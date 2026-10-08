# Milestone 3 Architecture & Design Report: Gemini AI Planning & Coordination Bridge

**Author**: Explorer 1 (Milestone 3 Architecture & Investigation)  
**Date**: 2026-10-08  
**Target Systems**: `src/ai/`, `test/mocks/mockGemini.ts`  
**Dependencies**: `@google/genai` (v2.27.0, installed), `mineflayer` (v4.20.1), `zod` (v3.23.8)

---

## 1. Executive Summary & Objective

The objective of Milestone 3 is to build the AI Planning and Coordination Bridge connecting natural language commands from Discord (text slash commands `/task` or voice STT audio transcripts) to concrete, fair-play survival actions executed by the Mineflayer Minecraft agent.

This investigation analyzes:
1. **Google Gemini SDK Integration (`src/ai/geminiClient.ts`)**:
   - Official `@google/genai` SDK (version 2.27.0 installed).
   - Primary model `gemini-3.8-flash` as configured in `src/config/env.ts`.
   - Tool declaration format conforming to `@google/genai` `FunctionDeclaration` specifications.
   - Stateful multi-turn chat and function calling flow (`chats.create` or `models.generateContent`).
2. **Offline Mock Gemini Provider (`test/mocks/mockGemini.ts`)**:
   - Deterministic, zero-secret offline mock client implementing the exact same interface as the live client.
   - Natural language intent parser using regular expressions and heuristics to match goals to the 9 fair-play tools.
   - State machine simulating multi-turn reasoning and tool execution feedback loops.
   - Programmable scriptable responses for deterministic testing in CI and test harnesses.
3. **Architectural Interface Contracts (`src/ai/types.ts`)**:
   - Unified interface `IGeminiClient` and `IGeminiSession` enabling 100% interchangeable dependency injection between live and mock providers.
   - Decoupled `IGeminiPlanner` yielding an `AsyncIterable<PlannerStepEvent>` stream for real-time Discord feedback.

---

## 2. Official `@google/genai` SDK (v2.27.0) Deep-Dive

### 2.1 Package Analysis & Verification
In `package.json`, `@google/genai` is listed as `^2.3.0`. The actual installed package in `node_modules/@google/genai` is **v2.27.0**.
Key properties verified from runtime exports and type definitions:
- **Client Class**: `import { GoogleGenAI } from '@google/genai'`
- **Client Constructor**:
  ```typescript
  const ai = new GoogleGenAI({
    apiKey: config.gemini.apiKey,
    vertexai: false, // Default MLDev Gemini Developer API
  });
  ```
- **Type Enums**:
  ```typescript
  import { Type, FunctionCallingConfigMode } from '@google/genai';
  // Type: { STRING: 'STRING', NUMBER: 'NUMBER', INTEGER: 'INTEGER', BOOLEAN: 'BOOLEAN', ARRAY: 'ARRAY', OBJECT: 'OBJECT' }
  // FunctionCallingConfigMode: { AUTO: 'AUTO', ANY: 'ANY', NONE: 'NONE', VALIDATED: 'VALIDATED' }
  ```
- **Type Interfaces**:
  - `FunctionDeclaration`: Structured tool declaration with `name`, `description`, `parameters: Schema`.
  - `Schema`: Type specification with `type`, `description`, `properties`, `required`, `enum`, etc.
  - `Tool`: `{ functionDeclarations?: FunctionDeclaration[] }`.
  - `GenerateContentConfig`: Config container including `tools`, `toolConfig`, `systemInstruction`, `temperature`, `maxOutputTokens`.
  - `FunctionCall`: `{ name: string, args: Record<string, unknown>, id?: string }`.
  - `FunctionResponse`: `{ name: string, response: Record<string, unknown>, id?: string }`.
  - `GenerateContentResponse`: Response object with getter `.text` and getter `.functionCalls`.

### 2.2 Chat & Multi-Turn Session Architecture
The SDK provides `ai.chats.create({ model, config, history })`:
```typescript
const chat = ai.chats.create({
  model: 'gemini-3.8-flash',
  config: {
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: FAIR_PLAY_TOOLS }],
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingConfigMode.AUTO,
      },
    },
    temperature: 0.2, // Low temperature for deterministic planning
  },
});
```
When sending user prompts:
```typescript
const response = await chat.sendMessage({ message: userGoalText });
```
When handling tool execution results:
```typescript
const toolResponseTurn = await chat.sendMessage({
  message: [{
    functionResponse: {
      name: toolCall.name,
      response: { output: executionResult },
      id: toolCall.id,
    },
  }],
});
```
`Chat` automatically manages curated history alternation (`user` -> `model` -> `user (functionResponse)` -> `model`), preventing history corruption or manual state assembly errors.

