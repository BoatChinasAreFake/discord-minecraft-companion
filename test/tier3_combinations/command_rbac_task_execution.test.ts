/**
 * Tier 3 Cross-Feature Combination: Command RBAC & Task Execution
 *
 * Verifies Discord slash commands integration with 3-tier RBAC security (VIEWER, OPERATOR, ADMIN),
 * automatic interaction deferral, administrative permission bypass, offline agent rejection,
 * input validation, and end-to-end task assignment through the AgentCoordinator.
 *
 * Test Cases: TC-T3-RBC-1 to TC-T3-RBC-5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { createTestContext, type TestContext } from '../harness/index.js';

describe('Tier 3: Command RBAC & Task Execution (TC-T3-RBC-1 to TC-T3-RBC-5)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  // --------------------------------------------------------------------------
  // TC-T3-RBC-1: Authorized OPERATOR executes /task -> Full end-to-end execution
  // --------------------------------------------------------------------------
  it('TC-T3-RBC-1: Authorized OPERATOR executes /task with auto-deferral and end-to-end Minecraft execution', async () => {
    // 1. Simulate authorized operator running /task
    const result = await ctx.harness.simulateSlashCommand({
      commandName: 'task',
      options: { goal: 'go to 5 64 5' },
      user: { id: 'operator_user_1', username: 'OperatorPlayer' },
      member: { id: 'operator_user_1', roles: ['role_operator'] },
    });

    // 2. Interaction verified
    expect(result.allowed).toBe(true);
    expect(result.deferred).toBe(true);
    expect(result.replied).toBe(true);
    expect(result.replyContent).toContain('⏳ **Task Assigned**: "go to 5 64 5"');

    // 3. Coordinator dispatched task to Gemini planner -> wait for completion
    await ctx.harness.waitForPlannerCompletion();

    // 4. Minecraft agent moved to coordinates (5, 64, 5)
    ctx.assertBotPosition({ x: 5, y: 64, z: 5 });
  });

  // --------------------------------------------------------------------------
  // TC-T3-RBC-2: Unauthorized VIEWER executes /task -> RBAC denies immediately
  // --------------------------------------------------------------------------
  it('TC-T3-RBC-2: Unauthorized VIEWER executes /task and is denied immediately with ephemeral rejection', async () => {
    const initialPos = ctx.harness.minecraftAgent.getStatus().position;

    // Stimulus: User having only viewer permissions (no operator role) runs /task
    const result = await ctx.harness.simulateSlashCommand({
      commandName: 'task',
      options: { goal: 'defend area' },
      user: { id: 'viewer_user_1', username: 'ViewerGuest' },
      member: {
        id: 'viewer_user_1',
        roles: ['role_viewer'],
        permissions: {
          has: () => false,
          bitfield: 0n,
        },
      },
    });

    // Assert: RBAC denied immediately
    expect(result.allowed).toBe(false);
    expect(result.replied).toBe(true);
    expect(result.replyContent).toContain('⛔ Permission Denied');
    expect(result.replyContent).toContain('requires Operator privileges');

    // Assert: Planner never executed and bot remained untouched
    expect(ctx.harness.planner.isExecuting()).toBe(false);
    expect(ctx.harness.minecraftAgent.getStatus().position).toEqual(initialPos);
  });

  // --------------------------------------------------------------------------
  // TC-T3-RBC-3: Discord Administrator bypass allows user without explicit role
  // --------------------------------------------------------------------------
  it('TC-T3-RBC-3: Discord Administrator permission bitfield bypasses explicit role whitelisting', async () => {
    // Member has empty role list but Discord Administrator permission flag (8n)
    const adminMember = {
      id: 'unwhitelisted_server_admin',
      roles: [],
      permissions: {
        has: (flag: any) =>
          flag === PermissionFlagsBits.Administrator || flag === 8n || flag === 'Administrator',
        bitfield: PermissionFlagsBits.Administrator,
      },
    };

    // 1. Check ADMIN tier command: /connect
    const connectResult = await ctx.harness.simulateSlashCommand({
      commandName: 'connect',
      options: { host: 'localhost', port: 25565, username: 'MockAdminBot' },
      user: { id: 'unwhitelisted_server_admin', username: 'ServerAdmin' },
      member: adminMember,
    });

    expect(connectResult.allowed).toBe(true);
    expect(connectResult.replied).toBe(true);

    // 2. Check OPERATOR tier command: /task
    const taskResult = await ctx.harness.simulateSlashCommand({
      commandName: 'task',
      options: { goal: 'go to 2 64 2' },
      user: { id: 'unwhitelisted_server_admin', username: 'ServerAdmin' },
      member: adminMember,
    });

    expect(taskResult.allowed).toBe(true);
    expect(taskResult.replied).toBe(true);
    expect(taskResult.replyContent).toContain('Task Assigned');

    await ctx.harness.waitForPlannerCompletion();
    ctx.assertBotPosition({ x: 2, y: 64, z: 2 });
  });

  // --------------------------------------------------------------------------
  // TC-T3-RBC-4: /task rejection when Minecraft agent is disconnected
  // --------------------------------------------------------------------------
  it('TC-T3-RBC-4: /task rejects when Minecraft agent is offline with directive to run /connect', async () => {
    // 1. Disconnect Minecraft agent
    await ctx.harness.minecraftAgent.disconnect();
    expect(ctx.harness.minecraftAgent.getStatus().connected).toBe(false);

    // 2. Authorized operator runs /task
    const result = await ctx.harness.simulateSlashCommand({
      commandName: 'task',
      options: { goal: 'gather 5 oak_log' },
      user: { id: 'operator_user_1', username: 'OperatorUser' },
      member: { id: 'operator_user_1', roles: ['role_operator'] },
    });

    // 3. Command accepted by RBAC but fails business validation
    expect(result.allowed).toBe(true);
    expect(result.replyContent).toContain('❌ Bot is offline. An Administrator must run /connect first.');

    // 4. Planner not called
    expect(ctx.harness.planner.isExecuting()).toBe(false);
  });

  // --------------------------------------------------------------------------
  // TC-T3-RBC-5: /task validation rejects empty goals and goals > 500 characters
  // --------------------------------------------------------------------------
  it('TC-T3-RBC-5: /task input validation rejects empty goals and goals exceeding 500 characters', async () => {
    const operatorUser = { id: 'operator_user_1', username: 'OperatorUser' };
    const operatorMember = { id: 'operator_user_1', roles: ['role_operator'] };

    // 1. Empty / whitespace-only goal
    const emptyResult = await ctx.harness.simulateSlashCommand({
      commandName: 'task',
      options: { goal: '   ' },
      user: operatorUser,
      member: operatorMember,
    });

    expect(emptyResult.allowed).toBe(true);
    expect(emptyResult.replyContent).toContain('❌ Task goal cannot be empty.');

    // 2. Goal exceeding 500 characters
    const longGoal = 'explore the surrounding forest and build a large stone fence '.repeat(10); // > 500 chars
    expect(longGoal.length).toBeGreaterThan(500);

    const overflowResult = await ctx.harness.simulateSlashCommand({
      commandName: 'task',
      options: { goal: longGoal },
      user: operatorUser,
      member: operatorMember,
    });

    expect(overflowResult.allowed).toBe(true);
    expect(overflowResult.replyContent).toContain('❌ Task goal must be 500 characters or fewer.');

    // Neither reached planner
    expect(ctx.harness.planner.isExecuting()).toBe(false);
  });
});
