# Technical Specification & Feature Mining Report: Discord Text, Voice & In-Game Bridge Core (Requirement R1)

**Target Component:** Requirement R1 (Discord Text, Voice & In-Game Bridge Core), Access Control, Configuration, and Testability  
**Author:** spec_miner_survey_1  
**Project:** Multimodal Discord & Fair-Play Minecraft AI Bot  
**Reference Request:** `.agents/teamwork/ORIGINAL_REQUEST.md`  
**Date:** 2026-10-07  

---

## 1. Executive Summary & Architectural Overview

The Discord & In-Game Bridge Core provides the bidirectional human-agent interface between Discord users and the Minecraft survival agent. The subsystem is structured into four primary functional domains:
1. **Discord Text & Slash Commands:** Registration, lifecycle handling, rate-limiting, and error-tolerant execution of slash commands (`/status`, `/connect`, `/disconnect`, `/task`, `/stop`, `/inventory`, `/voice`, `/help`) alongside text mention handling.
2. **Interactive Two-Way Voice Channel Pipeline:** A full-duplex audio pipeline utilizing `@discordjs/voice`, `prism-media`, and Opus/PCM decoders/encoders. Inbound streams capture speech with silence detection/VAD and buffer PCM chunks for Speech-to-Text (STT). Outbound streams accept synthesized speech from Text-to-Speech (TTS), managing queueing, priority overrides (e.g. low-health warnings), and streaming audio resources to the voice channel.
3. **Bidirectional Chat Bridge:** Real-time synchronization between a configured Discord channel and Minecraft server chat. Incorporates strict anti-loopback filtering, message deduplication hash caching, character-length truncation (Minecraft 256-char limit), command injection prevention, and format sanitization.
4. **Live Status Embeds & RBAC:** Real-time visual monitoring of bot health, hunger, coordinates, active task, and equipped gear, throttled to prevent Discord HTTP 429 rate limits, guarded by a multi-tier Role-Based Access Control (RBAC) middleware.

All components are designed with strict **Dependency Injection (DI)** interfaces to permit 100% automated testing without external network connections, live Discord tokens, or active Minecraft servers.

---

