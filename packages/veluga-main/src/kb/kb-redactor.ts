import type { AuditLogger } from '../audit-logger.js';
import type { KbDocChunk, PolicyContext } from '../../../shared-types/src/index.js';
import { hasClearance } from './kb-contract.js';

export interface KbRedactionResult<T extends { mixed?: KbDocChunk[]; chunks?: KbDocChunk[] }> {
  output: T;
  removed: KbDocChunk[];
}

export function redactOverClassifiedChunks<T extends { mixed?: KbDocChunk[]; chunks?: KbDocChunk[] }>(
  output: T,
  policy: PolicyContext,
  options: { audit?: AuditLogger; sessionId?: string } = {}
): KbRedactionResult<T> {
  const key = output.mixed ? 'mixed' : 'chunks';
  const chunks = (output[key] ?? []) as KbDocChunk[];
  const allowed: KbDocChunk[] = [];
  const removed: KbDocChunk[] = [];

  for (const chunk of chunks) {
    const scopeAllowed = policy.hasKbScope(chunk.scope);
    const clearanceAllowed = hasClearance(policy.user.clearance, chunk.classification);
    if (scopeAllowed && clearanceAllowed) {
      allowed.push(chunk);
      continue;
    }
    removed.push(chunk);
    options.audit?.append({
      session_id: options.sessionId ?? 'kb-redactor',
      user_id: policy.user.user_id,
      event_type: 'kb.over_classification',
      payload: {
        doc_id: chunk.doc_id,
        chunk_id: chunk.chunk_id,
        scope: chunk.scope,
        classification: chunk.classification,
        user_clearance: policy.user.clearance,
        reason: scopeAllowed ? 'classification_exceeds_clearance' : 'scope_not_allowed'
      },
      policy_version_id: policy.policy_version_id
    });
  }

  return { output: { ...output, [key]: allowed }, removed };
}
