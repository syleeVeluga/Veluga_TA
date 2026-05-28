export interface SubscriptionLoginFeatureFlags {
  enabled: boolean;
  chatgptPlusOAuth: boolean;
  claudeProCli: boolean;
}

export interface FeatureFlags {
  subscriptionLogin: SubscriptionLoginFeatureFlags;
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function envFlag(env: NodeJS.ProcessEnv, names: string[]): boolean {
  return names.some((name) => TRUE_VALUES.has((env[name] ?? '').trim().toLowerCase()));
}

export function getFeatureFlags(env: NodeJS.ProcessEnv = process.env): FeatureFlags {
  const subscriptionLoginEnabled = envFlag(env, [
    'VELUGA_SUBSCRIPTION_LOGIN_ENABLED',
    'VITE_SUBSCRIPTION_LOGIN',
  ]);

  return {
    subscriptionLogin: {
      enabled: subscriptionLoginEnabled,
      chatgptPlusOAuth:
        subscriptionLoginEnabled &&
        envFlag(env, [
          'VELUGA_SUBSCRIPTION_LOGIN_CHATGPT_PLUS_OAUTH',
          'VITE_SUBSCRIPTION_LOGIN_CHATGPT_PLUS_OAUTH',
        ]),
      claudeProCli:
        subscriptionLoginEnabled &&
        envFlag(env, [
          'VELUGA_SUBSCRIPTION_LOGIN_CLAUDE_PRO_CLI',
          'VITE_SUBSCRIPTION_LOGIN_CLAUDE_PRO_CLI',
        ]),
    },
  };
}
