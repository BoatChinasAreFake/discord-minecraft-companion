import { describe, it, expect } from 'vitest';
import {
  TOOL_NAMES,
  FAIR_PLAY_TOOL_DECLARATIONS,
  goToCoordinatesDeclaration,
  followPlayerDeclaration,
  gatherResourceDeclaration,
  defendAreaDeclaration,
  reportStatusDeclaration,
  stopCurrentTaskDeclaration,
  craftItemDeclaration,
  sleepInBedDeclaration,
  depositOrRetrieveDeclaration,
} from '../../src/ai/tools/definitions.js';
import {
  validateToolArgs,
  validateToolCall,
  FairPlayValidationError,
  FORBIDDEN_ITEMS,
  SURVIVAL_LIMITS,
} from '../../src/ai/tools/validator.js';

describe('Milestone 3 Explorer 2: Structured Fair-Play Tool Declarations & Validator', () => {
  describe('Tool Declarations Conformity (definitions.ts)', () => {
    it('declares exactly the 9 required structured tools', () => {
      expect(TOOL_NAMES).toHaveLength(9);
      expect(TOOL_NAMES).toEqual([
        'goToCoordinates',
        'followPlayer',
        'gatherResource',
        'defendArea',
        'reportStatus',
        'stopCurrentTask',
        'craftItem',
        'sleepInBed',
        'depositOrRetrieve',
      ]);
      expect(FAIR_PLAY_TOOL_DECLARATIONS).toHaveLength(9);
    });

    it('each declaration has name, description, and parameters schema', () => {
      for (const decl of FAIR_PLAY_TOOL_DECLARATIONS) {
        expect(decl.name).toBeDefined();
        expect(decl.description).toBeDefined();
        expect(decl.description!.length).toBeGreaterThan(10);
        expect(decl.parameters).toBeDefined();
        expect(decl.parameters?.type).toBe('OBJECT');
      }
    });

    it('goToCoordinates declaration requires x, y, z', () => {
      expect(goToCoordinatesDeclaration.parameters?.required).toEqual(['x', 'y', 'z']);
      expect(goToCoordinatesDeclaration.parameters?.properties?.x.type).toBe('NUMBER');
      expect(goToCoordinatesDeclaration.parameters?.properties?.y.type).toBe('NUMBER');
      expect(goToCoordinatesDeclaration.parameters?.properties?.z.type).toBe('NUMBER');
    });

    it('followPlayer declaration requires playerName and specifies optional distance', () => {
      expect(followPlayerDeclaration.parameters?.required).toEqual(['playerName']);
      expect(followPlayerDeclaration.parameters?.properties?.playerName.type).toBe('STRING');
      expect(followPlayerDeclaration.parameters?.properties?.distance.type).toBe('NUMBER');
    });

    it('gatherResource declaration requires blockType and count', () => {
      expect(gatherResourceDeclaration.parameters?.required).toEqual(['blockType', 'count']);
      expect(gatherResourceDeclaration.parameters?.properties?.blockType.type).toBe('STRING');
      expect(gatherResourceDeclaration.parameters?.properties?.count.type).toBe('INTEGER');
      expect(gatherResourceDeclaration.parameters?.properties?.maxSearchRadius.type).toBe('NUMBER');
    });

    it('defendArea declaration has radius and targetHostilesOnly', () => {
      expect(defendAreaDeclaration.parameters?.properties?.radius.type).toBe('NUMBER');
      expect(defendAreaDeclaration.parameters?.properties?.targetHostilesOnly.type).toBe('BOOLEAN');
    });

    it('reportStatus declaration has includeInventory and includePosition', () => {
      expect(reportStatusDeclaration.parameters?.properties?.includeInventory.type).toBe('BOOLEAN');
      expect(reportStatusDeclaration.parameters?.properties?.includePosition.type).toBe('BOOLEAN');
    });

    it('stopCurrentTask declaration has optional reason', () => {
      expect(stopCurrentTaskDeclaration.parameters?.properties?.reason.type).toBe('STRING');
    });

    it('craftItem declaration requires item and count', () => {
      expect(craftItemDeclaration.parameters?.required).toEqual(['item', 'count']);
      expect(craftItemDeclaration.parameters?.properties?.item.type).toBe('STRING');
      expect(craftItemDeclaration.parameters?.properties?.count.type).toBe('INTEGER');
    });

    it('sleepInBed declaration has empty properties', () => {
      expect(sleepInBedDeclaration.parameters?.properties).toEqual({});
    });

    it('depositOrRetrieve declaration requires action and items array', () => {
      expect(depositOrRetrieveDeclaration.parameters?.required).toEqual(['action', 'items']);
      expect(depositOrRetrieveDeclaration.parameters?.properties?.action.enum).toEqual(['deposit', 'retrieve']);
      expect(depositOrRetrieveDeclaration.parameters?.properties?.items.type).toBe('ARRAY');
    });
  });

  describe('Validation Interceptor: Happy Path Validation', () => {
    it('validates goToCoordinates with valid survival coordinates', () => {
      const res = validateToolCall('goToCoordinates', { x: 100, y: 64, z: -200 });
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.data).toEqual({ x: 100, y: 64, z: -200 });
      }
    });

    it('validates followPlayer with username and custom distance', () => {
      const res = validateToolCall('followPlayer', { playerName: 'Steve', distance: 5 });
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.data).toEqual({ playerName: 'Steve', distance: 5 });
      }
    });

    it('validates followPlayer with default distance', () => {
      const res = validateToolCall('followPlayer', { playerName: 'Alex' });
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.data).toEqual({ playerName: 'Alex', distance: 3 });
      }
    });

    it('validates gatherResource with valid block and stack count', () => {
      const res = validateToolCall('gatherResource', { blockType: 'oak_log', count: 16 });
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.data).toEqual({ blockType: 'oak_log', count: 16, maxSearchRadius: 16 });
      }
    });

    it('validates gatherResource normalizing minecraft: prefix', () => {
      const res = validateToolCall('gatherResource', { blockType: 'minecraft:iron_ore', count: 8, maxSearchRadius: 20 });
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.data).toEqual({ blockType: 'iron_ore', count: 8, maxSearchRadius: 20 });
      }
    });

    it('validates defendArea with default parameters', () => {
      const res = validateToolCall('defendArea', {});
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.data).toEqual({ radius: 16, targetHostilesOnly: true });
      }
    });

    it('validates reportStatus with default parameters', () => {
      const res = validateToolCall('reportStatus', {});
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.data).toEqual({ includeInventory: true, includePosition: true });
      }
    });

    it('validates stopCurrentTask with benign reason', () => {
      const res = validateToolCall('stopCurrentTask', { reason: 'User issued stop command' });
      expect(res.valid).toBe(true);
    });

    it('validates craftItem with valid survival item and count', () => {
      const res = validateToolCall('craftItem', { item: 'wooden_pickaxe', count: 1 });
      expect(res.valid).toBe(true);
    });

    it('validates sleepInBed with empty object', () => {
      const res = validateToolCall('sleepInBed', {});
      expect(res.valid).toBe(true);
    });

    it('validates depositOrRetrieve for deposit', () => {
      const res = validateToolCall('depositOrRetrieve', {
        action: 'deposit',
        containerCoordinates: { x: 10, y: 64, z: 10 },
        items: [{ name: 'cobblestone', count: 32 }],
      });
      expect(res.valid).toBe(true);
    });

    it('validates depositOrRetrieve for retrieve without coordinates', () => {
      const res = validateToolCall('depositOrRetrieve', {
        action: 'retrieve',
        items: [{ name: 'bread', count: 5 }],
      });
      expect(res.valid).toBe(true);
    });
  });

  describe('Fair-Play Survival Bounds & Corner Cases', () => {
    it('accepts boundary Y levels: -64 and 320', () => {
      expect(validateToolCall('goToCoordinates', { x: 0, y: -64, z: 0 }).valid).toBe(true);
      expect(validateToolCall('goToCoordinates', { x: 0, y: 320, z: 0 }).valid).toBe(true);
    });

    it('rejects out-of-bounds Y levels (< -64 or > 320)', () => {
      const below = validateToolCall('goToCoordinates', { x: 0, y: -65, z: 0 });
      expect(below.valid).toBe(false);
      expect(below.error).toContain('survival world bounds');

      const above = validateToolCall('goToCoordinates', { x: 0, y: 321, z: 0 });
      expect(above.valid).toBe(false);
      expect(above.error).toContain('survival world bounds');
    });

    it('rejects NaN and Infinite coordinates', () => {
      expect(validateToolCall('goToCoordinates', { x: NaN, y: 64, z: 0 }).valid).toBe(false);
      expect(validateToolCall('goToCoordinates', { x: 0, y: Infinity, z: 0 }).valid).toBe(false);
      expect(validateToolCall('goToCoordinates', { x: 0, y: 64, z: -Infinity }).valid).toBe(false);
    });

    it('accepts stack boundary counts: 1 and 64', () => {
      expect(validateToolCall('craftItem', { item: 'torch', count: 1 }).valid).toBe(true);
      expect(validateToolCall('craftItem', { item: 'torch', count: 64 }).valid).toBe(true);
    });

    it('rejects stack count violations: 0, negative, and > 64', () => {
      expect(validateToolCall('craftItem', { item: 'torch', count: 0 }).valid).toBe(false);
      expect(validateToolCall('craftItem', { item: 'torch', count: -5 }).valid).toBe(false);
      expect(validateToolCall('craftItem', { item: 'torch', count: 65 }).valid).toBe(false);
      expect(validateToolCall('craftItem', { item: 'torch', count: 2.5 }).valid).toBe(false);
    });

    it('accepts search and defend radii: 1 and 32', () => {
      expect(validateToolCall('defendArea', { radius: 1 }).valid).toBe(true);
      expect(validateToolCall('defendArea', { radius: 32 }).valid).toBe(true);
      expect(validateToolCall('gatherResource', { blockType: 'stone', count: 1, maxSearchRadius: 1 }).valid).toBe(true);
      expect(validateToolCall('gatherResource', { blockType: 'stone', count: 1, maxSearchRadius: 32 }).valid).toBe(true);
    });

    it('rejects radius violations: 0, negative, and > 32', () => {
      expect(validateToolCall('defendArea', { radius: 0 }).valid).toBe(false);
      expect(validateToolCall('defendArea', { radius: 33 }).valid).toBe(false);
      expect(validateToolCall('defendArea', { radius: -10 }).valid).toBe(false);
      expect(validateToolCall('gatherResource', { blockType: 'stone', count: 1, maxSearchRadius: 50 }).valid).toBe(false);
    });

    it('rejects follow distance violations (< 1 or > 32)', () => {
      expect(validateToolCall('followPlayer', { playerName: 'Steve', distance: 0 }).valid).toBe(false);
      expect(validateToolCall('followPlayer', { playerName: 'Steve', distance: 33 }).valid).toBe(false);
    });
  });

  describe('Reach Constraint Enforcement (depositOrRetrieve)', () => {
    it('passes container interaction within 4.50m reach', () => {
      const botEye = { x: 0, y: 65.62, z: 0 };
      const closeContainer = { x: 2, y: 64, z: 0 }; // distance ~2.09m <= 4.5m

      const res = validateToolCall(
        'depositOrRetrieve',
        {
          action: 'deposit',
          containerCoordinates: closeContainer,
          items: [{ name: 'cobblestone', count: 10 }],
        },
        { botEyePosition: botEye }
      );

      expect(res.valid).toBe(true);
    });

    it('rejects container interaction exceeding 4.50m reach when context provided', () => {
      const botEye = { x: 0, y: 65.62, z: 0 };
      const farContainer = { x: 10, y: 64, z: 0 }; // distance > 10.0m > 4.5m

      const res = validateToolCall(
        'depositOrRetrieve',
        {
          action: 'deposit',
          containerCoordinates: farContainer,
          items: [{ name: 'cobblestone', count: 10 }],
        },
        { botEyePosition: botEye }
      );

      expect(res.valid).toBe(false);
      expect(res.code).toBe('REACH_EXCEEDED');
      expect(res.error).toContain('out of reach');
    });

    it('throws FairPlayValidationError on validateToolArgs when reach exceeded', () => {
      const botEye = { x: 0, y: 65.62, z: 0 };
      const farContainer = { x: 10, y: 64, z: 0 };

      expect(() =>
        validateToolArgs(
          'depositOrRetrieve',
          {
            action: 'deposit',
            containerCoordinates: farContainer,
            items: [{ name: 'cobblestone', count: 10 }],
          },
          { botEyePosition: botEye }
        )
      ).toThrow(FairPlayValidationError);
    });
  });

  describe('Forbidden Item & Block Sanitization', () => {
    const forbiddenSamples = [
      'bedrock',
      'barrier',
      'command_block',
      'chain_command_block',
      'repeating_command_block',
      'structure_block',
      'structure_void',
      'jigsaw',
      'light',
      'debug_stick',
      'spawner',
      'monster_spawner',
    ];

    it.each(forbiddenSamples)('rejects gatherResource with forbidden item "%s"', (item) => {
      const res = validateToolCall('gatherResource', { blockType: item, count: 1 });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/forbidden|creative-only/i);
    });

    it.each(forbiddenSamples)('rejects craftItem with forbidden item "%s"', (item) => {
      const res = validateToolCall('craftItem', { item, count: 1 });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/forbidden|creative-only/i);
    });

    it.each(forbiddenSamples)('rejects depositOrRetrieve containing forbidden item "%s"', (item) => {
      const res = validateToolCall('depositOrRetrieve', {
        action: 'deposit',
        items: [{ name: item, count: 1 }],
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/forbidden|creative-only/i);
    });
  });

  describe('Rejection of OP Command Injection Attempts', () => {
    it('blocks command injection in stopCurrentTask reason (/op, /gamemode, /stop)', () => {
      expect(validateToolCall('stopCurrentTask', { reason: '/op Hacker' }).valid).toBe(false);
      expect(validateToolCall('stopCurrentTask', { reason: '/gamemode creative' }).valid).toBe(false);
      expect(validateToolCall('stopCurrentTask', { reason: '/stop' }).valid).toBe(false);
      expect(validateToolCall('stopCurrentTask', { reason: '/give @p diamond 64' }).valid).toBe(false);
    });

    it('blocks multiline command injection in stopCurrentTask reason', () => {
      expect(validateToolCall('stopCurrentTask', { reason: 'User requested halt\n/op Hacker' }).valid).toBe(false);
      expect(validateToolCall('stopCurrentTask', { reason: 'User requested halt\r\n/kill @e' }).valid).toBe(false);
    });

    it('blocks semicolon command injection in stopCurrentTask reason', () => {
      expect(validateToolCall('stopCurrentTask', { reason: 'halt; /op hacker' }).valid).toBe(false);
    });

    it('blocks command injection in followPlayer playerName', () => {
      expect(validateToolCall('followPlayer', { playerName: '/op Alice' }).valid).toBe(false);
      expect(validateToolCall('followPlayer', { playerName: 'Alice\n/give' }).valid).toBe(false);
      expect(validateToolCall('followPlayer', { playerName: 'Steve;/kill' }).valid).toBe(false);
    });

    it('blocks command injection in gatherResource blockType', () => {
      expect(validateToolCall('gatherResource', { blockType: '/give @p diamond', count: 1 }).valid).toBe(false);
      expect(validateToolCall('gatherResource', { blockType: 'stone\n/op hacker', count: 1 }).valid).toBe(false);
    });

    it('blocks command injection in craftItem item', () => {
      expect(validateToolCall('craftItem', { item: '/gamemode 1', count: 1 }).valid).toBe(false);
      expect(validateToolCall('craftItem', { item: 'sword; /op hacker', count: 1 }).valid).toBe(false);
    });
  });

  describe('General Schema Integrity', () => {
    it('rejects unknown tool names with UNKNOWN_TOOL_NAME code', () => {
      const res = validateToolCall('teleportToPlayer', { target: 'Steve' });
      expect(res.valid).toBe(false);
      expect(res.code).toBe('UNKNOWN_TOOL_NAME');
    });

    it('rejects depositOrRetrieve with empty items array', () => {
      const res = validateToolCall('depositOrRetrieve', { action: 'deposit', items: [] });
      expect(res.valid).toBe(false);
    });

    it('rejects depositOrRetrieve with invalid action string', () => {
      const res = validateToolCall('depositOrRetrieve', {
        action: 'steal',
        items: [{ name: 'diamond', count: 1 }],
      });
      expect(res.valid).toBe(false);
    });
  });
});
