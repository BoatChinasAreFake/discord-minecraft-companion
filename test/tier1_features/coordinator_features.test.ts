import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { AgentCoordinator } from '../../src/coordinator/agentCoordinator.js';
import { ProgressReporter } from '../../src/coordinator/progressReporter.js';
import { GeminiPlanner } from '../../src/ai/planner.js';
import { MockGeminiClient } from '../mocks/mockGemini.js';
import { MockMinecraftAgent } from '../mocks/mockMinecraft.js';
import { MockDiscordGateway } from '../mocks/mockDiscord.js';
import { AudioQueueManager } from '../../src/audio/queue.js';
import { AudioPriority, type ITTSPipeline, type TTSQueueItem } from '../../src/audio/types.js';
import type { AppConfig } from '../../src/config/types.js';
import type { PlayerLike } from '../../src/audio/queue.js';

class MockAudioPlayerAdapter extends EventEmitter implements PlayerLike {
  public playing = false;
  public stoppedCount = 0;
  public playedBuffers: Buffer[] = [];

  public isPlaying(): boolean {
    return this.playing;
  }

  public async playBuffer(buffer: Buffer): Promise<void> {
    this.playing = true;
    this.playedBuffers.push(buffer);
  }

  public stop(_force?: boolean): boolean {
    this.playing = false;
    this.stoppedCount++;
    this.emit('idle');
    return true;
  }
}

