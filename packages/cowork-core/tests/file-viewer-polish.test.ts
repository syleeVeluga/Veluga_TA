import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import FileViewerError from '../src/renderer/features/file-viewer/viewers/FileViewerError';
import {
  FILE_VIEWER_DEFAULT_WIDTH,
  FILE_VIEWER_MAX_WIDTH,
  FILE_VIEWER_MIN_WIDTH,
  clampViewerWidth,
  useFileViewerStore,
} from '../src/renderer/features/file-viewer/store';

const panelPath = path.resolve(
  process.cwd(),
  'src/renderer/features/file-viewer/FileViewerPanel.tsx'
);
const codeViewerPath = path.resolve(
  process.cwd(),
  'src/renderer/features/file-viewer/viewers/CodeViewer.tsx'
);
const documentThemeHookPath = path.resolve(
  process.cwd(),
  'src/renderer/hooks/useDocumentTheme.ts'
);
const storePath = path.resolve(process.cwd(), 'src/renderer/features/file-viewer/store.ts');

describe('stage 6 polish — store width + toggle', () => {
  beforeEach(() => {
    useFileViewerStore.setState({
      path: null,
      cwd: undefined,
      lastPath: null,
      lastCwd: undefined,
      width: FILE_VIEWER_DEFAULT_WIDTH,
    });
  });

  it('clamps widths into the valid range', () => {
    expect(clampViewerWidth(100)).toBe(FILE_VIEWER_MIN_WIDTH);
    expect(clampViewerWidth(10_000)).toBe(FILE_VIEWER_MAX_WIDTH);
    expect(clampViewerWidth(FILE_VIEWER_DEFAULT_WIDTH + 13.4)).toBe(
      FILE_VIEWER_DEFAULT_WIDTH + 13
    );
    expect(clampViewerWidth(Number.NaN)).toBe(FILE_VIEWER_DEFAULT_WIDTH);
  });

  it('persists clamped widths through setWidth', () => {
    const { setWidth } = useFileViewerStore.getState();

    setWidth(50);
    expect(useFileViewerStore.getState().width).toBe(FILE_VIEWER_MIN_WIDTH);

    setWidth(700);
    expect(useFileViewerStore.getState().width).toBe(700);
  });

  it('toggle closes when open and re-opens last path when closed', () => {
    const store = useFileViewerStore.getState();
    store.open('/workspace/example.ts', '/workspace');

    expect(useFileViewerStore.getState().path).toBe('/workspace/example.ts');

    useFileViewerStore.getState().toggle();
    expect(useFileViewerStore.getState().path).toBeNull();
    expect(useFileViewerStore.getState().lastPath).toBe('/workspace/example.ts');

    useFileViewerStore.getState().toggle();
    expect(useFileViewerStore.getState().path).toBe('/workspace/example.ts');
    expect(useFileViewerStore.getState().cwd).toBe('/workspace');
  });

  it('reads width from localStorage when available', () => {
    const source = fs.readFileSync(storePath, 'utf8');
    expect(source).toContain("'file-viewer:width'");
    expect(source).toContain('window.localStorage');
  });
});

describe('stage 6 polish — FileViewerError', () => {
  it('renders TOO_LARGE with an OS-open button and size limit', () => {
    const markup = renderToStaticMarkup(
      React.createElement(FileViewerError, {
        path: '/workspace/huge.bin',
        cwd: '/workspace',
        error: 'TOO_LARGE',
        limit: 50 * 1024 * 1024,
      })
    );

    expect(markup).toContain('파일이 50MB 초과');
    expect(markup).toContain('OS에서 열기');
    expect(markup).toContain('<button');
  });

  it('renders NOT_FOUND message', () => {
    const markup = renderToStaticMarkup(
      React.createElement(FileViewerError, {
        path: '/workspace/missing.txt',
        error: 'NOT_FOUND',
      })
    );

    expect(markup).toContain('파일을 찾을 수 없습니다');
  });

  it('renders READ_FAILED message', () => {
    const markup = renderToStaticMarkup(
      React.createElement(FileViewerError, {
        path: '/workspace/locked.txt',
        error: 'READ_FAILED',
      })
    );

    expect(markup).toContain('권한이 없거나 손상된 파일');
  });

  it('renders workspace and path validation messages', () => {
    const outsideWorkspaceMarkup = renderToStaticMarkup(
      React.createElement(FileViewerError, {
        path: '/other/file.txt',
        error: 'OUTSIDE_WORKSPACE',
      })
    );
    const notAbsoluteMarkup = renderToStaticMarkup(
      React.createElement(FileViewerError, {
        path: 'relative.txt',
        error: 'NOT_ABSOLUTE',
      })
    );

    expect(outsideWorkspaceMarkup).toContain('작업 공간 밖의 파일은 미리볼 수 없습니다');
    expect(notAbsoluteMarkup).toContain('절대 경로가 아닌 파일은 미리볼 수 없습니다');
  });
});

describe('stage 6 polish — FileViewerPanel surface', () => {
  it('binds Escape/Cmd+\\\\ shortcuts and routes errors through FileViewerError', () => {
    const source = fs.readFileSync(panelPath, 'utf8');

    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain("event.key === '\\\\'");
    expect(source).toContain('event.metaKey || event.ctrlKey');
    expect(source).toContain('toggle()');
    expect(source).toContain('FileViewerError');
  });

  it('renders a draggable resize handle bound to the store width', () => {
    const source = fs.readFileSync(panelPath, 'utf8');

    expect(source).toContain('data-testid="file-viewer-resize-handle"');
    expect(source).toContain('cursor-col-resize');
    expect(source).toContain('setWidth');
    expect(source).toContain('style={{ width: `${width}px` }}');
    expect(source).toContain('max-w-[45vw]');
  });
});

describe('stage 6 polish — CodeViewer theme', () => {
  it('imports both shiki themes and observes document class changes', () => {
    const source = fs.readFileSync(codeViewerPath, 'utf8');
    const hookSource = fs.readFileSync(documentThemeHookPath, 'utf8');

    expect(source).toContain("import('@shikijs/themes/github-dark')");
    expect(source).toContain("import('@shikijs/themes/github-light')");
    expect(source).toContain('useDocumentTheme()');
    expect(hookSource).toContain("classList.contains('light')");
    expect(hookSource).toContain('MutationObserver');
    expect(hookSource).toContain("attributeFilter: ['class']");
  });
});
