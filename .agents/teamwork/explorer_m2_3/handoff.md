# Handoff Report: Milestone 2 Survival Loops, Client Lifecycle & Test Suite Architecture

**Author**: Explorer 3 (Milestone 2 Investigation)  
**Date**: 2026-10-07  
**Working Directory**: `.agents/teamwork/explorer_m2_3/`  
**Handoff Type**: Hard (Task Complete)  

---

## 1. Observation

1. **Authoritative Requirements in `ORIGINAL_REQUEST.md` (lines 77–86)**:
   - "Auto-eating when hunger or health drops (`src/minecraft/loops/autoEat.ts`), sleeping in nearby beds at night with mob exclusion checks (`src/minecraft/loops/autoSleep.ts`), and auto-equipping optimal gear via composite defense scoring (`src/minecraft/loops/autoEquip.ts`)."
   - "Offline Mock: Implement `test/mocks/mockMinecraft.ts` with an in-memory voxel world and event emitter bot to support 100% offline verification."
   - "Physical Reach Limits: Reach limits strictly clamped to $\le 4.5$m for block interactions and $\le 3.5$m for entity combat (`src/minecraft/fairplay/reach.ts`)."

2. **Interface Contracts in `src/minecraft/types.ts` (lines 7–35, 67–84)**:
   - `MinecraftBotStatus` requires fields: `connected`, `username`, `health` (0.0–20.0), `food` (0–20), `position` (`Vec3Location`), `dimension` (`'overworld' | 'the_nether' | 'the_end'`), `currentTask`, `gear` (`mainHand`, `offHand`, `armorSummary`, `helmet`, `chestplate`, `leggings`, `boots`), `inventory` (`usedSlots`, `totalSlots`, `freeSlots`), and `server` (`host`, `port`, `ping`).
   - `IMinecraftAgent` requires: `connect()`, `disconnect()`, `getStatus()`, `canInteractWith()`, `findVisibleBlock()`, `navigateTo()`, `mineBlock()`, `placeBlock()`, `craftItem()`, `attackEntity()`, `sleepInNearbyBed()`, `sendChat()`, `on('chat')`, `on('statusUpdate')`, `on('death')`, and `removeListener()`.

3. **Existing Milestone 1 Test Execution**:
   - `cmd /c "npm test"` executed Vitest run with 14 test suites, 140 passing tests, 0 failures.
   - `cmd /c "npm run build"` completed with zero TypeScript compilation errors (`tsc -p tsconfig.json`).
   - Powershell script execution policy on Windows restricts `npm.ps1`, requiring execution via `cmd /c "npm test"` or `cmd /c "npm run build"`.

4. **Minecraft Data Inspection (`minecraft-data` v1.20.4)**:
   - `mcData.foodsByName['golden_carrot']`: foodPoints: 6, saturation: 14.4, effectiveQuality: 20.4.
   - `mcData.foodsByName['cooked_beef']`: foodPoints: 8, saturation: 12.8, effectiveQuality: 20.8.
   - `mcData.foodsByName['rotten_flesh']`: foodPoints: 4, saturation: 0.8, effectiveQuality: 4.8.
   - `mcData.foodsByName['pufferfish']`: foodPoints: 1, saturation: 0.2, effectiveQuality: 1.2.
   - `mcData.itemsByName['diamond_chestplate']`: maxDurability: 528, enchantCategories: `['armor', 'armor_chest', 'breakable', 'wearable', 'vanishable']`.

5. **PrismarineJS Mineflayer API (`node_modules/mineflayer/index.d.ts`)**:
   - Bot events: `'chat'`, `'health'`, `'time'`, `'rain'`, `'sleep'`, `'wake'`, `'death'`, `'kicked'`, `'end'`.
   - Bot methods: `consume()`, `sleep(bedBlock: Block)`, `wake()`, `equip(item, destination)`, `unequip(destination)`, `isSleeping`.

---

## 2. Logic Chain

1. **Auto-Eat Trigger Logic**:
   - Observation 1 & 4 show Minecraft food mechanics: natural regeneration requires `food >= 18` (rapid healing at `food == 20` with saturation).
   - Therefore, triggering eating when `food <= 14` prevents loss of sprinting (`<= 6`), and triggering when `health < 20 && food <= 17` actively restores natural healing.
   - Harmful foods (`pufferfish`, `spider_eye`, `poisonous_potato`) cause net damage/poison, so they are blacklisted.
   - `rotten_flesh` inflicts the Hunger effect (80% chance) but restores 4 food points; it is blacklisted during normal gameplay, but permitted when starving (`food <= 6`) to prevent starvation damage.
   - Eating locks the player in a 32-tick consumption animation with 80% speed reduction. Therefore, active melee threats within 4m must defer eating or trigger tactical retreat before consumption starts.

