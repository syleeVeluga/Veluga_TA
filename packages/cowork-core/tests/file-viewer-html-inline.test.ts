import { describe, expect, it } from 'vitest';
import {
  hasBlockedResources,
  inlineHtmlResources,
  isInlinableRelative,
  mimeForExt,
  resolveRelative,
} from '../src/renderer/features/file-viewer/utils/html-inline';
import type { ReadFileResult } from '../src/renderer/features/file-viewer/types';

function fakeReader(files: Record<string, string | Buffer>) {
  return async (absPath: string): Promise<ReadFileResult> => {
    const normalized = absPath.replace(/\\/g, '/');
    const value = files[normalized];
    if (value === undefined) {
      return { error: 'NOT_FOUND' };
    }
    const buf = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
    return {
      buffer: buf.toString('base64'),
      ext: normalized.slice(normalized.lastIndexOf('.')),
      name: normalized.slice(normalized.lastIndexOf('/') + 1),
      size: buf.byteLength,
    };
  };
}

describe('html-inline helpers', () => {
  it('classifies inlinable relative references', () => {
    expect(isInlinableRelative('shared.css')).toBe(true);
    expect(isInlinableRelative('./img/a.png')).toBe(true);
    expect(isInlinableRelative('../styles/x.css')).toBe(true);
    expect(isInlinableRelative('https://cdn/x.css')).toBe(false);
    expect(isInlinableRelative('//cdn/x.css')).toBe(false);
    expect(isInlinableRelative('data:text/css,x')).toBe(false);
    expect(isInlinableRelative('#anchor')).toBe(false);
    expect(isInlinableRelative('file:///c:/x.css')).toBe(false);
  });

  it('resolves relative paths against the referencing file, including ..', () => {
    expect(resolveRelative('C:/work/slides/slide1.html', 'shared.css')).toBe(
      'C:/work/slides/shared.css'
    );
    expect(resolveRelative('C:/work/slides/slide1.html', '../assets/logo.png')).toBe(
      'C:/work/assets/logo.png'
    );
    expect(resolveRelative('/home/u/site/index.html', './css/main.css')).toBe(
      '/home/u/site/css/main.css'
    );
  });

  it('maps extensions to mime types', () => {
    expect(mimeForExt('a.png')).toBe('image/png');
    expect(mimeForExt('.css')).toBe('text/css');
    expect(mimeForExt('font.woff2')).toBe('font/woff2');
    expect(mimeForExt('x.unknown')).toBe('application/octet-stream');
  });
});

describe('inlineHtmlResources', () => {
  it('inlines a relative @import inside an inline <style> block', async () => {
    const read = fakeReader({
      'C:/w/slides/shared.css': ':root{--c:#fff}',
    });
    const html = `<style>@import url('shared.css');\nbody{color:var(--c)}</style>`;
    const out = await inlineHtmlResources(html, 'C:/w/slides/slide1.html', read);
    expect(out).toContain('--c:#fff');
    expect(out).not.toContain("@import url('shared.css')");
  });

  it('inlines a relative <link rel="stylesheet"> into a <style> block', async () => {
    const read = fakeReader({ 'C:/w/site/main.css': 'h1{color:red}' });
    const html = `<head><link rel="stylesheet" href="main.css"></head>`;
    const out = await inlineHtmlResources(html, 'C:/w/site/index.html', read);
    expect(out).toContain('<style>');
    expect(out).toContain('h1{color:red}');
    expect(out).not.toContain('<link');
  });

  it('rewrites relative <img src> to a data URL', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const read = fakeReader({ 'C:/w/site/img/a.png': png });
    const html = `<img src="img/a.png" alt="x">`;
    const out = await inlineHtmlResources(html, 'C:/w/site/index.html', read);
    expect(out).toContain(`data:image/png;base64,${png.toString('base64')}`);
  });

  it('leaves external and missing resources untouched', async () => {
    const read = fakeReader({});
    const html = `<link rel="stylesheet" href="https://cdn/x.css"><img src="missing.png">`;
    const out = await inlineHtmlResources(html, 'C:/w/site/index.html', read);
    expect(out).toContain('href="https://cdn/x.css"');
    expect(out).toContain('src="missing.png"');
  });
});

describe('hasBlockedResources', () => {
  it('flags scripts and external resources', () => {
    expect(hasBlockedResources('<script src="app.js"></script>')).toBe(true);
    expect(hasBlockedResources('<script>doThing()</script>')).toBe(true);
    expect(hasBlockedResources('<link href="https://cdn/x.css">')).toBe(true);
    expect(hasBlockedResources('<style>@import url("//cdn/x.css");</style>')).toBe(true);
  });

  it('does not flag self-contained documents', () => {
    expect(hasBlockedResources('<h1>Hello</h1><style>h1{color:red}</style>')).toBe(false);
    expect(hasBlockedResources('<img src="data:image/png;base64,AAAA">')).toBe(false);
  });
});
