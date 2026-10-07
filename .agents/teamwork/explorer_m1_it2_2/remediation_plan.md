# Remediation Plan: Milestone 1 Iteration 2 (Chat Bridge & Anti-Loopback Filter)

**Author**: Explorer M1 It2 (2) (`explorer_m1_it2_2`)  
**Target Files**:
1. `src/bridge/antiLoopback.ts`
2. `src/bridge/chatBridge.ts`  
**Test Suite**: `test/tier5_adversarial/m1_adversarial.test.ts`, `test/m1/bridge.test.ts`  
**Date**: 2026-10-07  

---

## 1. Executive Summary & Root Cause Analysis

Empirical testing with Vitest on `test/tier5_adversarial/m1_adversarial.test.ts` revealed 6 failing test cases across `AntiLoopbackFilter` and `ChatBridge`:

| Test ID | Subsystem | Severity | Vulnerability / Defect |
|---|---|---|---|
| `ADV-ALF-4` | `AntiLoopbackFilter.chunkForMinecraft` | **CRITICAL** | Massive unbroken payload (e.g. 500 chars) creates chunks of length 331, breaching Minecraft Java's 256-char packet limit and causing server Netty disconnect (`DecoderException`). |
| `ADV-ALF-2` | `AntiLoopbackFilter.sanitizeForDiscord` | **HIGH** | Case-sensitive regexes (`/@everyone/g`, `/@here/g`) miss `@EVERYONE`, `@Here`, etc., allowing in-game players to ping all Discord guild members. |
| `ADV-ALF-11` | `AntiLoopbackFilter.sanitizeForMinecraft` | **LOW** | Modern Minecraft 1.16+ hex color sequences (`§x§f§f§a§a§0§0`) leave `§x` intact due to regex `/§[0-9a-fk-or]/gi` missing the `x` code. |
| `ADV-ALF-12` | `AntiLoopbackFilter.normalizeText` | **MEDIUM** | Invisible zero-width spaces (`\u200B-\u200D\uFEFF`) bypass Lock 3 hash deduplication because regex `\s` does not match zero-width Unicode characters. |
| `ADV-BRG-1` | `ChatBridge.stop` | **MEDIUM** | `this.agent.removeListener('chat', ...)` is never invoked in `stop()`, leaking listeners on `agent` and causing duplicate event handlers across restarts. |
| `ADV-BRG-2` | `ChatBridge.handleDiscordMessage` | **MEDIUM** | Discord username is interpolated raw into `prefix` (`[Discord] <${message.author.username}>:`), allowing Discord users with nicknames containing section signs (e.g. `§4§lADMIN§r`) to inject color and formatting codes into Minecraft chat. |

---

## 2. Precise Code Remediation Proposals

### 2.1 File: `src/bridge/antiLoopback.ts`

#### Fix A: `normalizeText` (Lines 21–28)
- **Problem**: Missing stripping of zero-width characters and modern hex color `§x` prefix.
- **Root Cause**: `\s` does not match `\u200B-\u200D\uFEFF`, and `/§[0-9a-fk-or]/gi` omits `x`.

**Current Implementation**:
```typescript
  public normalizeText(text: string): string {
    return text
      .replace(/§[0-9a-fk-or]/gi, '') // Strip MC formatting codes
      .replace(/[\x00-\x1F\x7F]/g, ' ') // Strip control characters
      .replace(/\s+/g, ' ') // Collapse whitespace
      .trim()
      .toLowerCase();
  }
```

**Proposed Replacement**:
```typescript
  public normalizeText(text: string): string {
    return text
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // Strip zero-width characters (ZWS, ZWNJ, ZWJ, BOM)
      .replace(/§[0-9a-fk-orx]/gi, '') // Strip MC formatting & hex color codes
      .replace(/§/g, '') // Strip any stray section signs
      .replace(/[\x00-\x1F\x7F]/g, ' ') // Strip control characters
      .replace(/\s+/g, ' ') // Collapse whitespace
      .trim()
      .toLowerCase();
  }
```

