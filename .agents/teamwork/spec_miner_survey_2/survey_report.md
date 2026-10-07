# Requirement R2 Technical Specification: Minecraft Gameplay Agent Engine & Fair-Play Constraints

**Author**: `spec_miner_survey_2` (Teamwork Specification Miner)  
**Target Milestone**: Milestone 2 (Minecraft Fair-Play Survival Engine) & Test Harness  
**Authoritative References**: Minecraft Java Edition Protocol, Mineflayer 4.x, `prismarine-world`, `prismarine-block`, `mineflayer-pathfinder`, `mineflayer-armor-manager`, vanilla survival physics constants.

---

## 1. Executive Summary & Scope

Requirement R2 mandates the design and implementation of a Minecraft client agent in TypeScript/Mineflayer that connects to standard Minecraft Java Edition servers and operates **strictly as a legitimate survival player**. The core imperative is **Fair-Play and Anti-Cheat Integrity**: under no circumstances may the bot leverage raw server-sent chunk memory to perform X-Ray inspection, execute privileged server operator commands, or bypass standard survival physical constraints (such as reach, line-of-sight, field-of-view, or gravity).

This specification details:
1. **Strict Fair-Play & Anti-Cheat Engine (MANDATORY)**:
   - Surface exposure checks and 3D Line-of-Sight (LOS) raycasting algorithms.
   - Field of view (FOV) and peripheral perception modeling.
   - Standard physical interaction reach ($\le 4.5$ blocks for blocks, $\le 3.5$ blocks for entities) and survival movement physics.
   - Command sanitization and complete prohibition of OP commands (`/tp`, `/give`, `/gamemode`, etc.).
2. **Foundational Gameplay Capabilities**:
   - `mineflayer-pathfinder` integration, safe traversal, obstacle avoidance, and goal validation.
   - Legitimate block mining, optimal tool selection, and block placement.
   - Inventory inspection, container manipulation (chests/furnaces), and 2x2/3x3 crafting.
   - Combat, hostile mob line-of-sight detection, weapon cooldown timing, off-hand shielding, and tactical retreat.
3. **Automated Survival Loops**:
   - Auto-eating with nutritional/saturation optimization and poison exclusion.
   - Auto-sleeping respecting day/night cycles, thunderstorms, and monster proximity.
   - Auto-equipping with composite armor defense scoring and off-hand tool/shield management.
4. **Error Handling & Emergency Recovery**:
   - Path stalls, tool depletion, drowning recovery, suffocation escape, and lava/fire mitigation.
5. **Testability & Mocking Architecture**:
   - 100% offline, deterministic CI/local test harness utilizing in-memory `prismarine-world` voxel fixtures and mock protocol streams.

---

## 2. Strict Fair-Play & Anti-Cheat Engine (MANDATORY)

### 2.1 Perception Limitations: Anti-Xray & Line-of-Sight Raycasting

In vanilla Minecraft Java servers, the server transmits full chunk voxel data within the player's render distance (typically 8 to 16 chunks in radius). While this data exists in the client's memory (`bot.world`), human players can only see blocks that are exposed to open air/transparent medium and directly visible without intervening opaque obstacles.

Directly calling `bot.findBlock()` across loaded chunks without visibility validation constitutes **X-Ray cheating** (e.g. locating diamond ore buried under 20 layers of solid stone). The agent MUST enforce the following 3-step perception pipeline before any block can be recognized, targeted, or added to the agent's spatial memory.

```
+----------------------------------------------------------------------------------+
|                           CANDIDATE BLOCK IN CHUNK                               |
+----------------------------------------------------------------------------------+
                                         |
                                         v
+----------------------------------------------------------------------------------+
| Step 1: Surface Exposure Check                                                   |
| Does at least one of 6 adjacent faces touch an air/transparent/passable block?   |
| (Up, Down, North, South, East, West)                                             |
+----------------------------------------------------------------------------------+
                                         |
                     [No]                | [Yes]
       +---------------------------------+--------------------------------+
       |                                                                  |
       v                                                                  v
+--------------+                                        +----------------------------------+
| DISCARD:     |                                        | Step 2: Line-of-Sight (LOS)      |
| Fully buried |                                        | Fast 3D Voxel Raycast            |
| (X-Ray block)|                                        | From Eye to Exposed Face Center  |
+--------------+                                        +----------------------------------+
                                                                          |
                                                      [Occluded by solid] | [Unobstructed]
                                        +---------------------------------+----------------+
                                        |                                                  |
                                        v                                                  v
                                 +--------------+                               +--------------------+
                                 | DISCARD:     |                               | Step 3: FOV & Range|
                                 | Occluded     |                               | Distance <= 32m    |
                                 | by wall/stone|                               | In FOV or near-scan|
                                 +--------------+                               +--------------------+
                                                                                           |
                                                                                           v
                                                                                +--------------------+
                                                                                | LEGITIMATE TARGET  |
                                                                                +--------------------+
```

#### Step 1: Surface Exposure Check (Face Adjacency)
A solid block is completely hidden if all 6 neighbor positions are full opaque solid blocks.
- **Definition**: Let block $B$ be at integer coordinates $(x, y, z)$.
- Neighbor offsets $\mathcal{N} = \{(0, 1, 0), (0, -1, 0), (1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1)\}$.
- Let $\text{IsPassableOrTransparent}(b)$ return `true` if:
  - $b.\text{boundingBox} == \text{'empty'}$ (air, cave_air, void_air), OR
  - $b.\text{transparent} == \text{true}$ (glass, ice, stained_glass, water, leaves), OR
  - $b$ is non-full-cube (torches, slabs, stairs, doors, signs, carpets, rails).
- A block $B$ has exposed faces $\mathcal{F}_{\text{exp}} = \{ \vec{n} \in \mathcal{N} \mid \text{IsPassableOrTransparent}( \text{blockAt}(B.\text{pos} + \vec{n}) ) \}$.
- If $|\mathcal{F}_{\text{exp}}| == 0$, $B$ is completely enclosed in solid rock/earth. **Immediately reject $B$.**

#### Step 2: Line-of-Sight (LOS) 3D Raycasting
Even if an ore block is exposed inside an underground ravine or cavern 20 meters away, a player standing on the surface above cannot see it because opaque stone blocks lie in between.
- **Eye Origin**:
  $$\vec{P}_{\text{eye}} = \vec{P}_{\text{bot}} + \begin{pmatrix} 0 \\ H_{\text{eye}} \\ 0 \end{pmatrix}$$
  where $H_{\text{eye}} = 1.62$ blocks (standing), $1.27$ blocks (sneaking/crouching), or $0.40$ blocks (swimming/crawling).
- **Target Point Selection**:
  For each exposed normal $\vec{n} \in \mathcal{F}_{\text{exp}}$, the target sample point is the center of the exposed face:
  $$\vec{P}_{\text{face}} = B.\text{pos} + \begin{pmatrix} 0.5 \\ 0.5 \\ 0.5 \end{pmatrix} + 0.5 \cdot \vec{n}$$
