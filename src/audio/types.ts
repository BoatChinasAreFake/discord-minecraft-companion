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
  aborted?: boolean;
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
