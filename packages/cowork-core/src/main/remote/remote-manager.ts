/**
 * Remote Manager
 * Coordinates the gateway, messenger channels, and message router.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { log, logError, logWarn } from '../utils/logger';
import { RemoteGateway } from './gateway';
import { MessageRouter } from './message-router';
import { DiscordChannel } from './channels/discord';
import { SlackChannel } from './channels/slack';
import { remoteConfigStore } from './remote-config-store';
import { tunnelManager, TunnelStatus } from './tunnel-manager';
import { buildRemoteSessionTitle } from './remote-title';
import {
  buildPermissionMessage,
  buildQuestionMessage,
  isSkipResponse,
  parsePermissionResponse,
  resolveInteractionLocale,
} from './interaction-messages';
import type {
  GatewayStatus,
  GatewayConfig,
  DiscordChannelConfig,
  SlackChannelConfig,
  ChannelType,
  RemoteSessionMapping,
  PairedUser,
  PairingRequest,
  RemoteConfig,
  DmPolicy,
} from './types';
import type { Message, ContentBlock, ServerEvent, Session } from '../../renderer/types/index';

export interface AgentExecutor {
  startSession(title: string, prompt: string, cwd?: string): Promise<Session>;
  continueSession(
    sessionId: string,
    prompt: string,
    content?: ContentBlock[],
    cwd?: string
  ): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
  validateWorkingDirectory?(cwd: string): Promise<string | null> | string | null;
}

export interface RemoteInteraction {
  type: 'question' | 'permission';
  sessionId: string;
  remoteSessionId: string;
  ownerSenderId: string;
  questionId?: string;
  toolUseId?: string;
  toolName?: string;
  questions?: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
  input?: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
}

type ChannelInfo = { channelType: ChannelType; channelId: string };

export class RemoteManager extends EventEmitter {
  private gateway?: RemoteGateway;
  private messageRouter: MessageRouter;
  private agentExecutor?: AgentExecutor;
  private sendToRenderer?: (event: ServerEvent) => void;

  private remoteSessionIds: Set<string> = new Set();
  private sessionIdMapping: Map<string, string> = new Map();
  private reverseSessionIdMapping: Map<string, string> = new Map();
  private sessionChannelMapping: Map<string, ChannelInfo> = new Map();
  private sessionOwnerMapping: Map<string, string> = new Map();
  private pendingInteractions: Map<string, RemoteInteraction> = new Map();
  private interactionResolvers: Map<string, (response: string) => void> = new Map();
  private responseBuffers: Map<string, { texts: string[]; lastSent: number; toolSteps: string[] }> =
    new Map();
  private sentMessageHashes: Map<string, Set<string>> = new Map();
  private sendTimers: Map<string, NodeJS.Timeout> = new Map();
  private lockChain: Promise<void> = Promise.resolve();
  private defaultWorkingDirectory?: string;

  constructor() {
    super();
    this.messageRouter = new MessageRouter();
    this.messageRouter.onResponse(async (response) => {
      await this.gateway?.sendResponse(response);
    });
  }

  setAgentExecutor(executor: AgentExecutor): void {
    this.agentExecutor = executor;

    this.messageRouter.setAgentCallback(
      async (
        sessionId,
        prompt,
        content,
        workingDirectory,
        channelType,
        channelId,
        senderId,
        onMessage,
        onPartial
      ) => {
        await this.executeAgent(
          sessionId,
          prompt,
          content,
          workingDirectory,
          channelType as ChannelType,
          channelId,
          senderId,
          onMessage,
          onPartial
        );
      }
    );

    if (executor.validateWorkingDirectory) {
      this.messageRouter.setWorkingDirectoryValidator(executor.validateWorkingDirectory);
    }

    log('[RemoteManager] Agent executor set');
  }

  setDefaultWorkingDirectory(dir?: string): void {
    this.defaultWorkingDirectory = dir;
    this.messageRouter.setDefaultWorkingDirectory(dir);
    log('[RemoteManager] Default working directory set:', dir || '(none)');
  }

  setRendererCallback(callback: (event: ServerEvent) => void): void {
    this.sendToRenderer = callback;
  }

  async start(): Promise<void> {
    const config = remoteConfigStore.getAll();

    if (!config.gateway.enabled) {
      log('[RemoteManager] Remote control is disabled');
      return;
    }

    log('[RemoteManager] Starting remote control system...');

    try {
      this.gateway = new RemoteGateway(
        config.gateway,
        this.messageRouter,
        this.buildChannelAuthPolicies(config)
      );

      const configuredDefaultWorkingDir =
        config.gateway.defaultWorkingDirectory || this.defaultWorkingDirectory;
      if (configuredDefaultWorkingDir) {
        this.setDefaultWorkingDirectory(configuredDefaultWorkingDir);
      }

      this.setupGatewayEvents();
      this.gateway.setMessageInterceptor((message) =>
        this.handlePotentialInteractionResponse(
          message.channelType,
          message.channelId,
          message.sender.id,
          message.content.text || ''
        )
      );

      await this.registerChannels(config);
      this.loadPairedUsers();
      await this.gateway.start();

      const tunnelUrl = await tunnelManager.start(config.gateway.port);
      if (tunnelUrl) {
        log('[RemoteManager] Tunnel URL:', tunnelUrl);
        for (const channelType of this.getConfiguredWebhookChannels(config)) {
          log(
            `[RemoteManager] ${channelType} Webhook URL:`,
            `${tunnelUrl}/webhook/${channelType}`
          );
        }
      }

      log('[RemoteManager] Remote control system started');
      this.emitStatusUpdate();
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'EADDRINUSE') {
        logWarn(
          '[RemoteManager] Remote control port already in use, skipping startup for this instance'
        );
        await this.gateway?.stop();
        this.gateway = undefined;
        this.emitStatusUpdate();
        return;
      }

      logError('[RemoteManager] Failed to start remote control:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.gateway) return;

    log('[RemoteManager] Stopping remote control system...');

    for (const timer of this.sendTimers.values()) {
      clearTimeout(timer);
    }
    this.sendTimers.clear();

    await tunnelManager.stop();

    try {
      await this.gateway.stop();
      this.gateway = undefined;
      log('[RemoteManager] Remote control system stopped');
      this.emitStatusUpdate();
    } catch (error) {
      logError('[RemoteManager] Error stopping remote control:', error);
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  getStatus(): GatewayStatus & { tunnel?: TunnelStatus } {
    if (!this.gateway) {
      return {
        running: false,
        channels: [],
        activeSessions: 0,
        pendingPairings: 0,
      };
    }

    return {
      ...this.gateway.getStatus(),
      tunnel: tunnelManager.getStatus(),
    };
  }

  getTunnelStatus(): TunnelStatus {
    return tunnelManager.getStatus();
  }

  getWebhookUrl(channelType: ChannelType): string | null {
    return tunnelManager.getWebhookUrl(channelType);
  }

  async updateGatewayConfig(config: Partial<GatewayConfig>): Promise<void> {
    remoteConfigStore.setGatewayConfig(config);
    if (this.gateway?.running) {
      await this.restart();
    }
  }

  async updateDiscordConfig(config: DiscordChannelConfig): Promise<void> {
    remoteConfigStore.setDiscordConfig(config);
    if (this.gateway?.running) {
      await this.restart();
    }
  }

  async updateSlackConfig(config: SlackChannelConfig): Promise<void> {
    remoteConfigStore.setSlackConfig(config);
    if (this.gateway?.running) {
      await this.restart();
    }
  }

  approvePairing(channelType: ChannelType, userId: string): boolean {
    if (!this.gateway) return false;
    const success = this.gateway.approvePairing(channelType, userId);

    if (success) {
      remoteConfigStore.addPairedUser({
        userId,
        channelType,
        pairedAt: Date.now(),
        lastActiveAt: Date.now(),
      });
      this.emitStatusUpdate();
    }

    return success;
  }

  rejectPairing(channelType: ChannelType, userId: string): boolean {
    if (!this.gateway) return false;
    const success = this.gateway.rejectPairing(channelType, userId);
    if (success) {
      this.emitStatusUpdate();
    }
    return success;
  }

  revokePairing(channelType: ChannelType, userId: string): boolean {
    if (!this.gateway) return false;
    const success = this.gateway.revokePairing(channelType, userId);
    if (success) {
      remoteConfigStore.removePairedUser(channelType, userId);
      this.emitStatusUpdate();
    }
    return success;
  }

  getPairedUsers(): PairedUser[] {
    return remoteConfigStore.getPairedUsers();
  }

  getPendingPairings(): PairingRequest[] {
    return this.gateway?.getPendingPairings() || [];
  }

  getRemoteSessions(): RemoteSessionMapping[] {
    return this.messageRouter.getAllSessionMappings();
  }

  clearRemoteSession(sessionId: string): boolean {
    return this.messageRouter.clearSession(sessionId);
  }

  isRemoteSession(actualSessionId: string): boolean {
    return this.sessionIdMapping.has(actualSessionId);
  }

  getRemoteSessionId(actualSessionId: string): string | undefined {
    return this.sessionIdMapping.get(actualSessionId);
  }

  async handleQuestionRequest(
    actualSessionId: string,
    questionId: string,
    questions: NonNullable<RemoteInteraction['questions']>
  ): Promise<string | null> {
    const remoteSessionId = this.sessionIdMapping.get(actualSessionId);
    if (!remoteSessionId) return null;

    const channelInfo = this.sessionChannelMapping.get(remoteSessionId);
    if (!channelInfo || !this.gateway) return null;

    const interaction: RemoteInteraction = {
      type: 'question',
      sessionId: actualSessionId,
      remoteSessionId,
      ownerSenderId: this.sessionOwnerMapping.get(remoteSessionId) || '',
      questionId,
      questions,
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000,
    };

    await this.withInteractionLock(async () => {
      this.pendingInteractions.set(questionId, interaction);
    });

    try {
      await this.gateway.sendResponse({
        channelType: channelInfo.channelType,
        channelId: channelInfo.channelId,
        content: {
          type: 'markdown',
          markdown: buildQuestionMessage(questions, resolveInteractionLocale()),
        },
      });
    } catch (err) {
      logError('[RemoteManager] Failed to send question to channel:', err);
      await this.withInteractionLock(async () => {
        this.pendingInteractions.delete(questionId);
      });
      return null;
    }

    return new Promise((resolve) => {
      this.interactionResolvers.set(questionId, (response) => {
        resolve(this.parseQuestionResponse(response, questions));
      });
      this.scheduleInteractionTimeout(questionId, () => resolve('{}'), 'Question');
    });
  }

  async handlePermissionRequest(
    actualSessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<{ allow: boolean; remember?: boolean } | null> {
    const remoteSessionId = this.sessionIdMapping.get(actualSessionId);
    if (!remoteSessionId) return null;

    const channelInfo = this.sessionChannelMapping.get(remoteSessionId);
    if (!channelInfo || !this.gateway) return null;

    const config = remoteConfigStore.getAll();
    if (config.gateway.autoApproveSafeTools && this.isSafeTool(toolName)) {
      log('[RemoteManager] Auto-approving safe tool:', toolName);
      await this.doSendToChannel(channelInfo, `Auto-approved: **${toolName}**`);
      return { allow: true };
    }

    const interaction: RemoteInteraction = {
      type: 'permission',
      sessionId: actualSessionId,
      remoteSessionId,
      ownerSenderId: this.sessionOwnerMapping.get(remoteSessionId) || '',
      toolUseId,
      toolName,
      input,
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000,
    };

    await this.withInteractionLock(async () => {
      this.pendingInteractions.set(toolUseId, interaction);
    });

    try {
      await this.gateway.sendResponse({
        channelType: channelInfo.channelType,
        channelId: channelInfo.channelId,
        content: {
          type: 'markdown',
          markdown: buildPermissionMessage(toolName, input, resolveInteractionLocale()),
        },
      });
    } catch (err) {
      logError('[RemoteManager] Failed to send permission request to channel:', err);
      await this.withInteractionLock(async () => {
        this.pendingInteractions.delete(toolUseId);
      });
      return null;
    }

    return new Promise((resolve) => {
      this.interactionResolvers.set(toolUseId, (response) => {
        resolve(parsePermissionResponse(response));
      });
      this.scheduleInteractionTimeout(toolUseId, () => resolve({ allow: false }), 'Permission');
    });
  }

  async handlePotentialInteractionResponse(
    channelType: ChannelType,
    channelId: string,
    senderId: string,
    messageText: string
  ): Promise<boolean> {
    return this.withInteractionLock(async () => {
      for (const [id, interaction] of this.pendingInteractions) {
        const channelInfo = this.sessionChannelMapping.get(interaction.remoteSessionId);
        if (!channelInfo) continue;

        if (channelInfo.channelType !== channelType || channelInfo.channelId !== channelId) {
          continue;
        }

        if (!interaction.ownerSenderId || senderId !== interaction.ownerSenderId) {
          log('[RemoteManager] Ignoring interaction response from non-owner sender:', senderId);
          continue;
        }

        this.pendingInteractions.delete(id);
        const resolver = this.interactionResolvers.get(id);
        if (resolver) {
          resolver(messageText);
          this.interactionResolvers.delete(id);
        }
        return true;
      }

      return false;
    });
  }

  getPendingInteractionsCount(): number {
    return this.pendingInteractions.size;
  }

  async sendResponseToChannel(
    actualSessionId: string,
    text: string,
    immediate: boolean = false
  ): Promise<void> {
    const remoteSessionId = this.sessionIdMapping.get(actualSessionId);
    if (!remoteSessionId) {
      log('[RemoteManager] Not a remote session, skipping channel response:', actualSessionId);
      return;
    }

    const channelInfo = this.sessionChannelMapping.get(remoteSessionId);
    if (!channelInfo || !this.gateway) {
      logError('[RemoteManager] No channel info for remote session:', remoteSessionId);
      return;
    }

    const hash = this.hashText(text);
    if (!this.sentMessageHashes.has(actualSessionId)) {
      this.sentMessageHashes.set(actualSessionId, new Set());
    }
    const sentHashes = this.sentMessageHashes.get(actualSessionId)!;
    if (sentHashes.has(hash)) {
      log('[RemoteManager] Skipping duplicate message');
      return;
    }
    if (sentHashes.size >= 500) {
      sentHashes.clear();
    }
    sentHashes.add(hash);

    if (immediate) {
      await this.doSendToChannel(channelInfo, text);
      return;
    }

    if (!this.responseBuffers.has(actualSessionId)) {
      this.responseBuffers.set(actualSessionId, { texts: [], lastSent: 0, toolSteps: [] });
    }
    const buffer = this.responseBuffers.get(actualSessionId)!;
    buffer.texts.push(text);

    const existingTimer = this.sendTimers.get(actualSessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.flushResponseBuffer(actualSessionId).catch((err) => {
        logError('[RemoteManager] Failed to flush buffer:', err);
      });
    }, 2000);
    this.sendTimers.set(actualSessionId, timer);
  }

  async sendToolProgress(
    actualSessionId: string,
    toolName: string,
    status: 'running' | 'completed' | 'error',
    output?: string
  ): Promise<void> {
    const remoteSessionId = this.sessionIdMapping.get(actualSessionId);
    if (!remoteSessionId) return;

    const channelInfo = this.sessionChannelMapping.get(remoteSessionId);
    if (!channelInfo || !this.gateway) return;

    const notifyTools = ['Bash', 'Write', 'Edit', 'WebSearch', 'WebFetch', 'mcp__Chrome__'];
    if (!notifyTools.some((tool) => toolName.includes(tool))) return;

    let statusText = `**${toolName}** ${status}`;
    if (output && status !== 'running') {
      statusText += output.length < 200 ? `\n\`\`\`\n${output}\n\`\`\`` : `: ${output.slice(0, 100)}`;
    }

    if (status === 'running') {
      if (!this.responseBuffers.has(actualSessionId)) {
        this.responseBuffers.set(actualSessionId, { texts: [], lastSent: 0, toolSteps: [] });
      }
      this.responseBuffers.get(actualSessionId)!.toolSteps.push(statusText);
      return;
    }

    if (status === 'completed' && toolName.includes('mcp__Chrome__')) {
      await this.doSendToChannel(channelInfo, statusText);
    }
  }

  async clearSessionBuffer(actualSessionId: string): Promise<void> {
    await this.flushResponseBuffer(actualSessionId);
    this.responseBuffers.delete(actualSessionId);
    this.sentMessageHashes.delete(actualSessionId);

    const timer = this.sendTimers.get(actualSessionId);
    if (timer) {
      clearTimeout(timer);
      this.sendTimers.delete(actualSessionId);
    }

    const remoteSessionId = this.sessionIdMapping.get(actualSessionId);
    this.sessionIdMapping.delete(actualSessionId);
    if (remoteSessionId) {
      for (const [key, value] of this.reverseSessionIdMapping) {
        if (value === actualSessionId) {
          this.reverseSessionIdMapping.delete(key);
          break;
        }
      }
      this.sessionChannelMapping.delete(remoteSessionId);
      this.sessionOwnerMapping.delete(remoteSessionId);
    }
  }

  private setupGatewayEvents(): void {
    if (!this.gateway) return;

    this.gateway.on('event', (event) => {
      this.emit('event', event);
    });

    this.gateway.on('gateway.pairing_request', (data) => {
      log('[RemoteManager] New pairing request:', data);
      this.emitToRenderer({
        type: 'remote.pairing_request',
        payload: data,
      } as unknown as ServerEvent);
    });

    this.gateway.on('gateway.started', () => {
      this.emitStatusUpdate();
    });

    this.gateway.on('gateway.stopped', () => {
      this.emitStatusUpdate();
    });
  }

  private async registerChannels(config: RemoteConfig): Promise<void> {
    if (!this.gateway) return;

    const discordConfig = config.channels.discord;
    if (discordConfig?.botToken) {
      const discordChannel = new DiscordChannel(discordConfig);
      this.gateway.registerChannel(discordChannel);
      log('[RemoteManager] Discord channel registered');
    }

    const slackConfig = config.channels.slack;
    if (slackConfig?.botToken) {
      const slackChannel = new SlackChannel(slackConfig);
      this.gateway.registerChannel(slackChannel);

      this.gateway.on(
        'webhook:slack',
        (data: {
          headers: Record<string, string>;
          body: string;
          respond: (status: number, responseData: unknown) => void;
        }) => {
          const result = slackChannel.handleWebhook(data.headers, data.body);
          data.respond(result.status, result.data);
        }
      );

      log('[RemoteManager] Slack channel registered');
    }
  }

  private loadPairedUsers(): void {
    if (!this.gateway) return;

    for (const user of remoteConfigStore.getPairedUsers()) {
      this.gateway.restorePairedUser(user);
      log('[RemoteManager] Loaded paired user:', user.userId);
    }
  }

  private async executeAgent(
    sessionId: string,
    prompt: string,
    content: ContentBlock[],
    workingDirectory: string | undefined,
    channelType: ChannelType,
    channelId: string,
    senderId: string,
    _onMessage: (message: Message) => void,
    _onPartial: (delta: string) => void
  ): Promise<void> {
    if (!this.agentExecutor) {
      throw new Error('Agent executor not set');
    }

    log('[RemoteManager] Executing agent for session:', sessionId);
    log('[RemoteManager] Working directory:', workingDirectory || '(default)');

    const isNewSession = !this.remoteSessionIds.has(sessionId);
    if (isNewSession) {
      const newSession = await this.agentExecutor.startSession(
        buildRemoteSessionTitle(prompt),
        prompt,
        workingDirectory
      );

      this.remoteSessionIds.add(sessionId);
      this.sessionIdMapping.set(newSession.id, sessionId);
      this.reverseSessionIdMapping.set(sessionId, newSession.id);
      this.sessionChannelMapping.set(sessionId, { channelType, channelId });
      this.sessionOwnerMapping.set(sessionId, senderId);

      this.emitToRenderer({
        type: 'session.update',
        payload: { sessionId: newSession.id, updates: newSession },
      });
      this.emitRemoteUserMessage(newSession.id, content, prompt);
      return;
    }

    const actualSessionId = this.reverseSessionIdMapping.get(sessionId);
    if (!actualSessionId) {
      throw new Error(`No actual session ID found for remote session: ${sessionId}`);
    }
    this.emitRemoteUserMessage(actualSessionId, content, prompt);
    await this.agentExecutor.continueSession(actualSessionId, prompt, content, workingDirectory);
  }

  private getConfiguredWebhookChannels(config: RemoteConfig): ChannelType[] {
    const channels: ChannelType[] = [];
    if (config.channels.slack?.botToken && !config.channels.slack.useSocketMode) {
      channels.push('slack');
    }
    return channels;
  }

  private buildChannelAuthPolicies(
    config: RemoteConfig
  ): Partial<
    Record<
      ChannelType,
      {
        policy: DmPolicy;
        allowFrom?: string[];
        channels?: Record<string, { allowFrom?: string[] }>;
      }
    >
  > {
    const policies: Partial<
      Record<
        ChannelType,
        {
          policy: DmPolicy;
          allowFrom?: string[];
          channels?: Record<string, { allowFrom?: string[] }>;
        }
      >
    > = {};

    if (config.channels.discord?.dm) {
      policies.discord = {
        ...config.channels.discord.dm,
        channels: config.channels.discord.channels,
      };
    }
    if (config.channels.slack?.dm) {
      policies.slack = {
        ...config.channels.slack.dm,
        channels: config.channels.slack.channels,
      };
    }
    return policies;
  }

  private async flushResponseBuffer(actualSessionId: string): Promise<void> {
    const buffer = this.responseBuffers.get(actualSessionId);
    if (!buffer || buffer.texts.length === 0) return;

    const remoteSessionId = this.sessionIdMapping.get(actualSessionId);
    if (!remoteSessionId) return;

    const channelInfo = this.sessionChannelMapping.get(remoteSessionId);
    if (!channelInfo || !this.gateway) return;

    const combinedText = buffer.texts.join('\n\n');
    buffer.texts = [];
    buffer.lastSent = Date.now();

    const timer = this.sendTimers.get(actualSessionId);
    if (timer) {
      clearTimeout(timer);
      this.sendTimers.delete(actualSessionId);
    }

    await this.doSendToChannel(channelInfo, combinedText);
  }

  private async doSendToChannel(channelInfo: ChannelInfo, text: string): Promise<void> {
    try {
      await this.gateway!.sendResponse({
        channelType: channelInfo.channelType,
        channelId: channelInfo.channelId,
        content: {
          type: 'markdown',
          markdown: text,
        },
      });
    } catch (err) {
      logError('[RemoteManager] Failed to send to channel:', err);
    }
  }

  private async withInteractionLock<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const acquired = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.lockChain;
    this.lockChain = acquired;
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private parseQuestionResponse(
    messageText: string,
    questions: NonNullable<RemoteInteraction['questions']>
  ): string {
    if (isSkipResponse(messageText)) {
      return '{}';
    }

    const answers: Record<number, string[]> = {};
    questions.forEach((question, questionIndex) => {
      if (question.options?.length) {
        const numbers = messageText.match(/\d+/g);
        if (!numbers) return;

        const selectedLabels = numbers
          .map((number) => parseInt(number, 10) - 1)
          .filter((index) => index >= 0 && index < question.options!.length)
          .map((index) => question.options![index].label);

        if (selectedLabels.length > 0) {
          answers[questionIndex] = question.multiSelect ? selectedLabels : [selectedLabels[0]];
        }
      } else {
        answers[questionIndex] = [messageText.trim()];
      }
    });

    return JSON.stringify(answers);
  }

  private scheduleInteractionTimeout(
    id: string,
    resolve: () => void,
    label: 'Question' | 'Permission'
  ): void {
    setTimeout(
      () => {
        this.withInteractionLock(async () => {
          if (this.pendingInteractions.has(id)) {
            log(`[RemoteManager] ${label} timeout:`, id);
            this.pendingInteractions.delete(id);
            this.interactionResolvers.delete(id);
            resolve();
          }
        }).catch((err) => logError(`[RemoteManager] ${label} timeout lock error:`, err));
      },
      5 * 60 * 1000
    );
  }

  private isSafeTool(toolName: string): boolean {
    const safeTools = [
      'Read',
      'Glob',
      'Grep',
      'LS',
      'WebFetch',
      'WebSearch',
      'mcp__Chrome__navigate_page',
      'mcp__Chrome__take_screenshot',
      'mcp__Chrome__take_snapshot',
      'mcp__Chrome__click',
      'mcp__Chrome__fill',
      'mcp__Chrome__hover',
      'mcp__Chrome__list_pages',
      'mcp__Chrome__select_page',
      'mcp__Chrome__new_page',
      'mcp__Chrome__close_page',
      'mcp__Chrome__wait_for',
      'mcp__Chrome__press_key',
      'mcp__Chrome__evaluate_script',
      'mcp__Chrome__get_network_request',
      'mcp__Chrome__list_network_requests',
      'mcp__Chrome__list_console_messages',
      'Task',
    ];
    return safeTools.includes(toolName);
  }

  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString();
  }

  private emitStatusUpdate(): void {
    this.emitToRenderer({
      type: 'remote.status',
      payload: this.getStatus(),
    } as unknown as ServerEvent);
  }

  private emitToRenderer(event: ServerEvent): void {
    if (this.sendToRenderer) {
      this.sendToRenderer(event);
    }
    this.emit('renderer-event', event);
  }

  private emitRemoteUserMessage(
    actualSessionId: string,
    content: ContentBlock[],
    prompt: string
  ): void {
    if (!this.sendToRenderer) return;

    const messageContent: ContentBlock[] =
      content && content.length > 0 ? content : [{ type: 'text', text: prompt }];

    const userMessage: Message = {
      id: uuidv4(),
      sessionId: actualSessionId,
      role: 'user',
      content: messageContent,
      timestamp: Date.now(),
    };

    this.sendToRenderer({
      type: 'stream.message',
      payload: { sessionId: actualSessionId, message: userMessage },
    });
  }
}

export const remoteManager = new RemoteManager();
