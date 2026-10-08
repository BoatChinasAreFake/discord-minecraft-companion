# Milestone 2 Technical Investigation & Implementation Blueprint: Minecraft Fair-Play Survival Engine

**Author:** Explorer 1 (Read-Only Investigation)  
**Date:** 2026-10-07  
**Scope:** Perception & Anti-Xray, Fair-Play Limits, and Offline Mock Minecraft Architecture  
**Working Directory:** `.agents/teamwork/explorer_m2_1/`  
**Project Workspace:** `c:\Users\rando\Documents\antigravity\wise-pasteur`  

---

## 1. Executive Summary & Problem Scope

Milestone 2 establishes the Minecraft client agent engine operating under strict survival fair-play rules. In survival multiplayer (SMP) environments, automated bots are often banned if they employ client-side cheats such as:
1. **X-Ray / Unexposed Block Scanning:** Inspecting underground chunk block data directly to pinpoint concealed diamond/ancient debris veins encased in solid stone.
2. **Wall-Hacking / Sight Piercing:** Targeting blocks or entities through opaque walls without valid line of sight (LOS).
3. **Omniscient Angle Perception:** Interacting with objects directly behind the bot's head across long distances without physical line-of-sight orientation.
4. **Reach Cheats:** Interacting with blocks beyond survival reach ($> 4.50$m) or attacking entities beyond survival melee reach ($> 3.50$m).
5. **Privileged Command Abuse:** Invoking administrative / OP commands (`/tp`, `/give`, `/gamemode`, `/kill`, etc.) to bypass survival progression.

To guarantee 100% fair-play survival compliance and enable 100% offline, zero-secret continuous integration (CI) test execution, this investigation specifies:
- **Surface Exposure Filter (`src/minecraft/perception/exposure.ts`)**: 6-connectivity adjacency analysis to reject encased blocks.
- **3D Line-of-Sight Raycasting (`src/minecraft/perception/raycast.ts`)**: Amanatides & Woo 3D Digital Differential Analyzer (3D DDA) voxel traversal from eye position to target exposed face centers.
- **Field-of-View Cone & Tactile Fallback (`src/minecraft/perception/fov.ts`)**: $70^\circ$ focal FOV cone ($\cos(35^\circ) \approx 0.81915$) with a $2.50$m near-field tactile fallback radius.
- **Reach Enforcer (`src/minecraft/fairplay/reach.ts`)**: Strict physical distance limits: block interaction $\le 4.50$m, entity attack reach $\le 3.50$m.
- **Command Sanitizer (`src/minecraft/fairplay/commandSanitizer.ts`)**: Hardened regex and normalization filter prohibiting all OP commands and command-block execution wrappers.
- **Offline Mock Minecraft Architecture (`test/mocks/mockMinecraft.ts`)**: Complete in-memory voxel grid world, event emitter bot, inventory, equipment, and pathfinder plugin emulation for deterministic, sub-second test execution.

---

## 2. Perception & Anti-Xray Subsystem

```
                    ┌──────────────────────────────────────────────┐
                    │               Candidate Block                │
                    │         (e.g., diamond_ore at (x,y,z))       │
                    └──────────────────────┬───────────────────────┘
                                           │
                                           ▼
             [Stage 1: Exposure Filter (exposure.ts)]
             Check 6 adjacent neighbors (+X,-X,+Y,-Y,+Z,-Z)
             Are all 6 neighbors solid/opaque?
                    ├── YES ──► [DISCARD: Hidden / Encased Ore (Anti-Xray)]
                    └── NO
                        │ (Exposed Faces Found: Top, North, etc.)
                        ▼
             [Stage 2: FOV & Tactile Filter (fov.ts)]
             Is distance <= 2.50m (Tactile Radius)?
                    ├── YES ──► Proceed to Stage 3
                    └── NO
                        │
                        Is target inside 70° Focal Cone (dot >= cos(35°))?
                               ├── NO  ──► [DISCARD: Outside Field of View]
                               └── YES ──► Proceed to Stage 3
                                           │
                                           ▼
             [Stage 3: 3D DDA Raycast (raycast.ts)]
             Cast 3D DDA rays from Eye Pos (x, y+1.62, z) to exposed face centers
             Does ray hit solid/opaque block before reaching target face?
                    ├── YES ──► [DISCARD: Occluded by Wall / Obstacle]
                    └── NO  ──► [PERCEIVED: Valid Fair-Play Visible Block]
```

### 2.1 Surface Exposure Filter (`src/minecraft/perception/exposure.ts`)

