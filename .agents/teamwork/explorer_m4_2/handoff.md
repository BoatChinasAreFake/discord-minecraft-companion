# Milestone 4: Tier 1 & Tier 2 Test Architecture & Case Inventory Specification

## 1. Observation

Direct observations from the codebase investigation:

1. **Current Test Status & Build**:
   - Running `cmd /c npm test` executed 26 test files with 444 passed tests (444/444 passed, 100% pass rate in 2.69s).
   - Running `cmd /c npm run build` (`tsc -p tsconfig.json`) compiled cleanly with 0 TypeScript diagnostics or errors.
   - Vitest configuration in `vitest.config.ts:7` specifies: `include: ['test/**/*.test.ts']`, `pool: 'forks'`, `testTimeout: 15000`, `globals: true`.
2. **Feature Inventory (PROJECT.md:51-103)**:
   - Features F01 to F43 span 4 core subsystems:
     - Discord Subsystem (F01–F08, F13–F17): slash commands (`/status`, `/connect`, `/disconnect`, `/task`, `/stop`, `/inventory`, `/voice`, `/help`), 2.5s auto-deferral, voice session manager, Opus decoding & VAD, STT/TTS pipeline, priority audio queue with preemption, live status embeds, 5s throttling, RBAC (VIEWER, OPERATOR, ADMIN).
     - Bridge Subsystem (F09–F12): Discord<->Minecraft chat relay, 3-lock anti-loopback filter (bot self-ID, bot account flag, 10s TTL hash deduplication), 256-char chunking and control character sanitization.
     - Minecraft Agent Subsystem (F18–F34): connection lifecycle with backoff jitter, 6-neighbor surface exposure filter, Amanatides & Woo 3D DDA raycasting, 70° FOV cone with 2.5m tactile fallback, reach enforcers ($\le 4.50$m block, $\le 3.50$m entity), command sanitizer (OP command blocking), pathfinding navigation, mining with harvest tiers, 2x2/3x3 crafting, 1.9+ combat cooldown & shield blocking, survival loops (auto-eat, auto-sleep, auto-equip).
     - Gemini AI Planner Subsystem (F35–F42): `@google/genai` (>= 2.3.0) client for `gemini-3.8-flash`, 9 structured fair-play tools, fair-play argument validator, multi-turn plan execution generator, progress reporting, task abort handling, deterministic regex mock.
3. **Mock Capabilities & Infrastructure (`test/mocks/`)**:
   - `MockDiscordGateway` (`test/mocks/mockDiscord.ts:20-162`): Simulates command dispatch, user text messages (`simulateUserMessage`), message deletion (`simulateDeleteMessage`), embed tracking, and voice sessions.
   - `MockVoiceSession` (`test/mocks/mockVoice.ts:12-128`): Simulates inbound user Opus/PCM audio streams (`simulateUserSpeaking`, `simulateUserSilence`) and captures outbound TTS playback buffers (`playedRecordings`).
   - `MockWorld` & `MockMineflayerBot` (`test/mocks/mockMinecraft.ts:76-533`): Voxel grid with arbitrary block placement (`setBlock`, `loadBox`, `createFlatWorld`), 46-slot inventory, pathfinder goto/stop, dig, placeBlock, equip, consume, sleep/wake, attack, craft, and container windows.
   - `MockGeminiClient` & `MockGeminiSession` (`test/mocks/mockGemini.ts:30-408`): Deterministic heuristic regex decomposition for all 9 fair-play tools, multi-turn step queues (`setScriptedTurns`), and custom handlers.
4. **Existing Milestone Tests**:
   - `test/m1/`: unit tests for Discord commands, embeds, bridge, RBAC, audio pipelines.
   - `test/m2/`: unit tests for Minecraft actions, client lifecycle, fairplay reach/sanitizer, perception, survival loops.
   - `test/m3/`: unit tests for Gemini tools, planner, and coordinator.
   - `test/tier5_adversarial/`: adversarial probes, fuzzing, and security audits.

---

## 2. Logic Chain

From the observations above:

1. **Subsystem Isolation for Tier 1**:
   - Tier 1 requires isolated happy-path tests verifying each feature (F01–F43) in isolation with high modularity.
   - Grouping into four coherent test files cleanly partitions the architectural boundaries:
     1. `test/tier1_features/discord_features.test.ts` (F01–F03, F09–F15)
     2. `test/tier1_features/minecraft_features.test.ts` (F18–F34)
     3. `test/tier1_features/ai_features.test.ts` (F35–F39, F42)
     4. `test/tier1_features/coordinator_features.test.ts` (F08, F40–F41)
2. **Boundary Value Analysis for Tier 2**:
   - Boundary tests require probing extreme values, error conditions, invalid inputs, timeouts, and state transitions across the same subsystems.
   - Partitioning into five dedicated edge-case test files ensures comprehensive coverage:
     1. `test/tier2_boundaries/minecraft_boundaries.test.ts`: Coordinate boundaries ($\pm 30,000,000$, $y=-64, 320$), exact reach limits ($4.5000$m vs $4.5001$m, $3.5000$m vs $3.5001$m), empty inventory states, death states, unexposed ore blocks.
     2. `test/tier2_boundaries/command_sanitizer_boundaries.test.ts`: Direct OP commands (`/op`, `/gamemode`, `/tp`, `/give`, `/kill`), obfuscations (spaces, tabs, colons, mixed casing, multi-slash, multiline injection).
     3. `test/tier2_boundaries/discord_bridge_boundaries.test.ts`: 256-character message chunking, multibyte UTF-8 slicing, embed 5s throttling, dirty-state SHA-256 suppression, Discord error 10008 auto-healing, RBAC null context.
     4. `test/tier2_boundaries/voice_audio_boundaries.test.ts`: 500ms silence timeout, empty audio packets, VAD energy threshold gating, audio queue flood with EMERGENCY preemption, destroyed voice session error handling.
     5. `test/tier2_boundaries/ai_planner_boundaries.test.ts`: Empty/whitespace goal prompts, `maxToolTurns` loop cutoff (infinite loop guard), tool parameter validation errors, AbortSignal cancellation, disconnected bot rejection.

---

## 3. Test Structure & Test File Organization

### Directory Layout

