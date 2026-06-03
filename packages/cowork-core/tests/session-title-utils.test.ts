import { describe, it, expect } from 'vitest';
import {
  buildTitlePrompt,
  normalizeGeneratedTitle,
  shouldGenerateTitle,
} from '../src/main/session/session-title-utils';

describe('session title utils', () => {
  it('generates title only for first user message and default title', () => {
    expect(
      shouldGenerateTitle({
        userMessageCount: 1,
        currentTitle: 'Hello world',
        prompt: 'Hello world',
        hasAttempted: false,
      })
    ).toBe(true);

    expect(
      shouldGenerateTitle({
        userMessageCount: 2,
        currentTitle: 'Hello world',
        prompt: 'Hello world',
        hasAttempted: false,
      })
    ).toBe(false);
  });

  it('skips when title was manually changed', () => {
    expect(
      shouldGenerateTitle({
        userMessageCount: 1,
        currentTitle: 'Custom title',
        prompt: 'Hello world',
        hasAttempted: false,
      })
    ).toBe(false);
  });

  it('skips when already attempted', () => {
    expect(
      shouldGenerateTitle({
        userMessageCount: 1,
        currentTitle: 'Hello world',
        prompt: 'Hello world',
        hasAttempted: true,
      })
    ).toBe(false);
  });

  it('builds a bilingual prompt requiring <=15 chars and same language', () => {
    const prompt = buildTitlePrompt('PPT 하나 만들어줘');
    expect(prompt).toContain('15');
    expect(prompt).toContain('동일한 언어');
    expect(prompt).toContain('same language');
  });

  it('normalizes generated title by taking first line and stripping quotes', () => {
    const title = normalizeGeneratedTitle('"   나의 제목   "\n두 번째 줄');
    expect(title).toBe('나의 제목');
  });

  it('drops synthetic empty placeholder titles', () => {
    expect(normalizeGeneratedTitle('(no content)')).toBeNull();
    expect(normalizeGeneratedTitle('(empty content)')).toBeNull();
  });
});
