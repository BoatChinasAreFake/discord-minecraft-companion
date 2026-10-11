import dotenv from 'dotenv';
import { z } from 'zod';
import type { AppConfig, AIProvider } from './types.js';

// Load .env file into process.env if present
dotenv.config();

// Helper to parse comma-delimited strings into clean arrays of trimmed non-empty strings
const commaSeparatedList = z
  .string()
  .optional()
  .transform((val) => {
    if (!val) return [];
    return val
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  });

export const EnvSchema = z.object({
  // Discord
  DISCORD_BOT_TOKEN: z.string().min(1, 'DISCORD_BOT_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
  DISCORD_GUILD_ID: z.string().optional(),
  DISCORD_CHAT_BRIDGE_CHANNEL_ID: z.string().min(1, 'DISCORD_CHAT_BRIDGE_CHANNEL_ID is required'),
  DISCORD_STATUS_CHANNEL_ID: z.string().optional(),
  DISCORD_VOICE_CHANNEL_ID: z.string().optional(),
  DISCORD_CONTROL_CHANNEL_ID: z.string().optional(),

  // RBAC
  DISCORD_ALLOWED_ROLE_IDS: commaSeparatedList,
  DISCORD_ALLOWED_USER_IDS: commaSeparatedList,
  DISCORD_ADMIN_ROLE_IDS: commaSeparatedList,
  DISCORD_ADMIN_USER_IDS: commaSeparatedList,

  // Minecraft
  MINECRAFT_HOST: z.string().default('localhost'),
  MINECRAFT_PORT: z.coerce.number().int().min(1).max(65535).default(25565),
  MINECRAFT_USERNAME: z.string().min(1).default('DiscordSurvivalBot'),
  MINECRAFT_VERSION: z.string().default('1.21.11'),
  MINECRAFT_AUTH: z.enum(['offline', 'microsoft']).default('offline'),

  // Multi-Provider AI Configuration
  AI_PROVIDER: z.enum([
    'gemini',
    'openrouter',
    'openai',
    'deepseek',
    'ollama',
    'lmstudio',
    'local',
    'custom'
  ]).default('gemini'),
  AI_MODEL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().optional(),
  AI_MAX_TOOL_STEPS: z.coerce.number().int().min(1).max(20).optional(),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).optional(),

  // Provider-specific credentials
  OPENROUTER_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),
  LMSTUDIO_BASE_URL: z.string().optional(),

  // Gemini AI (Backward compatibility)
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_MAX_TOOL_STEPS: z.coerce.number().int().min(1).max(20).default(5),

  // Audio Pipelines
  VOICE_STT_SILENCE_DURATION_MS: z.coerce.number().int().min(100).default(500),
  VOICE_MIN_UTTERANCE_MS: z.coerce.number().int().min(50).default(200),
  VOICE_MAX_UTTERANCE_MS: z.coerce.number().int().min(1000).default(15000),
  VOICE_TTS_VOICE_NAME: z.string().default('en-US-Standard-C'),

  // Status Embed
  STATUS_EMBED_INTERVAL_SEC: z.coerce.number().int().min(1).default(5),

  // Runtime
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  MOCK_ALL: z
    .string()
    .optional()
    .transform((val) => val === 'true')
});

function getDefaultModel(provider: AIProvider): string {
  switch (provider) {
    case 'gemini':
      return 'gemini-3.8-flash';
    case 'openrouter':
      return 'anthropic/claude-3.5-sonnet';
    case 'openai':
      return 'gpt-4o';
    case 'deepseek':
      return 'deepseek-chat';
    case 'ollama':
    case 'local':
      return 'llama3.1';
    case 'lmstudio':
      return 'local-model';
    case 'custom':
      return 'default-model';
  }
}

function getDefaultBaseUrl(provider: AIProvider): string | undefined {
  switch (provider) {
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'deepseek':
      return 'https://api.deepseek.com/v1';
    case 'ollama':
    case 'local':
      return 'http://localhost:11434/v1';
    case 'lmstudio':
      return 'http://localhost:1234/v1';
    default:
      return undefined;
  }
}

