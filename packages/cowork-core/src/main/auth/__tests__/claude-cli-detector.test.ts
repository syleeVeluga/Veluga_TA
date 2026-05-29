import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the spawn helper so no real `claude` process is launched.
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('../claude-cli-spawn', () => ({ spawnClaudeCli: spawnMock }));

import { detectClaudeCli, findClaudeExecutable } from '../claude-cli-detector';

/** Minimal stand-in for a spawned child process. */
class FakeProc extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() };
  kill = vi.fn();

  /** Emit stdout chunks then exit on the next tick (after listeners attach). */
  resolveWith(stdout: string, code: number | null): void {
    setTimeout(() => {
      if (stdout) this.stdout.emit('data', Buffer.from(stdout, 'utf8'));
      this.emit('exit', code);
    }, 0);
  }
}

const REAL_FILE = __filename; // an existing path to satisfy the override existence check
const tempDirs: string[] = [];

describe('claude-cli-detector', () => {
  beforeEach(() => spawnMock.mockReset());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('reports not installed when the override path does not exist', async () => {
    const status = await detectClaudeCli('/definitely/not/here/claude');
    expect(status).toEqual({
      installed: false,
      installInstructions: expect.stringContaining('claude-code'),
      reason: 'not installed',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('detects an installed and authenticated CLI', async () => {
    spawnMock.mockImplementation((...callArgs: unknown[]) => {
      const args = (callArgs[1] as string[]) ?? [];
      const proc = new FakeProc();
      if (args.includes('--version')) {
        proc.resolveWith('2.1.87 (Claude Code)\n', 0);
      } else {
        proc.resolveWith(
          JSON.stringify({ loggedIn: true, email: 'sy@veluga.io', subscriptionType: 'team' }),
          0
        );
      }
      return proc;
    });

    const status = await detectClaudeCli(REAL_FILE);
    expect(status).toMatchObject({
      installed: true,
      path: REAL_FILE,
      version: '2.1.87 (Claude Code)',
      authenticated: true,
      email: 'sy@veluga.io',
      subscriptionType: 'team',
    });
    expect(status.reason).toBeUndefined();
  });

  it('marks an installed but logged-out CLI as not authenticated', async () => {
    spawnMock.mockImplementation((...callArgs: unknown[]) => {
      const args = (callArgs[1] as string[]) ?? [];
      const proc = new FakeProc();
      if (args.includes('--version')) proc.resolveWith('2.1.87\n', 0);
      else proc.resolveWith(JSON.stringify({ loggedIn: false }), 0);
      return proc;
    });

    const status = await detectClaudeCli(REAL_FILE);
    expect(status.installed).toBe(true);
    expect(status.authenticated).toBe(false);
    expect(status.reason).toBe('not authenticated');
  });

  it('treats a non-zero --version exit as not installed', async () => {
    spawnMock.mockImplementation(() => {
      const proc = new FakeProc();
      proc.resolveWith('', 1);
      return proc;
    });

    const status = await detectClaudeCli(REAL_FILE);
    expect(status.installed).toBe(false);
    expect(status.path).toBe(REAL_FILE);
  });

  it('falls back to authenticated when auth status prints non-JSON but exits 0', async () => {
    spawnMock.mockImplementation((...callArgs: unknown[]) => {
      const args = (callArgs[1] as string[]) ?? [];
      const proc = new FakeProc();
      if (args.includes('--version')) proc.resolveWith('2.1.87\n', 0);
      else proc.resolveWith('Logged in as sy@veluga.io', 0); // legacy non-JSON
      return proc;
    });

    const status = await detectClaudeCli(REAL_FILE);
    expect(status.authenticated).toBe(true);
    expect(status.email).toBeUndefined();
  });

  it('findClaudeExecutable returns undefined for a missing override', () => {
    expect(findClaudeExecutable('/nope/claude')).toBeUndefined();
    expect(findClaudeExecutable(REAL_FILE)).toBe(REAL_FILE);
  });

  it('finds the native installer location even when it is not on PATH', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veluga-claude-cli-'));
    tempDirs.push(root);
    const binDir = path.join(root, '.local', 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const cliPath = path.join(binDir, process.platform === 'win32' ? 'claude.exe' : 'claude');
    fs.writeFileSync(cliPath, '');

    vi.stubEnv(process.platform === 'win32' ? 'USERPROFILE' : 'HOME', root);
    vi.stubEnv('PATH', '');

    expect(findClaudeExecutable()).toBe(cliPath);
  });
});
