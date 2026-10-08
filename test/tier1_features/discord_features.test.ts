import { describe, it, expect, vi } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import {
  createDefaultCommandRegistry,
  statusCommand,
  connectCommand,
  disconnectCommand,
  taskCommand,
  stopCommand,
  inventoryCommand,
  voiceCommand,
  helpCommand,
  withAutoDefer,
} from '../../src/discord/commands/index.js';
import { RBACService, RBACTier } from '../../src/discord/rbac.js';
import { AntiLoopbackFilter } from '../../src/bridge/antiLoopback.js';
import { ChatBridge } from '../../src/bridge/chatBridge.js';
import {
  buildStatusEmbed,
  computeStateHash,
  generateProgressBar,
  StatusEmbedManager,
} from '../../src/discord/embed.js';
import { MockDiscordGateway } from '../mocks/mockDiscord.js';
import type { CommandContext, IDiscordGateway, UserMessage } from '../../src/discord/types.js';
import type { MinecraftBotStatus } from '../../src/minecraft/types.js';
import type { IMinecraftChatAgent } from '../../src/bridge/types.js';
import type { AppConfig } from '../../src/config/types.js';

function createMockCommandContext(statusOverrides?: Partial<MinecraftBotStatus>): {
  context: CommandContext;
  status: MinecraftBotStatus;
  connectSpy: any;
  disconnectSpy: any;
  assignSpy: any;
  stopSpy: any;
  joinVoiceSpy: any;
  leaveVoiceSpy: any;
} {
  const status: MinecraftBotStatus = {
    connected: true,
    username: 'TestBot',
    health: 20,
    food: 20,
    position: { x: 10, y: 64, z: -20 },
    dimension: 'overworld',
    currentTask: 'Idle',
    gear: {
      mainHand: 'Diamond Sword',
      offHand: 'Shield',
      armorSummary: 'Full Iron',
      helmet: 'Iron Helmet',
      chestplate: 'Iron Chestplate',
      leggings: 'Iron Leggings',
      boots: 'Iron Boots',
    },
    inventory: {
      usedSlots: 10,
      totalSlots: 36,
      freeSlots: 26,
    },
    server: {
      host: 'localhost',
      port: 25565,
      ping: 15,
    },
    ...statusOverrides,
  };

  const connectSpy = vi.fn().mockResolvedValue(undefined);
  const disconnectSpy = vi.fn().mockResolvedValue(undefined);
  const assignSpy = vi.fn().mockResolvedValue(undefined);
  const stopSpy = vi.fn().mockResolvedValue(undefined);
  const joinVoiceSpy = vi.fn().mockResolvedValue(undefined);
  const leaveVoiceSpy = vi.fn().mockResolvedValue(undefined);

  const context: CommandContext = {
    coordinator: {
      getMinecraftStatus: () => status,
      connectMinecraft: connectSpy,
      disconnectMinecraft: disconnectSpy,
      assignTask: assignSpy,
      stopCurrentTask: stopSpy,
      getInventory: () => ({ ...status.inventory, gear: status.gear }),
      joinVoiceChannel: joinVoiceSpy,
      leaveVoiceChannel: leaveVoiceSpy,
    },
  };

  return {
    context,
    status,
    connectSpy,
    disconnectSpy,
    assignSpy,
    stopSpy,
    joinVoiceSpy,
    leaveVoiceSpy,
  };
}

