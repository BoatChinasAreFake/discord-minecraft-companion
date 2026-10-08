# Milestone 2 Technical Investigation: Minecraft Fair-Play Survival Engine (Action Subsystems)

## 1. Executive Summary & Architectural Scope

This report specifies the concrete algorithmic architecture, state machines, and mathematical models for the core Minecraft action engines within Milestone 2:
1. **Mineflayer Pathfinder Navigation** (`src/minecraft/actions/pathfinding.ts`)
2. **Block Interaction & Mining Engine** (`src/minecraft/actions/mining.ts`)
3. **Inventory Management & Crafting Engine** (`src/minecraft/actions/inventory.ts`, `src/minecraft/actions/crafting.ts`)
4. **Combat & Defensive System** (`src/minecraft/actions/combat.ts`)

All systems are strictly bounded by **Vanilla Fair-Play Survival Constraints** (`ORIGINAL_REQUEST.md`, `PROJECT.md` F18–F34):
- Zero server privileges / OP commands.
- Block interaction reach strictly clamped to $\le 4.50\text{ m}$ from the player's eye.
- Entity combat reach strictly clamped to $\le 3.50\text{ m}$ from the player's eye.
- Perception and action execution gated by 3D Line-of-Sight (LOS) raycasting.
- Adherence to standard Minecraft physics (fall damage avoidance, tool harvest tiers, 1.9+ weapon cooldowns, shield activation delays).

---

## 2. Mineflayer Pathfinder Navigation (`src/minecraft/actions/pathfinding.ts`)

### 2.1 Overview & Plugin Integration
The pathfinding engine wraps `mineflayer-pathfinder` (v2.4.5), exposing a safe, non-destructive, and stall-resilient navigation interface for the agent.

```
┌────────────────────────────────────────────────────────┐
│                   PathfindingManager                   │
├────────────────────────────────────────────────────────┤
│ - bot: Bot                                             │
│ - movements: Movements                                 │
│ - stallDetector: StallDetector                         │
│ - activeNavigationPromise: Promise<ActionResult> | null│
└───────────┬────────────────────────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────┐
│               mineflayer-pathfinder                    │
│  - Movements configuration (penalties & bounds)        │
│  - Goals: GoalBlock, GoalNear, GoalXZ, GoalFollow      │
│  - A* search engine & dynamic collision index          │
└────────────────────────────────────────────────────────┘
```

### 2.2 Safe Movement Configuration
In vanilla Minecraft, careless pathfinding can cause death from falling, drowning, lava immolation, or suffocating inside blocks. We instantiate a hardened `Movements` profile:

```typescript
const movements = new Movements(bot);

// 1. Fall Damage Prevention
// Falling 3 blocks deals 0 damage; falling 4 blocks deals 1 HP (half-heart).
// Strictly clamp maximum drop down distance:
movements.maxDropDown = 3;

// 2. Strict Grounded Navigation (No Parkour)
// Parkour jumps across 2-3 block gaps risk catastrophic failure during entity collision or latency.
movements.allowParkour = false;

// 3. Fair-Play Base Preservation (No Griefing / Pillaring)
movements.allow1by1towers = false;
movements.canDig = false; // Non-destructive navigation by default; digging enabled only during deliberate excavation

// 4. Fluid Hazard Prevention
movements.dontCreateFlow = true;             // Never break blocks supporting stationary lava/water
movements.dontMineUnderFallingBlock = true;   // Never step under unsupported gravel/sand
movements.infiniteLiquidDropdownDistance = false;
```

#### Hazard Block Blacklist & Exclusion Penalties
Hazardous blocks are registered in `movements.blocksToAvoid` and dynamically weighted in `movements.exclusionAreasStep`:

| Block Type | Inherent Danger | Avoidance Strategy |
|---|---|---|
| `lava`, `flowing_lava` | Fatal fire & drowning damage | Added to `blocksToAvoid` + 100 step penalty within 2 blocks |
| `fire`, `soul_fire` | Ignites player ($1\text{ HP}/\text{sec}$) | Added to `blocksToAvoid` |
| `cactus` | Contact damage ($1\text{ HP}$ per contact) | Added to `blocksToAvoid` |
| `sweet_berry_bush` | Movement slowdown & contact damage | Added to `blocksToAvoid` |
| `magma_block` | Thermal contact damage ($1\text{ HP}$ on stand) | Added to `blocksToAvoid` |
| `wither_rose` | Wither status effect | Added to `blocksToAvoid` |
| `campfire`, `soul_campfire` | Step contact damage | Added to `blocksToAvoid` |
| `powder_snow` | Freezing damage trap ($1\text{ HP}/2\text{sec}$) | Added to `blocksToAvoid` |

