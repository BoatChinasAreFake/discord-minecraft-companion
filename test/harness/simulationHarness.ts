/**
 * Simulation Harness.
 *
 * Central dependency-injection container and deterministic test orchestrator
 * wiring MockDiscordGateway, MockVoiceSession, MockMinecraftAgent, MockWorld,
 * MockMineflayerBot, MockGeminiClient, MockSTTProvider, MockTTSProvider,
 * AudioQueueManager, MockPlayerAdapter, VoiceReceiver, ChatBridge, StatusEmbedManager,
 * CommandRegistry, RBACService, GeminiPlanner, ProgressReporter, and AgentCoordinator.
 *
 * Provides lifecycle controls (start, stop, reset), deterministic event simulators,
 * and asynchronous synchronization helpers for 100% offline verification.
 */

import { EventEmitter } from 'node:events';
import type { AppConfig } from '../../src/config/types.js';
import type {
  IDiscordGateway,
  IVoiceSession,
  UserMessage,
  EmbedData,
  CommandContext,
} from '../../src/discord/types.js';
import type {
  IMinecraftAgent,
  MinecraftBotStatus,
  MinecraftConnectionConfig,
  Vec3Location,
} from '../../src/minecraft/types.js';
import type { IMinecraftChatAgent } from '../../src/bridge/types.js';
import type { GeminiTurnResponse, MockTurnHandler } from '../mocks/mockGemini.js';
import { MockDiscordGateway, type RecordedSentMessage } from '../mocks/mockDiscord.js';
import { MockVoiceSession, type RecordedAudioPlayback } from '../mocks/mockVoice.js';
import {
  MockWorld,
  MockMineflayerBot,
  MockMinecraftAgent,
} from '../mocks/mockMinecraft.js';
import { MinecraftClient } from '../../src/minecraft/client.js';
import { MockGeminiClient } from '../mocks/mockGemini.js';
import { MockSTTProvider, STTPipeline } from '../../src/audio/stt.js';
import { MockTTSProvider, TTSPipeline } from '../../src/audio/tts.js';
import { AudioQueueManager, type PlayerLike } from '../../src/audio/queue.js';
import { AudioPriority, type TTSQueueItem } from '../../src/audio/types.js';
import { VoiceReceiver } from '../../src/audio/receiver.js';
import { ChatBridge } from '../../src/bridge/chatBridge.js';
import { StatusEmbedManager } from '../../src/discord/embed.js';
import {
  CommandRegistry,
  createDefaultCommandRegistry,
} from '../../src/discord/commands/index.js';
import { withAutoDefer } from '../../src/discord/commands/deferral.js';
import { RBACService } from '../../src/discord/rbac.js';
import { GeminiPlanner } from '../../src/ai/planner.js';
import { ProgressReporter } from '../../src/coordinator/progressReporter.js';
import { AgentCoordinator } from '../../src/coordinator/agentCoordinator.js';
import {
  isPrivilegedCommand,
  PrivilegedCommandError,
} from '../../src/minecraft/fairplay/commandSanitizer.js';

export class MockPlayerAdapter extends EventEmitter implements PlayerLike {
  private playing = false;

  constructor(private voiceSession: MockVoiceSession) {
    super();
  }

  public isPlaying(): boolean {
    return this.playing || this.voiceSession.isAudioPlaying;
  }

  public async playBuffer(buffer: Buffer, options?: any): Promise<void> {
    this.playing = true;
    try {
      await this.voiceSession.playAudioStream(buffer, options?.priority ?? 'NORMAL');
    } finally {
      this.playing = false;
      setImmediate(() => {
        this.emit('idle');
      });
    }
  }

  public stop(force?: boolean): boolean {
    this.playing = false;
    this.voiceSession.stopAudio();
    setImmediate(() => {
      this.emit('idle');
    });
    return true;
  }
}

export function createSyntheticPcmBuffer(durationMs = 400, sampleRate = 48000): Buffer {
  const bytesPerMs = (sampleRate * 2 * 2) / 1000;
  const buffer = Buffer.alloc(Math.floor(durationMs * bytesPerMs));
  for (let i = 0; i < buffer.length - 1; i += 2) {
    buffer.writeInt16LE(1500, i);
  }
  return buffer;
}

