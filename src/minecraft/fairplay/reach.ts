import type { Vec3Location } from '../types.js';

export const MAX_BLOCK_REACH_METERS = 4.50;
export const MAX_ENTITY_ATTACK_REACH_METERS = 3.50;

export class ReachExceededError extends Error {
  constructor(
    public readonly targetType: 'block' | 'entity',
    public readonly distance: number,
    public readonly maxAllowed: number,
    public readonly targetPos: Vec3Location
  ) {
    super(
      `Fair-Play Reach Exceeded: ${targetType} interaction at distance ${distance.toFixed(2)}m exceeds maximum survival limit of ${maxAllowed.toFixed(2)}m`
    );
    this.name = 'ReachExceededError';
  }
}

/**
 * Computes exact Euclidean distance from eye position to the closest surface point
 * of a block's unit axis-aligned bounding box (AABB) [x, x+1] x [y, y+1] x [z, z+1].
 */
export function getBlockDistanceToEye(eyePos: Vec3Location, blockPos: Vec3Location): number {
  const minX = Math.floor(blockPos.x);
  const maxX = minX + 1.0;
  const minY = Math.floor(blockPos.y);
  const maxY = minY + 1.0;
  const minZ = Math.floor(blockPos.z);
  const maxZ = minZ + 1.0;

  const cx = Math.max(minX, Math.min(eyePos.x, maxX));
  const cy = Math.max(minY, Math.min(eyePos.y, maxY));
  const cz = Math.max(minZ, Math.min(eyePos.z, maxZ));

  const dx = eyePos.x - cx;
  const dy = eyePos.y - cy;
  const dz = eyePos.z - cz;

  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Computes exact Euclidean distance from eye position to the closest point
 * of an entity's axis-aligned bounding box.
 */
export function getEntityDistanceToEye(
  eyePos: Vec3Location,
  entityPos: Vec3Location,
  entityHeight = 1.8,
  entityWidth = 0.6
): number {
  const halfW = entityWidth / 2.0;
  const minX = entityPos.x - halfW;
  const maxX = entityPos.x + halfW;
  const minY = entityPos.y;
  const maxY = entityPos.y + entityHeight;
  const minZ = entityPos.z - halfW;
  const maxZ = entityPos.z + halfW;

  const cx = Math.max(minX, Math.min(eyePos.x, maxX));
  const cy = Math.max(minY, Math.min(eyePos.y, maxY));
  const cz = Math.max(minZ, Math.min(eyePos.z, maxZ));

  const dx = eyePos.x - cx;
  const dy = eyePos.y - cy;
  const dz = eyePos.z - cz;

  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Validates that block is within <= 4.50m reach.
 * Throws ReachExceededError if out of reach.
 */
export function assertBlockReach(eyePos: Vec3Location, blockPos: Vec3Location): number {
  const dist = getBlockDistanceToEye(eyePos, blockPos);
  // Allow epsilon 1e-4 for floating point tolerances at boundary
  if (dist > MAX_BLOCK_REACH_METERS + 1e-4) {
    throw new ReachExceededError('block', dist, MAX_BLOCK_REACH_METERS, blockPos);
  }
  return dist;
}

/**
 * Validates that entity is within <= 3.50m attack reach.
 * Throws ReachExceededError if out of reach.
 */
export function assertEntityAttackReach(
  eyePos: Vec3Location,
  entityPos: Vec3Location,
  entityHeight?: number,
  entityWidth?: number
): number {
  const dist = getEntityDistanceToEye(eyePos, entityPos, entityHeight, entityWidth);
  if (dist > MAX_ENTITY_ATTACK_REACH_METERS + 1e-4) {
    throw new ReachExceededError('entity', dist, MAX_ENTITY_ATTACK_REACH_METERS, entityPos);
  }
  return dist;
}

export function isWithinBlockReach(eyePos: Vec3Location, blockPos: Vec3Location): boolean {
  return getBlockDistanceToEye(eyePos, blockPos) <= MAX_BLOCK_REACH_METERS + 1e-4;
}

export function isWithinEntityAttackReach(
  eyePos: Vec3Location,
  entityPos: Vec3Location,
  entityHeight?: number,
  entityWidth?: number
): boolean {
  return getEntityDistanceToEye(eyePos, entityPos, entityHeight, entityWidth) <= MAX_ENTITY_ATTACK_REACH_METERS + 1e-4;
}
