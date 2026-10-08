import { EventEmitter } from 'node:events';
import type {
  IMinecraftAgent,
  MinecraftBotStatus,
  MinecraftConnectionConfig,
  ActionResult,
  VisibleBlock,
  BlockSearchCriteria,
  PathfindingOptions,
  Vec3Location,
} from '../../src/minecraft/types.js';
import type { IMinecraftChatAgent } from '../../src/bridge/types.js';
import { assertBlockReach, assertEntityAttackReach, getBlockDistanceToEye, getEntityDistanceToEye } from '../../src/minecraft/fairplay/reach.js';
import { sanitizeMinecraftMessage, assertAllowedMinecraftChat } from '../../src/minecraft/fairplay/commandSanitizer.js';
import { evaluateBlockExposure, type IBlockAccessor } from '../../src/minecraft/perception/exposure.js';
import { hasBlockLineOfSight } from '../../src/minecraft/perception/raycast.js';
import { getLookVectorFromYawPitch, isWithinPerceptionFOV } from '../../src/minecraft/perception/fov.js';

export interface MockItem {
  id?: number;
  name: string;
  count: number;
  type?: number;
  slot?: number;
  metadata?: number;
  nbt?: Record<string, unknown>;
  durabilityUsed?: number;
  maxDurability?: number;
  defense?: number;
  toughness?: number;
  knockbackResistance?: number;
  enchantments?: Array<{ name: string; level: number }>;
}

export interface MockBlock {
  name: string;
  position: Vec3Location;
  hardness: number;
  transparent: boolean;
  boundingBox: 'empty' | 'block';
  material?: string;
  diggable: boolean;
  occupied?: boolean;
}

export class Vec3Impl implements Vec3Location {
  constructor(public x: number, public y: number, public z: number) {}

  public offset(dx: number, dy: number, dz: number): Vec3Impl {
    return new Vec3Impl(this.x + dx, this.y + dy, this.z + dz);
  }

  public clone(): Vec3Impl {
    return new Vec3Impl(this.x, this.y, this.z);
  }

  public floor(): Vec3Impl {
    return new Vec3Impl(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
  }

  public distanceTo(other: Vec3Location): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    const dz = this.z - other.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  public set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
}

export class MockWorld implements IBlockAccessor {
  private blocks = new Map<string, MockBlock>();

  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  }

  public getBlock(pos: Vec3Location): MockBlock | null {
    const k = this.key(pos.x, pos.y, pos.z);
    return this.blocks.get(k) ?? {
      name: 'air',
      position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
      hardness: 0,
      transparent: true,
      boundingBox: 'empty',
      diggable: false,
    };
  }

  public setBlock(pos: Vec3Location, blockOrName: string | Partial<MockBlock>): MockBlock {
    const k = this.key(pos.x, pos.y, pos.z);
    const position = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };

    let block: MockBlock;
    if (typeof blockOrName === 'string') {
      const name = blockOrName;
      const isAir = name === 'air' || name === 'cave_air' || name === 'void_air';
      const isGlass = name.includes('glass');
      const isLeaves = name.includes('leaves');
      const isLiquid = name === 'water' || name === 'lava';

      block = {
        name,
        position,
        hardness: isAir ? 0 : name.includes('obsidian') ? 50 : name.includes('ore') ? 3 : 1.5,
        transparent: isAir || isGlass || isLeaves || isLiquid,
        boundingBox: isAir || isLiquid ? 'empty' : 'block',
        material: isAir ? undefined : 'rock',
        diggable: !isAir,
      };
    } else {
      block = {
        name: blockOrName.name || 'air',
        position,
        hardness: blockOrName.hardness ?? 1.5,
        transparent: blockOrName.transparent ?? false,
        boundingBox: blockOrName.boundingBox ?? 'block',
        material: blockOrName.material,
        diggable: blockOrName.diggable ?? true,
        occupied: blockOrName.occupied,
      };
    }

    this.blocks.set(k, block);
    return block;
  }

  public loadBox(min: Vec3Location, max: Vec3Location, blockName: string): void {
    const minX = Math.min(min.x, max.x);
    const maxX = Math.max(min.x, max.x);
    const minY = Math.min(min.y, max.y);
    const maxY = Math.max(min.y, max.y);
    const minZ = Math.min(min.z, max.z);
    const maxZ = Math.max(min.z, max.z);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          this.setBlock({ x, y, z }, blockName);
        }
      }
    }
  }

  public createFlatWorld(bedrockY = 0, stoneY = 60, dirtY = 63, surface = 'grass_block'): void {
    const radius = 16;
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        this.setBlock({ x, y: bedrockY, z }, 'bedrock');
        for (let y = bedrockY + 1; y <= stoneY; y++) {
          this.setBlock({ x, y, z }, 'stone');
        }
        for (let y = stoneY + 1; y < dirtY; y++) {
          this.setBlock({ x, y, z }, 'dirt');
        }
        this.setBlock({ x, y: dirtY, z }, surface);
      }
    }
  }

  public getAllBlocks(): MockBlock[] {
    return Array.from(this.blocks.values());
  }

  public clear(): void {
    this.blocks.clear();
  }
}

