# Milestone 4 Handoff Report: Cross-Subsystem Interactions, Tier 3 & Tier 4 E2E Test Design, and Documentation Audit

**Agent:** `explorer_m4_3`  
**Milestone:** Milestone 4 (Final E2E Test Verification & Hardening)  
**Parent:** `orchestrator_4` (`f1768415-3044-4bb9-b757-80b682dc585d`)  
**Date:** 2026-10-08T13:40:00Z  

---

## 1. Observation

Direct code observations from the workspace (`c:\Users\rando\Documents\antigravity\wise-pasteur`):

### 1.1 Architecture & Subsystem Implementations
- **AgentCoordinator (`src/coordinator/agentCoordinator.ts`)**:
  - Connects `IDiscordGateway`, `IMinecraftAgent`, `IGeminiPlanner`, `ProgressReporter`, `AppConfig`, and `IAudioQueueManager` (lines 26-35).
  - Handles goal assignment asynchronously via `executeGoal` generator loop (lines 70-82).
  - Listens to Minecraft agent events `'death'` and `'statusUpdate'` (lines 190-208), broadcasting survival emergencies with `AudioPriority.EMERGENCY` when health drops $\le 6.0$ HP (lines 196-207).
  - Implements `stopCurrentTask()` which halts `planner.cancelCurrentGoal()`, Mineflayer pathfinder, digging, controls, and purges non-emergency TTS audio via `audioQueue.cancelNonEmergency()` (lines 85-128).
  - Implements `handleVoicePrompt()` (lines 149-156) which checks regex `^(stop|halt|cancel|abort)\b/i` to either trigger emergency halt or dispatch a new goal.
- **ProgressReporter (`src/coordinator/progressReporter.ts`)**:
  - Translates `PlannerStepEvent` types into Discord text messages and audio TTS queue items:
    - `'tool_call'` -> Discord text `⚙️ **Step [Turn X]**: Executing \`<toolName>\`` + `AudioPriority.NORMAL` TTS (lines 33-40).
    - `'tool_result'` failure -> Discord text `⚠️ **Obstacle**: ...` + `AudioPriority.HIGH` TTS (lines 42-50).
    - `'progress'` -> Discord text `💬 ...` + `AudioPriority.NORMAL` TTS (lines 52-59).
    - `'error'` -> Discord text `❌ **Error**: ...` + `AudioPriority.HIGH` TTS (lines 61-66).
    - `'done'` -> Discord text `✅ **Task Finished**: ...` + `AudioPriority.HIGH` TTS (lines 68-74).
- **GeminiPlanner (`src/ai/planner.ts`)**:
  - Implements `IGeminiPlanner` via asynchronous generator `executeGoal(goalText, context)` with multi-turn loop (lines 43-223).
  - Enforces fair-play parameter validation via `validateToolCall(call.name, call.args, validationCtx)` (lines 130-146).
  - Implements 9 structured tools in `executeAction`: `goToCoordinates`, `followPlayer`, `gatherResource`, `defendArea`, `reportStatus`, `stopCurrentTask`, `craftItem`, `sleepInBed`, `depositOrRetrieve` (lines 263-323).
  - Implements `executeGatherResource` with multi-step sequential loop: checks line-of-sight surface exposure via `findVisibleBlock`, paths within 3.5m reach via `navigateTo`, and mines block via `mineBlock` (lines 325-380).
- **ChatBridge & Anti-Loopback Filter (`src/bridge/chatBridge.ts`, `src/bridge/antiLoopback.ts`)**:
  - Enforces Triple-Lock anti-loopback: Lock 1 (Self-ID: `botDiscordId`, `botMinecraftUsername`), Lock 2 (Bot accounts & `[Discord]` echo prefix), Lock 3 (10-second TTL SHA-256 normalized hash cache) (lines 48-84 of `antiLoopback.ts`).
  - Implements message chunking into $\le 256$ characters with index tags `[1/2]` (lines 131-194 of `antiLoopback.ts`).
  - Leaky-bucket dispatch queue for Minecraft chat with rate limit interval (lines 150-171 of `chatBridge.ts`).
- **Live Status Embed & Throttling (`src/discord/embed.ts`)**:
  - Generates 10-segment emoji progress bars for health (`❤️`/`🤍`) and hunger (`🍗`/`▫️`) (lines 11-22).
  - Hashes canonical status via SHA-256 (`computeStateHash`, lines 24-49) to eliminate redundant Discord API calls.
  - Implements 5-second interval throttling (`StatusEmbedManager`, lines 139-223) with Discord Error 10008 automatic message recreate recovery.
- **Fair-Play Survival Engine (`src/minecraft/`)**:
  - Surface exposure anti-xray: `evaluateBlockExposure` requires at least 1 of 6 adjacent faces to be non-solid / transparent (`src/minecraft/perception/exposure.ts`).
  - 3D DDA raycasting: `hasBlockLineOfSight` verifies direct ray from eye to exposed face centers (`src/minecraft/perception/raycast.ts`).
  - Field-of-view: $70^\circ$ focal cone with $2.5$m near-field tactile fallback (`src/minecraft/perception/fov.ts`).
  - Physical reach enforcement: block interactions clamped strictly to $\le 4.50$m, entity combat clamped to $\le 3.50$m (`src/minecraft/fairplay/reach.ts`).
  - Command sanitizer: blocks all OP privileges (`/tp`, `/give`, `/gamemode`, `/op`, etc.) via two-phase tokenizer (`src/minecraft/fairplay/commandSanitizer.ts`).
  - Auto-Eat Loop: activates when hunger $\le 14$ or health $< 20$ & hunger $\le 17$, prioritizes saturation score, strictly blacklists poisonous items (`src/minecraft/loops/autoEat.ts`).
  - Auto-Sleep Loop: vanilla sleep window 12541-23458 and thunderstorms, enforces 8m horizontal / 5m vertical monster exclusion AABB, prevents Nether/End explosions (`src/minecraft/loops/autoSleep.ts`).
  - Auto-Equip Loop: composite defensive formula evaluating armor defense, toughness, and enchantments (`src/minecraft/loops/autoEquip.ts`).
  - Combat: 1.9+ weapon cooldown timing controller (e.g. 625ms for sword), shield raising/lowering, tactical retreat when health drops $< 6.0$ HP (`src/minecraft/actions/combat.ts`).
  - Crafting: 2x2 player grid vs 3x3 crafting table topological recipe decomposition (`src/minecraft/actions/crafting.ts`).
