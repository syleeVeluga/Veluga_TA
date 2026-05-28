import { MessageMarkdown } from '@renderer/components/MessageMarkdown';
import { MermaidBlock } from '@renderer/components/MermaidBlock';
import type { ViewerComponentProps } from '../viewer-map';
import { readErrorMessage, textFromReadResult } from '../utils/read-result';

const markdownComponents = {
  code({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
    const match = /language-([\w+#.-]+)/.exec(className || '');
    if (match?.[1] === 'mermaid') {
      return <MermaidBlock source={String(children).replace(/\n$/, '')} />;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

export default function MarkdownViewer({ readResult }: ViewerComponentProps) {
  const text = textFromReadResult(readResult);

  if (text === null) {
    return <div className="p-4 text-sm text-text-muted">{readErrorMessage(readResult)}</div>;
  }

  return (
    <div className="h-full overflow-auto p-4">
      <MessageMarkdown normalizedText={text} components={markdownComponents} />
    </div>
  );
}
