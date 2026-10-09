export type AIProvider =
  | 'gemini'
  | 'openrouter'
  | 'openai'
  | 'deepseek'
  | 'ollama'
  | 'lmstudio'
  | 'local'
  | 'custom';

export interface AIProviderConfig {
  provider: AIProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxToolSteps: number;
  temperature?: number;
}

export interface AppConfig {
  discord: {
    token: string;
    clientId: string;
    guildId?: string;
    chatBridgeChannelId: string;
    statusChannelId?: string;
    voiceChannelId?: string;
    controlChannelId?: string;
  };
  rbac: {
    allowedRoleIds: string[];
    allowedUserIds: string[];
    adminRoleIds: string[];
    adminUserIds: string[];
  };
  minecraft: {
    host: string;
    port: number;
    username: string;
    version: string;
    auth: 'offline' | 'microsoft';
  };
  ai: AIProviderConfig;
  gemini: {
    apiKey: string;
    model: string;
    maxToolSteps: number;
  };
  audio: {
    sttSilenceDurationMs: number;
    minUtteranceMs: number;
    maxUtteranceMs: number;
    ttsVoiceName: string;
  };
  status: {
    embedIntervalSec: number;
  };
  runtime: {
    nodeEnv: 'development' | 'production' | 'test';
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    mockAll: boolean;
  };
}