export class MockWindow {
  public itemsList: MockItem[] = [];

  constructor(public id = 1, public title = 'Container') {}

  public async deposit(itemType: number | string, metadata: unknown, count: number): Promise<void> {
    const name = typeof itemType === 'string' ? itemType : String(itemType);
    const existing = this.itemsList.find((i) => i.name === name);
    if (existing) {
      existing.count += count;
    } else {
      this.itemsList.push({ name, count });
    }
  }

  public async withdraw(itemType: number | string, metadata: unknown, count: number): Promise<void> {
    const name = typeof itemType === 'string' ? itemType : String(itemType);
    const existing = this.itemsList.find((i) => i.name === name);
    if (!existing || existing.count < count) {
      throw new Error(`Insufficient item ${name} in container`);
    }
    existing.count -= count;
    if (existing.count <= 0) {
      this.itemsList = this.itemsList.filter((i) => i !== existing);
    }
  }

  public close(): void {
    // Window closed
  }
}

export class MockMineflayerBot extends EventEmitter {
  public entity: {
    id: number;
    position: Vec3Impl;
    yaw: number;
    pitch: number;
    height: number;
    eyeHeight: number;
  };

  public health = 20.0;
  public food = 20;
  public foodSaturation = 5.0;
  public oxygenLevel = 20;
  public isSleeping = false;
  public isDigging = false;
  public isBlocking = false;
  public time = { timeOfDay: 6000, age: 1000 };
  public thunderState = 0;
  public isRaining = false;
  public game = { dimension: 'overworld' };
  public heldItem: MockItem | null = null;
  public offHandItem: MockItem | null = null;
  public armor: {
    head: MockItem | null;
    torso: MockItem | null;
    legs: MockItem | null;
    feet: MockItem | null;
  } = {
    head: null,
    torso: null,
    legs: null,
    feet: null,
  };

  public inventory: {
    slots: Array<MockItem | null>;
    items: () => MockItem[];
    findInventoryItem: (name: string) => MockItem | null;
    count: (name: string) => number;
  };

  public entities: Record<string, any> = {};
  public controlStates: Record<string, boolean> = {};

  public pathfinder: {
    isMoving: () => boolean;
    goto: (goal: any) => Promise<void>;
    setGoal: (goal: any) => void;
    stop: () => void;
    setMovements: (movements: any) => void;
    movements: any;
  };

  constructor(public world: MockWorld, startPos: Vec3Location = { x: 0, y: 64, z: 0 }) {
    super();

    this.entity = {
      id: 1,
      position: new Vec3Impl(startPos.x, startPos.y, startPos.z),
      yaw: 0,
      pitch: 0,
      height: 1.62,
      eyeHeight: 1.62,
    };

    const slots: Array<MockItem | null> = new Array(46).fill(null);

    this.inventory = {
      slots,
      items: () => slots.filter((item): item is MockItem => item !== null && item.count > 0),
      findInventoryItem: (name: string) => {
        return slots.find((item) => item && item.name === name && item.count > 0) || null;
      },
      count: (name: string) => {
        return slots.reduce((acc, item) => (item && item.name === name ? acc + item.count : acc), 0);
      },
    };

    let moving = false;
    this.pathfinder = {
      isMoving: () => moving,
      goto: async (goal: any) => {
        moving = true;
        const targetX = goal.x ?? goal.destination?.x ?? this.entity.position.x;
        const targetY = goal.y ?? goal.destination?.y ?? this.entity.position.y;
        const targetZ = goal.z ?? goal.destination?.z ?? this.entity.position.z;
        this.entity.position.set(targetX, targetY, targetZ);
        moving = false;
        this.emit('goal_reached');
      },
      setGoal: (goal: any) => {
        if (!goal) {
          moving = false;
        } else {
          moving = true;
        }
      },
      stop: () => {
        moving = false;
      },
      setMovements: (m: any) => {
        this.pathfinder.movements = m;
      },
      movements: null,
    };
  }

