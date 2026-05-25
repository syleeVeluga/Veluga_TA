import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HtmlViewer from '../src/renderer/features/file-viewer/viewers/HtmlViewer';

const htmlViewerPath = path.resolve(
  process.cwd(),
  'src/renderer/features/file-viewer/viewers/HtmlViewer.tsx'
);
const codeViewerPath = path.resolve(
  process.cwd(),
  'src/renderer/features/file-viewer/viewers/CodeViewer.tsx'
);

function readResultForHtml(html: string) {
  return {
    buffer: Buffer.from(html, 'utf8').toString('base64'),
    ext: '.html',
    name: 'preview.html',
    size: Buffer.byteLength(html),
  };
}

describe('HtmlViewer stage 3 controls', () => {
  it('renders preview/source controls with sanitize disabled by default', () => {
    const markup = renderToStaticMarkup(
      React.createElement(HtmlViewer, {
        path: 'preview.html',
        readResult: readResultForHtml('<h1>Hello</h1>'),
      })
    );

    expect(markup).toContain('Preview');
    expect(markup).toContain('Source');
    expect(markup).toContain('Sanitize');
    expect(markup).toContain('type="checkbox"');
    expect(markup).not.toContain('checked=""');
  });

  it('routes source mode through CodeViewer with html highlighting enabled', () => {
    const htmlViewerSource = fs.readFileSync(htmlViewerPath, 'utf8');
    const codeViewerSource = fs.readFileSync(codeViewerPath, 'utf8');

    expect(htmlViewerSource).toContain(
      '<CodeViewer path={path} readResult={readResult} content={text} ext=".html" />'
    );
    expect(codeViewerSource).toContain("import('@shikijs/langs/html')");
    expect(codeViewerSource).toContain("cleanPath.endsWith('.html')");
  });

  it('sanitizes preview html and resets local html controls on file changes', () => {
    const source = fs.readFileSync(htmlViewerPath, 'utf8');

    expect(source).toContain('DOMPurify.sanitize(text)');
    expect(source).toContain("setMode('preview');");
    expect(source).toContain('setSanitizePreview(false);');
    expect(source).toContain('[path]');
  });
});
