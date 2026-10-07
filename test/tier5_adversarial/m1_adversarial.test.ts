import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { AntiLoopbackFilter } from '../../src/bridge/antiLoopback.js';
import { ChatBridge } from '../../src/bridge/chatBridge.js';
import { RBACService, RBACTier } from '../../src/discord/rbac.js';
import { StatusEmbedManager, computeStateHash } from '../../src/discord/embed.js';
import type { IDiscordGateway } from '../../src/discord/types.js';
import type { IMinecraftChatAgent } from '../../src/bridge/types.js';
import type { AppConfig } from '../../src/config/types.js';
import type { MinecraftBotStatus } from '../../src/minecraft/types.js';

function createMockConfig(overrides?: Partial<AppConfig['rbac']>): AppConfig {
  return {
    discord: {
      token: 'mock_token',
      clientId: 'bot_discord_123',
      chatBridgeChannelId: 'bridge_chan_100',
    },
    rbac: {
      allowedRoleIds: ['op_role_1', 'op_role_2'],
      allowedUserIds: ['op_user_1'],
      adminRoleIds: ['admin_role_1'],
      adminUserIds: ['admin_user_1'],
      ...overrides,
    },
    minecraft: {
      host: 'localhost',
      port: 25565,
      username: 'SurvivalBot',
      version: '1.20.4',
      auth: 'offline',
    },
    gemini: {
      apiKey: 'key',
      model: 'gemini-3.8-flash',
      maxToolSteps: 5,
    },
    audio: {
      sttSilenceDurationMs: 500,
      minUtteranceMs: 200,
      maxUtteranceMs: 15000,
      ttsVoiceName: 'en-US-Standard-C',
    },
    status: {
      embedIntervalSec: 5,
    },
    runtime: {
      nodeEnv: 'test',
      logLevel: 'info',
      mockAll: true,
    },
  };
}

function createDummyStatus(overrides?: Partial<MinecraftBotStatus>): MinecraftBotStatus {
  return {
    connected: true,
    username: 'SurvivalBot',
    health: 20,
    food: 20,
    position: { x: 100.0, y: 64.0, z: -200.0 },
    dimension: 'overworld',
    currentTask: 'Idle',
    gear: {
      mainHand: 'Diamond Sword',
      offHand: 'Shield',
      armorSummary: 'Diamond Armor',
    },
    inventory: {
      usedSlots: 10,
      totalSlots: 36,
      freeSlots: 26,
    },
    server: {
      host: 'localhost',
      port: 25565,
      ping: 10,
    },
    ...overrides,
  };
}

