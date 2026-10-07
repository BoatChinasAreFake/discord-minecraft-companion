# Milestone 1 Challenger Handoff Report: Audio Queue, Voice Receiver & STT/TTS Subsystems

**Agent**: `challenger_m1_1`  
**Milestone**: Milestone 1  
**Project**: Multimodal Discord Minecraft Bot with AI Agent Engine  
**Working Directory**: `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\challenger_m1_1`  
**Date**: 2026-10-07  
**Verdict**: **REQUEST_CHANGES**  

---

## 1. Observation

Direct code analysis and empirical test execution revealed four defects across `src/audio/queue.ts` and `src/audio/tts.ts`:

1. **Async Preemption Interleaving in `AudioQueueManager.processNext()` (`src/audio/queue.ts:91-116`)**:
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

   // Play through player (returns promise that resolves on completion)
   await this.player.playBuffer(audioBuffer);
   ```
   When `handleEmergencyPreemption` preempts an in-flight non-emergency item awaiting `synthesizeSpeech`, `this.currentItem` is cleared and the emergency item begins playing. Once `synthesizeSpeech` finishes, the async continuation in `processNext` executes unconditionally, invoking `this.player.playBuffer(audioBuffer)`.
   *Empirical result (`ADV-AQM-1`)*: The slow item (`SLOW_AUDIO`) interrupted and overwrote the emergency alert (`PRE_SYNTH_EMERGENCY`).

2. **False Completion on Speech Synthesis Error (`src/audio/queue.ts:117-137`)**:
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
   Inside `handlePlaybackComplete`:
   ```typescript
   if (this.currentItem) {
     if (this.currentItem.onComplete) {
       this.currentItem.onComplete();
     }
     this.emit('itemCompleted', this.currentItem);
     this.currentItem = null;
   }
   ```
   Because `this.currentItem` is still set to `nextItem`, `handlePlaybackComplete()` executes `this.currentItem.onComplete()` and emits `itemCompleted`.
   *Empirical result (`ADV-AQM-2`)*: A failed synthesis triggered both `onError` and `onComplete` / `itemCompleted`.

3. **False Completion on Player Error (`src/audio/queue.ts:32-37`)**:
   ```typescript
   this.player.on('error', (err: any) => {
     if (this.currentItem?.onError) {
       this.currentItem.onError(err);
     }
     this.handlePlaybackComplete();
   });
   ```
   *Empirical result (`ADV-AQM-3`)*: A player error triggered both `onError` and `onComplete` / `itemCompleted`.

4. **Emergency Queue Ordering Inversion (`src/audio/queue.ts:61`)**:
   ```typescript
   this.queue.unshift(emergencyItem);
   ```
   When multiple emergency alerts arrive while an emergency is already playing, `unshift` creates a LIFO stack.
   *Empirical result (`ADV-AQM-4`)*: Alert `E3` (arrived later) was placed before alert `E2` (arrived earlier).

5. **Unhandled Negative Duration in `generateSyntheticPcmTone` (`src/audio/tts.ts:12-13`)**:
   ```typescript
   const totalBytes = Math.floor(durationMs * bytesPerMs);
   const buffer = Buffer.alloc(totalBytes);
   ```
   *Empirical result (`ADV-TTS-3`)*: Throws unhandled `RangeError: The value of "size" is out of range` when passed negative duration.

6. **Components Verified Robust**:
   - `VoiceReceiver`: Boundary PCM buffers (0-byte, 1-byte, odd-length 3-byte), digital silence, low-amplitude hum, short 50ms click bursts, and duration boundaries (199ms vs 200ms) handled safely without crash.
   - `STTPipeline`: Propagates API errors; `MockSTTProvider` drained deterministically across concurrent calls.
   - `TTSPipeline`: LRU caching verified strictly capped at 100 entries; provider errors do not poison cache.

---

## 2. Logic Chain

1. **Preemption Invariant**: Requirement R1 and Project scope F08 mandate that `AudioPriority.EMERGENCY` preempts active playback without delay or corruption. Because `synthesizeSpeech` is asynchronous, preemption can occur between synthesis initiation and playback invocation. Lacking a cancellation check, the preempted task resumes and clobbers emergency audio.
2. **Error Semantics Invariant**: The contract between `AudioQueueManager` and consumers assumes `onComplete` denotes successful playback completion, while `onError` denotes failure. Invoking both on error corrupts coordinator state machines that wait for playback completion.
3. **Queue Fairness Invariant**: Messages with matching priority must be processed in chronological FIFO order (`createdAt` ascending). LIFO inversion on emergency alerts disrupts chronological emergency reporting.
4. **Conclusion Support**: These empirical findings show that `AudioQueueManager` requires specific bug fixes before proceeding.

---

## 3. Caveats

- Tests were run with mock voice sessions and synthetic PCM audio buffers; hardware Opus encoding/decoding and UDP network jitter on live Discord voice connections were not evaluated.
- Review-only constraint respected: no production code in `src/` was modified by this agent.

---

## 4. Conclusion

**Verdict: REQUEST_CHANGES**

`AudioQueueManager` must be updated with:
1. Cancellation guards for in-flight speech synthesis so preempted tasks cannot execute `player.playBuffer`.
2. Separation of error handling from completion handling so `onComplete` and `itemCompleted` are never fired on failure.
3. FIFO ordering preserved for multiple emergency alerts.
4. Defensive bounds checking in `generateSyntheticPcmTone`.

---

## 5. Verification Method

To independently reproduce all empirical findings:

1. **Run the Adversarial Test Suite**:
   ```powershell
   npx.cmd vitest run test/tier5_adversarial/audio_adversarial.test.ts
   ```
2. **Inspect Test Logic & Reports**:
   - Test specifications: `test/tier5_adversarial/audio_adversarial.test.ts`
   - Detailed Challenge Report: `.agents/teamwork/challenger_m1_1/challenge_report.md`
   - Invalidation condition: If `AudioQueueManager` is modified such that in-flight synthesis cancellation, error handling separation, and FIFO emergency ordering pass without clobbering, this finding is resolved.