- **Raycast Traversal**:
  Compute ray direction $\vec{D} = \frac{\vec{P}_{\text{face}} - \vec{P}_{\text{eye}}}{\|\vec{P}_{\text{face}} - \vec{P}_{\text{eye}}\|}$ and distance $L = \|\vec{P}_{\text{face}} - \vec{P}_{\text{eye}}\|$.
  Execute Amanatides & Woo 3D Digital Differential Analyzer (DDA) or `prismarine-world.raycast`:
  ```ts
  const hit = world.raycast(
    eyePos,
    dir,
    dist + 0.05,
    (block) => block.boundingBox !== 'empty' && !block.transparent
  );
  ```
- **Visibility Verdict**:
  - If `hit === null` OR `hit.position.equals(B.pos)`: Line of sight is completely clear.
  - If `hit` hits an intermediate opaque block $B_{\text{inter}} \ne B$: The face is occluded.
  - The block is **visible** if at least one exposed face has clear line of sight.

#### Step 3: Distance and Field-of-View (FOV) Constraints
- **Maximum Perception Distance ($R_{\text{max}}$)**: Set to $32.0$ blocks (standard survival visual search horizon; beyond 32 blocks, raycast overhead increases and human players do not identify ore veins).
- **Conical Field of View (Focal Perception)**:
  - Default FOV angle: $\theta_{\text{FOV}} = 70^\circ$ (standard Minecraft camera setting).
  - Let $\vec{V}_{\text{look}} = (\cos(\text{pitch})\cos(\text{yaw}), -\sin(\text{pitch}), \cos(\text{pitch})\sin(\text{yaw}))$.
  - A block is in focal vision if:
    $$\frac{\vec{D} \cdot \vec{V}_{\text{look}}}{\|\vec{D}\|} \ge \cos\left(\frac{\theta_{\text{FOV}}}{2}\right) \approx \cos(35^\circ) \approx 0.819$$
- **Near-Field Tactile / Peripheral Zone**:
  - Any exposed, unobstructed block within $R_{\text{near}} \le 2.5$ blocks is perceived regardless of yaw/pitch (simulating peripheral vision, hearing, and tactile awareness).
- **Scanning Mode**:
  - When actively searching for resources, the agent must rotate its head (`bot.look(yaw, pitch)`) in discrete intervals (e.g. sweeping $-60^\circ, 0^\circ, +60^\circ$ yaw) to legitimately bring new areas into its FOV cone.

#### Legitimate Resource Discovery Protocol
How does the bot mine ores without X-Ray?
1. **Surface & Cave Exposure Discovery**: Search only blocks that pass Steps 1-3. When exploring caves or ravines, exposed coal, iron, copper, or diamond are legitimately registered into the agent's `DiscoveredBlocksMemory`.
2. **Branch Mining Discovery**: The bot digs a 1x2 tunnel. With each block mined, up to 5 previously hidden adjacent blocks become exposed. The bot inspects only the *newly exposed* faces. If an ore block is uncovered, it is mined. If solid stone is revealed, it continues tunneling.

---

### 2.2 Standard Physical Limits: Interaction Reach & Survival Physics

Anti-cheat software (e.g. GrimAC, NoCheatPlus, Vulcan) monitors client packet timestamps, coordinates, and reach vectors. The bot must strictly conform to vanilla survival physics.

#### Block Interaction Reach: Exactly 4.5 Blocks
- **Vanilla Specification**: In Minecraft Java Survival Mode, the maximum block reach distance is $4.5$ blocks from the eye position to the target block surface point.
- **Enforcement Rule**:
  Before calling `bot.dig(block)` or `bot.placeBlock(refBlock, face)`:
  $$d_{\text{reach}} = \|\vec{P}_{\text{eye}} - \vec{P}_{\text{target}}\| \le 4.50\text{ blocks}$$
  - If $d_{\text{reach}} > 4.50$, the interaction MUST be rejected with `OutOfReachError`.
  - The agent must use `mineflayer-pathfinder` (`GoalGetToBlock(x, y, z)`) to walk within reach before initiating the action.

#### Entity Combat Reach: Exactly 3.0 - 3.5 Blocks
- **Vanilla Specification**: In Minecraft Java Survival Mode, the player attack reach against entities is $3.0$ blocks (bounding box surface) and capped at $3.5$ blocks center-to-center.
- **Enforcement Rule**:
  Before calling `bot.attack(entity)`:
  $$d_{\text{entity}} = \|\vec{P}_{\text{eye}} - \text{EntityCenter}\| \le 3.50\text{ blocks}$$
  - If $d_{\text{entity}} > 3.50$, the attack is withheld, and the bot steps closer.

#### Survival Movement Physics Constants
| Parameter | Value (blocks/second) | Value (blocks/tick) | Notes |
|:---|:---|:---|:---|
| Normal Walking Speed | $4.317\text{ m/s}$ | $0.2158\text{ m/tick}$ | Standard unhindered walking |
| Sprinting Speed | $5.612\text{ m/s}$ | $0.2806\text{ m/tick}$ | Requires food $> 6$ drumsticks |
| Sneaking / Crouching Speed | $1.295\text{ m/s}$ | $0.0648\text{ m/tick}$ | Prevents walking off edges |
| Swimming Speed | $1.970\text{ m/s}$ | $0.0985\text{ m/tick}$ | In water currents |
| Initial Jump Velocity | $8.400\text{ m/s}$ | $0.4200\text{ m/tick}$ | Upward jump impulse |
| Gravity Acceleration | $1.600\text{ m/s}^2$ | $0.0800\text{ m/tick}^2$ | Downward acceleration per tick |
| Drag Multiplier | $0.98$ (air) / $0.80$ (water) | Per tick velocity retention |
| Maximum Safe Fall Drop | $3.00\text{ blocks}$ | Fall damage formula: $\text{damage} = \max(0, \lfloor\text{fallDist} - 3\rfloor)$ |

- **Cheating Prohibitions**:
  - `bot.entity.position.set()` is strictly forbidden (teleportation cheat).
  - No fly hacks, no phase / noclip, no speed modification.
  - Movement must be driven entirely by Mineflayer's standard physics engine (`prismarine-physics`) reacting to control states (`forward`, `back`, `left`, `right`, `jump`, `sprint`, `sneak`).

---

### 2.3 Privileged Command Lockdown

The bot must operate as an unprivileged survival player. Under no circumstances may it issue administrative operator (OP) commands or creative cheats, even if configured on a development server.

#### Prohibited Command List
```ts
export const PROHIBITED_COMMANDS = new Set([
  'tp', 'teleport',
  'give',
  'gamemode',
  'op', 'deop',
  'kill',
  'setblock', 'fill', 'clone',
  'locate', 'locatebiome',
  'effect',
  'weather', 'time',
  'summon',
  'enchant',
  'xp', 'experience',
  'difficulty',
  'seed',
  'whitelist', 'ban', 'kick', 'pardon',
  'execute', 'data', 'scoreboard', 'gamerule', 'tag', 'attribute', 'advancement', 'function'
]);
```

#### Allowed Non-Privileged Chat Commands Whitelist
Only standard player communication and unprivileged server utilities are allowed:
- `/me <action>`
- `/msg <user> <message>`, `/tell <user> <message>`, `/w <user> <message>`
- `/help`
- `/rules`, `/list`

