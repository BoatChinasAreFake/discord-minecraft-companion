import { describe, it, expect } from 'vitest';
import { STTPipeline, MockSTTProvider } from '../../src/audio/stt.js';
import {
  TTSPipeline,
  MockTTSProvider,
  generateSyntheticPcmTone,
} from '../../src/audio/tts.js';

describe('STT & TTS Audio Pipelines (src/audio/stt.ts & tts.ts)', () => {
  it('TC-STT-1: MockSTTProvider returns default transcript when queue is empty', async () => {
    const provider = new MockSTTProvider();
    provider.setDefaultTranscript('Custom default response');

    const result = await provider.transcribe({
      buffer: Buffer.from('dummy_wav'),
      mimeType: 'audio/wav',
      sampleRate: 48000,
    });

    expect(result).toBe('Custom default response');
    expect(provider.callHistory.length).toBe(1);
  });

  it('TC-STT-2: MockSTTProvider drains queued transcripts in FIFO order', async () => {
    const provider = new MockSTTProvider();
    provider.enqueueTranscript('First command');
    provider.enqueueTranscript('Second command');

    const res1 = await provider.transcribe({ buffer: Buffer.alloc(10), mimeType: 'audio/wav', sampleRate: 48000 });
    const res2 = await provider.transcribe({ buffer: Buffer.alloc(10), mimeType: 'audio/wav', sampleRate: 48000 });
    const res3 = await provider.transcribe({ buffer: Buffer.alloc(10), mimeType: 'audio/wav', sampleRate: 48000 });

    expect(res1).toBe('First command');
    expect(res2).toBe('Second command');
    expect(res3).toBe('Hello bot, please report status'); // Fell back to default
  });

  it('TC-STT-3: STTPipeline wraps raw PCM in WAV container before dispatching', async () => {
    const mockProvider = new MockSTTProvider();
    const pipeline = new STTPipeline(mockProvider);

    const rawPcm = Buffer.alloc(1920); // 10ms of 48kHz stereo 16-bit
    await pipeline.transcribePcm(rawPcm);

    expect(mockProvider.callHistory.length).toBe(1);
    expect(mockProvider.callHistory[0].bufferLength).toBe(1920 + 44); // 44 bytes header
    expect(mockProvider.callHistory[0].mimeType).toBe('audio/wav');
  });

  it('TC-TTS-1: generateSyntheticPcmTone generates accurate byte length for requested duration', () => {
    // 500ms at 48kHz, 2 channels, 16-bit: 500 * (48000 * 2 * 2 / 1000) = 96,000 bytes
    const tone = generateSyntheticPcmTone(500, 440, 48000, 2);
    expect(tone.length).toBe(96000);
  });

  it('TC-TTS-2: MockTTSProvider synthesizes WAV audio with tone', async () => {
    const provider = new MockTTSProvider();
    const wav = await provider.synthesize('Hello world');

    expect(wav.length).toBeGreaterThan(44);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(provider.callHistory).toContain('Hello world');
  });

  it('TC-TTS-3: TTSPipeline caches identical speech requests (LRU cache hit)', async () => {
    const mockProvider = new MockTTSProvider();
    const pipeline = new TTSPipeline(mockProvider);

    const text = 'Repeatable status message';
    const buf1 = await pipeline.synthesizeSpeech(text);
    const buf2 = await pipeline.synthesizeSpeech(text);

    expect(buf1).toBe(buf2); // Cache hit (same Buffer reference)
    expect(mockProvider.callHistory.length).toBe(1); // Provider only called once!
  });

  it('TC-TTS-4: TTSPipeline returns empty buffer for empty or whitespace text', async () => {
    const mockProvider = new MockTTSProvider();
    const pipeline = new TTSPipeline(mockProvider);

    const result = await pipeline.synthesizeSpeech('   ');
    expect(result.length).toBe(0);
    expect(mockProvider.callHistory.length).toBe(0);
  });
});
