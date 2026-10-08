import type { Vec3Location, ActionResult } from '../types.js';
import { assertEntityAttackReach, getEntityDistanceToEye } from '../fairplay/reach.js';

export class CombatCooldownController {
  private lastAttackTimestamp = 0;

  public getCooldownPeriodMs(heldItemName?: string): number {
    if (!heldItemName) return 250; // Bare hand
    const lower = heldItemName.toLowerCase();
    if (lower.includes('sword')) return 625; // 1.6 attacks/sec
    if (lower.includes('netherite_axe') || lower.includes('diamond_axe')) return 1000;
    if (lower.includes('iron_axe')) return 1111;
    if (lower.includes('stone_axe') || lower.includes('wooden_axe')) return 1250;
    if (lower.includes('pickaxe')) return 833;
    if (lower.includes('shovel')) return 1000;
    return 250;
  }

  public async awaitFullGauge(heldItemName?: string): Promise<number> {
    const period = this.getCooldownPeriodMs(heldItemName);
    const elapsed = Date.now() - this.lastAttackTimestamp;
    const waitTime = period - elapsed;
    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    return Math.max(0, waitTime);
  }

  public recordAttack(): void {
    this.lastAttackTimestamp = Date.now();
  }
}

export class CombatAction {
  public cooldown = new CombatCooldownController();

  constructor(private bot: any) {}

  public shouldRetreat(): boolean {
    return (this.bot.health ?? 20) < 6.0;
  }

  public async attackEntity(entityId: number): Promise<ActionResult> {
    // 1. Health check for tactical retreat (< 6 HP)
    if (this.shouldRetreat()) {
      await this.executeRetreat();
      return {
        success: false,
        message: 'Attack aborted: health below 6 HP, executed tactical retreat',
      };
    }

    const entity = this.bot.entities ? this.bot.entities[String(entityId)] : null;
    if (!entity) {
      return { success: false, message: `Entity ${entityId} not found` };
    }

    const eye = {
      x: this.bot.entity.position.x,
      y: this.bot.entity.position.y + (this.bot.entity.eyeHeight ?? 1.62),
      z: this.bot.entity.position.z,
    };

    // 2. Entity Combat Reach Check (<= 3.50m)
    const dist = getEntityDistanceToEye(eye, entity.position);
    if (dist > 3.50 + 1e-4) {
      return {
        success: false,
        message: `Entity ${entityId} is out of attack reach (${dist.toFixed(2)}m > 3.50m)`,
      };
    }

    // 3. Face entity
    if (this.bot.lookAt) {
      await this.bot.lookAt(entity.position, true);
    }

    // 4. Weapon cooldown gauge timing
    const heldWeapon = this.bot.heldItem?.name;
    await this.cooldown.awaitFullGauge(heldWeapon);

    // 5. Lower shield if raised
    if (this.bot.deactivateItem) {
      this.bot.deactivateItem();
    }

    // 6. Swing attack
    if (this.bot.attack) {
      await this.bot.attack(entity);
      this.cooldown.recordAttack();
    }

    // 7. Re-raise shield if available in offhand
    if (this.bot.offHandItem?.name === 'shield' && this.bot.activateItem) {
      this.bot.activateItem(true);
    }

    return {
      success: true,
      message: `Successfully attacked entity ${entityId}`,
      details: { weapon: heldWeapon, distance: dist },
    };
  }

  public async executeRetreat(): Promise<ActionResult> {
    // Drop shield and enable sprinting
    if (this.bot.setControlState) {
      this.bot.setControlState('sprint', true);
      this.bot.setControlState('back', true);
    }

    // Compute repulsion away from nearby threats
    let repulsionX = 0;
    let repulsionZ = 0;
    const botPos = this.bot.entity.position;

    if (this.bot.entities) {
      for (const ent of Object.values(this.bot.entities) as any[]) {
        if (!ent || !ent.position || ent.id === this.bot.entity.id) continue;
        const dx = botPos.x - ent.position.x;
        const dz = botPos.z - ent.position.z;
        const dSq = dx * dx + dz * dz;
        if (dSq > 0 && dSq < 256) {
          repulsionX += dx / dSq;
          repulsionZ += dz / dSq;
        }
      }
    }

    const mag = Math.sqrt(repulsionX * repulsionX + repulsionZ * repulsionZ);
    const retreatVector = mag > 1e-4 ? { x: repulsionX / mag, z: repulsionZ / mag } : { x: 0, z: -1 };

    const safePos: Vec3Location = {
      x: botPos.x + retreatVector.x * 16,
      y: botPos.y,
      z: botPos.z + retreatVector.z * 16,
    };

    if (this.bot.pathfinder?.goto) {
      try {
        await this.bot.pathfinder.goto(safePos);
      } catch {
        // Pathfinder best effort
      }
    }

    if (this.bot.setControlState) {
      this.bot.setControlState('back', false);
      this.bot.setControlState('sprint', false);
    }

    return {
      success: true,
      message: `Executed tactical retreat to (${safePos.x.toFixed(1)}, ${safePos.z.toFixed(1)})`,
    };
  }
}
