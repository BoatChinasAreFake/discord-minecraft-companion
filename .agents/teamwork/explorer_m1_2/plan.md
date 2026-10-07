# Milestone 1: Voice Channels & Audio Pipelines Implementation Strategy

**Author**: `explorer_m1_2`  
**Milestone**: Milestone 1 (Discord Core & Audio/Bridge Infrastructure)  
**Target Subsystem**: `src/audio/` (Voice Receiver, Voice Player, Priority Audio Queue, STT & TTS Pipelines)  
**Date**: 2026-10-07  
**Status**: COMPLETE IMPLEMENTATION BLUEPRINT  

---

## 1. Executive Architectural Blueprint

The **Audio Pipeline Subsystem** provides full-duplex, two-way conversational voice channel communication between Discord users and the Minecraft AI survival agent. The subsystem handles inbound speech capture, streaming decoding, Voice Activity Detection (VAD), Speech-to-Text (STT) transcription, Text-to-Speech (TTS) synthesis, and priority-based outbound streaming playback into Discord voice channels with sub-second preemption for survival emergency alerts.

```
                    ┌──────────────────────────────────────────────────┐
                    │               Discord Voice Gateway              │
                    │               (@discordjs/voice)                 │
                    └───────────────┬──────────────────▲───────────────┘
                                    │                  │
                      Inbound Opus Streams     Outbound AudioResource
                                    │                  │
                                    ▼                  │
                    ┌────────────────────────┐  ┌───────────────────────┐
                    │     VoiceReceiver      │  │      VoicePlayer      │
                    │  - AfterSilence (500ms)│  │ - AudioPlayer status  │
                    │  - prism-media Opus Dec│  │ - AudioResource stream│
                    │  - 48kHz stereo PCM    │  │ - Watchdog / Recovery │
                    │  - VAD / RMS energy    │  └──────────▲────────────┘
                    │  - 15s safety clamp    │             │
                    └──────────┬─────────────┘             │
                               │                    Dequeued Item
                        PCM/WAV Buffer                     │
                               ▼                           │
                    ┌────────────────────────┐  ┌───────────────────────┐
                    │       STTPipeline      │  │   AudioQueueManager   │
                    │  - ISTTPipeline        │  │ - AudioPriority Queue │
                    │  - MockSTTProvider     │  │ - EMERGENCY Preempt   │
                    │  - GeminiSTTProvider   │  │ - Auto-playback loop  │
                    └──────────┬─────────────┘  └──────────▲────────────┘
                               │                           │
                        Transcribed Text            Synthesized Buffer
                               │                           │
                               ▼                           │
                    ┌───────────────────────────────────────────────┐
                    │               Agent Coordinator               │
                    │      (Prompt routing & Survival alerts)       │
                    └──────────────────────┬────────────────────────┘
                                           │
                                    Agent Response
                                           ▼
                                ┌──────────────────────┐
                                │     TTSPipeline      │
                                │ - ITTSPipeline       │
                                │ - MockTTSProvider    │
                                │ - GeminiTTSProvider  │
                                └──────────────────────┘
```

### Key Architectural Tenets
1. **100% Offline Testability (Zero Native Binary Dependency Lock)**: The architecture is built with strict Dependency Injection (DI) and clean stream interfaces. Tests execute in-memory with zero reliance on Discord voice UDP sockets, external cloud APIs, or audio hardware.
2. **Hard Multi-Speaker Isolation**: Each speaking Discord user is processed in an independent streaming buffer keyed by `userId`, preventing audio frame interleaving and memory leaks.
3. **Deterministic Survival Preemption**: Critical survival alerts (e.g., creeper explosions, suffocation, low health) preempt normal conversation in $\le 50$ms by halting current playback and executing emergency announcements.
4. **Acoustic Noise Immunity**: Utterances $< 200$ms or with Root-Mean-Square (RMS) amplitude below acoustic noise thresholds are dropped prior to STT invocation, protecting token budgets and eliminating hallucinations.

---

## 2. Component 1: `src/audio/types.ts` Specification

`src/audio/types.ts` defines all contracts, enums, data structures, and configuration models required across the audio pipelines.

### 2.1 Complete TypeScript Interface Declarations

