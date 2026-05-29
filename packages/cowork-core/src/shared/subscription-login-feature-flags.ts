export interface SubscriptionLoginFeatureFlags {
  enabled: boolean;
  chatgpt_plus_oauth: boolean;
  claude_pro_cli: boolean;
}

export const subscriptionLoginFeatureFlags: SubscriptionLoginFeatureFlags = {
  enabled: false,
  chatgpt_plus_oauth: false,
  claude_pro_cli: false,
};