  public get eyePosition(): Vec3Location {
    return {
      x: this.entity.position.x,
      y: this.entity.position.y + this.entity.eyeHeight,
      z: this.entity.position.z,
    };
  }

  public blockAt(pos: Vec3Location): MockBlock | null {
    return this.world.getBlock(pos);
  }

  public addItem(item: MockItem): void {
    const existing = this.inventory.slots.find((s) => s && s.name === item.name);
    if (existing) {
      existing.count += item.count;
    } else {
      const freeIdx = this.inventory.slots.findIndex((s, idx) => s === null && idx >= 9);
      if (freeIdx !== -1) {
        this.inventory.slots[freeIdx] = { ...item, slot: freeIdx };
      } else {
        const anyFree = this.inventory.slots.findIndex((s) => s === null);
        if (anyFree !== -1) {
          this.inventory.slots[anyFree] = { ...item, slot: anyFree };
        }
      }
    }
  }

  public removeItem(itemName: string, count = 1): boolean {
    let remaining = count;
    for (let i = 0; i < this.inventory.slots.length; i++) {
      const s = this.inventory.slots[i];
      if (s && s.name === itemName) {
        if (s.count <= remaining) {
          remaining -= s.count;
          this.inventory.slots[i] = null;
        } else {
          s.count -= remaining;
          remaining = 0;
        }
        if (remaining === 0) break;
      }
    }
    return remaining === 0;
  }

  public async dig(block: MockBlock): Promise<void> {
    assertBlockReach(this.eyePosition, block.position);
    this.isDigging = true;
    this.emit('diggingStarted', block);
    this.world.setBlock(block.position, 'air');
    this.isDigging = false;
    this.emit('diggingCompleted', block);
  }

  public stopDigging(): void {
    if (this.isDigging) {
      this.isDigging = false;
      this.emit('diggingAborted');
    }
  }

  public async placeBlock(referenceBlock: MockBlock, faceVector: Vec3Location): Promise<void> {
    const targetPos: Vec3Location = {
      x: referenceBlock.position.x + faceVector.x,
      y: referenceBlock.position.y + faceVector.y,
      z: referenceBlock.position.z + faceVector.z,
    };
    assertBlockReach(this.eyePosition, targetPos);
    const item = this.heldItem;
    if (item) {
      this.world.setBlock(targetPos, item.name);
      this.removeItem(item.name, 1);
    }
  }

  public async equip(item: MockItem, destination: 'hand' | 'off-hand' | 'head' | 'torso' | 'legs' | 'feet'): Promise<void> {
    switch (destination) {
      case 'hand':
        this.heldItem = item;
        break;
      case 'off-hand':
        this.offHandItem = item;
        break;
      case 'head':
        this.armor.head = item;
        break;
      case 'torso':
        this.armor.torso = item;
        break;
      case 'legs':
        this.armor.legs = item;
        break;
      case 'feet':
        this.armor.feet = item;
        break;
    }
    this.emit('equip', item, destination);
  }

  public async unequip(destination: 'hand' | 'off-hand' | 'head' | 'torso' | 'legs' | 'feet'): Promise<void> {
    switch (destination) {
      case 'hand':
        this.heldItem = null;
        break;
      case 'off-hand':
        this.offHandItem = null;
        break;
      case 'head':
        this.armor.head = null;
        break;
      case 'torso':
        this.armor.torso = null;
        break;
      case 'legs':
        this.armor.legs = null;
        break;
      case 'feet':
        this.armor.feet = null;
        break;
    }
  }

  public async consume(): Promise<void> {
    if (this.heldItem) {
      const foodValue = this.heldItem.name.includes('carrot') ? 6 : this.heldItem.name.includes('beef') ? 8 : 4;
      this.food = Math.min(20, this.food + foodValue);
      this.foodSaturation = Math.min(this.food, this.foodSaturation + 5.0);
      this.removeItem(this.heldItem.name, 1);
      this.emit('consumed', this.heldItem);
    }
  }

  public async sleep(bedBlock: MockBlock): Promise<void> {
    assertBlockReach(this.eyePosition, bedBlock.position);
    this.isSleeping = true;
    this.emit('sleep');
  }

  public async wake(): Promise<void> {
    if (this.isSleeping) {
      this.isSleeping = false;
      this.emit('wake');
    }
  }

  public async attack(targetEntity: any): Promise<void> {
    assertEntityAttackReach(this.eyePosition, targetEntity.position);
    this.emit('attackedTarget', targetEntity);
    if (typeof targetEntity.health === 'number') {
      targetEntity.health -= 6;
      if (targetEntity.health <= 0) {
        delete this.entities[targetEntity.id];
      }
    }
  }

