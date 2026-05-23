import type { PolicyContext } from '../../shared-types/src/index.js';
import { handleSystemSelfHelp } from '../../../skills/core/system-self-help/handler.js';
import { IntentRouter } from './agents/intent-router.js';

export async function handleUserMessage(
  message: string,
  policy: PolicyContext,
  fallback: (message: string) => Promise<string> | string
): Promise<string> {
  if (!policy.veluga.enable_veluga_orchestration) {
    return fallback(message);
  }
  const router = new IntentRouter();
  const intent = await router.classify(message, policy);
  if (intent.fast_path_hit === 'greeting') return '안녕하세요. 무엇을 도와드릴까요? [parametric:high]';
  if (intent.fast_path_hit === 'thanks') return '도움이 됐다면 다행입니다. [parametric:high]';
  if (intent.fast_path_hit === 'ack') return '확인했습니다. [parametric:high]';
  if (intent.fast_path_hit === 'self_help') return handleSystemSelfHelp({ policyContext: policy });
  return fallback(message);
}
