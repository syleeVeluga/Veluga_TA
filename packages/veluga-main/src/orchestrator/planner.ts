import { createHash } from 'node:crypto';
import type { IntentPlan, PolicyContext, WorkerTask, WorkerType, WorkPlan } from '../../../shared-types/src/index.js';

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

  return {
    sessionId,
    tasks,
    dataPassingMode: policy.project ? 'project_temp' : 'memory',
    effortTier: effortTier(message, tasks.length),
    rationale: 'heuristic_intent_policy_sanitized_static_graph'
  };
}

export function sanitizeScopes(scopes: string[], policy: PolicyContext): string[] {
  return [...new Set(scopes.filter((scope) => policy.hasKbScope(scope)))].sort();
}

export function sanitizeSkills(skills: string[], policy: PolicyContext): string[] {
  return [...new Set(skills.filter((skill) => policy.hasSkill(skill)))].sort();
}

function createTask(input: {
  sessionId: string;
  workerType: WorkerType;
  optional: boolean;
  objective: string;
  toolScope: string[];
  boundaries: string[];
  payload: Readonly<Record<string, string | string[]>>;
}): WorkerTask {
  const id = input.workerType;
  return {
    id,
    workerType: input.workerType,
    dependencies: [],
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
