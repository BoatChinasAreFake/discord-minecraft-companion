# DISPATCH: Milestone 1 - Explorer 1 (Scaffold, Config, Slash Commands & RBAC)

**Role**: teamwork_preview_explorer
**Working directory**: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m1_1
**Project root**: c:\Users\rando\Documents\antigravity\wise-pasteur
**Original request**: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\ORIGINAL_REQUEST.md
**Project scope**: c:\Users\rando\Documents\antigravity\wise-pasteur\PROJECT.md
**Survey 1 Report**: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\spec_miner_survey_1\survey_report.md
**Survey 3 Report**: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_survey_3\survey_report.md

## 2026-10-07T19:20:47Z
[Message] timestamp=2026-10-07T19:20:47Z sender=e9cac3a4-2cab-4915-bfc4-a4488f13ddf5 priority=MESSAGE_PRIORITY_HIGH content=You are an explorer for Milestone 1 of the Discord & Minecraft bot project.
Working directory: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m1_1
Project root: c:\Users\rando\Documents\antigravity\wise-pasteur

MANDATORY FIRST STEPS:
1. Read the user requirements from c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\ORIGINAL_REQUEST.md
2. Read the master project scope from c:\Users\rando\Documents\antigravity\wise-pasteur\PROJECT.md
3. Review the survey reports at c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\spec_miner_survey_1\survey_report.md and c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_survey_3\survey_report.md

Your focus area:
Project Scaffold, Environment Configuration, Discord Slash Commands, and RBAC Security.

Investigate and produce a concrete, step-by-step implementation strategy for:
1. package.json dependencies and scripts:
   - discord.js@14, @discordjs/voice, prism-media, opusscript, @google/genai, mineflayer, mineflayer-pathfinder, etc.
   - devDependencies: typescript, vitest, @types/node, etc.
   - scripts: build (tsc), test (vitest run), start
2. tsconfig.json (ES2022, NodeNext, strict mode, sourceMap, declaration)
3. vitest.config.ts (Node environment, fast in-memory execution)
4. .env.example (all required keys with descriptive comments)
5. src/config/env.ts (environment variable loading and validation)
6. src/discord/commands/ (slash commands: /status, /connect, /disconnect, /task, /stop, /inventory, /voice, /help, auto-deferral 2.5s)
7. src/discord/rbac.ts (3-tier security model: VIEWER, OPERATOR, ADMIN with role/user whitelisting)
8. src/discord/client.ts (Discord bot client wrapper, lifecycle, interaction routing)

Write your full plan to:
c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m1_1\plan.md
and write a standard handoff.md in your working directory.
When done, notify me via send_message with a concise summary and report path.