export interface SimulationHarnessOptions {
  configOverrides?: Partial<AppConfig>;
  /** Use real MinecraftClient with MockMineflayerBot instead of MockMinecraftAgent */
  useRealMinecraftClient?: boolean;
  /** Auto-connect Minecraft agent on start (default: true) */
  autoConnectMinecraft?: boolean;
  /** Initial bot spawn position (default: { x: 0, y: 64, z: 0 }) */
  initialBotPosition?: Vec3Location;
  /** Initial world surface type (default: 'grass_block') */
  worldSurface?: string;
}

export interface SimulateSlashCommandOptions {
  commandName: string;
  subcommand?: string;
  options?: Record<string, any>;
  user?: {
    id: string;
    username: string;
    tag?: string;
    bot?: boolean;
  };
  member?: any;
  guildId?: string;
  channelId?: string;
}

export interface SimulateSlashCommandResult {
  commandName: string;
  allowed: boolean;
  replied: boolean;
  deferred: boolean;
  replyContent?: string;
  replyEmbeds?: any[];
  error?: Error;
}

export class SimulationHarness {
  public readonly config: AppConfig;
  public readonly options: SimulationHarnessOptions;

  // Mocks
  public readonly mockDiscord: MockDiscordGateway;
  public readonly mockVoiceSession: MockVoiceSession;
  public readonly mockWorld: MockWorld;
  public readonly mockBot: MockMineflayerBot;
  public readonly minecraftAgent: IMinecraftAgent & IMinecraftChatAgent;
  public readonly mockGemini: MockGeminiClient;
  public readonly mockSTT: MockSTTProvider;
  public readonly sttPipeline: STTPipeline;
  public readonly mockTTS: MockTTSProvider;
  public readonly ttsPipeline: TTSPipeline;
  public readonly mockPlayerAdapter: MockPlayerAdapter;

  // Subsystems
  public readonly audioQueue: AudioQueueManager;
  public readonly voiceReceiver: VoiceReceiver;
  public readonly chatBridge: ChatBridge;
  public readonly statusEmbedManager: StatusEmbedManager;
  public readonly commandRegistry: CommandRegistry;
  public readonly rbacService: RBACService;
  public readonly planner: GeminiPlanner;
  public readonly progressReporter: ProgressReporter;
  public readonly coordinator: AgentCoordinator;
  public readonly commandContext: CommandContext;

  // Tracking state for assertions
  public executedCommands: string[] = [];
  public fairPlayViolations: string[] = [];
  public emergencyPreemptions: any[] = [];
  public preemptedItems: TTSQueueItem[] = [];

  private isStarted = false;

