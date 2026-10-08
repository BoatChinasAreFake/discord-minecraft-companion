# Milestone 3 Explorer 2 Investigation & Design Report: Structured Fair-Play Tool Declarations & Validation Interceptor

**Author**: Explorer 2 (Milestone 3: Gemini AI Planning & Coordination Bridge)  
**Date**: 2026-10-08  
**Project Workspace**: `c:\Users\rando\Documents\antigravity\wise-pasteur`  
**Working Directory**: `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m3_2`  

---

## 1. Executive Summary & Problem Boundary

In Milestone 3 (Gemini AI Planning & Coordination Bridge), the autonomous agent translates multimodal Discord user prompts into structured in-game Minecraft survival actions using Google Gemini (`gemini-3.8-flash` via official `@google/genai` >= 2.3.0).

Under strict **Fair-Play Survival Rules (R2 & R3)**, the AI agent must never cheat, use OP/administrative commands, scan hidden underground chunks (no x-ray), or interact beyond vanilla survival physical boundaries. Because Large Language Model (LLM) tool call generations are inherently probabilistic and susceptible to prompt injections, hallucinations, or malformed parameters, a dual-layer architectural defense is mandatory:
1. **The 9 Structured Fair-Play Tool Declarations (`src/ai/tools/definitions.ts`)**: Explicit OpenAPI 3.03 / JSON Schema declarations passed to Gemini to strictly constrain the model's action space to legitimate survival primitives.
2. **The Validation Interceptor (`src/ai/tools/validator.ts`)**: A strict, zero-trust validation interceptor placed between Gemini's tool calls and the Minecraft client engine (`IMinecraftAgent`), deterministically rejecting illegal coordinates, out-of-reach interactions, privileged items, command injections, and boundary violations before any game action can execute.

This report delivers the complete architectural design, JSON Schema specifications, TypeScript contracts, validation algorithms, and test coverage matrix for both subsystems.

---

## 2. The 9 Structured Fair-Play Tool Declarations (`src/ai/tools/definitions.ts`)

### 2.1 Tool Inventory & Semantic Purpose

| # | Tool Name | Scope & Purpose | Required Parameters | Optional Parameters |
|---|-----------|-----------------|---------------------|---------------------|
| 1 | `goToCoordinates` | Navigates bot to 3D world coordinates using safe pathfinding | `x: number`, `y: number`, `z: number` | None |
| 2 | `followPlayer` | Follows a player maintaining safe survival distance | `playerName: string` | `distance?: number` (default 3) |
| 3 | `gatherResource` | Searches and legitimately mines visible surface/exposed resources | `blockType: string`, `count: number` | `maxSearchRadius?: number` (default 16) |
| 4 | `defendArea` | Patrols and defends area using 1.9+ weapon cooldown & shield | None | `radius?: number` (default 16), `targetHostilesOnly?: boolean` (default true) |
| 5 | `reportStatus` | Returns health, hunger, coordinates, dimension, gear, inventory | None | `includeInventory?: boolean`, `includePosition?: boolean` |
| 6 | `stopCurrentTask` | Immediately halts active pathfinding, mining, or combat goal | None | `reason?: string` |
| 7 | `craftItem` | Crafts item via 2x2 grid or nearby 3x3 crafting table | `item: string`, `count: number` | None |
| 8 | `sleepInBed` | Locates and rests in nearby bed during night/thunderstorm | None | None (`{}`) |
| 9 | `depositOrRetrieve` | Deposits or retrieves items from nearby container (<= 4.5m reach) | `action: 'deposit' \| 'retrieve'`, `items: ItemQuantity[]` | `containerCoordinates?: { x, y, z }` |

---

### 2.2 Complete JSON Schema / `@google/genai` Declarations

Gemini 3.8 Flash via `@google/genai` requires tool definitions using the `Type` enum (`STRING`, `NUMBER`, `INTEGER`, `BOOLEAN`, `ARRAY`, `OBJECT`). Below is the exact schema specification:

#### 1) `goToCoordinates`
```typescript
export const goToCoordinatesDeclaration: FunctionDeclaration = {
  name: 'goToCoordinates',
  description:
    'Navigate the Minecraft bot to the specified 3D world coordinates using safe survival pathfinding. Respects fall damage, liquid hazards, and physical obstacle collision.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      x: { type: Type.NUMBER, description: 'Target X coordinate in the Minecraft world.' },
      y: { type: Type.NUMBER, description: 'Target Y coordinate in the Minecraft world (clamped to survival bounds: -64 to 320).' },
      z: { type: Type.NUMBER, description: 'Target Z coordinate in the Minecraft world.' },
    },
    required: ['x', 'y', 'z'],
  },
};
```

