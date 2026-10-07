# Handoff Report: Milestone 1 Iteration 2 Audio Queue & TTS Remediation

**Author**: `explorer_m1_it2_1`  
**Date**: 2026-10-07  
**Type**: Hard Handoff (Investigation & Remediation Specification Complete)  

---

## 1. Observation

1. **Async Preemption Interleaving in `src/audio/queue.ts:105-116`**:
   - In `processNext()`, when `audioBuffer` is absent, execution awaits `this.ttsPipeline.synthesizeSpeech(...)`:
     ```typescript
     let audioBuffer = nextItem.audioBuffer;
     if (!audioBuffer) {
       audioBuffer = await this.ttsPipeline.synthesizeSpeech(nextItem.text, {
         voiceName: (nextItem.metadata?.voiceName as string) || undefined,
       });
       nextItem.audioBuffer = audioBuffer;
     }

     this.emit('playingItem', nextItem);
     this.isProcessing = false;
     await this.player.playBuffer(audioBuffer);
     ```
   - When an emergency alert arrives while synthesis is awaiting, `handleEmergencyPreemption()` (lines 63-70) clears `this.currentItem = null` and invokes `this.player.stop(true)` to play the emergency item.
   - However, when the in-flight synthesis promise resolves, `processNext()` resumes without checking whether `nextItem` was preempted or whether `this.currentItem` has changed. It immediately calls `this.player.playBuffer(audioBuffer)`, interrupting and clobbering the active emergency alert.
   - Empirically reproduced in `test/tier5_adversarial/audio_adversarial.test.ts:67-121` (`ADV-AQM-1`).

2. **False Completion on Synthesis Failure in `src/audio/queue.ts:117-124`**:
   - In `processNext()`, if `synthesizeSpeech` rejects with an error:
     ```typescript
     } catch (err: any) {
       this.isProcessing = false;
       this.emit('error', err);
       if (nextItem.onError) {
         nextItem.onError(err);
       }
       this.handlePlaybackComplete();
     }
     ```
   - `handlePlaybackComplete()` (lines 127-137) checks:
     ```typescript
     private handlePlaybackComplete(): void {
       if (this.currentItem) {
         if (this.currentItem.onComplete) {
           this.currentItem.onComplete();
         }
         this.emit('itemCompleted', this.currentItem);
         this.currentItem = null;
       }
       this.processNext();
     }
     ```
   - Because `this.currentItem` was set to `nextItem` before the `try` block, `handlePlaybackComplete()` invokes `onComplete()` and emits `'itemCompleted'`, falsely signaling that failed audio completed successfully.
   - Empirically reproduced in `test/tier5_adversarial/audio_adversarial.test.ts:123-162` (`ADV-AQM-2`).

3. **False Completion on Player Error in `src/audio/queue.ts:32-37`**:
   - The player error listener is wired as follows:
     ```typescript
     this.player.on('error', (err: any) => {
       if (this.currentItem?.onError) {
         this.currentItem.onError(err);
       }
       this.handlePlaybackComplete();
     });
     ```
   - Invoking `handlePlaybackComplete()` invokes `this.currentItem.onComplete()` and emits `'itemCompleted'` despite the underlying audio player failing.
   - Empirically reproduced in `test/tier5_adversarial/audio_adversarial.test.ts:164-197` (`ADV-AQM-3`).

4. **Emergency Queue FIFO Ordering Inversion in `src/audio/queue.ts:60-61`**:
   - In `handleEmergencyPreemption()`:
     ```typescript
     // Put emergency at the very front of the queue
     this.queue.unshift(emergencyItem);
     ```
   - When multiple emergency items arrive sequentially while an active emergency item is already playing, each is prepended with `unshift()`. If `E2` arrives at $t=20$ and `E3` arrives at $t=30$, the queue becomes `[E3, E2]`. When playback advances, `E3` plays before `E2`, reversing chronological FIFO order.
   - Empirically reproduced in `test/tier5_adversarial/audio_adversarial.test.ts:199-244` (`ADV-AQM-4`).

5. **Boundary Defect in `src/audio/tts.ts:11-13`**:
   - `generateSyntheticPcmTone` calculates:
     ```typescript
     const bytesPerMs = (sampleRate * channels * 2) / 1000;
     const totalBytes = Math.floor(durationMs * bytesPerMs);
     const buffer = Buffer.alloc(totalBytes);
     ```
   - If `durationMs < 0` (e.g. `-100`), `totalBytes = -19200`. Calling `Buffer.alloc(-19200)` throws `RangeError: The value of "size" is out of range`.
   - Empirically confirmed in `test/tier5_adversarial/audio_adversarial.test.ts:516-521` (`ADV-TTS-3`).

---

## 2. Logic Chain

1. **Preemption Interleaving**:
   - From Observation 1, asynchronous operations can span multiple turns of the event loop.
   - If state mutates during an `await`, the continuation cannot assume the pre-condition (`nextItem === currentItem`) still holds.
   - Introducing a per-item cancellation token (`item.aborted = true`) and a monotonic generation counter (`currentGeneration`) allows the continuation to detect whether the item was preempted or cancelled while awaiting synthesis.
   - If `nextItem.aborted || this.currentItem !== nextItem || this.currentGeneration !== generation`, the callback safely discards the synthesized buffer and exits without invoking `player.playBuffer()`.

