import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const settingsMemoryPath = path.resolve(
  process.cwd(),
  'src/renderer/components/settings/SettingsMemory.tsx'
);

describe('SettingsMemory layout', () => {
  it('keeps memory search controls inside the settings content width', () => {
    const source = fs.readFileSync(settingsMemoryPath, 'utf8');

    expect(source).toContain(
      'grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(144px,160px)_minmax(0,1fr)_auto]'
    );
    expect(source.match(/className="min-w-0 rounded-lg border border-border bg-background/g))
      .toHaveLength(3);
    expect(source).not.toContain('flex flex-col gap-3 sm:flex-row');
  });
});