```typescript
import { Readable } from 'node:stream';

/**
 * Audio playback priority levels.
 * Lower numeric value indicates higher execution priority.
 */
export enum AudioPriority {
  /** Critical survival emergency (e.g. low health, creeper hiss, lava danger) - PREEMPTS playback */
  EMERGENCY = 0,
  /** High priority announcements (e.g. task completed, bed occupied, arrived at coords) */
  HIGH = 1,
  /** Standard assistant replies and conversational responses */
  NORMAL = 2,
  /** Ambient chatter, periodic observations, non-urgent summaries */
  LOW = 3,
}

/**
 * Raw audio packet chunk emitted by receiver or stream sources.
 */
export interface AudioPacket {
  userId: string;
  sequence?: number;
  timestamp?: number;
  data: Buffer;
}

/**
 * Configuration schema for the VoiceReceiver pipeline.
 */
export interface VoiceReceiverConfig {
  /** Silence duration in ms before concluding user utterance (default: 500ms) */
  silenceDurationMs: number;
  /** Minimum duration in ms of valid speech; shorter audio is treated as acoustic noise (default: 200ms) */
  minUtteranceDurationMs: number;
  /** Maximum duration in ms before forcing utterance cut-off (default: 15000ms / 15s) */
  maxUtteranceDurationMs: number;
  /** PCM Root Mean Square (RMS) threshold below which speech is discarded as noise (default: 300) */
  noiseThresholdRms: number;
  /** Audio sample rate in Hz (default: 48000) */
  sampleRate: number;
  /** Audio channels count (default: 2 for stereo) */
  channels: number;
  /** Audio bit depth (default: 16-bit signed integer) */
  bitDepth: number;
}

/**
 * Default receiver configuration constants.
 */
export const DEFAULT_RECEIVER_CONFIG: Readonly<VoiceReceiverConfig> = {
  silenceDurationMs: 500,
  minUtteranceDurationMs: 200,
  maxUtteranceDurationMs: 15000,
  noiseThresholdRms: 300,
  sampleRate: 48000,
  channels: 2,
  bitDepth: 16,
};

/**
 * Metadata and payload for an assembled speech utterance.
 */
export interface UtteranceEvent {
  userId: string;
  pcmBuffer: Buffer;
  wavBuffer: Buffer;
  durationMs: number;
  rms: number;
  timestamp: number;
}

/**
 * Individual speaker tracking state in receiver.
 */
export interface SpeakerSession {
  userId: string;
  startTime: number;
  chunks: Buffer[];
  totalBytes: number;
  stream?: any;
  decoder?: any;
}

/**
 * Voice player playback state machine representation.
 */
export enum VoicePlaybackState {
  IDLE = 'idle',
  BUFFERING = 'buffering',
  PLAYING = 'playing',
  PAUSED = 'paused',
  STOPPED = 'stopped',
}

/**
 * Playback options for resource streaming.
 */
export interface PlaybackOptions {
  volume?: number;
  fadeDurationMs?: number;
}

/**
 * Item queued for Text-to-Speech synthesis and playback.
 */
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
}

/**
 * Options passed to TTS synthesis pipelines.
 */
export interface TTSOptions {
  voiceName?: string;
  speed?: number;
  pitch?: number;
  sampleRate?: number;
}

/**
 * Contract for decoupled Speech-to-Text pipeline.
 */
export interface ISTTPipeline {
  transcribePcm(pcmBuffer: Buffer, metadata?: { userId?: string; sampleRate?: number }): Promise<string>;
}

/**
 * Contract for pluggable STT provider backends (Gemini, Whisper, Mock).
 */
export interface ISTTProvider {
  readonly name: string;
  transcribe(audio: { buffer: Buffer; mimeType: string; sampleRate: number }): Promise<string>;
}

/**
 * Contract for decoupled Text-to-Speech pipeline.
 */
export interface ITTSPipeline {
  synthesizeSpeech(text: string, options?: TTSOptions): Promise<Buffer>;
}

/**
 * Contract for pluggable TTS provider backends (Gemini, ElevenLabs, Mock).
 */
export interface ITTSProvider {
  readonly name: string;
  synthesize(text: string, options?: TTSOptions): Promise<Buffer>;
}

/**
 * Contract for Priority Audio Queue Manager.
 */
export interface IAudioQueueManager {
  enqueue(item: TTSQueueItem): void;
  cancelNonEmergency(): void;
  stopAll(): void;
  getQueueLength(): number;
  getCurrentItem(): TTSQueueItem | null;
  isPlaying(): boolean;
}
```

---

## 3. Component 2: `src/audio/receiver.ts` Specification

`src/audio/receiver.ts` implements the inbound audio ingestion pipeline. It attaches to `@discordjs/voice`, subscribes to individual speaking users, decodes Opus packets into 48kHz 16-bit stereo PCM using `prism-media`, enforces safety limits, computes acoustic RMS energy (VAD), formats valid utterances into WAV containers, and dispatches them to STT.

