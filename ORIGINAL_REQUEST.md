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
