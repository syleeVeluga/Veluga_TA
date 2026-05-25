import type { PreviewKind } from './types';

export const CODE_EXTS = new Set([
  '.c',
  '.cpp',
  '.cs',
  '.css',
  '.go',
  '.java',
  '.js',
  '.jsx',
  '.json',
  '.kt',
  '.mjs',
  '.py',
  '.rs',
  '.sh',
  '.sql',
  '.ts',
  '.tsx',
  '.xml',
  '.yaml',
  '.yml',
]);

export const IMAGE_EXTS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp',
]);

export const TEXT_EXTS = new Set([
  '.env',
  '.gitignore',
  '.log',
  '.text',
  '.txt',
]);

export const OS_ONLY_EXTS = new Set([
  '.dmg',
  '.exe',
  '.ppt',
  '.pptx',
  '.zip',
]);

function extname(filePath: string): string {
  const normalized = filePath.split(/[?#]/, 1)[0]?.replace(/\\/g, '/') ?? '';
  const name = normalized.slice(normalized.lastIndexOf('/') + 1);
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex < 0) {
    return '';
  }
  if (dotIndex === 0 && name.indexOf('.', 1) < 0) {
    return name.toLowerCase();
  }
  return name.slice(dotIndex).toLowerCase();
}

export function previewKindForFile(filePath: string): PreviewKind {
  const ext = extname(filePath);

  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (CODE_EXTS.has(ext)) return 'code';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.csv' || ext === '.tsv') return 'csv';
  if (ext === '.docx') return 'docx';
  if (ext === '.xlsx' || ext === '.xls') return 'xlsx';
  if (TEXT_EXTS.has(ext)) return 'text';

  return 'unsupported';
}