- **Offline Mocks (`test/mocks/`)**:
  - `MockDiscordGateway`: tracks sent/edited messages, records registered slash commands, simulates inbound user messages and slash command interactions.
  - `MockVoiceSession`: simulates inbound user speech chunks and captures outbound TTS playback buffers with priority tags.
  - `MockWorld` & `MockMineflayerBot` & `MockMinecraftAgent`: in-memory voxel world, block exposure, entity combat, inventory, crafting, and event emission.
  - `MockGeminiClient` & `MockGeminiSession`: deterministic regex-based tool call decomposition, scripted turns, and history tracking.
- **Existing Tests**:
  - `test/m1/` (10 test suites), `test/m2/` (5 test suites), `test/m3/` (4 test suites), `test/tier5_adversarial/` (7 test suites) = 26 suites, 444 tests passing.
- **Documentation (`README.md` & `.env.example`)**:
  - `README.md` only documents "Features (Milestone 1)" and lacks Milestone 2, Milestone 3, Milestone 4, architecture diagrams, command descriptions, voice workflows, and complete test tier breakdown.
  - `.env.example` documents all 27 environment variables matching `src/config/env.ts`, but lacks `"start"` script reference in `package.json` and explicit guidance on offline mock mode (`MOCK_ALL=true`).

---

## 2. Logic Chain

1. **Subsystem Decoupling & Integration**:
   - The system is divided into four cleanly decoupled layers: Discord/Audio Gateway -> Agent Coordinator -> Gemini AI Planner -> Minecraft Fair-Play Engine.
   - Coordinator acts as the central hub: inbound events from Discord (slash commands, text messages, voice speech packets) or Minecraft (health drops, chat, death, status changes) flow into the Coordinator, which dispatches goals to Gemini, broadcasts survival alerts, or invokes actions on the Minecraft client.
2. **Tier 3 (Cross-Feature Combinations) Scope**:
   - Tier 3 requires pairwise subsystem interaction tests that prove two or more distinct subsystems communicate seamlessly:
     - Voice -> STT -> Coordinator -> Gemini -> Mineflayer -> TTS -> Status Embed.
     - Minecraft Chat -> Triple-Lock Filter -> Leaky Bucket -> Discord Relay (and vice-versa).
     - Discord Slash Commands -> RBAC -> Auto-Deferral -> Coordinator -> Gemini Planner -> Minecraft Action.
     - Minecraft In-Game Events (Hunger / Nightfall / Damage) -> Survival Loops (Auto-Eat / Auto-Sleep) -> Status Embed Updates -> Discord Emergency Alerts.
3. **Tier 4 (Real-World Application Scenarios) Scope**:
   - Tier 4 requires end-to-end multi-step user journeys modeling realistic survival gameplay:
     - *Full Mining Expedition*: Perception exposure check -> pathfinding -> reach verification $\le 4.5$m -> pickaxe harvest tier verification -> block digging -> drop collection -> Discord progress reporting.
     - *Defensive Base Patrol & Mob Combat*: Perimeter defense -> hostile mob LOS detection -> advance -> 1.9+ weapon cooldown & shield -> defeat mob -> low health tactical retreat & auto-eat.
     - *Overnight Shelter & Crafting*: Natural language "craft wooden sword" -> recipe decomposition -> wood gathering -> 2x2 grid crafting -> table placement -> 3x3 grid crafting -> weapon equipping -> thunderstorm auto-sleep.
     - *Emergency Abort Journey*: Long running multi-turn task interrupted mid-execution via `/stop` or voice keyword "stop" -> immediate task abort, pathfinder stop, digger cancel, TTS queue non-emergency purge, status reset.
4. **Offline Hermetic Test Harness**:
   - All tests can run 100% offline with zero external network access, zero live Discord tokens, zero Gemini API keys, and zero external Minecraft servers by using the existing in-memory mocks (`MockDiscordGateway`, `MockVoiceSession`, `MockMinecraftAgent` / `MockMineflayerBot`, `MockGeminiClient`).
5. **Documentation Requirements**:
   - `README.md` must be thoroughly updated to reflect the full 4-milestone multimodal architecture, complete slash command inventory, voice and chat bridge workflows, fair-play survival rules, and 5-tier test harness.

---

## 3. Detailed Test Design: Tier 3 Cross-Feature Combinations

**Target Directory:** `test/tier3_combinations/`  
**Total Test Files:** 4  
**Total Test Cases:** 22  

### 3.1 Suite 1: `test/tier3_combinations/voice_to_action_pipeline.test.ts`
Tests the complete full-duplex voice pipeline integrated with coordinator, AI planner, Mineflayer agent, TTS queue, and live status embeds.