## 2. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Slash Commands | `/status` Command | Displays current status embed of the Minecraft bot (health, hunger, coords, task, inventory). | `interaction` (Slash command) | Rich Status Embed (ephemeral or in-channel) | Returns error embed if bot is not initialized. | ORIGINAL_REQUEST R1/AC |
| 2 | Slash Commands | `/connect` Command | Connects the Mineflayer bot to the designated Minecraft server. | Options: `host` (opt), `port` (opt), `username` (opt) | Ephemeral confirmation & connection initiation | Rejects if already connected or unauthorized (RBAC). | ORIGINAL_REQUEST R1/AC |
| 3 | Slash Commands | `/disconnect` Command | Safely disconnects the Mineflayer bot from the Minecraft server. | None | Ephemeral confirmation message | Rejects if not connected or unauthorized (RBAC). | ORIGINAL_REQUEST R1/AC |
| 4 | Slash Commands | `/task` (or `/action`) | Issues a high-level survival command/goal to the AI planner (e.g., "gather 10 oak logs"). | Option: `goal` (string) | Ephemeral acknowledgment + task start notification | Rejects if bot is offline or user lacks Operator role. | ORIGINAL_REQUEST R1/R3 |
| 5 | Slash Commands | `/stop` Command | Aborts current pathfinding or survival task immediately and returns bot to idle state. | None | Ephemeral confirmation & status update | Returns error if bot not connected or user unauthorized. | ORIGINAL_REQUEST R1/R2 |
| 6 | Slash Commands | `/inventory` Command | Returns a detailed breakdown of items in inventory, free slots, and armor status. | None | Rich Inventory Embed | Returns error embed if bot offline. | ORIGINAL_REQUEST R1/AC |
| 7 | Slash Commands | `/voice join` Command | Joins the caller's active voice channel or configured channel to begin voice interaction. | Option: `channel` (opt) | Voice connection established, joins channel | Rejects if caller not in voice channel or missing voice permissions. | ORIGINAL_REQUEST R1/AC |
| 8 | Slash Commands | `/voice leave` Command | Leaves the current voice channel and tears down audio pipelines. | None | Voice connection destroyed | Returns warning if bot not in voice channel. | ORIGINAL_REQUEST R1/AC |
| 9 | Slash Commands | `/help` Command | Displays guide to bot commands, fair-play survival rules, and permitted actions. | None | Formatted Help Embed | None (deterministic response). | ORIGINAL_REQUEST AC |
| 10 | Command Lifecycle | Deferred Response | Automatically defers interactions (`deferReply`) when processing exceeds 2500ms. | Interaction token | Discord Loading/Thinking state | Recovers cleanly and prevents 10062 "Unknown interaction" timeout. | Discord API Spec |
| 11 | Command Registration | Guild/Global Deployer | Deploys slash commands via Discord REST API; supports fast guild-scoped deploy for dev and global deploy for prod. | `clientId`, `guildId`, `token`, command definitions | HTTP 200/201 from Discord REST | Throws formatted config error if token/IDs missing. | Discord.js REST Spec |
| 12 | Voice Receiver | User Audio Ingestion | Subscribes to speaking user audio stream via `@discordjs/voice` Receiver. | `userId`, `AudioReceiveStream` | Stream of Opus packets | Handles user muting, abrupt leaving, or packet loss gracefully. | `@discordjs/voice` Spec |
| 13 | Voice Receiver | Opus Decoding & PCM Buffer | Decodes Opus packets to raw 48kHz 16-bit stereo PCM using `prism-media`. | Inbound Opus packet stream | Raw PCM Buffer / stream | Emits stream error and cleans up decoder on corrupt packets. | `prism-media` API Spec |
| 14 | Voice Receiver | Silence Detection (VAD) | Uses `EndBehaviorType.AfterSilence` (default 500ms) to detect utterance completion. | Silence duration threshold | Utterance completion trigger | Cancels stream on timeout/inactivity without memory leaks. | `@discordjs/voice` Spec |
| 15 | Voice Receiver | Multi-Speaker Isolation | Tracks simultaneous speakers in concurrent per-user buffers without audio corruption. | Concurrent `userId` streams | Distinct user PCM buffers | Independent buffer cleanup per speaker. | Multi-user Voice Spec |
| 16 | Voice Receiver | STT Integration | Dispatches completed user audio buffer to Speech-to-Text provider (Gemini / Whisper / Mock). | Audio buffer (WAV/PCM) | Transcribed text string + confidence | Returns fallback warning if audio unintelligible or STT fails. | ORIGINAL_REQUEST R1/R3 |
| 17 | Voice Player | Audio Queue & Priority | Manages queue of outbound speech synthesis items with priority overrides for alerts. | Speech text / audio payload, priority | Sequential playback order | Discards expired non-critical queue items if queue overflows. | Audio Pipeline Spec |
| 18 | Voice Player | TTS Synthesis | Converts bot textual response or alert into spoken audio stream. | Text string, voice parameters | Audio stream (MP3/Opus/PCM) | Fallback to text channel notification if TTS service errors. | ORIGINAL_REQUEST R1 |
| 19 | Voice Player | Audio Resource Streaming | Streams audio through `@discordjs/voice` `AudioPlayer` into `VoiceConnection`. | `AudioResource` | Opus packets to Discord Voice Gateway | Handles player errors, transitions to Idle, plays next queue item. | `@discordjs/voice` Spec |
| 20 | Voice Player | State Machine Tracking | Monitors `AudioPlayer` states (`Idle`, `Buffering`, `Playing`, `Paused`, `AutoPaused`). | State change events | Synchronized status events | Emits diagnostic events on stuck buffering or stall. | `@discordjs/voice` Spec |
| 21 | Chat Bridge | Discord -> MC Relay | Relays text messages from Discord bridge channel to Minecraft server chat. | `messageCreate` event | `bot.chat("[Discord] <User>: <Text>")` | Rejects messages if Minecraft client is disconnected. | ORIGINAL_REQUEST R1 |
| 22 | Chat Bridge | MC -> Discord Relay | Relays in-game chat messages from Minecraft to Discord bridge channel. | Mineflayer `chat` event | Discord channel message / embed | Drops messages if Discord bridge channel unavailable. | ORIGINAL_REQUEST R1 |
| 23 | Chat Bridge | Loopback Prevention | Ignores bot's own Discord messages and bot's own Minecraft chat messages. | `message.author.id`, `chat.username` | Drop self-authored messages | Silently drops without processing. | ORIGINAL_REQUEST R1/AC |
| 24 | Chat Bridge | Deduplication Cache | LRU / TTL hash cache (`hash(content)`) to prevent cross-bridge echo loops. | Message content hash | Drop duplicate matching recent outbound | Drops duplicate message if seen within TTL window (10s). | Anti-Loopback Spec |
| 25 | Chat Bridge | Chat Sanitization | Strips control characters, escapes color codes (`§`), and resolves Discord mentions (`<@id>`). | Raw Discord/MC string | Clean sanitized string | Strips dangerous control chars; preserves readable text. | Chat Protocol Spec |
| 26 | Chat Bridge | Message Length Chunking | Truncates or chunks messages exceeding Minecraft's 256-character packet limit. | Discord message > 256 chars | Split messages or ellipsis-truncated string | Prevents Minecraft server kicking bot for oversized chat packets. | Vanilla Protocol Spec |
| 27 | Chat Bridge | Command Injection Guard | Ensures Discord messages relayed to Minecraft chat cannot trigger privileged/unintended slash commands. | Relayed message string | Prefixed `[Discord] <User>: ` payload | Ensures message never starts with raw `/` command syntax. | ORIGINAL_REQUEST R2 |
| 28 | Live Status Embed | Status Embed Builder | Formats real-time HP, Hunger, XYZ coords, Dimension, Task, Armor, Inventory into rich Embed. | `AgentState` snapshot | `EmbedBuilder` (Discord.js v14) | Renders fallback "Unknown/Connecting" when state partial. | ORIGINAL_REQUEST R1/AC |
| 29 | Live Status Embed | Rate Limit Throttling | Enforces minimum update interval (e.g., 3-5 seconds) to respect Discord REST rate limits. | Periodic ticker / state change | Throttled `message.edit()` | Drops rapid successive updates; queues latest state. | Discord REST Spec |
| 30 | Live Status Embed | Dirty-State Change Detection | Compares hash of current state vs previous rendered state; skips Discord edit if state is unchanged. | Current vs prior state hash | Skip unnecessary REST call | Prevents wasteful HTTP calls when bot is stationary/idle. | Performance Spec |
| 31 | Live Status Embed | Persistent Message Pin | Maintains a designated status message in `#bot-status` channel, reusing and updating in-place. | `channelId`, `messageId` | Updated in-place message | Creates new message if original message was deleted. | Discord UI Spec |
| 32 | RBAC | Permission Guard Middleware | Enforces multi-tier permissions (`Viewer`, `Operator`, `Admin`) on commands & voice requests. | Interaction user, roles, permissions | Allowed (pass) / Denied (abort) | Replies with ephemeral error: "⛔ Permission Denied". | ORIGINAL_REQUEST R1/AC |
| 33 | RBAC | Role & User Whitelist | Reads allowed role IDs and user IDs from environment variables (`DISCORD_ALLOWED_ROLE_IDS`). | Guild member roles / user snowflake | Boolean authorization flag | Defaults to deny if user not listed and lacks Admin permission. | ORIGINAL_REQUEST R1 |
| 34 | RBAC | Security Audit Logging | Logs all privileged command invocations and rejected unauthorized attempts with user/guild IDs. | Command context, user ID, decision | Structured audit log entry | Non-blocking log emission. | Security Spec |
| 35 | Configuration | Environment Validation | Loads and strictly validates all environment variables on application startup using schema validator. | `.env` file / process.env | Typed `Config` object | Halts startup with descriptive error list if required vars missing. | ORIGINAL_REQUEST AC |
| 36 | Testability | Mock Discord Client | In-memory simulator of Discord.js Client, channels, messages, and interactions. | Mock configuration | EventEmitter emitting Discord events | Zero network calls, 100% deterministic unit/integration test. | ORIGINAL_REQUEST R4/AC |
| 37 | Testability | Mock Voice Gateway | Simulates VoiceConnection, AudioReceiveStream, AudioPlayer without native Opus/UDP dependencies. | Mock audio packets / events | Event emissions & captured outputs | Allows CI testing on any OS without audio hardware. | ORIGINAL_REQUEST R4/AC |

