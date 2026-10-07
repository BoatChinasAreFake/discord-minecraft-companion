# Milestone 1 Iteration 2: Remediation Plan for RBAC and Discord Client Voice Session

**Document Version**: 1.0  
**Target Milestone**: Milestone 1 (Discord Core & Audio/Bridge Infrastructure)  
**Author**: `explorer_m1_it2_3`  
**Date**: 2026-10-07  
**Status**: READY FOR WORKER IMPLEMENTATION  

---

## 1. Executive Summary

This remediation plan delivers surgical TypeScript code fixes and architectural integration for two critical defects identified during Milestone 1 code review:

1. **Security Vulnerability in `src/discord/rbac.ts` (Line 78)**:  
   `guild && guild.ownerId === userId` evaluated to `true` when both `guild.ownerId` and `user.id` were `undefined`, erroneously conferring full `RBACTier.ADMIN` status to unauthenticated or context-deficient actors.
2. **Integrity Violation in `src/discord/client.ts` (`joinVoice`)**:  
   `IVoiceSession.playAudioStream` and `stopAudio` were empty no-op dummy stubs (`async () => {}`, `() => {}`), completely disconnected from `VoicePlayer` (`src/audio/player.ts`), `VoiceReceiver` (`src/audio/receiver.ts`), and `AudioQueueManager` (`src/audio/queue.ts`). Outbound audio could not be streamed and inbound audio was unattached.

This document details the exact root causes, step-by-step logic chains, complete replacement code blocks, and independent verification tests.

---

## 2. Issue 1: Unauthenticated Admin Privilege Escalation (`src/discord/rbac.ts`)

### 2.1 Problem Analysis & Threat Mechanism

- **Target File**: `src/discord/rbac.ts`
- **Location**: Line 78 in method `resolveUserTier(member, user, guild)`
- **Current Defective Code**:
  ```typescript
  // Check Guild Owner
  if (guild && guild.ownerId === userId) {
    return RBACTier.ADMIN;
  }
  ```

#### Vulnerability Analysis:
- `user.id` is extracted via `const userId = user.id;`. If an incoming interaction object has an undefined/malformed `user.id`, `userId` is `undefined`.
- In edge cases, webhook invocations, or partial mock guild objects where `guild.ownerId` is not populated or explicitly `undefined`, `guild && guild.ownerId === userId` evaluates:
  `Boolean(guild) && (undefined === undefined) => true && true => true`.
- Consequently, `resolveUserTier` immediately returns `RBACTier.ADMIN`, granting unrestricted administrative access to sensitive bot operations (such as `/connect` and `/disconnect`).
- In addition, an empty string `""` or whitespace string `" "` for both fields could also evaluate to equality if not validated for non-emptiness.

### 2.2 Precise Remediation Specification

1. Safely extract `userId` with optional chaining (`user?.id`).
2. Require both `guild.ownerId` and `userId` to be valid, non-empty, non-whitespace strings before performing identity equality.
3. Protect whitelist lookups (`adminUserIds` and `allowedUserIds`) by ensuring `userId` is defined and non-empty.

### 2.3 Proposed Code Changes for `src/discord/rbac.ts`

#### Before:
```typescript
  public resolveUserTier(
    member: GuildMember | APIInteractionGuildMember | null,
    user: User,
    guild?: Guild | null
  ): RBACTier {
    const userId = user.id;

    // Check Admin User ID whitelist
    if (this.config.rbac.adminUserIds.includes(userId)) {
      return RBACTier.ADMIN;
    }

    // Check Guild Owner
    if (guild && guild.ownerId === userId) {
      return RBACTier.ADMIN;
    }
```

