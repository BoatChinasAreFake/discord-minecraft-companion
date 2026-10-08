import type { Vec3Location } from '../types.js';
import { MAX_BLOCK_REACH_METERS, MAX_ENTITY_ATTACK_REACH_METERS, getBlockDistanceToEye, getEntityDistanceToEye } from './reach.js';
import { sanitizeMinecraftMessage } from './commandSanitizer.js';

export const FAIRPLAY_BLOCK_REACH = MAX_BLOCK_REACH_METERS; // 4.50m
export const FAIRPLAY_ENTITY_REACH = MAX_ENTITY_ATTACK_REACH_METERS; // 3.50m
export const FAIRPLAY_MAX_DROP_DOWN = 3;
export const FAIRPLAY_ALLOW_PARKOUR = false;
export const FAIRPLAY_ALLOW_1BY1_TOWERS = false;
export const FAIRPLAY_FOCAL_FOV_HALF_ANGLE = 35.0;
export const FAIRPLAY_TACTILE_RADIUS = 2.50;

export interface FairPlayValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateFairPlayAction(
  action: 'mine' | 'attack' | 'chat' | 'place' | 'move',
  params: Record<string, unknown>
): FairPlayValidationResult {
  switch (action) {
    case 'mine':
    case 'place': {
      const eyePos = params.eyePos as Vec3Location;
      const targetPos = params.targetPos as Vec3Location;
      if (!eyePos || !targetPos) {
        return { valid: false, reason: 'Missing eyePos or targetPos for block interaction' };
      }
      const dist = getBlockDistanceToEye(eyePos, targetPos);
      if (dist > FAIRPLAY_BLOCK_REACH + 1e-4) {
        return {
          valid: false,
          reason: `Block interaction distance ${dist.toFixed(2)}m exceeds max fair-play limit of ${FAIRPLAY_BLOCK_REACH}m`
        };
      }
      return { valid: true };
    }
    case 'attack': {
      const eyePos = params.eyePos as Vec3Location;
      const entityPos = params.entityPos as Vec3Location;
      if (!eyePos || !entityPos) {
        return { valid: false, reason: 'Missing eyePos or entityPos for attack action' };
      }
      const dist = getEntityDistanceToEye(eyePos, entityPos);
      if (dist > FAIRPLAY_ENTITY_REACH + 1e-4) {
        return {
          valid: false,
          reason: `Entity attack distance ${dist.toFixed(2)}m exceeds max fair-play combat limit of ${FAIRPLAY_ENTITY_REACH}m`
        };
      }
      return { valid: true };
    }
    case 'chat': {
      const message = params.message as string;
      const result = sanitizeMinecraftMessage(message);
      if (result.isCommand && !result.allowed) {
        return {
          valid: false,
          reason: result.reason || `Blocked privileged command: ${result.commandName}`
        };
      }
      return { valid: true };
    }
    case 'move': {
      if (params.maxDropDown !== undefined && Number(params.maxDropDown) > FAIRPLAY_MAX_DROP_DOWN) {
        return {
          valid: false,
          reason: `maxDropDown ${params.maxDropDown} exceeds safe survival limit of ${FAIRPLAY_MAX_DROP_DOWN}`
        };
      }
      if (params.allowParkour === true) {
        return {
          valid: false,
          reason: 'Parkour jumping is disabled under fair-play navigation safety rules'
        };
      }
      return { valid: true };
    }
    default:
      return { valid: true };
  }
}

export function assertFairPlayAction(
  action: 'mine' | 'attack' | 'chat' | 'place' | 'move',
  params: Record<string, unknown>
): void {
  const result = validateFairPlayAction(action, params);
  if (!result.valid) {
    throw new Error(`FairPlayRuleViolation: ${result.reason}`);
  }
}
