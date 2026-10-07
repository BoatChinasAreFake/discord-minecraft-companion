# Implementation Strategy: Bidirectional Chat Bridge, Live Status Embeds, and In-Memory Test Mocks (Milestone 1)

**Target Milestone**: Milestone 1 (Discord Core & Audio/Bridge Infrastructure)  
**Author**: Explorer M1-3 (`teamwork_preview_explorer`)  
**Scope**:  
1. `src/bridge/antiLoopback.ts` (Triple-lock anti-loopback, sanitization, 256-char chunking)  
2. `src/bridge/chatBridge.ts` (Bidirectional relay between Discord and Minecraft chat)  
3. `src/discord/embed.ts` (Live status embed builder, visual bars, 5s throttling, SHA256 dirty-state hashing)  
4. `test/mocks/mockDiscord.ts` & `test/mocks/mockVoice.ts` (100% offline in-memory test mocks)  
5. Milestone 1 Unit & Integration Test Plan (Tiers 1–4 test matrices)

---

## 1. Architectural Context & Interface Alignment

The bridge, embed, and mock subsystems link Discord with the agent coordinator and Minecraft engine while ensuring zero network/secret dependencies during testing:

```
[ Discord Gateway / Mock ]
         │ (messageCreate, editMessage)
         ▼
 ┌──────────────────────────────────────────────────────────────┐
 │                     ChatBridge Subsystem                     │
 │  - AntiLoopbackFilter (Self-ID, Bot Accounts, 10s TTL Hash)  │
 │  - Format Sanitizer (Strip §, resolve mentions, clean ASCII) │
 │  - Message Chunker (<= 256-chars for Minecraft packets)      │
 │  - Leaky-Bucket Rate Limiter (Max 2 msgs/sec to Minecraft)   │
 └───────────────┬──────────────────────────────▲───────────────┘
                 │                              │
                 ▼                              │
        [ IMinecraftAgent.sendChat ]   [ agent.on('chat') ]
                                                │
 ┌──────────────────────────────────────────────┴───────────────┐
 │                   Live Status Embed Subsystem                │
 │  - Visual Bar Builder (Health ❤️/🤍, Hunger 🍗/▫️)          │
 │  - SHA-256 Dirty-State Change Detector                       │
 │  - 5-Second Interval Throttler                               │
 │  - Error 10008 Self-Healing & Message Pin Manager            │
 └──────────────────────────────────────────────────────────────┘
```

### Shared Type Contracts (`src/bridge/types.ts` & `src/discord/types.ts`)

```typescript
// src/discord/types.ts
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

export interface IDiscordGateway {
  registerCommands(commands: any[]): Promise<void>;
  sendMessage(channelId: string, content: string | { content?: string; embeds?: EmbedData[] }): Promise<string>;
  updateEmbed(channelId: string, messageId: string, embed: EmbedData): Promise<void>;
  joinVoice(channelId: string, guildId: string): Promise<IVoiceSession>;
  leaveVoice(guildId: string): Promise<void>;
  onCommand(handler: (interaction: any) => Promise<void>): void;
  onMessage(handler: (message: UserMessage) => Promise<void>): void;
}

export interface IVoiceSession {
  subscribeUser(userId: string): any;
  playAudioStream(stream: any, priority: 'NORMAL' | 'HIGH' | 'EMERGENCY'): Promise<void>;
  stopAudio(): void;
  destroy(): void;
}
```

```typescript
// src/minecraft/types.ts (relevant to bridge & embed)
export interface Vec3Location {
  x: number;
  y: number;
  z: number;
}

export interface MinecraftBotStatus {
  connected: boolean;
  username: string;
  health: number; // 0.0 - 20.0
  food: number;   // 0 - 20
  position: Vec3Location;
  dimension: string; // 'overworld' | 'the_nether' | 'the_end'
  currentTask: string | null;
  gear: {
    mainHand: string;
    offHand: string;
    armorSummary: string;
    helmet?: string;
    chestplate?: string;
    leggings?: string;
    boots?: string;
  };
  inventory: {
    usedSlots: number;
    totalSlots: number; // default 36
    freeSlots: number;
    keyItemsSummary?: string;
  };
  server: {
    host: string;
    port: number;
    ping: number;
  };
}
```

---

## 2. Component Specification: `src/bridge/antiLoopback.ts`

### 2.1 Purpose & Responsibilities
Provides triple-lock loopback protection, formatting sanitization, mention resolution, and length chunking for outbound Minecraft and Discord text.

### 2.2 Core Invariants
1. **Triple-Lock Protection**:
   - **Lock 1 (Self-ID Check)**: If message sender ID matches the bot's own Discord ID (`botDiscordId`) or in-game username (`botMinecraftUsername`), drop immediately.
   - **Lock 2 (Bot Account Check)**: If Discord author has `bot === true`, drop immediately to prevent bot-to-bot cascade amplification.
   - **Lock 3 (10s TTL Hash Deduplication)**: When a message is dispatched across the bridge (Discord -> MC or MC -> Discord), its normalized cryptographic hash is stored with a 10,000ms TTL. If the server or Discord echoes the message back within this window, the hash collision triggers an instant drop.
