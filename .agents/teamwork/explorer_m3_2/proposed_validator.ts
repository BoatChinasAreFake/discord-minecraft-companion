/**
 * Validation Interceptor for Gemini Tool Invocations.
 *
 * Intercepts and validates all tool call arguments before dispatching to the
 * Minecraft agent. Strictly enforces fair-play survival limitations:
 * 1. Finite 3D coordinates and reasonable Y levels (-64 to 320).
 * 2. Survival reach constraints (<= 4.5m for container interactions).
 * 3. Prohibiting privileged, creative-only, or unobtainable blocks/items (bedrock, command blocks, barrier, etc.).
 * 4. Rejection of OP command injections across all string fields.
 * 5. Type and range bounds (count: 1..64, search radius: 1..32, defend radius: 1..32).
 */

import { z } from 'zod';
import type { Vec3Location } from '../../minecraft/types.js';
import {
  getBlockDistanceToEye,
  MAX_BLOCK_REACH_METERS,
} from '../../minecraft/fairplay/reach.js';
import { isPrivilegedCommand } from '../../minecraft/fairplay/commandSanitizer.js';
import {
  TOOL_NAMES,
  type ToolName,
  type ToolParamsMap,
  type GoToCoordinatesParams,
  type FollowPlayerParams,
  type GatherResourceParams,
  type DefendAreaParams,
  type ReportStatusParams,
  type StopCurrentTaskParams,
  type CraftItemParams,
  type SleepInBedParams,
  type DepositOrRetrieveParams,
} from './definitions.js';

// ============================================================================
// Custom Error Class
// ============================================================================

export class FairPlayValidationError extends Error {
  public readonly validationCode: string;
  public readonly toolName?: string;
  public readonly fieldName?: string;

  constructor(
    message: string,
    validationCode: string = 'FAIR_PLAY_VIOLATION',
    toolName?: string,
    fieldName?: string
  ) {
    super(`FairPlayValidationError [${validationCode}]${toolName ? ` in tool "${toolName}"` : ''}${fieldName ? ` (field "${fieldName}")` : ''}: ${message}`);
    this.name = 'FairPlayValidationError';
    this.validationCode = validationCode;
    this.toolName = toolName;
    this.fieldName = fieldName;
  }
}

// ============================================================================
// Fair-Play Survival Boundaries & Blacklists
// ============================================================================

export const SURVIVAL_LIMITS = {
  MIN_Y: -64,
  MAX_Y: 320,
  MAX_WORLD_COORDINATE: 30000000,
  MAX_STACK_COUNT: 64,
  MIN_STACK_COUNT: 1,
  MAX_SEARCH_RADIUS: 32,
  DEFAULT_SEARCH_RADIUS: 16,
  MAX_DEFEND_RADIUS: 32,
  DEFAULT_DEFEND_RADIUS: 16,
  MAX_FOLLOW_DISTANCE: 32,
  MIN_FOLLOW_DISTANCE: 1,
  DEFAULT_FOLLOW_DISTANCE: 3,
  MAX_CONTAINER_ITEMS: 27,
  MAX_BLOCK_REACH: MAX_BLOCK_REACH_METERS, // 4.50m
} as const;

export const FORBIDDEN_ITEMS = new Set<string>([
  'bedrock',
  'barrier',
  'command_block',
  'chain_command_block',
  'repeating_command_block',
  'command_block_minecart',
  'structure_block',
  'structure_void',
  'jigsaw',
  'light',
  'debug_stick',
  'spawner',
  'monster_spawner',
  'knowledge_book',
  'end_portal',
  'end_portal_frame',
  'nether_portal',
  'end_gateway',
  'reinforced_deepslate',
]);

// ============================================================================
// Normalization & Primitive Validation Helpers
// ============================================================================

export function normalizeItemOrBlockIdentifier(raw: string): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.startsWith('minecraft:')) {
    return trimmed.slice(10);
  }
  return trimmed;
}

