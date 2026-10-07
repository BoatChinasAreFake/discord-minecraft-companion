import { describe, it, expect, vi } from 'vitest';
import {
  VoiceReceiver,
  calculatePcmRms,
  createWavBuffer,
} from '../../src/audio/receiver.js';

describe('Voice Receiver Subsystem (src/audio/receiver.ts)', () => {
  it('TC-REC-1: calculatePcmRms returns 0 for empty or silent buffers', () => {
    expect(calculatePcmRms(Buffer.alloc(0))).toBe(0);
    expect(calculatePcmRms(Buffer.alloc(100))).toBe(0);
  });

  it('TC-REC-2: calculatePcmRms calculates accurate amplitude for active audio', () => {
    // 16-bit signed PCM buffer with alternating +1000 and -1000 values
    const buffer = Buffer.alloc(100);
    for (let i = 0; i < 100; i += 2) {
      buffer.writeInt16LE(1000, i);
    }

    const rms = calculatePcmRms(buffer);
    expect(rms).toBeCloseTo(1000, 0);
  });

  it('TC-REC-3: createWavBuffer prepends standard 44-byte RIFF header', () => {
    const pcm = Buffer.alloc(1920); // 10ms of 48kHz stereo 16-bit
    const wav = createWavBuffer(pcm, 48000, 2, 16);

    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    expect(wav.readUInt16LE(20)).toBe(1); // PCM format
    expect(wav.readUInt16LE(22)).toBe(2); // Stereo
    expect(wav.readUInt32LE(24)).toBe(48000); // 48kHz sample rate
    expect(wav.readUInt16LE(34)).toBe(16); // 16-bit depth
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
  });

  it('TC-REC-4: discards utterances shorter than minUtteranceDurationMs', () => {
    const receiver = new VoiceReceiver({
      minUtteranceDurationMs: 200,
      sampleRate: 48000,
      channels: 2,
      bitDepth: 16,
    });

    const discardedSpy = vi.fn();
    const utteranceSpy = vi.fn();
    receiver.on('noiseDiscarded', discardedSpy);
    receiver.on('utterance', utteranceSpy);

    // 100ms of audio (100 * 192 = 19,200 bytes)
    const shortBuffer = Buffer.alloc(19200);
    for (let i = 0; i < shortBuffer.length; i += 2) {
      shortBuffer.writeInt16LE(1500, i);
    }

    const res = receiver.processPcmUtterance('user_1', shortBuffer);

    expect(res).toBeNull();
    expect(discardedSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'duration_too_short' })
    );
    expect(utteranceSpy).not.toHaveBeenCalled();
  });

  it('TC-REC-5: discards utterances with RMS below noiseThresholdRms (VAD)', () => {
    const receiver = new VoiceReceiver({
      minUtteranceDurationMs: 200,
      noiseThresholdRms: 300,
      sampleRate: 48000,
      channels: 2,
      bitDepth: 16,
    });

    const discardedSpy = vi.fn();
    const utteranceSpy = vi.fn();
    receiver.on('noiseDiscarded', discardedSpy);
    receiver.on('utterance', utteranceSpy);

    // 300ms of audio (300 * 192 = 57,600 bytes) with low noise amplitude (50)
    const quietBuffer = Buffer.alloc(57600);
    for (let i = 0; i < quietBuffer.length; i += 2) {
      quietBuffer.writeInt16LE(50, i);
    }

    const res = receiver.processPcmUtterance('user_1', quietBuffer);

    expect(res).toBeNull();
    expect(discardedSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'rms_below_threshold' })
    );
    expect(utteranceSpy).not.toHaveBeenCalled();
  });

  it('TC-REC-6: processes valid speech utterance and emits event', () => {
    const receiver = new VoiceReceiver({
      minUtteranceDurationMs: 200,
      noiseThresholdRms: 300,
      sampleRate: 48000,
      channels: 2,
      bitDepth: 16,
    });

    const utteranceSpy = vi.fn();
    receiver.on('utterance', utteranceSpy);

    // 400ms of valid loud speech (400 * 192 = 76,800 bytes) with amplitude 2000
    const speechBuffer = Buffer.alloc(76800);
    for (let i = 0; i < speechBuffer.length; i += 2) {
      speechBuffer.writeInt16LE(2000, i);
    }

    const res = receiver.processPcmUtterance('user_speech_1', speechBuffer);

    expect(res).not.toBeNull();
    expect(res?.userId).toBe('user_speech_1');
    expect(res?.durationMs).toBeCloseTo(400, 0);
    expect(res?.rms).toBeCloseTo(2000, 0);
    expect(res?.wavBuffer.length).toBe(76800 + 44);
    expect(utteranceSpy).toHaveBeenCalledWith(res);
  });
});
