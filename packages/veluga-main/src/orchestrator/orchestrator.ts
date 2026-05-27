import type { ContextFragment, WorkerTask, WorkPlan } from '../../../shared-types/src/index.js';

export const TERMINAL: ReadonlySet<WorkerTask['status']> = new Set(['completed', 'failed', 'aborted', 'skipped']);

export interface OrchestratorOptions {
  maxConcurrency?: number;
  defaultTimeoutMs?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
  retryCapMs?: number;
  maxSteps?: number;
  tokenBudget?: number;
}

export type RunWorker = (task: WorkerTask, signal: AbortSignal) => Promise<ContextFragment>;

export interface ExecutePlanResult {
  results: Record<string, ContextFragment>;
  failedRequired: WorkerTask[];
  tokensUsed: number;
}

export class NonRetryableWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableWorkerError';
  }
}

export class OrchestrationBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestrationBudgetError';
  }
}

export class VelugaOrchestrator {
  constructor(
    private readonly runWorker: RunWorker,
    private readonly opts: OrchestratorOptions = {}
  ) {}

  validate(plan: WorkPlan): { ok: true } | { ok: false; reason: string } {
    const ids = new Set<string>();
    for (const task of plan.tasks) {
      if (ids.has(task.id)) {
        return { ok: false, reason: `Duplicate task id: ${task.id}` };
      }
      ids.add(task.id);
    }

    for (const task of plan.tasks) {
      for (const dependency of task.dependencies) {
        if (!ids.has(dependency)) {
          return { ok: false, reason: `Task ${task.id} depends on missing task ${dependency}` };
        }
      }
    }

    const indegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    for (const task of plan.tasks) {
      indegree.set(task.id, task.dependencies.length);
      for (const dependency of task.dependencies) {
        outgoing.set(dependency, [...(outgoing.get(dependency) ?? []), task.id]);
      }
    }

    const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
    let visited = 0;
    while (queue.length > 0) {
      const id = queue.shift()!;
      visited += 1;
      for (const child of outgoing.get(id) ?? []) {
        const next = (indegree.get(child) ?? 0) - 1;
        indegree.set(child, next);
        if (next === 0) queue.push(child);
      }
    }

    return visited === plan.tasks.length ? { ok: true } : { ok: false, reason: 'WorkPlan contains a dependency cycle' };
  }

  async executePlan(
    plan: WorkPlan,
    onTaskUpdate: (task: WorkerTask) => void,
    signal: AbortSignal
  ): Promise<ExecutePlanResult> {
    const validation = this.validate(plan);
    if (!validation.ok) {
      throw new Error(validation.reason);
    }

    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener('abort', abort, { once: true });
    }

    try {
      return await this.runValidatedPlan(plan, onTaskUpdate, controller);
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }

  private async runValidatedPlan(
    plan: WorkPlan,
    onTaskUpdate: (task: WorkerTask) => void,
    controller: AbortController
  ): Promise<ExecutePlanResult> {
    const tasks = plan.tasks.map(cloneTask);
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const active = new Map<string, Promise<void>>();
    const results: Record<string, ContextFragment> = {};
    const maxConcurrency = Math.max(1, this.opts.maxConcurrency ?? 3);
    const maxSteps = Math.max(1, this.opts.maxSteps ?? Math.max(20, tasks.length * 8));
    const tokenBudget = this.opts.tokenBudget ?? Infinity;
    let steps = 0;
    let tokensUsed = 0;
    let tokenBudgetExceeded = false;

    const update = (task: WorkerTask, status: WorkerTask['status'], error?: string): void => {
      task.status = status;
      task.error = error;
      if (status === 'running') task.startedAt = Date.now();
      if (TERMINAL.has(status)) task.completedAt = Date.now();
      onTaskUpdate(cloneTask(task));
    };

    try {
      while (terminalCount(tasks) < tasks.length) {
        if (tokenBudgetExceeded) {
          markRemaining(tasks, update, 'aborted', 'token budget exceeded');
          throw new OrchestrationBudgetError('Orchestration tokenBudget exceeded');
        }
        if (controller.signal.aborted) {
          markRemaining(tasks, update, 'aborted', 'orchestration aborted');
          break;
        }
        steps += 1;
        if (steps > maxSteps) {
          controller.abort('max steps exceeded');
          markRemaining(tasks, update, 'aborted', 'max steps exceeded');
          throw new OrchestrationBudgetError('Orchestration maxSteps exceeded');
        }

        markBlocked(tasks, taskById, update);

        const runnable = tasks.filter(
          (task) =>
            task.status === 'pending' &&
            task.dependencies.every((dependency) => taskById.get(dependency)?.status === 'completed')
        );

        while (active.size < maxConcurrency && runnable.length > 0 && !controller.signal.aborted) {
          const task = runnable.shift()!;
          update(task, 'running');
          const promise = this.runWithRetry(task, controller.signal)
            .then((result) => {
              task.result = result;
              results[task.id] = result;
              tokensUsed += result.tokensUsed;
              update(task, 'completed');
              if (tokensUsed > tokenBudget) {
                tokenBudgetExceeded = true;
                controller.abort('token budget exceeded');
              }
            })
            .catch((error: unknown) => {
              const message = errorMessage(error);
              update(task, task.optional ? 'skipped' : 'failed', message);
            })
            .finally(() => {
              active.delete(task.id);
            });
          active.set(task.id, promise);
        }

        if (tokensUsed > tokenBudget) {
          markRemaining(tasks, update, 'aborted', 'token budget exceeded');
          throw new OrchestrationBudgetError('Orchestration tokenBudget exceeded');
        }

        if (active.size > 0) {
          await Promise.race(active.values());
          continue;
        }

        if (terminalCount(tasks) < tasks.length) {
          markRemaining(tasks, update, 'aborted', 'orchestration deadlock');
          break;
        }
      }

      return {
        results,
        failedRequired: tasks.filter((task) => !task.optional && task.status !== 'completed').map(cloneTask),
        tokensUsed
      };
    } finally {
      if (controller.signal.aborted) {
        await Promise.allSettled(active.values());
      }
    }
  }

