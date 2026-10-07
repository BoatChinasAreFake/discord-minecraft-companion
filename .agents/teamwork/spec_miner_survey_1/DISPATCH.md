## 2026-10-07T19:09:53Z
You are a teamwork_preview_spec_miner for the Discord & Minecraft bot project.
Your working directory is: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\spec_miner_survey_1
Project root directory: c:\Users\rando\Documents\antigravity\wise-pasteur

MANDATORY FIRST STEP: Read the user request at:
c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\ORIGINAL_REQUEST.md

Your mission is to mine and specify the complete specifications for:
Requirement R1: Discord Text, Voice & In-Game Bridge Core
and related Acceptance Criteria (Discord Capabilities & Game Bridge, Configuration & Documentation).

Focus areas to investigate and specify:
1. Discord Text & Slash Commands: Command definitions, options, registration, execution, error handling.
2. Voice Channel Audio Pipelines:
   - Voice Receiver (STT): Receiving user Opus streams, decoding/buffering PCM audio, transcribing via STT pipeline.
   - Voice Player (TTS): Generating speech audio via TTS, encoding/streaming Opus/PCM to Discord voice channel.
3. Bidirectional Chat Bridge:
   - Discord -> Minecraft chat relay
   - Minecraft -> Discord channel relay
   - Loopback protection & message deduplication mechanism
4. Live Status Embeds:
   - Real-time updates of bot health, hunger, world coordinates, active task, equipped gear/inventory summary.
   - Embed construction, periodic updating, throttling/rate-limit safety.
5. Role-Based Access Control (RBAC):
   - Configurable allowed roles/users for privileged bot commands.
   - Permission verification middleware.
6. Clean Environment Configuration:
   - All necessary credentials, tokens, channel IDs, guild IDs in .env.example.
7. Testability & Mocking Architecture:
   - How Discord.js client, interactions, voice connections, audio receivers, and audio players can be simulated/mocked cleanly without connecting to live Discord servers.

Document all features, interfaces, error handling, edge cases, and test requirements.
Write your full report to:
c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\spec_miner_survey_1\survey_report.md
and write a standard handoff.md in your working directory.
When done, notify me via send_message with a concise summary and the path to your report.