```
test/
├── tier1_features/
│   ├── discord_features.test.ts        # Discord slash commands, voice session, chat bridge, embed generator, RBAC
│   ├── minecraft_features.test.ts      # Mineflayer client, exposure, raycast, FOV, reach, actions, survival loops
│   ├── ai_features.test.ts             # Gemini SDK mock, 9 fair-play tools, validator, multi-turn loop, result packaging
│   └── coordinator_features.test.ts    # AgentCoordinator, priority queue preemption, progress reporting, stop interrupts
└── tier2_boundaries/
    ├── minecraft_boundaries.test.ts    # World bounds, reach boundaries, encased ores, raycast blockers, empty inventory, dead bot
    ├── command_sanitizer_boundaries.test.ts # OP commands, namespaces, whitespaces, multi-slashes, multiline injections
    ├── discord_bridge_boundaries.test.ts # 256-char chunking, UTF-8 surrogate safety, embed 5s throttle, hash suppression, RBAC edge cases
    ├── voice_audio_boundaries.test.ts  # Silence timeout, VAD threshold, queue flood preemption, session destruction
    └── ai_planner_boundaries.test.ts   # Empty goal text, maxToolTurns cutoff, invalid tool args, AbortSignal, disconnected bot
```

---

## 4. Test Case Inventory Specification

### 4.1 Tier 1: Feature Coverage (`test/tier1_features/`)

#### Suite 1: `discord_features.test.ts`
- **T1-DISC-01 (`/status` command)**:
  - Input: Slash interaction `/status` dispatched to `CommandRegistry`.
  - Action: Execute `statusCommand.execute(ctx, interaction)`.
  - Assertions: `interaction.reply` called with embed containing bot username (`TestBot`), health progress bar (`■`), coordinates (`10, 64, -20`), dimension (`overworld`), and active task (`Idle`).
- **T1-DISC-02 (`/connect` command)**:
  - Input: Slash interaction `/connect` with options `{ host: 'mc.hypixel.net', port: 25565, username: 'Player1' }`.
  - Action: Execute `connectCommand.execute(ctx, interaction)`.
  - Assertions: `ctx.connectMinecraft` invoked with `{ host: 'mc.hypixel.net', port: 25565, username: 'Player1' }`, reply confirms connection initiated.
- **T1-DISC-03 (`/disconnect` command)**:
  - Input: Slash interaction `/disconnect`.
  - Action: Execute `disconnectCommand.execute(ctx, interaction)`.
  - Assertions: `ctx.disconnectMinecraft` invoked, reply confirms agent disconnected.
- **T1-DISC-04 (`/task` command)**:
  - Input: Slash interaction `/task` with option `{ goal: 'gather 10 oak_log' }`.
  - Action: Execute `taskCommand.execute(ctx, interaction)`.
  - Assertions: `ctx.assignTask` invoked with `{ goal: 'gather 10 oak_log', user: interaction.user.tag }`.
- **T1-DISC-05 (`/stop` command)**:
  - Input: Slash interaction `/stop`.
  - Action: Execute `stopCommand.execute(ctx, interaction)`.
  - Assertions: `ctx.stopCurrentTask` invoked, reply confirms emergency task stop.
- **T1-DISC-06 (`/inventory` command)**:
  - Input: Slash interaction `/inventory`.
  - Action: Execute `inventoryCommand.execute(ctx, interaction)`.
  - Assertions: Output lists equipped gear (main hand, off hand, armor summary) and inventory slot statistics (used/free slots).
- **T1-DISC-07 (`/voice` command)**:
  - Input: Slash interaction `/voice` with option `{ action: 'join', channel: 'voice_channel_101' }`.
  - Action: Execute `voiceCommand.execute(ctx, interaction)`.
  - Assertions: `ctx.joinVoice` called with `'voice_channel_101'`, reply confirms voice connection.
- **T1-DISC-08 (`/help` command)**:
  - Input: Slash interaction `/help`.
  - Action: Execute `helpCommand.execute(ctx, interaction)`.
  - Assertions: Output lists all 8 registered slash commands and their descriptions and required RBAC tier.
- **T1-DISC-09 (Auto-deferral mechanism)**:
  - Input: Long-running command execution wrapped in `withAutoDefer`.
  - Action: Handler takes 2800ms to resolve.
  - Assertions: `interaction.deferReply` triggered at 2500ms; final response edits deferred reply rather than calling reply.
- **T1-DISC-10 (Voice session management)**:
  - Input: `discordGateway.joinVoice('v1', 'g1')`.
  - Action: Session returned, user subscribed, then `discordGateway.leaveVoice('g1')`.
  - Assertions: Session created, stream readable, `leaveVoice` destroys session and cleans active map.
- **T1-DISC-11 (Discord-to-Minecraft chat relay)**:
  - Input: Inbound Discord message from non-bot user: `"Hello from Discord!"`.
  - Action: `ChatBridge` processes message.
  - Assertions: `minecraftAgent.sendChat` called with formatted message `"[Discord] User: Hello from Discord!"`.
- **T1-DISC-12 (Minecraft-to-Discord chat relay)**:
  - Input: In-game chat event `("Steve", "Hello from Minecraft!")`.
  - Action: `ChatBridge` receives event.
  - Assertions: `discordGateway.sendMessage` called on configured channel with `"[Minecraft] <Steve> Hello from Minecraft!"`.
- **T1-DISC-13 (Triple-Lock Anti-Loopback: Self bot ID)**:
  - Input: Discord message authored by `botDiscordId`.
  - Action: Filter evaluates message.
  - Assertions: Dropped with reason `'SELF_BOT_ID'`; zero relay calls.
- **T1-DISC-14 (Triple-Lock Anti-Loopback: Bot accounts)**:
  - Input: Discord message with `author.bot === true`.
  - Action: Filter evaluates message.
  - Assertions: Dropped with reason `'BOT_ACCOUNT'`.
- **T1-DISC-15 (Triple-Lock Anti-Loopback: 10s TTL hash)**:
  - Input: Outbound relayed text recorded, identical inbound message arrives within 5s.
  - Action: Filter evaluates message.
  - Assertions: Dropped with reason `'DUPLICATE_TTL_HASH'`.
- **T1-DISC-16 (Chat sanitization & formatting)**:
  - Input: Inbound chat containing `§aGreen §cRed \r\n` control codes.
  - Action: Sanitizer strips legacy formatting codes.
  - Assertions: Returns clean plaintext `"Green Red"`.
- **T1-DISC-17 (Status embed generation)**:
  - Input: Bot status with HP 16/20, food 14/20, position (100, 64, -200).
  - Action: `buildStatusEmbed(status)`.
  - Assertions: Color is green (0x2ecc71), health bar has 8 filled and 2 empty symbols, fields include coordinates and gear.
- **T1-DISC-18 (Status embed throttling & dirty check)**:
  - Input: 5 rapid identical status updates within 2 seconds.
  - Action: `StatusEmbedManager.updateNow(status)` called 5 times.
  - Assertions: Only 1 initial Discord update is issued; subsequent identical hashes suppressed.
