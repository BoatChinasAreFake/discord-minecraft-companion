# Milestone 4 Exploration & Harness Architecture Report

## 1. Observation

### 1.1 Existing Mock Infrastructure (`test/mocks/`)
Direct inspection of `test/mocks/` revealed a well-engineered set of in-memory mocks:
- **`MockDiscordGateway`** (`test/mocks/mockDiscord.ts`, lines 20-162):
  - Implements `IDiscordGateway` (`registerCommands`, `sendMessage`, `updateEmbed`, `joinVoice`, `leaveVoice`, `onCommand`, `onMessage`).
  - Records sent messages (`sentMessages: RecordedSentMessage[]`), edited messages (`editedMessages: RecordedEditedMessage[]`), and voice sessions (`activeVoiceSessions: Map<string, MockVoiceSession>`).
  - Exposes test simulation hooks: `simulateUserMessage(msg)`, `simulateCommandInteraction(interaction)`, `simulateDeleteMessage(id)`.
  - Supports error injection via `failNextSendWith` and `failNextUpdateWith`.
- **`MockVoiceSession`** (`test/mocks/mockVoice.ts`, lines 12-128):
  - Implements `IVoiceSession` (`subscribeUser`, `playAudioStream`, `stopAudio`, `destroy`).
  - Manages simulated user inbound streams (`activeUserStreams: Map<string, PassThrough>`).
  - Records outbound audio playback (`playedRecordings: RecordedAudioPlayback[]`), storing raw PCM/WAV chunks, byte counts, priorities (`NORMAL`, `HIGH`, `EMERGENCY`), and completion flags.
  - Exposes simulation hooks: `simulateUserSpeaking(userId, pcmChunks)`, `simulateUserSilence(userId)`, `getCombinedPlayedAudio(index)`.
- **`MockMinecraftAgent`, `MockWorld`, `MockMineflayerBot`** (`test/mocks/mockMinecraft.ts`, lines 46-741):
  - `MockWorld`: In-memory 3D voxel store implementing `IBlockAccessor` (`getBlock`, `setBlock`, `loadBox`, `createFlatWorld`, `getAllBlocks`).
  - `MockMineflayerBot`: Event-driven Mineflayer bot stub (`entity`, `health`, `food`, `armor`, `inventory`, `pathfinder`, `dig`, `placeBlock`, `equip`, `consume`, `sleep`, `attack`, `openContainer`, `craft`). Enforces fair-play reach assertions (`assertBlockReach <= 4.5m`, `assertEntityAttackReach <= 3.5m`) and chat sanitizer (`assertAllowedMinecraftChat`).
  - `MockMinecraftAgent`: Implements `IMinecraftAgent` and `IMinecraftChatAgent`. Integrates 3D DDA raycasting (`hasBlockLineOfSight`), surface exposure anti-xray (`evaluateBlockExposure`), and FOV perception cone (`isWithinPerceptionFOV`). Emits `'chat'`, `'statusUpdate'`, `'death'`, `'spawn'`.
- **`MockGeminiClient` & `MockGeminiSession`** (`test/mocks/mockGemini.ts`, lines 30-408):
  - Implements `IGeminiClient` and `IGeminiSession`.
  - Built-in heuristic regex decomposition supporting all 9 fair-play survival tools:
    1. Composite multi-step: `"gather X logs and craft Y"` -> `gatherResource` then `craftItem`.
    2. Navigation: `"go to X Y Z"` -> `goToCoordinates`.
    3. Follow: `"follow Player within D"` -> `followPlayer`.
    4. Gathering: `"gather/mine/collect X"` -> `gatherResource`.
    5. Combat patrol: `"defend/protect/patrol radius R"` -> `defendArea`.
    6. Status check: `"status/hp/inventory"` -> `reportStatus`.
    7. Emergency halt: `"stop/halt/cancel"` -> `stopCurrentTask`.
    8. Crafting: `"craft/make X"` -> `craftItem`.
    9. Sleeping: `"sleep/bed/night"` -> `sleepInBed`.
    10. Storage: `"deposit/withdraw X"` -> `depositOrRetrieve`.
  - Also supports scripted turns queue (`setScriptedTurns`, `addScriptedTurn`) and programmable custom handler (`setCustomHandler`).

