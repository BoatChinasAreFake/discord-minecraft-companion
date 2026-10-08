import { describe, it, expect, beforeEach } from 'vitest';
import { GeminiClient, GeminiSession } from '../../src/ai/geminiClient.js';
import { MockGeminiClient, MockGeminiSession } from '../mocks/mockGemini.js';
import type { IGeminiClient, IGeminiSession } from '../../src/ai/types.js';
import { FAIR_PLAY_TOOLS, TOOL_NAMES } from '../../src/ai/tools/definitions.js';

describe('Milestone 3: Gemini Client Integration & Mock Provider', () => {
  describe('Live GeminiClient Initialization', () => {
    it('initializes with gemini-3.8-flash model by default', () => {
      const client = new GeminiClient({ apiKey: 'mock-key-for-init' });
      expect(client.modelName).toBe('gemini-3.8-flash');
      expect(typeof client.createSession).toBe('function');
    });

    it('initializes from AppConfig object', () => {
      const mockConfig: any = {
        gemini: {
          apiKey: 'config-key',
          model: 'gemini-3.8-flash',
          maxToolSteps: 5,
        },
      };
      const client = new GeminiClient(mockConfig);
      expect(client.modelName).toBe('gemini-3.8-flash');
    });

    it('allows custom model specification', () => {
      const client = new GeminiClient({ apiKey: 'test-key', model: 'custom-model-v1' });
      expect(client.modelName).toBe('custom-model-v1');
    });

    it('creates a session with session history and methods', async () => {
      const client = new GeminiClient({ apiKey: 'mock-key' });
      const session = await client.createSession({ systemInstruction: 'Test instructions' });
      expect(session).toBeDefined();
      expect(typeof session.sendUserMessage).toBe('function');
      expect(typeof session.sendToolResponse).toBe('function');
      expect(typeof session.getHistory).toBe('function');
    });
  });

  describe('Interface Substitution Guarantee (Live vs Mock)', () => {
    it('MockGeminiClient satisfies IGeminiClient interface seamlessly', async () => {
      const liveClient: IGeminiClient = new GeminiClient({ apiKey: 'test' });
      const mockClient: IGeminiClient = new MockGeminiClient();

      expect(typeof liveClient.createSession).toBe('function');
      expect(typeof mockClient.createSession).toBe('function');

      const mockSession: IGeminiSession = await mockClient.createSession();
      expect(typeof mockSession.sendUserMessage).toBe('function');
      expect(typeof mockSession.sendToolResponse).toBe('function');
      expect(typeof mockSession.getHistory).toBe('function');
    });
  });

  describe('Offline MockGeminiProvider Deterministic Heuristics', () => {
    let mockClient: MockGeminiClient;
    let session: MockGeminiSession;

    beforeEach(async () => {
      mockClient = new MockGeminiClient();
      session = (await mockClient.createSession()) as MockGeminiSession;
    });

    it('parses goToCoordinates intent from natural language', async () => {
      const res = await session.sendUserMessage('go to 150 64 -300');
      expect(res.toolCalls).toHaveLength(1);
      expect(res.toolCalls![0].name).toBe('goToCoordinates');
      expect(res.toolCalls![0].args).toEqual({ x: 150, y: 64, z: -300 });
    });

    it('parses followPlayer intent with custom distance', async () => {
      const res = await session.sendUserMessage('follow Steve within 5 blocks');
      expect(res.toolCalls).toHaveLength(1);
      expect(res.toolCalls![0].name).toBe('followPlayer');
      expect(res.toolCalls![0].args).toEqual({ playerName: 'Steve', distance: 5 });
    });

    it('parses gatherResource intent with quantity and block type', async () => {
      const res = await session.sendUserMessage('gather 12 iron_ore');
      expect(res.toolCalls).toHaveLength(1);
      expect(res.toolCalls![0].name).toBe('gatherResource');
      expect(res.toolCalls![0].args).toEqual({
        blockType: 'iron_ore',
        count: 12,
        maxSearchRadius: 16,
      });
    });

    it('parses defendArea intent with radius', async () => {
      const res = await session.sendUserMessage('defend area within radius 20');
      expect(res.toolCalls).toHaveLength(1);
      expect(res.toolCalls![0].name).toBe('defendArea');
      expect(res.toolCalls![0].args).toEqual({ radius: 20, targetHostilesOnly: true });
    });

    it('parses reportStatus intent', async () => {
      const res = await session.sendUserMessage('report status and inventory');
      expect(res.toolCalls).toHaveLength(1);
      expect(res.toolCalls![0].name).toBe('reportStatus');
      expect(res.toolCalls![0].args).toEqual({
        includeInventory: true,
        includePosition: true,
      });
    });

    it('parses stopCurrentTask intent', async () => {
      const res = await session.sendUserMessage('stop active task immediately');
      expect(res.toolCalls).toHaveLength(1);
      expect(res.toolCalls![0].name).toBe('stopCurrentTask');
      expect(res.toolCalls![0].args).toEqual({ reason: 'User requested halt' });
    });

    it('parses craftItem intent', async () => {
      const res = await session.sendUserMessage('craft 4 torches');
      expect(res.toolCalls).toHaveLength(1);
      expect(res.toolCalls![0].name).toBe('craftItem');
      expect(res.toolCalls![0].args).toEqual({ item: 'torches', count: 4 });
    });

    it('parses sleepInBed intent', async () => {
      const res = await session.sendUserMessage('sleep in bed');
      expect(res.toolCalls).toHaveLength(1);
      expect(res.toolCalls![0].name).toBe('sleepInBed');
      expect(res.toolCalls![0].args).toEqual({});
    });

    it('parses deposit container intent', async () => {
      const res = await session.sendUserMessage('deposit 16 cobblestone');
      expect(res.toolCalls).toHaveLength(1);
      expect(res.toolCalls![0].name).toBe('depositOrRetrieve');
      expect(res.toolCalls![0].args).toEqual({
        action: 'deposit',
        items: [{ name: 'cobblestone', count: 16 }],
      });
    });

    it('parses retrieve container intent', async () => {
      const res = await session.sendUserMessage('retrieve 5 cooked_beef');
      expect(res.toolCalls).toHaveLength(1);
      expect(res.toolCalls![0].name).toBe('depositOrRetrieve');
      expect(res.toolCalls![0].args).toEqual({
        action: 'retrieve',
        items: [{ name: 'cooked_beef', count: 5 }],
      });
    });

    it('handles conversational input with text response and no tool calls', async () => {
      const res = await session.sendUserMessage('Hello bot, what is the weather like?');
      expect(res.text).toBeDefined();
      expect(res.toolCalls).toBeUndefined();
    });
  });

  describe('Multi-Turn Heuristic State Machine & Composite Goals', () => {
    it('simulates composite 2-step goal (gather -> craft)', async () => {
      const client = new MockGeminiClient();
      const session = (await client.createSession()) as MockGeminiSession;

      // Turn 1: user prompt triggers gatherResource
      const turn1 = await session.sendUserMessage('gather 3 oak_log and craft crafting_table');
      expect(turn1.toolCalls).toHaveLength(1);
      expect(turn1.toolCalls![0].name).toBe('gatherResource');

      // Turn 2: tool response for gatherResource triggers queued craftItem
      const turn2 = await session.sendToolResponse('gatherResource', {
        success: true,
        message: 'Gathered 3 oak_log',
      });
      expect(turn2.toolCalls).toHaveLength(1);
      expect(turn2.toolCalls![0].name).toBe('craftItem');

      // Turn 3: tool response for craftItem completes plan
      const turn3 = await session.sendToolResponse('craftItem', {
        success: true,
        message: 'Crafted crafting_table',
      });
      expect(turn3.toolCalls).toBeUndefined();
      expect(turn3.text).toContain('completed successfully');
    });

    it('tracks full turn history in getHistory()', async () => {
      const client = new MockGeminiClient();
      const session = await client.createSession();

      await session.sendUserMessage('navigate to 10 64 20');
      await session.sendToolResponse('goToCoordinates', { success: true });

      const history = session.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(4); // user, model, tool, model
      expect((history[0] as any).role).toBe('user');
      expect((history[1] as any).role).toBe('model');
      expect((history[2] as any).role).toBe('tool');
      expect((history[3] as any).role).toBe('model');
    });
  });

  describe('Scripted Turn Overrides for Deterministic Testing', () => {
    it('plays back scripted turns sequentially', async () => {
      const client = new MockGeminiClient();
      const session = (await client.createSession()) as MockGeminiSession;

      session.setScriptedTurns([
        {
          text: 'Step 1: Heading to coordinates',
          toolCalls: [{ name: 'goToCoordinates', args: { x: 1, y: 64, z: 1 } }],
        },
        {
          text: 'Step 2: Checking area status',
          toolCalls: [{ name: 'reportStatus', args: {} }],
        },
        {
          text: 'All scripted operations completed.',
        },
      ]);

      const res1 = await session.sendUserMessage('do custom test');
      expect(res1.text).toBe('Step 1: Heading to coordinates');
      expect(res1.toolCalls![0].name).toBe('goToCoordinates');

      const res2 = await session.sendToolResponse('goToCoordinates', { success: true });
      expect(res2.text).toBe('Step 2: Checking area status');
      expect(res2.toolCalls![0].name).toBe('reportStatus');

      const res3 = await session.sendToolResponse('reportStatus', { success: true });
      expect(res3.text).toBe('All scripted operations completed.');
      expect(res3.toolCalls).toBeUndefined();
    });

    it('supports custom dynamic handler callback', async () => {
      const client = new MockGeminiClient();
      const session = (await client.createSession()) as MockGeminiSession;

      session.setCustomHandler(async (input) => {
        if (input.type === 'user') {
          return {
            text: `Handler received prompt: ${input.prompt}`,
            toolCalls: [{ name: 'reportStatus', args: {} }],
          };
        }
        return {
          text: `Handler processed tool response from ${input.toolName}`,
        };
      });

      const res1 = await session.sendUserMessage('custom prompt');
      expect(res1.text).toBe('Handler received prompt: custom prompt');
      expect(res1.toolCalls![0].name).toBe('reportStatus');

      const res2 = await session.sendToolResponse('reportStatus', { success: true });
      expect(res2.text).toBe('Handler processed tool response from reportStatus');
    });

    it('rejects on aborted signal', async () => {
      const client = new MockGeminiClient();
      const session = await client.createSession();
      const controller = new AbortController();
      controller.abort();

      await expect(session.sendUserMessage('hello', controller.signal)).rejects.toThrow(
        'Operation aborted'
      );
      await expect(
        session.sendToolResponse('craftItem', {}, undefined, controller.signal)
      ).rejects.toThrow('Operation aborted');
    });
  });

  describe('Fair-Play Tool Declaration Schema Verification', () => {
    it('exports all 9 tool declarations', () => {
      expect(TOOL_NAMES).toHaveLength(9);
      expect(FAIR_PLAY_TOOLS[0].functionDeclarations).toHaveLength(9);
    });

    it('declares function declarations with valid schema names and descriptions', () => {
      const decls = FAIR_PLAY_TOOLS[0].functionDeclarations!;
      for (const decl of decls) {
        expect(TOOL_NAMES).toContain(decl.name);
        expect(decl.description).toBeDefined();
        expect(decl.parameters).toBeDefined();
      }
    });
  });
});
