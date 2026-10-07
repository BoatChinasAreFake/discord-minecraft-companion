# Milestone 1 Iteration 2: Audio Priority Queue & TTS Remediation Plan

**Author**: Explorer M1 Iteration 2 (`explorer_m1_it2_1`)  
**Target Subsystems**: `src/audio/queue.ts`, `src/audio/tts.ts`, `src/audio/types.ts`  
**Test Suite**: `test/tier5_adversarial/audio_adversarial.test.ts`, `test/m1/audio_player_queue.test.ts`  
**Date**: 2026-10-07  
**Status**: PROPOSED & VERIFIED  

---

## 1. Executive Summary & Defect Catalog

During Milestone 1 adversarial stress testing by Challenger 1 (`challenger_m1_1`), four significant defects were identified across `AudioQueueManager` and `generateSyntheticPcmTone`:

| Defect ID | Severity | File | Root Cause | Impact |
|---|---|---|---|---|
| **DEF-AQM-1** | **Critical** | `src/audio/queue.ts:105-116` | Missing preemption/cancellation check following asynchronous speech synthesis | In-flight synthesis of preempted normal audio completes and clobbers active emergency survival alerts |
| **DEF-AQM-2** | **High** | `src/audio/queue.ts:117-124` | `catch` block invokes `handlePlaybackComplete()` which has success semantics | Synthesis failure erroneously triggers `onComplete()` and emits `itemCompleted` |
| **DEF-AQM-3** | **High** | `src/audio/queue.ts:32-37` | Player `'error'` event invokes `handlePlaybackComplete()` | Player crash or underflow erroneously triggers `onComplete()` and emits `itemCompleted` |
| **DEF-AQM-4** | **Medium** | `src/audio/queue.ts:61` | `handleEmergencyPreemption()` uses `unshift()` instead of priority/FIFO sorting | Multiple emergency alerts enqueued during playback invert into LIFO order |
| **DEF-TTS-1** | **Low** | `src/audio/tts.ts:11-13` | No guard against `durationMs <= 0` prior to `Buffer.alloc()` | Negative durations throw unhandled `RangeError` |

---

## 2. Root Cause Analysis & Architectural Remediation

### 2.1 Async Preemption Interleaving (DEF-AQM-1)
- **Mechanism**: When `processNext()` processes an item without pre-synthesized audio, it yields execution to `await this.ttsPipeline.synthesizeSpeech(...)`. When an emergency alert arrives during this await, `handleEmergencyPreemption()` sets `this.currentItem = null`, stops the player, and begins playing the emergency alert. However, when the original promise resolves, execution resumes in `processNext()`, which unconditionally sets `nextItem.audioBuffer = audioBuffer`, emits `playingItem`, and calls `this.player.playBuffer(audioBuffer)`.
- **Remediation Strategy**:
  1. Add an `aborted?: boolean` flag to `TTSQueueItem`.
  2. Maintain a monotonic `currentGeneration: number` inside `AudioQueueManager`.
  3. In `handleEmergencyPreemption()`, mark `preempted.aborted = true` and increment `this.currentGeneration++`.
  4. In `processNext()`, capture the generation at start (`const generation = ++this.currentGeneration`).
  5. Immediately after `await this.ttsPipeline.synthesizeSpeech(...)` and before calling `playBuffer()`, verify:
     ```typescript
     if (nextItem.aborted || this.currentItem !== nextItem || this.currentGeneration !== generation) {
       return; // Discard synthesized buffer and exit quietly
     }
     ```
  6. Similarly, in `catch (err)` of `processNext()`, if the item was aborted or superseded, suppress the error so preempted items do not pollute current playback state.
  7. Apply corresponding cancellation logic to `cancelNonEmergency()` and `stopAll()`.

---

### 2.2 Error Recovery Semantics (DEF-AQM-2 & DEF-AQM-3)
- **Mechanism**: `handlePlaybackComplete()` was designed exclusively with completion semantics:
  ```typescript
  if (this.currentItem) {
    if (this.currentItem.onComplete) this.currentItem.onComplete();
    this.emit('itemCompleted', this.currentItem);
    this.currentItem = null;
  }
  this.processNext();
  ```
  Both the synthesis `catch` block (line 123) and the player error listener (line 36) called `this.handlePlaybackComplete()`. Consequently, failed items received both `onError()` AND `onComplete()`, and emitted both `'error'` AND `'itemCompleted'`.
- **Remediation Strategy**:
  1. Decouple error handling from `handlePlaybackComplete()`.
  2. Implement a dedicated `handlePlaybackError(err: any)` method:
     ```typescript
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
     ```
  3. Route both `this.player.on('error', ...)` and `processNext()`'s `catch (err)` to `handlePlaybackError(err)`.
  4. Ensure `handlePlaybackComplete()` guards against null `currentItem`: if `this.currentItem === null`, return immediately without emitting completion events or advancing the queue twice.

---

### 2.3 Chronological FIFO Queue Ordering for Emergency Alerts (DEF-AQM-4)
- **Mechanism**: `handleEmergencyPreemption()` called `this.queue.unshift(emergencyItem)`. If an emergency item `E1` is playing and subsequent emergency alerts `E2` ($t=20$) and `E3` ($t=30$) arrive, `E2` is unshifted to `[E2]`, and `E3` is unshifted to `[E3, E2]`. This reverses arrival order to LIFO, causing later emergency events to play before earlier ones.
- **Remediation Strategy**:
  1. Replace `this.queue.unshift(emergencyItem)` with `this.insertSorted(emergencyItem)`.
  2. Because `AudioPriority.EMERGENCY` is 0, `insertSorted()` automatically places emergency items before all non-emergency items (priority $> 0$).
  3. When multiple emergency items exist, `insertSorted()` compares `createdAt` ascending, ensuring stable chronological FIFO ordering `[E2, E3]`.

