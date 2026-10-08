import type { Vec3Location, ActionResult } from '../types.js';
import { assertBlockReach, getBlockDistanceToEye } from '../fairplay/reach.js';
import { evaluateBlockExposure } from '../perception/exposure.js';
import { hasBlockLineOfSight } from '../perception/raycast.js';

export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'shears' | 'none';

export interface HarvestRequirement {
  requiresTool: boolean;
  toolType: ToolType;
  minTierRank: number;
  minTierName: string;
}

export const TIER_RANKS: Record<string, number> = {
  none: 0,
  wooden: 1,
  golden: 1,
  stone: 2,
  iron: 3,
  diamond: 4,
  netherite: 5,
};

export function getToolTierRank(toolName: string): number {
  const lower = toolName.toLowerCase();
  if (lower.includes('netherite')) return 5;
  if (lower.includes('diamond')) return 4;
  if (lower.includes('iron')) return 3;
  if (lower.includes('stone')) return 2;
  if (lower.includes('golden') || lower.includes('gold')) return 1;
  if (lower.includes('wooden') || lower.includes('wood')) return 1;
  return 0;
}

export function getToolType(toolName: string): ToolType {
  const lower = toolName.toLowerCase();
  if (lower.includes('pickaxe')) return 'pickaxe';
  if (lower.includes('axe')) return 'axe';
  if (lower.includes('shovel')) return 'shovel';
  if (lower.includes('hoe')) return 'hoe';
  if (lower.includes('shears')) return 'shears';
  return 'none';
}

export function getHarvestRequirement(blockName: string): HarvestRequirement {
  const name = blockName.toLowerCase();

  // Tier 4 Pickaxe: Obsidian, Ancient Debris, Crying Obsidian, Respawn Anchor
  if (name.includes('obsidian') || name.includes('ancient_debris') || name.includes('respawn_anchor')) {
    return { requiresTool: true, toolType: 'pickaxe', minTierRank: 4, minTierName: 'diamond' };
  }

  // Tier 3 Pickaxe: Diamond, Emerald, Gold, Redstone ores
  if (
    name.includes('diamond_ore') ||
    name.includes('emerald_ore') ||
    name.includes('gold_ore') ||
    name.includes('redstone_ore')
  ) {
    return { requiresTool: true, toolType: 'pickaxe', minTierRank: 3, minTierName: 'iron' };
  }

  // Tier 2 Pickaxe: Iron, Copper, Lapis ores
  if (name.includes('iron_ore') || name.includes('copper_ore') || name.includes('lapis_ore')) {
    return { requiresTool: true, toolType: 'pickaxe', minTierRank: 2, minTierName: 'stone' };
  }

  // Tier 1 Pickaxe: Coal ore, Nether Quartz, Stone, Cobblestone, Sandstone, Deepslate
  if (
    name.includes('coal_ore') ||
    name.includes('quartz_ore') ||
    name.includes('stone') ||
    name.includes('cobblestone') ||
    name.includes('deepslate') ||
    name.includes('sandstone') ||
    name.includes('andesite') ||
    name.includes('diorite') ||
    name.includes('granite')
  ) {
    return { requiresTool: true, toolType: 'pickaxe', minTierRank: 1, minTierName: 'wooden' };
  }

  // Woods / Axes (optional, drops with bare hand but faster with axe)
  if (name.includes('log') || name.includes('wood') || name.includes('plank')) {
    return { requiresTool: false, toolType: 'axe', minTierRank: 0, minTierName: 'none' };
  }

  // Dirt, Sand, Gravel (optional, drops with bare hand)
  if (name.includes('dirt') || name.includes('sand') || name.includes('gravel') || name.includes('clay')) {
    return { requiresTool: false, toolType: 'shovel', minTierRank: 0, minTierName: 'none' };
  }

  // Default: can break with hand
  return { requiresTool: false, toolType: 'none', minTierRank: 0, minTierName: 'none' };
}

