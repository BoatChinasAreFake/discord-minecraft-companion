# Project: Multimodal Discord Minecraft Bot with AI Agent Engine

## Architecture

The system is a decoupled, modular multimodal agent architecture integrating Discord (voice & text), Google Gemini AI planning (`@google/genai` >= 2.3.0), and a fair-play Minecraft Java client (`Mineflayer`):

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

## Feature Inventory

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F01 | Slash Command Registration & Dispatch | Slash commands (`/status`, `/connect`, `/disconnect`, `/task`, `/stop`, `/inventory`, `/voice`, `/help`) | M1 | R1, Survey 1 |
| F02 | Deferred Interaction Handling | Automatic 2.5s interaction deferral and graceful Discord error handling | M1 | R1, Survey 1 |
| F03 | Voice Connection & Session Manager | Join, leave, reconnect, and track voice channels via `@discordjs/voice` | M1 | R1, Survey 1 |
| F04 | Voice Receiver & Speaking Tracker | Capture user Opus voice streams with silence detection (`AfterSilence` 500ms) | M1 | R1, Survey 1 |
| F05 | Voice Audio Decoding & VAD | Decode Opus to 48kHz stereo PCM, apply voice activity detection / noise gating | M1 | R1, Survey 1 |
| F06 | STT Audio Pipeline Interface | Interface for transcribing buffered user PCM voice into text prompts | M1 | R1, Survey 1 |
| F07 | Voice Player & Audio Streaming | Encode and stream synthetic audio into Discord voice channel | M1 | R1, Survey 1 |
| F08 | Audio Priority Queue Manager | Priority queue for TTS audio with preemption for emergency survival alerts | M1 | R1, Survey 1 |
| F09 | Discord-to-Minecraft Chat Relay | Relay Discord text channel messages into Minecraft server chat | M1 | R1, Survey 1 |
| F10 | Minecraft-to-Discord Chat Relay | Relay in-game player chat events into configured Discord channel | M1 | R1, Survey 1 |
| F11 | Triple-Lock Anti-Loopback Filter | Filter bot self-ID, bot accounts, and 10s TTL hash deduplication | M1 | R1, Survey 1 |
| F12 | Chat Sanitization & 256-Char Chunking | Strip `§` codes, sanitize control chars, and chunk to <= 256 chars | M1 | R1, Survey 1 |
| F13 | Live Status Embed Generator | Visual HP/hunger progress bars, coordinates, task, gear, inventory summary | M1 | R1, Survey 1 |
| F14 | Status Embed Throttling | 5s interval throttling and dirty-state hashing to prevent Discord HTTP 429 | M1 | R1, Survey 1 |
| F15 | Role-Based Access Control (RBAC) | 3-tier security model (VIEWER, OPERATOR, ADMIN) with role/user whitelist | M1 | R1, Survey 1 |
| F16 | Environment Configuration & Schema Validation | Validate all credentials, tokens, channel IDs in `.env.example` schema | M1 | R1, Survey 1 |
| F17 | In-Memory Discord Gateway Mock Interfaces | `IDiscordGateway`, `IVoiceSession` mock implementations for 100% offline tests | M1 | R1, Survey 1 |
| F18 | Mineflayer Connection & Lifecycle Manager | Connect, spawn, disconnect, error, and auto-reconnect handling | M2 | R2, Survey 2 |
| F19 | Anti-Xray Surface Exposure Filter | Discard solid blocks where all 6 adjacent faces are solid/opaque | M2 | R2, Survey 2 |
| F20 | 3D Line-of-Sight Raycasting Perception | Amanatides & Woo DDA / `world.raycast` from eye to exposed face centers | M2 | R2, Survey 2 |
| F21 | Field-of-View Cone & Tactile Fallback | $70^\circ$ focal FOV cone with $2.5$m near-field tactile fallback | M2 | R2, Survey 2 |
| F22 | Block Interaction Reach Enforcer | Enforce survival reach strictly clamped to $\le 4.50$ blocks from eye position | M2 | R2, Survey 2 |
| F23 | Entity Combat Reach Enforcer | Enforce entity attack reach clamped to $\le 3.50$ blocks | M2 | R2, Survey 2 |
| F24 | Command Sanitizer & OP Prohibition | Strictly block privileged commands (`/tp`, `/give`, `/gamemode`, etc.) | M2 | R2, Survey 2 |
| F25 | Mineflayer Pathfinder Navigation | Safe movements (`maxDropDown = 3`, parkour false, liquid penalty, stall recovery) | M2 | R2, Survey 2 |
| F26 | Block Interaction & Mining Engine | Tool harvest tier matching, raycast dig execution with damage interrupt guard | M2 | R2, Survey 2 |
| F27 | Block Placement & Sneak-Interaction | Legitimate block placing and sneak-interaction for containers | M2 | R2, Survey 2 |
| F28 | Inventory Management & Crafting Engine | 2x2 player inventory grid and 3x3 crafting table recursive crafting | M2 | R2, Survey 2 |
| F29 | Combat & Defensive System | Hostile mob LOS detection, 1.9+ weapon cooldown timing, shield, panic retreat | M2 | R2, Survey 2 |
| F30 | Auto-Eating Survival Loop | Monitor hunger ($\le 14$) & health ($< 20$), prioritize saturation, poison blacklist | M2 | R2, Survey 2 |
| F31 | Auto-Sleeping Survival Loop | Detect night & thunderstorm, check $8$m/$5$m monster exclusion, sleep in bed | M2 | R2, Survey 2 |
| F32 | Auto-Equipping Survival Loop | Composite defensive formula evaluating armor defense, toughness, enchantments | M2 | R2, Survey 2 |
| F33 | Hazard Avoidance & Emergency Reflexes | Drowning surface ascent, water bucket clutch, suffocation dig-out | M2 | R2, Survey 2 |
| F34 | In-Memory Voxel World & Mock Protocol Bot | In-memory world state and EventEmitter bot mocks for 100% offline testing | M2 | R2, Survey 2 |
| F35 | Google Gemini SDK Integration | Official `@google/genai` (>= 2.3.0) client configured for `gemini-3.8-flash` | M3 | R3, Survey 3 |
| F36 | 9 Structured Fair-Play Tool Declarations | `goToCoordinates`, `followPlayer`, `gatherResource`, `defendArea`, `reportStatus`, `stopCurrentTask`, `craftItem`, `sleepInBed`, `depositOrRetrieve` | M3 | R3, Survey 3 |
| F37 | Fair-Play Tool Argument Validation | Intercept and validate tool parameters against survival boundaries | M3 | R3, Survey 3 |
| F38 | Goal Decomposition & Multi-Turn Execution Loop | Decompose natural language goals into ordered tool executions and results | M3 | R3, Survey 3 |
| F39 | Tool Result Packaging & Step Timeline | Format tool outputs back to Gemini model for plan continuation | M3 | R3, Survey 3 |
| F40 | Bidirectional Discord Progress Reporting | Send task start, step progress, obstacles, and completion to Discord text/voice | M3 | R3, Survey 3 |
| F41 | Task Cancellation & Emergency Halt | Handle `/stop` slash command and emergency user voice interrupts | M3 | R3, Survey 3 |
| F42 | In-Memory Gemini Provider Mock | Deterministic regex-based tool calling mock for zero-secret offline execution | M3 | R3, Survey 3 |
| F43 | Project Build & TypeScript Scaffold | `package.json`, `tsconfig.json` (ES2022/NodeNext/strict), `npm run build` | M1 | AC, Survey 3 |
| F44 | Offline Simulation Harness Infra | Test context and dependency injection containers for 100% offline tests | E2E | R4, Survey 3 |
| F45 | Tier 1 Feature Coverage Test Suite | $\ge 5$ test cases per feature covering isolated happy-paths | E2E | R4, Survey 3 |
| F46 | Tier 2 Boundary & Corner Case Test Suite | $\ge 5$ test cases per feature covering edge values, timeouts, limits | E2E | R4, Survey 3 |
| F47 | Tier 3 Cross-Feature Combination Suite | Pairwise integration tests validating multi-subsystem interactions | E2E | R4, Survey 3 |
| F48 | Tier 4 Real-World Application Scenarios | Comprehensive end-to-end user workflows (voice/text -> plan -> action -> embed) | E2E | R4, Survey 3 |
| F49 | E2E Test Suite Pass (100% Pass Rate) | Execute full suite and ensure 100% passing tests in CI/local | M4 | AC, Survey 3 |
| F50 | Tier 5 Adversarial Coverage Hardening | White-box stress testing, gap analysis, and vulnerability hardening | M4 | AC, Project |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Design test runner, mock harness, and 4-tier test suites (Tiers 1-4); publish `TEST_READY.md` | Survey complete | COMPLETED |
| M1 | Discord Core & Audio/Bridge Infrastructure | Project scaffold, configuration schema, slash commands, RBAC, live status embeds, chat bridge, voice receiver (STT), voice player (TTS), priority queue | Survey complete | COMPLETED |
| M2 | Minecraft Fair-Play Survival Engine | Mineflayer agent, perception raycasting (anti-xray, FOV), reach enforcement ($\le 4.5$m), command sanitizer (no OP), pathfinding, mining, crafting, combat, survival loops (eat, sleep, equip) | M1 contracts defined | COMPLETED |
| M3 | Gemini AI Planning & Coordination Bridge | `@google/genai` integration (`gemini-3.8-flash`), 9 fair-play tool schemas, tool execution engine, Discord coordination feedback, task abort handling | M1, M2 contracts defined | COMPLETED |
| M4 | Final E2E Test Verification & Hardening | Phase 1: 100% pass rate on E2E test suite (Tiers 1-4); Phase 2: Adversarial coverage hardening (Tier 5) | E2E, M1, M2, M3 | COMPLETED |

