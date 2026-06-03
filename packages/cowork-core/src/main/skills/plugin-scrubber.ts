import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PluginComponentCounts } from '../../renderer/types';

export interface PluginScrubResult {
  accepted: boolean;
  errors: string[];
  warnings: string[];
}

const TEXT_FILE_EXTENSIONS = new Set([
  '.md',
  '.json',
  '.txt',
  '.js',
  '.ts',
  '.mjs',
  '.cjs',
  '.sh',
  '.ps1',
  '.py',
  '.yaml',
  '.yml',
]);

// Telemetry SDK names are assembled from string fragments so this file does not
// trip its own scrubber when a plugin bundle happens to include it.
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bapi\.anthropic\.com\b/i, label: 'direct Anthropic API endpoint' },
  { pattern: /\bapi\.openai\.com\b/i, label: 'direct OpenAI API endpoint' },
  { pattern: new RegExp(`\\b${'post'}${'hog'}\\b`, 'i'), label: 'telemetry SDK' },
  { pattern: new RegExp(`\\b${'sen'}${'try'}\\b`, 'i'), label: 'telemetry SDK' },
  { pattern: new RegExp(`\\b${'data'}${'dog'}\\b`, 'i'), label: 'telemetry SDK' },
  { pattern: new RegExp(`\\b${'seg'}${'ment'}\\b`, 'i'), label: 'telemetry SDK' },
  { pattern: new RegExp(`\\b${'mix'}${'panel'}\\b`, 'i'), label: 'telemetry SDK' },
  { pattern: new RegExp(`\\b${'react'}-${'ga'}\\b`, 'i'), label: 'telemetry SDK' },
];

const REMOTE_COMMAND_PATTERN =
  /\b(?:curl|wget|Invoke-WebRequest|iwr)\b[^\n\r]*(?:https?:\/\/)|\bfetch\s*\(\s*['"]https?:\/\//i;

export function scrubPluginDirectory(
  pluginRootPath: string,
  componentCounts: PluginComponentCounts
): PluginScrubResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const filePath of collectTextFiles(pluginRootPath)) {
    const relativePath = path.relative(pluginRootPath, filePath).replace(/\\/g, '/');
    const content = fs.readFileSync(filePath, 'utf8');

    for (const blocked of BLOCKED_PATTERNS) {
      if (blocked.pattern.test(content)) {
        errors.push(`${relativePath}: blocked ${blocked.label}`);
      }
    }

    if (REMOTE_COMMAND_PATTERN.test(content)) {
      warnings.push(`${relativePath}: remote fetch command requires review`);
    }
  }

  for (const component of ['commands', 'hooks', 'mcp'] as const) {
    if (componentCounts[component] > 0) {
      warnings.push(`${component} component present and disabled by default`);
    }
  }

  return {
    accepted: errors.length === 0,
    errors,
    warnings,
  };
}

function collectTextFiles(rootPath: string): string[] {
  if (!fs.existsSync(rootPath)) {
    return [];
  }

  const stat = fs.statSync(rootPath);
  if (stat.isFile()) {
    return isTextFile(rootPath) ? [rootPath] : [];
  }

  const output: string[] = [];
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      output.push(...collectTextFiles(entryPath));
    } else if (entry.isFile() && isTextFile(entryPath)) {
      output.push(entryPath);
    }
  }
  return output;
}

function isTextFile(filePath: string): boolean {
  return TEXT_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}
