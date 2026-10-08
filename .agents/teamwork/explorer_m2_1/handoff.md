# Handoff Report: Milestone 2 Minecraft Fair-Play Survival Engine Investigation

**Author:** Explorer 1 (Read-Only Investigation)  
**Date:** 2026-10-07  
**Working Directory:** `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m2_1`  
**Handoff Type:** Hard (Task complete)  

---

## 1. Observation

1. **User Request & Master Architecture (`ORIGINAL_REQUEST.md`, `PROJECT.md`):**
   - `ORIGINAL_REQUEST.md` (lines 77–86) defines Milestone 2 scope:
     > "Surface exposure checks (`src/minecraft/perception/exposure.ts`) and 3D line-of-sight raycasting (`src/minecraft/perception/raycast.ts`). The bot must never scan through solid walls or inspect underground chunks for hidden ores, caves, or chests... Perception FOV: 70° focal FOV cone with 2.5m near-field tactile fallback (`src/minecraft/perception/fov.ts`). No Privileged Commands: Command sanitizer (`src/minecraft/fairplay/commandSanitizer.ts`) blocking all OP privileges... Physical Reach Limits: Reach limits strictly clamped to $\le 4.5$m for block interactions and $\le 3.5$m for entity combat (`src/minecraft/fairplay/reach.ts`)... Offline Mock: Implement `test/mocks/mockMinecraft.ts` with an in-memory voxel world and event emitter bot to support 100% offline verification."
   - `PROJECT.md` (lines 70–86) specifies features F18 through F34 for Milestone 2.

2. **Codebase Status (`src/minecraft/types.ts` & `package.json`):**
   - `src/minecraft/types.ts` contains existing types: `Vec3Location`, `MinecraftBotStatus`, `MinecraftConnectionConfig`, `ActionResult`, `VisibleBlock`, `BlockSearchCriteria`, and `IMinecraftAgent`.
   - `package.json` (lines 19–23) contains installed dependencies:
     ```json
     "mineflayer": "^4.20.1",
     "mineflayer-pathfinder": "^2.4.5",
     "vec3": "^0.1.10"
     ```
   - `tsconfig.json` (lines 3–5) specifies:
     ```json
     "target": "ES2022",
     "module": "NodeNext",
     "moduleResolution": "NodeNext"
     ```
     requiring `.js` extensions for relative TypeScript module imports.

3. **Current Test Suite Execution:**
   - Ran `npm.cmd test`: All 14 existing test files and 140/140 tests pass cleanly (100% pass rate).
   - Ran `npm.cmd run typecheck`: TypeScript compilation succeeds cleanly with 0 errors.

4. **Mock Directory (`test/mocks/`):**
   - Current files: `mockDiscord.ts`, `mockVoice.ts`, and `index.ts`.
   - `mockMinecraft.ts` is not yet created, and `test/mocks/index.ts` only exports `mockDiscord.js` and `mockVoice.js`.

---

## 2. Logic Chain

1. **Anti-Xray Perception via 3-Stage Pipeline:**
   - From Observation 1, bots must never query raw chunk arrays for underground ores without surface exposure and line of sight.
   - Stage 1: Any block whose 6 adjacent neighbors (+X, -X, +Y, -Y, +Z, -Z) are solid/opaque is physically encased inside rock/ground. Filtering these blocks out immediately eliminates X-ray cheating at zero raycast cost.
   - Stage 2: For exposed blocks, if distance $\le 2.50$m, the block is within tactile near-field radius and perceived regardless of orientation. If distance $> 2.50$m, the angle between the bot's look vector and the target direction must satisfy $\hat{V}_{look} \cdot \hat{D}_{target} \ge \cos(35^\circ) \approx 0.81915$.
   - Stage 3: For blocks passing FOV, Amanatides & Woo 3D DDA voxel traversal casts rays from the bot's eye position $(x, y+1.62, z)$ to the exposed face center coordinates. If any ray reaches the exposed face without encountering solid opaque blocks, the block is confirmed visible.