  public activateItem(offHand = false): void {
    if (offHand || this.offHandItem?.name === 'shield') {
      this.isBlocking = true;
    }
  }

  public deactivateItem(): void {
    this.isBlocking = false;
  }

  public async lookAt(point: Vec3Location, force = false): Promise<void> {
    const dx = point.x - this.eyePosition.x;
    const dy = point.y - this.eyePosition.y;
    const dz = point.z - this.eyePosition.z;
    const distXZ = Math.sqrt(dx * dx + dz * dz);
    this.entity.yaw = Math.atan2(-dx, -dz);
    this.entity.pitch = Math.atan2(-dy, distXZ);
  }

  public chat(message: string): void {
    const cleaned = assertAllowedMinecraftChat(message);
    this.emit('chat', 'bot', cleaned);
  }

  public respawn(): void {
    this.health = 20.0;
    this.food = 20;
    this.emit('respawn');
    this.emit('spawn');
  }

  public setControlState(control: string, state: boolean): void {
    this.controlStates[control] = state;
  }

  private openContainers = new Map<string, MockWindow>();

  public async openContainer(block: MockBlock): Promise<MockWindow> {
    assertBlockReach(this.eyePosition, block.position);
    const key = `${Math.floor(block.position.x)},${Math.floor(block.position.y)},${Math.floor(block.position.z)}`;
    let win = this.openContainers.get(key);
    if (!win) {
      win = new MockWindow(1, block.name);
      this.openContainers.set(key, win);
    }
    return win;
  }

  public async openBlock(block: MockBlock): Promise<MockWindow> {
    assertBlockReach(this.eyePosition, block.position);
    return new MockWindow(2, block.name);
  }

  public async craft(recipe: any, count: number, tableBlock?: MockBlock): Promise<void> {
    if (tableBlock) {
      assertBlockReach(this.eyePosition, tableBlock.position);
    }
    // Craft execution
    this.emit('crafted', recipe, count);
  }
}

export class MockMinecraftAgent extends EventEmitter implements IMinecraftAgent, IMinecraftChatAgent {
  public bot: MockMineflayerBot;
  public world: MockWorld;
  private connected = false;
  private currentTask: string | null = null;
  private serverConfig: MinecraftConnectionConfig = { host: 'localhost', port: 25565, username: 'MockBot' };

  constructor(world?: MockWorld, bot?: MockMineflayerBot) {
    super();
    this.world = world ?? new MockWorld();
    this.bot = bot ?? new MockMineflayerBot(this.world);

    // Forward bot events
    this.bot.on('chat', (username: string, message: string) => {
      this.emit('chat', username, message);
    });

    this.bot.on('spawn', () => {
      this.connected = true;
      this.emit('statusUpdate', this.getStatus());
    });

    this.bot.on('health', () => {
      if (this.bot.health <= 0) {
        this.emit('death', 'Player died');
      }
      this.emit('statusUpdate', this.getStatus());
    });
  }

  public async connect(config: MinecraftConnectionConfig): Promise<void> {
    this.serverConfig = config;
    this.connected = true;
    this.emit('statusUpdate', this.getStatus());
  }

