## 2026-10-08T13:54:23Z
You are worker_m4_2 working on Milestone 4 (Final E2E Test Verification & Hardening).
Your working directory is: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\worker_m4_2
The project workspace is: c:\Users\rando\Documents\antigravity\wise-pasteur
Authoritative user request path: c:\Users\rando\Documents\antigravity\wise-pasteur\ORIGINAL_REQUEST.md
Project specification path: c:\Users\rando\Documents\antigravity\wise-pasteur\PROJECT.md
Scope path: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\orchestrator_4\SCOPE.md
Explorer handoff path: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m4_2\handoff.md

MANDATORY: You MUST read ORIGINAL_REQUEST.md at the path above before starting work.
Also read Section 4.1 of explorer_m4_2's handoff file for the exact Tier 1 test case inventory and assertions.
The newly created simulation harness is available at `test/harness/index.ts` (`createTestContext`, `SimulationHarness`).

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

File Ownership:
You own exclusively:
- test/tier1_features/discord_features.test.ts
- test/tier1_features/minecraft_features.test.ts
- test/tier1_features/ai_features.test.ts
- test/tier1_features/coordinator_features.test.ts

Your task:
Implement the 4 Tier 1 Feature Coverage test suites covering isolated happy-paths across all features (F01-F43):
1. `test/tier1_features/discord_features.test.ts` (T1-DISC-01 to T1-DISC-21):
   - Slash commands: /status, /connect, /disconnect, /task, /stop, /inventory, /voice, /help
   - Auto-deferral withAutoDefer
   - Voice session management
   - Chat bridge Discord <-> Minecraft relay
   - Triple-lock anti-loopback (bot ID, bot account, 10s TTL hash)
   - Chat sanitization and § strip
   - Status embed generation and dirty-state throttling
   - RBAC VIEWER, OPERATOR, and ADMIN access checks
2. `test/tier1_features/minecraft_features.test.ts` (T1-MC-01 to T1-MC-23):
   - Client spawn and graceful disconnect
   - Surface exposure filter (encased vs exposed vs transparent medium)
   - 3D DDA raycasting (unobstructed vs obstructed)
   - Perception FOV (70° cone, 2.5m tactile fallback, outside zone)
   - Reach enforcement (block <= 4.5m, entity attack <= 3.5m)
   - Command sanitizer regular chat pass-through
   - Pathfinder navigation
   - Mining engine with harvest tier matching
   - Block placement
   - Crafting engine (2x2 grid planks, 3x3 table pickaxe)
   - Combat 1.9+ weapon cooldown timing and shield blocking
   - Survival loops: auto-eat saturation priority, auto-sleep night bed, auto-equip composite scoring
3. `test/tier1_features/ai_features.test.ts` (T1-AI-01 to T1-AI-08):
   - Gemini client mock initialization and conversation history
   - 9 structured fair-play tool declarations
   - Tool argument validator (valid calls vs schema rejects)
   - Single-step and multi-step goal decomposition (goToCoordinates, gather and craft)
   - Tool result packaging
   - In-memory regex mock resolution
4. `test/tier1_features/coordinator_features.test.ts` (T1-COORD-01 to T1-COORD-08):
   - Priority audio queue (FIFO normal queueing, emergency preemption)
   - Progress reporting (start, step progress, done)
   - Emergency stop via /stop command and voice interrupt
   - Survival alerts for bot death and critical low health <= 6 HP
5. Verification:
   - Run `cmd /c npm test` (or `npm.cmd test`).
   - Run `cmd /c npm run build`.
   - Verify all tests pass 100% and build succeeds with 0 TypeScript errors.
6. Write your handoff report to:
   c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\worker_m4_2\handoff.md
7. Update your progress.md and send a completion message back to orchestrator_4 (f1768415-3044-4bb9-b757-80b682dc585d).
