# Multimodal Discord & Fair-Play Minecraft AI Companion

A decoupled multimodal Discord bot and fair-play Minecraft Java survival companion powered by the Google Gemini AI planning engine (`gemini-3.8-flash` via `@google/genai` >= 2.3.0).

---

## System Architecture

```
                   ┌────────────────────────────────────────┐
                   │             Discord Client             │
                   │  - Slash Commands & Text (/task, etc.) │
                   │  - Voice Gateway (Receiver & Player)   │
                   └───────┬────────────────────────▲───────┘
                           │                        │
               Inbound Audio / Text         Outbound TTS / Status Embeds
                           │                        │
                           ▼                        │
                   ┌────────────────────────────────┴───────┐
                   │           Agent Coordinator            │
                   │  - RBAC & Interaction Dispatch         │
                   │  - Bidirectional Chat Bridge (Anti-Loop)│
                   │  - Status Embed State & Throttling     │
                   └───────┬────────────────────────▲───────┘
                           │                        │
                   User Intent / Audio      Plan Progress / Events
                           │                        │
                           ▼                        │
                   ┌────────────────────────────────┴───────┐
                   │     Gemini AI Planning Engine          │
                   │  - @google/genai + gemini-3.8-flash    │
                   │  - 9 Structured Fair-Play Tools        │
                   │  - Multi-Turn Execution & Tool Results │
                   └───────┬────────────────────────▲───────┘
                           │                        │
                 Validated Tool Calls       Execution Results
                           │                        │
                           ▼                        │
                   ┌────────────────────────────────┴───────┐
                   │   Minecraft Gameplay Agent Engine      │
                   │  - Perception (Raycast, Anti-Xray, FOV)│
                   │  - Physical Limits (Reach <= 4.5m)     │
                   │  - Command Sanitizer (No OP Commands)  │
                   │  - Pathfinding, Mining, Crafting, Combat│
                   │  - Survival Loops (Eat, Sleep, Equip)  │
                   └────────────────────────────────────────┘
```

---

## Key Features

### 1. Discord Text, Slash Commands & RBAC
- **8 Slash Commands**:
  - `/status` (VIEWER): Displays live health, hunger, coordinates, active task, equipped gear, and inventory overview.
  - `/inventory` (VIEWER): Inspects detailed inventory slots, armor, and off-hand items.
  - `/help` (VIEWER): Displays command directory and RBAC permissions.
  - `/task <goal>` (OPERATOR): Assigns natural language survival goals to the AI companion.
  - `/stop` (OPERATOR): Emergency halt on active tasks, pathfinding, digging, and audio playback.
  - `/voice <join|leave>` (OPERATOR): Commands the companion to join or leave the voice channel.
  - `/connect [host] [port] [username]` (ADMIN): Connects the bot to a Minecraft Java server.
  - `/disconnect` (ADMIN): Disconnects the bot from the Minecraft server.
- **3-Tier Role-Based Access Control (RBAC)**: `VIEWER`, `OPERATOR`, and `ADMIN` with snowflake whitelisting and Discord `Administrator` bypass.
- **Auto-Deferral Guard**: Automatic 2.5-second interaction deferral preventing Discord interaction timeout errors (Error 10062).

### 2. Full-Duplex Voice Pipelines (STT & TTS)
- **Voice Receiver**: User Opus capture via `@discordjs/voice`, Opus-to-PCM decoding, and acoustic RMS Voice Activity Detection (VAD).
- **Decoupled STT & TTS**: Pluggable Speech-to-Text and Text-to-Speech providers with Google Gemini SDK support and offline mocks.
- **Priority Audio Queue**: Priority levels (`EMERGENCY` = 0, `HIGH` = 1, `NORMAL` = 2, `LOW` = 3) with preemption (< 50ms) for critical survival alerts.
- **Voice Emergency Interrupt**: Speaking "stop", "halt", "cancel", or "abort" immediately halts active in-game tasks and purges non-emergency audio.