2. **Command Injection Prevention**:
   - Messages are strictly prefixed with `[Discord] <Username>: `.
   - All control characters and newlines (`\r`, `\n`) are stripped/collapsed to spaces, making it impossible to inject a secondary line starting with `/op`, `/kill`, or `/give`.
3. **Vanilla Packet Truncation (<= 256 chars)**:
   - Minecraft Java chat packets strictly reject or kick clients transmitting payloads longer than 256 characters. Messages exceeding this limit are intelligently split into indexed chunks (`[1/2]`, `[2/2]`) or truncated with `...`.
4. **Mention & Color Code Sanitization**:
   - Discord user mentions (`<@123>`), channels (`<#456>`), roles (`<@&789>`), and custom emojis (`<:pepe:123>`) are converted to plain-text representations (`@user_123`, `#channel_456`, `:pepe:`).
   - Minecraft section signs (`§[0-9a-fk-or]`) are stripped to prevent unauthorized formatting.
   - Outbound Minecraft-to-Discord messages have `@everyone` and `@here` neutralized with zero-width spaces (`@\u200beveryone`).

### 2.3 Concrete Implementation Architecture

```typescript
import { createHash } from 'crypto';

export interface AntiLoopbackOptions {
  botDiscordId: string;
  botMinecraftUsername: string;
  ttlMs?: number; // default: 10000 ms
}

export interface InboundMessageMeta {
  source: 'discord' | 'minecraft';
  authorId?: string;
  authorUsername?: string;
  isBotAccount?: boolean;
  content: string;
}

export interface DropEvaluation {
  drop: boolean;
  reason?: 'SELF_BOT_ID' | 'BOT_ACCOUNT' | 'DUPLICATE_TTL_HASH' | 'EMPTY_CONTENT' | 'DISCORD_PREFIX_ECHO';
}

export class AntiLoopbackFilter {
  private readonly ttlMs: number;
  private readonly botDiscordId: string;
  private readonly botMinecraftUsername: string;
  // Stores hash -> expiration timestamp (ms)
  private readonly hashCache: Map<string, number> = new Map();

  constructor(options: AntiLoopbackOptions) {
    this.botDiscordId = options.botDiscordId;
    this.botMinecraftUsername = options.botMinecraftUsername.toLowerCase();
    this.ttlMs = options.ttlMs ?? 10_000;
  }

  /**
   * Normalizes text for deterministic hash comparison:
   * Strips formatting, lowers case, trims, collapses multiple spaces.
   */
  public normalizeText(text: string): string {
    return text
      .replace(/§[0-9a-fk-or]/gi, '')           // Strip MC formatting codes
      .replace(/[\x00-\x1F\x7F]/g, ' ')         // Strip control characters
      .replace(/\s+/g, ' ')                     // Collapse whitespace
      .trim()
      .toLowerCase();
  }

  public computeHash(text: string): string {
    const normalized = this.normalizeText(text);
    return createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Records a hash into the TTL deduplication cache.
   */
  public recordOutbound(text: string): string {
    this.pruneExpired();
    const hash = this.computeHash(text);
    this.hashCache.set(hash, Date.now() + this.ttlMs);
    return hash;
  }

  /**
   * Evaluates inbound message against the triple-lock criteria.
   */
  public evaluate(meta: InboundMessageMeta): DropEvaluation {
    this.pruneExpired();

    const trimmed = meta.content.trim();
    if (trimmed.length === 0) {
      return { drop: true, reason: 'EMPTY_CONTENT' };
    }

    // Lock 1: Self ID check
    if (meta.source === 'discord' && meta.authorId === this.botDiscordId) {
      return { drop: true, reason: 'SELF_BOT_ID' };
    }
    if (meta.source === 'minecraft' && meta.authorUsername?.toLowerCase() === this.botMinecraftUsername) {
      return { drop: true, reason: 'SELF_BOT_ID' };
    }

    // Lock 2: Bot account check (Discord only)
    if (meta.source === 'discord' && meta.isBotAccount) {
      return { drop: true, reason: 'BOT_ACCOUNT' };
    }

    // Secondary Lock: Detect [Discord] prefix echo on Minecraft chat
    if (meta.source === 'minecraft' && meta.content.startsWith('[Discord]')) {
      return { drop: true, reason: 'DISCORD_PREFIX_ECHO' };
    }

    // Lock 3: 10s TTL Hash Deduplication check
    const hash = this.computeHash(trimmed);
    const expiresAt = this.hashCache.get(hash);
    if (expiresAt && expiresAt > Date.now()) {
      return { drop: true, reason: 'DUPLICATE_TTL_HASH' };
    }

    return { drop: false };
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [hash, expiresAt] of this.hashCache.entries()) {
      if (expiresAt <= now) {
        this.hashCache.delete(hash);
      }
    }
  }

  public clear(): void {
    this.hashCache.clear();
  }

  // --------------------------------------------------------------------------
  // Formatting & Sanitization Helpers
  // --------------------------------------------------------------------------

  public sanitizeForMinecraft(content: string): string {
    return content
      .replace(/<@!?(\d+)>/g, '@user_$1')      // User mentions
      .replace(/<#(\d+)>/g, '#channel_$1')      // Channel mentions
      .replace(/<@&(\d+)>/g, '@role_$1')        // Role mentions
      .replace(/<a?:(\w+):\d+>/g, ':$1:')       // Custom emojis
      .replace(/§[0-9a-fk-or]/gi, '')           // Section signs
      .replace(/[\r\n\t]+/g, ' ')               // Replace newlines/tabs with space
      .replace(/[\x00-\x1F\x7F]/g, '')          // Strip control characters
      .trim();
  }

  public sanitizeForDiscord(content: string): string {
    return content
      .replace(/@everyone/g, '@\u200beveryone')
      .replace(/@here/g, '@\u200bhere');
  }

  /**
   * Breaks formatted message into valid Minecraft chat chunks <= 256 characters.
   * If total length exceeds 256, splits at word boundaries with index tags [1/2].
   */
  public chunkForMinecraft(prefix: string, message: string, maxLen = 256): string[] {
    const fullMessage = `${prefix} ${message}`.trim();
    if (fullMessage.length <= maxLen) {
      return [fullMessage];
    }

    const chunks: string[] = [];
    const maxChunks = 3; // Prevent spamming chat if user pastes huge text
    const words = message.split(' ');
    let currentChunk = '';

    for (const word of words) {
      const candidate = currentChunk ? `${currentChunk} ${word}` : word;
      // Reserve 12 characters for indexing: `${prefix} [1/3] ${chunk}`
      const testFormat = `${prefix} [1/1] ${candidate}`;

      if (testFormat.length > maxLen) {
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = word;
        } else {
          // Single word longer than max allowed chunk: hard slice
          chunks.push(word.slice(0, maxLen - prefix.length - 12));
          currentChunk = word.slice(maxLen - prefix.length - 12);
        }
      } else {
        currentChunk = candidate;
      }

      if (chunks.length >= maxChunks) break;
    }

    if (currentChunk && chunks.length < maxChunks) {
      chunks.push(currentChunk);
    }

    const total = chunks.length;
    return chunks.map((chunk, idx) => {
      if (total === 1) return `${prefix} ${chunk}`;
      return `${prefix} [${idx + 1}/${total}] ${chunk}`;
    });
  }
}
```