// ============================================================================
// SUITE 1: AntiLoopbackFilter Adversarial Tests
// ============================================================================
describe('Adversarial Challenge: AntiLoopbackFilter', () => {
  let filter: AntiLoopbackFilter;

  beforeEach(() => {
    filter = new AntiLoopbackFilter({
      botDiscordId: 'bot_discord_123',
      botMinecraftUsername: 'SurvivalBot',
      ttlMs: 10_000,
    });
  });

  describe('1.1 @everyone and @here Injection Tests', () => {
    it('ADV-ALF-1: sanitizes exact lowercase @everyone and @here', () => {
      const sanitized = filter.sanitizeForDiscord('Hey @everyone and @here!');
      expect(sanitized).toBe('Hey @\u200beveryone and @\u200bhere!');
    });

    it('ADV-ALF-2: [VULNERABILITY PROBE] checks uppercase and mixed-case @everyone and @here', () => {
      const inputs = [
        'Alert @EVERYONE now!',
        'Warning @Everyone look out!',
        'Check @HERE right now!',
        'Listen @Here please!',
        'Ping @eVeRyOnE alert!',
      ];

      for (const input of inputs) {
        const sanitized = filter.sanitizeForDiscord(input);
        // An adversarial bypass occurs if raw @EVERYONE or @Everyone survives without zero-width space
        const hasUnsanitizedEveryone = /@(everyone|here)/i.test(sanitized) && !/@\u200b(everyone|here)/i.test(sanitized);
        expect(hasUnsanitizedEveryone, `Failed to sanitize case variant in: ${input} -> ${sanitized}`).toBe(false);
      }
    });
  });

  describe('1.2 256-Character Boundary & Split Invariants', () => {
    it('ADV-ALF-3: handles messages exactly at 255, 256, and 257 characters with prefix', () => {
      const prefix = '[Discord] <User>:';
      // Test exact boundaries
      for (const len of [255 - prefix.length - 1, 256 - prefix.length - 1, 257 - prefix.length - 1]) {
        const msg = 'x'.repeat(len);
        const chunks = filter.chunkForMinecraft(prefix, msg, 256);
        for (const chunk of chunks) {
          expect(chunk.length).toBeLessThanOrEqual(256);
        }
      }
    });

    it('ADV-ALF-4: [VULNERABILITY PROBE] splits single massive unbroken token (no spaces) <= 256 chars', () => {
      const prefix = '[Discord] <VeryLongUsername12345>:';
      // 500 characters of unbroken continuous text (e.g. pasted URL, hex string, or attack payload)
      const unbrokenPayload = 'A'.repeat(500);
      const chunks = filter.chunkForMinecraft(prefix, unbrokenPayload, 256);

      expect(chunks.length).toBeGreaterThan(0);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        expect(
          chunk.length,
          `Chunk [${i + 1}/${chunks.length}] exceeded 256 characters! Length: ${chunk.length}, content: "${chunk.slice(0, 30)}..."`
        ).toBeLessThanOrEqual(256);
      }
    });

    it('ADV-ALF-5: [VULNERABILITY PROBE] enforces maxLen on all chunks with long prefixes and multiple words', () => {
      const prefix = '[Discord] <PlayerWithLongName>:';
      const words = ['W'.repeat(120), 'W'.repeat(130), 'W'.repeat(140)];
      const message = words.join(' ');
      const chunks = filter.chunkForMinecraft(prefix, message, 256);

      for (let i = 0; i < chunks.length; i++) {
        expect(
          chunks[i].length,
          `Chunk [${i + 1}/${chunks.length}] length ${chunks[i].length} exceeds 256!`
        ).toBeLessThanOrEqual(256);
      }
    });
  });

  describe('1.3 Unicode Tricks and Normalization', () => {
    it('ADV-ALF-6: detects loopback when message contains Minecraft section codes (§a, §l, etc.)', () => {
      filter.recordOutbound('Server restarting soon');
      const inboundFromMC = {
        source: 'minecraft' as const,
        authorUsername: 'Server',
        content: '§c§lServer §r§crestarting soon',
      };
      const result = filter.evaluate(inboundFromMC);
      expect(result.drop).toBe(true);
      expect(result.reason).toBe('DUPLICATE_TTL_HASH');
    });

    it('ADV-ALF-7: strips control characters and newlines during sanitization', () => {
      const dirty = 'Hello\x00\x07\x1F World\r\n\tNew line';
      const clean = filter.sanitizeForMinecraft(dirty);
      expect(clean).toBe('Hello World New line');
    });

    it('ADV-ALF-8: handles Unicode homoglyphs and zero-width spaces in deduplication', () => {
      // Outbound message with regular spaces
      filter.recordOutbound('test message');
      // Inbound message with multiple spaces collapsed
      const inbound = {
        source: 'minecraft' as const,
        authorUsername: 'Player1',
        content: 'test    message',
      };
      const result = filter.evaluate(inbound);
      expect(result.drop).toBe(true);
      expect(result.reason).toBe('DUPLICATE_TTL_HASH');
    });
  });

  describe('1.4 Flood Message & Leaky Bucket Resilience', () => {
    it('ADV-ALF-9: deduplicates rapid identical flood messages', () => {
      const text = 'Spam flood message';
      filter.recordOutbound(text);

      for (let i = 0; i < 500; i++) {
        const evalRes = filter.evaluate({
          source: 'minecraft',
          authorUsername: `Attacker_${i}`,
          content: text,
        });
        expect(evalRes.drop).toBe(true);
        expect(evalRes.reason).toBe('DUPLICATE_TTL_HASH');
      }
    });

    it('ADV-ALF-11: [VULNERABILITY PROBE] checks Minecraft 1.16+ hex color codes (§x) stripping in sanitizeForMinecraft', () => {
      const hexColored = '§x§f§f§a§a§0§0Golden Text';
      const clean = filter.sanitizeForMinecraft(hexColored);
      expect(clean.includes('§'), `Failed to strip section sign from hex color: ${clean}`).toBe(false);
    });

    it('ADV-ALF-12: [VULNERABILITY PROBE] zero-width space normalization for deduplication', () => {
      const normal = 'diamonds here';
      const withZws = 'd\u200biamonds here';
      expect(
        filter.normalizeText(withZws),
        `Zero-width space survived normalization: "${filter.normalizeText(withZws)}"`
      ).toBe(filter.normalizeText(normal));
    });
  });
});