---

## Interface Contracts

### 1. Discord ↔ Coordinator (`src/discord/types.ts`, `src/coordinator/types.ts`)
```typescript
export interface IDiscordGateway {
  registerCommands(commands: SlashCommandDefinition[]): Promise<void>;
  sendMessage(channelId: string, content: string | MessagePayload): Promise<string>;
  updateEmbed(channelId: string, messageId: string, embed: EmbedData): Promise<void>;
  joinVoice(channelId: string, guildId: string): Promise<IVoiceSession>;
  leaveVoice(guildId: string): Promise<void>;
  onCommand(handler: (interaction: CommandInteraction) => Promise<void>): void;
  onMessage(handler: (message: UserMessage) => Promise<void>): void;
}

export interface IVoiceSession {
  subscribeUser(userId: string): ReadableStream<AudioPacket>;
  playAudioStream(stream: ReadableStream<Buffer>, priority: AudioPriority): Promise<void>;
  stopAudio(): void;
  destroy(): void;
}
```

### 2. Audio Pipeline ↔ Coordinator (`src/audio/types.ts`)
```typescript
export interface ISTTPipeline {
  transcribePcm(pcmBuffer: Buffer): Promise<string>;
}

export interface ITTSPipeline {
  synthesizeSpeech(text: string): Promise<Buffer>;
}

export interface IAudioQueueManager {
  enqueue(item: TTSQueueItem): void;
  cancelNonEmergency(): void;
  stopAll(): void;
}
```

