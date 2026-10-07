## 2026-10-07T19:09:53Z
You are a teamwork_preview_explorer for the Discord & Minecraft bot project.
Your working directory is: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_survey_3
Project root directory: c:\Users\rando\Documents\antigravity\wise-pasteur

MANDATORY FIRST STEP: Read the user request at:
c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\ORIGINAL_REQUEST.md

Your mission is to investigate and specify:
Requirement R3: Natural Language AI Tool-Calling & Coordination
Requirement R4: Automated Test Suite & Simulation Harness
and related Acceptance Criteria (Build & Verification Harness).

Focus areas to investigate and specify:
1. Natural Language AI Tool-Calling Engine:
   - Official Google Gemini SDK (`@google/genai`): client configuration, model selection, structured tool definitions (FunctionDeclaration).
   - Tool execution loop: Decomposing natural language goals from Discord (text or transcribed voice) into discrete Minecraft agent actions (e.g. `goToCoordinates`, `followPlayer`, `gatherResource`, `defendArea`, `reportStatus`, `stopCurrentTask`).
   - Fair-play enforcement in tool declarations: ensuring tool parameters and execution respect survival limits.
   - Progress reporting and status feedback back to Discord (progress messages, error handling, completion announcements).
2. Automated Test Suite & Simulation Harness Architecture:
   - Must run 100% offline in CI and local environments without requiring live API keys, Discord tokens, or live Minecraft servers.
   - Mock Discord Event Simulator: Mock voice streams (STT/TTS roundtrip), mock slash commands, mock text message events, mock permissions.
   - Mock Minecraft Protocol / Server Stub: Mocking bot events, world chunks/blocks, entity movements, chat events.
   - Mock Gemini Provider: deterministic tool call responses and conversation simulation.
   - Test Organization & 4-Tier Strategy:
     * Tier 1: Feature Coverage (>=5 test cases per feature)
     * Tier 2: Boundary & Corner Cases (>=5 test cases per feature)
     * Tier 3: Cross-Feature Combinations (pairwise interactions)
     * Tier 4: Real-World Application Scenarios (end-to-end voice/text -> planning -> execution -> feedback)
3. Build & Project Configuration:
   - Package manager, TypeScript configuration, build scripts (`npm run build`, `npm test`), directory layout.

Write your full report to:
c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_survey_3\survey_report.md
and write a standard handoff.md in your working directory.
When done, notify me via send_message with a concise summary and the path to your report.
