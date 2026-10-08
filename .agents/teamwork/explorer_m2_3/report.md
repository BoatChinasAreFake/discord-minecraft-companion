# Milestone 2: Automated Survival Loops, Client Lifecycle Manager & Test Suite Architecture

**Author**: Explorer 3 (Milestone 2 Investigation)  
**Date**: 2026-10-07  
**Working Directory**: `.agents/teamwork/explorer_m2_3/`  
**Target Subsystems**:
- Automated Survival Loops (`src/minecraft/loops/autoEat.ts`, `autoSleep.ts`, `autoEquip.ts`)
- Minecraft Client Lifecycle Manager (`src/minecraft/client.ts`)
- Milestone 2 Test Suite Architecture (`test/m2/survivalLoops.test.ts`, `test/m2/client.test.ts`, `test/m2/perception.test.ts`, `test/m2/fairplay.test.ts`, `test/m2/actions.test.ts`)

---

## 1. Executive Summary & Architectural Overview

Milestone 2 establishes the core Minecraft Fair-Play Survival Engine for the Discord-Minecraft AI companion bot. Operating strictly within standard survival vanilla gameplay constraints (no OP commands, no wall x-ray, physical reach $\le 4.5$m), the agent must act autonomously to maintain its survival, manage its lifecycle, and faithfully execute AI instructions.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                           MinecraftClient (Agent)                              │
│  - IMinecraftAgent implementation                                              │
│  - Connection State Machine (DISCONNECTED -> CONNECTING -> SPAWNED)            │
│  - Exponential Backoff Auto-Reconnect with Jitter                              │
│  - Event Bridges ('chat', 'statusUpdate', 'health', 'death', 'kicked')         │
└───────┬─────────────────┬──────────────────────┬────────────────────────┬──────┘
        │                 │                      │                        │
        ▼                 ▼                      ▼                        ▼
