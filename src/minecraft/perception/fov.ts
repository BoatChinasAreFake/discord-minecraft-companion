import type { Vec3Location } from '../types.js';

export interface FOVCheckResult {
  inPerception: boolean;
  mode: 'tactile' | 'focal_fov' | 'outside';
  distance: number;
  angleDegrees?: number;
  dotProduct?: number;
}

export const TACTILE_RADIUS_METERS = 2.50;
export const FOV_HALF_ANGLE_DEGREES = 35.0; // 70 degree total cone
export const FOV_COS_THRESHOLD = Math.cos((FOV_HALF_ANGLE_DEGREES * Math.PI) / 180); // ~0.819152

/**
 * Derives a normalized 3D look direction vector from Minecraft yaw and pitch angles (radians).
 * Yaw: horizontal rotation (0 is South, Math.PI/2 is West, Math.PI is North, -Math.PI/2 is East).
 * Pitch: vertical tilt (0 is horizon, < 0 looking up, > 0 looking down).
 */
export function getLookVectorFromYawPitch(yaw: number, pitch: number): Vec3Location {
  const cosPitch = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cosPitch,
    y: -Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch,
  };
}

/**
 * Checks whether a target point falls within the agent's legitimate perception zone:
 * 1. Near-field tactile fallback: within <= 2.50m (360-degree sphere, mining at feet, etc.)
 * 2. Focal FOV vision cone: within 70-degree cone (dot product >= cos(35°))
 */
export function isWithinPerceptionFOV(
  eyePos: Vec3Location,
  targetPos: Vec3Location,
  lookVector: Vec3Location
): FOVCheckResult {
  const dx = targetPos.x - eyePos.x;
  const dy = targetPos.y - eyePos.y;
  const dz = targetPos.z - eyePos.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // 1. Tactile Fallback Rule: <= 2.50m sphere
  if (distance <= TACTILE_RADIUS_METERS + 1e-4) {
    return {
      inPerception: true,
      mode: 'tactile',
      distance,
    };
  }

  // 2. Focal FOV Cone Rule: > 2.50m
  const lookMag = Math.sqrt(
    lookVector.x * lookVector.x + lookVector.y * lookVector.y + lookVector.z * lookVector.z
  );

  if (lookMag < 1e-6 || distance < 1e-6) {
    return { inPerception: false, mode: 'outside', distance };
  }

  const dot = (lookVector.x * dx + lookVector.y * dy + lookVector.z * dz) / (lookMag * distance);
  const clampedDot = Math.max(-1, Math.min(1, dot));
  const angleDeg = (Math.acos(clampedDot) * 180) / Math.PI;

  if (clampedDot >= FOV_COS_THRESHOLD - 1e-4) {
    return {
      inPerception: true,
      mode: 'focal_fov',
      distance,
      angleDegrees: angleDeg,
      dotProduct: clampedDot,
    };
  }

  return {
    inPerception: false,
    mode: 'outside',
    distance,
    angleDegrees: angleDeg,
    dotProduct: clampedDot,
  };
}
