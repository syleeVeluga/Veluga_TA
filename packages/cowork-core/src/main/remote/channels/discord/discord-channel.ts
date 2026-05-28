/**
 * Discord Channel
 * Handles Discord bot message receive and send flows.
 */

import { ChannelBase, withRetry } from '../channel-base';
import { log, logError, logWarn } from '../../../utils/logger';
import type {
  DiscordChannelConfig,
  RemoteMessage,
  RemoteResponse,
  RemoteResponseContent,
} from '../../types';

type DiscordClient = import('discord.js').Client;
type DiscordMessage = import('discord.js').Message;
type SendableDiscordChannel = import('discord.js').TextChannel | import('discord.js').DMChannel;

export class DiscordChannel extends ChannelBase {
  readonly type = 'discord' as const;

  private config: DiscordChannelConfig;
  private client?: DiscordClient;
  private botUserId?: string;

  constructor(config: DiscordChannelConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    if (this._connected) {
      logWarn('[Discord] Channel already started');
      return;
    }

    this.logStatus('Starting channel...');

    try {
      const { Client, GatewayIntentBits, Partials } = await import('discord.js');

      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.MessageContent,
        ],
        partials: [Partials.Channel],
      });

      this.client.on('messageCreate', (message) => {
        this.handleMessage(message).catch((error) => {
          logError('[Discord] Error processing message:', error);
        });
      });

      const readyPromise = new Promise<void>((resolve) => {
        this.client!.once('ready', () => resolve());
      });
      await this.client.login(this.config.botToken);
      await readyPromise;
      this.botUserId = this.client.user?.id;
      log('[Discord] Bot user ID:', this.botUserId);

      this._connected = true;
      this.logStatus('Channel started successfully');
    } catch (error) {
      logError('[Discord] Failed to start channel:', error);
      this._connected = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this._connected) return;

    this.logStatus('Stopping channel...');

    this.client?.destroy();
    this.client = undefined;
    this.botUserId = undefined;
    this._connected = false;
    this.logStatus('Channel stopped');
  }

  async send(response: RemoteResponse): Promise<void> {
    if (!this._connected || !this.client) {
      throw new Error('Channel not connected');
    }

    await withRetry(
      async () => {
        await this.sendMessage(response.channelId, response.content);
      },
      {
        maxRetries: 3,
        delayMs: 1000,
        onRetry: (attempt, error) => {
          logWarn(`[Discord] Send retry ${attempt}:`, error.message);
        },
      }
    );
  }

  private async handleMessage(message: DiscordMessage): Promise<void> {
    if (!this.client) return;
    if (message.author.bot) return;

    const isDm = message.channel.isDMBased();
    const isMentioned = this.botUserId ? message.mentions.users.has(this.botUserId) : false;
    const cleanText = this.stripMention(message.content);

    if (!isDm && !this.shouldHandleGuildMessage(message, isMentioned)) {
      return;
    }

    const channelId =
      'isThread' in message.channel && message.channel.isThread() && message.channel.parentId
        ? `${message.channel.parentId}:${message.channel.id}`
        : message.channelId;

    const remoteMessage: RemoteMessage = {
      id: message.id,
      channelType: 'discord',
      channelId,
      sender: {
        id: message.author.id,
        name: message.author.username,
        avatar: message.author.displayAvatarURL(),
        isBot: false,
      },
      content: {
        type: 'text',
        text: cleanText,
      },
      timestamp: message.createdTimestamp,
      isGroup: !isDm,
      isMentioned,
      raw: message,
    };

    this.emitMessage(remoteMessage);
  }

  private shouldHandleGuildMessage(message: DiscordMessage, isMentioned: boolean): boolean {
    const channelSettings = this.config.channels?.[message.channelId];
    const requireMention = channelSettings?.requireMention ?? true;
    if (requireMention && !isMentioned) return false;

    const allowFrom = channelSettings?.allowFrom;
    if (allowFrom?.length && !allowFrom.includes(message.author.id)) return false;

    return true;
  }

  private stripMention(text: string): string {
    if (!this.botUserId) return text.trim();
    return text.replace(new RegExp(`<@!?${this.botUserId}>\\s*`, 'g'), '').trim();
  }

  private async sendMessage(channelId: string, content: RemoteResponseContent): Promise<void> {
    if (!this.client) throw new Error('Client not initialized');

    const [rawChannelId, threadId] = channelId.split(':');
    const channel = await this.client.channels.fetch(threadId || rawChannelId);
    if (!channel?.isTextBased()) {
      throw new Error(`Discord channel is not text based: ${rawChannelId}`);
    }

    const text = this.contentToText(content);
    const chunks = this.splitMessage(text, 1900);
    if (!('send' in channel)) {
      throw new Error(`Discord channel cannot send messages: ${rawChannelId}`);
    }

    const textChannel = channel as SendableDiscordChannel;

    for (const chunk of chunks) {
      await textChannel.send(chunk);

      if (chunks.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }

  private contentToText(content: RemoteResponseContent): string {
    switch (content.type) {
      case 'text':
        return content.text || '';
      case 'markdown':
        return content.markdown || '';
      default:
        return content.text || String(content);
    }
  }
}
