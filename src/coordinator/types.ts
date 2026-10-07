import type { MinecraftBotStatus, MinecraftConnectionConfig } from '../minecraft/types.js';
import type { AudioPriority } from '../audio/types.js';

export interface PlanningContext {
  botStatus: MinecraftBotStatus;
  userPrompt: string;
  source: 'discord_text' | 'discord_slash' | 'discord_voice';
  senderTag?: string;
}

export interface PlannerStepEvent {
  type: 'thought' | 'tool_call' | 'tool_result' | 'progress' | 'error' | 'done';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  message?: string;
  result?: unknown;
}

export interface CoordinatorVoicePrompt {
  userId: string;
  prompt: string;
  source: 'voice';
}

export interface IAgentCoordinator {
  getMinecraftStatus(): MinecraftBotStatus;
  connectMinecraft(config: MinecraftConnectionConfig): Promise<void>;
  disconnectMinecraft(): Promise<void>;
  assignTask(task: { goal: string; user: string }): Promise<void>;
  stopCurrentTask(): Promise<void>;
  getInventory(): MinecraftBotStatus['inventory'] & { gear?: MinecraftBotStatus['gear'] };
  joinVoiceChannel(channelId: string, guildId?: string): Promise<void>;
  leaveVoiceChannel(guildId?: string): Promise<void>;
  handleVoicePrompt(event: CoordinatorVoicePrompt): Promise<void>;
  broadcastSurvivalAlert(message: string, priority?: AudioPriority): Promise<void>;
}
