# Handoff Report: AI Planner, Simulation Harness & Build System (Survey 3)
**Author**: `explorer_survey_3` (teamwork_preview_explorer)  
**Recipient**: `orchestrator_1` (e9cac3a4-2cab-4915-bfc4-a4488f13ddf5)  
**Date**: 2026-10-07  
**Working Directory**: `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_survey_3`  
**Primary Deliverable**: `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_survey_3\survey_report.md`  

---

## 1. Observation

1. **User Requirements Document (`ORIGINAL_REQUEST.md`)**:
   - Requirement R3 specifies: *"Integrate an LLM planning agent (using the official Google Gemini SDK) that connects Discord user requests (text or voice) to concrete Minecraft actions. The planner must decompose high-level user goals... into structured tool calls executed by the Minecraft agent, reporting progress, status changes, and in-game events back to the Discord channel. All tool definitions must enforce the fair-play constraints."* (`ORIGINAL_REQUEST.md:29-30`)
   - Requirement R4 specifies: *"Provide a comprehensive automated verification harness that can run in CI or local environments without requiring live external secrets or external servers. This must include mock Discord voice and text event simulators, and mock Minecraft protocol/server stubs to test and verify command parsing, voice processing workflows, AI tool calling, survival loops, chat bridging, RBAC checks, fair-play perception limits, and Minecraft action execution end-to-end."* (`ORIGINAL_REQUEST.md:32-34`)
   - Acceptance criteria require:
     * Clean build (`npm run build`) with TypeScript type checks passing without errors. (`ORIGINAL_REQUEST.md:38`)
     * Automated test suite (`npm test`) passes 100% of unit and integration tests. (`ORIGINAL_REQUEST.md:39`)
     * Complete pipeline verification: simulated voice/text prompt -> Gemini tool call invocation -> simulated Minecraft agent action execution -> Discord response confirmation. (`ORIGINAL_REQUEST.md:40`)

2. **Official Google Gemini SDK Documentation (`@google/genai`)**:
   - Upstream documentation (`gemini-api-dev` skill and MCP search docs) confirms that the modern SDK package is `@google/genai` (>= 2.3.0). Legacy packages `google-generativeai` and `@google/generative-ai` are deprecated and forbidden.
   - Recommended model for multimodal agentic tool-calling is `gemini-3.8-flash`. Deprecated models (`gemini-1.5-*`, `gemini-2.0-*`, `gemini-2.5-*`) must never be used.
   - Tool calling declarations in `@google/genai` use the OpenAPI schema structure with `type: "function"` or `Type.OBJECT`, `name`, `description`, `parameters`, and `required`.
   - Tool result feedback uses the typed steps timeline (`type: "function_result"` with `call_id`, `name`, and `result` array) or `functionResponse` in `generateContent`.

3. **Host Runtime & Environment State**:
   - `node -v` returned `v24.21.0`.
   - `npm -v` in PowerShell returned `SecurityError: PSSecurityException` due to script execution policy on `npm.ps1`.
   - `npm.cmd -v` executed successfully and returned version `11.19.0`.
   - Project directory `c:\Users\rando\Documents\antigravity\wise-pasteur` is currently greenfield with no pre-existing `package.json` or source files outside `.agents/`.

---

## 2. Logic Chain

1. **From Requirement R3 and SDK Documentation to Engine Architecture**:
   - Based on Observation 1 and 2, Requirement R3 requires decomposing natural language into concrete Minecraft actions while enforcing fair-play survival limits.
   - Because `@google/genai` (>= 2.3.0) and `gemini-3.8-flash` are the authoritative standard, the planner engine must wrap `@google/genai` using structured `FunctionDeclaration` definitions for: `goToCoordinates`, `followPlayer`, `gatherResource`, `defendArea`, `reportStatus`, `stopCurrentTask`, `craftItem`, `sleepInBed`, and `depositOrRetrieve`.
   - To enforce fair play, tool arguments must be intercepted and validated prior to dispatch: coordinates must be within legitimate world bounds, block interactions must be within 4.5m reach and have exposed surfaces (no x-ray), and privileged commands (`/tp`, `/give`, `/gamemode`) must be rejected.
   - Feedback to Discord must be bidirectional: updates must be dispatched to Discord text embeds and TTS voice buffers on task start, progress milestones, obstacles, and completion.

2. **From Requirement R4 to 100% Offline Test Harness Architecture**:
   - Based on Observation 1, CI and local test execution must not depend on external network calls, active Discord tokens, or live Minecraft servers.
   - Therefore, the architecture requires an abstract dependency injection boundary (`IGeminiProvider`, `IDiscordClient`, `IMinecraftBot`).
   - In test mode (`NODE_ENV=test`, `MOCK_ALL=true`), `MockGeminiProvider` provides deterministic regex-matched tool calls and conversation steps; `MockDiscordClient` simulates voice packet streams (STT/TTS), slash commands, and RBAC; and `MockMineflayerBot` simulates 3D block world state, entity movements, and survival ticks (hunger, health, day/night).
   - This ensures 100% deterministic, ultra-fast test execution in CI without flakiness or credentials.

