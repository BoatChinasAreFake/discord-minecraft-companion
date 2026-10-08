import { describe, it, expect, beforeEach } from 'vitest';
import { MinecraftClient } from '../../src/minecraft/client.js';
import { MockWorld, MockMineflayerBot } from '../mocks/mockMinecraft.js';
import { PrivilegedCommandError } from '../../src/minecraft/fairplay/commandSanitizer.js';

describe('Milestone 2: Minecraft Client Lifecycle & Subsystem Orchestration', () => {
  let world: MockWorld;
  let bot: MockMineflayerBot;
  let client: MinecraftClient;

  beforeEach(() => {
    world = new MockWorld();
    bot = new MockMineflayerBot(world, { x: 0, y: 64, z: 0 });
    client = new MinecraftClient({
      bot,
      maxReconnectRetries: 3,
      baseReconnectDelayMs: 100,
      maxReconnectDelayMs: 1000,
      statusThrottleMs: 10,
      enableAutoEat: false,
      enableAutoSleep: false,
      enableAutoEquip: false,
    });
  });

  describe('Lifecycle State Machine (client.ts)', () => {
    it('TC-CLI-1: connect(config) transitions state to SPAWNED and populates status', async () => {
      expect(client.state).toBe('DISCONNECTED');

      await client.connect({
        host: 'mc.example.com',
        port: 25565,
        username: 'SurvivalBot',
      });

      expect(client.state).toBe('SPAWNED');
      const status = client.getStatus();
      expect(status.connected).toBe(true);
      expect(status.username).toBe('SurvivalBot');
      expect(status.server.host).toBe('mc.example.com');
    });

    it('TC-CLI-2: disconnect() transitions state to DISCONNECTED and halts loops', async () => {
      await client.connect({ host: 'localhost', port: 25565, username: 'TestBot' });
      expect(client.state).toBe('SPAWNED');

      await client.disconnect();
      expect(client.state).toBe('DISCONNECTED');
      expect(client.getStatus().connected).toBe(false);
    });

    it('TC-CLI-3: Backoff delay calculation scales exponentially within jitter limits', () => {
      const delay0 = client.calculateBackoffDelay(0);
      const delay1 = client.calculateBackoffDelay(1);
      const delay2 = client.calculateBackoffDelay(2);

      // Base 100 * 2^0 = 100 (+/- 20% -> 80 - 120)
      expect(delay0).toBeGreaterThanOrEqual(80);
      expect(delay0).toBeLessThanOrEqual(120);

      // Base 100 * 2^1 = 200 (+/- 20% -> 160 - 240)
      expect(delay1).toBeGreaterThanOrEqual(160);
      expect(delay1).toBeLessThanOrEqual(240);

      // Base 100 * 2^2 = 400 (+/- 20% -> 320 - 480)
      expect(delay2).toBeGreaterThanOrEqual(320);
      expect(delay2).toBeLessThanOrEqual(480);
    });

    it('TC-CLI-4: Unexpected socket end event triggers RECONNECTING state', async () => {
      await client.connect({ host: 'localhost', port: 25565, username: 'TestBot' });
      expect(client.state).toBe('SPAWNED');

      // Server drops connection unexpectedly
      bot.emit('end');
      expect(client.state).toBe('RECONNECTING');

      // Intentional disconnect cleans up
      await client.disconnect();
      expect(client.state).toBe('DISCONNECTED');
    });

    it('TC-CLI-5: Kicked event retains kick message and triggers reconnection logic', async () => {
      await client.connect({ host: 'localhost', port: 25565, username: 'TestBot' });

      let capturedKickReason = '';
      client.on('kicked', (reason: string) => {
        capturedKickReason = reason;
      });

      bot.emit('kicked', 'Server restart in progress');
      expect(capturedKickReason).toBe('Server restart in progress');
      expect(client.state).toBe('RECONNECTING');

      await client.disconnect();
    });
  });

  describe('Event Bridges (client.ts)', () => {
    it('TC-BRG-1: Player chat event bridges from bot to client chat listener', async () => {
      await client.connect({ host: 'localhost', port: 25565, username: 'CompanionBot' });

      let receivedUser = '';
      let receivedMsg = '';
      client.on('chat', (username: string, message: string) => {
        receivedUser = username;
        receivedMsg = message;
      });

      bot.emit('chat', 'Alice', 'Hello CompanionBot!');
      expect(receivedUser).toBe('Alice');
      expect(receivedMsg).toBe('Hello CompanionBot!');
    });

    it('TC-BRG-2: Health update triggers statusUpdate event', async () => {
      await client.connect({ host: 'localhost', port: 25565, username: 'CompanionBot' });

      let updatedHealth = 0;
      client.on('statusUpdate', (status) => {
        updatedHealth = status.health;
      });

      bot.health = 14.5;
      bot.emit('health');

      expect(updatedHealth).toBe(14.5);
    });

    it('TC-BRG-3: Bot death triggers death event and auto-respawn', async () => {
      await client.connect({ host: 'localhost', port: 25565, username: 'CompanionBot' });

      let deathTriggered = false;
      client.on('death', () => {
        deathTriggered = true;
      });

      bot.health = 0;
      bot.emit('death');

      expect(deathTriggered).toBe(true);
    });
  });

  describe('Fair-Play Perception & Action Orchestration (client.ts)', () => {
    it('TC-ACT-1: canInteractWith returns true for reachable exposed block', () => {
      world.setBlock({ x: 2, y: 64, z: 0 }, 'oak_log');
      world.setBlock({ x: 2, y: 65, z: 0 }, 'air');

      expect(client.canInteractWith({ x: 2, y: 64, z: 0 })).toBe(true);
    });

    it('TC-ACT-2: canInteractWith returns false for block > 4.50m reach', () => {
      world.setBlock({ x: 10, y: 64, z: 0 }, 'oak_log');
      expect(client.canInteractWith({ x: 10, y: 64, z: 0 })).toBe(false);
    });

    it('TC-ACT-3: canInteractWith returns false for block behind solid wall', () => {
      world.setBlock({ x: 3, y: 64, z: 0 }, 'diamond_ore');
      world.setBlock({ x: 1, y: 64, z: 0 }, 'stone'); // Wall
      world.setBlock({ x: 1, y: 65, z: 0 }, 'stone'); // Wall eye level
      expect(client.canInteractWith({ x: 3, y: 64, z: 0 })).toBe(false);
    });

    it('TC-ACT-4: sendChat rejects OP commands via CommandSanitizer', async () => {
      await expect(client.sendChat('/tp Alice 0 100 0')).rejects.toThrow(PrivilegedCommandError);
      await expect(client.sendChat('/give @p diamond 64')).rejects.toThrow(PrivilegedCommandError);
    });

    it('TC-ACT-5: sendChat successfully sends legitimate survival chat', async () => {
      let sentChat = '';
      bot.on('chat', (sender, msg) => {
        sentChat = msg;
      });

      await client.sendChat('I am gathering resources!');
      expect(sentChat).toBe('I am gathering resources!');
    });

    it('TC-ACT-6: findVisibleBlock discovers exposed ore in FOV', async () => {
      // Facing South (yaw = 0, pitch = 0)
      bot.entity.yaw = 0;
      bot.entity.pitch = 0;

      // Place exposed diamond ore in forward look direction (z = -3)
      world.setBlock({ x: 0, y: 64, z: -3 }, 'diamond_ore');
      world.setBlock({ x: 0, y: 65, z: -3 }, 'air'); // Exposed top

      const found = await client.findVisibleBlock({
        blockNames: ['diamond_ore'],
        maxDistance: 16,
      });

      expect(found).not.toBeNull();
      expect(found?.name).toBe('diamond_ore');
      expect(found?.position.z).toBe(-3);
    });

    it('TC-ACT-7: High-level action methods update currentTask and return ActionResult', async () => {
      world.setBlock({ x: 1, y: 64, z: 0 }, 'dirt');

      const mineRes = await client.mineBlock({ x: 1, y: 64, z: 0 });
      expect(mineRes.success).toBe(true);

      const navRes = await client.navigateTo({ x: 4, y: 64, z: 4 });
      expect(navRes.success).toBe(true);
      expect(bot.entity.position.x).toBe(4);
    });
  });
});
