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
} from './types.js';
import type { IMinecraftChatAgent } from '../bridge/types.js';
import { assertBlockReach, getBlockDistanceToEye } from './fairplay/reach.js';
import { assertAllowedMinecraftChat } from './fairplay/commandSanitizer.js';
import { evaluateBlockExposure } from './perception/exposure.js';
import { hasBlockLineOfSight } from './perception/raycast.js';
import { getLookVectorFromYawPitch, isWithinPerceptionFOV } from './perception/fov.js';
import { PathfinderAction } from './actions/pathfinding.js';
import { MiningAction } from './actions/mining.js';
import { InventoryAction, getInventoryStatus } from './actions/inventory.js';
import { CraftingAction } from './actions/crafting.js';
import { CombatAction } from './actions/combat.js';
import { AutoEatLoop } from './loops/autoEat.js';
import { AutoSleepLoop } from './loops/autoSleep.js';
import { AutoEquipLoop } from './loops/autoEquip.js';

export type ClientState = 'DISCONNECTED' | 'CONNECTING' | 'SPAWNED' | 'RECONNECTING';

export interface MinecraftClientOptions {
  bot?: any; // Mock or pre-configured bot for testing
  maxReconnectRetries?: number; // default: 5
  baseReconnectDelayMs?: number; // default: 1000
  maxReconnectDelayMs?: number; // default: 30000
  statusThrottleMs?: number; // default: 500
  enableAutoEat?: boolean;
  enableAutoSleep?: boolean;
  enableAutoEquip?: boolean;
}

export class MinecraftClient extends EventEmitter implements IMinecraftAgent, IMinecraftChatAgent {
  public state: ClientState = 'DISCONNECTED';
  public bot: any = null;
  private config: MinecraftConnectionConfig | null = null;
  private intentionalDisconnect = false;
  private reconnectRetryCount = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private lastStatusEmission = 0;
  private currentTask: string | null = null;

  // Actions and Loops
  public pathfinderAction: PathfinderAction | null = null;
  public miningAction: MiningAction | null = null;
  public inventoryAction: InventoryAction | null = null;
  public craftingAction: CraftingAction | null = null;
  public combatAction: CombatAction | null = null;
  public autoEatLoop: AutoEatLoop | null = null;
  public autoSleepLoop: AutoSleepLoop | null = null;
  public autoEquipLoop: AutoEquipLoop | null = null;

  public maxReconnectRetries: number;
  public baseReconnectDelayMs: number;
  public maxReconnectDelayMs: number;
  public statusThrottleMs: number;
  public enableAutoEat: boolean;
  public enableAutoSleep: boolean;
  public enableAutoEquip: boolean;

  constructor(options: MinecraftClientOptions = {}) {
    super();
    this.maxReconnectRetries = options.maxReconnectRetries ?? 5;
    this.baseReconnectDelayMs = options.baseReconnectDelayMs ?? 1000;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30000;
    this.statusThrottleMs = options.statusThrottleMs ?? 500;
    this.enableAutoEat = options.enableAutoEat ?? true;
    this.enableAutoSleep = options.enableAutoSleep ?? true;
    this.enableAutoEquip = options.enableAutoEquip ?? true;

    if (options.bot) {
      this.bindBot(options.bot);
    }
  }

