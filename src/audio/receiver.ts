import { EventEmitter } from 'node:events';
import { EndBehaviorType } from '@discordjs/voice';
import prism from 'prism-media';
import {
  VoiceReceiverConfig,
  DEFAULT_RECEIVER_CONFIG,
  SpeakerSession,
  UtteranceEvent,
} from './types.js';

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

export function createWavBuffer(
  pcmBuffer: Buffer,
  sampleRate = 48000,
  channels = 2,
  bitDepth = 16
): Buffer {
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
  header.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
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

export class VoiceReceiver extends EventEmitter {
  private config: VoiceReceiverConfig;
  private sessions: Map<string, SpeakerSession> = new Map();
  private attachedConnection: any = null;
  private isListening = false;

  constructor(config: Partial<VoiceReceiverConfig> = {}) {
    super();
    this.config = { ...DEFAULT_RECEIVER_CONFIG, ...config };
  }

  public getConfig(): VoiceReceiverConfig {
    return { ...this.config };
  }

  public attach(connection: any): void {
    this.attachedConnection = connection;
    this.isListening = true;

    if (connection && connection.receiver && connection.receiver.speaking) {
      connection.receiver.speaking.on('start', (userId: string) => {
        if (!this.isListening) return;
        this.handleSpeakerStart(userId, connection);
      });
    }
  }

  public detach(): void {
    this.isListening = false;
    for (const [userId] of this.sessions) {
      this.cleanupSession(userId);
    }
    this.sessions.clear();
    this.attachedConnection = null;
  }

  public handleSpeakerStart(userId: string, connection: any): void {
    if (this.sessions.has(userId)) return;

    try {
      const opusStream = connection.receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: this.config.silenceDurationMs,
        },
      });

      const decoder = new (prism as any).opus.Decoder({
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

        // Safety clamp: if continuous speech exceeds maxUtteranceDurationMs
        if (session.totalBytes >= maxBytes) {
          this.finalizeUtterance(userId);
        }
      });

      decoder.on('end', () => {
        this.finalizeUtterance(userId);
      });

      decoder.on('error', (err: any) => {
        this.emit('error', new Error(`Opus decoder error for user ${userId}: ${err.message}`));
        this.cleanupSession(userId);
      });

      opusStream.on('error', (err: any) => {
        this.emit('error', new Error(`Opus stream error for user ${userId}: ${err.message}`));
        this.cleanupSession(userId);
      });
    } catch (err: any) {
      this.emit('error', new Error(`Failed to subscribe to user ${userId}: ${err.message}`));
    }
  }

  public finalizeUtterance(userId: string): void {
    const session = this.sessions.get(userId);
    if (!session) return;

    const pcmBuffer = Buffer.concat(session.chunks);
    this.cleanupSession(userId);

    this.processPcmUtterance(userId, pcmBuffer);
  }

  public processPcmUtterance(userId: string, pcmBuffer: Buffer): UtteranceEvent | null {
    const bytesPerMs =
      (this.config.sampleRate * this.config.channels * (this.config.bitDepth / 8)) / 1000;
    const durationMs = pcmBuffer.length / bytesPerMs;

    // Filter 1: Duration check
    if (durationMs < this.config.minUtteranceDurationMs) {
      this.emit('noiseDiscarded', { userId, reason: 'duration_too_short', durationMs });
      return null;
    }

    // Filter 2: VAD RMS amplitude check
    const rms = calculatePcmRms(pcmBuffer);
    if (rms < this.config.noiseThresholdRms) {
      this.emit('noiseDiscarded', { userId, reason: 'rms_below_threshold', rms, durationMs });
      return null;
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
    return event;
  }

  public cleanupSession(userId: string): void {
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

  public getActiveSessionsCount(): number {
    return this.sessions.size;
  }
}