┌──────────────┐   ┌──────────────┐       ┌──────────────┐         ┌──────────────┐
│  Perception  │   │   Fair-Play  │       │   Actions    │         │Survival Loops│
│- Raycast LOS │   │- Reach Clamp │       │- Pathfinder  │         │- Auto-Eat    │
│- Exposure    │   │- CmdSanitizer│       │- Mining      │         │- Auto-Sleep  │
│- FOV Cone    │   │- Rules       │       │- Crafting    │         │- Auto-Equip  │
│- Tactile 2.5m│   │              │       │- Combat 1.9+ │         │              │
└──────────────┘   └──────────────┘       └──────────────┘         └──────────────┘
```

This report provides complete algorithmic specifications, mathematical scoring models, state machines, and testing blueprints for:
1. **Survival Loops**: Autonomous eating with saturation optimization and combat-safe pauses; sleeping with vanilla monster exclusion ($8$m horizontal, $5$m vertical); equipping with composite defense formula.
2. **Client Lifecycle**: Robust connection manager implementing `IMinecraftAgent`, handling server drops, respawns, status embedding, and subsystem mediation.
3. **Test Suite Architecture**: 5 comprehensive unit test suites ensuring 100% offline verification using in-memory mock Minecraft world and bot stubs.

---

## 2. Automated Survival Loops Specification

### 2.1 Auto-Eating Loop (`src/minecraft/loops/autoEat.ts`)

#### 2.1.1 Trigger Conditions & Minecraft Vanilla Mechanics
In Minecraft 1.9+ Java Edition:
- **Maximum Food**: 20 hunger points (10 food shanks).
- **Maximum Saturation**: Clamped to current food level (up to 20.0).
- **Rapid Health Regeneration**: Occurs when `food == 20` and `saturation > 0` (heals 1 HP every 0.5s, consuming saturation points).
- **Standard Health Regeneration**: Occurs when `food >= 18` (heals 1 HP every 4.0s, consuming 1.5 food points).
- **No Regeneration**: Occurs when `food <= 17`.
- **Sprint Disabled**: Occurs when `food <= 6`.
- **Starvation Damage**: Occurs when `food == 0` (takes 1 HP damage every 4s).

Accordingly, the auto-eat loop enforces the following trigger predicates:
1. **Hunger Threshold**: `bot.food <= 14` (7 food shanks or fewer). The bot should eat before sprinting is threatened.
2. **Healing Threshold**: `bot.health < 20.0 && bot.food <= 17`. When wounded, natural healing cannot proceed unless food is at least 18 (and ideally 20 to trigger rapid regeneration).
3. **Emergency Starvation Threshold**: `bot.food <= 6`. Critical status requiring immediate consumption of any available food, including conditional foods.

#### 2.1.2 Food Ranking & Scoring Algorithm
The food selector inspects all items in `bot.inventory.items()` and computes a score $S(item)$ based on nutrition, saturation, waste prevention, and health status:

$$\Delta_{\text{food}} = 20 - \text{bot.food}$$
$$S(item) = 1.5 \times \text{saturation} + 1.0 \times \text{foodPoints} - \text{WastePenalty} + \text{EmergencyBonus}$$

Where:
- $\text{WastePenalty} = \max(0, \text{foodPoints} - \Delta_{\text{food}}) \times 0.5$ (penalizes wasting hunger points unless healing).
- If $\text{bot.health} < 14.0$, saturation multiplier is increased from $1.5$ to $2.2$ because rapid healing rapidly exhausts saturation.
- Special Items:
  - `golden_apple`: $+50$ bonus if $\text{bot.health} \le 10.0$ (provides Regeneration II and Absorption).
  - `enchanted_golden_apple`: $+100$ bonus if $\text{bot.health} \le 6.0$.

#### 2.1.3 Food Blacklist & Safety Table

| Item Name | Food Points | Saturation | Policy | Rationale |
|-----------|-------------|------------|--------|-----------|
| `pufferfish` | 1 | 0.2 | **STRICT BLACKLIST** | Inflicts Poison IV (down to 1 HP), Nausea II, Hunger III |
| `spider_eye` | 2 | 3.2 | **STRICT BLACKLIST** | Inflicts Poison IV (4 seconds, loses 4 HP) |
| `poisonous_potato` | 2 | 1.2 | **STRICT BLACKLIST** | 60% chance Poison IV |
| `chorus_fruit` | 4 | 2.4 | **STRICT BLACKLIST** | Random 8-block teleportation; risks falling/lava |
| `suspicious_stew` | 6 | 7.2 | **STRICT BLACKLIST** | Random unknown potion effects (blindness, wither, poison) |
| `rotten_flesh` | 4 | 0.8 | **CONDITIONAL** | Inflicts Hunger 80% (drains 1.8 food). Blacklisted UNLESS starving (`bot.food <= 6`) |
| `raw_chicken` | 2 | 1.2 | **CONDITIONAL** | 30% chance Hunger effect. Deprioritized; only used if no safe food |
| `golden_carrot` | 6 | 14.4 | **TIER 1 (BEST)** | Highest non-magic saturation in game |
| `cooked_beef` / `cooked_porkchop` | 8 | 12.8 | **TIER 1** | Premier standard survival food |
| `golden_apple` | 4 | 9.6 | **TIER 1 (COMBAT)** | Emergency absorption & rapid regeneration |
| `cooked_mutton` / `cooked_salmon` | 6 | 9.6 | **TIER 2** | Excellent sustain food |
| `bread` / `baked_potato` | 5 | 6.0 | **TIER 2** | Standard staple food |
| `apple` / `carrot` | 4 / 3 | 2.4 / 3.6 | **TIER 3** | Low saturation, quick snacks |

#### 2.1.4 Safe Eating Pause & Combat Coordination
Eating requires 32 ticks ($\approx 1.61$ seconds) of continuous item holding. During eating:
- Movement speed is slowed by 80% (sneaking speed: 0.064 blocks/tick).
- The bot cannot swing a weapon or raise a shield.
- Any damage knockback or swinging can abort consumption.

**Combat-Safe Eating Algorithm**:
1. Check `isCombatCritical()`:
   - Identify if any hostile mob is within melee reach ($\le 4.0$m) and targeting/facing the bot.
2. If `isCombatCritical() === true`:
   - If $\text{bot.health} > 8.0$: **DEFER EATING**. Maintain weapon/shield, engage or kite threat first.
   - If $\text{bot.health} \le 8.0$ (dangerously low):
     - Trigger tactical retreat: issue pathfinding backpedal or jump behind cover ($\ge 5.0$m separation).
     - Once separation $> 4.5$m is established or cover is reached, execute consumption.
3. Execution sequence:
   - Save currently equipped main-hand item.
   - Call `await bot.equip(selectedFood, 'hand')`.
   - Call `await bot.consume()`.
   - Restore previous main-hand item (weapon or tool).
   - Enforce a 500ms debounce cooldown to prevent eating spam loops.

#### 2.1.5 Component Architecture (`src/minecraft/loops/autoEat.ts`)
```typescript
export interface AutoEatOptions {
  minFoodThreshold?: number;         // default: 14
  healthRegenFoodThreshold?: number; // default: 17
  starveThreshold?: number;          // default: 6
  checkIntervalMs?: number;          // default: 2000
  blacklist?: string[];              // harmful food item names
}

export class AutoEatLoop {
  private running = false;
  private isEating = false;
  private lastEatTime = 0;
  private checkTimer: NodeJS.Timeout | null = null;

  constructor(private bot: Bot, private options: AutoEatOptions = {}) {}

