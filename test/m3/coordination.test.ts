import { describe, it, expect, beforeEach } from 'vitest';
import { AgentCoordinator } from '../../src/coordinator/agentCoordinator.js';
import { ProgressReporter } from '../../src/coordinator/progressReporter.js';
import { GeminiPlanner } from '../../src/ai/planner.js';
import { MockGeminiClient } from '../mocks/mockGemini.js';
import { MockMinecraftAgent } from '../mocks/mockMinecraft.js';
import { MockDiscordGateway } from '../mocks/mockDiscord.js';
import type { IAudioQueueManager, TTSQueueItem } from '../../src/audio/types.js';
import { AudioPriority } from '../../src/audio/types.js';
import type { AppConfig } from '../../src/config/types.js';

class MockAudioQueueManager implements IAudioQueueManager {
  public items: TTSQueueItem[] = [];
  public cancelledNonEmergencyCount = 0;

  public enqueue(item: TTSQueueItem): void {
    this.items.push(item);
  }

  public cancelNonEmergency(): void {
    this.cancelledNonEmergencyCount++;
    this.items = this.items.filter((i) => i.priority === AudioPriority.EMERGENCY);
  }

  public stopAll(): void {
    this.items = [];
  }

  public getQueueLength(): number {
    return this.items.length;
  }

  public getCurrentItem(): TTSQueueItem | null {
    return this.items[0] || null;
  }

  public isPlaying(): boolean {
    return false;
  }
}

