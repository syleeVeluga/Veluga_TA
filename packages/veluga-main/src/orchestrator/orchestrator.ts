import type { ConditionalEdge, ContextFragment, WorkerTask, WorkerTaskStatus, WorkPlan } from '../../../shared-types/src/index.js';
import type { AbortCleanupRegistry } from './abort-cleanup.js';
import type { CheckpointStore } from './checkpoint-store.js';
import { outOfScopeTools } from './worker-scope.js';

export const TERMINAL: ReadonlySet<WorkerTaskStatus> = new Set(['completed', 'failed', 'aborted', 'skipped']);

export interface OrchestratorOptions {
  maxConcurrency?: number;
  defaultTimeoutMs?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
  retryCapMs?: number;
  maxSteps?: number;
  tokenBudget?: number;
  checkpointStore?: CheckpointStore;
  checkpointState?: string;
  abortCleanup?: AbortCleanupRegistry;
  enableConditionalEdges?: boolean;
  maxReplans?: number;
  onReplan?: (event: ConditionalReplanEvent) => void | Promise<void>;
}

export type RunWorker = (task: WorkerTask, signal: AbortSignal) => Promise<ContextFragment>;

export interface ConditionalReplanEvent {
  sessionId: string;
  edgeId: string;
  reason: string;
  addedTask: WorkerTask;
  replanCount: number;
}

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

export function validateWorkPlan(plan: WorkPlan): { ok: true } | { ok: false; reason: string } {
  const tasks = collectPlanTasks(plan);
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) {
      return { ok: false, reason: `Duplicate task id: ${task.id}` };
    }
    ids.add(task.id);

    const outOfScope = outOfScopeTools(task);
    if (outOfScope.length > 0) {
      return { ok: false, reason: `Task ${task.id} has out-of-scope tools: ${outOfScope.join(', ')}` };
    }
  }

  for (const edge of plan.dynamic?.conditionalEdges ?? []) {
    if (edge.id.trim().length === 0) {
      return { ok: false, reason: 'Conditional edge id is required' };
    }
    if (!ids.has(edge.condition.taskId)) {
      return { ok: false, reason: `Conditional edge ${edge.id} depends on missing task ${edge.condition.taskId}` };
    }
  }

  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (!ids.has(dependency)) {
        return { ok: false, reason: `Task ${task.id} depends on missing task ${dependency}` };
      }
    }
  }

  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const task of tasks) {
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

  return visited === tasks.length ? { ok: true } : { ok: false, reason: 'WorkPlan contains a dependency cycle' };
}

export class VelugaOrchestrator {
  private readonly activeControllers = new Set<AbortController>();

  constructor(
    private readonly runWorker: RunWorker,
    private readonly opts: OrchestratorOptions = {}
  ) {}

  validate(plan: WorkPlan): { ok: true } | { ok: false; reason: string } {
    return validateWorkPlan(plan);
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

    this.activeControllers.add(controller);
    this.opts.checkpointStore?.save(plan.sessionId, this.opts.checkpointState ?? 'RUNNING_PARALLEL', plan);

    try {
      const result = await this.runValidatedPlan(plan, onTaskUpdate, controller);
      if (result.failedRequired.length === 0 && !controller.signal.aborted) {
        this.opts.checkpointStore?.clear(plan.sessionId);
      }
      return result;
    } finally {
      this.activeControllers.delete(controller);
      signal.removeEventListener('abort', abort);
      if (controller.signal.aborted) {
        await this.opts.abortCleanup?.cleanup();
      }
    }
  }

  abortAll(reason = 'orchestration aborted'): void {
    for (const controller of this.activeControllers) {
      controller.abort(reason);
    }
  }

