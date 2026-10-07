# Milestone 1 Code Review & Adversarial Stress Report

**Milestone**: Milestone 1 — Discord Core & Audio/Bridge Infrastructure  
**Reviewer**: `reviewer_m1_1` (Roles: reviewer, critic)  
**Date**: 2026-10-07  
**Project Root**: `c:\Users\rando\Documents\antigravity\wise-pasteur`  

---

## Review Summary

**Verdict**: **REQUEST_CHANGES**

Milestone 1 implements an impressive foundational scaffold across TypeScript configuration, 8 slash commands with RBAC checks, audio RMS VAD / WAV packaging, priority queue management, and triple-lock chat bridge deduplication. However, rigorous adversarial scrutiny and test execution revealed **1 Critical Integrity Violation**, **1 Critical Security Vulnerability**, **2 Major Functional/Security Defects**, and **test failures in `npm test`**.

---

## Findings

### 1. [Critical] Finding 1 — INTEGRITY VIOLATION: Facade / Dummy Voice Playback Implementation in `DiscordBotClient`
- **What**: `IVoiceSession.playAudioStream` and `IVoiceSession.stopAudio` in `DiscordBotClient.joinVoice` are empty dummy no-ops.
- **Where**: `src/discord/client.ts`, lines 136–137.
- **Why**: 
  In `DiscordBotClient.joinVoice(channelId, guildId)`:
  ```typescript
  const session: IVoiceSession = {
    channelId,
    guildId,
    subscribeUser: (userId: string) => connection.receiver.subscribe(userId),
    playAudioStream: async () => {}, // EMPTY NO-OP
    stopAudio: () => {},            // EMPTY NO-OP
    destroy: () => connection.destroy()
  };
  ```
  Even though a full `VoicePlayer` class with state machine, volume controls, buffering watchdog, and resource streaming was written in `src/audio/player.ts`, `DiscordBotClient` never instantiates or connects `VoicePlayer` to the returned session. Any caller invoking `session.playAudioStream(...)` silently does nothing — no audio is played or streamed into Discord. Unit tests in `test/m1/` masked this by exclusively testing `MockVoiceSession`. Under Teamwork reviewer/critic integrity standards, dummy or facade implementations that look correct but implement no real logic require an immediate `REQUEST_CHANGES` verdict with an INTEGRITY VIOLATION tag.
- **Suggestion**: In `DiscordBotClient.joinVoice`, instantiate/attach a `VoicePlayer` to `connection` (`player.attach(connection)`), delegate `playAudioStream` to `player.playStream(stream)` / `player.playBuffer(buffer)`, and delegate `stopAudio` to `player.stop()`.

---

### 2. [Critical] Finding 2 — SECURITY VULNERABILITY: Unauthenticated Admin Privilege Escalation via Undefined Match
- **What**: Undefined user ID matching undefined guild owner ID grants `ADMIN` permissions to unauthenticated users.
- **Where**: `src/discord/rbac.ts`, line 78.
- **Why**:
  ```typescript
  // Check Guild Owner
  if (guild && guild.ownerId === userId) {
    return RBACTier.ADMIN;
  }
  ```
  If `user.id` is undefined (or omitted in edge interaction payloads) and `guild.ownerId` is undefined (e.g. malformed or partial guild context, or mock contexts), `guild.ownerId === userId` evaluates to `undefined === undefined` which is `true`. The caller is immediately granted `RBACTier.ADMIN` status, gaining unauthenticated access to `/connect` and `/disconnect`.
  Verified failing in `test/tier5_adversarial/m1_adversarial.test.ts` (test `ADV-RBAC-7`).
- **Suggestion**: Ensure both `userId` and `guild.ownerId` are non-empty before equality check:
  ```typescript
  if (guild?.ownerId && userId && guild.ownerId === userId) {
    return RBACTier.ADMIN;
  }
  ```

---

### 3. [Major] Finding 3 — SECURITY / MODERATION BYPASS: Case-Sensitive Regex Permits `@EVERYONE` Pings
- **What**: Anti-loopback filter fails to sanitize case variants of `@everyone` and `@here`.
- **Where**: `src/bridge/antiLoopback.ts`, lines 120–121.
- **Why**:
  ```typescript
  public sanitizeForDiscord(content: string): string {
    return content
      .replace(/@everyone/g, '@\u200beveryone')
      .replace(/@here/g, '@\u200bhere');
  }
  ```
  The regex lacks the `i` (case-insensitive) flag. An in-game user sending `@EVERYONE`, `@Everyone`, `@HERE`, or `@Here` passes through without the zero-width space insertion, causing Discord to ping all server members.
  Verified failing in `test/tier5_adversarial/m1_adversarial.test.ts` (test `ADV-ALF-2`).
- **Suggestion**: Add the `i` flag: `/@everyone/gi` and `/@here/gi`.

---

