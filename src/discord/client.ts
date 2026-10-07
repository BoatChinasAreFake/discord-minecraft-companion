import { Readable } from 'node:stream';
import {
  Client,
  GatewayIntentBits,
  Events,
  ChatInputCommandInteraction,
  Message,
  EmbedBuilder,
  MessagePayload,
  MessageCreateOptions
} from 'discord.js';
import {
  joinVoiceChannel as discordJoinVoice,
  getVoiceConnection,
  VoiceConnection
} from '@discordjs/voice';
import type { AppConfig } from '../config/types.js';
import type { RBACService } from './rbac.js';
import type { CommandRegistry } from './commands/registry.js';
import { withAutoDefer } from './commands/deferral.js';
import type { IDiscordGateway, IVoiceSession, UserMessage, CommandContext, EmbedData } from './types.js';
import { VoicePlayer } from '../audio/player.js';
import { VoiceReceiver } from '../audio/receiver.js';
import { AudioQueueManager } from '../audio/queue.js';
import { TTSPipeline, MockTTSProvider } from '../audio/tts.js';
import { AudioPriority, type ITTSPipeline } from '../audio/types.js';

export class DiscordBotClient implements IDiscordGateway {
  private client: Client;
  private messageHandlers: Array<(message: UserMessage) => Promise<void>> = [];
  private commandHandlers: Array<(interaction: any) => Promise<void>> = [];
  private voiceSessions: Map<string, IVoiceSession> = new Map();
  private ttsPipeline: ITTSPipeline;

