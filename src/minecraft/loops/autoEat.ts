export interface FoodStats {
  foodPoints: number;
  saturation: number;
  status: 'SAFE' | 'CONDITIONAL' | 'BLACKLIST';
}

export const FOOD_DATABASE: Record<string, FoodStats> = {
  // Strict blacklist (Harmful / Poisonous)
  pufferfish: { foodPoints: 1, saturation: 0.2, status: 'BLACKLIST' },
  spider_eye: { foodPoints: 2, saturation: 3.2, status: 'BLACKLIST' },
  poisonous_potato: { foodPoints: 2, saturation: 1.2, status: 'BLACKLIST' },
  chorus_fruit: { foodPoints: 4, saturation: 2.4, status: 'BLACKLIST' },
  suspicious_stew: { foodPoints: 6, saturation: 7.2, status: 'BLACKLIST' },

  // Conditional (Only when starving <= 6)
  rotten_flesh: { foodPoints: 4, saturation: 0.8, status: 'CONDITIONAL' },
  raw_chicken: { foodPoints: 2, saturation: 1.2, status: 'CONDITIONAL' },

  // High tier (S & A Tier)
  golden_carrot: { foodPoints: 6, saturation: 14.4, status: 'SAFE' },
  cooked_beef: { foodPoints: 8, saturation: 12.8, status: 'SAFE' },
  cooked_porkchop: { foodPoints: 8, saturation: 12.8, status: 'SAFE' },
  golden_apple: { foodPoints: 4, saturation: 9.6, status: 'SAFE' },
  enchanted_golden_apple: { foodPoints: 4, saturation: 9.6, status: 'SAFE' },
  cooked_mutton: { foodPoints: 6, saturation: 9.6, status: 'SAFE' },
  cooked_salmon: { foodPoints: 6, saturation: 9.6, status: 'SAFE' },

  // Mid tier (B Tier)
  bread: { foodPoints: 5, saturation: 6.0, status: 'SAFE' },
  baked_potato: { foodPoints: 5, saturation: 6.0, status: 'SAFE' },
  cooked_cod: { foodPoints: 5, saturation: 6.0, status: 'SAFE' },
  cooked_chicken: { foodPoints: 6, saturation: 7.2, status: 'SAFE' },

  // Low tier (C Tier)
  apple: { foodPoints: 4, saturation: 2.4, status: 'SAFE' },
  carrot: { foodPoints: 3, saturation: 3.6, status: 'SAFE' },
  melon_slice: { foodPoints: 2, saturation: 1.2, status: 'SAFE' },
  sweet_berries: { foodPoints: 2, saturation: 0.4, status: 'SAFE' },
  cookie: { foodPoints: 2, saturation: 0.4, status: 'SAFE' },
};

export interface AutoEatOptions {
  minFoodThreshold?: number; // default: 14
  healthRegenFoodThreshold?: number; // default: 17
  starveThreshold?: number; // default: 6
  checkIntervalMs?: number; // default: 2000
}

export class AutoEatLoop {
  private running = false;
  private isEating = false;
  private lastEatTime = 0;
  private timer: NodeJS.Timeout | null = null;

  public minFoodThreshold: number;
  public healthRegenFoodThreshold: number;
  public starveThreshold: number;
  public checkIntervalMs: number;

  constructor(private bot: any, options: AutoEatOptions = {}) {
    this.minFoodThreshold = options.minFoodThreshold ?? 14;
    this.healthRegenFoodThreshold = options.healthRegenFoodThreshold ?? 17;
    this.starveThreshold = options.starveThreshold ?? 6;
    this.checkIntervalMs = options.checkIntervalMs ?? 2000;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      this.checkAndEat().catch(() => {});
    }, this.checkIntervalMs);
  }

  public stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public shouldEat(): boolean {
    const food = this.bot.food ?? 20;
    const health = this.bot.health ?? 20;

    // 1. Critical starvation: food <= 6
    if (food <= this.starveThreshold) return true;

    // 2. Regular hunger: food <= 14
    if (food <= this.minFoodThreshold) return true;

    // 3. Regeneration trigger: damaged (health < 20) and food <= 17
    if (health < 20 && food <= this.healthRegenFoodThreshold) return true;

    return false;
  }

  public selectBestFood(): any | null {
    const items = this.bot.inventory?.items ? this.bot.inventory.items() : [];
    const food = this.bot.food ?? 20;
    const health = this.bot.health ?? 20;
    const deltaFood = 20 - food;

    let bestItem: any | null = null;
    let bestScore = -Infinity;

    for (const item of items) {
      if (!item) continue;
      const stats = FOOD_DATABASE[item.name];
      if (!stats) continue;

      // Strict blacklist rejection
      if (stats.status === 'BLACKLIST') continue;

      // Conditional items: only permitted if starving (food <= starveThreshold)
      if (stats.status === 'CONDITIONAL' && food > this.starveThreshold) continue;

      // Compute score
      const satWeight = health < 14 ? 2.2 : 1.5;
      const wastePenalty = health >= 20 ? Math.max(0, stats.foodPoints - deltaFood) * 0.5 : 0;
      let score = satWeight * stats.saturation + stats.foodPoints - wastePenalty;

      // Golden apple emergency health bonus
      if (item.name === 'golden_apple' && health <= 10) {
        score += 50;
      } else if (item.name === 'enchanted_golden_apple' && health <= 6) {
        score += 100;
      }

      if (score > bestScore) {
        bestScore = score;
        bestItem = item;
      }
    }

    return bestItem;
  }

  public canSafelyEat(): boolean {
    // Check if hostile mobs are dangerously close (< 4.0m) while health is not critical
    const health = this.bot.health ?? 20;
    const botPos = this.bot.entity?.position;
    if (!botPos || !this.bot.entities) return true;

    if (health > 8.0) {
      for (const ent of Object.values(this.bot.entities) as any[]) {
        if (!ent || !ent.position || ent.id === this.bot.entity.id) continue;
        const dx = botPos.x - ent.position.x;
        const dz = botPos.z - ent.position.z;
        const distSq = dx * dx + dz * dz;
        // Hostile mob inside 4.0m
        const isHostile = ent.name?.match(/(zombie|skeleton|creeper|spider|enderman)/i);
        if (isHostile && distSq <= 16.0) {
          return false; // Defer eating for combat safety
        }
      }
    }

    return true;
  }

  public async checkAndEat(): Promise<boolean> {
    if (this.isEating || !this.shouldEat()) return false;

    // Anti-thrashing debounce: 500ms
    if (Date.now() - this.lastEatTime < 500) return false;

    if (!this.canSafelyEat()) return false;

    const foodItem = this.selectBestFood();
    if (!foodItem) return false;

    this.isEating = true;
    const previousHeld = this.bot.heldItem;

    try {
      if (this.bot.equip) {
        await this.bot.equip(foodItem, 'hand');
      }
      if (this.bot.consume) {
        await this.bot.consume();
      }
      this.lastEatTime = Date.now();
      return true;
    } finally {
      this.isEating = false;
      // Restore previously held item if available
      if (previousHeld && this.bot.equip) {
        try {
          await this.bot.equip(previousHeld, 'hand');
        } catch {
          // Best effort restore
        }
      }
    }
  }
}