---

## 3. Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | Slash Commands | User invokes `/task` while Minecraft bot is disconnected or dead. | Command must immediately return ephemeral error: "❌ Bot is currently disconnected from Minecraft." and not enqueue dead tasks. |
| 2 | Slash Commands | Execution of a complex planner task takes > 3000ms. | If not deferred immediately, Discord fails with Error 10062 "Unknown interaction". Must invoke `await interaction.deferReply()` within 2.5 seconds. |
| 3 | Voice Receiver | User speaks briefly (< 150ms, e.g., throat clearing or microphone tap). | PCM buffer size is below minimum speech duration threshold (< 200ms); system drops buffer to avoid wasting STT tokens on noise. |
| 4 | Voice Receiver | User speaks continuously without pausing for > 15 seconds. | Audio buffer reaches maximum safety limit; receiver forces utterance cut-off, flushes buffered speech to STT, and starts new buffer. |
| 5 | Voice Receiver | User leaves voice channel or is deafened while stream is active. | Voice receiver emits `end` or `close` on the stream; active buffer is flushed or cleaned up cleanly without memory leak. |
| 6 | Voice Receiver | Two users speak simultaneously in the voice channel. | Two distinct `AudioReceiveStream` instances are handled concurrently keyed by `userId`; each user's speech is transcribed independently. |
| 7 | Voice Player | High-priority alert (e.g., "Creeper explosion warning") generated while bot is speaking normal response. | Audio queue pauses or cancels lower-priority playback, plays high-priority alert immediately, then resumes or discards previous queue item. |
| 8 | Voice Connection | Discord voice server initiates regional migration or disconnects. | Voice connection transitions to `Disconnected`; reconnect handler awaits `Signalling`/`Connecting` within 5s backoff before destroying. |
| 9 | Chat Bridge | Discord user types message longer than 256 characters (e.g. 500 chars). | Sending >256 chars to vanilla Minecraft triggers kick. Bridge splits message into chunks (`[1/2]`, `[2/2]`) or truncates with `...`. |
| 10 | Chat Bridge | Discord user sends a message starting with `/kill @a` or `/op hacker`. | Bridge prefixes message with `[Discord] Alice: /kill @a`. Because it starts with `[Discord]`, Minecraft treats it strictly as chat, NOT a command. |
| 11 | Chat Bridge | Discord user sends a message containing formatted color codes (`§cRed text`). | Bridge strips all `§` characters to prevent server kick or unauthorized formatting exploits. |
| 12 | Chat Bridge | Discord user sends custom emojis `<:pepe:12345678>` or mentions `<@!987654321>`. | Bridge regex resolves mentions into `@Username` and custom emojis into `:emoji_name:` for human readability in Minecraft chat. |
| 13 | Chat Bridge | Bot sends message to Minecraft; Minecraft server broadcasts it back. | Direct loopback is filtered by `username === bot.username`. Cross-bridge echo is filtered by the deduplication hash cache. |
| 14 | Chat Bridge | Rapid burst of 20 Discord messages in 1 second. | Minecraft server kicks players for chat spam. Bridge applies a leaky-bucket queue (max 2 messages/sec) to throttle outbound chat packets. |
| 15 | Live Status Embed | Bot moves continuously while pathfinding (updating coordinates 20 times/sec). | If status embed edits on every coordinate change, Discord returns HTTP 429 (Rate Limited). Throttle limiter updates at most once every 3-5 seconds. |
| 16 | Live Status Embed | Status embed message in Discord is manually deleted by a channel moderator. | Status updater catches Discord API Error 10008 "Unknown Message", resets `statusMessageId = null`, and creates a new status message on next tick. |
| 17 | RBAC | Non-whitelisted user attempts to run `/connect` or `/task`. | Command guard aborts execution before calling agent engine, logs security audit event, and replies with ephemeral "⛔ Permission Denied". |
| 18 | RBAC | Discord server Owner or Administrator runs a command even if not explicitly in `ALLOWED_ROLE_IDS`. | RBAC checks `member.permissions.has(PermissionFlagsBits.Administrator)` and grants access automatically. |
| 19 | Configuration | Required environment variable (e.g. `DISCORD_BOT_TOKEN`) is missing or whitespace-only. | Config loader fails fast during pre-flight boot, printing clear validation failure and exiting with non-zero status code. |
| 20 | Testability | Tests run on CI server without audio output devices or GPU. | MockVoiceGateway and MockAudioPlayer operate purely on EventEmitter / stream abstractions in Node.js memory without hardware dependencies. |

