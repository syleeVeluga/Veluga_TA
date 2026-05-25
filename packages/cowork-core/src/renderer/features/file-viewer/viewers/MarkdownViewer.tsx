import { MessageMarkdown } from '@renderer/components/MessageMarkdown';
import type { ViewerComponentProps } from '../viewer-map';
import { readErrorMessage, textFromReadResult } from '../utils/read-result';

export default function MarkdownViewer({ readResult }: ViewerComponentProps) {
  const text = textFromReadResult(readResult);

  if (text === null) {
    return <div className="p-4 text-sm text-text-muted">{readErrorMessage(readResult)}</div>;
  }

  return (
    <div className="h-full overflow-auto p-4">
      <MessageMarkdown normalizedText={text} />
    </div>
  );
}
