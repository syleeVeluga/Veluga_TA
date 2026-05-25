import type { IpcMain } from 'electron';
import { basename, extname, isAbsolute, relative, resolve } from 'path';
import * as fs from 'fs';
import {
  decodePathSafely,
  isUncPath,
  isWindowsDrivePath,
  localPathFromFileUrl,
} from '../../../../shared/local-file-path';
import { resolvePathAgainstWorkspace } from '../../../../shared/workspace-path';
import type { ReadFileResult } from '../types';

export const FILE_VIEWER_READ_LIMIT_BYTES = 50 * 1024 * 1024;

interface FileViewerIpcOptions {
  getAllowedRoots: () => Array<string | null | undefined>;
  onRead?: (event: { path: string; root: string; size: number }) => void;
  onReject?: (event: { path?: string; reason: string }) => void;
}

function normalizeInputPath(filePath: string): string {
  const decoded = decodePathSafely(filePath.trim());
  if (!decoded.startsWith('file://')) {
    return decoded;
  }
  return localPathFromFileUrl(decoded) ?? decoded;
}

function realpath(pathValue: string): string {
  return fs.realpathSync.native(pathValue);
}

function resolveCandidatePath(filePath: string, workspaceRoot: string): string | null {
  const normalizedPath = resolvePathAgainstWorkspace(normalizeInputPath(filePath), workspaceRoot);
  if (
    !isAbsolute(normalizedPath) &&
    !isWindowsDrivePath(normalizedPath) &&
    !isUncPath(normalizedPath)
  ) {
    return null;
  }
  return isUncPath(normalizedPath) ? normalizedPath : resolve(normalizedPath);
}

function isWithinRoot(pathValue: string, root: string): boolean {
  const relativePath = relative(root, pathValue);
  return (
    relativePath === '' ||
    (!!relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath))
  );
}

function getExistingAllowedRoots(options: FileViewerIpcOptions): string[] {
  const roots = options
    .getAllowedRoots()
    .filter((root): root is string => Boolean(root))
    .map((root) => resolve(root));

  const uniqueRoots: string[] = [];
  for (const root of roots) {
    try {
      if (!fs.statSync(root).isDirectory()) {
        continue;
      }
      const realRoot = realpath(root);
      if (!uniqueRoots.includes(realRoot)) {
        uniqueRoots.push(realRoot);
      }
    } catch {
      continue;
    }
  }
  return uniqueRoots;
}

export function registerFileViewerIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  options: FileViewerIpcOptions
): void {
  ipcMain.handle('file-viewer:read', (_event, filePath: string): ReadFileResult => {
    if (!filePath || typeof filePath !== 'string') {
      options.onReject?.({ reason: 'NOT_ABSOLUTE' });
      return { error: 'NOT_ABSOLUTE' };
    }

    const allowedRoots = getExistingAllowedRoots(options);
    if (allowedRoots.length === 0) {
      options.onReject?.({ path: filePath, reason: 'OUTSIDE_WORKSPACE' });
      return { error: 'OUTSIDE_WORKSPACE' };
    }

    const candidates = allowedRoots
      .map((root) => ({ root, path: resolveCandidatePath(filePath, root) }))
      .filter((candidate): candidate is { root: string; path: string } => Boolean(candidate.path));
    if (candidates.length === 0) {
      options.onReject?.({ path: filePath, reason: 'NOT_ABSOLUTE' });
      return { error: 'NOT_ABSOLUTE' };
    }

    try {
      const existingCandidate = candidates.find((candidate) => fs.existsSync(candidate.path));
      if (!existingCandidate) {
        options.onReject?.({ path: candidates[0].path, reason: 'NOT_FOUND' });
        return { error: 'NOT_FOUND' };
      }

      if (!fs.statSync(existingCandidate.path).isFile()) {
        options.onReject?.({ path: existingCandidate.path, reason: 'READ_FAILED' });
        return { error: 'READ_FAILED' };
      }

      const realFilePath = realpath(existingCandidate.path);
      const stat = fs.statSync(realFilePath);
      if (!stat.isFile()) {
        options.onReject?.({ path: realFilePath, reason: 'READ_FAILED' });
        return { error: 'READ_FAILED' };
      }

      const allowedRoot = allowedRoots.find((root) => isWithinRoot(realFilePath, root));
      if (!allowedRoot) {
        options.onReject?.({ path: existingCandidate.path, reason: 'OUTSIDE_WORKSPACE' });
        return { error: 'OUTSIDE_WORKSPACE' };
      }

      if (stat.size > FILE_VIEWER_READ_LIMIT_BYTES) {
        options.onReject?.({ path: realFilePath, reason: 'TOO_LARGE' });
        return { error: 'TOO_LARGE', limit: FILE_VIEWER_READ_LIMIT_BYTES };
      }

      options.onRead?.({ path: realFilePath, root: allowedRoot, size: stat.size });
      return {
        buffer: fs.readFileSync(realFilePath).toString('base64'),
        ext: extname(realFilePath).toLowerCase(),
        name: basename(realFilePath),
        size: stat.size,
      };
    } catch {
      options.onReject?.({ path: filePath, reason: 'READ_FAILED' });
      return { error: 'READ_FAILED' };
    }
  });
}