#### 2.1.1 Neighbor Topology & Coordinate Offsets
For any integer block coordinate $\vec{p} = (x, y, z) \in \mathbb{Z}^3$, there are exactly 6 cardinal neighbor faces:
1. $+X$ (East): $(x + 1, y, z)$, face center: $(x + 1.0, y + 0.5, z + 0.5)$
2. $-X$ (West): $(x - 1, y, z)$, face center: $(x + 0.0, y + 0.5, z + 0.5)$
3. $+Y$ (Up): $(x, y + 1, z)$, face center: $(x + 0.5, y + 1.0, z + 0.5)$
4. $-Y$ (Down): $(x, y - 1, z)$, face center: $(x + 0.5, y + 0.0, z + 0.5)$
5. $+Z$ (South): $(x, y, z + 1)$, face center: $(x + 0.5, y + 0.5, z + 1.0)$
6. $-Z$ (North): $(x, y, z - 1)$, face center: $(x + 0.5, y + 0.5, z + 0.0)$

#### 2.1.2 Block Classification: Exposing vs. Occluding
A face of block $\vec{p}$ is **exposed** if the adjacent neighbor block allows light to pass, is fluid, or is non-solid.
- **Exposing Blocks (Non-Solid / Transparent / Fluid):**
  - Gaseous / empty: `air`, `cave_air`, `void_air`
  - Fluids: `water`, `lava`
  - Glass: `glass`, `tinted_glass`, `white_stained_glass`, etc.
  - Leaves / Foliage: `oak_leaves`, `birch_leaves`, `spruce_leaves`, `jungle_leaves`, `acacia_leaves`, `dark_oak_leaves`, `mangrove_leaves`, `cherry_leaves`, `azalea_leaves`
  - Flora: `grass`, `tall_grass`, `fern`, `large_fern`, `dandelion`, `poppy`, `flower_pot`, `vine`, `glow_lichen`, `sculk_vein`, `seagrass`, `kelp`
  - Utility / Redstone: `torch`, `wall_torch`, `lantern`, `redstone_wire`, `lever`, `repeater`, `comparator`, `rail`
  - Partial Structures: `ladder`, `scaffolding`, `cobweb`, `iron_bars`, `chain`, `carpet`, `snow` (layer)
  - Interactive / Non-full: `door`, `trapdoor`, `fence`, `fence_gate`, `slab`, `stairs`
- **Occluding Blocks (Full Opaque Cubes):**
  - `stone`, `deepslate`, `dirt`, `cobblestone`, `iron_ore`, `coal_ore`, `diamond_ore`, `gold_ore`, `copper_ore`, `granite`, `diorite`, `andesite`, `netherrack`, `end_stone`, `oak_planks`, `obsidian`, `bedrock`, etc.
- **Unloaded / Out-of-Bounds Chunks:**
  - If `world.getBlock(neighborPos)` returns `null` or `undefined` (chunk unloaded), the neighbor is treated as **occluding / unexposed**. This prevents false x-ray leakage across chunk boundaries.

#### 2.1.3 Interface & Implementation Specification
```typescript
import type { Vec3Location } from '../types.js';

export type BlockFace = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

export interface FaceDefinition {
  face: BlockFace;
  normal: Vec3Location;
  faceCenterOffset: Vec3Location;
}

export const CARDINAL_FACES: FaceDefinition[] = [
  { face: '+x', normal: { x: 1, y: 0, z: 0 }, faceCenterOffset: { x: 1.0, y: 0.5, z: 0.5 } },
  { face: '-x', normal: { x: -1, y: 0, z: 0 }, faceCenterOffset: { x: 0.0, y: 0.5, z: 0.5 } },
  { face: '+y', normal: { x: 0, y: 1, z: 0 }, faceCenterOffset: { x: 0.5, y: 1.0, z: 0.5 } },
  { face: '-y', normal: { x: 0, y: -1, z: 0 }, faceCenterOffset: { x: 0.5, y: 0.0, z: 0.5 } },
  { face: '+z', normal: { x: 0, y: 0, z: 1 }, faceCenterOffset: { x: 0.5, y: 0.5, z: 1.0 } },
  { face: '-z', normal: { x: 0, y: 0, z: -1 }, faceCenterOffset: { x: 0.5, y: 0.5, z: 0.0 } },
];

export interface IBlockAccessor {
  getBlock(pos: Vec3Location): { name: string; transparent?: boolean; boundingBox?: string } | null;
}

export interface BlockExposure {
  isExposed: boolean;
  exposedFaces: BlockFace[];
  exposedFaceCenters: Vec3Location[];
}

export function isExposingBlock(block: { name: string; transparent?: boolean; boundingBox?: string } | null): boolean {
  if (!block) return false; // Unloaded chunks do not expose
  if (block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') return true;
  if (block.transparent === true) return true;
  if (block.boundingBox === 'empty') return true;
  if (EXPOSING_BLOCK_NAMES.has(block.name)) return true;
  return false;
}

export function evaluateBlockExposure(world: IBlockAccessor, pos: Vec3Location): BlockExposure {
  const exposedFaces: BlockFace[] = [];
  const exposedFaceCenters: Vec3Location[] = [];

  for (const { face, normal, faceCenterOffset } of CARDINAL_FACES) {
    const neighborPos = { x: pos.x + normal.x, y: pos.y + normal.y, z: pos.z + normal.z };
    const neighbor = world.getBlock(neighborPos);
    if (isExposingBlock(neighbor)) {
      exposedFaces.push(face);
      exposedFaceCenters.push({
        x: pos.x + faceCenterOffset.x,
        y: pos.y + faceCenterOffset.y,
        z: pos.z + faceCenterOffset.z,
      });
    }
  }

  return {
    isExposed: exposedFaces.length > 0,
    exposedFaces,
    exposedFaceCenters,
  };
}
```