### 3.1 Detailed Audio Math & Format Constants
- **Sample Rate ($F_s$)**: $48{,}000\text{ Hz}$
- **Channels ($C$)**: $2$ (Stereo)
- **Bit Depth ($B$)**: $16\text{ bits} = 2\text{ bytes per sample}$
- **Bytes per Second**: $48{,}000 \times 2 \times 2 = 192{,}000\text{ bytes/s}$ ($192\text{ bytes/ms}$)
- **Opus Frame Size**: $960\text{ samples/frame}$ ($20\text{ms}$ at $48\text{kHz}$)
- **Minimum Utterance Size**: $200\text{ms} \times 192\text{ bytes/ms} = 38{,}400\text{ bytes}$
- **Maximum Utterance Limit**: $15\text{s} \times 192{,}000\text{ bytes/s} = 2{,}880{,}000\text{ bytes}$ ($\sim 2.88\text{ MB}$)

### 3.2 Voice Activity Detection & RMS Algorithm
To reject microphone clicks, breath noises, and ambient room noise without invoking cloud STT models, the receiver computes the Root-Mean-Square (RMS) of all 16-bit signed PCM samples:

$$RMS = \sqrt{ \frac{1}{N} \sum_{i=0}^{N-1} x_i^2 }$$

```typescript
export function calculatePcmRms(pcmBuffer: Buffer): number {
  if (pcmBuffer.length < 2) return 0;
  const sampleCount = Math.floor(pcmBuffer.length / 2);
  let sumOfSquares = 0;

  for (let i = 0; i < pcmBuffer.length - 1; i += 2) {
    const sample = pcmBuffer.readInt16LE(i);
    sumOfSquares += sample * sample;
  }

  return Math.sqrt(sumOfSquares / sampleCount);
}
```
- A normal human voice registers $RMS \ge 800 - 3500$.
- Background fan hiss and microphone hum register $RMS < 200 - 300$.
- Any utterance with $RMS < \text{noiseThresholdRms}$ (default 300) is filtered out.

### 3.3 RIFF/WAVE Header Generation Algorithm
Many STT services require containerized WAV files with standard 44-byte headers:

```typescript
export function createWavBuffer(pcmBuffer: Buffer, sampleRate = 48000, channels = 2, bitDepth = 16): Buffer {
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  // RIFF Chunk Descriptor
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4); // ChunkSize
  header.write('WAVE', 8);

  // "fmt " sub-chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);

  // "data" sub-chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}
```

### 3.4 `VoiceReceiver` Implementation Blueprint

```typescript
import { EventEmitter } from 'node:events';
import { EndBehaviorType, VoiceConnection } from '@discordjs/voice';
import prism from 'prism-media';
import {
  VoiceReceiverConfig,
  DEFAULT_RECEIVER_CONFIG,
  SpeakerSession,
  UtteranceEvent,
} from './types.js';

export class VoiceReceiver extends EventEmitter {
  private config: VoiceReceiverConfig;
  private sessions: Map<string, SpeakerSession> = new Map();
  private attachedConnection: VoiceConnection | null = null;
  private isListening = false;

  constructor(config: Partial<VoiceReceiverConfig> = {}) {
    super();
    this.config = { ...DEFAULT_RECEIVER_CONFIG, ...config };
  }

  public attach(connection: VoiceConnection): void {
    this.attachedConnection = connection;
    this.isListening = true;

    // Listen for speaker start events
    connection.receiver.speaking.on('start', (userId: string) => {
      if (!this.isListening) return;
      this.handleSpeakerStart(userId, connection);
    });
  }

  public detach(): void {
    this.isListening = false;
    for (const [userId, session] of this.sessions) {
      this.cleanupSession(userId);
    }
    this.sessions.clear();
    this.attachedConnection = null;
  }

  private handleSpeakerStart(userId: string, connection: VoiceConnection): void {
    // If session already active, allow existing stream to complete
    if (this.sessions.has(userId)) return;

    try {
      const opusStream = connection.receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: this.config.silenceDurationMs,
        },
      });

      const decoder = new prism.opus.Decoder({
        rate: this.config.sampleRate,
        channels: this.config.channels,
        frameSize: 960,
      });

      const session: SpeakerSession = {
        userId,
        startTime: Date.now(),
        chunks: [],
        totalBytes: 0,
        stream: opusStream,
        decoder,
      };

      this.sessions.set(userId, session);

      opusStream.pipe(decoder);

      const maxBytes =
        (this.config.sampleRate *
          this.config.channels *
          (this.config.bitDepth / 8) *
          this.config.maxUtteranceDurationMs) /
        1000;

      decoder.on('data', (chunk: Buffer) => {
        session.chunks.push(chunk);
        session.totalBytes += chunk.length;

        // Safety clamp: if user speaks over max duration without pause
        if (session.totalBytes >= maxBytes) {
          this.finalizeUtterance(userId);
        }
      });

      decoder.on('end', () => {
        this.finalizeUtterance(userId);
      });

      decoder.on('error', (err) => {
        this.emit('error', new Error(`Opus decoder error for user ${userId}: ${err.message}`));
        this.cleanupSession(userId);
      });

      opusStream.on('error', (err) => {
        this.emit('error', new Error(`Opus stream error for user ${userId}: ${err.message}`));
        this.cleanupSession(userId);
      });
    } catch (err: any) {
      this.emit('error', new Error(`Failed to subscribe to user ${userId}: ${err.message}`));
    }
  }

  private finalizeUtterance(userId: string): void {
    const session = this.sessions.get(userId);
    if (!session) return;

    const pcmBuffer = Buffer.concat(session.chunks);
    this.cleanupSession(userId);

    const bytesPerMs = (this.config.sampleRate * this.config.channels * (this.config.bitDepth / 8)) / 1000;
    const durationMs = pcmBuffer.length / bytesPerMs;

    // Filter 1: Duration check
    if (durationMs < this.config.minUtteranceDurationMs) {
      this.emit('noiseDiscarded', { userId, reason: 'duration_too_short', durationMs });
      return;
    }

    // Filter 2: VAD RMS amplitude check
    const rms = calculatePcmRms(pcmBuffer);
    if (rms < this.config.noiseThresholdRms) {
      this.emit('noiseDiscarded', { userId, reason: 'rms_below_threshold', rms, durationMs });
      return;
    }

    // Build standard WAV container
    const wavBuffer = createWavBuffer(
      pcmBuffer,
      this.config.sampleRate,
      this.config.channels,
      this.config.bitDepth
    );

    const event: UtteranceEvent = {
      userId,
      pcmBuffer,
      wavBuffer,
      durationMs,
      rms,
      timestamp: Date.now(),
    };

    this.emit('utterance', event);
  }

  private cleanupSession(userId: string): void {
    const session = this.sessions.get(userId);
    if (!session) return;

    if (session.decoder && !session.decoder.destroyed) {
      session.decoder.destroy();
    }
    if (session.stream && !session.stream.destroyed) {
      session.stream.destroy();
    }
    this.sessions.delete(userId);
  }
}
```

