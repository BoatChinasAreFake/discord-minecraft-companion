import { describe, it, expect, vi } from 'vitest';
import { MockDiscordGateway } from '../mocks/mockDiscord.js';
import { MockVoiceSession } from '../mocks/mockVoice.js';
import { ChatBridge } from '../../src/bridge/chatBridge.js';
import { AntiLoopbackFilter } from '../../src/bridge/antiLoopback.js';
import { StatusEmbedManager } from '../../src/discord/embed.js';
import { AudioQueueManager } from '../../src/audio/queue.js';
import { STTPipeline, MockSTTProvider } from '../../src/audio/stt.js';
import { TTSPipeline, MockTTSProvider } from '../../src/audio/tts.js';
import { VoiceReceiver } from '../../src/audio/receiver.js';
import { AudioPriority } from '../../src/audio/types.js';
import type { IMinecraftChatAgent } from '../../src/bridge/types.js';
import type { MinecraftBotStatus } from '../../src/minecraft/types.js';

describe('Milestone 1 End-to-End Integration Suite (test/m1/integration.test.ts)', () => {
  it('TC-INT-1: MockDiscordGateway captures messages, embeds, and voice sessions', async () => {
    const gateway = new MockDiscordGateway();

    // Send text message
    const msgId = await gateway.sendMessage('chan_1', 'Hello world');
    expect(gateway.sentMessages.length).toBe(1);
    expect(gateway.getLastSentMessage('chan_1')?.content).toBe('Hello world');

    // Update embed
    const embedData = { title: 'Test Title', color: 0x00ff00 };
    await gateway.updateEmbed('chan_1', msgId, embedData);
    expect(gateway.editedMessages.length).toBe(1);
    expect(gateway.editedMessages[0].embed.title).toBe('Test Title');

    // Voice session
    const voiceSession = await gateway.joinVoice('vchan_1', 'guild_1');
    expect(voiceSession).toBeInstanceOf(MockVoiceSession);
    expect(gateway.activeVoiceSessions.has('guild_1')).toBe(true);

    await gateway.leaveVoice('guild_1');
    expect(gateway.activeVoiceSessions.has('guild_1')).toBe(false);
  });

  it('TC-INT-2: End-to-end Bidirectional Chat Bridge with Anti-Loopback Filter', async () => {
    const gateway = new MockDiscordGateway();
    const sentToMinecraft: string[] = [];
    let mcChatListener: ((u: string, m: string) => void) | null = null;

    const mcAgent: IMinecraftChatAgent = {
      sendChat: vi.fn().mockImplementation(async (msg) => {
        sentToMinecraft.push(msg);
      }),
      on: vi.fn().mockImplementation((ev, l) => {
        if (ev === 'chat') mcChatListener = l;
      }),
      removeListener: vi.fn(),
    };

    const filter = new AntiLoopbackFilter({
      botDiscordId: 'bot_id',
      botMinecraftUsername: 'CompanionBot',
      ttlMs: 5000,
    });

    const bridge = new ChatBridge(
      gateway,
      mcAgent,
      {
        bridgeChannelId: 'bridge_chan',
        botDiscordId: 'bot_id',
        botMinecraftUsername: 'CompanionBot',
        rateLimitDelayMs: 20,
      },
      filter
    );

    bridge.start();

    // 1. User sends message in Discord bridge channel
    await gateway.simulateUserMessage({
      channelId: 'bridge_chan',
      author: { id: 'user_42', username: 'Alex', bot: false },
      content: 'Can someone help build a house?',
    });

    // Wait for leaky-bucket dispatch
    await new Promise((r) => setTimeout(r, 60));

    expect(sentToMinecraft.length).toBe(1);
    expect(sentToMinecraft[0]).toBe('[Discord] <Alex>: Can someone help build a house?');

    // 2. Minecraft server broadcasts the message back in-game (server echo)
    // AntiLoopbackFilter must detect the hash collision and DROP it!
    const preCount = gateway.sentMessages.length;
    mcChatListener!('Server', '[Discord] <Alex>: Can someone help build a house?');

    expect(gateway.sentMessages.length).toBe(preCount); // Dropped! Zero echo back to Discord!

    // 3. Legitimate in-game player responds
    mcChatListener!('Steve', 'I have spare oak logs!');

    expect(gateway.sentMessages.length).toBe(preCount + 1);
    expect(gateway.getLastSentMessage('bridge_chan')?.content).toContain('**[Minecraft] <Steve>** I have spare oak logs!');

    bridge.stop();
  });

  it('TC-INT-3: End-to-end Audio Pipeline: Receiver -> STT -> TTS -> Priority Queue -> Mock Voice Playback', async () => {
    const voiceSession = new MockVoiceSession('vchan_1', 'guild_1');

    // Set up STT and TTS
    const mockSTT = new MockSTTProvider();
    mockSTT.setDefaultTranscript('Bot, what is your health?');
    const stt = new STTPipeline(mockSTT);

    const mockTTS = new MockTTSProvider();
    const tts = new TTSPipeline(mockTTS);

    // Mock Player connecting AudioQueueManager to MockVoiceSession
    const playerAdapter = {
      on: vi.fn(),
      playBuffer: async (buf: Buffer) => {
        await voiceSession.playAudioStream(buf, 'NORMAL');
      },
      stop: (_force?: boolean) => {
        voiceSession.stopAudio();
        return true;
      },
      isPlaying: () => voiceSession.isAudioPlaying,
    };

    const queue = new AudioQueueManager(playerAdapter as any, tts);

    // 1. Simulate user speech captured by VoiceReceiver
    const receiver = new VoiceReceiver({
      minUtteranceDurationMs: 200,
      noiseThresholdRms: 300,
    });

    // 400ms speech buffer
    const pcmBuffer = Buffer.alloc(76800);
    for (let i = 0; i < pcmBuffer.length; i += 2) {
      pcmBuffer.writeInt16LE(1500, i);
    }

    const utterance = receiver.processPcmUtterance('user_10', pcmBuffer);
    expect(utterance).not.toBeNull();

    // 2. Transcribe utterance via STT
    const transcript = await stt.transcribePcm(utterance!.pcmBuffer);
    expect(transcript).toBe('Bot, what is your health?');

    // 3. Coordinator generates reply and enqueues to audio queue
    const replyText = 'My health is full at 20 hearts.';
    queue.enqueue({
      id: 'reply_1',
      text: replyText,
      priority: AudioPriority.NORMAL,
      createdAt: Date.now(),
    });

    // AudioQueueManager asynchronously synthesizes TTS and plays into voiceSession
    await new Promise((r) => setTimeout(r, 40));

    expect(voiceSession.playedRecordings.length).toBe(1);
    expect(voiceSession.playedRecordings[0].completed).toBe(true);
    expect(voiceSession.playedRecordings[0].totalBytes).toBeGreaterThan(44);
  });

  it('TC-INT-4: Live Status Embed Manager full update cycle with Mock Gateway', async () => {
    const gateway = new MockDiscordGateway();
    const manager = new StatusEmbedManager(gateway, {
      statusChannelId: 'status_chan',
      updateIntervalSec: 5,
    });

    const status: MinecraftBotStatus = {
      connected: true,
      username: 'SurvivalBot',
      health: 14.5,
      food: 18,
      position: { x: 50.0, y: 70.0, z: -120.0 },
      dimension: 'overworld',
      currentTask: 'Smelting iron ore',
      gear: {
        mainHand: 'Iron Pickaxe',
        offHand: 'Torch',
        armorSummary: 'Iron Helmet, Chestplate',
      },
      inventory: {
        usedSlots: 12,
        totalSlots: 36,
        freeSlots: 24,
      },
      server: {
        host: 'play.survival.net',
        port: 25565,
        ping: 20,
      },
    };

    manager.updateState(status);

    // Initial tick creates new message
    await manager.tick();
    expect(gateway.sentMessages.length).toBe(1);
    const pinnedId = manager.getCurrentMessageId()!;
    expect(pinnedId).toBeDefined();

    // Modify status (health drops to 6 -> Red status)
    status.health = 6.0;
    status.currentTask = 'Fleeing hostile mob';
    manager.updateState(status);

    // Next tick edits the message
    await manager.tick();
    expect(gateway.editedMessages.length).toBe(1);
    expect(gateway.editedMessages[0].messageId).toBe(pinnedId);
    expect(gateway.editedMessages[0].embed.color).toBe(0xe74c3c); // Red color for low HP!
  });
});
