import { EventEmitter } from 'node:events';
import {
  AudioPriority,
  IAudioQueueManager,
  TTSQueueItem,
  ITTSPipeline
} from './types.js';

export interface PlayerLike {
  on(event: string, listener: (...args: any[]) => void): void;
  playBuffer(buffer: Buffer, options?: any): Promise<void>;
  stop(force?: boolean): boolean;
  isPlaying(): boolean;
}

export class AudioQueueManager extends EventEmitter implements IAudioQueueManager {
  private queue: TTSQueueItem[] = [];
  private currentItem: TTSQueueItem | null = null;
  private isProcessing = false;
  private currentGeneration = 0;

  constructor(
    private player: PlayerLike,
    private ttsPipeline: ITTSPipeline
  ) {
    super();

    // Hook player idle state to auto-trigger the next queue item
    this.player.on('idle', () => {
      this.handlePlaybackComplete();
    });

    this.player.on('error', (err: any) => {
      this.handlePlaybackError(err);
    });
  }

  public enqueue(item: TTSQueueItem): void {
    // 1. EMERGENCY Preemption Check
    if (item.priority === AudioPriority.EMERGENCY) {
      this.handleEmergencyPreemption(item);
      return;
    }

    // 2. Normal Queue Insertion: Priority ASC, then CreatedAt ASC
    this.insertSorted(item);
    this.emit('enqueued', item);

    // 3. Auto-play trigger if idle
    if (!this.currentItem && !this.isProcessing) {
      this.processNext();
    }
  }

  private handleEmergencyPreemption(emergencyItem: TTSQueueItem): void {
    this.emit('preemptionTriggered', { emergencyItem, currentItem: this.currentItem });

    // Insert emergency item in chronological FIFO order among emergency items
    this.insertSorted(emergencyItem);

    if (this.currentItem && this.currentItem.priority !== AudioPriority.EMERGENCY) {
      // Preempt active non-emergency playback
      const preempted = this.currentItem;
      preempted.aborted = true;
      this.currentGeneration++;
      this.currentItem = null;
      this.isProcessing = false;
      this.player.stop(true);
      this.emit('itemPreempted', preempted);
    }

    if (!this.currentItem && !this.isProcessing) {
      this.processNext();
    }
  }

  private insertSorted(item: TTSQueueItem): void {
    const itemCreated = item.createdAt ?? 0;
    const index = this.queue.findIndex(
      (existing) =>
        existing.priority > item.priority ||
        (existing.priority === item.priority && (existing.createdAt ?? 0) > itemCreated)
    );

    if (index === -1) {
      this.queue.push(item);
    } else {
      this.queue.splice(index, 0, item);
    }
  }

  public async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const nextItem = this.queue.shift()!;
    this.currentItem = nextItem;
    const generation = ++this.currentGeneration;

    try {
      if (nextItem.onStart) {
        try {
          nextItem.onStart();
        } catch (startErr) {
          this.emit('error', startErr);
        }
      }

      // If audioBuffer is not pre-synthesized, synthesize via TTS pipeline
      let audioBuffer = nextItem.audioBuffer;
      if (!audioBuffer) {
        audioBuffer = await this.ttsPipeline.synthesizeSpeech(nextItem.text, {
          voiceName: (nextItem.metadata?.voiceName as string) || undefined,
        });

        // Verify if preempted or aborted while synthesis was awaiting
        if (nextItem.aborted || this.currentItem !== nextItem || this.currentGeneration !== generation) {
          return;
        }

        nextItem.audioBuffer = audioBuffer;
      }

      if (nextItem.aborted || this.currentItem !== nextItem || this.currentGeneration !== generation) {
        return;
      }

      this.emit('playingItem', nextItem);
      this.isProcessing = false;

      // Play through player (returns promise that resolves on completion)
      await this.player.playBuffer(audioBuffer);
    } catch (err: any) {
      if (nextItem.aborted || this.currentItem !== nextItem || this.currentGeneration !== generation) {
        return;
      }
      this.handlePlaybackError(err);
    }
  }

  private handlePlaybackComplete(): void {
    if (!this.currentItem) {
      return;
    }

    const completedItem = this.currentItem;
    this.currentItem = null;
    this.isProcessing = false;

    if (completedItem.onComplete) {
      try {
        completedItem.onComplete();
      } catch (cbErr) {
        this.emit('error', cbErr);
      }
    }
    this.emit('itemCompleted', completedItem);

    this.processNext();
  }

  private handlePlaybackError(err: any): void {
    const failedItem = this.currentItem;
    if (!failedItem) {
      this.emit('error', err);
      return;
    }

    this.currentItem = null;
    this.isProcessing = false;

    this.emit('error', err);
    this.emit('itemFailed', { item: failedItem, error: err });

    if (failedItem.onError) {
      try {
        failedItem.onError(err);
      } catch (cbErr) {
        this.emit('error', cbErr);
      }
    }

    this.processNext();
  }

  public cancelNonEmergency(): void {
    for (const item of this.queue) {
      if (item.priority !== AudioPriority.EMERGENCY) {
        item.aborted = true;
      }
    }
    this.queue = this.queue.filter((item) => item.priority === AudioPriority.EMERGENCY);

    if (this.currentItem && this.currentItem.priority !== AudioPriority.EMERGENCY) {
      const cancelled = this.currentItem;
      cancelled.aborted = true;
      this.currentGeneration++;
      this.currentItem = null;
      this.isProcessing = false;
      this.player.stop(true);
      if (this.queue.length > 0) {
        this.processNext();
      }
    }
    this.emit('queueFiltered', 'non_emergency_cancelled');
  }

  public stopAll(): void {
    for (const item of this.queue) {
      item.aborted = true;
    }
    this.queue = [];
    if (this.currentItem) {
      this.currentItem.aborted = true;
      this.currentItem = null;
    }
    this.currentGeneration++;
    this.isProcessing = false;
    this.player.stop(true);
    this.emit('stoppedAll');
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public getQueue(): TTSQueueItem[] {
    return [...this.queue];
  }

  public getCurrentItem(): TTSQueueItem | null {
    return this.currentItem;
  }

  public isPlaying(): boolean {
    return this.currentItem !== null || this.player.isPlaying();
  }
}
