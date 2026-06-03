import { describe, expect, it } from 'vitest';
import { buildPiSessionRuntimeSignature } from '../src/main/claude/pi-session-runtime';

describe('pi session runtime signature', () => {
  const baseInput = {
    configProvider: 'custom',
    customProtocol: 'openai',
    modelProvider: 'openai',
    modelApi: 'openai-completions',
    modelBaseUrl: 'https://relay.example.com/v1',
    effectiveCwd: '/workspace/demo',
    apiKey: 'sk-demo-key',
  };

  it('changes when provider runtime changes even if the session id stays the same', () => {
    const original = buildPiSessionRuntimeSignature(baseInput);
    const changedProvider = buildPiSessionRuntimeSignature({
      ...baseInput,
      configProvider: 'openrouter',
    });

    expect(changedProvider).not.toBe(original);
  });

  it('changes when base url, api, key, or cwd changes', () => {
    const original = buildPiSessionRuntimeSignature(baseInput);

    expect(buildPiSessionRuntimeSignature({
      ...baseInput,
      modelBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    })).not.toBe(original);

    expect(buildPiSessionRuntimeSignature({
      ...baseInput,
      modelApi: 'openai-responses',
    })).not.toBe(original);

    expect(buildPiSessionRuntimeSignature({
      ...baseInput,
      apiKey: 'sk-another-key',
    })).not.toBe(original);

    expect(buildPiSessionRuntimeSignature({
      ...baseInput,
      effectiveCwd: '/workspace/other',
    })).not.toBe(original);
  });

  it('normalizes equivalent urls with trailing slashes', () => {
    const original = buildPiSessionRuntimeSignature(baseInput);
    const normalized = buildPiSessionRuntimeSignature({
      ...baseInput,
      modelBaseUrl: 'https://relay.example.com/v1/',
    });

    expect(normalized).toBe(original);
  });

  it('changes when deep agent execution mode changes', () => {
    const original = buildPiSessionRuntimeSignature({
      ...baseInput,
      executionMode: 'default',
      deepAgentEnabled: false,
    });
    const deepAgent = buildPiSessionRuntimeSignature({
      ...baseInput,
      executionMode: 'deep_agent',
      deepAgentEnabled: true,
    });

    expect(deepAgent).not.toBe(original);
  });

  it('changes when deep agent persona registry changes', () => {
    const original = buildPiSessionRuntimeSignature({
      ...baseInput,
      executionMode: 'deep_agent',
      deepAgentEnabled: true,
      deepAgentPersonaSignature: '[{"id":"reviewer","sourcePathHash":"a"}]',
    });
    const changed = buildPiSessionRuntimeSignature({
      ...baseInput,
      executionMode: 'deep_agent',
      deepAgentEnabled: true,
      deepAgentPersonaSignature: '[{"id":"reviewer","sourcePathHash":"b"}]',
    });

    expect(changed).not.toBe(original);
  });
});
