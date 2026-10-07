export interface AntiLoopbackOptions {
  botDiscordId: string;
  botMinecraftUsername: string;
  ttlMs?: number; // default: 10000 ms
}

export interface InboundMessageMeta {
  source: 'discord' | 'minecraft';
  authorId?: string;
  authorUsername?: string;
  isBotAccount?: boolean;
  content: string;
}

export type DropReason =
  | 'SELF_BOT_ID'
  | 'BOT_ACCOUNT'
  | 'DUPLICATE_TTL_HASH'
  | 'EMPTY_CONTENT'
  | 'DISCORD_PREFIX_ECHO';

export interface DropEvaluation {
  drop: boolean;
  reason?: DropReason;
}

export interface IMinecraftChatAgent {
  sendChat(message: string): Promise<void>;
  on(event: 'chat', listener: (username: string, message: string) => void): void;
  removeListener(event: string, listener: (...args: any[]) => void): void;
}

export interface ChatBridgeConfig {
  bridgeChannelId: string;
  botDiscordId: string;
  botMinecraftUsername: string;
  rateLimitDelayMs?: number; // default: 500ms between outbound MC chat packets
  maxQueueSize?: number; // default: 50
}