- **T1-DISC-19 (RBAC: Viewer access)**:
  - Input: Unauthenticated user executes `/status` or `/help` (required tier: VIEWER).
  - Action: `rbacService.check(member, user, RBACTier.VIEWER)`.
  - Assertions: Returns `allowed: true, userTier: RBACTier.VIEWER`.
- **T1-DISC-20 (RBAC: Operator access)**:
  - Input: User with operator role executes `/task` (required tier: OPERATOR).
  - Action: `rbacService.check(member, user, RBACTier.OPERATOR)`.
  - Assertions: Returns `allowed: true, userTier: RBACTier.OPERATOR`.
- **T1-DISC-21 (RBAC: Admin access)**:
  - Input: User with administrator bitflag executes `/connect` (required tier: ADMIN).
  - Action: `rbacService.check(member, user, RBACTier.ADMIN)`.
  - Assertions: Returns `allowed: true, userTier: RBACTier.ADMIN`.

#### Suite 2: `minecraft_features.test.ts`
- **T1-MC-01 (Mineflayer client spawn & status emission)**:
  - Input: `MinecraftClient.connect(config)`.
  - Action: Mock bot emits `'spawn'`.
  - Assertions: Client state transitions to `'SPAWNED'`, emits `'statusUpdate'` with `connected: true`.
- **T1-MC-02 (Mineflayer client graceful disconnect)**:
  - Input: `MinecraftClient.disconnect()`.
  - Action: Stops loops and quits bot.
  - Assertions: State transitions to `'DISCONNECTED'`, loops stopped, status reflects `connected: false`.
- **T1-MC-03 (Surface exposure: Encased block)**:
  - Input: Diamond ore at (10, 50, 10) surrounded by 6 solid stone blocks.
  - Action: `evaluateBlockExposure(world, { x: 10, y: 50, z: 10 })`.
  - Assertions: `isExposed === false, exposedFaces.length === 0`.
- **T1-MC-04 (Surface exposure: Exposed cardinal face)**:
  - Input: Iron ore at (5, 60, 5) with top face (+Y) exposed to air.
  - Action: `evaluateBlockExposure(world, { x: 5, y: 60, z: 5 })`.
  - Assertions: `isExposed === true, exposedFaces` contains `'+y'`, `exposedFaceCenters` contains `{ x: 5.5, y: 61.0, z: 5.5 }`.
- **T1-MC-05 (Surface exposure: Transparent medium exposure)**:
  - Input: Gold ore adjacent to water or glass block.
  - Action: `evaluateBlockExposure(world, pos)`.
  - Assertions: `isExposed === true` because water/glass are in `EXPOSING_BLOCK_NAMES`.
- **T1-MC-06 (3D DDA raycast: Unobstructed line of sight)**:
  - Input: Eye at (0, 65.62, 0), target exposed face center at (3, 65.5, 0), path filled with air.
  - Action: `hasBlockLineOfSight(world, eye, targetVoxel, exposedFaceCenters)`.
  - Assertions: Returns `true`.
- **T1-MC-07 (3D DDA raycast: Obstructed line of sight)**:
  - Input: Eye at (0, 65.62, 0), target at (4, 65.5, 0), solid cobblestone wall at (2, 65, 0).
  - Action: `hasBlockLineOfSight(world, eye, targetVoxel, exposedFaceCenters)`.
  - Assertions: Returns `false`, obstruction identified as `'cobblestone'`.
- **T1-MC-08 (Perception FOV: 70° focal cone)**:
  - Input: Target at (5, 64, 0), look vector along +X (yaw = -PI/2, pitch = 0), distance 5m.
  - Action: `isWithinPerceptionFOV(eye, target, lookVector)`.
  - Assertions: `inPerception === true, mode: 'focal_fov'`, angle is 0°.
- **T1-MC-09 (Perception FOV: 2.5m tactile fallback)**:
  - Input: Target directly behind bot at (-1.5, 64, 0), distance 1.5m <= 2.5m.
  - Action: `isWithinPerceptionFOV(eye, target, lookVector)`.
  - Assertions: `inPerception === true, mode: 'tactile'`.
- **T1-MC-10 (Perception FOV: Outside vision zone)**:
  - Input: Target behind bot at (-4, 64, 0), distance 4m > 2.5m, angle 180° > 35°.
  - Action: `isWithinPerceptionFOV(eye, target, lookVector)`.
  - Assertions: `inPerception === false, mode: 'outside'`.
- **T1-MC-11 (Reach enforcement: Block reach <= 4.5m)**:
  - Input: Eye at (0, 65.62, 0), target block at (3, 65, 0) (distance 3.0m).
  - Action: `assertBlockReach(eye, target)`.
  - Assertions: Does not throw, returns distance 3.0m.
- **T1-MC-12 (Reach enforcement: Entity attack reach <= 3.5m)**:
  - Input: Eye at (0, 65.62, 0), target entity at (2, 65, 0) (distance 2.0m).
  - Action: `assertEntityAttackReach(eye, target)`.
  - Assertions: Does not throw, returns distance 2.0m.
- **T1-MC-13 (Command sanitizer: Regular chat pass-through)**:
  - Input: `"Hello server, I am gathering wood"`.
  - Action: `assertAllowedMinecraftChat(message)`.
  - Assertions: Returns cleaned string without exception.
- **T1-MC-14 (Navigation: Pathfinder goto)**:
  - Input: `navigateTo({ x: 20, y: 64, z: 20 })`.
  - Action: Pathfinder moves bot.
  - Assertions: Bot position updates to (20, 64, 20), returns `{ success: true }`.
- **T1-MC-15 (Mining engine: Harvest tier verification & dig)**:
  - Input: Iron ore block at (2, 64, 0) within reach; bot holding stone pickaxe (tier 2 >= tier 2 required).
  - Action: `miningAction.mineBlock(pos)`.
  - Assertions: Harvest tier satisfied, block dug, world block set to `'air'`, returns `{ success: true }`.
- **T1-MC-16 (Block placement)**:
  - Input: `placeBlock({ x: 2, y: 65, z: 0 }, 'dirt')` against solid reference block below.
  - Action: Places block.
  - Assertions: Block placed at destination, inventory item count decremented by 1.
- **T1-MC-17 (Crafting engine: 2x2 grid planks)**:
  - Input: Bot has 2 oak logs, requests crafting 4 oak planks.
  - Action: `craftingAction.craftItem('oak_planks', 4)`.
  - Assertions: 1 oak log consumed, 4 oak planks added to inventory, returns `{ success: true }`.
- **T1-MC-18 (Crafting engine: 3x3 table recursive pickaxe)**:
  - Input: Bot has oak planks and sticks, standing next to crafting table.
  - Action: `craftingAction.craftItem('wooden_pickaxe', 1)`.
  - Assertions: Requires crafting table, consumes 3 planks and 2 sticks, produces wooden pickaxe.
