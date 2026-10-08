## 2026-10-07T23:55:10Z
You are Worker 1 for Milestone 2: Minecraft Fair-Play Survival Engine.
Your working directory is: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\worker_m2_1
Project workspace: c:\Users\rando\Documents\antigravity\wise-pasteur

MANDATORY FIRST STEPS:
1. Read the authoritative user request at: c:\Users\rando\Documents\antigravity\wise-pasteur\ORIGINAL_REQUEST.md
2. Read the master project architecture and contracts at: c:\Users\rando\Documents\antigravity\wise-pasteur\PROJECT.md
3. Read the three Explorer reports in detail:
   - c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m2_1\report.md (Perception, Fair-play limits, Mock Minecraft)
   - c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m2_2\report.md (Pathfinding, Mining tiers, Crafting, 1.9+ Combat)
   - c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m2_3\report.md (Survival loops: AutoEat, AutoSleep, AutoEquip; Client lifecycle; Test matrix)

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

FILE OWNERSHIP (EXCLUSIVE):
You own and must implement the following files in the project:
- test/mocks/mockMinecraft.ts (in-memory 3D voxel grid world, EventEmitter bot, mock IMinecraftAgent with full physics, inventory, pathfinder emulation)
- test/mocks/index.ts (re-export mockMinecraft)
- src/minecraft/types.ts (interfaces: IMinecraftAgent, IMinecraftChatAgent, Vec3, etc.)
- src/minecraft/fairplay/reach.ts (block reach <= 4.50m from eyes, entity combat reach <= 3.50m)
- src/minecraft/fairplay/commandSanitizer.ts (filter all OP/privileged commands: /tp, /give, /gamemode, /op, /stop, etc.)
- src/minecraft/fairplay/rules.ts (fair-play constraints and rule validator)
- src/minecraft/perception/exposure.ts (6-neighbor face exposure check against air/transparent blocks; anti-xray filter)
- src/minecraft/perception/raycast.ts (3D DDA voxel line-of-sight raycaster from eyes to target face centers)
- src/minecraft/perception/fov.ts (70 degree focal FOV cone + 2.5m near-field tactile fallback)
- src/minecraft/actions/pathfinding.ts (mineflayer-pathfinder integration with safe drop maxDropDown=3, parkour=false, hazard avoidance, stall detection)
- src/minecraft/actions/mining.ts (tool harvest tiers, raycast dig execution, damage interrupt guard)
- src/minecraft/actions/inventory.ts (inventory slots, quickbar, armor, container interactions)
- src/minecraft/actions/crafting.ts (2x2 vs 3x3 table detection, recursive recipe decomposition)
- src/minecraft/actions/combat.ts (LOS check, 3.5m reach, 1.9+ weapon cooldown attack gauge timing, shield raise, < 6 HP panic retreat)
- src/minecraft/loops/autoEat.ts (hunger <= 14 or health < 20 while hunger <= 17, saturation prioritization, poison blacklist)
- src/minecraft/loops/autoSleep.ts (night/thunderstorm check, 8m/5m mob exclusion, bed navigation and sleep)
- src/minecraft/loops/autoEquip.ts (composite defense score formula, hysteresis threshold)
- src/minecraft/client.ts (IMinecraftAgent lifecycle manager, auto-reconnect backoff, event bridges, subsystem orchestration)
- Test suites under test/m2/:
  - test/m2/perception.test.ts (exposure, raycast, FOV cone, tactile fallback)
  - test/m2/fairplay.test.ts (reach limits, command sanitizer, anti-xray)
  - test/m2/actions.test.ts (pathfinding, mining tiers, crafting 2x2/3x3, combat cooldown & shields)
  - test/m2/survivalLoops.test.ts (auto-eat, auto-sleep mob exclusion, auto-equip composite scoring)
  - test/m2/client.test.ts (lifecycle states, event bridges, subsystem integration)

VERIFICATION REQUIREMENTS:
- Run `npm test` using run_command to verify that ALL test suites (including existing M1 tests in test/m1/ AND new M2 tests in test/m2/) pass 100%.
- Run `npm run build` or `npm run typecheck` to verify clean compilation with 0 TypeScript errors.
- Document build and test commands and full execution output in your handoff report.

OUTPUT REQUIREMENTS:
- Write your completion report to c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\worker_m2_1\handoff.md
- Use send_message to notify parent (id: e026c1ee-5533-4b5b-93ce-229eafdae44b) when done.