### 3. Bidirectional Chat Bridge
- **Real-Time Relay**: Relays messages between Discord chat bridge channel and Minecraft server chat.
- **Triple-Lock Anti-Loopback Filter**:
  1. *Lock 1 (Self-ID)*: Drops messages originating from bot Discord ID or bot Minecraft username.
  2. *Lock 2 (Bot Accounts & Prefix)*: Drops Discord bot accounts and in-game messages prefixed with `[Discord]`.
  3. *Lock 3 (10s TTL Hash Deduplication)*: SHA-256 normalized hash cache detects and drops server echo broadcasts.
- **Chunking & Sanitization**: Strips dangerous control codes and section signs (`§`), escapes `@everyone`/`@here`, and splits messages > 256 characters into indexed chunks (`[1/2]`).

### 4. Live Status Embeds
- **Dynamic Emoji Progress Bars**: 10-segment health (`❤️`/`🤍`) and hunger (`🍗`/`▫️`) visual indicators.
- **Throttling & Dirty-State Hashing**: 5-second interval throttling with SHA-256 state hashing preventing Discord HTTP 429 rate limits.
- **Self-Healing**: Automatically recreates pinned status embed if deleted (Discord Error 10008).

### 5. Minecraft Fair-Play Survival Engine
- **Strict Anti-Cheat / Fair-Play**:
  - *Anti-Xray Filter*: 6-neighbor surface exposure check discards hidden blocks enclosed by solid blocks.
  - *3D Line-of-Sight Raycasting*: Amanatides & Woo DDA raycasting verifies unobstructed line of sight.
  - *Perception FOV Cone*: $70^\circ$ focal cone with $2.5$m near-field tactile fallback.
  - *Physical Reach Limits*: Block interactions strictly clamped to $\le 4.50$m; entity combat clamped to $\le 3.50$m.
  - *Command Sanitizer*: Two-phase tokenization strictly blocks OP commands (`/tp`, `/give`, `/gamemode`, `/op`, etc.).
- **Actions Subsystems**:
  - *Safe Pathfinding*: Navigates avoiding lava, fire, and drops > 3 blocks.
  - *Mining Engine*: Enforces harvest tool tiers (stone, iron, diamond) and damage interrupt guards.
  - *Crafting Engine*: 2x2 player inventory grid and 3x3 crafting table topological recipe decomposition.
  - *Combat System*: 1.9+ weapon cooldown timing (e.g. 625ms for sword), shield raising/lowering, and tactical retreat when HP < 6.
- **Automated Survival Loops**:
  - *Auto-Eat Loop*: Consumes food when hunger $\le 14$ or health $< 20$, prioritizes saturation, blacklists poison.
  - *Auto-Sleep Loop*: Sleeps during night (12541-23458) and thunderstorms, enforces 8m/5m monster exclusion AABB.
  - *Auto-Equip Loop*: Evaluates composite defense score to automatically equip optimal armor and weapons.

### 6. Multi-Provider AI Planning Engine (Gemini, OpenRouter, Claude, DeepSeek, ChatGPT & Local Models)
The bot features a decoupled, multi-provider AI architecture supporting all major cloud and local LLMs through either the Google Gemini SDK or OpenAI-compatible tool-calling:
- **Supported Providers:**
  - **Google Gemini**: Native SDK via `@google/genai` (default: `gemini-3.8-flash`).
  - **OpenRouter**: Access Claude 3.5 Sonnet, DeepSeek V3/R1, Llama 3.3, Mistral, and more via `https://openrouter.ai/api/v1`.
  - **OpenAI / ChatGPT**: Native OpenAI API (`gpt-4o`, `gpt-4o-mini`, `o1`, `o3-mini`).
  - **DeepSeek**: High-performance reasoning and chat (`deepseek-chat`, `deepseek-reasoner`).
  - **Local Models (Ollama, LM Studio, vLLM, LocalAI)**: Zero-cloud, 100% private local execution (e.g. `http://localhost:11434/v1` for Ollama).
  - **Custom Endpoints**: Any user-defined OpenAI-compatible proxy or model gateway.
