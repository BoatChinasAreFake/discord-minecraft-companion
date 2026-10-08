import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { VoiceReceiver, calculatePcmRms } from '../../src/audio/receiver.js';
import { AudioQueueManager } from '../../src/audio/queue.js';
import { AudioPriority, DEFAULT_RECEIVER_CONFIG } from '../../src/audio/types.js';
import type { ITTSPipeline, TTSQueueItem } from '../../src/audio/types.js';
import { MockVoiceSession } from '../mocks/mockVoice.js';

class MockAudioPlayer extends EventEmitter {
  public playing = false;
  public playedBuffers: Buffer[] = [];
  public stoppedCount = 0;

  public async playBuffer(buffer: Buffer): Promise<void> {
    this.playing = true;
    this.playedBuffers.push(buffer);
    this.emit('playing');
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
}

describe('Tier 2: Voice & Audio Pipeline Boundaries (T2-AUD-01 to T2-AUD-08)', () => {
  let mockPlayer: MockAudioPlayer;
  let mockTTS: ITTSPipeline;
  let queueManager: AudioQueueManager;
  let receiver: VoiceReceiver;

  beforeEach(() => {
    mockPlayer = new MockAudioPlayer();
    mockTTS = {
      synthesizeSpeech: vi.fn().mockResolvedValue(Buffer.from('synthesized_audio_data')),
    };
    queueManager = new AudioQueueManager(mockPlayer, mockTTS);
    receiver = new VoiceReceiver();
  });

  // --------------------------------------------------------------------------
  // Silence Timeout & Inbound Stream Boundaries (T2-AUD-01 to T2-AUD-04)
  // --------------------------------------------------------------------------
  describe('Inbound Audio Stream & VAD Energy Boundaries (T2-AUD-01 to T2-AUD-04)', () => {
    it('T2-AUD-01: configures silence duration timeout to 500ms AfterSilence', () => {
      const config = receiver.getConfig();
      expect(config.silenceDurationMs).toBe(500);
      expect(DEFAULT_RECEIVER_CONFIG.silenceDurationMs).toBe(500);

      // Custom config override
      const customReceiver = new VoiceReceiver({ silenceDurationMs: 650 });
      expect(customReceiver.getConfig().silenceDurationMs).toBe(650);
    });

    it('T2-AUD-02: empty audio packet stream is handled gracefully without emitting speech utterance', () => {
      let utteranceEmitted = false;
      let noiseDiscardedReason = '';

      receiver.on('utterance', () => {
        utteranceEmitted = true;
      });

      receiver.on('noiseDiscarded', (evt) => {
        noiseDiscardedReason = evt.reason;
      });

      // Process empty 0-byte buffer
      const result = receiver.processPcmUtterance('user_empty_stream', Buffer.alloc(0));

      expect(result).toBeNull();
      expect(utteranceEmitted).toBe(false);
      expect(noiseDiscardedReason).toBe('duration_too_short');
    });

    it('T2-AUD-03: VAD energy filter rejects low amplitude acoustic noise floor (< 300 RMS)', () => {
      // 300ms duration at 48000Hz stereo 16-bit (4 bytes per sample frame) = 57,600 bytes
      const numBytes = Math.floor((48000 * 2 * 2 * 300) / 1000);
      const lowEnergyBuffer = Buffer.alloc(numBytes);

      // Fill with low amplitude static noise (sample values around 25)
      for (let i = 0; i < lowEnergyBuffer.length; i += 2) {
        lowEnergyBuffer.writeInt16LE(25, i);
      }

      const rms = calculatePcmRms(lowEnergyBuffer);
      expect(rms).toBeCloseTo(25, 0);
      expect(rms).toBeLessThan(300);

      let discardedReason = '';
      receiver.on('noiseDiscarded', (evt) => {
        discardedReason = evt.reason;
      });

      const event = receiver.processPcmUtterance('user_quiet', lowEnergyBuffer);
      expect(event).toBeNull();
      expect(discardedReason).toBe('rms_below_threshold');
    });

    it('T2-AUD-04: VAD energy filter accepts high vocal energy speech (> 300 RMS) and emits UtteranceEvent', () => {
      // 400ms duration at 48000Hz stereo 16-bit
      const numBytes = Math.floor((48000 * 2 * 2 * 400) / 1000);
      const speechBuffer = Buffer.alloc(numBytes);

      // Fill with vocal energy (sample amplitude 2500)
      for (let i = 0; i < speechBuffer.length; i += 2) {
        speechBuffer.writeInt16LE(2500, i);
      }

      const rms = calculatePcmRms(speechBuffer);
      expect(rms).toBeCloseTo(2500, 0);
      expect(rms).toBeGreaterThan(300);

      let capturedEvent: any = null;
      receiver.on('utterance', (evt) => {
        capturedEvent = evt;
      });

      const result = receiver.processPcmUtterance('user_active_speaker', speechBuffer);
      expect(result).not.toBeNull();
      expect(capturedEvent).not.toBeNull();
      expect(capturedEvent.userId).toBe('user_active_speaker');
      expect(capturedEvent.durationMs).toBeCloseTo(400, 0);
      expect(capturedEvent.rms).toBeCloseTo(2500, 0);
      expect(capturedEvent.wavBuffer).toBeDefined();
      expect(capturedEvent.wavBuffer.length).toBeGreaterThan(speechBuffer.length); // Includes 44-byte WAV header
    });
  });

  // --------------------------------------------------------------------------
  // Audio Queue Stress & Preemption Boundaries (T2-AUD-05, T2-AUD-06)
  // --------------------------------------------------------------------------
  describe('Audio Queue Stress & Emergency Preemption (T2-AUD-05, T2-AUD-06)', () => {
    it('T2-AUD-05: queue flood preemption prioritizes EMERGENCY item ahead of 50 queued NORMAL items', () => {
      // Start with normal item that begins active playback
      queueManager.enqueue({
        id: 'active_normal',
        text: 'Active long conversation',
        priority: AudioPriority.NORMAL,
        createdAt: 100,
      });

      // Flood queue with 50 NORMAL priority items
      for (let i = 0; i < 50; i++) {
        queueManager.enqueue({
          id: `normal_msg_${i}`,
          text: `Normal chat message ${i}`,
          priority: AudioPriority.NORMAL,
          createdAt: 1000 + i,
        });
      }

      expect(queueManager.getQueueLength()).toBe(50);

      // Enqueue 1 critical EMERGENCY item
      const emergencyItem: TTSQueueItem = {
        id: 'emergency_lava_alert',
        text: 'Warning! Lava breach detected!',
        priority: AudioPriority.EMERGENCY,
        createdAt: 2000,
      };

      queueManager.enqueue(emergencyItem);

      // The emergency item preempts active normal playback and immediately becomes currentItem
      expect(queueManager.getCurrentItem()?.id).toBe('emergency_lava_alert');
      expect(queueManager.getCurrentItem()?.priority).toBe(AudioPriority.EMERGENCY);

      // If a second emergency item arrives while first emergency item is playing, it is placed at head of queue
      const emergencyItem2: TTSQueueItem = {
        id: 'emergency_second_alert',
        text: 'Warning! Hostile mob attacking!',
        priority: AudioPriority.EMERGENCY,
        createdAt: 2001,
      };
      queueManager.enqueue(emergencyItem2);

      const queue = queueManager.getQueue();
      expect(queue[0].id).toBe('emergency_second_alert');
      expect(queue[0].priority).toBe(AudioPriority.EMERGENCY);
    });

    it('T2-AUD-06: cancelNonEmergency selectively purges NORMAL and HIGH items while preserving EMERGENCY items', () => {
      // Start with active emergency item so subsequent emergency items queue up
      queueManager.enqueue({
        id: 'active_emerg',
        text: 'Active emergency',
        priority: AudioPriority.EMERGENCY,
        createdAt: 1,
      });

      const items: TTSQueueItem[] = [
        { id: 'norm_1', text: 'N1', priority: AudioPriority.NORMAL, createdAt: 100 },
        { id: 'norm_2', text: 'N2', priority: AudioPriority.NORMAL, createdAt: 101 },
        { id: 'high_1', text: 'H1', priority: AudioPriority.HIGH, createdAt: 102 },
        { id: 'high_2', text: 'H2', priority: AudioPriority.HIGH, createdAt: 103 },
        { id: 'emg_1', text: 'E1', priority: AudioPriority.EMERGENCY, createdAt: 104 },
        { id: 'emg_2', text: 'E2', priority: AudioPriority.EMERGENCY, createdAt: 105 },
      ];

      for (const item of items) {
        queueManager.enqueue(item);
      }

      queueManager.cancelNonEmergency();

      // Only the 2 emergency items should remain in the pending queue
      const remaining = queueManager.getQueue();
      expect(remaining).toHaveLength(2);
      for (const item of remaining) {
        expect(item.priority).toBe(AudioPriority.EMERGENCY);
      }
      expect(remaining.map((i) => i.id)).toEqual(['emg_1', 'emg_2']);
    });
  });

  // --------------------------------------------------------------------------
  // Voice Session Destruction Boundaries (T2-AUD-07, T2-AUD-08)
  // --------------------------------------------------------------------------
  describe('Voice Session Destruction Boundaries (T2-AUD-07, T2-AUD-08)', () => {
    it('T2-AUD-07: rejects audio playback on a destroyed voice session and throws error', async () => {
      const voiceSession = new MockVoiceSession('voice_chan_1', 'guild_1');
      voiceSession.destroy();
      expect(voiceSession.isDestroyed).toBe(true);

      const buffer = Buffer.from('playback_pcm_chunk');
      await expect(voiceSession.playAudioStream(buffer, 'NORMAL')).rejects.toThrow(
        'Cannot play audio on destroyed voice session'
      );
    });

    it('T2-AUD-08: destroys all active user streams and clears session map on mid-stream disconnect', () => {
      const voiceSession = new MockVoiceSession('voice_chan_1', 'guild_1');

      const stream1 = voiceSession.subscribeUser('speaker_alpha');
      const stream2 = voiceSession.subscribeUser('speaker_beta');

      expect(voiceSession.activeUserStreams.size).toBe(2);
      expect(stream1.destroyed).toBe(false);
      expect(stream2.destroyed).toBe(false);

      // Session destroyed mid-stream
      voiceSession.destroy();

      expect(voiceSession.isDestroyed).toBe(true);
      expect(voiceSession.activeUserStreams.size).toBe(0);
      expect(stream1.destroyed).toBe(true);
      expect(stream2.destroyed).toBe(true);
    });
  });
});