  constructor(options: SimulationHarnessOptions = {}) {
    this.options = options;

    const defaultConfig: AppConfig = {
      discord: {
        token: 'mock_discord_token',
        clientId: 'mock_client_id_1',
        guildId: 'guild_test_1',
        chatBridgeChannelId: 'bridge_channel_1',
        statusChannelId: 'status_channel_1',
        voiceChannelId: 'voice_channel_1',
        controlChannelId: 'control_channel_1',
      },
      rbac: {
        allowedRoleIds: ['role_operator'],
        allowedUserIds: ['user_operator'],
        adminRoleIds: ['role_admin'],
        adminUserIds: ['user_admin'],
      },
      minecraft: {
        host: 'localhost',
        port: 25565,
        username: 'MockSurvivalBot',
        version: '1.20.4',
        auth: 'offline',
      },
      gemini: {
        apiKey: 'mock_gemini_key',
        model: 'gemini-3.8-flash',
        maxToolSteps: 10,
      },
      audio: {
        sttSilenceDurationMs: 500,
        minUtteranceMs: 200,
        maxUtteranceMs: 15000,
        ttsVoiceName: 'en-US-Standard-C',
      },
      status: {
        embedIntervalSec: 1, // Fast interval for testing
      },
      runtime: {
        nodeEnv: 'test',
        logLevel: 'error',
        mockAll: true,
      },
    };

    this.config = {
      ...defaultConfig,
      ...options.configOverrides,
      discord: { ...defaultConfig.discord, ...options.configOverrides?.discord },
      rbac: { ...defaultConfig.rbac, ...options.configOverrides?.rbac },
      minecraft: { ...defaultConfig.minecraft, ...options.configOverrides?.minecraft },
      gemini: { ...defaultConfig.gemini, ...options.configOverrides?.gemini },
      audio: { ...defaultConfig.audio, ...options.configOverrides?.audio },
      status: { ...defaultConfig.status, ...options.configOverrides?.status },
      runtime: { ...defaultConfig.runtime, ...options.configOverrides?.runtime },
    };

    // 1. Core Discord Mocks
    this.mockDiscord = new MockDiscordGateway();
    const voiceChannelId = this.config.discord.voiceChannelId || 'voice_channel_1';
    const guildId = this.config.discord.guildId || 'guild_test_1';
    this.mockVoiceSession = new MockVoiceSession(voiceChannelId, guildId);
    this.mockDiscord.activeVoiceSessions.set(guildId, this.mockVoiceSession);

    // 2. Audio Pipeline & Player Adapter
    this.mockSTT = new MockSTTProvider();
    this.sttPipeline = new STTPipeline(this.mockSTT);
    this.mockTTS = new MockTTSProvider();
    this.ttsPipeline = new TTSPipeline(this.mockTTS);
    this.mockPlayerAdapter = new MockPlayerAdapter(this.mockVoiceSession);
    this.audioQueue = new AudioQueueManager(this.mockPlayerAdapter, this.ttsPipeline);

    // Attach audio queue to voice session
    (this.mockVoiceSession as any).queue = this.audioQueue;

    // Hook audio queue events for assertions
    this.audioQueue.on('preemptionTriggered', (data) => {
      this.emergencyPreemptions.push(data);
    });
    this.audioQueue.on('itemPreempted', (item) => {
      this.preemptedItems.push(item);
    });

    this.voiceReceiver = new VoiceReceiver({
      minUtteranceDurationMs: this.config.audio.minUtteranceMs,
      noiseThresholdRms: 200,
    });
    (this.mockVoiceSession as any).receiver = this.voiceReceiver;

    // 3. Minecraft Environment & Agent
    this.mockWorld = new MockWorld();
    this.mockWorld.createFlatWorld(0, 60, 63, options.worldSurface ?? 'grass_block');
    this.mockBot = new MockMineflayerBot(
      this.mockWorld,
      options.initialBotPosition ?? { x: 0, y: 64, z: 0 }
    );

    // Hook bot chat & check for privileged commands
    this.mockBot.on('chat', (sender: string, message: string) => {
      if (sender === 'bot') {
        this.executedCommands.push(message);
        if (isPrivilegedCommand(message)) {
          this.fairPlayViolations.push(`Privileged command executed: ${message}`);
        }
      }
    });

    if (options.useRealMinecraftClient) {
      this.minecraftAgent = new MinecraftClient({
        bot: this.mockBot,
        statusThrottleMs: 10,
        enableAutoEat: true,
        enableAutoSleep: true,
        enableAutoEquip: true,
      });
    } else {
      this.minecraftAgent = new MockMinecraftAgent(this.mockWorld, this.mockBot);
    }

    // 4. Gemini AI Planner
    this.mockGemini = new MockGeminiClient(this.config.gemini.model);
    this.planner = new GeminiPlanner(this.mockGemini, this.minecraftAgent, {
      maxToolTurns: this.config.gemini.maxToolSteps || 10,
    });

    // 5. Progress Reporter & Status Embed Manager
    this.progressReporter = new ProgressReporter(this.mockDiscord, this.audioQueue, {
      defaultChannelId: this.config.discord.chatBridgeChannelId,
      enableVoiceTTS: true,
    });

    this.statusEmbedManager = new StatusEmbedManager(this.mockDiscord, {
      statusChannelId:
        this.config.discord.statusChannelId || this.config.discord.chatBridgeChannelId,
      updateIntervalSec: this.config.status.embedIntervalSec,
    });

    // Wire bot status update to live embed manager
    this.minecraftAgent.on('statusUpdate', (status: MinecraftBotStatus) => {
      this.statusEmbedManager.updateState(status);
    });

    // 6. Chat Bridge
    this.chatBridge = new ChatBridge(this.mockDiscord, this.minecraftAgent, {
      bridgeChannelId: this.config.discord.chatBridgeChannelId,
      botDiscordId: this.config.discord.clientId,
      botMinecraftUsername: this.config.minecraft.username,
      rateLimitDelayMs: 10, // Fast leaky-bucket for deterministic tests
      maxQueueSize: 50,
    });

    // 7. Slash Commands & RBAC
    this.commandRegistry = createDefaultCommandRegistry();
    this.rbacService = new RBACService(this.config);

    // 8. Agent Coordinator
    this.coordinator = new AgentCoordinator(
      this.mockDiscord,
      this.minecraftAgent,
      this.planner,
      this.progressReporter,
      this.config,
      this.audioQueue
    );

    // 9. Command Context wiring
    this.commandContext = {
      coordinator: {
        getMinecraftStatus: () => this.coordinator.getMinecraftStatus(),
        connectMinecraft: (cfg: MinecraftConnectionConfig) =>
          this.coordinator.connectMinecraft(cfg),
        disconnectMinecraft: () => this.coordinator.disconnectMinecraft(),
        assignTask: (t: { goal: string; user: string }) => this.coordinator.assignTask(t),
        stopCurrentTask: () => this.coordinator.stopCurrentTask(),
        getInventory: () => this.coordinator.getInventory(),
        joinVoiceChannel: (c: string, g?: string) => this.coordinator.joinVoiceChannel(c, g),
        leaveVoiceChannel: (g?: string) => this.coordinator.leaveVoiceChannel(g),
      },
    };
  }

