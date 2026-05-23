import { readFileSync, writeFileSync } from 'node:fs';
import { parsePolicyFile } from '../../policy-service/src/simple-yaml.js';
import type { ProjectYaml } from '../../shared-types/src/index.js';

export function parseProjectYaml(text: string): ProjectYaml {
  const parsed = parsePolicyFile(text);
  if (typeof parsed.project_id !== 'string' || typeof parsed.owner !== 'string') {
    throw new Error('project.yaml must include project_id and owner');
  }
  return {
    project_id: parsed.project_id,
    owner: parsed.owner,
    purpose: stringOrUndefined(parsed.purpose),
    created_at: stringOrDefault(parsed.created_at, new Date(0).toISOString()),
    overrides: objectOrUndefined(parsed.overrides) as ProjectYaml['overrides'],
    shared_with: stringArray(parsed.shared_with),
    style_card_id: nullableString(parsed.style_card_id),
    last_session_summary: nullableString(parsed.last_session_summary),
    last_session_at: nullableString(parsed.last_session_at),
    docx_citation_style: citationStyle(parsed.docx_citation_style)
  };
}

export function readProjectYaml(filePath: string): ProjectYaml {
  return parseProjectYaml(readFileSync(filePath, 'utf8'));
}

export function writeProjectYaml(filePath: string, project: ProjectYaml): void {
  writeFileSync(filePath, serializeProjectYaml(project), 'utf8');
}

export function serializeProjectYaml(project: ProjectYaml): string {
  const lines: string[] = [
    `project_id: ${quote(project.project_id)}`,
    `owner: ${quote(project.owner)}`,
    `purpose: ${quote(project.purpose ?? '')}`,
    `created_at: ${quote(project.created_at)}`
  ];
  const overrides = project.overrides ?? {};
  lines.push('overrides:');
  for (const key of [
    'external_apis',
    'audit_log',
    'unverified_quotes',
    'approval_for_destructive',
    'retention_default_days'
  ] as const) {
    if (overrides[key] !== undefined) {
      lines.push(`  ${key}: ${formatScalar(overrides[key])}`);
    }
  }
  lines.push(`  active_skills: ${formatArray(overrides.active_skills ?? [])}`);
  lines.push(`  pinned_kb_docs: ${formatArray(overrides.pinned_kb_docs ?? [])}`);
  lines.push(`shared_with: ${formatArray(project.shared_with ?? [])}`);
  lines.push(`style_card_id: ${project.style_card_id ? quote(project.style_card_id) : 'null'}`);
  lines.push(`last_session_summary: ${project.last_session_summary ? quote(project.last_session_summary) : 'null'}`);
  lines.push(`last_session_at: ${project.last_session_at ? quote(project.last_session_at) : 'null'}`);
  lines.push(`docx_citation_style: ${quote(project.docx_citation_style ?? 'footnote')}`);
  return `${lines.join('\n')}\n`;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function formatScalar(value: string | number): string {
  return typeof value === 'number' ? String(value) : quote(value);
}

function formatArray(values: string[]): string {
  return `[${values.map(quote).join(', ')}]`;
}

function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null || value === 'null') return null;
  return typeof value === 'string' ? value : undefined;
}

function citationStyle(value: unknown): ProjectYaml['docx_citation_style'] {
  return value === 'endnote' || value === 'inline' || value === 'footnote' ? value : 'footnote';
}
