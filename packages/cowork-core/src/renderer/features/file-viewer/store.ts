import { create } from 'zustand';

export const FILE_VIEWER_DEFAULT_WIDTH = 420;
export const FILE_VIEWER_MIN_WIDTH = 320;
export const FILE_VIEWER_MAX_WIDTH = 960;
const STORAGE_KEY = 'file-viewer:width';

export function clampViewerWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return FILE_VIEWER_DEFAULT_WIDTH;
  }
  return Math.max(FILE_VIEWER_MIN_WIDTH, Math.min(FILE_VIEWER_MAX_WIDTH, Math.round(value)));
}

function readStoredWidth(): number {
  if (typeof window === 'undefined') {
    return FILE_VIEWER_DEFAULT_WIDTH;
  }
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) {
      return FILE_VIEWER_DEFAULT_WIDTH;
    }
    return clampViewerWidth(Number(raw));
  } catch {
    return FILE_VIEWER_DEFAULT_WIDTH;
  }
}

function persistWidth(width: number): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage?.setItem(STORAGE_KEY, String(width));
  } catch {
    /* ignore quota / disabled storage */
  }
}

interface FileViewerState {
  path: string | null;
  cwd?: string;
  lastPath: string | null;
  lastCwd?: string;
  width: number;
  open: (path: string, cwd?: string) => void;
  close: () => void;
  toggle: () => void;
  setWidth: (width: number) => void;
}

export const useFileViewerStore = create<FileViewerState>((set, get) => ({
  path: null,
  cwd: undefined,
  lastPath: null,
  lastCwd: undefined,
  width: readStoredWidth(),
  open: (path, cwd) => set({ path, cwd, lastPath: path, lastCwd: cwd }),
  close: () => {
    const current = get();
    set({
      path: null,
      cwd: undefined,
      lastPath: current.path ?? current.lastPath,
      lastCwd: current.path ? current.cwd : current.lastCwd,
    });
  },
  toggle: () => {
    const { path, lastPath, lastCwd } = get();
    if (path !== null) {
      set({ path: null, cwd: undefined, lastPath: path });
      return;
    }
    if (lastPath !== null) {
      set({ path: lastPath, cwd: lastCwd });
    }
  },
  setWidth: (width) => {
    const clamped = clampViewerWidth(width);
    persistWidth(clamped);
    set({ width: clamped });
  },
}));

export function openFileInViewer(path: string, cwd?: string): void {
  useFileViewerStore.getState().open(path, cwd);
}
