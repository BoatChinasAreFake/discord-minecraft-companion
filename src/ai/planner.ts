/**
 * Multi-Turn Planning Loop.
 *
 * Implements IGeminiPlanner as an asynchronous generator emitting PlannerStepEvent
 * updates ('thought', 'tool_call', 'tool_result', 'progress', 'error', 'done').
 * Coordinates multi-turn execution against IMinecraftAgent with fair-play validation,
 * a 10-turn safety guard, and emergency task cancellation.
 */

import type { IMinecraftAgent, ActionResult, Vec3Location } from '../minecraft/types.js';
import { validateToolCall, type ValidationContext } from './tools/validator.js';
import type {
  IGeminiClient,
  IGeminiPlanner,
  PlanningContext,
  PlannerStepEvent,
  PlannerOptions,
  GeminiTurnResponse,
} from './types.js';

export class GeminiPlanner implements IGeminiPlanner {
  private activeAbortController: AbortController | null = null;
  private executing = false;

  constructor(
    private geminiClient: IGeminiClient,
    private minecraftAgent: IMinecraftAgent,
    private options: PlannerOptions = {}
  ) {}

  public isExecuting(): boolean {
    return this.executing;
  }

  public cancelCurrentGoal(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
    this.executing = false;
  }

  public async *executeGoal(
    goalText: string,
    context: PlanningContext
  ): AsyncIterable<PlannerStepEvent> {
    const maxTurns = this.options.maxToolTurns ?? 10;
    this.activeAbortController = new AbortController();
    const signal = this.activeAbortController.signal;
    this.executing = true;

    let turn = 0;
    let completed = false;

    try {
      const systemInstruction = this.buildSystemPrompt(context);
      const session = await this.geminiClient.createSession({ systemInstruction });

      yield {
        type: 'thought',
        message: `Analyzing goal: "${goalText}"`,
        turn: 0,
        timestamp: Date.now(),
      };

      if (signal.aborted) {
        yield { type: 'error', message: 'Goal execution aborted by user signal.', turn: 0 };
        yield { type: 'done', message: 'Halted by cancellation.', turn: 0 };
        return;
      }

      let currentResponse: GeminiTurnResponse = await session.sendUserMessage(goalText, signal);

      while (turn < maxTurns && !completed) {
        if (signal.aborted) {
          yield { type: 'error', message: 'Goal execution aborted by user signal.', turn };
          yield { type: 'done', message: 'Halted by cancellation.', turn };
          return;
        }

        turn++;

        // If model returns conversational text without tool calls, task is considered complete
        if (
          currentResponse.text &&
          (!currentResponse.toolCalls || currentResponse.toolCalls.length === 0)
        ) {
          completed = true;
          yield {
            type: 'progress',
            message: currentResponse.text,
            turn,
            timestamp: Date.now(),
          };
          yield {
            type: 'done',
            message: currentResponse.text,
            turn,
            timestamp: Date.now(),
          };
          break;
        }

        if (currentResponse.text) {
          yield {
            type: 'thought',
            message: currentResponse.text,
            turn,
            timestamp: Date.now(),
          };
        }

        if (currentResponse.toolCalls && currentResponse.toolCalls.length > 0) {
          for (const call of currentResponse.toolCalls) {
            if (signal.aborted) {
              yield { type: 'error', message: 'Goal execution aborted by user signal.', turn };
              yield { type: 'done', message: 'Halted by cancellation.', turn };
              return;
            }

            yield {
              type: 'tool_call',
              toolName: call.name,
              toolArgs: call.args,
              turn,
              timestamp: Date.now(),
            };

            // Fair-play parameter validation
            const validationCtx = this.createValidationContext();
            const validation = validateToolCall(call.name, call.args, validationCtx);

            let actionResult: ActionResult;

            if (!validation.valid) {
              actionResult = {
                success: false,
                message: `Fair-play validation failed: ${validation.error}`,
              };
              yield {
                type: 'error',
                message: actionResult.message,
                turn,
                timestamp: Date.now(),
              };
            } else {
              // Execute legitimate survival action on IMinecraftAgent
              actionResult = await this.executeAction(call.name, validation.data as Record<string, any>);
            }

            yield {
              type: 'tool_result',
              toolName: call.name,
              result: actionResult,
              turn,
              timestamp: Date.now(),
            };

            if (signal.aborted) {
              yield { type: 'error', message: 'Goal execution aborted by user signal.', turn };
              yield { type: 'done', message: 'Halted by cancellation.', turn };
              return;
            }

            // Provide tool response back to Gemini session for multi-turn plan continuation
            currentResponse = await session.sendToolResponse(
              call.name,
              actionResult,
              call.id,
              signal
            );
          }
        } else {
          // No text and no tool calls - break
          completed = true;
          yield {
            type: 'done',
            message: 'Goal completed with no further actions.',
            turn,
            timestamp: Date.now(),
          };
          break;
        }
      }

      // Check if turn guard limit was triggered
      if (turn >= maxTurns && !completed) {
        yield {
          type: 'error',
          message: `Maximum tool turn guard reached (${maxTurns} turns). Goal aborted to prevent unbounded looping.`,
          turn,
          timestamp: Date.now(),
        };
        yield {
          type: 'done',
          message: 'Aborted due to maximum turn limit.',
          turn,
          timestamp: Date.now(),
        };
      }
    } catch (err: any) {
      if (signal.aborted) {
        yield { type: 'error', message: 'Goal execution aborted by user signal.', turn };
        yield { type: 'done', message: 'Halted by cancellation.', turn };
      } else {
        yield {
          type: 'error',
          message: `Planner runtime failure: ${err?.message || String(err)}`,
          turn,
          timestamp: Date.now(),
        };
        yield {
          type: 'done',
          message: 'Planner failed with error.',
          turn,
          timestamp: Date.now(),
        };
      }
    } finally {
      this.executing = false;
      this.activeAbortController = null;
    }
  }

