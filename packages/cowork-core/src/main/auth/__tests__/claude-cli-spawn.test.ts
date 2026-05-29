import { describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn(() => ({ killed: false })) }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { quoteWindowsCmdArg, spawnClaudeCli } from '../claude-cli-spawn';

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

  // Regression: `cmd /s /c` strips the outermost quote pair, so the command line
  // must be wrapped in an extra pair. Without it `"exe" "--version"` collapses
  // into `exe" "--version` and the CLI never launches (reported as "not installed").
  it.runIf(process.platform === 'win32')(
    'wraps the Windows command line so cmd /s /c does not corrupt quoted paths',
    () => {
      spawnMock.mockClear();
      spawnClaudeCli('C:\\Users\\me\\.local\\bin\\claude.exe', ['--version']);

      const [, args] = spawnMock.mock.calls[0] as unknown as [string, string[]];
      expect(args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
      const commandLine = args[3];
      // Outer wrap present, and removing it leaves the per-argument quoting intact.
      expect(commandLine.startsWith('"')).toBe(true);
      expect(commandLine.endsWith('"')).toBe(true);
      const inner = commandLine.slice(1, -1);
      expect(inner).toBe('"C:\\Users\\me\\.local\\bin\\claude.exe" "--version"');
    }
  );
});
