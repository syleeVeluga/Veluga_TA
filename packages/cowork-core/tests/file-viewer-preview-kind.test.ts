import { describe, expect, it } from 'vitest';
import {
  OS_ONLY_EXTS,
  previewKindForFile,
} from '../src/renderer/features/file-viewer/preview-kind';

describe('previewKindForFile', () => {
  it.each([
    ['README.md', 'markdown'],
    ['src/App.tsx', 'code'],
    ['diagram.PNG?raw=1', 'image'],
    ['report.pdf', 'pdf'],
    ['index.html', 'html'],
    ['data.tsv', 'csv'],
    ['proposal.docx', 'docx'],
    ['budget.xlsx', 'xlsx'],
    ['notes.txt', 'text'],
    ['archive.zip', 'unsupported'],
  ] as const)('classifies %s as %s', (filePath, kind) => {
    expect(previewKindForFile(filePath)).toBe(kind);
  });

  it('keeps OS-only extensions out of the previewable set', () => {
    expect(OS_ONLY_EXTS.has('.pptx')).toBe(true);
    expect(previewKindForFile('slides.pptx')).toBe('unsupported');
  });
});
