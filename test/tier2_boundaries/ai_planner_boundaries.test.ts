import { describe, it, expect, beforeEach } from 'vitest';
import { GeminiPlanner } from '../../src/ai/planner.js';
import {
  validateToolArgs,
  validateToolCall,
  FairPlayValidationError,
} from '../../src/ai/tools/validator.js';
import { AgentCoordinator } from '../../src/coordinator/agentCoordinator.js';
import { ProgressReporter } from '../../src/coordinator/progressReporter.js';
import { MockGeminiClient } from '../mocks/mockGemini.js';
import { MockMinecraftAgent } from '../mocks/mockMinecraft.js';
import { MockDiscordGateway } from '../mocks/mockDiscord.js';
import type { PlanningContext, PlannerStepEvent } from '../../src/ai/types.js';
import type { AppConfig } from '../../src/config/types.js';

describe('Tier 2: AI Planner Boundaries & Failure Recovery (T2-PLN-01 to T2-PLN-10)', () => {
  let mockGemini: MockGeminiClient;
  let mockAgent: MockMinecraftAgent;
  let mockDiscord: MockDiscordGateway;
  let planner: GeminiPlanner;
  let progressReporter: ProgressReporter;
  let context: PlanningContext;
  let appConfig: AppConfig;

  beforeEach(async () => {
    mockGemini = new MockGeminiClient();
    mockAgent = new MockMinecraftAgent();
    await mockAgent.connect({ host: 'localhost', port: 25565, username: 'TestBot' });

    planner = new GeminiPlanner(mockGemini, mockAgent, {
      maxToolTurns: 10,
    });

    mockDiscord = new MockDiscordGateway({
      botUserId: 'bot_101',
      chatBridgeChannelId: 'bridge_channel_1',
    });

    progressReporter = new ProgressReporter(mockDiscord, null, {
      defaultChannelId: 'bridge_channel_1',
      enableVoiceTTS: false,
    });

    context = {
      botStatus: mockAgent.getStatus(),
      userPrompt: '',
      source: 'discord_slash',
      senderTag: 'Commander#0001',
      channelId: 'bridge_channel_1',
    };

    appConfig = {
      discord: {
        token: 'test',
        clientId: 'bot_101',
        chatBridgeChannelId: 'bridge_channel_1',
        statusChannelId: 'status_channel_1',
        voiceChannelId: 'voice_channel_1',
      },
      minecraft: {
        host: 'localhost',
        port: 25565,
        username: 'TestBot',
      },
      gemini: {
        apiKey: 'key',
        model: 'gemini-3.8-flash',
      },
      rbac: {
        adminUserIds: ['admin_1'],
        adminRoleIds: [],
        allowedUserIds: ['op_1'],
        allowedRoleIds: [],
      },
      tts: { provider: 'mock' },
      stt: { provider: 'mock' },
    };
  });

  // --------------------------------------------------------------------------
  // Goal String Boundaries (T2-PLN-01 to T2-PLN-03)
  // --------------------------------------------------------------------------
  describe('Goal String Boundaries (T2-PLN-01 to T2-PLN-03)', () => {
    it('T2-PLN-01: empty goal string prompt yields error event or failure notification', async () => {
      mockGemini.setCustomHandler(async (input) => {
        if (!input.prompt || !input.prompt.trim()) {
          throw new Error('Goal prompt cannot be empty');
        }
        return { text: 'Done' };
      });

      const events: PlannerStepEvent[] = [];
      for await (const event of planner.executeGoal('', context)) {
        events.push(event);
      }

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.message).toContain('Goal prompt cannot be empty');
    });

    it('T2-PLN-02: whitespace-only goal prompt emits error event without executing actions', async () => {
      let executedAction = false;
      mockGemini.setCustomHandler(async (input) => {
        if (!input.prompt || !input.prompt.trim()) {
          throw new Error('Goal prompt cannot be whitespace');
        }
        executedAction = true;
        return { text: 'Done' };
      });

      const events: PlannerStepEvent[] = [];
      for await (const event of planner.executeGoal('   \t\n  ', context)) {
        events.push(event);
      }

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.message).toContain('Goal prompt cannot be whitespace');
      expect(executedAction).toBe(false);
    });

    it('T2-PLN-03: processes long goal prompt (1200 characters) safely without stack overflow', async () => {
      const longGoal = 'gather wood and protect area '.repeat(45); // > 1200 chars
      expect(longGoal.length).toBeGreaterThan(1200);

      const events: PlannerStepEvent[] = [];
      for await (const event of planner.executeGoal(longGoal, context)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Infinite Loop Cutoff (T2-PLN-04)
  // --------------------------------------------------------------------------
  describe('Infinite Loop Guard (T2-PLN-04)', () => {
    it('T2-PLN-04: halts at turn 10 and yields error when maxToolTurns limit is reached (infinite loop guard)', async () => {
      mockGemini.setCustomHandler(async () => ({
        toolCalls: [
          {
            name: 'goToCoordinates',
            args: { x: 0, y: 64, z: 0 },
          },
        ],
      }));

      const events: PlannerStepEvent[] = [];
      for await (const event of planner.executeGoal('loop endlessly', context)) {
        events.push(event);
      }

      const guardError = events.find(
        (e) => e.type === 'error' && e.message?.includes('Maximum tool turn guard reached')
      );
      expect(guardError).toBeDefined();
      expect(guardError?.message).toContain('10 turns');

      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
      expect(doneEvent?.message).toContain('maximum turn limit');
    });
  });

  // --------------------------------------------------------------------------
  // Tool Validator Boundaries (T2-PLN-05 to T2-PLN-08)
  // --------------------------------------------------------------------------
  describe('Tool Parameter Validator Boundaries (T2-PLN-05 to T2-PLN-08)', () => {
    it('T2-PLN-05: rejects vertical out-of-bounds coordinates (y < -64 or y > 320) via validation interceptor', () => {
      // Y below bedrock floor (-64)
      expect(() =>
        validateToolArgs('goToCoordinates', { x: 0, y: -70, z: 0 })
      ).toThrow(FairPlayValidationError);

      const lowResult = validateToolCall('goToCoordinates', { x: 0, y: -70, z: 0 });
      expect(lowResult.valid).toBe(false);
      expect(lowResult.error).toContain('survival world bounds');

      // Y above world ceiling (320)
      expect(() =>
        validateToolArgs('goToCoordinates', { x: 0, y: 350, z: 0 })
      ).toThrow(FairPlayValidationError);

      const highResult = validateToolCall('goToCoordinates', { x: 0, y: 350, z: 0 });
      expect(highResult.valid).toBe(false);
      expect(highResult.error).toContain('survival world bounds');
    });

    it('T2-PLN-06: rejects negative stack count or excessive search radius (> 32) via validation interceptor', () => {
      // Negative count
      expect(() =>
        validateToolArgs('gatherResource', { blockType: 'oak_log', count: -5 })
      ).toThrow(FairPlayValidationError);

      const negCountResult = validateToolCall('gatherResource', { blockType: 'oak_log', count: -5 });
      expect(negCountResult.valid).toBe(false);

      // Search radius > 32 blocks
      expect(() =>
        validateToolArgs('gatherResource', { blockType: 'oak_log', count: 1, maxSearchRadius: 128 })
      ).toThrow(FairPlayValidationError);

      const radiusResult = validateToolCall('gatherResource', { blockType: 'oak_log', count: 1, maxSearchRadius: 128 });
      expect(radiusResult.valid).toBe(false);
    });

    it('T2-PLN-07: rejects invalid craft item parameters (count = 0 or non-positive)', () => {
      expect(() =>
        validateToolArgs('craftItem', { item: 'diamond_sword', count: 0 })
      ).toThrow(FairPlayValidationError);

      const zeroCountResult = validateToolCall('craftItem', { item: 'diamond_sword', count: 0 });
      expect(zeroCountResult.valid).toBe(false);
    });

    it('T2-PLN-08: rejects unregistered or privileged tool invocations (teleportToPlayer)', () => {
      expect(() =>
        validateToolArgs('teleportToPlayer' as any, { user: 'Steve' })
      ).toThrow(FairPlayValidationError);

      const result = validateToolCall('teleportToPlayer', { user: 'Steve' });
      expect(result.valid).toBe(false);
      expect(result.code).toBe('UNKNOWN_TOOL_NAME');
    });
  });

  // --------------------------------------------------------------------------
  // AbortSignal & Disconnection Guard Boundaries (T2-PLN-09, T2-PLN-10)
  // --------------------------------------------------------------------------
  describe('AbortSignal & Disconnection Guard Boundaries (T2-PLN-09, T2-PLN-10)', () => {
    it('T2-PLN-09: immediately aborts execution when cancelCurrentGoal() is invoked mid-step', async () => {
      mockGemini.setCustomHandler(async (input) => {
        if (input.type === 'user') {
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

    it('T2-PLN-10: rejects task assignment when Minecraft agent is disconnected', async () => {
      await mockAgent.disconnect();
      expect(mockAgent.getStatus().connected).toBe(false);

      const coordinator = new AgentCoordinator(
        mockDiscord,
        mockAgent,
        planner,
        progressReporter,
        appConfig
      );

      await expect(
        coordinator.assignTask({ goal: 'mine wood', user: 'TestUser#0001' })
      ).rejects.toThrow('Cannot assign task: Minecraft agent is disconnected.');
    });
  });
});