  public start(): void;
  public stop(): void;
  public async checkAndEat(): Promise<boolean>;
  public selectBestFood(): Item | null;
  public canSafelyEat(): boolean;
}
```

---

### 2.2 Auto-Sleeping Loop (`src/minecraft/loops/autoSleep.ts`)

#### 2.2.1 Trigger Conditions & Game Time Mechanics
In Minecraft vanilla mechanics:
- **Day Cycle**: 24,000 ticks total.
  - $0$ ticks = 06:00 (Dawn)
  - $6,000$ ticks = 12:00 (Noon)
  - $12,541$ ticks = 18:32 (Sunset / Earliest bed sleeping time)
  - $23,458$ ticks = 05:43 (Latest bed sleeping time)
- **Thunderstorm Exception**: Vanilla allows sleeping during thunderstorms at **any time of day** (`bot.thunderState > 0` or `(bot.isRaining && bot.thunderState > 0)`).
- **Dimension Safety**: Sleeping in the Nether or the End triggers catastrophic bed explosions ($r = 5$, damage up to 65 HP). Sleep must be **strictly prevented** unless `bot.game.dimension === 'overworld'`.

**Sleep Activation Predicate**:
$$\text{CanSleep} = (\text{dimension} == \text{'overworld'}) \land \left( (\text{timeOfDay} \ge 12541 \land \text{timeOfDay} \le 23458) \lor \text{thunderState} > 0 \right)$$

#### 2.2.2 Fair-Play Bed Scanning Algorithm
1. Query nearby blocks within a configured search radius (default 16–24 blocks horizontal, 6 blocks vertical).
2. Filter for bed block types (`white_bed`, `red_bed`, ..., or regex `/_bed$/`).
3. Apply fair-play visibility constraints:
   - Bed must be exposed to open air or situated inside a legitimate player-accessible enclosed space (not sealed inside bedrock or inaccessible solid underground cavities).
4. Verify bed occupancy:
   - Check block state `occupied !== true`.
   - Check that no player or villager entity is currently sleeping on or positioned directly above the bed.

#### 2.2.3 Vanilla Monster Exclusion Radius Check
In vanilla Minecraft, clicking a bed when hostile mobs are nearby fails with the message:
> *"You may not rest now, there are monsters nearby"*

The exact vanilla check checks an Axis-Aligned Bounding Box (AABB) centered on the bed:
- **Horizontal Reach**: 8 blocks in $X$ and $Z$ ($|x_{\text{mob}} - x_{\text{bed}}| \le 8$ and $|z_{\text{mob}} - z_{\text{bed}}| \le 8$, with Euclidean distance $\sqrt{\Delta x^2 + \Delta z^2} \le 8.0$).
- **Vertical Reach**: 5 blocks in $Y$ ($|y_{\text{mob}} - y_{\text{bed}}| \le 5.0$).

**Hostile Mob Registry**:
`zombie`, `skeleton`, `creeper`, `spider`, `cave_spider`, `enderman`, `witch`, `phantom`, `drowned`, `husk`, `stray`, `slime`, `zombified_piglin`, `pillager`, `vindicator`, `evoker`, `ravager`, `warden`, `wither_skeleton`.

**Algorithm**:
```typescript
function isBedSafeFromMonsters(bedPos: Vec3, bot: Bot): { safe: boolean; threats: Entity[] } {
  const threats: Entity[] = [];
  for (const entity of Object.values(bot.entities)) {
    if (!isHostileEntity(entity)) continue;
    const dx = Math.abs(entity.position.x - bedPos.x);
    const dz = Math.abs(entity.position.z - bedPos.z);
    const dy = Math.abs(entity.position.y - bedPos.y);
    if (dx <= 8.0 && dz <= 8.0 && dy <= 5.0) {
      threats.push(entity);
    }
  }
  return { safe: threats.length === 0, threats };
}
```
If threats are present:
- Abort sleep attempt.
- Do NOT spam sleep packets.
- Signal the combat subsystem or alert the user via Discord status that monsters prevent sleeping.

#### 2.2.4 Bed Navigation, Sleep Execution & Wake Lifecycle
1. If distance from bot eye to bed $> 4.5$m:
   - Engage pathfinder to navigate to adjacent block: `bot.pathfinder.goto(new GoalGetToBlock(bedPos.x, bedPos.y, bedPos.z))`.
2. Once within fair-play reach ($\le 4.5$m) and monster exclusion check passes:
   - Call `await bot.sleep(bedBlock)`.
   - Listen for `'sleep'` event. Set `bot.isSleeping = true`.
3. Sleeping State Monitoring:
   - Halt all movement and pathfinding.
   - Listen for `'wake'` event emitted by Mineflayer when dawn breaks (`timeOfDay < 12541` or weather clears).
   - If damaged while sleeping (`entityHurt` on bot), immediately trigger `await bot.wake()` and switch to combat/defense posture.

#### 2.2.5 Component Architecture (`src/minecraft/loops/autoSleep.ts`)
```typescript
export interface AutoSleepOptions {
  searchRadius?: number;        // default: 24
  checkIntervalMs?: number;     // default: 5000
}

export class AutoSleepLoop {
  private running = false;
  private isSleeping = false;
  private checkTimer: NodeJS.Timeout | null = null;

  constructor(private bot: Bot, private options: AutoSleepOptions = {}) {}

