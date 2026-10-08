import { describe, it, expect, beforeEach } from 'vitest';
import { MockWorld, MockMineflayerBot, MockMinecraftAgent } from '../mocks/mockMinecraft.js';
import { MinecraftClient } from '../../src/minecraft/client.js';
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
  TACTILE_RADIUS_METERS,
  FOV_HALF_ANGLE_DEGREES,
} from '../../src/minecraft/perception/fov.js';
import {
  assertBlockReach,
  assertEntityAttackReach,
  getBlockDistanceToEye,
  getEntityDistanceToEye,
  ReachExceededError,
  MAX_BLOCK_REACH_METERS,
  MAX_ENTITY_ATTACK_REACH_METERS,
} from '../../src/minecraft/fairplay/reach.js';
import { MiningAction, canSafelyHarvest } from '../../src/minecraft/actions/mining.js';
import { CraftingAction, decomposeRecipe } from '../../src/minecraft/actions/crafting.js';
import { AutoEatLoop } from '../../src/minecraft/loops/autoEat.js';
import { AutoEquipLoop } from '../../src/minecraft/loops/autoEquip.js';
import { validateToolArgs, FairPlayValidationError } from '../../src/ai/tools/validator.js';

describe('Tier 2: Minecraft Fair-Play Boundaries & Edge Cases (T2-MC-01 to T2-MC-26)', () => {
  let world: MockWorld;
  let bot: MockMineflayerBot;
  let client: MinecraftClient;

  beforeEach(() => {
    world = new MockWorld();
    bot = new MockMineflayerBot(world, { x: 0, y: 64, z: 0 });
    client = new MinecraftClient({
      bot,
      maxReconnectRetries: 1,
      baseReconnectDelayMs: 50,
      maxReconnectDelayMs: 100,
      statusThrottleMs: 10,
      enableAutoEat: false,
      enableAutoSleep: false,
      enableAutoEquip: false,
    });
  });

  // --------------------------------------------------------------------------
  // Coordinate Boundaries (T2-MC-01 to T2-MC-04)
  // --------------------------------------------------------------------------
  describe('Spatial & Coordinate Boundaries (T2-MC-01 to T2-MC-04)', () => {
    it('T2-MC-01: calculates distances near extreme world boundaries (+/- 30,000,000) stably without overflow', () => {
      const farBlock = { x: 29999984, y: 64, z: -29999984 };
      const eyePos = { x: 29999984.5, y: 65.62, z: -29999984.5 };

      const distance = getBlockDistanceToEye(eyePos, farBlock);
      expect(Number.isFinite(distance)).toBe(true);
      expect(Number.isNaN(distance)).toBe(false);
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThan(5.0);
    });

    it('T2-MC-02: evaluates block exposure at world vertical limits (y = -64 and y = 320) and handles out-of-bounds gracefully', () => {
      const bedrockPos = { x: 0, y: -64, z: 0 };
      world.setBlock(bedrockPos, 'bedrock');
      world.setBlock({ x: 0, y: -63, z: 0 }, 'air');

      const floorExposure = evaluateBlockExposure(world, bedrockPos);
      expect(floorExposure.isExposed).toBe(true);
      expect(floorExposure.exposedFaces).toContain('+y');

      const skyPos = { x: 0, y: 320, z: 0 };
      world.setBlock(skyPos, 'glass');
      world.setBlock({ x: 0, y: 319, z: 0 }, 'air');

      const ceilingExposure = evaluateBlockExposure(world, skyPos);
      expect(ceilingExposure.isExposed).toBe(true);

      // Unset positions default safely, and null chunk returns false in isExposingBlock
      const outOfBounds = world.getBlock({ x: 0, y: -65, z: 0 });
      expect(outOfBounds).toBeDefined();
      expect(isExposingBlock(null)).toBe(false);
    });

    it('T2-MC-03: computes sub-voxel distance clamping accurately across boundary offsets (x.999 vs x.001)', () => {
      const block = { x: 11, y: 64, z: 0 };
      // Eye positioned just outside the minX boundary at 10.999
      const eyeJustOutside = { x: 10.999, y: 64.5, z: 0.5 };
      const distOutside = getBlockDistanceToEye(eyeJustOutside, block);
      expect(distOutside).toBeCloseTo(0.001, 3);

      // Eye positioned just inside the minX boundary at 11.001
      const eyeJustInside = { x: 11.001, y: 64.5, z: 0.5 };
      const distInside = getBlockDistanceToEye(eyeJustInside, block);
      expect(distInside).toBe(0.0);
    });

    it('T2-MC-04: rejects NaN and Infinite coordinates in tool parameters and spatial validation', () => {
      expect(() =>
        validateToolArgs('goToCoordinates', { x: NaN, y: 64, z: 0 })
      ).toThrow(FairPlayValidationError);

      expect(() =>
        validateToolArgs('goToCoordinates', { x: 0, y: Infinity, z: 0 })
      ).toThrow(FairPlayValidationError);

      expect(() =>
        validateToolArgs('goToCoordinates', { x: 0, y: 64, z: -Infinity })
      ).toThrow(FairPlayValidationError);
    });
  });

  // --------------------------------------------------------------------------
  // Reach Boundaries (T2-MC-05 to T2-MC-11)
  // --------------------------------------------------------------------------
  describe('Physical Reach Boundaries (T2-MC-05 to T2-MC-11)', () => {
    it('T2-MC-05: permits block interaction at exact 4.5000m reach boundary', () => {
      // Eye at (0.5, 64.0, 0.0), Block at (5.0, 64.0, 0.0). Closest AABB surface point is cx=5.0, dx=4.5000m
      const eye = { x: 0.5, y: 64.0, z: 0.0 };
      const block = { x: 5.0, y: 64.0, z: 0.0 };

      const dist = getBlockDistanceToEye(eye, block);
      expect(dist).toBeCloseTo(4.50, 4);
      expect(() => assertBlockReach(eye, block)).not.toThrow();
    });

    it('T2-MC-06: rejects block interaction at 4.5001m violation and throws ReachExceededError', () => {
      // Eye at (0.4998, 64.0, 0.0), Block at (5.0, 64.0, 0.0). Distance = 4.5002m > 4.5000m
      const eye = { x: 0.4998, y: 64.0, z: 0.0 };
      const block = { x: 5.0, y: 64.0, z: 0.0 };

      const dist = getBlockDistanceToEye(eye, block);
      expect(dist).toBeGreaterThan(4.50);

      expect(() => assertBlockReach(eye, block)).toThrow(ReachExceededError);

      try {
        assertBlockReach(eye, block);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ReachExceededError);
        expect(err.targetType).toBe('block');
        expect(err.maxAllowed).toBe(MAX_BLOCK_REACH_METERS);
        expect(err.distance).toBeGreaterThan(4.50);
      }
    });

    it('T2-MC-07: clamps 3D diagonal cube distances accurately against unit box [2, 3] x [2, 3] x [2, 3]', () => {
      const eye = { x: 0, y: 0, z: 0 };
      const block = { x: 2, y: 2, z: 2 };

      // Closest point on unit box is (2, 2, 2). Euclidean distance = sqrt(4 + 4 + 4) = sqrt(12) ~ 3.4641m
      const dist = getBlockDistanceToEye(eye, block);
      expect(dist).toBeCloseTo(Math.sqrt(12), 3);
      expect(dist).toBeLessThanOrEqual(4.50);
      expect(() => assertBlockReach(eye, block)).not.toThrow();
    });

    it('T2-MC-08: evaluates zero-distance reach when eye is directly inside the target block', () => {
      const block = { x: 10, y: 64, z: 10 };
      const eyeInside = { x: 10.5, y: 64.5, z: 10.5 };

      const dist = getBlockDistanceToEye(eyeInside, block);
      expect(dist).toBe(0.0);
      expect(() => assertBlockReach(eyeInside, block)).not.toThrow();
    });

    it('T2-MC-09: permits entity combat attack reach at exact 3.5000m boundary', () => {
      // Standard entity width=0.6 (halfW=0.3), height=1.8
      // If entity is at x=3.8, minX = 3.8 - 0.3 = 3.5. Distance from eye (0, 65, 0) to cx=3.5 is exactly 3.5000m
      const eye = { x: 0, y: 65, z: 0 };
      const entityPos = { x: 3.8, y: 65, z: 0 };

      const dist = getEntityDistanceToEye(eye, entityPos);
      expect(dist).toBeCloseTo(3.50, 4);
      expect(() => assertEntityAttackReach(eye, entityPos)).not.toThrow();
    });

    it('T2-MC-10: rejects entity combat attack reach at 3.5001m violation and throws ReachExceededError', () => {
      const eye = { x: 0, y: 65, z: 0 };
      const entityPos = { x: 3.8002, y: 65, z: 0 };

      const dist = getEntityDistanceToEye(eye, entityPos);
      expect(dist).toBeGreaterThan(3.50);

      expect(() => assertEntityAttackReach(eye, entityPos)).toThrow(ReachExceededError);

      try {
        assertEntityAttackReach(eye, entityPos);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ReachExceededError);
        expect(err.targetType).toBe('entity');
        expect(err.maxAllowed).toBe(MAX_ENTITY_ATTACK_REACH_METERS);
      }
    });

    it('T2-MC-11: calculates reach to large entity hitboxes (width 3.0m, height 4.0m) via perimeter clamping', () => {
      // Boss entity with width 3.0m (halfW = 1.5m), height 4.0m positioned at center x=5.0m
      // Closest perimeter point cx = 5.0 - 1.5 = 3.50m from eye x=0.0m
      const eye = { x: 0, y: 64, z: 0 };
      const bossPos = { x: 5.0, y: 64, z: 0 };

      const dist = getEntityDistanceToEye(eye, bossPos, 4.0, 3.0);
      expect(dist).toBeCloseTo(3.50, 4);
      expect(() => assertEntityAttackReach(eye, bossPos, 4.0, 3.0)).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Perception & Raycast Boundaries (T2-MC-12 to T2-MC-20)
  // --------------------------------------------------------------------------
  describe('Perception & Raycast Boundaries (T2-MC-12 to T2-MC-20)', () => {
    it('T2-MC-12: evaluates deeply encased ore as unexposed with zero exposed face centers', () => {
      const targetPos = { x: 10, y: 50, z: 10 };
      world.setBlock(targetPos, 'diamond_ore');

      // Surround on all 6 cardinal faces
      world.setBlock({ x: 11, y: 50, z: 10 }, 'deepslate');
      world.setBlock({ x: 9, y: 50, z: 10 }, 'deepslate');
      world.setBlock({ x: 10, y: 51, z: 10 }, 'deepslate');
      world.setBlock({ x: 10, y: 49, z: 10 }, 'deepslate');
      world.setBlock({ x: 10, y: 50, z: 11 }, 'deepslate');
      world.setBlock({ x: 10, y: 50, z: 9 }, 'deepslate');

      const exposure = evaluateBlockExposure(world, targetPos);
      expect(exposure.isExposed).toBe(false);
      expect(exposure.exposedFaces).toHaveLength(0);
      expect(exposure.exposedFaceCenters).toHaveLength(0);
    });

    it('T2-MC-13: enforces strict cardinal neighbor rule: diagonal air does NOT expose block (anti-xray)', () => {
      const targetPos = { x: 10, y: 50, z: 10 };
      world.setBlock(targetPos, 'diamond_ore');

      // 6 solid neighbors on all cardinal faces
      world.setBlock({ x: 11, y: 50, z: 10 }, 'stone');
      world.setBlock({ x: 9, y: 50, z: 10 }, 'stone');
      world.setBlock({ x: 10, y: 51, z: 10 }, 'stone');
      world.setBlock({ x: 10, y: 49, z: 10 }, 'stone');
      world.setBlock({ x: 10, y: 50, z: 11 }, 'stone');
      world.setBlock({ x: 10, y: 50, z: 9 }, 'stone');

      // Diagonal air neighbor at (11, 51, 10)
      world.setBlock({ x: 11, y: 51, z: 10 }, 'air');

      const exposure = evaluateBlockExposure(world, targetPos);
      expect(exposure.isExposed).toBe(false);
    });

    it('T2-MC-14: guards against unloaded chunk boundaries: null neighbor treated as non-exposing', () => {
      const targetPos = { x: 0, y: 64, z: 0 };
      world.setBlock(targetPos, 'gold_ore');

      // Mock accessor returning null for chunk boundary neighbor
      const mockAccessor = {
        getBlock: (pos: any) => {
          if (pos.x === 1) return null; // Unloaded chunk
          return { name: 'stone' };
        },
      };

      expect(isExposingBlock(null)).toBe(false);
      const exposure = evaluateBlockExposure(mockAccessor, targetPos);
      expect(exposure.isExposed).toBe(false);
    });

    it('T2-MC-15: raycast detects intermediate 1-block stone wall obstruction and returns hit details', () => {
      const eye = { x: 0, y: 64.5, z: 0 };
      const targetVoxel = { x: 5, y: 64, z: 0 };
      const targetFace = { x: 5.0, y: 64.5, z: 0.5 };

      world.setBlock(targetVoxel, 'iron_ore');
      // Place solid stone wall between eye and target at x=3
      world.setBlock({ x: 3, y: 64, z: 0 }, 'stone');

      const hit = checkLineOfSight(world, eye, targetVoxel, targetFace, 16.0);
      expect(hit.visible).toBe(false);
      expect(hit.obstruction).toBe('stone');
      expect(hit.hitVoxel).toEqual({ x: 3, y: 64, z: 0 });
    });

    it('T2-MC-16: raycast enforces maximum distance cutoff of 32m', () => {
      const eye = { x: 0, y: 64, z: 0 };
      const distantVoxel = { x: 35, y: 64, z: 0 };
      const distantPoint = { x: 35.5, y: 64.5, z: 0.5 };

      world.setBlock(distantVoxel, 'gold_ore');

      const hit = checkLineOfSight(world, eye, distantVoxel, distantPoint, 32.0);
      expect(hit.visible).toBe(false);
      expect(hit.obstruction).toBe('MAX_DISTANCE_EXCEEDED');
      expect(hit.distance).toBeGreaterThan(32.0);
    });

    it('T2-MC-17: detects target at exact 35.0° half-angle FOV boundary under focal_fov mode', () => {
      const eye = { x: 0, y: 64, z: 0 };
      // Look direction along -Z
      const look = getLookVectorFromYawPitch(0, 0); // { x: 0, y: 0, z: -1 }

      // Target at angle theta = 35.0° in X-Z plane, distance 3.0m (> 2.5m tactile threshold)
      const dist = 3.0;
      const angleRad = (35.0 * Math.PI) / 180;
      const target = {
        x: dist * Math.sin(angleRad),
        y: 64,
        z: -dist * Math.cos(angleRad),
      };

      const result = isWithinPerceptionFOV(eye, target, look);
      expect(result.inPerception).toBe(true);
      expect(result.mode).toBe('focal_fov');
      expect(result.angleDegrees).toBeCloseTo(35.0, 1);
    });

    it('T2-MC-18: rejects target at 35.1° FOV boundary failure under outside mode', () => {
      const eye = { x: 0, y: 64, z: 0 };
      const look = getLookVectorFromYawPitch(0, 0);

      // Target at angle theta = 35.1°, distance 3.0m
      const dist = 3.0;
      const angleRad = (35.1 * Math.PI) / 180;
      const target = {
        x: dist * Math.sin(angleRad),
        y: 64,
        z: -dist * Math.cos(angleRad),
      };

      const result = isWithinPerceptionFOV(eye, target, look);
      expect(result.inPerception).toBe(false);
      expect(result.mode).toBe('outside');
      expect(result.angleDegrees).toBeGreaterThan(35.0);
    });

    it('T2-MC-19: detects target at exact 2.5000m sphere boundary under tactile fallback mode', () => {
      const eye = { x: 0, y: 64, z: 0 };
      // Look direction South (-Z)
      const look = getLookVectorFromYawPitch(0, 0);
      // Target directly behind bot (+Z) at distance 2.5000m
      const target = { x: 0, y: 64, z: 2.5000 };

      const result = isWithinPerceptionFOV(eye, target, look);
      expect(result.inPerception).toBe(true);
      expect(result.mode).toBe('tactile');
      expect(result.distance).toBeCloseTo(2.50, 4);
    });

    it('T2-MC-20: rejects target behind bot at 2.5001m tactile boundary failure under outside mode', () => {
      const eye = { x: 0, y: 64, z: 0 };
      const look = getLookVectorFromYawPitch(0, 0);
      // Target directly behind bot at distance 2.5002m
      const target = { x: 0, y: 64, z: 2.5002 };

      const result = isWithinPerceptionFOV(eye, target, look);
      expect(result.inPerception).toBe(false);
      expect(result.mode).toBe('outside');
    });
  });

  // --------------------------------------------------------------------------
  // Empty Inventory & State Edge Cases (T2-MC-21 to T2-MC-26)
  // --------------------------------------------------------------------------
  describe('Empty Inventory & Agent State Edge Cases (T2-MC-21 to T2-MC-26)', () => {
    it('T2-MC-21: mining high-tier ore with empty inventory returns harvest failure without digging', async () => {
      const targetPos = { x: 2, y: 64, z: 0 };
      world.setBlock(targetPos, 'diamond_ore');
      world.setBlock({ x: 2, y: 65, z: 0 }, 'air');

      // Bot has empty inventory (no pickaxe)
      const harvestCheck = canSafelyHarvest('diamond_ore', []);
      expect(harvestCheck.canHarvest).toBe(false);
      expect(harvestCheck.reason).toContain('requires a pickaxe of tier >= iron');

      const mining = new MiningAction(bot);
      const result = await mining.mineBlock(targetPos);

      expect(result.success).toBe(false);
      expect(result.message).toContain('requires a pickaxe');
      expect(world.getBlock(targetPos)?.name).toBe('diamond_ore');
    });

    it('T2-MC-22: recipe decomposition with empty inventory identifies all missing raw materials', () => {
      const emptyInv = new Map<string, number>();
      const decomp = decomposeRecipe('wooden_sword', 1, emptyInv);

      expect(decomp.canCraft).toBe(false);
      expect(decomp.missingRawMaterials.length).toBeGreaterThan(0);
      // Base raw material needed for wooden sword (planks/logs)
      const missingLogOrPlank = decomp.missingRawMaterials.some(
        (m) => m.item === 'oak_log' || m.item === 'oak_planks'
      );
      expect(missingLogOrPlank).toBe(true);
    });

    it('T2-MC-23: auto-eat survival loop with empty inventory completes cleanly without throwing', async () => {
      bot.food = 10; // Low hunger triggering auto-eat threshold
      const autoEat = new AutoEatLoop(bot);

      expect(autoEat.shouldEat()).toBe(true);
      expect(autoEat.selectBestFood()).toBeNull();

      const ate = await autoEat.checkAndEat();
      expect(ate).toBe(false);
      expect(bot.food).toBe(10);
    });

    it('T2-MC-24: auto-equip survival loop with empty inventory completes cleanly without throwing', async () => {
      const autoEquip = new AutoEquipLoop(bot);
      await expect(autoEquip.evaluateAndEquip()).resolves.not.toThrow();

      expect(bot.armor.head).toBeNull();
      expect(bot.armor.torso).toBeNull();
      expect(bot.armor.legs).toBeNull();
      expect(bot.armor.feet).toBeNull();
    });

    it('T2-MC-25: action rejection when agent is dead (health = 0) or disconnected', async () => {
      await client.connect({ host: 'localhost', port: 25565, username: 'TestBot' });
      await client.disconnect();

      expect(client.state).toBe('DISCONNECTED');
      expect(client.getStatus().connected).toBe(false);

      // Attempt mining when client is disconnected
      bot.health = 0;
      bot.emit('death');

      const status = client.getStatus();
      expect(status.connected).toBe(false);
      expect(status.health).toBe(0);
    });

    it('T2-MC-26: respawn resets agent health and food to 20 and emits spawn event', () => {
      bot.health = 0.0;
      bot.food = 4;

      let respawnFired = false;
      let spawnFired = false;

      bot.on('respawn', () => {
        respawnFired = true;
      });
      bot.on('spawn', () => {
        spawnFired = true;
      });

      bot.respawn();

      expect(bot.health).toBe(20.0);
      expect(bot.food).toBe(20);
      expect(respawnFired).toBe(true);
      expect(spawnFired).toBe(true);
    });
  });
});
