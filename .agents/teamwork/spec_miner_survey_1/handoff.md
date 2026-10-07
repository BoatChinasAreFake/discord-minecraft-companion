# Handoff Report: Requirement R1 (Discord Text, Voice & In-Game Bridge Core) Specification

**From:** `spec_miner_survey_1` (teamwork_preview_spec_miner)  
**To:** `orchestrator_1` (e9cac3a4-2cab-4915-bfc4-a4488f13ddf5)  
**Date:** 2026-10-07  
**Artifact:** `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\spec_miner_survey_1\survey_report.md`  

---

## 1. Observation

1. **User Request & Requirements (`ORIGINAL_REQUEST.md` lines 12–19, 47–54, 60–63):**
   - Line 12–19:
     > "R1. Discord Text, Voice & In-Game Bridge Core: Implement a Discord bot service supporting text commands/slash commands, interactive voice channels, and bidirectional game bridging:
     > - Voice Channels: Support two-way voice communication: capturing and transcribing user speech via an STT audio pipeline and replying with synthesized voice audio via a TTS pipeline.
     > - Bidirectional Chat Bridge: Relay messages in real time between a configured Discord text channel and in-game Minecraft server chat (with loopback protection).
     > - Live Status Embeds: Expose rich Discord status embeds displaying real-time bot health, hunger, world coordinates, active task status, and equipped gear.
     > - Access Control: Enforce role-based access control (RBAC) so only configured Discord roles or users can command the bot to execute in-game actions.
     > Provide clean configuration via environment variables for all credentials and IDs."
   - Line 48–54:
     > "Slash commands for bot status, server connection, and Minecraft tasks are registered and respond accurately. Role-based access control enforces permission checks on sensitive bot control commands. Bidirectional chat bridge relays messages between Discord and Minecraft server chat without duplication or feedback loops. Live status embed accurately displays real-time health, hunger, position, active task, and inventory overview. Voice receiver pipeline accurately ingests and buffers audio streams from users in a voice channel. Voice player pipeline generates and streams synthetic audio into the voice channel."
   - Line 38–40:
     > "Project builds cleanly (`npm run build` or equivalent) with TypeScript type checks passing without errors. Automated test suite (`npm test`) runs programmatically and passes 100% of unit and integration tests. Mock harness validates the complete pipeline: simulated user voice/text prompt -> Gemini tool call invocation -> simulated Minecraft agent action execution -> Discord response confirmation."
2. **Discord.js & `@discordjs/voice` Audio Pipeline Specifications:**
   - Discord audio packets are 48kHz stereo 16-bit PCM compressed into Opus frames (960 samples / 20ms).
   - Receiver subscription requires `selfDeaf: false` on `joinVoiceChannel`, listening to `receiver.speaking.on('start', userId)` and subscribing with `receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 500 } })`.
   - Decoding Opus requires piping through `prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 })`.
   - Discord REST API limits channel message edits to ~5 requests per second; unthrottled edits on Minecraft tick (20 ticks/s) trigger HTTP 429 rate limit exceptions.
   - Minecraft vanilla chat packet limits length to 256 characters; sending longer strings triggers disconnects.

---

## 2. Logic Chain

1. **Slash Commands & Interaction Lifecycle:** Based on Observation 1, the bot must provide commands for status, connection management, task assignment, inventory, voice joining, and help. Because Discord interaction responses expire after 3000ms unless deferred, all commands invoking planning or network operations must issue `deferReply()` within 2.5s and catch errors cleanly to avoid Discord Error 10062.
2. **Audio Pipeline Isolation & Streaming:** Based on Observation 1 and Observation 2, audio processing requires distinct inbound (STT) and outbound (TTS) paths. Inbound speech must terminate cleanly via silence detection (500ms), filter noise (<200ms), and buffer PCM data before STT dispatch. Outbound speech requires an `AudioQueueManager` with priority preemption so critical survival alerts (e.g., mob attack, starvation) take precedence over general conversational replies.
3. **Chat Bridge Anti-Loopback & Sanitization:** Relaying chat naively results in infinite echo loops when the Minecraft server broadcasts the bot's own relayed messages back. To eliminate feedback loops, the bridge applies a triple-lock mechanism: (a) ignore self bot IDs, (b) ignore other bot accounts, and (c) an in-memory TTL hash cache (10s) that matches and suppresses recently sent messages. Furthermore, to prevent server disconnects and exploit injection, messages are sanitized, stripped of `§` formatting characters, and truncated/chunked at 256 characters.
4. **Status Embed Throttling:** Based on Observation 2, high-frequency tick updates risk HTTP 429 penalties. Enforcing a 5-second interval combined with a SHA256 state-dirty hash check ensures zero redundant Discord REST calls when the agent is idle or moving within a 1-block radius.
5. **RBAC Security Middleware:** A tiered model (`VIEWER`, `OPERATOR`, `ADMIN`) validates caller permissions via whitelist IDs and guild permissions before executing in-game tasks, protecting the Minecraft server from unauthorized tampering while keeping informational commands public.
6. **Zero-Dependency Mock Architecture:** Based on Observation 1, acceptance criteria mandate 100% CI pass rate without live credentials. Therefore, all Discord client, voice gateway, and player interactions are defined through abstract TypeScript interfaces (`IDiscordGateway`, `IVoiceSession`), enabling lightweight in-memory test mocks (`MockDiscordClient`, `MockVoiceSession`).

---

## 3. Caveats

- **Native Audio Compilation:** `@discordjs/opus` requires native build tools (node-gyp, Python, C++ compiler) which can occasionally fail in non-standard environments. The specification recommends `opusscript` fallback or mocking audio streams at the PCM buffer layer during automated CI runs.
- **Privileged Discord Intents:** `GatewayIntentBits.MessageContent` is a privileged intent requiring manual toggle in the Discord Developer Portal for live bot operations. The specification explicitly includes this requirement in `.env.example` and the verification checklist.
- No other caveats.

---

## 4. Conclusion

The specification for Requirement R1 (Discord Text, Voice & In-Game Bridge Core) has been mined and documented in full detail in:
`c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\spec_miner_survey_1\survey_report.md`

The specification contains:
- 37 rigorously probed features across 7 categories.
- 20 realistic edge cases with defined observed behaviors and recovery logic.
- Full TypeScript interface contracts for commands, voice pipelines, chat bridge, status embeds, RBAC, and mock test harnesses.
- Exhaustive `.env.example` configuration schema with type validation.
- Complete mapping to acceptance criteria.

---

## 5. Verification Method

To independently verify this specification:
1. **Inspect Report Content:**
   - Read `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\spec_miner_survey_1\survey_report.md` and check:
     - Table `## Features Discovered` (contains 37 items with Category, Description, Inputs, Outputs, Error Behavior, Discovered Via).
     - Table `## Edge Cases` (contains 20 items with Feature, Input, Observed Behavior).
     - Sections 4.1 through 4.7 covering Slash Commands, Voice Pipelines, Chat Bridge, Live Status Embeds, RBAC, Environment Config, and Testability & Mocking Architecture.
2. **Trace Acceptance Criteria:**
   - Cross-reference Section 5 Traceability Matrix against lines 47–54 and 60–63 of `ORIGINAL_REQUEST.md`.
3. **Invalidation Conditions:**
   - The specification is invalidated if Discord.js v14 API breaking changes alter SlashCommandBuilder syntax or voice gateway v4 receiver protocols, or if tests require external live Discord credentials.