---

#### Fix B: `sanitizeForMinecraft` (Lines 106–116)
- **Problem**: Section codes in hex color sequences (e.g. `§x§f§f§a§a§0§0`) leave `§x` intact.
- **Root Cause**: The regex `/§[0-9a-fk-or]/gi` does not match the `x` character used in 1.16+ RGB hex color sequences.

**Current Implementation**:
```typescript
  public sanitizeForMinecraft(content: string): string {
    return content
      .replace(/<@!?(\d+)>/g, '@user_$1') // User mentions
      .replace(/<#(\d+)>/g, '#channel_$1') // Channel mentions
      .replace(/<@&(\d+)>/g, '@role_$1') // Role mentions
      .replace(/<a?:(\w+):\d+>/g, ':$1:') // Custom emojis
      .replace(/§[0-9a-fk-or]/gi, '') // Section signs
      .replace(/[\r\n\t]+/g, ' ') // Replace newlines/tabs with space
      .replace(/[\x00-\x1F\x7F]/g, '') // Strip control characters
      .trim();
  }
```

**Proposed Replacement**:
```typescript
  public sanitizeForMinecraft(content: string): string {
    return content
      .replace(/<@!?(\d+)>/g, '@user_$1') // User mentions
      .replace(/<#(\d+)>/g, '#channel_$1') // Channel mentions
      .replace(/<@&(\d+)>/g, '@role_$1') // Role mentions
      .replace(/<a?:(\w+):\d+>/g, ':$1:') // Custom emojis
      .replace(/§[0-9a-fk-orx]/gi, '') // Strip section signs & hex color codes
      .replace(/§/g, '') // Strip any stray section signs
      .replace(/[\r\n\t]+/g, ' ') // Replace newlines/tabs with space
      .replace(/[\x00-\x1F\x7F]/g, '') // Strip control characters
      .trim();
  }
```

---

#### Fix C: `sanitizeForDiscord` (Lines 118–122)
- **Problem**: Case-sensitive matching allows `@EVERYONE`, `@Everyone`, `@HERE`, `@Here`, etc. to bypass ping neutralization.
- **Root Cause**: Regular expressions `/g` lack the `/i` case-insensitive flag.

**Current Implementation**:
```typescript
  public sanitizeForDiscord(content: string): string {
    return content
      .replace(/@everyone/g, '@\u200beveryone')
      .replace(/@here/g, '@\u200bhere');
  }
```

**Proposed Replacement**:
```typescript
  public sanitizeForDiscord(content: string): string {
    return content
      .replace(/@everyone/gi, '@\u200beveryone')
      .replace(/@here/gi, '@\u200bhere');
  }
```

---

#### Fix D: `chunkForMinecraft` (Lines 128–170)
- **Problem**: When encountering unbroken strings (e.g. 500-char continuous tokens without spaces), the single word is sliced once, but the remaining 289 characters in `currentChunk` are pushed directly to `chunks` without further slicing, generating a 331-character chunk.
- **Root Cause**: Lack of a slicing loop for unbroken tokens, and lack of length clamping before pushing `currentChunk` into the final chunks array.
- **Mathematical Invariant**:
  - Each chunk is formatted as: `${prefix} [${idx + 1}/${total}] ${chunk}` (or `${prefix} ${chunk}` if total is 1).
  - For `total <= 3`, the tag ` [${idx + 1}/${total}] ` is at most 7 characters (e.g. `" [1/3] "`).
  - By reserving `tagOverhead = 8` characters, `maxChunkLen = Math.max(1, maxLen - prefix.length - tagOverhead)`.
  - Slicing every token so `chunk.length <= maxChunkLen` mathematically guarantees that:
    `formattedChunk.length <= prefix.length + 7 + (maxLen - prefix.length - 8) = maxLen - 1 < maxLen <= 256`.

