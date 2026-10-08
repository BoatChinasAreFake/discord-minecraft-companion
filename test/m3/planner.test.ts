import { describe, it, expect, beforeEach } from 'vitest';
import { GeminiPlanner } from '../../src/ai/planner.js';
import { MockGeminiClient, MockGeminiSession } from '../mocks/mockGemini.js';
import { MockMinecraftAgent, MockWorld } from '../mocks/mockMinecraft.js';
import type { PlanningContext, PlannerStepEvent } from '../../src/ai/types.js';

describe('Milestone 3: Gemini AI Planning Loop (planner.ts)', () => {
  let mockGemini: MockGeminiClient;
  let mockAgent: MockMinecraftAgent;
  let planner: GeminiPlanner;
  let context: PlanningContext;

  beforeEach(async () => {
    mockGemini = new MockGeminiClient();
    mockAgent = new MockMinecraftAgent();
    await mockAgent.connect({ host: 'localhost', port: 25565, username: 'TestBot' });

    planner = new GeminiPlanner(mockGemini, mockAgent, {
      maxToolTurns: 10,
    });

    context = {
      botStatus: mockAgent.getStatus(),
      userPrompt: '',
      source: 'discord_slash',
      senderTag: 'PlayerOne',
      channelId: 'bridge-1',
    };
  });

  describe('Single-Step Goal Decomposition', () => {
    it('executes goToCoordinates goal and emits full event lifecycle', async () => {
      const events: PlannerStepEvent[] = [];
      const goal = 'go to 50 64 -100';

      for await (const event of planner.executeGoal(goal, context)) {
        events.push(event);
      }

      const types = events.map((e) => e.type);
      expect(types).toContain('thought');
      expect(types).toContain('tool_call');
      expect(types).toContain('tool_result');
      expect(types).toContain('done');

      // Verify tool_call parameters
      const callEvent = events.find((e) => e.type === 'tool_call')!;
      expect(callEvent.toolName).toBe('goToCoordinates');
      expect(callEvent.toolArgs).toEqual({ x: 50, y: 64, z: -100 });

      // Verify tool_result
      const resultEvent = events.find((e) => e.type === 'tool_result')!;
      expect(resultEvent.toolName).toBe('goToCoordinates');
      expect((resultEvent.result as any).success).toBe(true);

      // Verify bot position updated
      const status = mockAgent.getStatus();
      expect(status.position).toEqual({ x: 50, y: 64, z: -100 });
    });

    it('executes followPlayer goal', async () => {
      const events: PlannerStepEvent[] = [];
      for await (const event of planner.executeGoal('follow Steve within 4 blocks', context)) {
        events.push(event);
      }

      const callEvent = events.find((e) => e.type === 'tool_call');
      expect(callEvent).toBeDefined();
      expect(callEvent?.toolName).toBe('followPlayer');
      expect(callEvent?.toolArgs).toEqual({ playerName: 'Steve', distance: 4 });

      const resEvent = events.find((e) => e.type === 'tool_result');
      expect((resEvent?.result as any).success).toBe(true);
    });

    it('executes reportStatus goal', async () => {
      const events: PlannerStepEvent[] = [];
      for await (const event of planner.executeGoal('report status', context)) {
        events.push(event);
      }

      const callEvent = events.find((e) => e.type === 'tool_call');
      expect(callEvent?.toolName).toBe('reportStatus');

      const resEvent = events.find((e) => e.type === 'tool_result');
      expect((resEvent?.result as any).success).toBe(true);
      expect((resEvent?.result as any).details).toBeDefined();
    });

    it('executes sleepInBed goal', async () => {
      // Place an accessible bed in the world
      mockAgent.world.setBlock({ x: 1, y: 64, z: 0 }, 'red_bed');

      const events: PlannerStepEvent[] = [];
      for await (const event of planner.executeGoal('sleep in bed', context)) {
        events.push(event);
      }

      const callEvent = events.find((e) => e.type === 'tool_call');
      expect(callEvent?.toolName).toBe('sleepInBed');

      const resEvent = events.find((e) => e.type === 'tool_result');
      expect((resEvent?.result as any).success).toBe(true);
    });
  });

  describe('Multi-Step Goal Decomposition', () => {
    it('executes composite 2-step plan (gatherResource then craftItem)', async () => {
      // Place exposed oak_log near the bot so gatherResource succeeds
      mockAgent.world.setBlock({ x: 2, y: 64, z: 0 }, 'oak_log');
      mockAgent.world.setBlock({ x: 2, y: 65, z: 0 }, 'oak_log');
      mockAgent.world.setBlock({ x: 2, y: 66, z: 0 }, 'oak_log');

      const events: PlannerStepEvent[] = [];
      const goal = 'gather 3 oak_log and craft crafting_table';

      for await (const event of planner.executeGoal(goal, context)) {
        events.push(event);
      }

      const toolCalls = events.filter((e) => e.type === 'tool_call');
      expect(toolCalls.length).toBeGreaterThanOrEqual(2);
      expect(toolCalls[0].toolName).toBe('gatherResource');
      expect(toolCalls[1].toolName).toBe('craftItem');

      const toolResults = events.filter((e) => e.type === 'tool_result');
      expect(toolResults.length).toBeGreaterThanOrEqual(2);
      expect((toolResults[0].result as any).success).toBe(true);
      expect((toolResults[1].result as any).success).toBe(true);

      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
    });
  });

  describe('Fair-Play Validation Interception in Loop', () => {
    it('intercepts illegal coordinates (Y=500), yields error, and passes failure to session', async () => {
      // Script a tool call with illegal Y coordinate
      mockGemini.setScriptedTurns([
        {
          toolCalls: [{ name: 'goToCoordinates', args: { x: 10, y: 500, z: 20 } }],
        },
        {
          text: 'Acknowledged coordinate validation error. Task aborted.',
        },
      ]);

      const events: PlannerStepEvent[] = [];
      for await (const event of planner.executeGoal('teleport to sky', context)) {
        events.push(event);
      }

      const errorEvent = events.find(
        (e) => e.type === 'error' && e.message?.includes('Fair-play validation failed')
      );
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.message).toContain('survival world bounds');

      const resEvent = events.find((e) => e.type === 'tool_result');
      expect((resEvent?.result as any).success).toBe(false);
      expect((resEvent?.result as any).message).toContain('Fair-play validation failed');

      // Planner should complete without crashing
      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
    });

    it('intercepts forbidden item request (bedrock), yields error without crashing', async () => {
      mockGemini.setScriptedTurns([
        {
          toolCalls: [{ name: 'craftItem', args: { item: 'bedrock', count: 1 } }],
        },
        {
          text: 'Bedrock is unobtainable in survival.',
        },
      ]);

      const events: PlannerStepEvent[] = [];
      for await (const event of planner.executeGoal('craft bedrock', context)) {
        events.push(event);
      }

      const errorEvent = events.find(
        (e) => e.type === 'error' && e.message?.includes('Fair-play validation failed')
      );
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.message).toMatch(/forbidden|creative-only/i);
    });

    it('intercepts OP command injection in arguments', async () => {
      mockGemini.setScriptedTurns([
        {
          toolCalls: [{ name: 'stopCurrentTask', args: { reason: '/op Hacker' } }],
        },
        {
          text: 'Cannot inject OP commands.',
        },
      ]);

      const events: PlannerStepEvent[] = [];
      for await (const event of planner.executeGoal('stop with hack', context)) {
        events.push(event);
      }

      const errorEvent = events.find(
        (e) => e.type === 'error' && e.message?.includes('Fair-play validation failed')
      );
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.message).toContain('privileged command');
    });
  });

  describe('10-Turn Safety Guard against Infinite Loops', () => {
    it('halts and yields error after reaching max turns (custom limit 3)', async () => {
      const tightPlanner = new GeminiPlanner(mockGemini, mockAgent, {
        maxToolTurns: 3,
      });

      // Provide infinite sequence of tool calls
      mockGemini.setCustomHandler(async (input) => ({
        toolCalls: [
          {
            name: 'reportStatus',
            args: { includeInventory: false },
          },
        ],
      }));

      const events: PlannerStepEvent[] = [];
      for await (const event of tightPlanner.executeGoal('infinite loop test', context)) {
        events.push(event);
      }

      const guardError = events.find(
        (e) => e.type === 'error' && e.message?.includes('Maximum tool turn guard reached')
      );
      expect(guardError).toBeDefined();
      expect(guardError?.message).toContain('3 turns');

      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
      expect(doneEvent?.message).toContain('maximum turn limit');
    });

    it('halts at default 10 turns when looping continues', async () => {
      mockGemini.setCustomHandler(async () => ({
        toolCalls: [{ name: 'reportStatus', args: {} }],
      }));

      const events: PlannerStepEvent[] = [];
      for await (const event of planner.executeGoal('loop 10 test', context)) {
        events.push(event);
      }

      const guardError = events.find(
        (e) => e.type === 'error' && e.message?.includes('Maximum tool turn guard reached')
      );
      expect(guardError).toBeDefined();
      expect(guardError?.message).toContain('10 turns');
    });
  });

  describe('Emergency Cancellation Protocol', () => {
    it('aborts execution when cancelCurrentGoal() is invoked mid-step', async () => {
      // Simulate slow step
      mockGemini.setCustomHandler(async (input) => {
        if (input.type === 'user') {
          // Trigger cancellation while inside the stream
          setTimeout(() => planner.cancelCurrentGoal(), 10);
          return {
            toolCalls: [{ name: 'goToCoordinates', args: { x: 10, y: 64, z: 10 } }],
          };
        }
        return { text: 'Next step' };
      });

      const events: PlannerStepEvent[] = [];
      for await (const event of planner.executeGoal('navigate slowly', context)) {
        events.push(event);
        if (event.type === 'tool_call') {
          planner.cancelCurrentGoal();
        }
      }

      expect(planner.isExecuting()).toBe(false);
      const errorEvent = events.find(
        (e) => e.type === 'error' && e.message?.includes('aborted by user signal')
      );
      expect(errorEvent).toBeDefined();

      const doneEvent = events.find(
        (e) => e.type === 'done' && e.message?.includes('Halted by cancellation')
      );
      expect(doneEvent).toBeDefined();
    });
  });

  describe('Conversational Non-Tool Prompts', () => {
    it('handles direct text without calling any tools', async () => {
      const events: PlannerStepEvent[] = [];
      for await (const event of planner.executeGoal('Who are you?', context)) {
        events.push(event);
      }

      const toolCalls = events.filter((e) => e.type === 'tool_call');
      expect(toolCalls).toHaveLength(0);

      const progressEvent = events.find((e) => e.type === 'progress');
      expect(progressEvent).toBeDefined();

      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
    });
  });

  describe('Tool Failure Handling (e.g. Block Not Found)', () => {
    it('returns informative failure when resource is not visible in world', async () => {
      // Empty world: no diamond_ore
      const events: PlannerStepEvent[] = [];
      for await (const event of planner.executeGoal('gather 1 diamond_ore', context)) {
        events.push(event);
      }

      const resultEvent = events.find((e) => e.type === 'tool_result');
      expect(resultEvent).toBeDefined();
      expect((resultEvent?.result as any).success).toBe(false);
      expect((resultEvent?.result as any).message).toContain('Could not find any exposed, visible');
    });
  });
});
