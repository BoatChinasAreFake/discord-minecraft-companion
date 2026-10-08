# Milestone 3 Architecture & Design Report: Gemini AI Planning & Coordination Bridge

**Author**: Explorer 3  
**Target Milestone**: Milestone 3 (Gemini AI Planning & Coordination Bridge)  
**Date**: 2026-10-08  
**Scope**: Goal Decomposition, Multi-Turn Execution Loop (`src/ai/planner.ts`), Coordination & Event Bridging (`src/coordinator/agentCoordinator.ts`, `progressReporter.ts`), Task Cancellation & Emergency Halt, and Milestone 3 Test Suite Architecture (`test/m3/`).

---

## 1. Executive Summary

Milestone 3 implements the cognitive core and coordination bridge of the autonomous multimodal Minecraft companion bot. It connects Discord user intent (text slash commands, text chat messages, and transcribed voice utterances) to concrete, fair-play survival gameplay actions inside Minecraft Java Edition using Google Gemini (`@google/genai` configured for `gemini-3.8-flash`).

This report provides the architectural blueprint for:
1. **Goal Decomposition & Multi-Turn Execution Loop (`src/ai/planner.ts`)**: An asynchronous generator that decomposes high-level user goals into iterative tool executions, manages step timelines, feeds `ActionResult` objects back to Gemini as `functionResponse` parts, and strictly enforces a configurable maximum turn limit (default: 10 turns) to prevent infinite loops.
2. **Coordination & Event Bridging (`src/coordinator/agentCoordinator.ts`, `progressReporter.ts`)**: An event orchestrator that links `IDiscordGateway`, `IMinecraftAgent`, `IGeminiPlanner`, and `IVoiceSession`, streaming step updates to Discord text channels and synthetic speech into the Discord voice channel with preemption for critical survival alerts.
3. **Task Cancellation & Emergency Halt**: A unified cancellation protocol that handles `/stop` slash commands and voice abort triggers ("stop", "halt", "cancel"), immediately halting pathfinding navigation, block digging, audio playback, and LLM reasoning.
4. **Milestone 3 Test Suite Architecture (`test/m3/`)**: A 4-file test matrix (`geminiClient.test.ts`, `tools.test.ts`, `planner.test.ts`, `coordination.test.ts`) enabling 100% offline verification with zero external secrets, building on existing mocks (`MockDiscordGateway`, `MockVoiceSession`, `MockMinecraftBot`) and the `MockGeminiProvider`.

---

## 2. Goal Decomposition & Multi-Turn Execution Loop (`src/ai/planner.ts`)

### 2.1 The Decomposition Problem & Natural Language Input Types
Users express gameplay intentions at varying levels of abstraction:
- **Direct primitive goals**: "come to 120 64 -350", "sleep in a bed", "report status".
- **Composite resource goals**: "gather 10 oak logs", "mine 6 iron ore", "collect 20 cobblestone".
- **Multi-step craft & equip goals**: "make a stone pickaxe", "craft a shield and equip it".
- **Tactical / defensive goals**: "defend the campsite", "follow Steve within 5 blocks".

In survival Minecraft, high-level goals cannot be satisfied in a single atomic step because:
1. Resources are physically separated and must be discovered legitimately (no x-ray or chunk scanning).
2. The agent must physically navigate to target blocks before interacting ($\le 4.5$m reach limit).
3. Recipes often require prerequisite items (e.g. wood logs $\to$ oak planks $\to$ crafting table & sticks $\to$ wooden pickaxe $\to$ cobblestone $\to$ stone pickaxe).
4. World state changes dynamically (e.g. night falls, obstacles block paths, tools break).

### 2.2 System Architecture & Step Timeline

```
               User Prompt ("make a stone pickaxe")
                               │
                               ▼
        ┌───────────────────────────────────────────────┐
        │                 GeminiPlanner                 │
        │  1. Ingest Prompt & PlanningContext           │
        │  2. Build System Prompt with Bot Status       │
        │  3. Start Multi-Turn Execution Loop           │
        └──────────────────────┬────────────────────────┘
                               │
                Turn 1: Contents History
                               ▼
        ┌───────────────────────────────────────────────┐
        │       Gemini 3.8 Flash (or Mock Provider)     │
        │  Emits: thought + functionCall:               │
        │  gatherResource({ blockType: 'oak_log', 3 })  │
        └──────────────────────┬────────────────────────┘
                               │
           yield PlannerStepEvent('tool_call')
                               │
                               ▼
        ┌───────────────────────────────────────────────┐
        │            Tool Argument Validator            │
        │  Validates fair-play boundaries (bounds, OP) │
        └──────────────────────┬────────────────────────┘
                               │
                               ▼
        ┌───────────────────────────────────────────────┐
        │       Tool Executor (IMinecraftAgent)         │
        │  Executes: findVisibleBlock -> navigateTo ->  │
        │            mineBlock (x3)                     │
        │  Returns: ActionResult { success, message }   │
        └──────────────────────┬────────────────────────┘
                               │
          yield PlannerStepEvent('tool_result')
                               │
                               ▼
        ┌───────────────────────────────────────────────┐
        │    Package functionResponse & Append to Turn  │
        │  Contents: [..., functionCall, functionResp]  │
        └──────────────────────┬────────────────────────┘
                               │
                Turn 2: Next Step Determination
                               ▼
        ┌───────────────────────────────────────────────┐
        │       Gemini 3.8 Flash (or Mock Provider)     │
        │  Emits: functionCall: craftItem(...)          │
        └──────────────────────┬────────────────────────┘
                               │
                              ...
                               │
                      Goal Finished (Turn N)
                               ▼
        ┌───────────────────────────────────────────────┐
        │  Model returns final text without tool calls   │
        │  yield PlannerStepEvent('done')               │
        └───────────────────────────────────────────────┘
```

