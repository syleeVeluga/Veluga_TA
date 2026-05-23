import type { Clearance } from './policy.js';

export type KbClassification = Clearance;

export interface KbSearchInput {
  query: string;
  scopes: string[];
  as_of_date?: string;
  top_k?: number;
  min_score?: number;
  policy_token?: string;
}

export interface KbDocChunk {
  doc_id: string;
  chunk_id: string;
  scope: string;
  classification: KbClassification;
  text: string;
  valid_from: string;
  valid_to?: string | null;
  score: number;
  metadata: Record<string, unknown>;
}

export interface KbSearchOutput {
  chunks: KbDocChunk[];
}

export interface KbMetadataInput {
  filters: Record<string, unknown>;
  scopes?: string[];
  clearance?: Clearance;
  as_of_date?: string;
  limit?: number;
  policy_token?: string;
}

export interface KbMetadataOutput {
  docs: Array<Record<string, unknown>>;
}

export interface KbHybridInput {
  query: string;
  scopes: string[];
  as_of_date?: string;
  policy_token?: string;
}

export interface KbHybridOutput {
  mixed: KbDocChunk[];
  routing_explain: string;
}

export interface KbEvidence {
  doc_id: string;
  as_of: string;
  text: string;
  classification?: KbClassification;
  scope?: string;
}
