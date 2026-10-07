# Adversarial Challenge Report: Audio Queue, Voice Receiver & STT/TTS Subsystems

**Milestone**: Milestone 1  
**Target Subsystems**: Audio Priority Queue (`src/audio/queue.ts`), Voice Receiver (`src/audio/receiver.ts`), STT & TTS Pipelines (`src/audio/stt.ts`, `src/audio/tts.ts`)  
**Investigator**: `teamwork_preview_challenger` (`challenger_m1_1`)  
**Date**: 2026-10-07  
**Verdict**: **REQUEST_CHANGES**  

---

## Challenge Summary

**Overall risk assessment**: **CRITICAL**

While the core functionality of `VoiceReceiver`, `STTPipeline`, and `TTSPipeline` exhibits strong resilience against boundary inputs and concurrency, `AudioQueueManager` contains critical concurrency and state management flaws that directly compromise survival preemption integrity and error contract handling.

Specifically:
1. **Critical Concurrency Defect (Async Preemption Interleaving)**: In-flight speech synthesis of a preempted non-emergency item is not tracked or aborted. When synthesis resolves, the preempted item proceeds to play, interrupting and clobbering active emergency alerts.
2. **High Error Recovery Defect (False Completion Callbacks)**: When speech synthesis rejects or the audio player emits an error, `AudioQueueManager` calls `handlePlaybackComplete()`, which invokes `onComplete()` and emits `itemCompleted`, signaling successful playback of failed audio.
3. **Medium Queue Ordering Inversion (Emergency LIFO Reversal)**: Consecutive emergency items queued while another emergency item is playing use `unshift()`, reversing queue order into LIFO instead of FIFO.
4. **Low Boundary Defect (Unhandled Negative Duration)**: `generateSyntheticPcmTone` does not guard against non-positive durations, crashing with `RangeError` on negative inputs.

---

## Challenges

### [Critical] Challenge 1: Async Preemption Interleaving Clobbers Active Emergency Playback

- **Assumption challenged**: Preempted non-emergency audio items will yield execution immediately to `AudioPriority.EMERGENCY` items and will never play or interrupt the emergency alert.
- **Attack scenario**:
  1. A low/normal priority item `A` is enqueued and begins execution in `processNext()`.
  2. Because item `A` does not have a pre-synthesized buffer, it awaits `ttsPipeline.synthesizeSpeech(A.text)`.
  3. While `synthesizeSpeech` is awaiting (e.g. standard Gemini API / network delay of 50–500ms), a critical survival emergency alert `E` (e.g., low health warning or creeper hiss) is enqueued.
  4. `handleEmergencyPreemption()` executes: it sets `this.currentItem = null`, calls `this.player.stop(true)`, unshifts `E`, and starts playback of `E`.
  5. The promise for `A`'s `synthesizeSpeech` resolves. The execution continuation in `processNext()` resumes at line 110 of `src/audio/queue.ts`:
     ```typescript
     nextItem.audioBuffer = audioBuffer;
     this.emit('playingItem', nextItem);
     this.isProcessing = false;
     await this.player.playBuffer(audioBuffer);
     ```
  6. `processNext()` never verifies whether `nextItem` was preempted or whether `this.currentItem` has changed. It immediately calls `this.player.playBuffer(A.audioBuffer)`.
  7. `player.playBuffer` stops whatever is playing (the emergency alert `E`) and plays the normal chatter item `A` over it.
- **Blast Radius**: Critical in-game survival alerts are silenced and cut off. In dangerous situations (lava exposure, mob attack, imminent death), the bot will mute emergency warnings in favor of stale conversational replies.
- **Mitigation**:
  - Add an `aborted` or `preempted` cancellation token to each `TTSQueueItem`.
  - In `handleEmergencyPreemption()`, mark `preempted.aborted = true`.
  - In `processNext()`, after awaiting `ttsPipeline.synthesizeSpeech()`, verify `if (nextItem.aborted || this.currentItem !== nextItem) return;`.

---