  constructor(
    private config: AppConfig,
    private rbac: RBACService,
    private registry: CommandRegistry,
    private commandContext: CommandContext,
    ttsPipeline?: ITTSPipeline
  ) {
    this.ttsPipeline = ttsPipeline ?? new TTSPipeline(new MockTTSProvider());

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
      ]
    });

    this.setupListeners();
  }

  public setTTSPipeline(ttsPipeline: ITTSPipeline): void {
    this.ttsPipeline = ttsPipeline;
  }

  public getVoiceSession(guildId: string): IVoiceSession | undefined {
    return this.voiceSessions.get(guildId);
  }

  public getRawClient(): Client {
    return this.client;
  }

  public async start(): Promise<void> {
    if (this.config.runtime.mockAll) {
      console.log('[Discord Client] Running in offline mock mode, skipping live gateway login.');
      return;
    }

    await this.client.login(this.config.discord.token);
    console.log(`[Discord Client] Logged in as ${this.client.user?.tag}`);

    // Deploy slash commands
    await this.registry.deploy(this.config);
    console.log('[Discord Client] Slash commands deployed successfully.');
  }

  public async stop(): Promise<void> {
    for (const [, session] of this.voiceSessions) {
      try {
        session.destroy();
      } catch {
        // Suppress cleanup errors during shutdown
      }
    }
    this.voiceSessions.clear();
    this.client.destroy();
    console.log('[Discord Client] Gateway connection destroyed.');
  }

  public onMessage(handler: (message: UserMessage) => Promise<void>): void {
    this.messageHandlers.push(handler);
  }

  public onCommand(handler: (interaction: any) => Promise<void>): void {
    this.commandHandlers.push(handler);
  }

  public async registerCommands(commands: any[]): Promise<void> {
    for (const cmd of commands) {
      if (cmd && cmd.name) {
        this.registry.register(cmd);
      }
    }
  }

  public async sendMessage(
    channelId: string,
    content: string | { content?: string; embeds?: (EmbedData | EmbedBuilder)[] } | MessagePayload | MessageCreateOptions
  ): Promise<string> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('send' in channel)) {
      throw new Error(`Channel ${channelId} not found or is not text-based`);
    }

    let payload: any = content;
    if (typeof content === 'object' && content !== null && 'embeds' in content && content.embeds) {
      payload = {
        ...content,
        embeds: content.embeds.map((emb: any) => {
          if (emb instanceof EmbedBuilder) return emb;
          return new EmbedBuilder(emb);
        })
      };
    }

    const sent = await (channel as any).send(payload);
    return sent.id;
  }

  public async updateEmbed(channelId: string, messageId: string, embed: EmbedData | EmbedBuilder): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) {
      throw new Error(`Channel ${channelId} not found or is not text-based`);
    }
    const message = await (channel as any).messages.fetch(messageId);
    const embedObj = embed instanceof EmbedBuilder ? embed : new EmbedBuilder(embed);
    await message.edit({ embeds: [embedObj] });
  }

  public async joinVoice(channelId: string, guildId: string): Promise<IVoiceSession> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !('guild' in channel)) {
      throw new Error(`Voice channel ${channelId} not found or does not belong to a guild`);
    }

    // Clean up existing session in this guild if one exists
    const existingSession = this.voiceSessions.get(guildId);
    if (existingSession) {
      try {
        existingSession.destroy();
      } catch {
        // Ignore error when resetting session
      }
      this.voiceSessions.delete(guildId);
    }

    const connection: VoiceConnection = discordJoinVoice({
      channelId,
      guildId,
      adapterCreator: (channel as any).guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false
    });

    // 1. Instantiate and attach VoicePlayer
    const player = new VoicePlayer();
    player.attach(connection);

    // 2. Instantiate and attach VoiceReceiver
    const receiver = new VoiceReceiver(
      this.config.audio
        ? {
            silenceDurationMs: this.config.audio.sttSilenceDurationMs,
            minUtteranceDurationMs: this.config.audio.minUtteranceMs,
            maxUtteranceDurationMs: this.config.audio.maxUtteranceMs,
          }
        : {}
    );
    receiver.attach(connection);

    // 3. Instantiate AudioQueueManager wired to player and TTS
    const queue = new AudioQueueManager(player, this.ttsPipeline);

    let isSessionDestroyed = false;

    const session: IVoiceSession = {
      channelId,
      guildId,
      get isDestroyed() {
        return isSessionDestroyed;
      },
      player,
      receiver,
      queue,
      connection,
      subscribeUser: (userId: string) => connection.receiver.subscribe(userId),
      playAudioStream: async (
        stream: any,
        priority: AudioPriority | 'NORMAL' | 'HIGH' | 'EMERGENCY' = AudioPriority.NORMAL
      ): Promise<void> => {
        if (isSessionDestroyed) {
          throw new Error('Cannot play audio on destroyed voice session');
        }

        // Emergency priority preempts any lower priority playback
        if (priority === AudioPriority.EMERGENCY || priority === 'EMERGENCY') {
          queue.cancelNonEmergency();
          player.stop(true);
        }

        let readableStream: Readable;
        if (Buffer.isBuffer(stream)) {
          readableStream = Readable.from(stream);
        } else if (stream instanceof Readable || typeof (stream as any)?.pipe === 'function') {
          readableStream = stream as Readable;
        } else if (typeof (stream as any)?.getReader === 'function') {
          readableStream = Readable.fromWeb(stream as any);
        } else if (stream && typeof (stream as any)[Symbol.asyncIterator] === 'function') {
          readableStream = Readable.from(stream);
        } else {
          throw new Error('Unsupported audio stream format passed to playAudioStream');
        }

        await player.playStream(readableStream);
      },
      stopAudio: () => {
        queue.stopAll();
        player.stop(true);
      },
      destroy: () => {
        if (isSessionDestroyed) return;
        isSessionDestroyed = true;
        try {
          receiver.detach();
        } catch {}
        try {
          queue.stopAll();
        } catch {}
        try {
          player.stop(true);
        } catch {}
        try {
          connection.destroy();
        } catch {}
        this.voiceSessions.delete(guildId);
      }
    };

    this.voiceSessions.set(guildId, session);
    return session;
  }

  public async leaveVoice(guildId: string): Promise<void> {
    const session = this.voiceSessions.get(guildId);
    if (session) {
      session.destroy();
      this.voiceSessions.delete(guildId);
    }
    const connection = getVoiceConnection(guildId);
    if (connection) {
      connection.destroy();
    }
  }

  private setupListeners(): void {
    // 1. Interaction Routing with RBAC and Auto-Deferral
    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      await this.handleInteraction(interaction);
    });

    // 2. Inbound Message Handling for Chat Bridge
    this.client.on(Events.MessageCreate, async (msg: Message) => {
      if (msg.author.id === this.client.user?.id) return; // Prevent self-loop

      const userMsg: UserMessage = {
        id: msg.id,
        channelId: msg.channelId,
        guildId: msg.guildId ?? undefined,
        author: {
          id: msg.author.id,
          username: msg.author.username,
          bot: msg.author.bot
        },
        content: msg.content,
        createdAt: msg.createdAt
      };

      for (const handler of this.messageHandlers) {
        try {
          await handler(userMsg);
        } catch (err) {
          console.error('[Discord Client] Error in message handler:', err);
        }
      }
    });
  }

  public async handleInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
    // Notify external listeners
    for (const handler of this.commandHandlers) {
      try {
        await handler(interaction);
      } catch (err) {
        console.error('[Discord Client] Error in external command handler:', err);
      }
    }

    const command = this.registry.get(interaction.commandName);
    if (!command) {
      await interaction.reply({ content: `❌ Unknown command: /${interaction.commandName}`, ephemeral: true });
      return;
    }

    // RBAC Security Check
    const rbacResult = this.rbac.check(
      interaction.member,
      interaction.user,
      command.tier,
      interaction.guild
    );

    if (!rbacResult.allowed) {
      console.warn(
        `[RBAC Audit] DENIED: User ${interaction.user.tag ?? interaction.user.username} (${interaction.user.id}) attempted /${command.name}`
      );
      await interaction.reply({
        content: rbacResult.reason || '⛔ Permission Denied.',
        ephemeral: true
      });
      return;
    }

    // Execute with Auto-Deferral Guard
    try {
      if (command.deferImmediately) {
        await interaction.deferReply({ ephemeral: command.deferEphemeral ?? false });
        await command.execute(interaction, this.commandContext);
      } else {
        await withAutoDefer(
          interaction,
          { timeoutMs: 2500, ephemeral: command.deferEphemeral ?? false },
          () => command.execute(interaction, this.commandContext)
        );
      }
    } catch (err: any) {
      console.error(`[Discord Client] Error executing command /${command.name}:`, err);
      const errorMessage = '❌ An error occurred while executing this command.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: errorMessage });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
  }
}