### 1.2 Coordinator & Subsystem Wiring
- **`AgentCoordinator`** (`src/coordinator/agentCoordinator.ts`, lines 21-210):
  - Injects `IDiscordGateway`, `IMinecraftAgent`, `IGeminiPlanner`, `ProgressReporter`, `AppConfig`, and `IAudioQueueManager`.
  - Connects bot events:
    - `minecraftAgent.on('death')` -> triggers `broadcastSurvivalAlert(..., EMERGENCY)` and `stopCurrentTask()`.
    - `minecraftAgent.on('statusUpdate')` -> rate-limited low-health alert when `health <= 6`.
  - Task execution: `assignTask({ goal, user })` dispatches to `planner.executeGoal(goal, context)` in an async fire-and-forget loop and feeds events into `progressReporter.reportEvent`.
  - Emergency halt: `stopCurrentTask()` cancels planner goal, halts Mineflayer pathfinder/digging, cancels non-emergency audio in `audioQueue`, and reports stop to Discord.
  - Multimodal voice routing: `handleVoicePrompt({ userId, prompt, source })` parses `"stop"` or assigns task.
  - Voice channel management: `joinVoiceChannel` and `leaveVoiceChannel` via `discordGateway`.
- **`ProgressReporter`** (`src/coordinator/progressReporter.ts`, lines 18-115):
  - Injects `IDiscordGateway`, `IAudioQueueManager`, `ProgressReporterConfig`.
  - Routes planner events:
    - `'tool_call'` -> Discord text message + `AudioPriority.NORMAL` TTS.
    - `'tool_result'` (with failure) -> Discord text obstacle alert + `AudioPriority.HIGH` TTS.
    - `'progress'` -> Discord text message + `AudioPriority.NORMAL` TTS.
    - `'error'` -> Discord text error + `AudioPriority.HIGH` TTS.
    - `'done'` -> Discord text finish alert + `AudioPriority.HIGH` TTS.
- **`GeminiPlanner`** (`src/ai/planner.ts`, lines 21-381):
  - Injects `IGeminiClient`, `IMinecraftAgent`, `PlannerOptions`.
  - Emits async generator stream of `PlannerStepEvent`.
  - Intercepts and validates tool arguments via `validateToolCall` against fair-play survival rules before executing actions on `minecraftAgent`.
  - Enforces a 10-turn safety guard to prevent infinite loops.
- **`ChatBridge`** (`src/bridge/chatBridge.ts`, lines 5-180):
  - Bridges Discord text channel and Minecraft chat with leaky-bucket rate limiting (`rateLimitDelayMs`, default 500ms).
  - Uses `AntiLoopbackFilter` with triple-lock filtering (bot ID check, bot account check, 10s TTL hash deduplication).
- **`StatusEmbedManager`** (`src/discord/embed.ts`, lines 139-223):
  - Generates visual status embeds (health bar, hunger bar, coordinates, equipped gear, inventory).
  - Throttles updates via `updateIntervalSec` (default 5s) and `computeStateHash` to prevent redundant updates.
- **`AudioQueueManager`** (`src/audio/queue.ts`, lines 16-244):
  - Priority queue with preemption: `EMERGENCY` (0) preempts `HIGH` (1), `NORMAL` (2), `LOW` (3).
  - Requires a `PlayerLike` adapter with `playBuffer`, `stop`, `isPlaying`, and EventEmitter emitting `'idle'`.
- **`Discord Commands & RBAC`** (`src/discord/commands/`, `src/discord/rbac.ts`):
  - 8 slash commands (`/status`, `/connect`, `/disconnect`, `/task`, `/stop`, `/inventory`, `/voice`, `/help`).
  - 3-tier RBAC (`VIEWER`, `OPERATOR`, `ADMIN`).
  - `withAutoDefer` auto-defers commands exceeding 2.5s execution window.

### 1.3 Existing Test Suite & Build Verification
- Running `cmd /c npm test` executed 27 test files: **444 tests passed (100%), 0 failed**.
- Running `cmd /c npm run build` compiled clean: **0 TypeScript errors, exit code 0**.

