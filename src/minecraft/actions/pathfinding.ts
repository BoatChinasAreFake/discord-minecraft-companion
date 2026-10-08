import type { Vec3Location, ActionResult, PathfindingOptions } from '../types.js';

export interface MovementConfig {
  maxDropDown: number;
  allowParkour: boolean;
  allow1by1towers: boolean;
  canDig: boolean;
  dontCreateFlow: boolean;
  dontMineUnderFallingBlock: boolean;
  blocksToAvoid: Set<string>;
  exclusionAreasStep: Array<(block: any) => number>;
}

export const HAZARDOUS_BLOCKS = new Set<string>([
  'lava',
  'flowing_lava',
  'fire',
  'soul_fire',
  'cactus',
  'sweet_berry_bush',
  'magma_block',
  'wither_rose',
  'campfire',
  'soul_campfire',
  'powder_snow',
]);

/**
 * Builds a hardened, fair-play movements configuration.
 * Enforces safe drops (<= 3 blocks), disables risky parkour and 1x1 pillaring,
 * and penalizes fluid/fire hazards.
 */
export function createSafeMovements(bot: any): MovementConfig {
  const blocksToAvoid = new Set<string>(HAZARDOUS_BLOCKS);
  const exclusionAreasStep: Array<(block: any) => number> = [
    (block: any) => {
      if (!block || !block.position) return 0;
      // Proximity penalty for lava or fire neighbors
      const neighbors = [
        { x: block.position.x + 1, y: block.position.y, z: block.position.z },
        { x: block.position.x - 1, y: block.position.y, z: block.position.z },
        { x: block.position.x, y: block.position.y, z: block.position.z + 1 },
        { x: block.position.x, y: block.position.y, z: block.position.z - 1 },
      ];
      for (const pos of neighbors) {
        const adj = bot.blockAt ? bot.blockAt(pos) : null;
        if (adj && (adj.name.includes('lava') || adj.name.includes('fire'))) {
          return 150;
        }
      }
      return 0;
    },
  ];

  return {
    maxDropDown: 3,
    allowParkour: false,
    allow1by1towers: false,
    canDig: false,
    dontCreateFlow: true,
    dontMineUnderFallingBlock: true,
    blocksToAvoid,
    exclusionAreasStep,
  };
}

export class PathfinderAction {
  private isNavigating = false;
  private stallCheckInterval: NodeJS.Timeout | null = null;
  private lastPosition: Vec3Location | null = null;
  private stallDurationMs = 0;
  private retryCount = 0;
  public movements: MovementConfig;

  constructor(private bot: any) {
    this.movements = createSafeMovements(bot);
    if (bot.pathfinder && bot.pathfinder.setMovements) {
      bot.pathfinder.setMovements(this.movements);
    }
  }

  public async navigateTo(target: Vec3Location, options: PathfindingOptions = {}): Promise<ActionResult> {
    if (!this.bot.pathfinder) {
      return { success: false, message: 'Pathfinder plugin is not initialized on bot' };
    }

    this.isNavigating = true;
    this.retryCount = 0;
    this.stallDurationMs = 0;
    this.lastPosition = {
      x: this.bot.entity.position.x,
      y: this.bot.entity.position.y,
      z: this.bot.entity.position.z,
    };

    const maxRetries = 3;
    const timeoutMs = options.timeoutMs ?? 30000;

    return new Promise<ActionResult>((resolve) => {
      let timeoutHandle: NodeJS.Timeout | null = null;

      const cleanup = () => {
        this.isNavigating = false;
        if (this.stallCheckInterval) {
          clearInterval(this.stallCheckInterval);
          this.stallCheckInterval = null;
        }
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      };

      timeoutHandle = setTimeout(() => {
        cleanup();
        this.stop();
        resolve({
          success: false,
          message: `Navigation timed out after ${timeoutMs}ms`,
        });
      }, timeoutMs);

      // Start stall monitoring loop every 500ms
      this.stallCheckInterval = setInterval(async () => {
        if (!this.isNavigating || !this.bot.pathfinder.isMoving()) {
          this.stallDurationMs = 0;
          return;
        }

        const currentPos: Vec3Location = {
          x: this.bot.entity.position.x,
          y: this.bot.entity.position.y,
          z: this.bot.entity.position.z,
        };

        if (this.lastPosition) {
          const dx = currentPos.x - this.lastPosition.x;
          const dy = currentPos.y - this.lastPosition.y;
          const dz = currentPos.z - this.lastPosition.z;
          const displacement = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (displacement < 0.25) {
            this.stallDurationMs += 500;
          } else {
            this.stallDurationMs = 0;
          }
        }

        this.lastPosition = currentPos;

        // If stalled for >= 3000ms, trigger stall recovery
        if (this.stallDurationMs >= 3000) {
          this.stallDurationMs = 0;
          this.retryCount++;

          if (this.retryCount > maxRetries) {
            cleanup();
            this.stop();
            resolve({
              success: false,
              message: 'Navigation aborted: path blocked after 3 recovery attempts',
            });
            return;
          }

          // Unstick impulse: backpedal and jump
          if (this.bot.setControlState) {
            this.bot.setControlState('back', true);
            this.bot.setControlState('jump', true);
            setTimeout(() => {
              if (this.bot.setControlState) {
                this.bot.setControlState('back', false);
                this.bot.setControlState('jump', false);
              }
            }, 350);
          }

          // Penalize stuck block in movements
          const stuckPos = { ...currentPos };
          this.movements.exclusionAreasStep.push((b: any) => {
            if (!b || !b.position) return 0;
            if (
              Math.floor(b.position.x) === Math.floor(stuckPos.x) &&
              Math.floor(b.position.z) === Math.floor(stuckPos.z)
            ) {
              return 50;
            }
            return 0;
          });
        }
      }, 500);

      // Execute goto
      const goal = { x: Math.floor(target.x), y: Math.floor(target.y), z: Math.floor(target.z) };
      this.bot.pathfinder
        .goto(goal)
        .then(() => {
          cleanup();
          resolve({
            success: true,
            message: `Reached target destination (${target.x}, ${target.y}, ${target.z})`,
          });
        })
        .catch((err: any) => {
          cleanup();
          resolve({
            success: false,
            message: `Pathfinding failed: ${err.message || String(err)}`,
          });
        });
    });
  }

  public stop(): void {
    this.isNavigating = false;
    if (this.stallCheckInterval) {
      clearInterval(this.stallCheckInterval);
      this.stallCheckInterval = null;
    }
    if (this.bot.pathfinder && this.bot.pathfinder.stop) {
      this.bot.pathfinder.stop();
    }
    if (this.bot.setControlState) {
      this.bot.setControlState('forward', false);
      this.bot.setControlState('back', false);
      this.bot.setControlState('jump', false);
      this.bot.setControlState('sprint', false);
    }
  }
}
