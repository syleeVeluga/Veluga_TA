/**
 * @module main/auth/claude-cli-detector
 *
 * Detects the locally installed Claude Code CLI and its authentication state
 * for the Claude Pro delegation auth method (Phase 4).
 *
 * Veluga never stores Anthropic tokens — the `claude` CLI owns all auth. This
 * module only *observes* whether the CLI is present and logged in by invoking
 * the documented, verified commands:
 *   - `claude --version`            → installation + version
 *   - `claude auth status --json`   → { loggedIn, email, subscriptionType, ... }
 *
 * No token material is ever read, logged, or returned.
 */
import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import type { ClaudeCliStatus } from '../../renderer/types';
import { logWarn } from '../utils/logger';
import { spawnClaudeCli } from './claude-cli-spawn';

const INSTALL_URL = 'https://docs.claude.com/en/docs/claude-code';
const PROBE_TIMEOUT_MS = 5000;
const isWindows = process.platform === 'win32';

interface ProbeResult {
  code: number | null;
  stdout: string;
}

/**
 * Detect the Claude Code CLI. `overridePath` comes from the optional
 * `claudeCodePath` app config setting and takes precedence over PATH lookup.
 */
export async function detectClaudeCli(overridePath?: string): Promise<ClaudeCliStatus> {
  const exePath = findClaudeExecutable(overridePath);
  if (!exePath) {
    return { installed: false, installInstructions: INSTALL_URL, reason: 'not installed' };
  }

  const version = await probeVersion(exePath);
  if (!version) {
    // Found a file but it does not behave like the CLI — treat as not installed.
    return {
      installed: false,
      path: exePath,
      installInstructions: INSTALL_URL,
      reason: 'not installed',
    };
  }

  const auth = await probeAuth(exePath);
  return {
    installed: true,
    path: exePath,
    version,
    authenticated: auth.authenticated,
    email: auth.email,
    subscriptionType: auth.subscriptionType,
    reason: auth.authenticated ? undefined : 'not authenticated',
  };
}

function fileExists(candidate: string): boolean {
  try {
    accessSync(candidate, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the `claude` executable path. Honors an explicit override, then
 * scans PATH. On Windows the PATHEXT extensions (`.CMD`, `.EXE`, …) are tried
 * so we get the launchable shim, not the extension-less bash script.
 */
export function findClaudeExecutable(overridePath?: string): string | undefined {
  const override = overridePath?.trim();
  if (override) {
    return fileExists(override) ? override : undefined;
  }

  const dirs = getClaudeSearchDirs();
  const extensions = isWindows
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase())
    : [''];
  // Prefer launchable Windows shims (.cmd/.exe/.bat) over the bare bash script.
  const orderedExts = isWindows
    ? ['.cmd', '.exe', '.bat', ...extensions].filter((e, i, a) => a.indexOf(e) === i)
    : extensions;

  for (const dir of dirs) {
    for (const ext of orderedExts) {
      const candidate = path.join(dir, `claude${ext}`);
      if (fileExists(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function getClaudeSearchDirs(): string[] {
  const delimiter = isWindows ? ';' : ':';
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean);

  if (isWindows) {
    const userProfile = process.env.USERPROFILE?.trim();
    if (userProfile) {
      dirs.push(path.join(userProfile, '.local', 'bin'));
    }
  } else {
    const home = process.env.HOME?.trim();
    if (home) {
      dirs.push(path.join(home, '.local', 'bin'));
    }
  }

  return [...new Set(dirs)];
}

function probe(exePath: string, args: string[]): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve) => {
    let stdout = '';
    let settled = false;
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    let proc: ReturnType<typeof spawnClaudeCli>;
    try {
      proc = spawnClaudeCli(exePath, args);
    } catch {
      finish({ code: null, stdout: '' });
      return;
    }

    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // ignore
      }
      finish({ code: null, stdout });
    }, PROBE_TIMEOUT_MS);

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    // stderr intentionally ignored — it may carry sensitive auth diagnostics.
    proc.on('error', () => finish({ code: null, stdout }));
    proc.on('exit', (code) => finish({ code, stdout }));
  });
}

async function probeVersion(exePath: string): Promise<string | undefined> {
  const { code, stdout } = await probe(exePath, ['--version']);
  if (code !== 0) return undefined;
  const trimmed = stdout.trim();
  return trimmed || undefined;
}

interface AuthProbe {
  authenticated: boolean;
  email?: string;
  subscriptionType?: string;
}

async function probeAuth(exePath: string): Promise<AuthProbe> {
  const { code, stdout } = await probe(exePath, ['auth', 'status', '--json']);
  if (code !== 0) {
    return { authenticated: false };
  }
  try {
    const parsed = JSON.parse(stdout.trim()) as {
      loggedIn?: boolean;
      email?: string;
      subscriptionType?: string;
    };
    return {
      authenticated: parsed.loggedIn === true,
      email: typeof parsed.email === 'string' ? parsed.email : undefined,
      subscriptionType:
        typeof parsed.subscriptionType === 'string' ? parsed.subscriptionType : undefined,
    };
  } catch {
    // Older CLIs may print non-JSON; a clean exit still implies logged in.
    logWarn('[ClaudeCli] auth status returned non-JSON output');
    return { authenticated: true };
  }
}
