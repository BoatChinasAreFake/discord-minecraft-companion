# DISPATCH: Survey 2 - Minecraft Fair-Play Engine

**Role**: teamwork_preview_spec_miner
**Working directory**: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\spec_miner_survey_2
**Project root**: c:\Users\rando\Documents\antigravity\wise-pasteur
**Original request**: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\ORIGINAL_REQUEST.md

## 2026-10-07T19:09:53Z
You are a teamwork_preview_spec_miner for the Discord & Minecraft bot project.
Your working directory is: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\spec_miner_survey_2
Project root directory: c:\Users\rando\Documents\antigravity\wise-pasteur

MANDATORY FIRST STEP: Read the user request at:
c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\ORIGINAL_REQUEST.md

Your mission is to mine and specify the complete specifications for:
Requirement R2: Minecraft Gameplay Agent Engine & Fair-Play Constraints
and related Acceptance Criteria (Fair-Play & Survival Integrity, Minecraft Agent & Survival Capabilities).

Focus areas to investigate and specify:
1. Strict Fair-Play & Anti-Cheat Engine (MANDATORY):
   - Perception Limitations: The bot MUST NEVER x-ray or scan underground chunks for hidden blocks. Specify how line-of-sight raycasting / visibility checks work (e.g. checking whether blocks have open/exposed faces directly visible from player position or eye line without occluding opaque blocks).
   - Standard Physical Limits: Interaction reach strictly limited to vanilla player survival reach (~4.5 blocks). Field of view and survival movement physics.
   - No Privileged Commands: Completely disable/prohibit OP commands (`/tp`, `/give`, `/gamemode`). Strictly regular survival player.
2. Foundational Gameplay Capabilities (Mineflayer / TypeScript):
   - Pathfinding: Integration with mineflayer-pathfinder, safe movement, obstacle avoidance, reachable target validation.
   - Block Interaction & Mining: Digging visible blocks, tool selection, block placement.
   - Inventory Management & Crafting: Inventory inspection, item transfer, container interaction, crafting basics.
   - Combat & Defense: Hostile mob detection within line-of-sight, weapon swinging, shielding, retreating on critical health.
3. Automated Survival Loops:
   - Auto-eating: Monitoring food level and health, selecting edible food from inventory, consuming when below threshold.
   - Sleeping: Detecting night/thunderstorms, locating nearby accessible beds, entering/leaving beds safely.
   - Auto-equipping: Evaluating armor points and weapon stats, equipping best available gear automatically.
4. Error Handling & Recovery:
   - Handling unreachable goals, missing tools/resources, interruptions, hazards (lava, drowning, falling).
5. Testability & Mocking Architecture:
   - How Mineflayer bot, world state, physics, pathfinder, and Minecraft server protocol can be simulated in unit and integration tests without a live Minecraft Java server.

Write your full report to:
c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\spec_miner_survey_2\survey_report.md
and write a standard handoff.md in your working directory.
When done, notify me via send_message with a concise summary and the path to your report.
