/**
 * @module main/auth/claude-cli-spawn
 *
 * Cross-platform spawn helper for the `claude` CLI.
 *
 * Why this exists: on Windows the resolved executable is usually a `.cmd`
 * shim, which Node's `child_process.spawn` refuses to launch directly (EINVAL
 * since the CVE-2024-27980 fix) unless routed through a shell. We route
 * through `cmd.exe` ourselves and escape every argument, so installation
 * directories containing spaces still work without allowing metacharacters in
 * model IDs to alter the command. Prompt content is still passed via stdin.
 */
import { spawn, type ChildProcess } from 'node:child_process';

const isWindows = process.platform === 'win32';

export function quoteWindowsCmdArg(arg: string): string {
  if (/[\0\r\n]/.test(arg)) {
    throw new Error('Cannot pass control characters to Claude CLI');
  }
  const escaped = arg.replace(/(["^&|<>()%!])/g, '^$1');
  return `"${escaped}"`;
}

/**
 * Spawn the `claude` CLI with stdio piped. On Windows, `.cmd`/`.bat` shims are
 * launched via `cmd.exe` with the executable path quoted.
 */
export function spawnClaudeCli(exePath: string, args: string[]): ChildProcess {
  const stdio: ['pipe', 'pipe', 'pipe'] = ['pipe', 'pipe', 'pipe'];
  if (isWindows) {
    const commandLine = [exePath, ...args].map(quoteWindowsCmdArg).join(' ');
    // `cmd /s /c` strips the first and last quote of the command line, so a
    // bare `"exe" "arg"` collapses into `exe" "arg` and fails to launch. Wrap
    // the whole command in an extra quote pair that /s consumes, leaving the
    // per-argument quotes intact.
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${commandLine}"`], {
      stdio,
      windowsVerbatimArguments: true,
    });
  }
  return spawn(exePath, args, { stdio });
}
