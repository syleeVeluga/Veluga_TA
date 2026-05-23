import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AuditLogger } from './audit-logger.js';
import type { KbEvidence, PolicyContext, VerificationResult } from '../../shared-types/src/index.js';

const ANY_CITATION_RE = /\[src:(nb_([^\]#|]+)#(\d+)\|nb|([^|\]]+)\|kb\|as_of:(\d{4}-\d{2}-\d{2}))\]/g;

export interface VerifyCitationsInput {
  text: string;
  projectRoot: string;
  policy: PolicyContext;
  sessionId?: string;
  audit?: AuditLogger;
  chunkSize?: number;
  threshold?: number;
  kbEvidence?: KbEvidence[];
}

export function verifyProjectCitations(input: VerifyCitationsInput): VerificationResult {
  if (!input.policy.veluga.enable_veluga_orchestration) {
    return { total_citations: 0, matched: 0, unmatched: [], modified_text: input.text };
  }

  const unmatched: VerificationResult['unmatched'] = [];
  let matched = 0;
  let modified = '';
  let cursor = 0;

  const kbEvidence = new Map((input.kbEvidence ?? []).map((evidence) => [`${evidence.doc_id}|${evidence.as_of}`, evidence]));

  for (const match of input.text.matchAll(ANY_CITATION_RE)) {
    const tag = match[0];
    const position = match.index ?? 0;
    const isNotebook = Boolean(match[2]);
    const claim = precedingClaim(input.text, position);
    const fileId = match[2];
    const chunkId = Number(match[3]);
    const docId = match[4];
    const asOf = match[5];
    const result = isNotebook
      ? input.policy.project
        ? matchCitation({
            projectRoot: input.projectRoot,
            fileId,
            chunkId,
            claim,
            chunkSize: input.chunkSize ?? 800,
            threshold: input.threshold ?? 0.28
          })
        : { ok: false as const, reason: 'project_not_active' }
      : matchKbCitation({
          evidence: kbEvidence.get(`${docId}|${asOf}`),
          claim,
          threshold: input.threshold ?? 0.28
        });

    modified += input.text.slice(cursor, position);
    if (result.ok) {
      matched += 1;
      modified += tag;
      input.audit?.append({
        session_id: input.sessionId ?? 'citation-verifier',
        user_id: input.policy.user.user_id,
        event_type: 'citation.linked',
        payload: isNotebook ? { tag, file_id: fileId, chunk_id: chunkId } : { tag, doc_id: docId, as_of: asOf, source: 'kb' },
        policy_version_id: input.policy.policy_version_id
      });
    } else {
      unmatched.push({ tag, position, reason: result.reason });
      modified += input.policy.effective.unverified_quotes === 'allow' ? tag : `${tag}[unverified]`;
      input.audit?.append({
        session_id: input.sessionId ?? 'citation-verifier',
        user_id: input.policy.user.user_id,
        event_type: 'unverified.detected',
        payload: { tag, reason: result.reason },
        policy_version_id: input.policy.policy_version_id
      });
    }
    cursor = position + tag.length;
  }
  modified += input.text.slice(cursor);

  return {
    total_citations: matched + unmatched.length,
    matched,
    unmatched,
    modified_text: modified
  };
}

function matchKbCitation(input: {
  evidence: KbEvidence | undefined;
  claim: string;
  threshold: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.evidence) {
    return { ok: false, reason: 'kb_evidence_missing' };
  }
  const normalizedClaim = normalize(input.claim);
  const normalizedEvidence = normalize(input.evidence.text);
  if (!normalizedClaim || normalizedEvidence.includes(normalizedClaim)) {
    return { ok: true };
  }
  const score = diceCoefficient(normalizedClaim, normalizedEvidence);
  return score >= input.threshold ? { ok: true } : { ok: false, reason: 'claim_not_supported_by_kb' };
}

function matchCitation(input: {
  projectRoot: string;
  fileId: string;
  chunkId: number;
  claim: string;
  chunkSize: number;
  threshold: number;
}): { ok: true } | { ok: false; reason: string } {
  const filePath = resolveProjectFile(input.projectRoot, input.fileId);
  if (!filePath) {
    return { ok: false, reason: 'source_file_missing' };
  }
  const chunks = chunkText(readFileSync(filePath, 'utf8'), input.chunkSize);
  const chunk = chunks[input.chunkId];
  if (!chunk) {
    return { ok: false, reason: 'chunk_missing' };
  }
  const normalizedClaim = normalize(input.claim);
  const normalizedChunk = normalize(chunk);
  if (!normalizedClaim || normalizedChunk.includes(normalizedClaim)) {
    return { ok: true };
  }
  const score = diceCoefficient(normalizedClaim, normalizedChunk);
  return score >= input.threshold ? { ok: true } : { ok: false, reason: 'claim_not_supported_by_chunk' };
}

function resolveProjectFile(root: string, fileId: string): string | null {
  const rootResolved = path.resolve(root);
  for (const candidateId of [fileId, decodeURIComponent(fileId)]) {
    const candidate = path.resolve(rootResolved, candidateId);
    const relative = path.relative(rootResolved, candidate);
    if (!relative.startsWith('..') && !path.isAbsolute(relative) && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function chunkText(text: string, chunkSize = 800): string[] {
  const sentences = text
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.!?])\s+|(?<=[。！？])\s*|\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences.length ? sentences : [text]) {
    if (current && current.length + sentence.length + 1 > chunkSize) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function precedingClaim(text: string, position: number): string {
  const prefix = text.slice(0, position).replace(/\s+/g, ' ');
  const boundary = Math.max(prefix.lastIndexOf('.'), prefix.lastIndexOf('\n'), prefix.lastIndexOf('!'), prefix.lastIndexOf('?'));
  return prefix.slice(boundary + 1).trim();
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function diceCoefficient(a: string, b: string): number {
  const aTerms = new Set(a.split(' ').filter((term) => term.length > 2));
  const bTerms = new Set(b.split(' ').filter((term) => term.length > 2));
  if (!aTerms.size) return 1;
  let shared = 0;
  for (const term of aTerms) {
    if (bTerms.has(term)) shared += 1;
  }
  return (2 * shared) / (aTerms.size + bTerms.size);
}
