import { ipcRenderer } from 'electron';
import type { ReadFileResult } from '../types';

export interface FileViewerBinding {
  read: (filePath: string) => Promise<ReadFileResult>;
  grant: (filePath: string) => Promise<{ granted: boolean }>;
}

export function createFileViewerBinding(): FileViewerBinding {
  return {
    read: (filePath: string) => ipcRenderer.invoke('file-viewer:read', filePath),
    grant: (filePath: string) => ipcRenderer.invoke('file-viewer:grant-path', filePath),
  };
}