  private async runValidatedPlan(
    plan: WorkPlan,
    onTaskUpdate: (task: WorkerTask) => void,
    controller: AbortController
  ): Promise<ExecutePlanResult> {
    const tasks = plan.tasks.map(cloneTask);
    const taskById = new Map<string, WorkerTask>(tasks.map((task) => [task.id, task]));
    const active = new Map<string, Promise<void>>();
    const results: Record<string, ContextFragment> = {};
    const maxConcurrency = Math.max(1, this.opts.maxConcurrency ?? 3);
    const maxSteps = Math.max(1, this.opts.maxSteps ?? Math.max(20, tasks.length * 8));
    const tokenBudget = this.opts.tokenBudget ?? Infinity;
    const conditionalEdges = plan.dynamic?.conditionalEdges ?? [];
    const firedEdgeIds = new Set(plan.dynamic?.firedEdgeIds ?? []);
    const maxReplans = this.opts.enableConditionalEdges
      ? Math.max(0, this.opts.maxReplans ?? plan.dynamic?.maxReplans ?? 0)
      : 0;
    let replanCount = firedEdgeIds.size;
    let steps = 0;
    let tokensUsed = 0;
    let tokenBudgetExceeded = false;

    for (const task of tasks) {
      if (task.status === 'running') {
        task.status = 'pending';
        task.startedAt = undefined;
        task.error = undefined;
      }
      if (task.status === 'completed') {
        const result = task.result ?? this.opts.checkpointStore?.getCachedResult(plan.sessionId, task.idempotencyKey);
        if (result) {
          task.result = result;
          results[task.id] = result;
          tokensUsed += result.tokensUsed;
        } else {
          task.status = 'failed';
          task.error = 'completed task missing cached result';
        }
      }
    }

    const update = (task: WorkerTask, status: WorkerTask['status'], error?: string): void => {
      task.status = status;
      task.error = error;
      if (status === 'running') task.startedAt = Date.now();
      if (TERMINAL.has(status)) task.completedAt = Date.now();
      onTaskUpdate(cloneTask(task));
      this.opts.checkpointStore?.save(plan.sessionId, this.opts.checkpointState ?? 'RUNNING_PARALLEL', snapshotPlan(plan, tasks, firedEdgeIds));
    };

    const fireConditionalEdges = async (): Promise<void> => {
      if (maxReplans <= replanCount || conditionalEdges.length === 0) return;

      for (const edge of conditionalEdges) {
        if (maxReplans <= replanCount) return;
        if (firedEdgeIds.has(edge.id)) continue;
        if (!evaluateConditionalEdge(edge, taskById)) continue;

        const nextTask = cloneTask(edge.nextTask);
        if (taskById.has(nextTask.id)) {
          firedEdgeIds.add(edge.id);
          continue;
        }

        const candidateTasks = [...tasks, nextTask];
        const candidatePlan = snapshotPlan(plan, candidateTasks, new Set([...firedEdgeIds, edge.id]));
        const validation = validateWorkPlan(candidatePlan);
        if (!validation.ok) {
          firedEdgeIds.add(edge.id);
          continue;
        }

        firedEdgeIds.add(edge.id);
        replanCount += 1;
        tasks.push(nextTask);
        taskById.set(nextTask.id, nextTask);
        await this.opts.onReplan?.({
          sessionId: plan.sessionId,
          edgeId: edge.id,
          reason: edge.description,
          addedTask: cloneTask(nextTask),
          replanCount
        });
        update(nextTask, 'pending');
      }
    };

    const hasReadyConditionalEdge = (): boolean =>
      maxReplans > replanCount &&
      conditionalEdges.some((edge) => !firedEdgeIds.has(edge.id) && evaluateConditionalEdge(edge, taskById));

    try {
      while (terminalCount(tasks) < tasks.length || hasReadyConditionalEdge()) {
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
        await fireConditionalEdges();

        const runnable = tasks.filter(
          (task) =>
            task.status === 'pending' &&
            task.dependencies.every((dependency) => taskById.get(dependency)?.status === 'completed')
        );

        while (active.size < maxConcurrency && runnable.length > 0 && !controller.signal.aborted) {
          const task = runnable.shift()!;
          const cached = this.opts.checkpointStore?.getCachedResult(plan.sessionId, task.idempotencyKey);
          if (cached) {
            task.result = cached;
            results[task.id] = cached;
            tokensUsed += cached.tokensUsed;
            update(task, 'completed');
            continue;
          }
          update(task, 'running');
          const promise = this.runWithRetry(task, controller.signal)
            .then((result) => {
              task.result = result;
              results[task.id] = result;
              tokensUsed += result.tokensUsed;
              this.opts.checkpointStore?.putResult(plan.sessionId, task.idempotencyKey, result);
              update(task, 'completed');
              if (tokensUsed > tokenBudget) {
                tokenBudgetExceeded = true;
                controller.abort('token budget exceeded');
              }
            })
            .catch((error: unknown) => {
              const message = errorMessage(error);
              update(task, task.optional ? 'skipped' : controller.signal.aborted ? 'aborted' : 'failed', message);
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

function snapshotPlan(plan: WorkPlan, tasks: WorkerTask[], firedEdgeIds: ReadonlySet<string>): WorkPlan {
  return {
    ...plan,
    tasks: tasks.map(cloneTask),
    dynamic: plan.dynamic
      ? {
          conditionalEdges: plan.dynamic.conditionalEdges.map(cloneConditionalEdge),
          firedEdgeIds: [...firedEdgeIds].sort(),
          maxReplans: plan.dynamic.maxReplans
        }
      : undefined
  };
}

function cloneConditionalEdge(edge: ConditionalEdge): ConditionalEdge {
  return {
    ...edge,
    condition:
      edge.condition.kind === 'task_status_in'
        ? { ...edge.condition, statuses: [...edge.condition.statuses] }
        : { ...edge.condition },
    nextTask: cloneTask(edge.nextTask)
  };
}

function collectPlanTasks(plan: WorkPlan): WorkerTask[] {
  const tasks = plan.tasks.map(cloneTask);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const fired = new Set(plan.dynamic?.firedEdgeIds ?? []);

  for (const edge of plan.dynamic?.conditionalEdges ?? []) {
    if (taskById.has(edge.nextTask.id)) {
      if (!fired.has(edge.id)) {
        tasks.push(cloneTask(edge.nextTask));
      }
      continue;
    }
    const nextTask = cloneTask(edge.nextTask);
    tasks.push(nextTask);
    taskById.set(nextTask.id, nextTask);
  }

  return tasks;
}

export function evaluateConditionalEdge(edge: ConditionalEdge, taskById: ReadonlyMap<string, WorkerTask>): boolean {
  const task = taskById.get(edge.condition.taskId);
  if (!task) return false;

  switch (edge.condition.kind) {
    case 'result_citations_below':
      return task.status === 'completed' && (task.result?.citations.length ?? 0) < edge.condition.minCitations;
    case 'result_tokens_below':
      return task.status === 'completed' && (task.result?.tokensUsed ?? 0) < edge.condition.minTokens;
    case 'task_status_in':
      return edge.condition.statuses.includes(task.status);
  }
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
