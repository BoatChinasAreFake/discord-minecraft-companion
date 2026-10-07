import { describe, it, expect, vi } from 'vitest';
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
import { RBACTier } from '../../src/discord/rbac.js';
import type { CommandContext } from '../../src/discord/types.js';
import type { MinecraftBotStatus } from '../../src/minecraft/types.js';

function createMockContext(statusOverrides?: Partial<MinecraftBotStatus>): {
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
  return {
    commandName: options.commandName || 'test',
    user: { id: 'user_1', tag: 'User#1234', username: 'User' },
    member: options.member || null,
    guildId: 'guild_1',
    deferred: false,
    replied: false,
    reply: vi.fn().mockImplementation(async () => {
      // reply called
    }),
    editReply: vi.fn().mockImplementation(async () => {
      // editReply called
    }),
    deferReply: vi.fn().mockImplementation(async () => {
      // deferReply called
    }),
    options: {
      getString: vi.fn().mockImplementation((name: string) => options[name] ?? null),
      getInteger: vi.fn().mockImplementation((name: string) => options[name] ?? null),
      getChannel: vi.fn().mockImplementation((name: string) => options[name] ?? null),
      getSubcommand: vi.fn().mockImplementation(() => options.subcommand ?? ''),
    },
  };
}

describe('Slash Commands Subsystem (src/discord/commands/)', () => {
  it('TC-CMD-1: registers all 8 slash commands with expected tiers', () => {
    const registry = createDefaultCommandRegistry();
    const all = registry.getAll();
    expect(all.length).toBe(8);

    expect(registry.get('status')?.tier).toBe(RBACTier.VIEWER);
    expect(registry.get('connect')?.tier).toBe(RBACTier.ADMIN);
    expect(registry.get('disconnect')?.tier).toBe(RBACTier.ADMIN);
    expect(registry.get('task')?.tier).toBe(RBACTier.OPERATOR);
    expect(registry.get('stop')?.tier).toBe(RBACTier.OPERATOR);
    expect(registry.get('inventory')?.tier).toBe(RBACTier.VIEWER);
    expect(registry.get('voice')?.tier).toBe(RBACTier.OPERATOR);
    expect(registry.get('help')?.tier).toBe(RBACTier.VIEWER);
  });

  it('TC-CMD-2: withAutoDefer completes fast tasks without calling deferReply', async () => {
    const interaction = createMockInteraction();
    const result = await withAutoDefer(
      interaction,
      { timeoutMs: 100 },
      async () => 'fast_result'
    );

    expect(result).toBe('fast_result');
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it('TC-CMD-3: withAutoDefer calls deferReply when task exceeds timeout', async () => {
    const interaction = createMockInteraction();
    const result = await withAutoDefer(
      interaction,
      { timeoutMs: 50 },
      async () => {
        await new Promise((r) => setTimeout(r, 120));
        return 'slow_result';
      }
    );

    expect(result).toBe('slow_result');
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
  });

  it('TC-CMD-4: /status replies with formatted status embed', async () => {
    const { context } = createMockContext();
    const interaction = createMockInteraction({ commandName: 'status' });

    await statusCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalled();
    const callArgs = interaction.reply.mock.calls[0][0];
    expect(callArgs.embeds).toBeDefined();
    expect(callArgs.embeds[0].title).toContain('TestBot');
  });

  it('TC-CMD-5: /connect initiates connection if currently offline', async () => {
    const { context, connectSpy } = createMockContext({ connected: false });
    const interaction = createMockInteraction({
      commandName: 'connect',
      host: 'mc.example.com',
      port: 25565,
      username: 'MinerBot',
    });
    interaction.deferred = true;

    await connectCommand.execute(interaction, context);

    expect(connectSpy).toHaveBeenCalledWith({
      host: 'mc.example.com',
      port: 25565,
      username: 'MinerBot',
    });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Successfully initiated connection') })
    );
  });

  it('TC-CMD-6: /connect returns warning if already connected', async () => {
    const { context, connectSpy } = createMockContext({ connected: true });
    const interaction = createMockInteraction({ commandName: 'connect' });

    await connectCommand.execute(interaction, context);

    expect(connectSpy).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('already connected') })
    );
  });

  it('TC-CMD-7: /disconnect invokes coordinator disconnect', async () => {
    const { context, disconnectSpy } = createMockContext({ connected: true });
    const interaction = createMockInteraction({ commandName: 'disconnect' });

    await disconnectCommand.execute(interaction, context);

    expect(disconnectSpy).toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Disconnected Minecraft agent') })
    );
  });

  it('TC-CMD-8: /task assigns goal when bot is connected', async () => {
    const { context, assignSpy } = createMockContext({ connected: true });
    const interaction = createMockInteraction({
      commandName: 'task',
      goal: 'gather 10 oak logs',
    });
    interaction.deferred = true;

    await taskCommand.execute(interaction, context);

    expect(assignSpy).toHaveBeenCalledWith({
      goal: 'gather 10 oak logs',
      user: 'User#1234',
    });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('gather 10 oak logs') })
    );
  });

  it('TC-CMD-9: /task rejects when bot is offline', async () => {
    const { context, assignSpy } = createMockContext({ connected: false });
    const interaction = createMockInteraction({
      commandName: 'task',
      goal: 'gather 10 oak logs',
    });

    await taskCommand.execute(interaction, context);

    expect(assignSpy).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Bot is offline') })
    );
  });

  it('TC-CMD-10: /stop halts current task', async () => {
    const { context, stopSpy } = createMockContext({ connected: true });
    const interaction = createMockInteraction({ commandName: 'stop' });

    await stopCommand.execute(interaction, context);

    expect(stopSpy).toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Emergency Stop') })
    );
  });

  it('TC-CMD-11: /inventory displays gear and slot capacity', async () => {
    const { context } = createMockContext({ connected: true });
    const interaction = createMockInteraction({ commandName: 'inventory' });

    await inventoryCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalled();
    const payload = interaction.reply.mock.calls[0][0];
    expect(payload.embeds[0].title).toContain('Inventory & Equipment');
  });

  it('TC-CMD-12: /voice join and leave manage voice channels', async () => {
    const { context, joinVoiceSpy, leaveVoiceSpy } = createMockContext();

    // Voice join with channel specified
    const joinInteraction = createMockInteraction({
      commandName: 'voice',
      subcommand: 'join',
      channel: { id: 'voice_chan_99' },
    });
    await voiceCommand.execute(joinInteraction, context);
    expect(joinVoiceSpy).toHaveBeenCalledWith('voice_chan_99', 'guild_1');

    // Voice leave
    const leaveInteraction = createMockInteraction({
      commandName: 'voice',
      subcommand: 'leave',
    });
    await voiceCommand.execute(leaveInteraction, context);
    expect(leaveVoiceSpy).toHaveBeenCalledWith('guild_1');
  });

  it('TC-CMD-13: /help displays command directory and fair-play rules', async () => {
    const { context } = createMockContext();
    const interaction = createMockInteraction({ commandName: 'help' });

    await helpCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalled();
    const payload = interaction.reply.mock.calls[0][0];
    expect(payload.embeds[0].title).toContain('Help');
  });
});