#### After:
```typescript
  public resolveUserTier(
    member: GuildMember | APIInteractionGuildMember | null,
    user: User,
    guild?: Guild | null
  ): RBACTier {
    const userId = user?.id;

    // Check Admin User ID whitelist (only if userId is valid string)
    if (userId && this.config.rbac.adminUserIds.includes(userId)) {
      return RBACTier.ADMIN;
    }

    // Check Guild Owner (strictly require non-empty, non-whitespace string equality)
    if (
      typeof guild?.ownerId === 'string' &&
      guild.ownerId.trim().length > 0 &&
      typeof userId === 'string' &&
      userId.trim().length > 0 &&
      guild.ownerId === userId
    ) {
      return RBACTier.ADMIN;
    }
```

And in Operator User ID whitelist (line 106):
```typescript
    // Check Operator User ID whitelist
    if (userId && this.config.rbac.allowedUserIds.includes(userId)) {
      return RBACTier.OPERATOR;
    }
```

---

## 3. Issue 2: Voice Pipeline Wiring in `DiscordBotClient` (`src/discord/client.ts`)

### 3.1 Problem Analysis & Integrity Violation

- **Target File**: `src/discord/client.ts`
- **Location**: Lines 118–142 in method `joinVoice(channelId, guildId)`
- **Current Defective Code**:
  ```typescript
  public async joinVoice(channelId: string, guildId: string): Promise<IVoiceSession> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !('guild' in channel)) {
      throw new Error(`Voice channel ${channelId} not found or does not belong to a guild`);
    }

    const connection: VoiceConnection = discordJoinVoice({
      channelId,
      guildId,
      adapterCreator: (channel as any).guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false
    });

    const session: IVoiceSession = {
      channelId,
      guildId,
      subscribeUser: (userId: string) => connection.receiver.subscribe(userId),
      playAudioStream: async () => {}, // EMPTY DUMMY
      stopAudio: () => {},            // EMPTY DUMMY
      destroy: () => connection.destroy()
    };

    return session;
  }
  ```

#### Integrity Violation Details:
- The project implements a comprehensive `VoicePlayer` in `src/audio/player.ts` featuring `@discordjs/voice` `AudioPlayer` state management (`IDLE`, `BUFFERING`, `PLAYING`, `PAUSED`), volume controls, buffering watchdog timers, and `playStream`/`playBuffer` APIs.
- The project implements `VoiceReceiver` in `src/audio/receiver.ts` with VAD noise threshold gating, 48kHz stereo RMS calculations, and RIFF WAV header generation.
- The project implements `AudioQueueManager` in `src/audio/queue.ts` with priority-ordered playback, FIFO tie-breaking, and preemption for `EMERGENCY` alerts.
- However, `DiscordBotClient.joinVoice` completely ignored all three components. Calling `session.playAudioStream(...)` did nothing.
- Active voice sessions were not tracked on `DiscordBotClient`, leading to resource leaks when `leaveVoice` or `stop` was invoked.

### 3.2 Architectural Wiring Strategy

```
                          Discord Voice Gateway
                                   │
                     joinVoice(channelId, guildId)
                                   ▼
                       ┌───────────────────────┐
                       │    VoiceConnection    │
                       └───────────┬───────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
    ┌───────────────────┐                     ┌───────────────────┐
    │    VoicePlayer    │                     │   VoiceReceiver   │
    │  .attach(conn)    │                     │   .attach(conn)   │
    └─────────▲─────────┘                     └───────────────────┘
              │
    ┌─────────┴─────────┐
    │ AudioQueueManager │
    │   (player, tts)   │
    └───────────────────┘
              ▲
              │
    ┌─────────┴────────────────────────────────────────┐
    │                  IVoiceSession                   │
    │  - playAudioStream (Buffer, Readable, WebStream) │
    │  - stopAudio (player.stop, queue.stopAll)        │
    │  - destroy (detach, stop, conn.destroy)          │
    │  - player, receiver, queue instances exposed     │
    └──────────────────────────────────────────────────┘
```

1. **`VoicePlayer` Attachment**:
   Instantiate `player = new VoicePlayer(); player.attach(connection);`. This invokes `connection.subscribe(player.getRawPlayer())`, piping audio frames to Discord's voice socket.
