import { Suspense, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { previewKindForFile } from './preview-kind';
import { useFileViewerStore } from './store';
import type { ReadFileResult } from './types';
import { READ_REQUIRED_KINDS, viewerComponents } from './viewer-map';

function basename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || filePath;
}

export function FileViewerPanel() {
  const path = useFileViewerStore((s) => s.path);
  const cwd = useFileViewerStore((s) => s.cwd);
  const close = useFileViewerStore((s) => s.close);
  const [readResult, setReadResult] = useState<ReadFileResult | undefined>(undefined);

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

  if (path === null) {
    return null;
  }

  const Viewer = viewerComponents[kind];

  return (
    <aside className="w-[420px] max-w-[45vw] shrink-0 border-l border-border-muted bg-background flex flex-col overflow-hidden">
      <div className="h-10 px-3 flex items-center gap-2 border-b border-border-muted shrink-0">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-text-primary truncate">{basename(path)}</p>
          <p className="text-[11px] text-text-muted truncate">{kind}</p>
        </div>
        <button
          type="button"
          onClick={close}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          title="Close file viewer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <Suspense fallback={<div className="p-4 text-sm text-text-muted">Loading...</div>}>
          <Viewer path={path} cwd={cwd} readResult={readResult} />
        </Suspense>
      </div>
    </aside>
  );
}
