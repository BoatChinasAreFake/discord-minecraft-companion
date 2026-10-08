/**
 * Tier 4 Real-World Application Scenario: Emergency Abort Journey
 *
 * Verifies emergency cancellation protocols across slash commands (/stop),
 * natural language voice interrupts ("abort", "stop"), in-game death events,
 * and rapid task preemption (Task A interrupted by Task B).
 *
 * Test Cases: TC-T4-ABT-1 to TC-T4-ABT-4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../harness/index.js';
import { AudioPriority } from '../../src/audio/types.js';

describe('Tier 4 Scenario: Emergency Abort Journey (TC-T4-ABT-1 to TC-T4-ABT-4)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext({ useRealMinecraftClient: true });
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  // --------------------------------------------------------------------------
  // TC-T4-ABT-1: Slash Command /stop Interrupts Active Task
  // --------------------------------------------------------------------------
  it('TC-T4-ABT-1: Slash Command /stop Interrupts Active Task (cancels planner, halts movement, purges audio queue)', async () => {
    // 1. Script a long-running multi-turn task
    ctx.harness.setGeminiCustomHandler(async (input) => {
      if (input.type === 'user') {
        return {
          text: 'Starting multi-stage expedition.',
          toolCalls: [{ name: 'goToCoordinates', args: { x: 30, y: 64, z: 30 } }],
        };
      }
      // Hold turn to ensure active cancellation window
      await new Promise((r) => setTimeout(r, 300));
      return {
        text: 'Continuing second stage.',
        toolCalls: [{ name: 'goToCoordinates', args: { x: 60, y: 64, z: 60 } }],
      };
    });

    // Populate multiple non-emergency items in audio queue to verify purging
    ctx.harness.audioQueue.enqueue({
      id: 'bg_tts_1',
      text: 'Background progress commentary 1',
      priority: AudioPriority.NORMAL,
    });
    ctx.harness.audioQueue.enqueue({
      id: 'bg_tts_2',
      text: 'Background progress commentary 2',
      priority: AudioPriority.NORMAL,
    });
    expect(ctx.harness.audioQueue.getQueueLength()).toBeGreaterThanOrEqual(1);

    // 2. Start the task
    ctx.harness.coordinator.assignTask({
      goal: 'long mining expedition',
      user: 'OperatorAlex',
    });

    // Wait until planner is actively executing
    await ctx.harness.waitFor(() => ctx.harness.planner.isExecuting(), 2000);
    expect(ctx.harness.planner.isExecuting()).toBe(true);

    // 3. Operator triggers emergency stop via /stop slash command
    const stopResult = await ctx.harness.simulateSlashCommand({
      commandName: 'stop',
      user: { id: 'user_operator', username: 'OperatorAlex' },
      member: { id: 'user_operator', roles: ['role_operator'] },
    });

    expect(stopResult.allowed).toBe(true);
    expect(stopResult.replyContent).toContain('Emergency Stop');

    // 4. Assertions:
    // a. Planner is cancelled and no longer executing
    await ctx.harness.waitFor(() => !ctx.harness.planner.isExecuting(), 2000);
    expect(ctx.harness.planner.isExecuting()).toBe(false);

    // b. Non-emergency background audio was purged
    const remainingQueue = ctx.harness.audioQueue.getQueue();
    expect(remainingQueue.some((item) => item.id.startsWith('bg_tts'))).toBe(false);
    expect(
      remainingQueue.filter(
        (item) => item.priority === AudioPriority.NORMAL || item.priority === AudioPriority.LOW
      )
    ).toHaveLength(0);

    // c. Discord received Emergency Stop notification
    ctx.assertDiscordMessageSent(/🛑 Emergency Stop/);

    // d. Status embed reflects standby
    await ctx.harness.triggerStatusEmbedTick(true);
    ctx.assertStatusEmbedUpdated();
  });

  // --------------------------------------------------------------------------
  // TC-T4-ABT-2: Voice "Abort" Interrupt Halts Active Multi-Turn Task
  // --------------------------------------------------------------------------
  it('TC-T4-ABT-2: Voice "Abort" Interrupt Halts Active Multi-Turn Task (regex detection -> cancel planner -> halt)', async () => {
    // 1. Script a multi-turn task with a delay
    ctx.harness.setGeminiCustomHandler(async (input) => {
      if (input.type === 'user') {
        return {
          toolCalls: [{ name: 'goToCoordinates', args: { x: 40, y: 64, z: 40 } }],
        };
      }
      await new Promise((r) => setTimeout(r, 300));
      return {
        toolCalls: [{ name: 'goToCoordinates', args: { x: 80, y: 64, z: 80 } }],
      };
    });

    ctx.harness.coordinator.assignTask({
      goal: 'patrol outer border',
      user: 'VoiceAlex',
    });

    await ctx.harness.waitFor(() => ctx.harness.planner.isExecuting(), 2000);
    expect(ctx.harness.planner.isExecuting()).toBe(true);

    // 2. User speaks "abort immediately" into voice channel
    await ctx.harness.simulateUserVoicePrompt('voice_user_1', 'abort immediately');

    // 3. Assertions:
    // a. Active planner execution cancelled
    await ctx.harness.waitFor(() => !ctx.harness.planner.isExecuting(), 2000);
    expect(ctx.harness.planner.isExecuting()).toBe(false);

    // b. Discord received emergency stop notification
    ctx.assertDiscordMessageSent(/🛑 Emergency Stop/);
  });

  // --------------------------------------------------------------------------
  // TC-T4-ABT-3: Agent In-Game Death Triggers Emergency Halt & Survival Alert
  // --------------------------------------------------------------------------
  it('TC-T4-ABT-3: Agent In-Game Death Triggers Emergency Halt & Survival Alert (hp=0 -> death event -> alert -> halt)', async () => {
    // 1. Start an active goal
    ctx.harness.setGeminiCustomHandler(async (input) => {
      if (input.type === 'user') {
        return {
          toolCalls: [{ name: 'goToCoordinates', args: { x: 25, y: 64, z: 25 } }],
        };
      }
      await new Promise((r) => setTimeout(r, 400));
      return { text: 'Done' };
    });

    ctx.harness.coordinator.assignTask({
      goal: 'explore danger zone',
      user: 'ExplorerAlex',
    });

    await ctx.harness.waitFor(() => ctx.harness.planner.isExecuting(), 2000);
    expect(ctx.harness.planner.isExecuting()).toBe(true);

    // 2. Simulate catastrophic lethal damage (health = 0)
    ctx.harness.simulateBotDamage(0);

    // Wait for event propagation
    await new Promise((r) => setTimeout(r, 50));

    // 3. Assertions:
    // a. Planner halted by emergency stop
    await ctx.harness.waitFor(() => !ctx.harness.planner.isExecuting(), 2000);
    expect(ctx.harness.planner.isExecuting()).toBe(false);

    // b. Emergency survival alert broadcast to Discord text
    ctx.assertDiscordMessageSent((m) =>
      Boolean(
        m.content?.includes('🚨 **SURVIVAL EMERGENCY**') &&
        m.content?.includes('Agent died in-game')
      )
    );

    // c. Audio queue preemption triggered with EMERGENCY priority
    ctx.assertEmergencyAudioPreemptionOccurred();
  });

  // --------------------------------------------------------------------------
  // TC-T4-ABT-4: Task Preemption via Rapid New Task Assignment
  // --------------------------------------------------------------------------
  it('TC-T4-ABT-4: Task Preemption via Rapid New Task Assignment (Task A aborted cleanly when Task B assigned)', async () => {
    // 1. Task A and Task B handler
    let isTaskB = false;
    ctx.harness.setGeminiCustomHandler(async (input) => {
      if (input.type === 'user') {
        if (input.prompt?.includes('Task A')) {
          return {
            text: 'Starting Task A',
            toolCalls: [{ name: 'goToCoordinates', args: { x: 50, y: 64, z: 50 } }],
          };
        }
        if (input.prompt?.includes('Task B')) {
          isTaskB = true;
          return {
            text: 'Starting Task B',
            toolCalls: [{ name: 'goToCoordinates', args: { x: 10, y: 64, z: 10 } }],
          };
        }
      }

      // Handling tool responses
      if (input.type === 'tool') {
        if (isTaskB) {
          return {
            text: 'Task B reached destination (10, 64, 10) successfully.',
          };
        }
        // If still in Task A, delay to allow preemption
        await new Promise((r) => setTimeout(r, 400));
        return {
          text: 'Continuing Task A to distant coordinates',
          toolCalls: [{ name: 'goToCoordinates', args: { x: 99, y: 64, z: 99 } }],
        };
      }

      return { text: 'Done' };
    });

    // 2. Start Task A
    ctx.harness.coordinator.assignTask({
      goal: 'Task A: navigate far',
      user: 'UserAlex',
    });

    await ctx.harness.waitFor(() => ctx.harness.planner.isExecuting(), 2000);
    expect(ctx.harness.planner.isExecuting()).toBe(true);

    // 3. Rapidly assign Task B before Task A completes
    await ctx.harness.coordinator.assignTask({
      goal: 'Task B: navigate near',
      user: 'UserAlex',
    });

    // 4. Wait for Task B to complete
    await ctx.harness.waitForPlannerCompletion(4000);

    // 5. Assertions:
    // a. Planner has completed
    expect(ctx.harness.planner.isExecuting()).toBe(false);

    // b. Bot reached Task B destination (10, 64, 10), NOT Task A destination (99, 64, 99)
    ctx.assertBotPosition({ x: 10, y: 64, z: 10 });
  });
});
