import type { KbMcpAdapter } from '../../../packages/veluga-main/src/kb/kb-mcp-adapter.js';
import type { KbEvidence, PolicyContext } from '../../../packages/shared-types/src/index.js';

export interface GovProposalInput {
  query: string;
  policy: PolicyContext;
  /** Omit (or pass null) when no KB connector is configured — produces a project-only draft. */
  kb?: KbMcpAdapter | null;
  projectFacts?: string[];
  asOfDate?: string;
  minCitations?: number;
}

export interface GovProposalDraft {
  text: string;
  kbEvidence: KbEvidence[];
  citation_count: number;
  /** True when the draft was produced without a KB connection. */
  kb_disabled: boolean;
}

export async function draftGovProposal(input: GovProposalInput): Promise<GovProposalDraft> {
  if (!input.kb || !input.kb.isAvailable()) {
    return projectOnlyDraft(input);
  }

  const result = await input.kb.hybrid(
    {
      query: input.query,
      scopes: input.policy.active_kb_scopes,
      as_of_date: input.asOfDate
    },
    input.policy
  );

  const minCitations = input.minCitations ?? 5;
  const evidence = result.mixed.slice(0, Math.max(minCitations, Math.min(result.mixed.length, minCitations))).map((chunk) => ({
    doc_id: chunk.doc_id,
    as_of: chunk.valid_from,
    text: chunk.text,
    classification: chunk.classification,
    scope: chunk.scope
  }));

  const facts = input.projectFacts?.length
    ? input.projectFacts.map((fact, index) => `${index + 1}. ${fact}`).join('\n')
    : '1. Project capabilities and execution history should be filled from the active project files.';

  const kbParagraphs = evidence.map(
    (item, index) =>
      `Section ${index + 1}: ${summarizeEvidence(item.text)} [src:${item.doc_id}|kb|as_of:${item.as_of}]`
  );

  return {
    text: [
      '# Government Proposal Draft',
      '',
      '## Project Fit',
      facts,
      '',
      '## KB-Grounded Requirements',
      ...kbParagraphs,
      '',
      `## Routing Note\n${result.routing_explain}`
    ].join('\n'),
    kbEvidence: evidence,
    citation_count: evidence.length,
    kb_disabled: false
  };
}

function projectOnlyDraft(input: GovProposalInput): GovProposalDraft {
  const facts = input.projectFacts?.length
    ? input.projectFacts.map((fact, index) => `${index + 1}. ${fact}`).join('\n')
    : '1. Project capabilities and execution history should be filled from the active project files.';

  return {
    text: [
      '# Government Proposal Draft',
      '',
      '## Project Fit',
      facts,
      '',
      '> **Note**: No KB connector is configured for this deployment.',
      '> This draft is grounded in project files only. [src:nb_project|nb]',
      '> KB-grounded citations ([src:...|kb|...]) require a connected KB connector.'
    ].join('\n'),
    kbEvidence: [],
    citation_count: 0,
    kb_disabled: true
  };
}

function summarizeEvidence(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}
