# Handoff Report: Voice Channels & Audio Pipelines Investigation

**Author**: `explorer_m1_2`  
**Milestone**: Milestone 1 (Discord Core & Audio/Bridge Infrastructure)  
**Target Path**: `src/audio/` (`types.ts`, `receiver.ts`, `player.ts`, `queue.ts`, `stt.ts`, `tts.ts`)  
**Working Directory**: `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m1_2`  
**Date**: 2026-10-07  

---

## 1. Observation

1. **User Requirements (`ORIGINAL_REQUEST.md`)**:
   - Lines 14-15: "Voice Channels: Support two-way voice communication: capturing and transcribing user speech via an STT audio pipeline and replying with synthesized voice audio via a TTS pipeline."
   - Lines 52-53: "Voice receiver pipeline accurately ingests and buffers audio streams from users in a voice channel. Voice player pipeline generates and streams synthetic audio into the voice channel."
2. **Project Specification (`PROJECT.md`)**:
   - Lines 55-60: Features F03 (`Voice Connection & Session Manager`), F04 (`Voice Receiver & Speaking Tracker`), F05 (`Voice Audio Decoding & VAD`), F06 (`STT Audio Pipeline Interface`), F07 (`Voice Player & Audio Streaming`), and F08 (`Audio Priority Queue Manager`).
   - Lines 140-155: Canonical interface contracts:
     - `ISTTPipeline`: `transcribePcm(pcmBuffer: Buffer): Promise<string>`
     - `ITTSPipeline`: `synthesizeSpeech(text: string): Promise<Buffer>`
     - `IAudioQueueManager`: `enqueue(item: TTSQueueItem): void`, `cancelNonEmergency(): void`, `stopAll(): void`
   - Lines 223-229: Codebase directory layout:
     ```
     src/audio/
     ├── receiver.ts
     ├── player.ts
     ├── queue.ts
     ├── stt.ts
     ├── tts.ts
     └── types.ts
     ```
3. **Survey 1 Report (`spec_miner_survey_1/survey_report.md`)**:
   - Lines 38-46: Voice receiver and player functional specifications.
   - Lines 198-280: Voice Receiver Pipeline (STT) and Voice Player Pipeline (TTS) architecture:
     - Ingestion via `@discordjs/voice` `subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 500 } })`.
     - Opus decoding via `prism.opus.Decoder` to 48kHz 16-bit stereo PCM (`frameSize: 960, channels: 2, rate: 48000`).
     - Safety clamp of 15 seconds to prevent memory leaks from continuous transmission.
     - VAD noise rejection for audio $< 200$ms.
     - Priority audio queue with preemption for critical survival alerts.
4. **Survey 3 Report (`explorer_survey_3/survey_report.md`)**:
   - Lines 751-764: Node.js runtime and dependency manifest:
     - Runtime: Node.js `v24.21.0`, npm `11.19.0`.
     - Dependencies: `@discordjs/voice` (`^0.17.1`), `prism-media` (`^1.3.5`), `@discordjs/opus` (`^0.9.0`), `opusscript` (`^0.1.0`), `@google/genai` (`^2.3.0`).

---

## 2. Logic Chain

1. **Inbound Opus Ingestion and Utterance Framing**:
   - *Premise*: Discord delivers user voice streams as encrypted Opus packets over voice gateway UDP sockets.
   - *Inference*: The bot must subscribe per speaking user using `@discordjs/voice` Receiver.
   - *Reference*: Survey 1 lines 206-214. Using `EndBehaviorType.AfterSilence` with a duration of 500ms accurately delimits discrete utterances by emitting stream `'end'` when user pauses speech for half a second.

2. **Opus to PCM Decoding and Buffering**:
   - *Premise*: Downstream audio processing (RMS calculation, WAV generation, STT) operates on raw uncompressed PCM.
   - *Inference*: Chunks must be decoded to 48,000 Hz, 16-bit signed integer little-endian, 2 channels (stereo) via `prism.opus.Decoder`.
   - *Reference*: Survey 1 lines 218-238. Audio rate is 192 bytes/ms ($48000 \times 2 \times 2 / 1000$). Buffer growth is monitored; if an utterance exceeds 15 seconds ($2{,}880{,}000$ bytes), it is forcibly clamped to prevent memory exhaustion.

