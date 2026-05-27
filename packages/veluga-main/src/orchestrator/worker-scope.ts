import type { WorkerTask, WorkerType } from '../../../shared-types/src/index.js';

export const WORKER_TOOL_SCOPE: Readonly<Record<WorkerType, readonly string[]>> = {
  'kb-retrieval': ['kb_hybrid', 'kb_search'],
  'file-analysis': ['project.read'],
  'policy-preaudit': ['policy.read'],
  'style-card-load': ['project.read', 'style-card']
};

export function outOfScopeTools(task: Pick<WorkerTask, 'workerType' | 'toolScope'>): string[] {
  const allowedForWorker = new Set(WORKER_TOOL_SCOPE[task.workerType]);
  return task.toolScope.filter((tool) => !allowedForWorker.has(tool));
}
