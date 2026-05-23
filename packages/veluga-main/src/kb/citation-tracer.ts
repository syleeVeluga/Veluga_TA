import type { KbTraverseOutput, PolicyContext } from '../../../shared-types/src/index.js';
import type { KbMcpAdapter } from './kb-mcp-adapter.js';

export type CitationStatus = 'ok' | 'revised' | 'superseded' | 'not_found';
export type TraceOverall = 'green' | 'yellow' | 'red';

export interface CitationCheck {
  tag: string;
  doc_id: string;
  as_of: string;
  status: CitationStatus;
  message: string;
  suggested_doc_id?: string;
}

export interface TraceResult {
  results: CitationCheck[];
  overall: TraceOverall;
}

const KB_TAG_RE = /\[src:([^|\]]+)\|kb\|as_of:(\d{4}-\d{2}-\d{2})\]/g;

export function extractKbCitationTags(text: string): string[] {
  return [...text.matchAll(KB_TAG_RE)].map((match) => match[0]);
}

export async function traceCitations(input: {
  text?: string;
  report_citations?: string[];
  policy: PolicyContext;
  kb: KbMcpAdapter;
}): Promise<TraceResult> {
  const tags = input.report_citations ?? extractKbCitationTags(input.text ?? '');
  const results: CitationCheck[] = [];

  for (const tag of tags) {
    const citation = parseCitationTag(tag);
    const trace = await input.kb.traverse(
      {
        start_node: citation.doc_id,
        edge_types: ['revised_by', 'superseded_by'],
        depth: 1,
        as_of_date: citation.as_of,
        user_scopes: input.policy.active_kb_scopes
      },
      input.policy
    );
    results.push(analyzeTrace(tag, citation.doc_id, citation.as_of, trace));
  }

  return { results, overall: aggregate(results) };
}

export function parseCitationTag(tag: string): { doc_id: string; as_of: string } {
  const match = new RegExp(`^${KB_TAG_RE.source}$`).exec(tag);
  if (!match) throw new Error(`Invalid KB citation tag: ${tag}`);
  return { doc_id: match[1], as_of: match[2] };
}

export function analyzeTrace(tag: string, docId: string, asOf: string, trace: KbTraverseOutput): CitationCheck {
  const start = trace.nodes.find((node) => node.id === docId);
  if (!start) {
    return { tag, doc_id: docId, as_of: asOf, status: 'not_found', message: `${docId} was not returned by kb_traverse` };
  }

  const superseded = trace.edges.find((edge) => edge.from_node === docId && edge.type === 'superseded_by');
  if (superseded) {
    return {
      tag,
      doc_id: docId,
      as_of: asOf,
      status: 'superseded',
      message: `${docId} is superseded by ${superseded.to_node}`,
      suggested_doc_id: superseded.to_node
    };
  }

  const revised = trace.edges.find((edge) => edge.from_node === docId && edge.type === 'revised_by');
  if (revised) {
    return {
      tag,
      doc_id: docId,
      as_of: asOf,
      status: 'revised',
      message: `${docId} has a newer revision ${revised.to_node}`,
      suggested_doc_id: revised.to_node
    };
  }

  return { tag, doc_id: docId, as_of: asOf, status: 'ok', message: `${docId} is current for ${asOf}` };
}

function aggregate(results: CitationCheck[]): TraceOverall {
  if (results.some((result) => result.status === 'superseded' || result.status === 'not_found')) return 'red';
  if (results.some((result) => result.status === 'revised')) return 'yellow';
  return 'green';
}
