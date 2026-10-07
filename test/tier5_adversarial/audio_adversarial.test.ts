import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { AudioQueueManager } from '../../src/audio/queue.js';
import { VoicePlayer } from '../../src/audio/player.js';
import {
  VoiceReceiver,
  calculatePcmRms,
  createWavBuffer,
} from '../../src/audio/receiver.js';
import { STTPipeline, MockSTTProvider } from '../../src/audio/stt.js';
import {
  TTSPipeline,
  MockTTSProvider,
  generateSyntheticPcmTone,
} from '../../src/audio/tts.js';
import {
  AudioPriority,
  VoicePlaybackState,
  DEFAULT_RECEIVER_CONFIG,
} from '../../src/audio/types.js';
import type {
  ITTSPipeline,
  TTSQueueItem,
  ISTTProvider,
  ITTSProvider,
} from '../../src/audio/types.js';

// Helper mock player that supports configurable delay and controls
class ControlledMockPlayer extends EventEmitter {
  public playing = false;
  public playedBuffers: Buffer[] = [];
  public stoppedCount = 0;
  public playBufferDelayMs = 0;

  public async playBuffer(buffer: Buffer): Promise<void> {
    this.playing = true;
    this.playedBuffers.push(buffer);
    this.emit('playing');
    if (this.playBufferDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.playBufferDelayMs));
    }
  }

  public stop(_force?: boolean): boolean {
    this.playing = false;
    this.stoppedCount++;
    this.emit('idle');
    return true;
  }

  public isPlaying(): boolean {
    return this.playing;
  }

  public simulateComplete(): void {
    this.playing = false;
    this.emit('idle');
  }

  public simulateError(err: Error): void {
    this.playing = false;
    this.emit('error', err);
  }
}