- **T1-MC-19 (Combat system: 1.9+ weapon cooldown)**:
  - Input: Bot holding diamond sword (cooldown 625ms). First attack at t=0, second attack at t=200ms.
  - Action: `combatAction.attackEntity(targetId)`.
  - Assertions: `CombatCooldownController.awaitFullGauge` waits remaining 425ms before swinging to deliver full damage.
- **T1-MC-20 (Combat system: Shield blocking)**:
  - Input: Hostile mob attacks bot; bot holding shield in off-hand.
  - Action: `combatAction.activateItem(true)`.
  - Assertions: `bot.isBlocking === true`.
- **T1-MC-21 (Auto-eating survival loop: Saturation priority)**:
  - Input: Bot food drops to 12 <= 14; inventory contains cooked beef (saturation 12.8) and apple (saturation 2.4).
  - Action: `autoEatLoop.checkAndEat()`.
  - Assertions: Selects cooked beef (highest saturation tier), consumes food, food level restored.
- **T1-MC-22 (Auto-sleeping survival loop: Night bed check)**:
  - Input: World time is 13500 (night), nearby bed block at (2, 64, 0), no hostile mobs within 8m.
  - Action: `autoSleepLoop.checkAndSleep()`.
  - Assertions: Bot interacts with bed, `bot.isSleeping === true`.
- **T1-MC-23 (Auto-equipping survival loop: Composite defense scoring)**:
  - Input: Inventory contains iron chestplate (defense 6) and diamond chestplate (defense 8 + toughness 2).
  - Action: `autoEquipLoop.checkAndEquip()`.
  - Assertions: Diamond chestplate evaluated with higher composite score, equipped into torso armor slot.

#### Suite 3: `ai_features.test.ts`
- **T1-AI-01 (Gemini client mock initialization & history)**:
  - Input: Create session with system instruction `"Fair-play Minecraft companion"`.
  - Action: Send user message, inspect session history.
  - Assertions: User message and model response recorded chronologically in history array.
- **T1-AI-02 (9 Structured Fair-Play Tool declarations)**:
  - Input: `FAIR_PLAY_TOOL_DECLARATIONS` export.
  - Action: Verify names, parameter types, and descriptions.
  - Assertions: Exactly 9 tools declared: `goToCoordinates`, `followPlayer`, `gatherResource`, `defendArea`, `reportStatus`, `stopCurrentTask`, `craftItem`, `sleepInBed`, `depositOrRetrieve`.
- **T1-AI-03 (Tool argument validator: Valid calls)**:
  - Input: Valid tool call objects for all 9 tools (e.g. `goToCoordinates({ x: 10, y: 64, z: -10 })`, `gatherResource({ blockType: 'oak_log', count: 5 })`).
  - Action: `validateToolCall(toolCall)`.
  - Assertions: Each tool call passes validation without throwing.
- **T1-AI-04 (Tool argument validator: Schema rejects)**:
  - Input: Tool call `goToCoordinates` missing `z` parameter, or `followPlayer` with non-string `playerName`.
  - Action: `validateToolCall(malformedCall)`.
  - Assertions: Throws `FairPlayValidationError` identifying invalid parameter.
- **T1-AI-05 (Single-step goal decomposition: goToCoordinates)**:
  - Input: Natural language goal: `"navigate to 100 64 -200"`.
  - Action: Run `planner.executeGoal(goal, context)`.
  - Assertions: Emits event sequence: `thought` -> `tool_call` (`goToCoordinates`) -> `tool_result` -> `done`. Bot position becomes (100, 64, -200).
- **T1-AI-06 (Multi-step goal decomposition: gather and craft)**:
  - Input: Goal: `"gather 3 oak_log and craft oak_planks"`.
  - Action: Run `planner.executeGoal(goal, context)`.
  - Assertions: Turn 1 executes `gatherResource`; on tool result, Turn 2 executes `craftItem`; emits `done`.
- **T1-AI-07 (Tool result packaging)**:
  - Input: Tool execution result `{ success: true, message: 'Arrived at destination' }`.
  - Action: Formatted into tool response message sent back to Gemini session.
  - Assertions: Session records role `'tool'` with matching `callId` and result content.
- **T1-AI-08 (In-memory mock deterministic regex parsing)**:
  - Input: Diverse prompts ("come to 50 70 50", "protect area within 20", "report status", "stop now").
  - Action: Mock session resolves tool calls.
  - Assertions: Correct tool names and extracted arguments matched without external API calls.

#### Suite 4: `coordinator_features.test.ts`
- **T1-COORD-01 (Priority audio queue: FIFO normal queueing)**:
  - Input: Enqueue Item A (NORMAL, t=100) and Item B (NORMAL, t=200).
  - Action: `AudioQueueManager.enqueue()`.
  - Assertions: Played in FIFO order (Item A first, then Item B).
- **T1-COORD-02 (Priority audio queue: Emergency preemption)**:
  - Input: Item A (NORMAL) is actively playing. Emergency Item E is enqueued.
  - Action: `AudioQueueManager.enqueue(emergencyItem)`.
  - Assertions: Item A interrupted, emergency item plays immediately at head of queue.
- **T1-COORD-03 (Progress reporting: Task start)**:
  - Input: Planner emits event `{ type: 'thought', message: 'Analyzing terrain' }`.
  - Action: `ProgressReporter.reportEvent(event, context)`.
  - Assertions: Discord gateway receives status embed or text update indicating task in progress.
- **T1-COORD-04 (Progress reporting: Step progress & done)**:
  - Input: Planner emits step progress and final `'done'` event.
  - Action: `ProgressReporter.reportEvent(event, context)`.
  - Assertions: Discord gateway receives completion message with summary of executed steps.
- **T1-COORD-05 (Emergency stop via /stop command)**:
  - Input: Active running navigation/mining task; `AgentCoordinator.stopCurrentTask()` called.
  - Action: Halts planner, stops bot pathfinder and digging.
  - Assertions: Planner cancelled, bot pathfinder stopped, Discord notification sent.
- **T1-COORD-06 (Emergency stop via voice interrupt)**:
  - Input: Coordinator receives voice prompt event `{ userId: 'u1', prompt: 'stop immediately' }`.
  - Action: `AgentCoordinator.handleVoicePrompt(event)`.
  - Assertions: Triggers `stopCurrentTask()`.
- **T1-COORD-07 (Survival alert: Bot death in-game)**:
  - Input: Minecraft agent emits `'death'`.
  - Action: Coordinator event listener triggers.
  - Assertions: Discord bridge broadcasts `🚨 SURVIVAL EMERGENCY: Agent died in-game`, emergency TTS enqueued.
