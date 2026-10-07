import { PassThrough, Readable } from 'node:stream';
import type { IVoiceSession } from '../../src/discord/types.js';
import type { AudioPriority } from '../../src/audio/types.js';

export interface RecordedAudioPlayback {
  priority: AudioPriority | 'NORMAL' | 'HIGH' | 'EMERGENCY';
  chunks: Buffer[];
  totalBytes: number;
  completed: boolean;
}

export class MockVoiceSession implements IVoiceSession {
  public channelId: string;
  public guildId: string;
  public isDestroyed = false;
  public isAudioPlaying = false;

  // Tracks active simulated inbound speaker streams
  public activeUserStreams: Map<string, PassThrough> = new Map();

  // Tracks captured outbound TTS playback
  public playedRecordings: RecordedAudioPlayback[] = [];

  constructor(channelId: string, guildId: string) {
    this.channelId = channelId;
    this.guildId = guildId;
  }

  public subscribeUser(userId: string): PassThrough {
    let stream = this.activeUserStreams.get(userId);
    if (!stream || stream.destroyed) {
      stream = new PassThrough();
      this.activeUserStreams.set(userId, stream);
    }
    return stream;
  }

  public async playAudioStream(
    stream: Readable | Buffer,
    priority: AudioPriority | 'NORMAL' | 'HIGH' | 'EMERGENCY'
  ): Promise<void> {
    if (this.isDestroyed) {
      throw new Error('Cannot play audio on destroyed voice session');
    }

    this.isAudioPlaying = true;
    const recording: RecordedAudioPlayback = {
      priority,
      chunks: [],
      totalBytes: 0,
      completed: false,
    };
    this.playedRecordings.push(recording);

    if (Buffer.isBuffer(stream)) {
      recording.chunks.push(stream);
      recording.totalBytes = stream.length;
      recording.completed = true;
      this.isAudioPlaying = false;
      return;
    }

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        recording.chunks.push(chunk);
        recording.totalBytes += chunk.length;
      });

      stream.on('end', () => {
        recording.completed = true;
        this.isAudioPlaying = false;
        resolve();
      });

      stream.on('error', (err) => {
        this.isAudioPlaying = false;
        reject(err);
      });
    });
  }

  public stopAudio(): void {
    this.isAudioPlaying = false;
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.stopAudio();
    for (const stream of this.activeUserStreams.values()) {
      if (!stream.destroyed) {
        stream.destroy();
      }
    }
    this.activeUserStreams.clear();
  }

  // --------------------------------------------------------------------------
  // Simulation Helpers for Inbound User Speech
  // --------------------------------------------------------------------------

  public simulateUserSpeaking(userId: string, pcmChunks: Buffer[]): void {
    const stream = this.subscribeUser(userId);
    for (const chunk of pcmChunks) {
      stream.write(chunk);
    }
  }

  public simulateUserSilence(userId: string): void {
    const stream = this.activeUserStreams.get(userId);
    if (stream) {
      stream.end();
      this.activeUserStreams.delete(userId);
    }
  }

  public getCombinedPlayedAudio(index?: number): Buffer {
    const idx = index ?? this.playedRecordings.length - 1;
    const recording = this.playedRecordings[idx];
    if (!recording) return Buffer.alloc(0);
    return Buffer.concat(recording.chunks);
  }

  public reset(): void {
    this.destroy();
    this.isDestroyed = false;
    this.playedRecordings = [];
  }
}