2. **Error Recovery Decoupling**:
   - From Observations 2 and 3, `handlePlaybackComplete()` embodies success semantics (`onComplete`, `itemCompleted`).
   - Calling `handlePlaybackComplete()` on error conflates failure and success states.
   - Extracting error handling into `handlePlaybackError(err)` ensures that on error:
     - `this.currentItem` is cleared (`this.currentItem = null`)
     - `this.isProcessing = false`
     - `error` and `itemFailed` events are emitted
     - `item.onError(err)` is executed
     - `onComplete` and `itemCompleted` are NEVER invoked
     - `this.processNext()` advances the queue to subsequent items.
   - Checking `if (!this.currentItem) return;` at the start of `handlePlaybackComplete()` prevents subsequent `'idle'` events from duplicate processing.

3. **Emergency FIFO Ordering**:
   - From Observation 4, `unshift()` implements LIFO (stack) semantics, not FIFO (queue) semantics.
   - `insertSorted()` already sorts by `priority` ascending, and then by `createdAt` ascending.
   - Because `AudioPriority.EMERGENCY = 0`, `insertSorted()` places emergency items before any non-emergency items (priority $> 0$).
   - Among multiple emergency items, sorting by `createdAt` ascending guarantees strict chronological FIFO order (`[E2, E3]`).

4. **Tone Generation Guard**:
   - From Observation 5, durations $\le 0$ have no meaningful audio representation.
   - Guarding with `if (!durationMs || durationMs <= 0 || !Number.isFinite(durationMs)) return Buffer.alloc(0);` guarantees non-crashing behavior for negative, zero, or non-finite durations.

---

## 3. Caveats

1. **Other Subsystem Failures**: Test suite `test/tier5_adversarial/m1_adversarial.test.ts` contains 7 failing tests in `AntiLoopbackFilter`, `ChatBridge`, and `RBACService` (e.g. hex color stripping, username formatting injection, undefined ownerId match). These belong to the chat bridge and security scopes, not the audio queue / TTS scope assigned to this investigation.
2. **Read-Only Explorer Scope**: In accordance with the Explorer archetype rules, no changes have been committed directly to `src/` or `test/`. All proposed changes have been staged in `.agents/teamwork/explorer_m1_it2_1/`.

---

## 4. Conclusion

The four root causes have been isolated, proven, and fully resolved in the proposed code artifacts:
- `src/audio/types.ts`: Added `aborted?: boolean` to `TTSQueueItem`.
- `src/audio/queue.ts`: Implemented generation tracking, preemption discard guard, dedicated `handlePlaybackError()`, and FIFO `insertSorted()` for emergency items.
- `src/audio/tts.ts`: Added zero/negative/non-finite duration guard to `generateSyntheticPcmTone()`.
- `test/tier5_adversarial/audio_adversarial.test.ts`: Updated test assertions to verify the fixed behaviors.

All concrete files are ready for immediate adoption:
- Plan: `.agents/teamwork/explorer_m1_it2_1/remediation_plan.md`
- Proposed source files: `proposed_queue.ts`, `proposed_tts.ts`, `proposed_types.ts`, `proposed_audio_adversarial.test.ts`
- Patch file: `.agents/teamwork/explorer_m1_it2_1/changes.patch`

---

## 5. Verification Method

To verify these fixes after applying them to `src/` and `test/`:

1. **Run Audio Player & Queue Unit Tests**:
   ```powershell
   node ./node_modules/vitest/vitest.mjs run test/m1/audio_player_queue.test.ts
   ```
   *Expected*: 6 passing tests (`TC-APQ-1` through `TC-APQ-6`).

2. **Run STT & TTS Unit Tests**:
   ```powershell
   node ./node_modules/vitest/vitest.mjs run test/m1/audio_stt_tts.test.ts
   ```
   *Expected*: 7 passing tests (`TC-STT-1` through `TC-STT-3`, `TC-TTS-1` through `TC-TTS-4`).

3. **Run Adversarial Audio Suite (with updated test assertions)**:
   ```powershell
   node ./node_modules/vitest/vitest.mjs run test/tier5_adversarial/audio_adversarial.test.ts
   ```
   *Expected*: 17 passing tests (`ADV-AQM-1` through `ADV-AQM-6`, `ADV-REC-1` through `ADV-REC-6`, `ADV-STT-1` through `ADV-STT-2`, `ADV-TTS-1` through `ADV-TTS-3`).

4. **Invalidation Conditions**:
   - If `mockPlayer.playedBuffers` contains `'SLOW_AUDIO'` in `ADV-AQM-1`, async preemption discard failed.
   - If `onComplete` is called in `ADV-AQM-2` or `ADV-AQM-3`, error decoupling failed.
   - If `queue.getQueue()` order is `['E3', 'E2']` in `ADV-AQM-4`, emergency FIFO sorting failed.
   - If `generateSyntheticPcmTone(-100)` throws `RangeError`, negative duration guard failed.
