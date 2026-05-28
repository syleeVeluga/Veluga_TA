import { describe, expect, it } from 'vitest';

import { getFeatureFlags } from '../../main/config/feature-flags';

describe('getFeatureFlags', () => {
  it('keeps subscription login disabled by default', () => {
    expect(getFeatureFlags({}).subscriptionLogin).toEqual({
      enabled: false,
      chatgptPlusOAuth: false,
      claudeProCli: false,
    });
  });

  it('requires the master flag before provider-specific subscription flags are enabled', () => {
    expect(
      getFeatureFlags({
        VELUGA_SUBSCRIPTION_LOGIN_CHATGPT_PLUS_OAUTH: 'true',
        VELUGA_SUBSCRIPTION_LOGIN_CLAUDE_PRO_CLI: 'true',
      }).subscriptionLogin
    ).toEqual({
      enabled: false,
      chatgptPlusOAuth: false,
      claudeProCli: false,
    });
  });

  it('enables subscription login from the subscription build env', () => {
    expect(
      getFeatureFlags({
        VELUGA_SUBSCRIPTION_LOGIN_ENABLED: 'true',
        VELUGA_SUBSCRIPTION_LOGIN_CHATGPT_PLUS_OAUTH: '1',
        VELUGA_SUBSCRIPTION_LOGIN_CLAUDE_PRO_CLI: 'on',
      }).subscriptionLogin
    ).toEqual({
      enabled: true,
      chatgptPlusOAuth: true,
      claudeProCli: true,
    });
  });
});