#### 2) `followPlayer`
```typescript
export const followPlayerDeclaration: FunctionDeclaration = {
  name: 'followPlayer',
  description:
    'Follow a specified player within the Minecraft world while maintaining a safe survival distance and pathfinding around hazards.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      playerName: { type: Type.STRING, description: 'The in-game username of the player to follow.' },
      distance: { type: Type.NUMBER, description: 'Target following distance in blocks (default: 3.0, allowed range: 1.0 to 32.0).' },
    },
    required: ['playerName'],
  },
};
```

#### 3) `gatherResource`
```typescript
export const gatherResourceDeclaration: FunctionDeclaration = {
  name: 'gatherResource',
  description:
    'Search for, navigate to, and legitimately harvest/mine a specified survival block resource without cheating or x-ray. Operates strictly within line-of-sight and surface exposure rules.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      blockType: { type: Type.STRING, description: 'The standard Minecraft block identifier to harvest (e.g., "oak_log", "iron_ore", "cobblestone").' },
      count: { type: Type.INTEGER, description: 'The quantity of resource blocks to collect (between 1 and 64).' },
      maxSearchRadius: { type: Type.NUMBER, description: 'Maximum horizontal search radius in blocks from current location (max: 32, default: 16).' },
    },
    required: ['blockType', 'count'],
  },
};
```

#### 4) `defendArea`
```typescript
export const defendAreaDeclaration: FunctionDeclaration = {
  name: 'defendArea',
  description:
    'Patrol and defend the immediate area against hostile threats within a specified radius using fair-play combat (weapon cooldown gauge timing and shield blocking).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      radius: { type: Type.NUMBER, description: 'Defensive patrol radius in blocks around current position (max: 32, default: 16).' },
      targetHostilesOnly: { type: Type.BOOLEAN, description: 'Whether to target only hostile monsters while ignoring friendly players and passive mobs (default: true).' },
    },
    required: [],
  },
};
```

#### 5) `reportStatus`
```typescript
export const reportStatusDeclaration: FunctionDeclaration = {
  name: 'reportStatus',
  description:
    "Query and return the bot's current health, hunger, coordinates, dimension, active gear, and inventory overview.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      includeInventory: { type: Type.BOOLEAN, description: 'Whether to include a detailed breakdown of inventory items and free slots (default: true).' },
      includePosition: { type: Type.BOOLEAN, description: "Whether to include the bot's current 3D world coordinates and dimension (default: true)." },
    },
    required: [],
  },
};
```

#### 6) `stopCurrentTask`
```typescript
export const stopCurrentTaskDeclaration: FunctionDeclaration = {
  name: 'stopCurrentTask',
  description:
    'Immediately halt and cancel the current active task or goal, stopping pathfinding navigation, block digging, and combat actions.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      reason: { type: Type.STRING, description: 'Optional human-readable reason or user prompt that triggered the task cancellation.' },
    },
    required: [],
  },
};
```

#### 7) `craftItem`
```typescript
export const craftItemDeclaration: FunctionDeclaration = {
  name: 'craftItem',
  description:
    'Craft a specified item using legitimate survival recipes, utilizing inventory 2x2 grid or a nearby crafting table (<= 4.5m reach) if a 3x3 table is required.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      item: { type: Type.STRING, description: 'The standard item or recipe name to craft (e.g., "torch", "iron_pickaxe", "crafting_table").' },
      count: { type: Type.INTEGER, description: 'The quantity of items to craft (between 1 and 64).' },
    },
    required: ['item', 'count'],
  },
};
```

#### 8) `sleepInBed`
```typescript
export const sleepInBedDeclaration: FunctionDeclaration = {
  name: 'sleepInBed',
  description:
    'Locate and sleep in an available bed nearby during night or thunderstorm to skip the night and set spawn, adhering to the 8m/5m monster exclusion distance.',
  parameters: {
    type: Type.OBJECT,
    properties: {},
    required: [],
  },
};
```