export function canSafelyHarvest(
  blockName: string,
  inventoryItems: any[]
): { canHarvest: boolean; toolToEquip: any | null; reason?: string } {
  const req = getHarvestRequirement(blockName);

  if (!req.requiresTool) {
    // Find best optional tool if available
    const matching = inventoryItems.filter((item) => item && getToolType(item.name) === req.toolType);
    if (matching.length > 0) {
      matching.sort((a, b) => getToolTierRank(b.name) - getToolTierRank(a.name));
      return { canHarvest: true, toolToEquip: matching[0] };
    }
    return { canHarvest: true, toolToEquip: null };
  }

  // Must have required tool of at least minTierRank
  const matchingTools = inventoryItems.filter((item) => item && getToolType(item.name) === req.toolType);
  const eligibleTools = matchingTools.filter((tool) => getToolTierRank(tool.name) >= req.minTierRank);

  if (eligibleTools.length === 0) {
    return {
      canHarvest: false,
      toolToEquip: null,
      reason: `Cannot harvest ${blockName}: requires a ${req.toolType} of tier >= ${req.minTierName}. Mining would destroy the block without dropping items.`,
    };
  }

  eligibleTools.sort((a, b) => getToolTierRank(b.name) - getToolTierRank(a.name));
  return { canHarvest: true, toolToEquip: eligibleTools[0] };
}

export class MiningAction {
  constructor(private bot: any) {}

  public async mineBlock(targetPos: Vec3Location): Promise<ActionResult> {
    const eye = {
      x: this.bot.entity.position.x,
      y: this.bot.entity.position.y + (this.bot.entity.eyeHeight ?? 1.62),
      z: this.bot.entity.position.z,
    };

    // 1. Fair-Play Reach Check (<= 4.50m)
    const dist = getBlockDistanceToEye(eye, targetPos);
    if (dist > 4.50 + 1e-4) {
      return {
        success: false,
        message: `Block at (${targetPos.x}, ${targetPos.y}, ${targetPos.z}) is out of reach (${dist.toFixed(2)}m > 4.50m)`,
      };
    }

    const block = this.bot.blockAt ? this.bot.blockAt(targetPos) : null;
    if (!block || block.name === 'air') {
      return { success: false, message: 'No target block found at coordinates' };
    }

    // 2. Line of Sight Check
    const exposure = evaluateBlockExposure(
      { getBlock: (p) => (this.bot.blockAt ? this.bot.blockAt(p) : null) },
      targetPos
    );
    const hasLos = hasBlockLineOfSight(
      { getBlock: (p) => (this.bot.blockAt ? this.bot.blockAt(p) : null) },
      eye,
      targetPos,
      exposure.exposedFaceCenters
    );
    if (!hasLos) {
      return {
        success: false,
        message: `Block at (${targetPos.x}, ${targetPos.y}, ${targetPos.z}) has no visible line of sight (obstructed by solid block)`,
      };
    }

    // 3. Harvest Tier Check
    const items = this.bot.inventory?.items ? this.bot.inventory.items() : [];
    const harvestCheck = canSafelyHarvest(block.name, items);
    if (!harvestCheck.canHarvest) {
      return {
        success: false,
        message: harvestCheck.reason || 'Insufficient tool tier to harvest block without destroying drops',
      };
    }

    // 4. Equip Best Tool
    if (harvestCheck.toolToEquip && this.bot.equip) {
      await this.bot.equip(harvestCheck.toolToEquip, 'hand');
    }

    // 5. Dig Execution with Damage Interrupt Guard
    return new Promise<ActionResult>((resolve) => {
      let aborted = false;

      const hurtListener = (target: any) => {
        if (target && target.id === this.bot.entity?.id) {
          aborted = true;
          if (this.bot.stopDigging) {
            this.bot.stopDigging();
          }
          this.bot.removeListener('entityHurt', hurtListener);
          resolve({
            success: false,
            message: 'Mining interrupted: agent took damage during digging',
          });
        }
      };

      if (this.bot.on) {
        this.bot.on('entityHurt', hurtListener);
      }

      this.bot
        .dig(block)
        .then(() => {
          if (this.bot.removeListener) {
            this.bot.removeListener('entityHurt', hurtListener);
          }
          if (!aborted) {
            resolve({
              success: true,
              message: `Successfully mined ${block.name} at (${targetPos.x}, ${targetPos.y}, ${targetPos.z})`,
            });
          }
        })
        .catch((err: any) => {
          if (this.bot.removeListener) {
            this.bot.removeListener('entityHurt', hurtListener);
          }
          if (!aborted) {
            resolve({
              success: false,
              message: `Mining failed: ${err.message || String(err)}`,
            });
          }
        });
    });
  }
}
