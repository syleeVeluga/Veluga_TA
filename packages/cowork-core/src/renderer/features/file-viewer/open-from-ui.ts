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

  // The user explicitly opened this file, so grant the viewer read access to it
  // (and its directory, for rendering relative assets) even if it lives outside
  // the workspace roots. Awaited so the grant is registered before the viewer's
  // read fires. Best-effort: in-workspace files work regardless.
  try {
    await window.electronAPI?.fileViewer?.grant?.(filePath);
  } catch {
    /* fall through — workspace files still resolve without an explicit grant */
  }

  openFileInViewer(filePath, cwd);
}