  // --------------------------------------------------------------------------
  // Lifecycle Management
  // --------------------------------------------------------------------------

  public async start(): Promise<void> {
    if (this.isStarted) return;
    this.isStarted = true;

    // Connect Minecraft agent if configured
    if (this.options.autoConnectMinecraft !== false) {
      await this.minecraftAgent.connect({
        host: this.config.minecraft.host,
        port: this.config.minecraft.port,
        username: this.config.minecraft.username,
      });
    }

    // Initialize status in embed manager
    this.statusEmbedManager.updateState(this.minecraftAgent.getStatus());

    // Start ChatBridge and StatusEmbedManager
    this.chatBridge.start();
    this.statusEmbedManager.start();

    // Register commands with mock Discord gateway
    await this.mockDiscord.registerCommands(this.commandRegistry.getAll());

    // Join default voice session
    await this.coordinator.joinVoiceChannel(
      this.config.discord.voiceChannelId || 'voice_channel_1',
      this.config.discord.guildId || 'guild_test_1'
    );
  }

  public async stop(): Promise<void> {
    if (!this.isStarted) return;
    this.isStarted = false;

    await this.coordinator.stopCurrentTask();
    this.chatBridge.stop();
    this.statusEmbedManager.stop();
    this.audioQueue.stopAll();
    await this.minecraftAgent.disconnect();
    await this.mockDiscord.leaveVoice(this.config.discord.guildId || 'guild_test_1');
  }

  public reset(): void {
    this.mockDiscord.reset();
    this.mockVoiceSession.reset();
    this.mockGemini.reset();
    this.mockSTT.clearQueue();
    this.audioQueue.stopAll();

    this.mockWorld.clear();
    this.mockWorld.createFlatWorld(0, 60, 63, this.options.worldSurface ?? 'grass_block');

    this.mockBot.health = 20.0;
    this.mockBot.food = 20;
    this.mockBot.foodSaturation = 5.0;
    const startPos = this.options.initialBotPosition ?? { x: 0, y: 64, z: 0 };
    this.mockBot.entity.position.set(startPos.x, startPos.y, startPos.z);
    this.mockBot.inventory.slots.fill(null);

    this.executedCommands = [];
    this.fairPlayViolations = [];
    this.emergencyPreemptions = [];
    this.preemptedItems = [];

    // Re-register commands and update status
    this.statusEmbedManager.updateState(this.minecraftAgent.getStatus());
  }

  // --------------------------------------------------------------------------
  // Deterministic Event Simulators
  // --------------------------------------------------------------------------

