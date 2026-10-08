/**
 * Agent Coordinator.
 *
 * Central orchestrator connecting Discord gateway, Minecraft client agent,
 * Gemini AI planner, progress reporter, and voice audio pipelines.
 */

import type { IDiscordGateway, IVoiceSession } from '../discord/types.js';
import type {
  IMinecraftAgent,
  MinecraftBotStatus,
  MinecraftConnectionConfig,
} from '../minecraft/types.js';
import type { IGeminiPlanner, PlanningContext } from '../ai/types.js';
import type { ProgressReporter } from './progressReporter.js';
import type { AppConfig } from '../config/types.js';
import type { IAudioQueueManager } from '../audio/types.js';
import { AudioPriority } from '../audio/types.js';
import type { IAgentCoordinator, CoordinatorVoicePrompt } from './types.js';

export class AgentCoordinator implements IAgentCoordinator {
  private activeVoiceSession: IVoiceSession | null = null;
  private currentGoal: string | null = null;
  private lastAlertTimestamp = 0;

  constructor(
    private discordGateway: IDiscordGateway,
    private minecraftAgent: IMinecraftAgent,
    private planner: IGeminiPlanner,
    private progressReporter: ProgressReporter,
    private config: AppConfig,
    private audioQueue: IAudioQueueManager | null = null
  ) {
    this.bindMinecraftEvents();
  }

  public getMinecraftStatus(): MinecraftBotStatus {
    return this.minecraftAgent.getStatus();
  }

  public async connectMinecraft(config: MinecraftConnectionConfig): Promise<void> {
    await this.minecraftAgent.connect(config);
  }

  public async disconnectMinecraft(): Promise<void> {
    await this.stopCurrentTask();
    await this.minecraftAgent.disconnect();
  }

  public async assignTask(task: { goal: string; user: string }): Promise<void> {
    const status = this.minecraftAgent.getStatus();
    if (!status.connected) {
      throw new Error('Cannot assign task: Minecraft agent is disconnected.');
    }

    if (this.planner.isExecuting()) {
      await this.stopCurrentTask();
    }

    this.currentGoal = task.goal;
    const context: PlanningContext = {
      botStatus: status,
      userPrompt: task.goal,
      source: 'discord_slash',
      senderTag: task.user,
      channelId: this.config.discord.chatBridgeChannelId,
    };

    // Run planner execution generator asynchronously
    (async () => {
      try {
        for await (const event of this.planner.executeGoal(task.goal, context)) {
          await this.progressReporter.reportEvent(event, context);
        }
      } catch (err) {
        console.error('[AgentCoordinator] Goal stream failed:', err);
      } finally {
        if (this.currentGoal === task.goal) {
          this.currentGoal = null;
        }
      }
    })();
  }

  public async stopCurrentTask(): Promise<void> {
    this.planner.cancelCurrentGoal();
    this.currentGoal = null;

    // Physical halt on Minecraft agent
    try {
      const agentAny = this.minecraftAgent as any;
      if (agentAny.pathfinderAction?.stop) {
        agentAny.pathfinderAction.stop();
      }
      if (agentAny.bot?.pathfinder?.stop) {
        agentAny.bot.pathfinder.stop();
      }
      if (agentAny.bot?.stopDigging) {
        agentAny.bot.stopDigging();
      }
      if (agentAny.bot?.clearControlStates) {
        agentAny.bot.clearControlStates();
      }
    } catch (err) {
      console.warn('[AgentCoordinator] Warning during physical stop:', err);
    }

    // Voice queue purge
    if (this.activeVoiceSession?.queue?.cancelNonEmergency) {
      this.activeVoiceSession.queue.cancelNonEmergency();
    } else if (this.audioQueue?.cancelNonEmergency) {
      this.audioQueue.cancelNonEmergency();
    }

    const currentStatus = this.minecraftAgent.getStatus();
    await this.progressReporter.reportEvent(
      {
        type: 'done',
        message: '🛑 Emergency Stop: Active task halted. Standing by.',
      },
      {
        botStatus: currentStatus,
        userPrompt: 'stop',
        source: 'discord_slash',
        channelId: this.config.discord.chatBridgeChannelId,
      }
    );
  }

  public getInventory(): MinecraftBotStatus['inventory'] & { gear?: MinecraftBotStatus['gear'] } {
    const status = this.minecraftAgent.getStatus();
    return {
      ...status.inventory,
      gear: status.gear,
    };
  }

  public async joinVoiceChannel(channelId: string, guildId?: string): Promise<void> {
    const targetGuildId = guildId || this.config.discord.guildId || 'default';
    this.activeVoiceSession = await this.discordGateway.joinVoice(channelId, targetGuildId);
  }

  public async leaveVoiceChannel(guildId?: string): Promise<void> {
    const targetGuildId = guildId || this.config.discord.guildId || 'default';
    await this.discordGateway.leaveVoice(targetGuildId);
    this.activeVoiceSession = null;
  }

  public async handleVoicePrompt(event: CoordinatorVoicePrompt): Promise<void> {
    const text = (event.prompt || '').trim();
    if (/^(stop|halt|cancel|abort)\b/i.test(text)) {
      await this.stopCurrentTask();
    } else {
      await this.assignTask({ goal: text, user: `VoiceUser_${event.userId}` });
    }
  }

  public async broadcastSurvivalAlert(
    message: string,
    priority: AudioPriority = AudioPriority.EMERGENCY
  ): Promise<void> {
    const channelId = this.config.discord.chatBridgeChannelId;
    if (channelId) {
      try {
        await this.discordGateway.sendMessage(
          channelId,
          `🚨 **SURVIVAL EMERGENCY**: ${message}`
        );
      } catch (err) {
        console.error('[AgentCoordinator] Failed to broadcast alert message to Discord:', err);
      }
    }

    const targetQueue = this.activeVoiceSession?.queue || this.audioQueue;
    if (targetQueue) {
      try {
        targetQueue.enqueue({
          id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          text: message,
          priority,
          createdAt: Date.now(),
        });
      } catch (err) {
        console.error('[AgentCoordinator] Failed to enqueue emergency alert TTS:', err);
      }
    }
  }

  private bindMinecraftEvents(): void {
    this.minecraftAgent.on('death', (deathMessage?: string) => {
      const msg = `Agent died in-game: ${deathMessage || 'Unknown cause'}`;
      this.broadcastSurvivalAlert(msg, AudioPriority.EMERGENCY).catch(() => {});
      this.stopCurrentTask().catch(() => {});
    });

    this.minecraftAgent.on('statusUpdate', (status: MinecraftBotStatus) => {
      if (status.connected && status.health <= 6 && status.health > 0) {
        const now = Date.now();
        // Rate-limit health alerts to once every 10 seconds to avoid spam
        if (now - this.lastAlertTimestamp > 10000) {
          this.lastAlertTimestamp = now;
          this.broadcastSurvivalAlert(
            `Low health warning: ${status.health.toFixed(1)}/20 hearts remaining!`,
            AudioPriority.EMERGENCY
          ).catch(() => {});
        }
      }
    });
  }
}