  private async runWithRetry(task: WorkerTask, signal: AbortSignal): Promise<ContextFragment> {
    const maxAttempts = Math.max(1, this.opts.maxAttempts ?? 3);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (signal.aborted) throw abortError(signal);
      task.attempts = attempt;
      try {
        return await this.withTimeout(task, signal);
      } catch (error) {
        lastError = error;
        if (signal.aborted || attempt >= maxAttempts || !isRetryable(error)) {
          throw error;
        }
        await sleep(backoffDelay(attempt, this.opts), signal);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Worker failed');
  }

  private async withTimeout(task: WorkerTask, signal: AbortSignal): Promise<ContextFragment> {
    const controller = new AbortController();
    const timeoutMs = Math.max(1, this.opts.defaultTimeoutMs ?? 30000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;

    try {
      if (signal.aborted) {
        controller.abort(signal.reason);
      } else {
        abortListener = () => controller.abort(signal.reason);
        signal.addEventListener('abort', abortListener, { once: true });
      }

      return await Promise.race([
        this.runWorker(task, controller.signal),
        new Promise<ContextFragment>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort('worker timeout');
            reject(new TimeoutError(`Worker ${task.id} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      if (abortListener) signal.removeEventListener('abort', abortListener);
    }
  }
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

function cloneTask(task: WorkerTask): WorkerTask {
  return {
    ...task,
    dependencies: [...task.dependencies],
    outputContract: { ...task.outputContract },
    toolScope: [...task.toolScope],
    boundaries: [...task.boundaries],
    payload: clonePayload(task.payload),
    result: task.result
      ? {
          ...task.result,
          citations: [...task.result.citations]
        }
      : undefined
  };
}

function clonePayload(payload: Readonly<Record<string, string | string[]>>): Readonly<Record<string, string | string[]>> {
  const next: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(payload)) {
    next[key] = Array.isArray(value) ? [...value] : value;
  }
  return next;
}

function terminalCount(tasks: WorkerTask[]): number {
  return tasks.filter((task) => TERMINAL.has(task.status)).length;
}

function markBlocked(
  tasks: WorkerTask[],
  taskById: Map<string, WorkerTask>,
  update: (task: WorkerTask, status: WorkerTask['status'], error?: string) => void
): void {
  for (const task of tasks) {
    if (task.status !== 'pending') continue;
    const blocked = task.dependencies.some((dependency) => {
      const dep = taskById.get(dependency);
      return dep ? TERMINAL.has(dep.status) && dep.status !== 'completed' : false;
    });
    if (blocked) {
      update(task, task.optional ? 'skipped' : 'aborted', 'dependency did not complete');
    }
  }
}

function markRemaining(
  tasks: WorkerTask[],
  update: (task: WorkerTask, status: WorkerTask['status'], error?: string) => void,
  status: WorkerTask['status'],
  error: string
): void {
  for (const task of tasks) {
    if (!TERMINAL.has(task.status)) {
      update(task, task.optional && status === 'aborted' ? 'skipped' : status, error);
    }
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof NonRetryableWorkerError) return false;
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status: unknown }).status) : 0;
  if (status >= 500 && status <= 599) return true;
  const text = errorMessage(error).toLowerCase();
  if (/policy|deny|denied|forbidden|unauthorized|clearance|not active/.test(text)) return false;
  return /timeout|temporarily unavailable|econnreset|etimedout|gateway|rate limit|5\d\d/.test(text);
}

function backoffDelay(attempt: number, opts: OrchestratorOptions): number {
  const base = Math.max(0, opts.retryBaseMs ?? 250);
  const cap = Math.max(base, opts.retryCapMs ?? 4000);
  return Math.min(cap, base * 2 ** (attempt - 1)) + Math.random() * base;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', abort);
    const timer = setTimeout(() => {
      settled = true;
      cleanup();
      resolve();
    }, ms);
    const abort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(abortError(signal));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? 'aborted'));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
