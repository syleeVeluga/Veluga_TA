import { describe, expect, it } from 'vitest';
import type { ContextFragment, IntentPlan, WorkerTask, WorkerType, WorkPlan } from '../../packages/shared-types/src/index.js';
import { VelugaOrchestrator } from '../../packages/veluga-main/src/orchestrator/orchestrator.js';
import { buildWorkPlan, sanitizeGeneratedWorkPlan } from '../../packages/veluga-main/src/orchestrator/planner.js';
import { BoundedSubSessionBudgetError, BoundedSubSessionRunner } from '../../packages/veluga-main/src/orchestrator/sub-session.js';
import { makePolicy } from '../phase1/helpers.js';

describe('Phase3 optional dynamic orchestration', () => {
  it('keeps conditional edges default-off and adds them only when the session flag is enabled', () => {
    const intent = kbIntent();
    const defaultPlan = buildWorkPlan('Summarize the KB policy guidance', intent, makePolicy());
    const dynamicPlan = buildWorkPlan(
      'Summarize the KB policy guidance',
      intent,
      makePolicy({ session: { dynamic_orchestration: { conditional_edges: true } } })
    );

    expect(defaultPlan.dynamic).toBeUndefined();
    expect(dynamicPlan.dynamic?.conditionalEdges.map((edge) => edge.id)).toEqual(['kb-insufficient-evidence-file-analysis']);
    expect(dynamicPlan.tasks.some((task) => task.workerType === 'file-analysis')).toBe(false);
  });

  it('fires a pure conditional edge once when KB evidence is insufficient', async () => {
    const plan = buildWorkPlan(
      'Summarize the KB policy guidance',
      kbIntent(),
      makePolicy({ session: { dynamic_orchestration: { conditional_edges: true } } })
    );
    const calls: string[] = [];
    const replanEdges: string[] = [];
    const orchestrator = new VelugaOrchestrator(
      async (workerTask) => {
        calls.push(workerTask.id);
        if (workerTask.id === 'kb-retrieval') return fragment('kb-retrieval', 0);
        return fragment(workerTask.workerType, 1);
      },
      {
        enableConditionalEdges: true,
        maxReplans: 1,
        maxConcurrency: 1,
        maxAttempts: 1,
        onReplan: (event) => {
          replanEdges.push(event.edgeId);
        }
      }
    );

    const result = await orchestrator.executePlan(plan, () => undefined, new AbortController().signal);

    expect(replanEdges).toEqual(['kb-insufficient-evidence-file-analysis']);
    expect(calls).toEqual(['policy-preaudit', 'kb-retrieval', 'file-analysis-after-kb-gap']);
    expect(result.failedRequired).toEqual([]);
    expect(Object.keys(result.results)).toEqual(expect.arrayContaining(['kb-retrieval', 'file-analysis-after-kb-gap']));
  });

  it('ignores conditional edges when the execution flag is disabled', async () => {
    const plan = buildWorkPlan(
      'Summarize the KB policy guidance',
      kbIntent(),
      makePolicy({ session: { dynamic_orchestration: { conditional_edges: true } } })
    );
    const calls: string[] = [];
    const orchestrator = new VelugaOrchestrator(
      async (workerTask) => {
        calls.push(workerTask.id);
        if (workerTask.id === 'kb-retrieval') return fragment('kb-retrieval', 0);
        return fragment(workerTask.workerType, 1);
      },
      { enableConditionalEdges: false, maxConcurrency: 1, maxAttempts: 1 }
    );

    await orchestrator.executePlan(plan, () => undefined, new AbortController().signal);

    expect(calls).toEqual(['policy-preaudit', 'kb-retrieval']);
  });

  it('validates generated dynamic tasks and falls back unless dynamic DAG is explicitly enabled with high confidence', () => {
    const fallback = planWith([task('policy-preaudit')]);
    const candidate = planWith([
      task('generated-file', {
        workerType: 'file-analysis',
        toolScope: ['project.read', 'kb_search']
      })
    ]);
    const offPolicy = makePolicy();
    const onPolicy = makePolicy({ session: { dynamic_orchestration: { dynamic_dag: true } } });

    expect(sanitizeGeneratedWorkPlan({ candidate, fallback, policy: offPolicy, confidence: 'high' })).toBe(fallback);
    expect(sanitizeGeneratedWorkPlan({ candidate, fallback, policy: onPolicy, confidence: 'low' })).toBe(fallback);

    const sanitized = sanitizeGeneratedWorkPlan({ candidate, fallback, policy: onPolicy, confidence: 'high' });
    expect(sanitized).not.toBe(fallback);
    expect(sanitized.sessionId).toBe(fallback.sessionId);
    expect(sanitized.tasks[0].toolScope).toEqual(['project.read']);

    const disallowedOnly = planWith([task('bad-file', { workerType: 'file-analysis', toolScope: ['kb_search'] })]);
    expect(sanitizeGeneratedWorkPlan({ candidate: disallowedOnly, fallback, policy: onPolicy, confidence: 'high' })).toBe(fallback);

    const invalidDynamic = {
      ...fallback,
      dynamic: {
        conditionalEdges: [
          {
            id: 'bad-scope',
            description: 'bad generated edge',
            condition: { kind: 'task_status_in' as const, taskId: 'policy-preaudit', statuses: ['completed' as const] },
            nextTask: task('bad-file', { workerType: 'file-analysis', toolScope: ['kb_search'], dependencies: ['policy-preaudit'] })
          }
        ],
        firedEdgeIds: [],
        maxReplans: 1
      }
    };
    expect(new VelugaOrchestrator(async (workerTask) => fragment(workerTask.workerType)).validate(invalidDynamic)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('out-of-scope')
    });
  });

  it('enforces bounded sub-session count and token budgets and is inert when disabled', async () => {
    let calls = 0;
    const request = {
      id: 'sub-a',
      objective: 'Summarize isolated evidence.',
      boundaries: ['Return summary only.'],
      tokenBudget: 10
    };
    const disabled = new BoundedSubSessionRunner({
      enabled: false,
      maxSubSessions: 1,
      tokenBudget: 10,
      run: async () => {
        calls += 1;
        return { id: 'sub-a', summary: 'should not run', citations: [], tokensUsed: 1 };
      }
    });

    await expect(disabled.runAll([request], new AbortController().signal)).resolves.toEqual([]);
    expect(calls).toBe(0);

    const enabled = new BoundedSubSessionRunner({
      enabled: true,
      maxSubSessions: 1,
      tokenBudget: 10,
      run: async (subRequest) => ({ id: subRequest.id, summary: 'summary only', citations: [], tokensUsed: 5 })
    });
    await expect(enabled.runAll([request], new AbortController().signal)).resolves.toEqual([
      { id: 'sub-a', summary: 'summary only', citations: [], tokensUsed: 5 }
    ]);
    await expect(enabled.runAll([request, { ...request, id: 'sub-b' }], new AbortController().signal)).rejects.toThrow(
      BoundedSubSessionBudgetError
    );

    const overBudget = new BoundedSubSessionRunner({
      enabled: true,
      maxSubSessions: 1,
      tokenBudget: 10,
      run: async (subRequest) => ({ id: subRequest.id, summary: 'too large', citations: [], tokensUsed: 11 })
    });
    await expect(overBudget.runAll([request], new AbortController().signal)).rejects.toThrow(BoundedSubSessionBudgetError);
  });
});

function kbIntent(): IntentPlan {
  return {
    intent_class: 'general_qa',
    answer_mode: 'kb_grounded',
    use_kb: true,
    kb_scopes: ['law:public'],
    suggested_skills: [],
    needs_clarification: false,
    clarification_questions: []
  };
}

function planWith(tasks: WorkerTask[]): WorkPlan {
  return {
    sessionId: 's-dynamic',
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
    boundaries: ['test boundary'],
    payload: {},
    status: 'pending',
    optional: overrides.optional ?? false,
    attempts: 0,
    idempotencyKey: id
  };
}

function fragment(workerType: WorkerType, citations = 1): ContextFragment {
  return {
    workerType,
    summary: `${workerType} summary [parametric:high]`,
    citations: Array.from({ length: citations }, () => ({ kind: 'parametric' as const, level: 'high' as const })),
    tokensUsed: 10
  };
}
