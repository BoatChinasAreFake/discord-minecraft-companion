import { createHash } from 'node:crypto';
import { ITTSPipeline, ITTSProvider, TTSOptions } from './types.js';
import { createWavBuffer } from './receiver.js';

export function generateSyntheticPcmTone(
  durationMs: number,
  frequencyHz = 440,
  sampleRate = 48000,
  channels = 2
): Buffer {
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

export class MockTTSProvider implements ITTSProvider {
  public readonly name = 'MockTTSProvider';
  public callHistory: string[] = [];

  public async synthesize(text: string, options: TTSOptions = {}): Promise<Buffer> {
    this.callHistory.push(text);

    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const durationMs = Math.max(250, Math.min(3000, 200 + words * 60));

    const pcm = generateSyntheticPcmTone(durationMs, 440, options.sampleRate ?? 48000, 2);
    return createWavBuffer(pcm, options.sampleRate ?? 48000, 2, 16);
  }
}

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

  public getCacheSize(): number {
    return this.cache.size;
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