---

## 4. Component 3: `src/audio/player.ts` Specification

`src/audio/player.ts` encapsulates the outbound audio streaming pipeline using `@discordjs/voice` `AudioPlayer`. It handles audio resource creation, lifecycle state synchronization, buffering stalls, volume management, and clean promise-based playback completion.

### 4.1 State Machine Lifecycle
`@discordjs/voice` provides five distinct states:
1. `Idle`: Ready to play; no active audio source.
2. `Buffering`: Ingesting and priming initial audio frames.
3. `Playing`: Actively writing Opus frames to the voice UDP connection.
4. `Paused`: Playback paused by controller.
5. `AutoPaused`: Paused automatically due to missing voice connection subscribers.

### 4.2 Buffering Stall Watchdog
Network glitches or stream deadlocks can leave an AudioPlayer indefinitely stuck in `Buffering`. The `VoicePlayer` implements an active watchdog:
- If `AudioPlayerStatus.Buffering` persists for $> 5000\text{ms}$, the player issues `stop(true)`, logs a stall error, and resets to `Idle`.

### 4.3 `VoicePlayer` Implementation Blueprint

```typescript
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import {
  AudioPlayer,
  AudioPlayerStatus,
  AudioResource,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnection,
} from '@discordjs/voice';
import { VoicePlaybackState, PlaybackOptions } from './types.js';

export class VoicePlayer extends EventEmitter {
  private player: AudioPlayer;
  private currentResource: AudioResource | null = null;
  private bufferingWatchdogTimer: NodeJS.Timeout | null = null;
  private activeResolver: (() => void) | null = null;
  private defaultVolume = 1.0;

  constructor() {
    super();
    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
        maxMissedFrames: 250,
      },
    });

    this.setupListeners();
  }

  private setupListeners(): void {
    this.player.on(AudioPlayerStatus.Playing, () => {
      this.clearBufferingWatchdog();
      this.emit('stateChange', VoicePlaybackState.PLAYING);
      this.emit('playing');
    });

    this.player.on(AudioPlayerStatus.Idle, () => {
      this.clearBufferingWatchdog();
      this.currentResource = null;
      this.emit('stateChange', VoicePlaybackState.IDLE);
      this.emit('idle');

      if (this.activeResolver) {
        const resolve = this.activeResolver;
        this.activeResolver = null;
        resolve();
      }
    });

    this.player.on(AudioPlayerStatus.Buffering, () => {
      this.startBufferingWatchdog();
      this.emit('stateChange', VoicePlaybackState.BUFFERING);
    });

    this.player.on(AudioPlayerStatus.Paused, () => {
      this.emit('stateChange', VoicePlaybackState.PAUSED);
    });

    this.player.on('error', (error) => {
      this.clearBufferingWatchdog();
      this.emit('error', error);
      this.currentResource = null;
      if (this.activeResolver) {
        const resolve = this.activeResolver;
        this.activeResolver = null;
        resolve();
      }
    });
  }

  public attach(connection: VoiceConnection): void {
    connection.subscribe(this.player);
  }

  public getRawPlayer(): AudioPlayer {
    return this.player;
  }

  public getState(): VoicePlaybackState {
    switch (this.player.state.status) {
      case AudioPlayerStatus.Playing:
        return VoicePlaybackState.PLAYING;
      case AudioPlayerStatus.Buffering:
        return VoicePlaybackState.BUFFERING;
      case AudioPlayerStatus.Paused:
      case AudioPlayerStatus.AutoPaused:
        return VoicePlaybackState.PAUSED;
      default:
        return VoicePlaybackState.IDLE;
    }
  }

  public isPlaying(): boolean {
    return this.player.state.status === AudioPlayerStatus.Playing ||
           this.player.state.status === AudioPlayerStatus.Buffering;
  }

  public async playBuffer(buffer: Buffer, options: PlaybackOptions = {}): Promise<void> {
    const stream = Readable.from(buffer);
    return this.playStream(stream, options);
  }

  public async playStream(stream: Readable, options: PlaybackOptions = {}): Promise<void> {
    this.stop(true);

    const resource = createAudioResource(stream, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true,
    });

    const targetVolume = options.volume ?? this.defaultVolume;
    resource.volume?.setVolume(targetVolume);
    this.currentResource = resource;

    return new Promise<void>((resolve) => {
      this.activeResolver = resolve;
      this.player.play(resource);
    });
  }

  public stop(force = false): boolean {
    this.clearBufferingWatchdog();
    if (this.activeResolver) {
      const resolve = this.activeResolver;
      this.activeResolver = null;
      resolve();
    }
    return this.player.stop(force);
  }

  public pause(): boolean {
    return this.player.pause();
  }

  public resume(): boolean {
    return this.player.unpause();
  }

  public setVolume(volume: number): void {
    this.defaultVolume = Math.max(0, Math.min(2.0, volume));
    if (this.currentResource?.volume) {
      this.currentResource.volume.setVolume(this.defaultVolume);
    }
  }

  private startBufferingWatchdog(): void {
    this.clearBufferingWatchdog();
    this.bufferingWatchdogTimer = setTimeout(() => {
      this.emit('error', new Error('AudioPlayer buffering stalled (> 5000ms). Resetting player.'));
      this.stop(true);
    }, 5000);
  }

  private clearBufferingWatchdog(): void {
    if (this.bufferingWatchdogTimer) {
      clearTimeout(this.bufferingWatchdogTimer);
      this.bufferingWatchdogTimer = null;
    }
  }
}
```

