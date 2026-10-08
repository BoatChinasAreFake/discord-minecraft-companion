/**
 * Tier 3 Cross-Feature Combination: Voice-to-Action Pipeline
 *
 * Verifies full duplex voice processing, acoustic VAD filtering, AI tool execution,
 * multi-priority TTS audio playback, status embed propagation, and multi-speaker isolation.
 *
 * Test Cases: TC-T3-V2A-1 to TC-T3-V2A-5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import prism from 'prism-media';
import { createTestContext, type TestContext } from '../harness/index.js';
import { createSyntheticPcmBuffer } from '../harness/simulationHarness.js';
import { AudioPriority } from '../../src/audio/types.js';
import { VoiceReceiver } from '../../src/audio/receiver.js';

describe('Tier 3: Voice-to-Action Pipeline (TC-T3-V2A-1 to TC-T3-V2A-5)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  // --------------------------------------------------------------------------
  // TC-T3-V2A-1: Full duplex voice-to-action cycle
  // --------------------------------------------------------------------------
  it('TC-T3-V2A-1: Full duplex voice-to-action cycle (Voice -> STT -> Gemini -> Minecraft -> TTS -> Embed)', async () => {
    // 1. Prepare speech utterance with 400ms audio buffer
    const pcmBuffer = createSyntheticPcmBuffer(400);

    // 2. Enqueue expected speech-to-text transcript
    ctx.harness.mockSTT.enqueueTranscript('go to 10 64 20');

    // 3. Process acoustic utterance through VoiceReceiver VAD
    let utteranceEmitted = false;
    ctx.harness.voiceReceiver.once('utterance', (evt) => {
      utteranceEmitted = true;
      expect(evt.userId).toBe('user_voice_1');
      expect(evt.durationMs).toBeCloseTo(400, 0);
    });

    const event = ctx.harness.voiceReceiver.processPcmUtterance('user_voice_1', pcmBuffer);
    expect(event).not.toBeNull();
    expect(utteranceEmitted).toBe(true);

    // 4. Coordinator handles voice prompt
    await ctx.harness.coordinator.handleVoicePrompt({
      userId: 'user_voice_1',
      prompt: 'go to 10 64 20',
      source: 'voice',
    });

    // 5. Wait for Gemini planning and Minecraft action completion
    await ctx.harness.waitForPlannerCompletion();

    // 6. Minecraft agent moved to target coordinates
    ctx.assertBotPosition({ x: 10, y: 64, z: 20 });

    // 7. ProgressReporter sent tool call step message to Discord text channel
    ctx.assertDiscordMessageSent((m) => m.content?.includes('goToCoordinates') ?? false);

    // 8. ProgressReporter enqueued NORMAL priority TTS in audio queue
    const playedAudio = ctx.assertAudioPlayed();
    expect(playedAudio).toBeDefined();

    // 9. StatusEmbedManager updates embed coordinates to (10.0, 64.0, 20.0)
    await ctx.harness.triggerStatusEmbedTick(true);
    ctx.assertStatusEmbedField('Coordinates', 'X: 10.0, Y: 64.0, Z: 20.0');
  });

  // --------------------------------------------------------------------------
  // TC-T3-V2A-2: Voice command tool obstacle and HIGH priority TTS reflection
  // --------------------------------------------------------------------------
  it('TC-T3-V2A-2: Voice command tool obstacle reflects failure to Discord text and HIGH priority TTS', async () => {
    // Track enqueued TTS items to verify priority and message content
    const enqueuedTTS: any[] = [];
    const origEnqueue = ctx.harness.audioQueue.enqueue.bind(ctx.harness.audioQueue);
    vi.spyOn(ctx.harness.audioQueue, 'enqueue').mockImplementation((item) => {
      enqueuedTTS.push(item);
      return origEnqueue(item);
    });

    // World is flat grass with no diamond_ore blocks exposed.
    // User voice prompt: "gather 1 diamond_ore"
    ctx.harness.mockSTT.enqueueTranscript('gather 1 diamond_ore');

    await ctx.harness.coordinator.handleVoicePrompt({
      userId: 'user_voice_1',
      prompt: 'gather 1 diamond_ore',
      source: 'voice',
    });

    await ctx.harness.waitForPlannerCompletion();

    // Line-of-sight exposure check fails because no exposed diamond_ore exists.
    // 1. ProgressReporter sent an obstacle message to Discord text
    ctx.assertDiscordMessageSent((m) => m.content?.includes('⚠️ **Obstacle**') ?? false);

    // 2. Obstacle triggered HIGH priority TTS in audio queue
    const highAudio = enqueuedTTS.find(
      (item) => item.priority === AudioPriority.HIGH && item.text.startsWith('Obstacle:')
    );
    expect(highAudio, 'Expected HIGH priority TTS item for tool obstacle').toBeDefined();
    expect(highAudio.text).toContain('diamond_ore');
  });

  // --------------------------------------------------------------------------
  // TC-T3-V2A-3: Acoustic noise rejection prevents false tool invocations
  // --------------------------------------------------------------------------
  it('TC-T3-V2A-3: Acoustic noise rejection prevents false tool invocations (< 200ms or low RMS)', async () => {
    const initialPos = ctx.harness.minecraftAgent.getStatus().position;
    const initialSentCount = ctx.harness.mockDiscord.sentMessages.length;

    let discardedCount = 0;
    const reasons: string[] = [];
    ctx.harness.voiceReceiver.on('noiseDiscarded', (evt) => {
      discardedCount++;
      reasons.push(evt.reason);
    });

    // 1. Sub-threshold duration: 100ms (< 200ms minUtteranceDurationMs)
    const shortBuffer = Buffer.alloc(19200);
    for (let i = 0; i < shortBuffer.length; i += 2) {
      shortBuffer.writeInt16LE(1500, i);
    }
    const resShort = ctx.harness.voiceReceiver.processPcmUtterance('user_noise', shortBuffer);
    expect(resShort).toBeNull();

    // 2. Sub-threshold RMS energy: 300ms but amplitude 40 (< 200 noiseThresholdRms)
    const quietBuffer = Buffer.alloc(57600);
    for (let i = 0; i < quietBuffer.length; i += 2) {
      quietBuffer.writeInt16LE(40, i);
    }
    const resQuiet = ctx.harness.voiceReceiver.processPcmUtterance('user_noise', quietBuffer);
    expect(resQuiet).toBeNull();

    // Assert noise discarded events fired with correct reasons
    expect(discardedCount).toBe(2);
    expect(reasons).toContain('duration_too_short');
    expect(reasons).toContain('rms_below_threshold');

    // Assert zero planner execution, zero bot movement, and zero new Discord messages
    expect(ctx.harness.planner.isExecuting()).toBe(false);
    expect(ctx.harness.minecraftAgent.getStatus().position).toEqual(initialPos);
    expect(ctx.harness.mockDiscord.sentMessages.length).toBe(initialSentCount);
  });

  // --------------------------------------------------------------------------
  // TC-T3-V2A-4: Voice emergency interrupt halting active action
  // --------------------------------------------------------------------------
  it('TC-T3-V2A-4: Voice emergency interrupt halts active action, cancels pathfinder, and purges audio queue', async () => {
    // Custom mock turn handler that simulates a long-running multi-turn execution
    ctx.harness.setGeminiCustomHandler(async (interaction) => {
      if (interaction.type === 'user') {
        return {
          toolCalls: [{ name: 'goToCoordinates', args: { x: 50, y: 64, z: 50 } }],
        };
      } else {
        // Delay during subsequent tool turns to provide an active cancellation window
        await new Promise((r) => setTimeout(r, 200));
        return {
          toolCalls: [{ name: 'goToCoordinates', args: { x: 60, y: 64, z: 60 } }],
        };
      }
    });

    // Start long-running goal in background
    ctx.harness.coordinator.assignTask({
      goal: 'walk to far coordinate',
      user: 'VoiceUser_1',
    });

    // Wait until planner is actively executing
    await ctx.harness.waitFor(() => ctx.harness.planner.isExecuting(), 2000);
    expect(ctx.harness.planner.isExecuting()).toBe(true);

    // User speaks emergency "stop" into voice channel
    await ctx.harness.coordinator.handleVoicePrompt({
      userId: 'user_voice_1',
      prompt: 'stop immediately',
      source: 'voice',
    });

    // 1. Planner goal cancelled
    expect(ctx.harness.planner.isExecuting()).toBe(false);

    // 2. Non-emergency audio queue purged
    expect(ctx.harness.audioQueue.getQueueLength()).toBe(0);

    // 3. Discord received Emergency Stop notification
    ctx.assertDiscordMessageSent((m) => m.content?.includes('🛑 Emergency Stop') ?? false);
  });

  // --------------------------------------------------------------------------
  // TC-T3-V2A-5: Multi-speaker concurrent voice channel isolation
  // --------------------------------------------------------------------------
  it('TC-T3-V2A-5: Multi-speaker concurrent voice channel maintains isolated speaker sessions without crosstalk', async () => {
    // Spy on prism Decoder to allow piping PassThrough streams offline
    const PassThroughDecoder = class extends PassThrough {};
    const decoderSpy = vi
      .spyOn((prism as any).opus, 'Decoder')
      .mockImplementation(() => new PassThroughDecoder());

    const isolatedReceiver = new VoiceReceiver({
      minUtteranceDurationMs: 200,
      noiseThresholdRms: 200,
    });

    const userAStream = new PassThrough();
    const userBStream = new PassThrough();

    const mockConnection = {
      receiver: {
        speaking: new EventEmitter(),
        subscribe: (userId: string) => {
          if (userId === 'user_alice') return userAStream;
          return userBStream;
        },
      },
    };

    isolatedReceiver.attach(mockConnection);

    // 1. User Alice and User Bob begin speaking concurrently
    mockConnection.receiver.speaking.emit('start', 'user_alice');
    mockConnection.receiver.speaking.emit('start', 'user_bob');

    expect(isolatedReceiver.getActiveSessionsCount()).toBe(2);

    const emittedUtterances: Array<{ userId: string; durationMs: number; rms: number }> = [];
    isolatedReceiver.on('utterance', (evt) => {
      emittedUtterances.push({
        userId: evt.userId,
        durationMs: evt.durationMs,
        rms: evt.rms,
      });
    });

    // 2. Stream 400ms of audio for Alice
    const aliceAudio = createSyntheticPcmBuffer(400);
    userAStream.write(aliceAudio);
    userAStream.end();

    // Allow event loop to process stream end and VAD evaluation
    await new Promise((r) => setTimeout(r, 20));

    expect(emittedUtterances.length).toBe(1);
    expect(emittedUtterances[0].userId).toBe('user_alice');
    expect(emittedUtterances[0].durationMs).toBeCloseTo(400, 0);

    // Bob's session remains active and isolated
    expect(isolatedReceiver.getActiveSessionsCount()).toBe(1);

    // 3. Stream 600ms of audio for Bob
    const bobAudio = createSyntheticPcmBuffer(600);
    userBStream.write(bobAudio);
    userBStream.end();

    await new Promise((r) => setTimeout(r, 20));

    expect(emittedUtterances.length).toBe(2);
    expect(emittedUtterances[1].userId).toBe('user_bob');
    expect(emittedUtterances[1].durationMs).toBeCloseTo(600, 0);

    expect(isolatedReceiver.getActiveSessionsCount()).toBe(0);

    isolatedReceiver.detach();
    decoderSpy.mockRestore();
  });
});
