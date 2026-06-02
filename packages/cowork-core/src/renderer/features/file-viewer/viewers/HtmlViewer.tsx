import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import type { ViewerComponentProps } from '../viewer-map';
import { readErrorMessage, textFromReadResult } from '../utils/read-result';
import { hasBlockedResources, inlineHtmlResources } from '../utils/html-inline';
import CodeViewer from './CodeViewer';

type HtmlViewMode = 'preview' | 'source';

export default function HtmlViewer({ path, readResult }: ViewerComponentProps) {
  const text = textFromReadResult(readResult);
  const [mode, setMode] = useState<HtmlViewMode>('preview');
  const [sanitizePreview, setSanitizePreview] = useState(false);

  // Inline relative stylesheets / @imports / images so the sandboxed iframe can
  // render documents that reference sibling files without loosening the CSP.
  // null until inlining resolves (or falls back to the raw document).
  const [inlinedText, setInlinedText] = useState<string | null>(null);

  useEffect(() => {
    setMode('preview');
    setSanitizePreview(false);
  }, [path]);

  useEffect(() => {
    let cancelled = false;
    setInlinedText(null);

    if (text === null) {
      return () => {
        cancelled = true;
      };
    }

    const read = window.electronAPI?.fileViewer?.read;
    if (!read) {
      setInlinedText(text);
      return () => {
        cancelled = true;
      };
    }

    void inlineHtmlResources(text, path, read)
      .then((result) => {
        if (!cancelled) setInlinedText(result);
      })
      .catch(() => {
        // Inlining is best-effort; fall back to the raw document.
        if (!cancelled) setInlinedText(text);
      });

    return () => {
      cancelled = true;
    };
  }, [path, text]);

  const previewText = useMemo(
    () =>
      inlinedText !== null && sanitizePreview
        ? DOMPurify.sanitize(inlinedText, { WHOLE_DOCUMENT: true })
        : inlinedText,
    [sanitizePreview, inlinedText]
  );
  const blocked = useMemo(
    () => (inlinedText !== null ? hasBlockedResources(inlinedText) : false),
    [inlinedText]
  );

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
      {blocked && (
        <div className="shrink-0 border-b border-border-muted bg-surface-muted/40 px-3 py-1.5 text-[11px] text-text-muted">
          일부 스크립트·외부 리소스는 보안 미리보기에서 차단됩니다. 원본은 Source 탭에서 확인하세요.
        </div>
      )}
      {previewText === null ? (
        <div className="p-4 text-sm text-text-muted">미리보기 준비 중...</div>
      ) : (
        <iframe
          key={path}
          title={path}
          srcDoc={previewText}
          sandbox=""
          className="min-h-0 flex-1 border-0 bg-background"
        />
      )}
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