---

### 2.2 3D Line-of-Sight Raycasting (`src/minecraft/perception/raycast.ts`)

#### 2.2.1 Amanatides & Woo 3D Digital Differential Analyzer (3D DDA)
The Amanatides & Woo (1987) algorithm traverses every 3D voxel intersected by a ray from an origin point $\vec{O} = (x_0, y_0, z_0)$ along direction vector $\vec{D} = (D_x, D_y, D_z)$ in $O(N)$ operations where $N$ is the number of traversed voxels.

**Mathematical Derivation:**
1. **Initial Voxel:**
   $$X = \lfloor x_0 \rfloor, \quad Y = \lfloor y_0 \rfloor, \quad Z = \lfloor z_0 \rfloor$$
2. **Step Sign:**
   $$\text{stepX} = D_x > 0 ? 1 : (D_x < 0 ? -1 : 0)$$
   $$\text{stepY} = D_y > 0 ? 1 : (D_y < 0 ? -1 : 0)$$
   $$\text{stepZ} = D_z > 0 ? 1 : (D_z < 0 ? -1 : 0)$$
3. **$tDelta$ (Distance along ray between consecutive voxel boundaries along each axis):**
   $$tDeltaX = |1 / D_x| \quad (\text{if } D_x \ne 0 \text{ else } \infty)$$
   $$tDeltaY = |1 / D_y| \quad (\text{if } D_y \ne 0 \text{ else } \infty)$$
   $$tDeltaZ = |1 / D_z| \quad (\text{if } D_z \ne 0 \text{ else } \infty)$$
4. **$tMax$ (Distance along ray from origin to the very first voxel boundary):**
   - For $X$:
     $$\text{If } \text{stepX} > 0: \quad tMaxX = \frac{(X + 1) - x_0}{D_x}$$
     $$\text{If } \text{stepX} < 0: \quad tMaxX = \frac{X - x_0}{D_x}$$
     $$\text{If } \text{stepX} == 0: \quad tMaxX = \infty$$
   - Same formulas for $Y$ and $Z$.
5. **Voxel Stepping Loop:**
   At each step, find the minimum of $(tMaxX, tMaxY, tMaxZ)$ and advance by 1 in that axis:
   ```typescript
   if (tMaxX < tMaxY && tMaxX < tMaxZ) {
     X += stepX;
     tCurrent = tMaxX;
     tMaxX += tDeltaX;
   } else if (tMaxY < tMaxZ) {
     Y += stepY;
     tCurrent = tMaxY;
     tMaxY += tDeltaY;
   } else {
     Z += stepZ;
     tCurrent = tMaxZ;
     tMaxZ += tDeltaZ;
   }
   ```
6. **Termination Conditions:**
   - If current voxel $(X, Y, Z)$ matches the target block coordinates: **Ray hit target unobstructed $\implies$ VISIBLE.**
   - If current voxel $(X, Y, Z)$ is solid and opaque (not an exposing block): **Ray hit an occluding obstacle $\implies$ NOT VISIBLE.**
   - If $tCurrent > \text{maxDistance}$: **Ray exceeded search distance $\implies$ NOT VISIBLE.**

#### 2.2.2 Multi-Face Target Sampling
When checking whether block $\vec{B}$ is visible:
- Casting only to the block center $(x+0.5, y+0.5, z+0.5)$ can produce false negatives when looking obliquely at an exposed face (the ray may clip the edge of an adjacent block before reaching center).
- **Solution:** Test rays from the eye position to the center of each **exposed face** (determined by `evaluateBlockExposure`).
- If **at least one** exposed face center has an unobstructed ray from the eye position, the block has line of sight!