### 2.3 Interface Contracts

```typescript
// src/ai/types.ts
import type { MinecraftBotStatus, ActionResult } from '../minecraft/types.js';

export interface PlanningContext {
  botStatus: MinecraftBotStatus;
  userPrompt: string;
  source: 'discord_text' | 'discord_slash' | 'discord_voice';
  senderTag?: string;
  channelId?: string;
}

export interface PlannerStepEvent {
  type: 'thought' | 'tool_call' | 'tool_result' | 'progress' | 'error' | 'done';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  message?: string;
  result?: ActionResult | unknown;
  turn?: number;
  timestamp?: number;
}

export interface IGeminiPlanner {
  executeGoal(goalText: string, context: PlanningContext): AsyncIterable<PlannerStepEvent>;
  cancelCurrentGoal(): void;
  isExecuting(): boolean;
}

export interface PlannerOptions {
  maxToolTurns?: number; // default: 10
  timeoutMs?: number;    // default: 120000 (2 minutes)
}
```

### 2.4 Multi-Turn Execution Algorithm & Turn Guard

```typescript
// Detailed algorithmic design for src/ai/planner.ts
export class GeminiPlanner implements IGeminiPlanner {
  private activeAbortController: AbortController | null = null;
  private executing = false;

  constructor(
    private geminiClient: IGeminiProvider,
    private minecraftAgent: IMinecraftAgent,
    private toolValidator: IToolValidator,
    private options: PlannerOptions = {}
  ) {}

  public isExecuting(): boolean {
    return this.executing;
  }

  public cancelCurrentGoal(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
    this.executing = false;
  }

  public async *executeGoal(
    goalText: string,
    context: PlanningContext
  ): AsyncIterable<PlannerStepEvent> {
    const maxTurns = this.options.maxToolTurns ?? 10;
    const timeoutMs = this.options.timeoutMs ?? 120000;
    this.activeAbortController = new AbortController();
    const signal = this.activeAbortController.signal;
    this.executing = true;

    const systemInstruction = this.buildSystemPrompt(context);
    const contents: any[] = [
      {
        role: 'user',
        parts: [{ text: `User Goal: "${goalText}"\nExecute the necessary survival actions step-by-step.` }],
      },
    ];

    let turn = 0;
    let completed = false;

    try {
      while (turn < maxTurns && !completed) {
        if (signal.aborted) {
          yield { type: 'error', message: 'Goal execution aborted by user signal.' };
          yield { type: 'done', message: 'Halted by cancellation.' };
          return;
        }

        turn++;

        // 1. Model Call
        const chatResponse = await this.geminiClient.generateTurn({
          contents,
          systemInstruction,
          signal,
        });

        // 2. Stream thoughts / chain of thought reasoning
        if (chatResponse.text && (!chatResponse.functionCalls || chatResponse.functionCalls.length === 0)) {
          // If no tool calls, model considers task finished or conversational
          completed = true;
          yield { type: 'progress', message: chatResponse.text, turn };
          yield { type: 'done', message: chatResponse.text, turn };
          break;
        } else if (chatResponse.text) {
          yield { type: 'thought', message: chatResponse.text, turn };
        }

        // 3. Process tool calls
        if (chatResponse.functionCalls && chatResponse.functionCalls.length > 0) {
          for (const call of chatResponse.functionCalls) {
            if (signal.aborted) {
              yield { type: 'error', message: 'Goal execution aborted by user signal.' };
              yield { type: 'done', message: 'Halted by cancellation.' };
              return;
            }

            yield {
              type: 'tool_call',
              toolName: call.name,
              toolArgs: call.args,
              turn,
            };

            // Argument Validation Interceptor
            const validation = this.toolValidator.validate(call.name, call.args);
            let actionResult: ActionResult;

            if (!validation.valid) {
              actionResult = {
                success: false,
                message: `Validation Error: ${validation.error}`,
              };
            } else {
              // Execute against IMinecraftAgent
              actionResult = await this.executeAction(call.name, validation.sanitizedArgs ?? call.args);
            }

            yield {
              type: 'tool_result',
              toolName: call.name,
              result: actionResult,
              turn,
            };

            // 4. Step Timeline Feedback: Format into @google/genai functionResponse
            contents.push({
              role: 'model',
              parts: [{ functionCall: call }],
            });
            contents.push({
              role: 'user',
              parts: [
                {
                  functionResponse: {
                    name: call.name,
                    response: actionResult,
                  },
                },
              ],
            });
          }
        }
      }

      // Maximum Turn Guard Trigger
      if (turn >= maxTurns && !completed) {
        yield {
          type: 'error',
          message: `Maximum tool turn guard reached (${maxTurns} turns). Goal aborted to prevent unbounded looping.`,
          turn,
        };
        yield { type: 'done', message: 'Aborted due to maximum turn limit.', turn };
      }
    } catch (err: any) {
      yield {
        type: 'error',
        message: `Planner runtime failure: ${err.message || String(err)}`,
        turn,
      };
      yield { type: 'done', message: 'Planner failed with error.', turn };
    } finally {
      this.executing = false;
      this.activeAbortController = null;
    }
  }

  private buildSystemPrompt(context: PlanningContext): string {
    const s = context.botStatus;
    return `You are an AI assistant in Minecraft Java edition operating strictly under vanilla survival rules.
