import { describe, expect, it } from 'vitest';

import {
  resolveMessageEndPayload,
  toUserFacingErrorText,
} from '../src/main/claude/agent-runner-message-end';

describe('resolveMessageEndPayload', () => {
  it('falls back to accumulated streamed text when message_end content is empty', () => {
    const result = resolveMessageEndPayload({
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'stop',
      },
      streamedText: 'streamed fallback',
    });

    expect(result.nextStreamedText).toBe('');
    expect(result.errorText).toBeUndefined();
    expect(result.shouldEmitMessage).toBe(true);
    expect(result.effectiveContent).toEqual([{ type: 'text', text: 'streamed fallback' }]);
  });

  it('surfaces user-facing error text when message_end stops with error', () => {
    const result = resolveMessageEndPayload({
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'first_response_timeout',
      },
      streamedText: 'partial text',
      language: 'en',
    });

    expect(result.nextStreamedText).toBe('');
    expect(result.shouldEmitMessage).toBe(false);
    expect(result.effectiveContent).toEqual([]);
    expect(result.errorText).toBe(
      'Model response timed out. No upstream response was received for a long time. Try again later or check the current model/gateway load.'
    );
  });

  it('surfaces empty_success_result when message_end has no content and no streamed fallback', () => {
    const result = resolveMessageEndPayload({
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'stop',
      },
      streamedText: '',
      language: 'en',
    });

    expect(result.nextStreamedText).toBe('');
    expect(result.shouldEmitMessage).toBe(false);
    expect(result.effectiveContent).toEqual([]);
    expect(result.errorText).toBe(
      'The model returned an empty successful result. The current model or gateway may have a compatibility issue. Try again or switch protocol.'
    );
  });
});

describe('toUserFacingErrorText', () => {
  it('maps 400 / bad request to configuration hint', () => {
    const result = toUserFacingErrorText('HTTP 400: bad request - ROLE_UNSPECIFIED', 'en');
    expect(result).toContain('The upstream rejected the request (400)');
    expect(result).toContain('Original error:');
    expect(result).toContain('ROLE_UNSPECIFIED');
  });

  it('maps invalid request to configuration hint', () => {
    const result = toUserFacingErrorText('invalid request: unsupported parameter "store"', 'en');
    expect(result).toContain('The upstream rejected the request (400)');
    expect(result).toContain('Original error:');
  });

  it('maps 401 to authentication hint', () => {
    const result = toUserFacingErrorText('Error 401: Unauthorized', 'en');
    expect(result).toContain('Authentication failed');
    expect(result).toContain('API key');
    expect(result).toContain('Original error:');
  });

  it('maps 429 / rate limit to throttle hint', () => {
    const result = toUserFacingErrorText('429 Too Many Requests - rate limit exceeded', 'en');
    expect(result).toContain('rate limited (429)');
    expect(result).toContain('Original error:');
  });

  it('passes through unknown errors unchanged', () => {
    const raw = 'some obscure upstream error';
    expect(toUserFacingErrorText(raw)).toBe(raw);
  });

  it('still maps first_response_timeout correctly (regression)', () => {
    expect(toUserFacingErrorText('first_response_timeout', 'en')).toBe(
      'Model response timed out. No upstream response was received for a long time. Try again later or check the current model/gateway load.'
    );
  });

  it('maps errors in Korean when requested', () => {
    const result = toUserFacingErrorText('HTTP 400: bad request - ROLE_UNSPECIFIED', 'ko');
    expect(result).toContain('upstream이 요청을 거부했습니다(400)');
    expect(result).toContain('원본 오류:');
    expect(result).toContain('ROLE_UNSPECIFIED');
  });

  it('maps 5xx server errors to upstream service hint', () => {
    const result = toUserFacingErrorText('HTTP 502: Bad Gateway', 'en');
    expect(result).toContain('upstream service returned an error');
    expect(result).toContain('Original error:');
    expect(result).toContain('502');
  });

  it('maps "server error" to upstream service hint', () => {
    const result = toUserFacingErrorText('internal server error', 'en');
    expect(result).toContain('upstream service returned an error');
  });

  it('maps "overloaded" to upstream service hint', () => {
    const result = toUserFacingErrorText('overloaded_error', 'en');
    expect(result).toContain('upstream service returned an error');
  });

  it('maps "terminated" to network connection hint', () => {
    const result = toUserFacingErrorText('terminated', 'en');
    expect(result).toContain('Network connection interrupted');
    expect(result).toContain('terminated');
  });

  it('maps "connection error" to network connection hint', () => {
    const result = toUserFacingErrorText('connection error: ECONNRESET', 'en');
    expect(result).toContain('Network connection interrupted');
  });

  it('maps "fetch failed" to network connection hint', () => {
    const result = toUserFacingErrorText('fetch failed', 'en');
    expect(result).toContain('Network connection interrupted');
  });

  it('maps "other side closed" to network connection hint', () => {
    const result = toUserFacingErrorText('other side closed', 'en');
    expect(result).toContain('Network connection interrupted');
  });
});
