import { createHash } from 'crypto';
import type { EmbedData, IDiscordGateway } from './types.js';
import type { MinecraftBotStatus } from '../minecraft/types.js';

export interface StatusEmbedConfig {
  statusChannelId: string;
  updateIntervalSec?: number; // default: 5s
  pinnedMessageId?: string;
}

export function generateProgressBar(
  current: number,
  max: number,
  segments: number = 10,
  filledChar: string = '■',
  emptyChar: string = '□'
): string {
  const clamped = Math.max(0, Math.min(current, max));
  const filledCount = Math.round((clamped / max) * segments);
  const emptyCount = Math.max(0, segments - filledCount);
  return filledChar.repeat(filledCount) + emptyChar.repeat(emptyCount);
}

export function computeStateHash(status: MinecraftBotStatus): string {
  const canonical = {
    connected: status.connected,
    health: Math.round(status.health * 2) / 2, // 0.5 granularity
    food: Math.round(status.food),
    pos: status.position
      ? [
          Math.round(status.position.x),
          Math.round(status.position.y),
          Math.round(status.position.z),
          status.dimension ?? 'overworld'
        ]
      : null,
    task: status.currentTask ?? '',
    gear: status.gear
      ? {
          main: status.gear.mainHand ?? '',
          off: status.gear.offHand ?? '',
          armor: status.gear.armorSummary ?? ''
        }
      : null,
    invUsed: status.inventory?.usedSlots ?? 0,
    server: status.server ? `${status.server.host}:${status.server.port}` : ''
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function buildStatusEmbed(status: MinecraftBotStatus): EmbedData {
  if (!status.connected) {
    return {
      title: `🎮 Minecraft Agent: ${status.username || 'Bot'}`,
      description: '🔴 **Offline / Disconnected from Minecraft server**',
      color: 0x95a5a6, // Grey
      fields: [
        {
          name: '🌐 Server',
          value: `\`${status.server?.host || 'localhost'}:${status.server?.port || 25565}\``,
          inline: true
        },
        {
          name: '📋 Status',
          value: 'Awaiting connection command (`/connect`)',
          inline: true
        }
      ],
      footer: { text: 'Survival AI Companion • Offline' },
      timestamp: new Date().toISOString()
    };
  }

  // Dynamic status color
  let color = 0x2ecc71; // Green
  if (status.health <= 7) {
    color = 0xe74c3c; // Red
  } else if (status.health <= 15) {
    color = 0xf1c40f; // Yellow
  }

  const healthBar = generateProgressBar(status.health, 20, 10, '❤️', '🤍');
  const hungerBar = generateProgressBar(status.food, 20, 10, '🍗', '▫️');

  const x = status.position ? status.position.x.toFixed(1) : '0.0';
  const y = status.position ? status.position.y.toFixed(1) : '0.0';
  const z = status.position ? status.position.z.toFixed(1) : '0.0';
  const dim = status.dimension || 'overworld';

  const usedSlots = status.inventory?.usedSlots ?? 0;
  const totalSlots = status.inventory?.totalSlots ?? 36;
  const freeSlots = status.inventory?.freeSlots ?? Math.max(0, totalSlots - usedSlots);

  return {
    title: `🎮 Minecraft Agent Status: ${status.username}`,
    color,
    fields: [
      {
        name: '💖 Health',
        value: `${healthBar} **${status.health.toFixed(1)}/20**`,
        inline: true
      },
      {
        name: '🍗 Hunger',
        value: `${hungerBar} **${status.food}/20**`,
        inline: true
      },
      {
        name: '🧭 Coordinates',
        value: `\`X: ${x}, Y: ${y}, Z: ${z}\` (${dim})`,
        inline: false
      },
      {
        name: '📋 Active Task',
        value: status.currentTask || 'Idle - Standing by',
        inline: false
      },
      {
        name: '⚔️ Equipped Gear',
        value: `Main: \`${status.gear?.mainHand || 'Air'}\` | Off: \`${status.gear?.offHand || 'Air'}\`\nArmor: \`${status.gear?.armorSummary || 'None'}\``,
        inline: false
      },
      {
        name: '🎒 Inventory',
        value: `Used: **${usedSlots}/${totalSlots}** slots | Free: **${freeSlots}**`,
        inline: true
      },
      {
        name: '🌐 Server',
        value: `\`${status.server?.host || 'localhost'}:${status.server?.port || 25565}\` (${status.server?.ping ?? 0}ms)`,
        inline: true
      }
    ],
    footer: { text: 'Survival AI Companion • Live Status' },
    timestamp: new Date().toISOString()
  };
}

export class StatusEmbedManager {
  private readonly gateway: IDiscordGateway;
  private readonly config: StatusEmbedConfig;
  private currentMessageId: string | null = null;
  private lastHash: string | null = null;
  private latestStatus: MinecraftBotStatus | null = null;
  private updateTimer: NodeJS.Timeout | null = null;
  private isUpdating: boolean = false;

  constructor(gateway: IDiscordGateway, config: StatusEmbedConfig) {
    this.gateway = gateway;
    this.config = config;
    this.currentMessageId = config.pinnedMessageId ?? null;
  }

  public start(): void {
    if (this.updateTimer) return;
    const intervalMs = (this.config.updateIntervalSec ?? 5) * 1000;
    this.updateTimer = setInterval(() => {
      this.tick();
    }, intervalMs);
  }

  public stop(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  public updateState(status: MinecraftBotStatus): void {
    this.latestStatus = status;
  }

  public async tick(force = false): Promise<boolean> {
    if (!this.latestStatus || this.isUpdating) return false;

    const currentHash = computeStateHash(this.latestStatus);
    if (!force && currentHash === this.lastHash) {
      return false; // Skip redundant Discord API call!
    }

    this.isUpdating = true;
    try {
      const embed = buildStatusEmbed(this.latestStatus);

      if (this.currentMessageId) {
        try {
          await this.gateway.updateEmbed(this.config.statusChannelId, this.currentMessageId, embed);
          this.lastHash = currentHash;
          return true;
        } catch (err: any) {
          // If Discord Error 10008 (Unknown Message) was thrown, message was deleted
          if (err?.code === 10008 || String(err).includes('10008')) {
            console.warn('[StatusEmbedManager] Status message was deleted, creating new pin.');
            this.currentMessageId = null;
          } else {
            throw err;
          }
        }
      }

      // Create new message if no message ID exists or was deleted
      const messageId = await this.gateway.sendMessage(this.config.statusChannelId, {
        embeds: [embed]
      });
      this.currentMessageId = messageId;
      this.lastHash = currentHash;
      return true;
    } catch (err) {
      console.error('[StatusEmbedManager] Failed to update status embed:', err);
      return false;
    } finally {
      this.isUpdating = false;
    }
  }

  public getCurrentMessageId(): string | null {
    return this.currentMessageId;
  }

  public getLastHash(): string | null {
    return this.lastHash;
  }
}