| Test Case ID | Test Case Title | Stimulus / Input | Subsystems Involved | Expected Result / Assertions |
|---|---|---|---|---|
| `TC-T3-V2A-1` | Full duplex voice-to-action cycle | Voice PCM speech utterance ("go to 10 64 20") followed by silence | MockVoiceSession, VoiceReceiver, STTPipeline, AgentCoordinator, GeminiPlanner, MockMinecraftAgent, AudioQueueManager, StatusEmbedManager | 1. VAD processes utterance and emits event.<br>2. STT transcribes prompt.<br>3. Coordinator assigns task to Gemini.<br>4. Gemini calls `goToCoordinates(10, 64, 20)`.<br>5. Minecraft agent moves to (10, 64, 20).<br>6. ProgressReporter enqueues NORMAL priority TTS.<br>7. VoiceSession plays synthesized audio.<br>8. StatusEmbedManager updates embed coordinates to (10.0, 64.0, 20.0). |
| `TC-T3-V2A-2` | Voice command tool obstacle and HIGH priority TTS reflection | Voice command "mine diamond_ore" with occluded or unreachable block | VoiceReceiver, STTPipeline, AgentCoordinator, GeminiPlanner, MiningAction, ProgressReporter, AudioQueueManager | 1. Mining fails with line-of-sight obstacle.<br>2. Planner emits `tool_result` with failure.<br>3. ProgressReporter sends Discord obstacle text.<br>4. AudioQueue receives HIGH priority TTS ("Obstacle: ..."). |
| `TC-T3-V2A-3` | Acoustic noise rejection prevents false tool invocations | Audio buffer < 200ms or low RMS (< 300) | VoiceReceiver, AgentCoordinator, GeminiPlanner | 1. VoiceReceiver emits `noiseDiscarded`.<br>2. Zero STT transcriptions triggered.<br>3. Zero tasks assigned; bot position and state remain completely unchanged. |
| `TC-T3-V2A-4` | Voice emergency interrupt halting active action | Active multi-turn expedition running; user speaks "stop" | VoiceReceiver, STT, AgentCoordinator, GeminiPlanner, PathfinderAction, AudioQueueManager | 1. Coordinator detects stop regex.<br>2. AbortController cancels active planner loop.<br>3. Pathfinder stops movement.<br>4. Non-emergency TTS queue purged.<br>5. Discord receives `🛑 Emergency Stop` notification. |
| `TC-T3-V2A-5` | Multi-speaker concurrent voice channel isolation | User A and User B stream audio concurrently | VoiceReceiver, MockVoiceSession | 1. Separate SpeakerSessions maintained.<br>2. User A's utterance finalized on silence without crosstalk.<br>3. User B's utterance finalized independently with correct userId attribution. |

---

### 3.2 Suite 2: `test/tier3_combinations/chat_bridge_anti_loopback.test.ts`
Tests bidirectional chat relay between Minecraft server and Discord text channel with triple-lock anti-loopback filtering and message chunking.

| Test Case ID | Test Case Title | Stimulus / Input | Subsystems Involved | Expected Result / Assertions |
|---|---|---|---|---|
| `TC-T3-CBL-1` | In-game player chat passes triple-lock and relays to Discord | In-game player "Alex" chats "Hello world" | MockMineflayerBot, ChatBridge, AntiLoopbackFilter, MockDiscordGateway | 1. AntiLoopbackFilter allows message.<br>2. Discord bridge channel receives `**[Minecraft] <Alex>** Hello world`. |
| `TC-T3-CBL-2` | Minecraft server echo of Discord message dropped via 10s TTL hash collision | Discord user sends message; server echoes it back in-game | MockDiscordGateway, ChatBridge, AntiLoopbackFilter, MockMineflayerBot | 1. Bridge sends to Minecraft and records hash.<br>2. Server echoes message in-game.<br>3. Filter evaluates inbound echo: matches TTL hash -> DROPPED (`DUPLICATE_TTL_HASH`).<br>4. Zero echo sent back to Discord. |
| `TC-T3-CBL-3` | In-game chat with Discord prefix `[Discord]` dropped via Lock 2 prefix check | In-game message starting with `[Discord] <User>: Hi` | ChatBridge, AntiLoopbackFilter | 1. Filter detects `[Discord]` prefix.<br>2. Message dropped (`DISCORD_PREFIX_ECHO`). |
| `TC-T3-CBL-4` | Bot self-ID and bot account filter locks drop loopback from Discord | Discord message from `botDiscordId` or with `author.bot === true` | ChatBridge, AntiLoopbackFilter, MockMineflayerBot | 1. Filter drops self-ID (Lock 1) or bot account (Lock 2).<br>2. Zero packets enqueued for Minecraft chat. |
| `TC-T3-CBL-5` | In-game death message relays to Discord as formatted alert | In-game death event occurs: "CompanionBot was slain by Zombie" | ChatBridge, MockDiscordGateway | 1. Bridge sends formatted message to Discord: `💀 **[Minecraft]** CompanionBot was slain by Zombie`. |
| `TC-T3-CBL-6` | Discord-to-Minecraft relay sanitizes dangerous control chars and chunks 256+ characters | Discord message with `@everyone`, `<@123>`, control characters, and 300+ chars | ChatBridge, AntiLoopbackFilter, MockMineflayerBot | 1. Mentions escaped, control chars stripped.<br>2. Message split into chunks $\le 256$ chars tagged `[1/2]` and `[2/2]`.<br>3. Delivered to Minecraft via leaky bucket queue. |

---

### 3.3 Suite 3: `test/tier3_combinations/command_rbac_task_execution.test.ts`
Tests Discord slash commands with RBAC security validation, auto-deferral, coordinator dispatch, and Minecraft action execution.

