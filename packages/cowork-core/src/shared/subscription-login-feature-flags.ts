export interface SubscriptionLoginFeatureFlags {
  enabled: boolean;
  chatgpt_plus_oauth: boolean;
  claude_pro_cli: boolean;
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function readEnv(name: string): string | undefined {
  if (typeof process !== 'undefined') {
    return process.env?.[name];
  }
  return undefined;
}

function readViteEnv(name: string): string | undefined {
  return (import.meta.env?.[name] as string | undefined) || undefined;
}

function envFlag(names: string[]): boolean {
  return names.some((name) =>
    TRUE_VALUES.has((readEnv(name) || readViteEnv(name) || '').trim().toLowerCase())
  );
}

const enabled = envFlag(['VELUGA_SUBSCRIPTION_LOGIN_ENABLED', 'VITE_SUBSCRIPTION_LOGIN']);

export const subscriptionLoginFeatureFlags: SubscriptionLoginFeatureFlags = {
  enabled,
  chatgpt_plus_oauth:
    enabled &&
    envFlag([
      'VELUGA_SUBSCRIPTION_LOGIN_CHATGPT_PLUS_OAUTH',
      'VITE_SUBSCRIPTION_LOGIN_CHATGPT_PLUS_OAUTH',
    ]),
  claude_pro_cli:
    enabled &&
    envFlag(['VELUGA_SUBSCRIPTION_LOGIN_CLAUDE_PRO_CLI', 'VITE_SUBSCRIPTION_LOGIN_CLAUDE_PRO_CLI']),
};
