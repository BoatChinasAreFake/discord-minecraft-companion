/**
 * Tier 3 Cross-Feature Combination: Survival Loop Events & Live Status Embeds
 *
 * Verifies autonomous survival loops (Auto-Eat, Auto-Sleep, Auto-Equip) triggered by in-game
 * events (hunger, critical health damage, nightfall, monster exclusion, dimensions, gear upgrades)
 * and their immediate propagation to Discord emergency alerts, emergency TTS queue,
 * and live Discord status embeds.
 *
 * Test Cases: TC-T3-SRV-1 to TC-T3-SRV-6
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../harness/index.js';
import { AutoEatLoop } from '../../src/minecraft/loops/autoEat.js';
import { AutoSleepLoop } from '../../src/minecraft/loops/autoSleep.js';
import { AutoEquipLoop } from '../../src/minecraft/loops/autoEquip.js';

describe('Tier 3: Survival Loop Events & Live Status Embeds (TC-T3-SRV-1 to TC-T3-SRV-6)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  // --------------------------------------------------------------------------
  // TC-T3-SRV-1: Low hunger triggers auto-eat and updates status embed hunger bar
  // --------------------------------------------------------------------------
  it('TC-T3-SRV-1: Low hunger triggers auto-eat and updates live status embed hunger bar to 20/20', async () => {
    // 1. Set bot hunger to 14 and supply cooked beef in inventory
    ctx.harness.mockBot.food = 14;
    ctx.harness.mockBot.addItem({ name: 'cooked_beef', count: 5 });

    const autoEat = new AutoEatLoop(ctx.harness.mockBot);
    expect(autoEat.shouldEat()).toBe(true);

    // 2. Execute auto-eat check and verify food increases to 20
    const ate = await autoEat.checkAndEat();
    expect(ate).toBe(true);
    expect(ctx.harness.mockBot.food).toBe(20);

    // 3. Status embed reflects full hunger bar (🍗🍗🍗🍗🍗🍗🍗🍗🍗🍗 **20/20**)
    ctx.harness.statusEmbedManager.updateState(ctx.harness.minecraftAgent.getStatus());
    await ctx.harness.triggerStatusEmbedTick(true);

    ctx.assertStatusEmbedField('Hunger', '🍗🍗🍗🍗🍗🍗🍗🍗🍗🍗 **20/20**');
  });

  // --------------------------------------------------------------------------
  // TC-T3-SRV-2: Critical health drop triggers emergency alert and emergency TTS
  // --------------------------------------------------------------------------
  it('TC-T3-SRV-2: Critical health drop triggers SURVIVAL EMERGENCY alert and EMERGENCY priority TTS', async () => {
    // 1. Simulate critical health damage dropping bot HP to 5.0 (<= 6.0 HP threshold)
    ctx.harness.simulateBotDamage(5.0);

    // Give asynchronous event emission a tick to propagate
    await new Promise((r) => setTimeout(r, 20));

    // 2. Coordinator detects critical health and broadcasts SURVIVAL EMERGENCY to Discord
    ctx.assertDiscordMessageSent((m) =>
      Boolean(
        m.content?.includes('🚨 **SURVIVAL EMERGENCY**') &&
        m.content?.includes('Low health warning: 5.0/20 hearts remaining!')
      )
    );

    // 3. AudioQueue received EMERGENCY priority item and triggered queue preemption
    ctx.assertEmergencyAudioPreemptionOccurred();
  });

  // --------------------------------------------------------------------------
  // TC-T3-SRV-3: Nightfall in Overworld triggers auto-sleep in bed
  // --------------------------------------------------------------------------
  it('TC-T3-SRV-3: Nightfall in Overworld triggers auto-sleep in safe bed and updates status', async () => {
    // 1. Set world time to 13000 (vanilla night window starts at 12541)
    ctx.harness.simulateWeather(false, false, 13000);

    // 2. Place a valid bed block at (2, 64, 0) within interaction reach
    ctx.harness.mockWorld.setBlock({ x: 2, y: 64, z: 0 }, 'red_bed');

    const autoSleep = new AutoSleepLoop(ctx.harness.mockBot);

    // 3. Verify conditions: nightfall active and no monsters nearby
    expect(autoSleep.canSleepNow()).toBe(true);
    expect(autoSleep.isMonsterNearby({ x: 2, y: 64, z: 0 })).toBe(false);

    // 4. Execute checkAndSleep
    const slept = await autoSleep.checkAndSleep();
    expect(slept).toBe(true);
    expect(ctx.harness.mockBot.isSleeping).toBe(true);

    // 5. Update status embed to reflect updated agent state
    ctx.harness.statusEmbedManager.updateState(ctx.harness.minecraftAgent.getStatus());
    await ctx.harness.triggerStatusEmbedTick(true);
    ctx.assertStatusEmbedUpdated();
  });

  // --------------------------------------------------------------------------
  // TC-T3-SRV-4: Nightfall with hostile mob within 8m/5m exclusion zone aborts sleep
  // --------------------------------------------------------------------------
  it('TC-T3-SRV-4: Nightfall with hostile mob within 8m/5m exclusion zone aborts sleep', async () => {
    // 1. Set night time and place bed at (2, 64, 0)
    ctx.harness.simulateWeather(false, false, 13000);
    ctx.harness.mockWorld.setBlock({ x: 2, y: 64, z: 0 }, 'red_bed');

    // 2. Spawn a hostile zombie at (5, 64, 0) (dx=3m from bed, within 8m horizontal exclusion)
    ctx.harness.mockBot.entities['999'] = {
      id: 999,
      name: 'zombie',
      position: { x: 5, y: 64, z: 0 },
    };

    const autoSleep = new AutoSleepLoop(ctx.harness.mockBot);

    // 3. Monster exclusion check detects nearby hostile threat
    expect(autoSleep.canSleepNow()).toBe(true);
    expect(autoSleep.isMonsterNearby({ x: 2, y: 64, z: 0 })).toBe(true);

    // 4. Attempting to sleep is safely aborted
    const slept = await autoSleep.checkAndSleep();
    expect(slept).toBe(false);
    expect(ctx.harness.mockBot.isSleeping).toBe(false);
  });

  // --------------------------------------------------------------------------
  // TC-T3-SRV-5: Nether / End dimension check prevents explosive bed sleep
  // --------------------------------------------------------------------------
  it('TC-T3-SRV-5: Nether and End dimension checks prevent explosive bed sleep', async () => {
    ctx.harness.simulateWeather(false, false, 13000);
    ctx.harness.mockWorld.setBlock({ x: 2, y: 64, z: 0 }, 'white_bed');

    // 1. Test Nether dimension
    ctx.harness.mockBot.game.dimension = 'the_nether';
    const autoSleepNether = new AutoSleepLoop(ctx.harness.mockBot);
    expect(autoSleepNether.canSleepNow()).toBe(false);

    const sleptNether = await autoSleepNether.checkAndSleep();
    expect(sleptNether).toBe(false);
    expect(ctx.harness.mockBot.isSleeping).toBe(false);

    // 2. Test The End dimension
    ctx.harness.mockBot.game.dimension = 'the_end';
    const autoSleepEnd = new AutoSleepLoop(ctx.harness.mockBot);
    expect(autoSleepEnd.canSleepNow()).toBe(false);

    const sleptEnd = await autoSleepEnd.checkAndSleep();
    expect(sleptEnd).toBe(false);
    expect(ctx.harness.mockBot.isSleeping).toBe(false);
  });

  // --------------------------------------------------------------------------
  // TC-T3-SRV-6: Inventory armor upgrade triggers auto-equip and status embed update
  // --------------------------------------------------------------------------
  it('TC-T3-SRV-6: Inventory armor upgrade triggers auto-equip and live status embed gear reflection', async () => {
    // 1. Initial gear: leather chestplate equipped
    ctx.harness.mockBot.armor.torso = { name: 'leather_chestplate', count: 1 };

    // 2. Superior gear added to inventory: diamond chestplate
    ctx.harness.mockBot.addItem({ name: 'diamond_chestplate', count: 1 });

    const autoEquip = new AutoEquipLoop(ctx.harness.mockBot);

    // 3. Evaluate and equip based on superior composite defensive score
    await autoEquip.evaluateAndEquip();

    // Verify diamond chestplate is equipped
    expect(ctx.harness.mockBot.armor.torso?.name).toBe('diamond_chestplate');

    // 4. Update status embed and verify new gear is displayed
    ctx.harness.statusEmbedManager.updateState(ctx.harness.minecraftAgent.getStatus());
    await ctx.harness.triggerStatusEmbedTick(true);

    ctx.assertStatusEmbedField('Equipped Gear', 'diamond_chestplate');
  });
});
