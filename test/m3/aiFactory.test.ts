import { describe, it, expect } from 'vitest';
import { createAIClient } from '../../src/ai/factory.js';
import { GeminiClient } from '../../src/ai/geminiClient.js';
import { OpenAICompatibleClient } from '../../src/ai/openAICompatibleClient.js';

describe('AI Client Factory (createAIClient)', () => {
  it('TC-FACT-1: Creates GeminiClient when provider is gemini', () => {
    const client = createAIClient({
      provider: 'gemini',
      apiKey: 'test-gemini-key',
      model: 'gemini-3.8-flash',
    });

    expect(client).toBeInstanceOf(GeminiClient);
    expect(client.modelName).toBe('gemini-3.8-flash');
  });

  it('TC-FACT-2: Creates OpenAICompatibleClient for OpenRouter with default Claude model', () => {
    const client = createAIClient({
      provider: 'openrouter',
      apiKey: 'sk-or-v1-test',
    });

    expect(client).toBeInstanceOf(OpenAICompatibleClient);
    const openAIClient = client as OpenAICompatibleClient;
    expect(openAIClient.endpointUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(openAIClient.modelName).toBe('anthropic/claude-3.5-sonnet');
    expect(openAIClient.apiKey).toBe('sk-or-v1-test');
  });

  it('TC-FACT-3: Creates OpenAICompatibleClient for OpenAI with default GPT-4o model', () => {
    const client = createAIClient({
      provider: 'openai',
      apiKey: 'sk-proj-test',
    });

    expect(client).toBeInstanceOf(OpenAICompatibleClient);
    const openAIClient = client as OpenAICompatibleClient;
    expect(openAIClient.endpointUrl).toBe('https://api.openai.com/v1/chat/completions');
    expect(openAIClient.modelName).toBe('gpt-4o');
  });

  it('TC-FACT-4: Creates OpenAICompatibleClient for DeepSeek with deepseek-chat model', () => {
    const client = createAIClient({
      provider: 'deepseek',
      apiKey: 'sk-deepseek-test',
    });

    expect(client).toBeInstanceOf(OpenAICompatibleClient);
    const openAIClient = client as OpenAICompatibleClient;
    expect(openAIClient.endpointUrl).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(openAIClient.modelName).toBe('deepseek-chat');
  });

  it('TC-FACT-5: Creates OpenAICompatibleClient for Ollama / Local with localhost:11434', () => {
    const client = createAIClient({
      provider: 'ollama',
      model: 'qwen2.5:14b',
    });

    expect(client).toBeInstanceOf(OpenAICompatibleClient);
    const openAIClient = client as OpenAICompatibleClient;
    expect(openAIClient.endpointUrl).toBe('http://localhost:11434/v1/chat/completions');
    expect(openAIClient.modelName).toBe('qwen2.5:14b');
  });

  it('TC-FACT-6: Creates OpenAICompatibleClient for LM Studio with localhost:1234', () => {
    const client = createAIClient({
      provider: 'lmstudio',
    });

    expect(client).toBeInstanceOf(OpenAICompatibleClient);
    const openAIClient = client as OpenAICompatibleClient;
    expect(openAIClient.endpointUrl).toBe('http://localhost:1234/v1/chat/completions');
    expect(openAIClient.modelName).toBe('local-model');
  });

  it('TC-FACT-7: Creates client using custom baseURL and custom model', () => {
    const client = createAIClient({
      provider: 'custom',
      baseUrl: 'http://my-ai-proxy.internal:8000/v1',
      model: 'custom-fine-tuned-model',
      apiKey: 'internal-secret',
    });

    expect(client).toBeInstanceOf(OpenAICompatibleClient);
    const openAIClient = client as OpenAICompatibleClient;
    expect(openAIClient.endpointUrl).toBe('http://my-ai-proxy.internal:8000/v1/chat/completions');
    expect(openAIClient.modelName).toBe('custom-fine-tuned-model');
  });

  it('TC-FACT-8: Instantiates client cleanly from AppConfig object', () => {
    const mockAppConfig: any = {
      ai: {
        provider: 'openrouter',
        model: 'deepseek/deepseek-r1',
        apiKey: 'sk-or-test-appconfig',
        baseUrl: 'https://openrouter.ai/api/v1',
        maxToolSteps: 8,
        temperature: 0.1,
      },
      gemini: {
        apiKey: 'mock_gemini_key',
        model: 'gemini-3.8-flash',
        maxToolSteps: 5,
      },
    };

    const client = createAIClient(mockAppConfig);
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
    const openAIClient = client as OpenAICompatibleClient;
    expect(openAIClient.modelName).toBe('deepseek/deepseek-r1');
    expect(openAIClient.apiKey).toBe('sk-or-test-appconfig');
    expect(openAIClient.temperature).toBe(0.1);
  });
});