- **T1-COORD-08 (Survival alert: Critical low health <= 6 HP)**:
  - Input: Bot health drops to 4.0 HP.
  - Action: Status update emitted.
  - Assertions: Emergency alert broadcasted; second drop within 3 seconds rate-limited to prevent spam.

---

### 4.2 Tier 2: Boundaries & Edge Cases (`test/tier2_boundaries/`)

#### Suite 1: `minecraft_boundaries.test.ts`
- **T2-MC-01 (World boundary coordinates: $\pm 30,000,000$)**:
  - Input: Coordinates $(29999984, 64, -29999984)$.
  - Action: `Vec3Location` distance and reach calculations.
  - Assertions: No numerical overflow or infinity; arithmetic is stable.
- **T2-MC-02 (Height limits: $y = -64$ and $y = 320$)**:
  - Input: Block targets at bedrock floor ($y = -64$) and world ceiling ($y = 320$).
  - Action: Evaluate exposure and distance from eye.
  - Assertions: Exposure correctly accesses -64 and 320; coordinates below -64 handled gracefully.
- **T2-MC-03 (Sub-voxel boundary offsets: $x.9999$ vs $x.0001$)**:
  - Input: Eye at $(10.999, 64.0, 0)$, block at $(11, 64, 0)$.
  - Action: `getBlockDistanceToEye(eye, block)`.
  - Assertions: Closest point on unit box $[11, 12]$ is $x=11.0$; distance is $0.001$m.
- **T2-MC-04 (NaN and Infinite coordinates rejection)**:
  - Input: Goal coordinates with $x = \text{NaN}$ or $y = \infty$.
  - Action: Pass to `validateToolArgs` and `navigateTo`.
  - Assertions: Throws `FairPlayValidationError` or action returns `{ success: false }`.
- **T2-MC-05 (Block reach boundary: Exact 4.5000m)**:
  - Input: Eye at $(0, 64, 0)$, block at $(4.5, 64, 0)$ (closest AABB point at $x=4.5$, distance exactly $4.5000$m).
  - Action: `assertBlockReach(eye, blockPos)`.
  - Assertions: Passes without throwing (`distance <= 4.50 + 1e-4`).
- **T2-MC-06 (Block reach boundary: 4.5001m violation)**:
  - Input: Eye at $(0, 64, 0)$, block at $(5.5001, 64, 0)$ (closest AABB point at $x=4.5001$m).
  - Action: `assertBlockReach(eye, blockPos)`.
  - Assertions: Throws `ReachExceededError` with `targetType === 'block'`, `maxAllowed === 4.50`.
- **T2-MC-07 (Unit cube AABB 3D diagonal clamping)**:
  - Input: Eye at $(0, 0, 0)$, block unit cube $[2, 3] \times [2, 3] \times [2, 3]$.
  - Action: `getBlockDistanceToEye(eye, { x: 2, y: 2, z: 2 })`.
  - Assertions: Closest point is $(2, 2, 2)$, distance is $\sqrt{2^2 + 2^2 + 2^2} = \sqrt{12} \approx 3.4641$m $\le 4.5$m.
- **T2-MC-08 (Zero-distance reach: Eye inside target block)**:
  - Input: Eye at $(10.5, 64.5, 10.5)$, block at $(10, 64, 10)$.
  - Action: `assertBlockReach(eye, blockPos)`.
  - Assertions: Distance evaluated as $0.0$m, passes.
- **T2-MC-09 (Entity combat attack reach: Exact 3.5000m)**:
  - Input: Eye at $(0, 65, 0)$, entity hitbox $[3.5, 4.1] \times [64, 65.8] \times [-0.3, 0.3]$.
  - Action: `assertEntityAttackReach(eye, entityPos)`.
  - Assertions: Distance to closest hitbox point is $3.5000$m, passes without throwing.
- **T2-MC-10 (Entity combat attack reach: 3.5001m violation)**:
  - Input: Eye at $(0, 65, 0)$, closest point on entity box is at $3.5001$m.
  - Action: `assertEntityAttackReach(eye, entityPos)`.
  - Assertions: Throws `ReachExceededError` with `targetType === 'entity'`, `maxAllowed === 3.50`.
- **T2-MC-11 (Large entity hitbox reach calculation)**:
  - Input: Boss entity with width 3.0m, height 4.0m positioned at distance 5m center-to-center.
  - Action: `getEntityDistanceToEye(eye, pos, 4.0, 3.0)`.
  - Assertions: Clamps to bounding box perimeter ($5.0 - 1.5 = 3.5$m), correctly validating reach.
- **T2-MC-12 (Perception exposure: Deeply encased ore)**:
  - Input: Diamond ore with 6 solid rock neighbors.
  - Action: `evaluateBlockExposure(world, pos)`.
  - Assertions: `isExposed === false, exposedFaceCenters.length === 0`.
- **T2-MC-13 (Perception exposure: Diagonal air non-exposure)**:
  - Input: Ore with solid neighbors on all 6 cardinal faces, but air at $(x+1, y+1, z)$ (diagonal).
  - Action: `evaluateBlockExposure(world, pos)`.
  - Assertions: `isExposed === false` (strictly cardinal faces evaluated, preventing corner x-ray leaks).
- **T2-MC-14 (Perception exposure: Unloaded chunk boundary null guard)**:
  - Input: Block adjacent to an unloaded chunk (accessor returns `null`).
  - Action: `evaluateBlockExposure(world, pos)`.
  - Assertions: Null neighbor treated as non-exposing (`isExposed === false`), preventing x-ray through chunk borders.
- **T2-MC-15 (Raycast: Intermediate 1-block wall obstruction)**:
  - Input: Exposed block at (5, 64, 0); solid stone block placed at (3, 64, 0).
  - Action: `checkLineOfSight(world, eye, targetVoxel, targetFaceCenter)`.
  - Assertions: Returns `{ visible: false, hitVoxel: { x: 3, y: 64, z: 0 }, obstruction: 'stone' }`.
- **T2-MC-16 (Raycast: Max distance cutoff 32m)**:
  - Input: Target at distance 35m.
  - Action: `checkLineOfSight(world, eye, targetVoxel, faceCenter, 32.0)`.
  - Assertions: Returns `{ visible: false, obstruction: 'MAX_DISTANCE_EXCEEDED' }`.
- **T2-MC-17 (FOV angle: Exact 35.0° half-angle boundary)**:
  - Input: Target at angle $\theta = 35.0^\circ$ from look direction, distance 3.0m.
  - Action: `isWithinPerceptionFOV(eye, target, look)`.
  - Assertions: Dot product equals $\cos(35^\circ) \approx 0.81915$; returns `inPerception === true, mode: 'focal_fov'`.
