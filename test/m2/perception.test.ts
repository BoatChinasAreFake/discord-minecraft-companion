import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateBlockExposure,
  isExposingBlock,
  type IBlockAccessor,
  CARDINAL_FACES,
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
import { MockWorld } from '../mocks/mockMinecraft.js';

describe('Milestone 2: Perception & Anti-Xray Subsystem', () => {
  let world: MockWorld;

  beforeEach(() => {
    world = new MockWorld();
  });

  describe('Surface Exposure Filter (exposure.ts)', () => {
    it('TC-EXP-1: Encased block (6 solid stone neighbors) returns isExposed === false', () => {
      // Place a target diamond_ore at (10, 50, 10)
      const targetPos = { x: 10, y: 50, z: 10 };
      world.setBlock(targetPos, 'diamond_ore');

      // Surround with 6 solid stone blocks
      world.setBlock({ x: 11, y: 50, z: 10 }, 'stone'); // +x
      world.setBlock({ x: 9, y: 50, z: 10 }, 'stone');  // -x
      world.setBlock({ x: 10, y: 51, z: 10 }, 'stone'); // +y
      world.setBlock({ x: 10, y: 49, z: 10 }, 'stone'); // -y
      world.setBlock({ x: 10, y: 50, z: 11 }, 'stone'); // +z
      world.setBlock({ x: 10, y: 50, z: 9 }, 'stone');  // -z

      const exposure = evaluateBlockExposure(world, targetPos);
      expect(exposure.isExposed).toBe(false);
      expect(exposure.exposedFaces).toHaveLength(0);
      expect(exposure.exposedFaceCenters).toHaveLength(0);
    });

    it('TC-EXP-2: Block with +Y face exposed to air returns isExposed === true with +y face center', () => {
      const targetPos = { x: 5, y: 60, z: 5 };
      world.setBlock(targetPos, 'iron_ore');

      // 5 solid neighbors, top (+y) is air
      world.setBlock({ x: 6, y: 60, z: 5 }, 'stone');
      world.setBlock({ x: 4, y: 60, z: 5 }, 'stone');
      world.setBlock({ x: 5, y: 59, z: 5 }, 'stone');
      world.setBlock({ x: 5, y: 60, z: 6 }, 'stone');
      world.setBlock({ x: 5, y: 60, z: 4 }, 'stone');
      world.setBlock({ x: 5, y: 61, z: 5 }, 'air');

      const exposure = evaluateBlockExposure(world, targetPos);
      expect(exposure.isExposed).toBe(true);
      expect(exposure.exposedFaces).toEqual(['+y']);
      expect(exposure.exposedFaceCenters).toEqual([{ x: 5.5, y: 61.0, z: 5.5 }]);
    });

    it('TC-EXP-3: Block adjacent to transparent glass or water is recognized as exposed', () => {
      const targetPos = { x: 0, y: 64, z: 0 };
      world.setBlock(targetPos, 'diamond_ore');

      world.setBlock({ x: 1, y: 64, z: 0 }, 'glass');
      world.setBlock({ x: -1, y: 64, z: 0 }, 'water');
      world.setBlock({ x: 0, y: 65, z: 0 }, 'stone');
      world.setBlock({ x: 0, y: 63, z: 0 }, 'stone');
      world.setBlock({ x: 0, y: 64, z: 1 }, 'stone');
      world.setBlock({ x: 0, y: 64, z: -1 }, 'stone');

      const exposure = evaluateBlockExposure(world, targetPos);
      expect(exposure.isExposed).toBe(true);
      expect(exposure.exposedFaces).toContain('+x');
      expect(exposure.exposedFaces).toContain('-x');
    });

    it('TC-EXP-4: Unloaded chunk boundary (null) does not falsely expose block', () => {
      const targetPos = { x: 100, y: 64, z: 100 };
      const nullAccessor: IBlockAccessor = {
        getBlock: () => null, // Represents unloaded chunks
      };

      const exposure = evaluateBlockExposure(nullAccessor, targetPos);
      expect(exposure.isExposed).toBe(false);
      expect(exposure.exposedFaces).toHaveLength(0);
    });

    it('TC-EXP-5: Exposing block classification recognizes foliage, redstone, and partial structures', () => {
      expect(isExposingBlock({ name: 'oak_leaves', transparent: true })).toBe(true);
      expect(isExposingBlock({ name: 'torch', transparent: true })).toBe(true);
      expect(isExposingBlock({ name: 'ladder', transparent: true })).toBe(true);
      expect(isExposingBlock({ name: 'oak_slab', transparent: true })).toBe(true);
      expect(isExposingBlock({ name: 'stone' })).toBe(false);
      expect(isExposingBlock({ name: 'deepslate' })).toBe(false);
      expect(isExposingBlock(null)).toBe(false);
    });
  });

  describe('3D Line-of-Sight Raycasting (raycast.ts)', () => {
    it('TC-RAY-1: Unobstructed raycast through air returns visible === true', () => {
      const eyePos = { x: 0, y: 65.62, z: 0 };
      const targetVoxel = { x: 3, y: 65, z: 0 };
      const targetPoint = { x: 3.5, y: 65.5, z: 0.5 };

      world.setBlock(targetVoxel, 'gold_ore');
      world.setBlock({ x: 1, y: 65, z: 0 }, 'air');
      world.setBlock({ x: 2, y: 65, z: 0 }, 'air');

      const result = checkLineOfSight(world, eyePos, targetVoxel, targetPoint, 16);
      expect(result.visible).toBe(true);
      expect(result.distance).toBeGreaterThan(0);
    });

    it('TC-RAY-2: Solid stone wall between eye and target blocks line of sight', () => {
      const eyePos = { x: 0, y: 65.62, z: 0 };
      const targetVoxel = { x: 4, y: 65, z: 0 };
      const targetPoint = { x: 4.5, y: 65.5, z: 0.5 };

      world.setBlock(targetVoxel, 'diamond_ore');
      // Place solid stone wall at x = 2
      world.setBlock({ x: 2, y: 65, z: 0 }, 'stone');

      const result = checkLineOfSight(world, eyePos, targetVoxel, targetPoint, 16);
      expect(result.visible).toBe(false);
      expect(result.obstruction).toBe('stone');
      expect(result.hitVoxel).toEqual({ x: 2, y: 65, z: 0 });
    });

    it('TC-RAY-3: Raycast passes through transparent glass and water without obstruction', () => {
      const eyePos = { x: 0, y: 65.62, z: 0 };
      const targetVoxel = { x: 3, y: 65, z: 0 };
      const targetPoint = { x: 3.5, y: 65.5, z: 0.5 };

      world.setBlock(targetVoxel, 'chest');
      world.setBlock({ x: 1, y: 65, z: 0 }, 'glass');
      world.setBlock({ x: 2, y: 65, z: 0 }, 'water');

      const result = checkLineOfSight(world, eyePos, targetVoxel, targetPoint, 16);
      expect(result.visible).toBe(true);
    });

    it('TC-RAY-4: Multi-face sampling finds exposed top face even when front face is occluded', () => {
      const eyePos = { x: 0, y: 67, z: 0 };
      const targetVoxel = { x: 2, y: 64, z: 0 };

      world.setBlock(targetVoxel, 'emerald_ore');
      // Block front face at x=1, y=64
      world.setBlock({ x: 1, y: 64, z: 0 }, 'stone');
      // Top face at x=2, y=65 is air
      world.setBlock({ x: 2, y: 65, z: 0 }, 'air');

      const topFaceCenter = { x: 2.5, y: 65.0, z: 0.5 };
      const hasLos = hasBlockLineOfSight(world, eyePos, targetVoxel, [topFaceCenter]);
      expect(hasLos).toBe(true);
    });

    it('TC-RAY-5: Exceeding max search distance terminates gracefully', () => {
      const eyePos = { x: 0, y: 64, z: 0 };
      const targetVoxel = { x: 50, y: 64, z: 0 };
      const targetPoint = { x: 50.5, y: 64.5, z: 0.5 };

      const result = checkLineOfSight(world, eyePos, targetVoxel, targetPoint, 16);
      expect(result.visible).toBe(false);
      expect(result.obstruction).toBe('MAX_DISTANCE_EXCEEDED');
    });
  });

  describe('Field-of-View Cone & Tactile Fallback (fov.ts)', () => {
    it('TC-FOV-1: Target directly in front (0° offset, 5m away) is within focal cone', () => {
      const eyePos = { x: 0, y: 65.62, z: 0 };
      // Facing South (yaw = 0, pitch = 0 -> look vector is (0, 0, -1))
      const lookVector = getLookVectorFromYawPitch(0, 0); // { x: 0, y: 0, z: -1 }
      const targetPos = { x: 0, y: 65.62, z: -5.0 };

      const result = isWithinPerceptionFOV(eyePos, targetPos, lookVector);
      expect(result.inPerception).toBe(true);
      expect(result.mode).toBe('focal_fov');
      expect(result.angleDegrees).toBeLessThan(1.0);
    });

    it('TC-FOV-2: Target at 25° angle (< 35° half-angle) is within focal cone', () => {
      const eyePos = { x: 0, y: 65.62, z: 0 };
      const lookVector = { x: 0, y: 0, z: -1 };
      // Target at 25 degrees horizontal offset at 4.0m
      const rad = (25 * Math.PI) / 180;
      const targetPos = {
        x: 4.0 * Math.sin(rad),
        y: 65.62,
        z: -4.0 * Math.cos(rad),
      };

      const result = isWithinPerceptionFOV(eyePos, targetPos, lookVector);
      expect(result.inPerception).toBe(true);
      expect(result.mode).toBe('focal_fov');
      expect(result.angleDegrees).toBeCloseTo(25, 0);
    });

    it('TC-FOV-3: Target at 60° angle (> 35° half-angle, 5m away) is outside FOV', () => {
      const eyePos = { x: 0, y: 65.62, z: 0 };
      const lookVector = { x: 0, y: 0, z: -1 };
      const rad = (60 * Math.PI) / 180;
      const targetPos = {
        x: 5.0 * Math.sin(rad),
        y: 65.62,
        z: -5.0 * Math.cos(rad),
      };

      const result = isWithinPerceptionFOV(eyePos, targetPos, lookVector);
      expect(result.inPerception).toBe(false);
      expect(result.mode).toBe('outside');
      expect(result.angleDegrees).toBeCloseTo(60, 0);
    });

    it('TC-FOV-4: Target directly behind (180° offset, 1.8m away) is perceived via tactile fallback', () => {
      const eyePos = { x: 0, y: 65.62, z: 0 };
      const lookVector = { x: 0, y: 0, z: -1 };
      // Target is directly behind at distance 1.8m (<= 2.50m)
      const targetPos = { x: 0, y: 65.62, z: 1.8 };

      const result = isWithinPerceptionFOV(eyePos, targetPos, lookVector);
      expect(result.inPerception).toBe(true);
      expect(result.mode).toBe('tactile');
      expect(result.distance).toBeCloseTo(1.8, 1);
    });

    it('TC-FOV-5: Target directly behind at 3.2m (> 2.50m tactile radius) is rejected', () => {
      const eyePos = { x: 0, y: 65.62, z: 0 };
      const lookVector = { x: 0, y: 0, z: -1 };
      // Target directly behind at 3.2m
      const targetPos = { x: 0, y: 65.62, z: 3.2 };

      const result = isWithinPerceptionFOV(eyePos, targetPos, lookVector);
      expect(result.inPerception).toBe(false);
      expect(result.mode).toBe('outside');
    });

    it('TC-FOV-6: Look vector accurately computes vertical tilt pitch', () => {
      // Looking straight down: pitch = Math.PI / 2
      const lookDown = getLookVectorFromYawPitch(0, Math.PI / 2);
      expect(lookDown.y).toBeCloseTo(-1, 2);
      expect(lookDown.x).toBeCloseTo(0, 2);
      expect(lookDown.z).toBeCloseTo(0, 2);

      // Looking straight up: pitch = -Math.PI / 2
      const lookUp = getLookVectorFromYawPitch(0, -Math.PI / 2);
      expect(lookUp.y).toBeCloseTo(1, 2);
    });
  });
});
