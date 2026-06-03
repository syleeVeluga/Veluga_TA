import { describe, expect, it } from 'vitest';
import type { SubAgentPersona } from '../../packages/shared-types/src/index.js';
import {
  DeepAgentReplanGuard,
  getDeepAgentPatternContracts,
  planDeepAgentPattern,
} from '../../packages/veluga-main/src/orchestrator/deep-agent-patterns.js';
import { makePolicy } from '../phase1/helpers.js';

const PERSONAS: SubAgentPersona[] = [
  persona('producer', 'Producer'),
  persona('reviewer', 'Reviewer'),
  persona('researcher', 'Researcher'),
  persona('supervisor', 'Supervisor'),
  persona('worker', 'Worker'),
];

describe('Phase3 Deep Agent review patterns', () => {
  it('declares lightweight pattern contracts without adding system agents', () => {
    const contracts = getDeepAgentPatternContracts();

    expect(contracts.map((contract) => contract.id)).toEqual([
      'producer_reviewer',
      'supervisor',
      'fanout_summarize',
    ]);
    expect(contracts.find((contract) => contract.id === 'producer_reviewer')).toMatchObject({
      requiredPersonaRoles: ['producer', 'reviewer'],
      maxSubSessions: 2,
      maxDepth: 1,
      outputContract: { shape: 'review_verdict' },
    });
  });

  it('plans producer-reviewer as sequential bounded spawn steps', () => {
    const plan = planDeepAgentPattern({
      patternId: 'producer_reviewer',
      objective: 'Assess the memo for unsupported claims.',
      policy: deepPolicy(),
      personas: PERSONAS,
    });

    expect(plan.status).toBe('planned');
    expect(plan.steps.map((step) => step.id)).toEqual(['producer', 'reviewer']);
    expect(plan.steps[1]).toMatchObject({
      personaId: 'reviewer',
      dependsOn: ['producer'],
      toolScope: ['read', 'grep', 'glob'],
    });
  });

  it('falls back when policy disables a pattern or depth is too low', () => {
    const denied = planDeepAgentPattern({
      patternId: 'producer_reviewer',
      objective: 'Review this.',
      policy: deepPolicy({ allowed_patterns: ['fanout_summarize'] }),
      personas: PERSONAS,
    });
    const depthDenied = planDeepAgentPattern({
      patternId: 'producer_reviewer',
      objective: 'Review this.',
      policy: deepPolicy({ max_depth: 0 }),
      personas: PERSONAS,
    });

    expect(denied).toMatchObject({
      status: 'fallback',
      reason: 'pattern denied by policy: producer_reviewer',
    });
    expect(depthDenied).toMatchObject({
      status: 'fallback',
      reason: 'pattern depth denied by policy',
    });
  });

  it('bounds fanout by policy maxSubSessions', () => {
    const allowed = planDeepAgentPattern({
      patternId: 'fanout_summarize',
      objective: 'Compare three files.',
      policy: deepPolicy({ max_subsessions: 4 }),
      personas: PERSONAS,
      fanoutScopes: ['file-a', 'file-b', 'file-c'],
    });
    const denied = planDeepAgentPattern({
      patternId: 'fanout_summarize',
      objective: 'Compare three files.',
      policy: deepPolicy({ max_subsessions: 2 }),
      personas: PERSONAS,
      fanoutScopes: ['file-a', 'file-b', 'file-c'],
    });

    expect(allowed.status).toBe('planned');
    expect(allowed.steps).toHaveLength(3);
    expect(denied).toMatchObject({
      status: 'fallback',
      reason: 'pattern sub-session count denied by policy',
    });
  });

  it('emits requested/completed/denied replan events and enforces maxReplans', async () => {
    const events: string[] = [];
    const guard = new DeepAgentReplanGuard({
      patternId: 'producer_reviewer',
      maxReplans: 1,
      onEvent: (event) => {
        events.push(`${event.type}:${event.replanCount}`);
      },
    });

    await expect(guard.request('review failed')).resolves.toBe(true);
    await expect(guard.request('review still failed')).resolves.toBe(false);

    expect(events).toEqual([
      'deep_agent.replan.requested:0',
      'deep_agent.replan.completed:1',
      'deep_agent.replan.requested:1',
      'deep_agent.replan.denied:1',
    ]);
  });
});

function deepPolicy(overrides: Record<string, unknown> = {}) {
  return makePolicy({
    session: {
      deep_agent: {
        enabled: true,
        max_depth: 1,
        max_subsessions: 4,
        allowed_tool_scopes: ['read', 'grep', 'glob'],
        allowed_patterns: ['producer_reviewer', 'supervisor', 'fanout_summarize'],
        max_replans: 1,
        ...overrides,
      },
    },
  });
}

function persona(id: string, name: string): SubAgentPersona {
  return {
    id,
    name,
    description: `${name} persona`,
    systemPrefix: `${name} bounded subagent.`,
    defaultToolScope: ['read', 'grep', 'glob'],
    source: 'plugin',
    pluginId: 'deep-agent-basic-team',
    sourcePathHash: id,
  };
}
