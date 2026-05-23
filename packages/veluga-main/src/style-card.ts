import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AuditLogger } from './audit-logger.js';
import type { LlmGateway } from './llm-gateway.js';
import type { PolicyContext, StyleCard } from '../../shared-types/src/index.js';
import { readProjectYaml, writeProjectYaml } from './project-yaml.js';

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.csv', '.tsv']);

export interface ExtractStyleCardInput {
  projectRoot: string;
  policy: PolicyContext;
  sessionId?: string;
  audit?: AuditLogger;
  gateway?: LlmGateway;
  force?: boolean;
  now?: Date;
}

export async function extractStyleCard(input: ExtractStyleCardInput): Promise<StyleCard> {
  if (!input.policy.veluga.enable_veluga_orchestration || !input.policy.project) {
    throw new Error('style-card requires an active Veluga project');
  }

  const projectYamlPath = path.join(input.projectRoot, 'project.yaml');
  const project = readProjectYaml(projectYamlPath);
  const sourceFiles = listTextFiles(input.projectRoot);
  if (sourceFiles.length < 3) {
    throw new Error('style-card extraction requires at least 3 project text files');
  }

  const cacheDir = path.join(input.projectRoot, '.veluga', 'style-cards');
  mkdirSync(cacheDir, { recursive: true });
  const cacheKey = hashSources(input.projectRoot, sourceFiles);
  const cardId = `style_${cacheKey}`;
  const cachePath = path.join(cacheDir, `${cardId}.json`);
  if (!input.force && existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf8')) as StyleCard;
  }

  const samples = sourceFiles.map((file) => ({
    file,
    text: readFileSync(path.join(input.projectRoot, file), 'utf8').slice(0, 6000)
  }));
  const llmCard = input.gateway ? await tryLlmStyleCard(input.gateway, project.project_id, samples) : null;
  const card = llmCard ?? heuristicStyleCard({
    projectId: project.project_id,
    sourceFiles,
    texts: samples.map((sample) => sample.text),
    now: input.now ?? new Date(),
    llmInvocations: input.gateway ? 1 : 0,
    cardId
  });

  writeFileSync(cachePath, JSON.stringify(card, null, 2), 'utf8');
  project.style_card_id = card.card_id;
  writeProjectYaml(projectYamlPath, project);
  input.audit?.append({
    session_id: input.sessionId ?? 'style-card',
    user_id: input.policy.user.user_id,
    event_type: 'style_card.extracted',
    payload: {
      card_id: card.card_id,
      source_files: card.source_files,
      llm_invocations: card.llm_invocations
    },
    policy_version_id: input.policy.policy_version_id
  });
  return card;
}

function listTextFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.veluga' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        out.push(path.relative(root, full).replace(/\\/g, '/'));
      }
    }
  };
  walk(root);
  return out.sort();
}

function hashSources(root: string, files: string[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    const full = path.join(root, file);
    const stat = statSync(full);
    hash.update(file);
    hash.update(String(stat.size));
    hash.update(readFileSync(full));
  }
  return hash.digest('hex').slice(0, 16);
}

async function tryLlmStyleCard(
  gateway: LlmGateway,
  projectId: string,
  samples: Array<{ file: string; text: string }>
): Promise<StyleCard | null> {
  try {
    const response = await gateway.chat({
      model: 'veluga-style-card',
      temperature: 0,
      json_schema: {
        type: 'object',
        required: ['patterns'],
        properties: {
          patterns: { type: 'object' }
        }
      },
      messages: [
        {
          role: 'system',
          content: 'Extract a concise JSON style card from project report samples.'
        },
        {
          role: 'user',
          content: JSON.stringify({ project_id: projectId, samples })
        }
      ]
    });
    const parsed = JSON.parse(response.text) as Partial<StyleCard>;
    if (parsed.patterns?.tone) {
      return {
        card_id: parsed.card_id ?? `style_${createHash('sha256').update(response.text).digest('hex').slice(0, 16)}`,
        project_id: projectId,
        generated_at: parsed.generated_at ?? new Date().toISOString(),
        patterns: {
          tone: parsed.patterns.tone,
          sentence_style: parsed.patterns.sentence_style ?? 'concise report prose',
          section_titles: parsed.patterns.section_titles ?? [],
          typical_sentence_examples: parsed.patterns.typical_sentence_examples ?? [],
          avoided_phrases: parsed.patterns.avoided_phrases ?? []
        },
        source_files: samples.map((sample) => sample.file),
        llm_invocations: 1
      };
    }
  } catch {
    return null;
  }
  return null;
}

function heuristicStyleCard(input: {
  projectId: string;
  sourceFiles: string[];
  texts: string[];
  now: Date;
  llmInvocations: number;
  cardId: string;
}): StyleCard {
  const text = input.texts.join('\n');
  const titles = [...text.matchAll(/^\s{0,3}(#{1,3}\s+.+|\d+(?:\.\d+)*[.)]\s+.+)$/gm)]
    .map((match) => match[1].replace(/^#{1,3}\s+/, '').trim())
    .slice(0, 8);
  const sentences = text
    .split(/(?<=[.!?])\s+|(?<=\.)\n+/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 20 && sentence.length <= 180)
    .slice(0, 5);
  const averageLength = sentences.length
    ? Math.round(sentences.reduce((sum, sentence) => sum + sentence.length, 0) / sentences.length)
    : 0;
  return {
    card_id: input.cardId,
    project_id: input.projectId,
    generated_at: input.now.toISOString(),
    patterns: {
      tone: 'formal, concise, evidence-oriented',
      sentence_style: averageLength > 90 ? 'long-form analytical sentences' : 'short report sentences',
      section_titles: titles,
      typical_sentence_examples: sentences.slice(0, 5),
      avoided_phrases: ['maybe', 'obviously', 'just']
    },
    source_files: input.sourceFiles,
    llm_invocations: input.llmInvocations
  };
}