---

## 4. Deep-Dive Specification by Focus Area

### 4.1 Discord Text & Slash Commands Architecture

#### 4.1.1 Command Inventory & Option Schema

```typescript
export interface CommandDefinition {
  name: string;
  description: string;
  tier: 'VIEWER' | 'OPERATOR' | 'ADMIN';
  builder: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction, context: BotContext) => Promise<void>;
}
```

The bot shall expose the following standard slash commands:
1. `/status`:
   - Description: "View the real-time survival status, health, location, and inventory of the bot."
   - Tier: `VIEWER`
   - Options: None.
2. `/connect`:
   - Description: "Connect the Minecraft survival agent to a server."
   - Tier: `ADMIN`
   - Options:
     - `host` (string, optional): Server hostname/IP (defaults to env `MINECRAFT_HOST`).
     - `port` (integer, optional): Server port (defaults to env `MINECRAFT_PORT`).
     - `username` (string, optional): Bot in-game username (defaults to env `MINECRAFT_USERNAME`).
3. `/disconnect`:
   - Description: "Disconnect the Minecraft survival agent from the server."
   - Tier: `ADMIN`
   - Options: None.
4. `/task`:
   - Description: "Assign an autonomous survival task or goal to the Minecraft agent."
   - Tier: `OPERATOR`
   - Options:
     - `prompt` (string, required): Natural language goal (e.g., "gather 10 oak logs", "follow Alice", "build dirt shelter").
5. `/stop`:
   - Description: "Immediately halt all active actions, pathfinding, and planning tasks."
   - Tier: `OPERATOR`
   - Options: None.
6. `/inventory`:
   - Description: "Display current inventory contents, equipped gear, and free capacity."
   - Tier: `VIEWER`
   - Options: None.
7. `/voice`:
   - Subcommand `join`:
     - Description: "Join the caller's voice channel or designated channel."
     - Tier: `OPERATOR`
     - Options: `channel` (channel, optional, must be GuildVoice).
   - Subcommand `leave`:
     - Description: "Leave the active voice channel."
     - Tier: `OPERATOR`
     - Options: None.
8. `/help`:
   - Description: "Display command list, fair-play survival rules, and bot usage guide."
   - Tier: `VIEWER`
   - Options: None.

#### 4.1.2 Command Registration & Lifecycle Management
- **Guild Deployment vs Global Deployment:**
  - When `DISCORD_GUILD_ID` is defined in environment variables, commands are deployed immediately to that specific guild via `Routes.applicationGuildCommands(clientId, guildId)`. This provides instant updates for development and testing.
  - When `DISCORD_GUILD_ID` is omitted, commands are deployed globally via `Routes.applicationCommands(clientId)`.
- **Interaction Execution Lifecycle:**
  1. Receive `interactionCreate` event. Verify `interaction.isChatInputCommand()`.
  2. Lookup command by `interaction.commandName`. If unknown, return ephemeral warning.
  3. Execute **RBAC Middleware**: check if `interaction.member` meets `command.tier`. If unauthorized, reply ephemeral ⛔ and return.
  4. Deferral Guard: If command involves network I/O, planning, or Mineflayer queries (e.g. `/task`, `/status`, `/connect`), call `await interaction.deferReply({ ephemeral: isEphemeral })`.
  5. Execute `command.execute(interaction, context)`.
  6. On success: Edit reply or follow up.
  7. On error: Catch exception, log error stack with context, and dispatch user-friendly error message:
     ```typescript
     if (interaction.deferred || interaction.replied) {
       await interaction.editReply({ content: '❌ An error occurred while executing this command.' });
     } else {
       await interaction.reply({ content: '❌ An error occurred while executing this command.', ephemeral: true });
     }
     ```

#### 4.1.3 Text Mention & Direct Channel Control
- If a message in a designated bot control channel (`DISCORD_CONTROL_CHANNEL_ID`) directly mentions the bot (`<@BOT_ID> do something...`), the bot extracts the prompt, validates RBAC, and routes the request into the same AI planning pipeline as `/task`.

---

### 4.2 Voice Channel Audio Pipelines

#### 4.2.1 Voice Connection Lifecycle
- **Connection Creation:**
  ```typescript
  import { joinVoiceChannel, VoiceConnectionStatus, entersState } from '@discordjs/voice';

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false, // MANDATORY: Must be false to receive user audio
    selfMute: false, // MANDATORY: Must be false to play synthesized speech
  });
  ```
- **Reconnection & Health Monitor:**
  - Listen to `connection.on(VoiceConnectionStatus.Disconnected)`.
  - Perform a 5-second race against `VoiceConnectionStatus.Signalling` and `Connecting` to handle voice server transitions smoothly without tearing down state prematurely.
  - If reconnect fails after timeout, trigger clean connection destruction: `connection.destroy()`.

#### 4.2.2 Voice Receiver Pipeline (STT)
1. **Speaking Event Detection:**
   ```typescript
   connection.receiver.speaking.on('start', (userId) => {
     handleUserSpeakingStart(userId);
   });
   ```
2. **Audio Subscription & Silence Truncation:**
   - Subscribe to the user's Opus stream with silence-based termination:
     ```typescript
     const opusStream = connection.receiver.subscribe(userId, {
       end: {
         behavior: EndBehaviorType.AfterSilence,
         duration: 500, // 500ms silence threshold marks end of utterance
       },
     });
     ```
3. **Opus to PCM Decoding:**
   - Pipe Opus chunks into `prism.opus.Decoder`:
     ```typescript
     import prism from 'prism-media';

     const decoder = new prism.opus.Decoder({
       frameSize: 960,
       channels: 2,
       rate: 48000,
     });
     opusStream.pipe(decoder);
     ```
