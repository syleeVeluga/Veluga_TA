import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import type { ViewerComponentProps } from '../viewer-map';
import { readErrorMessage, textFromReadResult } from '../utils/read-result';
import CodeViewer from './CodeViewer';

type HtmlViewMode = 'preview' | 'source';

export default function HtmlViewer({ path, readResult }: ViewerComponentProps) {
  const text = textFromReadResult(readResult);
  const [mode, setMode] = useState<HtmlViewMode>('preview');
  const [sanitizePreview, setSanitizePreview] = useState(false);
  const sanitizedText = useMemo(
    () => (text !== null && sanitizePreview ? DOMPurify.sanitize(text) : text),
    [sanitizePreview, text]
  );

  useEffect(() => {
    setMode('preview');
    setSanitizePreview(false);
  }, [path]);

  if (text === null) {
    return <div className="p-4 text-sm text-text-muted">{readErrorMessage(readResult)}</div>;
  }

  if (mode === 'source') {
    return (
      <div className="flex h-full flex-col">
        <HtmlViewerToolbar
          mode={mode}
          sanitizePreview={sanitizePreview}
          setMode={setMode}
          setSanitizePreview={setSanitizePreview}
        />
        <div className="min-h-0 flex-1">
          <CodeViewer path={path} readResult={readResult} content={text} ext=".html" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <HtmlViewerToolbar
        mode={mode}
        sanitizePreview={sanitizePreview}
        setMode={setMode}
        setSanitizePreview={setSanitizePreview}
      />
      <iframe
        title={path}
        srcDoc={sanitizedText ?? ''}
        sandbox=""
        className="min-h-0 flex-1 border-0 bg-background"
      />
    </div>
  );
}

interface HtmlViewerToolbarProps {
  mode: HtmlViewMode;
  sanitizePreview: boolean;
  setMode: (mode: HtmlViewMode) => void;
  setSanitizePreview: (value: boolean) => void;
}

function HtmlViewerToolbar({
  mode,
  sanitizePreview,
  setMode,
  setSanitizePreview,
}: HtmlViewerToolbarProps) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-muted px-3">
      <div className="flex rounded-md border border-border-muted p-0.5">
        <button
          type="button"
          onClick={() => setMode('preview')}
          className={`rounded px-2.5 py-1 text-xs transition-colors ${
            mode === 'preview'
              ? 'bg-surface-hover text-text-primary'
              : 'text-text-muted hover:text-text-primary'
          }`}
        >
          Preview
        </button>
        <button
          type="button"
          onClick={() => setMode('source')}
          className={`rounded px-2.5 py-1 text-xs transition-colors ${
            mode === 'source'
              ? 'bg-surface-hover text-text-primary'
              : 'text-text-muted hover:text-text-primary'
          }`}
        >
          Source
        </button>
      </div>
      <label className="flex items-center gap-2 text-xs text-text-muted">
        <input
          type="checkbox"
          checked={sanitizePreview}
          onChange={(event) => setSanitizePreview(event.currentTarget.checked)}
          className="h-3.5 w-3.5"
        />
        Sanitize
      </label>
    </div>
  );
}