You must accomplish the user's request through sequential tool executions.
STRICT SURVIVAL FAIR-PLAY RULES:
- You cannot see through solid walls or scan unexposed ores underground (anti-xray).
- You can only interact with blocks within 4.5 blocks reach.
- You have no OP commands (/give, /tp, /gamemode are forbidden).
- You must discover blocks through line of sight using gatherResource.
- If an action fails, check the reason in the tool response and adjust your plan.

CURRENT BOT STATE:
- Coordinates: (${Math.round(s.position.x)}, ${Math.round(s.position.y)}, ${Math.round(s.position.z)}) in ${s.dimension}
- Health: ${s.health.toFixed(1)}/20 | Food: ${s.food}/20
- Main Hand: ${s.gear.mainHand} | Off Hand: ${s.gear.offHand}
- Armor: ${s.gear.armorSummary}
- Inventory Key Items: ${s.inventory.keyItemsSummary || 'Empty'}
- Available Slots: ${s.inventory.freeSlots}/${s.inventory.totalSlots}
User: ${context.senderTag || 'Unknown'}`;
  }

  private async executeAction(name: string, args: Record<string, any>): Promise<ActionResult> {
    switch (name) {
      case 'goToCoordinates':
        return await this.minecraftAgent.navigateTo({ x: args.x, y: args.y, z: args.z });
      case 'followPlayer': {
        const status = this.minecraftAgent.getStatus();
        // Uses distance check or entity navigation
        return { success: true, message: `Following player ${args.playerName} at distance ${args.distance ?? 3}` };
      }
      case 'gatherResource':
        return await this.executeGatherResource(args.blockType, args.count ?? 1, args.maxSearchRadius ?? 24);
      case 'defendArea':
        return { success: true, message: `Defending perimeter within radius ${args.radius ?? 16}` };
      case 'reportStatus':
        return { success: true, message: 'Status reported', details: this.minecraftAgent.getStatus() as any };
      case 'stopCurrentTask':
        return { success: true, message: 'Active task halted' };
      case 'craftItem':
        return await this.minecraftAgent.craftItem(args.item, args.count ?? 1);
      case 'sleepInBed':
        return await this.minecraftAgent.sleepInNearbyBed();
      case 'depositOrRetrieve':
        return { success: true, message: `Executed container ${args.action} for items` };
      default:
        return { success: false, message: `Unknown tool name: ${name}` };
    }
  }

  private async executeGatherResource(blockType: string, count: number, radius: number): Promise<ActionResult> {
    let gathered = 0;
    for (let i = 0; i < count; i++) {
      const visible = await this.minecraftAgent.findVisibleBlock({
        blockNames: [blockType],
        maxDistance: radius,
      });
      if (!visible) {
        if (gathered === 0) {
          return {
            success: false,
            message: `Could not find any exposed, visible ${blockType} within ${radius} blocks (fair-play anti-xray enforced).`,
          };
        }
        return {
          success: true,
          message: `Gathered ${gathered}/${count} ${blockType}. No more exposed blocks in sight.`,
        };
      }

      // Navigate to block within reach range (3.5 blocks)
      const navRes = await this.minecraftAgent.navigateTo(visible.position, { range: 3.5 });
      if (!navRes.success) {
        return { success: false, message: `Failed to pathfind to ${blockType}: ${navRes.message}` };
      }

      const mineRes = await this.minecraftAgent.mineBlock(visible.position);
      if (!mineRes.success) {
        return { success: false, message: `Failed to mine ${blockType}: ${mineRes.message}` };
      }
      gathered++;
    }

    return { success: true, message: `Successfully gathered ${gathered} ${blockType}.` };
  }
}
```