export function assertNoCommandInjection(value: string, fieldName: string, toolName?: string): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (!trimmed) return;

  if (trimmed.startsWith('/') || isPrivilegedCommand(trimmed)) {
    throw new FairPlayValidationError(
      `String parameter contains privileged command or injection attempt: "${trimmed}"`,
      'COMMAND_INJECTION_DETECTED',
      toolName,
      fieldName
    );
  }
}

export function assertLegalItemIdentifier(rawName: string, fieldName: string, toolName?: string): string {
  if (typeof rawName !== 'string' || !rawName.trim()) {
    throw new FairPlayValidationError('Item or block name must not be empty', 'EMPTY_IDENTIFIER', toolName, fieldName);
  }

  assertNoCommandInjection(rawName, fieldName, toolName);

  const normalized = normalizeItemOrBlockIdentifier(rawName);

  if (!/^[a-z0-9_]+$/.test(normalized)) {
    throw new FairPlayValidationError(
      `Invalid item or block identifier "${rawName}". Must contain only lowercase alphanumeric characters and underscores.`,
      'MALFORMED_IDENTIFIER',
      toolName,
      fieldName
    );
  }

  if (FORBIDDEN_ITEMS.has(normalized)) {
    throw new FairPlayValidationError(
      `Block or item "${normalized}" is privileged, creative-only, or unobtainable under survival rules.`,
      'FORBIDDEN_ITEM_RESTRICTION',
      toolName,
      fieldName
    );
  }

  return normalized;
}

// ============================================================================
// Zod Schemas
// ============================================================================

const finiteCoordinateNumber = z
  .number({ invalid_type_error: 'Coordinate must be a number' })
  .refine((n) => Number.isFinite(n) && !Number.isNaN(n), {
    message: 'Coordinate must be a finite number',
  });

const xzWorldCoordinate = finiteCoordinateNumber.refine(
  (n) => Math.abs(n) <= SURVIVAL_LIMITS.MAX_WORLD_COORDINATE,
  { message: `Coordinate exceeds Minecraft world limits (+/- ${SURVIVAL_LIMITS.MAX_WORLD_COORDINATE})` }
);

const yWorldCoordinate = finiteCoordinateNumber.refine(
  (n) => n >= SURVIVAL_LIMITS.MIN_Y && n <= SURVIVAL_LIMITS.MAX_Y,
  { message: `Y altitude must be within survival world bounds [${SURVIVAL_LIMITS.MIN_Y}, ${SURVIVAL_LIMITS.MAX_Y}]` }
);

export const CoordinateSchema = z.object({
  x: xzWorldCoordinate,
  y: yWorldCoordinate,
  z: xzWorldCoordinate,
});

const safeItemNameSchema = z
  .string({ invalid_type_error: 'Item or block identifier must be a string' })
  .transform(normalizeItemOrBlockIdentifier)
  .superRefine((val, ctx) => {
    if (!val) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Identifier cannot be empty' });
      return;
    }
    if (val.startsWith('/') || isPrivilegedCommand(val)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Identifier contains command injection' });
      return;
    }
    if (!/^[a-z0-9_]+$/.test(val)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Identifier must be lowercase alphanumeric with underscores' });
      return;
    }
    if (FORBIDDEN_ITEMS.has(val)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${val}" is forbidden under survival rules` });
    }
  });

const stackCountSchema = z
  .number({ invalid_type_error: 'Count must be a number' })
  .int('Count must be an integer')
  .min(SURVIVAL_LIMITS.MIN_STACK_COUNT, `Count must be at least ${SURVIVAL_LIMITS.MIN_STACK_COUNT}`)
  .max(SURVIVAL_LIMITS.MAX_STACK_COUNT, `Count cannot exceed ${SURVIVAL_LIMITS.MAX_STACK_COUNT} (1 stack limit)`);