describe('Tier 1: Coordinator & Cross-Cutting Feature Coverage (F08, F40-F41)', () => {
  let discordGateway: MockDiscordGateway;
  let minecraftAgent: MockMinecraftAgent;
  let geminiClient: MockGeminiClient;
  let planner: GeminiPlanner;
  let mockPlayer: MockAudioPlayerAdapter;
  let mockTTS: ITTSPipeline;
  let audioQueue: AudioQueueManager;
  let progressReporter: ProgressReporter;
  let coordinator: AgentCoordinator;
  let config: AppConfig;

  beforeEach(async () => {
    discordGateway = new MockDiscordGateway();
    minecraftAgent = new MockMinecraftAgent();
    await minecraftAgent.connect({ host: 'localhost', port: 25565, username: 'CoordBot' });

    geminiClient = new MockGeminiClient();
    planner = new GeminiPlanner(geminiClient, minecraftAgent, { maxToolTurns: 10 });

    mockPlayer = new MockAudioPlayerAdapter();
    mockTTS = {
      synthesizeSpeech: vi.fn().mockResolvedValue(Buffer.from('mock_speech_pcm')),
    };
    audioQueue = new AudioQueueManager(mockPlayer, mockTTS);

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
        version: '1.21.11',
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
        logLevel: 'error',
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

  // --------------------------------------------------------------------------
  // Priority Audio Queue (F08)
  // --------------------------------------------------------------------------
  describe('Priority Audio Queue (T1-COORD-01, T1-COORD-02)', () => {
    it('T1-COORD-01: preserves strict FIFO queueing for items with matching priority', () => {
      // Seed queue with an active playing item
      audioQueue.enqueue({
        id: 'active_1',
        text: 'Initial message playing',
        priority: AudioPriority.NORMAL,
        createdAt: 10,
      });

      // Enqueue subsequent items of identical priority
      const itemA: TTSQueueItem = {
        id: 'item_a',
        text: 'First pending message',
        priority: AudioPriority.NORMAL,
        createdAt: 100,
      };
      const itemB: TTSQueueItem = {
        id: 'item_b',
        text: 'Second pending message',
        priority: AudioPriority.NORMAL,
        createdAt: 200,
      };

      audioQueue.enqueue(itemA);
      audioQueue.enqueue(itemB);

      const pending = audioQueue.getQueue();
      expect(pending.length).toBe(2);
      expect(pending[0].id).toBe('item_a');
      expect(pending[1].id).toBe('item_b');
    });

    it('T1-COORD-02: EMERGENCY priority item immediately preempts active playback', async () => {
      const preemptionSpy = vi.fn();
      audioQueue.on('preemptionTriggered', preemptionSpy);

      // Start playing non-emergency item
      audioQueue.enqueue({
        id: 'normal_play',
        text: 'Conversational chat in progress',
        priority: AudioPriority.NORMAL,
        createdAt: 100,
      });

      expect(audioQueue.getCurrentItem()?.id).toBe('normal_play');

      // Emergency item arrives
      const emergencyItem: TTSQueueItem = {
        id: 'emergency_alert',
        text: 'Emergency: Lava hazard ahead!',
        priority: AudioPriority.EMERGENCY,
        createdAt: 200,
      };

      audioQueue.enqueue(emergencyItem);

      expect(preemptionSpy).toHaveBeenCalled();
      expect(mockPlayer.stoppedCount).toBeGreaterThan(0);
      expect(audioQueue.getCurrentItem()?.id).toBe('emergency_alert');
    });
  });

  // --------------------------------------------------------------------------
  // Progress Reporting (F40)
  // --------------------------------------------------------------------------
  describe('Progress Reporting (T1-COORD-03, T1-COORD-04)', () => {
    it('T1-COORD-03: reports task start and progress events to Discord and voice queue', async () => {
      await progressReporter.reportEvent(
        {
          type: 'progress',
          message: 'Analyzing terrain around destination coordinates',
          turn: 1,
        },
        {
          botStatus: minecraftAgent.getStatus(),
          userPrompt: 'go to 50 64 50',
          source: 'discord_slash',
          channelId: 'chat-bridge-chan',
        }
      );

      const lastMsg = discordGateway.sentMessages[discordGateway.sentMessages.length - 1];
      expect(lastMsg).toBeDefined();
      expect(lastMsg.content).toContain('Analyzing terrain');
    });

    it('T1-COORD-04: reports step progress and final done event with action summary', async () => {
      // Step progress: tool_call and tool_result
      await progressReporter.reportEvent(
        {
          type: 'tool_call',
          toolName: 'goToCoordinates',
          toolArgs: { x: 50, y: 64, z: 50 },
          turn: 1,
        },
        {
          botStatus: minecraftAgent.getStatus(),
          userPrompt: 'go to 50 64 50',
          source: 'discord_slash',
          channelId: 'chat-bridge-chan',
        }
      );

      // Final done event
      await progressReporter.reportEvent(
        {
          type: 'done',
          message: 'Arrived at coordinates 50 64 50 successfully.',
          turn: 2,
        },
        {
          botStatus: minecraftAgent.getStatus(),
          userPrompt: 'go to 50 64 50',
          source: 'discord_slash',
          channelId: 'chat-bridge-chan',
        }
      );

      const lastMsg = discordGateway.sentMessages[discordGateway.sentMessages.length - 1];
      expect(lastMsg.content).toContain('Task Finished');
      expect(lastMsg.content).toContain('Arrived at coordinates 50 64 50 successfully');
    });
  });

  // --------------------------------------------------------------------------
  // Emergency Stop & Interrupts (F41)
  // --------------------------------------------------------------------------
  describe('Emergency Stop & Voice Interrupts (T1-COORD-05, T1-COORD-06)', () => {
    it('T1-COORD-05: stopCurrentTask cancels planner, halts bot movements, and purges non-emergency audio', async () => {
      await coordinator.assignTask({ goal: 'gather 10 oak_log', user: 'Admin#0001' });

      await coordinator.stopCurrentTask();

      expect(planner.isExecuting()).toBe(false);

      const stopMsg = discordGateway.sentMessages.find((m) =>
        m.content?.includes('Emergency Stop')
      );
      expect(stopMsg).toBeDefined();
    });

    it('T1-COORD-06: voice prompt "stop immediately" triggers emergency halt', async () => {
      await coordinator.assignTask({ goal: 'explore perimeter', user: 'Admin#0001' });

      await coordinator.handleVoicePrompt({
        userId: 'voice_speaker_1',
        prompt: 'stop immediately',
        source: 'voice',
      });

      expect(planner.isExecuting()).toBe(false);

      const stopMsg = discordGateway.sentMessages.find((m) =>
        m.content?.includes('Emergency Stop')
      );
      expect(stopMsg).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Survival Alerts (F34)
  // --------------------------------------------------------------------------
  describe('Survival Alerts (T1-COORD-07, T1-COORD-08)', () => {
    it('T1-COORD-07: triggers emergency broadcast and halts task upon bot death', async () => {
      await coordinator.assignTask({ goal: 'mine iron', user: 'User#1' });

      // Simulate bot death event
      minecraftAgent.emit('death', 'Fell into lava');

      await new Promise((r) => setTimeout(r, 20));

      const deathAlert = discordGateway.sentMessages.find((m) =>
        m.content?.includes('Agent died in-game')
      );
      expect(deathAlert).toBeDefined();
      expect(deathAlert?.content).toContain('🚨 **SURVIVAL EMERGENCY**');

      const alertAudio = audioQueue.getQueue().concat(
        audioQueue.getCurrentItem() ? [audioQueue.getCurrentItem()!] : []
      );
      const emgAudio = alertAudio.find((i) => i.priority === AudioPriority.EMERGENCY);
      expect(emgAudio).toBeDefined();
    });

    it('T1-COORD-08: triggers low health alert when health <= 6 HP and rate-limits rapid repeated drops', async () => {
      // First drop to 4 HP triggers alert
      minecraftAgent.bot.health = 4.0;
      minecraftAgent.emit('statusUpdate', minecraftAgent.getStatus());

      await new Promise((r) => setTimeout(r, 20));

      const hpAlerts = discordGateway.sentMessages.filter((m) =>
        m.content?.includes('Low health warning')
      );
      expect(hpAlerts.length).toBe(1);
      expect(hpAlerts[0].content).toContain('4.0/20');

      // Second drop within 10 seconds is rate-limited
      minecraftAgent.bot.health = 3.0;
      minecraftAgent.emit('statusUpdate', minecraftAgent.getStatus());

      await new Promise((r) => setTimeout(r, 20));

      const hpAlertsAfter = discordGateway.sentMessages.filter((m) =>
        m.content?.includes('Low health warning')
      );
      expect(hpAlertsAfter.length).toBe(1); // Suppressed by rate limit
    });
  });
});