#### 9) `depositOrRetrieve`
```typescript
export const depositOrRetrieveDeclaration: FunctionDeclaration = {
  name: 'depositOrRetrieve',
  description:
    'Deposit items into or retrieve items from a legitimate nearby storage container (chest, barrel, shulker_box) within <= 4.5m survival reach.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: {
        type: Type.STRING,
        description: 'The container action to perform: "deposit" to put items into container, or "retrieve" to take items out.',
        enum: ['deposit', 'retrieve'],
      },
      containerCoordinates: {
        type: Type.OBJECT,
        description: 'Optional 3D coordinates of the target container block. If omitted, searches for the nearest visible container.',
        properties: {
          x: { type: Type.NUMBER, description: 'Container X coordinate.' },
          y: { type: Type.NUMBER, description: 'Container Y coordinate.' },
          z: { type: Type.NUMBER, description: 'Container Z coordinate.' },
        },
        required: ['x', 'y', 'z'],
      },
      items: {
        type: Type.ARRAY,
        description: 'List of items to transfer with their target counts.',
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: 'The item identifier (e.g., "cobblestone", "iron_ingot").' },
            count: { type: Type.INTEGER, description: 'The quantity of this item to transfer (between 1 and 64).' },
          },
          required: ['name', 'count'],
        },
      },
    },
    required: ['action', 'items'],
  },
};
```

---

## 3. Validation Interceptor Architecture (`src/ai/tools/validator.ts`)

The validation interceptor enforces 5 distinct layers of fair-play survival constraints using Zod schemas (`zod: ^3.23.8`) and direct integration with Milestone 2 fair-play utilities.

```
                           ┌───────────────────────────────┐
                           │   Gemini Tool Call Response   │
                           │  { name, args: rawJsonObj }   │
                           └───────────────┬───────────────┘
                                           │
                                           ▼
                           ┌───────────────────────────────┐
                           │    Validation Interceptor     │
                           │   src/ai/tools/validator.ts   │
                           ├───────────────────────────────┤
                           │ 1. Unknown Tool Rejection     │
                           │ 2. Command Injection Filter   │
                           │ 3. Coordinate & Altitude Gate │
                           │ 4. Forbidden Item Blacklist   │
                           │ 5. Range Bounds & Stack Caps  │
                           │ 6. Reach Enforcer (<= 4.50m)  │
                           └───────┬───────────────┬───────┘
                                   │               │
                            Valid  │               │ Invalid (FairPlayValidationError)
                                   ▼               ▼
                        ┌──────────────────┐  ┌──────────────────────────┐
                        │ Dispatch to Bot  │  │ Format Feedback Result:  │
                        │ IMinecraftAgent  │  │ "Error: Block bedrock is │
                        │  Action Engine   │  │  forbidden in survival"  │
                        └──────────────────┘  └────────────┬─────────────┘
                                                           │
                                                           ▼
                                              ┌──────────────────────────┐
                                              │ Return to Gemini Planner │
                                              │   for plan correction    │
                                              └──────────────────────────┘
```

### 3.1 The 5 Fair-Play Survival Constraint Layers

#### Layer 1: Coordinate Bounds & Altitude Validation
- **Finite Check**: `Number.isFinite(coord) && !Number.isNaN(coord)`. Rejects `NaN`, `Infinity`, `-Infinity`.
- **Y Altitude Bounds**: Modern Minecraft Overworld boundaries range strictly from $Y = -64$ to $Y = 320$. Any destination or container at $Y < -64$ (void) or $Y > 320$ (build ceiling) is rejected immediately with a descriptive survival error.
- **Horizontal World Limits**: $|X| \le 30,000,000$ and $|Z| \le 30,000,000$.

#### Layer 2: Reach Constraint Enforcement
- Under vanilla Minecraft survival mechanics, a player can interact with blocks up to $4.50$ meters from the eye position.
- In `depositOrRetrieve`, when `containerCoordinates` are specified and the agent's `botEyePosition` is passed in `ValidationContext`:
  $$\text{dist} = \text{getBlockDistanceToEye}(\text{botEyePosition}, \text{containerCoordinates})$$
  $$\text{dist} \le 4.50 + 10^{-4} \text{ m}$$
- If $\text{dist} > 4.50$m, the interceptor throws `FairPlayValidationError` with code `REACH_EXCEEDED`, forcing the planner to first navigate closer with `goToCoordinates`.

