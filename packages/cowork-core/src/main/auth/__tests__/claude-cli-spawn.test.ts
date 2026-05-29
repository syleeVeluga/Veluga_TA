import { describe, expect, it } from 'vitest';

import { quoteWindowsCmdArg } from '../claude-cli-spawn';

describe('claude-cli-spawn', () => {
  it('quotes and escapes cmd metacharacters in Windows arguments', () => {
    expect(quoteWindowsCmdArg('model&calc|more')).toBe('"model^&calc^|more"');
    expect(quoteWindowsCmdArg('100%')).toBe('"100^%"');
    expect(quoteWindowsCmdArg('say "hi"')).toBe('"say ^"hi^""');
    expect(quoteWindowsCmdArg('')).toBe('""');
  });

  it('rejects control characters that cannot be safely passed through cmd.exe', () => {
    expect(() => quoteWindowsCmdArg('bad\r\nnext')).toThrow(/control characters/);
  });
});
