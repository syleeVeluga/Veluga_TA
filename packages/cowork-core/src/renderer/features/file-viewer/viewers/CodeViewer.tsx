import { useEffect, useMemo, useState } from 'react';
import { createHighlighterCore, type HighlighterCore as Highlighter } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import type { ViewerComponentProps } from '../viewer-map';
import { readErrorMessage, textFromReadResult } from '../utils/read-result';
import TextViewer from './TextViewer';

const DARK_THEME = 'github-dark';
const LIGHT_THEME = 'github-light';
const MAX_HIGHLIGHT_BYTES = 5 * 1024 * 1024;

interface CodeViewerProps extends ViewerComponentProps {
  content?: string;
  ext?: string;
}

let highlighterPromise: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighterCore({
    themes: [
      import('@shikijs/themes/github-dark'),
      import('@shikijs/themes/github-light'),
    ],
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
      import('@shikijs/langs/html'),
    ],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  });

  return highlighterPromise;
}

function languageForPath(path: string, ext?: string): string | null {
  const cleanPath = (ext ?? path).split(/[?#]/, 1)[0]?.toLowerCase() ?? '';
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
  if (cleanPath.endsWith('.html') || cleanPath.endsWith('.htm')) return 'html';
  return null;
}

function readableSize(readResult: ViewerComponentProps['readResult'], content?: string): number | null {
  if (content !== undefined) {
    return new TextEncoder().encode(content).byteLength;
  }
  if (!readResult || 'error' in readResult) {
    return null;
  }
  return readResult.size;
}

function isLightTheme(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  return document.documentElement.classList.contains('light');
}

function useDocumentTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (isLightTheme() ? 'light' : 'dark'));

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return;
    }
    const target = document.documentElement;
    const observer = new MutationObserver(() => {
      setTheme(isLightTheme() ? 'light' : 'dark');
    });
    observer.observe(target, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

export default function CodeViewer({ path, readResult, content, ext }: CodeViewerProps) {
  const language = useMemo(() => languageForPath(path, ext), [ext, path]);
  const size = readableSize(readResult, content);
  const isTooLarge = size !== null && size > MAX_HIGHLIGHT_BYTES;
  const text = isTooLarge ? null : content ?? textFromReadResult(readResult);
  const theme = useDocumentTheme();
  const shikiTheme = theme === 'light' ? LIGHT_THEME : DARK_THEME;
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
          theme: shikiTheme,
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
  }, [isTooLarge, language, shikiTheme, text]);

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

  const containerBg = theme === 'light' ? 'bg-[#ffffff]' : 'bg-[#24292e]';

  return (
    <div
      className={`h-full overflow-auto ${containerBg} [&_pre]:m-0 [&_pre]:min-h-full [&_pre]:overflow-visible [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-sm [&_pre]:leading-6 [&_code]:block`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
