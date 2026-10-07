import { describe, it, expect, vi } from 'vitest';
import { DiscordBotClient } from '../../src/discord/client.js';
import { VoicePlayer } from '../../src/audio/player.js';
import { VoiceReceiver } from '../../src/audio/receiver.js';
import { AudioQueueManager } from '../../src/audio/queue.js';
import { AudioPriority } from '../../src/audio/types.js';

describe('DiscordBotClient Voice Wiring (src/discord/client.ts)', () => {
  it('wires VoicePlayer, VoiceReceiver, and AudioQueueManager into IVoiceSession', async () => {
    const mockChannel = {
      guild: {
        voiceAdapterCreator: vi.fn().mockReturnValue({
          sendPayload: vi.fn(),
          destroy: vi.fn(),
        }),
      },
      isTextBased: () => false,
    };

    const mockClient = {
      channels: {
        fetch: vi.fn().mockResolvedValue(mockChannel),
      },
      destroy: vi.fn(),
    };

    // Instantiate DiscordBotClient with mock dependencies
    const config: any = {
      audio: { sttSilenceDurationMs: 500, minUtteranceMs: 200, maxUtteranceMs: 15000 },
      runtime: { mockAll: true },
      discord: { token: 'test' },
      rbac: { adminUserIds: [], adminRoleIds: [], allowedUserIds: [], allowedRoleIds: [] }
    };
    const rbac: any = { check: vi.fn() };
    const registry: any = { get: vi.fn() };
    const context: any = {};

    const client = new DiscordBotClient(config, rbac, registry, context);
    // Overwrite raw client with mock
    (client as any).client = mockClient;

    const session = await client.joinVoice('voice_chan_1', 'guild_1');

    expect(session.player).toBeInstanceOf(VoicePlayer);
    expect(session.receiver).toBeInstanceOf(VoiceReceiver);
    expect(session.queue).toBeInstanceOf(AudioQueueManager);
    expect(typeof session.playAudioStream).toBe('function');
    expect(typeof session.stopAudio).toBe('function');
    expect(typeof session.destroy).toBe('function');

    // Test playAudioStream executes through VoicePlayer
    const playSpy = vi.spyOn(session.player!, 'playStream').mockResolvedValue(undefined as any);
    const buf = Buffer.from('test_audio_data');
    await session.playAudioStream(buf, AudioPriority.NORMAL);
    expect(playSpy).toHaveBeenCalled();

    // Test stopAudio executes through player and queue
    const stopPlayerSpy = vi.spyOn(session.player!, 'stop');
    const stopQueueSpy = vi.spyOn(session.queue!, 'stopAll');
    session.stopAudio();
    expect(stopPlayerSpy).toHaveBeenCalledWith(true);
    expect(stopQueueSpy).toHaveBeenCalled();

    // Test destroy cleans up connection and session state
    session.destroy();
    expect(session.isDestroyed).toBe(true);
  });
});
