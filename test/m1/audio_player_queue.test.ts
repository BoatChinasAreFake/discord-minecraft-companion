import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { VoicePlayer } from '../../src/audio/player.js';
import { AudioQueueManager } from '../../src/audio/queue.js';
import { AudioPriority, VoicePlaybackState } from '../../src/audio/types.js';
import type { ITTSPipeline, TTSQueueItem } from '../../src/audio/types.js';

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

  public completeCurrent(): void {
    this.playing = false;
    this.emit('idle');
  }
}

describe('Audio Player & Priority Queue (src/audio/player.ts & queue.ts)', () => {
  it('TC-APQ-1: VoicePlayer initializes in IDLE state and manages volume limits', () => {
    const player = new VoicePlayer();
    expect(player.getState()).toBe(VoicePlaybackState.IDLE);
    expect(player.isPlaying()).toBe(false);

    player.setVolume(1.5);
    expect(player.getVolume()).toBe(1.5);

    // Clamps below 0 and above 2.0
    player.setVolume(-0.5);
    expect(player.getVolume()).toBe(0);

    player.setVolume(3.5);
    expect(player.getVolume()).toBe(2.0);
  });

  it('TC-APQ-2: AudioQueueManager maintains strict priority order', () => {
    const mockPlayer = new MockAudioPlayer();
    const mockTTS: ITTSPipeline = {
      synthesizeSpeech: vi.fn().mockResolvedValue(Buffer.from('audio_pcm')),
    };

    const queue = new AudioQueueManager(mockPlayer, mockTTS);

    const normalItem: TTSQueueItem = {
      id: '1',
      text: 'Normal announcement',
      priority: AudioPriority.NORMAL,
      createdAt: 100,
    };
    const lowItem: TTSQueueItem = {
      id: '2',
      text: 'Low chatter',
      priority: AudioPriority.LOW,
      createdAt: 105,
    };
    const highItem: TTSQueueItem = {
      id: '3',
      text: 'High alert',
      priority: AudioPriority.HIGH,
      createdAt: 110,
    };

    queue.enqueue(lowItem);
    // At this point, lowItem starts playing because queue was idle
    expect(queue.getCurrentItem()?.id).toBe('2');

    // Enqueue normal and high while low is playing
    queue.enqueue(normalItem);
    queue.enqueue(highItem);

    // Queue order should be high (HIGH=1), then normal (NORMAL=2)
    const pending = queue.getQueue();
    expect(pending.length).toBe(2);
    expect(pending[0].id).toBe('3'); // High priority
    expect(pending[1].id).toBe('1'); // Normal priority
  });

  it('TC-APQ-3: AudioQueueManager preserves FIFO order for matching priorities', () => {
    const mockPlayer = new MockAudioPlayer();
    const mockTTS: ITTSPipeline = {
      synthesizeSpeech: vi.fn().mockResolvedValue(Buffer.from('audio_pcm')),
    };

    const queue = new AudioQueueManager(mockPlayer, mockTTS);

    // Start with a dummy playing item
    queue.enqueue({ id: 'active', text: 'Active', priority: AudioPriority.NORMAL, createdAt: 1 });

    const itemA: TTSQueueItem = { id: 'a', text: 'First', priority: AudioPriority.NORMAL, createdAt: 10 };
    const itemB: TTSQueueItem = { id: 'b', text: 'Second', priority: AudioPriority.NORMAL, createdAt: 20 };
    const itemC: TTSQueueItem = { id: 'c', text: 'Third', priority: AudioPriority.NORMAL, createdAt: 30 };

    queue.enqueue(itemA);
    queue.enqueue(itemB);
    queue.enqueue(itemC);

    const pending = queue.getQueue();
    expect(pending.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('TC-APQ-4: EMERGENCY priority preempts active non-emergency playback immediately', async () => {
    const mockPlayer = new MockAudioPlayer();
    const mockTTS: ITTSPipeline = {
      synthesizeSpeech: vi.fn().mockResolvedValue(Buffer.from('audio_pcm')),
    };

    const queue = new AudioQueueManager(mockPlayer, mockTTS);

    const preemptionSpy = vi.fn();
    queue.on('preemptionTriggered', preemptionSpy);

    // Play normal speech
    const normalItem: TTSQueueItem = {
      id: 'normal_1',
      text: 'Long conversation about flowers',
      priority: AudioPriority.NORMAL,
      createdAt: 100,
    };
    queue.enqueue(normalItem);
    expect(queue.getCurrentItem()?.id).toBe('normal_1');

    // Influx of emergency alert (creeper explosion / low health)
    const emergencyItem: TTSQueueItem = {
      id: 'emerg_1',
      text: 'Warning! Creeper detonating!',
      priority: AudioPriority.EMERGENCY,
      createdAt: 200,
    };
    queue.enqueue(emergencyItem);

    // Verify preemption event fired and player stopped previous item
    expect(preemptionSpy).toHaveBeenCalled();
    expect(mockPlayer.stoppedCount).toBeGreaterThan(0);
    // Emergency item should immediately become the active playing item
    expect(queue.getCurrentItem()?.id).toBe('emerg_1');
  });

  it('TC-APQ-5: cancelNonEmergency flushes non-emergency items while preserving emergency', () => {
    const mockPlayer = new MockAudioPlayer();
    const mockTTS: ITTSPipeline = {
      synthesizeSpeech: vi.fn().mockResolvedValue(Buffer.from('audio_pcm')),
    };

    const queue = new AudioQueueManager(mockPlayer, mockTTS);

    // Block player with active emergency item
    queue.enqueue({ id: 'active', text: 'Active Emergency', priority: AudioPriority.EMERGENCY, createdAt: 1 });

    queue.enqueue({ id: 'norm_1', text: 'Text', priority: AudioPriority.NORMAL, createdAt: 10 });
    queue.enqueue({ id: 'low_1', text: 'Text', priority: AudioPriority.LOW, createdAt: 20 });
    queue.enqueue({ id: 'emerg_queued', text: 'Text', priority: AudioPriority.EMERGENCY, createdAt: 30 });

    queue.cancelNonEmergency();

    const remaining = queue.getQueue();
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe('emerg_queued');
  });

  it('TC-APQ-6: stopAll clears entire queue and stops player', () => {
    const mockPlayer = new MockAudioPlayer();
    const mockTTS: ITTSPipeline = {
      synthesizeSpeech: vi.fn().mockResolvedValue(Buffer.from('audio_pcm')),
    };

    const queue = new AudioQueueManager(mockPlayer, mockTTS);

    queue.enqueue({ id: '1', text: 'One', priority: AudioPriority.NORMAL, createdAt: 1 });
    queue.enqueue({ id: '2', text: 'Two', priority: AudioPriority.HIGH, createdAt: 2 });

    expect(queue.isPlaying()).toBe(true);
    queue.stopAll();

    expect(queue.getQueueLength()).toBe(0);
    expect(queue.getCurrentItem()).toBeNull();
    expect(mockPlayer.stoppedCount).toBeGreaterThan(0);
  });
});
