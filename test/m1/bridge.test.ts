import { describe, it, expect, vi } from 'vitest';
import { AntiLoopbackFilter } from '../../src/bridge/antiLoopback.js';
import { ChatBridge } from '../../src/bridge/chatBridge.js';
import type { IMinecraftChatAgent } from '../../src/bridge/types.js';
import type { IDiscordGateway, UserMessage } from '../../src/discord/types.js';

describe('Chat Bridge & Anti-Loopback Subsystem (src/bridge/)', () => {
  describe('AntiLoopbackFilter', () => {
    const filter = new AntiLoopbackFilter({
      botDiscordId: 'bot_discord_123',
      botMinecraftUsername: 'SurvivalBot',
      ttlMs: 200, // Short TTL for test
    });

    it('TC-ALF-1: drops Discord messages authored by self bot ID (Lock 1)', () => {
      const res = filter.evaluate({
        source: 'discord',
        authorId: 'bot_discord_123',
        content: 'Self message',
      });
      expect(res.drop).toBe(true);
      expect(res.reason).toBe('SELF_BOT_ID');
    });

    it('TC-ALF-2: drops Discord messages authored by other bot accounts (Lock 2)', () => {
      const res = filter.evaluate({
        source: 'discord',
        authorId: 'other_bot_456',
        isBotAccount: true,
        content: 'Bot announcement',
      });
      expect(res.drop).toBe(true);
      expect(res.reason).toBe('BOT_ACCOUNT');
    });

    it('TC-ALF-3: drops Minecraft chat authored by self in-game username (Lock 1)', () => {
      const res = filter.evaluate({
        source: 'minecraft',
        authorUsername: 'survivalbot', // Case-insensitive check
        content: 'In-game chat from self',
      });
      expect(res.drop).toBe(true);
      expect(res.reason).toBe('SELF_BOT_ID');
    });

    it('TC-ALF-4: drops messages matching recent hash within TTL window (Lock 3)', () => {
      filter.clear();
      filter.recordOutbound('Hello Minecraft server');

      const res = filter.evaluate({
        source: 'minecraft',
        authorUsername: 'Player1',
        content: 'Hello Minecraft server',
      });
      expect(res.drop).toBe(true);
      expect(res.reason).toBe('DUPLICATE_TTL_HASH');
    });

    it('TC-ALF-5: allows duplicate message once TTL has expired', async () => {
      filter.clear();
      filter.recordOutbound('Temporary message');

      // Wait 250ms for 200ms TTL to expire
      await new Promise((r) => setTimeout(r, 250));

      const res = filter.evaluate({
        source: 'minecraft',
        authorUsername: 'Player1',
        content: 'Temporary message',
      });
      expect(res.drop).toBe(false);
    });

    it('TC-ALF-6: drops [Discord] prefix echo received in Minecraft', () => {
      const res = filter.evaluate({
        source: 'minecraft',
        authorUsername: 'Server',
        content: '[Discord] <Alice>: Hey everyone',
      });
      expect(res.drop).toBe(true);
      expect(res.reason).toBe('DISCORD_PREFIX_ECHO');
    });

    it('TC-ALF-7: drops empty or whitespace-only messages', () => {
      const res = filter.evaluate({
        source: 'discord',
        authorId: 'user_1',
        content: '   \n  \t ',
      });
      expect(res.drop).toBe(true);
      expect(res.reason).toBe('EMPTY_CONTENT');
    });

    it('TC-ALF-8: sanitizes Discord mentions, emojis, and § formatting codes for Minecraft', () => {
      const input = 'Hey <@12345> check <#67890> with <:pepe:999>! §cColor §lBold\nSecond line';
      const clean = filter.sanitizeForMinecraft(input);

      expect(clean).toContain('@user_12345');
      expect(clean).toContain('#channel_67890');
      expect(clean).toContain(':pepe:');
      expect(clean).not.toContain('§');
      expect(clean).not.toContain('\n');
    });

    it('TC-ALF-9: neutralizes Discord pings (@everyone, @here)', () => {
      const input = 'Alert @everyone and @here';
      const clean = filter.sanitizeForDiscord(input);

      expect(clean).toContain('@\u200beveryone');
      expect(clean).toContain('@\u200bhere');
    });

    it('TC-ALF-10: chunks messages longer than 256 characters into indexed parts', () => {
      const prefix = '[Discord] <User>:';
      const longMessage = 'word '.repeat(70); // ~350 characters
      const chunks = filter.chunkForMinecraft(prefix, longMessage);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.length).toBeLessThanOrEqual(3);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(256);
        expect(chunk).toContain(prefix);
      }
      expect(chunks[0]).toContain('[1/');
      expect(chunks[1]).toContain('[2/');
    });
  });

  describe('ChatBridge Relay', () => {
    function createBridgeHarness() {
      let discordMessageHandler: ((msg: UserMessage) => Promise<void>) | null = null;
      let mcChatHandler: ((username: string, msg: string) => void) | null = null;

      const sentToDiscord: Array<{ channelId: string; content: string }> = [];
      const sentToMinecraft: string[] = [];

      const mockGateway: IDiscordGateway = {
        registerCommands: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockImplementation(async (channelId, content) => {
          sentToDiscord.push({ channelId, content: typeof content === 'string' ? content : content.content });
          return 'msg_id_1';
        }),
        updateEmbed: vi.fn().mockResolvedValue(undefined),
        joinVoice: vi.fn(),
        leaveVoice: vi.fn().mockResolvedValue(undefined),
        onCommand: vi.fn(),
        onMessage: vi.fn().mockImplementation((handler) => {
          discordMessageHandler = handler;
        }),
      };

      const mockAgent: IMinecraftChatAgent = {
        sendChat: vi.fn().mockImplementation(async (msg: string) => {
          sentToMinecraft.push(msg);
        }),
        on: vi.fn().mockImplementation((event, listener) => {
          if (event === 'chat') mcChatHandler = listener;
        }),
        removeListener: vi.fn(),
      };

      const bridge = new ChatBridge(
        mockGateway,
        mockAgent,
        {
          bridgeChannelId: 'bridge_chan_100',
          botDiscordId: 'bot_id',
          botMinecraftUsername: 'SurvivalBot',
          rateLimitDelayMs: 20, // Fast tick for test
        }
      );

      return {
        bridge,
        mockGateway,
        mockAgent,
        sentToDiscord,
        sentToMinecraft,
        simulateDiscord: async (msg: Partial<UserMessage>) => {
          if (discordMessageHandler) {
            await discordMessageHandler({
              id: '1',
              channelId: msg.channelId || 'bridge_chan_100',
              author: msg.author || { id: 'u1', username: 'Alice', bot: false },
              content: msg.content || '',
              createdAt: new Date(),
            });
          }
        },
        simulateMinecraft: (username: string, message: string) => {
          if (mcChatHandler) mcChatHandler(username, message);
        },
      };
    }

    it('TC-BRG-1: relays Discord message to Minecraft queue and sends through agent', async () => {
      const h = createBridgeHarness();
      h.bridge.start();

      await h.simulateDiscord({ content: 'Hello in-game friends!' });

      // Allow leaky-bucket queue timer to tick
      await new Promise((r) => setTimeout(r, 60));

      expect(h.sentToMinecraft.length).toBe(1);
      expect(h.sentToMinecraft[0]).toContain('[Discord] <Alice>:');
      expect(h.sentToMinecraft[0]).toContain('Hello in-game friends!');

      h.bridge.stop();
    });

    it('TC-BRG-2: ignores Discord messages sent to non-bridge channels', async () => {
      const h = createBridgeHarness();
      h.bridge.start();

      await h.simulateDiscord({ channelId: 'general_channel', content: 'Secret message' });
      await new Promise((r) => setTimeout(r, 60));

      expect(h.sentToMinecraft.length).toBe(0);
      h.bridge.stop();
    });

    it('TC-BRG-3: relays Minecraft in-game chat to Discord text bridge channel', async () => {
      const h = createBridgeHarness();
      h.bridge.start();

      h.simulateMinecraft('Bob', 'Hey Discord!');

      expect(h.sentToDiscord.length).toBe(1);
      expect(h.sentToDiscord[0].channelId).toBe('bridge_chan_100');
      expect(h.sentToDiscord[0].content).toContain('**[Minecraft] <Bob>** Hey Discord!');

      h.bridge.stop();
    });

    it('TC-BRG-4: relays Minecraft player death messages to Discord', async () => {
      const h = createBridgeHarness();
      h.bridge.start();

      await h.bridge.handleMinecraftDeath('Bob was blown up by Creeper');

      expect(h.sentToDiscord.length).toBe(1);
      expect(h.sentToDiscord[0].content).toContain('💀 **[Minecraft]** Bob was blown up by Creeper');

      h.bridge.stop();
    });
  });
});
