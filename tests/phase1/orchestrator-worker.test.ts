import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ContextFragment, IntentPlan, WorkerTask, WorkerType, WorkPlan } from '../../packages/shared-types/src/index.js';
import { AuditLogger } from '../../packages/veluga-main/src/audit-logger.js';
import { AgentStateManager } from '../../packages/veluga-main/src/orchestrator/agent-state-manager.js';
import { VelugaOrchestrator, type RunWorker } from '../../packages/veluga-main/src/orchestrator/orchestrator.js';
import { buildWorkPlan } from '../../packages/veluga-main/src/orchestrator/planner.js';
import { createRunWorker } from '../../packages/veluga-main/src/orchestrator/worker-bridge.js';
import { handleUserMessage, type OrchestrationStateUpdate } from '../../packages/veluga-main/src/ipc-middleware.js';
import { makePolicy } from './helpers.js';

describe('Phase1 orchestrator-worker engine', () => {
  it('rejects missing dependencies and dependency cycles before execution', () => {
    const orchestrator = new VelugaOrchestrator(successWorker);

    expect(orchestrator.validate(planWith([task('a', { dependencies: ['missing'] })]))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('missing')
    });
    expect(
      orchestrator.validate(
        planWith([
          task('a', { dependencies: ['b'] }),
          task('b', { dependencies: ['a'] })
        ])
      )
    ).toMatchObject({ ok: false, reason: expect.stringContaining('cycle') });
  });

  it('degrades optional failures while continuing independent required work', async () => {
    const updates: WorkerTask[] = [];
    const orchestrator = new VelugaOrchestrator(
      async (workerTask) => {
        if (workerTask.id === 'optional') throw new Error('temporary gateway 503');
        return fragment(workerTask.workerType);
      },
      { maxAttempts: 1, retryBaseMs: 0 }
    );

    const result = await orchestrator.executePlan(
      planWith([task('optional', { optional: true }), task('required')]),
      (workerTask) => updates.push(workerTask),
      new AbortController().signal
    );

    expect(result.failedRequired).toEqual([]);
    expect(lastUpdate(updates, 'optional')?.status).toBe('skipped');
    expect(lastUpdate(updates, 'required')?.status).toBe('completed');
  });

  it('cascades required failures to dependent tasks as aborted', async () => {
    const updates: WorkerTask[] = [];
    const orchestrator = new VelugaOrchestrator(
      async (workerTask) => {
        if (workerTask.id === 'root') throw new Error('policy denied');
        return fragment(workerTask.workerType);
      },
      { maxAttempts: 1 }
    );

    const result = await orchestrator.executePlan(
      planWith([task('root'), task('child', { dependencies: ['root'] })]),
      (workerTask) => updates.push(workerTask),
      new AbortController().signal
    );

    expect(result.failedRequired.map((workerTask) => workerTask.id)).toEqual(['root', 'child']);
    expect(lastUpdate(updates, 'root')?.status).toBe('failed');
    expect(lastUpdate(updates, 'child')?.status).toBe('aborted');
  });

  it('honors maxConcurrency and retries transient worker errors', async () => {
    let active = 0;
    let maxActive = 0;
    const attempts = new Map<string, number>();
    const worker: RunWorker = async (workerTask) => {
      const attempt = (attempts.get(workerTask.id) ?? 0) + 1;
      attempts.set(workerTask.id, attempt);
      if (workerTask.id === 'retry' && attempt === 1) {
        throw new Error('gateway 503');
      }
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(10);
      active -= 1;
      return fragment(workerTask.workerType);
    };
    const orchestrator = new VelugaOrchestrator(worker, { maxConcurrency: 2, retryBaseMs: 0, retryCapMs: 0 });

    await orchestrator.executePlan(
      planWith([task('retry'), task('b'), task('c'), task('d')]),
      () => undefined,
      new AbortController().signal
    );

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(attempts.get('retry')).toBe(2);
  });

  it('times out workers and records required failure without hanging the plan', async () => {
    const updates: WorkerTask[] = [];
    const orchestrator = new VelugaOrchestrator(
      () => new Promise<ContextFragment>(() => undefined),
      { defaultTimeoutMs: 5, maxAttempts: 1 }
    );

    const result = await orchestrator.executePlan(planWith([task('slow')]), (workerTask) => updates.push(workerTask), new AbortController().signal);

    expect(result.failedRequired.map((workerTask) => workerTask.id)).toEqual(['slow']);
    expect(lastUpdate(updates, 'slow')?.error).toContain('timed out');
  });

  it('records aborted required tasks as failed required work', async () => {
    const controller = new AbortController();
    controller.abort('user canceled');
    const orchestrator = new VelugaOrchestrator(successWorker);

    const result = await orchestrator.executePlan(planWith([task('canceled')]), () => undefined, controller.signal);

    expect(result.failedRequired.map((workerTask) => workerTask.id)).toEqual(['canceled']);
    expect(result.failedRequired[0].status).toBe('aborted');
  });
});