describe('Milestone 3: Agent Coordination & Progress Reporting', () => {
  let discordGateway: MockDiscordGateway;
  let minecraftAgent: MockMinecraftAgent;
  let geminiClient: MockGeminiClient;
  let planner: GeminiPlanner;
  let audioQueue: MockAudioQueueManager;
  let progressReporter: ProgressReporter;
  let coordinator: AgentCoordinator;
  let config: AppConfig;

  beforeEach(async () => {
    discordGateway = new MockDiscordGateway();
    minecraftAgent = new MockMinecraftAgent();
    await minecraftAgent.connect({ host: 'localhost', port: 25565, username: 'CoordBot' });

    geminiClient = new MockGeminiClient();
    planner = new GeminiPlanner(geminiClient, minecraftAgent, { maxToolTurns: 10 });
    audioQueue = new MockAudioQueueManager();

    config = {
      discord: {
        token: 'mock-token',
        clientId: 'mock-client-id',
        guildId: 'guild-123',
        chatBridgeChannelId: 'chat-bridge-chan',
        statusChannelId: 'status-chan',
      },
      rbac: {
        allowedRoleIds: [],
        allowedUserIds: [],
        adminRoleIds: [],
        adminUserIds: [],
      },
      minecraft: {
        host: 'localhost',
        port: 25565,
        username: 'CoordBot',
        version: '1.20.4',
        auth: 'offline',
      },
      gemini: {
        apiKey: 'mock-key',
        model: 'gemini-3.8-flash',
        maxToolSteps: 5,
      },
      audio: {
        sttSilenceDurationMs: 500,
        minUtteranceMs: 200,
        maxUtteranceMs: 15000,
        ttsVoiceName: 'en-US-Standard-C',
      },
      status: {
        embedIntervalSec: 5,
      },
      runtime: {
        nodeEnv: 'test',
        logLevel: 'info',
        mockAll: true,
      },
    };

    progressReporter = new ProgressReporter(discordGateway, audioQueue, {
      defaultChannelId: 'chat-bridge-chan',
      enableVoiceTTS: true,
    });

    coordinator = new AgentCoordinator(
      discordGateway,
      minecraftAgent,
      planner,
      progressReporter,
      config,
      audioQueue
    );
  });

  describe('Task Assignment & Safety', () => {
    it('successfully assigns task to connected agent and executes plan', async () => {
      await coordinator.assignTask({ goal: 'go to 10 64 20', user: 'DiscordUser#1' });

      // Allow background stream to process
      await new Promise((r) => setTimeout(r, 50));

      // Discord received progress messages
      expect(discordGateway.sentMessages.length).toBeGreaterThanOrEqual(1);
      const stepMsg = discordGateway.sentMessages.find((m) => m.content?.includes('goToCoordinates'));
      expect(stepMsg).toBeDefined();

      // Audio queue received TTS item
      expect(audioQueue.items.length).toBeGreaterThanOrEqual(1);
      const ttsItem = audioQueue.items.find((i) => i.priority === AudioPriority.NORMAL);
      expect(ttsItem).toBeDefined();
    });

    it('rejects task assignment when Minecraft bot is disconnected', async () => {
      await minecraftAgent.disconnect();

      await expect(
        coordinator.assignTask({ goal: 'gather wood', user: 'DiscordUser#1' })
      ).rejects.toThrow('Cannot assign task: Minecraft agent is disconnected.');
    });

    it('cancels previous task if new task is assigned while executing', async () => {
      // First task
      await coordinator.assignTask({ goal: 'defend area', user: 'User1' });

      // Immediate second task replaces it
      await coordinator.assignTask({ goal: 'go to 5 64 5', user: 'User2' });
      await new Promise((r) => setTimeout(r, 50));

      const finalStatus = minecraftAgent.getStatus();
      expect(finalStatus.position).toEqual({ x: 5, y: 64, z: 5 });
    });
  });

  describe('ProgressReporter Multi-Priority Streaming', () => {
    it('routes tool_call to Discord text and AudioPriority.NORMAL TTS', async () => {
      await progressReporter.reportEvent(
        {
          type: 'tool_call',
          toolName: 'goToCoordinates',
          toolArgs: { x: 10, y: 64, z: 20 },
          turn: 1,
        },
        {
          botStatus: minecraftAgent.getStatus(),
          userPrompt: 'go to 10 64 20',
          source: 'discord_slash',
          channelId: 'chat-bridge-chan',
        }
      );

      const sent = discordGateway.sentMessages[discordGateway.sentMessages.length - 1];
      expect(sent.content).toContain('goToCoordinates');

      const queued = audioQueue.items[audioQueue.items.length - 1];
      expect(queued.priority).toBe(AudioPriority.NORMAL);
      expect(queued.text).toContain('go to coordinates');
    });

    it('routes obstacle (tool_result failure) to AudioPriority.HIGH TTS', async () => {
      await progressReporter.reportEvent(
        {
          type: 'tool_result',
          toolName: 'mineBlock',
          result: { success: false, message: 'Tool tier insufficient' },
          turn: 2,
        },
        {
          botStatus: minecraftAgent.getStatus(),
          userPrompt: 'mine diamond',
          source: 'discord_slash',
          channelId: 'chat-bridge-chan',
        }
      );

      const sent = discordGateway.sentMessages[discordGateway.sentMessages.length - 1];
      expect(sent.content).toContain('⚠️ **Obstacle**');

      const queued = audioQueue.items[audioQueue.items.length - 1];
      expect(queued.priority).toBe(AudioPriority.HIGH);
      expect(queued.text).toContain('Tool tier insufficient');
    });

    it('routes task completion to AudioPriority.HIGH TTS', async () => {
      await progressReporter.reportEvent(
        {
          type: 'done',
          message: 'Gathered 10 logs successfully.',
          turn: 3,
        },
        {
          botStatus: minecraftAgent.getStatus(),
          userPrompt: 'gather 10 logs',
          source: 'discord_slash',
          channelId: 'chat-bridge-chan',
        }
      );

      const sent = discordGateway.sentMessages[discordGateway.sentMessages.length - 1];
      expect(sent.content).toContain('✅ **Task Finished**');

      const queued = audioQueue.items[audioQueue.items.length - 1];
      expect(queued.priority).toBe(AudioPriority.HIGH);
    });

    it('routes error to AudioPriority.HIGH TTS', async () => {
      await progressReporter.reportEvent(
        {
          type: 'error',
          message: 'Pathfinding timed out.',
          turn: 1,
        },
        {
          botStatus: minecraftAgent.getStatus(),
          userPrompt: 'go somewhere',
          source: 'discord_slash',
          channelId: 'chat-bridge-chan',
        }
      );

      const sent = discordGateway.sentMessages[discordGateway.sentMessages.length - 1];
      expect(sent.content).toContain('❌ **Error**');

      const queued = audioQueue.items[audioQueue.items.length - 1];
      expect(queued.priority).toBe(AudioPriority.HIGH);
    });
  });

  describe('Emergency Survival Alerts & Audio Preemption', () => {
    it('broadcasts survival alerts with EMERGENCY priority to Discord and voice queue', async () => {
      await coordinator.broadcastSurvivalAlert('Creeper spotted behind bot!', AudioPriority.EMERGENCY);

      const lastMsg = discordGateway.sentMessages[discordGateway.sentMessages.length - 1];
      expect(lastMsg.content).toContain('🚨 **SURVIVAL EMERGENCY**: Creeper spotted behind bot!');

      const lastAudio = audioQueue.items[audioQueue.items.length - 1];
      expect(lastAudio.priority).toBe(AudioPriority.EMERGENCY);
      expect(lastAudio.text).toBe('Creeper spotted behind bot!');
    });

    it('triggers survival alert and stops task automatically on bot death', async () => {
      await coordinator.assignTask({ goal: 'patrol perimeter', user: 'Admin' });

      // Simulate bot death in-game
      minecraftAgent.bot.health = 0;
      minecraftAgent.bot.emit('health');

      await new Promise((r) => setTimeout(r, 20));

      const deathAlert = discordGateway.sentMessages.find((m) =>
        m.content?.includes('Agent died in-game')
      );
      expect(deathAlert).toBeDefined();

      const emgAudio = audioQueue.items.find((i) => i.priority === AudioPriority.EMERGENCY);
      expect(emgAudio).toBeDefined();
    });

    it('triggers low health warning on statusUpdate when health <= 6', async () => {
      minecraftAgent.bot.health = 4.0;
      minecraftAgent.bot.emit('health');

      await new Promise((r) => setTimeout(r, 20));

      const hpAlert = discordGateway.sentMessages.find((m) =>
        m.content?.includes('Low health warning')
      );
      expect(hpAlert).toBeDefined();
      expect(hpAlert?.content).toContain('4.0/20');
    });
  });

  describe('Emergency Halt Protocol (stopCurrentTask)', () => {
    it('halts planner, cancels non-emergency audio, and resets task state', async () => {
      await coordinator.assignTask({ goal: 'explore coords 100 64 100', user: 'User' });

      await coordinator.stopCurrentTask();

      expect(planner.isExecuting()).toBe(false);
      expect(audioQueue.cancelledNonEmergencyCount).toBeGreaterThanOrEqual(1);

      const stopMsg = discordGateway.sentMessages.find((m) =>
        m.content?.includes('Emergency Stop: Active task halted')
      );
      expect(stopMsg).toBeDefined();
    });
  });

  describe('Multimodal Voice Prompt Routing', () => {
    it('routes voice "stop" prompt to emergency halt', async () => {
      await coordinator.assignTask({ goal: 'mine 5 iron', user: 'User' });

      await coordinator.handleVoicePrompt({
        userId: 'voice-user-123',
        prompt: 'stop immediately',
        source: 'voice',
      });

      expect(planner.isExecuting()).toBe(false);
      const stopMsg = discordGateway.sentMessages.find((m) =>
        m.content?.includes('Emergency Stop')
      );
      expect(stopMsg).toBeDefined();
    });

    it('routes voice goal prompt to task assignment', async () => {
      await coordinator.handleVoicePrompt({
        userId: 'voice-user-456',
        prompt: 'go to 0 64 0',
        source: 'voice',
      });

      await new Promise((r) => setTimeout(r, 50));

      const status = minecraftAgent.getStatus();
      expect(status.position).toEqual({ x: 0, y: 64, z: 0 });
    });
  });

  describe('Voice Session Join / Leave & Inventory Inspection', () => {
    it('joins and leaves voice channel via coordinator', async () => {
      await coordinator.joinVoiceChannel('v-chan-1', 'guild-123');
      expect(discordGateway.activeVoiceSessions.has('guild-123')).toBe(true);

      await coordinator.leaveVoiceChannel('guild-123');
      expect(discordGateway.activeVoiceSessions.has('guild-123')).toBe(false);
    });

    it('returns structured inventory and equipped gear overview', () => {
      const inv = coordinator.getInventory();
      expect(inv.totalSlots).toBe(36);
      expect(inv.gear).toBeDefined();
      expect(inv.gear?.mainHand).toBeDefined();
    });
  });
});
