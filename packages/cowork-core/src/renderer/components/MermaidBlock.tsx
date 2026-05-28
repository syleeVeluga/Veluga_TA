import { memo, useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { useDocumentTheme } from '../hooks/useDocumentTheme';
import { CodeBlock } from './message/CodeBlock';

const RENDER_DEBOUNCE_MS = 150;
let renderCounter = 0;

function nextRenderId(): string {
  renderCounter += 1;
  return `mermaid-${renderCounter}`;
}

function removeMermaidErrorArtifacts(): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.querySelectorAll('body > div[id^="dmermaid-"], body > svg').forEach((element) => {
    if (element.querySelector('.error-icon, .error-text')) {
      element.remove();
    }
  });
}

interface MermaidBlockProps {
  source: string;
}

export const MermaidBlock = memo(function MermaidBlock({ source }: MermaidBlockProps) {
  const theme = useDocumentTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void import('./mermaid-config')
        .then(({ configureMermaid, mermaid }) => {
          configureMermaid(theme);
          return mermaid.render(nextRenderId(), source);
        })
        .then((result) => {
          if (!cancelled) {
            removeMermaidErrorArtifacts();
            setSvg(
              DOMPurify.sanitize(result.svg, { USE_PROFILES: { svg: true, svgFilters: true } })
            );
            setError(null);
          }
        })
        .catch((renderError: unknown) => {
          removeMermaidErrorArtifacts();
          if (!cancelled) {
            setError(
              renderError instanceof Error ? renderError.message : 'Unable to render diagram.'
            );
          }
        });
    }, RENDER_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [source, theme]);

  if (error) {
    return (
      <div className="my-3">
        <p className="mb-2 text-xs text-error">Mermaid diagram could not be rendered.</p>
        <CodeBlock language="mermaid">{source}</CodeBlock>
      </div>
    );
  }

  if (!svg) {
    return <div className="my-3 text-sm text-text-muted">Rendering diagram...</div>;
  }

  return (
    <div
      className="my-3 overflow-x-auto rounded border border-border bg-surface p-3 [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});
