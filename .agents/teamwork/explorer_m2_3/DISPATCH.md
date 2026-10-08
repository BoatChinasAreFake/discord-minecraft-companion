## 2026-10-07T23:48:52Z
You are Explorer 3 for Milestone 2: Minecraft Fair-Play Survival Engine.
Your working directory is: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m2_3
Project workspace: c:\Users\rando\Documents\antigravity\wise-pasteur

MANDATORY FIRST STEPS:
1. Read the authoritative user request at: c:\Users\rando\Documents\antigravity\wise-pasteur\ORIGINAL_REQUEST.md
2. Read the master project architecture and contracts at: c:\Users\rando\Documents\antigravity\wise-pasteur\PROJECT.md
3. Inspect existing types in src/minecraft/types.ts and test patterns in test/m1/.

SCOPE & OBJECTIVE (READ-ONLY INVESTIGATION):
You must investigate, design algorithms, and specify concrete implementation plans for:
1. Automated Survival Loops:
   - Auto-eating loop (src/minecraft/loops/autoEat.ts): monitor food level (<= 14) or health (< 20 while food <= 17). Select best food item in inventory prioritizing saturation/nutrition. Blacklist harmful foods (pufferfish, rotten flesh unless starving <= 6, spider eye, poison potato). Safe eating pause without interrupting active critical combat.
   - Auto-sleeping loop (src/minecraft/loops/autoSleep.ts): monitor world time (time of day >= 12541 or thunderstorm). Scan nearby reachable beds within fair-play perception. Enforce vanilla monster exclusion radius check (no hostile mobs within 8m horizontal, 5m vertical). Safely navigate to bed, activate sleep, and wake upon dawn.
   - Auto-equipping loop (src/minecraft/loops/autoEquip.ts): scan inventory for armor pieces (helmet, chestplate, leggings, boots) and weapons/tools. Compute composite defense score: material tier (netherite > diamond > iron > chainmail > gold > leather) + defense points + toughness + Protection enchantments. Automatically equip optimal gear.
2. Minecraft Client Lifecycle Manager (src/minecraft/client.ts):
   - Implementation of IMinecraftAgent interface.
   - Connection lifecycle (connecting, spawned, disconnected, error, kick, auto-reconnect backoff).
   - Event bridges ('chat', 'statusUpdate', 'health', 'death', 'kicked').
   - Integration with survival loops, fair-play perception, and action subsystems.
3. Milestone 2 Test Suite Architecture:
   - Design comprehensive unit test suites covering:
     * test/m2/perception.test.ts (exposure, raycast, FOV, reach)
     * test/m2/fairplay.test.ts (command sanitizer, reach limits, anti-xray)
     * test/m2/actions.test.ts (mining, pathfinding, inventory, crafting, combat cooldown)
     * test/m2/survivalLoops.test.ts (auto-eat, auto-sleep, auto-equip)
     * test/m2/client.test.ts (lifecycle, events, full agent coordination)
   - Ensure 100% test execution via in-memory mockMinecraft without external network or servers.

OUTPUT REQUIREMENTS:
- Write your detailed analysis and recommended implementation strategy to:
  c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m2_3\report.md
  and c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m2_3\handoff.md
- Use send_message to report completion to parent (id: e026c1ee-5533-4b5b-93ce-229eafdae44b).
DO NOT write source code in src/ or test/ - you are read-only.