```typescript
export interface RaycastHit {
  visible: boolean;
  hitVoxel?: Vec3Location;
  obstruction?: string;
  distance: number;
}

export function checkLineOfSight(
  world: IBlockAccessor,
  eye: Vec3Location,
  targetVoxel: Vec3Location,
  targetPoint: Vec3Location,
  maxDistance = 32.0
): RaycastHit {
  const dx = targetPoint.x - eye.x;
  const dy = targetPoint.y - eye.y;
  const dz = targetPoint.z - eye.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist > maxDistance) {
    return { visible: false, distance: dist, obstruction: 'MAX_DISTANCE_EXCEEDED' };
  }
  if (dist < 1e-6) {
    return { visible: true, distance: 0 };
  }

  // Normalized direction
  const dir = { x: dx / dist, y: dy / dist, z: dz / dist };

  let X = Math.floor(eye.x);
  let Y = Math.floor(eye.y);
  let Z = Math.floor(eye.z);

  const stepX = dir.x > 0 ? 1 : (dir.x < 0 ? -1 : 0);
  const stepY = dir.y > 0 ? 1 : (dir.y < 0 ? -1 : 0);
  const stepZ = dir.z > 0 ? 1 : (dir.z < 0 ? -1 : 0);

  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;

  let tMaxX = dir.x > 0 ? ((X + 1) - eye.x) / dir.x : (dir.x < 0 ? (X - eye.x) / dir.x : Infinity);
  let tMaxY = dir.y > 0 ? ((Y + 1) - eye.y) / dir.y : (dir.y < 0 ? (Y - eye.y) / dir.y : Infinity);
  let tMaxZ = dir.z > 0 ? ((Z + 1) - eye.z) / dir.z : (dir.z < 0 ? (Z - eye.z) / dir.z : Infinity);

  let tCurrent = 0;
  const targetX = Math.floor(targetVoxel.x);
  const targetY = Math.floor(targetVoxel.y);
  const targetZ = Math.floor(targetVoxel.z);

  while (tCurrent <= dist + 0.1) {
    if (X === targetX && Y === targetY && Z === targetZ) {
      return { visible: true, distance: tCurrent };
    }

    // Check if current voxel is opaque obstacle (skip start voxel if inside air)
    const block = world.getBlock({ x: X, y: Y, z: Z });
    if (block && !isExposingBlock(block)) {
      return { visible: false, hitVoxel: { x: X, y: Y, z: Z }, obstruction: block.name, distance: tCurrent };
    }

    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      X += stepX;
      tCurrent = tMaxX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxZ) {
      Y += stepY;
      tCurrent = tMaxY;
      tMaxY += tDeltaY;
    } else {
      Z += stepZ;
      tCurrent = tMaxZ;
      tMaxZ += tDeltaZ;
    }
  }

  return { visible: false, distance: dist, obstruction: 'RAY_OVERSHOT' };
}
```

---

### 2.3 Field-of-View Cone & Tactile Fallback (`src/minecraft/perception/fov.ts`)

#### 2.3.1 Specification & Geometry
Human survival gameplay combines two modes of perception:
1. **Focal Vision Cone:** A $70^\circ$ visual field centered on the player's look vector.
   - Half-angle: $\theta = 35^\circ$.
   - Threshold: $\cos(35^\circ) \approx 0.8191520442889918$.
   - Any object farther than $2.50$m must lie inside this cone:
     $$\hat{V}_{look} \cdot \hat{D}_{target} \ge \cos(35^\circ)$$
2. **Tactile Near-Field Fallback:** A $2.50$m radius spherical bubble around the player's eye position.
   - Any block or entity within $\le 2.50$m is perceived regardless of gaze angle.
   - **Rationale:** Survival players routinely mine blocks underfoot, place blocks behind themselves while backing up, or reach adjacent chests without snapping camera orientation.

#### 2.3.2 Mineflayer Orientation to Look Vector
In Mineflayer / Minecraft protocol:
- $yaw$ is horizontal rotation in radians.
- $pitch$ is vertical tilt in radians (0 is horizontal horizon, $<0$ looking up, $>0$ looking down).
- Unit look vector:
  $$\vec{V}_{look} = \begin{pmatrix} -\sin(yaw) \cdot \cos(pitch) \\ -\sin(pitch) \\ -\cos(yaw) \cdot \cos(pitch) \end{pmatrix}$$

#### 2.3.3 Interface & Implementation
```typescript
export interface FOVCheckResult {
  inPerception: boolean;
  mode: 'tactile' | 'focal_fov' | 'outside';
  distance: number;
  angleDegrees?: number;
  dotProduct?: number;
}

export const TACTILE_RADIUS_METERS = 2.50;
export const FOV_HALF_ANGLE_DEGREES = 35.0;
export const FOV_COS_THRESHOLD = Math.cos((FOV_HALF_ANGLE_DEGREES * Math.PI) / 180); // ~0.81915

export function getLookVectorFromYawPitch(yaw: number, pitch: number): Vec3Location {
  const cosPitch = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cosPitch,
    y: -Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch,
  };
}

export function isWithinPerceptionFOV(
  eyePos: Vec3Location,
  targetPos: Vec3Location,
  lookVector: Vec3Location
): FOVCheckResult {
  const dx = targetPos.x - eyePos.x;
  const dy = targetPos.y - eyePos.y;
  const dz = targetPos.z - eyePos.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // 1. Tactile Fallback Rule: <= 2.50m
  if (distance <= TACTILE_RADIUS_METERS) {
    return {
      inPerception: true,
      mode: 'tactile',
      distance,
    };
  }

  // 2. Focal FOV Cone Rule: > 2.50m
  const lookMag = Math.sqrt(
    lookVector.x * lookVector.x + lookVector.y * lookVector.y + lookVector.z * lookVector.z
  );
  if (lookMag < 1e-6 || distance < 1e-6) {
    return { inPerception: false, mode: 'outside', distance };
  }

  const dot = (lookVector.x * dx + lookVector.y * dy + lookVector.z * dz) / (lookMag * distance);
  const clampedDot = Math.max(-1, Math.min(1, dot));
  const angleDeg = (Math.acos(clampedDot) * 180) / Math.PI;

  if (clampedDot >= FOV_COS_THRESHOLD) {
    return {
      inPerception: true,
      mode: 'focal_fov',
      distance,
      angleDegrees: angleDeg,
      dotProduct: clampedDot,
    };
  }

  return {
    inPerception: false,
    mode: 'outside',
    distance,
    angleDegrees: angleDeg,
    dotProduct: clampedDot,
  };
}
```