const searchRadiusSchema = z
  .number({ invalid_type_error: 'Radius must be a number' })
  .refine((n) => Number.isFinite(n) && !Number.isNaN(n), 'Radius must be a finite number')
  .refine((n) => n >= 1 && n <= SURVIVAL_LIMITS.MAX_SEARCH_RADIUS, {
    message: `Radius must be between 1 and ${SURVIVAL_LIMITS.MAX_SEARCH_RADIUS} blocks`,
  });

const followDistanceSchema = z
  .number({ invalid_type_error: 'Distance must be a number' })
  .refine((n) => Number.isFinite(n) && !Number.isNaN(n), 'Distance must be a finite number')
  .refine((n) => n >= SURVIVAL_LIMITS.MIN_FOLLOW_DISTANCE && n <= SURVIVAL_LIMITS.MAX_FOLLOW_DISTANCE, {
    message: `Distance must be between ${SURVIVAL_LIMITS.MIN_FOLLOW_DISTANCE} and ${SURVIVAL_LIMITS.MAX_FOLLOW_DISTANCE} blocks`,
  });

const safePlayerNameSchema = z
  .string({ invalid_type_error: 'Player name must be a string' })
  .trim()
  .min(1, 'Player name cannot be empty')
  .max(16, 'Player name cannot exceed 16 characters')
  .superRefine((val, ctx) => {
    if (val.startsWith('/') || isPrivilegedCommand(val)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Player name contains command injection' });
      return;
    }
    if (!/^[a-zA-Z0-9_]{1,16}$/.test(val)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Player name must match standard Minecraft username syntax' });
    }
  });

const safeReasonSchema = z
  .string({ invalid_type_error: 'Reason must be a string' })
  .max(256, 'Reason cannot exceed 256 characters')
  .superRefine((val, ctx) => {
    if (val.startsWith('/') || isPrivilegedCommand(val)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Reason text contains privileged command injection' });
    }
  })
  .optional();

export const GoToCoordinatesSchema = CoordinateSchema;

export const FollowPlayerSchema = z.object({
  playerName: safePlayerNameSchema,
  distance: followDistanceSchema.optional().default(SURVIVAL_LIMITS.DEFAULT_FOLLOW_DISTANCE),
});

export const GatherResourceSchema = z.object({
  blockType: safeItemNameSchema,
  count: stackCountSchema,
  maxSearchRadius: searchRadiusSchema.optional().default(SURVIVAL_LIMITS.DEFAULT_SEARCH_RADIUS),
});

export const DefendAreaSchema = z.object({
  radius: searchRadiusSchema.optional().default(SURVIVAL_LIMITS.DEFAULT_DEFEND_RADIUS),
  targetHostilesOnly: z.boolean().optional().default(true),
});

export const ReportStatusSchema = z.object({
  includeInventory: z.boolean().optional().default(true),
  includePosition: z.boolean().optional().default(true),
});

export const StopCurrentTaskSchema = z.object({
  reason: safeReasonSchema,
});

export const CraftItemSchema = z.object({
  item: safeItemNameSchema,
  count: stackCountSchema,
});

export const SleepInBedSchema = z
  .object({})
  .catchall(z.unknown())
  .transform(() => ({}));

export const ItemQuantitySchema = z.object({
  name: safeItemNameSchema,
  count: stackCountSchema,
});

export const DepositOrRetrieveSchema = z.object({
  action: z.enum(['deposit', 'retrieve'], {
    errorMap: () => ({ message: 'Action must be strictly "deposit" or "retrieve"' }),
  }),
  containerCoordinates: CoordinateSchema.optional(),
  items: z
    .array(ItemQuantitySchema)
    .min(1, 'Items array must contain at least 1 item to transfer')
    .max(SURVIVAL_LIMITS.MAX_CONTAINER_ITEMS, `Cannot transfer more than ${SURVIVAL_LIMITS.MAX_CONTAINER_ITEMS} items at once`),
});

