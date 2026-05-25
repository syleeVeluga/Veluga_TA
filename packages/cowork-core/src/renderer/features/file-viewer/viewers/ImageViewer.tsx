import type { ViewerComponentProps } from '../viewer-map';
import { readErrorMessage } from '../utils/read-result';

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

export default function ImageViewer({ readResult }: ViewerComponentProps) {
  if (!readResult || 'error' in readResult) {
    return <div className="p-4 text-sm text-text-muted">{readErrorMessage(readResult)}</div>;
  }

  const mimeType = IMAGE_MIME_BY_EXT[readResult.ext] ?? 'application/octet-stream';

  return (
    <div className="h-full overflow-auto bg-surface-muted/40 p-4 flex items-center justify-center">
      <img
        src={`data:${mimeType};base64,${readResult.buffer}`}
        alt=""
        className="max-h-full max-w-full object-contain border border-border-muted bg-background"
      />
    </div>
  );
}