// ============================================================================
// SUITE 1.5: ChatBridge Lifecycle & Formatting Adversarial Tests
// ============================================================================
describe('Adversarial Challenge: ChatBridge Lifecycle & Formatting', () => {
  it('ADV-BRG-1: [VULNERABILITY PROBE] stops listeners from leaking on stop()', () => {
    const { EventEmitter } = require('events');
    const agent = new EventEmitter();
    agent.sendChat = vi.fn();
    const gateway: IDiscordGateway = {
      registerCommands: vi.fn(),
      sendMessage: vi.fn(),
      updateEmbed: vi.fn(),
      joinVoice: vi.fn(),
      leaveVoice: vi.fn(),
      onCommand: vi.fn(),
      onMessage: vi.fn(),
    };

    const bridge = new ChatBridge(gateway, agent as any, {
      bridgeChannelId: 'chan_1',
      botDiscordId: 'bot_1',
      botMinecraftUsername: 'Bot',
    });

    expect(agent.listenerCount('chat')).toBe(0);
    bridge.start();
    expect(agent.listenerCount('chat')).toBe(1);
    bridge.stop();
    // After stop, listener must be cleaned up to prevent memory leaks and duplicate handlers!
    expect(
      agent.listenerCount('chat'),
      'CRITICAL: Chat listener was not removed on bridge.stop(), causing memory leak and duplicate handlers on restart!'
    ).toBe(0);
  });

  it('ADV-BRG-2: [VULNERABILITY PROBE] Discord username Minecraft formatting code injection', async () => {
    let sentToMinecraft: string[] = [];
    const agent: IMinecraftChatAgent = {
      sendChat: vi.fn().mockImplementation(async (msg: string) => {
        sentToMinecraft.push(msg);
      }),
      on: vi.fn(),
    };

    let discordHandler: ((msg: any) => Promise<void>) | null = null;
    const gateway: IDiscordGateway = {
      registerCommands: vi.fn(),
      sendMessage: vi.fn(),
      updateEmbed: vi.fn(),
      joinVoice: vi.fn(),
      leaveVoice: vi.fn(),
      onCommand: vi.fn(),
      onMessage: vi.fn().mockImplementation((handler) => {
        discordHandler = handler;
      }),
    };

    const bridge = new ChatBridge(gateway, agent, {
      bridgeChannelId: 'chan_1',
      botDiscordId: 'bot_1',
      botMinecraftUsername: 'Bot',
      rateLimitDelayMs: 10,
    });

    bridge.start();

    // Attacker has Discord username containing Minecraft formatting / color codes
    await discordHandler!({
      channelId: 'chan_1',
      author: { id: 'user_malicious', username: '§4§lADMIN§r', bot: false },
      content: 'I am the server admin!',
    });

    // Wait for queue flush
    await new Promise((r) => setTimeout(r, 30));

    expect(sentToMinecraft.length).toBe(1);
    // The username section signs MUST be sanitized before dispatching to Minecraft chat
    expect(
      sentToMinecraft[0].includes('§'),
      `Username allowed Minecraft section code injection into Minecraft chat: "${sentToMinecraft[0]}"`
    ).toBe(false);

    bridge.stop();
  });
});

