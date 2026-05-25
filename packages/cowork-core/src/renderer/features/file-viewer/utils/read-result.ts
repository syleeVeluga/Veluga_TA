import type { ReadFileResult } from '../types';
import { decodeBase64Utf8 } from './base64';

export function textFromReadResult(readResult?: ReadFileResult): string | null {
  if (!readResult || 'error' in readResult) {
    return null;
  }
  return decodeBase64Utf8(readResult.buffer);
}

export function readErrorMessage(readResult?: ReadFileResult): string {
  if (!readResult) {
    return 'Loading...';
  }
  if (!('error' in readResult)) {
    return '';
  }
  if (readResult.error === 'TOO_LARGE' && readResult.limit) {
    return `File is too large to preview. Limit: ${Math.round(readResult.limit / 1024 / 1024)} MB.`;
  }
  return `Unable to preview file: ${readResult.error}.`;
}
