import type { Vec3Location, ActionResult } from '../types.js';
import { assertBlockReach, getBlockDistanceToEye } from '../fairplay/reach.js';
import { countItem } from './inventory.js';

export interface CraftStep {
  recipeName: string;
  outputItem: string;
  count: number;
  requiresTable: boolean;
}

export interface DecompositionResult {
  canCraft: boolean;
  missingRawMaterials: Array<{ item: string; count: number }>;
  executionPlan: CraftStep[];
}

export interface RecipeDefinition {
  name: string;
  outputItem: string;
  resultCount: number;
  requiresTable: boolean;
  ingredients: Array<{ item: string; count: number }>;
}

export const KNOWN_RECIPES: Record<string, RecipeDefinition> = {
  oak_planks: {
    name: 'oak_planks',
    outputItem: 'oak_planks',
    resultCount: 4,
    requiresTable: false,
    ingredients: [{ item: 'oak_log', count: 1 }],
  },
  stick: {
    name: 'stick',
    outputItem: 'stick',
    resultCount: 4,
    requiresTable: false,
    ingredients: [{ item: 'oak_planks', count: 2 }],
  },
  crafting_table: {
    name: 'crafting_table',
    outputItem: 'crafting_table',
    resultCount: 1,
    requiresTable: false,
    ingredients: [{ item: 'oak_planks', count: 4 }],
  },
  torch: {
    name: 'torch',
    outputItem: 'torch',
    resultCount: 4,
    requiresTable: false,
    ingredients: [
      { item: 'coal', count: 1 },
      { item: 'stick', count: 1 },
    ],
  },
  wooden_pickaxe: {
    name: 'wooden_pickaxe',
    outputItem: 'wooden_pickaxe',
    resultCount: 1,
    requiresTable: true,
    ingredients: [
      { item: 'oak_planks', count: 3 },
      { item: 'stick', count: 2 },
    ],
  },
  wooden_sword: {
    name: 'wooden_sword',
    outputItem: 'wooden_sword',
    resultCount: 1,
    requiresTable: true,
    ingredients: [
      { item: 'oak_planks', count: 2 },
      { item: 'stick', count: 1 },
    ],
  },
  stone_pickaxe: {
    name: 'stone_pickaxe',
    outputItem: 'stone_pickaxe',
    resultCount: 1,
    requiresTable: true,
    ingredients: [
      { item: 'cobblestone', count: 3 },
      { item: 'stick', count: 2 },
    ],
  },
  iron_pickaxe: {
    name: 'iron_pickaxe',
    outputItem: 'iron_pickaxe',
    resultCount: 1,
    requiresTable: true,
    ingredients: [
      { item: 'iron_ingot', count: 3 },
      { item: 'stick', count: 2 },
    ],
  },
  diamond_pickaxe: {
    name: 'diamond_pickaxe',
    outputItem: 'diamond_pickaxe',
    resultCount: 1,
    requiresTable: true,
    ingredients: [
      { item: 'diamond', count: 3 },
      { item: 'stick', count: 2 },
    ],
  },
  diamond_sword: {
    name: 'diamond_sword',
    outputItem: 'diamond_sword',
    resultCount: 1,
    requiresTable: true,
    ingredients: [
      { item: 'diamond', count: 2 },
      { item: 'stick', count: 1 },
    ],
  },
  chest: {
    name: 'chest',
    outputItem: 'chest',
    resultCount: 1,
    requiresTable: true,
    ingredients: [{ item: 'oak_planks', count: 8 }],
  },
  furnace: {
    name: 'furnace',
    outputItem: 'furnace',
    resultCount: 1,
    requiresTable: true,
    ingredients: [{ item: 'cobblestone', count: 8 }],
  },
};

export function is2x2Recipe(recipeName: string): boolean {
  const recipe = KNOWN_RECIPES[recipeName];
  return recipe ? !recipe.requiresTable : false;
}

export function is3x3Recipe(recipeName: string): boolean {
  const recipe = KNOWN_RECIPES[recipeName];
  return recipe ? recipe.requiresTable : true;
}

/**
 * Topologically decomposes a target craft into prerequisite crafts and identifies any missing raw materials.
 */
