# Handoff Report: Milestone 3 Gemini AI Planning & Coordination Bridge

**Agent**: Explorer 1 (`explorer_m3_1`)  
**Parent**: Orchestrator (`e026c1ee-5533-4b5b-93ce-229eafdae44b`)  
**Working Directory**: `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m3_1`  
**Milestone**: Milestone 3 — Gemini AI Planning & Coordination Bridge  
**Type**: Hard Handoff (Investigation & Architecture Design Complete)

---

## 1. Observation

1. **Installed SDK Version & Runtime Exports**:
   - `package.json` line 16 declares `"@google/genai": "^2.3.0"`.
   - Inspection of `node_modules/@google/genai/package.json` line 3 confirms actual installed version is `"version": "2.27.0"`.
   - Running `node -e "import('@google/genai').then(m => console.log(Object.keys(m)))"` confirmed runtime exports including: `GoogleGenAI`, `Chat`, `Chats`, `FunctionCallingConfigMode`, `Type`, `FunctionResponse`, `GenerateContentResponse`.
   - Enums confirmed: `Type.STRING = 'STRING'`, `Type.NUMBER = 'NUMBER'`, `Type.INTEGER = 'INTEGER'`, `Type.BOOLEAN = 'BOOLEAN'`, `Type.OBJECT = 'OBJECT'`, `Type.ARRAY = 'ARRAY'`.
   - Mode enum: `FunctionCallingConfigMode.AUTO = 'AUTO'`, `FunctionCallingConfigMode.ANY = 'ANY'`, `FunctionCallingConfigMode.NONE = 'NONE'`.

2. **Model & Environment Configuration**:
   - In `src/config/env.ts` lines 43-47, Gemini configuration schema is defined:
     ```typescript
     GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
     GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
     GEMINI_MAX_TOOL_STEPS: z.coerce.number().int().min(1).max(20).default(5),
     ```
   - Fallback logic for mock tests exists in lines 78-80:
     ```typescript
     if (!merged.GEMINI_API_KEY) merged.GEMINI_API_KEY = 'mock_gemini_api_key';
     ```

3. **Current Codebase State & Test Baseline**:
   - Running `cmd /c npm test` executed Vitest 2.1.9 across 22 test files, passing all 314 tests in 2.22s (Milestones 1 & 2 fully passing).
   - In `src/`, `src/ai/` directory does not yet exist.
   - In `src/coordinator/types.ts` lines 11-17, `PlannerStepEvent` is already defined:
     ```typescript
     export interface PlannerStepEvent {
       type: 'thought' | 'tool_call' | 'tool_result' | 'progress' | 'error' | 'done';
       toolName?: string;
       toolArgs?: Record<string, unknown>;
       message?: string;
       result?: unknown;
     }
     ```
   - In `PROJECT.md` line 187, `IGeminiPlanner` contract is defined:
     ```typescript
     export interface IGeminiPlanner {
       executeGoal(goalText: string, context: PlanningContext): AsyncIterable<PlannerStepEvent>;
       cancelCurrentGoal(): void;
     }
     ```

4. **Minecraft Agent Interfaces**:
   - In `src/minecraft/types.ts` lines 76-93, `IMinecraftAgent` exposes: `navigateTo(target)`, `mineBlock(pos)`, `placeBlock(pos, name)`, `craftItem(recipe, count)`, `attackEntity(id)`, `sleepInNearbyBed()`, `getStatus()`, `canInteractWith(pos)`.
   - In `test/mocks/mockMinecraft.ts` lines 675-737, `MockMinecraftAgent` implements all above methods deterministically.

---

## 2. Logic Chain

1. **SDK Invocation Pattern (from Observation 1 & 2)**:
   - Initializing `new GoogleGenAI({ apiKey: config.gemini.apiKey })` connects to Google Gemini developer API.
   - For multi-turn goal execution, `client.chats.create({ model: 'gemini-3.8-flash', config: { tools: [{ functionDeclarations }], toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } }, systemInstruction } })` maintains conversation state without manual history reconstruction.
   - Tool calling loop: Calling `chat.sendMessage({ message: goalText })` returns `response.functionCalls`. When a tool call is executed, sending back `chat.sendMessage({ message: [{ functionResponse: { name, response: { output: result } } }] })` enables the model to either request the next tool or emit final summary text.