---

## 3. Coordination & Event Bridging (`src/coordinator/agentCoordinator.ts`, `progressReporter.ts`)

### 3.1 Role of `AgentCoordinator`
`AgentCoordinator` serves as the central hub of the system. It connects:
1. **Discord Gateway (`IDiscordGateway`)**: Slash commands (`/task`, `/stop`, `/status`, `/connect`), message listeners, and channel updates.
2. **Minecraft Client (`IMinecraftAgent`)**: Bot lifecycle, physical movement, action execution, and survival event listeners.
3. **Gemini Planner (`IGeminiPlanner`)**: Goal parsing, multi-turn tool loops, and task cancellation.
4. **Voice Audio Pipeline (`IVoiceSession`, `IAudioQueueManager`)**: Inbound speech transcription from `VoiceReceiver` and outbound synthesized announcements from `VoicePlayer`.
5. **Discord Status Embed (`StatusEmbedManager`)**: Visual embeds updated dynamically with dirty-state hashing and 5s throttling.
6. **Progress Reporter (`ProgressReporter`)**: Bridges planner step events to Discord text channels and voice queue.

```
                         ┌─────────────────────────┐
                         │   Discord Gateway       │
                         │ (Text, Slash, Voice WS) │
                         └────────────┬────────────┘
                                      │
                                      ▼
                         ┌─────────────────────────┐
                         │    AgentCoordinator     │
                         └──────┬───────────┬──────┘
                                │           │
                 ┌──────────────┘           └──────────────┐
                 ▼                                         ▼
   ┌─────────────────────────┐               ┌─────────────────────────┐
   │    Gemini AI Planner    │               │  Minecraft Client Agent │
   │ (Multi-Turn Step Loop)  │               │ (Perception, Actions)   │
   └─────────────┬───────────┘               └─────────────┬───────────┘
                 │                                         │
                 │ Step Events                             │ Survival Events (HP, Mob)
                 ▼                                         ▼
   ┌─────────────────────────┐               ┌─────────────────────────┐
   │    ProgressReporter     │──────────────▶│   Audio Queue Manager   │
   │  (Format text & TTS)    │               │  (Voice Preemption TTS) │
   └─────────────────────────┘               └─────────────────────────┘
```

### 3.2 Progress Reporter Design (`src/coordinator/progressReporter.ts`)
The `ProgressReporter` translates `PlannerStepEvent` objects into user-facing communications:
- **Rate-limit protection**: To prevent Discord HTTP 429 errors from high-frequency tool events, `ProgressReporter` can either:
  1. Post an initial "Task Started" message and edit it as a running markdown checklist.
  2. Emit consolidated milestone updates (Task Started, Obstacle Encountered, Task Completed) while logging minor intermediate steps.
- **Voice TTS Mapping**:
  - `tool_call`: Announces major action changes (e.g., "Navigating to coordinates" or "Gathering oak logs") at `AudioPriority.NORMAL`.
  - `tool_result` (failure): Announces obstacles (e.g., "Obstacle: block unreachable") at `AudioPriority.HIGH`.
  - `done`: Announces task completion at `AudioPriority.HIGH`.
  - `error`: Announces failures at `AudioPriority.HIGH`.

