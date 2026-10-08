import type { Vec3Location } from '../types.js';
import { getBlockDistanceToEye } from '../fairplay/reach.js';

export const HOSTILE_MOBS = new Set<string>([
  'zombie',
  'skeleton',
  'creeper',
  'spider',
  'cave_spider',
  'enderman',
  'witch',
  'phantom',
  'drowned',
  'husk',
  'stray',
  'slime',
  'magma_cube',
  'zombified_piglin',
  'pillager',
  'vindicator',
  'evoker',
  'ravager',
  'warden',
  'wither_skeleton',
]);

export function isHostileMob(entityName: string): boolean {
  const name = entityName.toLowerCase();
  for (const hostile of HOSTILE_MOBS) {
    if (name.includes(hostile)) return true;
  }
  return false;
}

export interface AutoSleepOptions {
  searchRadius?: number; // default: 24
  checkIntervalMs?: number; // default: 5000
}

export class AutoSleepLoop {
  private running = false;
  private isSleeping = false;
  private timer: NodeJS.Timeout | null = null;
  public searchRadius: number;
  public checkIntervalMs: number;

  constructor(private bot: any, options: AutoSleepOptions = {}) {
    this.searchRadius = options.searchRadius ?? 24;
    this.checkIntervalMs = options.checkIntervalMs ?? 5000;

    if (this.bot.on) {
      this.bot.on('wake', () => {
        this.isSleeping = false;
      });
      this.bot.on('entityHurt', (entity: any) => {
        if (entity && entity.id === this.bot.entity?.id && this.isSleeping) {
          this.wakeUp().catch(() => {});
        }
      });
    }
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      this.checkAndSleep().catch(() => {});
    }, this.checkIntervalMs);
  }

  public stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public canSleepNow(): boolean {
    // 1. Dimension Safety: Bed explosions occur in the Nether or the End!
    const dimension = this.bot.game?.dimension || 'overworld';
    if (dimension !== 'overworld') {
      return false;
    }

    // 2. Thunderstorm check: Can sleep anytime during thunderstorm
    if (this.bot.thunderState && this.bot.thunderState > 0) {
      return true;
    }
    if (this.bot.isRaining && this.bot.thunderState > 0) {
      return true;
    }

    // 3. Time check: Vanilla sleep window 12541 - 23458
    const timeOfDay = this.bot.time?.timeOfDay ?? 6000;
    if (timeOfDay >= 12541 && timeOfDay <= 23458) {
      return true;
    }

    return false;
  }

  public isMonsterNearby(bedPos: Vec3Location): boolean {
    if (!this.bot.entities) return false;

    for (const ent of Object.values(this.bot.entities) as any[]) {
      if (!ent || !ent.position || !ent.name) continue;
      if (!isHostileMob(ent.name)) continue;

      // Vanilla Monster Exclusion AABB: 8m horizontal (X, Z), 5m vertical (Y)
      const dx = Math.abs(ent.position.x - bedPos.x);
      const dz = Math.abs(ent.position.z - bedPos.z);
      const dy = Math.abs(ent.position.y - bedPos.y);

      if (dx <= 8.0 && dz <= 8.0 && dy <= 5.0) {
        return true;
      }
    }

    return false;
  }

  public findReachableBed(): any | null {
    if (this.bot.findBlock) {
      return this.bot.findBlock({
        matching: (block: any) => block.name.endsWith('_bed') && !block.occupied,
        maxDistance: this.searchRadius,
      });
    }

    if (this.bot.world?.getAllBlocks) {
      const botPos = this.bot.entity?.position;
      let closestBed: any | null = null;
      let closestDist = Infinity;

      for (const block of this.bot.world.getAllBlocks()) {
        if (!block.name.endsWith('_bed') || block.occupied) continue;
        const dx = botPos.x - block.position.x;
        const dy = botPos.y - block.position.y;
        const dz = botPos.z - block.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist <= this.searchRadius && dist < closestDist) {
          closestDist = dist;
          closestBed = block;
        }
      }
      return closestBed;
    }

    return null;
  }

  public async checkAndSleep(): Promise<boolean> {
    if (this.isSleeping || !this.canSleepNow()) {
      return false;
    }

    const bed = this.findReachableBed();
    if (!bed) return false;

    // Check monster exclusion
    if (this.isMonsterNearby(bed.position)) {
      return false; // Prevent spamming sleep when monsters are nearby
    }

    const eye = {
      x: this.bot.entity.position.x,
      y: this.bot.entity.position.y + (this.bot.entity.eyeHeight ?? 1.62),
      z: this.bot.entity.position.z,
    };

    const dist = getBlockDistanceToEye(eye, bed.position);
    if (dist > 4.50 + 1e-4) {
      if (this.bot.pathfinder?.goto) {
        try {
          await this.bot.pathfinder.goto(bed.position);
        } catch {
          return false;
        }
      } else {
        return false;
      }
    }

    try {
      if (this.bot.sleep) {
        await this.bot.sleep(bed);
        this.isSleeping = true;
        return true;
      }
    } catch {
      return false;
    }

    return false;
  }

  public async wakeUp(): Promise<void> {
    if (this.isSleeping && this.bot.wake) {
      await this.bot.wake();
      this.isSleeping = false;
    }
  }
}
