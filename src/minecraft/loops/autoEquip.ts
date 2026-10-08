export type ArmorSlot = 'head' | 'torso' | 'legs' | 'feet';

export const MATERIAL_TIERS: Record<string, number> = {
  netherite: 6,
  diamond: 5,
  iron: 4,
  chainmail: 3,
  golden: 2,
  gold: 2,
  leather: 1,
  turtle: 2,
};

export function getMaterialTier(itemName: string): number {
  const lower = itemName.toLowerCase();
  for (const [mat, tier] of Object.entries(MATERIAL_TIERS)) {
    if (lower.includes(mat)) return tier;
  }
  return 0;
}

export function getArmorSlot(itemName: string): ArmorSlot | null {
  const lower = itemName.toLowerCase();
  if (lower.includes('helmet') || lower.includes('turtle_shell')) return 'head';
  if (lower.includes('chestplate') || lower.includes('elytra') || lower.includes('tunic')) return 'torso';
  if (lower.includes('leggings') || lower.includes('pants')) return 'legs';
  if (lower.includes('boots')) return 'feet';
  return null;
}

export function getBaseDefensePoints(itemName: string): number {
  const lower = itemName.toLowerCase();
  const slot = getArmorSlot(itemName);

  if (slot === 'head') {
    if (lower.includes('netherite') || lower.includes('diamond')) return 3;
    if (lower.includes('iron') || lower.includes('chainmail') || lower.includes('golden') || lower.includes('turtle')) return 2;
    return 1;
  }
  if (slot === 'torso') {
    if (lower.includes('netherite') || lower.includes('diamond')) return 8;
    if (lower.includes('iron')) return 6;
    if (lower.includes('chainmail') || lower.includes('golden')) return 5;
    return 3;
  }
  if (slot === 'legs') {
    if (lower.includes('netherite') || lower.includes('diamond')) return 6;
    if (lower.includes('iron')) return 5;
    if (lower.includes('chainmail')) return 4;
    if (lower.includes('golden')) return 3;
    return 2;
  }
  if (slot === 'feet') {
    if (lower.includes('netherite') || lower.includes('diamond')) return 3;
    if (lower.includes('iron')) return 2;
    return 1;
  }
  return 0;
}

export function getBaseWeaponDamage(itemName: string): number {
  const lower = itemName.toLowerCase();
  if (lower.includes('sword')) {
    if (lower.includes('netherite')) return 8;
    if (lower.includes('diamond')) return 7;
    if (lower.includes('iron')) return 6;
    if (lower.includes('stone')) return 5;
    return 4; // wooden / gold
  }
  if (lower.includes('axe')) {
    if (lower.includes('netherite') || lower.includes('diamond')) return 9;
    if (lower.includes('iron')) return 9;
    if (lower.includes('stone') || lower.includes('wooden')) return 7;
    return 7;
  }
  return 1;
}

export interface AutoEquipOptions {
  checkIntervalMs?: number; // default: 2000
  enableWeapons?: boolean;  // default: true
  enableShield?: boolean;   // default: true
}

export class AutoEquipLoop {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  public checkIntervalMs: number;
  public enableWeapons: boolean;
  public enableShield: boolean;

