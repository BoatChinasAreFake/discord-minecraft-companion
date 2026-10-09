/**
 * Multi-Provider AI Client Factory.
 *
 * Instantiates the appropriate client implementation (Google Gemini or
 * OpenAI-Compatible for OpenRouter, DeepSeek, Claude, ChatGPT, Ollama, LM Studio, etc.)
 * based on application configuration.
 */

import type { AppConfig, AIProvider } from '../config/types.js';
import { GeminiClient } from './geminiClient.js';
import {
  OpenAICompatibleClient,
  type OpenAICompatibleClientOptions,
} from './openAICompatibleClient.js';
import type { IGeminiClient } from './types.js';

export interface CreateClientParams {
  provider?: AIProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  headers?: Record<string, string>;
}

export const PROVIDER_DEFAULT_BASE_URLS: Record<string, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  ollama: 'http://localhost:11434/v1',
  local: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
};

export const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-3.8-flash',
  openrouter: 'anthropic/claude-3.5-sonnet',
  openai: 'gpt-4o',
  deepseek: 'deepseek-chat',
  ollama: 'llama3.1',
  local: 'llama3.1',
  lmstudio: 'local-model',
  custom: 'default-model',
};

/**
 * Creates an AI client (IGeminiClient / IAIClient) supporting any configured provider.
 */
export function createAIClient(configOrParams: AppConfig | CreateClientParams): IGeminiClient {
  let provider: AIProvider = 'gemini';
  let model: string | undefined;
  let apiKey: string | undefined;
  let baseUrl: string | undefined;
  let temperature: number | undefined;
  let headers: Record<string, string> | undefined;

  if ('ai' in configOrParams) {
    // AppConfig supplied
    provider = configOrParams.ai.provider || 'gemini';
    model = configOrParams.ai.model;
    apiKey = configOrParams.ai.apiKey;
    baseUrl = configOrParams.ai.baseUrl;
    temperature = configOrParams.ai.temperature;
  } else {
    // Direct parameters supplied
    provider = configOrParams.provider || 'gemini';
    model = configOrParams.model;
    apiKey = configOrParams.apiKey;
    baseUrl = configOrParams.baseUrl;
    temperature = configOrParams.temperature;
    headers = configOrParams.headers;
  }

  // Google Gemini Provider
  if (provider === 'gemini') {
    const geminiKey =
      apiKey ||
      ('gemini' in configOrParams ? configOrParams.gemini.apiKey : undefined) ||
      'mock_gemini_key';

    const geminiModel =
      model ||
      ('gemini' in configOrParams ? configOrParams.gemini.model : undefined) ||
      PROVIDER_DEFAULT_MODELS.gemini;

    return new GeminiClient({
      apiKey: geminiKey,
      model: geminiModel,
    });
  }

  // OpenAI-Compatible Providers (OpenRouter, DeepSeek, Claude, ChatGPT, Ollama, LMStudio, Local, Custom)
  const resolvedBaseUrl = baseUrl || PROVIDER_DEFAULT_BASE_URLS[provider];
  const resolvedModel = model || PROVIDER_DEFAULT_MODELS[provider] || 'gpt-4o';

  const clientOptions: OpenAICompatibleClientOptions = {
    providerName: provider,
    apiKey,
    model: resolvedModel,
    baseUrl: resolvedBaseUrl,
    temperature,
    headers,
  };

  return new OpenAICompatibleClient(clientOptions);
}
