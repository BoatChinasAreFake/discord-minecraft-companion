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

  public async transcribePcm(
    pcmBuffer: Buffer,
    metadata: { userId?: string; sampleRate?: number } = {}
  ): Promise<string> {
    const sampleRate = metadata.sampleRate ?? 48000;
    const wavBuffer = createWavBuffer(pcmBuffer, sampleRate, 2, 16);

    return this.provider.transcribe({
      buffer: wavBuffer,
      mimeType: 'audio/wav',
      sampleRate,
    });
  }
}

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

  public async transcribe(audio: {
    buffer: Buffer;
    mimeType: string;
    sampleRate: number;
  }): Promise<string> {
    this.callHistory.push({ bufferLength: audio.buffer.length, mimeType: audio.mimeType });

    if (this.transcriptQueue.length > 0) {
      return this.transcriptQueue.shift()!;
    }
    return this.defaultTranscript;
  }
}

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

  public async transcribe(audio: {
    buffer: Buffer;
    mimeType: string;
    sampleRate: number;
  }): Promise<string> {
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