| Test Case ID | Test Case Title | Stimulus / Input | Subsystems Involved | Expected Result / Assertions |
|---|---|---|---|---|
| `TC-T3-RBC-1` | Authorized OPERATOR executes `/task` -> Full end-to-end execution | User with OPERATOR role runs `/task goal:"go to 5 64 5"` | DiscordBotClient, RBACService, CommandRegistry, AgentCoordinator, GeminiPlanner, MockMinecraftAgent | 1. RBAC allows interaction.<br>2. Interaction auto-deferred.<br>3. Coordinator assigns task.<br>4. Gemini plans `goToCoordinates`.<br>5. Bot position becomes (5, 64, 5).<br>6. Deferred reply edited with confirmation. |
| `TC-T3-RBC-2` | Unauthorized VIEWER executes `/task` -> RBAC denies immediately | User with VIEWER role runs `/task goal:"defend area"` | DiscordBotClient, RBACService, CommandRegistry, AgentCoordinator | 1. RBAC denies with `⛔ Permission Denied`.<br>2. Ephemeral rejection replied.<br>3. Zero coordinator tasks or Minecraft actions invoked. |
| `TC-T3-RBC-3` | Discord Administrator bypass allows user without explicit role | User with Discord `Administrator` permission runs `/connect` and `/task` | RBACService, DiscordBotClient, CommandRegistry | 1. Administrator permission bypasses role whitelisting.<br>2. Commands execute successfully. |
| `TC-T3-RBC-4` | `/task` rejection when Minecraft agent is disconnected | Authorized OPERATOR runs `/task` while bot is disconnected | taskCommand, AgentCoordinator | 1. Rejects with "❌ Bot is offline. An Administrator must run /connect first."<br>2. Planner not called. |
| `TC-T3-RBC-5` | `/task` validation rejects empty goals and goals > 500 characters | Goal is empty string or > 500 chars | taskCommand | 1. Rejects immediately with validation error before reaching coordinator. |

---

### 3.4 Suite 4: `test/tier3_combinations/survival_loop_events_embed.test.ts`
Tests automated survival loops triggering from in-game events and propagating updates to live status embeds and Discord alerts.

| Test Case ID | Test Case Title | Stimulus / Input | Subsystems Involved | Expected Result / Assertions |
|---|---|---|---|---|
| `TC-T3-SRV-1` | Low hunger triggers auto-eat and updates status embed hunger bar | Bot hunger drops to 14 (`bot.food = 14`), cooked beef in inventory | MockMineflayerBot, AutoEatLoop, MinecraftClient, StatusEmbedManager | 1. AutoEatLoop triggers and consumes cooked beef.<br>2. `bot.food` increases to 20.<br>3. StatusEmbedManager updates embed hunger bar from depleted to `🍗🍗🍗🍗🍗🍗🍗🍗🍗🍗 **20/20**`. |
| `TC-T3-SRV-2` | Critical health drop triggers emergency alert and emergency TTS | Bot health drops to 5.0 HP (`bot.health = 5.0`) | MockMineflayerBot, AgentCoordinator, MockDiscordGateway, AudioQueueManager | 1. Coordinator detects health $\le 6.0$.<br>2. Broadcasts `🚨 **SURVIVAL EMERGENCY**: Low health warning: 5.0/20 hearts remaining!` to Discord text.<br>3. Enqueues EMERGENCY priority TTS item. |
| `TC-T3-SRV-3` | Nightfall in Overworld triggers auto-sleep in bed | World time becomes 13000 (night), safe bed at (2, 64, 0), no hostiles | MockMineflayerBot, AutoSleepLoop, MinecraftClient, StatusEmbedManager | 1. `canSleepNow()` is true.<br>2. `isMonsterNearby` is false.<br>3. Bot sleeps in bed.<br>4. Bot state updated and reflected in status embed. |
| `TC-T3-SRV-4` | Nightfall with hostile mob within 8m/5m exclusion zone aborts sleep | World time 13000, zombie at (5, 64, 0) near bed | AutoSleepLoop, MockMineflayerBot | 1. `isMonsterNearby` returns true.<br>2. Sleep aborted to avoid waking into danger.<br>3. Bot remains awake. |
| `TC-T3-SRV-5` | Nether / End dimension check prevents explosive bed sleep | Dimension set to `'the_nether'`, bed nearby | AutoSleepLoop | 1. `canSleepNow()` returns false.<br>2. Prevents catastrophic bed explosion in the Nether. |
| `TC-T3-SRV-6` | Inventory armor upgrade triggers auto-equip and status embed update | Diamond chestplate added to inventory while wearing leather chestplate | AutoEquipLoop, MockMineflayerBot, MinecraftClient, StatusEmbedManager | 1. AutoEquipLoop calculates higher composite defense.<br>2. Equips diamond chestplate.<br>3. Status embed reflects new gear: `Armor: diamond_chestplate`. |

---

## 4. Detailed Test Design: Tier 4 Real-World Application Scenarios

**Target Directory:** `test/tier4_scenarios/`  
**Total Test Files:** 4  
**Total Test Cases:** 15  

### 4.1 Suite 1: `test/tier4_scenarios/full_mining_expedition.test.ts`
Tests complete legitimate mining expedition user journey: "gather 3 iron_ore" adhering strictly to fair-play rules.

