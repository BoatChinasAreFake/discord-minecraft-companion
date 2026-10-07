import type { IDiscordGateway, UserMessage } from '../discord/types.js';
import { AntiLoopbackFilter } from './antiLoopback.js';
import type { ChatBridgeConfig, IMinecraftChatAgent } from './types.js';

export class ChatBridge {
  private readonly gateway: IDiscordGateway;
  private readonly agent: IMinecraftChatAgent;
  private readonly filter: AntiLoopbackFilter;
  private readonly config: ChatBridgeConfig;

  private isRunning = false;
  private chatQueue: string[] = [];
  private queueTimer: NodeJS.Timeout | null = null;

  // Bound event handlers for clean removal
  private boundDiscordHandler = this.handleDiscordMessage.bind(this);
  private boundMinecraftHandler = this.handleMinecraftChat.bind(this);

  constructor(
    gateway: IDiscordGateway,
    agent: IMinecraftChatAgent,
    config: ChatBridgeConfig,
    filter?: AntiLoopbackFilter
  ) {
    this.gateway = gateway;
    this.agent = agent;
    this.config = config;
    this.filter =
      filter ??
      new AntiLoopbackFilter({
        botDiscordId: config.botDiscordId,
        botMinecraftUsername: config.botMinecraftUsername,
      });
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.gateway.onMessage(this.boundDiscordHandler);
    this.agent.on('chat', this.boundMinecraftHandler);

    // Start leaky-bucket dispatch queue for Minecraft chat
    this.startQueueProcessor();
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.queueTimer) {
      clearInterval(this.queueTimer);
      this.queueTimer = null;
    }
    this.chatQueue = [];
    this.filter.clear();

    if (typeof this.agent.removeListener === 'function') {
      this.agent.removeListener('chat', this.boundMinecraftHandler);
    }
  }

  /**
   * Processes inbound Discord text messages.
   */
  public async handleDiscordMessage(message: UserMessage): Promise<void> {
    if (!this.isRunning) return;

    // Filter 1: Must be in configured chat bridge channel
    if (message.channelId !== this.config.bridgeChannelId) return;

    // Filter 2 & 3: Triple-lock check (Self-ID, Bot account, Hash deduplication)
    const evalResult = this.filter.evaluate({
      source: 'discord',
      authorId: message.author.id,
      isBotAccount: message.author.bot,
      content: message.content,
    });

    if (evalResult.drop) {
      return;
    }

    // Sanitize message content
    const sanitizedContent = this.filter.sanitizeForMinecraft(message.content);
    if (!sanitizedContent) return;

    const cleanUsername = this.filter.sanitizeForMinecraft(message.author.username) || 'User';
    const prefix = `[Discord] <${cleanUsername}>:`;
    const chunks = this.filter.chunkForMinecraft(prefix, sanitizedContent);

    // Record outbound hash in anti-loopback filter
    for (const chunk of chunks) {
      // Record raw content and formatted chunk to catch both server broadcast variants
      this.filter.recordOutbound(sanitizedContent);
      this.filter.recordOutbound(chunk);
      this.enqueueMinecraftChat(chunk);
    }
  }

  /**
   * Processes inbound Minecraft chat events.
   */
  public async handleMinecraftChat(username: string, message: string): Promise<void> {
    if (!this.isRunning) return;

    const evalResult = this.filter.evaluate({
      source: 'minecraft',
      authorUsername: username,
      content: message,
    });

    if (evalResult.drop) {
      return;
    }

    // Format for Discord relay
    const sanitizedMsg = this.filter.sanitizeForDiscord(message.trim());
    const discordPayload = `**[Minecraft] <${username}>** ${sanitizedMsg}`;

    // Record outbound hash to avoid echoing back
    this.filter.recordOutbound(message);
    this.filter.recordOutbound(sanitizedMsg);

    try {
      await this.gateway.sendMessage(this.config.bridgeChannelId, discordPayload);
    } catch (err) {
      console.error('[ChatBridge] Failed to relay Minecraft chat to Discord:', err);
    }
  }

  /**
   * Relays in-game death messages (e.g. from Mineflayer death/messagestr events).
   */
  public async handleMinecraftDeath(deathMessage: string): Promise<void> {
    if (!this.isRunning) return;
    const cleanMsg = this.filter.sanitizeForDiscord(deathMessage.trim());
    const payload = `💀 **[Minecraft]** ${cleanMsg}`;
    try {
      await this.gateway.sendMessage(this.config.bridgeChannelId, payload);
    } catch (err) {
      console.error('[ChatBridge] Failed to relay death message to Discord:', err);
    }
  }

  // --------------------------------------------------------------------------
  // Rate-Limiting Leaky Bucket
  // --------------------------------------------------------------------------

  private enqueueMinecraftChat(chunk: string): void {
    const maxQueue = this.config.maxQueueSize ?? 50;
    if (this.chatQueue.length >= maxQueue) {
      this.chatQueue.shift(); // Drop oldest on overflow
    }
    this.chatQueue.push(chunk);
  }

  private startQueueProcessor(): void {
    const intervalMs = this.config.rateLimitDelayMs ?? 500;
    this.queueTimer = setInterval(async () => {
      if (this.chatQueue.length === 0) return;
      const nextMessage = this.chatQueue.shift();
      if (nextMessage) {
        try {
          await this.agent.sendChat(nextMessage);
        } catch (err) {
          console.error('[ChatBridge] Failed to send chat to Minecraft:', err);
        }
      }
    }, intervalMs);
  }

  public getQueueLength(): number {
    return this.chatQueue.length;
  }

  public isBridgeRunning(): boolean {
    return this.isRunning;
  }
}