  public start(): void;
  public stop(): void;
  public async checkAndSleep(): Promise<boolean>;
  public findReachableBed(): Block | null;
  public isMonsterNearby(bedPos: Vec3): boolean;
  public async wakeUp(): Promise<void>;
}
```

---

### 2.3 Auto-Equipping Loop (`src/minecraft/loops/autoEquip.ts`)

#### 2.3.1 Inventory Equipment Slots & Categories
Minecraft equipment slots:
- `head`: helmets (`*_helmet`, `turtle_helmet`)
- `torso`: chestplates (`*_chestplate`, `elytra`)
- `legs`: leggings (`*_leggings`)
- `feet`: boots (`*_boots`)
- `hand`: main-hand weapons (`*_sword`, `*_axe`, `bow`, `crossbow`, `trident`)
- `off-hand`: shield (`shield`), totem of undying (`totem_of_undying`)

#### 2.3.2 Composite Defense Formula
Vanilla armor mechanics provide:
1. **Defense Points** ($D$): 1 point = 4% incoming damage reduction (max 20 points = 80%).
2. **Armor Toughness** ($T$): Reduces the armor penetration of heavy damage attacks. Diamond = 2/piece, Netherite = 3/piece.
3. **Knockback Resistance** ($K$): Netherite provides +1 (10%) per piece.
4. **Enchantment Protection Factor** ($EPF$):
   - `protection`: +1 EPF per level (reduces damage by $\text{EPF} \times 4\%$, capped at 80% / 20 EPF across all gear).
   - `projectile_protection`: +2 EPF vs arrows.
   - `blast_protection`: +2 EPF vs explosions.
   - `fire_protection`: +2 EPF vs fire.
5. **Durability & Utility**:
   - `unbreaking`: +100% effective durability per level.
   - `mending`: repairs durability with XP.

**Composite Armor Score Formula**:
$$\text{Score}_{\text{armor}} = (\text{MaterialTier} \times 25) + (D \times 10) + (T \times 8) + (K \times 5) + (E_{\text{prot}} \times 6) + (E_{\text{other}} \times 2) + \left(\frac{\text{durability}}{\text{maxDurability}} \times 2\right)$$

Where Material Tier values:
- `netherite` = 6
- `diamond` = 5
- `iron` = 4
- `chainmail` = 3
- `golden` = 2
- `leather` = 1

**Comparative Score Examples**:

| Armor Piece | Tier | Base Def | Toughness | Enchants | Durability | Calculated Score |
|-------------|------|----------|-----------|----------|------------|------------------|
| Netherite Chestplate Prot IV | 6 (150) | 8 (80) | 3 (24) | Prot IV (24) + K (5) | 100% (2) | **285.0** |
| Diamond Chestplate Prot IV | 5 (125) | 8 (80) | 2 (16) | Prot IV (24) | 100% (2) | **247.0** |
| Diamond Chestplate (Plain) | 5 (125) | 8 (80) | 2 (16) | None (0) | 100% (2) | **223.0** |
| Iron Chestplate Prot I | 4 (100) | 6 (60) | 0 (0) | Prot I (6) | 100% (2) | **168.0** |
| Iron Chestplate (Plain) | 4 (100) | 6 (60) | 0 (0) | None (0) | 100% (2) | **162.0** |
| Golden Chestplate | 2 (50) | 5 (50) | 0 (0) | None (0) | 100% (2) | **102.0** |
| Leather Tunic | 1 (25) | 3 (30) | 0 (0) | None (0) | 100% (2) | **57.0** |

#### 2.3.3 Weapon & Off-Hand Scoring
- **Main-Hand Weapon**:
  $$\text{Score}_{\text{weapon}} = (\text{BaseDamage} \times 10) + (\text{SharpnessLevel} \times 6) + (\text{FireAspectLevel} \times 3) + (\text{MaterialTier} \times 2)$$
  - Netherite Sword (8 base dmg) = 80 + 12 = 92
  - Diamond Sword (7 base dmg) = 70 + 10 = 80
  - Iron Sword (6 base dmg) = 60 + 8 = 68
  - Diamond Axe (9 base dmg, slower) = 90 + 10 = 100 (high burst)
- **Off-Hand Slot**:
  - `totem_of_undying` = 100 (resurrection guarantee)
  - `shield` = 80 (blocks 100% projectile & melee damage when raised)
  - Torches/Food = 10

#### 2.3.4 Execution & Anti-Thrashing Hysteresis
To prevent gear flapping (rapid repeated equipping of identical or near-identical items):
1. Compute the score of the currently equipped item in slot $S_{\text{current}}$.
2. Find the highest-scoring candidate item in inventory $S_{\text{candidate}}$.
3. Swap criterion:
   $$\text{Swap} \iff \text{slot is empty} \lor (S_{\text{candidate}} > S_{\text{current}} + \epsilon)$$
   Where $\epsilon = 1.0$ (hysteresis threshold preventing swaps for trivial differences).
4. Do not swap armor during an active combat swing or while sleeping.

#### 2.3.5 Component Architecture (`src/minecraft/loops/autoEquip.ts`)
```typescript
export interface AutoEquipOptions {
  checkIntervalMs?: number; // default: 2000
  enableWeapons?: boolean;  // default: true
  enableShield?: boolean;   // default: true
}

export class AutoEquipLoop {
  private running = false;
  private checkTimer: NodeJS.Timeout | null = null;

  constructor(private bot: Bot, private options: AutoEquipOptions = {}) {}

