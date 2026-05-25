import { X } from 'lucide-react';
import { previewKindForFile } from './preview-kind';
import { useFileViewerStore } from './store';

function basename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || filePath;
}

export function FileViewerPanel() {
  const path = useFileViewerStore((s) => s.path);
  const close = useFileViewerStore((s) => s.close);

  if (path === null) {
    return null;
  }

  const kind = previewKindForFile(path);

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
      <div className="flex-1 min-h-0" />
    </aside>
  );
}