- **T2-MC-18 (FOV angle: 35.1° half-angle boundary failure)**:
  - Input: Target at angle $\theta = 35.1^\circ$ from look direction, distance 3.0m.
  - Action: `isWithinPerceptionFOV(eye, target, look)`.
  - Assertions: Dot product $< \cos(35^\circ)$; returns `inPerception === false, mode: 'outside'`.
- **T2-MC-19 (Tactile fallback: Exactly 2.5000m sphere boundary)**:
  - Input: Target at angle 180° (behind bot) at distance $2.5000$m.
  - Action: `isWithinPerceptionFOV(eye, target, look)`.
  - Assertions: Returns `inPerception === true, mode: 'tactile'`.
- **T2-MC-20 (Tactile fallback: 2.5001m boundary failure)**:
  - Input: Target at angle 180° at distance $2.5001$m.
  - Action: `isWithinPerceptionFOV(eye, target, look)`.
  - Assertions: Returns `inPerception === false, mode: 'outside'`.
- **T2-MC-21 (Empty inventory: Mining high-tier ore without tool)**:
  - Input: Diamond ore block; bot inventory has 0 tools (bare hands).
  - Action: `miningAction.mineBlock(pos)`.
  - Assertions: Returns `{ success: false, message: expect.stringContaining('requires iron pickaxe') }`.
- **T2-MC-22 (Empty inventory: Crafting with zero ingredients)**:
  - Input: Bot inventory empty; requests crafting wooden sword.
  - Action: `craftingAction.decomposeRecipe('wooden_sword')`.
  - Assertions: Returns `{ canCraft: false, missingRawMaterials: expect.arrayContaining([{ item: 'oak_planks', count: 2 }]) }`.
- **T2-MC-23 (Empty inventory: Auto-eat loop with zero food)**:
  - Input: Food drops to 10; bot inventory has 0 food items.
  - Action: `autoEatLoop.checkAndEat()`.
  - Assertions: Completes cleanly without throwing; bot food remains 10.
- **T2-MC-24 (Empty inventory: Auto-equip loop with zero armor)**:
  - Input: Bot armor slots empty; bot inventory has 0 armor items.
  - Action: `autoEquipLoop.checkAndEquip()`.
  - Assertions: Completes cleanly without throwing; armor slots remain null.
- **T2-MC-25 (Dead bot: Action rejection during death)**:
  - Input: Bot health is 0 (dead). Attempt `mineBlock` or `navigateTo`.
  - Action: Invoke action methods.
  - Assertions: Action rejected with error indicating agent is dead or disconnected.
- **T2-MC-26 (Respawn state recovery)**:
  - Input: Dead bot receives respawn event.
  - Action: `bot.respawn()`.
  - Assertions: Health resets to 20, food resets to 20, state returns to spawned.

#### Suite 2: `command_sanitizer_boundaries.test.ts`
- **T2-SAN-01 (Direct OP command: /op)**:
  - Input: `"/op malicious_user"`.
  - Action: `assertAllowedMinecraftChat(input)`.
  - Assertions: Throws `PrivilegedCommandError` with `command: 'op'`.
- **T2-SAN-02 (Direct OP command: /gamemode)**:
  - Input: `"/gamemode creative"`.
  - Action: `assertAllowedMinecraftChat(input)`.
  - Assertions: Throws `PrivilegedCommandError` with `command: 'gamemode'`.
- **T2-SAN-03 (Direct OP command: /tp)**:
  - Input: `"/tp 0 100 0"`.
  - Action: `assertAllowedMinecraftChat(input)`.
  - Assertions: Throws `PrivilegedCommandError` with `command: 'tp'`.
- **T2-SAN-04 (Direct OP command: /give)**:
  - Input: `"/give @p diamond 64"`.
  - Action: `assertAllowedMinecraftChat(input)`.
  - Assertions: Throws `PrivilegedCommandError` with `command: 'give'`.
- **T2-SAN-05 (Direct OP command: /kill)**:
  - Input: `"/kill @e[type=!player]"`.
  - Action: `assertAllowedMinecraftChat(input)`.
  - Assertions: Throws `PrivilegedCommandError` with `command: 'kill'`.
- **T2-SAN-06 (Direct OP command: /execute)**:
  - Input: `"/execute as @a run gamemode survival"`.
  - Action: `assertAllowedMinecraftChat(input)`.
  - Assertions: Throws `PrivilegedCommandError` with `command: 'execute'`.
- **T2-SAN-07 (Namespace exploit: /minecraft:gamemode)**:
  - Input: `"/minecraft:gamemode creative"`.
  - Action: `assertAllowedMinecraftChat(input)`.
  - Assertions: Two-phase tokenizer identifies root `'gamemode'` and throws `PrivilegedCommandError`.
- **T2-SAN-08 (Namespace exploit: /bukkit:op)**:
  - Input: `"/bukkit:op attacker"`.
  - Action: `assertAllowedMinecraftChat(input)`.
  - Assertions: Identifies root `'op'` and throws `PrivilegedCommandError`.
- **T2-SAN-09 (Namespace with whitespace: /minecraft : give)**:
  - Input: `"/minecraft : give player diamond"`.
  - Action: `assertAllowedMinecraftChat(input)`.
  - Assertions: Tokenizer parses across spaced colon, blocks privileged command.
- **T2-SAN-10 (Leading whitespace injection: /  gamemode)**:
  - Input: `"/  gamemode 1"`.
  - Action: `assertAllowedMinecraftChat(input)`.
  - Assertions: Rejects malformed whitespace command and throws `PrivilegedCommandError`.
- **T2-SAN-11 (Tab and non-breaking space injection)**:
  - Input: `"/\tgamemode creative"` and `"/\u00A0op"`.
  - Action: `assertAllowedMinecraftChat(input)`.
  - Assertions: Blocked as malformed privileged command.