4. **Buffering & Voice Activity Detection (VAD):**
   - Collect PCM chunks into an in-memory buffer:
     ```typescript
     const chunks: Buffer[] = [];
     decoder.on('data', (chunk: Buffer) => {
       chunks.push(chunk);
       // Safety guard: max 15 seconds of audio buffer to prevent memory exhaustion
       if (totalBytes > 48000 * 2 * 2 * 15) {
         opusStream.destroy();
       }
     });
     ```
   - On `end` event:
     - Total duration check: calculate `durationMs = totalBytes / (48 * 2 * 2)`.
     - If `durationMs < 200ms`, discard as acoustic noise (mouth click, cough).
     - Otherwise, package PCM buffer into a standard 16-bit PCM WAV container (adding 44-byte WAV header).
5. **Speech-to-Text Dispatch:**
   - Forward WAV buffer to `AudioTranscriptionService` (interface `ISTTService`).
   - Transcription engine (Gemini multimodal audio or local/mock STT) returns text.
   - Dispatch transcribed utterance to agent intent parser:
     `emit('voiceCommand', { userId, username, text })`.

#### 4.2.3 Voice Player Pipeline (TTS)
1. **Speech Synthesis:**
   - Input: String from agent response or urgent survival alert.
   - Dispatched to `SpeechSynthesisService` (interface `ITTSService`).
   - Generates readable audio stream (Opus, Ogg, or MP3/PCM).
2. **Audio Resource Construction:**
   ```typescript
   import { createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } from '@discordjs/voice';

   const resource = createAudioResource(audioStream, {
     inputType: StreamType.Arbitrary,
     inlineVolume: true,
   });
   resource.volume?.setVolume(1.0);
   ```
3. **Audio Queue & Priority Scheduler:**
   - Class `AudioQueueManager` maintains an internal queue:
     ```typescript
     interface QueueItem {
       id: string;
       priority: 'NORMAL' | 'HIGH' | 'CRITICAL';
       text: string;
       resource: AudioResource;
     }
     ```
   - When an item with `priority === 'CRITICAL'` arrives (e.g. "Low health! Running to shelter!"), the active playback is stopped (`player.stop(true)`), and the critical resource plays immediately.
   - Normal responses are played sequentially.
4. **Playback Lifecycle:**
   - Listen to `player.on(AudioPlayerStatus.Idle)`: dequeue and play next item.
   - Listen to `player.on('error')`: log error, clean up resource, proceed to next item in queue.

---

### 4.3 Bidirectional Chat Bridge Architecture

#### 4.3.1 Discord to Minecraft Relay
- **Trigger:** Discord `messageCreate` event.
- **Filtering Rules:**
  1. `message.channel.id === config.DISCORD_CHAT_BRIDGE_CHANNEL_ID`: Only process messages in the designated bridge channel.
  2. `message.author.id !== client.user.id`: Never process messages sent by the bot itself.
  3. `!message.author.bot`: Ignore all other bot accounts to avoid multi-bot loops.
  4. `message.content.trim().length > 0`: Ignore empty messages (e.g. embeds without text).
- **Sanitization & Transformation:**
  1. Strip section sign formatting characters: `content.replace(/§[0-9a-fk-or]/gi, '')`.
  2. Strip control characters: `content.replace(/[\x00-\x1F\x7F]/g, ' ')`.
  3. Resolve user mentions: `<@!?(\d+)>` -> `@Username`.
  4. Resolve channel mentions: `<#(\d+)>` -> `#channel-name`.
  5. Format prefix: `const formatted = `[Discord] ${authorName}: ${cleanText}``.
  6. Length Truncation: Vanilla Minecraft chat packet max length is 256 characters. If `formatted.length > 256`, truncate to 253 characters and append `...`.
- **Deduplication Registration:**
  - Compute MD5 hash: `hash = createHash('md5').update(cleanText.trim().toLowerCase()).digest('hex')`.
  - Store `hash` in `outboundDiscordHashes` TTL cache (TTL: 10,000ms).
- **Dispatch:**
  - Call `mineflayerBot.chat(formatted)`.

#### 4.3.2 Minecraft to Discord Relay
- **Trigger:** Mineflayer `bot.on('chat', (username, message))`.
- **Filtering Rules:**
  1. `username !== bot.username`: Never relay messages where author is the bot itself.
  2. Check `outboundDiscordHashes`: If `outboundDiscordHashes.has(hash(message))`, this is an echo of a message we sent from Discord. **Drop immediately.**
- **Formatting:**
  - Format Discord message: `**[Minecraft] <${username}>** ${message}`.
  - Or use a Discord Webhook if configured, sending with the player's username and Minecraft avatar (`https://minotar.net/avatar/${username}/64.png`).
- **Deduplication Registration:**
  - Store hash in `outboundMinecraftHashes` TTL cache.
- **Dispatch:**
  - Send message to `DISCORD_CHAT_BRIDGE_CHANNEL_ID`.

#### 4.3.3 System Events Relay
- **Player Death:**
  - Hook into Mineflayer `messagestr` or death event:
  - If message matches death patterns (e.g., "Player was slain by Zombie"), relay to Discord with `💀 **[Minecraft]** ${deathMessage}`.
- **Player Join / Leave:**
  - Hook into player join/leave events:
  - Relay: `👋 **[Minecraft]** ${player} joined the game.` / `🚪 **[Minecraft]** ${player} left the game.`

---

### 4.4 Live Status Embeds & Throttling Safety

#### 4.4.1 Embed Design & Visual Indicators