---

## 3. Fair-Play Physical Limits & Anti-Cheat Subsystem

### 3.1 Reach Enforcer (`src/minecraft/fairplay/reach.ts`)

#### 3.1.1 Physical Constants & Standards
Vanilla Minecraft Java Edition enforces strict limits between the player's camera eye position $\vec{E} = (x, y + 1.62, z)$ and the target:
- **Maximum Block Reach:** Strictly $\le 4.50$ meters.
- **Maximum Entity Attack Reach:** Strictly $\le 3.50$ meters.

#### 3.1.2 Bounding Box (AABB) Clamping Math
A Minecraft voxel block occupies a unit axis-aligned bounding box (AABB):
$$[x, x+1] \times [y, y+1] \times [z, z+1]$$
To measure the true physical interaction distance to a block from eye point $\vec{E}$, we compute the closest point on the block's AABB:
$$c_x = \text{clamp}(E_x, x, x + 1), \quad c_y = \text{clamp}(E_y, y, y + 1), \quad c_z = \text{clamp}(E_z, z, z + 1)$$
$$d_{AABB} = \sqrt{(E_x - c_x)^2 + (E_y - c_y)^2 + (E_z - c_z)^2}$$
- If $d_{AABB} \le 4.50$, the block is physically reachable.
- If $d_{AABB} > 4.50$, interaction is strictly rejected!

For entities (player/mob), the distance is measured to the closest point of the entity bounding box $[x - w/2, x + w/2] \times [y, y + h] \times [z - w/2, z + w/2]$ or center $(x, y + h/2, z)$:
$$d_{entity} \le 3.50\text{m}$$

#### 3.1.3 Implementation Specification
```typescript
export class ReachExceededError extends Error {
  constructor(
    public readonly targetType: 'block' | 'entity',
    public readonly distance: number,
    public readonly maxAllowed: number,
    public readonly targetPos: Vec3Location
  ) {
    super(
      `Fair-Play Reach Exceeded: ${targetType} interaction at distance ${distance.toFixed(2)}m exceeds max allowed limit of ${maxAllowed.toFixed(2)}m`
    );
    this.name = 'ReachExceededError';
  }
}

export const MAX_BLOCK_REACH_METERS = 4.50;
export const MAX_ENTITY_ATTACK_REACH_METERS = 3.50;

export function getBlockDistanceToEye(eyePos: Vec3Location, blockPos: Vec3Location): number {
  const minX = Math.floor(blockPos.x);
  const maxX = minX + 1.0;
  const minY = Math.floor(blockPos.y);
  const maxY = minY + 1.0;
  const minZ = Math.floor(blockPos.z);
  const maxZ = minZ + 1.0;

  const cx = Math.max(minX, Math.min(eyePos.x, maxX));
  const cy = Math.max(minY, Math.min(eyePos.y, maxY));
  const cz = Math.max(minZ, Math.min(eyePos.z, maxZ));

  const dx = eyePos.x - cx;
  const dy = eyePos.y - cy;
  const dz = eyePos.z - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function assertBlockReach(eyePos: Vec3Location, blockPos: Vec3Location): number {
  const dist = getBlockDistanceToEye(eyePos, blockPos);
  if (dist > MAX_BLOCK_REACH_METERS) {
    throw new ReachExceededError('block', dist, MAX_BLOCK_REACH_METERS, blockPos);
  }
  return dist;
}

export function assertEntityAttackReach(eyePos: Vec3Location, entityPos: Vec3Location): number {
  const dx = entityPos.x - eyePos.x;
  const dy = (entityPos.y + 0.9) - eyePos.y; // Center of standard 1.8m mob
  const dz = entityPos.z - eyePos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist > MAX_ENTITY_ATTACK_REACH_METERS) {
    throw new ReachExceededError('entity', dist, MAX_ENTITY_ATTACK_REACH_METERS, entityPos);
  }
  return dist;
}
```

---

### 3.2 Command Sanitizer (`src/minecraft/fairplay/commandSanitizer.ts`)