3. **Acoustic Noise Filtering via Duration and RMS VAD**:
   - *Premise*: Brief microphone clicks, coughs, or room ambient noise will waste LLM token quota and cause hallucinations if passed to STT.
   - *Inference*: A two-tier VAD filter is applied:
     1. Duration filter: Any utterance $< 200$ms is discarded.
     2. RMS amplitude filter: $RMS = \sqrt{\frac{1}{N} \sum x_i^2}$. If $RMS < 300$, the utterance is dropped as acoustic silence.
   - *Reference*: `plan.md` Section 3.2.

4. **Decoupled STT Pipeline**:
   - *Premise*: Automated CI testing must execute 100% offline with zero external API keys or network requests.
   - *Inference*: `STTPipeline` implements `ISTTPipeline` and delegates to an injected `ISTTProvider`. `MockSTTProvider` allows deterministic in-memory transcript returns and test scripting, while `GeminiSTTProvider` leverages the official `@google/genai` SDK with `gemini-3.8-flash` multimodal audio understanding.

5. **Decoupled TTS Pipeline**:
   - *Premise*: Synthesized bot voice responses must play in voice channels and be fully testable offline without third-party TTS accounts.
   - *Inference*: `TTSPipeline` implements `ITTSPipeline` with pluggable `ITTSProvider`. `MockTTSProvider` mathematically generates 48kHz stereo sine wave PCM tones ($440$ Hz tone), ensuring 100% offline testability. An LRU/SHA256 cache prevents redundant synthesis for common recurring status phrases.

6. **Voice Player and Priority Queue Manager**:
   - *Premise*: In-game survival events (e.g. creeper proximity, suffocation, health $< 6$) require immediate audible alerts that cannot wait behind low-priority conversational speech.
   - *Inference*: `AudioQueueManager` maintains a priority-sorted queue (`AudioPriority.EMERGENCY = 0`, `HIGH = 1`, `NORMAL = 2`, `LOW = 3`).
   - When an `EMERGENCY` item is enqueued, if the `VoicePlayer` is actively playing a lower-priority item, the player is halted immediately (`player.stop(true)`), and the emergency alert is streamed in $\le 50$ms.

---

## 3. Caveats

1. **Native Opus Binary Compilation**: `@discordjs/opus` compiles native C++ binaries which can fail on minimal containers without build tools. The architecture is explicitly designed so that `prism-media` falls back to pure JavaScript `opusscript`, and all automated test suites rely on in-memory streams and mock providers, guaranteeing cross-platform test reliability.
2. **Gemini Live Quota**: In live production, `GeminiSTTProvider` requires `GEMINI_API_KEY`. In all automated CI environments, `MockSTTProvider` is configured by default via dependency injection.
3. **Out of Scope**: Slash commands, RBAC, Discord client setup, and Chat Bridge are owned by peer agents `explorer_m1_1` and `explorer_m1_3`.

---

## 4. Conclusion

A comprehensive, production-ready, step-by-step implementation strategy for all 6 target files has been designed and written to:
`c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m1_2\plan.md`

The strategy provides complete code blueprints, algorithms, mathematical formulas (RMS VAD, WAV header synthesis, sine wave synthesis), and test specifications for:
1. `src/audio/types.ts`: Core data structures, enums (`AudioPriority`), and pipeline contracts (`ISTTPipeline`, `ITTSPipeline`, `IAudioQueueManager`).
2. `src/audio/receiver.ts`: Voice receiver attaching to `@discordjs/voice`, `AfterSilence` 500ms, `prism-media` Opus decoding, 15s clamp, RMS VAD, and WAV header generation.
3. `src/audio/player.ts`: Voice player wrapping `@discordjs/voice` `AudioPlayer`, AudioResource creation, playback state tracking, and 5s buffering stall watchdog.
4. `src/audio/queue.ts`: Priority queue manager with immediate emergency preemption and auto-playback progression.
5. `src/audio/stt.ts`: Decoupled STT pipeline with `MockSTTProvider` and `GeminiSTTProvider`.
6. `src/audio/tts.ts`: Decoupled TTS pipeline with `MockTTSProvider` (synthetic tone generation) and LRU cache.

---

## 5. Verification Method

To independently verify this strategy:
1. **Document Inspection**:
   - Inspect `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m1_2\plan.md` to confirm complete coverage of all 6 modules, data types, error handling mechanisms, and integration points.
2. **Post-Implementation Test Verification**:
   - Once builder agent implements the modules according to `plan.md`, run:
     ```powershell
     npx.cmd vitest run test/unit/audio/
     ```
   - Invalidation conditions: Any test failure in VAD filtering, priority queue preemption, or offline synthetic audio streaming.
