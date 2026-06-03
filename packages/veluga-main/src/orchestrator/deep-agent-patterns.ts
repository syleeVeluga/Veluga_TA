import type {
  PolicyContext,
  SubAgentOutputContract,
  SubAgentPersona,
} from '../../../shared-types/src/index.js';
import {
  BUILTIN_GENERAL_SUBAGENT_PERSONA,
  SUMMARY_WITH_CITATIONS_CONTRACT,
} from '../../../shared-types/src/index.js';

export type DeepAgentPatternId = 'producer_reviewer' | 'supervisor' | 'fanout_summarize';

export interface DeepAgentPatternContract {
  id: DeepAgentPatternId;
  requiredPersonaRoles: string[];
  maxSubSessions: number;
  maxDepth: number;
  maxReplans: number;
  outputContract: SubAgentOutputContract;
}

export interface DeepAgentPatternStep {
  id: string;
  personaRole: string;
  personaId: string;
  objective: string;
  dependsOn: string[];
  tokenBudget: number;
  toolScope: string[];
}

export interface DeepAgentPatternPlan {
  patternId: DeepAgentPatternId;
  status: 'planned' | 'fallback';
  reason?: string;
  contract: DeepAgentPatternContract;
  steps: DeepAgentPatternStep[];
  maxReplans: number;
}

export interface PlanDeepAgentPatternInput {
  patternId: DeepAgentPatternId;
  objective: string;
  policy: PolicyContext;
  personas?: SubAgentPersona[];
  fanoutScopes?: string[];
}

export type DeepAgentPatternEventType =
  | 'deep_agent.replan.requested'
  | 'deep_agent.replan.completed'
  | 'deep_agent.replan.denied';

export interface DeepAgentPatternEvent {
  type: DeepAgentPatternEventType;
  patternId: DeepAgentPatternId;
  replanCount: number;
  reason?: string;
}

const REVIEW_VERDICT_CONTRACT: SubAgentOutputContract = {
  shape: 'review_verdict',
  schemaRef: 'SubAgentReviewVerdict',
};

const PATTERN_CONTRACTS: Record<DeepAgentPatternId, DeepAgentPatternContract> = {
  producer_reviewer: {
    id: 'producer_reviewer',
    requiredPersonaRoles: ['producer', 'reviewer'],
    maxSubSessions: 2,
    maxDepth: 1,
    maxReplans: 1,
    outputContract: REVIEW_VERDICT_CONTRACT,
  },
  supervisor: {
    id: 'supervisor',
    requiredPersonaRoles: ['supervisor', 'worker'],
    maxSubSessions: 3,
    maxDepth: 1,
    maxReplans: 1,
    outputContract: SUMMARY_WITH_CITATIONS_CONTRACT,
  },
  fanout_summarize: {
    id: 'fanout_summarize',
    requiredPersonaRoles: ['researcher'],
    maxSubSessions: 4,
    maxDepth: 1,
    maxReplans: 0,
    outputContract: SUMMARY_WITH_CITATIONS_CONTRACT,
  },
};

export function getDeepAgentPatternContracts(): DeepAgentPatternContract[] {
  return Object.values(PATTERN_CONTRACTS).map((contract) => ({ ...contract }));
}

export function planDeepAgentPattern(input: PlanDeepAgentPatternInput): DeepAgentPatternPlan {
  const contract = PATTERN_CONTRACTS[input.patternId];
  const deepAgentPolicy = input.policy.veluga.deep_agent;

  if (!deepAgentPolicy.enabled) {
    return fallback(input.patternId, contract, 'deep_agent disabled by policy');
  }
  if (!deepAgentPolicy.allowed_patterns.includes(input.patternId)) {
    return fallback(input.patternId, contract, `pattern denied by policy: ${input.patternId}`);
  }

  const effectiveContract: DeepAgentPatternContract = {
    ...contract,
    maxSubSessions: Math.min(contract.maxSubSessions, deepAgentPolicy.max_subsessions),
    maxDepth: Math.min(contract.maxDepth, deepAgentPolicy.max_depth),
    maxReplans: Math.min(contract.maxReplans, deepAgentPolicy.max_replans),
  };
  if (effectiveContract.maxDepth < contract.maxDepth) {
    return fallback(input.patternId, effectiveContract, 'pattern depth denied by policy');
  }

  const objective = input.objective.trim();
  if (!objective) {
    return fallback(input.patternId, effectiveContract, 'objective is required');
  }

  const personas = [BUILTIN_GENERAL_SUBAGENT_PERSONA, ...(input.personas || [])];
  const steps =
    input.patternId === 'producer_reviewer'
      ? producerReviewerSteps(objective, personas, deepAgentPolicy.allowed_tool_scopes)
      : input.patternId === 'supervisor'
        ? supervisorSteps(objective, personas, deepAgentPolicy.allowed_tool_scopes)
        : fanoutSummarizeSteps(
            objective,
            personas,
            deepAgentPolicy.allowed_tool_scopes,
            input.fanoutScopes || ['scope-a', 'scope-b']
          );

  if (steps.length > effectiveContract.maxSubSessions) {
    return fallback(input.patternId, effectiveContract, 'pattern sub-session count denied by policy');
  }

  return {
    patternId: input.patternId,
    status: 'planned',
    contract: effectiveContract,
    steps,
    maxReplans: effectiveContract.maxReplans,
  };
}