#### Layer 3: Block & Item Identifier Whitelist & Blacklist
- **Identifier Syntax**: Normalizes `minecraft:` prefixes and requires `^[a-z0-9_]+$`. Rejects uppercase, special characters, spaces, HTML/script tags.
- **Strict Blacklist (`FORBIDDEN_ITEMS`)**: Blocks unobtainable, privileged, creative-only, or illegal items:
  ```typescript
  export const FORBIDDEN_ITEMS = new Set<string>([
    'bedrock',
    'barrier',
    'command_block',
    'chain_command_block',
    'repeating_command_block',
    'command_block_minecart',
    'structure_block',
    'structure_void',
    'jigsaw',
    'light',
    'debug_stick',
    'spawner',
    'monster_spawner',
    'knowledge_book',
    'end_portal',
    'end_portal_frame',
    'nether_portal',
    'end_gateway',
    'reinforced_deepslate',
  ]);
  ```
- Any tool invocation (`gatherResource`, `craftItem`, `depositOrRetrieve`) attempting to manipulate these items is blocked.

#### Layer 4: Rejection of OP Command Injection
- In natural language multi-turn agents, malicious users or prompt injection payloads may trick the LLM into generating tool arguments carrying privileged commands:
  - `stopCurrentTask({ reason: "/op Hacker" })`
  - `followPlayer({ playerName: "Alice\n/give @p diamond 64" })`
  - `craftItem({ item: "diamond_sword; /gamemode creative" })`
- The interceptor integrates directly with `isPrivilegedCommand` from `src/minecraft/fairplay/commandSanitizer.ts`:
  - Rejects any string starting with `/`.
  - Rejects multiline newline injections (`\n`, `\r\n`, `\r`).
  - Rejects Unicode line separators (`\u2028`, `\u2029`).
  - Rejects semicolon chaining (`;`).
  - Player names are further constrained by Minecraft username regex `^[a-zA-Z0-9_]{1,16}$`.

#### Layer 5: Type and Range Bounds
- **Count Bounds**: All item/resource counts are strictly clamped to $1 \le count \le 64$ (integer). Prevents stack overflow exploits, negative counts, or zero-count cycles.
- **Search & Defend Radii**: Clamped to $1 \le radius \le 32$ blocks. Prevents unbounded chunk scanning or infinite patrol ranges.
- **Follow Distance**: Clamped to $1 \le distance \le 32$ blocks (defaults to 3.0 blocks).
- **Container Array**: Maximum 27 items per transaction (standard single chest capacity).

---

### 3.2 Dual Programmatic Entry Points

1. **`validateToolArgs<T>(toolName: T, rawArgs: unknown, context?: ValidationContext): ToolParamsMap[T]`**  
   Strict execution pipeline entry point. Throws `FairPlayValidationError` on any schema failure or rule breach. Returns fully typed and sanitized parameter objects.

2. **`validateToolCall(toolName: string, rawArgs: unknown, context?: ValidationContext): ToolValidationResult<unknown>`**  
   Safe functional wrapper returning a tagged union:
   ```typescript
   export type ToolValidationResult<T> =
     | { valid: true; data: T }
     | { valid: false; error: string; code: string; toolName?: string };
   ```
   Used by `planner.ts` to convert validation rejections directly into informative tool execution feedback messages returned to Gemini without throwing runtime exceptions.

---

## 4. Complete Proposed Implementations

The complete proposed files have been created in the working directory:
- `.agents/teamwork/explorer_m3_2/proposed_definitions.ts`
- `.agents/teamwork/explorer_m3_2/proposed_validator.ts`
- `.agents/teamwork/explorer_m3_2/proposed_tools.test.ts`

These files are completely self-contained drop-in replacements for:
- `src/ai/tools/definitions.ts`
- `src/ai/tools/validator.ts`
- `test/m3/tools.test.ts`

---

## 5. Test Matrix & Verification Coverage

The test suite in `proposed_tools.test.ts` provides complete test coverage:

