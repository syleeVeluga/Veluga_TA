import { describe, expect, it } from 'vitest';
import { modelSupportsReasoning } from '../src/shared/thinking';

describe('thinking model support detection', () => {
  it('detects OpenAI reasoning model ids', () => {
    for (const modelId of [
      'gpt-5.5',
      'openai/gpt-5.5',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5.4-pro',
      'o3',
      'o4-mini',
    ]) {
      expect(modelSupportsReasoning(modelId), modelId).toBe(true);
    }
  });

  it('keeps non-reasoning model ids unsupported', () => {
    for (const modelId of ['gpt-4.1-mini', 'gpt-5-image', 'llama-4-scout']) {
      expect(modelSupportsReasoning(modelId), modelId).toBe(false);
    }
  });
});
