import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { InstalledPlugin } from '../../renderer/types';
import { isPathWithinRoot } from '../tools/path-containment';
import type { SubAgentPersona } from '../../../../shared-types/src/index.js';

interface PluginManifest {
  agents?: string | string[];
}

export interface AgentPersonaRegistrySnapshot {
  personas: SubAgentPersona[];
  warnings: string[];
}

interface ParsedAgentMarkdown {
  id: string;
  name: string;
  description: string;
  systemPrefix: string;
  defaultToolScope: string[];
}

export class AgentPersonaRegistry {
  static fromInstalledPlugins(plugins: InstalledPlugin[]): AgentPersonaRegistrySnapshot {
    const personas: SubAgentPersona[] = [];
    const warnings: string[] = [];
    const seenIds = new Set<string>(['general_subagent']);

    const eligiblePlugins = plugins
      .filter(
        (plugin) =>
          plugin.enabled &&
          plugin.componentsEnabled.agents &&
          plugin.componentCounts.agents > 0 &&
          fs.existsSync(plugin.runtimePath)
      )
      .sort((a, b) => a.pluginId.localeCompare(b.pluginId));

    for (const plugin of eligiblePlugins) {
      const agentFiles = resolveAgentMarkdownFiles(plugin.runtimePath);
      for (const agentFile of agentFiles) {
        const relativePath = path.relative(plugin.runtimePath, agentFile).replace(/\\/g, '/');
        try {
          const parsed = parseAgentMarkdown(agentFile);
          const personaId = seenIds.has(parsed.id)
            ? `${plugin.pluginId}/${parsed.id}`
            : parsed.id;
          seenIds.add(personaId);
          personas.push({
            id: personaId,
            name: parsed.name,
            description: parsed.description,
            systemPrefix: parsed.systemPrefix,
            defaultToolScope: parsed.defaultToolScope,
            source: 'plugin',
            pluginId: plugin.pluginId,
            sourcePathHash: hashSource(agentFile, fs.readFileSync(agentFile, 'utf8')),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`${plugin.pluginId}/${relativePath}: ${message}`);
        }
      }
    }

    return { personas, warnings };
  }
}

function resolveAgentMarkdownFiles(pluginRootPath: string): string[] {
  const manifest = readManifest(pluginRootPath);
  const relativePaths = manifest?.agents
    ? Array.isArray(manifest.agents)
      ? manifest.agents
      : [manifest.agents]
    : ['./agents'];
  const files = new Set<string>();

  for (const relativePath of relativePaths) {
    const targetPath = resolveSafePath(pluginRootPath, relativePath);
    if (!targetPath || !fs.existsSync(targetPath)) {
      continue;
    }
    const stat = fs.statSync(targetPath);
    if (stat.isFile() && targetPath.toLowerCase().endsWith('.md')) {
      files.add(targetPath);
      continue;
    }
    if (!stat.isDirectory()) {
      continue;
    }
    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) {
        continue;
      }
      files.add(path.join(targetPath, entry.name));
    }
  }

  return [...files].sort((a, b) => a.localeCompare(b));
}

function parseAgentMarkdown(filePath: string): ParsedAgentMarkdown {
  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) {
    throw new Error('empty persona markdown');
  }

  const { metadata, body } = splitFrontmatter(content);
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const basename = path.basename(filePath, path.extname(filePath));
  const id = sanitizeId(metadata.id || basename);
  const name = metadata.name || heading || basename;
  const description = metadata.description || firstParagraph(body) || name;
  const systemPrefix = stripLeadingHeading(body).trim();
  const defaultToolScope = parseToolScope(metadata.defaultToolScope || metadata.toolScope);

  if (!id) {
    throw new Error('persona id is required');
  }
  if (!systemPrefix) {
    throw new Error('persona system prompt is required');
  }

  return {
    id,
    name,
    description,
    systemPrefix,
    defaultToolScope,
  };
}

function splitFrontmatter(content: string): { metadata: Record<string, string>; body: string } {
  if (!content.startsWith('---')) {
    return { metadata: {}, body: content };
  }

  const closingIndex = content.indexOf('\n---', 3);
  if (closingIndex < 0) {
    return { metadata: {}, body: content };
  }

  const frontmatter = content.slice(3, closingIndex).trim();
  const metadata: Record<string, string> = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!match) {
      continue;
    }
    metadata[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
  }

  return {
    metadata,
    body: content.slice(closingIndex + '\n---'.length).trim(),
  };
}

function stripLeadingHeading(content: string): string {
  return content.replace(/^#\s+.+\r?\n?/, '').trim();
}

function firstParagraph(content: string): string {
  const withoutHeading = stripLeadingHeading(content);
  const paragraph = withoutHeading
    .split(/\r?\n\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  return paragraph?.replace(/\s+/g, ' ').slice(0, 240) || '';
}

function parseToolScope(value: string | undefined): string[] {
  if (!value) {
    return ['read', 'grep', 'glob'];
  }
  const trimmed = value.trim().replace(/^\[|\]$/g, '');
  const scopes = trimmed
    .split(',')
    .map((scope) => sanitizeId(scope.replace(/^['"]|['"]$/g, '').trim()))
    .filter(Boolean);
  return scopes.length > 0 ? [...new Set(scopes)] : ['read', 'grep', 'glob'];
}

function sanitizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function readManifest(pluginRootPath: string): PluginManifest | null {
  const manifestPath = path.join(pluginRootPath, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PluginManifest;
  } catch {
    return null;
  }
}

function resolveSafePath(rootPath: string, relativePath: string): string | null {
  const normalized = relativePath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/')) {
    return null;
  }
  const resolved = path.resolve(rootPath, normalized);
  return isPathWithinRoot(resolved, rootPath) ? resolved : null;
}

function hashSource(filePath: string, content: string): string {
  return crypto
    .createHash('sha256')
    .update(path.normalize(filePath))
    .update('\0')
    .update(content)
    .digest('hex');
}