2. **Fair-Play Physical Reach and Command Sanitization:**
   - From Observation 1, vanilla Minecraft limits survival interactions.
   - Distance from eye $(x, y+1.62, z)$ to block AABB $[x, x+1] \times [y, y+1] \times [z, z+1]$ must strictly be $\le 4.50$m; entity attack distance must strictly be $\le 3.50$m. Any attempt exceeding these thresholds must be intercepted and rejected with `ReachExceededError`.
   - All outbound chat strings must pass through `sanitizeMinecraftMessage`. If text begins with `/` (after stripping whitespace, control codes, and multi-slash prefixes), the root command is checked against `BLOCKED_COMMANDS`. If it matches any OP/administrative command (`tp`, `give`, `gamemode`, `op`, `kill`, `summon`, etc.), execution is rejected with `PrivilegedCommandError`. Regular chat messages without a leading `/` are permitted.

3. **Offline Mock Architecture:**
   - From Observation 1 & 4, tests must run without a live Minecraft server.
   - `MockWorld` maintains a sparse 3D coordinate map (`Map<string, MockBlock>`), providing `getBlock`, `setBlock`, `loadBox`, `createFlatWorld`, and `raycast`.
   - `MockMineflayerBot` extends `EventEmitter`, providing `entity` (position, yaw, pitch, eyeHeight), `inventory`, `heldItem`, `health`, `food`, equipment slots, action methods (`dig`, `placeBlock`, `equip`, `consume`, `sleep`, `chat`), and `bot.pathfinder` emulation.
   - Exposing `MockMinecraftAgent` implementing `IMinecraftAgent` allows both unit and integration tests to run in sub-second offline Vitest runs.

---

## 3. Caveats

1. **Sub-block Bounding Boxes (Slabs/Stairs/Chests):**
   - In full vanilla Minecraft, slabs and stairs have fractional bounding boxes ($0.5$m height). The exposure filter treats them as exposing blocks because they do not fill a $1.0\text{m}^3$ opaque cube. In `MockWorld`, treating slabs/stairs/doors as exposing non-solid blocks preserves exact physical visibility.
2. **Water Transparency:**
   - Water allows light through and exposes adjacent blocks. In deep water, Minecraft applies fog attenuation; for the purpose of the fair-play engine, water is treated as non-opaque for line of sight, which matches vanilla water visibility within standard survival ranges.
3. **No Implementation in `src/` or `test/`:**
   - As an explorer agent operating under read-only constraints, no source code in `src/` or `test/` was created or modified. All designs and specifications are documented in `report.md` and this handoff report.

---

## 4. Conclusion

The architectural investigation and mathematical designs for Milestone 2 are complete:
1. `src/minecraft/perception/exposure.ts`: Formulated 6-neighbor adjacency exposure evaluation and block classification matrix.
2. `src/minecraft/perception/raycast.ts`: Formulated Amanatides & Woo 3D DDA voxel stepping algorithm targeting exposed face centers.
3. `src/minecraft/perception/fov.ts`: Formulated $70^\circ$ focal FOV cone ($\cos(35^\circ)$ threshold) and $2.50$m tactile near-field fallback.
4. `src/minecraft/fairplay/reach.ts`: Formulated $\le 4.50$m block interaction and $\le 3.50$m entity combat reach clamping and AABB distance measurement.
5. `src/minecraft/fairplay/commandSanitizer.ts`: Formulated multi-layer regex normalization and OP command prohibition filter.
6. `test/mocks/mockMinecraft.ts`: Formulated in-memory 3D voxel grid world (`MockWorld`), event-driven mock bot (`MockMineflayerBot`), and mock agent (`MockMinecraftAgent`).

The full blueprint is published in:
`c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m2_1\report.md`

---

## 5. Verification Method

To verify the findings and specifications independently:
1. **Inspect Documentation Artifacts:**
   - View `report.md`: `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m2_1\report.md`
   - Verify all algorithmic models, mathematical formulas, and TypeScript interface signatures.
2. **Verify Workspace Baseline:**
   - Run typecheck: `npm.cmd run typecheck`
   - Run test suite: `npm.cmd test`
3. **Downstream Implementation Verification (Post-Implementation by Builder):**
   - Create unit tests in `test/m2/` targeting `exposure.test.ts`, `raycast.test.ts`, `fov.test.ts`, `reach.test.ts`, `commandSanitizer.test.ts`, and `mockMinecraft.test.ts`.
   - Ensure all new tests pass with 100% pass rate under `npm.cmd test`.
