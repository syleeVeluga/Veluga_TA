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
  switch (readResult.error) {
    case 'TOO_LARGE': {
      const mb = readResult.limit ? Math.round(readResult.limit / 1024 / 1024) : 50;
      return `파일이 ${mb}MB 초과.`;
    }
    case 'NOT_FOUND':
      return '파일을 찾을 수 없습니다.';
    case 'READ_FAILED':
      return '권한이 없거나 손상된 파일입니다.';
    case 'OUTSIDE_WORKSPACE':
      return '작업 공간 밖의 파일은 미리볼 수 없습니다.';
    case 'NOT_ABSOLUTE':
      return '절대 경로가 아닌 파일은 미리볼 수 없습니다.';
    default:
      return '미리보기를 표시할 수 없습니다.';
  }
}