2. **`VoiceReceiver` Attachment**:
   Instantiate `receiver = new VoiceReceiver(config.audio); receiver.attach(connection);`. This hooks `connection.receiver.speaking.on('start', ...)` to decode and buffer incoming Opus audio.
3. **`AudioQueueManager` Integration**:
   Instantiate `queue = new AudioQueueManager(player, this.ttsPipeline);`. This allows queued priority TTS announcements with emergency preemption.
4. **Multi-Format Audio Stream Ingestion**:
   In `playAudioStream(stream, priority)`:
   - Handle `Buffer`: convert via `Readable.from(stream)` or `player.playBuffer(stream)`.
   - Handle Node.js `Readable` stream: invoke `player.playStream(stream)`.
   - Handle WHATWG `ReadableStream`: convert via `Readable.fromWeb(stream)`.
   - Handle AsyncIterable: convert via `Readable.from(stream)`.
   - If `priority === AudioPriority.EMERGENCY` or `'EMERGENCY'`, trigger `queue.cancelNonEmergency()` and `player.stop(true)` to preempt any lower-priority audio.
5. **Session Lifecycle & Cleanup**:
   - Track active sessions in `DiscordBotClient.voiceSessions: Map<string, IVoiceSession>`.
   - On `leaveVoice(guildId)`: invoke `session.destroy()` before destroying connection.
   - On `DiscordBotClient.stop()`: cleanly destroy all active sessions.

---

### 3.3 Proposed Code Changes for `src/discord/types.ts`

Update `IVoiceSession` to expose the wired components and support both required and optional priority arguments:

```typescript
import type {
  ChatInputCommandInteraction,
  CommandInteraction,
  EmbedBuilder,
  MessageCreateOptions,
  MessagePayload
} from 'discord.js';
import type { VoiceConnection } from '@discordjs/voice';
import type { AudioPriority } from '../audio/types.js';
import type { VoicePlayer } from '../audio/player.js';
import type { VoiceReceiver } from '../audio/receiver.js';
import type { AudioQueueManager } from '../audio/queue.js';
import type { MinecraftBotStatus, MinecraftConnectionConfig } from '../minecraft/types.js';

export type RBACTierName = 'VIEWER' | 'OPERATOR' | 'ADMIN';

// ... (other interfaces unchanged) ...

export interface IVoiceSession {
  readonly channelId?: string;
  readonly guildId?: string;
  readonly isDestroyed?: boolean;
  readonly player?: VoicePlayer;
  readonly receiver?: VoiceReceiver;
  readonly queue?: AudioQueueManager;
  readonly connection?: VoiceConnection;
  subscribeUser(userId: string): any;
  playAudioStream(
    stream: any,
    priority?: AudioPriority | 'NORMAL' | 'HIGH' | 'EMERGENCY'
  ): Promise<void>;
  stopAudio(): void;
  destroy(): void;
}
```

---

### 3.4 Proposed Code Changes for `src/discord/client.ts`

#### Imports to Add / Update:
```typescript
import { Readable } from 'node:stream';
import {
  joinVoiceChannel as discordJoinVoice,
  getVoiceConnection,
  VoiceConnection
} from '@discordjs/voice';
import type { AppConfig } from '../config/types.js';
import type { RBACService } from './rbac.js';
import type { CommandRegistry } from './commands/registry.js';
import { withAutoDefer } from './commands/deferral.js';
import type { IDiscordGateway, IVoiceSession, UserMessage, CommandContext, EmbedData } from './types.js';
import { VoicePlayer } from '../audio/player.js';
import { VoiceReceiver } from '../audio/receiver.js';
import { AudioQueueManager } from '../audio/queue.js';
import { TTSPipeline, MockTTSProvider } from '../audio/tts.js';
import { AudioPriority, type ITTSPipeline } from '../audio/types.js';
```

