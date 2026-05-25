import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DocxViewer from '../src/renderer/features/file-viewer/viewers/DocxViewer';
import { decodeBase64ArrayBuffer } from '../src/renderer/features/file-viewer/utils/base64';
import { FILE_VIEWER_READ_LIMIT_BYTES } from '../src/renderer/features/file-viewer/ipc/main-handler';

const docxViewerPath = path.resolve(
  process.cwd(),
  'src/renderer/features/file-viewer/viewers/DocxViewer.tsx'
);
const viewerMapPath = path.resolve(process.cwd(), 'src/renderer/features/file-viewer/viewer-map.ts');

describe('DocxViewer stage 4', () => {
  it('decodes base64 file data into an ArrayBuffer', () => {
    const bytes = Buffer.from([0, 1, 2, 127, 255]);
    const arrayBuffer = decodeBase64ArrayBuffer(bytes.toString('base64'));

    expect(Array.from(new Uint8Array(arrayBuffer))).toEqual([0, 1, 2, 127, 255]);
  });

  it('renders read errors through the viewer boundary', () => {
    const markup = renderToStaticMarkup(
      React.createElement(DocxViewer, {
        path: 'large.docx',
        readResult: { error: 'TOO_LARGE', limit: FILE_VIEWER_READ_LIMIT_BYTES },
      })
    );

    expect(markup).toContain('File is too large to preview. Limit: 50 MB.');
  });

  it('calls docx-preview with decoded ArrayBuffer data and catches render failures', () => {
    const source = fs.readFileSync(docxViewerPath, 'utf8');

    expect(source).toContain("import { renderAsync } from 'docx-preview';");
    expect(source).toContain('decodeBase64ArrayBuffer(readResult.buffer)');
    expect(source).toContain(
      'renderAsync(arrayBuffer, containerRef.current, undefined, { renderAltChunks: false })'
    );
    expect(source).toContain('setRenderError(true)');
  });

  it('activates docx in the viewer map and file read path', () => {
    const source = fs.readFileSync(viewerMapPath, 'utf8');

    expect(source).toContain("'docx',");
    expect(source).toContain("docx: lazy(() => import('./viewers/DocxViewer'))");
  });
});
