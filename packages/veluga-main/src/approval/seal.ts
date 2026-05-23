import { createHash, createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AuditLogger } from '../audit-logger.js';

export interface SealMeta {
  approval_id: string;
  report_id: string;
  hash_prev: string;
  payload_hash: string;
  hash_self: string;
  signature: string;
  ts: string;
}

export interface SealPayload {
  approval_id: string;
  report_id: string;
  body: string;
  policy_snapshot: unknown;
  citation_trace: unknown;
  approver: string;
  comment?: string;
}

export function sealApproval(input: {
  payload: SealPayload;
  outputDir: string;
  prevHash?: string;
  hmacKey: string;
}): { sealed_path: string; meta: SealMeta } {
  const approvalId = assertSafeFileStem(input.payload.approval_id, 'approval_id');
  const outputDir = path.resolve(input.outputDir);
  mkdirSync(outputDir, { recursive: true });
  const payloadJson = JSON.stringify(input.payload, null, 2);
  const payload_hash = sha256(payloadJson);
  const hash_prev = input.prevHash ?? '';
  const hash_self = sha256(`${hash_prev}:${payload_hash}`);
  const signature = createHmac('sha256', input.hmacKey).update(hash_self).digest('hex');
  const meta: SealMeta = {
    approval_id: input.payload.approval_id,
    report_id: input.payload.report_id,
    hash_prev,
    payload_hash,
    hash_self,
    signature,
    ts: new Date().toISOString()
  };
  const sealed_path = path.resolve(outputDir, `${approvalId}.seal.json`);
  assertPathWithin(outputDir, sealed_path);
  writeFileSync(sealed_path, JSON.stringify({ meta, payload: input.payload }, null, 2), 'utf8');
  return { sealed_path, meta };
}

export function verifySeal(input: {
  sealed_path: string;
  hmacKey: string;
  audit?: AuditLogger;
  userId?: string;
  policyVersionId?: string;
}): { ok: boolean; expected_hash: string; actual_hash: string } {
  const bundle = JSON.parse(readFileSync(input.sealed_path, 'utf8')) as { meta: SealMeta; payload: SealPayload };
  const payloadHash = sha256(JSON.stringify(bundle.payload, null, 2));
  const actual_hash = sha256(`${bundle.meta.hash_prev}:${payloadHash}`);
  const expectedSignature = createHmac('sha256', input.hmacKey).update(actual_hash).digest('hex');
  const ok = payloadHash === bundle.meta.payload_hash && actual_hash === bundle.meta.hash_self && expectedSignature === bundle.meta.signature;
  if (!ok) {
    input.audit?.append({
      session_id: 'seal-verify',
      user_id: input.userId ?? 'system',
      event_type: 'seal.verify_failed',
      payload: { sealed_path: input.sealed_path, expected_hash: bundle.meta.hash_self, actual_hash },
      policy_version_id: input.policyVersionId ?? 'seal'
    });
  }
  return { ok, expected_hash: bundle.meta.hash_self, actual_hash };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertSafeFileStem(value: string, field: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
    throw new Error(`${field} must be a filename-safe token`);
  }
  return value;
}

function assertPathWithin(parentDir: string, childPath: string): void {
  const relative = path.relative(parentDir, childPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('sealed_path must remain within outputDir');
  }
}