---

## 3. Component Specification: `src/bridge/chatBridge.ts`

### 3.1 Purpose & Responsibilities
Maintains the live bidirectional pipe between Discord's text bridge channel and Minecraft Java in-game chat events. Integrates the `AntiLoopbackFilter`, outbound chat rate limiting (leaky bucket), and game death/event relays.

### 3.2 Concrete Implementation Architecture

```typescript
import { IDiscordGateway, UserMessage } from '../discord/types.js';
import { AntiLoopbackFilter } from './antiLoopback.js';

export interface IMinecraftChatAgent {
  sendChat(message: string): Promise<void>;
  on(event: 'chat', listener: (username: string, message: string) => void): void;
  removeListener(event: string, listener: (...args: any[]) => void): void;
}

export interface ChatBridgeConfig {
  bridgeChannelId: string;
  botDiscordId: string;
  botMinecraftUsername: string;
  rateLimitDelayMs?: number; // default: 500ms between outbound MC chat packets
  maxQueueSize?: number;     // default: 50
}

export class ChatBridge {
  private readonly gateway: IDiscordGateway;
  private readonly agent: IMinecraftChatAgent;
  private readonly filter: AntiLoopbackFilter;
  private readonly config: ChatBridgeConfig;

  private isRunning: boolean = false;
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
    this.filter = filter ?? new AntiLoopbackFilter({
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

    const prefix = `[Discord] <${message.author.username}>:`;
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
}
```

---

## 4. Component Specification: `src/discord/embed.ts`

### 4.1 Purpose & Responsibilities
Builds real-time, aesthetically rich status embeds displaying bot survival metrics (health, hunger, coords, gear, active task, inventory) and throttles updates (5s interval + SHA-256 dirty-state hashing) to eliminate redundant Discord API requests and prevent HTTP 429 rate limits.

### 4.2 Visual Indicators & Progress Bars
- **Health Bar**: 10 segments. Full: `❤️`, Empty: `🤍`. Clamped to $[0, 20]$.
- **Hunger Bar**: 10 segments. Full: `🍗`, Empty: `▫️`. Clamped to $[0, 20]$.
- **Dynamic Color**:
  - Green (`0x2ecc71` / `3066993`): Health $> 15.0$
  - Yellow (`0xf1c40f` / `15844367`): $7.0 < \text{Health} \le 15.0$
  - Red (`0xe74c3c` / `15158332`): $\text{Health} \le 7.0$
  - Grey (`0x95a5a6` / `9807270`): Disconnected / Offline

### 4.3 Dirty-State Hashing Algorithm
To avoid triggering Discord edits during stationary idling, a SHA-256 digest is generated over a canonical state representation:
- Health rounded to $0.5$ step increments.
- Coordinates rounded to integer block units (ignoring sub-block floating point micro-jitter).
- Current task, gear, inventory count, connection state.

### 4.4 Concrete Implementation Architecture