---

## 3. The 9 Structured Fair-Play Tool Declarations

All 9 tools adhere to vanilla survival mechanics and fair-play boundaries. In `src/ai/tools/definitions.ts`:

### 1. `goToCoordinates`
- **Description**: "Navigate the bot to specific world coordinates (x, y, z) using legitimate pathfinding without teleportation."
- **Parameters**:
  ```typescript
  {
    type: Type.OBJECT,
    properties: {
      x: { type: Type.NUMBER, description: "Target X coordinate" },
      y: { type: Type.NUMBER, description: "Target Y coordinate" },
      z: { type: Type.NUMBER, description: "Target Z coordinate" },
      range: { type: Type.NUMBER, description: "Distance tolerance in blocks to stop within (default 1.0)" }
    },
    required: ["x", "y", "z"]
  }
  ```

### 2. `followPlayer`
- **Description**: "Follow a designated player within survival visual range, maintaining safe proximity."
- **Parameters**:
  ```typescript
  {
    type: Type.OBJECT,
    properties: {
      playerName: { type: Type.STRING, description: "Minecraft username of player to follow" },
      distance: { type: Type.NUMBER, description: "Desired follow distance in blocks (default 3.0)" }
    },
    required: ["playerName"]
  }
  ```

### 3. `gatherResource`
- **Description**: "Search for visible exposed blocks of a resource and mine them step-by-step under fair-play perception rules."
- **Parameters**:
  ```typescript
  {
    type: Type.OBJECT,
    properties: {
      resourceName: { type: Type.STRING, description: "Target block/item name (e.g., 'oak_log', 'iron_ore', 'dirt')" },
      count: { type: Type.INTEGER, description: "Target quantity of resources to gather (1 to 64)" }
    },
    required: ["resourceName", "count"]
  }
  ```

### 4. `defendArea`
- **Description**: "Patrol the immediate area and engage hostile entities using standard combat reach (<= 3.5m) and shield blocking."
- **Parameters**:
  ```typescript
  {
    type: Type.OBJECT,
    properties: {
      radius: { type: Type.NUMBER, description: "Perimeter defense radius in blocks (clamped 3 to 32, default 16)" },
      durationSec: { type: Type.INTEGER, description: "Patrol duration in seconds (default 30)" }
    },
    required: []
  }
  ```

### 5. `reportStatus`
- **Description**: "Inspect and report bot health, hunger, current coordinates, dimension, equipped gear, and inventory contents."
- **Parameters**:
  ```typescript
  {
    type: Type.OBJECT,
    properties: {
      includeInventory: { type: Type.BOOLEAN, description: "Whether to include detailed inventory slot breakdown (default true)" }
    },
    required: []
  }
  ```

### 6. `stopCurrentTask`
- **Description**: "Immediately halt all active pathfinding, mining, combat, or multi-step execution tasks."
- **Parameters**:
  ```typescript
  {
    type: Type.OBJECT,
    properties: {
      reason: { type: Type.STRING, description: "Reason for halting execution" }
    },
    required: []
  }
  ```

### 7. `craftItem`
- **Description**: "Craft an item recipe using player 2x2 crafting or an accessible nearby 3x3 crafting table."
- **Parameters**:
  ```typescript
  {
    type: Type.OBJECT,
    properties: {
      recipeName: { type: Type.STRING, description: "Name of item to craft (e.g. 'crafting_table', 'wooden_pickaxe')" },
      count: { type: Type.INTEGER, description: "Quantity of items to craft (default 1)" }
    },
    required: ["recipeName"]
  }
  ```

### 8. `sleepInBed`
- **Description**: "Locate an accessible bed within reach and sleep through night or thunderstorm."
- **Parameters**:
  ```typescript
  {
    type: Type.OBJECT,
    properties: {
      maxDistance: { type: Type.NUMBER, description: "Maximum search distance for bed in blocks (default 16)" }
    },
    required: []
  }
  ```

### 9. `depositOrRetrieve`
- **Description**: "Deposit items into or retrieve items from a container (chest/barrel) within vanilla reach (<= 4.5m)."
- **Parameters**:
  ```typescript
  {
    type: Type.OBJECT,
    properties: {
      action: { type: Type.STRING, enum: ["deposit", "retrieve"], description: "Whether to deposit or retrieve items" },
      itemName: { type: Type.STRING, description: "Name of item to transfer" },
      count: { type: Type.INTEGER, description: "Number of items to transfer (1 to 64)" },
      containerPosition: {
        type: Type.OBJECT,
        properties: {
          x: { type: Type.NUMBER },
          y: { type: Type.NUMBER },
          z: { type: Type.NUMBER }
        },
        description: "Coordinates of container block (optional; searches nearest if omitted)"
      }
    },
    required: ["action", "itemName", "count"]
  }
  ```

