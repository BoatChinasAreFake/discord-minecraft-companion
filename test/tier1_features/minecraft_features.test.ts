import { describe, it, expect, beforeEach } from 'vitest';
import { MinecraftClient } from '../../src/minecraft/client.js';
import { MockWorld, MockMineflayerBot } from '../mocks/mockMinecraft.js';
import {
  evaluateBlockExposure,
  isExposingBlock,
} from '../../src/minecraft/perception/exposure.js';
import {
  checkLineOfSight,
  hasBlockLineOfSight,
} from '../../src/minecraft/perception/raycast.js';
import {
  isWithinPerceptionFOV,
  getLookVectorFromYawPitch,
} from '../../src/minecraft/perception/fov.js';
import {
  assertBlockReach,
  assertEntityAttackReach,
  getBlockDistanceToEye,
} from '../../src/minecraft/fairplay/reach.js';
import {
  assertAllowedMinecraftChat,
  sanitizeMinecraftMessage,
} from '../../src/minecraft/fairplay/commandSanitizer.js';
import { PathfinderAction } from '../../src/minecraft/actions/pathfinding.js';
import { MiningAction, canSafelyHarvest } from '../../src/minecraft/actions/mining.js';
import { CraftingAction } from '../../src/minecraft/actions/crafting.js';
import { CombatAction, CombatCooldownController } from '../../src/minecraft/actions/combat.js';
import { AutoEatLoop } from '../../src/minecraft/loops/autoEat.js';
import { AutoSleepLoop } from '../../src/minecraft/loops/autoSleep.js';
import { AutoEquipLoop } from '../../src/minecraft/loops/autoEquip.js';

