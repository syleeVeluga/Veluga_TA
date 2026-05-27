import { createHash } from 'node:crypto';
import type { ConditionalEdge, IntentPlan, PolicyContext, WorkerTask, WorkerType, WorkPlan } from '../../../shared-types/src/index.js';
import { validateWorkPlan } from './orchestrator.js';
import { WORKER_TOOL_SCOPE } from './worker-scope.js';

export function buildWorkPlan(message: string, intent: IntentPlan, policy: PolicyContext): WorkPlan {
  const sessionId = `orch_${createHash('sha256').update(`${Date.now()}:${message}`).digest('hex').slice(0, 12)}`;
  const kbScopes = sanitizeScopes(intent.kb_scopes, policy);
  const skills = sanitizeSkills(intent.suggested_skills, policy);
  const tasks: WorkerTask[] = [];

  tasks.push(
    createTask({
      sessionId,
      workerType: 'policy-preaudit',
      optional: false,
      objective: 'Summarize applicable policy constraints before generation.',
      toolScope: ['policy.read'],
      boundaries: ['Do not alter policy state.', 'Do not call external services.'],
      payload: {
        policyVersionId: policy.policy_version_id,
        userId: policy.user.user_id,
        effectiveExternalApis: policy.effective.external_apis
      }
    })
  );

  if (intent.use_kb && kbScopes.length > 0) {
    tasks.push(
      createTask({
        sessionId,
        workerType: 'kb-retrieval',
        optional: true,
        objective: 'Retrieve compact KB evidence relevant to the user request.',
        toolScope: ['kb_hybrid', 'kb_search'],
        boundaries: ['Use only active KB scopes.', 'Return summaries and citations only, never raw bulk context.'],
        payload: { query: message, kbScopes }
      })
    );
  }

  if (shouldAnalyzeProject(message, intent, policy)) {
    tasks.push(
      createTask({
        sessionId,
        workerType: 'file-analysis',
        optional: true,
        objective: 'Extract a compact summary from local project files.',
        toolScope: ['project.read'],
        boundaries: ['Read project-local text files only.', 'Do not write or modify files.'],
        payload: { query: message, projectId: policy.project?.project_id ?? 'none' }
      })
    );
  }

  if (shouldLoadStyleCard(intent, skills, policy)) {
    tasks.push(
      createTask({
        sessionId,
        workerType: 'style-card-load',
        optional: true,
        objective: 'Load existing project style-card guidance for drafting tasks.',
        toolScope: ['project.read', 'style-card'],
        boundaries: ['Prefer cached style-card metadata.', 'Do not generate a new style-card in Phase 1 orchestration.'],
        payload: { skill: 'style-card', projectId: policy.project?.project_id ?? 'none' }
      })
    );
  }

  const dynamicEdges = buildConditionalEdges({ sessionId, message, intent, policy, kbScopes, tasks });

  return {
    sessionId,
    tasks,
    dataPassingMode: policy.project ? 'project_temp' : 'memory',
    effortTier: effortTier(message, tasks.length),
    rationale: dynamicEdges.length > 0 ? 'heuristic_intent_policy_sanitized_static_graph_with_conditional_edges' : 'heuristic_intent_policy_sanitized_static_graph',
    dynamic:
      dynamicEdges.length > 0
        ? {
            conditionalEdges: dynamicEdges,
            firedEdgeIds: [],
            maxReplans: 1
          }
        : undefined
  };
}

export function sanitizeScopes(scopes: string[], policy: PolicyContext): string[] {
  return [...new Set(scopes.filter((scope) => policy.hasKbScope(scope)))].sort();
}

export function sanitizeSkills(skills: string[], policy: PolicyContext): string[] {
  return [...new Set(skills.filter((skill) => policy.hasSkill(skill)))].sort();
}

export function sanitizeGeneratedWorkPlan(input: {
  candidate: WorkPlan | null | undefined;
  fallback: WorkPlan;
  policy: PolicyContext;
  confidence: 'high' | 'medium' | 'low';
}): WorkPlan {
  if (!input.policy.veluga.dynamic_orchestration.dynamic_dag || input.confidence !== 'high' || !input.candidate) {
    return input.fallback;
  }

  const tasks = input.candidate.tasks.map((task) => sanitizeGeneratedTask(input.fallback.sessionId, task)).filter(isWorkerTask);
  if (tasks.length === 0) return input.fallback;

  const conditionalEdges =
    input.candidate.dynamic?.conditionalEdges
      .map((edge) => {
        const nextTask = sanitizeGeneratedTask(input.fallback.sessionId, edge.nextTask);
        return nextTask
          ? {
              id: edge.id,
              description: edge.description,
              condition:
                edge.condition.kind === 'task_status_in'
                  ? { ...edge.condition, statuses: [...edge.condition.statuses] }
                  : { ...edge.condition },
              nextTask
            }
          : null;
      })
      .filter(isConditionalEdge) ?? [];

  const plan: WorkPlan = {
    ...input.fallback,
    tasks,
    rationale: `generated_dynamic_dag_sanitized:${input.candidate.rationale}`,
    dynamic:
      conditionalEdges.length > 0
        ? {
            conditionalEdges,
            firedEdgeIds: [],
            maxReplans: Math.max(0, Math.min(1, Math.floor(input.candidate.dynamic?.maxReplans ?? 0)))
          }
        : undefined
  };

  return validateWorkPlan(plan).ok ? plan : input.fallback;
}

