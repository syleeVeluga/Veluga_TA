import { useEffect, useMemo, useState } from 'react';
import { createHighlighterCore, type HighlighterCore as Highlighter } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import type { ViewerComponentProps } from '../viewer-map';
import { readErrorMessage, textFromReadResult } from '../utils/read-result';
import TextViewer from './TextViewer';

const THEME = 'github-dark';
const MAX_HIGHLIGHT_BYTES = 5 * 1024 * 1024;

let highlighterPromise: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighterCore({
    themes: [import('@shikijs/themes/github-dark')],
    langs: [
      import('@shikijs/langs/typescript'),
      import('@shikijs/langs/tsx'),
      import('@shikijs/langs/javascript'),
      import('@shikijs/langs/jsx'),
      import('@shikijs/langs/python'),
      import('@shikijs/langs/go'),
      import('@shikijs/langs/rust'),
      import('@shikijs/langs/java'),
      import('@shikijs/langs/json'),
      import('@shikijs/langs/yaml'),
      import('@shikijs/langs/toml'),
      import('@shikijs/langs/bash'),
      import('@shikijs/langs/css'),
    ],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  });

  return highlighterPromise;
}

function languageForPath(path: string): string | null {
  const cleanPath = path.split(/[?#]/, 1)[0]?.toLowerCase() ?? '';
  if (cleanPath.endsWith('.ts')) return 'typescript';
  if (cleanPath.endsWith('.tsx')) return 'tsx';
  if (cleanPath.endsWith('.js') || cleanPath.endsWith('.mjs')) return 'javascript';
  if (cleanPath.endsWith('.jsx')) return 'jsx';
  if (cleanPath.endsWith('.py')) return 'python';
  if (cleanPath.endsWith('.go')) return 'go';
  if (cleanPath.endsWith('.rs')) return 'rust';
  if (cleanPath.endsWith('.java')) return 'java';
  if (cleanPath.endsWith('.json')) return 'json';
  if (cleanPath.endsWith('.yaml') || cleanPath.endsWith('.yml')) return 'yaml';
  if (cleanPath.endsWith('.toml')) return 'toml';
  if (cleanPath.endsWith('.sh')) return 'bash';
  if (cleanPath.endsWith('.css')) return 'css';
  return null;
}

function readableSize(readResult: ViewerComponentProps['readResult']): number | null {
  if (!readResult || 'error' in readResult) {
    return null;
  }
  return readResult.size;
}

export default function CodeViewer({ path, readResult }: ViewerComponentProps) {
  const language = useMemo(() => languageForPath(path), [path]);
  const size = readableSize(readResult);
  const isTooLarge = size !== null && size > MAX_HIGHLIGHT_BYTES;
  const text = isTooLarge ? null : textFromReadResult(readResult);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(false);

    if (text === null || language === null || isTooLarge) {
      return () => {
        cancelled = true;
      };
    }

    void getHighlighter()
      .then((highlighter) =>
        highlighter.codeToHtml(text, {
          lang: language,
          theme: THEME,
          tokenizeMaxLineLength: 1000,
        })
      )
      .then((result) => {
        if (!cancelled) {
          setHtml(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isTooLarge, language, text]);

  if (isTooLarge) {
    return (
      <div className="p-4 text-sm text-text-muted">
        File is too large to highlight. Limit: {Math.round(MAX_HIGHLIGHT_BYTES / 1024 / 1024)} MB.
      </div>
    );
  }

  if (text === null) {
    return <div className="p-4 text-sm text-text-muted">{readErrorMessage(readResult)}</div>;
  }

  if (language === null || error) {
    return <TextViewer path={path} readResult={readResult} />;
  }

  if (html === null) {
    return <div className="p-4 text-sm text-text-muted">Loading...</div>;
  }

  return (
    <div
      className="h-full overflow-auto bg-[#24292e] [&_pre]:m-0 [&_pre]:min-h-full [&_pre]:overflow-visible [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-sm [&_pre]:leading-6 [&_code]:block"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