describe('Adversarial Stress & Edge Cases: AudioQueueManager', () => {
  it('ADV-AQM-1: Async Preemption Interleaving — in-flight synthesis of preempted item is safely discarded without clobbering emergency playback', async () => {
    const mockPlayer = new ControlledMockPlayer();

    // Delayed TTS synthesis simulating async I/O latency (50ms)
    const delayedTTS: ITTSPipeline = {
      synthesizeSpeech: vi.fn().mockImplementation(async (text: string) => {
        if (text === 'Slow Non-Emergency Item') {
          await new Promise((r) => setTimeout(r, 50));
          return Buffer.from('SLOW_AUDIO');
        }
        return Buffer.from('EMERGENCY_AUDIO');
      }),
    };

    const queue = new AudioQueueManager(mockPlayer, delayedTTS);
    const preemptedSpy = vi.fn();
    queue.on('itemPreempted', preemptedSpy);

    // 1. Enqueue slow non-emergency item
    queue.enqueue({
      id: 'slow_1',
      text: 'Slow Non-Emergency Item',
      priority: AudioPriority.NORMAL,
      createdAt: 100,
    });

    expect(queue.getCurrentItem()?.id).toBe('slow_1');

    // 2. Preempt with emergency item while synthesizeSpeech is still in-flight
    await new Promise((r) => setTimeout(r, 10)); // 10ms into synthesis
    queue.enqueue({
      id: 'emerg_1',
      text: 'Emergency Alert',
      priority: AudioPriority.EMERGENCY,
      createdAt: 110,
      audioBuffer: Buffer.from('PRE_SYNTH_EMERGENCY'),
    });

    expect(preemptedSpy).toHaveBeenCalled();
    expect(queue.getCurrentItem()?.id).toBe('emerg_1');

    // 3. Wait until the 50ms slow synthesis finishes
    await new Promise((r) => setTimeout(r, 60));

    // VERIFICATION OF REMEDIATION:
    // When slow_1's synthesis resolved, processNext() detected that slow_1 was preempted/aborted,
    // discarding its buffer and preserving active emergency playback intact!
    const playedBufferNames = mockPlayer.playedBuffers.map((b) => b.toString());
    const clobbered = playedBufferNames.includes('SLOW_AUDIO');

    expect(clobbered).toBe(false);
    expect(playedBufferNames).toEqual(['PRE_SYNTH_EMERGENCY']);
    expect(queue.getCurrentItem()?.id).toBe('emerg_1');
  });

  it('ADV-AQM-2: Error Recovery — TTS synthesis failure calls onError and does NOT trigger onComplete or itemCompleted', async () => {
    const mockPlayer = new ControlledMockPlayer();
    const failingTTS: ITTSPipeline = {
      synthesizeSpeech: vi.fn().mockRejectedValue(new Error('TTS Service Unavailable 503')),
    };

    const queue = new AudioQueueManager(mockPlayer, failingTTS);

    const onStart = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();
    const itemCompletedSpy = vi.fn();
    const errorSpy = vi.fn();

    queue.on('itemCompleted', itemCompletedSpy);
    queue.on('error', errorSpy);

    queue.enqueue({
      id: 'fail_item',
      text: 'Will fail synthesis',
      priority: AudioPriority.NORMAL,
      createdAt: 100,
      onStart,
      onComplete,
      onError,
    });

    // Wait for the async failure to resolve
    await new Promise((r) => setTimeout(r, 20));

    // Error must be triggered, completion must NOT be triggered
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(errorSpy).toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(itemCompletedSpy).not.toHaveBeenCalled();
  });

  it('ADV-AQM-3: Error Recovery — Player error during playback calls onError and does NOT trigger onComplete or itemCompleted', async () => {
    const mockPlayer = new ControlledMockPlayer();
    const mockTTS: ITTSPipeline = {
      synthesizeSpeech: vi.fn().mockResolvedValue(Buffer.from('AUDIO')),
    };

    const queue = new AudioQueueManager(mockPlayer, mockTTS);

    const onComplete = vi.fn();
    const onError = vi.fn();
    const itemCompletedSpy = vi.fn();

    queue.on('itemCompleted', itemCompletedSpy);

    queue.enqueue({
      id: 'player_fail_item',
      text: 'Playing audio',
      priority: AudioPriority.NORMAL,
      createdAt: 100,
      audioBuffer: Buffer.from('AUDIO'),
      onComplete,
      onError,
    });

    // Player emits playback error
    mockPlayer.simulateError(new Error('Audio device buffer underflow'));

    // onError must be triggered, onComplete must NOT be triggered
    expect(onError).toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(itemCompletedSpy).not.toHaveBeenCalled();
  });

  it('ADV-AQM-4: FIFO Ordering — Multiple emergency items queued during emergency playback maintain chronological FIFO order', async () => {
    const mockPlayer = new ControlledMockPlayer();
    const mockTTS: ITTSPipeline = {
      synthesizeSpeech: vi.fn().mockResolvedValue(Buffer.from('AUDIO')),
    };

    const queue = new AudioQueueManager(mockPlayer, mockTTS);

    // E1 is actively playing
    queue.enqueue({
      id: 'E1',
      text: 'Emergency 1',
      priority: AudioPriority.EMERGENCY,
      createdAt: 10,
      audioBuffer: Buffer.from('E1'),
    });
    expect(queue.getCurrentItem()?.id).toBe('E1');

    // While E1 is playing, E2 arrives at t=20, then E3 arrives at t=30
    queue.enqueue({
      id: 'E2',
      text: 'Emergency 2',
      priority: AudioPriority.EMERGENCY,
      createdAt: 20,
      audioBuffer: Buffer.from('E2'),
    });

    queue.enqueue({
      id: 'E3',
      text: 'Emergency 3',
      priority: AudioPriority.EMERGENCY,
      createdAt: 30,
      audioBuffer: Buffer.from('E3'),
    });

    // VERIFICATION OF REMEDIATION:
    // FIFO order ['E2', 'E3'] is preserved
    const pending = queue.getQueue();
    expect(pending.map((i) => i.id)).toEqual(['E2', 'E3']);

    // E1 completes
    mockPlayer.simulateComplete();

    // Next item played is E2 (arrived earlier)
    expect(queue.getCurrentItem()?.id).toBe('E2');
  });

  it('ADV-AQM-5: Rapid Cancellation & Preemption Under Concurrency Stress', async () => {
    const mockPlayer = new ControlledMockPlayer();
    const mockTTS: ITTSPipeline = {
      synthesizeSpeech: vi.fn().mockResolvedValue(Buffer.from('PCM')),
    };

    const queue = new AudioQueueManager(mockPlayer, mockTTS);

    // Flood with 100 mixed items concurrently
    for (let i = 0; i < 100; i++) {
      queue.enqueue({
        id: `stress_${i}`,
        text: `Message ${i}`,
        priority: i % 10 === 0 ? AudioPriority.EMERGENCY : AudioPriority.NORMAL,
        createdAt: 1000 + i,
      });

      if (i % 25 === 0) {
        queue.cancelNonEmergency();
      }
    }

    // Explicitly cancel all remaining non-emergency items
    queue.cancelNonEmergency();

    // All remaining pending items must be EMERGENCY
    const remaining = queue.getQueue();
    for (const item of remaining) {
      expect(item.priority).toBe(AudioPriority.EMERGENCY);
    }

    // Now stopAll
    queue.stopAll();
    expect(queue.getQueueLength()).toBe(0);
    expect(queue.getCurrentItem()).toBeNull();
  });

  it('ADV-AQM-6: Massive Queue Flooding (500 items) Priority Invariant Test', () => {
    const mockPlayer = new ControlledMockPlayer();
    const mockTTS: ITTSPipeline = {
      synthesizeSpeech: vi.fn().mockResolvedValue(Buffer.from('PCM')),
    };

    const queue = new AudioQueueManager(mockPlayer, mockTTS);

    // Start with 1 blocker item
    queue.enqueue({ id: 'blocker', text: 'B', priority: AudioPriority.NORMAL, createdAt: 1 });

    // Enqueue 500 items in random priority order
    for (let i = 0; i < 500; i++) {
      const p = (i % 3) + 1; // HIGH (1), NORMAL (2), LOW (3)
      queue.enqueue({
        id: `item_${i}`,
        text: `Msg ${i}`,
        priority: p as AudioPriority,
        createdAt: 1000 + i,
      });
    }

    const pending = queue.getQueue();
    expect(pending.length).toBe(500);

    // Verify monotonic priority non-decreasing (HIGH <= NORMAL <= LOW)
    for (let i = 0; i < pending.length - 1; i++) {
      expect(pending[i].priority).toBeLessThanOrEqual(pending[i + 1].priority);
    }
  });
});