#### Class Implementation (`DiscordBotClient`):
```typescript
export class DiscordBotClient implements IDiscordGateway {
  private client: Client;
  private messageHandlers: Array<(message: UserMessage) => Promise<void>> = [];
  private commandHandlers: Array<(interaction: any) => Promise<void>> = [];
  private voiceSessions: Map<string, IVoiceSession> = new Map();
  private ttsPipeline: ITTSPipeline;

  constructor(
    private config: AppConfig,
    private rbac: RBACService,
    private registry: CommandRegistry,
    private commandContext: CommandContext,
    ttsPipeline?: ITTSPipeline
  ) {
    this.ttsPipeline = ttsPipeline ?? new TTSPipeline(new MockTTSProvider());

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
      ]
    });

    this.setupListeners();
  }

  public setTTSPipeline(ttsPipeline: ITTSPipeline): void {
    this.ttsPipeline = ttsPipeline;
  }

  public getVoiceSession(guildId: string): IVoiceSession | undefined {
    return this.voiceSessions.get(guildId);
  }

  // ... (start, onMessage, onCommand, registerCommands, sendMessage, updateEmbed unchanged) ...

  public async stop(): Promise<void> {
    for (const [, session] of this.voiceSessions) {
      try {
        session.destroy();
      } catch {
        // Suppress cleanup errors during shutdown
      }
    }
    this.voiceSessions.clear();
    this.client.destroy();
    console.log('[Discord Client] Gateway connection destroyed.');
  }

  public async joinVoice(channelId: string, guildId: string): Promise<IVoiceSession> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !('guild' in channel)) {
      throw new Error(`Voice channel ${channelId} not found or does not belong to a guild`);
    }

    // Clean up existing session in this guild if one exists
    const existingSession = this.voiceSessions.get(guildId);
    if (existingSession) {
      try {
        existingSession.destroy();
      } catch {
        // Ignore error when resetting session
      }
      this.voiceSessions.delete(guildId);
    }

    const connection: VoiceConnection = discordJoinVoice({
      channelId,
      guildId,
      adapterCreator: (channel as any).guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false
    });

    // 1. Instantiate and attach VoicePlayer
    const player = new VoicePlayer();
    player.attach(connection);

    // 2. Instantiate and attach VoiceReceiver
    const receiver = new VoiceReceiver(
      this.config.audio
        ? {
            silenceDurationMs: this.config.audio.sttSilenceDurationMs,
            minUtteranceDurationMs: this.config.audio.minUtteranceMs,
            maxUtteranceDurationMs: this.config.audio.maxUtteranceMs,
          }
        : {}
    );
    receiver.attach(connection);

    // 3. Instantiate AudioQueueManager wired to player and TTS
    const queue = new AudioQueueManager(player, this.ttsPipeline);

    let isSessionDestroyed = false;

    const session: IVoiceSession = {
      channelId,
      guildId,
      get isDestroyed() {
        return isSessionDestroyed;
      },
      player,
      receiver,
      queue,
      connection,
      subscribeUser: (userId: string) => connection.receiver.subscribe(userId),
      playAudioStream: async (
        stream: any,
        priority: AudioPriority | 'NORMAL' | 'HIGH' | 'EMERGENCY' = AudioPriority.NORMAL
      ): Promise<void> => {
        if (isSessionDestroyed) {
          throw new Error('Cannot play audio on destroyed voice session');
        }

        // Emergency priority preempts any lower priority playback
        if (priority === AudioPriority.EMERGENCY || priority === 'EMERGENCY') {
          queue.cancelNonEmergency();
          player.stop(true);
        }

        let readableStream: Readable;
        if (Buffer.isBuffer(stream)) {
          readableStream = Readable.from(stream);
        } else if (stream instanceof Readable || typeof (stream as any)?.pipe === 'function') {
          readableStream = stream as Readable;
        } else if (typeof (stream as any)?.getReader === 'function') {
          readableStream = Readable.fromWeb(stream as any);
        } else if (stream && typeof (stream as any)[Symbol.asyncIterator] === 'function') {
          readableStream = Readable.from(stream);
        } else {
          throw new Error('Unsupported audio stream format passed to playAudioStream');
        }

        await player.playStream(readableStream);
      },
      stopAudio: () => {
        queue.stopAll();
        player.stop(true);
      },
      destroy: () => {
        if (isSessionDestroyed) return;
        isSessionDestroyed = true;
        try {
          receiver.detach();
        } catch {}
        try {
          queue.stopAll();
        } catch {}
        try {
          player.stop(true);
        } catch {}
        try {
          connection.destroy();
        } catch {}
        this.voiceSessions.delete(guildId);
      }
    };

    this.voiceSessions.set(guildId, session);
    return session;
  }

  public async leaveVoice(guildId: string): Promise<void> {
    const session = this.voiceSessions.get(guildId);
    if (session) {
      session.destroy();
      this.voiceSessions.delete(guildId);
    }
    const connection = getVoiceConnection(guildId);
    if (connection) {
      connection.destroy();
    }
  }
```

