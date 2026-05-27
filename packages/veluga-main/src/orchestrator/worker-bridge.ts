import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type {
  CitationTag,
  ContextFragment,
  IntentPlan,
  PolicyContext,
  WorkerTask
} from '../../../shared-types/src/index.js';
import type { AuditLogger } from '../audit-logger.js';
import { knowledgeGate } from '../agents/knowledge-gate.js';
import { KbConnectorRegistry } from '../kb/kb-connector-registry.js';
import { KbUnavailableError } from '../kb/kb-mcp-adapter.js';
import { readProjectYaml } from '../project-yaml.js';
import { NonRetryableWorkerError, type RunWorker } from './orchestrator.js';

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.csv', '.tsv']);

export interface WorkerBridgeOptions {
  sessionId?: string;
  message: string;
  policy: PolicyContext;
  kbRegistry?: KbConnectorRegistry;
  audit?: AuditLogger;
  projectRoot?: string;
}

export function createRunWorker(options: WorkerBridgeOptions): RunWorker {
  return async (task, signal) => {
    assertAllowedToolScope(task);
    throwIfAborted(signal);
    switch (task.workerType) {
      case 'kb-retrieval':
        return runKbRetrieval(task, options, signal);
      case 'file-analysis':
        return runFileAnalysis(task, options, signal);
      case 'policy-preaudit':
        return runPolicyPreaudit(task, options);
      case 'style-card-load':
        return runStyleCardLoad(task, options, signal);
    }
  };
}

async function runKbRetrieval(
  task: WorkerTask,
  options: WorkerBridgeOptions,
  signal: AbortSignal
): Promise<ContextFragment> {
  const scopes = stringArrayPayload(task, 'kbScopes');
  const intent = kbIntent(scopes);
  const sessionId = options.sessionId ?? task.id;
  const adapter = options.kbRegistry?.createAdapter({ audit: options.audit, sessionId, timeoutMs: 1500 }) ?? null;
  if (!adapter) {
    const decision = knowledgeGate(intent, options.policy, {
      kbAvailable: false,
      kbConnectorEnabled: false,
      audit: options.audit,
      sessionId
    });
    throw new NonRetryableWorkerError(decision.reason);
  }

  throwIfAborted(signal);
  const available = await adapter.healthCheck(options.policy);
  throwIfAborted(signal);
  const decision = knowledgeGate(intent, options.policy, {
    kbAvailable: available,
    kbConnectorEnabled: true,
    audit: options.audit,
    sessionId
  });
  if (!decision.allow) {
    if (decision.reason.includes('temporarily unavailable')) {
      throw new KbUnavailableError(decision.reason);
    }
    throw new NonRetryableWorkerError(decision.reason);
  }

  const effectiveScopes = decision.scope_overrides ?? scopes;
  const result = await adapter.hybrid({ query: stringPayload(task, 'query') || options.message, scopes: effectiveScopes }, options.policy);
  throwIfAborted(signal);
  const chunks = result.mixed.slice(0, 5);
  return {
    workerType: 'kb-retrieval',
    summary: chunks.length
      ? chunks
          .map((chunk) => `${chunk.doc_id}#${chunk.chunk_id}: ${limitText(chunk.text, 220)} [src:${chunk.doc_id}|kb|as_of:${chunk.valid_from}]`)
          .join('\n')
      : `KB returned no relevant evidence. Routing: ${result.routing_explain} [parametric:high]`,
    citations: chunks.map((chunk): CitationTag => ({ kind: 'kb', doc_id: chunk.doc_id, as_of: chunk.valid_from })),
    tokensUsed: estimateTokens(chunks.map((chunk) => chunk.text).join('\n'))
  };
}

async function runFileAnalysis(
  task: WorkerTask,
  options: WorkerBridgeOptions,
  signal: AbortSignal
): Promise<ContextFragment> {
  if (!options.policy.project) {
    throw new NonRetryableWorkerError('file-analysis requires an active project');
  }
  if (!options.projectRoot || !existsSync(options.projectRoot)) {
    return {
      workerType: 'file-analysis',
      summary: `Active project ${options.policy.project.project_id}; no projectRoot supplied for file parsing. [src:project-metadata|nb]`,
      citations: [{ kind: 'nb', file_id: 'project-metadata', chunk_id: options.policy.project.project_id }],
      tokensUsed: 18
    };
  }

  const files = listProjectTextFiles(options.projectRoot).slice(0, 6);
  const snippets: string[] = [];
  const citations: CitationTag[] = [];
  for (const file of files) {
    throwIfAborted(signal);
    const text = readFileSync(path.join(options.projectRoot, file), 'utf8');
    snippets.push(`${file}: ${limitText(text, 260)} [src:${file}|nb]`);
    citations.push({ kind: 'nb', file_id: file, chunk_id: 'head' });
  }

  return {
    workerType: 'file-analysis',
    summary: snippets.length ? snippets.join('\n') : `Project has no readable text files. [src:project-metadata|nb]`,
    citations: snippets.length ? citations : [{ kind: 'nb', file_id: 'project-metadata', chunk_id: options.policy.project.project_id }],
    tokensUsed: estimateTokens(snippets.join('\n'))
  };
}

