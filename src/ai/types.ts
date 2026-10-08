/**
 * Interface contracts for Gemini AI Planning & Coordination Bridge.
 *
 * Defines tool call requests, turn responses, live/mock interchangeable client
 * and session interfaces, planning context, and step events.
 */

import type { MinecraftBotStatus, ActionResult } from '../minecraft/types.js';

export interface ToolCallRequest {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiTurnResponse {
  text?: string;
  toolCalls?: ToolCallRequest[];
}

export interface IGeminiSession {
  sendUserMessage(prompt: string, signal?: AbortSignal): Promise<GeminiTurnResponse>;
  sendToolResponse(toolName: string, result: unknown, callId?: string, signal?: AbortSignal): Promise<GeminiTurnResponse>;
  getHistory(): unknown[];
}

export interface CreateSessionOptions {
  systemInstruction?: string;
  model?: string;
  temperature?: number;
}

export interface IGeminiClient {
  createSession(options?: CreateSessionOptions): Promise<IGeminiSession>;
}

export interface PlanningContext {
  botStatus: MinecraftBotStatus;
  userPrompt: string;
  source: 'discord_text' | 'discord_slash' | 'discord_voice';
  senderTag?: string;
  channelId?: string;
}

export interface PlannerStepEvent {
  type: 'thought' | 'tool_call' | 'tool_result' | 'progress' | 'error' | 'done';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  message?: string;
  result?: ActionResult | unknown;
  turn?: number;
  timestamp?: number;
}

export interface PlannerOptions {
  maxToolTurns?: number; // default: 10
  timeoutMs?: number;    // default: 120000 (2 minutes)
}

export interface IGeminiPlanner {
  executeGoal(goalText: string, context: PlanningContext): AsyncIterable<PlannerStepEvent>;
  cancelCurrentGoal(): void;
  isExecuting(): boolean;
}