// ============================================================================
// SUITE 2: RBACService Adversarial Tests
// ============================================================================
describe('Adversarial Challenge: RBACService', () => {
  let rbac: RBACService;

  beforeEach(() => {
    rbac = new RBACService(createMockConfig());
  });

  describe('2.1 Role Spoofing & Prototype Attacks', () => {
    it('ADV-RBAC-1: rejects role spoofing via malformed APIInteractionGuildMember roles array', () => {
      const maliciousMember = {
        roles: ['fake_role', 'admin_role_1_attempt', '__proto__', 'constructor'],
      } as any;
      const user = { id: 'attacker_1', username: 'Attacker' } as any;

      const result = rbac.check(maliciousMember, user, RBACTier.ADMIN);
      expect(result.allowed).toBe(false);
      expect(result.userTier).toBe(RBACTier.VIEWER);
    });

    it('ADV-RBAC-2: handles roles object without cache gracefully without throwing', () => {
      const weirdMember = {
        roles: {
          notCache: ['admin_role_1'],
        },
      } as any;
      const user = { id: 'user_1', username: 'Normal' } as any;

      const result = rbac.check(weirdMember, user, RBACTier.OPERATOR);
      expect(result.allowed).toBe(false);
      expect(result.userTier).toBe(RBACTier.VIEWER);
    });

    it('ADV-RBAC-3: handles roles as null, undefined, number, or boolean', () => {
      const user = { id: 'user_2', username: 'Normal' } as any;
      for (const invalidRoles of [null, undefined, 12345, true, 'admin_role_1']) {
        const member = { roles: invalidRoles } as any;
        const result = rbac.check(member, user, RBACTier.OPERATOR);
        expect(result.allowed).toBe(false);
      }
    });
  });

  describe('2.2 Edge Bitfields & Permission Spoofing', () => {
    it('ADV-RBAC-4: handles edge bitfields: 0n, -1n, large bitfields, string numbers', () => {
      const user = { id: 'user_3', username: 'EdgeUser' } as any;

      // 0n -> No permissions
      const member0 = { permissions: { bitfield: 0n } } as any;
      expect(rbac.check(member0, user, RBACTier.ADMIN).allowed).toBe(false);

      // Exact Administrator flag (1n << 3n = 8n)
      const memberAdmin = { permissions: { bitfield: PermissionFlagsBits.Administrator } } as any;
      expect(rbac.check(memberAdmin, user, RBACTier.ADMIN).allowed).toBe(true);

      // Bitfield with Administrator among other bits
      const memberAdminPlus = {
        permissions: { bitfield: PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageGuild },
      } as any;
      expect(rbac.check(memberAdminPlus, user, RBACTier.ADMIN).allowed).toBe(true);

      // String representation of bitfield
      const memberString = {
        permissions: { bitfield: String(PermissionFlagsBits.Administrator) },
      } as any;
      expect(rbac.check(memberString, user, RBACTier.ADMIN).allowed).toBe(true);

      // Bitfield without Administrator (e.g. SendMessages = 1n << 11n = 2048n)
      const memberNonAdmin = { permissions: { bitfield: 2048n } } as any;
      expect(rbac.check(memberNonAdmin, user, RBACTier.ADMIN).allowed).toBe(false);
    });

    it('ADV-RBAC-5: handles permissions object with throwing .has() method', () => {
      const memberThrowing = {
        permissions: {
          has: () => {
            throw new Error('Corrupted permission check');
          },
        },
      } as any;
      const user = { id: 'user_4', username: 'Thrower' } as any;

      // Should not throw, should fall through to default VIEWER
      expect(() => rbac.check(memberThrowing, user, RBACTier.OPERATOR)).not.toThrow();
      expect(rbac.check(memberThrowing, user, RBACTier.OPERATOR).allowed).toBe(false);
    });
  });

  describe('2.3 Missing Context & Edge Context Cases', () => {
    it('ADV-RBAC-6: handles DM context where member and guild are null', () => {
      const user = { id: 'random_dm_user', username: 'DMUser' } as any;
      const resViewer = rbac.check(null, user, RBACTier.VIEWER, null);
      expect(resViewer.allowed).toBe(true);

      const resOp = rbac.check(null, user, RBACTier.OPERATOR, null);
      expect(resOp.allowed).toBe(false);

      const resAdmin = rbac.check(null, user, RBACTier.ADMIN, null);
      expect(resAdmin.allowed).toBe(false);
    });

    it('ADV-RBAC-7: [VULNERABILITY PROBE] checks undefined ownerId and undefined userId match vulnerability', () => {
      // If user.id is undefined and guild.ownerId is undefined, undefined === undefined MUST NOT grant ADMIN!
      const userUndefinedId = { username: 'GhostUser' } as any;
      const guildUndefinedOwner = {} as any;

      const res = rbac.check(null, userUndefinedId, RBACTier.ADMIN, guildUndefinedOwner);
      expect(
        res.allowed,
        'CRITICAL: undefined user.id matched undefined guild.ownerId, granting unauthenticated ADMIN!'
      ).toBe(false);
    });
  });
});