function createMockInteraction(options: Record<string, any> = {}): any {
  let replied = options.replied ?? false;
  let deferred = options.deferred ?? false;

  const interaction: any = {
    commandName: options.commandName || 'test',
    user: options.user || { id: 'user_1', tag: 'User#1234', username: 'User', bot: false },
    member: options.member || null,
    guildId: options.guildId || 'guild_1',
    get deferred() {
      return deferred;
    },
    set deferred(val: boolean) {
      deferred = val;
    },
    get replied() {
      return replied;
    },
    set replied(val: boolean) {
      replied = val;
    },
    reply: vi.fn().mockImplementation(async (payload: any) => {
      replied = true;
      interaction.replyPayload = payload;
    }),
    editReply: vi.fn().mockImplementation(async (payload: any) => {
      replied = true;
      interaction.editReplyPayload = payload;
    }),
    deferReply: vi.fn().mockImplementation(async () => {
      deferred = true;
    }),
    options: {
      getString: vi.fn().mockImplementation((name: string) => options[name] ?? null),
      getInteger: vi.fn().mockImplementation((name: string) => options[name] ?? null),
      getNumber: vi.fn().mockImplementation((name: string) => options[name] ?? null),
      getBoolean: vi.fn().mockImplementation((name: string) => options[name] ?? null),
      getChannel: vi.fn().mockImplementation((name: string) => options[name] ?? null),
      getSubcommand: vi.fn().mockImplementation(() => options.subcommand ?? ''),
    },
  };

  return interaction;
}

function createTestRbacConfig(): AppConfig {
  return {
    discord: {
      token: 'mock_token',
      clientId: 'bot_id',
      chatBridgeChannelId: 'bridge_chan',
    },
    rbac: {
      allowedRoleIds: ['role_operator'],
      allowedUserIds: ['user_operator'],
      adminRoleIds: ['role_admin'],
      adminUserIds: ['user_admin'],
    },
    minecraft: {
      host: 'localhost',
      port: 25565,
      username: 'Bot',
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
      logLevel: 'error',
      mockAll: true,
    },
  };
}