2. **Auto-Sleep Trigger & Exclusion Logic**:
   - Observation 1 & 5 confirm vanilla sleep triggers: bed time starts at `timeOfDay >= 12541` (18:32) and ends at `23458` (05:43), or anytime during thunderstorms (`thunderState > 0`).
   - Vanilla bed interaction logic rejects sleeping if monsters exist within an AABB box: horizontal reach $\le 8$m ($|dx| \le 8, |dz| \le 8$), vertical reach $\le 5$m ($|dy| \le 5$).
   - Sleeping in the Nether or End causes explosive destruction; hence, `dimension === 'overworld'` must be strictly enforced.
   - Checking this monster exclusion box before sending bed sleep packets prevents server rejection spam and alerts the bot to clear or evade hostiles.

3. **Auto-Equip Scoring Logic**:
   - Observation 2 & 4 require tracking armor pieces, weapons, and off-hand items.
   - Netherite provides Toughness 3 and Knockback Resistance; Diamond provides Toughness 2; Iron provides baseline defense; Protection enchantments reduce damage by 4% per EPF point.
   - A composite score:
     $$\text{Score} = (\text{Tier} \times 25) + (D \times 10) + (T \times 8) + (K \times 5) + (E_{\text{prot}} \times 6) + (E_{\text{other}} \times 2) + \text{DurabilityRatio}$$
     strictly ranks Netherite Prot IV > Diamond Prot IV > Diamond Plain > Iron Prot I > Iron Plain > Leather, while an $\epsilon = 1.0$ hysteresis threshold prevents gear-thrashing oscillations.

4. **Client Lifecycle & Reconnect Logic**:
   - Observation 2 requires `MinecraftClient` to implement `IMinecraftAgent`.
   - Unexpected socket drops (`'end'`, `'kicked'`, socket errors) must not crash the companion bot.
   - Truncated exponential backoff ($T_{\text{delay}} = \min(30000, 1000 \times 2^n) \times (1 \pm 0.20)$) prevents thundering herd, and setting `intentionalDisconnect = true` on `client.disconnect()` ensures user-requested shutdowns never trigger reconnect loops.

5. **Test Suite Architecture**:
   - Observation 3 confirms 140/140 existing M1 tests run offline.
   - Designing 5 test suites (`perception`, `fairplay`, `actions`, `survivalLoops`, `client`) running against `MockMineflayerBot` and `MockWorld` guarantees that Milestone 2 features can be verified rapidly (< 2s) with zero external network or live Minecraft server dependencies.

---

## 3. Caveats

1. **Mineflayer Pathfinder Plugin Interaction**:
   - In production, `mineflayer-pathfinder` loads dynamically via `bot.loadPlugin(pathfinder)`. In offline tests, `bot.pathfinder` must be cleanly stubbed or mocked in `test/mocks/mockMinecraft.ts` so that `goto()`, `GoalGetToBlock`, and `Movements` resolve deterministically without a live physics engine.
2. **Bed Block Metadata in Mock Voxel Worlds**:
   - In live Minecraft 1.20+, beds have orientation (head/foot) and color names (`white_bed`, `red_bed`). Mock block objects in unit tests must provide `name: 'red_bed'` and block bounding box properties matching vanilla.
3. **Food Animation Timing in Mock Bot**:
   - Real `bot.consume()` takes 32 ticks (1600ms). In test suites, `MockMineflayerBot.consume()` should resolve either immediately or via a microtask timer to keep test suite duration fast (< 50ms per test).

---

## 4. Conclusion

The investigation into Milestone 2 Automated Survival Loops, Client Lifecycle Manager, and Test Suite Architecture is complete. Concrete algorithmic specifications, mathematical scoring models, blacklist definitions, state machines, and 5 comprehensive test suites with detailed test case tables have been designed and documented in:
`c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m2_3\report.md`

The implementer can proceed directly to build:
1. `src/minecraft/loops/autoEat.ts`
2. `src/minecraft/loops/autoSleep.ts`
3. `src/minecraft/loops/autoEquip.ts`
4. `src/minecraft/client.ts`
5. `test/m2/survivalLoops.test.ts`, `test/m2/client.test.ts`, `test/m2/perception.test.ts`, `test/m2/fairplay.test.ts`, `test/m2/actions.test.ts`

---

## 5. Verification Method

1. **Verify Report and Documentation**:
   - Inspect `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m2_3\report.md` to confirm all mathematical formulas, state machine diagrams, food blacklist tables, and test matrices are present.
2. **Verify Baseline Tests & Build**:
   - Execute: `cmd /c "npm test"`
   - Expected: 14 test suites pass (140/140 passed).
   - Execute: `cmd /c "npm run build"`
   - Expected: TypeScript compilation succeeds with exit code 0.
3. **Invalidation Conditions**:
   - Invalidation occurs if `IMinecraftAgent` contract in `src/minecraft/types.ts` is changed without updating `MinecraftClient` methods, or if Minecraft food/armor scoring functions fail to prioritize saturation over base hunger points when healing.
