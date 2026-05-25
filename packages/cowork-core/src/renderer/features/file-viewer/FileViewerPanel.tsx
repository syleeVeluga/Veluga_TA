import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { previewKindForFile } from './preview-kind';
import {
  FILE_VIEWER_MAX_WIDTH,
  FILE_VIEWER_MIN_WIDTH,
  useFileViewerStore,
} from './store';
import type { ReadFileResult } from './types';
import { READ_REQUIRED_KINDS, viewerComponents } from './viewer-map';
import FileViewerError from './viewers/FileViewerError';

function basename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || filePath;
}

export function FileViewerPanel() {
  const path = useFileViewerStore((s) => s.path);
  const cwd = useFileViewerStore((s) => s.cwd);
  const close = useFileViewerStore((s) => s.close);
  const toggle = useFileViewerStore((s) => s.toggle);
  const width = useFileViewerStore((s) => s.width);
  const setWidth = useFileViewerStore((s) => s.setWidth);
  const [readResult, setReadResult] = useState<ReadFileResult | undefined>(undefined);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const kind = path ? previewKindForFile(path) : 'unsupported';
  const requiresRead = READ_REQUIRED_KINDS.has(kind);

  useEffect(() => {
    let cancelled = false;
    setReadResult(undefined);

    if (!path || !requiresRead) {
      return () => {
        cancelled = true;
      };
    }

    const readFile = window.electronAPI?.fileViewer?.read;
    if (!readFile) {
      setReadResult({ error: 'READ_FAILED' });
      return () => {
        cancelled = true;
      };
    }

    void readFile(path)
      .then((result) => {
        if (!cancelled) {
          setReadResult(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReadResult({ error: 'READ_FAILED' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [path, requiresRead]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (event.key === 'Escape' && path !== null) {
        close();
        return;
      }
      if (event.key === '\\' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [close, path, toggle]);

  const onResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const renderedWidth =
        event.currentTarget.parentElement?.getBoundingClientRect().width ?? width;
      dragStateRef.current = { startX: event.clientX, startWidth: renderedWidth };
    },
    [width]
  );

  const onResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current;
      if (!state) {
        return;
      }
      const next = state.startWidth - (event.clientX - state.startX);
      setWidth(next);
    },
    [setWidth]
  );

  const onResizePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
  }, []);

  if (path === null) {
    return null;
  }

  const Viewer = viewerComponents[kind];
  const errorResult =
    requiresRead && readResult && 'error' in readResult ? readResult : null;

  return (
    <aside
      style={{ width: `${width}px` }}
      className="max-w-[45vw] shrink-0 border-l border-border-muted bg-background flex flex-col overflow-hidden relative"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file viewer"
        aria-valuemin={FILE_VIEWER_MIN_WIDTH}
        aria-valuemax={FILE_VIEWER_MAX_WIDTH}
        aria-valuenow={width}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-accent-muted active:bg-accent-muted"
        data-testid="file-viewer-resize-handle"
      />
      <div className="h-10 px-3 flex items-center gap-2 border-b border-border-muted shrink-0">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-text-primary truncate">{basename(path)}</p>
          <p className="text-[11px] text-text-muted truncate">{kind}</p>
        </div>
        <button
          type="button"
          onClick={close}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          title="Close file viewer (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {errorResult ? (
          <FileViewerError
            path={path}
            cwd={cwd}
            error={errorResult.error}
            limit={errorResult.limit}
          />
        ) : (
          <Suspense fallback={<div className="p-4 text-sm text-text-muted">Loading...</div>}>
            <Viewer path={path} cwd={cwd} readResult={readResult} />
          </Suspense>
        )}
      </div>
    </aside>
  );
}
