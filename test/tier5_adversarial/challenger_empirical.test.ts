import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { PermissionFlagsBits } from 'discord.js';
import { AntiLoopbackFilter } from '../../src/bridge/antiLoopback.js';
import { ChatBridge } from '../../src/bridge/chatBridge.js';
import { RBACService, RBACTier } from '../../src/discord/rbac.js';
import type { IDiscordGateway, UserMessage } from '../../src/discord/types.js';
import type { IMinecraftChatAgent } from '../../src/bridge/types.js';
import type { AppConfig } from '../../src/config/types.js';

function createMockConfig(): AppConfig {
  return {
    discord: {
      token: 'mock_token',
      clientId: 'bot_discord_123',
      chatBridgeChannelId: 'bridge_chan_100',
    },
    rbac: {
      allowedRoleIds: ['op_role_1'],
      allowedUserIds: ['op_user_1'],
      adminRoleIds: ['admin_role_1'],
      adminUserIds: ['admin_user_1'],
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

describe('Empirical Challenger: Milestone 1 Iteration 2 Adversarial Stress Suite', () => {
  // ==========================================================================
  // AREA 1: chunkForMinecraft <= 256 Characters Invariant
  // ==========================================================================
  describe('Area 1: Minecraft Chunking <= 256 Characters Invariant', () => {
    let filter: AntiLoopbackFilter;

    beforeEach(() => {
      filter = new AntiLoopbackFilter({
        botDiscordId: 'bot_discord_123',
        botMinecraftUsername: 'SurvivalBot',
        ttlMs: 10_000,
      });
    });

    it('EMP-CHK-1: Unbroken tokens of varied extreme lengths all produce chunks <= 256', () => {
      const prefix = '[Discord] <User1234567890>:'; // 27 chars
      const testLengths = [1, 2, 50, 100, 200, 255, 256, 257, 300, 500, 1000, 2048, 5000];

      for (const len of testLengths) {
        const unbroken = 'Z'.repeat(len);
        const chunks = filter.chunkForMinecraft(prefix, unbroken, 256);

        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks.length).toBeLessThanOrEqual(3); // Max 3 chunks anti-spam
        for (let i = 0; i < chunks.length; i++) {
          expect(
            chunks[i].length,
            `Unbroken length ${len}: Chunk [${i + 1}/${chunks.length}] exceeded 256! (Length: ${chunks[i].length})`
          ).toBeLessThanOrEqual(256);
        }
      }
    });

    it('EMP-CHK-2: Fuzz stress testing with 2000 randomized message payloads and prefix sizes', () => {
      // Deterministic PRNG
      let seed = 42;
      function rand(): number {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      }
      function randInt(min: number, max: number): number {
        return Math.floor(rand() * (max - min + 1)) + min;
      }

      const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=~';

      for (let iter = 0; iter < 2000; iter++) {
        // Generate random username (1 to 32 chars)
        const usernameLen = randInt(1, 32);
        let username = '';
        for (let u = 0; u < usernameLen; u++) username += chars[randInt(0, chars.length - 1)];
        const prefix = `[Discord] <${username}>:`;

        // Generate message with random mix of words and word lengths
        const numWords = randInt(1, 40);
        const words: string[] = [];
        for (let w = 0; w < numWords; w++) {
          const wLen = randInt(1, 300); // from single char to massive unbroken tokens
          let word = '';
          for (let c = 0; c < wLen; c++) word += chars[randInt(0, chars.length - 1)];
          words.push(word);
        }
        const message = words.join(' '.repeat(randInt(1, 4)));

        const chunks = filter.chunkForMinecraft(prefix, message, 256);
        expect(chunks.length).toBeLessThanOrEqual(3);

        for (let i = 0; i < chunks.length; i++) {
          expect(
            chunks[i].length,
            `Fuzz Iteration ${iter}: Chunk [${i + 1}/${chunks.length}] exceeded 256! (Len: ${chunks[i].length}, PrefixLen: ${prefix.length})`
          ).toBeLessThanOrEqual(256);
        }
      }
    });

    it('EMP-CHK-3: Empty, whitespace-only, and single-char boundary messages', () => {
      const prefix = '[Discord] <User>:';
      expect(filter.chunkForMinecraft(prefix, '', 256)).toEqual([prefix]);
      expect(filter.chunkForMinecraft(prefix, '   ', 256)).toEqual([prefix]);
      expect(filter.chunkForMinecraft(prefix, 'a', 256)).toEqual([`${prefix} a`]);
    });
  });

  // ==========================================================================
  // AREA 2: @everyone and @here Case Variant Neutralization
  // ==========================================================================
  describe('Area 2: @everyone and @here Case Variant Neutralization', () => {
    let filter: AntiLoopbackFilter;

    beforeEach(() => {
      filter = new AntiLoopbackFilter({
        botDiscordId: 'bot_discord_123',
        botMinecraftUsername: 'SurvivalBot',
      });
    });

    it('EMP-EVR-1: All 32 permutations of case for @everyone and @here are neutralized', () => {
      const testCases = [
        '@everyone',
        '@EVERYONE',
        '@Everyone',
        '@everyOne',
        '@eVeRyOnE',
        '@EvErYoNe',
        '@EVERYone',
        '@everyONE',
        '@here',
        '@HERE',
        '@Here',
        '@hErE',
        '@HeRe',
        '@HERe',
        '@heRE',
      ];

      for (const ping of testCases) {
        const sanitized = filter.sanitizeForDiscord(`Announcement: ${ping} please read!`);
        // Must NOT match @(everyone|here) without zero-width space
        const hasVulnerablePing = /@(?!\u200b)(?:everyone|here)/i.test(sanitized);
        expect(
          hasVulnerablePing,
          `Vulnerable ping survived in "${ping}" -> "${sanitized}"`
        ).toBe(false);

        // Must contain the neutralized version with ZWS
        expect(sanitized).toMatch(/@\u200b(?:everyone|here)/i);
      }
    });

    it('EMP-EVR-2: Neutralizes multiple mixed-case pings in a single sentence', () => {
      const complex = 'Alert @EVERYONE and also @Here and @everyone plus @HERE!';
      const sanitized = filter.sanitizeForDiscord(complex);
      const vulnerableMatch = sanitized.match(/@(?!\u200b)(?:everyone|here)/gi);
      expect(vulnerableMatch).toBeNull();
    });
  });

  // ==========================================================================
  // AREA 3: Zero-Width Characters Stripped in normalizeText
  // ==========================================================================
  describe('Area 3: Zero-Width Characters Stripped in normalizeText', () => {
    let filter: AntiLoopbackFilter;

    beforeEach(() => {
      filter = new AntiLoopbackFilter({
        botDiscordId: 'bot_discord_123',
        botMinecraftUsername: 'SurvivalBot',
      });
    });

    it('EMP-ZWS-1: Strips ZWS, ZWNJ, ZWJ, and BOM from text', () => {
      const plain = 'diamond sword attack';
      const infected =
        '\uFEFFd\u200Bi\u200Cam\u200Do\u200Bnd\u200C \u200Dsw\u200Bord \u200Cat\u200Dta\u200Bck\uFEFF';

      expect(filter.normalizeText(infected)).toBe(plain);
      expect(filter.computeHash(infected)).toBe(filter.computeHash(plain));
    });

    it('EMP-ZWS-2: Hash deduplication intercepts loopback messages obfuscated with zero-width characters', () => {
      filter.recordOutbound('Look at the diamonds in the chest!');

      const maliciousInbound = {
        source: 'minecraft' as const,
        authorUsername: 'Attacker',
        content: 'Look at the d\u200Bi\u200Camo\u200Dnds in the ch\uFEFFest!',
      };

      const result = filter.evaluate(maliciousInbound);
      expect(result.drop).toBe(true);
      expect(result.reason).toBe('DUPLICATE_TTL_HASH');
    });
  });

  // ==========================================================================
  // AREA 4: Hex Color Sequences and Minecraft Section Codes Stripped
  // ==========================================================================
  describe('Area 4: Hex Color Sequences and Minecraft Section Codes Stripped', () => {
    let filter: AntiLoopbackFilter;

    beforeEach(() => {
      filter = new AntiLoopbackFilter({
        botDiscordId: 'bot_discord_123',
        botMinecraftUsername: 'SurvivalBot',
      });
    });

    it('EMP-SEC-1: Strips standard Minecraft color codes §0-§f and formatting codes §k-§r', () => {
      const formatted = '§0Black §1Blue §2Green §4§lBoldRed §c§kObfuscated §rReset';
      const cleanMC = filter.sanitizeForMinecraft(formatted);
      expect(cleanMC.includes('§')).toBe(false);
      expect(cleanMC).toBe('Black Blue Green BoldRed Obfuscated Reset');

      const normalized = filter.normalizeText(formatted);
      expect(normalized.includes('§')).toBe(false);
      expect(normalized).toBe('black blue green boldred obfuscated reset');
    });

    it('EMP-SEC-2: Strips 1.16+ RGB hex color codes (§x§r§r§g§g§b§b) in both upper and lowercase', () => {
      const hex1 = '§x§f§f§5§5§5§5Bright Red Text';
      const hex2 = '§X§F§F§A§A§0§0Golden Shimmer';
      const mixed = '§x§1§2§3§4§5§6Custom Hex Color';

      for (const input of [hex1, hex2, mixed]) {
        const clean = filter.sanitizeForMinecraft(input);
        expect(clean.includes('§'), `Section sign survived in: ${clean}`).toBe(false);
        const norm = filter.normalizeText(input);
        expect(norm.includes('§'), `Section sign survived in normalizeText: ${norm}`).toBe(false);
      }
    });

    it('EMP-SEC-3: Strips stray, malformed, or consecutive section signs', () => {
      const stray = 'Malformed § signs §§§ and §z invalid §_ code';
      const clean = filter.sanitizeForMinecraft(stray);
      expect(clean.includes('§')).toBe(false);
      expect(clean).toBe('Malformed  signs  and z invalid _ code');
    });
  });

  // ==========================================================================
  // AREA 5: Chat Listeners Cleanly Removed on ChatBridge.stop()
  // ==========================================================================
  describe('Area 5: ChatBridge Lifecycle & Listener Cleanup', () => {
    it('EMP-BRG-1: Chat listener is cleanly added on start() and removed on stop()', () => {
      const agent = new EventEmitter();
      (agent as any).sendChat = vi.fn();

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
        botMinecraftUsername: 'SurvivalBot',
      });

      expect(agent.listenerCount('chat')).toBe(0);

      // 50 start/stop cycles to prove no listener leaks or accumulator issues
      for (let i = 0; i < 50; i++) {
        bridge.start();
        expect(agent.listenerCount('chat')).toBe(1);
        bridge.stop();
        expect(agent.listenerCount('chat')).toBe(0);
      }
    });

    it('EMP-BRG-2: After stop(), Minecraft chat events do NOT trigger Discord messages', async () => {
      const agent = new EventEmitter();
      (agent as any).sendChat = vi.fn();

      const sendMessageSpy = vi.fn().mockResolvedValue('msg_1');
      const gateway: IDiscordGateway = {
        registerCommands: vi.fn(),
        sendMessage: sendMessageSpy,
        updateEmbed: vi.fn(),
        joinVoice: vi.fn(),
        leaveVoice: vi.fn(),
        onCommand: vi.fn(),
        onMessage: vi.fn(),
      };

      const bridge = new ChatBridge(gateway, agent as any, {
        bridgeChannelId: 'chan_1',
        botDiscordId: 'bot_1',
        botMinecraftUsername: 'SurvivalBot',
      });

      bridge.start();
      agent.emit('chat', 'Player1', 'Hello world');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);

      bridge.stop();
      // Emit chat while stopped
      agent.emit('chat', 'Player2', 'Should not relay');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1); // Still 1, not 2!
    });
  });

  // ==========================================================================
  // AREA 6: Username Section Code Injection Prevention
  // ==========================================================================
  describe('Area 6: Username Section Code Injection Prevention', () => {
    it('EMP-USR-1: Malicious Discord usernames cannot inject Minecraft formatting codes', async () => {
      const sentChunks: string[] = [];
      const agent: IMinecraftChatAgent = {
        sendChat: vi.fn().mockImplementation(async (chunk: string) => {
          sentChunks.push(chunk);
        }),
        on: vi.fn(),
      };

      let discordHandler: ((msg: UserMessage) => Promise<void>) | null = null;
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
        bridgeChannelId: 'chan_bridge',
        botDiscordId: 'bot_discord',
        botMinecraftUsername: 'SurvivalBot',
        rateLimitDelayMs: 5,
      });

      bridge.start();

      const maliciousUsernames = [
        '§4§lADMIN§r',
        '§x§f§f§0§0§0§0ServerOwner',
        '§c§kHACKER',
        '§§§§§', // Entirely section signs -> should fallback to 'User'
        'User\r\nName\tWithControl\x00Chars',
      ];

      let idx = 0;
      for (const username of maliciousUsernames) {
        idx++;
        sentChunks.length = 0;
        await discordHandler!({
          id: `msg_${idx}`,
          channelId: 'chan_bridge',
          author: { id: `user_mal_${idx}`, username, bot: false },
          content: `Unique payload test ${idx}`,
          createdAt: new Date(),
        });

        // Await rate limit queue dispatch
        await new Promise((r) => setTimeout(r, 20));

        expect(sentChunks.length).toBeGreaterThanOrEqual(1);
        for (const chunk of sentChunks) {
          expect(chunk.includes('§'), `Section sign injected via username "${username}": "${chunk}"`).toBe(false);
          expect(chunk.includes('\r')).toBe(false);
          expect(chunk.includes('\n')).toBe(false);
          expect(chunk.length).toBeLessThanOrEqual(256);
        }
      }

      bridge.stop();
    });
  });

  // ==========================================================================
  // AREA 7: RBAC ownerId Check Strict String Equality & Auth Bypass Prevention
  // ==========================================================================
  describe('Area 7: RBAC ownerId Strict String Equality & Auth Bypass Prevention', () => {
    let rbac: RBACService;

    beforeEach(() => {
      rbac = new RBACService(createMockConfig());
    });

    it('EMP-RBC-1: Denies ADMIN and OPERATOR when userId or ownerId are undefined, null, or empty', () => {
      const maliciousCases: Array<{ userId: any; ownerId: any; desc: string }> = [
        { userId: undefined, ownerId: undefined, desc: 'both undefined' },
        { userId: null, ownerId: null, desc: 'both null' },
        { userId: '', ownerId: '', desc: 'both empty string' },
        { userId: '   ', ownerId: '   ', desc: 'both whitespace string' },
        { userId: undefined, ownerId: 'valid_owner_id', desc: 'undefined userId with valid ownerId' },
        { userId: 'valid_user_id', ownerId: undefined, desc: 'valid userId with undefined ownerId' },
        { userId: 'valid_user_id', ownerId: '', desc: 'valid userId with empty ownerId' },
        { userId: '', ownerId: 'valid_owner_id', desc: 'empty userId with valid ownerId' },
        { userId: 12345, ownerId: 12345, desc: 'both numeric IDs (type confusion)' },
        { userId: true, ownerId: true, desc: 'both boolean true' },
        { userId: {}, ownerId: {}, desc: 'both object literals' },
        { userId: [], ownerId: [], desc: 'both arrays' },
        { userId: 'user_1', ownerId: 'user_2', desc: 'mismatched string IDs' },
      ];

      for (const tc of maliciousCases) {
        const user = { id: tc.userId, username: 'Attacker' } as any;
        const guild = { ownerId: tc.ownerId } as any;

        const resAdmin = rbac.check(null, user, RBACTier.ADMIN, guild);
        expect(
          resAdmin.allowed,
          `Bypass vulnerability: ${tc.desc} was granted ADMIN!`
        ).toBe(false);

        const resOp = rbac.check(null, user, RBACTier.OPERATOR, guild);
        expect(
          resOp.allowed,
          `Bypass vulnerability: ${tc.desc} was granted OPERATOR!`
        ).toBe(false);
      }
    });

    it('EMP-RBC-2: Confirms genuine non-empty string equality for guild owner correctly grants ADMIN', () => {
      const validOwnerId = '987654321012345678';
      const user = { id: validOwnerId, username: 'LegitOwner' } as any;
      const guild = { ownerId: validOwnerId } as any;

      const resAdmin = rbac.check(null, user, RBACTier.ADMIN, guild);
      expect(resAdmin.allowed).toBe(true);
      expect(resAdmin.userTier).toBe(RBACTier.ADMIN);

      const resOp = rbac.check(null, user, RBACTier.OPERATOR, guild);
      expect(resOp.allowed).toBe(true);
      expect(resOp.userTier).toBe(RBACTier.ADMIN);
    });

    it('EMP-RBC-3: Confirms VIEWER tier is universally allowed regardless of context', () => {
      const user = { id: undefined, username: 'Ghost' } as any;
      const res = rbac.check(null, user, RBACTier.VIEWER, null);
      expect(res.allowed).toBe(true);
      expect(res.userTier).toBe(RBACTier.VIEWER);
    });
  });
});