---

### 2.4 Tone Generation Boundary Handling (DEF-TTS-1)
- **Mechanism**: In `generateSyntheticPcmTone()`, `const totalBytes = Math.floor(durationMs * bytesPerMs)` resulted in negative values when `durationMs < 0`. `Buffer.alloc(totalBytes)` then threw `RangeError: The value of "size" is out of range`.
- **Remediation Strategy**:
  1. Add an explicit boundary guard at the start of `generateSyntheticPcmTone()`:
     ```typescript
     if (!durationMs || durationMs <= 0 || !Number.isFinite(durationMs)) {
       return Buffer.alloc(0);
     }
     ```
  2. Ensure non-positive durations safely return a 0-byte buffer instead of throwing an unhandled exception.

---

## 3. Concrete TypeScript Code Modifications

### 3.1 File: `src/audio/types.ts`

```typescript
export interface TTSQueueItem {
  id: string;
  text: string;
  priority: AudioPriority;
  audioBuffer?: Buffer;
  metadata?: Record<string, unknown>;
  createdAt: number;
  onStart?: () => void;
  onComplete?: () => void;
  onError?: (err: Error) => void;
  aborted?: boolean; // <--- ADDED: Cancellation token for preemption and queue flushes
}
```

---

### 3.2 File: `src/audio/tts.ts`

```typescript
export function generateSyntheticPcmTone(
  durationMs: number,
  frequencyHz = 440,
  sampleRate = 48000,
  channels = 2
): Buffer {
  // Guard against non-positive or non-finite duration
  if (!durationMs || durationMs <= 0 || !Number.isFinite(durationMs)) {
    return Buffer.alloc(0);
  }

  const bytesPerMs = (sampleRate * channels * 2) / 1000;
  const totalBytes = Math.floor(durationMs * bytesPerMs);
  if (totalBytes <= 0) {
    return Buffer.alloc(0);
  }

  const buffer = Buffer.alloc(totalBytes);
  const amplitude = 16384; // 50% max volume

  const samplesPerChannel = totalBytes / (channels * 2);

  for (let i = 0; i < samplesPerChannel; i++) {
    const t = i / sampleRate;
    const sampleVal = Math.round(amplitude * Math.sin(2 * Math.PI * frequencyHz * t));

    for (let c = 0; c < channels; c++) {
      const offset = (i * channels + c) * 2;
      buffer.writeInt16LE(sampleVal, offset);
    }
  }

  return buffer;
}
```

---

### 3.3 File: `src/audio/queue.ts`

Full remediated implementation:

```typescript
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
```

---

## 4. Test Suite Alignment (`test/tier5_adversarial/audio_adversarial.test.ts`)

In Challenger 1's adversarial test file, tests `ADV-AQM-1` through `ADV-AQM-4` and `ADV-TTS-3` were written to empirically assert that the bug reproduced. Once the fixes are applied, the assertions must test the **expected secure behavior**:

1. **ADV-AQM-1**:
   ```typescript
   // Before: expect(clobbered).toBe(true); expect(playedBufferNames[playedBufferNames.length - 1]).toBe('SLOW_AUDIO');
   // Remediated:
   expect(clobbered).toBe(false);
   expect(playedBufferNames).toEqual(['PRE_SYNTH_EMERGENCY']);
   expect(queue.getCurrentItem()?.id).toBe('emerg_1');
   ```

2. **ADV-AQM-2**:
   ```typescript
   // Before: expect(onComplete).toHaveBeenCalled(); expect(itemCompletedSpy).toHaveBeenCalled();
   // Remediated:
   expect(onError).toHaveBeenCalledWith(expect.any(Error));
   expect(errorSpy).toHaveBeenCalled();
   expect(onComplete).not.toHaveBeenCalled();
   expect(itemCompletedSpy).not.toHaveBeenCalled();
   ```

3. **ADV-AQM-3**:
   ```typescript
   // Before: expect(onComplete).toHaveBeenCalled(); expect(itemCompletedSpy).toHaveBeenCalled();
   // Remediated:
   expect(onError).toHaveBeenCalled();
   expect(onComplete).not.toHaveBeenCalled();
   expect(itemCompletedSpy).not.toHaveBeenCalled();
   ```

4. **ADV-AQM-4**:
   ```typescript
   // Before: expect(pending.map((i) => i.id)).toEqual(['E3', 'E2']); ... expect(queue.getCurrentItem()?.id).toBe('E3');
   // Remediated:
   const pending = queue.getQueue();
   expect(pending.map((i) => i.id)).toEqual(['E2', 'E3']);
   mockPlayer.simulateComplete();
   expect(queue.getCurrentItem()?.id).toBe('E2');
   ```

5. **ADV-TTS-3**:
   ```typescript
   // Before: expect(() => generateSyntheticPcmTone(-100)).toThrow(RangeError);
   // Remediated:
   expect(generateSyntheticPcmTone(-100).length).toBe(0);
   ```

---

## 5. Artifact Reference Guide

For immediate application by the implementation agent, complete drop-in replacement files and unified diffs have been prepared in `.agents/teamwork/explorer_m1_it2_1/`:

- `proposed_queue.ts`: Complete drop-in replacement for `src/audio/queue.ts`
- `proposed_tts.ts`: Complete drop-in replacement for `src/audio/tts.ts`
- `proposed_types.ts`: Complete drop-in replacement for `src/audio/types.ts`
- `proposed_audio_adversarial.test.ts`: Complete drop-in replacement for `test/tier5_adversarial/audio_adversarial.test.ts`
- `changes.patch`: Unified diff patch applying all four fixes cleanly
