# Original User Request

## 2026-10-07T19:06:42Z

Build a multimodal Discord bot with text and two-way voice channel capabilities, integrated with an AI-driven agent capable of connecting to and playing inside a Minecraft server on command via natural language tool execution, operating strictly under fair-play survival rules.

Working directory: ~/teamwork_projects/discord_minecraft_bot
Integrity mode: development

## Requirements

### R1. Discord Text, Voice & In-Game Bridge Core
Implement a Discord bot service supporting text commands/slash commands, interactive voice channels, and bidirectional game bridging:
- **Voice Channels:** Support two-way voice communication: capturing and transcribing user speech via an STT audio pipeline and replying with synthesized voice audio via a TTS pipeline.
- **Bidirectional Chat Bridge:** Relay messages in real time between a configured Discord text channel and in-game Minecraft server chat (with loopback protection).
- **Live Status Embeds:** Expose rich Discord status embeds displaying real-time bot health, hunger, world coordinates, active task status, and equipped gear.
- **Access Control:** Enforce role-based access control (RBAC) so only configured Discord roles or users can command the bot to execute in-game actions.
Provide clean configuration via environment variables for all credentials and IDs.

### R2. Minecraft Gameplay Agent Engine & Fair-Play Constraints
Implement a Minecraft client agent using TypeScript/Mineflayer capable of joining standard Minecraft Java edition servers:
- **Strict Fair-Play & Anti-Cheat (MANDATORY):** The AI is strictly prohibited from cheating or obtaining information that cannot be determined from regular gameplay:
  - *No X-Ray / Hidden Chunk Scanning:* The bot must never scan through solid walls or inspect underground chunks for hidden ores, caves, or chests. It must discover resources legitimately through visible line-of-sight, surface exposure, and step-by-step mining.
  - *No Privileged Commands:* The agent must operate strictly as a regular survival player without OP privileges (`/tp`, `/give`, `/gamemode`, etc.).
  - *Standard Physical Limits:* The agent must respect standard survival limits, including legitimate reach distances (~4.5 blocks), field-of-view, gravity, and movement speeds.
- **Foundational Capabilities:** Pathfinding, legitimate block interaction/mining, inventory management, and combat/defense.
- **Automated Survival Loops:** Auto-eating when hunger or health drops, sleeping in nearby beds at night, and automatically equipping the best available armor and weapons from inventory.

### R3. Natural Language AI Tool-Calling & Coordination
Integrate an LLM planning agent (using the official Google Gemini SDK) that connects Discord user requests (text or voice) to concrete Minecraft actions. The planner must decompose high-level user goals (e.g., "come to my location", "gather 10 oak logs", "defend the perimeter") into structured tool calls executed by the Minecraft agent, reporting progress, status changes, and in-game events back to the Discord channel. All tool definitions must enforce the fair-play constraints.

### R4. Automated Test Suite & Simulation Harness
Provide a comprehensive automated verification harness that can run in CI or local environments without requiring live external secrets or external servers. This must include mock Discord voice and text event simulators, and mock Minecraft protocol/server stubs to test and verify command parsing, voice processing workflows, AI tool calling, survival loops, chat bridging, RBAC checks, fair-play perception limits, and Minecraft action execution end-to-end.

## Acceptance Criteria

### Build & Verification Harness
- [ ] Project builds cleanly (`npm run build` or equivalent) with TypeScript type checks passing without errors.
- [ ] Automated test suite (`npm test`) runs programmatically and passes 100% of unit and integration tests.
- [ ] Mock harness validates the complete pipeline: simulated user voice/text prompt -> Gemini tool call invocation -> simulated Minecraft agent action execution -> Discord response confirmation.

### Fair-Play & Survival Integrity
- [ ] Agent perception strictly enforces standard player limitations: block searches and pathfinding only target visible, exposed, or naturally discovered blocks (no x-ray or unexposed underground block queries).
- [ ] Agent operates completely within survival mode limits without relying on privileged server commands or creative abilities.
- [ ] Reach distance and interaction checks strictly respect vanilla player range (~4.5 blocks).

### Discord Capabilities & Game Bridge
- [ ] Slash commands for bot status, server connection, and Minecraft tasks are registered and respond accurately.
- [ ] Role-based access control enforces permission checks on sensitive bot control commands.
- [ ] Bidirectional chat bridge relays messages between Discord and Minecraft server chat without duplication or feedback loops.
- [ ] Live status embed accurately displays real-time health, hunger, position, active task, and inventory overview.
- [ ] Voice receiver pipeline accurately ingests and buffers audio streams from users in a voice channel.
- [ ] Voice player pipeline generates and streams synthetic audio into the voice channel.

### Minecraft Agent & Survival Capabilities
- [ ] Agent exposes modular actions for pathfinding, block interaction/mining, inventory inspection, and combat.
- [ ] Automated survival loops reliably trigger: auto-eating when food drops below threshold, sleeping in available beds at night, and auto-equipping optimal gear.
- [ ] Error handling gracefully handles unreachable destinations, missing tools, or low health, notifying the user.

### Configuration & Documentation
- [ ] `.env.example` provides explicit documentation for all required settings (Discord token, client ID, channel IDs, allowed roles, Gemini API key, Minecraft server host/port/version).
- [ ] `README.md` documents setup, running tests with mocks, and launching the live bot.

