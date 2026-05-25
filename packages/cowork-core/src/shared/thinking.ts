export type SharedThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export const THINKING_LEVELS: SharedThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

export const REASONING_MODEL_PATTERN =
  /\bthinking\b|\breasoner\b|deepseek-r1|deepseek-v4|kimi-k2|qwen3(?:\.5)?(?=[:/-]|$)|(?:^|\/)(?:gpt-5(?:\.\d+)?(?:-(?:mini|nano|pro|codex[\w.-]*))?|o[13][\w.-]*|o4-mini[\w.-]*)(?=$|[:@])/i;

export function isThinkingLevel(value: unknown): value is SharedThinkingLevel {
  return typeof value === 'string' && THINKING_LEVELS.includes(value as SharedThinkingLevel);
}

export function deriveThinkingLevel(input: {
  thinkingLevel?: unknown;
  enableThinking?: unknown;
}): SharedThinkingLevel {
  if (isThinkingLevel(input.thinkingLevel)) {
    return input.thinkingLevel;
  }
  return input.enableThinking === true ? 'medium' : 'off';
}

export function modelSupportsReasoning(modelId: string | undefined): boolean {
  const id = modelId?.trim() || '';
  if (!id) {
    return false;
  }
  return REASONING_MODEL_PATTERN.test(id) || /(?:^|\/)claude-(?:opus|sonnet|haiku)-4-\d+/i.test(id);
}