```typescript
// Dynamic Hazard Proximity Penalty in exclusionAreasStep
movements.exclusionAreasStep.push((block) => {
  // Check adjacent blocks (radius 1) for lava or open fire
  const neighbors = [
    block.position.offset(1, 0, 0),
    block.position.offset(-1, 0, 0),
    block.position.offset(0, 0, 1),
    block.position.offset(0, 0, -1),
  ];
  for (const pos of neighbors) {
    const adj = bot.blockAt(pos);
    if (adj && (adj.name.includes('lava') || adj.name.includes('fire'))) {
      return 150; // Heavy path cost penalty to maintain safety buffer
    }
  }
  return 0;
});
```

### 2.3 Navigation Goals
The engine translates high-level coordinates into specialized goals:
- `goals.GoalBlock(x, y, z)`: Used when the bot must stand directly upon a specific block.
- `goals.GoalNear(x, y, z, range)`: Used when approaching an interactive target (chest, crafting table, bed) within Euclidean distance `range` (default $3.0\text{ m}$).
- `goals.GoalXZ(x, z)`: Long-distance 2D horizontal transit (ignoring terrain elevation differences).
- `goals.GoalFollow(entity, range)`: Dynamic target tracking when following players or escorting mobs.

### 2.4 Stall & Obstruction Detection Algorithm
A common flaw in bot navigation is "running against an obstacle" in an endless loop due to unrecognized partial block obstructions (e.g., fence corners, carpets, vines, mobs).

#### Stall Detection State Machine:
$$\text{Displacement } \Delta D = \|\mathbf{P}_t - \mathbf{P}_{t - \Delta t}\|$$

```
   ┌────────────────────────────────────────────────────────┐
   │ Check every 500ms while bot.pathfinder.isMoving() === true│
   └───────────────────────────┬────────────────────────────┘
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
         ΔD >= 0.25 m                  ΔD < 0.25 m
        (Normal progress)             (Potential stall)
                │                             │
          Reset stall timer             stallDuration += 500ms
                                              │
                                              ▼
                                 stallDuration >= 3000ms?
                                        │
                                  ┌─────┴─────┐
                                 No          Yes
                                  │           │
                              Continue   Trigger Stall Recovery
```

#### Stall Recovery Protocol:
1. **Interrupt Navigation**: Halt active pathfinder movement (`bot.pathfinder.stop()`).
2. **Obstruction Clearance / Unstick Impulse**:
   - Check if an immediate block is directly in front of the bot's legs ($Y+0$) or torso ($Y+1$).
   - Execute small physical unstick maneuver:
     - Backpedal for 300ms: `bot.setControlState('back', true)`.
     - Jump impulse: `bot.setControlState('jump', true)`.
     - Clear control states after 350ms.
3. **Dynamic Exclusion Zone**:
   - Record the stuck voxel coordinate $\mathbf{B}_{\text{stuck}} = \lfloor \mathbf{P}_{\text{bot}} \rfloor$.
   - Add $\mathbf{B}_{\text{stuck}}$ to `movements.exclusionAreasStep` with an aversion weight ($+50$), preventing the A* pathfinder from attempting the exact same failed step.
4. **Retry Loop with Exponential Backoff**:
   - Limit retries to 3 attempts.
   - If `retryCount > 3`, terminate with graceful failure:
     `{ success: false, message: 'Navigation aborted: path blocked after 3 recovery attempts' }`.

---

## 3. Block Interaction & Mining Engine (`src/minecraft/actions/mining.ts`)

### 3.1 Legitimate Block Breaking & Harvest Tiers
In Minecraft, breaking an ore with an insufficient tool tier results in **zero item drops** (destroying the resource). The mining engine must enforce strict harvest requirements.

#### Complete Harvest Tier Matrix:

| Block Name | Required Tool Type | Minimum Harvest Tier | Drops If Broken With Bare Hand? |
|---|---|---|---|
| `dirt`, `sand`, `gravel`, `clay` | Shovel (optional) | `none` (0) | Yes |
| `oak_log`, `stone_axe` (all woods) | Axe (optional) | `none` (0) | Yes |
| `stone`, `cobblestone`, `sandstone` | Pickaxe | `wooden` (1) | No (drops nothing without pickaxe) |
| `coal_ore`, `deepslate_coal_ore` | Pickaxe | `wooden` (1) | No |
| `nether_quartz_ore` | Pickaxe | `wooden` (1) | No |
| `iron_ore`, `deepslate_iron_ore` | Pickaxe | `stone` (2) | No |
| `copper_ore`, `deepslate_copper_ore`| Pickaxe | `stone` (2) | No |
| `lapis_ore`, `deepslate_lapis_ore` | Pickaxe | `stone` (2) | No |
| `gold_ore`, `deepslate_gold_ore` | Pickaxe | `iron` (3) | No |
| `redstone_ore`, `deepslate_redstone_ore`| Pickaxe | `iron` (3) | No |
| `diamond_ore`, `deepslate_diamond_ore` | Pickaxe | `iron` (3) | No |
| `emerald_ore`, `deepslate_emerald_ore` | Pickaxe | `iron` (3) | No |
| `obsidian`, `crying_obsidian` | Pickaxe | `diamond` (4) | No |
| `ancient_debris`, `respawn_anchor` | Pickaxe | `diamond` (4) | No |

#### Tool Tier Hierarchy:
$$\text{Tier Rank}: \quad \text{none} (0) < \text{wooden/golden} (1) < \text{stone} (2) < \text{iron} (3) < \text{diamond} (4) < \text{netherite} (5)$$

#### Anti-Waste Tool Verification Algorithm:
```typescript
function canSafelyHarvest(block: Block, inventory: Item[]): { canHarvest: boolean; toolToEquip: Item | null; reason?: string } {
  const req = getHarvestRequirement(block.name);
  if (!req.requiresTool) {
    // Can be mined with bare hands or any tool
    const bestTool = findFastestTool(block, inventory);
    return { canHarvest: true, toolToEquip: bestTool };
  }

  // Find tools in inventory matching the required tool type
  const matchingTools = inventory.filter(item => getToolType(item.name) === req.toolType);
  const eligibleTools = matchingTools.filter(tool => getToolTierRank(tool.name) >= req.minTierRank);

  if (eligibleTools.length === 0) {
    return {
      canHarvest: false,
      toolToEquip: null,
      reason: `Cannot harvest ${block.name}: requires a ${req.toolType} of tier >= ${req.minTierName}. Mining would destroy the block without dropping items.`
    };
  }

  // Pick the tool with highest efficiency/tier
  eligibleTools.sort((a, b) => getToolTierRank(b.name) - getToolTierRank(a.name));
  return { canHarvest: true, toolToEquip: eligibleTools[0] };
}
```

### 3.2 Fair-Play Line-of-Sight & Reach Checks
Before digging any block, two strict verification checks must pass:

1. **Survival Reach Clamp ($\le 4.50\text{ m}$)**:
   $$\mathbf{E} = \mathbf{P}_{\text{bot}} + (0, h_{\text{eye}}, 0), \quad h_{\text{eye}} = 1.62\text{ m}$$
   $$\mathbf{C}_{\text{block}} = \mathbf{P}_{\text{block}} + (0.5, 0.5, 0.5)$$
   $$d = \|\mathbf{C}_{\text{block}} - \mathbf{E}\| \le 4.50\text{ m}$$
   If $d > 4.50$, the bot refuses to dig directly and triggers pathfinding to approach to within $3.0\text{ m}$.

2. **3D Line-of-Sight Raycasting**:
   - The bot casts a ray from $\mathbf{E}$ towards the visible exposed faces of the target block.
   - Using Amanatides & Woo 3D DDA (`bot.world.raycast`):
     - If the ray encounters an opaque solid block before intersecting the target block:
       **REJECT DIG**: Target is behind a solid wall (anti-xray constraint).

### 3.3 Digging Interrupt Handling
During the multi-second duration of `bot.dig(block)`, real-time events can endanger the bot. We establish an active event guard:

```
                        bot.dig(block) Active
                                  │
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
     Mob Hurt /              Hostile Mob             Falling Block
    Health Drop           Closes to <= 3.5m         (Gravel/Sand above)
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  ▼
                         bot.stopDigging()
                         - Emit cancel packet
                         - Equip weapon / shield
                         - Abort digging task
```

