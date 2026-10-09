/**
 * OpenAI-Compatible Multi-Provider AI Client.
 *
 * Implements IGeminiClient / IAIClient and IGeminiSession / IAISession using
 * standard OpenAI Chat Completions API format (/chat/completions).
 *
 * Provides native out-of-the-box support for:
 * - OpenRouter (Claude 3.5 Sonnet, DeepSeek V3/R1, Llama 3.3, Mistral, etc.)
 * - OpenAI / ChatGPT (GPT-4o, GPT-4o-mini, o1, o3-mini)
 * - DeepSeek API (deepseek-chat, deepseek-reasoner)
 * - Local LLMs: Ollama, LM Studio, vLLM, LocalAI
 * - Any custom OpenAI-compatible proxy or gateway.
 */

import { FAIR_PLAY_TOOL_DECLARATIONS } from './tools/definitions.js';
import type {
  IGeminiClient,
  IGeminiSession,
  CreateSessionOptions,
  GeminiTurnResponse,
  ToolCallRequest,
} from './types.js';

export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Converts internal Fair-Play Tool Declarations into standard OpenAI function calling tools format.
 */
export function getOpenAIFairPlayTools(): OpenAIToolDefinition[] {
  return FAIR_PLAY_TOOL_DECLARATIONS.map((decl) => ({
    type: 'function' as const,
    function: {
      name: decl.name || 'unnamed_tool',
      description: decl.description,
      parameters: (decl.parameters as Record<string, unknown>) ?? {
        type: 'object',
        properties: {},
      },
    },
  }));
}

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface OpenAICompatibleClientOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  providerName?: string;
  temperature?: number;
}

export class OpenAICompatibleSession implements IGeminiSession {
  private messages: OpenAIChatMessage[] = [];
  private openAITools: OpenAIToolDefinition[];

  constructor(
    private endpointUrl: string,
    private apiKey: string | undefined,
    private model: string,
    private headers: Record<string, string>,
    private temperature: number,
    systemInstruction?: string
  ) {
    this.openAITools = getOpenAIFairPlayTools();
    if (systemInstruction) {
      this.messages.push({
        role: 'system',
        content: systemInstruction,
      });
    }
  }

  public async sendUserMessage(prompt: string, signal?: AbortSignal): Promise<GeminiTurnResponse> {
    if (signal?.aborted) {
      throw new Error('Operation aborted');
    }

    this.messages.push({
      role: 'user',
      content: prompt,
    });

    return this.executeTurn(signal);
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

    const contentStr =
      typeof result === 'string'
        ? result
        : JSON.stringify(result ?? { status: 'success' });

    this.messages.push({
      role: 'tool',
      tool_call_id: callId || `call_${Date.now()}`,
      name: toolName,
      content: contentStr,
    });

    return this.executeTurn(signal);
  }

  public getHistory(): unknown[] {
    return [...this.messages];
  }

  private async executeTurn(signal?: AbortSignal): Promise<GeminiTurnResponse> {
    const payload = {
      model: this.model,
      messages: this.messages,
      tools: this.openAITools,
      tool_choice: 'auto',
      temperature: this.temperature,
    };

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.headers,
    };

    if (this.apiKey) {
      requestHeaders['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(this.endpointUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      let errBody = '';
      try {
        errBody = await response.text();
      } catch {
        // ignore error parsing
      }
      throw new Error(
        `OpenAI-compatible AI request failed (${response.status} ${response.statusText}): ${errBody}`
      );
    }

    const data: any = await response.json();
    const choice = data?.choices?.[0];
    const message = choice?.message;

    if (!message) {
      throw new Error('Invalid response from AI provider: choices[0].message is missing');
    }

    const turnResponse: GeminiTurnResponse = {};

    if (message.content) {
      turnResponse.text = message.content;
    }

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      turnResponse.toolCalls = message.tool_calls.map((tc: any): ToolCallRequest => {
        let parsedArgs: Record<string, unknown> = {};
        try {
          if (typeof tc.function?.arguments === 'string') {
            parsedArgs = JSON.parse(tc.function.arguments);
          } else if (typeof tc.function?.arguments === 'object' && tc.function?.arguments !== null) {
            parsedArgs = tc.function.arguments;
          }
        } catch (e) {
          parsedArgs = { raw: tc.function?.arguments };
        }

        return {
          id: tc.id,
          name: tc.function?.name,
          args: parsedArgs,
        };
      });
    }

    // Record the assistant's turn in message history
    this.messages.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: message.tool_calls,
    });

    return turnResponse;
  }
}

export class OpenAICompatibleClient implements IGeminiClient {
  public readonly endpointUrl: string;
  public readonly modelName: string;
  public readonly apiKey?: string;
  public readonly headers: Record<string, string>;
  public readonly temperature: number;

  constructor(options: OpenAICompatibleClientOptions) {
    this.apiKey = options.apiKey;
    this.modelName = options.model || 'gpt-4o';
    this.temperature = options.temperature ?? 0.2;

    // Resolve base URL and ensure /chat/completions suffix
    let base = options.baseUrl?.trim() || 'https://api.openai.com/v1';
    if (base.endsWith('/')) {
      base = base.slice(0, -1);
    }
    if (!base.endsWith('/chat/completions')) {
      this.endpointUrl = `${base}/chat/completions`;
    } else {
      this.endpointUrl = base;
    }

    // Default provider-specific headers (e.g. OpenRouter attribution)
    this.headers = { ...options.headers };
    if (options.providerName === 'openrouter' || this.endpointUrl.includes('openrouter.ai')) {
      if (!this.headers['HTTP-Referer']) {
        this.headers['HTTP-Referer'] = 'https://github.com/BoatChinasAreFake/discord-minecraft-companion';
      }
      if (!this.headers['X-Title']) {
        this.headers['X-Title'] = 'Discord Minecraft Companion';
      }
    }
  }

  public async createSession(options?: CreateSessionOptions): Promise<IGeminiSession> {
    const effectiveModel = options?.model || this.modelName;
    const effectiveTemp = options?.temperature ?? this.temperature;

    return new OpenAICompatibleSession(
      this.endpointUrl,
      this.apiKey,
      effectiveModel,
      this.headers,
      effectiveTemp,
      options?.systemInstruction
    );
  }
}