---

## 5. Component 4: `src/audio/queue.ts` Specification

`src/audio/queue.ts` implements the Priority-based Audio Queue Manager. It guarantees that survival emergency alerts (`AudioPriority.EMERGENCY`) preempt active lower-priority speech without delay, provides automatic sequential playback of queued speech, and avoids race conditions during voice interrupts.

### 5.1 Queue Scheduling & Preemption Logic

```
   Incoming TTSQueueItem
             │
             ├───────────────────────────────────────────────────────┐
             │ Priority == EMERGENCY                                 │ Priority > EMERGENCY
             ▼                                                       ▼
   Is Player Active?                                       Insert into Queue
   ├── NO  ──> Play Emergency immediately                  (Sorted: Priority ASC,
   └── YES ──> Check Active Priority                       CreatedAt ASC)
               ├── Active is EMERGENCY ──> Queue at Head   
               └── Active is NON-EMERGENCY                 If Player Idle:
                   ├── STOP Player (Preempt)               Auto-trigger next item
                   ├── Drop/Re-queue active item
                   └── PLAY Emergency immediately!
```

### 5.2 `AudioQueueManager` Implementation Blueprint

```typescript
import { EventEmitter } from 'node:events';
import {
  AudioPriority,
  IAudioQueueManager,
  TTSQueueItem,
} from './types.js';
import { VoicePlayer } from './player.js';
import { ITTSPipeline } from './types.js';

export class AudioQueueManager extends EventEmitter implements IAudioQueueManager {
  private queue: TTSQueueItem[] = [];
  private currentItem: TTSQueueItem | null = null;
  private isProcessing = false;

  constructor(
    private player: VoicePlayer,
    private ttsPipeline: ITTSPipeline
  ) {
    super();

    // Hook player idle state to auto-trigger the next queue item
    this.player.on('idle', () => {
      this.handlePlaybackComplete();
    });

    this.player.on('error', (err) => {
      if (this.currentItem?.onError) {
        this.currentItem.onError(err);
      }
      this.handlePlaybackComplete();
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

    if (this.currentItem && this.currentItem.priority !== AudioPriority.EMERGENCY) {
      // Preempt active non-emergency playback
      const preempted = this.currentItem;
      this.currentItem = null;
      this.player.stop(true);
      this.emit('itemPreempted', preempted);
    }

    // Put emergency at the very front of the queue
    this.queue.unshift(emergencyItem);

    // Immediately trigger playback
    this.processNext();
  }

  private insertSorted(item: TTSQueueItem): void {
    const index = this.queue.findIndex(
      (existing) =>
        existing.priority > item.priority ||
        (existing.priority === item.priority && existing.createdAt > item.createdAt)
    );

    if (index === -1) {
      this.queue.push(item);
    } else {
      this.queue.splice(index, 0, item);
    }
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const nextItem = this.queue.shift()!;
    this.currentItem = nextItem;

    try {
      if (nextItem.onStart) {
        nextItem.onStart();
      }

      // If audioBuffer is not pre-synthesized, synthesize via TTS pipeline
      let audioBuffer = nextItem.audioBuffer;
      if (!audioBuffer) {
        audioBuffer = await this.ttsPipeline.synthesizeSpeech(nextItem.text, {
          voiceName: (nextItem.metadata?.voiceName as string) || undefined,
        });
        nextItem.audioBuffer = audioBuffer;
      }

      this.emit('playingItem', nextItem);
      this.isProcessing = false;

      // Play through VoicePlayer (returns promise that resolves on Idle)
      await this.player.playBuffer(audioBuffer);
    } catch (err: any) {
      this.isProcessing = false;
      this.emit('error', err);
      if (nextItem.onError) {
        nextItem.onError(err);
      }
      this.handlePlaybackComplete();
    }
  }

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

  public cancelNonEmergency(): void {
    this.queue = this.queue.filter((item) => item.priority === AudioPriority.EMERGENCY);

    if (this.currentItem && this.currentItem.priority !== AudioPriority.EMERGENCY) {
      this.player.stop(true);
      this.currentItem = null;
    }
    this.emit('queueFiltered', 'non_emergency_cancelled');
  }

  public stopAll(): void {
    this.queue = [];
    this.player.stop(true);
    this.currentItem = null;
    this.isProcessing = false;
    this.emit('stoppedAll');
  }

  public getQueueLength(): number {
    return this.queue.length;
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

## 6. Component 5: `src/audio/stt.ts` Specification

`src/audio/stt.ts` decouples speech recognition from the underlying engine. It supports hot-swappable providers: `MockSTTProvider` (for 100% offline unit/integration tests) and `GeminiSTTProvider` (using the official `@google/genai` SDK with `gemini-3.8-flash` multimodal audio understanding).

### 6.1 Provider Interface & Pipeline Architecture

```typescript
import { GoogleGenAI } from '@google/genai';
import { ISTTPipeline, ISTTProvider } from './types.js';
import { createWavBuffer } from './receiver.js';