- **Mob Damage**: Listen to `bot.on('entityHurt')`. If hurt entity is `bot.entity`, immediately call `bot.stopDigging()` and switch to defensive combat.
- **Hostile Proximity**: If a creeper, skeleton, or zombie enters $\le 3.5\text{ m}$, stop digging immediately.
- **Falling Blocks**: Check the block at $\mathbf{P}_{\text{block}} + (0, 1, 0)$. If it is `sand` or `gravel` and the bot is standing below it, abort or dig the falling block from a safe side position to avoid suffocation.

---

## 4. Inventory Management & Crafting Engine (`src/minecraft/actions/inventory.ts`, `src/minecraft/actions/crafting.ts`)

### 4.1 Window & Slot Architecture
In Mineflayer/Prismarine, the player inventory window (window ID 0) consists of 46 distinct slots:

```
┌──────────────────────────────────────────────────────────────┐
│                  Player Window (Window ID 0)                 │
├──────────────────────────────┬───────────────────────────────┤
│ Slot 0                       │ 2x2 Crafting Result           │
│ Slots 1 - 4                  │ 2x2 Crafting Input Grid       │
│ Slots 5 - 8                  │ Armor (5:Head, 6:Chest, 7:Legs, 8:Feet)│
│ Slots 9 - 35 (27 slots)      │ Main Storage Inventory        │
│ Slots 36 - 44 (9 slots)      │ Hotbar / Quickbar             │
│ Slot 45                      │ Off-hand (Shield / Food)      │
└──────────────────────────────┴───────────────────────────────┘
```

Total accessible storage slots = $27\text{ (main)} + 9\text{ (hotbar)} = 36$ slots.

#### Inventory Management Interface:
- `getInventoryStatus()`: Returns `totalSlots (36)`, `usedSlots`, `freeSlots`, equipped armor names, held main-hand item, and off-hand item.
- `countItem(itemName)`: Total count across slots 9–45.
- `findItem(itemName)`: First matching `Item` instance.
- `equip(item, destination)`: Supports `'hand'`, `'off-hand'`, `'head'`, `'torso'`, `'legs'`, `'feet'`.

### 4.2 2x2 vs 3x3 Crafting Detection
Crafting recipes are classified into two categories:

1. **Player 2x2 Crafting Grid**:
   - Condition: Recipe bounding box width $\le 2$, height $\le 2$, and `recipe.requiresTable === false`.
   - Examples:
     - `oak_log` $\to$ 4 `oak_planks` (1x1)
     - 2 `oak_planks` $\to$ 4 `stick` (1x2)
     - 4 `oak_planks` $\to$ 1 `crafting_table` (2x2)
     - 1 `coal` + 1 `stick` $\to$ 4 `torch` (1x2)
   - Executed directly inside `bot.inventory` without external block interactions.

2. **Crafting Table 3x3 Grid**:
   - Condition: `recipe.requiresTable === true` or recipe dimensions exceed $2\times 2$.
   - Examples: All pickaxes, swords, axes, chests, furnaces, doors, buckets.
   - Requirements:
     - Must locate or place an active `crafting_table` block within $\le 4.50\text{ m}$.
     - Open the crafting table window (`bot.openBlock(tableBlock)`).
     - Execute `bot.craft(recipe, count, tableBlock)`.
     - Close window (`window.close()`).

### 4.3 Recursive Recipe Decomposition Algorithm
When an agent is commanded to craft an advanced item (e.g., `wooden_pickaxe`) while only possessing raw logs, the system must decompose the recipe recursively into prerequisite crafts.

```
                  ┌──────────────────────┐
                  │ Target: wooden_pickaxe│
                  └──────────┬───────────┘
                             │ Requires: 3 planks + 2 sticks + Crafting Table (3x3)
              ┌──────────────┴──────────────┐
              ▼                             ▼
       3 oak_planks                     2 sticks
              │                             │ Requires: 2 planks
              │                      ┌──────┴──────┐
              │                      ▼             ▼
              │                 2 oak_planks   (craft in 2x2)
              │                      │
              └──────────────┬───────┘
                             │
                             ▼
                Total Planks: 5 (+ 4 if Crafting Table needed = 9)
                             │
                             ▼
                Raw Resource: 3 oak_logs (3 * 4 = 12 planks)
```

