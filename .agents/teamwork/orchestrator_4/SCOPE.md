# Scope: Milestone 4 (Final E2E Test Verification & Hardening)

## Overview
Milestone 4 integrates all subsystems developed in M1, M2, and M3 into a unified offline simulation harness, develops comprehensive multi-tier E2E tests, verifies 100% test pass rate across all suites, ensures zero TypeScript errors on build, and updates project documentation.

## Architecture & Subsystems Under Test
1. **Discord Client & Coordinator**: Slash commands, voice pipeline (STT/TTS), priority queue, chat bridge, status embeds, RBAC.
2. **Minecraft Fair-Play Agent**: Perception (raycast, exposure, FOV), physical reach enforcement (<= 4.5m), command sanitizer (OP blocked), pathfinding, mining, crafting, combat, survival loops (eat, sleep, equip).
3. **Gemini AI Planner**: 9 fair-play tools, argument validation, multi-turn plan execution, step events, task cancellation.
4. **Mocks Available**: `test/mocks/mockDiscord.ts`, `test/mocks/mockVoice.ts`, `test/mocks/mockMinecraft.ts`, `test/mocks/mockGemini.ts`.

## Deliverables
1. **Offline Simulation Harness Infra (`test/harness/`)**:
   - `testContext.ts`: Test context container, lifecycle management, state assertions, dependency injection.
   - `simulationHarness.ts`: Unified integration wiring `mockDiscord`, `mockMinecraft`, and `mockGemini` to `AgentCoordinator`, `MinecraftAgent`, and `GeminiPlanner`.
2. **Multi-Tier E2E Test Suites**:
   - **Tier 1 Feature Coverage (`test/tier1_features/`)**: >= 5 isolated happy-path tests per feature area across all subsystem features (commands, voice, bridge, fairplay, planner).
   - **Tier 2 Boundaries & Edge Cases (`test/tier2_boundaries/`)**: Boundaries and error cases (reach limits, empty inventory, network timeouts, invalid inputs, disconnects, rate limits).
   - **Tier 3 Cross-Feature Combinations (`test/tier3_combinations/`)**: Pairwise subsystem interactions (e.g. voice -> STT -> Gemini tool call -> Minecraft action -> TTS status -> embed update).
   - **Tier 4 Real-World Application Scenarios (`test/tier4_scenarios/`)**: Complete user workflows (mining expedition, defensive combat alert, overnight shelter survival, multi-player chat task execution).
3. **Verification**:
   - 100% test pass rate (existing 444 tests + all new tests).
   - 0 TypeScript errors on `npm run build`.
4. **Documentation**:
   - Up-to-date `README.md` and `.env.example`.