function createTask(input: {
  sessionId: string;
  id?: string;
  workerType: WorkerType;
  optional: boolean;
  dependencies?: string[];
  objective: string;
  toolScope: string[];
  boundaries: string[];
  payload: Readonly<Record<string, string | string[]>>;
}): WorkerTask {
  const id = input.id ?? input.workerType;
  return {
    id,
    workerType: input.workerType,
    dependencies: input.dependencies ?? [],
    objective: input.objective,
    outputContract: { shape: 'context_fragment', schemaRef: 'ContextFragment' },
    toolScope: [...input.toolScope].sort(),
    boundaries: input.boundaries,
    payload: input.payload,
    status: 'pending',
    optional: input.optional,
    attempts: 0,
    idempotencyKey: createHash('sha256')
      .update(JSON.stringify({ sessionId: input.sessionId, id, payload: input.payload }))
      .digest('hex')
  };
}

function buildConditionalEdges(input: {
  sessionId: string;
  message: string;
  intent: IntentPlan;
  policy: PolicyContext;
  kbScopes: string[];
  tasks: WorkerTask[];
}): ConditionalEdge[] {
  if (!input.policy.veluga.dynamic_orchestration.conditional_edges) return [];
  if (!input.policy.project || !input.intent.use_kb || input.kbScopes.length === 0) return [];
  if (input.tasks.some((task) => task.workerType === 'file-analysis')) return [];
  if (!input.tasks.some((task) => task.id === 'kb-retrieval')) return [];

  return [
    {
      id: 'kb-insufficient-evidence-file-analysis',
      description: 'KB retrieval completed with no citations; expand to local project file analysis once.',
      condition: { kind: 'result_citations_below', taskId: 'kb-retrieval', minCitations: 1 },
      nextTask: createTask({
        sessionId: input.sessionId,
        id: 'file-analysis-after-kb-gap',
        workerType: 'file-analysis',
        optional: true,
        dependencies: ['kb-retrieval'],
        objective: 'Extract a compact project-file summary because KB retrieval returned insufficient evidence.',
        toolScope: ['project.read'],
        boundaries: ['Read project-local text files only.', 'Do not write or modify files.', 'Run only once after weak KB evidence.'],
        payload: { query: input.message, projectId: input.policy.project.project_id, trigger: 'kb_insufficient_evidence' }
      })
    }
  ];
}

function sanitizeGeneratedTask(sessionId: string, task: WorkerTask): WorkerTask | null {
  if (!isWorkerType(task.workerType) || task.id.trim().length === 0) return null;
  const allowedScope = new Set(WORKER_TOOL_SCOPE[task.workerType]);
  const toolScope = [...new Set(task.toolScope.filter((tool) => allowedScope.has(tool)))].sort();
  if (toolScope.length === 0) return null;
  const payload = sanitizePayload(task.payload);

  return {
    id: task.id,
    workerType: task.workerType,
    dependencies: [...new Set(task.dependencies.filter(Boolean))].sort(),
    objective: task.objective,
    outputContract: { shape: 'context_fragment', schemaRef: 'ContextFragment' },
    toolScope,
    boundaries: [...task.boundaries],
    payload,
    status: 'pending',
    optional: task.optional,
    attempts: 0,
    idempotencyKey: createHash('sha256')
      .update(JSON.stringify({ sessionId, id: task.id, payload }))
      .digest('hex')
  };
}

function sanitizePayload(payload: Readonly<Record<string, string | string[]>>): Readonly<Record<string, string | string[]>> {
  const next: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string') {
      next[key] = value;
    } else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      next[key] = [...value];
    }
  }
  return next;
}

function isWorkerType(value: string): value is WorkerType {
  return Object.prototype.hasOwnProperty.call(WORKER_TOOL_SCOPE, value);
}

function isWorkerTask(task: WorkerTask | null): task is WorkerTask {
  return task !== null;
}

function isConditionalEdge(edge: ConditionalEdge | null): edge is ConditionalEdge {
  return edge !== null;
}

function shouldAnalyzeProject(message: string, intent: IntentPlan, policy: PolicyContext): boolean {
  if (!policy.project) return false;
  if (intent.answer_mode === 'project_only' || intent.answer_mode === 'mixed') return true;
  if (intent.intent_class === 'summarize_project' || intent.intent_class === 'draft_with_grounding') return true;
  return /project|attached|attachment|file|document|report|notebook|프로젝트|첨부|문서|파일|보고서/i.test(message);
}

function shouldLoadStyleCard(intent: IntentPlan, skills: string[], policy: PolicyContext): boolean {
  if (!policy.project || !policy.hasSkill('style-card')) return false;
  return skills.includes('style-card') || intent.intent_class === 'draft_with_grounding';
}

function effortTier(message: string, taskCount: number): WorkPlan['effortTier'] {
  if (taskCount <= 1) return 'single';
  if (taskCount >= 4 || /compare|across|broad|전체|비교|종합|광범위/i.test(message)) return 'broad';
  return 'small';
}