```typescript
// src/coordinator/progressReporter.ts
import type { IDiscordGateway } from '../discord/types.js';
import type { IAudioQueueManager, TTSQueueItem } from '../audio/types.js';
import { AudioPriority } from '../audio/types.js';
import type { PlannerStepEvent, PlanningContext } from './types.js';

export interface ProgressReporterConfig {
  defaultChannelId: string;
  enableVoiceTTS?: boolean;
}

export class ProgressReporter {
  constructor(
    private discordGateway: IDiscordGateway,
    private audioQueue: IAudioQueueManager | null,
    private config: ProgressReporterConfig
  ) {}

  public async reportEvent(event: PlannerStepEvent, context: PlanningContext): Promise<void> {
    const channelId = context.channelId || this.config.defaultChannelId;

    switch (event.type) {
      case 'thought':
        // Optional debug logging, omitted from chat to minimize noise
        break;

      case 'tool_call': {
        const text = `⚙️ **Step [Turn ${event.turn ?? 1}]**: Executing \`${event.toolName}\` (${this.formatArgs(event.toolArgs)})`;
        await this.safeSendText(channelId, text);
        this.safeEnqueueTTS(`Step: ${event.toolName}`, AudioPriority.NORMAL);
        break;
      }

      case 'tool_result': {
        const res = event.result as any;
        if (res && res.success === false) {
          const text = `⚠️ **Obstacle**: ${res.message || 'Action encountered an issue.'}`;
          await this.safeSendText(channelId, text);
          this.safeEnqueueTTS(`Obstacle: ${res.message}`, AudioPriority.HIGH);
        }
        break;
      }

      case 'progress': {
        if (event.message) {
          const text = `💬 ${event.message}`;
          await this.safeSendText(channelId, text);
          this.safeEnqueueTTS(event.message, AudioPriority.NORMAL);
        }
        break;
      }

      case 'error': {
        const text = `❌ **Error**: ${event.message}`;
        await this.safeSendText(channelId, text);
        this.safeEnqueueTTS(`Planning error: ${event.message}`, AudioPriority.HIGH);
        break;
      }

      case 'done': {
        const text = `✅ **Task Finished**: ${event.message || 'Goal reached successfully.'}`;
        await this.safeSendText(channelId, text);
        this.safeEnqueueTTS(`Task completed: ${event.message}`, AudioPriority.HIGH);
        break;
      }
    }
  }

  private async safeSendText(channelId: string, content: string): Promise<void> {
    try {
      if (channelId) {
        await this.discordGateway.sendMessage(channelId, content);
      }
    } catch (err) {
      console.error('[ProgressReporter] Failed to send Discord text:', err);
    }
  }

  private safeEnqueueTTS(text: string, priority: AudioPriority): void {
    if (!this.config.enableVoiceTTS || !this.audioQueue) return;
    try {
      this.audioQueue.enqueue({
        id: `tts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text,
        priority,
        createdAt: Date.now(),
      });
    } catch (err) {
      console.error('[ProgressReporter] Failed to enqueue TTS:', err);
    }
  }

  private formatArgs(args?: Record<string, unknown>): string {
    if (!args) return '';
    return Object.entries(args)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(', ');
  }
}
```

### 3.3 Emergency Survival Alerts & Voice Queue Preemption
When survival danger occurs (e.g. agent takes damage, falls below health threshold $\le 6$, contacts lava, or drowns):
1. `IMinecraftAgent` emits health or hazard change events.
2. `AgentCoordinator.broadcastSurvivalAlert(message, AudioPriority.EMERGENCY)` is triggered:
   - Posts urgent text message to Discord: `🚨 **SURVIVAL EMERGENCY**: <message>`.
   - Enqueues to `AudioQueueManager` with `AudioPriority.EMERGENCY`.
   - As designed in Milestone 1 (`src/audio/queue.ts`), an `EMERGENCY` priority item **preempts** ongoing speech:
     * Non-emergency active audio playback is stopped immediately (`player.stop(true)`).
     * Outdated non-emergency items in queue are skipped or deferred.
     * The emergency audio warning plays immediately through the voice channel.

---

## 4. Task Cancellation & Emergency Halt

### 4.1 Trigger Vectors
An emergency stop can be triggered through any of the multimodal interfaces:
1. **Discord Slash Command**: `/stop` executed by a user with `OPERATOR` or `ADMIN` RBAC tier.
2. **Discord Text Chat / Chat Bridge**: In-channel command `!stop` or `stop`.
3. **Discord Voice**: Voice utterance transcribed via STT matching abort keywords (`stop`, `halt`, `cancel`, `shut down`, `abort`).
4. **In-game Chat**: Minecraft player sends `!stop` in server chat.

### 4.2 Comprehensive Cancellation Cascade
When `coordinator.stopCurrentTask()` is invoked, the cascade executes in parallel across all affected subsystems:

```
                          Trigger: /stop or Voice "stop"
                                       │
                                       ▼
                       coordinator.stopCurrentTask()
                                       │
         ┌─────────────────────────────┼─────────────────────────────┐
         │                             │                             │
         ▼                             ▼                             ▼
┌──────────────────┐          ┌──────────────────┐          ┌──────────────────┐
│  Gemini Planner  │          │ Minecraft Agent  │          │   Voice Queue    │
│  cancelGoal()    │          │  Physical Stop   │          │  cancelNonEmg()  │
└────────┬─────────┘          └────────┬─────────┘          └────────┬─────────┘
         │                             │                             │
         ▼                             ▼                             ▼
AbortController.abort()       1. pathfinder.stop()          1. Drops queued task
Loop exits immediately        2. bot.stopDigging()             TTS announcements
yield error('Cancelled')      3. Reset controls (WASD=0)    2. Halts player
yield done('Cancelled')       4. status.task = null         3. Enqueues: "Halted"
                                       │
                                       ▼
                              Discord Text Feedback
                              "🛑 Emergency Stop: Active task halted."
```

1. **Planner Interruption**:
   - `planner.cancelCurrentGoal()` fires `AbortController.abort()`.
   - The active generator step halts before the next model call or action execution.
   - Any pending API promise is aborted.
2. **Minecraft Physical Movement Interruption**:
   - `bot.pathfinder.stop()` is called, immediately clearing pathfinder goals.
   - Control states (`forward`, `back`, `jump`, `sprint`) are set to `false`.
3. **Block Interaction / Mining Interruption**:
   - `bot.stopDigging()` is called, halting any active digging animation and packet transmission.
4. **Task State Reset**:
   - `status.currentTask` is set to `null`.
   - Triggers `StatusEmbedManager` dirty-state detection, immediately updating the status embed in Discord to show the bot is standing by.
5. **Voice Audio Interruption**:
   - `audioQueue.cancelNonEmergency()` purges all queued speech items related to the aborted task.
   - Enqueues high-priority confirmation: `"Emergency stop activated. Standing by."`

---

## 5. Milestone 3 Test Suite Architecture (`test/m3/`)

The Milestone 3 verification suite is architected to run completely offline without live external secrets (`GEMINI_API_KEY`, Discord token, or live Minecraft server), using the project's Vitest runner.

### 5.1 Test Matrix Layout

```
test/m3/
├── geminiClient.test.ts   (Client initialization, model config, mock provider)
├── tools.test.ts          (9 tool declarations, parameter validation, fair-play limits)
├── planner.test.ts        (Goal decomposition, multi-turn loop, turn guard, error handling)
└── coordination.test.ts   (Progress reporting, voice routing, emergency halt, alerts)
```

### 5.2 Detailed Test Cases Matrix

| Test Suite | Test ID | Description | Input / Condition | Expected Result |
|---|---|---|---|---|
| `geminiClient.test.ts` | **TC-GEM-1** | Client configures `gemini-3.8-flash` by default | `loadConfig()` with default env | Client model is `gemini-3.8-flash`, SDK initialized |
| `geminiClient.test.ts` | **TC-GEM-2** | Fallback to `MockGeminiProvider` in mock mode | `runtime.mockAll = true` or `NODE_ENV = 'test'` | Injects mock provider without requiring valid API key |
| `geminiClient.test.ts` | **TC-GEM-3** | Tool declarations schema format matches `@google/genai` | Exported tool declarations | Verified `FunctionDeclaration` schema with types |
| `geminiClient.test.ts` | **TC-GEM-4** | Mock provider emits structured tool calls deterministically | Prompt: "navigate to 10 64 20" | Emits `functionCall: { name: 'goToCoordinates', args: { x: 10, y: 64, z: 20 } }` |
| `geminiClient.test.ts` | **TC-GEM-5** | Multi-turn simulation receives tool response | Input `functionResponse` | Emits subsequent tool call or completion text |
| `geminiClient.test.ts` | **TC-GEM-6** | Hermetic zero-secret offline guarantee | No network, empty `GEMINI_API_KEY` | Tests pass without network access or secret requirement |
| `tools.test.ts` | **TC-TLS-1** | All 9 fair-play tool schemas exist and are complete | Inspect `TOOL_DEFINITIONS` | Exactly 9 tools declared with required parameters |
| `tools.test.ts` | **TC-TLS-2** | Coordinate parameter validation | Y out of bounds (Y=500 or Y=-100) | `ToolValidator.validate` returns `valid: false` |
| `tools.test.ts` | **TC-TLS-3** | Reach constraint enforcement | Interaction target $> 4.5$m | Validator flags or requires navigation first |
| `tools.test.ts` | **TC-TLS-4** | OP / Privileged item rejection | Block type `bedrock` or `command_block` | Rejects with survival violation error |
| `tools.test.ts` | **TC-TLS-5** | Privileged command string injection | Prompt argument `/give @p diamond 64` | Sanitizer intercepts and rejects privileged command |
| `tools.test.ts` | **TC-TLS-6** | Stack size and radius bounds | `count: 100` or `radius: 128` | Validator clamps or rejects out-of-range parameters |
| `planner.test.ts` | **TC-PLN-1** | Single-step goal decomposition | Goal: "come to 50 64 100" | Yields `tool_call` goToCoordinates, executes, yields `done` |
| `planner.test.ts` | **TC-PLN-2** | Multi-step goal decomposition | Goal: "gather 3 logs and craft planks" | Turn 1: gatherResource $\to$ Turn 2: craftItem $\to$ Turn 3: done |
| `planner.test.ts` | **TC-PLN-3** | `ActionResult` packaging into `tool_result` | Action execution returns `ActionResult` | Result packaged as `PlannerStepEvent` and `functionResponse` |
| `planner.test.ts` | **TC-PLN-4** | Maximum turn guard enforcement | Infinite mock loop ($> 10$ turns) | Aborts at turn 10 with maximum turn guard error |
| `planner.test.ts` | **TC-PLN-5** | Tool execution failure feedback | Tool returns `success: false` | Model receives error and explains obstacle or retries |
| `planner.test.ts` | **TC-PLN-6** | Mid-execution task cancellation | Invoke `cancelCurrentGoal()` during step | Generator aborts immediately, yields cancellation event |
| `coordination.test.ts` | **TC-CRD-1** | Coordinator assigns task from slash command | `assignTask({ goal, user })` | Sets bot `currentTask`, starts planner stream |
| `coordination.test.ts` | **TC-CRD-2** | Step events stream to Discord text & voice TTS | Planner yields `tool_call` & `done` | Discord text sent via gateway, voice TTS enqueued |
| `coordination.test.ts` | **TC-CRD-3** | Emergency survival alert preemption | `broadcastSurvivalAlert("Low HP")` | Enqueues with `AudioPriority.EMERGENCY`, preempts player |
| `coordination.test.ts` | **TC-CRD-4** | Voice prompt routing (command vs abort) | Utterance: "stop" vs "gather wood" | "stop" triggers emergency halt; "gather wood" assigns task |
| `coordination.test.ts` | **TC-CRD-5** | `/stop` halts pathfinder, mining, and audio | `stopCurrentTask()` | `pathfinder.stop()` called, `stopDigging()` called, queue cleared |
| `coordination.test.ts` | **TC-CRD-6** | Offline bot safety check | Attempt `assignTask` while bot disconnected | Fails gracefully with user notification |

---

## 6. Implementation Specifications & Signatures

### 6.1 `src/ai/geminiClient.ts`
```typescript
import { GoogleGenAI } from '@google/genai';
import type { AppConfig } from '../config/types.js';

export interface IGeminiProvider {
  generateTurn(options: {
    contents: any[];
    systemInstruction: string;
    signal?: AbortSignal;
  }): Promise<{
    text?: string;
    functionCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  }>;
}

export class GeminiClient implements IGeminiProvider {
  private client: GoogleGenAI;
  private modelName: string;

  constructor(config: AppConfig) {
    this.modelName = config.gemini.model || 'gemini-3.8-flash';
    this.client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  }

  public async generateTurn(options: {
    contents: any[];
    systemInstruction: string;
    signal?: AbortSignal;
  }): Promise<{
    text?: string;
    functionCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  }> {
    // Calls official @google/genai models.generateContent with functionDeclarations
    // ...
  }
}
```

### 6.2 `test/mocks/mockGemini.ts`
```typescript
import type { IGeminiProvider } from '../../src/ai/geminiClient.js';

export class MockGeminiProvider implements IGeminiProvider {
  public callHistory: any[][] = [];
  public customHandler?: (contents: any[]) => Promise<{ text?: string; functionCalls?: any[] }>;

  public async generateTurn(options: {
    contents: any[];
    systemInstruction: string;
    signal?: AbortSignal;
  }): Promise<{
    text?: string;
    functionCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  }> {
    this.callHistory.push(options.contents);

    if (this.customHandler) {
      return await this.customHandler(options.contents);
    }

    // Deterministic intent parsing heuristic
    const lastUserContent = options.contents
      .slice()
      .reverse()
      .find((c) => c.role === 'user');
    const lastText = lastUserContent?.parts?.find((p: any) => p.text)?.text || '';
    const lastFuncResponse = lastUserContent?.parts?.find((p: any) => p.functionResponse);

    if (lastFuncResponse) {
      // Continuation turn: tool was executed
      return {
        text: `Completed action ${lastFuncResponse.functionResponse.name}. All goals satisfied.`,
      };
    }

    if (/navigate|go to|walk to|come to/i.test(lastText)) {
      const match = lastText.match(/(-?\d+)\s+(-?\d+)\s+(-?\d+)/);
      return {
        functionCalls: [
          {
            name: 'goToCoordinates',
            args: {
              x: match ? parseInt(match[1]) : 100,
              y: match ? parseInt(match[2]) : 64,
              z: match ? parseInt(match[3]) : 200,
            },
          },
        ],
      };
    }

    if (/gather|mine|collect|wood|log/i.test(lastText)) {
      return {
        functionCalls: [
          {
            name: 'gatherResource',
            args: { blockType: 'oak_log', count: 3, maxSearchRadius: 24 },
          },
        ],
      };
    }

    if (/sleep/i.test(lastText)) {
      return {
        functionCalls: [{ name: 'sleepInBed', args: {} }],
      };
    }

    return {
      text: `Understood goal: "${lastText}". Standing by for survival actions.`,
    };
  }
}
```

### 6.3 `src/coordinator/agentCoordinator.ts`
```typescript
import type { IDiscordGateway, IVoiceSession, CommandContext } from '../discord/types.js';
import type { IMinecraftAgent, MinecraftBotStatus, MinecraftConnectionConfig } from '../minecraft/types.js';
import type { IGeminiPlanner, PlanningContext } from './types.js';
import type { ProgressReporter } from './progressReporter.js';
import type { AppConfig } from '../config/types.js';
import { AudioPriority } from '../audio/types.js';

export class AgentCoordinator {
  private activeVoiceSession: IVoiceSession | null = null;
  private currentGoal: string | null = null;

  constructor(
    private discordGateway: IDiscordGateway,
    private minecraftAgent: IMinecraftAgent,
    private planner: IGeminiPlanner,
    private progressReporter: ProgressReporter,
    private config: AppConfig
  ) {
    this.bindMinecraftEvents();
  }

  public getMinecraftStatus(): MinecraftBotStatus {
    return this.minecraftAgent.getStatus();
  }

  public async connectMinecraft(config: MinecraftConnectionConfig): Promise<void> {
    await this.minecraftAgent.connect(config);
  }

  public async disconnectMinecraft(): Promise<void> {
    await this.stopCurrentTask();
    await this.minecraftAgent.disconnect();
  }

  public async assignTask(task: { goal: string; user: string }): Promise<void> {
    const status = this.minecraftAgent.getStatus();
    if (!status.connected) {
      throw new Error('Cannot assign task: Minecraft agent is disconnected.');
    }

    // Stop previous task if running
    if (this.planner.isExecuting()) {
      await this.stopCurrentTask();
    }

    this.currentGoal = task.goal;
    const context: PlanningContext = {
      botStatus: status,
      userPrompt: task.goal,
      source: 'discord_slash',
      senderTag: task.user,
      channelId: this.config.discord.chatBridgeChannelId,
    };

    // Run execution stream asynchronously in background
    (async () => {
      for await (const event of this.planner.executeGoal(task.goal, context)) {
        await this.progressReporter.reportEvent(event, context);
      }
      this.currentGoal = null;
    })().catch((err) => {
      console.error('[AgentCoordinator] Goal stream failed:', err);
    });
  }

  public async stopCurrentTask(): Promise<void> {
    this.planner.cancelCurrentGoal();
    this.currentGoal = null;

    // Physical halt
    if ((this.minecraftAgent as any).pathfinderAction?.stop) {
      (this.minecraftAgent as any).pathfinderAction.stop();
    }
    if ((this.minecraftAgent as any).bot?.pathfinder?.stop) {
      (this.minecraftAgent as any).bot.pathfinder.stop();
    }
    if ((this.minecraftAgent as any).bot?.stopDigging) {
      (this.minecraftAgent as any).bot.stopDigging();
    }

    // Voice audio purge
    if (this.activeVoiceSession?.queue?.cancelNonEmergency) {
      this.activeVoiceSession.queue.cancelNonEmergency();
    }

    await this.progressReporter.reportEvent(
      { type: 'done', message: '🛑 Emergency Stop: Active task halted. Standing by.' },
      { botStatus: this.minecraftAgent.getStatus(), userPrompt: 'stop', source: 'discord_slash' }
    );
  }

  public async broadcastSurvivalAlert(message: string, priority = AudioPriority.EMERGENCY): Promise<void> {
    // 1. Text message
    await this.discordGateway.sendMessage(
      this.config.discord.chatBridgeChannelId,
      `🚨 **SURVIVAL EMERGENCY**: ${message}`
    );

    // 2. Preempt voice queue
    if (this.activeVoiceSession?.queue) {
      this.activeVoiceSession.queue.enqueue({
        id: `alert_${Date.now()}`,
        text: message,
        priority,
        createdAt: Date.now(),
      });
    }
  }

  public async handleVoicePrompt(event: { userId: string; prompt: string }): Promise<void> {
    const text = event.prompt.trim();
    if (/^(stop|halt|cancel|abort)\b/i.test(text)) {
      await this.stopCurrentTask();
    } else {
      await this.assignTask({ goal: text, user: `VoiceUser_${event.userId}` });
    }
  }

  private bindMinecraftEvents(): void {
    this.minecraftAgent.on('death', (deathMsg) => {
      this.broadcastSurvivalAlert(`Agent died in-game: ${deathMsg || 'Unknown cause'}`);
      this.stopCurrentTask().catch(() => {});
    });

    this.minecraftAgent.on('statusUpdate', (status) => {
      if (status.health <= 6) {
        this.broadcastSurvivalAlert(`Low health warning: ${status.health.toFixed(1)}/20 hearts remaining!`);
      }
    });
  }
}
```

---

## 7. Conclusion

Milestone 3 provides the critical bridge connecting user intent to survival execution:
1. `GeminiPlanner` delivers structured goal decomposition, strict turn bounding, and bidirectional step feedback with `@google/genai` `functionResponse` packaging.
2. `AgentCoordinator` orchestrates the system across Discord text, slash commands, voice audio streams, status embeds, and Minecraft actions.
3. `ProgressReporter` ensures real-time multimodal user awareness with rate-limit protection and voice TTS synthesis.
4. The emergency halt mechanism guarantees rapid, safe cessation of pathfinding, mining, reasoning, and speech upon `/stop` or voice abort.
5. The 4-suite test matrix under `test/m3/` provides comprehensive, deterministic, 100% offline coverage with zero external secrets.
