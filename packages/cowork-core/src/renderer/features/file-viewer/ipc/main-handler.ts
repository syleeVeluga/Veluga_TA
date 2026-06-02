import type { IpcMain } from 'electron';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path';
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

function bareRelativeFileName(filePath: string): string | null {
  const normalizedPath = normalizeInputPath(filePath);
  if (
    !normalizedPath ||
    isAbsolute(normalizedPath) ||
    isWindowsDrivePath(normalizedPath) ||
    isUncPath(normalizedPath) ||
    /[/\\]/.test(normalizedPath)
  ) {
    return null;
  }
  return basename(normalizedPath);
}

function findFileByName(fileName: string, roots: string[]): string | null {
  if (!fileName) {
    return null;
  }
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const root of roots) {
    if (!root) continue;
    try {
      const resolvedRoot = resolve(root);
      if (fs.statSync(resolvedRoot).isDirectory()) {
        queue.push(resolvedRoot);
      }
    } catch {
      continue;
    }
  }

  let scannedDirs = 0;
  const MAX_DIRS = 2000;

  while (queue.length > 0 && scannedDirs < MAX_DIRS) {
    const dir = queue.shift()!;
    if (visited.has(dir)) {
      continue;
    }
    visited.add(dir);
    scannedDirs += 1;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isFile() && entry.name === fileName) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        queue.push(fullPath);
      }
    }
  }

  return null;
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
  // Directories the user explicitly opened in the viewer (realpath'd). Files the
  // user deliberately opens through the UI are viewable even when they live
  // outside the workspace roots — but a bare `file-viewer:read` for an
  // un-opened out-of-workspace path is still rejected, so this does not widen
  // what the agent can pull on its own. Session-scoped (cleared on restart).
  const grantedDirs = new Set<string>();

  ipcMain.handle('file-viewer:grant-path', (_event, filePath: string): { granted: boolean } => {
    if (!filePath || typeof filePath !== 'string') {
      return { granted: false };
    }
    try {
      const normalized = normalizeInputPath(filePath);
      if (!isAbsolute(normalized) && !isWindowsDrivePath(normalized) && !isUncPath(normalized)) {
        // Only explicit absolute opens grant access; relative paths stay scoped
        // to the workspace resolution rules.
        return { granted: false };
      }
      const resolved = isUncPath(normalized) ? normalized : resolve(normalized);
      if (!fs.existsSync(resolved)) {
        return { granted: false };
      }
      const real = realpath(resolved);
      const dir = fs.statSync(real).isDirectory() ? real : dirname(real);
      grantedDirs.add(dir);
      return { granted: true };
    } catch {
      return { granted: false };
    }
  });

  ipcMain.handle('file-viewer:read', (_event, filePath: string): ReadFileResult => {
    if (!filePath || typeof filePath !== 'string') {
      options.onReject?.({ reason: 'NOT_ABSOLUTE' });
      return { error: 'NOT_ABSOLUTE' };
    }

    // Authorized roots = workspace roots + directories the user explicitly opened.
    const authorizedRoots = [...getExistingAllowedRoots(options), ...grantedDirs];
    if (authorizedRoots.length === 0) {
      options.onReject?.({ path: filePath, reason: 'OUTSIDE_WORKSPACE' });
      return { error: 'OUTSIDE_WORKSPACE' };
    }

    const candidates = authorizedRoots
      .map((root) => ({ root, path: resolveCandidatePath(filePath, root) }))
      .filter((candidate): candidate is { root: string; path: string } => Boolean(candidate.path));
    if (candidates.length === 0) {
      options.onReject?.({ path: filePath, reason: 'NOT_ABSOLUTE' });
      return { error: 'NOT_ABSOLUTE' };
    }

    try {
      let existingCandidate = candidates.find((candidate) => fs.existsSync(candidate.path));
      if (!existingCandidate) {
        // Fallback: the AI may have emitted a bare filename relative to the wrong cwd.
        const fileName = bareRelativeFileName(filePath);
        const discovered = fileName ? findFileByName(fileName, authorizedRoots) : null;
        if (discovered) {
          existingCandidate = { root: authorizedRoots[0], path: discovered };
        } else {
          options.onReject?.({ path: candidates[0].path, reason: 'NOT_FOUND' });
          return { error: 'NOT_FOUND' };
        }
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

      const allowedRoot = authorizedRoots.find((root) => isWithinRoot(realFilePath, root));
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