export const TOOL_SCHEMAS = {
  goToCoordinates: GoToCoordinatesSchema,
  followPlayer: FollowPlayerSchema,
  gatherResource: GatherResourceSchema,
  defendArea: DefendAreaSchema,
  reportStatus: ReportStatusSchema,
  stopCurrentTask: StopCurrentTaskSchema,
  craftItem: CraftItemSchema,
  sleepInBed: SleepInBedSchema,
  depositOrRetrieve: DepositOrRetrieveSchema,
} as const;

// ============================================================================
// Context & Reach Verification
// ============================================================================

export interface ValidationContext {
  botEyePosition?: Vec3Location;
  botPosition?: Vec3Location;
  maxBlockReach?: number;
}

export function assertContainerReach(
  containerPos: Vec3Location,
  botEyePos: Vec3Location,
  maxReach: number = SURVIVAL_LIMITS.MAX_BLOCK_REACH
): number {
  const dist = getBlockDistanceToEye(botEyePos, containerPos);
  if (dist > maxReach + 1e-4) {
    throw new FairPlayValidationError(
      `Container interaction at (${containerPos.x}, ${containerPos.y}, ${containerPos.z}) is out of reach (${dist.toFixed(2)}m exceeds survival reach limit of ${maxReach.toFixed(2)}m). Bot must navigate closer before interacting.`,
      'REACH_EXCEEDED',
      'depositOrRetrieve',
      'containerCoordinates'
    );
  }
  return dist;
}

// ============================================================================
// Main Validation Interceptors
// ============================================================================

export interface ValidationSuccess<T> {
  valid: true;
  data: T;
}

export interface ValidationFailure {
  valid: false;
  error: string;
  code: string;
  toolName?: string;
  violations?: string[];
}

export type ToolValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export function isKnownToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * Validates tool arguments strictly, throwing FairPlayValidationError on any violation.
 */
export function validateToolArgs<T extends ToolName>(
  toolName: T,
  rawArgs: unknown,
  context?: ValidationContext
): ToolParamsMap[T] {
  if (!isKnownToolName(toolName)) {
    throw new FairPlayValidationError(`Unknown or unregistered tool "${toolName}"`, 'UNKNOWN_TOOL_NAME', toolName);
  }

  const schema = TOOL_SCHEMAS[toolName];
  const parseResult = schema.safeParse(rawArgs ?? {});

  if (!parseResult.success) {
    const errorDetails = parseResult.error.issues
      .map((i) => `[${i.path.join('.') || 'root'}] ${i.message}`)
      .join('; ');
    throw new FairPlayValidationError(
      `Validation failed for tool "${toolName}": ${errorDetails}`,
      'ARGUMENT_SCHEMA_VIOLATION',
      toolName
    );
  }

  const validatedData = parseResult.data as ToolParamsMap[T];

  // Specific cross-check: Container interaction reach constraints
  if (toolName === 'depositOrRetrieve') {
    const drParams = validatedData as DepositOrRetrieveParams;
    if (drParams.containerCoordinates && context?.botEyePosition) {
      assertContainerReach(drParams.containerCoordinates, context.botEyePosition, context.maxBlockReach);
    }
  }

  return validatedData;
}

/**
 * Safe functional wrapper returning a structured result object without throwing.
 */
export function validateToolCall(
  toolName: string,
  rawArgs: unknown,
  context?: ValidationContext
): ToolValidationResult<unknown> {
  try {
    if (!isKnownToolName(toolName)) {
      return {
        valid: false,
        error: `Unknown or unregistered tool "${toolName}"`,
        code: 'UNKNOWN_TOOL_NAME',
        toolName,
      };
    }

    const data = validateToolArgs(toolName, rawArgs, context);
    return { valid: true, data };
  } catch (err: any) {
    if (err instanceof FairPlayValidationError) {
      return {
        valid: false,
        error: err.message,
        code: err.validationCode,
        toolName: err.toolName,
      };
    }
    return {
      valid: false,
      error: err?.message || String(err),
      code: 'UNEXPECTED_VALIDATION_ERROR',
      toolName,
    };
  }
}