---

## 2. Logic Chain & Gap Analysis

### 2.1 Critical Findings & Integration Nuances
From our examination of the mock infrastructure and real coordinators, we identified four critical integration requirements for the harness:

1. **Async Timing in `AgentCoordinator.assignTask`**:
   - *Observation*: `coordinator.assignTask()` initiates `planner.executeGoal()` inside an unawaited IIFE `(async () => { for await (...) ... })()`. It resolves immediately.
   - *Inference*: Tests that call `assignTask()` cannot immediately assert completion without waiting. If tests rely only on `setTimeout`, they risk flakiness under varying CI loads.
   - *Requirement for Harness*: The harness must provide `waitForPlannerCompletion(timeoutMs)` (monitoring `planner.isExecuting()`) and a general `waitFor(condition, timeoutMs)` polling utility.

2. **AudioQueueManager vs `MockVoiceSession` Protocol Adapter**:
   - *Observation*: `AudioQueueManager` requires `PlayerLike` (`playBuffer`, `stop`, `isPlaying`, `on('idle')`). `MockVoiceSession` implements `IVoiceSession` (`playAudioStream`, `stopAudio`, `isAudioPlaying`), but does not have `playBuffer` or an `'idle'` event emitter.
   - *Inference*: Plugging `MockVoiceSession` directly into `AudioQueueManager` would result in a runtime type error or broken queue progression.
   - *Requirement for Harness*: The harness must include a lightweight `MockPlayerAdapter` that implements `PlayerLike`, bridges `playBuffer` to `voiceSession.playAudioStream`, and emits `'idle'` upon completion so `AudioQueueManager` smoothly advances to subsequent queued items.

3. **ChatBridge Rate-Limit Delay (Leaky Bucket)**:
   - *Observation*: `ChatBridge` defaults to `rateLimitDelayMs = 500`. Every relayed message waits 500ms in queue.
   - *Inference*: Running dozens of E2E tests through chat bridge with 500ms intervals would cause tests to take multiple minutes or time out.
   - *Requirement for Harness*: The test config should set `rateLimitDelayMs: 10` (or 20ms), and the harness must provide `flushChatBridge()` to immediately drain `chatBridge.chatQueue` during deterministic test steps.

4. **StatusEmbedManager & Client Throttle Controls**:
   - *Observation*: `StatusEmbedManager` defaults to a 5-second polling interval, and `MinecraftClient` has `statusThrottleMs = 500`.
   - *Inference*: Tests verifying live status embed changes cannot wait 5 seconds per assertion.
   - *Requirement for Harness*: The harness must set `updateIntervalSec: 1` and `statusThrottleMs: 10`, and expose `triggerStatusEmbedTick(force = true)` to immediately evaluate and post/update embeds on `MockDiscordGateway`.

5. **Voice Utterance Processing Pipeline**:
   - *Observation*: `VoiceReceiver` processes speech chunks and emits `'utterance'`. In live bots, an STT pipeline transcribes this and feeds it to `AgentCoordinator.handleVoicePrompt()`.
   - *Inference*: Multi-tier E2E tests need a seamless helper to simulate user voice speech that exercises the full path: Simulated Audio -> VoiceReceiver -> STT -> Coordinator -> Gemini Planner -> Minecraft Action -> ProgressReporter -> TTS -> VoiceSession.
   - *Requirement for Harness*: `harness.simulateUserVoicePrompt(userId, textOrPcm)` should automate this pipeline deterministically.

---

## 3. Detailed Architecture & Design Specifications

### 3.1 Design of `test/harness/simulationHarness.ts`

`SimulationHarness` is the central dependency-injection container and test orchestrator that wires all mock subsystems into a fully functional, 100% offline environment.