#### 3.2.1 Prohibited Command Matrix
Any command that circumvents regular survival gameplay or requires OP/administrative permissions must be blocked.
1. **Movement / Teleportation:** `/tp`, `/teleport`, `/tphere`, `/s`, `/tpa`, `/tpaccept`, `/warp`, `/home`, `/back`, `/spawn` (admin), `/fly`, `/god`, `/speed`
2. **Item / Block Cheating:** `/give`, `/i`, `/item`, `/setblock`, `/fill`, `/clone`, `/replaceitem`, `/loot`
3. **World / Gamemode Exploits:** `/gamemode`, `/gm`, `/gamerule`, `/difficulty`, `/time`, `/weather`, `/seed`, `/locate`, `/locatebiome`, `/defaultgamemode`
4. **Entity / Combat Manipulation:** `/summon`, `/kill`, `/effect`, `/enchant`, `/attribute`, `/damage`, `/tag`, `/data`, `/scoreboard`, `/team`
5. **Administrative Controls:** `/op`, `/deop`, `/stop`, `/kick`, `/ban`, `/ban-ip`, `/pardon`, `/pardon-ip`, `/whitelist`, `/reload`, `/save-all`, `/save-off`, `/save-on`, `/publish`, `/debug`
6. **Execution Wrappers:** `/execute`, `/function`, `/advancement`, `/recipe`, `/experience`, `/xp`, `/bossbar`, `/forceload`, `/particle`, `/playsound`, `/stopsound`, `/title`, `/tellraw`

#### 3.2.2 Anti-Evasion Normalization Pipeline
Attackers or hallucinating models may attempt evasions:
1. **Whitespace Trimming:** `   /tp 0 100 0   `
2. **Hidden Unicode Stripping:** Zero-width spaces (`\u200B`), non-breaking spaces (`\u00A0`), control characters.
3. **Multiple Leading Slashes:** `//tp`, `///give`
4. **Namespace Prefixes:** `/minecraft:tp`, `/minecraft:give`, `/essentials:fly`
5. **Mixed / Upper Case:** `/Tp`, `/GIVE`, `/GameMode`
6. **Chat vs. Command Distinction:** A normal message such as `"Can someone explain how /tp works in Minecraft?"` does **not** begin with `/` and must be permitted as valid survival player speech!

#### 3.2.3 Implementation Specification
```typescript
export class PrivilegedCommandError extends Error {
  constructor(public readonly command: string, public readonly reason: string) {
    super(`CommandSanitizer Blocked Privileged OP Command: "${command}" (${reason})`);
    this.name = 'PrivilegedCommandError';
  }
}

export const BLOCKED_COMMANDS = new Set<string>([
  'tp', 'teleport', 'tphere', 's', 'tpa', 'tpaccept', 'warp', 'home', 'back', 'spawn',
  'fly', 'god', 'speed', 'heal', 'feed',
  'give', 'i', 'item', 'setblock', 'fill', 'clone', 'replaceitem', 'loot',
  'gamemode', 'gm', 'gamerule', 'difficulty', 'time', 'weather', 'seed', 'locate', 'locatebiome', 'defaultgamemode',
  'summon', 'kill', 'effect', 'enchant', 'attribute', 'damage', 'tag', 'data', 'scoreboard', 'team',
  'op', 'deop', 'stop', 'kick', 'ban', 'ban-ip', 'pardon', 'pardon-ip', 'whitelist', 'reload', 'save-all', 'save-off', 'save-on', 'publish', 'debug',
  'execute', 'function', 'advancement', 'recipe', 'experience', 'xp', 'bossbar', 'forceload', 'particle', 'playsound', 'stopsound', 'title', 'tellraw'
]);

export interface CommandSanitizeResult {
  isCommand: boolean;
  allowed: boolean;
  commandName?: string;
  cleanedText: string;
  reason?: string;
}

export function sanitizeMinecraftMessage(input: string): CommandSanitizeResult {
  if (!input || typeof input !== 'string') {
    return { isCommand: false, allowed: true, cleanedText: '' };
  }

  // 1. Strip zero-width and invisible control characters
  const normalized = input.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

  // 2. If it does not start with '/', it is regular in-game chat -> ALLOW
  if (!normalized.startsWith('/')) {
    return { isCommand: false, allowed: true, cleanedText: normalized };
  }

  // 3. Extract root command after any leading slashes and optional namespace (e.g. /minecraft:give)
  const match = normalized.match(/^\/+(?:([a-zA-Z0-9_-]+):)?([a-zA-Z0-9_-]+)/i);
  if (!match) {
    // Malformed command beginning with slash
    return { isCommand: true, allowed: false, cleanedText: normalized, reason: 'MALFORMED_COMMAND' };
  }

  const rootCommand = match[2].toLowerCase();

  // 4. Check against blocked commands
  if (BLOCKED_COMMANDS.has(rootCommand)) {
    return {
      isCommand: true,
      allowed: false,
      commandName: rootCommand,
      cleanedText: normalized,
      reason: `PRIVILEGED_OP_COMMAND_${rootCommand.toUpperCase()}`
    };
  }

  return {
    isCommand: true,
    allowed: true,
    commandName: rootCommand,
    cleanedText: normalized
  };
}

export function assertAllowedMinecraftChat(message: string): string {
  const result = sanitizeMinecraftMessage(message);
  if (result.isCommand && !result.allowed) {
    throw new PrivilegedCommandError(result.commandName || message, result.reason || 'DISALLOWED_COMMAND');
  }
  return result.cleanedText;
}
```