```typescript
export function buildStatusEmbed(state: BotState): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`🎮 Minecraft Agent Status: ${state.username}`)
    .setTimestamp();

  // Dynamic status color based on health & connection
  if (!state.connected) {
    embed.setColor(0x95a5a6); // Grey
    embed.setDescription('🔴 **Offline / Disconnected from server**');
    return embed;
  }

  if (state.health > 15) {
    embed.setColor(0x2ecc71); // Green
  } else if (state.health > 7) {
    embed.setColor(0xf1c40f); // Yellow / Warning
  } else {
    embed.setColor(0xe74c3c); // Red / Danger
  }

  // Health and Hunger Bars (10 segment visual bar)
  const healthBar = generateBar(state.health, 20, '❤️', '🤍');
  const hungerBar = generateBar(state.food, 20, '🍗', '▫️');

  embed.addFields(
    { name: '💖 Health', value: `${healthBar} ${state.health.toFixed(1)}/20`, inline: true },
    { name: '🍗 Hunger', value: `${hungerBar} ${state.food}/20`, inline: true },
    { name: '🧭 Coordinates', value: `\`X: ${state.pos.x.toFixed(1)}, Y: ${state.pos.y.toFixed(1)}, Z: ${state.pos.z.toFixed(1)}\` (${state.dimension})`, inline: false },
    { name: '📋 Active Task', value: state.currentTask || 'Idle - Standing by', inline: false },
    { name: '⚔️ Equipped Gear', value: `Main: \`${state.gear.mainHand}\` | Off: \`${state.gear.offHand}\` | Armor: \`${state.gear.armorSummary}\``, inline: false },
    { name: '🎒 Inventory', value: `Used: ${state.inventory.usedSlots}/36 slots | Free: ${state.inventory.freeSlots}`, inline: true },
    { name: '🌐 Server', value: `\`${state.serverHost}:${state.serverPort}\` (Ping: ${state.ping}ms)`, inline: true }
  );

  return embed;
}
```

#### 4.4.2 Discord Rate Limit Mitigation & Dirty-State Checking
- **Discord REST Limits:** Discord enforces strict rate limits on channel message edits (maximum 5 requests per second per channel, with burst limits). Updating on every game tick (20 ticks/sec) would trigger HTTP 429 and rate-limit bans.
- **Update Frequency:** A configurable timer runs every `STATUS_EMBED_INTERVAL_SEC` (default: 5.0 seconds).
- **Dirty Checking Algorithm:**
  ```typescript
  function computeStateHash(state: BotState): string {
    return createHash('sha256')
      .update(JSON.stringify({
        connected: state.connected,
        hp: Math.round(state.health * 2) / 2, // Round to nearest 0.5
        food: state.food,
        pos: [Math.round(state.pos.x), Math.round(state.pos.y), Math.round(state.pos.z)], // 1-block threshold
        task: state.currentTask,
        gear: state.gear,
        usedSlots: state.inventory.usedSlots,
      }))
      .digest('hex');
  }
  ```
  - If `currentStateHash === previousStateHash`, the edit operation is completely skipped.
- **Persistent Message Management:**
  - The status reporter tracks `statusMessageId`.
  - On startup or `/status` initialization, it fetches the existing message in `DISCORD_STATUS_CHANNEL_ID`.
  - If not found or deleted (Discord Error 10008), it creates a new message and pins/saves the ID.
  - Updates perform `await statusMessage.edit({ embeds: [embed] })`.

---

### 4.5 Role-Based Access Control (RBAC) Architecture

#### 4.5.1 Access Tiers
1. **`VIEWER` (Public):**
   - Commands: `/status`, `/inventory`, `/help`.
   - Activities: Reading live status embed, sending messages in chat bridge.
   - Permissions: Anyone in the Discord guild.
2. **`OPERATOR` (Game Controller):**
   - Commands: `/task`, `/action`, `/stop`, `/voice join`, `/voice leave`, voice speech control.
   - Activities: Commanding bot in-game actions, issuing mining/combat/movement goals.
   - Permissions: Users whose ID is in `DISCORD_ALLOWED_USER_IDS`, or users possessing any role listed in `DISCORD_ALLOWED_ROLE_IDS`, or users with `Administrator` permission.
3. **`ADMIN` (Bot Administrator):**
   - Commands: `/connect`, `/disconnect`, reload configuration, shutdown.
   - Permissions: Users whose ID is in `DISCORD_ADMIN_USER_IDS`, or users possessing any role listed in `DISCORD_ADMIN_ROLE_IDS`, or guild owners / `Administrator`.

#### 4.5.2 Permission Verification Middleware

```typescript
export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

export class RBACService {
  constructor(private config: AppConfig) {}

  public checkPermission(member: GuildMember | null, user: User, tier: 'VIEWER' | 'OPERATOR' | 'ADMIN'): PermissionResult {
    if (tier === 'VIEWER') {
      return { allowed: true };
    }

    // Server Administrator bypass
    if (member && member.permissions.has(PermissionFlagsBits.Administrator)) {
      return { allowed: true };
    }

    if (tier === 'ADMIN') {
      if (this.config.adminUserIds.includes(user.id)) return { allowed: true };
      if (member && member.roles.cache.some(r => this.config.adminRoleIds.includes(r.id))) return { allowed: true };
      return { allowed: false, reason: 'Requires Admin privileges.' };
    }

    if (tier === 'OPERATOR') {
      if (this.config.adminUserIds.includes(user.id) || this.config.allowedUserIds.includes(user.id)) {
        return { allowed: true };
      }
      if (member) {
        const hasRole = member.roles.cache.some(r =>
          this.config.adminRoleIds.includes(r.id) || this.config.allowedRoleIds.includes(r.id)
        );
        if (hasRole) return { allowed: true };
      }
      return { allowed: false, reason: 'Requires Operator role to command the Minecraft agent.' };
    }

    return { allowed: false, reason: 'Unauthorized.' };
  }
}
```

---

### 4.6 Clean Environment Configuration Specification

#### 4.6.1 Configuration Schema (.env.example)

```env
# ==============================================================================
# DISCORD & MINECRAFT AGENT CONFIGURATION
# ==============================================================================