describe('Adversarial Stress & Edge Cases: VoiceReceiver', () => {
  it('ADV-REC-1: Boundary Audio Packets — empty, 1-byte, and odd-length malformed buffers', () => {
    expect(calculatePcmRms(Buffer.alloc(0))).toBe(0);
    expect(calculatePcmRms(Buffer.alloc(1))).toBe(0);

    // Odd-length buffer (3 bytes: 1 complete Int16 sample + 1 dangling trailing byte)
    const oddBuf = Buffer.alloc(3);
    oddBuf.writeInt16LE(1000, 0);
    oddBuf[2] = 0x7f; // Corrupt dangling byte
    expect(calculatePcmRms(oddBuf)).toBeCloseTo(1000, 0);

    // 0-byte buffer through processPcmUtterance
    const receiver = new VoiceReceiver();
    const resEmpty = receiver.processPcmUtterance('user_empty', Buffer.alloc(0));
    expect(resEmpty).toBeNull();

    // 1-byte buffer through processPcmUtterance
    const receiverOne = new VoiceReceiver();
    const resOneByte = receiverOne.processPcmUtterance('user_one', Buffer.alloc(1));
    expect(resOneByte).toBeNull();
  });

  it('ADV-REC-2: Silent & Sub-threshold PCM VAD rejection', () => {
    const receiver = new VoiceReceiver({ noiseThresholdRms: 300 });
    const discardedSpy = vi.fn();
    receiver.on('noiseDiscarded', discardedSpy);

    // 1 second of complete digital silence
    const silence = Buffer.alloc(192000);
    const resSilence = receiver.processPcmUtterance('u1', silence);
    expect(resSilence).toBeNull();
    expect(discardedSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'rms_below_threshold', rms: 0 })
    );

    // 1 second of low-level microphone hum (RMS = 100 < 300)
    const hum = Buffer.alloc(192000);
    for (let i = 0; i < hum.length; i += 2) {
      hum.writeInt16LE(100, i);
    }
    const resHum = receiver.processPcmUtterance('u2', hum);
    expect(resHum).toBeNull();
    expect(discardedSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'rms_below_threshold' })
    );
  });

  it('ADV-REC-3: Ultra-short high-amplitude click burst is rejected by duration filter', () => {
    const receiver = new VoiceReceiver({
      minUtteranceDurationMs: 200,
      noiseThresholdRms: 300,
    });

    const discardedSpy = vi.fn();
    receiver.on('noiseDiscarded', discardedSpy);

    // 50ms burst of deafening audio (32,000 amplitude)
    // 50ms * 192 bytes/ms = 9,600 bytes
    const loudClick = Buffer.alloc(9600);
    for (let i = 0; i < loudClick.length; i += 2) {
      loudClick.writeInt16LE(32000, i);
    }

    const res = receiver.processPcmUtterance('click_user', loudClick);
    expect(res).toBeNull();
    expect(discardedSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'duration_too_short' })
    );
  });

  it('ADV-REC-4: Boundary Duration Threshold — 199ms rejected vs 200ms accepted', () => {
    const receiver = new VoiceReceiver({
      minUtteranceDurationMs: 200,
      noiseThresholdRms: 300,
    });

    // 199ms = 199 * 192 = 38,208 bytes
    const buf199 = Buffer.alloc(38208);
    for (let i = 0; i < buf199.length; i += 2) {
      buf199.writeInt16LE(1500, i);
    }
    expect(receiver.processPcmUtterance('u_199', buf199)).toBeNull();

    // 200ms = 200 * 192 = 38,400 bytes
    const buf200 = Buffer.alloc(38400);
    for (let i = 0; i < buf200.length; i += 2) {
      buf200.writeInt16LE(1500, i);
    }
    const res200 = receiver.processPcmUtterance('u_200', buf200);
    expect(res200).not.toBeNull();
    expect(res200?.durationMs).toBe(200);
  });

  it('ADV-REC-5: Session Cleanup Idempotency & Detach Integrity', () => {
    const receiver = new VoiceReceiver();

    // Cleanup non-existent session
    expect(() => receiver.cleanupSession('non_existent')).not.toThrow();

    // Multiple detaches
    expect(() => {
      receiver.detach();
      receiver.detach();
    }).not.toThrow();

    expect(receiver.getActiveSessionsCount()).toBe(0);
  });

  it('ADV-REC-6: Extreme Sample Values & RMS Precision', () => {
    // 100 samples at maximum negative value (-32768) and maximum positive value (32767)
    const buf = Buffer.alloc(200);
    for (let i = 0; i < 200; i += 4) {
      buf.writeInt16LE(-32768, i);
      buf.writeInt16LE(32767, i + 2);
    }

    const rms = calculatePcmRms(buf);
    expect(Number.isFinite(rms)).toBe(true);
    expect(rms).toBeGreaterThan(32000);
    expect(rms).toBeLessThanOrEqual(32768);
  });
});

