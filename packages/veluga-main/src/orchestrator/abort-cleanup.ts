import { unlink } from 'node:fs/promises';

export interface KillableProcess {
  killed?: boolean;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit' | 'error', listener: (...args: unknown[]) => void): unknown;
  off?(event: 'exit' | 'error', listener: (...args: unknown[]) => void): unknown;
}

export interface AbortCleanupSummary {
  deletedTempFiles: string[];
  missingTempFiles: string[];
  tempFileErrors: Array<{ path: string; error: string }>;
  processesTerminated: number;
  processesKilled: number;
  processErrors: string[];
}

export class AbortCleanupRegistry {
  private readonly tempFiles = new Set<string>();
  private readonly childProcesses = new Set<KillableProcess>();

  constructor(private readonly options: { processKillGraceMs?: number } = {}) {}

  trackTempFile(filePath: string): string {
    this.tempFiles.add(filePath);
    return filePath;
  }

  untrackTempFile(filePath: string): void {
    this.tempFiles.delete(filePath);
  }

  trackChildProcess<T extends KillableProcess>(child: T): T {
    this.childProcesses.add(child);
    return child;
  }

  untrackChildProcess(child: KillableProcess): void {
    this.childProcesses.delete(child);
  }

  async cleanup(): Promise<AbortCleanupSummary> {
    const summary: AbortCleanupSummary = {
      deletedTempFiles: [],
      missingTempFiles: [],
      tempFileErrors: [],
      processesTerminated: 0,
      processesKilled: 0,
      processErrors: []
    };

    await Promise.all(
      [...this.tempFiles].map(async (filePath) => {
        try {
          await unlink(filePath);
          summary.deletedTempFiles.push(filePath);
          this.tempFiles.delete(filePath);
        } catch (error) {
          if (isMissingFileError(error)) {
            summary.missingTempFiles.push(filePath);
            this.tempFiles.delete(filePath);
            return;
          }
          summary.tempFileErrors.push({ path: filePath, error: errorMessage(error) });
        }
      })
    );

    for (const child of [...this.childProcesses]) {
      const result = await terminateProcess(child, this.options.processKillGraceMs ?? 5000);
      if (result === 'terminated') summary.processesTerminated += 1;
      if (result === 'killed') summary.processesKilled += 1;
      if (result.startsWith('error:')) summary.processErrors.push(result.slice('error:'.length));
      this.childProcesses.delete(child);
    }

    return summary;
  }
}

async function terminateProcess(child: KillableProcess, graceMs: number): Promise<'terminated' | 'killed' | `error:${string}`> {
  try {
    child.kill('SIGTERM');
  } catch (error) {
    return `error:${errorMessage(error)}`;
  }

  const graceful = await waitForExit(child, graceMs);
  if (graceful === 'exit') return 'terminated';
  if (graceful !== 'timeout') return graceful;

  try {
    child.kill('SIGKILL');
  } catch (error) {
    return `error:${errorMessage(error)}`;
  }
  return 'killed';
}

function waitForExit(child: KillableProcess, timeoutMs: number): Promise<'exit' | 'timeout' | `error:${string}`> {
  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    let onExit: () => void;
    let onError: (error: unknown) => void;
    const finish = (result: 'exit' | 'timeout' | `error:${string}`) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.off?.('exit', onExit);
      child.off?.('error', onError);
      resolve(result);
    };

    onExit = () => finish('exit');
    onError = (error: unknown) => finish(`error:${errorMessage(error)}`);
    timeout = setTimeout(() => finish('timeout'), Math.max(0, timeoutMs));
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