#### Architectural Structure:
```
SimulationHarness
├── Mocks
│   ├── MockDiscordGateway (gateway & message sink)
│   ├── MockVoiceSession (active voice channel session)
│   ├── MockMinecraftAgent (or MinecraftClient with MockMineflayerBot)
│   ├── MockWorld (in-memory 3D voxel storage)
│   ├── MockMineflayerBot (player entity & protocol events)
│   ├── MockGeminiClient (deterministic LLM provider)
│   ├── MockSTTProvider / STTPipeline (speech transcription)
│   └── MockTTSProvider / TTSPipeline (synthetic speech generator)
├── Subsystems Under Test
│   ├── AudioQueueManager (priority TTS queue with preemption)
│   ├── MockPlayerAdapter (bridges queue to voice session)
│   ├── VoiceReceiver (Opus/PCM stream ingestion & silence detection)
│   ├── ChatBridge (bidirectional Discord <-> Minecraft relay)
│   ├── StatusEmbedManager (live embed generation & dirty hashing)
│   ├── CommandRegistry (8 slash commands)
│   ├── RBACService (VIEWER, OPERATOR, ADMIN enforcement)
│   ├── GeminiPlanner (multi-turn tool calling loop)
│   ├── ProgressReporter (step & obstacle streaming)
│   └── AgentCoordinator (central coordination engine)
└── Utilities
    ├── Lifecycle Controls (start, stop, reset)
    ├── Deterministic Simulators (commands, text chat, voice, world, gemini)
    └── Deterministic Waiters (waitFor, waitForPlanner, waitForDiscord)
```

#### Detailed Interface Contracts for `simulationHarness.ts`:

```typescript
import type { AppConfig } from '../../src/config/types.js';
import type { RecordedSentMessage, RecordedEditedMessage } from '../mocks/mockDiscord.js';
import type { RecordedAudioPlayback } from '../mocks/mockVoice.js';
import type { Vec3Location, MinecraftBotStatus } from '../../src/minecraft/types.js';
import type { GeminiTurnResponse, MockTurnHandler } from '../mocks/mockGemini.js';
import type { EmbedData } from '../../src/discord/types.js';

export interface SimulationHarnessOptions {
  configOverrides?: Partial<AppConfig>;
  /** Use real MinecraftClient with MockMineflayerBot instead of MockMinecraftAgent */
  useRealMinecraftClient?: boolean;
  /** Auto-connect Minecraft agent on start (default: true) */
  autoConnectMinecraft?: boolean;
  /** Initial bot spawn position (default: { x: 0, y: 64, z: 0 }) */
  initialBotPosition?: Vec3Location;
  /** Initial world surface type (default: 'grass_block') */
  worldSurface?: string;
}

export interface SimulateSlashCommandOptions {
  commandName: string;
  subcommand?: string;
  options?: Record<string, string | number | boolean | any>;
  user?: { id: string; username: string; tag?: string; bot?: boolean };
  member?: any;
  guildId?: string;
  channelId?: string;
}

export interface SimulateSlashCommandResult {
  commandName: string;
  allowed: boolean;
  replied: boolean;
  deferred: boolean;
  replyContent?: string;
  replyEmbeds?: any[];
  error?: Error;
}
```

#### Core Methods of `SimulationHarness`:

1. **Lifecycle Management**:
   - `async start(): Promise<void>`:
     - Connects Minecraft agent (if `autoConnectMinecraft = true`).
     - Starts `ChatBridge` and `StatusEmbedManager`.
     - Deploys default command handlers to `MockDiscordGateway`.
     - Initializes audio queues and voice sessions.
   - `async stop(): Promise<void>`:
     - Halts coordinator and cancels active goals.
     - Stops `ChatBridge` and `StatusEmbedManager` intervals.
     - Disconnects Minecraft agent.
     - Destroys active voice sessions and purges audio queues.
   - `reset(): void`:
     - Resets `MockDiscordGateway`, `MockVoiceSession`, `MockGeminiClient`.
     - Clears `MockWorld` and rebuilds flat terrain.
     - Restores default bot health (20), food (20), and coordinates.

