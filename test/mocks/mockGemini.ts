/**
 * Offline Mock Gemini Provider.
 *
 * Deterministic offline mock implementation of IGeminiClient and IGeminiSession.
 * Supports heuristic regex parsing for all 9 fair-play tools, multi-turn state
 * machines, and programmable scripted turns for 100% offline hermetic verification.
 */

import type {
  IGeminiClient,
  IGeminiSession,
  CreateSessionOptions,
  GeminiTurnResponse,
  ToolCallRequest,
} from '../../src/ai/types.js';

export interface MockHandlerInput {
  type: 'user' | 'tool';
  prompt?: string;
  toolName?: string;
  result?: unknown;
  callId?: string;
  turn: number;
}

export type MockTurnHandler = (
  input: MockHandlerInput
) => Promise<GeminiTurnResponse> | GeminiTurnResponse;

export class MockGeminiSession implements IGeminiSession {
  private history: unknown[] = [];
  private scriptedTurns: GeminiTurnResponse[] = [];
  private customHandler?: MockTurnHandler;
  private currentTurn = 0;
  private currentGoal: string = '';
  private pendingSubgoals: ToolCallRequest[] = [];

  constructor(public readonly systemInstruction?: string) {}

  public setScriptedTurns(turns: GeminiTurnResponse[]): void {
    this.scriptedTurns = [...turns];
  }

  public addScriptedTurn(turn: GeminiTurnResponse): void {
    this.scriptedTurns.push(turn);
  }

  public setCustomHandler(handler?: MockTurnHandler): void {
    this.customHandler = handler;
  }

  public getHistory(): unknown[] {
    return [...this.history];
  }

  public reset(): void {
    this.history = [];
    this.scriptedTurns = [];
    this.customHandler = undefined;
    this.currentTurn = 0;
    this.currentGoal = '';
    this.pendingSubgoals = [];
  }

  public async sendUserMessage(prompt: string, signal?: AbortSignal): Promise<GeminiTurnResponse> {
    if (signal?.aborted) {
      throw new Error('Operation aborted');
    }

    this.currentTurn++;
    this.currentGoal = prompt;
    this.history.push({ role: 'user', content: prompt, turn: this.currentTurn });

    if (this.customHandler) {
      const handled = await this.customHandler({
        type: 'user',
        prompt,
        turn: this.currentTurn,
      });
      this.recordResponse(handled);
      return handled;
    }

    if (this.scriptedTurns.length > 0) {
      const scripted = this.scriptedTurns.shift()!;
      this.recordResponse(scripted);
      return scripted;
    }

    const response = this.heuristicDecompose(prompt);
    this.recordResponse(response);
    return response;
  }

  public async sendToolResponse(
    toolName: string,
    result: unknown,
    callId?: string,
    signal?: AbortSignal
  ): Promise<GeminiTurnResponse> {
    if (signal?.aborted) {
      throw new Error('Operation aborted');
    }

    this.currentTurn++;
    this.history.push({
      role: 'tool',
      toolName,
      result,
      callId,
      turn: this.currentTurn,
    });

    if (this.customHandler) {
      const handled = await this.customHandler({
        type: 'tool',
        toolName,
        result,
        callId,
        turn: this.currentTurn,
      });
      this.recordResponse(handled);
      return handled;
    }

    if (this.scriptedTurns.length > 0) {
      const scripted = this.scriptedTurns.shift()!;
      this.recordResponse(scripted);
      return scripted;
    }

    // If there was a multi-step composite goal queued
    if (this.pendingSubgoals.length > 0) {
      const nextTool = this.pendingSubgoals.shift()!;
      const response: GeminiTurnResponse = {
        text: `Executing next planned action: ${nextTool.name}`,
        toolCalls: [nextTool],
      };
      this.recordResponse(response);
      return response;
    }

    // Default: action completed, goals satisfied
    const response: GeminiTurnResponse = {
      text: `Action ${toolName} completed successfully. Goal "${this.currentGoal}" has been satisfied.`,
    };
    this.recordResponse(response);
    return response;
  }

  private recordResponse(res: GeminiTurnResponse): void {
    this.history.push({
      role: 'model',
      text: res.text,
      toolCalls: res.toolCalls,
      turn: this.currentTurn,
    });
  }