describe('Phase1 FSM, planner, and IPC route', () => {
  it('throws and audits illegal FSM transitions', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'veluga-orch-fsm-'));
    const audit = new AuditLogger(path.join(dir, 'audit.sqlite'));
    await audit.init();
    const policy = makePolicy();
    const fsm = new AgentStateManager({ sessionId: 's-fsm', policy, audit });

    expect(() => fsm.transition('STREAMING_RESPONSE')).toThrow(/Illegal orchestration transition/);
    expect(audit.all().map((row) => row.event_type)).toEqual(['orchestration.illegal_transition']);
  });

  it('builds sanitized static work plans with no unauthorized scopes or skills', () => {
    const policy = makePolicy({ user: { extra_skills: ['style-card'], denied_skills: [], kb_extra_scopes: ['audit:confidential'] } });
    const intent: IntentPlan = {
      intent_class: 'draft_with_grounding',
      answer_mode: 'mixed',
      use_kb: true,
      kb_scopes: ['law:public', 'audit:confidential', 'not:allowed'],
      suggested_skills: ['style-card', 'not-enabled'],
      needs_clarification: false,
      clarification_questions: []
    };

    const plan = buildWorkPlan('프로젝트 문서와 KB 정책 비교 보고서 초안', intent, policy);
    const kbTask = plan.tasks.find((workerTask) => workerTask.workerType === 'kb-retrieval');

    expect(plan.tasks.map((workerTask) => workerTask.id)).toEqual(
      expect.arrayContaining(['policy-preaudit', 'kb-retrieval', 'file-analysis', 'style-card-load'])
    );
    expect(kbTask?.payload.kbScopes).toEqual(['law:public']);
    expect(plan.tasks.every((workerTask) => workerTask.dependencies.length === 0)).toBe(true);
  });

  it('preserves mode-off fallback and routes mode-on non-fast-path through orchestration context', async () => {
    const offPolicy = makePolicy({ session: { enable_veluga_orchestration: false } });
    await expect(handleUserMessage('프로젝트 문서 요약', offPolicy, (input) => input)).resolves.toBe('프로젝트 문서 요약');

    const stateEvents: OrchestrationStateUpdate[] = [];
    const onPolicy = makePolicy();
    const response = await handleUserMessage(
      '프로젝트 문서 요약',
      onPolicy,
      (input) => {
        expect(input).toContain('Veluga orchestration context follows');
        expect(input).toContain('file-analysis');
        expect(input).toContain('policy-preaudit');
        return 'fallback response';
      },
      undefined,
      {
        onOrchestrationState: (event) => stateEvents.push(event),
        orchestratorOptions: { maxAttempts: 1, retryBaseMs: 0 }
      }
    );

    expect(response).toBe('fallback response');
    expect(stateEvents.map((event) => event.payload.agentStatus)).toEqual(expect.arrayContaining(['PLANNING', 'RUNNING_PARALLEL']));
  });

  it('keeps file-analysis inside projectRoot and ignores symlinked external files', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'veluga-orch-files-'));
    const projectRoot = path.join(dir, 'project');
    const outsideRoot = path.join(dir, 'outside');
    await mkdir(projectRoot);
    await mkdir(outsideRoot);
    await writeFile(path.join(projectRoot, 'inside.md'), 'inside project evidence');
    await writeFile(path.join(outsideRoot, 'secret.md'), 'outside secret evidence');

    try {
      await symlink(outsideRoot, path.join(projectRoot, 'linked-outside'), 'junction');
    } catch {
      return;
    }

    const worker = createRunWorker({ message: 'summarize files', policy: makePolicy(), projectRoot });
    const result = await worker(
      task('file-analysis', { workerType: 'file-analysis', toolScope: ['project.read'] }),
      new AbortController().signal
    );

    expect(result.summary).toContain('inside project evidence');
    expect(result.summary).not.toContain('outside secret evidence');
  });
});

function planWith(tasks: WorkerTask[]): WorkPlan {
  return {
    sessionId: 's-test',
    tasks,
    dataPassingMode: 'memory',
    effortTier: 'small',
    rationale: 'test'
  };
}

function task(
  id: string,
  overrides: Partial<Pick<WorkerTask, 'dependencies' | 'optional' | 'workerType' | 'toolScope'>> = {}
): WorkerTask {
  const workerType = overrides.workerType ?? 'policy-preaudit';
  return {
    id,
    workerType,
    dependencies: overrides.dependencies ?? [],
    objective: 'test',
    outputContract: { shape: 'context_fragment', schemaRef: 'ContextFragment' },
    toolScope: overrides.toolScope ?? ['policy.read'],
    boundaries: [],
    payload: {},
    status: 'pending',
    optional: overrides.optional ?? false,
    attempts: 0,
    idempotencyKey: id
  };
}

async function successWorker(workerTask: WorkerTask): Promise<ContextFragment> {
  return fragment(workerTask.workerType);
}

function fragment(workerType: WorkerType): ContextFragment {
  return {
    workerType,
    summary: `${workerType} summary [parametric:high]`,
    citations: [{ kind: 'parametric', level: 'high' }],
    tokensUsed: 10
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lastUpdate(updates: WorkerTask[], id: string): WorkerTask | undefined {
  for (let index = updates.length - 1; index >= 0; index -= 1) {
    if (updates[index].id === id) return updates[index];
  }
  return undefined;
}
