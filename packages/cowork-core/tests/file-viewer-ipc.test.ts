import {
  closeSync,
  ftruncateSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  FILE_VIEWER_READ_LIMIT_BYTES,
  registerFileViewerIpc,
} from '../src/renderer/features/file-viewer/ipc/main-handler';
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
  const handlers = new Map<string, (_event: unknown, filePath: string) => unknown>();
  const reads: Array<{ path: string; root: string; size: number }> = [];
  const rejects: Array<{ path?: string; reason: string }> = [];

  registerFileViewerIpc(
    {
      handle: (channel, nextHandler) => {
        handlers.set(channel, nextHandler as (_event: unknown, filePath: string) => unknown);
      },
    },
    {
      getAllowedRoots: () => roots,
      onRead: (event) => reads.push(event),
      onReject: (event) => rejects.push(event),
    }
  );

  const readHandler = handlers.get('file-viewer:read');
  const grantHandler = handlers.get('file-viewer:grant-path');
  if (!readHandler || !grantHandler) {
    throw new Error('file-viewer handlers were not registered');
  }

  return {
    read: (filePath: string) => (readHandler({}, filePath) ?? { error: 'READ_FAILED' }) as ReadFileResult,
    grant: (filePath: string) => grantHandler({}, filePath) as { granted: boolean },
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

  it('returns NOT_FOUND for missing absolute files under an allowed root', () =>
    withTempDir((workspace) => {
      const result = createReader([workspace]).read(join(workspace, 'missing.txt'));

      expect(result).toEqual({ error: 'NOT_FOUND' });
    }));

  it('returns NOT_ABSOLUTE for empty paths', () =>
    withTempDir((workspace) => {
      const result = createReader([workspace]).read('');

      expect(result).toEqual({ error: 'NOT_ABSOLUTE' });
    }));

  it('falls back to basename lookup across allowed roots when relative path misses', () =>
    withTempDir((dir) => {
      // Session cwd (empty) + a separate default working dir where the file actually lives.
      // Simulates the AI emitting a bare filename in chat after writing to default_working_dir.
      const sessionCwd = join(dir, 'session');
      const defaultDir = join(dir, 'default');
      mkdirSync(sessionCwd);
      mkdirSync(defaultDir);
      writeFileSync(join(defaultDir, 'report.html'), '<p>ok</p>');

      // First root is sessionCwd → resolves "report.html" to sessionCwd/report.html (missing).
      // Fallback should locate it under defaultDir.
      const reader = createReader([sessionCwd, defaultDir]);
      const result = reader.read('report.html');

      expect('buffer' in result ? Buffer.from(result.buffer, 'base64').toString('utf8') : '').toBe(
        '<p>ok</p>'
      );
      expect(reader.rejects).toHaveLength(0);
    }));

  it('does not fall back by basename for missing relative paths with directories', () =>
    withTempDir((dir) => {
      const sessionCwd = join(dir, 'session');
      const defaultDir = join(dir, 'default');
      mkdirSync(sessionCwd);
      mkdirSync(defaultDir);
      writeFileSync(join(defaultDir, 'report.html'), '<p>wrong</p>');

      const reader = createReader([sessionCwd, defaultDir]);
      const result = reader.read('out/report.html');

      expect(result).toEqual({ error: 'NOT_FOUND' });
    }));

  it('does not fall back by basename for missing absolute paths', () =>
    withTempDir((dir) => {
      const workspace = join(dir, 'workspace');
      const defaultDir = join(dir, 'default');
      mkdirSync(workspace);
      mkdirSync(defaultDir);
      writeFileSync(join(defaultDir, 'report.html'), '<p>wrong</p>');

      const reader = createReader([workspace, defaultDir]);
      const result = reader.read(join(workspace, 'report.html'));

      expect(result).toEqual({ error: 'NOT_FOUND' });
    }));

  it('reads an out-of-workspace file after the user explicitly opens it', () =>
    withTempDir((dir) => {
      const workspace = join(dir, 'workspace');
      mkdirSync(workspace);
      const outsideFile = join(dir, 'outside', 'note.html');
      mkdirSync(join(dir, 'outside'));
      writeFileSync(outsideFile, '<p>opened</p>');

      const reader = createReader([workspace]);

      // Without a grant the same file is rejected…
      expect(reader.read(outsideFile)).toEqual({ error: 'OUTSIDE_WORKSPACE' });

      // …after an explicit open it becomes viewable.
      expect(reader.grant(outsideFile)).toEqual({ granted: true });
      const result = reader.read(outsideFile);
      expect('buffer' in result ? Buffer.from(result.buffer, 'base64').toString('utf8') : '').toBe(
        '<p>opened</p>'
      );
    }));

  it('grants the opened file directory so sibling assets render', () =>
    withTempDir((dir) => {
      const workspace = join(dir, 'workspace');
      mkdirSync(workspace);
      const outsideDir = join(dir, 'deck');
      mkdirSync(outsideDir);
      writeFileSync(join(outsideDir, 'slide.html'), '<style>@import "shared.css"</style>');
      writeFileSync(join(outsideDir, 'shared.css'), 'body{color:red}');

      const reader = createReader([workspace]);
      expect(reader.grant(join(outsideDir, 'slide.html'))).toEqual({ granted: true });

      // The sibling stylesheet (read during inlining) is now reachable too.
      const css = reader.read(join(outsideDir, 'shared.css'));
      expect('buffer' in css ? Buffer.from(css.buffer, 'base64').toString('utf8') : '').toBe(
        'body{color:red}'
      );
    }));

  it('does not grant access from a non-existent or relative path', () =>
    withTempDir((dir) => {
      const workspace = join(dir, 'workspace');
      mkdirSync(workspace);
      const reader = createReader([workspace]);

      expect(reader.grant(join(dir, 'missing', 'ghost.html'))).toEqual({ granted: false });
      expect(reader.grant('relative/note.html')).toEqual({ granted: false });
      expect(reader.grant('')).toEqual({ granted: false });
    }));

  it('returns TOO_LARGE before reading files over the limit', () =>
    withTempDir((workspace) => {
      const filePath = join(workspace, 'large.bin');
      const fd = openSync(filePath, 'w');
      try {
        ftruncateSync(fd, FILE_VIEWER_READ_LIMIT_BYTES + 1);
      } finally {
        closeSync(fd);
      }

      const result = createReader([workspace]).read(filePath);

      expect(result).toEqual({ error: 'TOO_LARGE', limit: FILE_VIEWER_READ_LIMIT_BYTES });
    }));
});
