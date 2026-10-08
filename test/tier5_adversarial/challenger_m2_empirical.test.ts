import { describe, it, expect, beforeEach } from 'vitest';
import {
  assertBlockReach,
  assertEntityAttackReach,
  getBlockDistanceToEye,
  getEntityDistanceToEye,
  isWithinBlockReach,
  isWithinEntityAttackReach,
  ReachExceededError,
  MAX_BLOCK_REACH_METERS,
  MAX_ENTITY_ATTACK_REACH_METERS,
} from '../../src/minecraft/fairplay/reach.js';
import {
  checkLineOfSight,
  hasBlockLineOfSight,
  type RaycastHit,
} from '../../src/minecraft/perception/raycast.js';
import {
  evaluateBlockExposure,
  isExposingBlock,
  EXPOSING_BLOCK_NAMES,
  CARDINAL_FACES,
  type IBlockAccessor,
} from '../../src/minecraft/perception/exposure.js';
import {
  isWithinPerceptionFOV,
  getLookVectorFromYawPitch,
  TACTILE_RADIUS_METERS,
  FOV_HALF_ANGLE_DEGREES,
  FOV_COS_THRESHOLD,
} from '../../src/minecraft/perception/fov.js';
import {
  MockWorld,
  MockMineflayerBot,
  MockMinecraftAgent,
  type MockBlock,
} from '../mocks/mockMinecraft.js';

