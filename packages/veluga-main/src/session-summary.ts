import path from 'node:path';
import type { AuditLogger } from './audit-logger.js';
import type { LlmGateway, Message } from './llm-gateway.js';
import type { PolicyContext } from '../../shared-types/src/index.js';
import { readProjectYaml, writeProjectYaml } from './project-yaml.js';

export interface SessionSummaryInput {
  projectRoot: string;
  sessionId: string;
  turnCount: number;
  lastTurns: Message[];
  policy: PolicyContext;
  audit?: AuditLogger;
  gateway?: LlmGateway;
  now?: Date;
  skillsInvoked?: Record<string, number>;
  llmInvocations?: Record<string, number>;
  tokensUsed?: number;
}

export async function updateLastSessionSummary(input: SessionSummaryInput): Promise<string | null> {
  if (!input.policy.veluga.enable_veluga_orchestration || !input.policy.project || input.turnCount <= 0) {
    return null;
  }
  const projectPath = path.join(input.projectRoot, 'project.yaml');
  const project = readProjectYaml(projectPath);
  const summary = await summarize(input.lastTurns.slice(-5), input.gateway);
  const stamped = `${(input.now ?? new Date()).toISOString()} ${limitChars(summary, 60)}`;
  project.last_session_summary = stamped;
  project.last_session_at = (input.now ?? new Date()).toISOString();
  writeProjectYaml(projectPath, project);

  input.audit?.append({
    session_id: input.sessionId,
    user_id: input.policy.user.user_id,
    event_type: 'session.summary',
    payload: {
      turn_count: input.turnCount,
      last_summary: stamped,
      skills_invoked: input.skillsInvoked ?? {},
      llm_invocations: input.llmInvocations ?? {},
      tokens_used: input.tokensUsed ?? 0
    },
    policy_version_id: input.policy.policy_version_id
  });
  return stamped;
}

async function summarize(turns: Message[], gateway?: LlmGateway): Promise<string> {
  if (gateway) {
    const result = await gateway.chat({
      model: 'veluga-summary',
      max_tokens: 120,
      messages: [
        {
          role: 'system',
          content: 'Summarize the recent work in one Korean sentence under 60 characters.'
        },
        ...turns
      ]
    });
    return result.text.trim();
  }
  const lastUser = [...turns].reverse().find((turn) => turn.role === 'user')?.content ?? '';
  return lastUser ? `Recent work: ${lastUser}` : 'Recent work summarized.';
}

function limitChars(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}