  private heuristicDecompose(prompt: string): GeminiTurnResponse {
    const trimmed = prompt.trim();

    // 1. Check for composite multi-step: "gather X logs and craft Y"
    const compositeMatch = trimmed.match(
      /(?:gather|collect|chop|mine)\s+(\d+)?\s*([a-zA-Z0-9_]+)\s+and\s+(?:craft|make)\s+(\d+)?\s*([a-zA-Z0-9_]+)/i
    );
    if (compositeMatch) {
      const gatherCount = compositeMatch[1] ? parseInt(compositeMatch[1], 10) : 3;
      const gatherItem = compositeMatch[2];
      const craftCount = compositeMatch[3] ? parseInt(compositeMatch[3], 10) : 1;
      const craftItem = compositeMatch[4];

      this.pendingSubgoals = [
        {
          id: `call_${Date.now()}_craft`,
          name: 'craftItem',
          args: { item: craftItem, count: craftCount },
        },
      ];

      return {
        text: `Planning 2-step survival procedure: first gather ${gatherCount} ${gatherItem}, then craft ${craftCount} ${craftItem}.`,
        toolCalls: [
          {
            id: `call_${Date.now()}_gather`,
            name: 'gatherResource',
            args: { blockType: gatherItem, count: gatherCount, maxSearchRadius: 24 },
          },
        ],
      };
    }

    // 2. goToCoordinates
    const coordsMatch = trimmed.match(
      /(?:go\s+to|navigate\s+to|walk\s+to|come\s+to|coords?)\s+(-?\d+)[,\s]+(-?\d+)[,\s]+(-?\d+)/i
    );
    if (coordsMatch) {
      return {
        text: `Navigating to target coordinates (${coordsMatch[1]}, ${coordsMatch[2]}, ${coordsMatch[3]}).`,
        toolCalls: [
          {
            id: `call_${Date.now()}_goto`,
            name: 'goToCoordinates',
            args: {
              x: parseInt(coordsMatch[1], 10),
              y: parseInt(coordsMatch[2], 10),
              z: parseInt(coordsMatch[3], 10),
            },
          },
        ],
      };
    }

    // 3. followPlayer
    const followMatch = trimmed.match(/(?:follow|come\s+to)\s+([a-zA-Z0-9_]+)(?:\s+within\s+(\d+))?/i);
    if (followMatch) {
      const distance = followMatch[2] ? parseInt(followMatch[2], 10) : 3;
      return {
        text: `Following player ${followMatch[1]} at distance ${distance} blocks.`,
        toolCalls: [
          {
            id: `call_${Date.now()}_follow`,
            name: 'followPlayer',
            args: { playerName: followMatch[1], distance },
          },
        ],
      };
    }

    // 4. gatherResource
    const gatherMatch = trimmed.match(/(?:gather|mine|chop|collect|get)\s+(\d+)?\s*([a-zA-Z0-9_]+)/i);
    if (gatherMatch) {
      const count = gatherMatch[1] ? parseInt(gatherMatch[1], 10) : 1;
      const blockType = gatherMatch[2];
      return {
        text: `Searching for visible ${blockType} to harvest (count: ${count}).`,
        toolCalls: [
          {
            id: `call_${Date.now()}_gather`,
            name: 'gatherResource',
            args: { blockType, count, maxSearchRadius: 16 },
          },
        ],
      };
    }

    // 5. defendArea
    if (/(?:defend|protect|guard|patrol)\b/i.test(trimmed)) {
      const radiusMatch = trimmed.match(/(?:radius|within)\s+(\d+)/i);
      const radius = radiusMatch ? parseInt(radiusMatch[1], 10) : 16;
      return {
        text: `Engaging perimeter defense patrol within radius ${radius} blocks.`,
        toolCalls: [
          {
            id: `call_${Date.now()}_defend`,
            name: 'defendArea',
            args: { radius, targetHostilesOnly: true },
          },
        ],
      };
    }

    // 6. reportStatus
    if (/(?:report\s+status|status|where\s+are\s+you|health|hp|inventory|gear)\b/i.test(trimmed)) {
      return {
        text: 'Inspecting current bot status and inventory overview.',
        toolCalls: [
          {
            id: `call_${Date.now()}_status`,
            name: 'reportStatus',
            args: { includeInventory: true, includePosition: true },
          },
        ],
      };
    }

    // 7. stopCurrentTask
    if (/(?:stop|halt|cancel|abort|freeze)\b/i.test(trimmed)) {
      return {
        text: 'Stopping all active tasks immediately.',
        toolCalls: [
          {
            id: `call_${Date.now()}_stop`,
            name: 'stopCurrentTask',
            args: { reason: 'User requested halt' },
          },
        ],
      };
    }

    // 8. craftItem
    const craftMatch = trimmed.match(/(?:craft|make|create)\s+(\d+)?\s*([a-zA-Z0-9_]+)/i);
    if (craftMatch) {
      const count = craftMatch[1] ? parseInt(craftMatch[1], 10) : 1;
      const item = craftMatch[2];
      return {
        text: `Crafting ${count} ${item}.`,
        toolCalls: [
          {
            id: `call_${Date.now()}_craft`,
            name: 'craftItem',
            args: { item, count },
          },
        ],
      };
    }

    // 9. sleepInBed
    if (/(?:sleep|bed|night)\b/i.test(trimmed)) {
      return {
        text: 'Locating nearby bed to sleep through night/thunderstorm.',
        toolCalls: [
          {
            id: `call_${Date.now()}_sleep`,
            name: 'sleepInBed',
            args: {},
          },
        ],
      };
    }

    // 10. depositOrRetrieve
    const depositMatch = trimmed.match(/(?:deposit|store|put)\s+(\d+)?\s*([a-zA-Z0-9_]+)/i);
    if (depositMatch) {
      const count = depositMatch[1] ? parseInt(depositMatch[1], 10) : 1;
      return {
        text: `Depositing ${count} ${depositMatch[2]} into nearby container.`,
        toolCalls: [
          {
            id: `call_${Date.now()}_deposit`,
            name: 'depositOrRetrieve',
            args: {
              action: 'deposit',
              items: [{ name: depositMatch[2], count }],
            },
          },
        ],
      };
    }

    const retrieveMatch = trimmed.match(/(?:withdraw|retrieve|take|grab)\s+(\d+)?\s*([a-zA-Z0-9_]+)/i);
    if (retrieveMatch) {
      const count = retrieveMatch[1] ? parseInt(retrieveMatch[1], 10) : 1;
      return {
        text: `Retrieving ${count} ${retrieveMatch[2]} from nearby container.`,
        toolCalls: [
          {
            id: `call_${Date.now()}_retrieve`,
            name: 'depositOrRetrieve',
            args: {
              action: 'retrieve',
              items: [{ name: retrieveMatch[2], count }],
            },
          },
        ],
      };
    }

    // Default conversational response without tool calls
    return {
      text: `Understood: "${trimmed}". Standing by for survival directives.`,
    };
  }
}

