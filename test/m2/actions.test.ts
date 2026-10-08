import { describe, it, expect, beforeEach } from 'vitest';
import { PathfinderAction, createSafeMovements, HAZARDOUS_BLOCKS } from '../../src/minecraft/actions/pathfinding.js';
import { MiningAction, canSafelyHarvest, getHarvestRequirement } from '../../src/minecraft/actions/mining.js';
import { InventoryAction, getInventoryStatus, countItem } from '../../src/minecraft/actions/inventory.js';
import { CraftingAction, decomposeRecipe, is2x2Recipe, is3x3Recipe } from '../../src/minecraft/actions/crafting.js';
import { CombatAction, CombatCooldownController } from '../../src/minecraft/actions/combat.js';
import { MockWorld, MockMineflayerBot } from '../mocks/mockMinecraft.js';

describe('Milestone 2: Actions Subsystems', () => {
  let world: MockWorld;
  let bot: MockMineflayerBot;

  beforeEach(() => {
    world = new MockWorld();
    bot = new MockMineflayerBot(world, { x: 0, y: 64, z: 0 });
  });

  describe('Pathfinder Navigation (pathfinding.ts)', () => {
    it('TC-NAV-1: Movements configuration enforces safe survival boundaries', () => {
      const movements = createSafeMovements(bot);
      expect(movements.maxDropDown).toBe(3);
      expect(movements.allowParkour).toBe(false);
      expect(movements.allow1by1towers).toBe(false);
      expect(movements.canDig).toBe(false);
      expect(movements.dontCreateFlow).toBe(true);
      expect(movements.dontMineUnderFallingBlock).toBe(true);
      expect(movements.blocksToAvoid.has('lava')).toBe(true);
      expect(movements.blocksToAvoid.has('fire')).toBe(true);
      expect(movements.blocksToAvoid.has('magma_block')).toBe(true);
    });

    it('TC-NAV-2: Step exclusion dynamically penalizes steps adjacent to lava/fire', () => {
      const movements = createSafeMovements(bot);
      const stepPenaltyFn = movements.exclusionAreasStep[0];

      // Block with lava neighbor
      world.setBlock({ x: 5, y: 64, z: 0 }, 'stone');
      world.setBlock({ x: 6, y: 64, z: 0 }, 'lava');

      const penalty = stepPenaltyFn({ position: { x: 5, y: 64, z: 0 } });
      expect(penalty).toBe(150); // Heavy aversion penalty
    });

    it('TC-NAV-3: Navigation reaches target destination coordinates', async () => {
      const pathfinder = new PathfinderAction(bot);
      const result = await pathfinder.navigateTo({ x: 10, y: 64, z: 10 });
      expect(result.success).toBe(true);
      expect(bot.entity.position.x).toBe(10);
      expect(bot.entity.position.z).toBe(10);
    });
  });

  describe('Mining & Harvest Tiers (mining.ts)', () => {
    it('TC-MIN-1: Stone pickaxe allows harvesting stone and iron ore, but rejects diamond ore', () => {
      const stonePick = { name: 'stone_pickaxe', count: 1 };
      const inventory = [stonePick];

      const stoneCheck = canSafelyHarvest('stone', inventory);
      expect(stoneCheck.canHarvest).toBe(true);
      expect(stoneCheck.toolToEquip?.name).toBe('stone_pickaxe');

      const ironCheck = canSafelyHarvest('iron_ore', inventory);
      expect(ironCheck.canHarvest).toBe(true);

      const diamondCheck = canSafelyHarvest('diamond_ore', inventory);
      expect(diamondCheck.canHarvest).toBe(false);
      expect(diamondCheck.reason).toContain('requires a pickaxe of tier >= iron');
    });

    it('TC-MIN-2: Iron pickaxe allows harvesting diamond ore', () => {
      const ironPick = { name: 'iron_pickaxe', count: 1 };
      const check = canSafelyHarvest('diamond_ore', [ironPick]);
      expect(check.canHarvest).toBe(true);
      expect(check.toolToEquip?.name).toBe('iron_pickaxe');
    });

    it('TC-MIN-3: Rejects mining distant block beyond 4.50m reach', async () => {
      const mining = new MiningAction(bot);
      world.setBlock({ x: 10, y: 64, z: 0 }, 'stone');

      const result = await mining.mineBlock({ x: 10, y: 64, z: 0 });
      expect(result.success).toBe(false);
      expect(result.message).toContain('out of reach');
    });

    it('TC-MIN-4: Rejects mining block occluded by solid stone wall', async () => {
      const mining = new MiningAction(bot);
      const targetPos = { x: 3, y: 64, z: 0 };
      world.setBlock(targetPos, 'diamond_ore');
      // 2-block high wall blocking eye level and ground level
      world.setBlock({ x: 1, y: 64, z: 0 }, 'stone');
      world.setBlock({ x: 1, y: 65, z: 0 }, 'stone');
      bot.addItem({ name: 'iron_pickaxe', count: 1 });

      const result = await mining.mineBlock(targetPos);
      expect(result.success).toBe(false);
      expect(result.message).toContain('no visible line of sight');
    });

    it('TC-MIN-5: Damage interrupt guard aborts active digging when bot is hurt', async () => {
      const mining = new MiningAction(bot);
      const targetPos = { x: 2, y: 64, z: 0 };
      world.setBlock(targetPos, 'stone');
      bot.addItem({ name: 'wooden_pickaxe', count: 1 });

      // Override dig to be asynchronous and simulate damage mid-dig
      bot.dig = async () => {
        return new Promise<void>((resolve, reject) => {
          setTimeout(() => {
            // Emit damage on bot
            bot.emit('entityHurt', { id: bot.entity.id });
          }, 20);
        });
      };

      const result = await mining.mineBlock(targetPos);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Mining interrupted: agent took damage');
    });
  });

  describe('Inventory & Crafting (inventory.ts, crafting.ts)', () => {
    it('TC-CRF-1: Distinguishes 2x2 grid recipes from 3x3 table recipes', () => {
      expect(is2x2Recipe('oak_planks')).toBe(true);
      expect(is2x2Recipe('stick')).toBe(true);
      expect(is2x2Recipe('crafting_table')).toBe(true);
      expect(is2x2Recipe('torch')).toBe(true);

      expect(is3x3Recipe('wooden_pickaxe')).toBe(true);
      expect(is3x3Recipe('diamond_sword')).toBe(true);
      expect(is3x3Recipe('chest')).toBe(true);
    });

    it('TC-CRF-2: Recursively decomposes wooden_pickaxe into base logs and topological craft steps', () => {
      const currentInventory = new Map<string, number>([['oak_log', 3]]);
      const decomp = decomposeRecipe('wooden_pickaxe', 1, currentInventory);

      expect(decomp.canCraft).toBe(true);
      expect(decomp.missingRawMaterials).toHaveLength(0);
      expect(decomp.executionPlan.length).toBeGreaterThan(0);

      // Verify topological order: planks first, then sticks, then wooden_pickaxe
      const planNames = decomp.executionPlan.map((s) => s.outputItem);
      expect(planNames).toContain('oak_planks');
      expect(planNames).toContain('stick');
      expect(planNames).toContain('wooden_pickaxe');
      expect(planNames.indexOf('oak_planks')).toBeLessThan(planNames.indexOf('stick'));
      expect(planNames.indexOf('stick')).toBeLessThan(planNames.indexOf('wooden_pickaxe'));
    });

    it('TC-CRF-3: Correctly identifies missing raw resources when materials are insufficient', () => {
      const currentInventory = new Map<string, number>([['oak_log', 0]]);
      const decomp = decomposeRecipe('wooden_pickaxe', 1, currentInventory);

      expect(decomp.canCraft).toBe(false);
      expect(decomp.missingRawMaterials.length).toBeGreaterThan(0);
      const missingLog = decomp.missingRawMaterials.find((m) => m.item === 'oak_log');
      expect(missingLog).toBeDefined();
    });

    it('TC-INV-1: Inventory overview tracks slots, armor, and offhand items accurately', () => {
      bot.addItem({ name: 'iron_ingot', count: 5 });
      bot.addItem({ name: 'diamond', count: 3 });
      bot.equip({ name: 'diamond_chestplate', count: 1 }, 'torso');
      bot.equip({ name: 'shield', count: 1 }, 'off-hand');

      const inv = new InventoryAction(bot);
      const overview = inv.getOverview();

      expect(overview.totalSlots).toBe(36);
      expect(overview.usedSlots).toBeGreaterThanOrEqual(2);
      expect(overview.armor.torso).toBe('diamond_chestplate');
      expect(overview.offHandItem).toBe('shield');
    });

    it('TC-INV-2: Container deposit and withdraw transactions enforce reach checks', async () => {
      const inv = new InventoryAction(bot);
      const containerPos = { x: 2, y: 64, z: 0 };
      world.setBlock(containerPos, 'chest');
      bot.addItem({ name: 'gold_ingot', count: 10 });

      // Deposit 4 gold ingots
      const depositResult = await inv.depositItem(containerPos, 'gold_ingot', 4);
      expect(depositResult.success).toBe(true);

      // Withdraw 2 gold ingots
      const withdrawResult = await inv.withdrawItem(containerPos, 'gold_ingot', 2);
      expect(withdrawResult.success).toBe(true);
    });
  });

  describe('Combat & Weapon Cooldown (combat.ts)', () => {
    it('TC-CBT-1: Combat cooldown controller returns accurate period per weapon type', () => {
      const cooldown = new CombatCooldownController();
      expect(cooldown.getCooldownPeriodMs('diamond_sword')).toBe(625);
      expect(cooldown.getCooldownPeriodMs('iron_axe')).toBe(1111);
      expect(cooldown.getCooldownPeriodMs('diamond_pickaxe')).toBe(833);
      expect(cooldown.getCooldownPeriodMs(undefined)).toBe(250); // hand
    });

    it('TC-CBT-2: Enforces entity attack reach <= 3.50m', async () => {
      const combat = new CombatAction(bot);
      bot.entities['101'] = { id: 101, position: { x: 5, y: 64, z: 0 }, health: 20 };

      const result = await combat.attackEntity(101);
      expect(result.success).toBe(false);
      expect(result.message).toContain('out of attack reach');
    });

    it('TC-CBT-3: Successful melee attack against reachable entity', async () => {
      const combat = new CombatAction(bot);
      bot.entities['102'] = { id: 102, position: { x: 2.5, y: 64, z: 0 }, health: 20 };
      bot.heldItem = { name: 'diamond_sword', count: 1 };

      const result = await combat.attackEntity(102);
      expect(result.success).toBe(true);
      expect(result.message).toContain('Successfully attacked entity 102');
      expect(bot.entities['102'].health).toBeLessThan(20);
    });

    it('TC-CBT-4: Tactical retreat triggers when bot health drops below 6.0 HP', async () => {
      const combat = new CombatAction(bot);
      bot.health = 5.0; // Critical health (< 6 HP)
      bot.entities['103'] = { id: 103, position: { x: 2.0, y: 64, z: 0 }, health: 20, name: 'zombie' };

      const result = await combat.attackEntity(103);
      expect(result.success).toBe(false);
      expect(result.message).toContain('health below 6 HP, executed tactical retreat');
    });
  });
});