---

## 4. Offline Mock Minecraft Architecture (`test/mocks/mockMinecraft.ts`)

To ensure 100% test isolation, sub-second execution, and zero dependency on running external Java processes, the offline mock architecture must implement the full Mineflayer contract and 3D world state.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        test/mocks/mockMinecraft.ts                     │
├────────────────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────┐        ┌───────────────────────────────┐ │
│ │        MockWorld          │        │      MockMineflayerBot        │ │
│ │  - Map<string, MockBlock> │        │  (extends EventEmitter)       │ │
│ │  - getBlock / setBlock    │◄───────┤  - position / yaw / pitch     │ │
│ │  - createFlatWorld        │        │  - health / food / equipment  │ │
│ │  - loadBox / raycast      │        │  - inventory slots & items    │ │
│ └───────────────────────────┘        │  - pathfinder emulation       │ │
│                                      │  - dig / place / eat / sleep  │ │
│                                      └───────────────▲───────────────┘ │
│                                                      │                 │
│                                      ┌───────────────┴───────────────┐ │
│                                      │       MockMinecraftAgent      │ │
│                                      │    (implements IMinecraftAgent│ │
│                                      │     + IMinecraftChatAgent)    │ │
│                                      └───────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.1 In-Memory 3D Voxel World (`MockWorld`)
- **Key Coordinate Indexing:** `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`
- **Sparse Storage:** Unset blocks default to `{ name: 'air', transparent: true, boundingBox: 'empty' }`.
- **Predefined Materials Database:** Automatically assigns `transparent`, `boundingBox`, `hardness`, and `diggable` flags for common materials (`air`, `stone`, `dirt`, `grass_block`, `water`, `lava`, `glass`, `oak_leaves`, `oak_log`, `diamond_ore`, `iron_ore`, `white_bed`, etc.).
- **Convenience Generation:**
  - `createFlatWorld(bedrockY = 0, stoneY = 60, dirtY = 63, surface = 'grass_block')`
  - `loadBox(min, max, blockName)`
  - `setBlock(pos, blockOrName)`

### 4.2 Mock Mineflayer Bot (`MockMineflayerBot`)
- Extends `EventEmitter` from `node:events`.
- **Bot Physics & Vitals:**
  - `entity.position`: Vec3 instance $(x, y, z)$
  - `entity.yaw`: number (radians)
  - `entity.pitch`: number (radians)
  - `entity.height`: 1.62
  - `health`: 20.0
  - `food`: 20
  - `foodSaturation`: 5.0
- **Equipment & Inventory:**
  - Standard 36/45-slot inventory array.
  - Slots:
    - `0`: held item (`bot.heldItem`)
    - `5`: helmet, `6`: chestplate, `7`: leggings, `8`: boots, `45`: off-hand
  - `bot.inventory.items()` returns array of non-null items.
  - `bot.equip(item, destination)` accurately equips items into armor/hand slots.
- **Pathfinder Plugin Emulation (`bot.pathfinder`):**
  - `goto(goal)`: Asynchronously updates `bot.entity.position` to goal destination in simulated ticks.
  - `setGoal(goal)`: Records current goal.
  - `stop()`: Halts ongoing pathfinding.
  - `isMoving()`: Boolean flag.
- **Action Simulation:**
  - `dig(block)`: Validates reach $\le 4.50$m, removes block from `MockWorld`, replaces with air.
  - `placeBlock(referenceBlock, faceVector)`: Places target block into `MockWorld`.
  - `consume()`: Increments `food` and `foodSaturation`.
  - `sleep(bedBlock)`: Checks for nearby monsters; emits sleep event.
  - `chat(message)`: Passes through `sanitizeMinecraftMessage`; emits `'chat'` event to listeners.

### 4.3 Mock Minecraft Agent (`MockMinecraftAgent`)
Implements `IMinecraftAgent` (`src/minecraft/types.ts`) and `IMinecraftChatAgent` (`src/bridge/types.ts`):
- Bridges Discord Chat Bridge to in-game chat events.
- Exposes `canInteractWith(pos)` validating both reach ($\le 4.50$m) and 3D line-of-sight.
- Exposes `findVisibleBlock(criteria)` combining exposure filter, FOV cone/tactile fallback, and raycast.
- Exposes `getStatus()` returning structured `MinecraftBotStatus` for live Discord embeds.

---

## 5. Architectural Alignment & File Organization

