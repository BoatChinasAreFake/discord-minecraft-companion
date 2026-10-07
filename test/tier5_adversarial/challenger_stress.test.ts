import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { AudioQueueManager } from '../../src/audio/queue.js';
import { generateSyntheticPcmTone } from '../../src/audio/tts.js';
import { AudioPriority } from '../../src/audio/types.js';
import type { ITTSPipeline, TTSQueueItem } from '../../src/audio/types.js';

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

describe('Challenger Empirical Verification: Audio Queue & TTS Robustness', () => {
  describe('Focus 1: Async Preemption Interleaving & Race Conditions', () => {
    it('EMP-CHAL-1: Slow normal synthesis discarded when preempted by emergency items', async () => {
      const mockPlayer = new ControlledMockPlayer();

      const delayedTTS: ITTSPipeline = {
        synthesizeSpeech: vi.fn().mockImplementation(async (text: string) => {
          if (text === 'Normal Slow') {
            await new Promise((r) => setTimeout(r, 80));
            return Buffer.from('NORMAL_SLOW_AUDIO');
          }
          if (text === 'Emergency 2 Slow') {
            await new Promise((r) => setTimeout(r, 30));
            return Buffer.from('EMERGENCY_2_AUDIO');
          }
          return Buffer.from('FAST_AUDIO');
        }),
      };

      const queue = new AudioQueueManager(mockPlayer, delayedTTS);
      const preemptedEvents: any[] = [];
      queue.on('itemPreempted', (item) => preemptedEvents.push(item));

      // 1. Enqueue slow normal item
      queue.enqueue({
        id: 'norm_1',
        text: 'Normal Slow',
        priority: AudioPriority.NORMAL,
        createdAt: 100,
      });

      // 2. Preempt at 20ms with Emergency 1 (pre-synthesized buffer)
      await new Promise((r) => setTimeout(r, 20));
      queue.enqueue({
        id: 'emerg_1',
        text: 'Emergency 1 Instant',
        priority: AudioPriority.EMERGENCY,
        createdAt: 120,
        audioBuffer: Buffer.from('EMERGENCY_1_AUDIO'),
      });

      expect(preemptedEvents.length).toBe(1);
      expect(preemptedEvents[0].id).toBe('norm_1');
      expect(mockPlayer.playedBuffers.map((b) => b.toString())).toContain('EMERGENCY_1_AUDIO');

      // 3. While emerg_1 is active, enqueue Emergency 2 (which needs 30ms synthesis)
      queue.enqueue({
        id: 'emerg_2',
        text: 'Emergency 2 Slow',
        priority: AudioPriority.EMERGENCY,
        createdAt: 130,
      });

      // emerg_1 completes playback
      mockPlayer.simulateComplete();

      // Wait for emerg_2 synthesis (30ms) + buffer room (60ms)
      // and for norm_1's 80ms synthesis to have completely elapsed
      await new Promise((r) => setTimeout(r, 70));

      const playedStrings = mockPlayer.playedBuffers.map((b) => b.toString());

      // VERIFY: NORMAL_SLOW_AUDIO was NEVER played!
      expect(playedStrings).not.toContain('NORMAL_SLOW_AUDIO');
      expect(playedStrings).toEqual(['EMERGENCY_1_AUDIO', 'EMERGENCY_2_AUDIO']);
    });

    it('EMP-CHAL-2: cancelNonEmergency during slow synthesis aborts synthesis cleanly', async () => {
      const mockPlayer = new ControlledMockPlayer();

      const slowTTS: ITTSPipeline = {
        synthesizeSpeech: vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 60));
          return Buffer.from('CANCELLED_NORM_AUDIO');
        }),
      };

      const queue = new AudioQueueManager(mockPlayer, slowTTS);
      const completeSpy = vi.fn();
      const failSpy = vi.fn();
      queue.on('itemCompleted', completeSpy);
      queue.on('itemFailed', failSpy);

      queue.enqueue({
        id: 'norm_cancel',
        text: 'Will be cancelled',
        priority: AudioPriority.NORMAL,
        createdAt: 100,
      });

      // At 20ms, cancel all non-emergency
      await new Promise((r) => setTimeout(r, 20));
      queue.cancelNonEmergency();

      // Wait past the 60ms synthesis window
      await new Promise((r) => setTimeout(r, 60));

      expect(mockPlayer.playedBuffers.length).toBe(0);
      expect(completeSpy).not.toHaveBeenCalled();
      expect(failSpy).not.toHaveBeenCalled();
    });

    it('EMP-CHAL-3: stopAll during async synthesis drops in-flight items without playback', async () => {
      const mockPlayer = new ControlledMockPlayer();

      const slowTTS: ITTSPipeline = {
        synthesizeSpeech: vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 60));
          return Buffer.from('STOPPED_AUDIO');
        }),
      };

      const queue = new AudioQueueManager(mockPlayer, slowTTS);
      const stoppedSpy = vi.fn();
      queue.on('stoppedAll', stoppedSpy);

      queue.enqueue({
        id: 'emerg_stop',
        text: 'Emergency stopping',
        priority: AudioPriority.EMERGENCY,
        createdAt: 100,
      });

      await new Promise((r) => setTimeout(r, 20));
      queue.stopAll();

      expect(stoppedSpy).toHaveBeenCalled();
      expect(queue.getQueueLength()).toBe(0);
      expect(queue.getCurrentItem()).toBeNull();

      // Wait past synthesis completion
      await new Promise((r) => setTimeout(r, 60));
      expect(mockPlayer.playedBuffers.length).toBe(0);
    });
  });

  describe('Focus 2: Synthesis and Player Errors Do NOT Emit False Completion', () => {
    it('EMP-CHAL-4: Synthesis error triggers onError and itemFailed, NOT onComplete or itemCompleted', async () => {
      const mockPlayer = new ControlledMockPlayer();
      const failingTTS: ITTSPipeline = {
        synthesizeSpeech: vi.fn().mockRejectedValue(new Error('Fatal TTS Quota Exhaustion')),
      };

      const queue = new AudioQueueManager(mockPlayer, failingTTS);
      const onStart = vi.fn();
      const onComplete = vi.fn();
      const onError = vi.fn();
      const itemCompleted = vi.fn();
      const itemFailed = vi.fn();

      queue.on('itemCompleted', itemCompleted);
      queue.on('itemFailed', itemFailed);

      queue.enqueue({
        id: 'failing_synth',
        text: 'Crash synthesis',
        priority: AudioPriority.HIGH,
        onStart,
        onComplete,
        onError,
      });

      await new Promise((r) => setTimeout(r, 20));

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(itemFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          item: expect.objectContaining({ id: 'failing_synth' }),
          error: expect.any(Error),
        })
      );
      expect(onComplete).not.toHaveBeenCalled();
      expect(itemCompleted).not.toHaveBeenCalled();
    });

    it('EMP-CHAL-5: Player error triggers onError and itemFailed, NOT onComplete or itemCompleted', async () => {
      const mockPlayer = new ControlledMockPlayer();
      const instantTTS: ITTSPipeline = {
        synthesizeSpeech: vi.fn().mockResolvedValue(Buffer.from('VALID_PCM')),
      };

      const queue = new AudioQueueManager(mockPlayer, instantTTS);
      const onComplete = vi.fn();
      const onError = vi.fn();
      const itemCompleted = vi.fn();
      const itemFailed = vi.fn();

      queue.on('itemCompleted', itemCompleted);
      queue.on('itemFailed', itemFailed);

      queue.enqueue({
        id: 'failing_player',
        text: 'Audio hardware failure',
        priority: AudioPriority.NORMAL,
        audioBuffer: Buffer.from('VALID_PCM'),
        onComplete,
        onError,
      });

      mockPlayer.simulateError(new Error('Discord gateway connection severed'));

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(itemFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          item: expect.objectContaining({ id: 'failing_player' }),
        })
      );
      expect(onComplete).not.toHaveBeenCalled();
      expect(itemCompleted).not.toHaveBeenCalled();
    });

    it('EMP-CHAL-6: Safe emit error does not crash Node when zero error listeners exist', async () => {
      const mockPlayer = new ControlledMockPlayer();
      const failingTTS: ITTSPipeline = {
        synthesizeSpeech: vi.fn().mockRejectedValue(new Error('Unhandled emitter test')),
      };

      const queue = new AudioQueueManager(mockPlayer, failingTTS);
      // Intentionally DO NOT attach queue.on('error', ...)

      expect(queue.listenerCount('error')).toBe(0);

      // Should not throw unhandled exception
      await expect(
        (async () => {
          queue.enqueue({
            id: 'no_error_listener',
            text: 'Will fail without crash',
            priority: AudioPriority.NORMAL,
          });
          await new Promise((r) => setTimeout(r, 20));
        })()
      ).resolves.not.toThrow();
    });

    it('EMP-CHAL-7: Queue recovers and processes subsequent items after earlier failures', async () => {
      const mockPlayer = new ControlledMockPlayer();
      let callCount = 0;
      const alternatingTTS: ITTSPipeline = {
        synthesizeSpeech: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) throw new Error('First item failure');
          return Buffer.from('SUCCESS_AUDIO');
        }),
      };

      const queue = new AudioQueueManager(mockPlayer, alternatingTTS);
      const item1Failed = vi.fn();
      const item2Completed = vi.fn();

      queue.on('itemFailed', item1Failed);
      queue.on('itemCompleted', item2Completed);

      queue.enqueue({ id: 'bad_1', text: 'Bad 1', priority: AudioPriority.NORMAL });
      queue.enqueue({ id: 'good_2', text: 'Good 2', priority: AudioPriority.NORMAL });

      // Wait for bad_1 to fail and good_2 to start
      await new Promise((r) => setTimeout(r, 20));
      expect(item1Failed).toHaveBeenCalledTimes(1);
      expect(queue.getCurrentItem()?.id).toBe('good_2');

      // good_2 completes
      mockPlayer.simulateComplete();
      expect(item2Completed).toHaveBeenCalledTimes(1);
      expect(queue.getCurrentItem()).toBeNull();
    });
  });

  describe('Focus 3: Emergency Queue Ordering Maintains Chronological FIFO Order', () => {
    it('EMP-CHAL-8: Multiple emergency items maintain strict chronological FIFO sequence', () => {
      const mockPlayer = new ControlledMockPlayer();
      const mockTTS: ITTSPipeline = {
        synthesizeSpeech: vi.fn().mockResolvedValue(Buffer.from('PCM')),
      };

      const queue = new AudioQueueManager(mockPlayer, mockTTS);

      // Enqueue blocker to keep queue suspended
      queue.enqueue({
        id: 'active_emergency',
        text: 'Active',
        priority: AudioPriority.EMERGENCY,
        createdAt: 10,
        audioBuffer: Buffer.from('ACTIVE'),
      });

      // Enqueue 5 emergency items with strictly ascending timestamps
      const timestamps = [100, 200, 300, 400, 500];
      for (let i = 0; i < timestamps.length; i++) {
        queue.enqueue({
          id: `emerg_${i + 1}`,
          text: `Emergency ${i + 1}`,
          priority: AudioPriority.EMERGENCY,
          createdAt: timestamps[i],
          audioBuffer: Buffer.from(`EMERG_${i + 1}`),
        });
      }

      const pending = queue.getQueue();
      expect(pending.map((item) => item.id)).toEqual([
        'emerg_1',
        'emerg_2',
        'emerg_3',
        'emerg_4',
        'emerg_5',
      ]);
    });

    it('EMP-CHAL-9: Out-of-order emergency items are sorted by createdAt ascending', () => {
      const mockPlayer = new ControlledMockPlayer();
      const mockTTS: ITTSPipeline = {
        synthesizeSpeech: vi.fn().mockResolvedValue(Buffer.from('PCM')),
      };

      const queue = new AudioQueueManager(mockPlayer, mockTTS);

      queue.enqueue({
        id: 'blocker',
        text: 'Active',
        priority: AudioPriority.EMERGENCY,
        createdAt: 1,
        audioBuffer: Buffer.from('BLOCKER'),
      });

      // Insert timestamps in jumbled order: [300, 100, 500, 200, 400]
      const arrivals = [
        { id: 'E300', ts: 300 },
        { id: 'E100', ts: 100 },
        { id: 'E500', ts: 500 },
        { id: 'E200', ts: 200 },
        { id: 'E400', ts: 400 },
      ];

      for (const a of arrivals) {
        queue.enqueue({
          id: a.id,
          text: a.id,
          priority: AudioPriority.EMERGENCY,
          createdAt: a.ts,
          audioBuffer: Buffer.from(a.id),
        });
      }

      const pending = queue.getQueue();
      expect(pending.map((i) => i.id)).toEqual(['E100', 'E200', 'E300', 'E400', 'E500']);
    });

    it('EMP-CHAL-10: Identical createdAt emergency items preserve stable insertion FIFO order', () => {
      const mockPlayer = new ControlledMockPlayer();
      const mockTTS: ITTSPipeline = {
        synthesizeSpeech: vi.fn().mockResolvedValue(Buffer.from('PCM')),
      };

      const queue = new AudioQueueManager(mockPlayer, mockTTS);

      queue.enqueue({
        id: 'blocker',
        text: 'Active',
        priority: AudioPriority.EMERGENCY,
        createdAt: 1,
        audioBuffer: Buffer.from('BLOCKER'),
      });

      // 4 emergency items with identical timestamp 1000
      queue.enqueue({ id: 'E_A', text: 'A', priority: AudioPriority.EMERGENCY, createdAt: 1000 });
      queue.enqueue({ id: 'E_B', text: 'B', priority: AudioPriority.EMERGENCY, createdAt: 1000 });
      queue.enqueue({ id: 'E_C', text: 'C', priority: AudioPriority.EMERGENCY, createdAt: 1000 });
      queue.enqueue({ id: 'E_D', text: 'D', priority: AudioPriority.EMERGENCY, createdAt: 1000 });

      const pending = queue.getQueue();
      expect(pending.map((i) => i.id)).toEqual(['E_A', 'E_B', 'E_C', 'E_D']);
    });
  });

  describe('Focus 4: Synthetic PCM Tone Durations and Boundary Inputs', () => {
    it('EMP-CHAL-11: Non-positive and non-finite durations safely return empty buffer without RangeError', () => {
      const testCases = [
        0,
        -1,
        -0.0001,
        -100,
        -1000000,
        NaN,
        Infinity,
        -Infinity,
        0.00001, // Produces 0 total bytes
        null as any,
        undefined as any,
      ];

      for (const dur of testCases) {
        expect(() => {
          const buf = generateSyntheticPcmTone(dur);
          expect(buf).toBeInstanceOf(Buffer);
          expect(buf.length).toBe(0);
        }).not.toThrow();
      }
    });

    it('EMP-CHAL-12: Zero/negative sample rates and channels safely return empty buffer', () => {
      // sampleRate 0 or negative
      expect(generateSyntheticPcmTone(100, 440, 0, 2).length).toBe(0);
      expect(generateSyntheticPcmTone(100, 440, -48000, 2).length).toBe(0);

      // channels 0 or negative
      expect(generateSyntheticPcmTone(100, 440, 48000, 0).length).toBe(0);
      expect(generateSyntheticPcmTone(100, 440, 48000, -2).length).toBe(0);
    });

    it('EMP-CHAL-13: Valid tone generates exact byte count and samples within 16-bit limits', () => {
      const durationMs = 50;
      const sampleRate = 48000;
      const channels = 2;
      const expectedBytes = (durationMs * sampleRate * channels * 2) / 1000; // 9600 bytes

      const tone = generateSyntheticPcmTone(durationMs, 440, sampleRate, channels);
      expect(tone.length).toBe(expectedBytes);

      // Verify every Int16 sample is in signed range [-32768, 32767] and capped at 16384 (50% volume)
      for (let i = 0; i < tone.length; i += 2) {
        const sample = tone.readInt16LE(i);
        expect(sample).toBeGreaterThanOrEqual(-16384);
        expect(sample).toBeLessThanOrEqual(16384);
      }
    });
  });
});
