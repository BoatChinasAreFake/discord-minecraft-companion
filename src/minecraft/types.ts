import type { IMinecraftChatAgent } from '../bridge/types.js';

export interface Vec3Location {
  x: number;
  y: number;
  z: number;
}

export interface Vec3 extends Vec3Location {
  offset?(dx: number, dy: number, dz: number): Vec3;
  distanceTo?(other: Vec3Location): number;
  clone?(): Vec3;
  floor?(): Vec3;
}

export interface MinecraftBotStatus {
  connected: boolean;
  username: string;
  health: number; // 0.0 - 20.0
  food: number;   // 0 - 20
  position: Vec3Location;
  dimension: string; // 'overworld' | 'the_nether' | 'the_end'
  currentTask: string | null;
  gear: {
    mainHand: string;
    offHand: string;
    armorSummary: string;
    helmet?: string;
    chestplate?: string;
    leggings?: string;
    boots?: string;
  };
  inventory: {
    usedSlots: number;
    totalSlots: number; // default 36
    freeSlots: number;
    keyItemsSummary?: string;
  };
  server: {
    host: string;
    port: number;
    ping: number;
  };
}

export interface MinecraftConnectionConfig {
  host: string;
  port: number;
  username: string;
  auth?: 'offline' | 'microsoft';
  version?: string;
}

export interface ActionResult {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface VisibleBlock {
  name: string;
  position: Vec3Location;
  distance: number;
}

export interface BlockSearchCriteria {
  blockNames: string[];
  maxDistance?: number;
}

export interface PathfindingOptions {
  timeoutMs?: number;
  range?: number;
}

export interface IMinecraftAgent extends IMinecraftChatAgent {
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