export class DeepAgentReplanGuard {
  private replanCount = 0;

  constructor(
    private readonly options: {
      patternId: DeepAgentPatternId;
      maxReplans: number;
      onEvent?: (event: DeepAgentPatternEvent) => void | Promise<void>;
    }
  ) {}

  async request(reason: string): Promise<boolean> {
    await this.emit('deep_agent.replan.requested', reason);
    if (this.replanCount >= this.options.maxReplans) {
      await this.emit('deep_agent.replan.denied', reason);
      return false;
    }
    this.replanCount += 1;
    await this.emit('deep_agent.replan.completed', reason);
    return true;
  }

  get count(): number {
    return this.replanCount;
  }

  private async emit(type: DeepAgentPatternEventType, reason: string): Promise<void> {
    await this.options.onEvent?.({
      type,
      patternId: this.options.patternId,
      replanCount: this.replanCount,
      reason,
    });
  }
}

function producerReviewerSteps(
  objective: string,
  personas: SubAgentPersona[],
  allowedToolScopes: string[]
): DeepAgentPatternStep[] {
  const producer = resolvePersona(personas, 'producer');
  const reviewer = resolvePersona(personas, 'reviewer');
  return [
    spawnStep('producer', producer, `Produce a bounded answer for: ${objective}`, [], allowedToolScopes),
    spawnStep(
      'reviewer',
      reviewer,
      `Review the producer result for: ${objective}`,
      ['producer'],
      allowedToolScopes
    ),
  ];
}

function supervisorSteps(
  objective: string,
  personas: SubAgentPersona[],
  allowedToolScopes: string[]
): DeepAgentPatternStep[] {
  const supervisor = resolvePersona(personas, 'supervisor');
  const worker = resolvePersona(personas, 'worker');
  return [
    spawnStep('supervisor', supervisor, `Decompose bounded work for: ${objective}`, [], allowedToolScopes),
    spawnStep('worker', worker, `Execute the highest-priority bounded subtask for: ${objective}`, ['supervisor'], allowedToolScopes),
  ];
}

function fanoutSummarizeSteps(
  objective: string,
  personas: SubAgentPersona[],
  allowedToolScopes: string[],
  fanoutScopes: string[]
): DeepAgentPatternStep[] {
  const researcher = resolvePersona(personas, 'researcher');
  return fanoutScopes.map((scope, index) =>
    spawnStep(
      `researcher-${index + 1}`,
      researcher,
      `Analyze ${scope} for: ${objective}`,
      [],
      allowedToolScopes
    )
  );
}

function spawnStep(
  id: string,
  persona: SubAgentPersona,
  objective: string,
  dependsOn: string[],
  allowedToolScopes: string[]
): DeepAgentPatternStep {
  const toolScope = persona.defaultToolScope.filter((scope) => allowedToolScopes.includes(scope));
  return {
    id,
    personaRole: id.replace(/-\d+$/, ''),
    personaId: persona.id,
    objective,
    dependsOn,
    tokenBudget: 8_000,
    toolScope: toolScope.length > 0 ? toolScope : allowedToolScopes.slice(0, 1),
  };
}

function resolvePersona(personas: SubAgentPersona[], role: string): SubAgentPersona {
  const match = personas.find((persona) => {
    const haystack = `${persona.id} ${persona.name} ${persona.description}`.toLowerCase();
    return haystack.includes(role);
  });
  return match || BUILTIN_GENERAL_SUBAGENT_PERSONA;
}

function fallback(
  patternId: DeepAgentPatternId,
  contract: DeepAgentPatternContract,
  reason: string
): DeepAgentPatternPlan {
  return {
    patternId,
    status: 'fallback',
    reason,
    contract,
    steps: [],
    maxReplans: 0,
  };
}