#### Enforcement Architecture: Chat Interceptor
All outgoing chat packets from the agent (whether originating from autonomous loops, LLM tool executions, or Discord bridge commands) pass through a strict `CommandSanitizer`:
```ts
export class CommandSanitizer {
  static validateOutgoingMessage(message: string): void {
    const trimmed = message.trim();
    if (!trimmed.startsWith('/')) {
      return; // Regular survival chat message
    }

    const commandName = trimmed.slice(1).split(/\s+/)[0].toLowerCase();
    
    if (PROHIBITED_COMMANDS.has(commandName)) {
      throw new FairPlaySecurityViolationError(
        `Command '/${commandName}' is strictly prohibited under survival fair-play rules.`
      );
    }
  }
}
```
If an attempt is made to execute a prohibited command, the agent:
1. Rejects execution immediately without dispatching any network packet to the server.
2. Emits a `FAIR_PLAY_VIOLATION` event.
3. Reports the violation to Discord audit logs and the AI planner.

---

## 3. Foundational Gameplay Capabilities (Mineflayer / TypeScript)

### 3.1 Pathfinding Engine (`mineflayer-pathfinder`)

The agent integrates `mineflayer-pathfinder` to perform dynamic $A^*$ path generation over the Minecraft voxel grid.

#### Movement Configuration Profile
```ts
import { Movements, goals } from 'mineflayer-pathfinder';
import minecraftData from 'minecraft-data';

export function createSurvivalMovements(bot: Bot): Movements {
  const mcData = minecraftData(bot.version);
  const movements = new Movements(bot, mcData);

  // Survival safety configurations
  movements.maxDropDown = 3;            // Never drop more than 3 blocks (avoids fall damage)
  movements.allowParkour = false;         // Safe navigation: disable risky jump parkour over voids
  movements.allowSprinting = true;        // Sprint only when food > 6
  movements.liquidCost = 25;              // Strongly penalize water/lava to avoid slow swimming/burns
  
  // Terraform permissions (context-dependent)
  movements.canDig = false;               // Do not break world blocks during casual navigation
  movements.canPlaceOn = false;           // Do not bridge or place dirt blocks during casual navigation
  
  // Scaffolding materials when bridging is explicitly enabled
  movements.scaffoldingBlocks = [
    mcData.blocksByName.dirt.id,
    mcData.blocksByName.cobblestone.id
  ];

  return movements;
}
```

#### Goal Hierarchies & Mappings
| High-Level Goal | Pathfinder Goal Class | Parameters | Usage |
|:---|:---|:---|:---|
| Approach Entity | `goals.GoalFollow(entity, range)` | `entity: Entity, range = 2` | Following player or companion |
| Reach Area | `goals.GoalNear(x, y, z, range)` | `range = 1..3` | Moving near chest, bed, or station |
| Exact Block | `goals.GoalBlock(x, y, z)` | Exact coordinates | Standing on a designated spot |
| Interact Block | `goals.GoalGetToBlock(x, y, z)` | Target block coordinate | Reaching adjacent block for mining/placing |
| Open Terrain | `goals.GoalXZ(x, z)` | Horizontal coordinates | Traveling to biome or coordinate |

#### Path Stall & Obstacle Recovery Watchdog
- **Stall Detection**: If pathfinder is active but the bot's Euclidean displacement $\Delta d < 0.4$ blocks over $2,500\text{ ms}$, the path is flagged as stalled (stuck on corner, fence, or unexpected dynamic entity).
- **Recovery Strategy**:
  1. Stop current movement: `bot.pathfinder.stop()`.
  2. Jump / backstep impulse: `bot.setControlState('back', true)` for $300\text{ ms}$, then release.
  3. Recompute path with higher heuristic cost on stalled node.
  4. If stalled 3 times consecutively: throw `UnreachableGoalError`.

---

### 3.2 Block Interaction & Mining

#### Fair-Play Mining Lifecycle
1. **Pre-Mining Validation**:
   - Verify target block exists in loaded chunks: `block = bot.blockAt(pos)`.
   - Verify surface exposure and line-of-sight: `PerceptionFilter.canSeeBlock(bot, block) === true`.
2. **Proximity Navigation**:
   - Check distance: $d = \|\vec{P}_{\text{eye}} - \text{center}(block)\| \le 4.5$.
   - If $d > 4.5$, execute `bot.pathfinder.goto(new GoalGetToBlock(pos.x, pos.y, pos.z))`.
3. **Optimal Harvest Tool Selection**:
   - Evaluate block material and hardness.
   - Harvest Tool Matrix:
     - Stone / Ore: Pickaxe (Wooden, Stone, Iron, Diamond, Netherite).
       - *Rule*: Iron Ore requires Stone Pickaxe+; Diamond/Gold/Redstone requires Iron Pickaxe+; Obsidian requires Diamond Pickaxe+.
     - Wood / Planks: Axe.
     - Dirt / Gravel / Sand / Clay: Shovel.
     - Cobweb / Wool: Shears or Sword.
   - Select best candidate tool in inventory maximizing mining speed multiplier and durability.
   - Equip tool: `await bot.equip(toolItem, 'hand')`.
4. **Digging Execution**:
   - Look at block face: `await bot.lookAt(targetFacePoint, true)`.
   - Call `await bot.dig(block, 'raycast', 'raycast')`.
   - *Interruption Guard*: If `bot.on('damage')` or hostile mob enters $3.5$ blocks during dig, immediately call `bot.stopDigging()`, switch to combat mode, and resolve threat.
5. **Drop Collection**:
   - After block breaks, scan for dropped item entities (`entity.type === 'item'`) within $5.0$ blocks.
   - Pathfind to item position to pick it up into player inventory.

---

### 3.3 Block Placement

In Minecraft survival, a player cannot spawn a block in mid-air; a block must be placed against an existing solid block face.

1. **Reference Block & Face Normal Determination**:
   - Target placement position $\vec{P}_{\text{target}}$.
   - Search 6 adjacent neighbor voxels for a solid block $B_{\text{ref}}$.
   - Face normal: $\vec{n} = \vec{P}_{\text{target}} - B_{\text{ref}}.\text{pos}$.
2. **Player Collision Check**:
   - Verify that the target placement bounding box $[ \vec{P}_{\text{target}}, \vec{P}_{\text{target}} + (1, 1, 1) ]$ does NOT intersect the bot's current bounding box.
   - If collision detected, step backward before placing to prevent suffocating in placed block.
3. **Interactive Block Sneak-Placing**:
   - If $B_{\text{ref}}$ is interactive (`chest`, `trapped_chest`, `furnace`, `crafting_table`, `hopper`, `dispenser`, `door`, `trapdoor`):
     - Engage sneak: `bot.setControlState('sneak', true)`.
     - Execute placement: `await bot.placeBlock(B_ref, vec3(n.x, n.y, n.z))`.
     - Disengage sneak: `bot.setControlState('sneak', false)`.
   - Otherwise, execute `await bot.placeBlock(B_ref, vec3(n.x, n.y, n.z))`.

---

### 3.4 Inventory Management & Crafting

#### Inventory Slot Mapping (1.9+)
- Hotbar: Slots $36 - 44$ (Quick bar indices $0 - 8$).
- Main Inventory: Slots $9 - 35$ ($27$ slots).
- Armor Slots:
  - Head (Helmet): Slot $5$
  - Torso (Chestplate): Slot $6$
  - Legs (Leggings): Slot $7$
  - Feet (Boots): Slot $8$
- Off-hand: Slot $45$ (Shield / Totem).

