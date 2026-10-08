import type { MinecraftBotStatus, MinecraftConnectionConfig } from '../minecraft/types.js';
import type { AudioPriority } from '../audio/types.js';

export type { PlanningContext, PlannerStepEvent } from '../ai/types.js';

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
