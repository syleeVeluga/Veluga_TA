import { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import type { ViewerComponentProps } from '../viewer-map';
import { decodeBase64ArrayBuffer } from '../utils/base64';
import { readErrorMessage } from '../utils/read-result';

export default function DocxViewer({ readResult }: ViewerComponentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRenderError(false);

    if (!readResult || 'error' in readResult || !containerRef.current) {
      return () => {
        cancelled = true;
      };
    }

    const container = containerRef.current;
    container.replaceChildren();
    const arrayBuffer = decodeBase64ArrayBuffer(readResult.buffer);

    void renderAsync(arrayBuffer, containerRef.current, undefined, { renderAltChunks: false })
      .catch(() => {
        if (!cancelled) {
          setRenderError(true);
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
    return <div className="p-4 text-sm text-text-muted">Unable to render DOCX preview.</div>;
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