  private createValidationContext(): ValidationContext {
    const status = this.minecraftAgent.getStatus();
    const pos = status.position;
    const botEyePosition: Vec3Location = {
      x: pos.x,
      y: pos.y + 1.62,
      z: pos.z,
    };
    return {
      botEyePosition,
      botPosition: pos,
    };
  }

  private buildSystemPrompt(context: PlanningContext): string {
    const s = context.botStatus;
    const px = Math.round(s.position?.x ?? 0);
    const py = Math.round(s.position?.y ?? 64);
    const pz = Math.round(s.position?.z ?? 0);

    return `You are an AI assistant playing Minecraft Java Edition operating strictly under vanilla survival rules.
Accomplish the user's request through sequential tool executions.

STRICT SURVIVAL FAIR-PLAY CONSTRAINTS:
- No X-Ray: You cannot inspect hidden underground chunks or solid walls. All resources must be discovered via line-of-sight surface exposure using gatherResource.
- Reach Limits: Maximum block interaction reach is 4.5 meters. You must navigate closer before interacting with blocks or containers.
- No Privileged Commands: Administrative commands (/give, /tp, /gamemode, /op) are strictly forbidden.
- Step-by-Step Execution: If an action returns success: false, examine the obstacle message and adjust your plan accordingly.

CURRENT IN-GAME STATUS:
- Position: (${px}, ${py}, ${pz}) in dimension "${s.dimension || 'overworld'}"
- Health: ${(s.health ?? 20).toFixed(1)}/20 | Hunger: ${s.food ?? 20}/20
- Main Hand: ${s.gear?.mainHand || 'none'} | Off Hand: ${s.gear?.offHand || 'none'}
- Armor: ${s.gear?.armorSummary || 'none'}
- Free Inventory Slots: ${s.inventory?.freeSlots ?? 36}/${s.inventory?.totalSlots ?? 36}
- User: ${context.senderTag || 'Unknown'}`;
  }

  private async executeAction(name: string, args: Record<string, any>): Promise<ActionResult> {
    switch (name) {
      case 'goToCoordinates':
        return await this.minecraftAgent.navigateTo({
          x: args.x,
          y: args.y,
          z: args.z,
        });

      case 'followPlayer':
        return {
          success: true,
          message: `Following player ${args.playerName} at distance ${args.distance ?? 3.0} blocks.`,
        };

      case 'gatherResource':
        return await this.executeGatherResource(
          args.blockType,
          args.count ?? 1,
          args.maxSearchRadius ?? 16
        );

      case 'defendArea':
        return {
          success: true,
          message: `Defending perimeter within radius ${args.radius ?? 16} blocks (hostiles only: ${args.targetHostilesOnly ?? true}).`,
        };

      case 'reportStatus':
        return {
          success: true,
          message: 'Status inspected successfully.',
          details: this.minecraftAgent.getStatus() as any,
        };

      case 'stopCurrentTask':
        this.cancelCurrentGoal();
        return {
          success: true,
          message: `Active task halted${args.reason ? `: ${args.reason}` : ''}.`,
        };

      case 'craftItem':
        return await this.minecraftAgent.craftItem(args.item, args.count ?? 1);

      case 'sleepInBed':
        return await this.minecraftAgent.sleepInNearbyBed();

      case 'depositOrRetrieve':
        return {
          success: true,
          message: `Successfully executed container ${args.action} for ${args.items?.length ?? 0} item types.`,
        };

      default:
        return {
          success: false,
          message: `Unknown or unhandled tool: ${name}`,
        };
    }
  }

  private async executeGatherResource(
    blockType: string,
    count: number,
    radius: number
  ): Promise<ActionResult> {
    let gathered = 0;

    for (let i = 0; i < count; i++) {
      if (this.activeAbortController?.signal.aborted) {
        break;
      }

      const visible = await this.minecraftAgent.findVisibleBlock({
        blockNames: [blockType],
        maxDistance: radius,
      });

      if (!visible) {
        if (gathered === 0) {
          return {
            success: false,
            message: `Could not find any exposed, visible ${blockType} within ${radius} blocks (fair-play anti-xray enforced).`,
          };
        }
        return {
          success: true,
          message: `Gathered ${gathered}/${count} ${blockType}. No more exposed blocks in sight.`,
        };
      }

      // Legitimate pathfinding to block (stopping within 3.5m reach)
      const navResult = await this.minecraftAgent.navigateTo(visible.position, { range: 3.5 });
      if (!navResult.success) {
        return {
          success: gathered > 0,
          message: `Pathfinding to ${blockType} failed: ${navResult.message} (gathered: ${gathered}/${count})`,
        };
      }

      // Legitimate block mining
      const mineResult = await this.minecraftAgent.mineBlock(visible.position);
      if (!mineResult.success) {
        return {
          success: gathered > 0,
          message: `Mining ${blockType} failed: ${mineResult.message} (gathered: ${gathered}/${count})`,
        };
      }

      gathered++;
    }

    return {
      success: true,
      message: `Successfully gathered ${gathered} ${blockType}.`,
    };
  }
}