2. **Fair-Play Tool Schema Boundaries (from Observation 3 & 4)**:
   - The 9 tools required by `PROJECT.md` (`goToCoordinates`, `followPlayer`, `gatherResource`, `defendArea`, `reportStatus`, `stopCurrentTask`, `craftItem`, `sleepInBed`, `depositOrRetrieve`) map directly to `IMinecraftAgent` methods.
   - Each tool must declare its parameters via `@google/genai` `FunctionDeclaration` with `Type.OBJECT`, `Type.STRING`, `Type.NUMBER`, `Type.INTEGER`, `Type.BOOLEAN`.
   - Tool parameters must be intercepted and validated by `validateToolCall` to enforce reach limits ($\le 4.5$m), valid coordinate ranges ($y \in [-64, 320]$), valid harvest counts ($1 \le count \le 64$), and sanitize strings against OP commands.

3. **Offline Mock Gemini Parity (from Observation 1 & 3)**:
   - By creating an interface `IGeminiClient` and `IGeminiSession`, the live `GeminiClient` and `MockGeminiClient` become completely interchangeable via dependency injection.
   - `MockGeminiClient` needs no API key or internet access. It uses regex pattern matching on the incoming natural language goal (e.g. `/go to (-?\d+) (-?\d+) (-?\d+)/i` -> `goToCoordinates`, `/gather (\d+)?\s*(\w+)/i` -> `gatherResource`) to emit structured `ToolCallRequest` objects.
   - `MockGeminiSession` tracks multi-turn state: receiving `sendToolResponse` advances to either the next step in a composite plan or completes with a summary text response.
   - Furthermore, `MockGeminiClient` supports scripted turn injection (`setScriptedTurns`) for exact, deterministic test scenarios.

---

## 3. Caveats

1. **Live Gemini Network & Quota**:
   - The live client requires a valid Google Gemini API key and internet connectivity. In CI, testing, and offline modes, `MockGeminiClient` must be used (selected automatically when `env.runtime.mockAll === true` or in `test` environment).
2. **LLM Non-Determinism in Production**:
   - Live LLMs can generate alternative phrasing or unexpected arguments. The parameter validator (`validator.ts`) is mandatory as a defensive anti-cheat firewall before passing arguments to Mineflayer.
3. **Multi-Turn Max Depth Limit**:
   - To prevent runaway LLM tool calling loops, `GEMINI_MAX_TOOL_STEPS` (default 5) must be strictly enforced by `GeminiPlanner`.

---

## 4. Conclusion

The architecture for Milestone 3 is completely mapped and verified against `@google/genai` v2.27.0:
1. `src/ai/types.ts`: Formalizes `IGeminiClient`, `IGeminiSession`, `IGeminiPlanner`, `ToolCallRequest`, and `GeminiTurnResponse`.
2. `src/ai/tools/definitions.ts`: Implements the 9 fair-play `FunctionDeclaration` tool schemas using official `@google/genai` `Type` definitions.
3. `src/ai/tools/validator.ts`: Intercepts and enforces fair-play constraints (reach $\le 4.5$m, world coordinate limits, count $[1, 64]$, OP command blocking).
4. `src/ai/geminiClient.ts`: Live client using `GoogleGenAI` with model `gemini-3.8-flash`.
5. `src/ai/planner.ts`: Multi-turn planning engine coordinating tool calls with `IMinecraftAgent` and yielding `PlannerStepEvent` for Discord progress updates and TTS priority alerts.
6. `test/mocks/mockGemini.ts`: 100% offline, deterministic mock provider with regex intent recognition and multi-turn simulation state machine.

---

## 5. Verification Method

1. **TypeScript Typecheck**:
   Command: `cmd /c npm run typecheck`
   Expected: 0 errors, clean resolution of `@google/genai` types and interfaces.
2. **Automated Vitest Test Suite**:
   Command: `cmd /c npm test`
   Expected: 100% pass rate across existing 314 tests and new Milestone 3 test suites.
3. **Files to Inspect**:
   - Detailed architecture report: `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m3_1\report.md`
   - Dispatch record: `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m3_1\DISPATCH.md`
   - Working memory: `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m3_1\BRIEFING.md`
4. **Invalidation Conditions**:
   - If `@google/genai` package version is changed to an incompatible major version (< 2.0.0).
   - If Mineflayer action signatures change in `IMinecraftAgent`.
