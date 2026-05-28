/**
 * Remote Control Module
 * Remote control module exports.
 */

// Types
export * from './types';

// Core
export { RemoteGateway } from './gateway';
export { MessageRouter } from './message-router';
export { RemoteManager, remoteManager, type AgentExecutor, type RemoteInteraction } from './remote-manager';

// Channels
export { ChannelBase } from './channels/channel-base';
export { DiscordChannel } from './channels/discord';
export { SlackChannel } from './channels/slack';

// Config
export { remoteConfigStore } from './remote-config-store';
