import { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import type { ViewerComponentProps } from '../viewer-map';
import { decodeBase64ArrayBuffer } from '../utils/base64';
import { readErrorMessage } from '../utils/read-result';

export default function DocxViewer({ readResult }: ViewerComponentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRenderError(null);

    if (!readResult || 'error' in readResult || !containerRef.current) {
      return () => {
        cancelled = true;
      };
    }

    const container = containerRef.current;
    container.replaceChildren();

    let arrayBuffer: ArrayBuffer;
    try {
      arrayBuffer = decodeBase64ArrayBuffer(readResult.buffer);
    } catch (error) {
      console.error('[DocxViewer] failed to decode DOCX buffer:', error);
      setRenderError('파일 데이터를 해석할 수 없습니다.');
      return () => {
        cancelled = true;
      };
    }

    void renderAsync(arrayBuffer, container, undefined, { renderAltChunks: false })
      .then(() => {
        // A newer file may have started rendering into the same container while
        // this render was in flight — discard the stale result.
        if (cancelled) {
          container.replaceChildren();
        }
      })
      .catch((error) => {
        console.error('[DocxViewer] docx-preview render failed:', error);
        if (!cancelled) {
          setRenderError('DOCX 미리보기를 표시할 수 없습니다.');
          container.replaceChildren();
        }
      });

    return () => {
      cancelled = true;
      container.replaceChildren();
    };
  }, [readResult]);

  if (!readResult || 'error' in readResult) {
    return <div className="p-4 text-sm text-text-muted">{readErrorMessage(readResult)}</div>;
  }

  if (renderError) {
    return <div className="p-4 text-sm text-text-muted">{renderError}</div>;
  }

  return (
    <div className="h-full overflow-auto bg-surface-muted/40 p-4">
      <div
        ref={containerRef}
        className="mx-auto min-h-full max-w-full overflow-visible bg-background text-text-primary"
      />
    </div>
  );
}