  public start(): void;
  public stop(): void;
  public async evaluateAndEquip(): Promise<void>;
  public calculateArmorScore(item: Item): number;
  public calculateWeaponScore(item: Item): number;
}
```

---

## 3. Minecraft Client Lifecycle Manager (`src/minecraft/client.ts`)

### 3.1 Interface Contract Implementation
`MinecraftClient` implements `IMinecraftAgent` defined in `src/minecraft/types.ts`:

```typescript
export interface IMinecraftAgent {
  connect(config: MinecraftConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): MinecraftBotStatus;
  canInteractWith(position: Vec3Location): boolean;
  findVisibleBlock(criteria: BlockSearchCriteria): Promise<VisibleBlock | null>;
  navigateTo(target: Vec3Location, options?: PathfindingOptions): Promise<ActionResult>;
  mineBlock(position: Vec3Location): Promise<ActionResult>;
  placeBlock(position: Vec3Location, blockName: string): Promise<ActionResult>;
  craftItem(recipeName: string, count: number): Promise<ActionResult>;
  attackEntity(entityId: number): Promise<ActionResult>;
  sleepInNearbyBed(): Promise<ActionResult>;
  sendChat(message: string): Promise<void>;
  on(event: 'chat', listener: (username: string, message: string) => void): void;
  on(event: 'statusUpdate', listener: (status: MinecraftBotStatus) => void): void;
  on(event: 'death', listener: (deathMessage?: string) => void): void;
  removeListener(event: string, listener: (...args: any[]) => void): void;
}
```

### 3.2 Connection Lifecycle State Machine

```
                 ┌───────────────┐
        ┌───────►│ DISCONNECTED  │◄──────────────┐
        │        └───────┬───────┘               │
        │                │ connect()             │
        │                ▼                       │
        │        ┌───────────────┐               │
        │        │  CONNECTING   │               │
        │        └───────┬───────┘               │
        │                │ 'spawn' event         │
        │                ▼                       │
 disconnect()    ┌───────────────┐         disconnect()
        │        │    SPAWNED    │               │
        │        │   (ONLINE)    │               │
        │        └───────┬───────┘               │
        │                │                       │
        │         'end' / 'kicked' / error       │
        │                ▼                       │
        │        ┌───────────────┐               │
        └────────┤ RECONNECTING  ├───────────────┘
                 │(Backoff Timer)│  max retries exceeded
                 └───────┬───────┘
                         │ backoff timer fires
                         ▼
                     connect()
