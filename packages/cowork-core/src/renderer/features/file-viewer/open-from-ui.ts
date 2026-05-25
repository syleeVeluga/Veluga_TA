import { OS_ONLY_EXTS } from './preview-kind';
import { openFileInViewer } from './store';

function extname(filePath: string): string {
  const normalized = filePath.split(/[?#]/, 1)[0]?.replace(/\\/g, '/') ?? '';
  const name = normalized.slice(normalized.lastIndexOf('/') + 1);
  const dotIndex = name.lastIndexOf('.');
  return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : '';
}

export async function openFileFromUI(filePath: string, cwd?: string): Promise<void> {
  if (OS_ONLY_EXTS.has(extname(filePath)) && typeof window !== 'undefined') {
    await window.electronAPI?.showItemInFolder(filePath, cwd);
    return;
  }

  openFileInViewer(filePath);
}