export class MockGeminiClient implements IGeminiClient {
  public sessions: MockGeminiSession[] = [];
  public scriptedTurnsQueue: GeminiTurnResponse[] = [];
  public defaultCustomHandler?: MockTurnHandler;

  constructor(public readonly modelName: string = 'gemini-3.8-flash') {}

  public setScriptedTurns(turns: GeminiTurnResponse[]): void {
    this.scriptedTurnsQueue = [...turns];
    for (const session of this.sessions) {
      session.setScriptedTurns([...turns]);
    }
  }

  public setCustomHandler(handler?: MockTurnHandler): void {
    this.defaultCustomHandler = handler;
    for (const session of this.sessions) {
      session.setCustomHandler(handler);
    }
  }

  public async createSession(options?: CreateSessionOptions): Promise<IGeminiSession> {
    const session = new MockGeminiSession(options?.systemInstruction);
    if (this.scriptedTurnsQueue.length > 0) {
      session.setScriptedTurns([...this.scriptedTurnsQueue]);
    }
    if (this.defaultCustomHandler) {
      session.setCustomHandler(this.defaultCustomHandler);
    }
    this.sessions.push(session);
    return session;
  }

  public getLastSession(): MockGeminiSession | undefined {
    return this.sessions[this.sessions.length - 1];
  }

  public reset(): void {
    this.sessions = [];
    this.scriptedTurnsQueue = [];
    this.defaultCustomHandler = undefined;
  }
}