describe('Adversarial Stress & Edge Cases: STT & TTS Subsystems', () => {
  it('ADV-STT-1: STT Provider Error Propagation', async () => {
    const failingProvider: ISTTProvider = {
      name: 'FailingSTT',
      transcribe: vi.fn().mockRejectedValue(new Error('Rate Limit Exceeded (429)')),
    };

    const pipeline = new STTPipeline(failingProvider);
    const pcm = Buffer.alloc(1920);

    await expect(pipeline.transcribePcm(pcm)).rejects.toThrow('Rate Limit Exceeded (429)');
  });

  it('ADV-STT-2: MockSTTProvider Determinism under concurrent calls', async () => {
    const provider = new MockSTTProvider();
    provider.enqueueTranscript('Prompt A');
    provider.enqueueTranscript('Prompt B');
    provider.enqueueTranscript('Prompt C');

    // Run concurrently
    const [r1, r2, r3, r4] = await Promise.all([
      provider.transcribe({ buffer: Buffer.alloc(10), mimeType: 'audio/wav', sampleRate: 48000 }),
      provider.transcribe({ buffer: Buffer.alloc(10), mimeType: 'audio/wav', sampleRate: 48000 }),
      provider.transcribe({ buffer: Buffer.alloc(10), mimeType: 'audio/wav', sampleRate: 48000 }),
      provider.transcribe({ buffer: Buffer.alloc(10), mimeType: 'audio/wav', sampleRate: 48000 }),
    ]);

    expect(r1).toBe('Prompt A');
    expect(r2).toBe('Prompt B');
    expect(r3).toBe('Prompt C');
    expect(r4).toBe('Hello bot, please report status'); // Default fallback
  });

  it('ADV-TTS-1: TTS Pipeline LRU Cache Eviction at 100 item boundary', async () => {
    const mockProvider = new MockTTSProvider();
    const pipeline = new TTSPipeline(mockProvider);

    // Insert 100 items into cache
    for (let i = 0; i < 100; i++) {
      await pipeline.synthesizeSpeech(`Sentence number ${i}`);
    }
    expect(pipeline.getCacheSize()).toBe(100);
    expect(mockProvider.callHistory.length).toBe(100);

    // Item 0 should be cached
    await pipeline.synthesizeSpeech('Sentence number 0');
    expect(mockProvider.callHistory.length).toBe(100); // Cache hit!

    // Add item 101 -> forces eviction of oldest key
    await pipeline.synthesizeSpeech('Sentence number 100');
    expect(pipeline.getCacheSize()).toBe(100); // Capped at 100!
    expect(mockProvider.callHistory.length).toBe(101);
  });

  it('ADV-TTS-2: TTS Provider Failure does not poison cache', async () => {
    let shouldFail = true;
    const flakeyProvider: ITTSProvider = {
      name: 'FlakeyTTS',
      synthesize: vi.fn().mockImplementation(async (text: string) => {
        if (shouldFail) {
          throw new Error('TTS Network Timeout');
        }
        return Buffer.from('RECOVERED_AUDIO');
      }),
    };

    const pipeline = new TTSPipeline(flakeyProvider);

    // Call 1 fails
    await expect(pipeline.synthesizeSpeech('Retry test')).rejects.toThrow('TTS Network Timeout');
    expect(pipeline.getCacheSize()).toBe(0); // Failed call not cached!

    // Call 2 succeeds
    shouldFail = false;
    const res = await pipeline.synthesizeSpeech('Retry test');
    expect(res.toString()).toBe('RECOVERED_AUDIO');
    expect(pipeline.getCacheSize()).toBe(1); // Successful call is cached
  });

  it('ADV-TTS-3: generateSyntheticPcmTone edge cases (0ms, negative, extreme values)', () => {
    expect(generateSyntheticPcmTone(0).length).toBe(0);

    // Handled non-positive duration returns empty buffer without throwing RangeError
    expect(generateSyntheticPcmTone(-100).length).toBe(0);

    // 10ms of extreme frequency (20kHz)
    const tone = generateSyntheticPcmTone(10, 20000, 48000, 2);
    expect(tone.length).toBe(10 * 192);

    // Verify samples are bounded within 16-bit signed range [-32768, 32767]
    for (let i = 0; i < tone.length; i += 2) {
      const val = tone.readInt16LE(i);
      expect(val).toBeGreaterThanOrEqual(-16384);
      expect(val).toBeLessThanOrEqual(16384);
    }
  });
});
