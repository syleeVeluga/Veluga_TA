import { existsSync } from 'fs';
import path from 'path';
import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import {
  SettingsManager as PiSettingsManager,
  type BashOperations,
} from '@mariozechner/pi-coding-agent';
import { getDefaultShell } from '../utils/shell-resolver';

const DEFAULT_TERMINATION_GRACE_MS = 5000;
const DEFAULT_TASKKILL_WAIT_MS = 3000;
const POWERSHELL_UTF8_PREAMBLE =
  '$utf8NoBom = [System.Text.UTF8Encoding]::new($false); [Console]::InputEncoding = $utf8NoBom; [Console]::OutputEncoding = $utf8NoBom; $OutputEncoding = $utf8NoBom';
const POWERSHELL_BASE_ARGS = [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
];
// Unquoted characters that the outer shell interprets as command separators /
// redirections. Used to tell a self-contained PowerShell script payload apart
// from an outer-shell pipeline that merely starts with `powershell ...`.
const SHELL_OPERATOR_CHARS = new Set(['|', '&', ';', '<', '>']);

type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface WindowsShellInvocation {
  shell: string;
  args: string[];
}

export interface WindowsBashOperationsOptions {
  spawnProcess?: SpawnProcess;
  shellResolver?: (cwd: string) => string;
  terminationGraceMs?: number;
  taskkillWaitMs?: number;
}

function normalizeShellPath(shellPath: string): string {
  const trimmed = shellPath.trim();
  const quoted = trimmed.match(/^"(.+)"$/);
  return quoted ? quoted[1] : trimmed;
}

function defaultShellResolver(cwd: string): string {
  try {
    const configuredShell = PiSettingsManager.create(cwd).getShellPath();
    return configuredShell ? normalizeShellPath(configuredShell) : getDefaultShell();
  } catch {
    return getDefaultShell();
  }
}

// Applies UTF-8 locale defaults to the child environment. On Windows this
// overlaps with agent-runner's `createUtf8ShellSpawnHook` (which seeds the same
// vars before exec); the `||` fallbacks make this a no-op when the hook already
// ran, while still covering direct `exec` calls (e.g. tests) that bypass the hook.
function createUtf8ProcessEnv(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const base = env ?? process.env;
  const lang = base.LANG || 'en_US.UTF-8';
  return {
    ...base,
    LANG: lang,
    LC_CTYPE: base.LC_CTYPE || lang,
    PYTHONUTF8: base.PYTHONUTF8 || '1',
    PYTHONIOENCODING: base.PYTHONIOENCODING || 'utf-8',
  };
}

// Splits a command into shell tokens, stripping one level of quoting. Unquoted
// whitespace and unquoted operator characters break tokens (operators become
// their own token); characters inside quotes — including operators and spaces —
// stay part of a single token. This lets the caller distinguish a quoted
// PowerShell script (one token) from trailing outer-shell operators.
function tokenizeWindowsCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;

  const flush = () => {
    if (current) {
      tokens.push(current);
      current = '';
    }
  };

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if ((char === '"' || char === "'") && quote === undefined) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = undefined;
      continue;
    }
    if (quote === undefined) {
      if (/\s/.test(char)) {
        flush();
        continue;
      }
      if (SHELL_OPERATOR_CHARS.has(char)) {
        flush();
        tokens.push(char);
        continue;
      }
    }
    current += char;
  }

  flush();
  return tokens;
}

function isPowerShellExecutable(executable: string): boolean {
  const name = path.win32.basename(executable).toLowerCase();
  return (
    name === 'powershell' || name === 'powershell.exe' || name === 'pwsh' || name === 'pwsh.exe'
  );
}

function extractNestedPowerShellCommand(
  command: string
): { shell: string; command: string } | null {
  const tokens = tokenizeWindowsCommand(command.trim());
  const executableIndex = tokens[0] === '&' ? 1 : 0;
  const executable = tokens[executableIndex];
  if (!executable || !isPowerShellExecutable(executable)) return null;

  const commandIndex = tokens.findIndex((token, index) => {
    if (index <= executableIndex) return false;
    const normalized = token.toLowerCase();
    return normalized === '-command' || normalized === '-c';
  });
  if (commandIndex === -1) return null;

  // Only intercept when the script is a single self-contained argument. More than
  // one token means trailing outer-shell operators (`powershell -Command "X" | head`)
  // or multiple unquoted words — reconstructing those by joining would drop quoting
  // and fold the outer shell's pipeline into the PowerShell script. In that case we
  // bail and let the configured shell run the command verbatim.
  const payloadTokens = tokens.slice(commandIndex + 1);
  if (payloadTokens.length !== 1) return null;

  return {
    shell: path.win32.basename(executable).toLowerCase().startsWith('pwsh')
      ? 'pwsh.exe'
      : 'powershell.exe',
    command: payloadTokens[0],
  };
}

function buildPowerShellScript(command: string): string {
  return `${POWERSHELL_UTF8_PREAMBLE}; ${command}`;
}

