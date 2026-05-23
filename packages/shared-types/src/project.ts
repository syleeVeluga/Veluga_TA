import type { PolicyTierRules } from './policy.js';

export interface ProjectYaml {
  project_id: string;
  owner: string;
  purpose?: string;
  created_at: string;
  overrides?: PolicyTierRules & {
    active_skills?: string[];
    pinned_kb_docs?: string[];
  };
  shared_with?: string[];
  style_card_id?: string | null;
  last_session_summary?: string | null;
  last_session_at?: string | null;
  docx_citation_style?: 'footnote' | 'endnote' | 'inline';
}

export interface ProjectMeta {
  project_id: string;
  owner: string;
  root_path: string;
  active_skills: string[];
  style_card_id?: string | null;
  last_session_summary?: string | null;
  last_session_at?: string | null;
}

export interface StyleCard {
  card_id: string;
  project_id: string;
  generated_at: string;
  patterns: {
    tone: string;
    sentence_style: string;
    section_titles: string[];
    typical_sentence_examples: string[];
    avoided_phrases: string[];
  };
  source_files: string[];
  llm_invocations: number;
}

export interface VerificationResult {
  total_citations: number;
  matched: number;
  unmatched: { tag: string; position: number; reason: string }[];
  modified_text: string;
}