  constructor(private bot: any, options: AutoEquipOptions = {}) {
    this.checkIntervalMs = options.checkIntervalMs ?? 2000;
    this.enableWeapons = options.enableWeapons ?? true;
    this.enableShield = options.enableShield ?? true;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      this.evaluateAndEquip().catch(() => {});
    }, this.checkIntervalMs);
  }

  public stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public calculateArmorScore(item: any): number {
    if (!item || !item.name) return 0;
    const tier = getMaterialTier(item.name);
    const def = item.defense ?? getBaseDefensePoints(item.name);
    const toughness = item.toughness ?? (tier === 6 ? 3 : tier === 5 ? 2 : 0);
    const knockback = item.knockbackResistance ?? (tier === 6 ? 1 : 0);

    let protLevel = 0;
    let otherEnchantScore = 0;

    if (item.enchantments && Array.isArray(item.enchantments)) {
      for (const ench of item.enchantments) {
        if (ench.name === 'protection') {
          protLevel += ench.level;
        } else {
          otherEnchantScore += ench.level * 2;
        }
      }
    }

    const durabilityRatio =
      item.maxDurability && item.durabilityUsed !== undefined
        ? 1.0 - item.durabilityUsed / item.maxDurability
        : 1.0;

    return (
      tier * 25 +
      def * 10 +
      toughness * 8 +
      knockback * 5 +
      protLevel * 6 +
      otherEnchantScore +
      durabilityRatio * 2
    );
  }

  public calculateWeaponScore(item: any): number {
    if (!item || !item.name) return 0;
    const tier = getMaterialTier(item.name);
    const baseDamage = getBaseWeaponDamage(item.name);

    let sharpness = 0;
    let fireAspect = 0;

    if (item.enchantments && Array.isArray(item.enchantments)) {
      for (const ench of item.enchantments) {
        if (ench.name === 'sharpness') sharpness += ench.level;
        if (ench.name === 'fire_aspect') fireAspect += ench.level;
      }
    }

    return baseDamage * 10 + sharpness * 6 + fireAspect * 3 + tier * 2;
  }

  public calculateOffHandScore(item: any): number {
    if (!item || !item.name) return 0;
    if (item.name === 'totem_of_undying') return 100;
    if (item.name === 'shield') return 80;
    return 10;
  }

  public async evaluateAndEquip(): Promise<void> {
    const items = this.bot.inventory?.items ? this.bot.inventory.items() : [];
    const hysteresis = 1.0; // Prevent oscillation on trivial score differences

    // 1. Evaluate Armor slots (head, torso, legs, feet)
    const armorSlots: ArmorSlot[] = ['head', 'torso', 'legs', 'feet'];

    for (const slot of armorSlots) {
      const currentItem =
        this.bot.armor?.[slot] ||
        (slot === 'head' ? this.bot.inventory?.slots?.[5] :
         slot === 'torso' ? this.bot.inventory?.slots?.[6] :
         slot === 'legs' ? this.bot.inventory?.slots?.[7] :
         this.bot.inventory?.slots?.[8]);

      const currentScore = currentItem ? this.calculateArmorScore(currentItem) : 0;

      // Find candidates for this slot
      const candidates = items.filter((i: any) => i && getArmorSlot(i.name) === slot);
      if (candidates.length === 0) continue;

      let bestCandidate = candidates[0];
      let bestScore = this.calculateArmorScore(bestCandidate);

      for (let i = 1; i < candidates.length; i++) {
        const sc = this.calculateArmorScore(candidates[i]);
        if (sc > bestScore) {
          bestScore = sc;
          bestCandidate = candidates[i];
        }
      }

      if (!currentItem || bestScore > currentScore + hysteresis) {
        if (this.bot.equip) {
          await this.bot.equip(bestCandidate, slot);
        }
      }
    }

    // 2. Evaluate Weapon slot (mainHand)
    if (this.enableWeapons) {
      const currentWeapon = this.bot.heldItem;
      const currentWeaponScore = currentWeapon ? this.calculateWeaponScore(currentWeapon) : 0;

      const weapons = items.filter(
        (i: any) => i && (i.name.includes('sword') || i.name.includes('axe'))
      );

      if (weapons.length > 0) {
        let bestWeapon = weapons[0];
        let bestScore = this.calculateWeaponScore(bestWeapon);

        for (let i = 1; i < weapons.length; i++) {
          const sc = this.calculateWeaponScore(weapons[i]);
          if (sc > bestScore) {
            bestScore = sc;
            bestWeapon = weapons[i];
          }
        }

        if (!currentWeapon || bestScore > currentWeaponScore + hysteresis) {
          if (this.bot.equip) {
            await this.bot.equip(bestWeapon, 'hand');
          }
        }
      }
    }

    // 3. Evaluate OffHand slot (shield, totem)
    if (this.enableShield) {
      const currentOffHand = this.bot.offHandItem || this.bot.inventory?.slots?.[45];
      const currentScore = currentOffHand ? this.calculateOffHandScore(currentOffHand) : 0;

      const offHandCandidates = items.filter(
        (i: any) => i && (i.name === 'totem_of_undying' || i.name === 'shield')
      );

      if (offHandCandidates.length > 0) {
        let bestItem = offHandCandidates[0];
        let bestScore = this.calculateOffHandScore(bestItem);

        for (let i = 1; i < offHandCandidates.length; i++) {
          const sc = this.calculateOffHandScore(offHandCandidates[i]);
          if (sc > bestScore) {
            bestScore = sc;
            bestItem = offHandCandidates[i];
          }
        }

        if (!currentOffHand || bestScore > currentScore + hysteresis) {
          if (this.bot.equip) {
            await this.bot.equip(bestItem, 'off-hand');
          }
        }
      }
    }
  }
}
