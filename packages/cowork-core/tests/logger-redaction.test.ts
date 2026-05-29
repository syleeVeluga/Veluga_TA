import { describe, expect, it } from 'vitest';
import { redactLogText } from '../src/main/utils/logger';

describe('logger redaction', () => {
  it('redacts OAuth and API token shaped strings', () => {
    const jwt =
      'eyJhbGciOiJub25lIn0.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjdF8xMjMifX0.sig';

    expect(
      redactLogText(`access_token=${jwt} refresh_token=refresh-token sk-12345678901234567890`)
    ).toBe('access_token=***REDACTED*** ***REDACTED*** ***REDACTED***');
  });
});