# ------------------------------------------------------------------------------
# 1. Discord Bot Credentials & Scope
# ------------------------------------------------------------------------------
# Discord Bot Token from Discord Developer Portal (Required)
DISCORD_BOT_TOKEN=your_discord_bot_token_here

# Application Client ID from Discord Developer Portal (Required)
DISCORD_CLIENT_ID=123456789012345678

# Discord Guild ID for instant development slash command registration (Optional)
# If omitted, slash commands are deployed globally across all guilds.
DISCORD_GUILD_ID=123456789012345678

# ------------------------------------------------------------------------------
# 2. Discord Channel IDs
# ------------------------------------------------------------------------------
# Channel ID for Bidirectional Minecraft <-> Discord chat relay (Required for bridge)
DISCORD_CHAT_BRIDGE_CHANNEL_ID=123456789012345678

# Channel ID for persistent live status embeds (Optional, falls back to manual /status)
DISCORD_STATUS_CHANNEL_ID=123456789012345678

# Default Voice Channel ID for voice bot to join (Optional)
DISCORD_VOICE_CHANNEL_ID=123456789012345678

# ------------------------------------------------------------------------------
# 3. Role-Based Access Control (RBAC)
# ------------------------------------------------------------------------------
# Comma-separated list of Discord Role IDs allowed to execute in-game tasks (/task, voice)
DISCORD_ALLOWED_ROLE_IDS=123456789012345678,234567890123456789

# Comma-separated list of Discord User IDs allowed to execute in-game tasks
DISCORD_ALLOWED_USER_IDS=345678901234567890

# Comma-separated list of Discord Role/User IDs allowed to run admin commands (/connect, /disconnect)
DISCORD_ADMIN_ROLE_IDS=123456789012345678
DISCORD_ADMIN_USER_IDS=345678901234567890

# ------------------------------------------------------------------------------
# 4. Minecraft Server Connection
# ------------------------------------------------------------------------------
MINECRAFT_HOST=localhost
MINECRAFT_PORT=25565
MINECRAFT_USERNAME=DiscordSurvivalBot
MINECRAFT_VERSION=1.20.4
MINECRAFT_AUTH=offline

# ------------------------------------------------------------------------------
# 5. Gemini AI & Audio Pipelines
# ------------------------------------------------------------------------------
# Google Gemini API Key for planning and audio STT/TTS (Required for AI actions)
GEMINI_API_KEY=AIzaSyYourGeminiApiKeyHere

# Duration of silence in milliseconds before concluding user voice utterance (Default: 500)
VOICE_STT_SILENCE_DURATION_MS=500

# Minimum voice utterance length in milliseconds (Default: 250)
VOICE_MIN_UTTERANCE_MS=250

# Voice audio synthesis model / voice name (Default: en-US-Standard-C)
VOICE_TTS_VOICE_NAME=en-US-Standard-C

# ------------------------------------------------------------------------------
# 6. Status Embed & Throttling
# ------------------------------------------------------------------------------
# Interval in seconds between status embed edits (Default: 5)
STATUS_EMBED_INTERVAL_SEC=5

# ------------------------------------------------------------------------------
# 7. Logging & Diagnostics
# ------------------------------------------------------------------------------
# Log level: 'debug' | 'info' | 'warn' | 'error'
LOG_LEVEL=info
```

#### 4.6.2 Startup Schema Validation
- The application implements strict schema validation on startup using Zod or equivalent TypeScript validator.
- If mandatory keys (`DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`) are absent, the application emits a formatted diagnostic message and exits with status code `1` before opening network sockets.

---

### 4.7 Testability & Mocking Architecture

Requirement R4 dictates that the test suite (`npm test`) must run 100% programmatically in CI without requiring live external secrets or Discord/Minecraft network servers.

#### 4.7.1 Service Interfaces (Dependency Inversion)
To achieve isolation, all Discord interactions depend on abstract contracts:

```typescript
export interface IDiscordGateway {
  on(event: string, listener: (...args: any[]) => void): this;
  sendMessage(channelId: string, payload: MessagePayloadOptions): Promise<SentMessage>;
  editMessage(channelId: string, messageId: string, payload: MessageEditOptions): Promise<SentMessage>;
  fetchChannel(channelId: string): Promise<Channel | null>;
  joinVoice(channelId: string): Promise<IVoiceSession>;
  leaveVoice(): Promise<void>;
}