### 4. [Major] Finding 4 — PROTOCOL VIOLATION: Packet Overflow (> 256 Chars) on Long Unbroken Tokens
- **What**: `chunkForMinecraft` creates chat chunks exceeding 256 characters when message contains long unbroken strings.
- **Where**: `src/bridge/antiLoopback.ts`, lines 149–169.
- **Why**:
  When a single continuous token without spaces exceeds the chunk limit (e.g. 500 characters), the single-pass slice sets `currentChunk = word.slice(sliceLen)`. Because the remaining slice is not subdivided in a while loop, `currentChunk` retains up to 290 characters and is pushed as the final chunk. When prefixed with `[Discord] <User>:`, the packet length reaches 331 characters, exceeding vanilla Minecraft's 256-character packet limit and triggering packet disconnects.
  Verified failing in `test/tier5_adversarial/m1_adversarial.test.ts` (test `ADV-ALF-4`).
- **Suggestion**: Loop and slice unbroken tokens until the remaining slice length fits within the allowed chunk budget.

---

### 5. [Major] Finding 5 — BUILD / VERIFICATION FAILURE: `npm test` Fails with Exit Code 1
- **What**: Running the automated test suite `npm.cmd test` fails in the project root.
- **Where**: Test runner execution (`vitest run`).
- **Why**:
  `test/tier5_adversarial/m1_adversarial.test.ts` contains 3 failing tests:
  1. `ADV-ALF-2`: case variant sanitization for `@everyone`
  2. `ADV-ALF-4`: unbroken token splitting exceeding 256 characters
  3. `ADV-RBAC-7`: undefined `user.id` matching undefined `guild.ownerId`
  Result: 1 failed file, 3 failed tests out of 107.
- **Suggestion**: Worker must address the issues identified in Findings 2, 3, and 4 so that `npm test` passes 100%.

---

### 6. [Minor] Finding 6 — Voice Receiver Wiring Gap in Client
- **What**: `VoiceReceiver` is implemented in `src/audio/receiver.ts` with `attach(connection)`, but is never instantiated or hooked to voice connections in `DiscordBotClient`.
- **Where**: `src/discord/client.ts`.
- **Why**: Outbound audio and inbound audio tracking should be managed coherently within the Discord client or agent coordinator.
- **Suggestion**: Provide clean hooks or coordinator integration to attach `VoiceReceiver` upon joining a voice channel.

---

### 7. [Minor] Finding 7 — Negative Duration RangeError in Tone Generator
- **What**: `generateSyntheticPcmTone` throws an unhandled `RangeError` when duration is negative.
- **Where**: `src/audio/tts.ts`, line 13.
- **Why**: `totalBytes` is negative, causing `Buffer.alloc(totalBytes)` to throw.
- **Suggestion**: Add a boundary clamp: `if (durationMs <= 0) return Buffer.alloc(0);`.

---

## Verified Claims

- **TypeScript compilation**: Verified via `npm.cmd run build` → **PASS** (Zero compiler errors under `strict: true`, outputs generated to `dist/`).
- **M1 test suites**: Verified via `test/m1/` (69 tests) → **PASS** in isolation.
- **Comprehensive test runner**: Verified via `npm.cmd test` (107 tests across 11 files) → **FAIL** (3 adversarial tests failed).
- **Interface definitions**: Verified `PROJECT.md` contracts against `src/` type definitions → **PASS** (well-typed interfaces matching milestone specifications).
- **Module boundaries**: Verified `.agents/teamwork/` layout compliance → **PASS** (no source code or data in `.agents/teamwork/`).

---

## Adversarial Stress Testing Results

| Scenario | Tested Component | Expected Behavior | Actual Behavior | Result |
|---|---|---|---|---|
| Undefined owner and user IDs | `RBACService` | Deny admin access | Granted ADMIN access via `undefined === undefined` | **FAIL** |
| Mixed-case `@EVERYONE` | `AntiLoopbackFilter` | Zero-width space inserted | Skipped, raw `@EVERYONE` remained | **FAIL** |
| 500-char unbroken token | `AntiLoopbackFilter` | All chunks $\le 256$ chars | Generated 331-char chunk | **FAIL** |
| Voice session audio playback | `DiscordBotClient.joinVoice` | Streams audio via `VoicePlayer` | Empty no-op `async () => {}` | **FAIL (INTEGRITY)** |
| 5000 burst deduplication | `AntiLoopbackFilter` | Memory & performance stability | Completed in < 1000ms | **PASS** |
| Status hash coordinate jitter | `StatusEmbedManager` | Suppress sub-0.5 coordinate jitter | Cleanly suppressed | **PASS** |
| Deleted message error 10008 | `StatusEmbedManager` | Self-heal and send new pin | Caught 10008, re-pinned | **PASS** |
| Auto-deferral 2.5s timeout | `withAutoDefer` | Defer slow interaction | Timed out and deferred cleanly | **PASS** |
| Negative tone duration | `generateSyntheticPcmTone` | Return empty buffer | Threw `RangeError` | **FAIL** |

---

## Coverage Gaps

- **Live Discord Gateway & Voice Socket integration**: Tested only with in-memory mocks. Risk Level: **Medium** — acceptable for offline CI, but live voice pipeline should be validated during coordinator E2E track.
- **Mineflayer / Gemini planning**: Out of scope for Milestone 1 (designated for Milestones 2 and 3). Risk Level: **Low** (interfaces established).

---

## Unverified Items

- **Live Discord Gateway login with Discord API**: Offline test flag `MOCK_ALL=true` bypasses WebSocket login in test environments as per project requirements (R4).
