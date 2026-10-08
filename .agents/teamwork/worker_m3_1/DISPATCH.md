## 2026-10-08T00:53:59Z
You are Worker 1 for Milestone 3: Gemini AI Planning & Coordination Bridge.
Your working directory is: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\worker_m3_1
Project workspace: c:\Users\rando\Documents\antigravity\wise-pasteur

MANDATORY FIRST STEPS:
1. Read the authoritative user request at: c:\Users\rando\Documents\antigravity\wise-pasteur\ORIGINAL_REQUEST.md
2. Read the master project architecture and contracts at: c:\Users\rando\Documents\antigravity\wise-pasteur\PROJECT.md
3. Read all three Explorer reports and drop-in designs:
   - c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m3_1\report.md (Gemini SDK & mockGemini)
   - c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m3_2\report.md (9 Tools & Validation Interceptor)
   - c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m3_2\proposed_definitions.ts
   - c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m3_2\proposed_validator.ts
   - c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m3_3\report.md (Planner loop, progress reporter, emergency halt, test matrix)

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

FILE OWNERSHIP (EXCLUSIVE):
You own and must implement/update:
- src/ai/types.ts
- src/ai/tools/definitions.ts
- src/ai/tools/validator.ts
- src/ai/geminiClient.ts
- src/ai/planner.ts
- src/coordinator/progressReporter.ts
- src/coordinator/agentCoordinator.ts
- test/mocks/mockGemini.ts
- test/mocks/index.ts
- Test suites under test/m3/:
  - test/m3/geminiClient.test.ts
  - test/m3/tools.test.ts
  - test/m3/planner.test.ts
  - test/m3/coordination.test.ts

IMPLEMENTATION REQUIREMENTS:
1. Google Gemini SDK Integration (`src/ai/geminiClient.ts`):
   - Use official `@google/genai` (GoogleGenAI class, model `gemini-3.8-flash`).
   - Define `IGeminiClient` and `IGeminiSession` interfaces allowing seamless substitution between live client and MockGemini.
   - Configure FunctionCallingConfigMode.AUTO and declare all 9 tools.
2. 9 Structured Fair-Play Tools (`src/ai/tools/definitions.ts`):
   - Implement `goToCoordinates`, `followPlayer`, `gatherResource`, `defendArea`, `reportStatus`, `stopCurrentTask`, `craftItem`, `sleepInBed`, `depositOrRetrieve` using native `@google/genai` `Type` schema declarations.
3. Validation Interceptor (`src/ai/tools/validator.ts`):
   - Intercept and validate all tool parameters against survival boundaries: finite coordinates, Overworld Y [-64, 320], reach <= 4.5m, forbidden cheat item names (`bedrock`, `command_block`, `barrier`), OP command injection prevention via `isPrivilegedCommand`.
4. Multi-Turn Planning Loop (`src/ai/planner.ts`):
   - Asynchronous generator emitting `PlannerStepEvent` ('thought', 'tool_call', 'tool_result', 'progress', 'error', 'done').
   - Multi-turn execution against `IMinecraftAgent`, packaging tool results into `functionResponse` parts for plan continuation.
   - 10-turn safety guard to prevent infinite loops.
   - Task cancellation & emergency halt handling (`/stop` command and voice aborts).
5. Progress Reporter & Coordinator (`src/coordinator/`):
   - Stream task progress events to Discord text channels and voice TTS queue with emergency priority handling.
6. Offline Mock Gemini (`test/mocks/mockGemini.ts`):
   - Deterministic offline mock implementation supporting regex/heuristic goal matching, multi-turn state machines, and scripted turn overrides for 100% offline testing.
7. Milestone 3 Test Suites (`test/m3/`):
   - Write comprehensive unit & integration tests covering all Milestone 3 components.

VERIFICATION REQUIREMENTS:
- Run `npm.cmd run typecheck` (0 errors).
- Run `npm.cmd run build` (clean compilation to dist/).
- Run `npm.cmd test` and verify that 100% of all tests pass (M1, M2, and M3 suites).
- Document commands and full execution outputs in your handoff report.

OUTPUT REQUIREMENTS:
- Write completion report to c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\worker_m3_1\handoff.md
- Notify parent (id: e026c1ee-5533-4b5b-93ce-229eafdae44b) via send_message when done.