---

## 4. Verification Methods

### 4.1 RBAC Unit & Adversarial Verification

Run the vitest test suite targeting the RBAC unit tests and the adversarial probe:

```powershell
npx.cmd vitest run test/m1/rbac.test.ts test/tier5_adversarial/m1_adversarial.test.ts
```

#### Test Scenarios Covered:
1. `ADV-RBAC-7`: Passing `user = { username: 'GhostUser' }` (undefined `id`) and `guild = {}` (undefined `ownerId`) to `rbac.check(...)` must return `allowed: false` for `RBACTier.ADMIN`.
2. Whitespace IDs: Passing `user = { id: '   ' }` and `guild = { ownerId: '   ' }` must return `allowed: false`.
3. Legitimate Owner: Passing `user = { id: '12345' }` and `guild = { ownerId: '12345' }` must return `allowed: true` with `userTier: ADMIN`.

### 4.2 Discord Client Voice Session Unit Test

Create a dedicated unit test (e.g., in `test/m1/client_voice.test.ts`) to verify that `DiscordBotClient.joinVoice` properly wires `VoicePlayer`, `VoiceReceiver`, and `AudioQueueManager`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { DiscordBotClient } from '../../src/discord/client.js';
import { VoicePlayer } from '../../src/audio/player.js';
import { VoiceReceiver } from '../../src/audio/receiver.js';
import { AudioQueueManager } from '../../src/audio/queue.js';
import { AudioPriority } from '../../src/audio/types.js';

describe('DiscordBotClient Voice Wiring (src/discord/client.ts)', () => {
  it('wires VoicePlayer, VoiceReceiver, and AudioQueueManager into IVoiceSession', async () => {
    const mockChannel = {
      guild: {
        voiceAdapterCreator: vi.fn(),
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
    const config: any = { audio: { sttSilenceDurationMs: 500, minUtteranceMs: 200, maxUtteranceMs: 15000 }, runtime: { mockAll: true } };
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
```

---

## 5. Non-Regression and Safety Assessment

1. **Backwards Compatibility**:
   - `IVoiceSession` continues to fulfill the interface contract defined in `PROJECT.md` line 132 (`subscribeUser`, `playAudioStream`, `stopAudio`, `destroy`).
   - Mock voice sessions (`MockVoiceSession` in `test/mocks/mockVoice.ts`) remain 100% compliant because newly added properties (`player`, `receiver`, `queue`, `connection`) are optional (`?`).
   - Slash command handlers and coordinator components calling `gateway.joinVoice(...)` or `session.playAudioStream(...)` continue to function without signature changes.
2. **Resource Safety**:
   - The tracking map `voiceSessions` guarantees that duplicate calls to `joinVoice` in the same guild or subsequent calls to `leaveVoice` or `client.stop()` do not leak background timers (`VoicePlayer.bufferingWatchdogTimer`) or open sockets.