---

## 4. Fair-Play Parameter Validation & Anti-Cheat Interceptor (`validator.ts`)

Before any tool call is dispatched to `IMinecraftAgent`, it must pass through `validateToolCall(name, args)`:

1. **Boundary Constraints**:
   - `x`, `y`, `z`: Must be finite numbers. $y$ clamped between $-64$ and $320$.
   - `count`: Clamped to $[1, 64]$.
   - `radius`: Clamped to $[3, 32]$.
   - `distance`: Clamped to $[1, 16]$.
2. **Anti-Cheat & OP Prohibition**:
   - Disallowed block/item names: `bedrock`, `barrier`, `command_block`, `structure_block`, `debug_stick`.
   - String sanitizer: All text arguments sanitized via `sanitizeMinecraftMessage` (blocking `/op`, `/tp`, `/gamemode`, `/give`, etc.).
3. **Reach Pre-check**:
   - If direct container coordinates are specified, enforce reach $\le 4.5$m from bot eye position, or trigger auto-pathfinding to container first.

---

## 5. Interface Contracts (`src/ai/types.ts`)

To enable seamless dependency injection and interchangeability between live Gemini and mock Gemini:

```typescript
export interface ToolCallRequest {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiTurnResponse {
  text?: string;
  toolCalls?: ToolCallRequest[];
}

export interface IGeminiSession {
  sendUserMessage(prompt: string): Promise<GeminiTurnResponse>;
  sendToolResponse(toolName: string, result: unknown, callId?: string): Promise<GeminiTurnResponse>;
  getHistory(): unknown[];
}

export interface IGeminiClient {
  createSession(options?: { systemInstruction?: string }): Promise<IGeminiSession>;
}

export interface PlannerStepEvent {
  type: 'thought' | 'tool_call' | 'tool_result' | 'progress' | 'error' | 'done';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  message?: string;
  result?: unknown;
}

export interface IGeminiPlanner {
  executeGoal(goalText: string, context: PlanningContext): AsyncIterable<PlannerStepEvent>;
  cancelCurrentGoal(): void;
}
```

---

## 6. Offline Mock Gemini Provider Design (`test/mocks/mockGemini.ts`)

### 6.1 Architecture
The mock provider must run with zero internet connection and zero external credentials, satisfying:
- Implements `IGeminiClient` and `IGeminiSession`.
- Has built-in deterministic heuristic & regex rules covering all 9 tools and multi-step plans.
- Maintains multi-turn conversation state: remembers previous tool calls and produces appropriate step completions or next steps.
- Exposes a scriptable override API (`setScriptedTurns`, `addScenario`) for fine-grained test cases.

### 6.2 Deterministic Intent Matching Rules

| Tool | Matching Patterns (Regex / Heuristic) | Generated `ToolCallRequest` |
|---|---|---|
| `goToCoordinates` | `/(?:go\s+to|navigate\s+to|coords?)\s+(-?\d+)[,\s]+(-?\d+)[,\s]+(-?\d+)/i` | `{ name: 'goToCoordinates', args: { x: $1, y: $2, z: $3 } }` |
| `followPlayer` | `/(?:follow|come\s+to)\s+([a-zA-Z0-9_]+)/i` | `{ name: 'followPlayer', args: { playerName: $1, distance: 3 } }` |
| `gatherResource` | `/(?:gather|mine|chop|collect|get)\s+(\d+)?\s*([a-zA-Z0-9_]+)/i` | `{ name: 'gatherResource', args: { resourceName: $2, count: $1 || 1 } }` |
| `defendArea` | `/(?:defend|protect|guard|patrol)\s*(?:area|perimeter|base)?/i` | `{ name: 'defendArea', args: { radius: 16, durationSec: 30 } }` |
| `reportStatus` | `/(?:status|where\s+are\s+you|health|hp|inventory|gear)/i` | `{ name: 'reportStatus', args: { includeInventory: true } }` |
| `stopCurrentTask` | `/(?:stop|halt|cancel|abort|freeze)/i` | `{ name: 'stopCurrentTask', args: { reason: 'User requested stop' } }` |
| `craftItem` | `/(?:craft|make|create)\s+(\d+)?\s*([a-zA-Z0-9_]+)/i` | `{ name: 'craftItem', args: { recipeName: $2, count: $1 || 1 } }` |
| `sleepInBed` | `/(?:sleep|bed|night)/i` | `{ name: 'sleepInBed', args: { maxDistance: 16 } }` |
| `depositOrRetrieve` | `/(?:deposit|store|put)\s+(\d+)?\s*([a-zA-Z0-9_]+)/i` | `{ name: 'depositOrRetrieve', args: { action: 'deposit', itemName: $2, count: $1 || 1 } }` |
| `depositOrRetrieve` | `/(?:withdraw|retrieve|take|grab)\s+(\d+)?\s*([a-zA-Z0-9_]+)/i` | `{ name: 'depositOrRetrieve', args: { action: 'retrieve', itemName: $2, count: $1 || 1 } }` |