  public async simulateSlashCommand(
    options: SimulateSlashCommandOptions
  ): Promise<SimulateSlashCommandResult> {
    const command = this.commandRegistry.get(options.commandName);
    if (!command) {
      return {
        commandName: options.commandName,
        allowed: false,
        replied: false,
        deferred: false,
        error: new Error(`Unknown command: /${options.commandName}`),
      };
    }

    const user = {
      id: options.user?.id ?? 'user_admin',
      username: options.user?.username ?? 'TestAdmin',
      tag: options.user?.tag ?? `${options.user?.username ?? 'TestAdmin'}#0001`,
      bot: options.user?.bot ?? false,
    };

    const member = options.member ?? {
      id: user.id,
      user,
      roles: ['role_admin'],
      permissions: {
        has: () => true,
        bitfield: 8n,
      },
    };

    const guildId = options.guildId ?? this.config.discord.guildId ?? 'guild_test_1';
    const channelId = options.channelId ?? this.config.discord.chatBridgeChannelId;
    const guild = {
      id: guildId,
      ownerId: 'user_admin',
    };

    // RBAC Security Evaluation
    const rbacResult = this.rbacService.check(member, user as any, command.tier, guild as any);

    if (!rbacResult.allowed) {
      return {
        commandName: command.name,
        allowed: false,
        replied: true,
        deferred: false,
        replyContent: rbacResult.reason || '⛔ Permission Denied.',
      };
    }

    let replied = false;
    let deferred = false;
    let replyContent: string | undefined;
    let replyEmbeds: any[] | undefined;

    const mockInteraction: any = {
      commandName: command.name,
      user,
      member,
      guild,
      guildId,
      channelId,
      get deferred() {
        return deferred;
      },
      get replied() {
        return replied;
      },
      options: {
        getString: (name: string) => {
          const val = options.options?.[name];
          return val !== undefined && val !== null ? String(val) : null;
        },
        getInteger: (name: string) => {
          const val = options.options?.[name];
          return val !== undefined && val !== null ? parseInt(String(val), 10) : null;
        },
        getNumber: (name: string) => {
          const val = options.options?.[name];
          return val !== undefined && val !== null ? Number(val) : null;
        },
        getBoolean: (name: string) => {
          const val = options.options?.[name];
          return val !== undefined && val !== null ? Boolean(val) : null;
        },
        getSubcommand: () =>
          options.subcommand ?? (options.options?.subcommand as string) ?? null,
        getChannel: (name: string) => {
          const val = options.options?.[name];
          if (!val) return null;
          return typeof val === 'object' ? val : { id: String(val), name: String(val) };
        },
        get: (name: string) => options.options?.[name] ?? null,
      },
      deferReply: async (_opts?: any) => {
        deferred = true;
      },
      reply: async (payload: any) => {
        replied = true;
        if (typeof payload === 'string') {
          replyContent = payload;
        } else if (payload && typeof payload === 'object') {
          if (payload.content !== undefined) replyContent = payload.content;
          if (payload.embeds) replyEmbeds = payload.embeds;
        }
        await this.mockDiscord.sendMessage(channelId, payload);
      },
      editReply: async (payload: any) => {
        replied = true;
        if (typeof payload === 'string') {
          replyContent = payload;
        } else if (payload && typeof payload === 'object') {
          if (payload.content !== undefined) replyContent = payload.content;
          if (payload.embeds) replyEmbeds = payload.embeds;
        }
        await this.mockDiscord.sendMessage(channelId, payload);
      },
      followUp: async (payload: any) => {
        if (typeof payload === 'string') {
          replyContent = payload;
        } else if (payload && typeof payload === 'object') {
          if (payload.content !== undefined) replyContent = payload.content;
          if (payload.embeds) replyEmbeds = payload.embeds;
        }
        await this.mockDiscord.sendMessage(channelId, payload);
      },
    };

    try {
      if (command.deferImmediately) {
        await mockInteraction.deferReply({ ephemeral: command.deferEphemeral ?? false });
        await command.execute(mockInteraction, this.commandContext);
      } else {
        await withAutoDefer(
          mockInteraction,
          { timeoutMs: 2500, ephemeral: command.deferEphemeral ?? false },
          () => command.execute(mockInteraction, this.commandContext)
        );
      }

      return {
        commandName: command.name,
        allowed: true,
        replied,
        deferred,
        replyContent,
        replyEmbeds,
      };
    } catch (err: any) {
      return {
        commandName: command.name,
        allowed: true,
        replied,
        deferred,
        replyContent,
        replyEmbeds,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  public async simulateDiscordChatMessage(
    content: string,
    author?: Partial<UserMessage['author']>,
    channelId?: string
  ): Promise<void> {
    const targetChannel = channelId ?? this.config.discord.chatBridgeChannelId;
    await this.mockDiscord.simulateUserMessage({
      content,
      channelId: targetChannel,
      author: {
        id: author?.id ?? 'sim_user_1',
        username: author?.username ?? 'TestUser',
        bot: author?.bot ?? false,
      },
    });
  }

  public async simulateMinecraftChat(username: string, message: string): Promise<void> {
    if (this.minecraftAgent) {
      this.minecraftAgent.emit('chat', username, message);
    }
  }

  public async simulateUserVoicePrompt(
    userId: string,
    promptText: string,
    pcmBuffer?: Buffer
  ): Promise<void> {
    // 1. Enqueue transcript in mock STT provider
    this.mockSTT.enqueueTranscript(promptText);

    // 2. Process audio buffer through voice receiver
    const audio = pcmBuffer ?? createSyntheticPcmBuffer(400);
    this.voiceReceiver.processPcmUtterance(userId, audio);

    // 3. Dispatch to coordinator handleVoicePrompt
    await this.coordinator.handleVoicePrompt({
      userId,
      prompt: promptText,
      source: 'voice',
    });
  }

  public simulateWorldBlock(pos: Vec3Location, blockName: string): void {
    this.mockWorld.setBlock(pos, blockName);
  }

  public simulateBotDamage(newHealth: number): void {
    this.mockBot.health = Math.max(0, newHealth);
    this.mockBot.emit('health');
  }

  public simulateBotHunger(food: number, saturation?: number): void {
    this.mockBot.food = Math.max(0, Math.min(20, food));
    if (saturation !== undefined) {
      this.mockBot.foodSaturation = saturation;
    }
    this.mockBot.emit('statusUpdate', this.minecraftAgent.getStatus());
  }

  public simulateWeather(isRaining: boolean, isThunder: boolean, timeOfDay?: number): void {
    this.mockBot.isRaining = isRaining;
    this.mockBot.thunderState = isThunder ? 1 : 0;
    if (timeOfDay !== undefined) {
      this.mockBot.time.timeOfDay = timeOfDay;
    }
    this.mockBot.emit('time');
    this.mockBot.emit('rain');
  }

  public scriptGeminiTurn(turn: GeminiTurnResponse): void {
    this.mockGemini.setScriptedTurns([turn]);
  }

  public setGeminiCustomHandler(handler?: MockTurnHandler): void {
    this.mockGemini.setCustomHandler(handler);
  }

  // --------------------------------------------------------------------------
  // Synchronization & Wait Helpers
  // --------------------------------------------------------------------------

  public async waitFor(
    predicate: () => boolean | Promise<boolean>,
    timeoutMs = 3000,
    intervalMs = 10
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const ok = await predicate();
        if (ok) return;
      } catch {
        // Continue polling until timeout
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Timeout of ${timeoutMs}ms exceeded waiting for condition.`);
  }

  public async waitForPlannerCompletion(timeoutMs = 3000): Promise<void> {
    await this.waitFor(() => !this.planner.isExecuting(), timeoutMs);
  }

  public async waitForDiscordMessage(
    matcher: string | RegExp | ((msg: RecordedSentMessage) => boolean),
    timeoutMs = 3000
  ): Promise<RecordedSentMessage> {
    let found: RecordedSentMessage | undefined;
    await this.waitFor(() => {
      found = this.mockDiscord.sentMessages.find((m) => {
        if (typeof matcher === 'string') return m.content?.includes(matcher);
        if (matcher instanceof RegExp) return matcher.test(m.content ?? '');
        return matcher(m);
      });
      return found !== undefined;
    }, timeoutMs);
    return found!;
  }

  public async waitForChatBridgeFlushed(timeoutMs = 3000): Promise<void> {
    await this.waitFor(() => this.chatBridge.getQueueLength() === 0, timeoutMs);
  }

  public async triggerStatusEmbedTick(force = true): Promise<boolean> {
    this.statusEmbedManager.updateState(this.minecraftAgent.getStatus());
    return await this.statusEmbedManager.tick(force);
  }
}
