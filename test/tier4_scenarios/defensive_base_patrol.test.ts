/**
 * Tier 4 Real-World Application Scenario: Defensive Base Patrol
 *
 * Verifies defensive perimeter patrol, threat perception, 1.9+ weapon cooldown timing,
 * shield blocking mechanics, hostile mob discrimination, low-health tactical retreat,
 * and emergency survival alerts.
 *
 * Test Cases: TC-T4-DEF-1 to TC-T4-DEF-4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../harness/index.js';
import { CombatAction, CombatCooldownController } from '../../src/minecraft/actions/combat.js';
import { AutoEatLoop } from '../../src/minecraft/loops/autoEat.js';
import { isHostileMob } from '../../src/minecraft/loops/autoSleep.js';
import { assertEntityAttackReach, ReachExceededError } from '../../src/minecraft/fairplay/reach.js';

describe('Tier 4 Scenario: Defensive Base Patrol (TC-T4-DEF-1 to TC-T4-DEF-4)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext({ useRealMinecraftClient: true });
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  // --------------------------------------------------------------------------
  // TC-T4-DEF-1: Defensive Perimeter Patrol & Hostile Mob Defeat
  // --------------------------------------------------------------------------
  it('TC-T4-DEF-1: Defensive Perimeter Patrol & Hostile Mob Defeat (detect -> advance <= 3.5m -> 1.9+ cooldown -> shield -> defeat)', async () => {
    // 1. User commands base defense via /task
    const cmdResult = await ctx.harness.simulateSlashCommand({
      commandName: 'task',
      options: { goal: 'defend area within radius 16' },
      user: { id: 'user_operator', username: 'BaseDefender' },
      member: { id: 'user_operator', roles: ['role_operator'] },
    });

    expect(cmdResult.allowed).toBe(true);
    expect(cmdResult.replyContent).toContain('Task Assigned');

    // Wait for planner to acknowledge defense task
    await ctx.harness.waitForPlannerCompletion(3000);
    ctx.assertDiscordMessageSent(/defendArea/);

    // 2. Hostile zombie spawns at (4, 64, 0) with 20 HP
    ctx.harness.mockBot.entities['201'] = {
      id: 201,
      name: 'zombie',
      position: { x: 4, y: 64, z: 0 },
      health: 20,
    };

    // 3. Bot equipped with diamond sword and shield in off-hand
    ctx.harness.mockBot.heldItem = { name: 'diamond_sword', count: 1 };
    ctx.harness.mockBot.offHandItem = { name: 'shield', count: 1 };
    ctx.harness.mockBot.activateItem(true); // Raise shield initially

    // 4. Advance into attack reach <= 3.50m: bot moves to (2, 64, 0)
    await ctx.harness.minecraftAgent.navigateTo({ x: 2, y: 64, z: 0 });
    ctx.assertBotPosition({ x: 2, y: 64, z: 0 });

    const combat = new CombatAction(ctx.harness.mockBot);

    // Verify 1.9+ cooldown timing specification for diamond_sword (625ms)
    expect(combat.cooldown.getCooldownPeriodMs('diamond_sword')).toBe(625);

    // 5. Combat engagement loop: attack entity until defeated
    let attackRounds = 0;
    while (ctx.harness.mockBot.entities['201'] && ctx.harness.mockBot.entities['201'].health > 0) {
      attackRounds++;
      const result = await combat.attackEntity(201);
      expect(result.success).toBe(true);

      // Verify shield was re-raised in off-hand after attack swing
      expect(ctx.harness.mockBot.isBlocking).toBe(true);

      // Verify attack reach remained strictly within <= 3.50m
      const eye = ctx.harness.mockBot.eyePosition;
      const targetPos = ctx.harness.mockBot.entities['201']?.position ?? { x: 4, y: 64, z: 0 };
      expect(Math.abs(targetPos.x - eye.x)).toBeLessThanOrEqual(3.50);
    }

    // 6. Assertions:
    // a. Zombie defeated (removed from entities or health <= 0)
    expect(attackRounds).toBeGreaterThanOrEqual(3);
    const zombieRemaining = ctx.harness.mockBot.entities['201'];
    expect(!zombieRemaining || zombieRemaining.health <= 0).toBe(true);

    // b. Live status embed updated
    await ctx.harness.triggerStatusEmbedTick(true);
    ctx.assertStatusEmbedUpdated();

    // c. Fair-play invariants: no OP commands, reach respected
    ctx.assertNoPrivilegedCommandsExecuted();
    ctx.assertFairPlayPerceptionHonored();
  });

  // --------------------------------------------------------------------------
  // TC-T4-DEF-2: Low Health Tactical Retreat & Emergency Auto-Eat
  // --------------------------------------------------------------------------
  it('TC-T4-DEF-2: Low Health Tactical Retreat & Emergency Auto-Eat (< 6 HP retreats, broadcasts alert, and eats food)', async () => {
    // 1. Bot engages threat, but takes critical damage dropping to 5.0 HP (< 6.0 HP retreat threshold)
    ctx.harness.simulateBotDamage(5.0);
    ctx.harness.mockBot.food = 12; // Hunger below max to allow consuming food
    ctx.harness.mockBot.addItem({ name: 'golden_carrot', count: 5 });

    ctx.harness.mockBot.entities['202'] = {
      id: 202,
      name: 'zombie',
      position: { x: 1.5, y: 64, z: 0 },
      health: 20,
    };

    const initialPos = { ...ctx.harness.mockBot.entity.position };
    const combat = new CombatAction(ctx.harness.mockBot);

    // 2. Bot attempts to attack while at critical health (< 6 HP)
    expect(combat.shouldRetreat()).toBe(true);
    const result = await combat.attackEntity(202);

    // 3. Attack is aborted and tactical retreat is executed
    expect(result.success).toBe(false);
    expect(result.message).toContain('health below 6 HP, executed tactical retreat');

    // Bot retreated away from threat (position changed along repulsion vector)
    const currentPos = ctx.harness.mockBot.entity.position;
    const retreatedDistance = Math.sqrt(
      Math.pow(currentPos.x - initialPos.x, 2) + Math.pow(currentPos.z - initialPos.z, 2)
    );
    expect(retreatedDistance).toBeGreaterThan(0);

    // 4. Coordinator broadcast SURVIVAL EMERGENCY alert to Discord text
    await new Promise((r) => setTimeout(r, 20));
    ctx.assertDiscordMessageSent((m) =>
      Boolean(
        m.content?.includes('🚨 **SURVIVAL EMERGENCY**') &&
        m.content?.includes('5.0/20 hearts remaining')
      )
    );

    // 5. AudioQueue received EMERGENCY priority item and triggered queue preemption
    ctx.assertEmergencyAudioPreemptionOccurred();

    // 6. Auto-eat loop consumes food to begin health regeneration
    const autoEat = new AutoEatLoop(ctx.harness.mockBot);
    const ate = await autoEat.checkAndEat();
    expect(ate).toBe(true);
    expect(ctx.harness.mockBot.food).toBeGreaterThan(12);
  });

  // --------------------------------------------------------------------------
  // TC-T4-DEF-3: Hostile Target Discrimination
  // --------------------------------------------------------------------------
  it('TC-T4-DEF-3: Hostile Target Discrimination (attacks hostiles only; protects allied players and passive mobs)', async () => {
    // 1. Populate area with allied player Steve, passive sheep, and hostile zombie
    ctx.harness.mockBot.entities['301'] = {
      id: 301,
      name: 'Steve',
      type: 'player',
      position: { x: 2, y: 64, z: 0 },
      health: 20,
    };
    ctx.harness.mockBot.entities['302'] = {
      id: 302,
      name: 'sheep',
      type: 'mob',
      position: { x: 1.5, y: 64, z: 1 },
      health: 8,
    };
    ctx.harness.mockBot.entities['303'] = {
      id: 303,
      name: 'zombie',
      type: 'mob',
      position: { x: 2.5, y: 64, z: 0 },
      health: 20,
    };

    // 2. Verify classification rules
    expect(isHostileMob(ctx.harness.mockBot.entities['301'].name)).toBe(false);
    expect(isHostileMob(ctx.harness.mockBot.entities['302'].name)).toBe(false);
    expect(isHostileMob(ctx.harness.mockBot.entities['303'].name)).toBe(true);

    const combat = new CombatAction(ctx.harness.mockBot);

    // 3. Filter targets: only hostile mobs are targeted for attack
    const candidates = Object.values(ctx.harness.mockBot.entities) as any[];
    const hostileTargets = candidates.filter((e) => isHostileMob(e.name));

    expect(hostileTargets).toHaveLength(1);
    expect(hostileTargets[0].id).toBe(303);

    // 4. Attack only hostile target
    const result = await combat.attackEntity(hostileTargets[0].id);
    expect(result.success).toBe(true);

    // 5. Assertions:
    // Allied player and passive mob took 0 damage
    expect(ctx.harness.mockBot.entities['301'].health).toBe(20);
    expect(ctx.harness.mockBot.entities['302'].health).toBe(8);

    // Hostile zombie took damage
    expect(ctx.harness.mockBot.entities['303'].health).toBeLessThan(20);
  });

  // --------------------------------------------------------------------------
  // TC-T4-DEF-4: Combat Reach Clamping (> 3.50m)
  // --------------------------------------------------------------------------
  it('TC-T4-DEF-4: Combat Reach Clamping (> 3.50m triggers ReachExceededError and aborts melee strike)', async () => {
    const eye = ctx.harness.mockBot.eyePosition;

    // Hostile creeper positioned at 4.20m from eye (surface distance 3.90m > 3.50m combat reach)
    const outOfReachPos = {
      x: eye.x + 4.20,
      y: eye.y,
      z: eye.z,
    };

    ctx.harness.mockBot.entities['401'] = {
      id: 401,
      name: 'creeper',
      position: outOfReachPos,
      health: 20,
    };

    // 1. assertEntityAttackReach throws ReachExceededError
    expect(() => {
      assertEntityAttackReach(eye, outOfReachPos);
    }).toThrow(ReachExceededError);

    // 2. CombatAction.attackEntity returns failure with out of reach message
    const combat = new CombatAction(ctx.harness.mockBot);
    const result = await combat.attackEntity(401);

    expect(result.success).toBe(false);
    expect(result.message).toContain('out of attack reach');
    expect(result.message).toMatch(/>\s*3\.50m/);

    // 3. Creeper took 0 damage because attack was clamped by fair-play rule
    expect(ctx.harness.mockBot.entities['401'].health).toBe(20);
  });
});