async function runPolicyPreaudit(task: WorkerTask, options: WorkerBridgeOptions): Promise<ContextFragment> {
  const approval = options.policy.effective.approval_for_destructive;
  const externalApis = options.policy.effective.external_apis;
  const scopes = options.policy.active_kb_scopes.join(', ') || 'none';
  return {
    workerType: 'policy-preaudit',
    summary: [
      `Policy ${stringPayload(task, 'policyVersionId') || options.policy.policy_version_id}: external_apis=${externalApis}. [parametric:high]`,
      `approval_for_destructive=${approval}; active_kb_scopes=${scopes}. [parametric:high]`,
      `policy_guard_mode=${options.policy.veluga.policy_guard_mode}; hitl_mode=${options.policy.hitl_mode}. [parametric:high]`
    ].join('\n'),
    citations: [{ kind: 'parametric', level: 'high' }],
    tokensUsed: 40
  };
}

async function runStyleCardLoad(
  _task: WorkerTask,
  options: WorkerBridgeOptions,
  signal: AbortSignal
): Promise<ContextFragment> {
  if (!options.policy.project || !options.policy.hasSkill('style-card')) {
    throw new NonRetryableWorkerError('style-card is not active for this policy');
  }
  throwIfAborted(signal);
  if (!options.projectRoot) {
    return {
      workerType: 'style-card-load',
      summary: `Style-card skill is active, but no projectRoot was supplied. [parametric:high]`,
      citations: [{ kind: 'parametric', level: 'high' }],
      tokensUsed: 14
    };
  }

  const projectYamlPath = path.join(options.projectRoot, 'project.yaml');
  if (!existsSync(projectYamlPath)) {
    throw new NonRetryableWorkerError('project.yaml is required to load style-card metadata');
  }
  const project = readProjectYaml(projectYamlPath);
  return {
    workerType: 'style-card-load',
    summary: project.style_card_id
      ? `Project style_card_id=${project.style_card_id}; use the cached style guidance if available. [src:project.yaml|nb]`
      : 'No style_card_id is recorded for this project. [src:project.yaml|nb]',
    citations: [{ kind: 'nb', file_id: 'project.yaml', chunk_id: 'style_card_id' }],
    tokensUsed: 18
  };
}

function kbIntent(scopes: string[]): IntentPlan {
  return {
    intent_class: 'general_qa',
    answer_mode: 'kb_grounded',
    use_kb: true,
    kb_scopes: scopes,
    suggested_skills: [],
    needs_clarification: false,
    clarification_questions: []
  };
}

function assertAllowedToolScope(task: WorkerTask): void {
  const allowed: Record<WorkerTask['workerType'], string[]> = {
    'kb-retrieval': ['kb_hybrid', 'kb_search'],
    'file-analysis': ['project.read'],
    'policy-preaudit': ['policy.read'],
    'style-card-load': ['project.read', 'style-card']
  };
  const allowedForWorker = new Set(allowed[task.workerType]);
  const outOfScope = task.toolScope.filter((tool) => !allowedForWorker.has(tool));
  if (outOfScope.length > 0) {
    throw new NonRetryableWorkerError(`Worker ${task.workerType} has out-of-scope tools: ${outOfScope.join(', ')}`);
  }
}

function listProjectTextFiles(root: string): string[] {
  const out: string[] = [];
  const rootRealPath = realpathSync(root);
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.veluga' || entry.name === 'node_modules') continue;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (!isWithinRoot(realpathSync(full), rootRealPath)) continue;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      if (statSync(full).size > 1024 * 1024) continue;
      out.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  };
  walk(root);
  return out.sort();
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function stringPayload(task: WorkerTask, key: string): string | undefined {
  const value = task.payload[key];
  return typeof value === 'string' ? value : undefined;
}

function stringArrayPayload(task: WorkerTask, key: string): string[] {
  const value = task.payload[key];
  return Array.isArray(value) ? value : [];
}

function limitText(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error(String(signal.reason ?? 'aborted'));
  }
}