#### Topological Recipe Planning Algorithm:
```typescript
interface CraftStep {
  recipeName: string;
  outputItem: string;
  count: number;
  requiresTable: boolean;
}

interface DecompositionResult {
  canCraft: boolean;
  missingRawMaterials: Array<{ item: string; count: number }>;
  executionPlan: CraftStep[];
}

function decomposeRecipe(targetItem: string, targetCount: number, botInventory: InventorySnapshot): DecompositionResult {
  const plan: CraftStep[] = [];
  const virtualInventory = botInventory.clone();
  const missingMaterials = new Map<string, number>();

  function resolve(item: string, neededCount: number): boolean {
    const available = virtualInventory.count(item);
    if (available >= neededCount) {
      virtualInventory.consume(item, neededCount);
      return true;
    }

    const deficit = neededCount - available;
    virtualInventory.consume(item, available);

    // Find recipes that produce `item`
    const recipe = getBaseRecipe(item);
    if (!recipe) {
      // Base raw material cannot be crafted
      missingMaterials.set(item, (missingMaterials.get(item) ?? 0) + deficit);
      return false;
    }

    const craftsNeeded = Math.ceil(deficit / recipe.resultCount);
    for (const ingredient of recipe.ingredients) {
      const ingredientNeeded = ingredient.count * craftsNeeded;
      const success = resolve(ingredient.name, ingredientNeeded);
      if (!success) return false;
    }

    plan.push({
      recipeName: recipe.name,
      outputItem: item,
      count: craftsNeeded,
      requiresTable: recipe.requiresTable,
    });
    virtualInventory.add(item, craftsNeeded * recipe.resultCount - deficit);
    return true;
  }

  const success = resolve(targetItem, targetCount);
  return {
    canCraft: success && missingMaterials.size === 0,
    missingRawMaterials: Array.from(missingMaterials.entries()).map(([item, count]) => ({ item, count })),
    executionPlan: plan, // Ordered topologically from base crafts to target craft
  };
}
```

### 4.4 Container Deposit & Withdraw Engine
- **Container Types**: `chest`, `trapped_chest`, `barrel`, `shulker_box`.
- **Fair-Play Sneak Protocol**:
  - In vanilla Minecraft, clicking on a container while holding a block or tool will inadvertently open the container instead of placing against it, unless the player is sneaking (`bot.setControlState('sneak', true)`).
  - Conversely, to open a container legitimately: verify sneak is `false`, check reach $\le 4.50\text{ m}$ and line of sight, and open with `bot.openContainer(block)`.
- **Atomic Transaction Integrity**:
  - `deposit(block, item, count)` and `withdraw(block, item, count)` are wrapped in `try ... finally` blocks guaranteeing that `window.close()` is always invoked, avoiding container window desyncs.

---

## 5. Combat & Defensive System (`src/minecraft/actions/combat.ts`)

### 5.1 Target Acquisition & Combat Reach Limits
- **Target Reach Clamp**: Strictly clamped to $\le 3.50\text{ m}$ from the bot's eye position to the target entity's collision box.
- **Line-of-Sight Check**: Raycast from eye position to entity center ($Y + \frac{h}{2}$) and eye level ($Y + h_{\text{eye}}$). If obscured by solid voxels, melee attacks are prohibited.
- **Threat Prioritization Hierarchy**:
  1. **Creeper within 4.0 m**: Immediate detonation danger (Priority 1: Kiting/retreat).
  2. **Skeleton with bow aiming at bot**: High projectile damage (Priority 2: Shield block & rush).
  3. **Melee hostiles within 3.5 m** (Zombie, Spider, Enderman) (Priority 3: Timed attack).
  4. **Distant hostiles (> 3.5 m)** (Priority 4: Approach or avoid).

### 5.2 Combat 1.9+ Weapon Attack Cooldown Engine
Since Minecraft 1.9, attacking rapidly ("spam clicking") incurs severe penalties:
$$\text{Damage Multiplier} = 0.2 + 0.8 \times \left(\min\left(1.0, \frac{\Delta t}{T}\right)\right)^2$$
Attacking immediately after a swing deals only **20% damage**, incurs zero weapon knockback, and disables the Sweeping Edge area-of-effect attack.