#### Container Interaction Lifecycle
- Approach container block (within $4.5$ blocks).
- `const container = await bot.openContainer(block)`.
- Operations:
  - `await container.deposit(itemType, metadata, count)`.
  - `await container.withdraw(itemType, metadata, count)`.
- Always close: `container.close()`.

#### Autonomous Crafting Architecture
- **2x2 Player Inventory Crafting**:
  - Recipes with dimensions $\le 2\times 2$ (oak planks, crafting table, sticks, torches).
  - Check inventory for ingredients.
  - Query: `bot.recipesFor(itemTypeId, null, count, null)`.
  - Execute: `await bot.craft(recipe, count, null)`.
- **3x3 Crafting Table Crafting**:
  - Recipes requiring $3\times 3$ grid (pickaxe, axe, sword, chest, furnace, bed).
  - Search for crafting table within visible range ($\le 16$ blocks).
  - If no crafting table found, craft one (from 4 planks) and place it on valid ground.
  - Pathfind within $4.5$ blocks of crafting table.
  - Query: `bot.recipesFor(itemTypeId, null, count, craftingTableBlock)`.
  - Execute: `await bot.craft(recipe, count, craftingTableBlock)`.

---

### 3.5 Combat & Defense Engine

#### Threat Perception & Hostile Mob Classification
- Hostile entity IDs: `zombie`, `skeleton`, `creeper`, `spider`, `cave_spider`, `enderman`, `witch`, `phantom`, `drowned`, `husk`, `stray`, `slime`, `magma_cube`, `pillager`, `vindicator`, `evoker`, `ravager`, `warden`, `blaze`, `ghast`, `wither_skeleton`.
- **Perception Rule**: Filter entities where `dist <= 16.0` AND `PerceptionFilter.canSeeEntity(bot, entity) === true`.
- If a zombie is behind a 2-block thick cobblestone wall, the bot CANNOT attack or pathfind to it until line of sight is established or player takes damage.

#### 1.9+ Attack Cooldown Mechanics
In Minecraft 1.9+, spamming attack clicks reduces attack damage by up to $80\%$. The bot MUST respect weapon attack speed:
- Sword: Attack speed $1.6\text{ attacks/s}$ $\implies$ cooldown delay $\Delta t = \frac{1000}{1.6} = 625\text{ ms}$.
- Axe: Attack speed $0.8 - 1.0\text{ attacks/s}$ $\implies$ cooldown delay $\Delta t = 1000 - 1250\text{ ms}$.
- Bot tracks `lastAttackTime` and ensures:
  $$t_{\text{now}} - t_{\text{lastAttack}} \ge \Delta t_{\text{cooldown}}$$
  before issuing `bot.attack(entity)`.

#### Active Shield Defense
- If a shield is equipped in `off-hand`:
  - **Skeleton Arrow Defense**: If an active skeleton faces the bot and its bow pull animation is detected, activate shield: `bot.activateItem(true)`. Face projectile vector.
  - **Creeper Explosion Defense**: If a creeper is within $4.0$ blocks and fuse is priming (metadata `fuse === 1`), activate shield and backpedal.
  - Deactivate shield (`bot.deactivateItem()`) right before swinging weapon to strike.

#### Tactical Retreat & Panic Bunker
- **Critical Health Threshold**: If `bot.health <= 6` ($3$ hearts):
  1. Abort current work tasks.
  2. Equip shield or food.
  3. Sprint away from nearest hostile mob toward lighted/safe ground.
  4. If trapped: Dig 1x2 panic hole into ground or wall, place block to seal entrance, and consume food to trigger health regeneration.

---

## 4. Automated Survival Loops

The survival engine runs three concurrent, event-driven background loops that operate autonomously without requiring external Discord commands.

```
+----------------------------------------------------------------------------------+
|                            SURVIVAL ENGINE LOOPS                                 |
+----------------------------------------------------------------------------------+
         |                                |                               |
         v                                v                               v
+------------------+            +-------------------+           +------------------+
|   AutoEatLoop    |            |   AutoSleepLoop   |           |  AutoEquipLoop   |
| (bot.on 'health')|            |  (bot.on 'time')  |           | (bot.on 'update')|
+------------------+            +-------------------+           +------------------+
         |                                |                               |
- Food <= 14 drumsticks         - timeOfDay in [12541, 23458]   - Evaluate Head/   |
- Or Health < 20 & Food <= 17     OR (isRaining & thunder)        Torso/Legs/Feet  |
- Select best nutrition food    - Visible bed <= 16 blocks      - Compute Score:   |
- Avoid poisonous items         - Check 8m monster radius         Tier*100 + Def*10|
- Equip, consume, restore       - Pathfind, sleep, wake safely  - Equip best gear  |
+------------------+            +-------------------+           +------------------+
```

### 4.1 Autonomous Auto-Eat Loop

#### State Triggers
- Listen on `bot.on('health')`.
- Trigger conditions:
  1. **Routine Hunger**: `bot.food <= 14` (food bar at 7 drumsticks or below).
  2. **Regeneration Priority**: `bot.health < 20 && bot.food <= 17` (replenish hunger to enable natural healing).
  3. **Emergency Sprint Lockout**: `bot.food <= 6` (urgent priority: sprinting disabled).

#### Nutritional Value & Food Hierarchy
| Priority Tier | Items | Nutrition | Saturation | Notes |
|:---|:---|:---|:---|:---|
| Tier 1 (Optimal) | `golden_carrot`, `cooked_beef` (steak), `cooked_porkchop`, `cooked_mutton` | $8$ pts | $12.8$ pts | Highest saturation ratio |
| Tier 2 (Standard) | `cooked_chicken`, `cooked_salmon`, `baked_potato`, `bread` | $5-6$ pts | $6.0-7.2$ pts | Common staple foods |
| Tier 3 (Snacks) | `apple`, `carrot`, `melon_slice`, `sweet_berries` | $2-4$ pts | $1.2-2.4$ pts | Quick snacks |
| Emergency Only | `rotten_flesh` | $4$ pts | $0.8$ pts | **Only if food $\le 4$ and no other food exists** (80% hunger effect risk) |
| **STRICT BLACKLIST** | `pufferfish`, `spider_eye`, `poisonous_potato`, `chorus_fruit` | N/A | N/A | **NEVER CONSUME** (fatal poison, nausea, unwanted teleportation) |

#### Consumption Sequence
1. Save currently equipped main hand item: `const previousItem = bot.heldItem`.
2. Find highest-priority food item in inventory.
3. Equip food: `await bot.equip(foodItem, 'hand')`.
4. Call `await bot.consume()`.
5. Re-equip `previousItem` to restore player state.

---

### 4.2 Autonomous Auto-Sleep Loop

#### Environmental Triggers
- Listen on `bot.on('time')`.
- Minecraft day/night cycle consists of $24,000$ game ticks:
  - Daylight: ticks $0$ to $12,541$.
  - Night (Sleeping allowed): ticks $12,542$ to $23,458$.
  - Sunrise / Wakeup: tick $23,459$.
- Thunderstorms: `bot.isRaining === true` during active thunder allows sleeping regardless of tick time.

#### Bed Discovery & Pathfinding
1. Query nearby beds: search for blocks matching regex `/_bed$/` within radius $16$ blocks.
2. Fair-play check: bed must be in loaded chunks and line of sight / reachable path.
3. Move adjacent to bed: `await bot.pathfinder.goto(new GoalNear(bed.position.x, bed.position.y, bed.position.z, 2))`.

