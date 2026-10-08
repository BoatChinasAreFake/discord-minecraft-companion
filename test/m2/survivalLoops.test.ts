import { describe, it, expect, beforeEach } from 'vitest';
import { AutoEatLoop, FOOD_DATABASE } from '../../src/minecraft/loops/autoEat.js';
import { AutoSleepLoop, isHostileMob } from '../../src/minecraft/loops/autoSleep.js';
import { AutoEquipLoop, getMaterialTier, getBaseDefensePoints } from '../../src/minecraft/loops/autoEquip.js';
import { MockWorld, MockMineflayerBot } from '../mocks/mockMinecraft.js';

describe('Milestone 2: Automated Survival Loops', () => {
  let world: MockWorld;
  let bot: MockMineflayerBot;

  beforeEach(() => {
    world = new MockWorld();
    bot = new MockMineflayerBot(world, { x: 0, y: 64, z: 0 });
  });

  describe('Auto-Eat Loop (autoEat.ts)', () => {
    it('TC-EAT-1: Eats food when hunger drops to <= 14', async () => {
      bot.food = 14;
      bot.addItem({ name: 'cooked_beef', count: 5 });

      const autoEat = new AutoEatLoop(bot);
      expect(autoEat.shouldEat()).toBe(true);

      const ate = await autoEat.checkAndEat();
      expect(ate).toBe(true);
      expect(bot.food).toBeGreaterThan(14);
    });

    it('TC-EAT-2: Eats food when health < 20 and hunger <= 17 to enable natural regeneration', async () => {
      bot.health = 16.0;
      bot.food = 17;
      bot.addItem({ name: 'bread', count: 3 });

      const autoEat = new AutoEatLoop(bot);
      expect(autoEat.shouldEat()).toBe(true);

      const ate = await autoEat.checkAndEat();
      expect(ate).toBe(true);
      expect(bot.food).toBeGreaterThan(17);
    });

    it('TC-EAT-3: Does not eat when food = 18 and health = 20', async () => {
      bot.health = 20.0;
      bot.food = 18;
      bot.addItem({ name: 'bread', count: 3 });

      const autoEat = new AutoEatLoop(bot);
      expect(autoEat.shouldEat()).toBe(false);

      const ate = await autoEat.checkAndEat();
      expect(ate).toBe(false);
    });

    it('TC-EAT-4: Selects golden carrot over bread due to superior saturation score', () => {
      bot.food = 12;
      bot.addItem({ name: 'bread', count: 2 });
      bot.addItem({ name: 'golden_carrot', count: 2 });

      const autoEat = new AutoEatLoop(bot);
      const selected = autoEat.selectBestFood();
      expect(selected?.name).toBe('golden_carrot');
    });

    it('TC-EAT-5: Strictly blacklists harmful and poisonous foods', () => {
      bot.food = 10;
      bot.addItem({ name: 'pufferfish', count: 2 });
      bot.addItem({ name: 'spider_eye', count: 2 });
      bot.addItem({ name: 'poisonous_potato', count: 2 });

      const autoEat = new AutoEatLoop(bot);
      const selected = autoEat.selectBestFood();
      expect(selected).toBeNull();
    });

    it('TC-EAT-6: Rejects rotten flesh during normal hunger, but allows during starvation <= 6', () => {
      const autoEat = new AutoEatLoop(bot);
      bot.addItem({ name: 'rotten_flesh', count: 5 });

      // Normal hunger: 12
      bot.food = 12;
      expect(autoEat.selectBestFood()).toBeNull();

      // Critical starvation: 4
      bot.food = 4;
      expect(autoEat.selectBestFood()?.name).toBe('rotten_flesh');
    });

    it('TC-EAT-7: Pauses eating when hostile mob is in close combat proximity and health is safe', async () => {
      bot.food = 12;
      bot.health = 18.0;
      bot.addItem({ name: 'cooked_beef', count: 3 });
      // Place zombie at 2.5m
      bot.entities['201'] = { id: 201, name: 'zombie', position: { x: 2.0, y: 64, z: 0 } };

      const autoEat = new AutoEatLoop(bot);
      expect(autoEat.canSafelyEat()).toBe(false);

      const ate = await autoEat.checkAndEat();
      expect(ate).toBe(false);
    });

    it('TC-EAT-8: Restores previously equipped weapon after eating finishes', async () => {
      bot.food = 12;
      bot.heldItem = { name: 'diamond_sword', count: 1 };
      bot.addItem({ name: 'apple', count: 4 });

      const autoEat = new AutoEatLoop(bot);
      await autoEat.checkAndEat();

      expect(bot.heldItem?.name).toBe('diamond_sword');
    });
  });

  describe('Auto-Sleep Loop (autoSleep.ts)', () => {
    it('TC-SLP-1: Sleeps in nearby bed when night falls (time >= 12541)', async () => {
      bot.time = { timeOfDay: 13000, age: 5000 };
      world.setBlock({ x: 2, y: 64, z: 0 }, 'red_bed');

      const autoSleep = new AutoSleepLoop(bot);
      expect(autoSleep.canSleepNow()).toBe(true);

      const slept = await autoSleep.checkAndSleep();
      expect(slept).toBe(true);
      expect(bot.isSleeping).toBe(true);
    });

    it('TC-SLP-2: Allows sleeping during daytime if a thunderstorm is active', async () => {
      bot.time = { timeOfDay: 6000, age: 5000 }; // Midday
      bot.thunderState = 1; // Thunderstorm
      world.setBlock({ x: 2, y: 64, z: 0 }, 'white_bed');

      const autoSleep = new AutoSleepLoop(bot);
      expect(autoSleep.canSleepNow()).toBe(true);

      const slept = await autoSleep.checkAndSleep();
      expect(slept).toBe(true);
    });

    it('TC-SLP-3: Refuses sleeping in daytime without thunderstorm', () => {
      bot.time = { timeOfDay: 6000, age: 5000 };
      bot.thunderState = 0;
      world.setBlock({ x: 2, y: 64, z: 0 }, 'white_bed');

      const autoSleep = new AutoSleepLoop(bot);
      expect(autoSleep.canSleepNow()).toBe(false);
    });

    it('TC-SLP-4: Refuses sleeping in the Nether to prevent bed explosion', () => {
      bot.game.dimension = 'the_nether';
      bot.time = { timeOfDay: 14000, age: 5000 };
      world.setBlock({ x: 2, y: 64, z: 0 }, 'white_bed');

      const autoSleep = new AutoSleepLoop(bot);
      expect(autoSleep.canSleepNow()).toBe(false);
    });

    it('TC-SLP-5: Enforces vanilla 8m/5m monster exclusion check around bed', async () => {
      bot.time = { timeOfDay: 13000, age: 5000 };
      const bedPos = { x: 2, y: 64, z: 0 };
      world.setBlock(bedPos, 'white_bed');

      // Place skeleton at dx=4, dz=3, dy=1 from bed (within 8m horizontal, 5m vertical)
      bot.entities['301'] = { id: 301, name: 'skeleton', position: { x: 6, y: 65, z: 3 } };

      const autoSleep = new AutoSleepLoop(bot);
      expect(autoSleep.isMonsterNearby(bedPos)).toBe(true);

      const slept = await autoSleep.checkAndSleep();
      expect(slept).toBe(false);
      expect(bot.isSleeping).toBe(false);
    });

    it('TC-SLP-6: Passes exclusion check and sleeps when monster is > 8m away', async () => {
      bot.time = { timeOfDay: 13000, age: 5000 };
      const bedPos = { x: 2, y: 64, z: 0 };
      world.setBlock(bedPos, 'white_bed');

      // Place skeleton 15m away
      bot.entities['302'] = { id: 302, name: 'skeleton', position: { x: 17, y: 64, z: 0 } };

      const autoSleep = new AutoSleepLoop(bot);
      expect(autoSleep.isMonsterNearby(bedPos)).toBe(false);

      const slept = await autoSleep.checkAndSleep();
      expect(slept).toBe(true);
    });
  });

  describe('Auto-Equip Loop (autoEquip.ts)', () => {
    it('TC-EQP-1: Automatically equips armor pieces into empty slots', async () => {
      bot.addItem({ name: 'iron_helmet', count: 1 });
      bot.addItem({ name: 'iron_chestplate', count: 1 });
      bot.addItem({ name: 'iron_leggings', count: 1 });
      bot.addItem({ name: 'iron_boots', count: 1 });

      const autoEquip = new AutoEquipLoop(bot);
      await autoEquip.evaluateAndEquip();

      expect(bot.armor.head?.name).toBe('iron_helmet');
      expect(bot.armor.torso?.name).toBe('iron_chestplate');
      expect(bot.armor.legs?.name).toBe('iron_leggings');
      expect(bot.armor.feet?.name).toBe('iron_boots');
    });

    it('TC-EQP-2: Upgrades iron chestplate to diamond chestplate based on higher composite score', async () => {
      bot.armor.torso = { name: 'iron_chestplate', count: 1 };
      bot.addItem({ name: 'diamond_chestplate', count: 1 });

      const autoEquip = new AutoEquipLoop(bot);
      await autoEquip.evaluateAndEquip();

      expect(bot.armor.torso?.name).toBe('diamond_chestplate');
    });

    it('TC-EQP-3: Upgrades plain diamond chestplate to enchanted Protection IV diamond chestplate', async () => {
      bot.armor.torso = { name: 'diamond_chestplate', count: 1 };
      bot.addItem({
        name: 'diamond_chestplate',
        count: 1,
        enchantments: [{ name: 'protection', level: 4 }],
      });

      const autoEquip = new AutoEquipLoop(bot);
      await autoEquip.evaluateAndEquip();

      expect(bot.armor.torso?.enchantments?.[0]?.level).toBe(4);
    });

    it('TC-EQP-4: Upgrades diamond to netherite chestplate due to toughness and knockback resistance', async () => {
      bot.armor.torso = { name: 'diamond_chestplate', count: 1 };
      bot.addItem({ name: 'netherite_chestplate', count: 1 });

      const autoEquip = new AutoEquipLoop(bot);
      await autoEquip.evaluateAndEquip();

      expect(bot.armor.torso?.name).toBe('netherite_chestplate');
    });

    it('TC-EQP-5: Equips best weapon into main hand', async () => {
      bot.addItem({ name: 'stone_sword', count: 1 });
      bot.addItem({ name: 'diamond_sword', count: 1 });
      bot.addItem({ name: 'iron_sword', count: 1 });

      const autoEquip = new AutoEquipLoop(bot);
      await autoEquip.evaluateAndEquip();

      expect(bot.heldItem?.name).toBe('diamond_sword');
    });

    it('TC-EQP-6: Prioritizes totem of undying and shield into off-hand', async () => {
      bot.addItem({ name: 'torch', count: 16 });
      bot.addItem({ name: 'shield', count: 1 });

      const autoEquip = new AutoEquipLoop(bot);
      await autoEquip.evaluateAndEquip();
      expect(bot.offHandItem?.name).toBe('shield');

      // Now add totem of undying
      bot.addItem({ name: 'totem_of_undying', count: 1 });
      await autoEquip.evaluateAndEquip();
      expect(bot.offHandItem?.name).toBe('totem_of_undying');
    });

    it('TC-EQP-7: Anti-thrashing hysteresis prevents swapping near-identical gear', async () => {
      bot.armor.torso = { name: 'iron_chestplate', count: 1, defense: 6 };
      // Another iron chestplate with identical stats
      bot.addItem({ name: 'iron_chestplate', count: 1, defense: 6 });

      const autoEquip = new AutoEquipLoop(bot);
      let equippedCount = 0;
      bot.on('equip', (item: any, slot: string) => {
        if (slot === 'torso') equippedCount++;
      });

      await autoEquip.evaluateAndEquip();
      expect(equippedCount).toBe(0); // Did not flap / thrash
    });
  });
});
