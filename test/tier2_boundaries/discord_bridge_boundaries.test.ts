import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AntiLoopbackFilter } from '../../src/bridge/antiLoopback.js';
import { ChatBridge } from '../../src/bridge/chatBridge.js';
import { StatusEmbedManager, computeStateHash } from '../../src/discord/embed.js';
import { RBACService, RBACTier } from '../../src/discord/rbac.js';
import { MockDiscordGateway } from '../mocks/mockDiscord.js';
import type { MinecraftBotStatus } from '../../src/minecraft/types.js';
import type { AppConfig } from '../../src/config/types.js';

describe('Tier 2: Discord Bridge & RBAC Boundaries (T2-BRG-01 to T2-BRG-13)', () => {
  let filter: AntiLoopbackFilter;
  let mockDiscord: MockDiscordGateway;
  let rbacService: RBACService;
  let dummyConfig: AppConfig;

  beforeEach(() => {
    filter = new AntiLoopbackFilter({
      botDiscordId: 'bot_discord_123',
      botMinecraftUsername: 'CompanionBot',
      ttlMs: 10_000,
    });

    mockDiscord = new MockDiscordGateway({
      botUserId: 'bot_discord_123',
      chatBridgeChannelId: 'bridge_channel_1',
      statusChannelId: 'status_channel_1',
    });

    dummyConfig = {
      discord: {
        token: 'mock-token',
        clientId: 'bot_discord_123',
        guildId: 'guild_1',
        chatBridgeChannelId: 'bridge_channel_1',
        statusChannelId: 'status_channel_1',
        voiceChannelId: 'voice_1',
      },
      minecraft: {
        host: 'localhost',
        port: 25565,
        username: 'CompanionBot',
      },
      gemini: {
        apiKey: 'mock-key',
        model: 'gemini-3.8-flash',
      },
      rbac: {
        adminUserIds: ['admin_user_1'],
        adminRoleIds: ['admin_role_1'],
        allowedUserIds: ['op_user_1'],
        allowedRoleIds: ['op_role_1'],
      },
      tts: { provider: 'mock' },
      stt: { provider: 'mock' },
    };

    rbacService = new RBACService(dummyConfig);
  });

  // --------------------------------------------------------------------------
  // Chat Chunking Invariants (T2-BRG-01 to T2-BRG-04)
  // --------------------------------------------------------------------------
  describe('Minecraft Chat Chunking Boundaries <= 256 Chars (T2-BRG-01 to T2-BRG-04)', () => {
    it('T2-BRG-01: exactly 256-character message produces exactly 1 chunk of length <= 256', () => {
      const prefix = '[Discord] <User>:';
      const availableMsgLen = 256 - prefix.length - 1;
      const message = 'A'.repeat(availableMsgLen);

      const chunks = filter.chunkForMinecraft(prefix, message, 256);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].length).toBeLessThanOrEqual(256);
      expect(chunks[0]).toBe(`${prefix} ${message}`);
    });

    it('T2-BRG-02: 257-character message overflows into 2 valid chunks without exceeding 256 chars', () => {
      const prefix = '[Discord] <User>:';
      const availableMsgLen = 256 - prefix.length; // 1 char past boundary
      const message = 'word '.repeat(Math.ceil(availableMsgLen / 5));

      const chunks = filter.chunkForMinecraft(prefix, message, 256);
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(256);
        expect(chunk.startsWith(prefix)).toBe(true);
      }
    });

    it('T2-BRG-03: massive 1000-character wall of text is safely chunked within the 256-char limit', () => {
      const prefix = '[Discord] <Alice>:';
      const longMessage = 'The quick brown fox jumps over the lazy dog repeatedly and continues without stopping '.repeat(12);

      const chunks = filter.chunkForMinecraft(prefix, longMessage, 256);
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks.length).toBeLessThanOrEqual(3); // Cap at maxChunks (3) to prevent flood

      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(256);
        expect(chunk.startsWith(prefix)).toBe(true);
      }
    });

    it('T2-BRG-04: multibyte UTF-8 emojis at the 255-character boundary are preserved intact', () => {
      const prefix = '[Discord] <User>:';
      // Pad string right up to boundary, then place 4-byte UTF-8 emoji
      const pad = 'x'.repeat(220);
      const messageWithEmojis = `${pad} 🎮 ⚔️ 🛡️ 🔥 💎`;

      const chunks = filter.chunkForMinecraft(prefix, messageWithEmojis, 256);
      expect(chunks.length).toBeGreaterThanOrEqual(1);

      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(256);
        // Verify no split surrogate pairs or broken characters
        expect(chunk).not.toContain('\uFFFD'); // Unicode replacement char
      }

      // Check emoji preserved in the output
      const combined = chunks.join(' ');
      expect(combined).toContain('🎮');
    });
  });

  // --------------------------------------------------------------------------
  // Status Embed Throttling & Hash Suppression (T2-BRG-05 to T2-BRG-07)
  // --------------------------------------------------------------------------
  describe('Status Embed Throttling & Self-Healing (T2-BRG-05 to T2-BRG-07)', () => {
    const dummyStatus: MinecraftBotStatus = {
      connected: true,
      username: 'CompanionBot',
      health: 20,
      food: 20,
      position: { x: 10, y: 64, z: -20 },
      dimension: 'overworld',
      currentTask: 'Idle',
      gear: {
        mainHand: 'diamond_sword',
        offHand: 'shield',
        armorSummary: 'iron_armor',
      },
      inventory: {
        usedSlots: 5,
        totalSlots: 36,
        freeSlots: 31,
      },
      server: {
        host: 'localhost',
        port: 25565,
        ping: 15,
      },
    };

    it('T2-BRG-05: skips duplicate updates when state hash is identical (dirty-state hash suppression)', async () => {
      const updateSpy = vi.spyOn(mockDiscord, 'updateEmbed').mockResolvedValue(undefined);
      const sendSpy = vi.spyOn(mockDiscord, 'sendMessage');

      const manager = new StatusEmbedManager(mockDiscord, {
        statusChannelId: 'status_channel_1',
        pinnedMessageId: 'pinned_msg_101',
      });

      manager.updateState(dummyStatus);

      // First tick executes
      const firstTick = await manager.tick();
      expect(firstTick).toBe(true);
      expect(updateSpy).toHaveBeenCalledTimes(1);

      // Second tick with identical state is suppressed!
      const secondTick = await manager.tick();
      expect(secondTick).toBe(false);
      expect(updateSpy).toHaveBeenCalledTimes(1); // No additional API calls
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('T2-BRG-06: computes deterministic state hashes and detects micro-changes', () => {
      const hash1 = computeStateHash(dummyStatus);
      const hash2 = computeStateHash({ ...dummyStatus });
      expect(hash1).toBe(hash2);

      // Micro-change: health drops by 1
      const changedStatus: MinecraftBotStatus = {
        ...dummyStatus,
        health: 19.0,
      };
      const hashChanged = computeStateHash(changedStatus);
      expect(hashChanged).not.toBe(hash1);
    });

    it('T2-BRG-07: self-heals from Discord Error 10008 (Unknown Message) by creating a new status pin', async () => {
      // Mock updateEmbed throwing Discord error 10008
      mockDiscord.updateEmbed = vi.fn().mockImplementation(async () => {
        const err: any = new Error('Unknown Message');
        err.code = 10008;
        throw err;
      });

      const sendSpy = vi.spyOn(mockDiscord, 'sendMessage').mockResolvedValue('new_pinned_msg_202');

      const manager = new StatusEmbedManager(mockDiscord, {
        statusChannelId: 'status_channel_1',
        pinnedMessageId: 'stale_deleted_msg_1',
      });

      manager.updateState(dummyStatus);

      // Tick encounters 10008 error and recovers by calling sendMessage
      const success = await manager.tick();
      expect(success).toBe(true);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(manager.getCurrentMessageId()).toBe('new_pinned_msg_202');
    });
  });

  // --------------------------------------------------------------------------
  // Anti-Loopback Filter TTL Boundaries (T2-BRG-08 to T2-BRG-10)
  // --------------------------------------------------------------------------
  describe('Anti-Loopback Filter TTL Boundaries (T2-BRG-08 to T2-BRG-10)', () => {
    it('T2-BRG-08: drops identical outbound message returned within 10s TTL', () => {
      const text = 'Exploring caves near spawn';
      filter.recordOutbound(text);

      const evalResult = filter.evaluate({
        source: 'discord',
        authorId: 'other_user_1',
        isBotAccount: false,
        content: text,
      });

      expect(evalResult.drop).toBe(true);
      expect(evalResult.reason).toBe('DUPLICATE_TTL_HASH');
    });

    it('T2-BRG-09: allows message after 10s TTL expiration window passes', () => {
      const text = 'Status update at base';
      filter.recordOutbound(text);

      // Mock time advancement beyond 10s TTL
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + 11_000);

      const evalResult = filter.evaluate({
        source: 'discord',
        authorId: 'other_user_1',
        isBotAccount: false,
        content: text,
      });

      expect(evalResult.drop).toBe(false);

      vi.restoreAllMocks();
    });

    it('T2-BRG-10: drops empty and whitespace-only Discord chat without relaying', async () => {
      const mockAgent = {
        on: vi.fn(),
        sendChat: vi.fn(),
      };

      const bridge = new ChatBridge(
        mockDiscord,
        mockAgent as any,
        {
          bridgeChannelId: 'bridge_channel_1',
          botDiscordId: 'bot_discord_123',
          botMinecraftUsername: 'CompanionBot',
        },
        filter
      );
      bridge.start();

      await bridge.handleDiscordMessage({
        id: 'msg_empty_1',
        channelId: 'bridge_channel_1',
        author: { id: 'user_1', username: 'Alice', bot: false },
        content: '   \t\n  ',
      });

      expect(mockAgent.sendChat).not.toHaveBeenCalled();
      bridge.stop();
    });
  });

  // --------------------------------------------------------------------------
  // RBAC Access Control Boundaries (T2-BRG-11 to T2-BRG-13)
  // --------------------------------------------------------------------------
  describe('RBAC Access Control Boundaries (T2-BRG-11 to T2-BRG-13)', () => {
    it('T2-BRG-11: denies OPERATOR and ADMIN in null context (e.g. DM without guild or member)', () => {
      const user = { id: 'random_user_1', username: 'DirectMessenger' } as any;

      const opCheck = rbacService.check(null, user, RBACTier.OPERATOR, null);
      expect(opCheck.allowed).toBe(false);
      expect(opCheck.reason).toContain('Permission Denied');

      const adminCheck = rbacService.check(null, user, RBACTier.ADMIN, null);
      expect(adminCheck.allowed).toBe(false);

      // VIEWER tier is universally allowed even in DMs
      const viewerCheck = rbacService.check(null, user, RBACTier.VIEWER, null);
      expect(viewerCheck.allowed).toBe(true);
    });

    it('T2-BRG-12: protects against undefined/null ownerId vulnerability', () => {
      const attacker = { id: 'attacker_user_id', username: 'Attacker' } as any;
      const guildWithNullOwner = { id: 'guild_1', ownerId: undefined } as any;

      const result = rbacService.check(null, attacker, RBACTier.ADMIN, guildWithNullOwner);
      expect(result.allowed).toBe(false);
      expect(result.userTier).toBe(RBACTier.VIEWER);
    });

    it('T2-BRG-13: denies access when member role does not match required tier (viewer role attempting OPERATOR)', () => {
      const member = {
        roles: ['viewer_role_99'], // Not in allowedRoleIds ['op_role_1']
      } as any;
      const user = { id: 'regular_viewer_1', username: 'Viewer' } as any;

      const result = rbacService.check(member, user, RBACTier.OPERATOR);
      expect(result.allowed).toBe(false);
      expect(result.userTier).toBe(RBACTier.VIEWER);
      expect(result.reason).toContain('Permission Denied');
    });
  });
});
