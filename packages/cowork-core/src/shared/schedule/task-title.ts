export type ScheduleTitleLanguage = 'ko' | 'en';

const SCHEDULE_TITLE_TEXT: Record<ScheduleTitleLanguage, { prefix: string; fallback: string }> = {
  ko: {
    prefix: '[예약 작업]',
    fallback: '제목 없는 작업',
  },
  en: {
    prefix: '[Scheduled Task]',
    fallback: 'Untitled Task',
  },
};
const DEFAULT_SUMMARY_MAX_LENGTH = 48;
const PREFIX_PATTERN =
  /^\s*(?:\[Scheduled Task\]|\[\uc608\uc57d \uc791\uc5c5\]|\[\u5b9a\u65f6\u4efb\u52a1\])\s*/;

function normalizeLanguage(language: ScheduleTitleLanguage | undefined): ScheduleTitleLanguage {
  return language === 'en' ? 'en' : 'ko';
}

function normalizeTitlePart(value: string): string {
  return value
    .trim()
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function stripSchedulePrefix(value: string): string {
  return value.replace(PREFIX_PATTERN, '').trim();
}

export function summarizeSchedulePrompt(
  prompt: string,
  maxLength: number = DEFAULT_SUMMARY_MAX_LENGTH,
  language?: ScheduleTitleLanguage
): string {
  const normalizedPrompt = normalizeTitlePart(prompt);
  if (!normalizedPrompt) {
    return SCHEDULE_TITLE_TEXT[normalizeLanguage(language)].fallback;
  }
  if (!Number.isFinite(maxLength) || maxLength <= 0) {
    return normalizedPrompt;
  }
  if (normalizedPrompt.length <= maxLength) {
    return normalizedPrompt;
  }
  return `${normalizedPrompt.slice(0, Math.max(1, maxLength - 3))}...`;
}

export function buildScheduledTaskTitle(
  titleOrSummary: string,
  language?: ScheduleTitleLanguage
): string {
  const text = SCHEDULE_TITLE_TEXT[normalizeLanguage(language)];
  const normalized = normalizeTitlePart(stripSchedulePrefix(titleOrSummary));
  const summary = normalized || text.fallback;
  return `${text.prefix} ${summary}`;
}

export function buildScheduledTaskFallbackTitle(
  prompt: string,
  language?: ScheduleTitleLanguage
): string {
  return buildScheduledTaskTitle(
    summarizeSchedulePrompt(prompt, DEFAULT_SUMMARY_MAX_LENGTH, language),
    language
  );
}