export function decomposeRecipe(
  targetItem: string,
  targetCount: number,
  inventoryCounts: Map<string, number>
): DecompositionResult {
  const plan: CraftStep[] = [];
  const virtualInventory = new Map<string, number>(inventoryCounts);
  const missingMaterials = new Map<string, number>();

  function resolve(item: string, neededCount: number): boolean {
    const available = virtualInventory.get(item) ?? 0;
    if (available >= neededCount) {
      virtualInventory.set(item, available - neededCount);
      return true;
    }

    const deficit = neededCount - available;
    virtualInventory.set(item, 0);

    const recipe = KNOWN_RECIPES[item];
    if (!recipe) {
      // Base raw item cannot be crafted further
      missingMaterials.set(item, (missingMaterials.get(item) ?? 0) + deficit);
      return false;
    }

    const batches = Math.ceil(deficit / recipe.resultCount);
    for (const ing of recipe.ingredients) {
      const ingNeeded = ing.count * batches;
      const ok = resolve(ing.item, ingNeeded);
      if (!ok) {
        // Continue tracking other missing ingredients
      }
    }

    plan.push({
      recipeName: recipe.name,
      outputItem: item,
      count: batches,
      requiresTable: recipe.requiresTable,
    });

    const leftover = batches * recipe.resultCount - deficit;
    virtualInventory.set(item, (virtualInventory.get(item) ?? 0) + leftover);
    return true;
  }

  resolve(targetItem, targetCount);

  return {
    canCraft: missingMaterials.size === 0,
    missingRawMaterials: Array.from(missingMaterials.entries()).map(([item, count]) => ({ item, count })),
    executionPlan: plan,
  };
}

export class CraftingAction {
  constructor(private bot: any) {}

  public async craftItem(recipeName: string, count = 1): Promise<ActionResult> {
    const recipe = KNOWN_RECIPES[recipeName];
    if (!recipe) {
      return { success: false, message: `Unknown recipe "${recipeName}"` };
    }

    // Build current inventory map
    const invMap = new Map<string, number>();
    const items = this.bot.inventory?.items ? this.bot.inventory.items() : [];
    for (const item of items) {
      invMap.set(item.name, (invMap.get(item.name) ?? 0) + item.count);
    }

    const decomp = decomposeRecipe(recipeName, count, invMap);
    if (!decomp.canCraft) {
      const missingStr = decomp.missingRawMaterials.map((m) => `${m.count}x ${m.item}`).join(', ');
      return {
        success: false,
        message: `Cannot craft ${count}x ${recipeName}: missing raw resources: ${missingStr}`,
        details: { missing: decomp.missingRawMaterials },
      };
    }

    // Find nearby crafting table if needed
    let tableBlock: any = null;
    const needsTable = decomp.executionPlan.some((step) => step.requiresTable);

    if (needsTable) {
      if (this.bot.findBlock) {
        tableBlock = this.bot.findBlock({
          matching: (b: any) => b.name === 'crafting_table',
          maxDistance: 4.5,
        });
      } else if (this.bot.world?.getAllBlocks) {
        tableBlock = this.bot.world.getAllBlocks().find((b: any) => b.name === 'crafting_table');
      }

      if (!tableBlock) {
        return {
          success: false,
          message: `Crafting ${recipeName} requires a crafting table within 4.5m, but none found`,
        };
      }

      const eye = {
        x: this.bot.entity.position.x,
        y: this.bot.entity.position.y + (this.bot.entity.eyeHeight ?? 1.62),
        z: this.bot.entity.position.z,
      };
      const dist = getBlockDistanceToEye(eye, tableBlock.position);
      if (dist > 4.50 + 1e-4) {
        return {
          success: false,
          message: `Crafting table is out of reach (${dist.toFixed(2)}m > 4.50m)`,
        };
      }
    }

    // Execute each step in topological order
    for (const step of decomp.executionPlan) {
      const stepRecipe = KNOWN_RECIPES[step.recipeName] || { name: step.recipeName };
      if (this.bot.craft) {
        await this.bot.craft(stepRecipe, step.count, step.requiresTable ? tableBlock : undefined);
      }
    }

    return {
      success: true,
      message: `Successfully crafted ${count}x ${recipeName}`,
      details: { stepsExecuted: decomp.executionPlan.length },
    };
  }
}