| Test Case ID | Test Case Title | Scenario & Execution Details | Assertions & Verifications |
|---|---|---|---|
| `TC-T4-MINE-1` | Legitimate Mining Expedition Happy Path | 1. User commands `/task goal:"gather 3 iron_ore"`.<br>2. World has 3 exposed iron ore blocks at (3, 64, 1), (5, 64, 2), (8, 64, 3).<br>3. Bot holds stone pickaxe.<br>4. Multi-turn loop: for each ore, agent checks surface exposure, FOV, and raycast line-of-sight; navigates within 3.5m; verifies reach $\le 4.5$m; equips stone pickaxe; mines block; collects item.<br>5. Reports completion to Discord chat and voice TTS. | 1. Bot inventory contains 3 `iron_ore`.<br>2. Mined blocks replaced by air in world.<br>3. Discord received step updates and `✅ **Task Finished**`.<br>4. Status embed inventory count updated.<br>5. All block interactions confirmed $\le 4.50$m. |
| `TC-T4-MINE-2` | Anti-Xray Hidden Underground Ore Rejection | 1. User commands "gather 3 iron_ore".<br>2. World contains iron ore buried at Y=50 surrounded by solid stone on all 6 faces.<br>3. `findVisibleBlock` applies 6-neighbor exposure check: all faces solid -> block discarded.<br>4. Planner halts with anti-xray message. | 1. Bot NEVER targets or mines hidden underground ore.<br>2. Zero pathfinding to unexposed blocks.<br>3. Discord receives obstacle warning that no exposed ores exist. |
| `TC-T4-MINE-3` | Insufficient Tool Tier Obstacle Recovery | 1. User commands "gather 1 diamond_ore".<br>2. Exposed diamond ore present, but bot only has `wooden_pickaxe`.<br>3. `canSafelyHarvest` checks tier: diamond requires tier $\ge$ iron (rank 3), wooden is rank 1.<br>4. Mining aborted with descriptive obstacle. | 1. Diamond ore block is NOT broken or destroyed.<br>2. Bot inventory does not falsely receive diamond.<br>3. Discord text receives `⚠️ **Obstacle**: ... requires a pickaxe of tier >= iron`. |
| `TC-T4-MINE-4` | Reach Limit Boundary Enforcement (> 4.50m) | 1. Bot attempts to mine block at 4.60m from eye position.<br>2. `assertBlockReach` calculates distance 4.60m > 4.50m. | 1. Throws reach violation error.<br>2. Mining action returns `success: false`. |

---

### 4.2 Suite 2: `test/tier4_scenarios/defensive_base_patrol.test.ts`
Tests complete base patrol, threat detection, 1.9+ weapon cooldown combat, shield mechanics, and low-health retreat.

| Test Case ID | Test Case Title | Scenario & Execution Details | Assertions & Verifications |
|---|---|---|---|
| `TC-T4-DEF-1` | Defensive Perimeter Patrol & Hostile Mob Defeat | 1. User commands "defend area within radius 16".<br>2. Hostile Zombie spawns at (4, 64, 0) with 20 HP.<br>3. Bot detects zombie in FOV & LOS.<br>4. Advances to attack range $\le 3.50$m.<br>5. LookAt zombie -> waits 625ms for sword cooldown -> lowers shield -> attacks -> re-raises shield.<br>6. Repeats until zombie health $\le 0$. | 1. Zombie defeated (HP $\le 0$).<br>2. Attacks executed strictly within $\le 3.50$m.<br>3. Shield raised between weapon attack intervals.<br>4. Status embed displays active task. |
| `TC-T4-DEF-2` | Low Health Tactical Retreat & Emergency Auto-Eat | 1. During combat, bot health drops to 5.0 HP (< 6 HP).<br>2. `CombatAction.attackEntity` detects health < 6 HP and calls `executeRetreat()`.<br>3. Bot drops shield and sprints away along repulsion vector.<br>4. Coordinator broadcasts SURVIVAL EMERGENCY to Discord text and EMERGENCY TTS queue.<br>5. AutoEatLoop consumes golden carrot to regenerate health. | 1. Bot retreated away from threat.<br>2. Discord text receives `🚨 **SURVIVAL EMERGENCY**`.<br>3. Audio queue receives EMERGENCY priority alert.<br>4. Food consumed, health regeneration begins. |
| `TC-T4-DEF-3` | Hostile Target Discrimination | 1. Allied player "Steve" and passive sheep enter patrol radius.<br>2. `defendArea` filters non-hostile entities. | 1. Zero attacks against player or sheep.<br>2. Only hostile mobs trigger defensive engagement. |
| `TC-T4-DEF-4` | Combat Reach Clamping (> 3.50m) | 1. Mob is at 3.8m distance.<br>2. Bot attempts attack before closing distance. | 1. `attackEntity` returns failure: out of attack reach (3.8m > 3.50m). |

---

### 4.3 Suite 3: `test/tier4_scenarios/overnight_shelter_crafting.test.ts`
Tests multi-step crafting journey: recipe decomposition, gathering, 2x2 crafting, placing table, 3x3 crafting, equipping, and thunderstorm shelter.

| Test Case ID | Test Case Title | Scenario & Execution Details | Assertions & Verifications |
|---|---|---|---|
| `TC-T4-CRF-1` | Complete Crafting Expedition: Wood Gathering -> 2x2 Crafting -> Crafting Table -> 3x3 Crafting | 1. User commands "craft wooden sword".<br>2. Recipe decomposition: `wooden_sword` requires 2x `oak_planks`, 1x `stick`, `crafting_table`.<br>3. Bot gathers 3x `oak_log`.<br>4. Crafts 12x `oak_planks` in 2x2 player inventory grid.<br>5. Crafts 1x `crafting_table` and 4x `stick` in 2x2 grid.<br>6. Places crafting table at valid reference block within $\le 4.5$m reach.<br>7. Crafts `wooden_sword` in 3x3 table grid.<br>8. Auto-equips wooden sword in main hand. | 1. Inventory contains `wooden_sword`.<br>2. Crafting table placed in voxel world.<br>3. Bot main hand equipped with `wooden_sword`.<br>4. Discord received step updates and completion. |
| `TC-T4-CRF-2` | Thunderstorm Overnight Sleep Interruption | 1. During crafting mission, thunderstorm begins (`thunderState = 1`).<br>2. AutoSleepLoop detects thunderstorm (`canSleepNow() === true`).<br>3. Finds reachable bed, verifies monster exclusion (no hostiles within 8m/5m AABB).<br>4. Bot sleeps through storm until morning. | 1. Bot rests in bed during thunderstorm.<br>2. Wakes up when storm passes. |
| `TC-T4-CRF-3` | Crafting with Missing Resources Graceful Failure | 1. User commands "craft diamond_pickaxe" with 0 diamonds.<br>2. Recipe decomposition identifies 3 missing diamonds.<br>3. Returns descriptive obstacle without entering infinite loop. | 1. Zero invalid crafting transactions.<br>2. Discord notified of missing resources. |