#### Monster Proximity Radius Check
- Vanilla Rule: Sleeping fails if hostile monsters are within $8$ blocks horizontally and $5$ blocks vertically.
- Bot scans for hostile mobs in this bounding cylinder:
  - If hostile mob present: switch to Combat Engine to eliminate or lure away mob before attempting sleep.
- Call `await bot.sleep(bedBlock)`.
- Listen for `wake` event or morning transition, then resume active tasks.

---

### 4.3 Autonomous Auto-Equip Loop

#### Composite Armor Scoring Formula
Each armor piece in inventory is evaluated using a composite defensive index:
$$\text{Score} = (\text{TierBase} \times 100) + (\text{DefensePoints} \times 10) + (\text{Toughness} \times 5) + (\text{ProtectionLevel} \times 15)$$

| Armor Material | TierBase | Helmet Def | Chest Def | Leggings Def | Boots Def | Toughness | Knockback Res |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Netherite | 6 | 3 | 8 | 6 | 3 | 3 | +1 |
| Diamond | 5 | 3 | 8 | 6 | 3 | 2 | 0 |
| Iron | 4 | 2 | 6 | 5 | 2 | 0 | 0 |
| Chainmail | 3 | 2 | 5 | 4 | 1 | 0 | 0 |
| Golden | 2 | 2 | 5 | 3 | 1 | 0 | 0 |
| Leather | 1 | 1 | 3 | 2 | 1 | 0 | 0 |

#### Equipment Lifecycle
1. Triggered on `bot.inventory.on('updateSlot')`.
2. For each destination: `'head'`, `'torso'`, `'legs'`, `'feet'`:
   - Identify currently equipped item and calculate its score.
   - Scan inventory for candidate items matching slot destination.
   - If `candidateScore > currentScore`, call `await bot.equip(bestCandidate, destination)`.
3. Off-hand Evaluation:
   - If `off-hand` slot is empty and inventory contains a `shield`, call `await bot.equip(shield, 'off-hand')`.

---

## 5. Error Handling & Emergency Recovery

| Failure / Hazard | Detection Condition | Autonomous Recovery Procedure |
|:---|:---|:---|
| **Pathfinding Unreachable** | `pathfinder` throws `noPath` or calculation times out ($>10\text{s}$) | 1. Retry with `GoalNear(target, 3)` (relaxed tolerance).<br>2. If permitted, enable temporary bridging/digging.<br>3. If still unreachable, halt pathfinder and alert Discord with destination coordinates. |
| **Path Stalled** | Position unchanged ($\Delta d < 0.4$m) over $2.5\text{s}$ during active movement | 1. Stop movement: `bot.pathfinder.stop()`.<br>2. Issue backstep impulse ($300\text{ms}$) and jump.<br>3. Invalidate path cache and recompute alternate route. |
| **Tool Broken Mid-Mining** | Active tool durability drops to $0$ and disappears from hand | 1. Check inventory for backup tool of identical or higher tier.<br>2. Equip backup tool and resume digging.<br>3. If no tool exists, check if materials exist to craft wooden/stone pickaxe; otherwise halt task and notify user. |
| **Submerged Drowning Hazard** | `bot.oxygenLevel < 10` (half air bubbles remaining) | 1. Abort current work task immediately.<br>2. Set pathfinder goal to nearest surface air block directly above.<br>3. Engage continuous upward jump swimming: `bot.setControlState('jump', true)`. |
| **Lava / Fire Hazard** | Bot catches fire (`entity.metadata[0] & 0x01`) or touches lava | 1. Pathfinder liquid cost dynamically set to $1000$.<br>2. If water bucket present in inventory: perform water bucket clutch (place at feet, wait 1 tick, scoop water back up).<br>3. Otherwise, pathfind immediately to nearest water block within $10$ blocks. |
| **Suffocation Hazard** | Head block (`eyePos`) intersects opaque block (gravel, sand) | 1. Immediately call `bot.dig(headBlock)` with bare hands/shovel.<br>2. Issue backward movement impulse to exit falling block column. |
| **Fall Hazard** | Edge drop height $> 3.0$ blocks without water at landing base | 1. `Movements.maxDropDown = 3` strictly prevents pathfinder from routing off high ledges.<br>2. If accidentally knocked off ledge with water bucket equipped: perform clutch landing water bucket placement at impact tick. |

---

## 6. Testability & Mocking Architecture

Requirement R4 dictates that the verification suite must run 100% reliably in CI or local developer machines without requiring a live Minecraft Java server or external cloud dependencies.

### 6.1 Architecture: Decoupled Dependency Injection

The agent engine is structured around clean TypeScript interfaces, decoupling core logic from the live Mineflayer bot instance:

```
+------------------------------------------------------------------------------------+
|                                 AGENT ENGINE                                       |
+------------------------------------------------------------------------------------+
       |                     |                     |                    |
       v                     v                     v                    v
+---------------+     +---------------+     +---------------+    +---------------+
| IPerception-  |     | IPathfinding- |     |  IInventory-  |    |   ICombat-    |
|   Service     |     |   Service     |     |   Service     |    |   Service     |
+---------------+     +---------------+     +---------------+    +---------------+
       |                     |                     |                    |
       +---------------------+---------------------+--------------------+
                                      |
                 +--------------------+--------------------+
                 |                                         |
                 v                                         v
   +---------------------------+             +---------------------------+
   | Live Mineflayer Adapter   |             | Mock Test Adapter         |
   | (Connects to live server) |             | (In-memory Prismarine)    |
   +---------------------------+             +---------------------------+
```

### 6.2 Unit Testing: In-Memory `prismarine-world` Fixtures

Unit tests test fair-play raycasting, reach enforcers, command filters, and survival loops without any network sockets or protocol servers:

#### Voxel Fixture Test: Anti-Xray Occlusion Verification
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import World from 'prismarine-world';
import ChunkLoader from 'prismarine-chunk';
import Vec3 from 'vec3';
import { FairPlayPerceptionService } from '../src/fairplay/PerceptionService';