2. **Deterministic Event Simulators**:
   - `simulateSlashCommand(options: SimulateSlashCommandOptions): Promise<SimulateSlashCommandResult>`:
     - Constructs mock interaction object with options and user/member metadata.
     - Evaluates RBAC tier via `RBACService.check()`.
     - Dispatches through `withAutoDefer()` to `command.execute()`.
     - Captures reply/editReply text and embeds for test assertion.
   - `simulateDiscordChatMessage(content: string, author?: Partial<UserMessage['author']>): Promise<void>`:
     - Dispatches user message via `mockDiscord.simulateUserMessage()`.
     - Routes into `ChatBridge.handleDiscordMessage()`.
   - `simulateMinecraftChat(username: string, message: string): Promise<void>`:
     - Triggers in-game chat event on Minecraft agent.
     - Routes into `ChatBridge.handleMinecraftChat()`.
   - `simulateUserVoicePrompt(userId: string, promptText: string): Promise<void>`:
     - Simulates voice speech utterance.
     - Configures STT mock with `promptText`.
     - Dispatches `CoordinatorVoicePrompt` to `AgentCoordinator.handleVoicePrompt()`.
   - `simulateWorldBlock(pos: Vec3Location, blockName: string): void`:
     - Sets block in `MockWorld`.
   - `simulateBotDamage(newHealth: number): void`:
     - Updates `bot.health` and emits `'health'`, triggering survival loops or low-health/death alerts.
   - `simulateBotHunger(food: number, saturation?: number): void`:
     - Updates `bot.food` and `bot.foodSaturation`, triggering `AutoEatLoop`.
   - `simulateWeather(isRaining: boolean, isThunder: boolean, timeOfDay?: number): void`:
     - Updates bot environment, triggering `AutoSleepLoop`.
   - `scriptGeminiTurn(turn: GeminiTurnResponse): void`:
     - Enqueues scripted response into `MockGeminiClient`.
   - `setGeminiCustomHandler(handler: MockTurnHandler): void`:
     - Attaches custom programmatic decision handler to `MockGeminiClient`.

3. **Synchronization & Wait Helpers**:
   - `async waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs?: number, intervalMs?: number): Promise<void>`:
     - Deterministic polling loop with 10ms intervals. Throws descriptive timeout error if condition is not met.
   - `async waitForPlannerCompletion(timeoutMs?: number): Promise<void>`:
     - Awaits until `planner.isExecuting()` is false and `coordinator.currentGoal` is null.
   - `async waitForDiscordMessage(matcher: string | RegExp | ((msg: RecordedSentMessage) => boolean), timeoutMs?: number): Promise<RecordedSentMessage>`:
     - Awaits message matching predicate in `mockDiscord.sentMessages`.
   - `async waitForChatBridgeFlushed(timeoutMs?: number): Promise<void>`:
     - Flushes leaky-bucket queue and awaits until `chatBridge.getQueueLength() === 0`.
   - `async triggerStatusEmbedTick(force?: boolean): Promise<boolean>`:
     - Manually executes immediate `statusEmbedManager.tick(force)`.

---

### 3.2 Design of `test/harness/testContext.ts`

`TestContext` is the test-facing environment container and assertion suite. It wraps `SimulationHarness`, provides factory methods for Vitest lifecycle hooks, and exposes expressive assertion methods for multi-tier test suites.

#### Detailed Interface Contracts for `testContext.ts`:

