export type IntentClass =
  | 'conversational'
  | 'general_qa'
  | 'how_to_assist'
  | 'planning_assistance'
  | 'summarize_project'
  | 'draft_with_grounding'
  | 'compare_project_vs_kb'
  | 'compliance_check'
  | 'format_conversion';

export type AnswerMode = 'general' | 'project_only' | 'kb_grounded' | 'mixed';

export interface IntentPlan {
  intent_class: IntentClass;
  answer_mode: AnswerMode;
  use_kb: boolean;
  kb_scopes: string[];
  suggested_skills: string[];
  needs_clarification: boolean;
  clarification_questions: string[];
  fast_path_hit?: 'greeting' | 'thanks' | 'ack' | 'self_help' | 'explicit_skill';
}

export interface GateDecision {
  allow: boolean;
  reason: string;
  alternatives: string[];
  scope_overrides?: string[];
}

export interface SkillStep {
  id: string;
  mode: 'read' | 'write';
}

export interface SkillActivationPlan {
  ordered_skills: SkillStep[];
  data_passing: 'memory' | 'project_temp';
  rationale: string;
  unresolved_skills: string[];
}

export interface GeneralPlan {
  confidence: 'high' | 'medium' | 'low' | 'refuse';
  category: 'conversational' | 'common_knowledge' | 'how_to' | 'user_planning' | 'out_of_scope';
  steps: string[];
  escalate_to_kb: null | { reason: string; suggested_scopes: string[] };
  knowledge_boundaries: string[];
}

export interface GeneralResponse {
  text: string;
  citation_tags: CitationTag[];
  escalation_offered: boolean;
}

export type CitationTag =
  | { kind: 'kb'; doc_id: string; as_of: string }
  | { kind: 'nb'; file_id: string; chunk_id: string }
  | { kind: 'parametric'; level: 'high' | 'low' };

export type WorkerType = 'kb-retrieval' | 'file-analysis' | 'policy-preaudit' | 'style-card-load';

export type WorkerTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'aborted' | 'skipped';

export type ConditionalEdgeCondition =
  | { kind: 'result_citations_below'; taskId: string; minCitations: number }
  | { kind: 'result_tokens_below'; taskId: string; minTokens: number }
  | { kind: 'task_status_in'; taskId: string; statuses: WorkerTaskStatus[] };

export interface ContextFragment {
  workerType: WorkerType;
  summary: string;
  citations: CitationTag[];
  tokensUsed: number;
}

export interface WorkerTask {
  id: string;
  workerType: WorkerType;
  dependencies: string[];
  objective: string;
  outputContract: { shape: 'context_fragment'; schemaRef: string };
  toolScope: string[];
  boundaries: string[];
  payload: Readonly<Record<string, string | string[]>>;
  status: WorkerTaskStatus;
  optional: boolean;
  attempts: number;
  idempotencyKey: string;
  result?: ContextFragment;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface ConditionalEdge {
  id: string;
  description: string;
  condition: ConditionalEdgeCondition;
  nextTask: WorkerTask;
}

export interface DynamicWorkPlan {
  conditionalEdges: ConditionalEdge[];
  firedEdgeIds: string[];
  maxReplans: number;
}

export type DeepAgentExecutionMode = 'default' | 'deep_agent';

export interface SubAgentPersona {
  id: string;
  name: string;
  description: string;
  systemPrefix: string;
  defaultToolScope: string[];
  source: 'builtin' | 'plugin';
  pluginId?: string;
  sourcePathHash?: string;
}

export interface SubAgentOutputContract {
  shape: 'summary_with_citations' | 'review_verdict';
  schemaRef: string;
}

export const BUILTIN_GENERAL_SUBAGENT_PERSONA: SubAgentPersona = {
  id: 'general_subagent',
  name: 'General subagent',
  description: 'General-purpose bounded assistant for delegated subtasks.',
  systemPrefix:
    'You are a bounded Veluga subagent. Complete only the assigned objective, obey the boundaries and tool scope, and return tagged evidence.',
  defaultToolScope: ['read', 'grep', 'glob'],
  source: 'builtin'
};

export const SUMMARY_WITH_CITATIONS_CONTRACT: SubAgentOutputContract = {
  shape: 'summary_with_citations',
  schemaRef: 'SubAgentSummaryWithCitations'
};

export interface BoundedSubSessionRequest {
  id: string;
  parentSessionId: string;
  objective: string;
  boundaries: string[];
  tokenBudget: number;
  depth: number;
  persona: SubAgentPersona;
  toolScope: string[];
  outputContract: SubAgentOutputContract;
  policyContextRef?: string;
}

export interface BoundedSubSessionResult {
  id: string;
  parentSessionId: string;
  personaId: string;
  summary: string;
  citations: CitationTag[];
  tokensUsed: number;
  status: 'completed' | 'failed' | 'aborted';
  error?: string;
}

export interface WorkPlan {
  sessionId: string;
  tasks: WorkerTask[];
  dataPassingMode: 'memory' | 'project_temp';
  effortTier: 'single' | 'small' | 'broad';
  rationale: string;
  dynamic?: DynamicWorkPlan;
}