- **9 Fair-Play Survival Tools**: `goToCoordinates`, `followPlayer`, `gatherResource`, `defendArea`, `reportStatus`, `stopCurrentTask`, `craftItem`, `sleepInBed`, `depositOrRetrieve`.
- **Runtime Validation**: Interceptor strictly validates tool arguments against survival reach, FOV, and anti-cheat boundaries regardless of the underlying LLM.
- **Multi-Turn Planning**: Asynchronous generator streaming step progress and tool results to Discord text and voice.

---

### Multi-Model Configuration Guide

Simply set `AI_PROVIDER` and the corresponding credentials in your `.env`:

#### 1. OpenRouter (Claude, DeepSeek, Llama, etc.)
```env
AI_PROVIDER=openrouter
AI_MODEL=anthropic/claude-3.5-sonnet
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

#### 2. OpenAI (ChatGPT / GPT-4o)
```env
AI_PROVIDER=openai
AI_MODEL=gpt-4o
OPENAI_API_KEY=sk-proj-your-key-here
```

#### 3. DeepSeek
```env
AI_PROVIDER=deepseek
AI_MODEL=deepseek-chat
DEEPSEEK_API_KEY=sk-your-deepseek-key-here
```

#### 4. Local Models via Ollama (Zero Cost / Private)
```env
AI_PROVIDER=ollama
AI_MODEL=llama3.1
AI_BASE_URL=http://localhost:11434/v1
```

#### 5. Local Models via LM Studio
```env
AI_PROVIDER=lmstudio
AI_MODEL=local-model
AI_BASE_URL=http://localhost:1234/v1
```

#### 6. Google Gemini (Default)
```env
AI_PROVIDER=gemini
AI_MODEL=gemini-3.8-flash
GEMINI_API_KEY=AIzaSyYourGeminiApiKeyHere
```


## Prerequisites

- **Node.js**: v20+ (Tested on Node.js v22 and v24)
- **NPM**: v10+

---

## Installation

```bash
npm install
```

---

## Build

Compile TypeScript source code to `./dist` using ES2022 / NodeNext:

```bash
npm run build
```

Type-check without emitting:

```bash
npm run typecheck
```

---

## Testing (100% Offline Multi-Tier Test Suite)

Run the Vitest test suite with zero external secrets, network sockets, or live Minecraft servers:

```bash
npm test
```

### Test Suite Architecture:
- **Tier 1: Feature Coverage (`test/tier1_features/`)**: Isolated happy-path unit tests for all features.
- **Tier 2: Boundaries & Edge Cases (`test/tier2_boundaries/`)**: Coordinate limits, reach boundaries, empty inventories, timeouts.
- **Tier 3: Cross-Feature Combinations (`test/tier3_combinations/`)**: Multi-subsystem interactions (Voice -> STT -> AI -> Actions -> TTS -> Embeds, Chat Bridge, RBAC).
- **Tier 4: Real-World Application Scenarios (`test/tier4_scenarios/`)**: End-to-end user journeys (Mining Expedition, Defensive Patrol, Crafting & Shelter, Emergency Abort).
- **Tier 5: Adversarial Coverage Hardening (`test/tier5_adversarial/`)**: White-box stress tests, race conditions, edge invariants.

---

## Running the Bot

1. Copy `.env.example` to `.env` and fill in your Discord Bot Token, Gemini API Key, and Minecraft Server details:

```bash
cp .env.example .env
```

2. Build and start the bot:

```bash
npm run build
node dist/index.js
```

---

## Configuration Reference

See `.env.example` for the complete list of configuration options including Discord credentials, RBAC role snowflakes, Minecraft server settings, audio thresholds, and offline test simulation flags (`MOCK_ALL=true`).