describe('Tier 1: Discord Subsystem Feature Coverage (F01-F03, F09-F15)', () => {
  // --------------------------------------------------------------------------
  // Slash Commands (F01)
  // --------------------------------------------------------------------------
  describe('Slash Commands (T1-DISC-01 to T1-DISC-08)', () => {
    it('T1-DISC-01: /status command generates embed with username, health progress bar, coordinates, dimension, and task', async () => {
      const { context } = createMockCommandContext();
      const interaction = createMockInteraction({ commandName: 'status' });

      await statusCommand.execute(interaction, context);

      expect(interaction.reply).toHaveBeenCalled();
      const payload = interaction.replyPayload;
      expect(payload).toBeDefined();
      expect(payload.embeds).toHaveLength(1);

      const embed = payload.embeds[0];
      expect(embed.title).toContain('TestBot');
      expect(embed.fields).toBeDefined();

      const healthField = embed.fields.find((f: any) => f.name.includes('Health'));
      expect(healthField).toBeDefined();
      expect(healthField.value).toContain('20.0/20');
      expect(healthField.value).toContain('❤️');

      // Verify progress bar calculation helper
      const bar = generateProgressBar(20, 20, 10, '■', '□');
      expect(bar).toBe('■■■■■■■■■■');

      const coordField = embed.fields.find((f: any) => f.name.includes('Coordinates'));
      expect(coordField).toBeDefined();
      expect(coordField.value).toContain('10.0');
      expect(coordField.value).toContain('64.0');
      expect(coordField.value).toContain('-20.0');
      expect(coordField.value).toContain('overworld');

      const taskField = embed.fields.find((f: any) => f.name.includes('Active Task'));
      expect(taskField).toBeDefined();
      expect(taskField.value).toContain('Idle');
    });

    it('T1-DISC-02: /connect command triggers Minecraft agent connection with host, port, and username', async () => {
      const { context, connectSpy } = createMockCommandContext({ connected: false });
      const interaction = createMockInteraction({
        commandName: 'connect',
        host: 'mc.hypixel.net',
        port: 25565,
        username: 'Player1',
        deferred: true,
      });

      await connectCommand.execute(interaction, context);

      expect(connectSpy).toHaveBeenCalledWith({
        host: 'mc.hypixel.net',
        port: 25565,
        username: 'Player1',
      });
      expect(interaction.editReply).toHaveBeenCalled();
      expect(interaction.editReplyPayload.content).toContain('Successfully initiated connection');
    });

    it('T1-DISC-03: /disconnect command triggers graceful Minecraft agent disconnect', async () => {
      const { context, disconnectSpy } = createMockCommandContext({ connected: true });
      const interaction = createMockInteraction({ commandName: 'disconnect', deferred: true });

      await disconnectCommand.execute(interaction, context);

      expect(disconnectSpy).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalled();
      expect(interaction.editReplyPayload.content).toContain('Disconnected Minecraft agent');
    });

    it('T1-DISC-04: /task command assigns high-level goal with author attribution', async () => {
      const { context, assignSpy } = createMockCommandContext({ connected: true });
      const interaction = createMockInteraction({
        commandName: 'task',
        goal: 'gather 10 oak_log',
        deferred: true,
      });

      await taskCommand.execute(interaction, context);

      expect(assignSpy).toHaveBeenCalledWith({
        goal: 'gather 10 oak_log',
        user: 'User#1234',
      });
      expect(interaction.editReply).toHaveBeenCalled();
      expect(interaction.editReplyPayload.content).toContain('Task Assigned');
    });

    it('T1-DISC-05: /stop command halts active task immediately', async () => {
      const { context, stopSpy } = createMockCommandContext({ connected: true });
      const interaction = createMockInteraction({ commandName: 'stop' });

      await stopCommand.execute(interaction, context);

      expect(stopSpy).toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalled();
      expect(interaction.replyPayload.content).toContain('Emergency Stop');
    });

    it('T1-DISC-06: /inventory command reports gear summary and slot metrics', async () => {
      const { context } = createMockCommandContext({ connected: true });
      const interaction = createMockInteraction({ commandName: 'inventory' });

      await inventoryCommand.execute(interaction, context);

      expect(interaction.reply).toHaveBeenCalled();
      const payload = interaction.replyPayload;
      expect(payload.embeds).toBeDefined();
      const embed = payload.embeds[0];

      const fields = embed.fields || [];
      const weaponsField = fields.find((f: any) => f.name.includes('Weapons & Tools'));
      expect(weaponsField).toBeDefined();
      expect(weaponsField.value).toContain('Diamond Sword');
      expect(weaponsField.value).toContain('Shield');

      const armorField = fields.find((f: any) => f.name.includes('Armor'));
      expect(armorField).toBeDefined();
      expect(armorField.value).toContain('Iron Helmet');

      const storageField = fields.find((f: any) => f.name.includes('Capacity'));
      expect(storageField).toBeDefined();
      expect(storageField.value).toContain('10/36');
      expect(storageField.value).toContain('26');
    });

    it('T1-DISC-07: /voice command joins specified voice channel and confirms connection', async () => {
      const { context, joinVoiceSpy } = createMockCommandContext();
      const targetChannel = { id: 'voice_channel_101', name: 'voice_channel_101' };
      const interaction = createMockInteraction({
        commandName: 'voice',
        subcommand: 'join',
        channel: targetChannel,
      });

      await voiceCommand.execute(interaction, context);

      expect(joinVoiceSpy).toHaveBeenCalledWith('voice_channel_101', 'guild_1');
      expect(interaction.reply).toHaveBeenCalled();
      expect(interaction.replyPayload.content).toContain('voice_channel_101');
    });

    it('T1-DISC-08: /help command enumerates all 8 commands, descriptions, and RBAC tiers', async () => {
      const { context } = createMockCommandContext();
      const interaction = createMockInteraction({ commandName: 'help' });

      await helpCommand.execute(interaction, context);

      expect(interaction.reply).toHaveBeenCalled();
      const payload = interaction.replyPayload;
      expect(payload.embeds).toBeDefined();
      const embed = payload.embeds[0];

      const allText = embed.fields.map((f: any) => `${f.name} ${f.value}`).join('\n');
      expect(allText).toContain('/status');
      expect(allText).toContain('/inventory');
      expect(allText).toContain('/help');
      expect(allText).toContain('/task');
      expect(allText).toContain('/stop');
      expect(allText).toContain('/voice');
      expect(allText).toContain('/connect');
      expect(allText).toContain('/disconnect');
      expect(allText).toContain('Viewer');
      expect(allText).toContain('Operator');
      expect(allText).toContain('Admin');
    });
  });

  // --------------------------------------------------------------------------
  // Auto-Deferral (F02)
  // --------------------------------------------------------------------------
  describe('Auto-Deferral Mechanism (T1-DISC-09)', () => {
    it('T1-DISC-09: withAutoDefer triggers deferReply when execution exceeds threshold', async () => {
      const interaction = createMockInteraction();
      const result = await withAutoDefer(
        interaction,
        { timeoutMs: 30 },
        async () => {
          await new Promise((r) => setTimeout(r, 80));
          return 'slow_completed_result';
        }
      );

      expect(result).toBe('slow_completed_result');
      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
    });
  });

  // --------------------------------------------------------------------------
  // Voice Session Management (F03)
  // --------------------------------------------------------------------------
  describe('Voice Session Lifecycle (T1-DISC-10)', () => {
    it('T1-DISC-10: joins voice channel, creates active session, and cleans up on leaveVoice', async () => {
      const gateway = new MockDiscordGateway();
      const session = (await gateway.joinVoice('voice_channel_1', 'guild_test_1')) as any;

      expect(session).toBeDefined();
      expect(gateway.activeVoiceSessions.has('guild_test_1')).toBe(true);
      expect(session.isDestroyed).toBe(false);

      const stream = session.subscribeUser('test_user');
      expect(stream).toBeDefined();

      await gateway.leaveVoice('guild_test_1');
      expect(gateway.activeVoiceSessions.has('guild_test_1')).toBe(false);
      expect(session.isDestroyed).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Chat Bridge Relay (F09)
  // --------------------------------------------------------------------------
  describe('Chat Bridge Relay (T1-DISC-11, T1-DISC-12)', () => {
    it('T1-DISC-11: relays Discord message to Minecraft server chat', async () => {
      let discordMessageHandler: ((msg: UserMessage) => Promise<void>) | null = null;
      const sentToMinecraft: string[] = [];

      const mockGateway: IDiscordGateway = {
        registerCommands: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockResolvedValue('msg_1'),
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
        on: vi.fn(),
        removeListener: vi.fn(),
      };

      const bridge = new ChatBridge(mockGateway, mockAgent, {
        bridgeChannelId: 'bridge_channel_1',
        botDiscordId: 'bot_id',
        botMinecraftUsername: 'SurvivalBot',
        rateLimitDelayMs: 10,
      });

      bridge.start();

      expect(discordMessageHandler).not.toBeNull();
      await discordMessageHandler!({
        id: 'msg_101',
        channelId: 'bridge_channel_1',
        author: { id: 'user_regular', username: 'Alex', bot: false },
        content: 'Hello from Discord!',
        createdAt: new Date(),
      });

      // Wait for leaky bucket drain
      await new Promise((r) => setTimeout(r, 40));

      expect(sentToMinecraft.length).toBe(1);
      expect(sentToMinecraft[0]).toContain('[Discord] <Alex>: Hello from Discord!');

      bridge.stop();
    });

    it('T1-DISC-12: relays Minecraft server chat event to Discord text channel', async () => {
      let mcChatListener: ((username: string, message: string) => void) | null = null;
      const sentToDiscord: Array<{ channelId: string; content: string }> = [];

      const mockGateway: IDiscordGateway = {
        registerCommands: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockImplementation(async (channelId, content) => {
          sentToDiscord.push({
            channelId,
            content: typeof content === 'string' ? content : (content.content ?? ''),
          });
          return 'msg_id_1';
        }),
        updateEmbed: vi.fn().mockResolvedValue(undefined),
        joinVoice: vi.fn(),
        leaveVoice: vi.fn().mockResolvedValue(undefined),
        onCommand: vi.fn(),
        onMessage: vi.fn(),
      };

      const mockAgent: IMinecraftChatAgent = {
        sendChat: vi.fn().mockResolvedValue(undefined),
        on: vi.fn().mockImplementation((event, listener) => {
          if (event === 'chat') mcChatListener = listener;
        }),
        removeListener: vi.fn(),
      };

      const bridge = new ChatBridge(mockGateway, mockAgent, {
        bridgeChannelId: 'bridge_channel_1',
        botDiscordId: 'bot_id',
        botMinecraftUsername: 'SurvivalBot',
      });

      bridge.start();

      expect(mcChatListener).not.toBeNull();
      mcChatListener!('Steve', 'Hello from Minecraft!');

      expect(sentToDiscord.length).toBe(1);
      expect(sentToDiscord[0].channelId).toBe('bridge_channel_1');
      expect(sentToDiscord[0].content).toContain('[Minecraft] <Steve>');
      expect(sentToDiscord[0].content).toContain('Hello from Minecraft!');

      bridge.stop();
    });
  });

  // --------------------------------------------------------------------------
  // Triple-Lock Anti-Loopback Filter (F10)
  // --------------------------------------------------------------------------
  describe('Triple-Lock Anti-Loopback Filter (T1-DISC-13 to T1-DISC-15)', () => {
    const filter = new AntiLoopbackFilter({
      botDiscordId: 'self_bot_discord_id',
      botMinecraftUsername: 'SurvivalBot',
      ttlMs: 5000,
    });

    it('T1-DISC-13: drops messages authored by self bot ID (Lock 1)', () => {
      const result = filter.evaluate({
        source: 'discord',
        authorId: 'self_bot_discord_id',
        content: 'Relayed message echo',
      });

      expect(result.drop).toBe(true);
      expect(result.reason).toBe('SELF_BOT_ID');
    });

    it('T1-DISC-14: drops messages authored by external bot accounts (Lock 2)', () => {
      const result = filter.evaluate({
        source: 'discord',
        authorId: 'other_bot_999',
        isBotAccount: true,
        content: 'Server announcement broadcast',
      });

      expect(result.drop).toBe(true);
      expect(result.reason).toBe('BOT_ACCOUNT');
    });

    it('T1-DISC-15: drops duplicate messages within TTL hash window (Lock 3)', () => {
      filter.clear();
      filter.recordOutbound('Recent outbound message to server');

      const result = filter.evaluate({
        source: 'minecraft',
        authorUsername: 'ServerEcho',
        content: 'Recent outbound message to server',
      });

      expect(result.drop).toBe(true);
      expect(result.reason).toBe('DUPLICATE_TTL_HASH');
    });
  });

  // --------------------------------------------------------------------------
  // Chat Sanitization (F11)
  // --------------------------------------------------------------------------
  describe('Chat Sanitization & Formatting (T1-DISC-16)', () => {
    it('T1-DISC-16: strips legacy Minecraft § formatting codes and control characters', () => {
      const filter = new AntiLoopbackFilter({
        botDiscordId: 'bot_id',
        botMinecraftUsername: 'bot_mc',
      });

      const raw = '§aGreen §cRed \r\n';
      const clean = filter.sanitizeForMinecraft(raw);

      expect(clean).toBe('Green Red');
      expect(clean).not.toContain('§');
      expect(clean).not.toContain('\r');
      expect(clean).not.toContain('\n');
    });
  });

  // --------------------------------------------------------------------------
  // Live Status Embeds (F13, F14)
  // --------------------------------------------------------------------------
  describe('Status Embed Generation & Throttling (T1-DISC-17, T1-DISC-18)', () => {
    it('T1-DISC-17: buildStatusEmbed sets green color and renders 8/10 health progress bar', () => {
      const status: MinecraftBotStatus = {
        connected: true,
        username: 'SurvivalBot',
        health: 16,
        food: 14,
        position: { x: 100, y: 64, z: -200 },
        dimension: 'overworld',
        currentTask: 'Chopping trees',
        gear: {
          mainHand: 'Iron Axe',
          armorSummary: 'Iron Armor',
        },
        inventory: {
          usedSlots: 10,
          totalSlots: 36,
          freeSlots: 26,
        },
      };

      const embed = buildStatusEmbed(status);

      expect(embed.color).toBe(0x2ecc71); // Green for HP > 15
      const healthField = embed.fields?.find((f) => f.name.includes('Health'));
      expect(healthField).toBeDefined();
      // 16 / 20 = 8 segments filled out of 10
      expect(healthField?.value).toContain('❤️❤️❤️❤️❤️❤️❤️❤️🤍🤍');
      expect(healthField?.value).toContain('16.0/20');

      const coordField = embed.fields?.find((f) => f.name.includes('Coordinates'));
      expect(coordField?.value).toContain('X: 100.0, Y: 64.0, Z: -200.0');
    });

    it('T1-DISC-18: StatusEmbedManager suppresses duplicate updates via state hashing', async () => {
      const updateEmbedSpy = vi.fn().mockResolvedValue(undefined);
      const sendMessageSpy = vi.fn().mockResolvedValue('msg_1');

      const mockGateway: IDiscordGateway = {
        registerCommands: vi.fn(),
        sendMessage: sendMessageSpy,
        updateEmbed: updateEmbedSpy,
        joinVoice: vi.fn(),
        leaveVoice: vi.fn(),
        onCommand: vi.fn(),
        onMessage: vi.fn(),
      };

      const manager = new StatusEmbedManager(mockGateway, {
        statusChannelId: 'status_chan_1',
        updateIntervalSec: 10,
      });

      const status: MinecraftBotStatus = {
        connected: true,
        username: 'Bot',
        health: 20,
        food: 20,
        position: { x: 0, y: 64, z: 0 },
        dimension: 'overworld',
      };

      manager.updateState(status);

      // First tick sends initial message
      const firstTick = await manager.tick();
      expect(firstTick).toBe(true);
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);

      // 4 subsequent ticks with identical status are suppressed
      for (let i = 0; i < 4; i++) {
        const suppressed = await manager.tick();
        expect(suppressed).toBe(false);
      }

      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(updateEmbedSpy).toHaveBeenCalledTimes(0);
    });
  });

  // --------------------------------------------------------------------------
  // Role-Based Access Control (F15)
  // --------------------------------------------------------------------------
  describe('RBAC Authorization Tiers (T1-DISC-19 to T1-DISC-21)', () => {
    const rbac = new RBACService(createTestRbacConfig());

    it('T1-DISC-19: VIEWER tier is universally accessible to unauthenticated users', () => {
      const unauthMember = null;
      const user = { id: 'random_guest_999', username: 'GuestUser' } as any;

      const result = rbac.check(unauthMember, user, RBACTier.VIEWER);

      expect(result.allowed).toBe(true);
      expect(result.userTier).toBe(RBACTier.VIEWER);
    });

    it('T1-DISC-20: OPERATOR tier granted to user with whitelisted operator role', () => {
      const opMember = {
        roles: {
          cache: new Map([['role_operator', true]]),
        },
      } as any;
      const user = { id: 'user_123', username: 'OperatorUser' } as any;

      const result = rbac.check(opMember, user, RBACTier.OPERATOR);

      expect(result.allowed).toBe(true);
      expect(result.userTier).toBe(RBACTier.OPERATOR);
    });

    it('T1-DISC-21: ADMIN tier granted to user with Discord Administrator permission bitflag', () => {
      const adminMember = {
        permissions: {
          has: (flag: bigint) =>
            (flag & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator,
          bitfield: PermissionFlagsBits.Administrator,
        },
      } as any;
      const user = { id: 'admin_server_user', username: 'AdminUser' } as any;

      const result = rbac.check(adminMember, user, RBACTier.ADMIN);

      expect(result.allowed).toBe(true);
      expect(result.userTier).toBe(RBACTier.ADMIN);
    });
  });
});