```typescript
import { SimulationHarness, type SimulationHarnessOptions } from './simulationHarness.js';
import type { Vec3Location, MinecraftBotStatus } from '../../src/minecraft/types.js';
import type { RecordedSentMessage } from '../mocks/mockDiscord.js';
import type { RecordedAudioPlayback } from '../mocks/mockVoice.js';
import type { EmbedData } from '../../src/discord/types.js';

export interface TestContextOptions extends SimulationHarnessOptions {
  name?: string;
}

export class TestContext {
  public harness: SimulationHarness;

  constructor(harness: SimulationHarness) {
    this.harness = harness;
  }

  // Lifecycle
  public async setup(): Promise<void> {
    await this.harness.start();
  }

  public async teardown(): Promise<void> {
    await this.harness.stop();
  }

  public reset(): void {
    this.harness.reset();
  }

  // --------------------------------------------------------------------------
  // Assertion Helpers
  // --------------------------------------------------------------------------

  // Discord Text Assertions
  public assertDiscordMessageSent(
    matcher: string | RegExp | ((msg: RecordedSentMessage) => boolean),
    channelId?: string
  ): RecordedSentMessage;

  public assertLastDiscordMessageContains(text: string, channelId?: string): RecordedSentMessage;

  public assertNoDiscordMessageMatching(
    matcher: string | RegExp | ((msg: RecordedSentMessage) => boolean)
  ): void;

  // Discord Embed Assertions
  public assertStatusEmbedUpdated(predicate?: (embed: EmbedData) => boolean): void;
  public assertStatusEmbedColor(expectedColor: number): void;
  public assertStatusEmbedField(fieldName: string, expectedValueSubstring: string): void;

  // Minecraft Assertions
  public assertBotPosition(expected: Vec3Location, tolerance?: number): void;
  public assertBotHealth(expectedHealth: number): void;
  public assertBotFood(expectedFood: number): void;
  public assertInventoryContains(itemName: string, minCount?: number): void;
  public assertWorldBlockAt(pos: Vec3Location, expectedName: string): void;

  // Fair-Play & Anti-Cheat Invariants
  public assertNoPrivilegedCommandsExecuted(): void;
  public assertFairPlayPerceptionHonored(): void;

  // Voice & Audio Assertions
  public assertAudioPlayed(predicate?: (rec: RecordedAudioPlayback) => boolean): RecordedAudioPlayback;
  public assertEmergencyAudioPreemptionOccurred(): void;
  public assertNoAudioPlayed(): void;
}

export async function createTestContext(options?: TestContextOptions): Promise<TestContext> {
  const harness = new SimulationHarness(options);
  const context = new TestContext(harness);
  await context.setup();
  return context;
}
```

---

### 3.3 Multi-Tier Test Suite Strategy

With `SimulationHarness` and `TestContext` in place, Milestone 4 can implement the full 4-tier E2E testing pyramid without requiring external secrets or live networks:

```
┌──────────────────────────────────────────────────────────┐
│ Tier 4: Real-World Scenarios (test/tier4_scenarios/)    │
│  - Complete user journeys: Mining expedition,            │
│    Emergency night defense, Voice task halt,             │
│    Multi-player bridge interaction                       │
├──────────────────────────────────────────────────────────┤
│ Tier 3: Cross-Feature Combinations                      │
│ (test/tier3_combinations/)                               │
│  - Voice -> STT -> Gemini -> Minecraft -> TTS -> Embed   │
│  - Low health warning -> Preemptive alert -> Task halt   │
│  - Chat bridge <-> Anti-loopback <-> In-game broadcast   │
├──────────────────────────────────────────────────────────┤
│ Tier 2: Boundaries & Edge Cases                          │
│ (test/tier2_boundaries/)                                 │
│  - Reach limit > 4.5m rejected                          │
│  - Unexposed ores rejected by anti-xray                  │
│  - Disconnected agent task rejection                     │
│  - 10-turn planner safety guard exhaustion               │
│  - Leaky bucket chat queue overflow                      │
│  - Embed healing on Discord Error 10008                  │
├──────────────────────────────────────────────────────────┤
│ Tier 1: Isolated Feature Coverage                       │
│ (test/tier1_features/)                                   │
│  - 8 Slash commands happy-path execution                 │
│  - Voice receiver silence detection & PCM streaming     │
│  - Priority audio queue & preemption                    │
│  - Fair-play perception (Raycast, Exposure, FOV)         │
│  - Survival loops (Auto-Eat, Auto-Sleep, Auto-Equip)     │
│  - 9 Fair-play tool declarations                         │
└──────────────────────────────────────────────────────────┘
```

---

## 4. Caveats & Edge Assumptions

1. **Native Audio Dependencies**:
   - The production codebase includes optional `@discordjs/voice` bindings and Opus decoders. In offline testing, `MockVoiceSession` and `generateSyntheticPcmTone` operate on standard Node.js `Buffer` and `Readable` streams. No native C++ Opus compilers or audio drivers are required for tests.
2. **Mineflayer Protocol Stubs**:
   - Tests do not bind to real TCP Minecraft servers (port 25565). `MockWorld` and `MockMineflayerBot` provide identical API contracts and spatial math (vector distances, line of sight, 6-face exposure, 70° FOV, voxel manipulation).