describe('Tier 1: Minecraft Gameplay Agent Feature Coverage (F18-F34)', () => {
  let world: MockWorld;
  let bot: MockMineflayerBot;
  let client: MinecraftClient;

  beforeEach(() => {
    world = new MockWorld();
    bot = new MockMineflayerBot(world, { x: 0, y: 64, z: 0 });
    client = new MinecraftClient({
      bot,
      maxReconnectRetries: 2,
      baseReconnectDelayMs: 50,
      maxReconnectDelayMs: 200,
      statusThrottleMs: 10,
      enableAutoEat: false,
      enableAutoSleep: false,
      enableAutoEquip: false,
    });
  });

  // --------------------------------------------------------------------------
  // Client Lifecycle (F18)
  // --------------------------------------------------------------------------
  describe('Client Lifecycle (T1-MC-01, T1-MC-02)', () => {
    it('T1-MC-01: connects client, transitions state to SPAWNED, and emits statusUpdate', async () => {
      let statusEmitted = false;
      client.on('statusUpdate', (status) => {
        if (status.connected) statusEmitted = true;
      });

      await client.connect({
        host: 'mc.hypixel.net',
        port: 25565,
        username: 'TestBot',
      });

      expect(client.state).toBe('SPAWNED');
      expect(client.getStatus().connected).toBe(true);
      expect(client.getStatus().username).toBe('TestBot');
      expect(statusEmitted).toBe(true);
    });

    it('T1-MC-02: disconnect() gracefully halts loops and sets state to DISCONNECTED', async () => {
      await client.connect({ host: 'localhost', port: 25565, username: 'TestBot' });
      expect(client.state).toBe('SPAWNED');

      await client.disconnect();

      expect(client.state).toBe('DISCONNECTED');
      expect(client.getStatus().connected).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Surface Exposure Filter (F19)
  // --------------------------------------------------------------------------
  describe('Surface Exposure Filter (T1-MC-03 to T1-MC-05)', () => {
    it('T1-MC-03: encased block with 6 solid stone neighbors evaluates to isExposed === false', () => {
      const targetPos = { x: 10, y: 50, z: 10 };
      world.setBlock(targetPos, 'diamond_ore');

      // Surround on all 6 faces with solid stone
      world.setBlock({ x: 11, y: 50, z: 10 }, 'stone');
      world.setBlock({ x: 9, y: 50, z: 10 }, 'stone');
      world.setBlock({ x: 10, y: 51, z: 10 }, 'stone');
      world.setBlock({ x: 10, y: 49, z: 10 }, 'stone');
      world.setBlock({ x: 10, y: 50, z: 11 }, 'stone');
      world.setBlock({ x: 10, y: 50, z: 9 }, 'stone');

      const exposure = evaluateBlockExposure(world, targetPos);
      expect(exposure.isExposed).toBe(false);
      expect(exposure.exposedFaces).toHaveLength(0);
      expect(exposure.exposedFaceCenters).toHaveLength(0);
    });

    it('T1-MC-04: exposed cardinal +Y face evaluates to isExposed === true with face center', () => {
      const targetPos = { x: 5, y: 60, z: 5 };
      world.setBlock(targetPos, 'iron_ore');

      world.setBlock({ x: 6, y: 60, z: 5 }, 'stone');
      world.setBlock({ x: 4, y: 60, z: 5 }, 'stone');
      world.setBlock({ x: 5, y: 59, z: 5 }, 'stone');
      world.setBlock({ x: 5, y: 60, z: 6 }, 'stone');
      world.setBlock({ x: 5, y: 60, z: 4 }, 'stone');
      world.setBlock({ x: 5, y: 61, z: 5 }, 'air'); // Top face open to air

      const exposure = evaluateBlockExposure(world, targetPos);
      expect(exposure.isExposed).toBe(true);
      expect(exposure.exposedFaces).toContain('+y');
      expect(exposure.exposedFaceCenters).toEqual([{ x: 5.5, y: 61.0, z: 5.5 }]);
    });

    it('T1-MC-05: transparent water and glass blocks qualify as exposing mediums', () => {
      const targetPos = { x: 2, y: 64, z: 2 };
      world.setBlock(targetPos, 'gold_ore');

      world.setBlock({ x: 3, y: 64, z: 2 }, 'glass');
      world.setBlock({ x: 1, y: 64, z: 2 }, 'water');
      world.setBlock({ x: 2, y: 65, z: 2 }, 'stone');
      world.setBlock({ x: 2, y: 63, z: 2 }, 'stone');
      world.setBlock({ x: 2, y: 64, z: 3 }, 'stone');
      world.setBlock({ x: 2, y: 64, z: 1 }, 'stone');

      const exposure = evaluateBlockExposure(world, targetPos);
      expect(exposure.isExposed).toBe(true);
      expect(exposure.exposedFaces).toContain('+x');
      expect(exposure.exposedFaces).toContain('-x');
      expect(isExposingBlock({ name: 'glass', transparent: true })).toBe(true);
      expect(isExposingBlock({ name: 'water', transparent: true })).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 3D DDA Raycasting (F20)
  // --------------------------------------------------------------------------
  describe('3D DDA Line-of-Sight Raycasting (T1-MC-06, T1-MC-07)', () => {
    it('T1-MC-06: unobstructed raycast through air confirms visible line of sight', () => {
      const eyePos = { x: 0, y: 65.62, z: 0 };
      const targetVoxel = { x: 3, y: 65, z: 0 };
      const targetFaceCenter = { x: 3.5, y: 65.5, z: 0.5 };

      world.setBlock(targetVoxel, 'gold_ore');
      world.setBlock({ x: 1, y: 65, z: 0 }, 'air');
      world.setBlock({ x: 2, y: 65, z: 0 }, 'air');

      const result = checkLineOfSight(world, eyePos, targetVoxel, targetFaceCenter, 16);
      expect(result.visible).toBe(true);
      expect(result.distance).toBeGreaterThan(0);

      const hasLos = hasBlockLineOfSight(world, eyePos, targetVoxel, [targetFaceCenter]);
      expect(hasLos).toBe(true);
    });

    it('T1-MC-07: obstructed raycast identifies solid cobblestone wall and blocks visibility', () => {
      const eyePos = { x: 0, y: 65.62, z: 0 };
      const targetVoxel = { x: 4, y: 65, z: 0 };
      const targetFaceCenter = { x: 4.5, y: 65.5, z: 0.5 };

      world.setBlock(targetVoxel, 'diamond_ore');
      world.setBlock({ x: 2, y: 65, z: 0 }, 'cobblestone');

      const result = checkLineOfSight(world, eyePos, targetVoxel, targetFaceCenter, 16);
      expect(result.visible).toBe(false);
      expect(result.obstruction).toBe('cobblestone');
      expect(result.hitVoxel).toEqual({ x: 2, y: 65, z: 0 });
    });
  });

  // --------------------------------------------------------------------------
  // Perception FOV Cone (F21)
  // --------------------------------------------------------------------------
  describe('Perception FOV Cone & Tactile Fallback (T1-MC-08 to T1-MC-10)', () => {
    const eyePos = { x: 0, y: 65.62, z: 0 };
    // Looking directly South along -Z (yaw = 0, pitch = 0)
    const lookVector = getLookVectorFromYawPitch(0, 0); // { x: 0, y: 0, z: -1 }

    it('T1-MC-08: target in front within 70° cone is detected under focal_fov mode', () => {
      const targetPos = { x: 0, y: 65.62, z: -5.0 }; // 5m ahead
      const result = isWithinPerceptionFOV(eyePos, targetPos, lookVector);

      expect(result.inPerception).toBe(true);
      expect(result.mode).toBe('focal_fov');
      expect(result.angleDegrees).toBeLessThan(1.0);
    });

    it('T1-MC-09: target behind bot within 2.5m is detected under tactile fallback mode', () => {
      const targetPos = { x: 0, y: 65.62, z: 1.5 }; // 1.5m behind
      const result = isWithinPerceptionFOV(eyePos, targetPos, lookVector);

      expect(result.inPerception).toBe(true);
      expect(result.mode).toBe('tactile');
      expect(result.distance).toBeCloseTo(1.5, 1);
    });

    it('T1-MC-10: target behind bot beyond 2.5m is rejected under outside mode', () => {
      const targetPos = { x: 0, y: 65.62, z: 4.0 }; // 4.0m behind
      const result = isWithinPerceptionFOV(eyePos, targetPos, lookVector);

      expect(result.inPerception).toBe(false);
      expect(result.mode).toBe('outside');
    });
  });

  // --------------------------------------------------------------------------
  // Physical Reach Enforcement (F22)
  // --------------------------------------------------------------------------
  describe('Reach Enforcement (T1-MC-11, T1-MC-12)', () => {
    it('T1-MC-11: block interaction within <= 4.5m passes reach check', () => {
      const eyePos = { x: 0, y: 65.62, z: 0 };
      const targetBlock = { x: 3, y: 65, z: 0 }; // Distance ~3.0m

      expect(() => assertBlockReach(eyePos, targetBlock)).not.toThrow();
      const dist = getBlockDistanceToEye(eyePos, targetBlock);
      expect(dist).toBeLessThanOrEqual(4.50);
    });

    it('T1-MC-12: entity attack within <= 3.5m passes reach check', () => {
      const eyePos = { x: 0, y: 65.62, z: 0 };
      const targetEntity = { x: 2, y: 65, z: 0 }; // Distance ~2.0m

      expect(() => assertEntityAttackReach(eyePos, targetEntity)).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Command Sanitizer Regular Chat (F23)
  // --------------------------------------------------------------------------
  describe('Command Sanitizer Pass-Through (T1-MC-13)', () => {
    it('T1-MC-13: regular non-privileged chat passes through without exception', () => {
      const message = 'Hello server, I am gathering wood';
      const clean = assertAllowedMinecraftChat(message);

      expect(clean).toBe(message);

      const sanitized = sanitizeMinecraftMessage(message);
      expect(sanitized.isCommand).toBe(false);
      expect(sanitized.allowed).toBe(true);
      expect(sanitized.cleanedText).toBe(message);
    });
  });

  // --------------------------------------------------------------------------
  // Navigation & Pathfinder (F24)
  // --------------------------------------------------------------------------
  describe('Pathfinder Navigation (T1-MC-14)', () => {
    it('T1-MC-14: navigates bot to destination coordinates', async () => {
      const pathfinder = new PathfinderAction(bot);
      const destination = { x: 20, y: 64, z: 20 };

      const result = await pathfinder.navigateTo(destination);

      expect(result.success).toBe(true);
      expect(bot.entity.position.x).toBe(20);
      expect(bot.entity.position.y).toBe(64);
      expect(bot.entity.position.z).toBe(20);
    });
  });

  // --------------------------------------------------------------------------
  // Mining Engine (F25)
  // --------------------------------------------------------------------------
  describe('Mining Engine & Harvest Tiers (T1-MC-15)', () => {
    it('T1-MC-15: verifies harvest tier requirements and digs block within reach', async () => {
      const targetPos = { x: 2, y: 64, z: 0 };
      world.setBlock(targetPos, 'iron_ore');

      const stonePick = { name: 'stone_pickaxe', count: 1 };
      bot.addItem(stonePick);
      bot.heldItem = stonePick;

      // Harvest requirement check
      const harvestCheck = canSafelyHarvest('iron_ore', [stonePick]);
      expect(harvestCheck.canHarvest).toBe(true);
      expect(harvestCheck.toolToEquip?.name).toBe('stone_pickaxe');

      const mining = new MiningAction(bot);
      const result = await mining.mineBlock(targetPos);

      expect(result.success).toBe(true);
      expect(world.getBlock(targetPos)?.name).toBe('air');
    });
  });

  // --------------------------------------------------------------------------
  // Block Placement (F26)
  // --------------------------------------------------------------------------
  describe('Block Placement (T1-MC-16)', () => {
    it('T1-MC-16: places block against reference block and decrements inventory item count', async () => {
      const refPos = { x: 2, y: 64, z: 0 };
      const placePos = { x: 2, y: 65, z: 0 };
      world.setBlock(refPos, 'cobblestone');

      bot.addItem({ name: 'dirt', count: 5 });
      bot.heldItem = { name: 'dirt', count: 5 };

      const refBlock = world.getBlock(refPos)!;
      await bot.placeBlock(refBlock, { x: 0, y: 1, z: 0 });

      expect(world.getBlock(placePos)?.name).toBe('dirt');
      expect(bot.inventory.count('dirt')).toBe(4);
    });
  });

  // --------------------------------------------------------------------------
  // Crafting Engine (F27, F28)
  // --------------------------------------------------------------------------
  describe('Crafting Engine (T1-MC-17, T1-MC-18)', () => {
    it('T1-MC-17: crafts 4 oak_planks from 1 oak_log using 2x2 player inventory grid', async () => {
      bot.addItem({ name: 'oak_log', count: 2 });
      bot.craft = async (recipe: any, count: number) => {
        bot.removeItem('oak_log', 1);
        bot.addItem({ name: 'oak_planks', count: 4 });
        bot.emit('crafted', recipe, count);
      };

      const crafting = new CraftingAction(bot);
      const result = await crafting.craftItem('oak_planks', 4);

      expect(result.success).toBe(true);
      expect(bot.inventory.count('oak_planks')).toBe(4);
      expect(bot.inventory.count('oak_log')).toBe(1);
    });

    it('T1-MC-18: crafts wooden_pickaxe at nearby crafting table using 3x3 recipe', async () => {
      world.setBlock({ x: 1, y: 64, z: 0 }, 'crafting_table');
      bot.addItem({ name: 'oak_planks', count: 4 });
      bot.addItem({ name: 'stick', count: 2 });

      bot.craft = async (recipe: any, count: number, tableBlock?: any) => {
        if (tableBlock) {
          assertBlockReach(bot.eyePosition, tableBlock.position);
        }
        if (recipe.name === 'wooden_pickaxe') {
          bot.removeItem('oak_planks', 3);
          bot.removeItem('stick', 2);
          bot.addItem({ name: 'wooden_pickaxe', count: 1 });
        }
        bot.emit('crafted', recipe, count);
      };

      const crafting = new CraftingAction(bot);
      const result = await crafting.craftItem('wooden_pickaxe', 1);

      expect(result.success).toBe(true);
      expect(bot.inventory.count('wooden_pickaxe')).toBe(1);
      expect(bot.inventory.count('oak_planks')).toBe(1);
      expect(bot.inventory.count('stick')).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Combat System (F29, F30)
  // --------------------------------------------------------------------------
  describe('Combat System & Shield Blocking (T1-MC-19, T1-MC-20)', () => {
    it('T1-MC-19: enforces 1.9+ weapon cooldown timing for diamond_sword (625ms)', async () => {
      const cooldown = new CombatCooldownController();
      expect(cooldown.getCooldownPeriodMs('diamond_sword')).toBe(625);

      cooldown.recordAttack();
      const waitTime = await cooldown.awaitFullGauge('diamond_sword');
      // Should wait approximately remaining fraction of 625ms
      expect(waitTime).toBeGreaterThanOrEqual(0);
    });

    it('T1-MC-20: activates shield in off-hand to enter blocking state', () => {
      bot.offHandItem = { name: 'shield', count: 1 };
      expect(bot.isBlocking).toBe(false);

      bot.activateItem(true);
      expect(bot.isBlocking).toBe(true);

      bot.deactivateItem();
      expect(bot.isBlocking).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Automated Survival Loops (F31-F33)
  // --------------------------------------------------------------------------
  describe('Survival Loops (T1-MC-21 to T1-MC-23)', () => {
    it('T1-MC-21: auto-eat prioritizes high-saturation food (cooked_beef over apple)', async () => {
      bot.food = 12; // Hunger drops below 14 threshold
      bot.addItem({ name: 'apple', count: 3 });
      bot.addItem({ name: 'cooked_beef', count: 3 });

      const autoEat = new AutoEatLoop(bot);
      expect(autoEat.shouldEat()).toBe(true);

      const bestFood = autoEat.selectBestFood();
      expect(bestFood?.name).toBe('cooked_beef');

      const ate = await autoEat.checkAndEat();
      expect(ate).toBe(true);
      expect(bot.food).toBeGreaterThan(12);
    });

    it('T1-MC-22: auto-sleep detects night time and interacts with nearby bed', async () => {
      bot.time = { timeOfDay: 13500, age: 5000 }; // Night time
      world.setBlock({ x: 2, y: 64, z: 0 }, 'white_bed');

      const autoSleep = new AutoSleepLoop(bot);
      expect(autoSleep.canSleepNow()).toBe(true);

      const slept = await autoSleep.checkAndSleep();
      expect(slept).toBe(true);
      expect(bot.isSleeping).toBe(true);
    });

    it('T1-MC-23: auto-equip equips diamond chestplate over iron chestplate by composite score', async () => {
      bot.addItem({ name: 'iron_chestplate', count: 1 });
      bot.addItem({ name: 'diamond_chestplate', count: 1 });

      const autoEquip = new AutoEquipLoop(bot);
      await autoEquip.evaluateAndEquip();

      expect(bot.armor.torso?.name).toBe('diamond_chestplate');
    });
  });
});
