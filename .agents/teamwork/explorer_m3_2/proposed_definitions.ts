/**
 * Structured Fair-Play Tool Declarations for Google Gemini AI Planner.
 *
 * Implements 9 strictly scoped, non-cheating survival tools using official
 * `@google/genai` FunctionDeclaration schemas.
 */

import { Type, type FunctionDeclaration, type Tool } from '@google/genai';

export const TOOL_NAMES = [
  'goToCoordinates',
  'followPlayer',
  'gatherResource',
  'defendArea',
  'reportStatus',
  'stopCurrentTask',
  'craftItem',
  'sleepInBed',
  'depositOrRetrieve',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

// ============================================================================
// TypeScript Parameter Interfaces
// ============================================================================

export interface GoToCoordinatesParams {
  x: number;
  y: number;
  z: number;
}

export interface FollowPlayerParams {
  playerName: string;
  distance?: number;
}

export interface GatherResourceParams {
  blockType: string;
  count: number;
  maxSearchRadius?: number;
}

export interface DefendAreaParams {
  radius?: number;
  targetHostilesOnly?: boolean;
}

export interface ReportStatusParams {
  includeInventory?: boolean;
  includePosition?: boolean;
}

export interface StopCurrentTaskParams {
  reason?: string;
}

export interface CraftItemParams {
  item: string;
  count: number;
}

export type SleepInBedParams = Record<string, never>;

export interface ItemQuantity {
  name: string;
  count: number;
}

export interface DepositOrRetrieveParams {
  action: 'deposit' | 'retrieve';
  containerCoordinates?: {
    x: number;
    y: number;
    z: number;
  };
  items: ItemQuantity[];
}

export interface ToolParamsMap {
  goToCoordinates: GoToCoordinatesParams;
  followPlayer: FollowPlayerParams;
  gatherResource: GatherResourceParams;
  defendArea: DefendAreaParams;
  reportStatus: ReportStatusParams;
  stopCurrentTask: StopCurrentTaskParams;
  craftItem: CraftItemParams;
  sleepInBed: SleepInBedParams;
  depositOrRetrieve: DepositOrRetrieveParams;
}

// ============================================================================
// Gemini Function Declarations (OpenAPI 3.03 via @google/genai Type enum)
// ============================================================================

export const goToCoordinatesDeclaration: FunctionDeclaration = {
  name: 'goToCoordinates',
  description:
    'Navigate the Minecraft bot to the specified 3D world coordinates using safe survival pathfinding. Respects fall damage, liquid hazards, and physical obstacle collision.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      x: {
        type: Type.NUMBER,
        description: 'Target X coordinate in the Minecraft world.',
      },
      y: {
        type: Type.NUMBER,
        description: 'Target Y coordinate in the Minecraft world (clamped to survival bounds: -64 to 320).',
      },
      z: {
        type: Type.NUMBER,
        description: 'Target Z coordinate in the Minecraft world.',
      },
    },
    required: ['x', 'y', 'z'],
  },
};

export const followPlayerDeclaration: FunctionDeclaration = {
  name: 'followPlayer',
  description:
    'Follow a specified player within the Minecraft world while maintaining a safe survival distance and pathfinding around hazards.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      playerName: {
        type: Type.STRING,
        description: 'The in-game username of the player to follow.',
      },
      distance: {
        type: Type.NUMBER,
        description: 'Target following distance in blocks (default: 3.0, allowed range: 1.0 to 32.0).',
      },
    },
    required: ['playerName'],
  },
};

export const gatherResourceDeclaration: FunctionDeclaration = {
  name: 'gatherResource',
  description:
    'Search for, navigate to, and legitimately harvest/mine a specified survival block resource without cheating or x-ray. Operates strictly within line-of-sight and surface exposure rules.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      blockType: {
        type: Type.STRING,
        description: 'The standard Minecraft block identifier to harvest (e.g., "oak_log", "iron_ore", "cobblestone").',
      },
      count: {
        type: Type.INTEGER,
        description: 'The quantity of resource blocks to collect (between 1 and 64).',
      },
      maxSearchRadius: {
        type: Type.NUMBER,
        description: 'Maximum horizontal search radius in blocks from current location (max: 32, default: 16).',
      },
    },
    required: ['blockType', 'count'],
  },
};