### [High] Challenge 2: Error Handlers Falsely Trigger `onComplete` and `itemCompleted`

- **Assumption challenged**: An item whose synthesis or playback failed with an error will only trigger `onError`, and will never trigger `onComplete` or emit `itemCompleted`.
- **Attack scenario**:
  1. An item is enqueued whose synthesis fails (e.g., Gemini API rate limit 429, network timeout, or TTS synthesis error), or the underlying player encounters an audio pipeline error.
  2. In `src/audio/queue.ts` lines 120–124:
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
  3. `this.handlePlaybackComplete()` is called immediately:
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
  4. Because `this.currentItem` was set to `nextItem` before the try block and not cleared before calling `handlePlaybackComplete()`, `onComplete()` is called and `itemCompleted` is emitted.
  5. The same bug occurs on `player.on('error')` (lines 32–37).
- **Blast Radius**: Callers, coordinator subsystems, and user interaction loops awaiting voice completion will assume the message was delivered and heard by users in the voice channel, leading to desynchronization and missed critical communications.
- **Mitigation**:
  - In `catch` and `player.on('error')`, clear `this.currentItem = null` before invoking `this.processNext()`, or introduce a boolean flag `isError: boolean` so `handlePlaybackComplete` does not emit completion events for failed items.

---

### [Medium] Challenge 3: Emergency Item Chronological FIFO Ordering Inversion

- **Assumption challenged**: Multiple emergency items enqueued sequentially are played in chronological FIFO order (by `createdAt` ascending).
- **Attack scenario**:
  1. An emergency item `E1` is currently playing.
  2. While `E1` plays, emergency alert `E2` arrives at $t=20$ (e.g. "Taking damage from skeleton").
  3. Emergency alert `E3` arrives at $t=30$ (e.g. "Health critical: 2 hearts").
  4. In `handleEmergencyPreemption`:
     ```typescript
     this.queue.unshift(emergencyItem);
     ```
  5. Both `E2` and `E3` are prepended using `unshift()`, transforming the queue into `[E3, E2]`.
  6. When `E1` finishes, `E3` plays before `E2`.
- **Blast Radius**: Inverts chronological order of emergency events, reporting subsequent events prior to initial triggers.
- **Mitigation**:
  - Maintain emergency items in FIFO order. Use `insertSorted` even for emergency items, or insert after existing emergency items at the front of the queue.

---

### [Low] Challenge 4: Unhandled Negative Duration in `generateSyntheticPcmTone`

- **Assumption challenged**: Audio tone generation handles invalid duration arguments gracefully.
- **Attack scenario**:
  1. A caller invokes `generateSyntheticPcmTone(-100)` or negative speech duration.
  2. Line 13 executes `Buffer.alloc(totalBytes)` where `totalBytes = -19200`.
  3. Node.js throws an unhandled `RangeError: The value of "size" is out of range. It must be >= 0 && <= 9007199254740991. Received -19200`.
- **Blast Radius**: Unhandled exception crashes caller process if not wrapped in try-catch.
- **Mitigation**:
  - Guard `if (durationMs <= 0) return Buffer.alloc(0);` at the top of `generateSyntheticPcmTone`.

---

## Stress Test Results

Executed via automated test suite `test/tier5_adversarial/audio_adversarial.test.ts`:

| Test ID | Subsystem | Scenario | Expected Behavior | Actual Behavior | Result |
|---|---|---|---|---|---|
| `ADV-AQM-1` | `AudioQueueManager` | Slow synthesis interrupted by emergency item | Emergency item retains playback; preempted item aborted | Preempted item resumes on synthesis finish and overwrites emergency audio | **CONFIRMED BUG** |
| `ADV-AQM-2` | `AudioQueueManager` | TTS synthesis throws error | `onError` called; `onComplete` NOT called | Both `onError` AND `onComplete` / `itemCompleted` triggered | **CONFIRMED BUG** |
| `ADV-AQM-3` | `AudioQueueManager` | Player emits error mid-stream | `onError` called; `onComplete` NOT called | Both `onError` AND `onComplete` / `itemCompleted` triggered | **CONFIRMED BUG** |
| `ADV-AQM-4` | `AudioQueueManager` | Consecutive emergency items queued | Chronological FIFO playback order (`[E2, E3]`) | Queue inverted into LIFO (`[E3, E2]`) | **CONFIRMED BUG** |
| `ADV-AQM-5` | `AudioQueueManager` | Rapid cancellation & concurrency stress (100 items) | Queue flushes non-emergency items without corruption | Queue state remains stable; only emergency items remain | **PASS** |
| `ADV-AQM-6` | `AudioQueueManager` | Queue flooding (500 items across all priorities) | Monotonic priority ordering maintained | All 500 items ordered correctly by priority | **PASS** |
| `ADV-REC-1` | `VoiceReceiver` | Boundary packets (0-byte, 1-byte, 3-byte odd buffers) | Safe RMS calculation without NaN or crash; discarded | Processed safely, returns null, no crashes | **PASS** |
| `ADV-REC-2` | `VoiceReceiver` | Digital silence & low ambient hum | VAD RMS threshold rejects audio as noise | Discarded with `rms_below_threshold` | **PASS** |
| `ADV-REC-3` | `VoiceReceiver` | Ultra-short 50ms click burst (32k amplitude) | Duration filter rejects burst | Discarded with `duration_too_short` | **PASS** |
| `ADV-REC-4` | `VoiceReceiver` | Exact duration boundary (199ms vs 200ms) | 199ms discarded, 200ms emitted as utterance | 199ms rejected, 200ms emitted cleanly | **PASS** |
| `ADV-REC-5` | `VoiceReceiver` | Idempotent cleanup and double-detach | No unhandled exceptions; active sessions 0 | Graceful cleanup, sessions = 0 | **PASS** |
| `ADV-REC-6` | `VoiceReceiver` | Extreme 16-bit PCM samples (-32768, 32767) | Finite RMS without overflow | Finite RMS calculated accurately | **PASS** |
| `ADV-STT-1` | `STTPipeline` | Provider throws 429 rate limit error | Propagates error up the stack | Throws expected error | **PASS** |
| `ADV-STT-2` | `MockSTTProvider` | Concurrent async requests | Deterministic FIFO draining with fallback | Deterministic queue draining | **PASS** |
| `ADV-TTS-1` | `TTSPipeline` | LRU cache eviction at 100 entries | Oldest entry evicted, size capped at 100 | Exact LRU eviction observed | **PASS** |
| `ADV-TTS-2` | `TTSPipeline` | Provider failure recovery | Cache is not poisoned by failed synthesis | Failed item not cached; retry succeeds | **PASS** |
| `ADV-TTS-3` | `TTS Utility` | Boundary duration (-100ms) | Should return empty buffer | Throws `RangeError` (unhandled negative buffer allocation) | **DEFECT** |

---

## Unchallenged Areas

- **Native Opus Decoders (`node-opus` / `@discordjs/opus`)**: Tested with `prism-media` JavaScript decoder fallback. Hardware-specific C++ binary compilation was not exercised in this pure Node environment.
- **Discord Gateway Voice UDP Streaming**: Live voice channel socket streaming is tested using in-memory mock streams and synthetic audio chunks; live network packet jitter/drop over UDP was not simulated.

---

## Verdict & Recommendation

**Verdict**: **REQUEST_CHANGES**

The worker must address the following before Milestone 1 can be approved:
1. Fix async preemption interleaving in `AudioQueueManager.processNext()`: Ensure preempted items are cancelled and cannot invoke `player.playBuffer()` when their asynchronous synthesis completes.
2. Fix false completion reporting in `AudioQueueManager`: Ensure errors in speech synthesis or player playback do NOT invoke `onComplete` or emit `itemCompleted`.
3. Fix emergency FIFO ordering: Prevent `unshift()` from inverting chronological emergency alerts.
4. Guard `generateSyntheticPcmTone` against negative durations.
