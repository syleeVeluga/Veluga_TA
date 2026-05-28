import { describe, expect, it, vi } from 'vitest';
import { RemoteGateway } from '../src/main/remote/gateway';
import type { GatewayConfig, RemoteMessage } from '../src/main/remote/types';
import type { MessageRouter } from '../src/main/remote/message-router';

const gatewayConfig: GatewayConfig = {
  enabled: true,
  port: 18789,
  bind: '127.0.0.1',
  auth: {
    mode: 'allowlist',
    allowlist: [],
  },
};

function createGateway() {
  const router = {
    onResponse: vi.fn(),
    getActiveSessionCount: vi.fn(() => 0),
    routeMessage: vi.fn(),
  } as unknown as MessageRouter;

  return new RemoteGateway(gatewayConfig, router, {
    discord: { policy: 'open' },
    slack: {
      policy: 'pairing',
      channels: {
        'guild-channel-1': { allowFrom: ['slack-guild-user'] },
      },
    },
  }) as unknown as {
    checkAuthorization(message: RemoteMessage): Promise<boolean>;
    restorePairedUser(user: {
      userId: string;
      channelType: 'discord' | 'slack' | 'websocket';
      pairedAt: number;
      lastActiveAt: number;
    }): void;
  };
}

function buildMessage(
  channelType: 'discord' | 'slack',
  userId: string,
  options: { channelId?: string; isGroup?: boolean } = {}
): RemoteMessage {
  return {
    id: `${channelType}-message`,
    channelType,
    channelId: options.channelId ?? `${channelType}-channel`,
    sender: {
      id: userId,
      isBot: false,
    },
    content: {
      type: 'text',
      text: 'hello',
    },
    timestamp: Date.now(),
    isGroup: options.isGroup ?? false,
    isMentioned: true,
  };
}

describe('RemoteGateway channel auth policies', () => {
  it('keeps Discord and Slack DM policies independent', async () => {
    const gateway = createGateway();

    await expect(gateway.checkAuthorization(buildMessage('discord', 'discord-user'))).resolves.toBe(
      true
    );
    await expect(gateway.checkAuthorization(buildMessage('slack', 'slack-user'))).resolves.toBe(
      false
    );
  });

  it('authorizes paired users only for the paired channel', async () => {
    const gateway = createGateway();

    gateway.restorePairedUser({
      userId: 'slack-user',
      channelType: 'slack',
      pairedAt: Date.now(),
      lastActiveAt: Date.now(),
    });

    await expect(gateway.checkAuthorization(buildMessage('slack', 'slack-user'))).resolves.toBe(
      true
    );
    await expect(gateway.checkAuthorization(buildMessage('slack', 'other-user'))).resolves.toBe(
      false
    );
  });

  it('honors per-channel allowFrom for guild messages', async () => {
    const gateway = createGateway();

    // Same user, but only authorized in the matching guild channel.
    await expect(
      gateway.checkAuthorization(
        buildMessage('slack', 'slack-guild-user', {
          channelId: 'guild-channel-1',
          isGroup: true,
        })
      )
    ).resolves.toBe(true);

    await expect(
      gateway.checkAuthorization(
        buildMessage('slack', 'slack-guild-user', {
          channelId: 'guild-channel-other',
          isGroup: true,
        })
      )
    ).resolves.toBe(false);
  });

  it('decodes parent:thread channel ids when checking per-channel allowFrom', async () => {
    const gateway = createGateway();

    await expect(
      gateway.checkAuthorization(
        buildMessage('slack', 'slack-guild-user', {
          channelId: 'guild-channel-1:thread-99',
          isGroup: true,
        })
      )
    ).resolves.toBe(true);
  });
});
