import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { registerFileViewerIpc } from '../src/renderer/features/file-viewer/ipc/main-handler';
import type { ReadFileResult } from '../src/renderer/features/file-viewer/types';

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'file-viewer-ipc-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function createReader(roots: string[]) {
  let handler: ((_event: unknown, filePath: string) => ReadFileResult) | null = null;
  const reads: Array<{ path: string; root: string; size: number }> = [];
  const rejects: Array<{ path?: string; reason: string }> = [];

  registerFileViewerIpc(
    {
      handle: (_channel, nextHandler) => {
        handler = nextHandler as typeof handler;
      },
    },
    {
      getAllowedRoots: () => roots,
      onRead: (event) => reads.push(event),
      onReject: (event) => rejects.push(event),
    }
  );

  if (!handler) {
    throw new Error('file-viewer handler was not registered');
  }

  return {
    read: (filePath: string) => handler?.({}, filePath) ?? { error: 'READ_FAILED' },
    reads,
    rejects,
  };
}

describe('file-viewer IPC read guard', () => {
  it('reads files under an allowed workspace root', () =>
    withTempDir((workspace) => {
      const filePath = join(workspace, 'report.txt');
      writeFileSync(filePath, 'allowed');

      const reader = createReader([workspace]);
      const result = reader.read(filePath);

      expect('buffer' in result ? Buffer.from(result.buffer, 'base64').toString('utf8') : '').toBe(
        'allowed'
      );
      expect(reader.reads).toHaveLength(1);
      expect(reader.rejects).toHaveLength(0);
    }));

  it('maps /workspace paths to an allowed workspace root', () =>
    withTempDir((workspace) => {
      mkdirSync(join(workspace, 'out'));
      writeFileSync(join(workspace, 'out', 'report.txt'), 'mapped');

      const result = createReader([workspace]).read('/workspace/out/report.txt');

      expect('buffer' in result ? Buffer.from(result.buffer, 'base64').toString('utf8') : '').toBe(
        'mapped'
      );
    }));

  it('rejects absolute files outside allowed roots', () =>
    withTempDir((dir) => {
      const workspace = join(dir, 'workspace');
      mkdirSync(workspace);
      const outsideFile = join(dir, 'secret.txt');
      writeFileSync(outsideFile, 'secret');

      const reader = createReader([workspace]);
      const result = reader.read(outsideFile);

      expect(result).toEqual({ error: 'OUTSIDE_WORKSPACE' });
      expect(reader.rejects.at(-1)?.reason).toBe('OUTSIDE_WORKSPACE');
    }));

  it('rejects relative traversal outside allowed roots', () =>
    withTempDir((dir) => {
      const workspace = join(dir, 'workspace');
      mkdirSync(workspace);
      writeFileSync(join(dir, 'secret.txt'), 'secret');

      const result = createReader([workspace]).read('../secret.txt');

      expect(result).toEqual({ error: 'OUTSIDE_WORKSPACE' });
    }));
});
