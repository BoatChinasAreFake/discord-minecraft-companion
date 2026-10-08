/**
 * Google Gemini SDK Integration.
 *
 * Implements IGeminiClient and IGeminiSession using official @google/genai
 * configured for gemini-3.8-flash and 9 structured fair-play tools.
 */

import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai';
import type { AppConfig } from '../config/types.js';
import { FAIR_PLAY_TOOLS } from './tools/definitions.js';
import type {
  IGeminiClient,
  IGeminiSession,
  CreateSessionOptions,
  GeminiTurnResponse,
  ToolCallRequest,
} from './types.js';

export class GeminiSession implements IGeminiSession {
  private history: unknown[] = [];

  constructor(
    private chat: any,
    private systemInstruction?: string
  ) {}

  public async sendUserMessage(prompt: string, signal?: AbortSignal): Promise<GeminiTurnResponse> {
    if (signal?.aborted) {
      throw new Error('Operation aborted');
    }

    this.history.push({ role: 'user', content: prompt });
    const response = await this.chat.sendMessage({ message: prompt });

    return this.parseResponse(response);
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

    const responsePayload =
      result && typeof result === 'object'
        ? (result as Record<string, unknown>)
        : { output: result };

    this.history.push({
      role: 'tool',
      toolName,
      callId,
      response: responsePayload,
    });

    const response = await this.chat.sendMessage({
      message: [
        {
          functionResponse: {
            name: toolName,
            response: responsePayload,
            id: callId,
          },
        },
      ],
    });

    return this.parseResponse(response);
  }

  public getHistory(): unknown[] {
    try {
      if (this.chat && typeof this.chat.getHistory === 'function') {
        const liveHistory = this.chat.getHistory();
        if (Array.isArray(liveHistory) && liveHistory.length > 0) {
          return liveHistory;
        }
      }
    } catch {
      // Fallback to local recorded history
    }
    return [...this.history];
  }

  private parseResponse(response: any): GeminiTurnResponse {
    const result: GeminiTurnResponse = {};

    if (response?.text) {
      result.text = response.text;
    }

    if (response?.functionCalls && Array.isArray(response.functionCalls)) {
      result.toolCalls = response.functionCalls.map((call: any): ToolCallRequest => ({
        id: call.id,
        name: call.name,
        args: (call.args as Record<string, unknown>) ?? {},
      }));
    }

    if (result.text || result.toolCalls) {
      this.history.push({
        role: 'model',
        text: result.text,
        toolCalls: result.toolCalls,
      });
    }

    return result;
  }
}

export class GeminiClient implements IGeminiClient {
  private ai: GoogleGenAI;
  public readonly modelName: string;

  constructor(options: { apiKey: string; model?: string } | AppConfig) {
    const apiKey = 'gemini' in options ? options.gemini.apiKey : options.apiKey;
    const model = 'gemini' in options ? options.gemini.model : options.model;
    this.modelName = model || 'gemini-3.8-flash';
    this.ai = new GoogleGenAI({ apiKey });
  }

  public async createSession(options?: CreateSessionOptions): Promise<IGeminiSession> {
    const chat = this.ai.chats.create({
      model: options?.model || this.modelName,
      config: {
        systemInstruction: options?.systemInstruction,
        tools: FAIR_PLAY_TOOLS,
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.AUTO,
          },
        },
        temperature: options?.temperature ?? 0.2,
      },
    });

    return new GeminiSession(chat, options?.systemInstruction);
  }
}
