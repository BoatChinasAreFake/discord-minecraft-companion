import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OpenAICompatibleClient,
  getOpenAIFairPlayTools,
} from '../../src/ai/openAICompatibleClient.js';

describe('OpenAICompatibleClient & Tools (Multi-Model Support)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('TC-MULTI-1: getOpenAIFairPlayTools converts all 9 fair-play tools to OpenAI tool format', () => {
    const tools = getOpenAIFairPlayTools();
    expect(tools.length).toBe(9);

    const toolNames = tools.map((t) => t.function.name);
    expect(toolNames).toContain('goToCoordinates');
    expect(toolNames).toContain('followPlayer');
    expect(toolNames).toContain('gatherResource');
    expect(toolNames).toContain('defendArea');
    expect(toolNames).toContain('reportStatus');
    expect(toolNames).toContain('stopCurrentTask');
    expect(toolNames).toContain('craftItem');
    expect(toolNames).toContain('sleepInBed');
    expect(toolNames).toContain('depositOrRetrieve');

    for (const tool of tools) {
      expect(tool.type).toBe('function');
      expect(tool.function.name).toBeTypeOf('string');
      expect(tool.function.parameters).toBeDefined();
    }
  });

  it('TC-MULTI-2: OpenRouter client configures base URL and injects attribution headers', async () => {
    const client = new OpenAICompatibleClient({
      providerName: 'openrouter',
      apiKey: 'sk-or-test-key',
      model: 'anthropic/claude-3.5-sonnet',
      baseUrl: 'https://openrouter.ai/api/v1',
    });

    expect(client.endpointUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(client.headers['HTTP-Referer']).toBeDefined();
    expect(client.headers['X-Title']).toBe('Discord Minecraft Companion');
  });

  it('TC-MULTI-3: OpenAI client sends user message and parses assistant text response', async () => {
    const mockResponsePayload = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'I am ready to assist you in Minecraft!',
          },
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponsePayload,
    } as any);

    const client = new OpenAICompatibleClient({
      apiKey: 'sk-test-key',
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
    });

    const session = await client.createSession({
      systemInstruction: 'You are a helpful survival bot.',
    });

    const response = await session.sendUserMessage('Hello!');

    expect(response.text).toBe('I am ready to assist you in Minecraft!');
    expect(response.toolCalls).toBeUndefined();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, requestInit] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(requestInit.method).toBe('POST');

    const body = JSON.parse(requestInit.body);
    expect(body.model).toBe('gpt-4o');
    expect(body.messages[0]).toEqual({
      role: 'system',
      content: 'You are a helpful survival bot.',
    });
    expect(body.messages[1]).toEqual({
      role: 'user',
      content: 'Hello!',
    });
    expect(body.tools.length).toBe(9);
  });

  it('TC-MULTI-4: DeepSeek client parses tool calls correctly', async () => {
    const mockToolCallPayload = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Moving to the coordinates now.',
            tool_calls: [
              {
                id: 'call_deepseek_123',
                type: 'function',
                function: {
                  name: 'goToCoordinates',
                  arguments: JSON.stringify({ x: 100, y: 64, z: -200 }),
                },
              },
            ],
          },
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockToolCallPayload,
    } as any);

    const client = new OpenAICompatibleClient({
      providerName: 'deepseek',
      apiKey: 'sk-deepseek-test',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
    });

    const session = await client.createSession();
    const response = await session.sendUserMessage('Go to x:100, y:64, z:-200');

    expect(response.text).toBe('Moving to the coordinates now.');
    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls?.length).toBe(1);
    expect(response.toolCalls?.[0]).toEqual({
      id: 'call_deepseek_123',
      name: 'goToCoordinates',
      args: { x: 100, y: 64, z: -200 },
    });
  });

  it('TC-MULTI-5: Local Ollama / vLLM client handles multi-turn tool response continuation', async () => {
    const step1Payload = {
      choices: [
        {
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_local_1',
                type: 'function',
                function: {
                  name: 'gatherResource',
                  arguments: '{"blockType":"oak_log","count":3}',
                },
              },
            ],
          },
        },
      ],
    };

    const step2Payload = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'I have gathered 3 oak logs for you.',
          },
        },
      ],
    };

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => step1Payload,
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => step2Payload,
      } as any);

    const client = new OpenAICompatibleClient({
      providerName: 'ollama',
      model: 'llama3.1',
      baseUrl: 'http://localhost:11434/v1',
    });

    const session = await client.createSession();
    const turn1 = await session.sendUserMessage('Chop 3 trees');

    expect(turn1.toolCalls?.[0].name).toBe('gatherResource');

    const turn2 = await session.sendToolResponse(
      'gatherResource',
      { status: 'success', collected: 3 },
      'call_local_1'
    );

    expect(turn2.text).toBe('I have gathered 3 oak logs for you.');
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const lastCallBody = JSON.parse((global.fetch as any).mock.calls[1][1].body);
    const lastMsg = lastCallBody.messages[lastCallBody.messages.length - 1];
    expect(lastMsg.role).toBe('tool');
    expect(lastMsg.tool_call_id).toBe('call_local_1');
    expect(lastMsg.name).toBe('gatherResource');
  });

  it('TC-MULTI-6: Handles abort signal cancellation gracefully', async () => {
    const abortController = new AbortController();
    abortController.abort();

    const client = new OpenAICompatibleClient({
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
    });

    const session = await client.createSession();

    await expect(
      session.sendUserMessage('Test abort', abortController.signal)
    ).rejects.toThrow('Operation aborted');
  });

  it('TC-MULTI-7: Throws descriptive error on non-200 HTTP response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => '{"error":{"message":"Invalid API key provided"}}',
    } as any);

    const client = new OpenAICompatibleClient({
      apiKey: 'invalid_key',
      baseUrl: 'https://api.openai.com/v1',
    });

    const session = await client.createSession();

    await expect(session.sendUserMessage('Hello')).rejects.toThrow(
      /OpenAI-compatible AI request failed \(401 Unauthorized\)/
    );
  });
});
