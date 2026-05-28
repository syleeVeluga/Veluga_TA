import { app } from 'electron';
import type { RemoteInteraction } from './remote-manager';

export type InteractionLocale = 'en' | 'ko' | 'zh';

const permissionKeywords = {
  allow: new Set(['allow', 'approve', 'yes', 'y', 'ok', '허용', '승인', '예', '네', '同意', '允许', '是']),
  deny: new Set(['deny', 'reject', 'no', 'n', '거부', '아니오', '아니요', '拒绝', '否']),
  always: new Set(['always', 'always allow', '항상 허용', '항상 승인', '总是允许', '始终允许']),
};

export function resolveInteractionLocale(locale?: string): InteractionLocale {
  const source = locale ?? safeGetAppLocale();
  const normalized = source?.toLowerCase() || '';
  if (normalized.startsWith('ko')) return 'ko';
  if (normalized.startsWith('zh')) return 'zh';
  return 'en';
}

function safeGetAppLocale(): string | undefined {
  try {
    return app.getLocale();
  } catch {
    return undefined;
  }
}

export function buildQuestionMessage(
  questions: NonNullable<RemoteInteraction['questions']>,
  locale: InteractionLocale = 'en'
): string {
  const lines: string[] = [text(locale, 'questionTitle'), ''];

  questions.forEach((question) => {
    if (question.header) {
      lines.push(`**${question.header}**`);
    }
    lines.push(question.question, '');

    if (question.options?.length) {
      question.options.forEach((option, index) => {
        lines.push(
          `  ${index + 1}. ${option.label}${option.description ? ` - ${option.description}` : ''}`
        );
      });
      lines.push('', question.multiSelect ? text(locale, 'multiSelectHint') : text(locale, 'singleSelectHint'), '');
    } else {
      lines.push(text(locale, 'freeTextHint'), '');
    }
  });

  lines.push('---', text(locale, 'skipHint'));
  return lines.join('\n');
}

export function buildPermissionMessage(
  toolName: string,
  input: Record<string, unknown>,
  locale: InteractionLocale = 'en'
): string {
  return [
    text(locale, 'permissionTitle'),
    '',
    `${text(locale, 'toolLabel')} **${toolName}**`,
    '',
    `${text(locale, 'inputLabel')}`,
    '```json',
    JSON.stringify(input, null, 2),
    '```',
    '',
    '---',
    text(locale, 'allowHint'),
    text(locale, 'denyHint'),
    text(locale, 'alwaysHint'),
  ].join('\n');
}

export function parsePermissionResponse(response: string): { allow: boolean; remember?: boolean } {
  const normalized = response.toLowerCase().trim();
  if (permissionKeywords.always.has(normalized)) {
    return { allow: true, remember: true };
  }
  if (permissionKeywords.allow.has(normalized)) {
    return { allow: true };
  }
  return { allow: false };
}

export function isSkipResponse(response: string): boolean {
  const normalized = response.toLowerCase().trim();
  return normalized === 'skip' || normalized === '건너뛰기' || normalized === '跳过';
}

function text(locale: InteractionLocale, key: keyof typeof catalog.en): string {
  return catalog[locale][key] || catalog.en[key];
}

const catalog = {
  en: {
    questionTitle: '**Input needed**',
    multiSelectHint: 'Reply with option numbers separated by commas, for example `1,3`.',
    singleSelectHint: 'Reply with an option number, for example `1`.',
    freeTextHint: 'Reply with your answer.',
    skipHint: 'Reply `skip` to skip this question.',
    permissionTitle: '**Permission needed**',
    toolLabel: 'Tool:',
    inputLabel: 'Input:',
    allowHint: 'Reply `allow` or `y` to approve.',
    denyHint: 'Reply `deny` or `n` to reject.',
    alwaysHint: 'Reply `always` to approve and remember.',
  },
  ko: {
    questionTitle: '**입력이 필요합니다**',
    multiSelectHint: '여러 옵션은 `1,3`처럼 쉼표로 구분해 답장하세요.',
    singleSelectHint: '`1`처럼 옵션 번호로 답장하세요.',
    freeTextHint: '답변을 직접 입력해 주세요.',
    skipHint: '`건너뛰기` 또는 `skip`으로 답장하면 이 질문을 건너뜁니다.',
    permissionTitle: '**승인이 필요합니다**',
    toolLabel: '도구:',
    inputLabel: '입력:',
    allowHint: '`허용` 또는 `y`로 답장하면 승인합니다.',
    denyHint: '`거부` 또는 `n`으로 답장하면 거절합니다.',
    alwaysHint: '`항상 허용` 또는 `always`로 답장하면 승인하고 기억합니다.',
  },
  zh: {
    questionTitle: '**需要输入**',
    multiSelectHint: '回复用逗号分隔的选项编号，例如 `1,3`。',
    singleSelectHint: '回复选项编号，例如 `1`。',
    freeTextHint: '请直接回复答案。',
    skipHint: '回复 `跳过` 或 `skip` 可跳过此问题。',
    permissionTitle: '**需要权限**',
    toolLabel: '工具:',
    inputLabel: '输入:',
    allowHint: '回复 `允许` 或 `y` 以批准。',
    denyHint: '回复 `拒绝` 或 `n` 以拒绝。',
    alwaysHint: '回复 `始终允许` 或 `always` 以批准并记住。',
  },
};
