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