```typescript
import { createHash } from 'crypto';
import { EmbedData, IDiscordGateway } from './types.js';
import { MinecraftBotStatus } from '../minecraft/types.js';

export interface StatusEmbedConfig {
  statusChannelId: string;
  updateIntervalSec?: number; // default: 5s
  pinnedMessageId?: string;
}

export function generateProgressBar(
  current: number,
  max: number,
  segments: number = 10,
  filledChar: string = '■',
  emptyChar: string = '□'
): string {
  const clamped = Math.max(0, Math.min(current, max));
  const filledCount = Math.round((clamped / max) * segments);
  const emptyCount = Math.max(0, segments - filledCount);
  return filledChar.repeat(filledCount) + emptyChar.repeat(emptyCount);
}

export function computeStateHash(status: MinecraftBotStatus): string {
  const canonical = {
    connected: status.connected,
    health: Math.round(status.health * 2) / 2, // 0.5 granularity
    food: Math.round(status.food),
    pos: status.position ? [
      Math.round(status.position.x),
      Math.round(status.position.y),
      Math.round(status.position.z),
      status.dimension
    ] : null,
    task: status.currentTask ?? '',
    gear: status.gear ? {
      main: status.gear.mainHand,
      off: status.gear.offHand,
      armor: status.gear.armorSummary
    } : null,
    invUsed: status.inventory?.usedSlots ?? 0,
    server: status.server ? `${status.server.host}:${status.server.port}` : '',
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function buildStatusEmbed(status: MinecraftBotStatus): EmbedData {
  if (!status.connected) {
    return {
      title: `🎮 Minecraft Agent: ${status.username || 'Bot'}`,
      description: '🔴 **Offline / Disconnected from Minecraft server**',
      color: 0x95a5a6, // Grey
      fields: [
        { name: '🌐 Server', value: `\`${status.server?.host || 'localhost'}:${status.server?.port || 25565}\``, inline: true },
        { name: '📋 Status', value: 'Awaiting connection command (`/connect`)', inline: true }
      ],
      footer: { text: 'Survival AI Companion • Offline' },
      timestamp: new Date().toISOString(),
    };
  }

  // Dynamic status color
  let color = 0x2ecc71; // Green
  if (status.health <= 7) {
    color = 0xe74c3c;   // Red
  } else if (status.health <= 15) {
    color = 0xf1c40f;   // Yellow
  }

  const healthBar = generateProgressBar(status.health, 20, 10, '❤️', '🤍');
  const hungerBar = generateProgressBar(status.food, 20, 10, '🍗', '▫️');

  const x = status.position ? status.position.x.toFixed(1) : '0.0';
  const y = status.position ? status.position.y.toFixed(1) : '0.0';
  const z = status.position ? status.position.z.toFixed(1) : '0.0';
  const dim = status.dimension || 'overworld';

  const usedSlots = status.inventory?.usedSlots ?? 0;
  const totalSlots = status.inventory?.totalSlots ?? 36;
  const freeSlots = status.inventory?.freeSlots ?? (totalSlots - usedSlots);

  return {
    title: `🎮 Minecraft Agent Status: ${status.username}`,
    color,
    fields: [
      {
        name: '💖 Health',
        value: `${healthBar} **${status.health.toFixed(1)}/20**`,
        inline: true,
      },
      {
        name: '🍗 Hunger',
        value: `${hungerBar} **${status.food}/20**`,
        inline: true,
      },
      {
        name: '🧭 Coordinates',
        value: `\`X: ${x}, Y: ${y}, Z: ${z}\` (${dim})`,
        inline: false,
      },
      {
        name: '📋 Active Task',
        value: status.currentTask || 'Idle - Standing by',
        inline: false,
      },
      {
        name: '⚔️ Equipped Gear',
        value: `Main: \`${status.gear?.mainHand || 'Air'}\` | Off: \`${status.gear?.offHand || 'Air'}\`\nArmor: \`${status.gear?.armorSummary || 'None'}\``,
        inline: false,
      },
      {
        name: '🎒 Inventory',
        value: `Used: **${usedSlots}/${totalSlots}** slots | Free: **${freeSlots}**`,
        inline: true,
      },
      {
        name: '🌐 Server',
        value: `\`${status.server?.host || 'localhost'}:${status.server?.port || 25565}\` (${status.server?.ping ?? 0}ms)`,
        inline: true,
      },
    ],
    footer: { text: 'Survival AI Companion • Live Status' },
    timestamp: new Date().toISOString(),
  };
}

export class StatusEmbedManager {
  private readonly gateway: IDiscordGateway;
  private readonly config: StatusEmbedConfig;
  private currentMessageId: string | null = null;
  private lastHash: string | null = null;
  private latestStatus: MinecraftBotStatus | null = null;
  private updateTimer: NodeJS.Timeout | null = null;
  private isUpdating: boolean = false;

  constructor(gateway: IDiscordGateway, config: StatusEmbedConfig) {
    this.gateway = gateway;
    this.config = config;
    this.currentMessageId = config.pinnedMessageId ?? null;
  }

