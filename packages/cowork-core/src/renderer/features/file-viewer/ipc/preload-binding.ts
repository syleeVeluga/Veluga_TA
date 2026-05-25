import { ipcRenderer } from 'electron';
import type { ReadFileResult } from '../types';

export interface FileViewerBinding {
  read: (filePath: string) => Promise<ReadFileResult>;
}

export function createFileViewerBinding(): FileViewerBinding {
  return {
    read: (filePath: string) => ipcRenderer.invoke('file-viewer:read', filePath),
  };
}