## 2026-10-07T23:45:11Z

Build and complete the multimodal Discord bot with text and two-way voice channel capabilities, integrated with an AI-driven agent capable of connecting to and playing inside a Minecraft server on command via natural language tool execution, operating strictly under fair-play survival rules.

Working directory: c:/Users/rando/Documents/antigravity/wise-pasteur
Integrity mode: development

## Current Progress & State
- Milestone 1 is COMPLETED and verified: 14 test suites with 140/140 tests passing (100%), clean TypeScript build (`dist/`), git committed. Includes Discord client, slash commands, voice receiver/player pipelines (STT/TTS), priority audio queue, anti-loopback chat bridge, and RBAC security.
- Immediate Objectives: Resume and execute Milestone 2 (Minecraft Fair-Play Engine), Milestone 3 (Gemini AI Planning Bridge), and Milestone 4 (E2E Verification & Hardening) in `c:/Users/rando/Documents/antigravity/wise-pasteur`.

## Requirements to Implement

### R2. Minecraft Gameplay Agent Engine & Fair-Play Constraints (Milestone 2)
Implement a Minecraft client agent using TypeScript/Mineflayer capable of joining standard Minecraft Java edition servers:
- Strict Fair-Play & Anti-Cheat (MANDATORY): The AI is strictly prohibited from cheating or obtaining information that cannot be determined from regular gameplay:
  - Surface exposure checks (`src/minecraft/perception/exposure.ts`) and 3D line-of-sight raycasting (`src/minecraft/perception/raycast.ts`). The bot must never scan through solid walls or inspect underground chunks for hidden ores, caves, or chests. It must discover resources legitimately through visible line-of-sight, surface exposure, and step-by-step mining.
  - Perception FOV: $70^\circ$ focal FOV cone with $2.5$m near-field tactile fallback (`src/minecraft/perception/fov.ts`).
  - No Privileged Commands: Command sanitizer (`src/minecraft/fairplay/commandSanitizer.ts`) blocking all OP privileges (`/tp`, `/give`, `/gamemode`, etc.).
  - Physical Reach Limits: Reach limits strictly clamped to $\le 4.5$m for block interactions and $\le 3.5$m for entity combat (`src/minecraft/fairplay/reach.ts`).
- Foundational Capabilities: Mineflayer pathfinding navigation with safe drop/hazard penalties (`src/minecraft/actions/pathfinding.ts`), mining with harvest tier checks (`src/minecraft/actions/mining.ts`), inventory management & crafting (`src/minecraft/actions/inventory.ts`, `crafting.ts`), and combat with 1.9+ attack cooldown timing and shield protection (`src/minecraft/actions/combat.ts`).
- Automated Survival Loops: Auto-eating when hunger or health drops (`src/minecraft/loops/autoEat.ts`), sleeping in nearby beds at night with mob exclusion checks (`src/minecraft/loops/autoSleep.ts`), and auto-equipping optimal gear via composite defense scoring (`src/minecraft/loops/autoEquip.ts`).
- Offline Mock: Implement `test/mocks/mockMinecraft.ts` with an in-memory voxel world and event emitter bot to support 100% offline verification.

### R3. Natural Language AI Tool-Calling & Coordination (Milestone 3)
Integrate an LLM planning agent (`src/ai/`) using the official Google Gemini SDK (`@google/genai` >= 2.3.0) configured for `gemini-3.8-flash`:
- 9 Structured Fair-Play Tool Declarations: `goToCoordinates`, `followPlayer`, `gatherResource`, `defendArea`, `reportStatus`, `stopCurrentTask`, `craftItem`, `sleepInBed`, `depositOrRetrieve`.
- Validation Interceptor: Intercept and validate all tool parameters against fair-play survival limits.
- Decomposition & Execution Loop: Multi-turn tool execution loop reporting progress events back to Discord text/voice channels.
- Emergency Halt: Support task cancellation via `/stop` slash command and emergency voice interrupts.
- Offline Mock: Implement `test/mocks/mockGemini.ts` for deterministic offline testing without requiring live API keys.

### R4. Automated Test Suite & Simulation Harness (Milestones 2-4)
Provide a comprehensive automated verification harness that can run in CI or local environments without requiring live external secrets or external servers:
- Implement `test/harness/simulationHarness.ts` integrating mock Discord, mock Minecraft, and mock Gemini.
- Build test suites covering Tiers 1-4 and maintain 100% pass rate across all suites.
- End-to-end integration test validating: simulated user voice/text prompt -> Gemini tool call invocation -> simulated Minecraft agent action execution -> Discord response confirmation.
- Ensure `npm test` and `npm run build` pass cleanly with 0 errors.

## Acceptance Criteria
- [ ] Project builds cleanly (`npm run build`) with TypeScript type checks passing without errors.
- [ ] 100% of all unit, integration, and E2E tests pass via `npm test`.
- [ ] Minecraft agent strictly enforces fair-play reach ($\le 4.5$m), line-of-sight exposure, and blocks OP commands.
- [ ] Automated survival loops (eat, sleep, equip) trigger reliably based on in-game state changes.
- [ ] Gemini planner parses goals into valid tool calls and executes them against the Minecraft agent.
- [ ] Mock harness validates the complete pipeline end-to-end without requiring live API keys or external servers.
- [ ] `.env.example` and `README.md` are completely updated.
