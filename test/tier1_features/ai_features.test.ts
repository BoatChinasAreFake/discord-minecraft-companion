import { describe, it, expect, beforeEach } from 'vitest';
import { MockGeminiClient, MockGeminiSession } from '../mocks/mockGemini.js';
import {
  FAIR_PLAY_TOOL_DECLARATIONS,
  TOOL_NAMES,
  type ToolName,
} from '../../src/ai/tools/definitions.js';
import {
  validateToolArgs,
  validateToolCall,
  FairPlayValidationError,
} from '../../src/ai/tools/validator.js';
import { GeminiPlanner } from '../../src/ai/planner.js';
import { MockMinecraftAgent, MockWorld } from '../mocks/mockMinecraft.js';
import type { PlanningContext, PlannerStepEvent } from '../../src/ai/types.js';

describe('Tier 1: Gemini AI Planning Bridge Feature Coverage (F35-F39, F42)', () => {
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
      senderTag: 'Commander#0001',
      channelId: 'bridge_channel_1',
    };
  });

  // --------------------------------------------------------------------------
  // Mock Initialization & History Tracking (F35)
  // --------------------------------------------------------------------------
  describe('Mock Gemini Client & History (T1-AI-01)', () => {
    it('T1-AI-01: initializes session with system instruction and tracks chronological conversation history', async () => {
      const session = (await mockGemini.createSession({
        systemInstruction: 'Fair-play Minecraft companion',
      })) as MockGeminiSession;

      expect(session).toBeDefined();

      const res = await session.sendUserMessage('Hello bot, tell me your status');
      expect(res).toBeDefined();

      const history = session.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect((history[0] as any).role).toBe('user');
      expect((history[1] as any).role).toBe('model');
    });
  });

  // --------------------------------------------------------------------------
  // 9 Structured Fair-Play Tool Declarations (F36)
  // --------------------------------------------------------------------------
  describe('Structured Fair-Play Tool Declarations (T1-AI-02)', () => {
    it('T1-AI-02: exposes exactly 9 fair-play tool declarations with names, schemas, and descriptions', () => {
      expect(TOOL_NAMES).toHaveLength(9);
      expect(FAIR_PLAY_TOOL_DECLARATIONS).toHaveLength(9);

      const expectedNames: ToolName[] = [
        'goToCoordinates',
        'followPlayer',
        'gatherResource',
        'defendArea',
        'reportStatus',
        'stopCurrentTask',
        'craftItem',
        'sleepInBed',
        'depositOrRetrieve',
      ];

      for (const name of expectedNames) {
        expect(TOOL_NAMES).toContain(name);
        const decl = FAIR_PLAY_TOOL_DECLARATIONS.find((d) => d.name === name);
        expect(decl).toBeDefined();
        expect(decl?.description).toBeDefined();
        expect(decl?.parameters?.type).toBe('OBJECT');
      }
    });
  });

  // --------------------------------------------------------------------------
  // Tool Argument Validator (F37)
  // --------------------------------------------------------------------------
  describe('Tool Argument Validator (T1-AI-03, T1-AI-04)', () => {
    it('T1-AI-03: validates legitimate arguments for all 9 fair-play tools without errors', () => {
      const validCases: Array<{ tool: ToolName; args: any }> = [
        { tool: 'goToCoordinates', args: { x: 10, y: 64, z: -10 } },
        { tool: 'followPlayer', args: { playerName: 'Steve', distance: 3 } },
        { tool: 'gatherResource', args: { blockType: 'oak_log', count: 5 } },
        { tool: 'defendArea', args: { radius: 15, targetHostilesOnly: true } },
        { tool: 'reportStatus', args: { includeInventory: true, includePosition: true } },
        { tool: 'stopCurrentTask', args: { reason: 'User requested pause' } },
        { tool: 'craftItem', args: { item: 'oak_planks', count: 4 } },
        { tool: 'sleepInBed', args: {} },
        {
          tool: 'depositOrRetrieve',
          args: {
            action: 'deposit',
            items: [{ name: 'iron_ingot', count: 5 }],
          },
        },
      ];

      for (const { tool, args } of validCases) {
        // Both validateToolArgs and validateToolCall should succeed
        expect(() => validateToolArgs(tool, args)).not.toThrow();
        const callResult = validateToolCall(tool, args);
        expect(callResult.valid).toBe(true);
      }
    });

    it('T1-AI-04: rejects malformed arguments and throws FairPlayValidationError', () => {
      // 1. Missing required coordinate 'z'
      expect(() =>
        validateToolArgs('goToCoordinates', { x: 10, y: 64 })
      ).toThrow(FairPlayValidationError);

      const resCoord = validateToolCall('goToCoordinates', { x: 10, y: 64 });
      expect(resCoord.valid).toBe(false);

      // 2. Non-string playerName
      expect(() =>
        validateToolArgs('followPlayer', { playerName: 12345 })
      ).toThrow(FairPlayValidationError);

      // 3. Creative/Unobtainable item rejection (bedrock)
      expect(() =>
        validateToolArgs('craftItem', { item: 'bedrock', count: 1 })
      ).toThrow(FairPlayValidationError);
    });
  });

  // --------------------------------------------------------------------------
  // Single-Step & Multi-Step Goal Decomposition (F38)
  // --------------------------------------------------------------------------
  describe('Goal Decomposition & Plan Execution (T1-AI-05, T1-AI-06)', () => {
    it('T1-AI-05: decomposes single-step "navigate to 100 64 -200" into goToCoordinates and executes', async () => {
      const events: PlannerStepEvent[] = [];
      const goal = 'navigate to 100 64 -200';

      for await (const event of planner.executeGoal(goal, context)) {
        events.push(event);
      }

      const types = events.map((e) => e.type);
      expect(types).toContain('thought');
      expect(types).toContain('tool_call');
      expect(types).toContain('tool_result');
      expect(types).toContain('done');

      const callEvent = events.find((e) => e.type === 'tool_call')!;
      expect(callEvent.toolName).toBe('goToCoordinates');
      expect(callEvent.toolArgs).toEqual({ x: 100, y: 64, z: -200 });

      const resultEvent = events.find((e) => e.type === 'tool_result')!;
      expect(resultEvent.toolName).toBe('goToCoordinates');
      expect((resultEvent.result as any).success).toBe(true);

      expect(mockAgent.getStatus().position).toEqual({ x: 100, y: 64, z: -200 });
    });

    it('T1-AI-06: decomposes multi-step "gather 3 oak_log and craft oak_planks" into gatherResource then craftItem', async () => {
      // Place accessible oak logs in the world
      mockAgent.world.setBlock({ x: 1, y: 64, z: 0 }, 'oak_log');
      mockAgent.world.setBlock({ x: 1, y: 65, z: 0 }, 'oak_log');
      mockAgent.world.setBlock({ x: 1, y: 66, z: 0 }, 'oak_log');

      const events: PlannerStepEvent[] = [];
      const goal = 'gather 3 oak_log and craft oak_planks';

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

  // --------------------------------------------------------------------------
  // Tool Result Packaging (F39)
  // --------------------------------------------------------------------------
  describe('Tool Result Packaging (T1-AI-07)', () => {
    it('T1-AI-07: formats tool execution result and stores into session history as role "tool"', async () => {
      const session = (await mockGemini.createSession()) as MockGeminiSession;

      // User prompt triggers tool call
      await session.sendUserMessage('go to 20 64 20');

      // Send tool response
      const toolOutput = { success: true, message: 'Arrived at destination' };
      const turnResponse = await session.sendToolResponse('goToCoordinates', toolOutput);

      expect(turnResponse).toBeDefined();
      const history = session.getHistory();
      const toolEntry = history.find((h: any) => h.role === 'tool');

      expect(toolEntry).toBeDefined();
      expect(toolEntry?.toolName).toBe('goToCoordinates');
      expect((toolEntry?.result as any).message).toBe('Arrived at destination');
      expect((toolEntry?.result as any).success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // In-Memory Regex Heuristic Mock Resolution (F42)
  // --------------------------------------------------------------------------
  describe('In-Memory Regex Heuristic Mock (T1-AI-08)', () => {
    it('T1-AI-08: parses diverse user intents deterministically via regex mock without external API', async () => {
      const session = (await mockGemini.createSession()) as MockGeminiSession;

      // 1. Coordinates navigation
      const res1 = await session.sendUserMessage('come to 50 70 50');
      expect(res1.toolCalls?.[0].name).toBe('goToCoordinates');
      expect(res1.toolCalls?.[0].args).toEqual({ x: 50, y: 70, z: 50 });

      // 2. Area defense
      const res2 = await session.sendUserMessage('protect area within 20');
      expect(res2.toolCalls?.[0].name).toBe('defendArea');
      expect(res2.toolCalls?.[0].args).toEqual({ radius: 20, targetHostilesOnly: true });

      // 3. Status report
      const res3 = await session.sendUserMessage('report status');
      expect(res3.toolCalls?.[0].name).toBe('reportStatus');

      // 4. Emergency halt
      const res4 = await session.sendUserMessage('stop now');
      expect(res4.toolCalls?.[0].name).toBe('stopCurrentTask');
    });
  });
});
