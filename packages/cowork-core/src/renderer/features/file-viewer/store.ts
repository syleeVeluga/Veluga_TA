import { create } from 'zustand';

interface FileViewerState {
  path: string | null;
  open: (path: string) => void;
  close: () => void;
}

export const useFileViewerStore = create<FileViewerState>((set) => ({
  path: null,
  open: (path) => set({ path }),
  close: () => set({ path: null }),
}));

export function openFileInViewer(path: string): void {
  useFileViewerStore.getState().open(path);
}