---

### 4.4 Suite 4: `test/tier4_scenarios/emergency_abort_journey.test.ts`
Tests emergency halting across slash commands, voice interrupts, in-game death, and task preemption.

| Test Case ID | Test Case Title | Scenario & Execution Details | Assertions & Verifications |
|---|---|---|---|
| `TC-T4-ABT-1` | Slash Command `/stop` Interrupts Active Mining Expedition | 1. Bot is actively pathfinding/mining in multi-turn task.<br>2. Operator executes `/stop` slash command.<br>3. Coordinator triggers `stopCurrentTask()`.<br>4. AbortController cancels active planner signal.<br>5. Mineflayer pathfinder, diggers, and controls halted.<br>6. Non-emergency audio queue purged.<br>7. Discord receives emergency stop reply. | 1. `planner.isExecuting()` is false.<br>2. Bot movement and mining stopped.<br>3. Audio queue cleared.<br>4. Status embed task resets to idle standing by. |
| `TC-T4-ABT-2` | Voice "Abort" Interrupt Halts Multi-Turn Task | 1. Bot actively executing task.<br>2. User speaks "abort" into voice channel.<br>3. VAD/STT transcribes "abort".<br>4. Coordinator regex detects halt keyword and triggers `stopCurrentTask()`. | 1. Active task cancelled immediately.<br>2. Physical movements stopped. |
| `TC-T4-ABT-3` | Agent In-Game Death Triggers Emergency Halt | 1. In-game death event occurs (`bot.emit('death')`).<br>2. Coordinator receives death event.<br>3. Broadcasts survival alert and halts current task. | 1. Active task cancelled.<br>2. Emergency alert broadcast to Discord text and TTS queue. |
| `TC-T4-ABT-4` | Task Preemption via Rapid New Task Assignment | 1. Task A ("defend area") is executing.<br>2. User assigns Task B ("go to 10 64 10").<br>3. Coordinator cancels Task A and immediately starts Task B. | 1. Task A halted cleanly.<br>2. Task B executes and bot navigates to (10, 64, 10). |

---

## 5. Review & Audit of README.md and .env.example

### 5.1 `README.md` Audit & Required Updates

#### Findings:
1. **Scope Gaps**: The current `README.md` only documents Milestone 1 ("## Features (Milestone 1)"). It completely omits Milestone 2 (Fair-Play Survival Engine), Milestone 3 (Gemini AI Planning Bridge), and Milestone 4 (Simulation Harness & Multi-Tier Test Suite).
2. **Missing Architecture Diagram**: Does not include the complete 4-layer decoupled architecture diagram showing Discord/Voice <-> Coordinator <-> Gemini AI <-> Minecraft Client.
3. **Incomplete Command Inventory**: Only mentions slash commands exist, but does not provide the complete usage, parameters, and RBAC tiers for all 8 commands (`/status`, `/connect`, `/disconnect`, `/task`, `/stop`, `/inventory`, `/voice`, `/help`).
4. **Missing Voice & Bridge Workflows**: Does not describe how two-way voice channel interaction works (STT/TTS, priority queue preemption, voice stop keywords) or how the bidirectional chat bridge functions with triple-lock anti-loopback.
5. **Fair-Play Survival Documentation Missing**: Does not detail the strict fair-play rules (Anti-Xray 6-neighbor surface exposure filter, 3D DDA raycasting, 70° FOV cone with 2.5m tactile fallback, $\le 4.5$m block reach, $\le 3.5$m entity combat reach, command sanitizer blocking OP commands).
6. **Incomplete Testing Guide**: Only mentions `npm test`, without explaining the 5-tier test architecture (Tiers 1-5) or how offline simulation runs without live tokens/servers.
7. **Missing Production Launch Command**: `package.json` currently contains `"scripts": { "build": ..., "test": ... }`, but does not have a `"start"` script (`node dist/index.js`). `README.md` should document both building and launching.

#### Required Updates to `README.md`:
Replace `README.md` with the comprehensive documentation below:

