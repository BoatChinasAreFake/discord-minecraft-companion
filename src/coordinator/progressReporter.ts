/**
 * Progress Reporter.
 *
 * Streams task progress and step events to Discord text channels and voice TTS queue
 * with priority handling (NORMAL for steps, HIGH for obstacles/done, EMERGENCY for danger).
 */

import type { IDiscordGateway } from '../discord/types.js';
import type { IAudioQueueManager } from '../audio/types.js';
import { AudioPriority } from '../audio/types.js';
import type { PlannerStepEvent, PlanningContext } from '../ai/types.js';

export interface ProgressReporterConfig {
  defaultChannelId: string;
  enableVoiceTTS?: boolean;
}

export class ProgressReporter {
  constructor(
    private discordGateway: IDiscordGateway,
    private audioQueue: IAudioQueueManager | null,
    private config: ProgressReporterConfig
  ) {}

  public async reportEvent(event: PlannerStepEvent, context: PlanningContext): Promise<void> {
    const channelId = context.channelId || this.config.defaultChannelId;

    switch (event.type) {
      case 'thought':
        // Thoughts are internal reasoning; omitted from Discord text to avoid chat spam
        break;

      case 'tool_call': {
        const turnText = event.turn !== undefined ? ` [Turn ${event.turn}]` : '';
        const argsSummary = this.formatArgs(event.toolArgs);
        const text = `⚙️ **Step${turnText}**: Executing \`${event.toolName}\`${argsSummary ? ` (${argsSummary})` : ''}`;
        await this.safeSendText(channelId, text);
        this.safeEnqueueTTS(`Step: ${this.humanizeToolName(event.toolName)}`, AudioPriority.NORMAL);
        break;
      }

      case 'tool_result': {
        const res = event.result as any;
        if (res && res.success === false) {
          const text = `⚠️ **Obstacle**: ${res.message || 'Action encountered an issue.'}`;
          await this.safeSendText(channelId, text);
          this.safeEnqueueTTS(`Obstacle: ${res.message || 'Action encountered an issue'}`, AudioPriority.HIGH);
        }
        break;
      }

      case 'progress': {
        if (event.message) {
          const text = `💬 ${event.message}`;
          await this.safeSendText(channelId, text);
          this.safeEnqueueTTS(event.message, AudioPriority.NORMAL);
        }
        break;
      }

      case 'error': {
        const text = `❌ **Error**: ${event.message}`;
        await this.safeSendText(channelId, text);
        this.safeEnqueueTTS(`Planning error: ${event.message}`, AudioPriority.HIGH);
        break;
      }

      case 'done': {
        const text = `✅ **Task Finished**: ${event.message || 'Goal reached successfully.'}`;
        await this.safeSendText(channelId, text);
        this.safeEnqueueTTS(`Task completed: ${event.message || 'Goal reached successfully'}`, AudioPriority.HIGH);
        break;
      }
    }
  }

  private async safeSendText(channelId: string, content: string): Promise<void> {
    try {
      if (channelId) {
        await this.discordGateway.sendMessage(channelId, content);
      }
    } catch (err) {
      console.error('[ProgressReporter] Failed to send Discord text:', err);
    }
  }

  private safeEnqueueTTS(text: string, priority: AudioPriority): void {
    if (this.config.enableVoiceTTS === false || !this.audioQueue) return;
    try {
      this.audioQueue.enqueue({
        id: `tts_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        text,
        priority,
        createdAt: Date.now(),
      });
    } catch (err) {
      console.error('[ProgressReporter] Failed to enqueue TTS:', err);
    }
  }

  private formatArgs(args?: Record<string, unknown>): string {
    if (!args || Object.keys(args).length === 0) return '';
    return Object.entries(args)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(', ');
  }

  private humanizeToolName(toolName?: string): string {
    if (!toolName) return 'action';
    return toolName
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase()
      .trim();
  }
}
