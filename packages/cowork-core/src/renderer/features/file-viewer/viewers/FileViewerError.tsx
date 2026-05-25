import { FolderOpen } from 'lucide-react';
import type { ReadFileErrorCode } from '../types';

interface FileViewerErrorProps {
  path: string;
  cwd?: string;
  error: ReadFileErrorCode;
  limit?: number;
}

export default function FileViewerError({ path, cwd, error, limit }: FileViewerErrorProps) {
  if (error === 'TOO_LARGE') {
    const mb = limit ? Math.round(limit / 1024 / 1024) : 50;
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-text-muted">파일이 {mb}MB 초과.</p>
        <button
          type="button"
          onClick={() => {
            void window.electronAPI?.showItemInFolder(path, cwd);
          }}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary hover:bg-surface-hover transition-colors"
        >
          <FolderOpen className="h-4 w-4" />
          OS에서 열기
        </button>
      </div>
    );
  }

  if (error === 'NOT_FOUND') {
    return (
      <div className="h-full flex items-center justify-center p-6 text-center text-sm text-text-muted">
        파일을 찾을 수 없습니다.
      </div>
    );
  }

  if (error === 'READ_FAILED') {
    return (
      <div className="h-full flex items-center justify-center p-6 text-center text-sm text-text-muted">
        권한이 없거나 손상된 파일입니다.
      </div>
    );
  }

  if (error === 'OUTSIDE_WORKSPACE') {
    return (
      <div className="h-full flex items-center justify-center p-6 text-center text-sm text-text-muted">
        작업 공간 밖의 파일은 미리볼 수 없습니다.
      </div>
    );
  }

  if (error === 'NOT_ABSOLUTE') {
    return (
      <div className="h-full flex items-center justify-center p-6 text-center text-sm text-text-muted">
        절대 경로가 아닌 파일은 미리볼 수 없습니다.
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center p-6 text-center text-sm text-text-muted">
      미리보기를 표시할 수 없습니다.
    </div>
  );
}
