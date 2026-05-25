import type { ViewerComponentProps } from '../viewer-map';
import { readErrorMessage } from '../utils/read-result';

export default function PdfViewer({ path, readResult }: ViewerComponentProps) {
  if (!readResult || 'error' in readResult) {
    return <div className="p-4 text-sm text-text-muted">{readErrorMessage(readResult)}</div>;
  }

  return (
    <iframe
      title={path}
      src={`data:application/pdf;base64,${readResult.buffer}`}
      className="h-full w-full border-0 bg-background"
    />
  );
}