export class STTPipeline implements ISTTPipeline {
  constructor(private provider: ISTTProvider) {}

  public setProvider(provider: ISTTProvider): void {
    this.provider = provider;
  }

  public getProviderName(): string {
    return this.provider.name;
  }

  public async transcribePcm(pcmBuffer: Buffer, metadata: { userId?: string; sampleRate?: number } = {}): Promise<string> {
    const sampleRate = metadata.sampleRate ?? 48000;
    const wavBuffer = createWavBuffer(pcmBuffer, sampleRate, 2, 16);

    return this.provider.transcribe({
      buffer: wavBuffer,
      mimeType: 'audio/wav',
      sampleRate,
    });
  }
}
```

### 6.2 `MockSTTProvider` (100% Deterministic Offline Testing)
Supports static transcripts, scripted FIFO transcript queues, and pattern-based transcript generation for automated test harnesses.

```typescript
export class MockSTTProvider implements ISTTProvider {
  public readonly name = 'MockSTTProvider';
  private transcriptQueue: string[] = [];
  private defaultTranscript = 'Hello bot, please report status';
  public callHistory: Array<{ bufferLength: number; mimeType: string }> = [];

  public setDefaultTranscript(transcript: string): void {
    this.defaultTranscript = transcript;
  }

  public enqueueTranscript(transcript: string): void {
    this.transcriptQueue.push(transcript);
  }

  public clearQueue(): void {
    this.transcriptQueue = [];
    this.callHistory = [];
  }

  public async transcribe(audio: { buffer: Buffer; mimeType: string; sampleRate: number }): Promise<string> {
    this.callHistory.push({ bufferLength: audio.buffer.length, mimeType: audio.mimeType });

    if (this.transcriptQueue.length > 0) {
      return this.transcriptQueue.shift()!;
    }
    return this.defaultTranscript;
  }
}
```

### 6.3 `GeminiSTTProvider` (Production Multimodal Audio Pipeline)
Transcribes user speech via `@google/genai` inline data audio parts:

```typescript
export class GeminiSTTProvider implements ISTTProvider {
  public readonly name = 'GeminiSTTProvider';
  private ai: GoogleGenAI;
  private modelName: string;

