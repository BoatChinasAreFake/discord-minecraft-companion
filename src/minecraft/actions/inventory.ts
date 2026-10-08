import type { Vec3Location, ActionResult } from '../types.js';
import { assertBlockReach, getBlockDistanceToEye } from '../fairplay/reach.js';
import { evaluateBlockExposure } from '../perception/exposure.js';
import { hasBlockLineOfSight } from '../perception/raycast.js';

export interface InventoryOverview {
  totalSlots: number;
  usedSlots: number;
  freeSlots: number;
  heldItem: string;
  offHandItem: string;
  armor: {
    head?: string;
    torso?: string;
    legs?: string;
    feet?: string;
  };
  keyItemsSummary: string;
}

export function getInventoryStatus(bot: any): InventoryOverview {
  const items = bot.inventory?.items ? bot.inventory.items() : [];
  const usedSlots = items.length;
  const totalSlots = 36;
  const freeSlots = Math.max(0, totalSlots - usedSlots);

  const head = bot.armor?.head?.name || bot.inventory?.slots?.[5]?.name;
  const torso = bot.armor?.torso?.name || bot.inventory?.slots?.[6]?.name;
  const legs = bot.armor?.legs?.name || bot.inventory?.slots?.[7]?.name;
  const feet = bot.armor?.feet?.name || bot.inventory?.slots?.[8]?.name;

  const keyItemsSummary = items
    .slice(0, 5)
    .map((i: any) => `${i.count}x ${i.name}`)
    .join(', ');

  return {
    totalSlots,
    usedSlots,
    freeSlots,
    heldItem: bot.heldItem?.name || 'empty',
    offHandItem: bot.offHandItem?.name || bot.inventory?.slots?.[45]?.name || 'empty',
    armor: {
      head,
      torso,
      legs,
      feet,
    },
    keyItemsSummary,
  };
}

export function countItem(bot: any, itemName: string): number {
  if (bot.inventory?.count) {
    return bot.inventory.count(itemName);
  }
  const items = bot.inventory?.items ? bot.inventory.items() : [];
  return items.reduce((acc: number, item: any) => (item.name === itemName ? acc + item.count : acc), 0);
}

export function findItem(bot: any, itemName: string): any | null {
  if (bot.inventory?.findInventoryItem) {
    return bot.inventory.findInventoryItem(itemName);
  }
  const items = bot.inventory?.items ? bot.inventory.items() : [];
  return items.find((i: any) => i.name === itemName) || null;
}

export class InventoryAction {
  constructor(private bot: any) {}

  public getOverview(): InventoryOverview {
    return getInventoryStatus(this.bot);
  }

  public async depositItem(
    containerPos: Vec3Location,
    itemName: string,
    count: number
  ): Promise<ActionResult> {
    const eye = {
      x: this.bot.entity.position.x,
      y: this.bot.entity.position.y + (this.bot.entity.eyeHeight ?? 1.62),
      z: this.bot.entity.position.z,
    };

    // 1. Reach check
    const dist = getBlockDistanceToEye(eye, containerPos);
    if (dist > 4.50 + 1e-4) {
      return {
        success: false,
        message: `Container at (${containerPos.x}, ${containerPos.y}, ${containerPos.z}) is out of reach (${dist.toFixed(2)}m > 4.50m)`,
      };
    }

    const block = this.bot.blockAt ? this.bot.blockAt(containerPos) : null;
    if (!block || !block.name.match(/(chest|barrel|shulker_box)/)) {
      return { success: false, message: 'No valid container at target position' };
    }

    // 2. Line of sight check
    const exposure = evaluateBlockExposure(
      { getBlock: (p) => (this.bot.blockAt ? this.bot.blockAt(p) : null) },
      containerPos
    );
    const hasLos = hasBlockLineOfSight(
      { getBlock: (p) => (this.bot.blockAt ? this.bot.blockAt(p) : null) },
      eye,
      containerPos,
      exposure.exposedFaceCenters
    );
    if (!hasLos) {
      return { success: false, message: 'No line of sight to container' };
    }

    // 3. Check bot has enough of item
    const available = countItem(this.bot, itemName);
    if (available < count) {
      return {
        success: false,
        message: `Insufficient items to deposit: requested ${count}x ${itemName}, but only have ${available}`,
      };
    }

    // 4. Open and perform transaction safely
    let window: any = null;
    try {
      window = await this.bot.openContainer(block);
      await window.deposit(itemName, null, count);
      return {
        success: true,
        message: `Deposited ${count}x ${itemName} into container`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Deposit failed: ${err.message || String(err)}`,
      };
    } finally {
      if (window && window.close) {
        window.close();
      }
    }
  }

  public async withdrawItem(
    containerPos: Vec3Location,
    itemName: string,
    count: number
  ): Promise<ActionResult> {
    const eye = {
      x: this.bot.entity.position.x,
      y: this.bot.entity.position.y + (this.bot.entity.eyeHeight ?? 1.62),
      z: this.bot.entity.position.z,
    };

    // 1. Reach check
    const dist = getBlockDistanceToEye(eye, containerPos);
    if (dist > 4.50 + 1e-4) {
      return {
        success: false,
        message: `Container at (${containerPos.x}, ${containerPos.y}, ${containerPos.z}) is out of reach (${dist.toFixed(2)}m > 4.50m)`,
      };
    }

    const block = this.bot.blockAt ? this.bot.blockAt(containerPos) : null;
    if (!block || !block.name.match(/(chest|barrel|shulker_box)/)) {
      return { success: false, message: 'No valid container at target position' };
    }

    // 2. Line of sight check
    const exposure = evaluateBlockExposure(
      { getBlock: (p) => (this.bot.blockAt ? this.bot.blockAt(p) : null) },
      containerPos
    );
    const hasLos = hasBlockLineOfSight(
      { getBlock: (p) => (this.bot.blockAt ? this.bot.blockAt(p) : null) },
      eye,
      containerPos,
      exposure.exposedFaceCenters
    );
    if (!hasLos) {
      return { success: false, message: 'No line of sight to container' };
    }

    let window: any = null;
    try {
      window = await this.bot.openContainer(block);
      await window.withdraw(itemName, null, count);
      return {
        success: true,
        message: `Withdrew ${count}x ${itemName} from container`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Withdraw failed: ${err.message || String(err)}`,
      };
    } finally {
      if (window && window.close) {
        window.close();
      }
    }
  }
}