describe('FairPlayPerceptionService (Anti-Xray & Raycast)', () => {
  let world: any;
  let perception: FairPlayPerceptionService;

  beforeEach(() => {
    const Chunk = ChunkLoader('1.20.4');
    world = new World(() => new Chunk());
    perception = new FairPlayPerceptionService(world);
  });

  it('detects exposed ore with clear line of sight', () => {
    // Player standing at (0, 64, 0), eye at (0, 65.62, 0)
    // Exposed iron ore at (3, 64, 0), air at (3, 65, 0)
    world.setBlockType(new Vec3(3, 64, 0), 15); // Iron ore
    world.setBlockType(new Vec3(3, 65, 0), 0);  // Air above (exposed)
    
    const eyePos = new Vec3(0, 65.62, 0);
    const visible = perception.canSeeBlock(eyePos, new Vec3(3, 64, 0));
    expect(visible).toBe(true);
  });

  it('rejects buried diamond ore behind solid stone wall (Anti-Xray)', () => {
    // Player standing at (0, 64, 0), eye at (0, 65.62, 0)
    // Solid stone wall at (1, 64, 0) and (1, 65, 0)
    world.setBlockType(new Vec3(1, 64, 0), 1);  // Stone
    world.setBlockType(new Vec3(1, 65, 0), 1);  // Stone
    
    // Hidden diamond ore at (2, 64, 0)
    world.setBlockType(new Vec3(2, 64, 0), 56); // Diamond ore
    
    const eyePos = new Vec3(0, 65.62, 0);
    const visible = perception.canSeeBlock(eyePos, new Vec3(2, 64, 0));
    expect(visible).toBe(false); // Occluded! Zero X-Ray leakage
  });
});
```

#### Reach Enforcer Test: 4.5 Block Boundary
```ts
describe('PhysicalLimitsEnforcer', () => {
  it('throws OutOfReachError when interacting beyond 4.5 blocks', () => {
    const eyePos = new Vec3(0, 65.62, 0);
    const targetBlockPos = new Vec3(0, 65.62, 4.51); // 4.51 blocks away
    
    expect(() => {
      PhysicalLimitsEnforcer.assertBlockReach(eyePos, targetBlockPos);
    }).toThrowError(/ReachExceededError/);
  });

  it('permits interaction at 4.49 blocks', () => {
    const eyePos = new Vec3(0, 65.62, 0);
    const targetBlockPos = new Vec3(0, 65.62, 4.49);
    
    expect(() => {
      PhysicalLimitsEnforcer.assertBlockReach(eyePos, targetBlockPos);
    }).not.toThrow();
  });
});
```

#### Command Sanitizer Test: OP Command Interception
```ts
describe('CommandSanitizer', () => {
  it('blocks /tp, /give, /gamemode', () => {
    expect(() => CommandSanitizer.validateOutgoingMessage('/tp 100 64 100'))
      .toThrowError(/prohibited/);
    expect(() => CommandSanitizer.validateOutgoingMessage('/give player diamond 64'))
      .toThrowError(/prohibited/);
    expect(() => CommandSanitizer.validateOutgoingMessage('/gamemode creative'))
      .toThrowError(/prohibited/);
  });

  it('permits valid player chat and whitelisted commands', () => {
    expect(() => CommandSanitizer.validateOutgoingMessage('Hello world')).not.toThrow();
    expect(() => CommandSanitizer.validateOutgoingMessage('/msg Alice I found iron')).not.toThrow();
  });
});
```

### 6.3 Integration Testing: Protocol Mock Client / Server Stub

For integration tests verifying event-driven loops:
- `MockMinecraftClient`: An `EventEmitter` simulating the `node-minecraft-protocol` socket.
- Tests can emit standard packets:
  - `update_health`: `{ health: 12, food: 8, foodSaturation: 0 }` $\implies$ asserts bot switches held item to food and triggers eat action.
  - `time_update`: `{ time: 14000 }` $\implies$ asserts bot searches for bed and initiates sleep routine.
  - `chat`: simulates player messages from game chat to test chat bridging.
- Execution speed: Runs 50+ test cases in $< 500\text{ ms}$ with zero network overhead.

---

## 7. Features Discovered

The following comprehensive table enumerates all features discovered, specified, and required for Requirement R2:

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Fair-Play Perception | Anti-Xray Exposed Face Filter | Discards any solid block where all 6 neighbor faces are opaque, preventing underground block scanning. | Candidate `Vec3` coordinate | `boolean` (has exposed face) | Returns `false` if unexposed | Original Request R2 & Vanilla Voxel Geometry |
| 2 | Fair-Play Perception | 3D Line-of-Sight Raycasting | Fast voxel raycast from player eye to exposed face center; blocks with intervening opaque voxels are occluded. | `eyePos: Vec3`, `block: Block` | `boolean` (is line of sight clear) | Returns `false` if occluded by solid block | Mineflayer `bot.canSeeBlock` & `prismarine-world.raycast` |
| 3 | Fair-Play Perception | Field-of-View (FOV) Conical Filter | Enforces player gaze cone ($70^\circ$ FOV) for visual discovery, with $2.5$m near-field tactile fallback. | `eyePos: Vec3`, `yaw: number`, `pitch: number`, `target: Vec3` | `boolean` (within FOV cone) | Returns `false` if behind player beyond near-field | Human survival gameplay mechanics & camera geometry |
| 4 | Fair-Play Perception | Legitimate Resource Memory Map | Spatial memory storing legitimately discovered exposed blocks (surface/caves/tunneling). | Discovered visible blocks | Memory cache of valid targets | Evicts broken blocks or unloaded chunks | Minecraft survival exploration pattern |
| 5 | Physical Limits | Survival Block Reach Enforcer | Enforces maximum $4.50$ block Euclidean distance from eye to block for all digging, placing, and activating. | `eyePos: Vec3`, `targetPoint: Vec3` | `void` (passes assertion) | Throws `ReachExceededError` if distance $> 4.5$ | Vanilla Java survival specification & anti-cheat standards |
| 6 | Physical Limits | Survival Entity Reach Enforcer | Enforces maximum $3.50$ block center distance ($3.0$m bounding box) for attacks and entity interactions. | `eyePos: Vec3`, `entity: Entity` | `void` (passes assertion) | Throws `ReachExceededError` if distance $> 3.5$ | Vanilla Java combat mechanics & GrimAC limits |
| 7 | Physical Limits | Survival Movement Physics Enforcer | Relies solely on standard tick-driven physics; strictly forbids teleportation cheats and speed hacks. | Movement inputs (`forward`, `jump`, etc.) | New position per tick | Velocity clamped to physics equations | `prismarine-physics` & Minecraft vanilla constants |
| 8 | Fair-Play Security | Privileged OP Command Sanitizer | Intercepts outgoing chat/commands; strictly prohibits OP commands (`/tp`, `/give`, `/gamemode`, etc.). | Outgoing string message | Validated string or error | Throws `FairPlaySecurityViolationError` and alerts Discord | Original Request R2 & Acceptance Criteria |
| 9 | Pathfinding | Movement Profile Configurator | Configures safe survival movement rules: max drop $\le 3$, parkour disabled, water cost penalized. | `bot: Bot`, `mcData: any` | `Movements` instance | Reverts to safe fallback if parameters invalid | `mineflayer-pathfinder.Movements` |
| 10 | Pathfinding | Dynamic Goal Manager | Maps high-level intent into `GoalNear`, `GoalBlock`, `GoalFollow`, and `GoalGetToBlock`. | Target position / entity, tolerance | `goals.Goal` instance | Rejects invalid or infinite coordinates | `mineflayer-pathfinder.goals` |
| 11 | Pathfinding | Path Stall & Obstacle Watchdog | Detects displacement stalls ($<0.4$m over $2.5$s); executes backstep impulse and recomputes route. | Ticking position history | Recovery action impulse | Emits `UnreachableGoalError` after 3 consecutive failures | Navigation robustness & obstacle avoidance |
| 12 | Mining & Building | Optimal Harvest Tool Selector | Matches block material to inventory tools; selects tool with highest harvest speed and tier validity. | Target `Block`, `Inventory` | Best `Item` or null | Fallback to bare hands if no tool exists | `bot.pathfinder.bestHarvestTool` & harvest tiers |
| 13 | Mining & Building | Raycast-Guarded Block Mining | Validates visibility and reach, equips optimal tool, looks at face, and digs via raycast. | Target `Block` | Mining promise completion | Halts digging (`stopDigging`) on damage/attack | Mineflayer `bot.dig` API |
| 14 | Mining & Building | Dropped Item Entity Collector | Detects newly spawned item entities within $5$m of broken block and paths to collect them. | World entities (`type === 'item'`) | Inventory updated with drop | Ignores unreachable or submerged items | Minecraft block drop mechanics |
| 15 | Mining & Building | Reference-Block Placement Engine | Resolves adjacent reference block and face normal; ensures player bounding box does not collide. | `targetPos: Vec3`, `blockType: string` | Placement completion | Throws error if player collides or target invalid | Mineflayer `bot.placeBlock` API |
| 16 | Mining & Building | Interactive Block Sneak-Placer | Holds sneak key when placing against interactive blocks (chests, furnaces, doors) to prevent opening UI. | Target reference block | Block placed without opening UI | Releases sneak key in `finally` block | Minecraft interaction mechanics |
| 17 | Inventory | Container Interactor (Chest/Furnace) | Opens container within reach, transfers items with count validation, and guarantees container closure. | Target container `Block`, item filter, count | Transferred item count | Re-throws error and closes container cleanly | Mineflayer `bot.openContainer` API |
| 18 | Crafting | Autonomous 2x2 Crafting Handler | Resolves and crafts recipes fitting player inventory crafting grid (planks, sticks, crafting table). | Target `itemId`, count | Crafted items in inventory | Throws `InsufficientIngredientsError` if items missing | Mineflayer `bot.recipesFor` & `bot.craft` |
| 19 | Crafting | Autonomous 3x3 Crafting Table Handler | Locates or crafts/places crafting table within reach, resolves recipe, and executes 3x3 craft. | Target `itemId`, count | Crafted items in inventory | Crafts table first if none nearby | Minecraft crafting table mechanics |
| 20 | Combat & Defense | Line-of-Sight Hostile Mob Detector | Scans nearby entities ($\le 16$m); filters hostile types and verifies line-of-sight before engaging. | World entities | List of visible threat entities | Ignores mobs occluded behind solid walls | Mineflayer entity system & Raycaster |
| 21 | Combat & Defense | 1.9+ Attack Cooldown Engine | Enforces weapon cooldown timing ($625$ms for sword, $1000$ms for axe) before executing strike. | Target entity, equipped weapon | Damage inflicted on target | Delays swing until cooldown gauge reaches 100% | Minecraft 1.9+ combat mechanics |
| 22 | Combat & Defense | Active Shield Defense Subsystem | Equips shield to off-hand; activates shield on incoming skeleton arrow or creeper priming. | Threat entity metadata / projectile | Shield blocking state active | Lowers shield prior to offensive strike | Mineflayer `bot.activateItem` |
| 23 | Combat & Defense | Emergency Combat Retreat & Bunker | Triggers sprint retreat when health $\le 6$ HP ($3$ hearts); builds 1x2 panic bunker if escape cut off. | `bot.health` | Safe bunker sealed / health regenerated | Disengages from active tasks | Survival defense tactics |
| 24 | Survival Loops | Autonomous Auto-Eat Loop | Monitors hunger and health; consumes high-saturation food when hunger $\le 14$ or health $< 20$. | `bot.food`, `bot.health`, `inventory` | Hunger restored | Restores previously held tool after eating | Mineflayer `bot.consume` API |
| 25 | Survival Loops | Harmful Food Exclusion Filter | Blacklists poisonous foods (`pufferfish`, `spider_eye`, `poisonous_potato`) from auto-eat. | Food items in inventory | Safe edible items list | Filters out harmful items completely | Minecraft food toxicity data |
| 26 | Survival Loops | Autonomous Auto-Sleep Loop | Detects night ($12,542 - 23,458$ ticks) or thunderstorm; paths to nearby bed and sleeps. | `bot.time`, nearby bed blocks | Night skipped / player wakes safely | Aborts if monsters within $8$m radius | Mineflayer `bot.sleep` API |
| 27 | Survival Loops | Bed Monster Proximity Guard | Verifies $8$m horizontal / $5$m vertical radius around bed is clear of hostile monsters before sleeping. | Bed position, entity list | `boolean` (is safe to sleep) | Clears mob or waits if monsters near | Minecraft bed sleep restrictions |
| 28 | Survival Loops | Armor Defense Scoring & Auto-Equip | Evaluates armor in inventory using composite score (tier + defense + toughness + protection); equips best. | `inventory` update events | Upgraded armor equipped to slots | Preserves existing armor if superior | `mineflayer-armor-manager` scoring |
| 29 | Survival Loops | Off-Hand Auto-Equipper | Automatically assigns shields, totems of undying, or mining torches to the off-hand slot ($45$). | Off-hand slot state, `inventory` | Off-hand populated | Replaces broken shield if backup available | Minecraft off-hand mechanics |
| 30 | Hazard Mitigation | Drowning Surface Ascent Reflex | Monitors `bot.oxygenLevel`; if $< 10$, halts tasks and performs upward swim to reach air. | `bot.oxygenLevel` | Bot reaches surface water line | Interrupts active pathfinding | Minecraft oxygen depletion mechanics |
| 31 | Hazard Mitigation | Lava / Fire Extinguish Clutch | Sets lava path cost to $1000$; performs water bucket clutch at feet if burning and bucket available. | Fire status, nearby lava blocks | Fire extinguished / lava avoided | Pathfinds to water if no bucket available | Minecraft survival hazard mitigation |
| 32 | Hazard Mitigation | Suffocation Escape Reflex | Detects solid block at head position; digs suffocating block immediately or takes step backwards. | Block at `eyePos` | Head cleared of solid block | Emergency high-priority dig | Minecraft falling block mechanics |
| 33 | Verification Harness | In-Memory Prismarine World Harness | Provides headless, in-memory voxel world fixtures for deterministic raycasting and Anti-Xray testing. | Test voxel grid coordinates | Raycast test results | Throws test assertions on failure | `prismarine-world` & `prismarine-chunk` |
| 34 | Verification Harness | Mock Protocol Client Stub | Simulates `node-minecraft-protocol` socket to trigger health, time, chunk, and chat events in CI tests. | Simulated packet payloads | Bot event responses | Runs 100% offline in Vitest/Jest | `EventEmitter` protocol stub |

---

## 8. Edge Cases

The following comprehensive table enumerates all edge cases and boundary conditions analyzed for the Minecraft gameplay engine:

| # | Feature | Input / Condition | Observed / Required Behavior |
|---|---------|-------------------|-----------------------------|
| 1 | Anti-Xray Raycast | Diamond ore is exposed inside an underground cavern $20$m below player, but solid stone blocks are directly between player and cavern. | Face exposure check returns `true` (touches cave air), but 3D LOS raycast hits intermediate stone block. Target is correctly classified as **occluded** and discarded. Zero X-Ray leakage. |
| 2 | Anti-Xray Raycast | Target block is exposed only diagonally (two opaque blocks meet at an edge corner, leaving a sub-voxel sliver). | Raycast from eye to face center tests ray against full collision boxes. If center ray is blocked by either adjacent corner block, face is deemed occluded, preventing corner-peeking glitches. |
| 3 | Anti-Xray Raycast | Transparent blocks (glass, water, ice, leaves) exist between player and ore block. | Raycaster matcher treats transparent/fluid blocks as non-occluding. The ray passes through glass/water and successfully identifies the ore behind it, matching human vision. |
| 4 | Anti-Xray Raycast | Block center is occluded by a half-slab or stair, but the top face of the block is exposed to air. | Face normal sampling targets the exposed face center rather than pure block center $(0.5, 0.5, 0.5)$, successfully establishing line-of-sight to the exposed facet. |
| 5 | Physical Reach | Player crouches / sneaks, altering eye height from $1.62$m to $1.27$m. | Raycast origin dynamically recalculates using current entity eye height ($1.27$m), accurately testing distance and LOS from the crouching viewpoint. |
| 6 | Physical Reach | Interaction (dig/place) requested on a block whose nearest point is exactly $4.51$ blocks from eye position. | Distance calculation yields $4.51 > 4.50$. Enforcer immediately rejects with `OutOfReachError` before any network packet is dispatched. |
| 7 | Physical Reach | Hostile mob is attacked when mob center is $3.6$m away, but mob bounding box extends within $3.0$m. | Enforcer verifies distance to closest point on entity bounding box ($3.0$m $\le 3.0$m allowed). Attack executes legitimately without triggering reach flags. |
| 8 | Command Sanitizer | Discord user instructs bot: "Teleport to me using `/tp 100 64 100`". | Command sanitizer intercepts `/tp`, rejects execution with `FairPlaySecurityViolationError`, alerts Discord, and planner suggests walking to coordinates instead. |
| 9 | Command Sanitizer | Outgoing message is standard chat containing a slash in middle: `"I have 5/10 logs"`. | Message does not begin with `/` followed by a command token. Sanitizer recognizes it as regular survival chat and passes it through safely. |
| 10 | Pathfinding | Target coordinate is inside solid bedrock or deep underground lava lake. | Pathfinder $A^*$ search fails to find reachable nodes. Watchdog times out at $10$s, halts cleanly, and emits `UnreachableGoalError` without crashing bot. |
| 11 | Mining Lifecycle | Pickaxe breaks halfway through mining an obsidian block ($9.4$ seconds dig time). | Durability event triggers tool loss. Bot detects held item is empty, equips replacement diamond pickaxe from inventory, and restarts dig lifecycle. |
| 12 | Block Placement | Bot attempts to place a block in the exact voxel coordinate where the bot is currently standing. | Bounding box collision check detects intersection between player body and target block volume. Placement aborted until bot steps back $1$ block. |
| 13 | Block Placement | Bot places a block against the side of an active chest or furnace without crouching. | Without sneak, server opens chest GUI instead of placing block. The engine automatically engages `sneak` before placement, guaranteeing proper placement. |
| 14 | Crafting Engine | User requests iron pickaxe, but inventory contains iron ingots and no sticks, but contains oak logs. | Crafting engine executes recursive ingredient resolution: craft logs into planks $\implies$ planks into sticks $\implies$ combines sticks and iron ingots into pickaxe. |
| 15 | Combat Engine | Hostile skeleton is shooting arrows from behind a stone wall through an arrow slit. | Threat detector checks LOS: arrow slit provides partial opening. Shield activates when arrow trajectory is aligned; bot advances around wall to engage. |
| 16 | Combat Engine | Fast attack clicks triggered in rapid succession while wielding diamond sword. | Weapon cooldown manager throttles swings to $625$ms intervals, ensuring every strike delivers $100\%$ attack damage and maximum knockback. |
| 17 | Combat Engine | Creeper enters $3$ blocks range with active swelling (fuse metadata $= 1$). | Bot interrupts standard attack, activates off-hand shield, and engages sprint-backpedal to exceed $7$ blocks explosion danger radius. |
| 18 | Auto-Eat Loop | Health is at $10$ HP ($5$ hearts), but hunger bar is full ($20$ food points). | Bot cannot consume standard food because food bar is full ($20/20$). Loop detects saturation healing in progress and waits unless a `golden_apple` is held. |
| 19 | Auto-Eat Loop | Bot is starving ($2$ hunger), and only `rotten_flesh` and `pufferfish` are in inventory. | Filter strictly prohibits `pufferfish` (fatal). Permissive starvation clause allows `rotten_flesh` as emergency sustenance to prevent starvation damage. |
| 20 | Auto-Sleep Loop | Night falls, but a zombie is groaning behind a bedroom wall $6$ blocks from bed. | Server would reject sleep with "You may not rest now, there are monsters nearby". Bot scans $8$m radius, detects zombie, and eliminates it before sleeping. |
| 21 | Auto-Sleep Loop | User triggers sleep command at noon (tick $6000$) in clear weather. | Time check verifies $6000 \notin [12542, 23458]$ and `isRaining` is false. Sleep routine politely rejects request with explanation. |
| 22 | Auto-Equip Loop | Inventory contains an un-enchanted Diamond Chestplate (Defense $8$, Toughness $2$) and an Iron Chestplate with Protection IV (Defense $6$, $+16\%$ effective resist). | Composite score formula weighs Protection IV ($+60$ pts) against diamond tier advantage, equipping the piece with optimal effective defense against damage. |
| 23 | Hazard Mitigation | Bot falls into deep water trench with no stairs and oxygen drops to $5$ bubbles. | Drowning reflex takes absolute priority over current tasks: pathfinder sets goal to surface water level, jumps continuously, and reaches open air. |
| 24 | Hazard Mitigation | Gravel falls on bot's head while mining a cave ceiling. | Suffocation detector triggers: immediately digs falling gravel block at head level and takes $2$ steps backward into cleared tunnel. |
| 25 | Verification CI | Test suite runs on a headless Linux container with zero GPU, no audio device, and no Java runtime. | Mock harness runs entirely in Node.js/Vitest with in-memory world and EventEmitter protocol stubs, completing all test assertions in $< 5$ seconds. |

---

## 9. Architectural Integration & Contracts

### 9.1 Exported Interfaces for Milestone Implementers

The following TypeScript interface definitions establish the structural contracts for Milestone 2 implementers and the Gemini AI Tool Bridge (Milestone 3):

```ts
export interface IPerceptionService {
  canSeeBlock(eyePos: Vec3, blockPos: Vec3): boolean;
  canSeeEntity(eyePos: Vec3, entity: Entity): boolean;
  findLegitimateVisibleBlocks(bot: Bot, options: BlockFilterOptions): Block[];
  getDiscoveredResourceMemory(): Vec3[];
}

export interface IPhysicalLimitsEnforcer {
  assertBlockReach(eyePos: Vec3, targetPos: Vec3): void;
  assertEntityReach(eyePos: Vec3, entity: Entity): void;
  assertSurvivalCommand(command: string): void;
}

export interface IPathfindingService {
  goTo(goal: Goal, options?: PathOptions): Promise<void>;
  approach(target: Vec3, range?: number): Promise<void>;
  stop(): void;
  isStalled(): boolean;
}

export interface IBlockInteractionService {
  mineVisibleBlock(block: Block): Promise<void>;
  placeBlockAgainst(referenceBlock: Block, faceVector: Vec3, blockItemName: string): Promise<void>;
}

export interface ISurvivalLoopManager {
  startAll(): void;
  stopAll(): void;
  triggerAutoEatNow(): Promise<boolean>;
  triggerAutoSleepNow(): Promise<boolean>;
  triggerAutoEquipNow(): Promise<void>;
}
```

---

*End of Requirement R2 Technical Specification.*