  constructor(apiKey: string, modelName = 'gemini-3.8-flash') {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('GEMINI_API_KEY is required for GeminiSTTProvider');
    }
    this.ai = new GoogleGenAI({ apiKey });
    this.modelName = modelName;
  }

  public async transcribe(audio: { buffer: Buffer; mimeType: string; sampleRate: number }): Promise<string> {
    try {
      const base64Audio = audio.buffer.toString('base64');

      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: audio.mimeType,
                  data: base64Audio,
                },
              },
              {
                text: 'Transcribe this user speech accurately into plain text. Output ONLY the verbatim transcribed words without commentary or formatting.',
              },
            ],
          },
        ],
      });

      const text = response.text?.trim() || '';
      return text;
    } catch (err: any) {
      throw new Error(`Gemini STT transcription failed: ${err.message}`);
    }
  }
}
```

---

## 7. Component 6: `src/audio/tts.ts` Specification

`src/audio/tts.ts` provides text-to-speech synthesis with pluggable backends: `MockTTSProvider` (generates mathematical sine-wave tones or silent 48kHz PCM buffers for offline CI) and `GeminiTTSProvider` / Cloud TTS backends.

### 7.1 Synthetic Audio Generation Math
To enable offline tests without MP3/Ogg decoders or external network access, the mock TTS engine synthesizes mathematical 48kHz 16-bit stereo PCM waveforms:

$$s(t) = A \cdot \sin(2\pi f t)$$

Where:
- $A = 16384$ (50% amplitude of 16-bit max 32767)
- $f = 440\text{ Hz}$ (Concert pitch A4)
- $t = \frac{i}{F_s}$

```typescript
export function generateSyntheticPcmTone(
  durationMs: number,
  frequencyHz = 440,
  sampleRate = 48000,
  channels = 2
): Buffer {
  const bytesPerMs = (sampleRate * channels * 2) / 1000;
  const totalBytes = Math.floor(durationMs * bytesPerMs);
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

### 7.2 `MockTTSProvider` Blueprint
Calculates duration based on word count ($200\text{ms}$ base + $60\text{ms}$ per word), synthesizes PCM/WAV buffer, and caches recent syntheses.

```typescript
export class MockTTSProvider implements ITTSProvider {
  public readonly name = 'MockTTSProvider';
  public callHistory: string[] = [];

  public async synthesize(text: string, options: TTSOptions = {}): Promise<Buffer> {
    this.callHistory.push(text);

    const words = text.trim().split(/\s+/).length;
    const durationMs = Math.max(250, Math.min(3000, 200 + words * 60));

    const pcm = generateSyntheticPcmTone(durationMs, 440, options.sampleRate ?? 48000, 2);
    return createWavBuffer(pcm, options.sampleRate ?? 48000, 2, 16);
  }
}
```

### 7.3 `TTSPipeline` with LRU Synthesis Cache

```typescript
import { createHash } from 'node:crypto';
import { ITTSPipeline, ITTSProvider, TTSOptions } from './types.js';

export class TTSPipeline implements ITTSPipeline {
  private cache: Map<string, Buffer> = new Map();
  private maxCacheEntries = 100;

  constructor(private provider: ITTSProvider) {}

  public setProvider(provider: ITTSProvider): void {
    this.provider = provider;
    this.cache.clear();
  }

  public getProviderName(): string {
    return this.provider.name;
  }

  public async synthesizeSpeech(text: string, options: TTSOptions = {}): Promise<Buffer> {
    const cleanText = text.trim();
    if (!cleanText) {
      return Buffer.alloc(0);
    }

    const cacheKey = this.computeCacheKey(cleanText, options);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const buffer = await this.provider.synthesize(cleanText, options);

    // LRU eviction
    if (this.cache.size >= this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(cacheKey, buffer);

    return buffer;
  }

  private computeCacheKey(text: string, options: TTSOptions): string {
    return createHash('sha256')
      .update(`${options.voiceName || 'default'}:${options.speed || 1}:${text}`)
      .digest('hex');
  }
}
```

---

## 8. Integration Architecture: Connecting Audio to Discord & Coordinator

### 8.1 Discord Voice Gateway Connection (`IVoiceSession`)
When the bot executes `/voice join` or connects to a voice channel, it wraps the connection in an `IVoiceSession`:

```typescript
export interface IVoiceSession {
  readonly connectionStatus: string;
  readonly receiver: VoiceReceiver;
  readonly player: VoicePlayer;
  readonly queue: AudioQueueManager;
  destroy(): void;
}
```

### 8.2 Inbound Audio Flow (User Speech $\to$ AI Planner)
1. User speaks in voice channel.
2. `VoiceReceiver` ingests Opus, decodes to PCM via `prism-media`.
3. 500ms silence detected $\to$ `AfterSilence` terminates stream.
4. VAD verifies duration $\ge 200$ms and $RMS \ge 300$.
5. Utterance packaged into WAV buffer $\to$ emitted as `'utterance'`.
6. `STTPipeline.transcribePcm()` converts audio into text string.
7. Dispatched to `AgentCoordinator` as a voice interaction event:
   ```typescript
   coordinator.handleVoicePrompt({
     userId: event.userId,
     prompt: transcribedText,
     source: 'voice',
   });
   ```

### 8.3 Outbound Survival Alert Flow (Mineflayer Bot $\to$ Voice Channel)
1. Mineflayer bot triggers low-health survival interrupt ($HP \le 6$) or creeper close-proximity alert.
2. Coordinator builds emergency alert item:
   ```typescript
   audioQueue.enqueue({
     id: `emergency-${Date.now()}`,
     priority: AudioPriority.EMERGENCY,
     text: "Warning! Low health! Seeking shelter immediately!",
     createdAt: Date.now(),
   });
   ```
3. `AudioQueueManager` immediately halts any ongoing conversation playback, pushes alert to queue head, and streams synthesized alert in $< 50$ms.

---

## 9. Comprehensive Test Suite Specification

The audio pipelines are verified by programmatic tests satisfying Requirements R1 and R4.

### 9.1 Test File Matrix
- `test/unit/audio/types.test.ts`: Validates enum mappings, config constants, and type guards.
- `test/unit/audio/receiver.test.ts`:
  1. Validates Opus decoding pipeline to 48kHz stereo PCM buffer.
  2. Validates `AfterSilence` (500ms) stream close behavior.
  3. Validates minimum utterance filter ($< 200$ms discarded as noise).
  4. Validates RMS amplitude VAD filter (silent frames dropped).
  5. Validates 15-second safety limit clamp on continuous speech.
  6. Validates concurrent multi-speaker separation (distinct user sessions).
- `test/unit/audio/player.test.ts`:
  1. Validates `AudioPlayer` state machine transitions (`Idle` $\to$ `Playing` $\to$ `Idle`).
  2. Validates `playBuffer()` and stream playback resolution.
  3. Validates buffering watchdog timeout recovery ($> 5000$ms).
  4. Validates volume controls and error event propagation.
- `test/unit/audio/queue.test.ts`:
  1. Validates FIFO order within matching priority tiers.
  2. Validates priority-based sorting (`EMERGENCY` before `HIGH` before `NORMAL`).
  3. Validates **EMERGENCY preemption**: actively playing `NORMAL` audio is stopped immediately upon `EMERGENCY` arrival.
  4. Validates `cancelNonEmergency()` flushes low/normal queue while preserving emergency items.
  5. Validates `stopAll()` clears queue and stops active player.
  6. Validates automatic playback progression through sequential queue items.
- `test/unit/audio/stt.test.ts`:
  1. Validates `MockSTTProvider` static transcript and queue dispatch.
  2. Validates WAV header packaging from raw PCM.
  3. Validates provider swapping at runtime.
- `test/unit/audio/tts.test.ts`:
  1. Validates `MockTTSProvider` synthetic PCM tone generation.
  2. Validates LRU cache hit/miss behavior on identical speech inputs.
  3. Validates zero-length string handling.

---

## 10. Step-by-Step Implementation Sequence for Builder Agent

| Step | Action | Files Touched | Verification |
|---|---|---|---|
| **Step 1** | Implement contracts, enums, and configs | `src/audio/types.ts` | Typecheck passes cleanly |
| **Step 2** | Implement PCM/WAV helpers and mathematical VAD | `src/audio/receiver.ts` | `calculatePcmRms`, `createWavBuffer` unit tests pass |
| **Step 3** | Implement decoupled STT pipeline and in-memory mock | `src/audio/stt.ts` | Mock STT unit tests pass |
| **Step 4** | Implement decoupled TTS pipeline and synthetic tone mock | `src/audio/tts.ts` | Mock TTS audio buffer tests pass |
| **Step 5** | Implement VoicePlayer wrapper and buffering watchdog | `src/audio/player.ts` | Audio player state transition tests pass |
| **Step 6** | Implement Priority AudioQueueManager with EMERGENCY preemption | `src/audio/queue.ts` | Priority queue & preemption tests pass |
| **Step 7** | Implement VoiceReceiver with multi-speaker map and AfterSilence | `src/audio/receiver.ts` | Voice receiver VAD & buffering tests pass |
| **Step 8** | Integration validation: simulated voice packet $\to$ STT $\to$ Queue $\to$ Player | `test/integration/audio_roundtrip.test.ts` | 100% offline roundtrip passes |

---
*End of Plan*
