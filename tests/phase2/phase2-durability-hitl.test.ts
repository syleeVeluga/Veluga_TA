import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ContextFragment, WorkerTask, WorkerType, WorkPlan } from '../../packages/shared-types/src/index.js';
import { AuditLogger } from '../../packages/veluga-main/src/audit-logger.js';
import { MockApprovalConnector } from '../../packages/veluga-main/src/approval/connector.js';
import { ApprovalQueue } from '../../packages/veluga-main/src/approval/approval-queue.js';
import { PolicyGuard } from '../../packages/veluga-main/src/agents/policy-guard.js';
import { AgentStateManager } from '../../packages/veluga-main/src/orchestrator/agent-state-manager.js';
import { AbortCleanupRegistry, type KillableProcess } from '../../packages/veluga-main/src/orchestrator/abort-cleanup.js';
import { CheckpointStore } from '../../packages/veluga-main/src/orchestrator/checkpoint-store.js';
import { VelugaOrchestrator } from '../../packages/veluga-main/src/orchestrator/orchestrator.js';
import { interceptTools } from '../../packages/veluga-main/src/tool-interceptor.js';
import { makePolicy } from '../phase1/helpers.js';

describe('Phase2 durability and HITL', () => {
  it('persists checkpoint state and idempotent task results', async () => {
    const dir = await tempDir();
    const store = new CheckpointStore(path.join(dir, 'checkpoint.sqlite'));
    await store.init();
    const plan = planWith([task('policy-preaudit')], 's-durable');

    store.save(plan.sessionId, 'RUNNING_PARALLEL', plan);
    store.putResult(plan.sessionId, 'policy-preaudit', fragment('policy-preaudit'));

    expect(store.loadOpenSessions()).toMatchObject([{ sessionId: 's-durable', state: 'RUNNING_PARALLEL' }]);
    expect(store.getCachedResult(plan.sessionId, 'policy-preaudit')?.summary).toContain('policy-preaudit');

    store.clear(plan.sessionId);
    expect(store.loadOpenSessions()).toEqual([]);
    expect(store.getCachedResult(plan.sessionId, 'policy-preaudit')).toBeNull();
  });

  it('resumes open checkpoints without rerunning cached idempotent tasks', async () => {
    const dir = await tempDir();
    const store = new CheckpointStore(path.join(dir, 'checkpoint.sqlite'));
    await store.init();
    const cached = { ...task('cached'), status: 'running' as const, idempotencyKey: 'cached-key' };
    const fresh = { ...task('fresh'), idempotencyKey: 'fresh-key' };
    const plan = planWith([cached, fresh], 's-resume', 'project_temp');
    store.save(plan.sessionId, 'RUNNING_PARALLEL', plan);
    store.putResult(plan.sessionId, 'cached-key', fragment('policy-preaudit'));

    const loaded = store.loadOpenSessions()[0].plan;
    const calls: string[] = [];
    const orchestrator = new VelugaOrchestrator(
      async (workerTask) => {
        calls.push(workerTask.id);
        return fragment(workerTask.workerType);
      },
      { checkpointStore: store, maxConcurrency: 1, maxAttempts: 1 }
    );

    const result = await orchestrator.executePlan(loaded, () => undefined, new AbortController().signal);

    expect(calls).toEqual(['fresh']);
    expect(Object.keys(result.results).sort()).toEqual(['cached', 'fresh']);
    expect(store.loadOpenSessions()).toEqual([]);
  });

  it('queues approval requests through permission flow instead of throwing', async () => {
    const { audit, policy, guard } = await approvalHarness('veluga-hitl-allow-');
    const queue = new ApprovalQueue({
      connector: new MockApprovalConnector(),
      audit,
      policyVersionId: policy.policy_version_id
    });
    const fsm = new AgentStateManager({ sessionId: 's-hitl', policy, audit });
    fsm.transition('PLANNING');
    fsm.transition('RUNNING_PARALLEL');
    let executed = false;
    const tools = interceptTools(
      [
        {
          name: 'write-file',
          execute: (_input: unknown) => {
            executed = true;
            return 'wrote';
          }
        }
      ],
      {
        guard,
        audit,
        sessionId: 's-hitl',
        policy,
        approval: {
          stateManager: fsm,
          queue,
          approverId: 'approver@veluga.io',
          now: () => new Date('2026-05-27T00:00:00.000Z'),
          requestPermission: async (_sessionId, _toolUseId, _toolName, input) => {
            expect(input.payload_hash).toEqual(expect.any(String));
            return 'allow';
          }
        }
      }
    );

    await expect(tools[0].execute({ path: 'out.txt' })).resolves.toBe('wrote');
    expect(executed).toBe(true);
    expect(fsm.current()).toBe('RUNNING_PARALLEL');
    expect(queue.list('approver@veluga.io').items).toHaveLength(1);
    expect(audit.all().map((row) => row.event_type)).toEqual(
      expect.arrayContaining(['hitl.requested', 'hitl.resolved', 'tool.called'])
    );
  });

  it('rejects approval responses when the payload hash drifts', async () => {
    const { audit, policy, guard } = await approvalHarness('veluga-hitl-drift-');
    const fsm = new AgentStateManager({ sessionId: 's-drift', policy, audit });
    fsm.transition('PLANNING');
    fsm.transition('RUNNING_PARALLEL');
    let executed = false;
    const tools = interceptTools(
      [
        {
          name: 'write-file',
          execute: (_input: unknown) => {
            executed = true;
            return 'wrote';
          }
        }
      ],
      {
        guard,
        audit,
        sessionId: 's-drift',
        policy,
        approval: {
          stateManager: fsm,
          requestPermission: async () => ({ result: 'allow', payloadHash: 'tampered' })
        }
      }
    );

    await expect(tools[0].execute({ path: 'out.txt' })).rejects.toThrow(/payload drift/);
    expect(executed).toBe(false);
    expect(audit.all().map((row) => row.event_type)).toContain('approval.payload_drift');
  });

  it('cleans tracked temp files and subprocesses when orchestration is aborted', async () => {
    const dir = await tempDir();
    const tempFile = path.join(dir, 'handoff.tmp');
    await writeFile(tempFile, 'temporary context', 'utf8');
    const cleanup = new AbortCleanupRegistry({ processKillGraceMs: 5 });
    const child = cleanup.trackChildProcess(new FakeProcess(true));
    cleanup.trackTempFile(tempFile);
    const orchestrator = new VelugaOrchestrator(
      async (_workerTask, signal) =>
        new Promise<ContextFragment>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
      { abortCleanup: cleanup, maxAttempts: 1, defaultTimeoutMs: 1000 }
    );

    const execution = orchestrator.executePlan(planWith([task('slow')], 's-abort'), () => undefined, new AbortController().signal);
    await delay(0);
    orchestrator.abortAll('user canceled');
    const result = await execution;

    expect(result.failedRequired[0].status).toBe('aborted');
    expect(existsSync(tempFile)).toBe(false);
    expect(child.signals).toEqual(['SIGTERM']);

    const stuckCleanup = new AbortCleanupRegistry({ processKillGraceMs: 1 });
    const stuck = stuckCleanup.trackChildProcess(new FakeProcess(false));
    const summary = await stuckCleanup.cleanup();
    expect(stuck.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(summary.processesKilled).toBe(1);
  });
});

async function approvalHarness(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const audit = new AuditLogger(path.join(dir, 'audit.sqlite'));
  await audit.init();
  const policy = makePolicy({
    institution: {
      approval_for_destructive: 'required',
      policy_guard_mode: 'enforce'
    }
  });
  const guard = new PolicyGuard(audit);
  guard.register({ name: 'write-file', privilege: 'WRITE_LOCAL' });
  return { audit, policy, guard };
}

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'veluga-phase2-durable-'));
}

function planWith(
  tasks: WorkerTask[],
  sessionId: string,
  dataPassingMode: WorkPlan['dataPassingMode'] = 'memory'
): WorkPlan {
  return {
    sessionId,
    tasks,
    dataPassingMode,
    effortTier: 'small',
    rationale: 'durability test'
  };
}

function task(id: string, workerType: WorkerType = 'policy-preaudit'): WorkerTask {
  return {
    id,
    workerType,
    dependencies: [],
    objective: 'test',
    outputContract: { shape: 'context_fragment', schemaRef: 'ContextFragment' },
    toolScope: ['policy.read'],
    boundaries: [],
    payload: {},
    status: 'pending',
    optional: false,
    attempts: 0,
    idempotencyKey: id
  };
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

class FakeProcess extends EventEmitter implements KillableProcess {
  readonly signals: string[] = [];

  constructor(private readonly exitsOnTerm: boolean) {
    super();
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(String(signal));
    if (signal === 'SIGTERM' && this.exitsOnTerm) {
      setTimeout(() => this.emit('exit', 0, signal), 0);
    }
    return true;
  }
}