  public bindBot(bot: any): void {
    this.bot = bot;

    // Initialize subsystems
    this.pathfinderAction = new PathfinderAction(bot);
    this.miningAction = new MiningAction(bot);
    this.inventoryAction = new InventoryAction(bot);
    this.craftingAction = new CraftingAction(bot);
    this.combatAction = new CombatAction(bot);

    this.autoEatLoop = new AutoEatLoop(bot);
    this.autoSleepLoop = new AutoSleepLoop(bot);
    this.autoEquipLoop = new AutoEquipLoop(bot);

    if (this.enableAutoEat) this.autoEatLoop.start();
    if (this.enableAutoSleep) this.autoSleepLoop.start();
    if (this.enableAutoEquip) this.autoEquipLoop.start();

    // Event bridges
    if (bot.on) {
      bot.on('spawn', () => {
        this.state = 'SPAWNED';
        this.reconnectRetryCount = 0;
        this.emitThrottledStatus();
      });

      bot.on('chat', (username: string, message: string) => {
        if (username !== this.bot.username) {
          this.emit('chat', username, message);
        }
      });

      bot.on('health', () => {
        if (this.bot.health <= 0) {
          this.emit('death', 'Agent died in game');
          setTimeout(() => {
            if (this.bot.respawn) this.bot.respawn();
          }, 1000);
        }
        if (this.autoEatLoop) {
          this.autoEatLoop.checkAndEat().catch(() => {});
        }
        this.emitThrottledStatus(true);
      });

      bot.on('death', () => {
        this.emit('death', 'Agent died in game');
        setTimeout(() => {
          if (this.bot.respawn) this.bot.respawn();
        }, 1000);
      });

      bot.on('kicked', (reason: string) => {
        this.emit('kicked', reason);
        if (!this.intentionalDisconnect) {
          this.handleUnexpectedDisconnect();
        }
      });

      bot.on('end', () => {
        if (!this.intentionalDisconnect) {
          this.handleUnexpectedDisconnect();
        } else {
          this.state = 'DISCONNECTED';
          this.emitThrottledStatus();
        }
      });

      bot.on('error', (err: any) => {
        this.emit('error', err);
      });
    }
  }

  public calculateBackoffDelay(retryCount: number): number {
    const base = Math.min(this.maxReconnectDelayMs, this.baseReconnectDelayMs * Math.pow(2, retryCount));
    // Apply +/- 20% jitter
    const jitter = 0.2;
    const u = Math.random();
    return Math.floor(base * (1.0 - jitter + 2.0 * jitter * u));
  }

  private handleUnexpectedDisconnect(): void {
    if (this.reconnectRetryCount >= this.maxReconnectRetries) {
      this.state = 'DISCONNECTED';
      this.emitThrottledStatus();
      return;
    }

    this.state = 'RECONNECTING';
    const delay = this.calculateBackoffDelay(this.reconnectRetryCount);
    this.reconnectRetryCount++;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(async () => {
      if (this.intentionalDisconnect) return;
      if (this.config) {
        try {
          await this.connect(this.config);
        } catch {
          this.handleUnexpectedDisconnect();
        }
      }
    }, delay);
  }

  public async connect(config: MinecraftConnectionConfig): Promise<void> {
    this.config = config;
    this.intentionalDisconnect = false;
    this.state = 'CONNECTING';

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (!this.bot) {
      try {
        // Attempt dynamically importing mineflayer in live node environment
        const mineflayerModule = await import('mineflayer');
        const mineflayer = mineflayerModule.default || mineflayerModule;
        const newBot = mineflayer.createBot({
          host: config.host,
          port: config.port,
          username: config.username,
          version: config.version,
          auth: config.auth,
        });
        this.bindBot(newBot);
      } catch (err: any) {
        // If live connection fails or in test environment without live server
        this.handleUnexpectedDisconnect();
        throw err;
      }
    } else {
      this.state = 'SPAWNED';
      this.emitThrottledStatus();
    }
  }

