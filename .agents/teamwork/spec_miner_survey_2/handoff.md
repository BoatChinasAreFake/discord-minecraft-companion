# Handoff Report: Specification Mining for Requirement R2 (Minecraft Gameplay Agent & Fair-Play Constraints)

**Agent**: `spec_miner_survey_2`  
**Working Directory**: `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\spec_miner_survey_2`  
**Recipient**: `orchestrator_1` (`e9cac3a4-2cab-4915-bfc4-a4488f13ddf5`)  
**Date**: 2026-10-07T19:18:00Z  

---

## 1. Observation
1. **User Request & Acceptance Criteria**:
   - `ORIGINAL_REQUEST.md` lines 20-28: Requirement R2 mandates strict fair-play and anti-cheat constraints ("The AI is strictly prohibited from cheating... No X-Ray / Hidden Chunk Scanning... No Privileged Commands... Standard Physical Limits... Foundational Capabilities... Automated Survival Loops").
   - `ORIGINAL_REQUEST.md` lines 42-46: Acceptance criteria specify block searches targeting only visible/exposed blocks, survival mode limits without privileged commands, reach distance strictly respecting ~4.5 blocks.
   - `ORIGINAL_REQUEST.md` lines 55-59: Modular actions for pathfinding, mining, inventory, combat, automated survival loops (eating, sleeping, auto-equipping), and error handling.
2. **Mineflayer and Prismarine Ecosystem State**:
   - `npm.cmd view mineflayer version` returned `4.39.0`.
   - `npm.cmd view mineflayer-pathfinder version` returned `2.4.5`.
   - `npm.cmd view prismarine-world version` returned `3.7.0`.
   - `npm.cmd view vec3 version` returned `0.2.0`.
   - `npm.cmd view flying-squid version` returned `1.12.0`.
3. **Perception and Raycasting APIs**:
   - `prismarine-world` exposes `world.raycast(from, direction, range, matcher)` and `RaycastIterator`.
   - `mineflayer` exposes `bot.canSeeBlock(block)`, `bot.blockAtCursor(maxDistance, matcher)`, and `bot.dig(block, 'raycast', 'raycast')`.
   - Vanilla Minecraft Java survival mode constants:
     - Block interaction reach: $4.50$ blocks from eye position (`eyePos = bot.entity.position.offset(0, bot.entity.height, 0)`).
     - Entity attack reach: $3.00$ blocks bounding box edge, $3.50$ blocks center-to-center.
     - Eye height: $1.62$m (standing), $1.27$m (crouching/sneaking).
     - Sleeping tick interval: $12,542 \le \text{timeOfDay} \le 23,458$ (night) or active thunderstorm; monster exclusion cylinder: $8$m radius horizontally, $5$m vertically.
     - Attack cooldown: weapon swing cooldown delay $\Delta t = 1000 / \text{attackSpeed}$ ($625$ms for swords).

---

## 2. Logic Chain
1. *From Observation 1 and 3*: Raw calls to `bot.findBlock()` bypass visual occlusion and expose hidden ores in underground chunks, violating Requirement R2's Anti-Xray rule.
2. *Therefore*: Legitimate resource discovery requires a multi-stage perception pipeline:
   - Stage 1: Discard solid blocks where all 6 adjacent neighbors are solid/opaque (unexposed face filter).
   - Stage 2: Perform 3D line-of-sight raycasts from the player's eye coordinates to exposed face centers, checking for occluding opaque voxels.
   - Stage 3: Restrict focal visual perception within the player's $70^\circ$ FOV cone, supplemented by an immediate $2.5$m near-field tactile zone.
3. *From Observation 1 and 2*: Anti-cheat plugins monitor reach packets. Enforcing reach limits of $4.5$m for block interactions and $3.5$m for entity combat at the software abstraction layer prevents packet rejection and bans.
4. *From Observation 1*: Privileged operator commands (`/tp`, `/give`, `/gamemode`, etc.) violate survival integrity. A chat interceptor (`CommandSanitizer`) must inspect all outgoing messages, blocking prohibited commands before packet dispatch and alerting Discord.
5. *From Observation 2 and 3*: Mineflayer survival capabilities decompose into:
   - Pathfinding: Wrapped `mineflayer-pathfinder` configured with `maxDropDown = 3`, parkour disabled, and high liquid penalties.
   - Block Interaction: Pre-validated mining with tool harvest tier matching and sneak-placement on interactive containers.
   - Inventory & Crafting: Recursive ingredient resolution supporting 2x2 player inventory grid and 3x3 crafting tables.
   - Combat & Defense: Threat perception gated by line-of-sight, cooldown-timed swings, off-hand shield defense against arrows/creepers, and tactical retreat below $6$ HP.
   - Autonomous Survival Loops: Auto-eat (nutrition/saturation priority, poison blacklist), auto-sleep (night/thunderstorm check, monster clearing), auto-equip (composite armor defense scoring, off-hand shields).
6. *From Observation 2*: Integration testing can run 100% offline without live Mojang servers by using in-memory `prismarine-world` fixtures and EventEmitter protocol client stubs.

---

## 3. Caveats
1. Server-side custom modifications (e.g. custom plugins altering vanilla reach or custom items) are not assumed; the specification adheres strictly to standard vanilla Minecraft Java Edition survival mechanics.
2. Voice and Discord bridging specifications are handled by parallel surveyor `spec_miner_survey_1`; this report specifies the in-game gameplay agent engine and fair-play boundary.
3. Gemini tool calling schema mapping is handled by `explorer_survey_3`; this report provides the exported programmatic contracts (`IPerceptionService`, `IBlockInteractionService`, etc.) required for Gemini tool binding.

---

## 4. Conclusion
Requirement R2 has been fully investigated and specified with complete mathematical, algorithmic, and architectural rigor in:
`c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\spec_miner_survey_2\survey_report.md`

The specification includes:
- Complete anti-xray line-of-sight 3D raycasting algorithm and surface exposure filters.
- Strict $4.5$m block reach and $3.5$m entity reach validation algorithms.
- Prohibited command list and chat sanitizer architecture.
- Modular capabilities for pathfinding, block interaction, inventory, crafting, combat, and survival loops.
- 34 discovered and fully probed features in the required table format.
- 25 edge cases covering occlusion, crouching, reach thresholds, hazards, and crafting recipes.
- Offline, headless testing architecture using in-memory `prismarine-world` fixtures.

---

## 5. Verification Method
1. Inspect the generated specification report:
   - Path: `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\spec_miner_survey_2\survey_report.md`
   - Verify presence of Sections 1 through 9, including the `Features Discovered` (34 entries) and `Edge Cases` (25 entries) tables.
2. Verify package versions:
   - Run `npm.cmd view mineflayer version` $\implies 4.39.0$
   - Run `npm.cmd view mineflayer-pathfinder version` $\implies 2.4.5$
   - Run `npm.cmd view prismarine-world version` $\implies 3.7.0$
3. Invalidation Conditions:
   - If vanilla survival reach is proven to exceed 4.5 blocks without creative mode.
   - If Mineflayer removes `bot.canSeeBlock` or `world.raycast`.