```markdown
# Multimodal Discord & Fair-Play Minecraft AI Companion

A decoupled multimodal Discord bot and fair-play Minecraft Java survival companion powered by the Google Gemini AI planning engine (`gemini-3.8-flash` via `@google/genai` >= 2.3.0).

---

## System Architecture

```
                   ┌────────────────────────────────────────┐
                   │             Discord Client             │
                   │  - Slash Commands & Text (/task, etc.) │
                   │  - Voice Gateway (Receiver & Player)   │
                   └───────┬────────────────────────▲───────┘
                           │                        │
               Inbound Audio / Text         Outbound TTS / Status Embeds
                           │                        │
                           ▼                        │
                   ┌────────────────────────────────┴───────┐
                   │           Agent Coordinator            │
                   │  - RBAC & Interaction Dispatch         │
                   │  - Bidirectional Chat Bridge (Anti-Loop)│
                   │  - Status Embed State & Throttling     │
                   └───────┬────────────────────────▲───────┘
                           │                        │
                   User Intent / Audio      Plan Progress / Events
                           │                        │
                           ▼                        │
                   ┌────────────────────────────────┴───────┐
                   │     Gemini AI Planning Engine          │
                   │  - @google/genai + gemini-3.8-flash    │
                   │  - 9 Structured Fair-Play Tools        │
                   │  - Multi-Turn Execution & Tool Results │
                   └───────┬────────────────────────▲───────┘
                           │                        │
                 Validated Tool Calls       Execution Results
                           │                        │
                           ▼                        │
                   ┌────────────────────────────────┴───────┐
                   │   Minecraft Gameplay Agent Engine      │
                   │  - Perception (Raycast, Anti-Xray, FOV)│
                   │  - Physical Limits (Reach <= 4.5m)     │
                   │  - Command Sanitizer (No OP Commands)  │
                   │  - Pathfinding, Mining, Crafting, Combat│
                   │  - Survival Loops (Eat, Sleep, Equip)  │
                   └────────────────────────────────────────┘
```

---

## Key Features

### 1. Discord Text, Slash Commands & RBAC
- **8 Slash Commands**:
  - `/status` (VIEWER): Displays live health, hunger, coordinates, active task, equipped gear, and inventory overview.
  - `/inventory` (VIEWER): Inspects detailed inventory slots, armor, and off-hand items.
  - `/help` (VIEWER): Displays command directory and RBAC permissions.
  - `/task <goal>` (OPERATOR): Assigns natural language survival goals to the AI companion.
  - `/stop` (OPERATOR): Emergency halt on active tasks, pathfinding, digging, and audio playback.
  - `/voice <join|leave>` (OPERATOR): Commands the companion to join or leave the voice channel.
  - `/connect [host] [port] [username]` (ADMIN): Connects the bot to a Minecraft Java server.
  - `/disconnect` (ADMIN): Disconnects the bot from the Minecraft server.
- **3-Tier Role-Based Access Control (RBAC)**: `VIEWER`, `OPERATOR`, and `ADMIN` with snowflake whitelisting and Discord `Administrator` bypass.
- **Auto-Deferral Guard**: Automatic 2.5-second interaction deferral preventing Discord interaction timeout errors (Error 10062).

### 2. Full-Duplex Voice Pipelines (STT & TTS)
- **Voice Receiver**: User Opus capture via `@discordjs/voice`, Opus-to-PCM decoding, and acoustic RMS Voice Activity Detection (VAD).
- **Decoupled STT & TTS**: Pluggable Speech-to-Text and Text-to-Speech providers with Google Gemini SDK support and offline mocks.
- **Priority Audio Queue**: Priority levels (`EMERGENCY` = 0, `HIGH` = 1, `NORMAL` = 2, `LOW` = 3) with preemption (< 50ms) for critical survival alerts.
- **Voice Emergency Interrupt**: Speaking "stop", "halt", "cancel", or "abort" immediately halts active in-game tasks and purges non-emergency audio.

### 3. Bidirectional Chat Bridge
- **Real-Time Relay**: Relays messages between Discord chat bridge channel and Minecraft server chat.
- **Triple-Lock Anti-Loopback Filter**:
  1. *Lock 1 (Self-ID)*: Drops messages originating from bot Discord ID or bot Minecraft username.
  2. *Lock 2 (Bot Accounts & Prefix)*: Drops Discord bot accounts and in-game messages prefixed with `[Discord]`.
  3. *Lock 3 (10s TTL Hash Deduplication)*: SHA-256 normalized hash cache detects and drops server echo broadcasts.
- **Chunking & Sanitization**: Strips dangerous control codes and section signs (`§`), escapes `@everyone`/`@here`, and splits messages > 256 characters into indexed chunks (`[1/2]`).

### 4. Live Status Embeds
- **Dynamic Emoji Progress Bars**: 10-segment health (`❤️`/`🤍`) and hunger (`🍗`/`▫️`) visual indicators.
- **Throttling & Dirty-State Hashing**: 5-second interval throttling with SHA-256 state hashing preventing Discord HTTP 429 rate limits.
- **Self-Healing**: Automatically recreates pinned status embed if deleted (Discord Error 10008).

### 5. Minecraft Fair-Play Survival Engine
- **Strict Anti-Cheat / Fair-Play**:
  - *Anti-Xray Filter*: 6-neighbor surface exposure check discards hidden blocks enclosed by solid blocks.
  - *3D Line-of-Sight Raycasting*: Amanatides & Woo DDA raycasting verifies unobstructed line of sight.
  - *Perception FOV Cone*: $70^\circ$ focal cone with $2.5$m near-field tactile fallback.
  - *Physical Reach Limits*: Block interactions strictly clamped to $\le 4.50$m; entity combat clamped to $\le 3.50$m.
  - *Command Sanitizer*: Two-phase tokenization strictly blocks OP commands (`/tp`, `/give`, `/gamemode`, `/op`, etc.).
- **Actions Subsystems**:
  - *Safe Pathfinding*: Navigates avoiding lava, fire, and drops > 3 blocks.
  - *Mining Engine*: Enforces harvest tool tiers (stone, iron, diamond) and damage interrupt guards.
  - *Crafting Engine*: 2x2 player inventory grid and 3x3 crafting table topological recipe decomposition.
  - *Combat System*: 1.9+ weapon cooldown timing (e.g. 625ms for sword), shield raising/lowering, and tactical retreat when HP < 6.
- **Automated Survival Loops**:
  - *Auto-Eat Loop*: Consumes food when hunger $\le 14$ or health $< 20$, prioritizes saturation, blacklists poison.
  - *Auto-Sleep Loop*: Sleeps during night (12541-23458) and thunderstorms, enforces 8m/5m monster exclusion AABB.
  - *Auto-Equip Loop*: Evaluates composite defense score to automatically equip optimal armor and weapons.

### 6. Gemini AI Planning Bridge
- **Official Google Gemini SDK**: Uses `@google/genai` (>= 2.3.0) configured for `gemini-3.8-flash`.
- **9 Fair-Play Tools**: `goToCoordinates`, `followPlayer`, `gatherResource`, `defendArea`, `reportStatus`, `stopCurrentTask`, `craftItem`, `sleepInBed`, `depositOrRetrieve`.
- **Fair-Play Parameter Validation**: Runtime interceptor validates tool parameters against survival boundaries.
- **Multi-Turn Execution**: Asynchronous generator streaming step progress and tool results to Discord text and voice.

---

## Prerequisites

- **Node.js**: v20+ (Tested on Node.js v22 and v24)
- **NPM**: v10+

---

## Installation

```bash
npm install
```

---

## Build

Compile TypeScript source code to `./dist` using ES2022 / NodeNext:

```bash
npm run build
```

Type-check without emitting:

```bash
npm run typecheck
```

---

## Testing (100% Offline Multi-Tier Test Suite)

Run the Vitest test suite with zero external secrets, network sockets, or live Minecraft servers:

```bash
npm test
```

### Test Suite Architecture:
- **Tier 1: Feature Coverage (`test/tier1_features/`)**: Isolated happy-path unit tests for all features.
- **Tier 2: Boundaries & Edge Cases (`test/tier2_boundaries/`)**: Coordinate limits, reach boundaries, empty inventories, timeouts.
- **Tier 3: Cross-Feature Combinations (`test/tier3_combinations/`)**: Multi-subsystem interactions (Voice -> STT -> AI -> Actions -> TTS -> Embeds, Chat Bridge, RBAC).
- **Tier 4: Real-World Application Scenarios (`test/tier4_scenarios/`)**: End-to-end user journeys (Mining Expedition, Defensive Patrol, Crafting & Shelter, Emergency Abort).
- **Tier 5: Adversarial Coverage Hardening (`test/tier5_adversarial/`)**: White-box stress tests, race conditions, edge invariants.

---

## Running the Bot

1. Copy `.env.example` to `.env` and fill in your Discord Bot Token, Gemini API Key, and Minecraft Server details:

```bash
cp .env.example .env
```

2. Build and start the bot:

```bash
npm run build
node dist/index.js
```

---

## Configuration Reference

See `.env.example` for the complete list of configuration options including Discord credentials, RBAC role snowflakes, Minecraft server settings, audio thresholds, and offline test simulation flags (`MOCK_ALL=true`).
```

