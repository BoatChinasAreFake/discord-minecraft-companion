import { describe, it, expect, vi } from 'vitest';
import {
  generateProgressBar,
  computeStateHash,
  buildStatusEmbed,
  StatusEmbedManager,
} from '../../src/discord/embed.js';
import type { MinecraftBotStatus } from '../../src/minecraft/types.js';
import type { IDiscordGateway } from '../../src/discord/types.js';

function createDummyStatus(overrides?: Partial<MinecraftBotStatus>): MinecraftBotStatus {
  return {
    connected: true,
    username: 'TestBot',
    health: 20,
    food: 20,
    position: { x: 100.2, y: 64.0, z: -200.4 },
    dimension: 'overworld',
    currentTask: 'Chopping trees',
    gear: {
      mainHand: 'Iron Axe',
      offHand: 'Shield',
      armorSummary: 'Full Iron',
      helmet: 'Iron Helmet',
      chestplate: 'Iron Chestplate',
      leggings: 'Iron Leggings',
      boots: 'Iron Boots',
    },
    inventory: {
      usedSlots: 15,
      totalSlots: 36,
      freeSlots: 21,
    },
    server: {
      host: 'mc.example.com',
      port: 25565,
      ping: 25,
    },
    ...overrides,
  };
}

describe('Live Status Embed Subsystem (src/discord/embed.ts)', () => {
  it('TC-EMB-1: generateProgressBar builds accurate visual segment bars', () => {
    // 5 out of 10
    const half = generateProgressBar(10, 20, 10, '■', '□');
    expect(half).toBe('■■■■■□□□□□');

    // Clamps overflow
    const overflow = generateProgressBar(25, 20, 10, '■', '□');
    expect(overflow).toBe('■■■■■■■■■■');

    // Clamps underflow
    const underflow = generateProgressBar(-5, 20, 10, '■', '□');
    expect(underflow).toBe('□□□□□□□□□□');
  });

  it('TC-EMB-2: buildStatusEmbed applies dynamic health colors', () => {
    // Green for HP > 15
    const greenEmbed = buildStatusEmbed(createDummyStatus({ health: 18 }));
    expect(greenEmbed.color).toBe(0x2ecc71);

    // Yellow for 7 < HP <= 15
    const yellowEmbed = buildStatusEmbed(createDummyStatus({ health: 12 }));
    expect(yellowEmbed.color).toBe(0xf1c40f);

    // Red for HP <= 7
    const redEmbed = buildStatusEmbed(createDummyStatus({ health: 5 }));
    expect(redEmbed.color).toBe(0xe74c3c);
  });

  it('TC-EMB-3: buildStatusEmbed returns offline gray embed when disconnected', () => {
    const offlineEmbed = buildStatusEmbed(createDummyStatus({ connected: false }));
    expect(offlineEmbed.color).toBe(0x95a5a6);
    expect(offlineEmbed.description).toContain('Offline / Disconnected');
  });

  it('TC-EMB-4: computeStateHash suppresses sub-0.5 coordinate micro-jitter', () => {
    const statusA = createDummyStatus({ position: { x: 100.1, y: 64.0, z: -200.2 } });
    const statusB = createDummyStatus({ position: { x: 100.2, y: 64.1, z: -200.3 } });

    // Rounding coordinates to integers produces the exact same hash
    expect(computeStateHash(statusA)).toBe(computeStateHash(statusB));

    // Meaningful movement changes the hash
    const statusC = createDummyStatus({ position: { x: 150.0, y: 64.0, z: -200.0 } });
    expect(computeStateHash(statusA)).not.toBe(computeStateHash(statusC));
  });

  it('TC-EMB-5: StatusEmbedManager skips Discord API edit when state hash is unchanged', async () => {
    const updateEmbedSpy = vi.fn().mockResolvedValue(undefined);
    const sendMessageSpy = vi.fn().mockResolvedValue('created_msg_1');

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
      pinnedMessageId: 'pinned_1',
    });

    const status = createDummyStatus();
    manager.updateState(status);

    // First tick updates
    const updatedFirst = await manager.tick();
    expect(updatedFirst).toBe(true);
    expect(updateEmbedSpy).toHaveBeenCalledTimes(1);

    // Second tick with unchanged status is skipped!
    const updatedSecond = await manager.tick();
    expect(updatedSecond).toBe(false);
    expect(updateEmbedSpy).toHaveBeenCalledTimes(1);
  });

  it('TC-EMB-6: StatusEmbedManager heals from Discord Error 10008 by sending new pin', async () => {
    let callCount = 0;
    const updateEmbedSpy = vi.fn().mockImplementation(async () => {
      callCount++;
      const err: any = new Error('Unknown Message');
      err.code = 10008;
      throw err;
    });
    const sendMessageSpy = vi.fn().mockResolvedValue('recreated_msg_99');

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
      pinnedMessageId: 'old_deleted_pin',
    });

    const status = createDummyStatus();
    manager.updateState(status);

    await manager.tick();

    // Catch 10008 cleared old pin and immediately recreated message
    expect(sendMessageSpy).toHaveBeenCalled();
    expect(manager.getCurrentMessageId()).toBe('recreated_msg_99');
  });
});