### 3. Minecraft Agent ↔ Coordinator & AI Engine (`src/minecraft/types.ts`)
```typescript
export interface IMinecraftAgent {
  connect(config: MinecraftConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): MinecraftBotStatus;
  
  // Fair-play perception & validation
  findVisibleBlock(criteria: BlockSearchCriteria): Promise<VisibleBlock | null>;
  canInteractWith(position: Vec3): boolean; // enforces <= 4.5m and line of sight
  
  // Actions
  navigateTo(target: Vec3, options?: PathfindingOptions): Promise<ActionResult>;
  mineBlock(position: Vec3): Promise<ActionResult>;
  placeBlock(position: Vec3, blockName: string): Promise<ActionResult>;
  craftItem(recipeName: string, count: number): Promise<ActionResult>;
  attackEntity(entityId: number): Promise<ActionResult>;
  sleepInNearbyBed(): Promise<ActionResult>;
  
  // Chat
  sendChat(message: string): Promise<void>; // passes through CommandSanitizer
  
  on(event: 'chat', listener: (username: string, message: string) => void): void;
  on(event: 'statusUpdate', listener: (status: MinecraftBotStatus) => void): void;
  on(event: 'death', listener: () => void): void;
}
```

### 4. Gemini AI Planner ↔ Coordinator (`src/ai/types.ts`)
```typescript
export interface IGeminiPlanner {
  executeGoal(goalText: string, context: PlanningContext): AsyncIterable<PlannerStepEvent>;
  cancelCurrentGoal(): void;
}

export interface PlannerStepEvent {
  type: 'thought' | 'tool_call' | 'tool_result' | 'progress' | 'error' | 'done';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  message?: string;
  result?: unknown;
}
```

---

## Code Layout

```
wise-pasteur/
├── .env.example
├── README.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts
│   ├── config/
│   │   ├── env.ts
│   │   └── types.ts
│   ├── discord/
│   │   ├── client.ts
│   │   ├── commands/
│   │   ├── rbac.ts
│   │   ├── embed.ts
│   │   └── types.ts
│   ├── audio/
│   │   ├── receiver.ts
│   │   ├── player.ts
│   │   ├── queue.ts
│   │   ├── stt.ts
│   │   ├── tts.ts
│   │   └── types.ts
│   ├── bridge/
│   │   ├── chatBridge.ts
│   │   ├── antiLoopback.ts
│   │   └── types.ts
│   ├── minecraft/
│   │   ├── client.ts
│   │   ├── perception/
│   │   │   ├── raycast.ts
│   │   │   ├── exposure.ts
│   │   │   └── fov.ts
│   │   ├── fairplay/
│   │   │   ├── reach.ts
│   │   │   ├── commandSanitizer.ts
│   │   │   └── rules.ts
│   │   ├── actions/
│   │   │   ├── pathfinding.ts
│   │   │   ├── mining.ts
│   │   │   ├── inventory.ts
│   │   │   ├── crafting.ts
│   │   │   └── combat.ts
│   │   ├── loops/
│   │   │   ├── autoEat.ts
│   │   │   ├── autoSleep.ts
│   │   │   └── autoEquip.ts
│   │   └── types.ts
│   ├── ai/
│   │   ├── geminiClient.ts
│   │   ├── tools/
│   │   │   ├── definitions.ts
│   │   │   └── validator.ts
│   │   ├── planner.ts
│   │   └── types.ts
│   └── coordinator/
│       ├── agentCoordinator.ts
│       ├── progressReporter.ts
│       └── types.ts
└── test/
    ├── mocks/
    │   ├── mockDiscord.ts
    │   ├── mockVoice.ts
    │   ├── mockMinecraft.ts
    │   ├── mockGemini.ts
    │   └── index.ts
    ├── harness/
    │   ├── simulationHarness.ts
    │   └── testContext.ts
    ├── tier1_features/
    ├── tier2_boundaries/
    ├── tier3_combinations/
    ├── tier4_scenarios/
    └── tier5_adversarial/
```
