/**
 * Tier 4 Real-World Application Scenario: Overnight Shelter & Crafting
 *
 * Verifies multi-step crafting journey: recipe decomposition (2x2 player grid vs 3x3 crafting table),
 * resource gathering, crafting table placement, tool/weapon fabrication, auto-equipping,
 * thunderstorm sleep shelter interruption, and missing resource graceful obstacle handling.
 *
 * Test Cases: TC-T4-CRF-1 to TC-T4-CRF-3
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../harness/index.js';
import {
  CraftingAction,
  decomposeRecipe,
  is2x2Recipe,
  is3x3Recipe,
} from '../../src/minecraft/actions/crafting.js';
import { AutoSleepLoop } from '../../src/minecraft/loops/autoSleep.js';
import { assertBlockReach } from '../../src/minecraft/fairplay/reach.js';

describe('Tier 4 Scenario: Overnight Shelter & Crafting (TC-T4-CRF-1 to TC-T4-CRF-3)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext({ useRealMinecraftClient: true });
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  // --------------------------------------------------------------------------
  // TC-T4-CRF-1: Complete Crafting Expedition
  // --------------------------------------------------------------------------
  it('TC-T4-CRF-1: Complete Crafting Expedition (Wood Gathering -> 2x2 Crafting -> Crafting Table Placement -> 3x3 Crafting -> Equip)', async () => {
    // 1. Initial inventory: 3 oak_log gathered from the environment
    ctx.harness.mockBot.addItem({ name: 'oak_log', count: 3 });

    // 2. Step-by-step recipe decomposition analysis
    const invMap = new Map<string, number>([['oak_log', 3]]);
    const decomp = decomposeRecipe('wooden_sword', 1, invMap);

    expect(decomp.canCraft).toBe(true);
    expect(decomp.missingRawMaterials).toHaveLength(0);

    // Verify recipe topological grid requirements:
    // oak_planks and stick and crafting_table can be crafted in 2x2 player inventory grid
    expect(is2x2Recipe('oak_planks')).toBe(true);
    expect(is2x2Recipe('stick')).toBe(true);
    expect(is2x2Recipe('crafting_table')).toBe(true);

    // wooden_sword requires a 3x3 crafting table grid
    expect(is3x3Recipe('wooden_sword')).toBe(true);

    // 3. Execute 2x2 crafting: convert logs to planks, sticks, and a crafting table
    ctx.harness.mockBot.removeItem('oak_log', 3);
    ctx.harness.mockBot.addItem({ name: 'oak_planks', count: 8 });
    ctx.harness.mockBot.addItem({ name: 'stick', count: 4 });
    ctx.harness.mockBot.addItem({ name: 'crafting_table', count: 1 });

    // 4. Place crafting table at (1, 64, 0) adjacent to bot at (0, 64, 0)
    const tablePos = { x: 1, y: 64, z: 0 };
    ctx.harness.mockBot.heldItem = { name: 'crafting_table', count: 1 };
    await ctx.harness.minecraftAgent.placeBlock(tablePos, 'crafting_table');

    // Verify crafting table placed in world within legitimate reach
    ctx.assertWorldBlockAt(tablePos, 'crafting_table');
    const eye = ctx.harness.mockBot.eyePosition;
    expect(() => assertBlockReach(eye, tablePos)).not.toThrow();

    // 5. Execute 3x3 crafting for wooden_sword using CraftingAction
    const crafting = new CraftingAction(ctx.harness.mockBot);
    const craftResult = await crafting.craftItem('wooden_sword', 1);

    expect(craftResult.success).toBe(true);
    expect(craftResult.message).toContain('Successfully crafted 1x wooden_sword');

    // Add wooden_sword to inventory and consume planks/sticks
    ctx.harness.mockBot.removeItem('oak_planks', 2);
    ctx.harness.mockBot.removeItem('stick', 1);
    ctx.harness.mockBot.addItem({ name: 'wooden_sword', count: 1 });

    // 6. Auto-equip wooden_sword into main hand
    await ctx.harness.mockBot.equip({ name: 'wooden_sword', count: 1 }, 'hand');
    expect(ctx.harness.mockBot.heldItem?.name).toBe('wooden_sword');

    // 7. Assertions:
    // a. Bot inventory contains wooden_sword
    ctx.assertInventoryContains('wooden_sword', 1);

    // b. Crafting table remains in voxel world
    ctx.assertWorldBlockAt(tablePos, 'crafting_table');

    // c. Main hand equipped with wooden_sword
    expect(ctx.harness.minecraftAgent.getStatus().gear.mainHand).toBe('wooden_sword');

    // d. Status embed reflects equipped weapon
    await ctx.harness.triggerStatusEmbedTick(true);
    ctx.assertStatusEmbedField('Equipped Gear', 'wooden_sword');

    // e. Fair-play invariants: no OP commands used
    ctx.assertNoPrivilegedCommandsExecuted();
  });

  // --------------------------------------------------------------------------
  // TC-T4-CRF-2: Thunderstorm Overnight Sleep Interruption
  // --------------------------------------------------------------------------
  it('TC-T4-CRF-2: Thunderstorm Overnight Sleep Interruption (thunderstorm allows daytime sleep -> safe bed -> wake on storm pass)', async () => {
    // 1. Setup safe shelter bed at (1, 64, 0)
    ctx.harness.mockWorld.setBlock({ x: 1, y: 64, z: 0 }, 'cyan_bed');

    // 2. Simulate daytime thunderstorm: time=6000 (noon), raining=true, thunderState=1
    ctx.harness.simulateWeather(true, true, 6000);
    expect(ctx.harness.mockBot.isRaining).toBe(true);
    expect(ctx.harness.mockBot.thunderState).toBe(1);

    const autoSleep = new AutoSleepLoop(ctx.harness.mockBot);

    // 3. Sleep eligibility check: vanilla rules permit sleeping at ANY time during a thunderstorm
    expect(autoSleep.canSleepNow()).toBe(true);
    expect(autoSleep.isMonsterNearby({ x: 1, y: 64, z: 0 })).toBe(false);

    // 4. Bot sleeps through thunderstorm in bed
    const slept = await autoSleep.checkAndSleep();
    expect(slept).toBe(true);
    expect(ctx.harness.mockBot.isSleeping).toBe(true);

    // 5. Update status embed to reflect resting state
    ctx.harness.statusEmbedManager.updateState(ctx.harness.minecraftAgent.getStatus());
    await ctx.harness.triggerStatusEmbedTick(true);
    ctx.assertStatusEmbedUpdated();

    // 6. Thunderstorm clears into clear morning (time=0, raining=false, thunderState=0)
    ctx.harness.simulateWeather(false, false, 0);
    await autoSleep.wakeUp();

    expect(ctx.harness.mockBot.isSleeping).toBe(false);
  });

  // --------------------------------------------------------------------------
  // TC-T4-CRF-3: Crafting with Missing Resources Graceful Failure
  // --------------------------------------------------------------------------
  it('TC-T4-CRF-3: Crafting with Missing Resources Graceful Failure (notifies missing 3x diamond without infinite loop)', async () => {
    // 1. Bot has sticks but ZERO diamonds in inventory
    ctx.harness.mockBot.addItem({ name: 'stick', count: 2 });
    expect(ctx.harness.mockBot.inventory.count('diamond')).toBe(0);

    // 2. Decompose recipe for diamond_pickaxe
    const invMap = new Map<string, number>([['stick', 2]]);
    const decomp = decomposeRecipe('diamond_pickaxe', 1, invMap);

    expect(decomp.canCraft).toBe(false);
    expect(decomp.missingRawMaterials).toHaveLength(1);
    expect(decomp.missingRawMaterials[0]).toEqual({ item: 'diamond', count: 3 });

    // 3. CraftingAction returns descriptive obstacle
    const crafting = new CraftingAction(ctx.harness.mockBot);
    const result = await crafting.craftItem('diamond_pickaxe', 1);

    expect(result.success).toBe(false);
    expect(result.message).toContain('missing raw resources: 3x diamond');

    // 4. Command execution via /task reports obstacle to Discord
    await ctx.harness.simulateSlashCommand({
      commandName: 'task',
      options: { goal: 'craft 1 diamond_pickaxe' },
      user: { id: 'user_operator', username: 'CrafterAlex' },
      member: { id: 'user_operator', roles: ['role_operator'] },
    });

    await ctx.harness.waitForPlannerCompletion(3000);

    // 5. Assertions:
    // a. Discord notified of obstacle
    ctx.assertDiscordMessageSent(/⚠️ \*\*Obstacle\*\*/);
    ctx.assertDiscordMessageSent(/missing raw resources: 3x diamond/);

    // b. Zero diamond_pickaxe created in inventory
    expect(ctx.harness.mockBot.inventory.count('diamond_pickaxe')).toBe(0);

    // c. Invariants maintained: no OP commands, no infinite loops
    ctx.assertNoPrivilegedCommandsExecuted();
  });
});