// Builds a PowerShell invocation that passes the script via -EncodedCommand
// (Base64 of UTF-16LE). This is immune to the active console code page and to
// outer-shell quoting, so the script — including non-ASCII literals — is decoded
// natively by PowerShell exactly as written.
function buildPowerShellInvocation(shell: string, command: string): WindowsShellInvocation {
  const encoded = Buffer.from(buildPowerShellScript(command), 'utf16le').toString('base64');
  return {
    shell,
    args: [...POWERSHELL_BASE_ARGS, '-EncodedCommand', encoded],
  };
}

export function buildWindowsShellInvocation(
  command: string,
  shellPath = getDefaultShell()
): WindowsShellInvocation {
  const shell = normalizeShellPath(shellPath);
  const shellName = path.win32.basename(shell).toLowerCase();
  const nestedPowerShell = extractNestedPowerShellCommand(command);

  if (nestedPowerShell) {
    return buildPowerShellInvocation(nestedPowerShell.shell, nestedPowerShell.command);
  }

  if (shellName === 'cmd' || shellName === 'cmd.exe') {
    return { shell, args: ['/d', '/s', '/c', `chcp 65001 > nul & ${command}`] };
  }

  if (
    shellName === 'powershell' ||
    shellName === 'powershell.exe' ||
    shellName === 'pwsh' ||
    shellName === 'pwsh.exe'
  ) {
    return buildPowerShellInvocation(shell, command);
  }

  return { shell, args: ['-c', command] };
}

function createSpawnProcess(): SpawnProcess {
  return (command, args, options) => spawn(command, args, options);
}

async function waitForProcessClose(child: ChildProcess, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      child.off('close', finish);
      child.off('error', finish);
      resolve();
    };

    child.once('close', finish);
    child.once('error', finish);
    const timeoutHandle = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Ignore cleanup failures; the caller is already terminating a process tree.
      }
      finish();
    }, timeoutMs);
    timeoutHandle.unref?.();
  });
}

async function killWindowsProcessTree(
  pid: number,
  spawnProcess: SpawnProcess,
  taskkillWaitMs: number
): Promise<void> {
  try {
    const taskkill = spawnProcess('taskkill', ['/F', '/T', '/PID', String(pid)], {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    await waitForProcessClose(taskkill, taskkillWaitMs);
  } catch {
    try {
      process.kill(pid);
    } catch {
      // Process may already be gone.
    }
  }
}

export function createWindowsBashOperations(
  options: WindowsBashOperationsOptions = {}
): BashOperations {
  const spawnProcess = options.spawnProcess ?? createSpawnProcess();
  const shellResolver = options.shellResolver ?? defaultShellResolver;
  const terminationGraceMs = options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
  const taskkillWaitMs = options.taskkillWaitMs ?? DEFAULT_TASKKILL_WAIT_MS;

  return {
    exec: (command, cwd, { onData, signal, timeout, env }) =>
      new Promise((resolve, reject) => {
        if (!existsSync(cwd)) {
          reject(
            new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`)
          );
          return;
        }

        if (signal?.aborted) {
          reject(new Error('aborted'));
          return;
        }

        const { shell, args } = buildWindowsShellInvocation(command, shellResolver(cwd));
        const child = spawnProcess(shell, args, {
          cwd,
          detached: false,
          env: createUtf8ProcessEnv(env),
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });

        let settled = false;
        let timedOut = false;
        let timeoutHandle: NodeJS.Timeout | undefined;
        let forcedSettleHandle: NodeJS.Timeout | undefined;

        const cleanup = () => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (forcedSettleHandle) clearTimeout(forcedSettleHandle);
          child.stdout?.off('data', onData);
          child.stderr?.off('data', onData);
          child.off('close', onClose);
          child.off('error', onError);
          signal?.removeEventListener('abort', onAbort);
        };

        const settleResolve = (value: { exitCode: number | null }) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        };

        const settleReject = (error: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };

        const terminateChild = (reason: 'aborted' | 'timeout') => {
          if (child.pid) {
            void killWindowsProcessTree(child.pid, spawnProcess, taskkillWaitMs);
          } else {
            try {
              child.kill();
            } catch {
              // Ignore cleanup failures; the close/error path will settle or the grace timer will.
            }
          }

          forcedSettleHandle = setTimeout(() => {
            settleReject(
              reason === 'timeout' ? new Error(`timeout:${timeout}`) : new Error('aborted')
            );
          }, terminationGraceMs);
          forcedSettleHandle.unref?.();
        };

        function onClose(code: number | null) {
          if (signal?.aborted) {
            settleReject(new Error('aborted'));
            return;
          }
          if (timedOut) {
            settleReject(new Error(`timeout:${timeout}`));
            return;
          }
          settleResolve({ exitCode: code });
        }

        function onError(error: Error) {
          settleReject(error);
        }

        function onAbort() {
          terminateChild('aborted');
        }

        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.once('close', onClose);
        child.once('error', onError);

        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            terminateChild('timeout');
          }, timeout * 1000);
          timeoutHandle.unref?.();
        }

        signal?.addEventListener('abort', onAbort, { once: true });
      }),
  };
}
