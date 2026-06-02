import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess, SpawnOptions } from 'child_process';
import {
  buildWindowsShellInvocation,
  createWindowsBashOperations,
} from '../../main/claude/windows-bash-operations';

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();

  constructor(readonly pid?: number) {
    super();
  }
}

function decodeEncodedCommand(args: string[]): string {
  const index = args.indexOf('-EncodedCommand');
  if (index === -1 || index === args.length - 1) {
    throw new Error(`No -EncodedCommand payload in args: ${args.join(' ')}`);
  }
  return Buffer.from(args[index + 1], 'base64').toString('utf16le');
}

function createSpawnMock(children: FakeChildProcess[]) {
  return vi.fn((command: string, args: string[], _options: SpawnOptions) => {
    const child = children.shift();
    if (!child) throw new Error(`Unexpected spawn: ${command} ${args.join(' ')}`);
    return Object.assign(child, {
      spawnargs: [command, ...args],
      spawnfile: command,
      killed: false,
      connected: false,
      exitCode: null,
      signalCode: null,
    }) as unknown as ChildProcess;
  });
}

describe('windows bash operations', () => {
  it('uses platform-correct shell arguments for common Windows shells', () => {
    expect(buildWindowsShellInvocation('dir', 'C:\\Windows\\System32\\cmd.exe')).toEqual({
      shell: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'chcp 65001 > nul & dir'],
    });

    const powerShellInvocation = buildWindowsShellInvocation('Write-Output hi', 'pwsh.exe');
    expect(powerShellInvocation.shell).toBe('pwsh.exe');
    expect(powerShellInvocation.args.slice(0, -1)).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
    ]);
    const decodedScript = decodeEncodedCommand(powerShellInvocation.args);
    expect(decodedScript).toContain('[Console]::OutputEncoding = $utf8NoBom');
    expect(decodedScript).toContain('Write-Output hi');

    expect(buildWindowsShellInvocation('echo hi', 'C:\\Program Files\\Git\\bin\\bash.exe')).toEqual(
      {
        shell: 'C:\\Program Files\\Git\\bin\\bash.exe',
        args: ['-c', 'echo hi'],
      }
    );
  });

  it('unwraps nested PowerShell -Command calls before encoding the script', () => {
    const invocation = buildWindowsShellInvocation(
      'powershell -NoProfile -Command "$p = 1; Write-Output $p"',
      'C:\\Windows\\System32\\cmd.exe'
    );

    expect(invocation.shell).toBe('powershell.exe');
    const decodedScript = decodeEncodedCommand(invocation.args);
    expect(decodedScript).toContain('$p = 1; Write-Output $p');
    expect(decodedScript).not.toContain('powershell -NoProfile');
  });

  it('keeps operators inside a quoted -Command payload as a single script', () => {
    const invocation = buildWindowsShellInvocation(
      'powershell -Command "Get-Process | Where-Object { $_.CPU -gt 1 }"',
      'C:\\Windows\\System32\\cmd.exe'
    );

    expect(invocation.shell).toBe('powershell.exe');
    expect(decodeEncodedCommand(invocation.args)).toContain(
      'Get-Process | Where-Object { $_.CPU -gt 1 }'
    );
  });

  it('does not intercept when outer-shell operators trail the -Command payload', () => {
    // The pipe belongs to the outer shell, so the command must run verbatim
    // through the configured shell rather than being folded into PowerShell.
    const invocation = buildWindowsShellInvocation(
      'powershell -Command "Get-Date" | head -1',
      'C:\\Program Files\\Git\\bin\\bash.exe'
    );

    expect(invocation).toEqual({
      shell: 'C:\\Program Files\\Git\\bin\\bash.exe',
      args: ['-c', 'powershell -Command "Get-Date" | head -1'],
    });
  });

  it('spawns Windows shell commands without detaching the child process', async () => {
    const child = new FakeChildProcess(1234);
    const spawnProcess = createSpawnMock([child]);
    const onData = vi.fn();
    const ops = createWindowsBashOperations({
      spawnProcess,
      shellResolver: () => 'C:\\Windows\\System32\\cmd.exe',
    });

    const promise = ops.exec('echo hello', process.cwd(), {
      onData,
      env: { PATH: 'test-path' },
    });
    const output = Buffer.from('hello');
    child.stdout.emit('data', output);
    child.emit('close', 0);

    await expect(promise).resolves.toEqual({ exitCode: 0 });
    expect(onData).toHaveBeenCalledWith(output);
    expect(spawnProcess).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', 'chcp 65001 > nul & echo hello'],
      expect.objectContaining({
        cwd: process.cwd(),
        detached: false,
        env: {
          LANG: 'en_US.UTF-8',
          LC_CTYPE: 'en_US.UTF-8',
          PATH: 'test-path',
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    );
  });

  it('encodes PowerShell scripts via -EncodedCommand to avoid quoting/encoding issues', async () => {
    const child = new FakeChildProcess(2345);
    const spawnProcess = createSpawnMock([child]);
    const ops = createWindowsBashOperations({
      spawnProcess,
      shellResolver: () => 'powershell.exe',
    });

    const promise = ops.exec('Write-Output hi', process.cwd(), {
      onData: vi.fn(),
    });
    child.emit('close', 0);

    await expect(promise).resolves.toEqual({ exitCode: 0 });
    const [, spawnArgs, spawnOptions] = spawnProcess.mock.calls[0];
    expect(spawnArgs.slice(0, -1)).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
    ]);
    expect(decodeEncodedCommand(spawnArgs)).toContain('Write-Output hi');
    expect(spawnOptions).toMatchObject({ stdio: ['ignore', 'pipe', 'pipe'] });
  });

  it('kills the Windows process tree and rejects when a command times out', async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChildProcess(4321);
      const taskkill = new FakeChildProcess(9876);
      const spawnProcess = createSpawnMock([child, taskkill]);
      const ops = createWindowsBashOperations({
        spawnProcess,
        shellResolver: () => 'cmd.exe',
        taskkillWaitMs: 10,
        terminationGraceMs: 10,
      });

      const promise = ops.exec('node server.js', process.cwd(), {
        onData: vi.fn(),
        timeout: 1,
      });
      const result = promise.then(
        () => undefined,
        (error: Error) => error
      );

      await vi.advanceTimersByTimeAsync(1000);

      expect(spawnProcess).toHaveBeenNthCalledWith(
        2,
        'taskkill',
        ['/F', '/T', '/PID', '4321'],
        expect.objectContaining({
          detached: false,
          stdio: 'ignore',
          windowsHide: true,
        })
      );

      taskkill.emit('close', 0);
      child.emit('close', null);

      await expect(result).resolves.toMatchObject({ message: 'timeout:1' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not spawn a process when the working directory is missing', async () => {
    const missingCwd = path.join(os.tmpdir(), `open-cowork-missing-${Date.now()}`);
    const spawnProcess = createSpawnMock([]);
    const ops = createWindowsBashOperations({ spawnProcess });

    await expect(
      ops.exec('echo nope', missingCwd, {
        onData: vi.fn(),
      })
    ).rejects.toThrow('Working directory does not exist');
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