```

### 3.3 Exponential Backoff with Jitter Formula
When an unexpected disconnection occurs (server restart, socket timeout, network blip):
1. Set `reconnecting = true`.
2. Compute delay using truncated exponential backoff with full jitter:
   $$T_{\text{base}} = \min(T_{\max}, T_{\text{initial}} \times 2^{\text{retryCount}})$$
   $$T_{\text{delay}} = T_{\text{base}} \times (1 - J + 2 \times J \times U)$$
   Where:
   - $T_{\text{initial}} = 1,000$ ms (1 second)
   - $T_{\max} = 30,000$ ms (30 seconds)
   - $J = 0.20$ (20% jitter range)
   - $U \sim \text{Uniform}(0, 1)$
   - $\text{maxRetries} = 5$ (configurable; 0 to disable auto-reconnect)
3. If `disconnect()` was intentionally called by user or coordinator, flag `intentionalDisconnect = true` and suppress all reconnect loops.
4. On successful `'spawn'` event: reset `retryCount = 0`.

### 3.4 Event Bridges
The client bridges Mineflayer bot events into standard `IMinecraftAgent` events:
- `'chat'`: Translates `(username, message)` -> passes to registered listeners, avoiding bot-echo and server command feedback.
- `'health'`: Updates `status.health` and `status.food`. Triggers `autoEat.checkAndEat()`. Emits throttled `statusUpdate`.
- `'death'`: Detects bot death. Emits `('death', deathMessage)`. Calls `bot.respawn()` after 1000ms delay.
- `'kicked'`: Captures kick reason string, logs security audit, transitions state, and schedules reconnect if unintentional.
- `'time'`: Triggers `autoSleep.checkAndSleep()` when sunset approaches.

### 3.5 Subsystem Orchestration & Concurrency Guard
The `MinecraftClient` hosts and synchronizes:
1. **Perception**: `Raycaster`, `ExposureFilter`, `FovFilter`.
2. **Fair-Play**: `ReachEnforcer` ($\le 4.5$m blocks, $\le 3.5$m entities), `CommandSanitizer` (blocks `/tp`, `/give`, `/gamemode`).
3. **Actions**: `PathfinderAction`, `MiningAction`, `InventoryAction`, `CraftingAction`, `CombatAction`.
4. **Loops**: `AutoEatLoop`, `AutoSleepLoop`, `AutoEquipLoop`.

**Action Concurrency Mutex**:
To avoid race conditions (e.g. mining a block while pathfinding, or eating while in the middle of a 3x3 crafting table session):
- Maintain `currentTask: string | null` and an internal promise mutex `actionLock`.
- Background survival loops (eat, sleep, equip) request non-blocking locks or wait until high-priority actions complete.
- Critical survival interrupts (emergency eating at $\le 6$ food, emergency panic retreat) can cancel low-priority pathfinding.

---

## 4. Milestone 2 Test Suite Architecture

To maintain 100% test reliability and zero external server dependencies, all Milestone 2 tests run in-memory using `mockMinecraft.ts`.

### 4.1 Mock Architecture (`test/mocks/mockMinecraft.ts`)
- **`MockWorld`**: 3D voxel grid mapping coordinates $(x, y, z)$ to mock block objects (`name`, `hardness`, `transparent`, `boundingBox`). Supports raycasting and adjacent face queries (+X, -X, +Y, -Y, +Z, -Z).
- **`MockMineflayerBot`**: Inherits from Node `EventEmitter`. Implements:
  - Properties: `entity.position`, `entity.yaw`, `entity.pitch`, `health`, `food`, `foodSaturation`, `time`, `thunderState`, `isSleeping`, `heldItem`.
  - Methods: `equip()`, `consume()`, `sleep()`, `wake()`, `dig()`, `placeBlock()`, `attack()`, `chat()`, `respawn()`.
  - Pathfinder emulation: `pathfinder.goto()`, `pathfinder.setMovements()`.

---

### 4.2 Test Suite 1: Survival Loops (`test/m2/survivalLoops.test.ts`)

| Test ID | Category | Scenario Description | Expected Outcome |
|---------|----------|----------------------|------------------|
| `TC-EAT-1` | AutoEat | Bot food drops to 14 with steak in inventory | Bot equips and consumes steak, restoring food |
| `TC-EAT-2` | AutoEat | Bot health drops to 16 with food at 17 | Bot triggers eating to enable natural regeneration |
| `TC-EAT-3` | AutoEat | Bot has food = 18 and health = 20 | Bot does NOT eat; maintains inventory |
| `TC-EAT-4` | AutoEat | Inventory has golden carrot, steak, and bread | Bot selects golden carrot (highest saturation score) |
| `TC-EAT-5` | AutoEat | Inventory contains pufferfish, spider eye, poisonous potato | Bot strictly refuses harmful foods; does not consume |
| `TC-EAT-6` | AutoEat | Bot has rotten flesh; food = 12 | Bot refuses rotten flesh (normal threshold) |
| `TC-EAT-7` | AutoEat | Bot has rotten flesh; food = 4 (starving) | Bot consumes rotten flesh as emergency survival fallback |
| `TC-EAT-8` | AutoEat | Hostile zombie within 2.5m attacking bot | Bot pauses eating; defers until combat clearance is established |
| `TC-EAT-9` | AutoEat | Bot consumes food while holding diamond sword | Bot equips food, consumes, and restores sword to main hand |
| `TC-SLP-1` | AutoSleep | World time reaches 12541 (sunset) with nearby bed | Bot navigates to bed and initiates sleep |
| `TC-SLP-2` | AutoSleep | Daytime (time = 6000) during thunderstorm (`thunderState > 0`) | Bot recognizes thunderstorm and sleeps in bed |
| `TC-SLP-3` | AutoSleep | Clear midday (time = 6000, no rain) | Bot ignores bed; does not attempt sleep |
| `TC-SLP-4` | AutoSleep | Dimension set to `the_nether` at time 13000 | Bot refuses to sleep (prevents bed explosion) |
| `TC-SLP-5` | AutoSleep | Bed is occupied by villager | Bot skips occupied bed; searches for vacant bed |
| `TC-SLP-6` | AutoSleep | Hostile skeleton at $dx=5, dz=4, dy=1$ of bed | Bot blocks sleep due to vanilla 8m/5m monster exclusion |
| `TC-SLP-7` | AutoSleep | Hostile mob at $dx=10$ ($> 8$m horizontal) | Bot passes exclusion check and sleeps successfully |
| `TC-SLP-8` | AutoSleep | Bot is sleeping; world time transitions to dawn (time = 0) | Bot wakes up automatically on dawn event |
| `TC-EQP-1` | AutoEquip | Inventory contains Iron Armor pieces; empty armor slots | Bot automatically equips helmet, chestplate, leggings, boots |
| `TC-EQP-2` | AutoEquip | Bot wearing Iron Chestplate; obtains Diamond Chestplate | Bot equips Diamond Chestplate (higher composite score) |
| `TC-EQP-3` | AutoEquip | Bot wearing Plain Diamond Chestplate; obtains Diamond Prot IV | Bot upgrades to Prot IV chestplate |
| `TC-EQP-4` | AutoEquip | Bot obtains Netherite Chestplate | Bot upgrades to Netherite (armor toughness & knockback bonus) |
| `TC-EQP-5` | AutoEquip | Inventory contains Wooden, Iron, and Diamond Swords | Bot equips Diamond Sword to main hand |
| `TC-EQP-6` | AutoEquip | Inventory contains Shield and Totem of Undying | Bot prioritizes Totem/Shield to off-hand |
| `TC-EQP-7` | AutoEquip | Inventory has two near-identical armor pieces ($\Delta < \epsilon$) | Bot avoids thrashing; does not oscillate gear |

---

### 4.3 Test Suite 2: Minecraft Client Lifecycle (`test/m2/client.test.ts`)

| Test ID | Category | Scenario Description | Expected Outcome |
|---------|----------|----------------------|------------------|
| `TC-CLI-1` | Lifecycle | Call `client.connect(config)` | Transitions `DISCONNECTED` -> `CONNECTING` -> `SPAWNED` |
| `TC-CLI-2` | Lifecycle | Call `client.disconnect()` | Cleanly tears down bot, cancels timers, state = `DISCONNECTED` |
| `TC-CLI-3` | Lifecycle | Server drops socket unexpectedly (`'end'` event) | State = `RECONNECTING`; schedules backoff reconnect |
| `TC-CLI-4` | Lifecycle | Exponential backoff delay calculation | Delays double ($1\text{s} \to 2\text{s} \to 4\text{s}$) with jitter bounded by 20% |
| `TC-CLI-5` | Lifecycle | Consecutive failures exceed max retries (5) | Reconnect loop terminates, logs error, state = `DISCONNECTED` |
| `TC-CLI-6` | Lifecycle | Reconnect succeeds on attempt 2 | Resets retry counter to 0 upon `'spawn'` event |
| `TC-CLI-7` | Lifecycle | Bot kicked with custom ban message | Emits kicked event, preserves kick reason, handles auto-reconnect |
| `TC-BRG-1` | Events | In-game player sends chat message | Bridges to `client.on('chat')` with correct username and message |
| `TC-BRG-2` | Events | Bot takes damage / changes health | Updates `getStatus().health` and emits `statusUpdate` |
| `TC-BRG-3` | Events | Bot dies (`'death'` event) | Emits `'death'`, updates status, schedules auto-respawn |
| `TC-BRG-4` | Events | Rapid status updates within 200ms | Throttles status emissions to prevent coordinator spam |
| `TC-ACT-1` | Coordination | `canInteractWith(pos)` for block at 3m with clear LOS | Returns `true` |
| `TC-ACT-2` | Coordination | `canInteractWith(pos)` for block at 5.2m ($> 4.5$m reach) | Returns `false` |
| `TC-ACT-3` | Coordination | `canInteractWith(pos)` for block behind solid stone wall | Returns `false` (LOS raycast obstruction) |
| `TC-ACT-4` | Coordination | `sendChat("/tp 0 100 0")` | Command sanitizer intercepts and blocks OP command |
| `TC-ACT-5` | Coordination | `sendChat("Hello players!")` | Sanitizer permits valid survival chat message |

---

### 4.4 Test Suite 3: Perception & Anti-Xray (`test/m2/perception.test.ts`)

| Test ID | Category | Scenario Description | Expected Outcome |
|---------|----------|----------------------|------------------|
| `TC-EXP-1` | Exposure | Block completely surrounded by 6 solid stone blocks | `isExposed === false` (Anti-Xray drops block) |
| `TC-EXP-2` | Exposure | Block with +Y face exposed to air | `isExposed === true` |
| `TC-EXP-3` | Exposure | Block adjacent to transparent glass or water | `isExposed === true` |
| `TC-RAY-1` | Raycast | Unobstructed raycast from eye $(0, 1.62, 0)$ to target $(3, 1.5, 0)$ | Ray reaches target; `hasLineOfSight === true` |
| `TC-RAY-2` | Raycast | Solid stone wall at $x = 2$ between eye $(0, 1.62, 0)$ and target $(4, 1.5, 0)$ | Ray intersects wall; `hasLineOfSight === false` |
| `TC-FOV-1` | FOV | Target at $(3, 1.62, 0)$ directly in forward look vector ($0^\circ$) | `isInFov === true` |
| `TC-FOV-2` | FOV | Target at $25^\circ$ angle ($< 35^\circ$ half-angle) | `isInFov === true` |
| `TC-FOV-3` | FOV | Target at $60^\circ$ angle at distance 4.0m ($> 35^\circ$ half-angle) | `isInFov === false` |
| `TC-FOV-4` | Tactile | Target at $180^\circ$ (directly behind bot) at distance 1.8m ($\le 2.5$m) | `isInFov === true` (Tactile fallback activates) |
| `TC-FOV-5` | Tactile | Target at $180^\circ$ directly behind bot at distance 3.2m ($> 2.5$m) | `isInFov === false` (Beyond tactile reach) |

---

### 4.5 Test Suite 4: Fair-Play Limits & Anti-Cheat (`test/m2/fairplay.test.ts`)

| Test ID | Category | Scenario Description | Expected Outcome |
|---------|----------|----------------------|------------------|
| `TC-RCH-1` | Reach | Block interaction distance = 4.2m | `checkBlockReach === true` |
| `TC-RCH-2` | Reach | Block interaction distance = 4.51m | `checkBlockReach === false` |
| `TC-RCH-3` | Reach | Entity combat attack distance = 3.2m | `checkEntityReach === true` |
| `TC-RCH-4` | Reach | Entity combat attack distance = 3.6m | `checkEntityReach === false` |
| `TC-SAN-1` | Sanitizer | Command `/tp player 100 64 200` | Intercepted & rejected with security warning |
| `TC-SAN-2` | Sanitizer | Command `/give @p diamond 64` | Intercepted & rejected |
| `TC-SAN-3` | Sanitizer | Command `/gamemode creative` | Intercepted & rejected |
| `TC-SAN-4` | Sanitizer | Disguised command `  /Op player  ` | Normalized, stripped, and rejected |
| `TC-SAN-5` | Sanitizer | Non-OP allowed command `/tell Alice Hi` | Permitted |

---

### 4.6 Test Suite 5: Actions & Combat (`test/m2/actions.test.ts`)

| Test ID | Category | Scenario Description | Expected Outcome |
|---------|----------|----------------------|------------------|
| `TC-NAV-1` | Pathfinder | Safe path to target coordinates | Navigates with `maxDropDown = 3`, `parkour = false` |
| `TC-NAV-2` | Pathfinder | Lava / hazard directly in path | Pathfinder penalizes hazard and plans path around it |
| `TC-MIN-1` | Mining | Mining Stone block with Wooden Pickaxe | Harvest check passes; dig completes |
| `TC-MIN-2` | Mining | Mining Diamond Ore with Wooden Pickaxe | Harvest tier check fails; refuses to break without Iron+ pickaxe |
| `TC-MIN-3` | Mining | Bot takes damage from mob while digging | Digging aborts immediately to enter defensive posture |
| `TC-CRF-1` | Crafting | Crafting Oak Planks from Oak Log (2x2 grid) | Crafts without crafting table |
| `TC-CRF-2` | Crafting | Crafting Wooden Pickaxe (3x3 grid) | Detects 3x3 requirement; navigates to crafting table |
| `TC-CBT-1` | Combat | 1.9+ weapon attack cooldown | Bot waits for 100% attack meter charge before swinging weapon |
| `TC-CBT-2` | Combat | Hostile arrow projectile incoming | Bot raises shield in off-hand to deflect |
| `TC-CBT-3` | Combat | Bot health drops to $< 6.0$ HP (critical) | Disengages and initiates tactical kiting retreat |

---

## 5. Integration Contracts & Cross-Subsystem Verification

### 5.1 Discord Live Status Embed Integration
The `MinecraftClient` generates data conforming directly to `MinecraftBotStatus`:
- `computeStateHash(status)` in `src/discord/embed.ts` tracks:
  - `health` (rounded to 0.5)
  - `food` (rounded to integer)
  - `position` and `dimension`
  - `currentTask` (e.g., `'Auto-Eating'`, `'Sleeping'`, `'Navigating'`)
  - `gear` (helmet, chestplate, leggings, boots, mainHand, offHand, armorSummary)
  - `inventory` (usedSlots, freeSlots, keyItemsSummary)
- When `AutoEquipLoop` upgrades armor from Iron to Diamond, `statusUpdate` emits the new gear summary, triggering an automatic Discord embed update without manual slash commands.

### 5.2 Chat Bridge Integration
- Messages arriving via `client.on('chat')` pass into `ChatBridge` (`src/bridge/chatBridge.ts`).
- `AntiLoopbackFilter` applies Lock 1 (bot username check), Lock 2 (prefix echo drop), and Lock 3 (10s SHA-256 deduplication).
- Clean player messages relay to Discord channel `bridge_chan_100`.

### 5.3 Gemini AI Planner Coordination
- High-level planner goals (`gatherResource`, `sleepInBed`, `goToCoordinates`) map to `MinecraftClient` action methods:
  - `client.navigateTo()`
  - `client.mineBlock()`
  - `client.craftItem()`
  - `client.sleepInNearbyBed()`
- If `AutoEatLoop` triggers while the AI planner is navigating, the client pauses movement, consumes food in 1.6s, and seamlessly resumes navigation without failing the planner step.

---

## 6. Verification & Implementation Roadmap

```
Step 1: Mock Infrastructure
  Implement test/mocks/mockMinecraft.ts (MockWorld, MockMineflayerBot)

Step 2: Fair-Play & Perception Core
  Implement src/minecraft/perception/ (exposure, raycast, fov)
  Implement src/minecraft/fairplay/ (reach, commandSanitizer)

Step 3: Action Engines
  Implement src/minecraft/actions/ (pathfinding, mining, inventory, crafting, combat)

Step 4: Survival Loops Core
  Implement src/minecraft/loops/autoEat.ts
  Implement src/minecraft/loops/autoSleep.ts
  Implement src/minecraft/loops/autoEquip.ts

Step 5: Client Lifecycle Manager
  Implement src/minecraft/client.ts (IMinecraftAgent, backoff reconnect, event bridges)

Step 6: Comprehensive M2 Verification
  Run vitest test/m2/ and verify 100% test pass rate with 0 network calls
```

---

## 7. Conclusion

This architecture provides a watertight, mathematically sound, and fully verifiable design for Milestone 2. By isolating offline testing via in-memory voxel simulation, enforcing vanilla survival mechanics (monster exclusion, saturation-first nutrition, composite defense formulas), and managing client lifecycles with robust backoff reconnects, the bot will achieve exceptional in-game resilience under strict fair-play rules.