export function loadConfig(overrides?: NodeJS.ProcessEnv): AppConfig {
  const envToValidate = overrides || process.env;

  const isTestOrMock =
    envToValidate.NODE_ENV === 'test' ||
    envToValidate.MOCK_ALL === 'true';

  const merged = { ...envToValidate };
  if (isTestOrMock) {
    if (!merged.DISCORD_BOT_TOKEN) merged.DISCORD_BOT_TOKEN = 'mock_discord_bot_token';
    if (!merged.DISCORD_CLIENT_ID) merged.DISCORD_CLIENT_ID = '123456789012345678';
    if (!merged.DISCORD_CHAT_BRIDGE_CHANNEL_ID) merged.DISCORD_CHAT_BRIDGE_CHANNEL_ID = '123456789012345679';
    if (!merged.GEMINI_API_KEY && !merged.AI_API_KEY) {
      merged.GEMINI_API_KEY = 'mock_gemini_api_key';
      merged.AI_API_KEY = 'mock_ai_api_key';
    }
  }

  // Cross-fill API key between GEMINI_API_KEY and AI_API_KEY
  if (!merged.GEMINI_API_KEY && merged.AI_API_KEY) {
    merged.GEMINI_API_KEY = merged.AI_API_KEY;
  }
  if (!merged.AI_API_KEY && merged.GEMINI_API_KEY) {
    merged.AI_API_KEY = merged.GEMINI_API_KEY;
  }

  const result = EnvSchema.safeParse(merged);

  if (!result.success) {
    const errorMessages = result.error.issues
      .map((issue) => `  - [${issue.path.join('.')}] ${issue.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${errorMessages}`);
  }

  const data = result.data;

  // Determine effective provider, API key, model, and baseUrl
  const provider = data.AI_PROVIDER;
  const effectiveModel = data.AI_MODEL || (provider === 'gemini' ? data.GEMINI_MODEL : getDefaultModel(provider));
  
  let effectiveApiKey = data.AI_API_KEY;
  if (!effectiveApiKey) {
    if (provider === 'openrouter') effectiveApiKey = data.OPENROUTER_API_KEY;
    else if (provider === 'openai') effectiveApiKey = data.OPENAI_API_KEY;
    else if (provider === 'deepseek') effectiveApiKey = data.DEEPSEEK_API_KEY;
    else if (provider === 'gemini') effectiveApiKey = data.GEMINI_API_KEY;
    else if (provider === 'ollama' || provider === 'local' || provider === 'lmstudio') {
      effectiveApiKey = 'local-dummy-key';
    }
  }

  // If still no API key for non-local providers, fallback to mock if in test, else throw
  if (!effectiveApiKey && provider !== 'ollama' && provider !== 'local' && provider !== 'lmstudio') {
    if (isTestOrMock) {
      effectiveApiKey = `mock_${provider}_api_key`;
    } else {
      throw new Error(`API key is required for AI provider '${provider}'. Set AI_API_KEY or provider-specific key.`);
    }
  }

  const effectiveBaseUrl =
    data.AI_BASE_URL ||
    (provider === 'ollama' ? data.OLLAMA_BASE_URL : undefined) ||
    (provider === 'lmstudio' ? data.LMSTUDIO_BASE_URL : undefined) ||
    getDefaultBaseUrl(provider);

  const maxToolSteps = data.AI_MAX_TOOL_STEPS ?? data.GEMINI_MAX_TOOL_STEPS;

  return {
    discord: {
      token: data.DISCORD_BOT_TOKEN,
      clientId: data.DISCORD_CLIENT_ID,
      guildId: data.DISCORD_GUILD_ID,
      chatBridgeChannelId: data.DISCORD_CHAT_BRIDGE_CHANNEL_ID,
      statusChannelId: data.DISCORD_STATUS_CHANNEL_ID,
      voiceChannelId: data.DISCORD_VOICE_CHANNEL_ID,
      controlChannelId: data.DISCORD_CONTROL_CHANNEL_ID
    },
    rbac: {
      allowedRoleIds: data.DISCORD_ALLOWED_ROLE_IDS ?? [],
      allowedUserIds: data.DISCORD_ALLOWED_USER_IDS ?? [],
      adminRoleIds: data.DISCORD_ADMIN_ROLE_IDS ?? [],
      adminUserIds: data.DISCORD_ADMIN_USER_IDS ?? []
    },
    minecraft: {
      host: data.MINECRAFT_HOST,
      port: data.MINECRAFT_PORT,
      username: data.MINECRAFT_USERNAME,
      version: data.MINECRAFT_VERSION,
      auth: data.MINECRAFT_AUTH
    },
    ai: {
      provider,
      model: effectiveModel,
      apiKey: effectiveApiKey,
      baseUrl: effectiveBaseUrl,
      maxToolSteps,
      temperature: data.AI_TEMPERATURE ?? 0.2
    },
    gemini: {
      apiKey: effectiveApiKey || data.GEMINI_API_KEY || 'mock_gemini_api_key',
      model: data.GEMINI_MODEL,
      maxToolSteps: data.GEMINI_MAX_TOOL_STEPS
    },
    audio: {
      sttSilenceDurationMs: data.VOICE_STT_SILENCE_DURATION_MS,
      minUtteranceMs: data.VOICE_MIN_UTTERANCE_MS,
      maxUtteranceMs: data.VOICE_MAX_UTTERANCE_MS,
      ttsVoiceName: data.VOICE_TTS_VOICE_NAME
    },
    status: {
      embedIntervalSec: data.STATUS_EMBED_INTERVAL_SEC
    },
    runtime: {
      nodeEnv: data.NODE_ENV,
      logLevel: data.LOG_LEVEL,
      mockAll: Boolean(data.MOCK_ALL)
    }
  };
}

let globalConfig: AppConfig | null = null;
export function getConfig(): AppConfig {
  if (!globalConfig) {
    globalConfig = loadConfig();
  }
  return globalConfig;
}

export function resetConfigForTest(): void {
  globalConfig = null;
}