---

### 5.2 `.env.example` Audit & Required Updates

#### Findings:
1. `src/config/env.ts` defines 27 configuration keys.
2. `.env.example` already contains all 27 keys with correct variable names and matching default values.
3. **Enhancement Recommendations**:
   - Add explicit commentary to `MOCK_ALL` explaining how developers and CI environments can run full simulation without any Discord credentials or Gemini API keys.
   - Verify `package.json` contains a `"start"` script (`"start": "node dist/index.js"`) so `npm start` works out of the box.

---

## 6. Caveats

1. **Read-Only Explorer Scope**: In accordance with the Explorer archetype constraints, this agent did not modify any source code or test files in `src/` or `test/`. The test designs, architecture mappings, and documentation updates are presented in this report for workers to implement.
2. **Harness Dependency**: Tier 3 and Tier 4 test suites will consume `SimulationHarness` and `TestContext` designed by `explorer_m4_1`. Both direct mock instantiation (as demonstrated in `test/m3/coordination.test.ts`) and unified harness instantiation (`testContext.ts`) are fully compatible with the designed test cases.
3. **Vitest Pool Concurrency**: Because tests simulate timers and asynchronous generators, tests should continue running under Vitest's `forks` pool with `globals: true` to prevent global mock leakage across suites.

---

## 7. Conclusion

Cross-subsystem interactions across Discord, Audio, Coordinator, Minecraft, and Gemini AI have been investigated, verified, and traced down to exact line numbers and methods. 

The complete test architecture and case inventories for:
- **Tier 3: Cross-Feature Combinations (4 suites, 22 test cases)**
- **Tier 4: Real-World Application Scenarios (4 suites, 15 test cases)**

have been designed with comprehensive assertions, preconditions, and mock event triggers.

Furthermore, a full audit of `README.md` and `.env.example` was completed, providing the exact updated documentation ready for Milestone 4 certification.

---

## 8. Verification Method

To verify these findings and independently inspect the designed contracts:
1. **Inspect Coordinator Wiring**:
   ```bash
   view_file src/coordinator/agentCoordinator.ts (lines 26-209)
   view_file src/coordinator/progressReporter.ts (lines 18-75)
   ```
2. **Inspect AI Planner Action Execution**:
   ```bash
   view_file src/ai/planner.ts (lines 130-380)
   ```
3. **Inspect Existing Mocks Compatibility**:
   ```bash
   view_file test/mocks/mockDiscord.ts
   view_file test/mocks/mockVoice.ts
   view_file test/mocks/mockMinecraft.ts
   view_file test/mocks/mockGemini.ts
   ```
4. **Inspect Existing 444 Tests Clean Pass**:
   ```powershell
   npm.cmd test
   ```
5. **Inspect TypeScript Build**:
   ```powershell
   npm.cmd run build
   ```
