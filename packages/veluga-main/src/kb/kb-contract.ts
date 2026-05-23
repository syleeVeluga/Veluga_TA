import type {
  Clearance,
  KbDocChunk,
  KbHybridInput,
  KbHybridOutput,
  KbMetadataInput,
  KbMetadataOutput,
  KbSearchInput,
  KbSearchOutput,
  PolicyContext
} from '../../../shared-types/src/index.js';

const CLASSIFICATIONS: Clearance[] = ['public', 'internal', 'confidential', 'secret'];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class KbContractError extends Error {
  constructor(
    message: string,
    readonly path: string
  ) {
    super(`${path}: ${message}`);
    this.name = 'KbContractError';
  }
}

export function clearanceRank(value: Clearance): number {
  return CLASSIFICATIONS.indexOf(value);
}

export function requiredClearanceForScope(scope: string): Clearance {
  const suffix = scope.split(':').at(-1) as Clearance | undefined;
  return suffix && isClearance(suffix) ? suffix : 'internal';
}

export function hasClearance(user: Clearance, required: Clearance): boolean {
  return clearanceRank(user) >= clearanceRank(required);
}

export function normalizeKbSearchInput(input: KbSearchInput, policy: PolicyContext): Required<KbSearchInput> {
  assertString(input.query, 'query');
  assertScopes(input.scopes, 'scopes');
  const top_k = input.top_k ?? 10;
  const min_score = input.min_score ?? 0;
  assertIntegerRange(top_k, 'top_k', 1, 100);
  assertNumberRange(min_score, 'min_score', 0, 1);
  assertOptionalIsoDate(input.as_of_date, 'as_of_date');
  return {
    query: input.query,
    scopes: input.scopes,
    as_of_date: input.as_of_date ?? new Date().toISOString().slice(0, 10),
    top_k,
    min_score,
    policy_token: input.policy_token ?? policy.policy_version_id
  };
}

export function normalizeKbMetadataInput(input: KbMetadataInput, policy: PolicyContext): Required<KbMetadataInput> {
  assertRecord(input.filters, 'filters');
  const scopes = input.scopes ?? policy.active_kb_scopes;
  assertScopes(scopes, 'scopes');
  const limit = input.limit ?? 50;
  assertIntegerRange(limit, 'limit', 1, 200);
  assertOptionalIsoDate(input.as_of_date, 'as_of_date');
  return {
    filters: {
      ...input.filters,
      scopes,
      clearance: input.clearance ?? policy.user.clearance,
      as_of_date: input.as_of_date ?? new Date().toISOString().slice(0, 10)
    },
    scopes,
    clearance: input.clearance ?? policy.user.clearance,
    as_of_date: input.as_of_date ?? new Date().toISOString().slice(0, 10),
    limit,
    policy_token: input.policy_token ?? policy.policy_version_id
  };
}

export function normalizeKbHybridInput(input: KbHybridInput, policy: PolicyContext): Required<KbHybridInput> {
  assertString(input.query, 'query');
  assertScopes(input.scopes, 'scopes');
  assertOptionalIsoDate(input.as_of_date, 'as_of_date');
  return {
    query: input.query,
    scopes: input.scopes,
    as_of_date: input.as_of_date ?? new Date().toISOString().slice(0, 10),
    policy_token: input.policy_token ?? policy.policy_version_id
  };
}

export function parseKbSearchOutput(value: unknown): KbSearchOutput {
  const record = assertRecord(value, '$');
  const chunks = assertArray(record.chunks, 'chunks').map((chunk, index) => parseChunk(chunk, `chunks.${index}`));
  return { chunks };
}

export function parseKbMetadataOutput(value: unknown): KbMetadataOutput {
  const record = assertRecord(value, '$');
  return {
    docs: assertArray(record.docs, 'docs').map((doc, index) => assertRecord(doc, `docs.${index}`))
  };
}

export function parseKbHybridOutput(value: unknown): KbHybridOutput {
  const record = assertRecord(value, '$');
  return {
    mixed: assertArray(record.mixed, 'mixed').map((chunk, index) => parseChunk(chunk, `mixed.${index}`)),
    routing_explain: assertString(record.routing_explain, 'routing_explain')
  };
}

export function isChunkCurrentlyValid(chunk: Pick<KbDocChunk, 'valid_from' | 'valid_to'>, asOf: string): boolean {
  return chunk.valid_from <= asOf && (!chunk.valid_to || chunk.valid_to >= asOf);
}

function parseChunk(value: unknown, path: string): KbDocChunk {
  const record = assertRecord(value, path);
  const classification = assertString(record.classification, `${path}.classification`);
  if (!isClearance(classification)) {
    throw new KbContractError('must be one of public, internal, confidential, secret', `${path}.classification`);
  }
  const valid_from = assertString(record.valid_from, `${path}.valid_from`);
  assertIsoDate(valid_from, `${path}.valid_from`);
  const valid_to = record.valid_to === undefined || record.valid_to === null ? null : assertString(record.valid_to, `${path}.valid_to`);
  if (valid_to) assertIsoDate(valid_to, `${path}.valid_to`);
  return {
    doc_id: assertString(record.doc_id, `${path}.doc_id`),
    chunk_id: assertString(record.chunk_id, `${path}.chunk_id`),
    scope: assertString(record.scope, `${path}.scope`),
    classification,
    text: assertString(record.text, `${path}.text`),
    valid_from,
    valid_to,
    score: assertNumberRange(record.score, `${path}.score`, 0, 1),
    metadata: assertRecord(record.metadata ?? {}, `${path}.metadata`)
  };
}

function isClearance(value: string): value is Clearance {
  return CLASSIFICATIONS.includes(value as Clearance);
}

function assertScopes(value: unknown, path: string): string[] {
  const scopes = assertArray(value, path).map((scope, index) => assertString(scope, `${path}.${index}`));
  if (!scopes.length) throw new KbContractError('must contain at least one scope', path);
  return scopes;
}

function assertOptionalIsoDate(value: unknown, path: string): void {
  if (value === undefined || value === null) return;
  assertIsoDate(assertString(value, path), path);
}

function assertIsoDate(value: string, path: string): void {
  if (!ISO_DATE_RE.test(value)) throw new KbContractError('must be YYYY-MM-DD', path);
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new KbContractError('must be a non-empty string', path);
  return value;
}

function assertNumberRange(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value < min || value > max) {
    throw new KbContractError(`must be a number between ${min} and ${max}`, path);
  }
  return value;
}

function assertIntegerRange(value: unknown, path: string, min: number, max: number): number {
  const number = assertNumberRange(value, path, min, max);
  if (!Number.isInteger(number)) throw new KbContractError('must be an integer', path);
  return number;
}

function assertArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new KbContractError('must be an array', path);
  return value;
}

function assertRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new KbContractError('must be an object', path);
  return value as Record<string, unknown>;
}
