import type { ViewerComponentProps } from '../viewer-map';
import { readErrorMessage, textFromReadResult } from '../utils/read-result';

export default function TextViewer({ readResult }: ViewerComponentProps) {
  const text = textFromReadResult(readResult);

  if (text === null) {
    return <div className="p-4 text-sm text-text-muted">{readErrorMessage(readResult)}</div>;
  }

  return (
    <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-sm leading-6 text-text-primary">
      {text}
    </pre>
  );
}