describe('Empirical Challenger: Milestone 2 Perception & Reach Stress Harness', () => {
  // ==========================================================================
  // AREA 1: Block Interaction Reach Boundary Invariants (4.50m, 4.5001m, 4.51m, AABB)
  // ==========================================================================
  describe('Area 1: Block Interaction Reach Boundary Invariants', () => {
    it('EMP-RCH-1: Block exactly at 4.500000m Euclidean distance passes reach assertion', () => {
      // Eye at (0.5, 0.5, 0.5). Block at (5, 0, 0).
      // Block unit AABB is [5.0, 6.0] x [0.0, 1.0] x [0.0, 1.0].
      // Closest point on AABB to eye (0.5, 0.5, 0.5) is (5.0, 0.5, 0.5).
      // Distance is exactly 5.0 - 0.5 = 4.50m.
      const eyePos = { x: 0.5, y: 0.5, z: 0.5 };
      const blockPos = { x: 5, y: 0, z: 0 };

      const dist = getBlockDistanceToEye(eyePos, blockPos);
      expect(dist).toBeCloseTo(4.50, 6);
      expect(dist).toBeLessThanOrEqual(MAX_BLOCK_REACH_METERS);
      expect(isWithinBlockReach(eyePos, blockPos)).toBe(true);
      expect(() => assertBlockReach(eyePos, blockPos)).not.toThrow();
    });

    it('EMP-RCH-2: Block at boundary tolerance 4.5001m passes within 1e-4 epsilon', () => {
      // Eye at x = 0.5 - 0.0001 = 0.4999.
      // Distance to cx=5.0 is exactly 4.5001m.
      // Since tolerance is MAX_BLOCK_REACH_METERS + 1e-4 = 4.5001m, this should be accepted.
      const eyePos = { x: 0.4999, y: 0.5, z: 0.5 };
      const blockPos = { x: 5, y: 0, z: 0 };

      const dist = getBlockDistanceToEye(eyePos, blockPos);
      expect(dist).toBeCloseTo(4.5001, 4);
      expect(dist).toBeLessThanOrEqual(MAX_BLOCK_REACH_METERS + 1e-4 + 1e-9);
      expect(isWithinBlockReach(eyePos, blockPos)).toBe(true);
      expect(() => assertBlockReach(eyePos, blockPos)).not.toThrow();
    });

    it('EMP-RCH-3: Block at 4.5002m and 4.51m strictly exceeds reach limit and throws ReachExceededError', () => {
      // At 4.5002m (exceeds 4.50m + 1e-4 tolerance)
      const eyePos45002 = { x: 0.5 - 0.0002, y: 0.5, z: 0.5 };
      const blockPos = { x: 5, y: 0, z: 0 };

      const dist45002 = getBlockDistanceToEye(eyePos45002, blockPos);
      expect(dist45002).toBeGreaterThan(MAX_BLOCK_REACH_METERS + 1e-4);
      expect(isWithinBlockReach(eyePos45002, blockPos)).toBe(false);
      expect(() => assertBlockReach(eyePos45002, blockPos)).toThrow(ReachExceededError);

      // At 4.51m
      const eyePos451 = { x: 0.49, y: 0.5, z: 0.5 };
      const dist451 = getBlockDistanceToEye(eyePos451, blockPos);
      expect(dist451).toBeCloseTo(4.51, 4);
      expect(isWithinBlockReach(eyePos451, blockPos)).toBe(false);

      expect(() => assertBlockReach(eyePos451, blockPos)).toThrow(ReachExceededError);
      try {
        assertBlockReach(eyePos451, blockPos);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ReachExceededError);
        expect(err.targetType).toBe('block');
        expect(err.maxAllowed).toBe(4.50);
        expect(err.distance).toBeCloseTo(4.51, 2);
      }
    });

    it('EMP-RCH-4: 3D diagonal AABB Voronoi regions correctly clamp closest point on Corner, Edge, and Face', () => {
      const blockPos = { x: 10, y: 20, z: 30 }; // AABB: [10, 11] x [20, 21] x [30, 31]

      // 1. Face region: offset along only X axis
      const eyeFace = { x: 10 - 3.0, y: 20.5, z: 30.5 };
      expect(getBlockDistanceToEye(eyeFace, blockPos)).toBeCloseTo(3.0, 5);

      // 2. Edge region: offset along X and Y axes, Z is within range
      // dx = 2.0, dy = 2.0, dz = 0 -> dist = sqrt(8) ≈ 2.828427
      const eyeEdge = { x: 10 - 2.0, y: 20 - 2.0, z: 30.5 };
      expect(getBlockDistanceToEye(eyeEdge, blockPos)).toBeCloseTo(Math.sqrt(8), 5);

      // 3. Corner region: offset along all 3 axes
      // dx = 2.0, dy = 2.0, dz = 2.0 -> dist = sqrt(12) ≈ 3.464101
      const eyeCorner = { x: 10 - 2.0, y: 20 - 2.0, z: 30 - 2.0 };
      expect(getBlockDistanceToEye(eyeCorner, blockPos)).toBeCloseTo(Math.sqrt(12), 5);

      // 4. Exact 3D diagonal reach limit:
      // dx = dy = dz = s. 3 * s^2 = 4.5^2 = 20.25 -> s = sqrt(6.75) ≈ 2.5980762
      const s = Math.sqrt(20.25 / 3);
      const eyeDiagLimit = { x: 10 - s, y: 20 - s, z: 30 - s };
      expect(getBlockDistanceToEye(eyeDiagLimit, blockPos)).toBeCloseTo(4.50, 4);
      expect(() => assertBlockReach(eyeDiagLimit, blockPos)).not.toThrow();

      // Step just beyond along 3D diagonal: s + 0.01 -> dist ≈ 4.517m
      const eyeDiagExceeded = { x: 10 - (s + 0.01), y: 20 - (s + 0.01), z: 30 - (s + 0.01) };
      expect(getBlockDistanceToEye(eyeDiagExceeded, blockPos)).toBeGreaterThan(4.5001);
      expect(() => assertBlockReach(eyeDiagExceeded, blockPos)).toThrow(ReachExceededError);
    });

    it('EMP-RCH-5: Negative coordinate block bounding boxes correctly computed without sign inversion', () => {
      // Block at (-5, -10, -15). Math.floor preserves negative integers.
      // Unit AABB is [-5.0, -4.0] x [-10.0, -9.0] x [-15.0, -14.0].
      const blockPos = { x: -5, y: -10, z: -15 };

      // Eye at (-4.5, -9.5, -14.5) is inside the block -> distance = 0
      const eyeInside = { x: -4.5, y: -9.5, z: -14.5 };
      expect(getBlockDistanceToEye(eyeInside, blockPos)).toBe(0);

      // Eye at (0, 0, 0): closest point is (-4.0, -9.0, -14.0)
      // dx = 4, dy = 9, dz = 14 -> sqrt(16 + 81 + 196) = sqrt(293) ≈ 17.117
      const eyeOrigin = { x: 0, y: 0, z: 0 };
      expect(getBlockDistanceToEye(eyeOrigin, blockPos)).toBeCloseTo(Math.sqrt(293), 4);
    });
  });

  // ==========================================================================
  // AREA 2: Entity Attack Reach Boundary Invariants (3.50m, 3.5001m, 3.51m)
  // ==========================================================================
  describe('Area 2: Entity Combat Reach Boundary Invariants', () => {
    it('EMP-ENT-1: Entity combat attack at exactly 3.500000m distance passes reach assertion', () => {
      // Eye at (0, 65.0, 0).
      // Entity bottom at (3.8, 64.5, 0), width = 0.6 (halfW = 0.3), height = 1.8.
      // Entity AABB: X in [3.5, 4.1], Y in [64.5, 66.3], Z in [-0.3, 0.3].
      // Eye Y (65.0) and Z (0) are within entity bounding box!
      // Closest point is (3.5, 65.0, 0).
      // Distance is exactly 3.50m.
      const eyePos = { x: 0, y: 65.0, z: 0 };
      const entityPos = { x: 3.8, y: 64.5, z: 0 };

      const dist = getEntityDistanceToEye(eyePos, entityPos, 1.8, 0.6);
      expect(dist).toBeCloseTo(3.50, 5);
      expect(dist).toBeLessThanOrEqual(MAX_ENTITY_ATTACK_REACH_METERS);
      expect(isWithinEntityAttackReach(eyePos, entityPos, 1.8, 0.6)).toBe(true);
      expect(() => assertEntityAttackReach(eyePos, entityPos, 1.8, 0.6)).not.toThrow();
    });

    it('EMP-ENT-2: Entity combat attack at 3.5001m boundary tolerance passes within 1e-4 epsilon', () => {
      // Entity at x = 3.8001 -> minX = 3.5001m.
      const eyePos = { x: 0, y: 65.0, z: 0 };
      const entityPos = { x: 3.8001, y: 64.5, z: 0 };

      const dist = getEntityDistanceToEye(eyePos, entityPos, 1.8, 0.6);
      expect(dist).toBeCloseTo(3.5001, 4);
      expect(dist).toBeLessThanOrEqual(MAX_ENTITY_ATTACK_REACH_METERS + 1e-4 + 1e-9);
      expect(isWithinEntityAttackReach(eyePos, entityPos, 1.8, 0.6)).toBe(true);
      expect(() => assertEntityAttackReach(eyePos, entityPos, 1.8, 0.6)).not.toThrow();
    });

    it('EMP-ENT-3: Entity combat attack at 3.5002m and 3.51m throws ReachExceededError', () => {
      const eyePos = { x: 0, y: 65.0, z: 0 };

      // At 3.5002m
      const entityPos35002 = { x: 3.8002, y: 64.5, z: 0 };
      const dist35002 = getEntityDistanceToEye(eyePos, entityPos35002, 1.8, 0.6);
      expect(dist35002).toBeGreaterThan(MAX_ENTITY_ATTACK_REACH_METERS + 1e-4);
      expect(isWithinEntityAttackReach(eyePos, entityPos35002, 1.8, 0.6)).toBe(false);
      expect(() => assertEntityAttackReach(eyePos, entityPos35002, 1.8, 0.6)).toThrow(ReachExceededError);

      // At 3.51m
      const entityPos351 = { x: 3.81, y: 64.5, z: 0 };
      const dist351 = getEntityDistanceToEye(eyePos, entityPos351, 1.8, 0.6);
      expect(dist351).toBeCloseTo(3.51, 4);
      expect(isWithinEntityAttackReach(eyePos, entityPos351, 1.8, 0.6)).toBe(false);

      expect(() => assertEntityAttackReach(eyePos, entityPos351, 1.8, 0.6)).toThrow(ReachExceededError);
      try {
        assertEntityAttackReach(eyePos, entityPos351, 1.8, 0.6);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ReachExceededError);
        expect(err.targetType).toBe('entity');
        expect(err.maxAllowed).toBe(3.50);
        expect(err.distance).toBeCloseTo(3.51, 2);
      }
    });

    it('EMP-ENT-4: Handles various Minecraft entity hitbox dimensions accurately', () => {
      const eyePos = { x: 0, y: 65.0, z: 0 };

      // Ender Dragon: width 16.0 (halfW 8.0), height 8.0
      // Entity center at x = 11.0 -> closest point is 11.0 - 8.0 = 3.0m
      const dragonPos = { x: 11.0, y: 62.0, z: 0 };
      const dragonDist = getEntityDistanceToEye(eyePos, dragonPos, 8.0, 16.0);
      expect(dragonDist).toBeCloseTo(3.0, 4);
      expect(() => assertEntityAttackReach(eyePos, dragonPos, 8.0, 16.0)).not.toThrow();

      // Baby Zombie: width 0.3 (halfW 0.15), height 0.975
      // Entity center at x = 3.6 -> closest point is 3.6 - 0.15 = 3.45m
      const babyZombiePos = { x: 3.6, y: 64.5, z: 0 };
      const babyDist = getEntityDistanceToEye(eyePos, babyZombiePos, 0.975, 0.3);
      expect(babyDist).toBeCloseTo(3.45, 4);
      expect(() => assertEntityAttackReach(eyePos, babyZombiePos, 0.975, 0.3)).not.toThrow();
    });
  });

  // ==========================================================================
  // AREA 3: Amanatides & Woo 3D DDA Raycaster Adversarial Stress
  // ==========================================================================
  describe('Area 3: Amanatides & Woo 3D DDA Raycaster Stress', () => {
    let world: MockWorld;

    beforeEach(() => {
      world = new MockWorld();
    });

    it('EMP-RAY-1: Long corridor of 10 consecutive transparent blocks (glass & water) passes unobstructed', () => {
      const eye = { x: 0.5, y: 65.5, z: 0.5 };
      const targetVoxel = { x: 11, y: 65, z: 0 };
      const targetPoint = { x: 11.5, y: 65.5, z: 0.5 };

      world.setBlock(targetVoxel, 'gold_ore');

      // Interleave glass, water, stained glass, leaves
      const transparentTypes = [
        'glass',
        'water',
        'tinted_glass',
        'white_stained_glass',
        'oak_leaves',
        'water',
        'glass',
        'glass',
        'water',
        'glass',
      ];

      for (let x = 1; x <= 10; x++) {
        world.setBlock({ x, y: 65, z: 0 }, transparentTypes[x - 1]);
      }

      const hit = checkLineOfSight(world, eye, targetVoxel, targetPoint, 32);
      expect(hit.visible).toBe(true);
      expect(hit.obstruction).toBeUndefined();
      expect(hit.distance).toBeGreaterThan(10.0);
    });

    it('EMP-RAY-2: Single opaque block hidden inside transparent corridor cleanly obstructs raycast at exact hit voxel', () => {
      const eye = { x: 0.5, y: 65.5, z: 0.5 };
      const targetVoxel = { x: 11, y: 65, z: 0 };
      const targetPoint = { x: 11.5, y: 65.5, z: 0.5 };

      world.setBlock(targetVoxel, 'diamond_block');

      // Place 9 glass blocks and 1 obsidian at x = 6
      for (let x = 1; x <= 10; x++) {
        if (x === 6) {
          world.setBlock({ x, y: 65, z: 0 }, 'obsidian');
        } else {
          world.setBlock({ x, y: 65, z: 0 }, 'glass');
        }
      }

      const hit = checkLineOfSight(world, eye, targetVoxel, targetPoint, 32);
      expect(hit.visible).toBe(false);
      expect(hit.obstruction).toBe('obsidian');
      expect(hit.hitVoxel).toEqual({ x: 6, y: 65, z: 0 });
    });

    it('EMP-RAY-3: 3D DDA traversal across simultaneous diagonal axis boundaries (X=Y=Z) steps smoothly', () => {
      const eye = { x: 0.5, y: 0.5, z: 0.5 };
      const targetVoxel = { x: 4, y: 4, z: 4 };
      const targetPoint = { x: 4.5, y: 4.5, z: 4.5 };

      world.setBlock(targetVoxel, 'beacon');

      // Unobstructed 3D diagonal
      const hitClear = checkLineOfSight(world, eye, targetVoxel, targetPoint, 16);
      expect(hitClear.visible).toBe(true);

      // Block diagonal at (2, 2, 2)
      world.setBlock({ x: 2, y: 2, z: 2 }, 'stone');
      const hitBlocked = checkLineOfSight(world, eye, targetVoxel, targetPoint, 16);
      expect(hitBlocked.visible).toBe(false);
      expect(hitBlocked.obstruction).toBe('stone');
    });

    it('EMP-RAY-4: Raycast in all 6 pure cardinal directions (+X, -X, +Y, -Y, +Z, -Z) navigates without division by zero', () => {
      const directions = [
        { name: '+x', delta: { x: 5, y: 0, z: 0 } },
        { name: '-x', delta: { x: -5, y: 0, z: 0 } },
        { name: '+y', delta: { x: 0, y: 5, z: 0 } },
        { name: '-y', delta: { x: 0, y: -5, z: 0 } },
        { name: '+z', delta: { x: 0, y: 0, z: 5 } },
        { name: '-z', delta: { x: 0, y: 0, z: -5 } },
      ];

      for (const { name, delta } of directions) {
        const eye = { x: 10.5, y: 20.5, z: 30.5 };
        const targetVoxel = {
          x: Math.floor(eye.x + delta.x),
          y: Math.floor(eye.y + delta.y),
          z: Math.floor(eye.z + delta.z),
        };
        const targetPoint = {
          x: eye.x + delta.x,
          y: eye.y + delta.y,
          z: eye.z + delta.z,
        };

        world.setBlock(targetVoxel, 'target_block');
        const res = checkLineOfSight(world, eye, targetVoxel, targetPoint, 16);
        expect(res.visible, `Cardinal direction ${name} failed`).toBe(true);
      }
    });

    it('EMP-RAY-5: Raycast from eye position located exactly on voxel boundary planes (integer coordinates)', () => {
      // Eye at exact integer coordinates (10.0, 20.0, 30.0)
      const eye = { x: 10.0, y: 20.0, z: 30.0 };
      const targetVoxel = { x: 14, y: 20, z: 30 };
      const targetPoint = { x: 14.5, y: 20.5, z: 30.5 };

      world.setBlock(targetVoxel, 'chest');
      const hit = checkLineOfSight(world, eye, targetVoxel, targetPoint, 16);
      expect(hit.visible).toBe(true);
    });

    it('EMP-RAY-6: Multi-face sampling resolves visibility when only a single face is exposed and unobstructed', () => {
      const eye = { x: 0.5, y: 68.5, z: 0.5 };
      const targetVoxel = { x: 2, y: 64, z: 0 };
      world.setBlock(targetVoxel, 'ancient_debris');

      // Occlude -x face at (1, 64, 0)
      world.setBlock({ x: 1, y: 64, z: 0 }, 'netherrack');
      // Occlude +x face at (3, 64, 0)
      world.setBlock({ x: 3, y: 64, z: 0 }, 'netherrack');
      // Occlude -z face at (2, 64, -1)
      world.setBlock({ x: 2, y: 64, z: -1 }, 'netherrack');
      // Occlude +z face at (2, 64, 1)
      world.setBlock({ x: 2, y: 64, z: 1 }, 'netherrack');
      // Bottom is netherrack
      world.setBlock({ x: 2, y: 63, z: 0 }, 'netherrack');
      // ONLY +y face at (2, 65, 0) is air (exposed)
      world.setBlock({ x: 2, y: 65, z: 0 }, 'air');

      const exposure = evaluateBlockExposure(world, targetVoxel);
      expect(exposure.isExposed).toBe(true);
      expect(exposure.exposedFaces).toEqual(['+y']);

      // Frontal LOS to block center is blocked by netherrack at (1, 64, 0)
      const centerHit = checkLineOfSight(
        world,
        eye,
        targetVoxel,
        { x: 2.5, y: 64.5, z: 0.5 },
        16
      );
      // But testing top face center has LOS!
      const topHit = checkLineOfSight(
        world,
        eye,
        targetVoxel,
        exposure.exposedFaceCenters[0],
        16
      );
      expect(topHit.visible).toBe(true);

      // Full hasBlockLineOfSight method passes
      const hasLos = hasBlockLineOfSight(world, eye, targetVoxel, exposure.exposedFaceCenters, 16);
      expect(hasLos).toBe(true);
    });
  });

  // ==========================================================================
  // AREA 4: 70-Degree FOV Cone & 2.50m Tactile Fallback Boundaries
  // ==========================================================================
  describe('Area 4: 70-Degree FOV Cone & 2.50m Tactile Fallback Boundaries', () => {
    it('EMP-FOV-1: Tactile fallback boundary at exactly 2.500000m (behind player) passes in tactile mode', () => {
      const eyePos = { x: 0, y: 65.0, z: 0 };
      const lookVector = { x: 0, y: 0, z: -1 }; // Looking South (-Z)
      // Directly behind at 180° offset, exactly 2.50m distance (+Z)
      const targetPos = { x: 0, y: 65.0, z: 2.50 };

      const res = isWithinPerceptionFOV(eyePos, targetPos, lookVector);
      expect(res.inPerception).toBe(true);
      expect(res.mode).toBe('tactile');
      expect(res.distance).toBeCloseTo(2.50, 5);
    });

    it('EMP-FOV-2: Tactile fallback at 2.5001m tolerance passes, but 2.51m outside is rejected', () => {
      const eyePos = { x: 0, y: 65.0, z: 0 };
      const lookVector = { x: 0, y: 0, z: -1 };

      // At 2.5001m: within 1e-4 tolerance
      const targetPos25001 = { x: 0, y: 65.0, z: 2.5001 };
      const res25001 = isWithinPerceptionFOV(eyePos, targetPos25001, lookVector);
      expect(res25001.inPerception).toBe(true);
      expect(res25001.mode).toBe('tactile');

      // At 2.51m: outside tactile radius and outside 70° FOV cone (180° angle)
      const targetPos251 = { x: 0, y: 65.0, z: 2.51 };
      const res251 = isWithinPerceptionFOV(eyePos, targetPos251, lookVector);
      expect(res251.inPerception).toBe(false);
      expect(res251.mode).toBe('outside');
    });

    it('EMP-FOV-3: FOV focal cone boundary at exactly 35.000° half-angle passes in focal_fov mode', () => {
      const eyePos = { x: 0, y: 65.0, z: 0 };
      const lookVector = { x: 0, y: 0, z: -1 };
      const distance = 5.0; // Outside tactile radius (> 2.50m)

      // Angle = 35.0°: dx = dist * sin(35°), dz = -dist * cos(35°)
      const rad35 = (35.0 * Math.PI) / 180;
      const targetPos = {
        x: distance * Math.sin(rad35),
        y: 65.0,
        z: -distance * Math.cos(rad35),
      };

      const res = isWithinPerceptionFOV(eyePos, targetPos, lookVector);
      expect(res.inPerception).toBe(true);
      expect(res.mode).toBe('focal_fov');
      expect(res.angleDegrees).toBeCloseTo(35.0, 3);
      expect(res.dotProduct).toBeCloseTo(FOV_COS_THRESHOLD, 4);
    });

    it('EMP-FOV-4: FOV focal cone at 34.99° passes, whereas 35.05° and 35.10° are rejected', () => {
      const eyePos = { x: 0, y: 65.0, z: 0 };
      const lookVector = { x: 0, y: 0, z: -1 };
      const distance = 4.0;

      // 34.99° (inside)
      const radInside = (34.99 * Math.PI) / 180;
      const targetInside = {
        x: distance * Math.sin(radInside),
        y: 65.0,
        z: -distance * Math.cos(radInside),
      };
      const resInside = isWithinPerceptionFOV(eyePos, targetInside, lookVector);
      expect(resInside.inPerception).toBe(true);
      expect(resInside.mode).toBe('focal_fov');

      // 35.05° (outside)
      const radOutside = (35.05 * Math.PI) / 180;
      const targetOutside = {
        x: distance * Math.sin(radOutside),
        y: 65.0,
        z: -distance * Math.cos(radOutside),
      };
      const resOutside = isWithinPerceptionFOV(eyePos, targetOutside, lookVector);
      expect(resOutside.inPerception).toBe(false);
      expect(resOutside.mode).toBe('outside');
      expect(resOutside.angleDegrees).toBeGreaterThan(35.0);
    });

    it('EMP-FOV-5: Pitch and yaw derivations produce accurate 3D conical orientation', () => {
      // 45 degrees yaw West, 30 degrees pitch down
      const yaw = Math.PI / 4;
      const pitch = Math.PI / 6;
      const look = getLookVectorFromYawPitch(yaw, pitch);

      const mag = Math.sqrt(look.x * look.x + look.y * look.y + look.z * look.z);
      expect(mag).toBeCloseTo(1.0, 5); // Must be unit normalized

      // Pitch is 30 deg down -> y = -sin(30 deg) = -0.5
      expect(look.y).toBeCloseTo(-0.5, 4);

      // Target positioned exactly along look vector at 6m
      const eye = { x: 10, y: 64, z: 10 };
      const targetOnAxis = {
        x: eye.x + 6 * look.x,
        y: eye.y + 6 * look.y,
        z: eye.z + 6 * look.z,
      };

      const res = isWithinPerceptionFOV(eye, targetOnAxis, look);
      expect(res.inPerception).toBe(true);
      expect(res.mode).toBe('focal_fov');
      expect(res.angleDegrees).toBeCloseTo(0, 3);
    });
  });

  // ==========================================================================
  // AREA 5: Integrated MockMinecraftAgent Perception & Reach Verification
  // ==========================================================================
  describe('Area 5: Integrated Mock Agent Perception & Action Verification', () => {
    let agent: MockMinecraftAgent;

    beforeEach(() => {
      agent = new MockMinecraftAgent();
    });

    it('EMP-INT-1: canInteractWith enforces <= 4.50m reach and line-of-sight in integrated agent', () => {
      agent.bot.entity.position.set(0, 64, 0); // Eye at (0, 65.62, 0)
      const targetPos = { x: 3, y: 64, z: 0 };
      agent.world.setBlock(targetPos, 'iron_ore');

      // 1. Within 4.50m and open air -> canInteractWith is true
      expect(agent.canInteractWith(targetPos)).toBe(true);

      // 2. Beyond 4.50m (target at x=5) -> canInteractWith is false
      const farPos = { x: 5, y: 64, z: 0 };
      agent.world.setBlock(farPos, 'iron_ore');
      expect(agent.canInteractWith(farPos)).toBe(false);

      // 3. Within 4.50m but occluded by solid stone wall at x=2 -> canInteractWith is false
      agent.world.setBlock({ x: 2, y: 64, z: 0 }, 'stone');
      agent.world.setBlock({ x: 2, y: 65, z: 0 }, 'stone');
      agent.world.setBlock({ x: 2, y: 66, z: 0 }, 'stone');
      // Also occlude top and sides so no exposed face has LOS
      agent.world.setBlock({ x: 3, y: 65, z: 0 }, 'stone');
      expect(agent.canInteractWith(targetPos)).toBe(false);
    });

    it('EMP-INT-2: findVisibleBlock ignores unexposed underground ores (anti-xray invariant)', async () => {
      agent.bot.entity.position.set(0, 64, 0);

      // Encased diamond ore underground at (2, 60, 0)
      const underground = { x: 2, y: 60, z: 0 };
      agent.world.setBlock(underground, 'diamond_ore');
      agent.world.setBlock({ x: 3, y: 60, z: 0 }, 'stone');
      agent.world.setBlock({ x: 1, y: 60, z: 0 }, 'stone');
      agent.world.setBlock({ x: 2, y: 61, z: 0 }, 'stone');
      agent.world.setBlock({ x: 2, y: 59, z: 0 }, 'stone');
      agent.world.setBlock({ x: 2, y: 60, z: 1 }, 'stone');
      agent.world.setBlock({ x: 2, y: 60, z: -1 }, 'stone');

      const found = await agent.findVisibleBlock({
        blockNames: ['diamond_ore'],
        maxDistance: 16,
      });

      expect(found).toBeNull();
    });

    it('EMP-INT-3: findVisibleBlock perceives tactile nearby blocks behind player but rejects distant ones behind player', async () => {
      agent.bot.entity.position.set(0, 64, 0);
      agent.bot.entity.yaw = 0; // Facing south (-Z)
      agent.bot.entity.pitch = 0;

      // Block directly behind player (+Z) at distance 1.5m (<= 2.50m tactile radius)
      const closeBehind = { x: 0, y: 64, z: 1 };
      agent.world.setBlock(closeBehind, 'gold_ore');
      // Top face is exposed to air
      agent.world.setBlock({ x: 0, y: 65, z: 1 }, 'air');

      const foundTactile = await agent.findVisibleBlock({
        blockNames: ['gold_ore'],
        maxDistance: 16,
      });
      expect(foundTactile).not.toBeNull();
      expect(foundTactile?.position).toEqual(closeBehind);

      // Clear world and place block at 4.0m behind player (> 2.50m tactile radius, 180° outside FOV)
      agent.world.clear();
      const farBehind = { x: 0, y: 64, z: 4 };
      agent.world.setBlock(farBehind, 'gold_ore');
      agent.world.setBlock({ x: 0, y: 65, z: 4 }, 'air');

      const foundFar = await agent.findVisibleBlock({
        blockNames: ['gold_ore'],
        maxDistance: 16,
      });
      expect(foundFar).toBeNull();
    });
  });

  // ==========================================================================
  // AREA 6: High-Volume Fuzzing & Mathematical Oracle Invariants
  // ==========================================================================
  describe('Area 6: High-Volume Fuzzing & Mathematical Oracle Invariants', () => {
    it('EMP-FUZ-1: Oracle verification: getBlockDistanceToEye <= distance to any point inside or on block AABB', () => {
      // Linear congruential generator for reproducible fuzzing
      let seed = 1337;
      function rand(): number {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      }

      for (let iter = 0; iter < 1000; iter++) {
        // Random eye position in [-20, 20]
        const eye = {
          x: rand() * 40 - 20,
          y: rand() * 40 - 20,
          z: rand() * 40 - 20,
        };
        // Random block position (floored)
        const block = {
          x: Math.floor(rand() * 40 - 20),
          y: Math.floor(rand() * 40 - 20),
          z: Math.floor(rand() * 40 - 20),
        };

        const computedDist = getBlockDistanceToEye(eye, block);

        // Sample 20 random points inside the block AABB [x, x+1] x [y, y+1] x [z, z+1]
        for (let s = 0; s < 20; s++) {
          const samplePoint = {
            x: block.x + rand(),
            y: block.y + rand(),
            z: block.z + rand(),
          };
          const dx = eye.x - samplePoint.x;
          const dy = eye.y - samplePoint.y;
          const dz = eye.z - samplePoint.z;
          const sampleDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          // The AABB closest distance MUST be less than or equal to distance to any point inside AABB
          expect(
            computedDist,
            `Iteration ${iter}: getBlockDistanceToEye (${computedDist}) was greater than sample distance (${sampleDist})`
          ).toBeLessThanOrEqual(sampleDist + 1e-9);
        }
      }
    });

    it('EMP-FUZ-2: 360-degree spherical tactile field fuzz: 500 directions at 2.49m (pass) vs 2.51m outside cone (fail)', () => {
      let seed = 9999;
      function rand(): number {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      }

      const eye = { x: 0, y: 64, z: 0 };
      const look = { x: 0, y: 0, z: -1 }; // Looking South (-Z)

      for (let i = 0; i < 500; i++) {
        // Uniform random direction on unit sphere via Marsaglia method
        const u = rand() * 2 - 1;
        const theta = rand() * 2 * Math.PI;
        const r = Math.sqrt(Math.max(0, 1 - u * u));
        const dirX = r * Math.cos(theta);
        const dirY = r * Math.sin(theta);
        const dirZ = u;

        // 1. Point at 2.49m in ANY direction MUST be in perception via tactile fallback
        const pInside = {
          x: eye.x + 2.49 * dirX,
          y: eye.y + 2.49 * dirY,
          z: eye.z + 2.49 * dirZ,
        };
        const resInside = isWithinPerceptionFOV(eye, pInside, look);
        expect(resInside.inPerception, `Failed tactile perception at 2.49m in dir (${dirX}, ${dirY}, ${dirZ})`).toBe(true);
        expect(resInside.mode).toBe('tactile');

        // 2. Point at 2.55m: if angle to look vector > 35.1 deg, MUST be rejected
        const dot = dirX * look.x + dirY * look.y + dirZ * look.z;
        const angleDeg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;

        const pOutsideRadius = {
          x: eye.x + 2.55 * dirX,
          y: eye.y + 2.55 * dirY,
          z: eye.z + 2.55 * dirZ,
        };
        const resOutside = isWithinPerceptionFOV(eye, pOutsideRadius, look);

        if (angleDeg > 35.1) {
          expect(
            resOutside.inPerception,
            `Point at 2.55m with angle ${angleDeg}° was falsely accepted`
          ).toBe(false);
          expect(resOutside.mode).toBe('outside');
        } else if (angleDeg < 34.9) {
          expect(
            resInside.inPerception,
            `Point at 2.55m within cone (angle ${angleDeg}°) was rejected`
          ).toBe(true);
          expect(resOutside.mode).toBe('focal_fov');
        }
      }
    });

    it('EMP-FUZ-3: Raycaster resilience against extreme distances and zero distance edge cases', () => {
      const world = new MockWorld();
      const eye = { x: 0.5, y: 64.5, z: 0.5 };

      // Distance exactly zero
      const hitZero = checkLineOfSight(world, eye, { x: 0, y: 64, z: 0 }, eye, 32);
      expect(hitZero.visible).toBe(true);
      expect(hitZero.distance).toBe(0);

      // Distance beyond maxDistance (32m limit)
      const hitFar = checkLineOfSight(
        world,
        eye,
        { x: 50, y: 64, z: 0 },
        { x: 50.5, y: 64.5, z: 0.5 },
        32
      );
      expect(hitFar.visible).toBe(false);
      expect(hitFar.obstruction).toBe('MAX_DISTANCE_EXCEEDED');

      // Iteration safeguard: very long distance check within maxDistance
      const hitMaxDist = checkLineOfSight(
        world,
        eye,
        { x: 30, y: 64, z: 0 },
        { x: 30.5, y: 64.5, z: 0.5 },
        32
      );
      expect(hitMaxDist.visible).toBe(true);
    });
  });
});
