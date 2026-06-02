import type { ReadFileResult } from '../types';
import { decodeBase64Utf8 } from './base64';

export type ReadFileFn = (absPath: string) => Promise<ReadFileResult>;

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.css': 'text/css',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
};

export function mimeForExt(pathOrExt: string): string {
  const lower = pathOrExt.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot) : lower;
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/**
 * Only same-tree relative paths are inlined. Anything with an explicit scheme
 * (http:, https:, file:, mailto:, …), a protocol-relative `//host`, a fragment,
 * or an already-inlined data:/blob: URL is left untouched.
 */
export function isInlinableRelative(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('#')) return false;
  if (trimmed.startsWith('//')) return false;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return false;
  return true;
}

function dirOf(posixPath: string): string {
  const idx = posixPath.lastIndexOf('/');
  return idx <= 0 ? '' : posixPath.slice(0, idx);
}

/**
 * Resolve a relative href against the absolute path of the file that references
 * it. Returns a forward-slash path; the IPC read layer re-normalizes per-OS.
 */
export function resolveRelative(baseFileAbsPath: string, relativeUrl: string): string {
  const cleaned = relativeUrl.trim().split(/[?#]/, 1)[0] ?? '';
  const basePosix = baseFileAbsPath.replace(/\\/g, '/');
  const baseDir = dirOf(basePosix);
  const segments = (baseDir ? baseDir.split('/') : []).concat(cleaned.split('/'));
  const stack: string[] = [];
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (stack.length) stack.pop();
      continue;
    }
    stack.push(seg);
  }
  const leading = basePosix.startsWith('/') ? '/' : '';
  return leading + stack.join('/');
}

async function replaceAsync(
  input: string,
  pattern: RegExp,
  replacer: (match: RegExpExecArray) => Promise<string>
): Promise<string> {
  const matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  // pattern must be global; clone lastIndex handling to stay re-entrant.
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  while ((m = re.exec(input)) !== null) {
    matches.push(m);
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  if (matches.length === 0) return input;

  const replacements = await Promise.all(matches.map((match) => replacer(match)));
  let result = '';
  let cursor = 0;
  matches.forEach((match, i) => {
    result += input.slice(cursor, match.index) + replacements[i];
    cursor = match.index + match[0].length;
  });
  result += input.slice(cursor);
  return result;
}

async function readText(absPath: string, read: ReadFileFn): Promise<string | null> {
  try {
    const result = await read(absPath);
    if (!result || 'error' in result) return null;
    return decodeBase64Utf8(result.buffer);
  } catch {
    return null;
  }
}

async function readDataUrl(absPath: string, read: ReadFileFn): Promise<string | null> {
  try {
    const result = await read(absPath);
    if (!result || 'error' in result) return null;
    return `data:${mimeForExt(absPath)};base64,${result.buffer}`;
  } catch {
    return null;
  }
}

const URL_FN_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
const IMPORT_RE = /@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?\s*([^;]*);/gi;

/**
 * Inline relative `url(...)` and `@import` references inside a CSS string,
 * resolving them against the CSS file's own absolute path. Recurses into
 * imported stylesheets up to `depth` levels to keep cycles bounded.
 */
async function inlineCss(
  css: string,
  cssAbsPath: string,
  read: ReadFileFn,
  depth: number
): Promise<string> {
  let out = css;

  if (depth > 0) {
    out = await replaceAsync(out, IMPORT_RE, async (match) => {
      const ref = match[2];
      if (!isInlinableRelative(ref)) return match[0];
      const target = resolveRelative(cssAbsPath, ref);
      const imported = await readText(target, read);
      if (imported === null) return match[0];
      const media = (match[3] ?? '').trim();
      const inlined = await inlineCss(imported, target, read, depth - 1);
      return media ? `@media ${media}{\n${inlined}\n}` : inlined;
    });
  }

  out = await replaceAsync(out, URL_FN_RE, async (match) => {
    const ref = match[2];
    if (!isInlinableRelative(ref)) return match[0];
    const target = resolveRelative(cssAbsPath, ref);
    const dataUrl = await readDataUrl(target, read);
    if (dataUrl === null) return match[0];
    return `url("${dataUrl}")`;
  });

  return out;
}

const LINK_RE = /<link\b[^>]*>/gi;
const STYLE_BLOCK_RE = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;
const IMG_RE = /<img\b[^>]*>/gi;
const HREF_ATTR_RE = /\shref\s*=\s*(['"])([^'"]*)\1/i;
const SRC_ATTR_RE = /\ssrc\s*=\s*(['"])([^'"]*)\1/i;
const REL_STYLESHEET_RE = /\srel\s*=\s*(['"])[^'"]*stylesheet[^'"]*\1/i;

const MAX_IMPORT_DEPTH = 5;

/**
 * Rewrite an HTML document so that relative stylesheets, `@import`s, `url(...)`
 * assets and `<img>` sources are inlined as `<style>` blocks / data URLs read
 * through the secure file-viewer IPC. This lets the sandboxed `srcDoc` iframe
 * render documents that depend on sibling files (e.g. a slide deck importing
 * `shared.css`) without loosening the app CSP. External (http/https) and
 * script resources are intentionally left untouched.
 */
export async function inlineHtmlResources(
  html: string,
  htmlAbsPath: string,
  read: ReadFileFn
): Promise<string> {
  // <link rel="stylesheet" href="relative.css"> -> <style>...</style>
  let out = await replaceAsync(html, LINK_RE, async (match) => {
    const tag = match[0];
    if (!REL_STYLESHEET_RE.test(tag)) return tag;
    const href = HREF_ATTR_RE.exec(tag);
    if (!href || !isInlinableRelative(href[2])) return tag;
    const target = resolveRelative(htmlAbsPath, href[2]);
    const css = await readText(target, read);
    if (css === null) return tag;
    const inlined = await inlineCss(css, target, read, MAX_IMPORT_DEPTH);
    return `<style>\n${inlined}\n</style>`;
  });

  // Inline <style> blocks: resolve their @import / url() against the HTML file.
  out = await replaceAsync(out, STYLE_BLOCK_RE, async (match) => {
    const inlined = await inlineCss(match[2], htmlAbsPath, read, MAX_IMPORT_DEPTH);
    return `${match[1]}${inlined}${match[3]}`;
  });

  // <img src="relative.png"> -> data URL
  out = await replaceAsync(out, IMG_RE, async (match) => {
    const tag = match[0];
    const src = SRC_ATTR_RE.exec(tag);
    if (!src || !isInlinableRelative(src[2])) return tag;
    const target = resolveRelative(htmlAbsPath, src[2]);
    const dataUrl = await readDataUrl(target, read);
    if (dataUrl === null) return tag;
    return tag.replace(SRC_ATTR_RE, ` src="${dataUrl}"`);
  });

  return out;
}

/**
 * True when the document still references resources the sandboxed iframe cannot
 * load: scripts (blocked by `sandbox`), or external/protocol-relative URLs
 * (blocked by CSP). Used to surface a non-silent notice to the user.
 */
export function hasBlockedResources(html: string): boolean {
  if (/<script\b[^>]*\bsrc\s*=|<script\b[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(html)) {
    return true;
  }
  const externalRef =
    /(?:src|href)\s*=\s*['"](?:https?:|\/\/)/i.test(html) ||
    /@import\s+(?:url\(\s*)?['"](?:https?:|\/\/)/i.test(html) ||
    /url\(\s*['"]?(?:https?:|\/\/)/i.test(html);
  return externalRef;
}
