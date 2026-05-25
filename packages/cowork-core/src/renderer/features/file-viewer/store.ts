import { create } from 'zustand';

interface FileViewerState {
  path: string | null;
  cwd?: string;
  open: (path: string, cwd?: string) => void;
  close: () => void;
}

export const useFileViewerStore = create<FileViewerState>((set) => ({
  path: null,
  cwd: undefined,
  open: (path, cwd) => set({ path, cwd }),
  close: () => set({ path: null, cwd: undefined }),
}));

export function openFileInViewer(path: string, cwd?: string): void {
  useFileViewerStore.getState().open(path, cwd);
}
