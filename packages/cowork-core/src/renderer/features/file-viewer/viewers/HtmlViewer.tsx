import type { ViewerComponentProps } from '../viewer-map';
import { readErrorMessage, textFromReadResult } from '../utils/read-result';

export default function HtmlViewer({ path, readResult }: ViewerComponentProps) {
  const text = textFromReadResult(readResult);

  if (text === null) {
    return <div className="p-4 text-sm text-text-muted">{readErrorMessage(readResult)}</div>;
  }

  return (
    <iframe
      title={path}
      srcDoc={text}
      sandbox=""
      className="h-full w-full border-0 bg-background"
    />
  );
}
