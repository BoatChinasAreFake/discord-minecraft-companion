import type { Vec3Location } from '../types.js';
import { type IBlockAccessor, isExposingBlock } from './exposure.js';

export interface RaycastHit {
  visible: boolean;
  hitVoxel?: Vec3Location;
  obstruction?: string;
  distance: number;
}

/**
 * Executes Amanatides & Woo (1987) 3D Digital Differential Analyzer (3D DDA)
 * voxel line-of-sight check from eye position to a target point on or inside targetVoxel.
 */
export function checkLineOfSight(
  world: IBlockAccessor,
  eye: Vec3Location,
  targetVoxel: Vec3Location,
  targetPoint: Vec3Location,
  maxDistance = 32.0
): RaycastHit {
  const dx = targetPoint.x - eye.x;
  const dy = targetPoint.y - eye.y;
  const dz = targetPoint.z - eye.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist > maxDistance) {
    return { visible: false, distance: dist, obstruction: 'MAX_DISTANCE_EXCEEDED' };
  }
  if (dist < 1e-6) {
    return { visible: true, distance: 0 };
  }

  // Normalized direction
  const dirX = dx / dist;
  const dirY = dy / dist;
  const dirZ = dz / dist;

  let X = Math.floor(eye.x);
  let Y = Math.floor(eye.y);
  let Z = Math.floor(eye.z);

  const startX = X;
  const startY = Y;
  const startZ = Z;

  const targetX = Math.floor(targetVoxel.x);
  const targetY = Math.floor(targetVoxel.y);
  const targetZ = Math.floor(targetVoxel.z);

  const stepX = dirX > 0 ? 1 : dirX < 0 ? -1 : 0;
  const stepY = dirY > 0 ? 1 : dirY < 0 ? -1 : 0;
  const stepZ = dirZ > 0 ? 1 : dirZ < 0 ? -1 : 0;

  const tDeltaX = dirX !== 0 ? Math.abs(1 / dirX) : Infinity;
  const tDeltaY = dirY !== 0 ? Math.abs(1 / dirY) : Infinity;
  const tDeltaZ = dirZ !== 0 ? Math.abs(1 / dirZ) : Infinity;

  let tMaxX = dirX > 0 ? ((X + 1) - eye.x) / dirX : dirX < 0 ? (X - eye.x) / dirX : Infinity;
  let tMaxY = dirY > 0 ? ((Y + 1) - eye.y) / dirY : dirY < 0 ? (Y - eye.y) / dirY : Infinity;
  let tMaxZ = dirZ > 0 ? ((Z + 1) - eye.z) / dirZ : dirZ < 0 ? (Z - eye.z) / dirZ : Infinity;

  let tCurrent = 0;
  const maxIterations = 200; // Safeguard against non-advancing loops
  let iterations = 0;

  while (tCurrent <= dist + 0.1 && iterations++ < maxIterations) {
    // If we reached the target voxel, line of sight is clear!
    if (X === targetX && Y === targetY && Z === targetZ) {
      return { visible: true, distance: tCurrent };
    }

    // Do not check the eye's immediate starting voxel unless it is the target
    const isStartVoxel = X === startX && Y === startY && Z === startZ;
    if (!isStartVoxel) {
      const block = world.getBlock({ x: X, y: Y, z: Z });
      if (block && !isExposingBlock(block)) {
        // Obstructed by opaque solid block
        return {
          visible: false,
          hitVoxel: { x: X, y: Y, z: Z },
          obstruction: block.name,
          distance: tCurrent,
        };
      }
    }

    // Advance to next voxel along closest axis boundary
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      X += stepX;
      tCurrent = tMaxX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxZ) {
      Y += stepY;
      tCurrent = tMaxY;
      tMaxY += tDeltaY;
    } else {
      Z += stepZ;
      tCurrent = tMaxZ;
      tMaxZ += tDeltaZ;
    }
  }

  // Final check at termination point
  if (X === targetX && Y === targetY && Z === targetZ) {
    return { visible: true, distance: tCurrent };
  }

  return { visible: false, distance: dist, obstruction: 'RAY_OVERSHOT' };
}

/**
 * Checks line of sight from eye to target block.
 * If exposedFaceCenters are provided, tests each exposed face center.
 * If any face center has unobstructed line of sight, returns true.
 */
export function hasBlockLineOfSight(
  world: IBlockAccessor,
  eye: Vec3Location,
  targetVoxel: Vec3Location,
  exposedFaceCenters?: Vec3Location[],
  maxDistance = 32.0
): boolean {
  if (exposedFaceCenters && exposedFaceCenters.length > 0) {
    for (const faceCenter of exposedFaceCenters) {
      const hit = checkLineOfSight(world, eye, targetVoxel, faceCenter, maxDistance);
      if (hit.visible) {
        return true;
      }
    }
    return false;
  }

  // Fallback to testing the center of the block
  const blockCenter: Vec3Location = {
    x: Math.floor(targetVoxel.x) + 0.5,
    y: Math.floor(targetVoxel.y) + 0.5,
    z: Math.floor(targetVoxel.z) + 0.5,
  };

  const hit = checkLineOfSight(world, eye, targetVoxel, blockCenter, maxDistance);
  return hit.visible;
}