3. **From Acceptance Criteria to 4-Tier Test Strategy**:
   - To achieve robust quality assurance across all components, test suites must be organized into four tiers:
     * Tier 1: Feature Coverage (>=5 test cases per feature across tools, loops, fair-play, survival, bridge, and RBAC).
     * Tier 2: Boundary & Corner Cases (>=5 test cases per feature covering extreme values, timeouts, rate limits, occluded blocks, and malformed inputs).
     * Tier 3: Cross-Feature Combinations (validating pairwise interplay like survival auto-eat interrupting pathfinding, mob combat overriding mining, and voice-to-action roundtrips).
     * Tier 4: Real-World Application Scenarios (end-to-end user journeys including voice rescue, resource expeditions, perimeter defense, and emergency aborts).

4. **From Host Observations to Build Configuration**:
   - Based on Observation 3, Node.js 24 and npm 11 are present. Because PowerShell restricts `.ps1` execution, project scripts and CI must reference `npm.cmd` on Windows.
   - A modern TypeScript configuration (`tsconfig.json`) targeting `ES2022` with `NodeNext` resolution and strict type checking satisfies the clean build requirement.
   - Using `vitest` provides native TypeScript support, fast execution, and integrated coverage reporting.

---

## 3. Caveats

1. **Speech-to-Text & Text-to-Speech Engine Implementations in Production**:
   - The offline harness mocks STT and TTS deterministically with synthetic PCM buffers. In live production deployment, specific external audio services (e.g. Gemini 3.8 Flash TTS / 3.5 Transcribe or OpenAI Whisper / local Vosk) must be configured via environment variables. The specification defines the decoupled interface so any backend can be plugged in without changing the core planner or Minecraft agent.
2. **Mineflayer Version Compatibility with Minecraft 1.20+**:
   - Mineflayer 4.20.1 supports Minecraft Java versions up to 1.20.4 out of the box. For newer versions (e.g. 1.20.6 / 1.21), protocol data packages (`minecraft-data`) must match the server version configured in `.env`.
3. **ExecutionPolicy on Windows**:
   - If running scripts directly in Windows PowerShell without `npm.cmd`, the user or developer environment may require running `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`. Using `npm.cmd` avoids this issue entirely.

---

## 4. Conclusion

The specification report for Requirement R3 (AI Planner & Tool Calling), Requirement R4 (Automated Test Suite & Simulation Harness), and Build/Verification Configuration has been completely drafted and validated:
1. **Gemini Engine**: Designed with `@google/genai` >= 2.3.0 and `gemini-3.8-flash`, featuring 9 structured fair-play tools, multi-turn loop orchestration, strict survival parameter validation, and multi-modal Discord progress reporting.
2. **Simulation Harness**: Fully specified with zero-dependency mocks (`MockDiscordClient`, `MockMineflayerBot`, `MockGeminiProvider`) providing 100% offline, deterministic CI testing.
3. **4-Tier Test Suite**: Specified with >=5 tests per feature across Tier 1 (Coverage) and Tier 2 (Boundaries), plus Tier 3 (Cross-feature interplay) and Tier 4 (Real-world scenarios).
4. **Build System**: Configured for Node 24+, TypeScript 5.6+ strict mode, Vitest test runner, and Windows-safe `npm.cmd` scripts.

All architectural artifacts are recorded in:
`c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_survey_3\survey_report.md`

---

## 5. Verification Method

To independently verify this specification:
1. **Inspect Deliverable**:
   - View `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_survey_3\survey_report.md`
   - Confirm all sections (1. Natural Language AI Tool-Calling Engine, 2. Automated Test Suite & Simulation Harness, 3. 4-Tier Test Strategy, 4. Build Configuration, 5. Acceptance Criteria Traceability Matrix) are populated with detailed schemas, code examples, and test cases.
2. **Verify Node & Package Manager Commands**:
   - Run `node -v` -> Expected `v24.21.0` or `>= v20.0.0`.
   - Run `npm.cmd -v` -> Expected `11.19.0` or `>= 10.0.0`.
3. **Downstream Implementation Gate (Invalidation Conditions)**:
   - This specification is invalidated if any downstream implementation introduces legacy packages (`@google/generative-ai`), uses deprecated models (`gemini-2.0-*`), permits Minecraft OP commands (`/tp`, `/give`), allows x-ray mining through unexposed stone, or relies on live internet connectivity for unit/integration tests in CI.