export const defendAreaDeclaration: FunctionDeclaration = {
  name: 'defendArea',
  description:
    'Patrol and defend the immediate area against hostile threats within a specified radius using fair-play combat (weapon cooldown gauge timing and shield blocking).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      radius: {
        type: Type.NUMBER,
        description: 'Defensive patrol radius in blocks around the current position (max: 32, default: 16).',
      },
      targetHostilesOnly: {
        type: Type.BOOLEAN,
        description: 'Whether to target only hostile monsters while ignoring friendly players and passive mobs (default: true).',
      },
    },
    required: [],
  },
};

export const reportStatusDeclaration: FunctionDeclaration = {
  name: 'reportStatus',
  description:
    'Query and return the bot\'s current health, hunger, coordinates, dimension, active gear, and inventory overview.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      includeInventory: {
        type: Type.BOOLEAN,
        description: 'Whether to include a detailed breakdown of inventory items and free slots (default: true).',
      },
      includePosition: {
        type: Type.BOOLEAN,
        description: 'Whether to include the bot\'s current 3D world coordinates and dimension (default: true).',
      },
    },
    required: [],
  },
};

export const stopCurrentTaskDeclaration: FunctionDeclaration = {
  name: 'stopCurrentTask',
  description:
    'Immediately halt and cancel the current active task or goal, stopping pathfinding navigation, block digging, and combat actions.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      reason: {
        type: Type.STRING,
        description: 'Optional human-readable reason or user prompt that triggered the task cancellation.',
      },
    },
    required: [],
  },
};

export const craftItemDeclaration: FunctionDeclaration = {
  name: 'craftItem',
  description:
    'Craft a specified item using legitimate survival recipes, utilizing inventory 2x2 grid or a nearby crafting table (<= 4.5m reach) if a 3x3 table is required.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      item: {
        type: Type.STRING,
        description: 'The standard item or recipe name to craft (e.g., "torch", "iron_pickaxe", "crafting_table").',
      },
      count: {
        type: Type.INTEGER,
        description: 'The quantity of items to craft (between 1 and 64).',
      },
    },
    required: ['item', 'count'],
  },
};

export const sleepInBedDeclaration: FunctionDeclaration = {
  name: 'sleepInBed',
  description:
    'Locate and sleep in an available bed nearby during night or thunderstorm to skip the night and set spawn, adhering to the 8m/5m monster exclusion distance.',
  parameters: {
    type: Type.OBJECT,
    properties: {},
    required: [],
  },
};

export const depositOrRetrieveDeclaration: FunctionDeclaration = {
  name: 'depositOrRetrieve',
  description:
    'Deposit items into or retrieve items from a legitimate nearby storage container (chest, barrel, shulker_box) within <= 4.5m survival reach.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: {
        type: Type.STRING,
        description: 'The container action to perform: "deposit" to put items into container, or "retrieve" to take items out.',
        enum: ['deposit', 'retrieve'],
      },
      containerCoordinates: {
        type: Type.OBJECT,
        description: 'Optional 3D coordinates of the target container block. If omitted, searches for the nearest visible container.',
        properties: {
          x: { type: Type.NUMBER, description: 'Container X coordinate.' },
          y: { type: Type.NUMBER, description: 'Container Y coordinate.' },
          z: { type: Type.NUMBER, description: 'Container Z coordinate.' },
        },
        required: ['x', 'y', 'z'],
      },
      items: {
        type: Type.ARRAY,
        description: 'List of items to transfer with their target counts.',
        items: {
          type: Type.OBJECT,
          properties: {
            name: {
              type: Type.STRING,
              description: 'The item identifier (e.g., "cobblestone", "iron_ingot").',
            },
            count: {
              type: Type.INTEGER,
              description: 'The quantity of this item to transfer (between 1 and 64).',
            },
          },
          required: ['name', 'count'],
        },
      },
    },
    required: ['action', 'items'],
  },
};

export const FAIR_PLAY_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  goToCoordinatesDeclaration,
  followPlayerDeclaration,
  gatherResourceDeclaration,
  defendAreaDeclaration,
  reportStatusDeclaration,
  stopCurrentTaskDeclaration,
  craftItemDeclaration,
  sleepInBedDeclaration,
  depositOrRetrieveDeclaration,
];

export const FAIR_PLAY_TOOLS: Tool[] = [
  {
    functionDeclarations: FAIR_PLAY_TOOL_DECLARATIONS,
  },
];
