import type {
  ChatInputCommandInteraction,
  CommandInteraction,
  EmbedBuilder,
  MessageCreateOptions,
  MessagePayload
} from 'discord.js';
import type { AudioPriority } from '../audio/types.js';
import type { MinecraftBotStatus, MinecraftConnectionConfig } from '../minecraft/types.js';

export type RBACTierName = 'VIEWER' | 'OPERATOR' | 'ADMIN';

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface EmbedData {
  title?: string;
  description?: string;
  color?: number;
  fields?: EmbedField[];
  footer?: { text: string; iconUrl?: string };
  timestamp?: string;
  thumbnail?: { url: string };
  author?: { name: string; iconUrl?: string };
}

export interface UserMessage {
  id: string;
  channelId: string;
  guildId?: string;
  author: {
    id: string;
    username: string;
    bot: boolean;
  };
  content: string;
  createdAt: Date;
}

export interface SlashCommandDefinition {
  name: string;
  description: string;
  tier: RBACTierName;
}

import type { VoiceConnection } from '@discordjs/voice';
import type { VoicePlayer } from '../audio/player.js';
import type { VoiceReceiver } from '../audio/receiver.js';
import type { AudioQueueManager } from '../audio/queue.js';

export interface IVoiceSession {
  readonly channelId?: string;
  readonly guildId?: string;
  readonly isDestroyed?: boolean;
  readonly player?: VoicePlayer;
  readonly receiver?: VoiceReceiver;
  readonly queue?: AudioQueueManager;
  readonly connection?: VoiceConnection;
  subscribeUser(userId: string): any;
  playAudioStream(
    stream: any,
    priority?: AudioPriority | 'NORMAL' | 'HIGH' | 'EMERGENCY'
  ): Promise<void>;
  stopAudio(): void;
  destroy(): void;
}

export interface IDiscordGateway {
  registerCommands(commands: any[]): Promise<void>;
  sendMessage(
    channelId: string,
    content: string | { content?: string; embeds?: (EmbedData | EmbedBuilder)[] } | MessagePayload | MessageCreateOptions
  ): Promise<string>;
  updateEmbed(channelId: string, messageId: string, embed: EmbedData | EmbedBuilder): Promise<void>;
  joinVoice(channelId: string, guildId: string): Promise<IVoiceSession>;
  leaveVoice(guildId: string): Promise<void>;
  onCommand(handler: (interaction: CommandInteraction | ChatInputCommandInteraction) => Promise<void>): void;
  onMessage(handler: (message: UserMessage) => Promise<void>): void;
}

export interface CommandContext {
  coordinator: {
    getMinecraftStatus(): MinecraftBotStatus;
    connectMinecraft(config: MinecraftConnectionConfig): Promise<void>;
    disconnectMinecraft(): Promise<void>;
    assignTask(task: { goal: string; user: string }): Promise<void>;
    stopCurrentTask(): Promise<void>;
    getInventory(): MinecraftBotStatus['inventory'] & { gear?: MinecraftBotStatus['gear'] };
    joinVoiceChannel(channelId: string, guildId?: string): Promise<void>;
    leaveVoiceChannel(guildId?: string): Promise<void>;
  };
}