#### Attack Speed & Period Table ($T = \frac{1000}{S}\text{ ms}$):

| Weapon Type | Generic Attack Speed ($S$) | Full Cooldown Period ($T$) | Damage at Full Gauge |
|---|---|---|---|
| All Swords (Wood to Netherite) | $1.6\text{ attacks/sec}$ | $625\text{ ms}$ ($12.5\text{ ticks}$) | 100% + Sweeping Edge |
| Netherite / Diamond Axe | $1.0\text{ attacks/sec}$ | $1000\text{ ms}$ ($20\text{ ticks}$) | 100% + High Base Damage |
| Iron Axe | $0.9\text{ attacks/sec}$ | $1111\text{ ms}$ ($22.2\text{ ticks}$) | 100% |
| Stone / Wooden Axe | $0.8\text{ attacks/sec}$ | $1250\text{ ms}$ ($25\text{ ticks}$) | 100% |
| Pickaxes (all tiers) | $1.2\text{ attacks/sec}$ | $833\text{ ms}$ ($16.6\text{ ticks}$) | 100% |
| Shovels (all tiers) | $1.0\text{ attacks/sec}$ | $1000\text{ ms}$ ($20\text{ ticks}$) | 100% |
| Fists / Unarmed | $4.0\text{ attacks/sec}$ | $250\text{ ms}$ ($5\text{ ticks}$) | 100% |

#### Cooldown Timing & Attack Loop:
```typescript
class CombatCooldownController {
  private lastAttackTimestamp = 0;

  public getCooldownPeriodMs(heldItemName?: string): number {
    if (!heldItemName) return 250; // Bare hand: 4.0 attacks/sec
    if (heldItemName.includes('sword')) return 625; // 1.6 attacks/sec
    if (heldItemName.includes('netherite_axe') || heldItemName.includes('diamond_axe')) return 1000;
    if (heldItemName.includes('iron_axe')) return 1111;
    if (heldItemName.includes('stone_axe') || heldItemName.includes('wooden_axe')) return 1250;
    if (heldItemName.includes('pickaxe')) return 833;
    if (heldItemName.includes('shovel')) return 1000;
    return 250;
  }

  public async awaitFullGauge(heldItemName?: string): Promise<void> {
    const period = this.getCooldownPeriodMs(heldItemName);
    const elapsed = Date.now() - this.lastAttackTimestamp;
    if (elapsed < period) {
      await sleep(period - elapsed);
    }
  }

  public recordAttack(): void {
    this.lastAttackTimestamp = Date.now();
  }
}
```

### 5.3 Defensive Shield Mechanics
- **Activation Delay**: In vanilla Minecraft, shields take $5\text{ ticks}$ ($250\text{ ms}$) after right-clicking (`bot.activateItem()`) to enter the blocking state.
- **Directional Arc**: A shield blocks 100% of physical and projectile damage over a $180^\circ$ forward cone:
  $$\hat{\mathbf{v}}_{\text{look}} \cdot \frac{\mathbf{P}_{\text{threat}} - \mathbf{P}_{\text{bot}}}{\|\mathbf{P}_{\text{threat}} - \mathbf{P}_{\text{bot}}\|} \ge 0$$
  The bot must look directly at the threat:
  `await bot.lookAt(threat.position.offset(0, threat.height * 0.8, 0), true);`
- **Hit-and-Block Rotation**:
  1. Attack mob with full cooldown weapon swing.
  2. Immediately raise shield during the weapon recharge window ($625\text{ ms}$ for swords).
  3. Lower shield $100\text{ ms}$ before cooldown completion, verify reach $\le 3.50\text{ m}$, and swing again.
- **Projectile Interception**:
  - Detect incoming arrow entities within $12\text{ m}$ whose velocity vector points toward the bot.
  - Instantly face incoming trajectory and raise shield.

### 5.4 Tactical Retreat & Kiting (< 6 HP / 3 hearts)
When health drops below $6.0\text{ HP}$ ($3\text{ hearts}$), the bot enters **Emergency Survival Mode**:

1. **Offensive Abort**: Cease all melee attacks immediately.
2. **Repulsion Vector Calculation**:
   Calculate a safety destination directed away from all nearby hostile mobs:
   $$\mathbf{R}_{\text{retreat}} = \sum_{m \in \text{Hostiles}} \frac{\mathbf{P}_{\text{bot}} - \mathbf{P}_m}{\|\mathbf{P}_{\text{bot}} - \mathbf{P}_m\|^2}$$
   $$\mathbf{P}_{\text{safe}} = \mathbf{P}_{\text{bot}} + 16 \times \frac{\mathbf{R}_{\text{retreat}}}{\|\mathbf{R}_{\text{retreat}}\|}$$
3. **Sprint Navigation**:
   - Issue pathfinding goal: `bot.pathfinder.setGoal(new GoalNear(safePos.x, safePos.y, safePos.z, 2))`.
   - Enable sprinting: `bot.setControlState('sprint', true)`.
4. **Saturation Eating**:
   - Signal `AutoEatLoop` to prioritize high-saturation food (Golden Apple, Steak, Cooked Porkchop).

---

## 6. Offline Mock Architecture Compatibility (`test/mocks/mockMinecraft.ts`)

To support 100% offline testing without external Minecraft servers, all action modules interact with Mineflayer via standard properties and events that are easily mocked:

| Action Subsystem | Required Mock Bot Interfaces |
|---|---|
| **Pathfinding** | `bot.pathfinder` stub (`goto`, `setGoal`, `stop`, `isMoving`), `bot.entity.position`, `bot.setControlState` |
| **Mining** | `bot.dig(block)`, `bot.stopDigging()`, `bot.blockAt(pos)`, `bot.world.raycast`, `bot.equip`, `bot.entity.eyeHeight` |
| **Inventory & Crafting** | `bot.inventory` (Window with slots 0-45), `bot.craft`, `bot.openBlock`, `bot.openContainer`, `window.deposit`, `window.withdraw` |
| **Combat** | `bot.attack(entity)`, `bot.activateItem()`, `bot.deactivateItem()`, `bot.lookAt`, `bot.entities`, `bot.health` |

---

## 7. Concrete Test Strategy for Milestone 2 Actions

The following test suites should be constructed to validate all four action modules:

### 1. `test/m2/pathfinding.test.ts`
- `TC-NAV-1`: Movement configuration enforces `maxDropDown = 3`, `allowParkour = false`, `allow1by1towers = false`.
- `TC-NAV-2`: Step exclusion correctly penalizes lava and hazardous blocks.
- `TC-NAV-3`: GoalBlock and GoalNear correctly resolve coordinates within range.
- `TC-NAV-4`: Stall detection triggers unstick impulse after 3 seconds of zero displacement.
- `TC-NAV-5`: Exceeding 3 retries terminates navigation with descriptive error.

### 2. `test/m2/mining.test.ts`
- `TC-MINE-1`: Rejects mining diamond ore when only a stone pickaxe is available (prevents ore loss).
- `TC-MINE-2`: Enforces fair-play reach clamp $\le 4.50\text{ m}$.
- `TC-MINE-3`: Rejects mining when raycast detects solid wall obstruction.
- `TC-MINE-4`: Interrupts active digging when bot takes entity damage (`entityHurt`).
- `TC-MINE-5`: Successfully selects and equips the best available harvest tool before breaking block.

### 3. `test/m2/inventory_crafting.test.ts`
- `TC-CRAFT-1`: Correctly identifies 2x2 recipes (planks, sticks, torches) vs 3x3 table recipes (pickaxes, swords).
- `TC-CRAFT-2`: Recursively decomposes `wooden_pickaxe` into 3 logs and outputs topological craft steps.
- `TC-CRAFT-3`: Accurately reports missing base resources when crafting requirements are unmet.
- `TC-INV-1`: Tracks inventory slots, used slots, free slots, armor, and offhand accurately.
- `TC-INV-2`: Executes container deposit/withdraw transactions with reach verification and safe window closure.

### 4. `test/m2/combat.test.ts`
- `TC-COMBAT-1`: Enforces combat reach clamp $\le 3.50\text{ m}$.
- `TC-COMBAT-2`: Delays sword swing by $\ge 625\text{ ms}$ to respect 1.9+ attack cooldown for 100% damage.
- `TC-COMBAT-3`: Raises shield during weapon recharge delay and lowers before swing.
- `TC-COMBAT-4`: Rotates bot to face projectile source upon incoming arrow detection.
- `TC-COMBAT-5`: Triggers tactical retreat / sprint-kiting when bot health drops below 6.0 HP.
