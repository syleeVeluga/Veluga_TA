export type IntentClass =
  | 'conversational'
  | 'general_qa'
  | 'how_to_assist'
  | 'planning_assistance'
  | 'summarize_project'
  | 'draft_with_grounding'
  | 'compare_project_vs_kb'
  | 'compliance_check'
  | 'format_conversion';

export type AnswerMode = 'general' | 'project_only' | 'kb_grounded' | 'mixed';

export interface IntentPlan {
  intent_class: IntentClass;
  answer_mode: AnswerMode;
  use_kb: boolean;
  kb_scopes: string[];
  suggested_skills: string[];
  needs_clarification: boolean;
  clarification_questions: string[];
  fast_path_hit?: 'greeting' | 'thanks' | 'ack' | 'self_help' | 'explicit_skill';
}

export interface GeneralPlan {
  confidence: 'high' | 'medium' | 'low' | 'refuse';
  category: 'conversational' | 'common_knowledge' | 'how_to' | 'user_planning' | 'out_of_scope';
  steps: string[];
  escalate_to_kb: null | { reason: string; suggested_scopes: string[] };
  knowledge_boundaries: string[];
}

export interface GeneralResponse {
  text: string;
  citation_tags: CitationTag[];
  escalation_offered: boolean;
}

export type CitationTag =
  | { kind: 'kb'; doc_id: string; as_of: string }
  | { kind: 'nb'; file_id: string; chunk_id: string }
  | { kind: 'parametric'; level: 'high' | 'low' };