  public start(): void {
    if (this.updateTimer) return;
    const intervalMs = (this.config.updateIntervalSec ?? 5) * 1000;
    this.updateTimer = setInterval(() => {
      this.tick();
    }, intervalMs);
  }

  public stop(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  public updateState(status: MinecraftBotStatus): void {
    this.latestStatus = status;
  }

  public async tick(force = false): Promise<boolean> {
    if (!this.latestStatus || this.isUpdating) return false;

    const currentHash = computeStateHash(this.latestStatus);
    if (!force && currentHash === this.lastHash) {
      return false; // Skip redundant Discord API call!
    }

    this.isUpdating = true;
    try {
      const embed = buildStatusEmbed(this.latestStatus);

      if (this.currentMessageId) {
        try {
          await this.gateway.updateEmbed(this.config.statusChannelId, this.currentMessageId, embed);
          this.lastHash = currentHash;
          return true;
        } catch (err: any) {
          // If Discord Error 10008 (Unknown Message) was thrown, message was deleted
          if (err?.code === 10008 || String(err).includes('10008')) {
            console.warn('[StatusEmbedManager] Status message was deleted, creating new pin.');
            this.currentMessageId = null;
          } else {
            throw err;
          }
        }
      }

      // Create new message if no message ID exists or was deleted
      const messageId = await this.gateway.sendMessage(this.config.statusChannelId, {
        embeds: [embed],
      });
      this.currentMessageId = messageId;
      this.lastHash = currentHash;
      return true;
    } catch (err) {
      console.error('[StatusEmbedManager] Failed to update status embed:', err);
      return false;
    } finally {
      this.isUpdating = false;
    }
  }

  public getCurrentMessageId(): string | null {
    return this.currentMessageId;
  }

  public getLastHash(): string | null {
    return this.lastHash;
  }
}
```

---

## 5. Component Specification: `test/mocks/mockDiscord.ts` & `test/mocks/mockVoice.ts`

### 5.1 Architecture & Design Rationales
To satisfy Requirement R4 (100% offline verification), tests must run without Discord gateway tokens, external network connections, or native audio device/Opus compilation requirements.
- `MockDiscordGateway` implements `IDiscordGateway` with an in-memory event bus and inspection arrays.
- `MockVoiceSession` implements `IVoiceSession` using pure Node.js `stream.PassThrough` instances.

### 5.2 Implementation of `test/mocks/mockDiscord.ts`

```typescript
import { EventEmitter } from 'events';
import { IDiscordGateway, IVoiceSession, UserMessage, EmbedData } from '../../src/discord/types.js';
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
    payload: string | { content?: string; embeds?: EmbedData[] }
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
      embeds: typeof payload === 'object' ? payload.embeds : undefined,
      createdAt: new Date(),
    };

    this.sentMessages.push(recorded);
    return messageId;
  }

  public async updateEmbed(channelId: string, messageId: string, embed: EmbedData): Promise<void> {
    if (this.failNextUpdateWith) {
      const err = this.failNextUpdateWith;
      this.failNextUpdateWith = null;
      throw err;
    }

    const target = this.sentMessages.find(m => m.id === messageId && m.channelId === channelId);
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
    const idx = this.sentMessages.findIndex(m => m.id === messageId);
    if (idx !== -1) {
      this.sentMessages.splice(idx, 1);
    }
  }

  public getSentMessagesInChannel(channelId: string): RecordedSentMessage[] {
    return this.sentMessages.filter(m => m.channelId === channelId);
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
```

### 5.3 Implementation of `test/mocks/mockVoice.ts`

```typescript
import { PassThrough, Readable } from 'stream';
import { IVoiceSession } from '../../src/discord/types.js';

export interface RecordedAudioPlayback {
  priority: 'NORMAL' | 'HIGH' | 'EMERGENCY';
  chunks: Buffer[];
  totalBytes: number;
  completed: boolean;
}

export class MockVoiceSession implements IVoiceSession {
  public channelId: string;
  public guildId: string;
  public isDestroyed: boolean = false;
  public isAudioPlaying: boolean = false;

  // Tracks active simulated inbound speaker streams
  public activeUserStreams: Map<string, PassThrough> = new Map();

  // Tracks captured outbound TTS playback
  public playedRecordings: RecordedAudioPlayback[] = [];

  constructor(channelId: string, guildId: string) {
    this.channelId = channelId;
    this.guildId = guildId;
  }

  public subscribeUser(userId: string): PassThrough {
    let stream = this.activeUserStreams.get(userId);
    if (!stream || stream.destroyed) {
      stream = new PassThrough();
      this.activeUserStreams.set(userId, stream);
    }
    return stream;
  }

  public async playAudioStream(
    stream: Readable | Buffer,
    priority: 'NORMAL' | 'HIGH' | 'EMERGENCY'
  ): Promise<void> {
    if (this.isDestroyed) {
      throw new Error('Cannot play audio on destroyed voice session');
    }

    this.isAudioPlaying = true;
    const recording: RecordedAudioPlayback = {
      priority,
      chunks: [],
      totalBytes: 0,
      completed: false,
    };
    this.playedRecordings.push(recording);

    if (Buffer.isBuffer(stream)) {
      recording.chunks.push(stream);
      recording.totalBytes = stream.length;
      recording.completed = true;
      this.isAudioPlaying = false;
      return;
    }

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        recording.chunks.push(chunk);
        recording.totalBytes += chunk.length;
      });

      stream.on('end', () => {
        recording.completed = true;
        this.isAudioPlaying = false;
        resolve();
      });

      stream.on('error', (err) => {
        this.isAudioPlaying = false;
        reject(err);
      });
    });
  }

  public stopAudio(): void {
    this.isAudioPlaying = false;
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.stopAudio();
    for (const stream of this.activeUserStreams.values()) {
      stream.destroy();
    }
    this.activeUserStreams.clear();
  }

  // --------------------------------------------------------------------------
  // Simulation Helpers for Inbound User Speech
  // --------------------------------------------------------------------------

  public simulateUserSpeaking(userId: string, pcmChunks: Buffer[]): void {
    const stream = this.subscribeUser(userId);
    for (const chunk of pcmChunks) {
      stream.write(chunk);
    }
  }

  public simulateUserSilence(userId: string): void {
    const stream = this.activeUserStreams.get(userId);
    if (stream) {
      stream.end();
      this.activeUserStreams.delete(userId);
    }
  }

  public getCombinedPlayedAudio(index?: number): Buffer {
    const idx = index ?? this.playedRecordings.length - 1;
    const recording = this.playedRecordings[idx];
    if (!recording) return Buffer.alloc(0);
    return Buffer.concat(recording.chunks);
  }

  public reset(): void {
    this.destroy();
    this.isDestroyed = false;
    this.playedRecordings = [];
  }
}
```

---

## 6. Milestone 1 Unit & Integration Test Plan

The Milestone 1 test suite validates all 17 M1 features across the 4 standard tiers. Every feature must have $\ge 5$ test cases in Tier 1 and $\ge 5$ test cases in Tier 2.

```
                  ┌──────────────────────────────────────────────┐
                  │ Tier 4: Real-World Application Scenarios     │
                  ├──────────────────────────────────────────────┤
                  │ Tier 3: Cross-Feature Combination Matrix     │
                  ├──────────────────────────────────────────────┤
                  │ Tier 2: Boundary & Corner Cases (>=5 / feat) │
                  ├──────────────────────────────────────────────┤
                  │ Tier 1: Isolated Feature Coverage (>=5 / feat│
                  └──────────────────────────────────────────────┘
```

### 6.1 Tier 1: Feature Coverage Test Matrix ($\ge 5$ cases per feature)

#### Feature 1: Anti-Loopback Triple Lock (`test/unit/bridge/antiLoopback.test.ts`)
- **TC1.1.1 (Self-ID Drop)**: Discord message authored by `botDiscordId` is dropped with reason `SELF_BOT_ID`.
- **TC1.1.2 (Bot Account Drop)**: Discord message authored by another bot (`author.bot = true`) is dropped with reason `BOT_ACCOUNT`.
- **TC1.1.3 (MC Self-Username Drop)**: Minecraft chat message authored by `botMinecraftUsername` is dropped with reason `SELF_BOT_ID`.
- **TC1.1.4 (10s TTL Hash Deduplication Drop)**: Message whose content hash is registered in cache within 10,000ms is dropped with reason `DUPLICATE_TTL_HASH`.
- **TC1.1.5 (TTL Cache Expiration)**: Identical message sent after 10,001ms passes deduplication check successfully.

#### Feature 2: Chat Sanitization & 256-Char Chunking (`test/unit/bridge/sanitization.test.ts`)
- **TC1.2.1 (Formatting Strip)**: Strips Minecraft section signs (`§cRed §lBold`) completely without leaving orphan characters.
- **TC1.2.2 (Control Char Cleanse)**: Strips null bytes (`\x00`), escape chars (`\x1B`), and converts newlines to spaces.
- **TC1.2.3 (Mention Resolution)**: Converts `<@12345>` to `@user_12345`, `<#67890>` to `#channel_67890`, and custom emoji to `:emoji_name:`.
- **TC1.2.4 (256-Char Boundary Chunking)**: Breaks a 400-char message into 2 indexed chunks (`[Discord] <User>: [1/2] ...`, `... [2/2] ...`) each strictly $\le 256$ chars.
- **TC1.2.5 (Discord Ping Neutralization)**: Outbound text containing `@everyone` and `@here` is replaced with zero-width space variant `@\u200beveryone`.

#### Feature 3: Bidirectional Chat Bridge Relay (`test/unit/bridge/chatBridge.test.ts`)
- **TC1.3.1 (Discord -> MC Relay)**: Valid user message in bridge channel formats with prefix and enters Minecraft outbound chat queue.
- **TC1.3.2 (Channel Filtering)**: Discord message sent to general or status channel is ignored by the chat bridge.
- **TC1.3.3 (MC -> Discord Relay)**: In-game player chat event triggers `gateway.sendMessage` with `**[Minecraft] <User>** text`.
- **TC1.3.4 (Rate-Limiter Dispatch)**: Multiple queued Minecraft chat packets are dispatched sequentially at configured rate (500ms delay).
- **TC1.3.5 (Death Message Relay)**: `handleMinecraftDeath` formats death event with `💀 **[Minecraft]**` and dispatches to Discord.

#### Feature 4: Live Status Embed Generator (`test/unit/discord/embed.test.ts`)
- **TC1.4.1 (Visual Progress Bars)**: Renders exact 10-segment emoji progress bars for health (`❤️❤️❤️❤️❤️🤍🤍🤍🤍🤍 10.0/20`) and hunger.
- **TC1.4.2 (Health Dynamic Color Tiers)**: Returns Green ($0x2ecc71$) for HP 18, Yellow ($0xf1c40f$) for HP 12, Red ($0xe74c3c$) for HP 5.
- **TC1.4.3 (Offline State Representation)**: Returns Grey ($0x95a5a6$) embed with offline warning when `connected === false`.
- **TC1.4.4 (Coordinates & Dimension Formatting)**: Formats `X: 12.3, Y: 64.0, Z: -45.6 (overworld)` accurately.
- **TC1.4.5 (Inventory & Gear Summary)**: Displays equipped armor, hands, and slot breakdown (`14/36 slots used | 22 free`).

#### Feature 5: Status Embed Throttling & Dirty Checking (`test/unit/discord/embedThrottling.test.ts`)
- **TC1.5.1 (Deterministic Hash Generation)**: Same bot state produces identical SHA-256 hash.
- **TC1.5.2 (Dirty-Check Elimination)**: Manager skips Discord API `updateEmbed` call when state hash has not changed.
- **TC1.5.3 (Coordinate Micro-Jitter Suppression)**: Position shifts $< 0.5$ blocks produce identical state hashes, preventing unnecessary REST calls.
- **TC1.5.4 (5s Interval Throttling)**: Rapid state changes in succession trigger at most one Discord API edit per 5-second tick.
- **TC1.5.5 (Error 10008 Healing)**: When `updateEmbed` throws Discord Error 10008 (Unknown Message), manager sends a new message and updates pinned ID.

#### Feature 6: In-Memory Mocks Verification (`test/unit/mocks/mockGateway.test.ts`)
- **TC1.6.1 (Gateway Message Capture)**: `MockDiscordGateway.sendMessage` records message ID, channel, and embeds.
- **TC1.6.2 (Gateway Embed Edit Capture)**: `updateEmbed` updates target sent message in-memory.
- **TC1.6.3 (Simulate User Message)**: Dispatches simulated message through all registered `onMessage` listeners.
- **TC1.6.4 (Voice Audio Recording)**: `MockVoiceSession.playAudioStream` captures audio buffer chunks and records priority.
- **TC1.6.5 (Voice Inbound Speech Simulation)**: `simulateUserSpeaking` streams PCM buffer into user subscription `PassThrough`.

---

### 6.2 Tier 2: Boundary & Corner Cases ($\ge 5$ cases per feature)

#### Feature 1: Anti-Loopback Boundaries (`test/boundary/antiLoopbackBoundaries.test.ts`)
- **TC2.1.1 (Whitespace Only Messages)**: Strings with only spaces, tabs, or newlines return `drop: true` (`EMPTY_CONTENT`).
- **TC2.1.2 (Exact 256-Character Message)**: Formatted message of exactly 256 characters passes without chunking.
- **TC2.1.3 (257-Character Message)**: Single-character overflow correctly splits into 2 chunks.
- **TC2.1.4 (Max Chunks Cap)**: Gigantic input (>2000 chars) caps at max 3 chunks, discarding residual to prevent chat spam kicks.
- **TC2.1.5 (Rapid Identical Bursts)**: 10 identical messages sent in 50ms pass only the first; the other 9 are rejected by TTL hash.

#### Feature 2: Command Injection Prohibitions (`test/boundary/commandInjection.test.ts`)
- **TC2.2.1 (Leading Slash In Discord)**: Discord input `/kill @a` becomes `[Discord] <User>: /kill @a`, which vanilla parses as chat, not a command.
- **TC2.2.2 (Multiline Injection Attempt)**: Discord input containing `\n/op Hacker` collapses into single-line chat string.
- **TC2.2.3 (Color Code Spam Injection)**: Discord message containing 50 consecutive `§k` or `§0` codes is stripped to empty/clean text.
- **TC2.2.4 (Unicode RTL Override / Zero-Width Spam)**: Strips non-printable ASCII and control codes.
- **TC2.2.5 (Pre-tagged [Discord] Message in Minecraft)**: In-game chat message starting with `[Discord]` is dropped (`DISCORD_PREFIX_ECHO`).

#### Feature 3: Status Embed Edge Values (`test/boundary/embedBoundaries.test.ts`)
- **TC2.3.1 (Health Extreme 0.0)**: HP 0.0 renders 10 empty hearts (`🤍🤍🤍🤍🤍🤍🤍🤍🤍🤍 0.0/20`) with Red color.
- **TC2.3.2 (Health Extreme > 20.0)**: HP 25.0 (Absorption effect) clamps progress bar to 10 filled hearts without bar overflow.
- **TC2.3.3 (Coordinate Extreme Bounds)**: Huge coordinates (`X: 29999999.0, Z: -29999999.0`) format cleanly without NaN.
- **TC2.3.4 (Empty Inventory)**: Used slots 0, free slots 36 formats properly.
- **TC2.3.5 (Discord Rate-Limit Simulation)**: Simulated HTTP 429 backoff causes embed manager to preserve state and retry on subsequent tick.

#### Feature 4: Chat Queue & Memory Boundaries (`test/boundary/bridgeQueueBoundaries.test.ts`)
- **TC2.4.1 (Queue Overflow Dropping)**: When chat queue reaches 50 items, oldest items are dropped, maintaining memory safety.
- **TC2.4.2 (Rapid Bridge Stop/Start)**: Calling `start()` and `stop()` in rapid succession cleans up timers and listeners without leak.
- **TC2.4.3 (Special Characters in Author Name)**: Author with Unicode emojis in Discord username formats safely in Minecraft chat.
- **TC2.4.4 (Zero-Length Minecraft Chat)**: In-game empty chat packet handled without throwing TypeError.
- **TC2.4.5 (High Hash Table Turnover)**: 1,000 unique hashes added over time are pruned by TTL without memory growth.

---

### 6.3 Tier 3: Cross-Feature Combinations

- **TC3.1: Chat Bridge + Triple-Lock Anti-Loopback Roundtrip**:
  1. Discord user sends "Hello Minecraft".
  2. Bridge relays `[Discord] <User>: Hello Minecraft` to Minecraft agent.
  3. Minecraft server broadcasts chat event back to bot.
  4. AntiLoopback identifies both self-username and 10s TTL hash echo.
  5. Bridge drops the echo; zero messages re-posted to Discord channel.
- **TC3.2: Status Embed Dirty Checking + Rapid Minecraft Telemetry Stream**:
  1. Minecraft agent sends 50 status updates in 1 second (e.g. running across terrain).
  2. Embed manager absorbs all 50 updates in memory.
  3. Throttled timer executes once at 5s, computing SHA-256 state hash.
  4. Exactly one `updateEmbed` call is performed to Discord gateway.
- **TC3.3: Mock Gateway Error 10008 + Automatic Re-Pinning**:
  1. Embed manager initializes and pins message `mock_msg_100`.
  2. Test code calls `simulateDeleteMessage('mock_msg_100')` and triggers error.
  3. Embed manager catches Error 10008, creates new status message `mock_msg_101`, and updates stored message ID.
- **TC3.4: Priority Audio Playback + Emergency Preemption in Mock Voice**:
  1. Mock voice session plays NORMAL speech stream (1000 bytes).
  2. Low health alert triggers EMERGENCY stream.
  3. Mock session stops normal playback and starts emergency playback immediately.

---

### 6.4 Tier 4: Real-World Scenarios (End-to-End M1 Lifecycle)

- **Scenario 1: Complete Bidirectional Chat & Anti-Loopback Lifecycle**:
  Simulates a conversation where Discord user Alice types greetings, Minecraft player Bob replies in-game, and server echoes both messages. Validates that Alice's message appears in Minecraft, Bob's message appears in Discord, and no echoes or duplicates occur.
- **Scenario 2: Minecraft Survival Progression & Visual Status Monitoring**:
  Simulates bot joining server (Green HP 20), taking fall damage (Yellow HP 14), starving (Red HP 6), and regenerating back to full health. Asserts embed colors, health bars, and dirty-hash throttling behavior throughout the timeline.
- **Scenario 3: Zero-Secret Offline Integration Suite**:
  Runs entire Milestone 1 suite via `vitest run` with zero environment secrets and zero network calls, verifying 100% pass rate in CI.

---

## 7. Concrete File Delivery Plan

| File | Type | Target Content & Responsibilities |
|---|---|---|
| `src/bridge/types.ts` | Interface Contract | Chat message metadata, chunking options, loopback evaluation models |
| `src/bridge/antiLoopback.ts` | Implementation | `AntiLoopbackFilter` class (Triple-lock check, 10s TTL hash cache, formatting sanitization, 256-char chunker) |
| `src/bridge/chatBridge.ts` | Implementation | `ChatBridge` class (Discord <-> MC relay, leaky-bucket queue, death relay) |
| `src/discord/embed.ts` | Implementation | `buildStatusEmbed`, `generateProgressBar`, `computeStateHash`, `StatusEmbedManager` |
| `test/mocks/mockDiscord.ts` | Test Infrastructure | `MockDiscordGateway` (in-memory `IDiscordGateway`, simulation helpers, error injectors) |
| `test/mocks/mockVoice.ts` | Test Infrastructure | `MockVoiceSession` (in-memory `IVoiceSession`, stream audio recorders, speech simulators) |
| `test/unit/bridge/*.test.ts` | Test Suites | Tier 1 & Tier 2 unit test suites for loopback, sanitization, and chat bridge |
| `test/unit/discord/*.test.ts`| Test Suites | Tier 1 & Tier 2 unit test suites for status embed generation and throttling |
| `test/tier3_combinations/*.test.ts` | Test Suites | Cross-feature combination suites (Bridge + Loopback, Embed + Throttling) |
