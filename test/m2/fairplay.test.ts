import { describe, it, expect } from 'vitest';
import {
  assertBlockReach,
  assertEntityAttackReach,
  getBlockDistanceToEye,
  getEntityDistanceToEye,
  ReachExceededError,
  MAX_BLOCK_REACH_METERS,
  MAX_ENTITY_ATTACK_REACH_METERS,
} from '../../src/minecraft/fairplay/reach.js';
import {
  sanitizeMinecraftMessage,
  assertAllowedMinecraftChat,
  isPrivilegedCommand,
  PrivilegedCommandError,
} from '../../src/minecraft/fairplay/commandSanitizer.js';
import {
  validateFairPlayAction,
  assertFairPlayAction,
  FAIRPLAY_BLOCK_REACH,
  FAIRPLAY_ENTITY_REACH,
} from '../../src/minecraft/fairplay/rules.js';

describe('Milestone 2: Fair-Play & Anti-Cheat Subsystem', () => {
  describe('Reach Enforcer (reach.ts)', () => {
    it('TC-RCH-1: Block interaction at 4.2m passes reach check', () => {
      const eyePos = { x: 0, y: 64, z: 0 };
      const blockPos = { x: 4, y: 64, z: 0 }; // Closest point on AABB is x=4, distance is 4.0m
      expect(() => assertBlockReach(eyePos, blockPos)).not.toThrow();
      const dist = getBlockDistanceToEye(eyePos, blockPos);
      expect(dist).toBe(4.0);
    });

    it('TC-RCH-2: Block interaction beyond 4.50m (e.g. at 5.0m) throws ReachExceededError', () => {
      const eyePos = { x: 0, y: 64, z: 0 };
      // Target block at x=5, closest point on AABB is x=5.0m (> 4.50m)
      const blockPos = { x: 5, y: 64, z: 0 };
      expect(() => assertBlockReach(eyePos, blockPos)).toThrow(ReachExceededError);

      try {
        assertBlockReach(eyePos, blockPos);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ReachExceededError);
        expect(err.targetType).toBe('block');
        expect(err.maxAllowed).toBe(MAX_BLOCK_REACH_METERS);
        expect(err.distance).toBeGreaterThan(4.50);
      }
    });

    it('TC-RCH-3: Exact unit AABB clamping calculation from diagonal angle', () => {
      const eyePos = { x: 0, y: 0, z: 0 };
      // Block at x=2, y=2, z=2. Closest point on [2, 3] x [2, 3] x [2, 3] is (2, 2, 2)
      const blockPos = { x: 2, y: 2, z: 2 };
      const dist = getBlockDistanceToEye(eyePos, blockPos);
      // Distance is sqrt(2^2 + 2^2 + 2^2) = sqrt(12) ≈ 3.464m
      expect(dist).toBeCloseTo(Math.sqrt(12), 3);
      expect(dist).toBeLessThanOrEqual(MAX_BLOCK_REACH_METERS);
    });

    it('TC-RCH-4: Entity combat attack at 3.2m passes reach check', () => {
      const eyePos = { x: 0, y: 65.62, z: 0 };
      const entityPos = { x: 3.0, y: 64.0, z: 0 }; // Distance ~3.2m
      expect(() => assertEntityAttackReach(eyePos, entityPos)).not.toThrow();
    });

    it('TC-RCH-5: Entity combat attack at 3.6m throws ReachExceededError', () => {
      const eyePos = { x: 0, y: 65.62, z: 0 };
      const entityPos = { x: 4.0, y: 64.0, z: 0 }; // Distance > 3.5m
      expect(() => assertEntityAttackReach(eyePos, entityPos)).toThrow(ReachExceededError);
    });
  });

  describe('Command Sanitizer (commandSanitizer.ts)', () => {
    it('TC-SAN-1: Blocks OP command /tp and teleport variations', () => {
      expect(isPrivilegedCommand('/tp Alice 100 64 200')).toBe(true);
      expect(isPrivilegedCommand('/teleport Bob')).toBe(true);
      expect(isPrivilegedCommand('/tphere Charlie')).toBe(true);
      expect(() => assertAllowedMinecraftChat('/tp 0 100 0')).toThrow(PrivilegedCommandError);
    });

    it('TC-SAN-2: Blocks creative item cheating /give and /setblock', () => {
      expect(isPrivilegedCommand('/give @p diamond 64')).toBe(true);
      expect(isPrivilegedCommand('/setblock ~ ~ ~ diamond_block')).toBe(true);
      expect(isPrivilegedCommand('/fill ~ ~ ~ ~10 ~10 ~10 air')).toBe(true);
    });

    it('TC-SAN-3: Blocks gamemode and world exploits', () => {
      expect(isPrivilegedCommand('/gamemode creative')).toBe(true);
      expect(isPrivilegedCommand('/gm 1')).toBe(true);
      expect(isPrivilegedCommand('/time set day')).toBe(true);
      expect(isPrivilegedCommand('/weather clear')).toBe(true);
    });

    it('TC-SAN-4: Blocks admin server commands /op, /stop, /kill', () => {
      expect(isPrivilegedCommand('/op Hacker')).toBe(true);
      expect(isPrivilegedCommand('/stop')).toBe(true);
      expect(isPrivilegedCommand('/kill @e')).toBe(true);
      expect(isPrivilegedCommand('/ban player')).toBe(true);
    });

    it('TC-SAN-5: Normalizes and intercepts case variations (/TP, /Give, /GameMode)', () => {
      expect(isPrivilegedCommand('/TP player 0 100 0')).toBe(true);
      expect(isPrivilegedCommand('/GIVE @p gold 64')).toBe(true);
      expect(isPrivilegedCommand('/GameMode survival')).toBe(true);
    });

    it('TC-SAN-6: Normalizes and intercepts whitespace padding and multiple slashes', () => {
      expect(isPrivilegedCommand('   /tp 0 100 0   ')).toBe(true);
      expect(isPrivilegedCommand('//give @p iron 64')).toBe(true);
      expect(isPrivilegedCommand('///gamemode 1')).toBe(true);
    });

    it('TC-SAN-7: Intercepts namespace prefixed commands (/minecraft:give, /minecraft:tp)', () => {
      expect(isPrivilegedCommand('/minecraft:give @p diamond 1')).toBe(true);
      expect(isPrivilegedCommand('/minecraft:tp 100 64 100')).toBe(true);
    });

    it('TC-SAN-8: Strips hidden zero-width unicode characters injected into commands', () => {
      // Injected zero-width spaces (\u200B) inside "/\u200Btp"
      const injected = '/\u200Btp 100 64 100';
      expect(isPrivilegedCommand(injected)).toBe(true);
    });

    it('TC-SAN-9: Allows safe communication commands like /tell, /msg, /help', () => {
      const res1 = sanitizeMinecraftMessage('/tell Alice Hello!');
      expect(res1.isCommand).toBe(true);
      expect(res1.allowed).toBe(true);

      const res2 = sanitizeMinecraftMessage('/msg Bob I found a village');
      expect(res2.isCommand).toBe(true);
      expect(res2.allowed).toBe(true);
    });

    it('TC-SAN-10: Allows regular chat messages that mention commands without leading slash', () => {
      const chat = 'Does anyone know why /tp is disabled on this survival server?';
      const res = sanitizeMinecraftMessage(chat);
      expect(res.isCommand).toBe(false);
      expect(res.allowed).toBe(true);
      expect(res.cleanedText).toBe(chat);
    });

    it('TC-SAN-11: Blocks administrative OP commands (/clear, /spectate, /datapack)', () => {
      expect(isPrivilegedCommand('/clear @a')).toBe(true);
      expect(isPrivilegedCommand('/spectate Steve')).toBe(true);
      expect(isPrivilegedCommand('/datapack disable vanilla')).toBe(true);
      expect(() => assertAllowedMinecraftChat('/clear @a')).toThrow(PrivilegedCommandError);
      expect(() => assertAllowedMinecraftChat('/spectate Steve')).toThrow(PrivilegedCommandError);
      expect(() => assertAllowedMinecraftChat('/datapack disable vanilla')).toThrow(PrivilegedCommandError);
    });

    it('TC-SAN-12: Blocks space-padded namespace commands without regex backtracking failures', () => {
      expect(isPrivilegedCommand('/minecraft: give @p diamond 64')).toBe(true);
      expect(isPrivilegedCommand('/minecraft: tp 100 64 100')).toBe(true);
      expect(isPrivilegedCommand('/bukkit: op hacker')).toBe(true);
      expect(() => assertAllowedMinecraftChat('/minecraft: give @p diamond 64')).toThrow(PrivilegedCommandError);
      // Malformed colon without identifier
      expect(isPrivilegedCommand('/minecraft:')).toBe(true);
      expect(isPrivilegedCommand('/minecraft:  ')).toBe(true);
      expect(isPrivilegedCommand('/minecraft:???')).toBe(true);
    });

    it('TC-SAN-13: Blocks multiline command injections and semicolon chaining', () => {
      expect(isPrivilegedCommand('Good morning everyone!\n/op Hacker')).toBe(true);
      expect(isPrivilegedCommand('/tell Alice hello\n/give @p diamond 64')).toBe(true);
      expect(isPrivilegedCommand('/tell Alice hi; /op hacker')).toBe(true);
      expect(() => assertAllowedMinecraftChat('Good morning everyone!\n/op Hacker')).toThrow(PrivilegedCommandError);
      expect(() => assertAllowedMinecraftChat('/tell Alice hello\n/give @p diamond 64')).toThrow(PrivilegedCommandError);
    });

    it('TC-SAN-14: Preserves multiline regular chat and allowed survival commands', () => {
      const multiChat = 'Line 1: Hello\nLine 2: World';
      const resChat = sanitizeMinecraftMessage(multiChat);
      expect(resChat.isCommand).toBe(false);
      expect(resChat.allowed).toBe(true);
      expect(resChat.cleanedText).toBe(multiChat);

      const multiAllowed = '/tell Alice hello\n/msg Bob world';
      const resAllowed = sanitizeMinecraftMessage(multiAllowed);
      expect(resAllowed.isCommand).toBe(true);
      expect(resAllowed.allowed).toBe(true);
      expect(resAllowed.commandName).toBe('tell');
    });
  });

  describe('Survival Rules Validator (rules.ts)', () => {
    it('TC-RUL-1: Validates block reach limits and action parameters', () => {
      const eyePos = { x: 0, y: 64, z: 0 };
      const closeBlock = { x: 2, y: 64, z: 0 };
      const farBlock = { x: 10, y: 64, z: 0 };

      const okResult = validateFairPlayAction('mine', { eyePos, targetPos: closeBlock });
      expect(okResult.valid).toBe(true);

      const failResult = validateFairPlayAction('mine', { eyePos, targetPos: farBlock });
      expect(failResult.valid).toBe(false);
      expect(failResult.reason).toContain('exceeds max fair-play limit');
    });

    it('TC-RUL-2: Validates movement safe drop down distance and parkour rules', () => {
      const safeMove = validateFairPlayAction('move', { maxDropDown: 3, allowParkour: false });
      expect(safeMove.valid).toBe(true);

      const dangerousMove = validateFairPlayAction('move', { maxDropDown: 5 });
      expect(dangerousMove.valid).toBe(false);

      const parkourMove = validateFairPlayAction('move', { allowParkour: true });
      expect(parkourMove.valid).toBe(false);
    });
  });
});
