import { FolderOpen } from 'lucide-react';
import type { ViewerComponentProps } from '../viewer-map';

export default function UnsupportedViewer({ path, cwd }: ViewerComponentProps) {
  return (
    <div className="h-full p-4 flex items-center justify-center">
      <button
        type="button"
        onClick={() => {
          void window.electronAPI?.showItemInFolder(path, cwd);
        }}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary hover:bg-surface-hover transition-colors"
      >
        <FolderOpen className="h-4 w-4" />
        Open in file manager
      </button>
    </div>
  );
}
