export { DEFAULT_SESSION_TITLE, getDefaultTitleFromPrompt } from '../../shared/session-title';
import { DEFAULT_SESSION_TITLE, getDefaultTitleFromPrompt } from '../../shared/session-title';

export type TitleDecisionInput = {
  userMessageCount: number;
  currentTitle: string;
  prompt: string;
  hasAttempted: boolean;
};

export function shouldGenerateTitle(input: TitleDecisionInput): boolean {
  if (input.hasAttempted) return false;
  if (input.userMessageCount !== 1) return false;
  const defaultTitle = getDefaultTitleFromPrompt(input.prompt);
  return input.currentTitle === defaultTitle || input.currentTitle === DEFAULT_SESSION_TITLE;
}

export function normalizeGeneratedTitle(value: string | null | undefined): string | null {
  if (!value) return null;
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;
  const normalized = firstLine.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!normalized) return null;
  if (
    normalized.toLowerCase() === '(no content)' ||
    normalized.toLowerCase() === '(empty content)'
  ) {
    return null;
  }
  return normalized.slice(0, 120);
}

export function buildTitlePrompt(prompt: string): string {
  return [
    'Generate a short title for the following user request. Rules:',
    '- Max 15 characters (Korean) or 6 words (English)',
    '- Reply in the same language as the user request',
    '- No quotes, numbering, or punctuation at the end',
    '',
    '사용자 요청에 대한 짧은 대화 제목을 생성하세요:',
    '- 15자를 넘지 않도록',
    '- 동일한 언어로 출력',
    '- 따옴표나 번호를 붙이지 말 것',
    '',
    `User request / 사용자 요청: ${prompt.trim()}`,
  ].join('\n');
}
