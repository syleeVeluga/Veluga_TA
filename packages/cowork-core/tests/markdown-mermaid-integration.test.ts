import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const rendererRoot = path.resolve(process.cwd(), 'src/renderer');
const mainRoot = path.resolve(process.cwd(), 'src/main');

function readRendererFile(relativePath: string): string {
  return fs.readFileSync(path.join(rendererRoot, relativePath), 'utf8');
}

function readMainFile(relativePath: string): string {
  return fs.readFileSync(path.join(mainRoot, relativePath), 'utf8');
}

describe('markdown mermaid integration', () => {
  it('routes chat mermaid fences to MermaidBlock before CodeBlock fallback', () => {
    const source = readRendererFile('components/message/ContentBlockView.tsx');

    expect(source).toContain("import { MermaidBlock } from '../MermaidBlock';");
    expect(source).toContain("if (match[1] === 'mermaid')");
    expect(source).toContain("<MermaidBlock source={String(children).replace(/\\n$/, '')} />");
  });

  it('routes markdown viewer mermaid fences without replacing normal code rendering', () => {
    const source = readRendererFile('features/file-viewer/viewers/MarkdownViewer.tsx');

    expect(source).toContain("import { MermaidBlock } from '@renderer/components/MermaidBlock';");
    expect(source).toContain("if (match?.[1] === 'mermaid')");
    expect(source).toContain(
      '<MessageMarkdown normalizedText={text} components={markdownComponents} />'
    );
    expect(source).toContain('<code className={className} {...props}>');
  });

  it('configures mermaid with strict client-side rendering defaults', () => {
    const config = readRendererFile('components/mermaid-config.ts');
    const block = readRendererFile('components/MermaidBlock.tsx');

    expect(config).toContain("securityLevel: 'strict'");
    expect(config).toContain('suppressErrorRendering: true');
    expect(config).toContain('htmlLabels: false');
    expect(config).toContain("theme: 'base'");
    expect(config).toContain('primaryTextColor');
    expect(config).toContain('startOnLoad: false');
    expect(block).toContain("import DOMPurify from 'dompurify';");
    expect(block).toContain("import('./mermaid-config')");
    expect(block).toContain('removeMermaidErrorArtifacts');
    expect(block).toContain('DOMPurify.sanitize(result.svg');
    expect(block).toContain('const RENDER_DEBOUNCE_MS = 150;');
    expect(block).toContain('<CodeBlock language="mermaid">{source}</CodeBlock>');
  });

  it('guides agent-authored mermaid flowcharts away from parser-sensitive node ids', () => {
    const source = readMainFile('claude/agent-runner.ts');

    expect(source).toContain('MARKDOWN_RENDERING_GUIDANCE');
    expect(source).toContain('Use simple ASCII node IDs');
    expect(source).toContain('quoted labels');
    expect(source).toContain('contextualPrompt = `${MARKDOWN_RENDERING_GUIDANCE}');
  });
});
