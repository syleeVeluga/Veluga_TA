/**
 * Shared types for RemoteControlPanel sub-components.
 */

export type RemoteChannelType = 'discord' | 'slack' | 'websocket';
export type DmPolicy = 'open' | 'pairing' | 'allowlist';

export interface GatewayStatus {
  running: boolean;
  port?: number;
  publicUrl?: string;
  channels: Array<{ type: string; connected: boolean; error?: string }>;
  activeSessions: number;
  pendingPairings: number;
}

export interface PairedUser {
  userId: string;
  userName?: string;
  channelType: RemoteChannelType;
  pairedAt: number;
  lastActiveAt: number;
}

export interface PairingRequest {
  code: string;
  channelType: RemoteChannelType;
  userId: string;
  userName?: string;
  createdAt: number;
  expiresAt: number;
}

export interface RemoteConfig {
  gateway: {
    enabled: boolean;
    port: number;
    bind: string;
    defaultWorkingDirectory?: string;
    autoApproveSafeTools?: boolean;
    tunnel?: {
      enabled: boolean;
      type: 'ngrok' | 'cloudflare' | 'frp';
      ngrok?: {
        authToken: string;
        region?: string;
      };
    };
    auth: {
      mode: string;
      token?: string;
      requirePairing?: boolean;
    };
  };
  channels: {
    discord?: {
      botToken: string;
      applicationId?: string;
      dm: {
        policy: DmPolicy;
      };
    };
    slack?: {
      botToken: string;
      appToken?: string;
      signingSecret?: string;
      useSocketMode?: boolean;
      dm: {
        policy: DmPolicy;
      };
    };
  };
}

export interface TunnelStatus {
  connected: boolean;
  url: string | null;
  provider: string;
  error?: string;
}

export type ConfigStep = 'discord' | 'slack' | 'advanced';

export type LocalizedBanner = { key?: string; text?: string | null };
