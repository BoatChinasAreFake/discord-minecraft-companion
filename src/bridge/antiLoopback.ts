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