export interface IVoiceSession {
  connectionStatus: VoiceConnectionStatus;
  subscribeSpeaker(userId: string): Readable;
  playAudio(resource: Readable | Buffer): Promise<void>;
  stopAudio(): void;
  destroy(): void;
}
```

#### 4.7.2 Mock Discord Client Implementation
- **`MockDiscordClient`**: An EventEmitter that simulates:
  - Registering commands.
  - Simulating inbound slash commands:
    ```typescript
    await mockClient.simulateSlashCommand({
      name: 'status',
      user: { id: 'user_123', tag: 'Alice#0001' },
      roles: ['role_operator'],
      options: {},
    });
    ```
  - Simulating incoming chat messages in `DISCORD_CHAT_BRIDGE_CHANNEL_ID`:
    ```typescript
    await mockClient.simulateUserMessage({
      channelId: 'bridge_channel_1',
      author: { id: 'user_456', username: 'Bob', bot: false },
      content: 'Hello Minecraft!',
    });
    ```
  - Recording outbound messages sent by the bot to verify chat bridge and status embeds:
    ```typescript
    expect(mockClient.getSentMessages('bridge_channel_1')).toContainEqual(
      expect.objectContaining({ content: expect.stringContaining('Bob: Hello Minecraft!') })
    );
    ```

#### 4.7.3 Mock Voice Connection & Stream Simulator
- **`MockVoiceSession`**:
  - Does NOT bind UDP sockets or initialize native `@discordjs/opus` binaries.
  - Can be commanded by test code to simulate a user speaking:
    ```typescript
    const userAudioStream = mockVoiceSession.simulateUserSpeaking('user_123');
    userAudioStream.emit('data', createMockOpusPacket());
    userAudioStream.emit('end'); // Simulates silence trigger
    ```
  - Verifies that STT service receives the audio and dispatches the transcribed text.
  - Captures TTS playback buffer to verify correct synthesis and playback duration.

#### 4.7.4 Comprehensive Unit & Integration Test Matrix

```
tests/
├── unit/
│   ├── discord/
│   │   ├── commands.test.ts          # Validates slash command definitions, options & errors
│   │   ├── rbac.test.ts              # Validates Viewer/Operator/Admin permissions
│   │   ├── bridge.test.ts            # Validates sanitization, dedup, truncation, loopback
│   │   ├── status_embed.test.ts      # Validates embed generation, dirty-check, throttling
│   │   └── config.test.ts            # Validates environment variable schema validation
│   └── voice/
│       ├── receiver.test.ts          # Validates Opus decoding, silence duration, VAD filtering
│       ├── player.test.ts            # Validates AudioQueue, priorities, state transitions
│       └── tts_stt_mock.test.ts      # Validates mock speech transcription and synthesis
└── integration/
    ├── bridge_e2e.test.ts            # Simulated Discord message -> Minecraft chat -> verify output
    ├── voice_to_command.test.ts      # Simulated voice PCM -> STT -> Command pipeline -> Response
    └── status_lifecycle.test.ts      # Simulated health/hunger updates -> embed throttle -> edit call
```

---

## 5. Acceptance Criteria Traceability Matrix

| Original Request Acceptance Criterion | Specified Component | Verification Method |
|---|---|---|
| Slash commands for bot status, server connection, and Minecraft tasks are registered and respond accurately. | Section 4.1 (`/status`, `/connect`, `/disconnect`, `/task`, `/stop`, `/inventory`, `/voice`, `/help`) | Unit & integration tests simulating commands via `MockDiscordClient` verifying responses. |
| Role-based access control enforces permission checks on sensitive bot control commands. | Section 4.5 (`RBACService`, Tier enforcement on `/task`, `/connect`, voice) | Unit tests verifying Viewer/Operator/Admin boundaries, whitelists, and ephemeral rejections. |
| Bidirectional chat bridge relays messages between Discord and Minecraft server chat without duplication or feedback loops. | Section 4.3 (Message sanitization, self-ID check, deduplication hash cache) | Integration test simulating Discord message -> Minecraft echo -> verify no re-broadcast to Discord. |
| Live status embed accurately displays real-time health, hunger, position, active task, and inventory overview. | Section 4.4 (`buildStatusEmbed`, health/hunger visual bars, dimension, task) | Unit tests rendering embed with mock BotState, asserting field values and colors. |
| Voice receiver pipeline accurately ingests and buffers audio streams from users in a voice channel. | Section 4.2 (`VoiceReceiver`, `prism-media` decoder, silence VAD buffer) | Unit tests streaming mock Opus packets, verifying complete PCM assembly and VAD cut-off. |
| Voice player pipeline generates and streams synthetic audio into the voice channel. | Section 4.2 (`VoicePlayer`, `AudioQueueManager`, `createAudioResource`) | Unit tests generating TTS output, asserting player transitions and queue processing. |
| `.env.example` provides explicit documentation for all required settings. | Section 4.6 (Complete documented schema with credentials, IDs, ports, timeouts) | Automated config test verifying `.env.example` contains all keys defined in config schema. |
| Automated verification harness can run in CI without live external secrets or servers. | Section 4.7 (`MockDiscordClient`, `MockVoiceSession`, `MockMineflayerBot`) | 100% CI pass rate without network access or valid API tokens. |

---

## 6. Implementation Guidance & Technical Recommendations

1. **Strict TypeScript Typing:** Use Discord.js v14 (`discord.js`), `@discordjs/voice`, and `@discordjs/builders` with full strict type checking (`"strict": true` in `tsconfig.json`).
2. **Audio Dependencies:** In Node.js environments, `@discordjs/opus` requires native compilation tools. To maintain seamless cross-platform CI testability without build failures, provide fallback to `opusscript` or pure-mock streams in test suites.
3. **Gateway Intents:** When initializing `new Client({ intents: [...] })`, explicitly include:
   - `GatewayIntentBits.Guilds`
   - `GatewayIntentBits.GuildMessages`
   - `GatewayIntentBits.MessageContent` (Privileged intent — must document toggle in setup guide)
   - `GatewayIntentBits.GuildVoiceStates`
4. **Chat Bridge Anti-Spam:** Ensure rate limiting on the Minecraft bridge side. While Discord allows 5 messages per 5 seconds, vanilla Minecraft servers may kick clients sending more than 3-5 chat packets per second. A token bucket with 2 messages/second sustained rate is recommended.
5. **Clean Shutdown:** Register `process.on('SIGINT')` and `SIGTERM` to gracefully destroy voice connections (`connection.destroy()`), save pending state, and notify Discord status channel before exiting.