**Current Implementation**:
```typescript
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
          const sliceLen = Math.max(1, maxLen - prefix.length - 12);
          chunks.push(word.slice(0, sliceLen));
          currentChunk = word.slice(sliceLen);
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
```

**Proposed Replacement**:
```typescript
  public chunkForMinecraft(prefix: string, message: string, maxLen = 256): string[] {
    const fullMessage = `${prefix} ${message}`.trim();
    if (fullMessage.length <= maxLen) {
      return [fullMessage];
    }

    const chunks: string[] = [];
    const maxChunks = 3; // Prevent spamming chat if user pastes huge text
    const tagOverhead = 8; // Reserved for indexing tags like " [1/3] "
    const maxChunkLen = Math.max(1, maxLen - prefix.length - tagOverhead);
    const words = message.trim().split(/\s+/);
    let currentChunk = '';

    for (const word of words) {
      if (!word) continue;
      if (chunks.length >= maxChunks) break;

      if (word.length > maxChunkLen) {
        // If currentChunk already has content, flush it first
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = '';
          if (chunks.length >= maxChunks) break;
        }

        // Hard-slice unbroken token in chunks of maxChunkLen
        let remaining = word;
        while (remaining.length > maxChunkLen && chunks.length < maxChunks - 1) {
          chunks.push(remaining.slice(0, maxChunkLen));
          remaining = remaining.slice(maxChunkLen);
        }

        if (chunks.length >= maxChunks) break;

        // On the final chunk slot, clamp the remaining text to maxChunkLen
        if (remaining.length > maxChunkLen) {
          currentChunk = remaining.slice(0, maxChunkLen);
        } else {
          currentChunk = remaining;
        }
      } else {
        const candidate = currentChunk ? `${currentChunk} ${word}` : word;
        if (candidate.length <= maxChunkLen) {
          currentChunk = candidate;
        } else {
          if (currentChunk) {
            chunks.push(currentChunk);
          }
          currentChunk = word;
          if (chunks.length >= maxChunks) {
            currentChunk = '';
            break;
          }
        }
      }
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
```

---

### 2.2 File: `src/bridge/chatBridge.ts`

#### Fix E: Event Listener Cleanup in `stop()` (Lines 47–57)
- **Problem**: `ChatBridge.stop()` cancels timers and clears queues, but does not remove `boundMinecraftHandler` from `this.agent`.
- **Root Cause**: `this.agent.removeListener('chat', this.boundMinecraftHandler)` was omitted.

**Current Implementation**:
```typescript
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
```

**Proposed Replacement**:
```typescript
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
```

---

#### Fix F: Sanitize Discord Username in Minecraft Chat Prefix (Lines 80–86)
- **Problem**: `message.author.username` is interpolated raw into `prefix`, permitting section codes `§` in Discord server nicknames to be transmitted to Minecraft server chat.
- **Root Cause**: Missing call to `this.filter.sanitizeForMinecraft(message.author.username)` when constructing `prefix`.

**Current Implementation**:
```typescript
    // Sanitize message content
    const sanitizedContent = this.filter.sanitizeForMinecraft(message.content);
    if (!sanitizedContent) return;

    const prefix = `[Discord] <${message.author.username}>:`;
    const chunks = this.filter.chunkForMinecraft(prefix, sanitizedContent);
```

**Proposed Replacement**:
```typescript
    // Sanitize message content
    const sanitizedContent = this.filter.sanitizeForMinecraft(message.content);
    if (!sanitizedContent) return;

    const cleanUsername = this.filter.sanitizeForMinecraft(message.author.username) || 'User';
    const prefix = `[Discord] <${cleanUsername}>:`;
    const chunks = this.filter.chunkForMinecraft(prefix, sanitizedContent);
```

---

## 3. Full Proposed Replacement Files

For ease of inspection and application by the implementing worker, full drop-in replacements for both files are provided below:

### Proposed Replacement: `src/bridge/antiLoopback.ts`
```typescript
import { createHash } from 'crypto';
import type { AntiLoopbackOptions, InboundMessageMeta, DropEvaluation } from './types.js';

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
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // Strip zero-width characters (ZWS, ZWNJ, ZWJ, BOM)
      .replace(/§[0-9a-fk-orx]/gi, '') // Strip MC formatting & hex color codes
      .replace(/§/g, '') // Strip any stray section signs
      .replace(/[\x00-\x1F\x7F]/g, ' ') // Strip control characters
      .replace(/\s+/g, ' ') // Collapse whitespace
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

  public getCacheSize(): number {
    this.pruneExpired();
    return this.hashCache.size;
  }

  // --------------------------------------------------------------------------
  // Formatting & Sanitization Helpers
  // --------------------------------------------------------------------------

  public sanitizeForMinecraft(content: string): string {
    return content
      .replace(/<@!?(\d+)>/g, '@user_$1') // User mentions
      .replace(/<#(\d+)>/g, '#channel_$1') // Channel mentions
      .replace(/<@&(\d+)>/g, '@role_$1') // Role mentions
      .replace(/<a?:(\w+):\d+>/g, ':$1:') // Custom emojis
      .replace(/§[0-9a-fk-orx]/gi, '') // Strip section signs & hex color codes
      .replace(/§/g, '') // Strip any stray section signs
      .replace(/[\r\n\t]+/g, ' ') // Replace newlines/tabs with space
      .replace(/[\x00-\x1F\x7F]/g, '') // Strip control characters
      .trim();
  }

  public sanitizeForDiscord(content: string): string {
    return content
      .replace(/@everyone/gi, '@\u200beveryone')
      .replace(/@here/gi, '@\u200bhere');
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
    const tagOverhead = 8; // Reserved for indexing: e.g. " [1/3] "
    const maxChunkLen = Math.max(1, maxLen - prefix.length - tagOverhead);
    const words = message.trim().split(/\s+/);
    let currentChunk = '';

    for (const word of words) {
      if (!word) continue;
      if (chunks.length >= maxChunks) break;

      if (word.length > maxChunkLen) {
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = '';
          if (chunks.length >= maxChunks) break;
        }

        let remaining = word;
        while (remaining.length > maxChunkLen && chunks.length < maxChunks - 1) {
          chunks.push(remaining.slice(0, maxChunkLen));
          remaining = remaining.slice(maxChunkLen);
        }

        if (chunks.length >= maxChunks) break;

        if (remaining.length > maxChunkLen) {
          currentChunk = remaining.slice(0, maxChunkLen);
        } else {
          currentChunk = remaining;
        }
      } else {
        const candidate = currentChunk ? `${currentChunk} ${word}` : word;
        if (candidate.length <= maxChunkLen) {
          currentChunk = candidate;
        } else {
          if (currentChunk) {
            chunks.push(currentChunk);
          }
          currentChunk = word;
          if (chunks.length >= maxChunks) {
            currentChunk = '';
            break;
          }
        }
      }
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

### Proposed Replacement: `src/bridge/chatBridge.ts`
```typescript
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
```

---

## 4. Verification Method

To verify these changes independently once applied:

1. **TypeScript Build Check**:
   ```bash
   node ./node_modules/typescript/bin/tsc --noEmit
   ```
   Must pass cleanly with zero compiler warnings or errors.

2. **Milestone 1 Baseline Test Suite**:
   ```bash
   node ./node_modules/vitest/vitest.mjs run test/m1/bridge.test.ts
   ```
   Must pass all 14 tests (TC-ALF-1 to TC-ALF-10, TC-BRG-1 to TC-BRG-4).

3. **Adversarial Test Suite (Chat Bridge & Anti-Loopback section)**:
   ```bash
   node ./node_modules/vitest/vitest.mjs run test/tier5_adversarial/m1_adversarial.test.ts
   ```
   All 6 bridge tests (`ADV-ALF-2`, `ADV-ALF-4`, `ADV-ALF-11`, `ADV-ALF-12`, `ADV-BRG-1`, `ADV-BRG-2`) will pass 100%.