  public async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.state = 'DISCONNECTED';

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.autoEatLoop) this.autoEatLoop.stop();
    if (this.autoSleepLoop) this.autoSleepLoop.stop();
    if (this.autoEquipLoop) this.autoEquipLoop.stop();
    if (this.pathfinderAction) this.pathfinderAction.stop();

    if (this.bot && this.bot.quit) {
      try {
        this.bot.quit();
      } catch {
        // Ignored
      }
    }

    this.emitThrottledStatus();
  }

  public getStatus(): MinecraftBotStatus {
    const inv = this.bot ? getInventoryStatus(this.bot) : {
      totalSlots: 36,
      usedSlots: 0,
      freeSlots: 36,
      heldItem: 'empty',
      offHandItem: 'empty',
      armor: {},
      keyItemsSummary: '',
    };

    const armorList = [
      inv.armor.head,
      inv.armor.torso,
      inv.armor.legs,
      inv.armor.feet,
    ].filter(Boolean);

    return {
      connected: this.state === 'SPAWNED',
      username: this.config?.username || this.bot?.username || 'CompanionBot',
      health: this.bot?.health ?? 20.0,
      food: this.bot?.food ?? 20,
      position: {
        x: this.bot?.entity?.position?.x ?? 0,
        y: this.bot?.entity?.position?.y ?? 64,
        z: this.bot?.entity?.position?.z ?? 0,
      },
      dimension: this.bot?.game?.dimension || 'overworld',
      currentTask: this.currentTask,
      gear: {
        mainHand: inv.heldItem,
        offHand: inv.offHandItem,
        helmet: inv.armor.head,
        chestplate: inv.armor.torso,
        leggings: inv.armor.legs,
        boots: inv.armor.feet,
        armorSummary: armorList.join(', ') || 'none',
      },
      inventory: {
        usedSlots: inv.usedSlots,
        totalSlots: inv.totalSlots,
        freeSlots: inv.freeSlots,
        keyItemsSummary: inv.keyItemsSummary,
      },
      server: {
        host: this.config?.host || 'localhost',
        port: this.config?.port || 25565,
        ping: 20,
      },
    };
  }

  private statusThrottleTimer: NodeJS.Timeout | null = null;

  public emitThrottledStatus(force = false): void {
    const now = Date.now();
    if (force || this.statusThrottleMs === 0 || now - this.lastStatusEmission >= this.statusThrottleMs) {
      this.lastStatusEmission = now;
      if (this.statusThrottleTimer) {
        clearTimeout(this.statusThrottleTimer);
        this.statusThrottleTimer = null;
      }
      this.emit('statusUpdate', this.getStatus());
    } else if (!this.statusThrottleTimer) {
      const wait = Math.max(1, this.statusThrottleMs - (now - this.lastStatusEmission));
      this.statusThrottleTimer = setTimeout(() => {
        this.statusThrottleTimer = null;
        this.lastStatusEmission = Date.now();
        this.emit('statusUpdate', this.getStatus());
      }, wait);
    }
  }

  public canInteractWith(position: Vec3Location): boolean {
    if (!this.bot) return false;
    const eye = {
      x: this.bot.entity.position.x,
      y: this.bot.entity.position.y + (this.bot.entity.eyeHeight ?? 1.62),
      z: this.bot.entity.position.z,
    };
    const dist = getBlockDistanceToEye(eye, position);
    if (dist > 4.50 + 1e-4) return false;

    const accessor = {
      getBlock: (p: Vec3Location) => (this.bot.blockAt ? this.bot.blockAt(p) : null),
    };
    const exposure = evaluateBlockExposure(accessor, position);
    return hasBlockLineOfSight(accessor, eye, position, exposure.exposedFaceCenters);
  }

  public async findVisibleBlock(criteria: BlockSearchCriteria): Promise<VisibleBlock | null> {
    if (!this.bot) return null;
    const eye = {
      x: this.bot.entity.position.x,
      y: this.bot.entity.position.y + (this.bot.entity.eyeHeight ?? 1.62),
      z: this.bot.entity.position.z,
    };
    const look = getLookVectorFromYawPitch(this.bot.entity.yaw ?? 0, this.bot.entity.pitch ?? 0);
    const maxDist = criteria.maxDistance ?? 16;
    const targetNames = new Set(criteria.blockNames);

    const accessor = {
      getBlock: (p: Vec3Location) => (this.bot.blockAt ? this.bot.blockAt(p) : null),
    };

    let closest: VisibleBlock | null = null;
    let closestDist = Infinity;

    const blocksToScan = this.bot.world?.getAllBlocks ? this.bot.world.getAllBlocks() : [];
    for (const b of blocksToScan) {
      if (!targetNames.has(b.name)) continue;

      const dx = b.position.x - eye.x;
      const dy = b.position.y - eye.y;
      const dz = b.position.z - eye.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > maxDist) continue;

      // 1. Exposure check
      const exposure = evaluateBlockExposure(accessor, b.position);
      if (!exposure.isExposed) continue;

      // 2. FOV check
      const fovResult = isWithinPerceptionFOV(eye, b.position, look);
      if (!fovResult.inPerception) continue;

      // 3. Line of sight check
      const los = hasBlockLineOfSight(accessor, eye, b.position, exposure.exposedFaceCenters, maxDist);
      if (!los) continue;

      if (dist < closestDist) {
        closestDist = dist;
        closest = {
          name: b.name,
          position: b.position,
          distance: dist,
        };
      }
    }

    return closest;
  }

  public async navigateTo(target: Vec3Location, options?: PathfindingOptions): Promise<ActionResult> {
    this.currentTask = `Navigating to (${target.x}, ${target.y}, ${target.z})`;
    this.emitThrottledStatus();

    try {
      if (!this.pathfinderAction) {
        return { success: false, message: 'Pathfinder action not initialized' };
      }
      const res = await this.pathfinderAction.navigateTo(target, options);
      return res;
    } finally {
      this.currentTask = null;
      this.emitThrottledStatus();
    }
  }

  public async mineBlock(position: Vec3Location): Promise<ActionResult> {
    this.currentTask = `Mining at (${position.x}, ${position.y}, ${position.z})`;
    this.emitThrottledStatus();

    try {
      if (!this.miningAction) {
        return { success: false, message: 'Mining action not initialized' };
      }
      return await this.miningAction.mineBlock(position);
    } finally {
      this.currentTask = null;
      this.emitThrottledStatus();
    }
  }

  public async placeBlock(position: Vec3Location, blockName: string): Promise<ActionResult> {
    this.currentTask = `Placing ${blockName}`;
    this.emitThrottledStatus();

    try {
      assertBlockReach(
        {
          x: this.bot.entity.position.x,
          y: this.bot.entity.position.y + (this.bot.entity.eyeHeight ?? 1.62),
          z: this.bot.entity.position.z,
        },
        position
      );

      const refBlock = this.bot.blockAt
        ? this.bot.blockAt({ x: position.x, y: position.y - 1, z: position.z })
        : null;
      if (!refBlock) {
        return { success: false, message: 'No reference block to place against' };
      }

      await this.bot.placeBlock(refBlock, { x: 0, y: 1, z: 0 });
      return { success: true, message: `Placed ${blockName} at (${position.x}, ${position.y}, ${position.z})` };
    } catch (err: any) {
      return { success: false, message: `Failed to place block: ${err.message || String(err)}` };
    } finally {
      this.currentTask = null;
      this.emitThrottledStatus();
    }
  }

  public async craftItem(recipeName: string, count = 1): Promise<ActionResult> {
    this.currentTask = `Crafting ${count}x ${recipeName}`;
    this.emitThrottledStatus();

    try {
      if (!this.craftingAction) {
        return { success: false, message: 'Crafting action not initialized' };
      }
      return await this.craftingAction.craftItem(recipeName, count);
    } finally {
      this.currentTask = null;
      this.emitThrottledStatus();
    }
  }

  public async attackEntity(entityId: number): Promise<ActionResult> {
    this.currentTask = `Attacking entity ${entityId}`;
    this.emitThrottledStatus();

    try {
      if (!this.combatAction) {
        return { success: false, message: 'Combat action not initialized' };
      }
      return await this.combatAction.attackEntity(entityId);
    } finally {
      this.currentTask = null;
      this.emitThrottledStatus();
    }
  }

  public async sleepInNearbyBed(): Promise<ActionResult> {
    this.currentTask = 'Sleeping in bed';
    this.emitThrottledStatus();

    try {
      if (!this.autoSleepLoop) {
        return { success: false, message: 'AutoSleep loop not initialized' };
      }
      const ok = await this.autoSleepLoop.checkAndSleep();
      return {
        success: ok,
        message: ok ? 'Successfully resting in bed' : 'Could not sleep (unsafe, occupied, or monsters nearby)',
      };
    } finally {
      this.currentTask = null;
      this.emitThrottledStatus();
    }
  }

  public async sendChat(message: string): Promise<void> {
    // Passes through command sanitizer
    const cleaned = assertAllowedMinecraftChat(message);
    if (this.bot && this.bot.chat) {
      this.bot.chat(cleaned);
    }
  }
}