### 5.1 Target File Structure
```
src/minecraft/
├── types.ts                    # Core interfaces (already created in M1)
├── client.ts                   # Mineflayer lifecycle manager (IMinecraftAgent implementation)
├── perception/
│   ├── exposure.ts             # 6-neighbor surface exposure filter & classification
│   ├── raycast.ts              # Amanatides & Woo 3D DDA line-of-sight raycaster
│   └── fov.ts                  # 70° focal FOV cone + 2.5m tactile fallback
├── fairplay/
│   ├── reach.ts                # 4.50m block & 3.50m entity reach enforcer
│   ├── commandSanitizer.ts     # Anti-OP command blocker & evasion normalizer
│   └── rules.ts                # Survival constraint constants & configuration
├── actions/
│   ├── pathfinding.ts          # Safe drop / hazard penalty navigation wrapper
│   ├── mining.ts               # Harvest tier validation & raycast dig execution
│   ├── inventory.ts            # Inventory querying & sorting
│   ├── crafting.ts             # 2x2 player grid and 3x3 table crafting
│   └── combat.ts               # 1.9+ attack cooldown & shield protection
└── loops/
    ├── autoEat.ts              # Hunger/health monitoring & saturation optimization
    ├── autoSleep.ts            # Night detection & monster exclusion bed sleeping
    └── autoEquip.ts            # Composite defense score auto-equipper

test/
├── mocks/
│   ├── mockDiscord.ts          # Existing Discord mock
│   ├── mockVoice.ts            # Existing Voice mock
│   ├── mockMinecraft.ts        # In-memory MockWorld, MockMineflayerBot, MockMinecraftAgent
│   └── index.ts                # Barrel export re-exporting all mocks
```

### 5.2 TypeScript Build Compliance
All relative imports in `src/` must specify `.js` extension (e.g. `import { evaluateBlockExposure } from './exposure.js'`) in accordance with `NodeNext` module resolution configured in `tsconfig.json`.

---

## 6. Comprehensive Verification & Test Matrix

To achieve 100% test coverage across isolated features and adversarial boundaries, the following test suites should be constructed:

| Test Suite | File | Focus | Key Test Cases |
|------------|------|-------|----------------|
| **TS-EXP-01** | `test/m2/exposure.test.ts` | Surface Exposure Filter | - Encased block (6 solid stone neighbors) returns `isExposed: false`<br>- Block exposed to air on +Y returns `isExposed: true`, `exposedFaces: ['+y']`<br>- Block exposed through transparent glass/water/leaves<br>- Unloaded chunk boundary (`null`) correctly treated as occluded |
| **TS-RAY-01** | `test/m2/raycast.test.ts` | 3D DDA Raycast | - Unobstructed LOS through air to target exposed face<br>- LOS blocked by intermediate solid stone wall returns `visible: false`<br>- Raycast passes cleanly through transparent glass and water<br>- Boundary corner rays and oblique angles traverse correctly without infinite loops |
| **TS-FOV-01** | `test/m2/fov.test.ts` | FOV Cone & Tactile | - Block directly in front ($0^\circ$ offset, 5m away) is within focal cone<br>- Block at $30^\circ$ offset ($< 35^\circ$) is within focal cone<br>- Block at $45^\circ$ offset ($> 35^\circ$, 5m away) is outside FOV<br>- Block at $180^\circ$ (behind player) but at 2.0m ($\le 2.5$m) succeeds via tactile fallback<br>- Block at $180^\circ$ and 3.0m is rejected |
| **TS-RCH-01** | `test/m2/reach.test.ts` | Reach Enforcer | - Block at distance 4.49m allowed<br>- Block at distance 4.51m throws `ReachExceededError`<br>- Entity attack at 3.49m allowed<br>- Entity attack at 3.51m throws `ReachExceededError`<br>- Exact AABB surface clamping calculations |
| **TS-CMD-01** | `test/m2/commandSanitizer.test.ts` | Command Sanitizer | - Rejects `/tp`, `/give`, `/gamemode`, `/op`, `/kill`<br>- Rejects disguised `/TP`, `/  give`, `/minecraft:tp`<br>- Rejects zero-width space injected commands<br>- Allows standard chat (`"We need to find iron"` or `"How does /tp work?"`) |
| **TS-MCK-01** | `test/m2/mockMinecraft.test.ts` | Mock World & Bot | - `MockWorld` setBlock and getBlock retrieval<br>- `MockMineflayerBot` inventory, health, food, and equip operations<br>- Pathfinding goto emulation updates player coordinates<br>- Zero external network calls or secrets required |

---

## 7. Conclusion & Next Steps

This investigation delivers a mathematically sound, complete, and modular blueprint for Milestone 2:
1. **Anti-Xray & Perception** guarantees the agent never exploits subterranean omniscience, restricting discovery to legitimate line-of-sight and surface exposure.
2. **Fair-Play Constraints** enforce standard human survival limits ($\le 4.50$m block reach, $\le 3.50$m combat reach, zero OP commands).
3. **Offline Mock Architecture** provides a self-contained in-memory simulation engine for 100% offline test execution.

Next step: Implement the specified components in `src/minecraft/` and `test/mocks/mockMinecraft.ts` during Milestone 2 development.