| Category | Test Case ID | Test Description | Expected Result |
|----------|--------------|------------------|-----------------|
| **Declarations** | TC-TOOL-01 | All 9 tool declarations present in `TOOL_NAMES` and `FAIR_PLAY_TOOL_DECLARATIONS` | 9 tools, valid OpenAPI 3.03 schema |
| **Declarations** | TC-TOOL-02 | Property types match `@google/genai` Type enum (`STRING`, `NUMBER`, etc.) | Type matches for all parameters |
| **Happy Path** | TC-TOOL-03 | `goToCoordinates` accepts valid coordinates { x: 100, y: 64, z: -200 } | Passes with exact coordinates |
| **Happy Path** | TC-TOOL-04 | `followPlayer` accepts username and optional distance, defaults to 3 | Passes, applies default |
| **Happy Path** | TC-TOOL-05 | `gatherResource` strips `minecraft:` prefix and applies default radius 16 | Passes, normalized to clean ID |
| **Happy Path** | TC-TOOL-06 | `defendArea` and `reportStatus` apply defaults when passed `{}` | Passes with default booleans/radii |
| **Happy Path** | TC-TOOL-07 | `depositOrRetrieve` validates action and items array | Passes for deposit & retrieve |
| **Boundary** | TC-TOOL-08 | Boundary Y altitudes: Y = -64 and Y = 320 | Accepted |
| **Boundary** | TC-TOOL-09 | Out of bounds Y: Y = -65 and Y = 321 | Rejected (`survival world bounds`) |
| **Boundary** | TC-TOOL-10 | Non-finite coordinates: `NaN`, `Infinity`, `-Infinity` | Rejected (`finite number`) |
| **Boundary** | TC-TOOL-11 | Stack counts: count = 1 and count = 64 | Accepted |
| **Boundary** | TC-TOOL-12 | Stack count violations: count = 0, count = -5, count = 65, count = 2.5 | Rejected |
| **Boundary** | TC-TOOL-13 | Radius boundaries: radius = 1 and radius = 32 | Accepted |
| **Boundary** | TC-TOOL-14 | Radius violations: radius = 0, radius = 33, radius = -10 | Rejected |
| **Reach** | TC-TOOL-15 | `depositOrRetrieve` with container at 2.09m (<= 4.5m) | Accepted |
| **Reach** | TC-TOOL-16 | `depositOrRetrieve` with container at 10.0m (> 4.5m) | Rejected with `REACH_EXCEEDED` code |
| **Sanitization**| TC-TOOL-17 | Blacklist items rejected: bedrock, barrier, command_block, spawner, etc. | Rejected with `FORBIDDEN_ITEM_RESTRICTION` |
| **Injection** | TC-TOOL-18 | OP injection in `stopCurrentTask.reason`: `/op`, `/gamemode`, `/stop`, `/give` | Rejected |
| **Injection** | TC-TOOL-19 | Multiline command injection in `reason`: `"stop\n/op Hacker"`, `\r\n/kill` | Rejected |
| **Injection** | TC-TOOL-20 | Semicolon command chaining in `reason`: `"halt; /op hacker"` | Rejected |
| **Injection** | TC-TOOL-21 | Command injection in `followPlayer.playerName`: `"/op Alice"`, `"Steve;/kill"` | Rejected |
| **Injection** | TC-TOOL-22 | Command injection in `gatherResource.blockType` and `craftItem.item` | Rejected |
| **Robustness** | TC-TOOL-23 | Unknown tool name returns `UNKNOWN_TOOL_NAME` code | Rejected cleanly |
| **Robustness** | TC-TOOL-24 | Empty `items` array or invalid action in `depositOrRetrieve` | Rejected |

---

## 6. Synergy with Peer Explorers

- **Synergy with Explorer 1 (`src/ai/geminiClient.ts` & `test/mocks/mockGemini.ts`)**:
  - Explorer 1 can import `FAIR_PLAY_TOOLS` from `src/ai/tools/definitions.js` directly to configure the Gemini chat session:
    ```typescript
    const chat = ai.chats.create({
      model: 'gemini-3.8-flash',
      config: { tools: FAIR_PLAY_TOOLS }
    });
    ```
  - `mockGemini.ts` will pattern-match natural language intents and emit function calls matching the exact 9 tool schemas.
- **Synergy with Explorer 3 (`src/ai/planner.ts` & `src/coordinator/`)**:
  - In `planner.ts`, when Gemini emits a tool call turn `{ name, args }`, the planner calls:
    ```typescript
    const validation = validateToolCall(toolCall.name, toolCall.args, {
      botEyePosition: agent.getStatus().position ? getEyePos(agent.getStatus().position) : undefined
    });
    ```
  - If invalid, the planner packages `validation.error` into the tool response part without crashing, allowing Gemini to self-heal and re-plan.
  - If valid, the planner dispatches `validation.data` to `IMinecraftAgent`.