3. **Windows Environment Script Execution**:
   - On Windows powershell, executing `npm test` directly encounters `Execution_Policies` restriction on `npm.ps1`. All automated commands must use `cmd /c npm test` or `cmd /c npm run build`, which run cleanly and reliably.
4. **Vitest Multi-Process Forking**:
   - `vitest.config.ts` specifies `pool: 'forks'`. Each test file runs in its own Node.js worker process. `TestContext` instances are fully isolated between test files, preventing state contamination.

---

## 5. Conclusion & Actionable Next Steps

### 5.1 Assessment
The existing codebase architecture (M1 Discord/Audio/Bridge, M2 Minecraft Fair-Play, M3 Gemini Planning) is remarkably modular, clean, and well-covered by 444 unit tests with 100% pass rate. All interfaces (`IDiscordGateway`, `IMinecraftAgent`, `IGeminiPlanner`, `IAudioQueueManager`, `IVoiceSession`) align cleanly with the mock infrastructure.

### 5.2 Deliverable Plan for Milestone 4
1. **Implement `test/harness/simulationHarness.ts`**:
   - Connect `MockDiscordGateway`, `MockVoiceSession`, `MockMinecraftAgent`, `MockGeminiClient`, `MockSTTProvider`, `MockTTSProvider`, `AudioQueueManager`, `ChatBridge`, `StatusEmbedManager`, `CommandRegistry`, `RBACService`, `GeminiPlanner`, and `AgentCoordinator`.
   - Provide `MockPlayerAdapter` bridging `AudioQueueManager` to `MockVoiceSession`.
   - Implement lifecycle controls (`start`, `stop`, `reset`).
   - Implement deterministic simulators (`simulateSlashCommand`, `simulateDiscordChatMessage`, `simulateMinecraftChat`, `simulateUserVoicePrompt`, `simulateWorldBlock`, `simulateBotDamage`, `simulateBotHunger`, `simulateWeather`, `scriptGeminiTurn`).
   - Implement deterministic wait helpers (`waitFor`, `waitForPlannerCompletion`, `waitForDiscordMessage`, `waitForChatBridgeFlushed`, `triggerStatusEmbedTick`).
2. **Implement `test/harness/testContext.ts`**:
   - Implement `TestContext` class with domain assertion helpers for Discord messages, embeds, Minecraft bot state, inventory, fair-play rules, and audio playback.
   - Implement `createTestContext(options)` factory.
3. **Implement `test/harness/index.ts`**:
   - Re-export `simulationHarness.js` and `testContext.js`.
4. **Implement Multi-Tier E2E Test Suites**:
   - `test/tier1_features/`: Happy-path feature coverage.
   - `test/tier2_boundaries/`: Boundary values, reach thresholds, disconnects, rate limits.
   - `test/tier3_combinations/`: Cross-feature multi-subsystem pipelines.
   - `test/tier4_scenarios/`: Real-world end-to-end mission workflows.
5. **Verify Verification & Hardening**:
   - Run `cmd /c npm test` to confirm 100% pass rate across all suites (444 existing + all new E2E tests).
   - Run `cmd /c npm run build` to ensure 0 TypeScript errors.
   - Update `README.md` and `.env.example`.

---

## 6. Verification Method

To independently verify the architecture and harness design:
1. **Test Suite Baseline Check**:
   ```powershell
   cmd /c npm test
   ```
   *Expected*: All 27 test files pass, 444 tests pass (100%), 0 failures.
2. **TypeScript Compilation Check**:
   ```powershell
   cmd /c npm run build
   ```
   *Expected*: Exit code 0, 0 diagnostic errors.
3. **Harness Integration Verification** (once implemented):
   ```powershell
   cmd /c npx vitest run test/tier1_features/
   cmd /c npx vitest run test/tier2_boundaries/
   cmd /c npx vitest run test/tier3_combinations/
   cmd /c npx vitest run test/tier4_scenarios/
   ```
   *Expected*: All tiers pass 100% hermetically without live external API keys or server sockets.
