import { describe, expect, it } from 'vitest';
import {
  buildScheduledTaskFallbackTitle,
  buildScheduledTaskTitle,
  summarizeSchedulePrompt,
} from '../src/shared/schedule/task-title';

describe('scheduled task title', () => {
  it('always prefixes with [Scheduled Task]', () => {
    expect(buildScheduledTaskTitle('Organize today todos', 'en')).toBe(
      '[Scheduled Task] Organize today todos'
    );
  });

  it('normalizes whitespace and line breaks', () => {
    expect(buildScheduledTaskTitle('  First line\n\nSecond line   Third line  ', 'en')).toBe(
      '[Scheduled Task] First line Second line Third line'
    );
  });

  it('strips duplicated schedule prefixes', () => {
    expect(buildScheduledTaskTitle('[Scheduled Task] Daily summary', 'en')).toBe(
      '[Scheduled Task] Daily summary'
    );
  });

  it('strips legacy localized schedule prefixes', () => {
    const legacyPrefix = '[\u5b9a\u65f6\u4efb\u52a1]';
    expect(buildScheduledTaskTitle(`${legacyPrefix} Daily summary`, 'en')).toBe(
      '[Scheduled Task] Daily summary'
    );
  });

  it('uses Korean labels when requested', () => {
    expect(buildScheduledTaskTitle('[Scheduled Task] Daily summary', 'ko')).toBe(
      '[예약 작업] Daily summary'
    );
  });

  it('truncates very long prompt summary', () => {
    const longPrompt = 'a'.repeat(70);
    expect(summarizeSchedulePrompt(longPrompt)).toBe(`${'a'.repeat(45)}...`);
  });

  it('falls back for empty prompt', () => {
    expect(buildScheduledTaskTitle('   ', 'en')).toBe('[Scheduled Task] Untitled Task');
  });

  it('builds fallback title from prompt summary', () => {
    expect(buildScheduledTaskFallbackTitle('Find Agent papers from the last week', 'en')).toBe(
      '[Scheduled Task] Find Agent papers from the last week'
    );
  });
});