// ============================================================================
// SUITE 3: StatusEmbedManager Adversarial Tests
// ============================================================================
describe('Adversarial Challenge: StatusEmbedManager', () => {
  let mockGateway: IDiscordGateway;
  let updateEmbedSpy: ReturnType<typeof vi.fn>;
  let sendMessageSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    updateEmbedSpy = vi.fn().mockResolvedValue(undefined);
    sendMessageSpy = vi.fn().mockResolvedValue('msg_embed_1');

    mockGateway = {
      registerCommands: vi.fn(),
      sendMessage: sendMessageSpy,
      updateEmbed: updateEmbedSpy,
      joinVoice: vi.fn(),
      leaveVoice: vi.fn(),
      onCommand: vi.fn(),
      onMessage: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ADV-EMB-1: rapid status oscillations in updateState are throttled to 5s interval', async () => {
    const manager = new StatusEmbedManager(mockGateway, {
      statusChannelId: 'status_chan_1',
      pinnedMessageId: 'pinned_1',
      updateIntervalSec: 5,
    });

    manager.start();

    // Oscillate health rapidly 100 times over 3 seconds
    for (let i = 0; i < 100; i++) {
      manager.updateState(createDummyStatus({ health: i % 2 === 0 ? 20 : 15 }));
      vi.advanceTimersByTime(30); // 30ms * 100 = 3000ms = 3s
    }

    // At 3s, interval (5s) has NOT elapsed yet!
    expect(updateEmbedSpy).toHaveBeenCalledTimes(0);

    // Advance to 5s mark -> exactly 1 update!
    await vi.advanceTimersByTimeAsync(2000); // reaches 5000ms
    expect(updateEmbedSpy).toHaveBeenCalledTimes(1);

    // Oscillate another 100 times over next 4.5 seconds
    for (let i = 0; i < 100; i++) {
      manager.updateState(createDummyStatus({ health: i % 2 === 0 ? 10 : 8 }));
      await vi.advanceTimersByTimeAsync(45);
    }
    // At 9.5s, second interval has not elapsed
    expect(updateEmbedSpy).toHaveBeenCalledTimes(1);

    // Advance past 10s mark -> exactly 2nd update!
    await vi.advanceTimersByTimeAsync(500);
    expect(updateEmbedSpy).toHaveBeenCalledTimes(2);

    manager.stop();
  });

  it('ADV-EMB-2: SHA-256 dirty check suppresses Discord API edit if status oscillates back to initial state', async () => {
    const manager = new StatusEmbedManager(mockGateway, {
      statusChannelId: 'status_chan_1',
      pinnedMessageId: 'pinned_1',
      updateIntervalSec: 5,
    });

    const statusInitial = createDummyStatus({ health: 20 });
    manager.updateState(statusInitial);
    await manager.tick(); // Initial sync
    expect(updateEmbedSpy).toHaveBeenCalledTimes(1);

    // Status oscillates temporarily to 18, but returns to 20 before next tick
    manager.updateState(createDummyStatus({ health: 18 }));
    manager.updateState(createDummyStatus({ health: 20 }));

    // Tick executed
    const updated = await manager.tick();
    // Because hash(20) === lastHash, API call must be skipped!
    expect(updated).toBe(false);
    expect(updateEmbedSpy).toHaveBeenCalledTimes(1);
  });

  it('ADV-EMB-3: computeStateHash dirty check sensitivity test across status fields', () => {
    const base = createDummyStatus();
    const baseHash = computeStateHash(base);

    // Health change of 0.5 is dirty
    expect(computeStateHash(createDummyStatus({ health: 19.5 }))).not.toBe(baseHash);

    // Micro-jitter < 0.25 on coordinates is suppressed (rounded to integer)
    expect(computeStateHash(createDummyStatus({ position: { x: 100.2, y: 64.1, z: -200.2 } }))).toBe(baseHash);

    // Meaningful movement (>= 1 block) is dirty
    expect(computeStateHash(createDummyStatus({ position: { x: 101.5, y: 64.0, z: -200.0 } }))).not.toBe(baseHash);

    // Dimension change is dirty
    expect(computeStateHash(createDummyStatus({ dimension: 'the_nether' }))).not.toBe(baseHash);

    // Task change is dirty
    expect(computeStateHash(createDummyStatus({ currentTask: 'Mining diamonds' }))).not.toBe(baseHash);

    // Gear change is dirty
    expect(
      computeStateHash(
        createDummyStatus({ gear: { mainHand: 'Netherite Sword', offHand: 'Totem', armorSummary: 'Netherite' } })
      )
    ).not.toBe(baseHash);

    // Inventory slot usage is dirty
    expect(computeStateHash(createDummyStatus({ inventory: { usedSlots: 15, totalSlots: 36, freeSlots: 21 } }))).not.toBe(
      baseHash
    );

    // Disconnect is dirty
    expect(computeStateHash(createDummyStatus({ connected: false }))).not.toBe(baseHash);
  });

  it('ADV-EMB-4: concurrent overlapping ticks do not cause duplicate gateway calls', async () => {
    let resolveUpdate: () => void = () => {};
    const slowUpdateSpy = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve;
        })
    );

    const gateway: IDiscordGateway = {
      ...mockGateway,
      updateEmbed: slowUpdateSpy,
    };

    const manager = new StatusEmbedManager(gateway, {
      statusChannelId: 'status_chan_1',
      pinnedMessageId: 'pinned_1',
    });

    manager.updateState(createDummyStatus({ health: 18 }));

    // Trigger tick 1 (starts in background, pending)
    const tick1Promise = manager.tick();
    expect(slowUpdateSpy).toHaveBeenCalledTimes(1);

    // Trigger tick 2 while tick 1 is in-flight
    const tick2Result = await manager.tick();
    // Must be rejected due to isUpdating guard!
    expect(tick2Result).toBe(false);
    expect(slowUpdateSpy).toHaveBeenCalledTimes(1);

    // Resolve tick 1
    resolveUpdate();
    const tick1Result = await tick1Promise;
    expect(tick1Result).toBe(true);
  });
});