### 6.3 Multi-Turn Simulation Flow
```
User Prompt: "gather 10 oak logs and craft a crafting table"
                    │
                    ▼ [sendUserMessage]
   Turn 1 Response: toolCalls: [gatherResource({ resourceName: 'oak_log', count: 10 })]
                    │
                    ▼ [sendToolResponse: gatherResource -> success]
   Turn 2 Response: toolCalls: [craftItem({ recipeName: 'crafting_table', count: 1 })]
                    │
                    ▼ [sendToolResponse: craftItem -> success]
   Turn 3 Response: text: "I have gathered 10 oak logs and crafted a crafting table."
```

### 6.4 Programmable Test Script API
```typescript
mockGemini.setScriptedTurns([
  { toolCalls: [{ name: 'goToCoordinates', args: { x: 10, y: 64, z: 20 } }] },
  { text: 'Arrived safely at target position.' },
]);
```
This guarantees 100% deterministic test coverage across unit tests, boundary tests, and end-to-end integration scenarios.

---

## 7. Planner Execution Loop (`src/ai/planner.ts`)

```typescript
export class GeminiPlanner implements IGeminiPlanner {
  private abortController: AbortController | null = null;

  constructor(
    private client: IGeminiClient,
    private agent: IMinecraftAgent,
    private maxSteps: number = 5
  ) {}

  public async *executeGoal(goalText: string, context: PlanningContext): AsyncIterable<PlannerStepEvent> {
    this.abortController = new AbortController();
    const session = await this.client.createSession();
    
    yield { type: 'thought', message: `Analyzing goal: "${goalText}"` };
    let turn = await session.sendUserMessage(goalText);
    let stepCount = 0;

    while (stepCount < this.maxSteps) {
      if (this.abortController.signal.aborted) {
        yield { type: 'error', message: 'Goal cancelled by user.' };
        return;
      }

      if (!turn.toolCalls || turn.toolCalls.length === 0) {
        yield { type: 'done', message: turn.text || 'Goal completed.' };
        return;
      }

      for (const call of turn.toolCalls) {
        yield { type: 'tool_call', toolName: call.name, toolArgs: call.args };
        
        // Fair-play validation
        const val = validateToolCall(call.name, call.args);
        if (!val.valid) {
          yield { type: 'error', message: `Fair-play validation failed: ${val.error}` };
          turn = await session.sendToolResponse(call.name, { error: val.error }, call.id);
          continue;
        }

        // Execute on Minecraft Agent
        const execResult = await this.executeAction(call.name, val.sanitizedArgs);
        yield { type: 'tool_result', toolName: call.name, result: execResult };
        
        stepCount++;
        turn = await session.sendToolResponse(call.name, execResult, call.id);
      }
    }

    yield { type: 'done', message: 'Max planning steps reached.' };
  }

  public cancelCurrentGoal(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}
```

---

## 8. Integration & Verification Plan

1. **Unit Testing (`test/m3/gemini.test.ts`)**:
   - Validate all 9 `FunctionDeclaration` schemas against the OpenAPI/Gemini schema rules.
   - Verify `validateToolCall` enforces fair-play constraints (reach $\le 4.5$m, Y bounds, count clamping, OP blocking).
   - Test `MockGeminiClient` intent regex matching across all 9 actions.
   - Test multi-turn simulation in `MockGeminiSession`.
2. **Planner Integration Testing (`test/m3/planner.test.ts`)**:
   - Test `GeminiPlanner` wired with `MockGeminiClient` and `MockMinecraftAgent`.
   - Verify step sequence events (`thought` -> `tool_call` -> `tool_result` -> `done`).
   - Verify emergency cancellation via `cancelCurrentGoal()`.
   - Verify error recovery when action fails.
3. **Discord Coordination Integration**:
   - Validate `/task` and STT voice prompts trigger `agentCoordinator.assignTask`.
   - Validate live Discord progress reporting and TTS audio priority queue alerts.
