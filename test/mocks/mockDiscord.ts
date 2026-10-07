import { EventEmitter } from 'node:events';
import type { IDiscordGateway, IVoiceSession, UserMessage, EmbedData } from '../../src/discord/types.js';
import { MockVoiceSession } from './mockVoice.js';

export interface RecordedSentMessage {
  id: string;
  channelId: string;
  content?: string;
  embeds?: EmbedData[];
  createdAt: Date;
}

export interface RecordedEditedMessage {
  channelId: string;
  messageId: string;
  embed: EmbedData;
  editedAt: Date;
}

export class MockDiscordGateway extends EventEmitter implements IDiscordGateway {
  public registeredCommands: any[] = [];
  public sentMessages: RecordedSentMessage[] = [];
  public editedMessages: RecordedEditedMessage[] = [];
  public activeVoiceSessions: Map<string, MockVoiceSession> = new Map(); // guildId -> session

  private messageHandlers: Array<(message: UserMessage) => Promise<void>> = [];
  private commandHandlers: Array<(interaction: any) => Promise<void>> = [];

  // Error simulation switches
  public failNextUpdateWith: Error | null = null;
  public failNextSendWith: Error | null = null;

  public async registerCommands(commands: any[]): Promise<void> {
    this.registeredCommands = [...commands];
  }

  public async sendMessage(
    channelId: string,
    payload: string | { content?: string; embeds?: EmbedData[] } | any
  ): Promise<string> {
    if (this.failNextSendWith) {
      const err = this.failNextSendWith;
      this.failNextSendWith = null;
      throw err;
    }

    const messageId = `mock_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const recorded: RecordedSentMessage = {
      id: messageId,
      channelId,
      content: typeof payload === 'string' ? payload : payload.content,
      embeds: typeof payload === 'object' && payload.embeds ? payload.embeds : undefined,
      createdAt: new Date(),
    };

    this.sentMessages.push(recorded);
    return messageId;
  }

  public async updateEmbed(channelId: string, messageId: string, embed: EmbedData | any): Promise<void> {
    if (this.failNextUpdateWith) {
      const err = this.failNextUpdateWith;
      this.failNextUpdateWith = null;
      throw err;
    }

    const target = this.sentMessages.find((m) => m.id === messageId && m.channelId === channelId);
    if (!target) {
      const notFoundErr: any = new Error('Unknown Message');
      notFoundErr.code = 10008;
      throw notFoundErr;
    }

    target.embeds = [embed];
    this.editedMessages.push({
      channelId,
      messageId,
      embed,
      editedAt: new Date(),
    });
  }

  public async joinVoice(channelId: string, guildId: string): Promise<IVoiceSession> {
    let session = this.activeVoiceSessions.get(guildId);
    if (!session || session.isDestroyed) {
      session = new MockVoiceSession(channelId, guildId);
      this.activeVoiceSessions.set(guildId, session);
    }
    return session;
  }

  public async leaveVoice(guildId: string): Promise<void> {
    const session = this.activeVoiceSessions.get(guildId);
    if (session) {
      session.destroy();
      this.activeVoiceSessions.delete(guildId);
    }
  }

  public onCommand(handler: (interaction: any) => Promise<void>): void {
    this.commandHandlers.push(handler);
  }

  public onMessage(handler: (message: UserMessage) => Promise<void>): void {
    this.messageHandlers.push(handler);
  }

  // --------------------------------------------------------------------------
  // Simulation Helpers for Test Execution
  // --------------------------------------------------------------------------

  public async simulateUserMessage(msg: Partial<UserMessage>): Promise<void> {
    const fullMessage: UserMessage = {
      id: msg.id ?? `sim_msg_${Date.now()}`,
      channelId: msg.channelId ?? 'default_channel',
      guildId: msg.guildId ?? 'default_guild',
      author: msg.author ?? { id: 'sim_user_1', username: 'TestUser', bot: false },
      content: msg.content ?? '',
      createdAt: msg.createdAt ?? new Date(),
    };

    for (const handler of this.messageHandlers) {
      await handler(fullMessage);
    }
  }

  public async simulateCommandInteraction(interaction: any): Promise<void> {
    for (const handler of this.commandHandlers) {
      await handler(interaction);
    }
  }

  public simulateDeleteMessage(messageId: string): void {
    const idx = this.sentMessages.findIndex((m) => m.id === messageId);
    if (idx !== -1) {
      this.sentMessages.splice(idx, 1);
    }
  }

  public getSentMessagesInChannel(channelId: string): RecordedSentMessage[] {
    return this.sentMessages.filter((m) => m.channelId === channelId);
  }

  public getLastSentMessage(channelId?: string): RecordedSentMessage | undefined {
    if (channelId) {
      const inChan = this.getSentMessagesInChannel(channelId);
      return inChan[inChan.length - 1];
    }
    return this.sentMessages[this.sentMessages.length - 1];
  }

  public reset(): void {
    this.registeredCommands = [];
    this.sentMessages = [];
    this.editedMessages = [];
    this.activeVoiceSessions.clear();
    this.messageHandlers = [];
    this.commandHandlers = [];
    this.failNextUpdateWith = null;
    this.failNextSendWith = null;
  }
}
