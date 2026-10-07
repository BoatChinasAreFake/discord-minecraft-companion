# Multimodal Discord & Fair-Play Minecraft Agent Companion

A decoupled multimodal Discord bot and fair-play Minecraft survival companion powered by the Google Gemini AI planning engine (`@google/genai`).

## Features (Milestone 1)

- **Discord Slash Commands Engine**: 8 comprehensive slash commands (`/status`, `/connect`, `/disconnect`, `/task`, `/stop`, `/inventory`, `/voice`, `/help`) backed by automatic 2.5-second interaction deferral.
- **Role-Based Access Control (RBAC)**: 3-tier security model (`VIEWER`, `OPERATOR`, `ADMIN`) with user and role snowflake whitelisting and Discord `Administrator` bypass.
- **Audio Pipelines (Full-Duplex Voice)**:
  - **Inbound Voice Receiver**: User speech capture via `@discordjs/voice`, Opus-to-PCM decoding with `prism-media`, and acoustic RMS Voice Activity Detection (VAD).
  - **Decoupled STT & TTS**: Pluggable `MockSTTProvider` / `GeminiSTTProvider` and `MockTTSProvider` / `GeminiTTSProvider`.
  - **Priority Audio Queue Manager**: Priority levels (`EMERGENCY`, `HIGH`, `NORMAL`, `LOW`) with $< 50$ms preemption for critical survival alerts.
- **Bidirectional Chat Bridge**:
  - Real-time relay between Discord text channels and Minecraft server chat.
  - **Triple-Lock Anti-Loopback Filter**: Self-ID check, bot account check, and 10-second TTL SHA-256 hash deduplication.
  - Formatting sanitization, mention resolution, and 256-character packet chunking.
- **Live Status Embed Generator**:
  - Visual 10-segment emoji progress bars for health (`❤️`/`🤍`) and hunger (`🍗`/`▫️`).
  - Dynamic status colors (Green, Yellow, Red, Gray).
  - 5-second interval throttling with SHA-256 dirty-state hashing and Discord Error 10008 automatic self-healing.

## Prerequisites

- **Node.js**: v20+ (Tested on Node.js v24)
- **NPM**: v10+

## Installation

```powershell
npm.cmd install
```

## Build

Compile TypeScript source code to `./dist` using ES2022 / NodeNext:

```powershell
npm.cmd run build
```

## Testing (100% Offline with In-Memory Mocks)

Run the automated Vitest test suite with zero external secrets or network dependencies:

```powershell
npm.cmd test
```

## Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```powershell
Copy-Item .env.example .env
```

Key environment variables:
- `DISCORD_BOT_TOKEN`: Discord Bot Token.
- `DISCORD_CLIENT_ID`: Discord Application Client ID.
- `DISCORD_CHAT_BRIDGE_CHANNEL_ID`: Channel ID for text chat relay.
- `GEMINI_API_KEY`: Google AI Studio API key.
- `MINECRAFT_HOST` / `MINECRAFT_PORT`: Target Minecraft server address.
