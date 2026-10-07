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

  public attach(connection: any): void {
    if (connection && typeof connection.subscribe === 'function') {
      connection.subscribe(this.player);
    }
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
    return (
      this.player.state.status === AudioPlayerStatus.Playing ||
      this.player.state.status === AudioPlayerStatus.Buffering
    );
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
    if (resource.volume) {
      resource.volume.setVolume(targetVolume);
    }
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

  public getVolume(): number {
    return this.defaultVolume;
  }

  public startBufferingWatchdog(): void {
    this.clearBufferingWatchdog();
    this.bufferingWatchdogTimer = setTimeout(() => {
      this.emit('error', new Error('AudioPlayer buffering stalled (> 5000ms). Resetting player.'));
      this.stop(true);
    }, 5000);
  }

  public clearBufferingWatchdog(): void {
    if (this.bufferingWatchdogTimer) {
      clearTimeout(this.bufferingWatchdogTimer);
      this.bufferingWatchdogTimer = null;
    }
  }
}