- **T2-SAN-12 (Multi-slash obfuscation: //gamemode)**:
  - Input: `"//gamemode c"` and `"///tp 10 10 10"`.
  - Action: `assertAllowedMinecraftChat(input)`.
  - Assertions: Slashes stripped to root command name, blocked.
- **T2-SAN-13 (Mixed-case bypass attempt)**:
  - Input: `"/GaMeMoDe CrEaTiVe"` and `"/oP"`.
  - Action: `assertAllowedMinecraftChat(input)`.
  - Assertions: Lowercased and blocked.
- **T2-SAN-14 (Multiline newline injection: /say hi\n/op me)**:
  - Input: `"/say Hello world\n/op attacker"`.
  - Action: `assertAllowedMinecraftChat(input)`.
  - Assertions: Multiline scanner inspects all lines, catches privileged `/op` on second line, and throws.
- **T2-SAN-15 (Conversational command mentions: "I want to op the door")**:
  - Input: `"I want to op the door"` (does not start with `/`).
  - Action: `assertAllowedMinecraftChat(input)`.
  - Assertions: Allowed as regular chat without throwing.
- **T2-SAN-16 (Help query in chat: "How to use /tp?")**:
  - Input: `"How to use /tp?"`.
  - Action: `assertAllowedMinecraftChat(input)`.
  - Assertions: Allowed as chat because message does not begin with `/`.
- **T2-SAN-17 (Bare slash handling: "/" and "///")**:
  - Input: `"/"`.
  - Action: `assertAllowedMinecraftChat(input)`.
  - Assertions: Handled without uncaught exception.

#### Suite 3: `discord_bridge_boundaries.test.ts`
- **T2-BRG-01 (Chat chunking: Exactly 256 characters)**:
  - Input: String of exactly 256 ASCII characters `"A".repeat(256)`.
  - Action: `chunkMessage(msg, 256)`.
  - Assertions: Yields exactly 1 chunk of length 256.
- **T2-BRG-02 (Chat chunking: 257 characters overflow)**:
  - Input: String of 257 characters `"A".repeat(257)`.
  - Action: `chunkMessage(msg, 256)`.
  - Assertions: Yields 2 chunks; first chunk $\le 256$, second chunk of length 1.
- **T2-BRG-03 (Chat chunking: 1000 characters wall of text)**:
  - Input: Continuous wall of text of length 1000 with spaces.
  - Action: `chunkMessage(msg, 256)`.
  - Assertions: All yielded chunks have length $\le 256$, total reconstructed text matches original.
- **T2-BRG-04 (Chat chunking: Multibyte UTF-8 emojis at 255-byte boundary)**:
  - Input: String of 255 'a' characters followed by 4-byte emoji `'🎮'` (total 259 bytes).
  - Action: `chunkMessage(msg, 256)`.
  - Assertions: Emoji is NOT split in half; placed intact into chunk 2.
- **T2-BRG-05 (Embed update throttling: 5s interval guard)**:
  - Input: 10 state mutations within 2.0 seconds.
  - Action: `StatusEmbedManager` called on each mutation.
  - Assertions: Emits initial embed; remaining updates throttled until 5s timer expires.
- **T2-BRG-06 (Embed dirty-state hash suppression)**:
  - Input: Bot status unchanged (health=20, food=20, position identical).
  - Action: `computeStateHash` compared against `lastStateHash`.
  - Assertions: Hashes match; zero calls to `discordGateway.updateEmbed`.
- **T2-BRG-07 (Discord Error 10008 recovery)**:
  - Input: Discord returns error with `code: 10008` (Unknown Message) when updating pinned status embed.
  - Action: `StatusEmbedManager.updateNow()` catches error.
  - Assertions: Gateway creates and pins a new message; recovers clean state.
- **T2-BRG-08 (Anti-loopback duplicate within 10s TTL)**:
  - Input: Message relayed outbound at $t=0$; duplicate received at $t=8$s.
  - Action: `antiLoopbackFilter.evaluate()`.
  - Assertions: Returns `{ drop: true, reason: 'DUPLICATE_TTL_HASH' }`.
- **T2-BRG-09 (Anti-loopback expiration after 10s TTL)**:
  - Input: Message relayed outbound at $t=0$; advance timer by 11 seconds; duplicate received at $t=11$s.
  - Action: `antiLoopbackFilter.evaluate()`.
  - Assertions: Returns `{ drop: false }`.
- **T2-BRG-10 (Empty and whitespace-only Discord chat)**:
  - Input: Discord message with `content: "   \t\n  "`.
  - Action: `ChatBridge.handleDiscordMessage()`.
  - Assertions: Ignored and dropped without relaying to Minecraft.
- **T2-BRG-11 (RBAC null context handling)**:
  - Input: Direct Message context where `member === null` and `guild === null`.
  - Action: `rbacService.check(null, user, RBACTier.OPERATOR)`.
  - Assertions: Returns `allowed: false, reason: expect.stringContaining('Permission Denied')`.
- **T2-BRG-12 (RBAC undefined ownerId protection)**:
  - Input: Config where `ownerId` is undefined; user has `id: 'attacker'`.
  - Action: `rbacService.check(member, user, RBACTier.ADMIN)`.
  - Assertions: Does NOT match; denies admin access.
- **T2-BRG-13 (RBAC role mismatch protection)**:
  - Input: Member has roles `['viewer_role']`; required tier is OPERATOR (configured roles: `['op_role']`).
  - Action: `rbacService.check(member, user, RBACTier.OPERATOR)`.
  - Assertions: Returns `allowed: false`.

#### Suite 4: `voice_audio_boundaries.test.ts`
- **T2-AUD-01 (Silence timeout: 500ms AfterSilence)**:
  - Input: User speaks 1 packet then silence for 600ms.
  - Action: `AudioReceiver` silence detector tracks elapsed time.
  - Assertions: Silence timeout triggers at 500ms, closes packet stream and forwards buffer to STT.
- **T2-AUD-02 (Empty audio packet stream)**:
  - Input: Inbound user stream emits `'end'` immediately without data chunks.
  - Action: `AudioReceiver` processes stream.
  - Assertions: Handled gracefully without emitting empty transcription prompt.
- **T2-AUD-03 (VAD noise gate: Low energy floor)**:
  - Input: PCM audio buffer with low amplitude static ($< 30$ dB).
  - Action: VAD energy filter evaluates frame.
  - Assertions: Classified as silence; does not trigger speech recognition.
- **T2-AUD-04 (VAD noise gate: High energy speech)**:
  - Input: PCM audio buffer with clear vocal energy ($> 50$ dB).
  - Action: VAD energy filter evaluates frame.
  - Assertions: Classified as active speech; triggers STT pipeline.
- **T2-AUD-05 (Queue flood preemption under stress)**:
  - Input: Enqueue 50 NORMAL priority items in rapid succession, then enqueue 1 EMERGENCY item.
  - Action: `AudioQueueManager.enqueue(emergencyItem)`.
  - Assertions: Emergency item immediately placed at index 0 ahead of all 50 items.
- **T2-AUD-06 (cancelNonEmergency selective purge)**:
  - Input: Queue contains 5 NORMAL items, 3 HIGH items, 2 EMERGENCY items.
  - Action: `AudioQueueManager.cancelNonEmergency()`.
  - Assertions: Queue length becomes 2; only the 2 EMERGENCY items remain.
- **T2-AUD-07 (Playback on destroyed voice session)**:
  - Input: Voice session destroyed via `destroy()`; call `playAudioStream()`.
  - Action: Invoke playback.
  - Assertions: Throws `Error('Cannot play audio on destroyed voice session')`.
- **T2-AUD-08 (Mid-stream voice disconnect cleanup)**:
  - Input: Active user stream passing audio; voice session destroyed.
  - Action: `session.destroy()`.
  - Assertions: All active user `PassThrough` streams destroyed, map cleared.

#### Suite 5: `ai_planner_boundaries.test.ts`
- **T2-PLN-01 (Empty goal string prompt)**:
  - Input: Goal text `""`.
  - Action: `planner.executeGoal("", context)`.
  - Assertions: Yields error event or throws with message indicating empty goal text.
- **T2-PLN-02 (Whitespace-only goal prompt)**:
  - Input: Goal text `"   \t\n  "`.
  - Action: `planner.executeGoal(whitespaceGoal, context)`.
  - Assertions: Emits error event without making model calls.
- **T2-PLN-03 (Goal prompt length limit 1000 characters)**:
  - Input: Goal prompt of 1200 characters.
  - Action: Planner processes prompt.
  - Assertions: Safely truncated or passed to model without parser stack overflow.
- **T2-PLN-04 (Infinite loop cutoff: maxToolTurns exceeded)**:
  - Input: Mock model configured to endlessly call `goToCoordinates` on every turn; `maxToolTurns: 10`.
  - Action: `planner.executeGoal(goal, context)`.
  - Assertions: Planner cuts off at turn 10; yields `{ type: 'error', message: expect.stringContaining('Max tool turns') }` and `{ type: 'done' }`.
- **T2-PLN-05 (Validator boundary: Out-of-bounds coordinates)**:
  - Input: Tool call `goToCoordinates({ x: 0, y: -70, z: 0 })` ($y < -64$) or `y: 350` ($y > 320$).
  - Action: `validateToolCall(toolCall)`.
  - Assertions: Throws `FairPlayValidationError` citing vertical build limits.
- **T2-PLN-06 (Validator boundary: Negative count or excessive radius)**:
  - Input: `gatherResource({ blockType: 'oak_log', count: -5 })` or `radius: 128` ($> 64$).
  - Action: `validateToolCall(toolCall)`.
  - Assertions: Throws `FairPlayValidationError`.
- **T2-PLN-07 (Validator boundary: Invalid craft item parameters)**:
  - Input: `craftItem({ item: 'diamond_sword', count: 0 })`.
  - Action: `validateToolCall(toolCall)`.
  - Assertions: Throws `FairPlayValidationError` (count must be $\ge 1$).
- **T2-PLN-08 (Validator boundary: Unregistered tool invocation)**:
  - Input: Tool call `{ name: 'teleportToPlayer', args: { user: 'Steve' } }`.
  - Action: `validateToolCall(toolCall)`.
  - Assertions: Throws `FairPlayValidationError` citing unknown tool.
- **T2-PLN-09 (AbortSignal immediate cancellation)**:
  - Input: Goal execution started; `planner.cancelCurrentGoal()` invoked during turn 1.
  - Action: Generator loop checks cancellation state.
  - Assertions: Loop immediately terminates, emitting cancellation progress event.
- **T2-PLN-10 (Disconnected agent guard)**:
  - Input: Minecraft agent is disconnected (`status.connected === false`).
  - Action: `AgentCoordinator.assignTask({ goal: 'mine wood', user: 'u1' })`.
  - Assertions: Rejects with `Error('Cannot assign task: Minecraft agent is disconnected.')`.

---

## 5. Vitest Configurations & Runner Details

- **File Path Inclusion**:
  The root configuration `vitest.config.ts` includes `test/**/*.test.ts`, ensuring that all test suites placed under `test/tier1_features/` and `test/tier2_boundaries/` are automatically discovered and executed by `npm test`.
- **Test Isolation & Execution Settings**:
  - `pool: 'forks'`: guarantees complete V8 process isolation between test suites, preventing EventEmitter or global state contamination.
  - `testTimeout: 15000` (15s): provides ample margin for simulated multi-turn loops and backoff timers.
  - `clearMocks: true`, `mockReset: true`, `restoreMocks: true`: ensures Vitest spies (`vi.fn()`) and mock timers are reset before every test case.
- **Hermetic Execution**:
  All tests use dependency-injected mock instances (`MockDiscordGateway`, `MockMinecraftAgent`, `MockWorld`, `MockGeminiClient`, `MockVoiceSession`). No real network sockets, API keys, or Minecraft server instances are required.

---

## 6. Caveats

1. **Test Runner Process on Windows**:
   When invoking npm scripts from PowerShell on Windows environments where script execution policy is restricted, Vitest must be run via `cmd /c npm test` or `npx.cmd vitest run`.
2. **Timing of Asynchronous Generator Iterators**:
   Multi-turn planner generator loops (`for await (const event of planner.executeGoal(...))`) run asynchronously. In tests that trigger external aborts (`cancelCurrentGoal`), tests should wait for the generator to yield its completion event before performing assertions.
3. **Floating Point Tolerances in 3D Math**:
   Raycasting and FOV calculations use floating-point trigonometry. All assertions involving dot products, Euclidean distances, and vector coordinates incorporate an epsilon tolerance of $1\times 10^{-4}$ (or Vitest's `toBeCloseTo`).

---

## 7. Conclusion

The test architecture and case inventories for **Tier 1: Feature Coverage** (4 test suites, 60 test cases) and **Tier 2: Boundaries & Edge Cases** (5 test suites, 70 test cases) are fully designed, scoped, and specified with exact inputs, assertions, and expected outcomes.
- Tier 1 provides exhaustive happy-path verification across all 43 project features.
- Tier 2 provides rigorous boundary value analysis across spatial limits, survival restrictions, anti-cheat invariants, rate limits, audio timeouts, and malformed inputs.
- All tests are fully compatible with existing project mock infrastructure and the Vitest test runner.

---

## 8. Verification Method

1. **Verify Existing Suite Baseline**:
   ```bash
   cmd /c npm test
   ```
   Confirm all 444 existing tests continue to pass with 0 failures.
2. **Verify TypeScript Compilation**:
   ```bash
   cmd /c npm run build
   ```
   Confirm clean compile with zero errors in `dist/`.
3. **Verify Tier 1 & Tier 2 Implementation**:
   Once implemented in `test/tier1_features/` and `test/tier2_boundaries/`, run:
   ```bash
   cmd /c npx vitest run test/tier1_features/ test/tier2_boundaries/
   ```
   Confirm that all 130 newly defined test cases execute cleanly and pass 100%.