  public async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('statusUpdate', this.getStatus());
  }

  public getStatus(): MinecraftBotStatus {
    const items = this.bot.inventory.items();
    const usedSlots = items.length;
    const totalSlots = 36;
    const freeSlots = Math.max(0, totalSlots - usedSlots);

    const gear = {
      mainHand: this.bot.heldItem?.name || 'empty',
      offHand: this.bot.offHandItem?.name || 'empty',
      helmet: this.bot.armor.head?.name,
      chestplate: this.bot.armor.torso?.name,
      leggings: this.bot.armor.legs?.name,
      boots: this.bot.armor.feet?.name,
      armorSummary: [
        this.bot.armor.head?.name,
        this.bot.armor.torso?.name,
        this.bot.armor.legs?.name,
        this.bot.armor.feet?.name,
      ]
        .filter(Boolean)
        .join(', ') || 'none',
    };

    return {
      connected: this.connected,
      username: this.serverConfig.username,
      health: this.bot.health,
      food: this.bot.food,
      position: {
        x: this.bot.entity.position.x,
        y: this.bot.entity.position.y,
        z: this.bot.entity.position.z,
      },
      dimension: this.bot.game.dimension,
      currentTask: this.currentTask,
      gear,
      inventory: {
        usedSlots,
        totalSlots,
        freeSlots,
        keyItemsSummary: items.slice(0, 5).map((i) => `${i.count}x ${i.name}`).join(', '),
      },
      server: {
        host: this.serverConfig.host,
        port: this.serverConfig.port,
        ping: 20,
      },
    };
  }

  public canInteractWith(position: Vec3Location): boolean {
    const eye = this.bot.eyePosition;
    const dist = getBlockDistanceToEye(eye, position);
    if (dist > 4.50 + 1e-4) return false;

    const exposure = evaluateBlockExposure(this.world, position);
    return hasBlockLineOfSight(this.world, eye, position, exposure.exposedFaceCenters);
  }

  public async findVisibleBlock(criteria: BlockSearchCriteria): Promise<VisibleBlock | null> {
    const eye = this.bot.eyePosition;
    const look = getLookVectorFromYawPitch(this.bot.entity.yaw, this.bot.entity.pitch);
    const maxDist = criteria.maxDistance ?? 16;
    const targets = new Set(criteria.blockNames);

    let closest: VisibleBlock | null = null;
    let closestDist = Infinity;

    for (const block of this.world.getAllBlocks()) {
      if (!targets.has(block.name)) continue;

      const dist = this.bot.entity.position.distanceTo(block.position);
      if (dist > maxDist) continue;

      // 1. Exposure Check
      const exposure = evaluateBlockExposure(this.world, block.position);
      if (!exposure.isExposed) continue;

      // 2. FOV Cone & Tactile Check
      const fovCheck = isWithinPerceptionFOV(eye, block.position, look);
      if (!fovCheck.inPerception) continue;

      // 3. Line of sight check
      const hasLos = hasBlockLineOfSight(this.world, eye, block.position, exposure.exposedFaceCenters, maxDist);
      if (!hasLos) continue;

      if (dist < closestDist) {
        closestDist = dist;
        closest = {
          name: block.name,
          position: block.position,
          distance: dist,
        };
      }
    }

    return closest;
  }

  public async navigateTo(target: Vec3Location, options?: PathfindingOptions): Promise<ActionResult> {
    this.currentTask = `Navigating to ${target.x}, ${target.y}, ${target.z}`;
    await this.bot.pathfinder.goto(target);
    this.currentTask = null;
    return { success: true, message: `Successfully arrived at ${target.x}, ${target.y}, ${target.z}` };
  }

  public async mineBlock(position: Vec3Location): Promise<ActionResult> {
    this.currentTask = `Mining at ${position.x}, ${position.y}, ${position.z}`;
    const block = this.world.getBlock(position);
    if (!block || block.name === 'air') {
      this.currentTask = null;
      return { success: false, message: 'Block is air or not found' };
    }

    if (!this.canInteractWith(position)) {
      this.currentTask = null;
      return { success: false, message: 'Block unreachable or no line of sight' };
    }

    await this.bot.dig(block);
    this.currentTask = null;
    return { success: true, message: `Mined ${block.name} at ${position.x}, ${position.y}, ${position.z}` };
  }

  public async placeBlock(position: Vec3Location, blockName: string): Promise<ActionResult> {
    this.currentTask = `Placing ${blockName}`;
    const refBlock = this.world.getBlock({ x: position.x, y: position.y - 1, z: position.z });
    if (!refBlock) {
      this.currentTask = null;
      return { success: false, message: 'No reference block to place against' };
    }

    await this.bot.placeBlock(refBlock, { x: 0, y: 1, z: 0 });
    this.currentTask = null;
    return { success: true, message: `Placed ${blockName} at ${position.x}, ${position.y}, ${position.z}` };
  }

  public async craftItem(recipeName: string, count: number): Promise<ActionResult> {
    this.currentTask = `Crafting ${count}x ${recipeName}`;
    await this.bot.craft({ name: recipeName }, count);
    this.currentTask = null;
    return { success: true, message: `Crafted ${count}x ${recipeName}` };
  }

  public async attackEntity(entityId: number): Promise<ActionResult> {
    const entity = this.bot.entities[String(entityId)];
    if (!entity) {
      return { success: false, message: `Entity ${entityId} not found` };
    }
    await this.bot.attack(entity);
    return { success: true, message: `Attacked entity ${entityId}` };
  }

  public async sleepInNearbyBed(): Promise<ActionResult> {
    const bed = this.world.getAllBlocks().find((b) => b.name.includes('bed'));
    if (!bed) {
      return { success: false, message: 'No bed found' };
    }
    await this.bot.sleep(bed);
    return { success: true, message: 'Sleeping in bed' };
  }

  public async sendChat(message: string): Promise<void> {
    this.bot.chat(message);
  }
}
