/**
 * Tier 4 Real-World Application Scenario: Full Mining Expedition
 *
 * Verifies end-to-end legitimate mining journeys under strict fair-play survival rules:
 * surface exposure anti-xray verification, 3D line-of-sight raycasting, perception FOV cones,
 * physical reach limits (<= 4.50m), harvest tool tier prerequisites, block excavation,
 * drop collection, and Discord status reporting.
 *
 * Test Cases: TC-T4-MINE-1 to TC-T4-MINE-4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../harness/index.js';
import { MiningAction, canSafelyHarvest } from '../../src/minecraft/actions/mining.js';
import { assertBlockReach, ReachExceededError } from '../../src/minecraft/fairplay/reach.js';

describe('Tier 4 Scenario: Full Mining Expedition (TC-T4-MINE-1 to TC-T4-MINE-4)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext({ useRealMinecraftClient: true });
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  // --------------------------------------------------------------------------
  // TC-T4-MINE-1: Legitimate Mining Expedition Happy Path
  // --------------------------------------------------------------------------
  it('TC-T4-MINE-1: Legitimate Mining Expedition Happy Path (exposure -> FOV -> LOS -> reach <= 4.5m -> tier -> drops)', async () => {
    // 1. Setup 3 exposed iron ore blocks in the voxel world
    ctx.harness.simulateWorldBlock({ x: 3, y: 64, z: 1 }, 'iron_ore');
    ctx.harness.simulateWorldBlock({ x: 5, y: 64, z: 2 }, 'iron_ore');
    ctx.harness.simulateWorldBlock({ x: 8, y: 64, z: 3 }, 'iron_ore');

    // Orient bot looking along +X with a natural downward glance (pitch ~ 0.3 rad / 17 deg)
    ctx.harness.mockBot.entity.yaw = -Math.PI / 2;
    ctx.harness.mockBot.entity.pitch = 0.3;

    // 2. Supply legitimate tool: stone pickaxe (tier rank 2, required for iron_ore)
    ctx.harness.mockBot.addItem({ name: 'stone_pickaxe', count: 1 });

    // Hook mining drop collection: when block is dug legitimately, bot picks up the dropped iron_ore
    ctx.harness.mockBot.on('diggingCompleted', (b) => {
      ctx.harness.mockBot.addItem({ name: b.name, count: 1 });
    });

    // 3. User commands mining expedition via /task slash command
    const cmdResult = await ctx.harness.simulateSlashCommand({
      commandName: 'task',
      options: { goal: 'gather 3 iron_ore' },
      user: { id: 'user_operator', username: 'MinerAlex' },
      member: { id: 'user_operator', roles: ['role_operator'] },
    });

    expect(cmdResult.allowed).toBe(true);
    expect(cmdResult.replyContent).toContain('Task Assigned');

    // 4. Wait for multi-turn planner execution to complete all 3 mining cycles
    await ctx.harness.waitForPlannerCompletion(5000);

    // 5. Assertions:
    // a. Bot inventory contains exactly 3 iron_ore
    ctx.assertInventoryContains('iron_ore', 3);

    // b. Mined blocks replaced by air in the world
    ctx.assertWorldBlockAt({ x: 3, y: 64, z: 1 }, 'air');
    ctx.assertWorldBlockAt({ x: 5, y: 64, z: 2 }, 'air');
    ctx.assertWorldBlockAt({ x: 8, y: 64, z: 3 }, 'air');

    // c. Discord received step updates and task completion confirmation
    ctx.assertDiscordMessageSent(/gatherResource/);
    ctx.assertDiscordMessageSent(/Task Finished/);

    // d. Status embed updated
    await ctx.harness.triggerStatusEmbedTick(true);
    ctx.assertStatusEmbedUpdated();

    // e. Invariants: no OP commands executed, fair play perception honored
    ctx.assertNoPrivilegedCommandsExecuted();
    ctx.assertFairPlayPerceptionHonored();

    // f. Synthetic TTS audio was played in voice channel
    const audio = ctx.assertAudioPlayed();
    expect(audio.totalBytes).toBeGreaterThan(44);
  });

  // --------------------------------------------------------------------------
  // TC-T4-MINE-2: Anti-Xray Hidden Underground Ore Rejection
  // --------------------------------------------------------------------------
  it('TC-T4-MINE-2: Anti-Xray Hidden Underground Ore Rejection (6-neighbor exposure check drops buried ores)', async () => {
    // 1. Bury iron ore at Y=50 enclosed by solid stone on all 6 faces
    ctx.harness.simulateWorldBlock({ x: 0, y: 50, z: 0 }, 'iron_ore');
    ctx.harness.simulateWorldBlock({ x: 0, y: 51, z: 0 }, 'stone'); // +Y (above)
    ctx.harness.simulateWorldBlock({ x: 0, y: 49, z: 0 }, 'stone'); // -Y (below)
    ctx.harness.simulateWorldBlock({ x: 1, y: 50, z: 0 }, 'stone');  // +X (east)
    ctx.harness.simulateWorldBlock({ x: -1, y: 50, z: 0 }, 'stone'); // -X (west)
    ctx.harness.simulateWorldBlock({ x: 0, y: 50, z: 1 }, 'stone');  // +Z (south)
    ctx.harness.simulateWorldBlock({ x: 0, y: 50, z: -1 }, 'stone'); // -Z (north)

    ctx.harness.mockBot.addItem({ name: 'stone_pickaxe', count: 1 });
    const initialPos = { ...ctx.harness.mockBot.entity.position };

    // 2. Command mining expedition for iron_ore
    await ctx.harness.simulateSlashCommand({
      commandName: 'task',
      options: { goal: 'gather 3 iron_ore' },
      user: { id: 'user_operator', username: 'MinerAlex' },
      member: { id: 'user_operator', roles: ['role_operator'] },
    });

    await ctx.harness.waitForPlannerCompletion(4000);

    // 3. Assertions:
    // a. Buried block remains intact in the world (never mined or targeted)
    ctx.assertWorldBlockAt({ x: 0, y: 50, z: 0 }, 'iron_ore');

    // b. Zero pathfinding to unexposed underground block: bot remains on surface Y=64
    expect(ctx.harness.mockBot.entity.position.y).toBe(initialPos.y);

    // c. Discord received obstacle notice regarding fair-play anti-xray exposure
    ctx.assertDiscordMessageSent(/⚠️ \*\*Obstacle\*\*/);
    ctx.assertDiscordMessageSent(/fair-play anti-xray enforced/);

    // d. Zero iron_ore obtained in inventory
    expect(ctx.harness.mockBot.inventory.count('iron_ore')).toBe(0);
  });

  // --------------------------------------------------------------------------
  // TC-T4-MINE-3: Insufficient Tool Tier Obstacle Recovery
  // --------------------------------------------------------------------------
  it('TC-T4-MINE-3: Insufficient Tool Tier Obstacle Recovery (wooden pickaxe cannot harvest diamond_ore)', async () => {
    // 1. Exposed diamond_ore at (2, 64, 0)
    ctx.harness.simulateWorldBlock({ x: 2, y: 64, z: 0 }, 'diamond_ore');
    await ctx.harness.mockBot.lookAt({ x: 2, y: 64, z: 0 });

    // 2. Bot possesses ONLY wooden_pickaxe (tier 1; diamond_ore requires tier >= 3 iron)
    ctx.harness.mockBot.addItem({ name: 'wooden_pickaxe', count: 1 });

    // Verify harvest check directly
    const items = ctx.harness.mockBot.inventory.items();
    const harvestCheck = canSafelyHarvest('diamond_ore', items);
    expect(harvestCheck.canHarvest).toBe(false);
    expect(harvestCheck.reason).toContain('requires a pickaxe of tier >= iron');

    // 3. Command mining expedition for diamond_ore
    await ctx.harness.simulateSlashCommand({
      commandName: 'task',
      options: { goal: 'gather 1 diamond_ore' },
      user: { id: 'user_operator', username: 'MinerAlex' },
      member: { id: 'user_operator', roles: ['role_operator'] },
    });

    await ctx.harness.waitForPlannerCompletion(4000);

    // 4. Assertions:
    // a. Diamond ore block is NOT broken or destroyed
    ctx.assertWorldBlockAt({ x: 2, y: 64, z: 0 }, 'diamond_ore');

    // b. Inventory did NOT falsely receive diamond_ore
    expect(ctx.harness.mockBot.inventory.count('diamond_ore')).toBe(0);

    // c. Discord notified with descriptive obstacle warning
    ctx.assertDiscordMessageSent(/⚠️ \*\*Obstacle\*\*/);
    ctx.assertDiscordMessageSent(/requires a pickaxe of tier >= iron/);
  });

  // --------------------------------------------------------------------------
  // TC-T4-MINE-4: Reach Limit Boundary Enforcement (> 4.50m)
  // --------------------------------------------------------------------------
  it('TC-T4-MINE-4: Reach Limit Boundary Enforcement (> 4.50m triggers ReachExceededError and action failure)', async () => {
    const eye = {
      x: ctx.harness.mockBot.entity.position.x,
      y: ctx.harness.mockBot.entity.position.y + ctx.harness.mockBot.entity.eyeHeight,
      z: ctx.harness.mockBot.entity.position.z,
    };

    // Target block at distance > 4.50m from eye
    const distantPos = {
      x: eye.x + 5.0,
      y: 64,
      z: eye.z,
    };

    ctx.harness.simulateWorldBlock(distantPos, 'iron_ore');
    ctx.harness.mockBot.addItem({ name: 'iron_pickaxe', count: 1 });

    // 1. assertBlockReach throws ReachExceededError
    expect(() => {
      assertBlockReach(eye, distantPos);
    }).toThrow(ReachExceededError);

    // 2. canInteractWith returns false
    expect(ctx.harness.minecraftAgent.canInteractWith(distantPos)).toBe(false);

    // 3. MiningAction returns success: false with out of reach message
    const mining = new MiningAction(ctx.harness.mockBot);
    const result = await mining.mineBlock(distantPos);

    expect(result.success).toBe(false);
    expect(result.message).toContain('out of reach');
    expect(result.message).toMatch(/>\s*4\.50m/);

    // Block was not broken
    ctx.assertWorldBlockAt(distantPos, 'iron_ore');
  });
});
