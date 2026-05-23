import type { AssistantMessage, TextContent, ThinkingContent, ToolCall } from '@mariozechner/pi-ai';
import { splitThinkTagBlocks } from './think-tag-parser';
import type { AppLanguage } from '../config/config-store';

type MessageEndContentBlock = TextContent | ThinkingContent | ToolCall;

type MessageEndMessage = Pick<AssistantMessage, 'role' | 'content' | 'stopReason' | 'errorMessage'>;

interface ResolveMessageEndPayloadOptions {
  message?: MessageEndMessage;
  streamedText: string;
  language?: AppLanguage;
}

interface ResolvedMessageEndPayload {
  effectiveContent: MessageEndContentBlock[];
  errorText?: string;
  nextStreamedText: string;
  shouldEmitMessage: boolean;
}

const ERROR_TEXT = {
  en: {
    timeout:
      'Model response timed out. No upstream response was received for a long time. Try again later or check the current model/gateway load.',
    empty:
      'The model returned an empty successful result. The current model or gateway may have a compatibility issue. Try again or switch protocol.',
    badRequest:
      'The upstream rejected the request (400), likely due to incompatible model or protocol settings. Check the model name, protocol settings, and API endpoint.',
    auth:
      'Authentication failed. Check whether the API key is correct, expired, or lacks access to the current model.',
    rateLimit:
      'The request was rate limited (429). The current model or API endpoint has reached its request limit. Try again later.',
    server:
      'The upstream service returned an error, likely due to overload or a temporary failure. The SDK will retry automatically.',
    network:
      'Network connection interrupted. The proxy or gateway may be unstable. The SDK will retry automatically.',
    originalError: 'Original error',
    checkConfig: '_Check the configuration and try again._',
    retrying: '_Agent is retrying automatically. Please wait..._',
  },
  ko: {
    timeout:
      '모델 응답 시간이 초과되었습니다. 오랫동안 upstream 응답을 받지 못했습니다. 잠시 후 다시 시도하거나 현재 모델/게이트웨이 부하를 확인하세요.',
    empty:
      '모델이 빈 성공 결과를 반환했습니다. 현재 모델 또는 게이트웨이 호환성에 문제가 있을 수 있습니다. 다시 시도하거나 프로토콜을 바꿔 보세요.',
    badRequest:
      'upstream이 요청을 거부했습니다(400). 모델 또는 프로토콜 설정이 호환되지 않을 수 있습니다. 모델 이름, 프로토콜 설정, API endpoint를 확인하세요.',
    auth:
      '인증에 실패했습니다. API key가 올바른지, 만료되었는지, 현재 모델 접근 권한이 있는지 확인하세요.',
    rateLimit:
      '요청이 rate limit에 걸렸습니다(429). 현재 모델 또는 API endpoint의 호출 한도에 도달했습니다. 잠시 후 다시 시도하세요.',
    server:
      'upstream 서비스 오류가 발생했습니다. 모델 서비스 과부하 또는 일시적 장애일 수 있으며 SDK가 자동으로 재시도합니다.',
    network:
      '네트워크 연결이 중단되었습니다. 프록시 또는 게이트웨이가 불안정할 수 있으며 SDK가 자동으로 재시도합니다.',
    originalError: '원본 오류',
    checkConfig: '_설정을 확인한 뒤 다시 시도하세요._',
    retrying: '_Agent가 자동으로 재시도 중입니다. 잠시 기다려 주세요..._',
  },
} satisfies Record<AppLanguage, Record<string, string>>;

function normalizeLanguage(language: AppLanguage | undefined): AppLanguage {
  return language === 'en' ? 'en' : 'ko';
}

function withOriginalError(message: string, errorText: string, language: AppLanguage): string {
  return `${message}\n${ERROR_TEXT[language].originalError}: ${errorText}`;
}

export function getAgentErrorFollowupText(errorText: string, language?: AppLanguage): string {
  const normalizedLanguage = normalizeLanguage(language);
  return /\b4\d{2}\b/.test(errorText)
    ? ERROR_TEXT[normalizedLanguage].checkConfig
    : ERROR_TEXT[normalizedLanguage].retrying;
}

export function toUserFacingErrorText(errorText: string, language?: AppLanguage): string {
  const normalizedLanguage = normalizeLanguage(language);
  const text = ERROR_TEXT[normalizedLanguage];
  const lower = errorText.toLowerCase();
  if (lower.includes('first_response_timeout')) {
    return text.timeout;
  }
  if (lower.includes('empty_success_result')) {
    return text.empty;
  }
  if (
    /\b400\b/.test(errorText) ||
    lower.includes('bad request') ||
    lower.includes('invalid request')
  ) {
    return withOriginalError(text.badRequest, errorText, normalizedLanguage);
  }
  if (
    /\b(401|403)\b/.test(errorText) ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden')
  ) {
    return withOriginalError(text.auth, errorText, normalizedLanguage);
  }
  if (
    /\b429\b/.test(errorText) ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return withOriginalError(text.rateLimit, errorText, normalizedLanguage);
  }
  if (
    /\b(5\d{2})\b/.test(errorText) ||
    lower.includes('server error') ||
    lower.includes('internal error') ||
    lower.includes('service unavailable') ||
    lower.includes('overloaded')
  ) {
    return withOriginalError(text.server, errorText, normalizedLanguage);
  }
  if (
    lower.includes('terminated') ||
    lower.includes('connection reset') ||
    lower.includes('connection closed') ||
    lower.includes('connection refused') ||
    lower.includes('connection error') ||
    lower.includes('fetch failed') ||
    lower.includes('other side closed') ||
    lower.includes('reset before headers') ||
    lower.includes('upstream connect') ||
    lower.includes('retry delay')
  ) {
    return `${text.network} (${errorText})`;
  }
  return errorText;
}

export function resolveMessageEndPayload(
  options: ResolveMessageEndPayloadOptions
): ResolvedMessageEndPayload {
  const { message, streamedText, language } = options;
  const nextStreamedText = '';

  if (message?.stopReason === 'error' && message.errorMessage) {
    return {
      effectiveContent: [],
      errorText: toUserFacingErrorText(message.errorMessage, language),
      nextStreamedText,
      shouldEmitMessage: false,
    };
  }

  const rawContent =
    Array.isArray(message?.content) && message.content.length > 0
      ? message.content
      : streamedText
        ? [{ type: 'text' as const, text: streamedText }]
        : [];

  if (rawContent.length === 0) {
    return {
      effectiveContent: [],
      errorText: toUserFacingErrorText('empty_success_result', language),
      nextStreamedText,
      shouldEmitMessage: false,
    };
  }

  // Post-process: split any <think>...</think> tags in text blocks into
  // separate thinking + text content blocks for proper UI rendering.
  const effectiveContent: MessageEndContentBlock[] = [];
  for (const block of rawContent) {
    if (block.type === 'text') {
      const splitBlocks = splitThinkTagBlocks(block.text);
      for (const splitBlock of splitBlocks) {
        if (splitBlock.type === 'thinking') {
          effectiveContent.push({
            type: 'thinking',
            thinking: splitBlock.thinking,
          } as ThinkingContent);
        } else {
          effectiveContent.push({ type: 'text', text: splitBlock.text } as TextContent);
        }
      }
    } else {
      effectiveContent.push(block);
    }
  }

  return {
    effectiveContent,
    nextStreamedText,
    shouldEmitMessage: effectiveContent.length > 0 && (message?.role === 'assistant' || !message),
  };
}
