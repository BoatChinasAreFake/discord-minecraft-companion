import { describe, it, expect } from 'vitest';
import {
  assertAllowedMinecraftChat,
  sanitizeMinecraftMessage,
  isPrivilegedCommand,
  PrivilegedCommandError,
} from '../../src/minecraft/fairplay/commandSanitizer.js';

describe('Tier 2: Command Sanitizer Boundaries & Edge Cases (T2-SAN-01 to T2-SAN-17)', () => {
  // --------------------------------------------------------------------------
  // Direct OP Commands (T2-SAN-01 to T2-SAN-06)
  // --------------------------------------------------------------------------
  describe('Direct OP Commands (T2-SAN-01 to T2-SAN-06)', () => {
    it('T2-SAN-01: blocks direct /op command and throws PrivilegedCommandError', () => {
      const input = '/op malicious_user';
      expect(() => assertAllowedMinecraftChat(input)).toThrow(PrivilegedCommandError);
      expect(isPrivilegedCommand(input)).toBe(true);

      try {
        assertAllowedMinecraftChat(input);
      } catch (err: any) {
        expect(err).toBeInstanceOf(PrivilegedCommandError);
        expect(err.command).toBe('op');
      }
    });

    it('T2-SAN-02: blocks direct /gamemode command and throws PrivilegedCommandError', () => {
      const input = '/gamemode creative';
      expect(() => assertAllowedMinecraftChat(input)).toThrow(PrivilegedCommandError);
      expect(isPrivilegedCommand(input)).toBe(true);

      try {
        assertAllowedMinecraftChat(input);
      } catch (err: any) {
        expect(err).toBeInstanceOf(PrivilegedCommandError);
        expect(err.command).toBe('gamemode');
      }
    });

    it('T2-SAN-03: blocks direct /tp teleportation command and throws PrivilegedCommandError', () => {
      const input = '/tp 0 100 0';
      expect(() => assertAllowedMinecraftChat(input)).toThrow(PrivilegedCommandError);
      expect(isPrivilegedCommand(input)).toBe(true);

      try {
        assertAllowedMinecraftChat(input);
      } catch (err: any) {
        expect(err).toBeInstanceOf(PrivilegedCommandError);
        expect(err.command).toBe('tp');
      }
    });

    it('T2-SAN-04: blocks direct /give item spawn command and throws PrivilegedCommandError', () => {
      const input = '/give @p diamond 64';
      expect(() => assertAllowedMinecraftChat(input)).toThrow(PrivilegedCommandError);
      expect(isPrivilegedCommand(input)).toBe(true);

      try {
        assertAllowedMinecraftChat(input);
      } catch (err: any) {
        expect(err).toBeInstanceOf(PrivilegedCommandError);
        expect(err.command).toBe('give');
      }
    });

    it('T2-SAN-05: blocks direct /kill entity command and throws PrivilegedCommandError', () => {
      const input = '/kill @e[type=!player]';
      expect(() => assertAllowedMinecraftChat(input)).toThrow(PrivilegedCommandError);
      expect(isPrivilegedCommand(input)).toBe(true);

      try {
        assertAllowedMinecraftChat(input);
      } catch (err: any) {
        expect(err).toBeInstanceOf(PrivilegedCommandError);
        expect(err.command).toBe('kill');
      }
    });

    it('T2-SAN-06: blocks direct /execute administrative script command and throws PrivilegedCommandError', () => {
      const input = '/execute as @a run gamemode survival';
      expect(() => assertAllowedMinecraftChat(input)).toThrow(PrivilegedCommandError);
      expect(isPrivilegedCommand(input)).toBe(true);

      try {
        assertAllowedMinecraftChat(input);
      } catch (err: any) {
        expect(err).toBeInstanceOf(PrivilegedCommandError);
        expect(err.command).toBe('execute');
      }
    });
  });

  // --------------------------------------------------------------------------
  // Obfuscation & Exploit Bypasses (T2-SAN-07 to T2-SAN-14)
  // --------------------------------------------------------------------------
  describe('Obfuscation & Bypass Defenses (T2-SAN-07 to T2-SAN-14)', () => {
    it('T2-SAN-07: catches vanilla namespace prefix /minecraft:gamemode and resolves root command', () => {
      const input = '/minecraft:gamemode creative';
      expect(() => assertAllowedMinecraftChat(input)).toThrow(PrivilegedCommandError);
      expect(isPrivilegedCommand(input)).toBe(true);

      try {
        assertAllowedMinecraftChat(input);
      } catch (err: any) {
        expect(err).toBeInstanceOf(PrivilegedCommandError);
        expect(err.command).toBe('gamemode');
      }
    });

    it('T2-SAN-08: catches Bukkit/Spigot namespace prefix /bukkit:op and blocks attacker', () => {
      const input = '/bukkit:op attacker';
      expect(() => assertAllowedMinecraftChat(input)).toThrow(PrivilegedCommandError);
      expect(isPrivilegedCommand(input)).toBe(true);

      try {
        assertAllowedMinecraftChat(input);
      } catch (err: any) {
        expect(err).toBeInstanceOf(PrivilegedCommandError);
        expect(err.command).toBe('op');
      }
    });

    it('T2-SAN-09: catches whitespace inside namespace syntax /minecraft : give', () => {
      const input = '/minecraft : give player diamond';
      expect(() => assertAllowedMinecraftChat(input)).toThrow(PrivilegedCommandError);
      expect(isPrivilegedCommand(input)).toBe(true);
    });

    it('T2-SAN-10: blocks leading whitespace command injection /  gamemode', () => {
      const input = '/  gamemode 1';
      expect(() => assertAllowedMinecraftChat(input)).toThrow(PrivilegedCommandError);
      expect(isPrivilegedCommand(input)).toBe(true);
    });

    it('T2-SAN-11: blocks tab (\\t) and non-breaking space (\\u00A0) obfuscation attempts', () => {
      const tabInput = '/\tgamemode creative';
      expect(() => assertAllowedMinecraftChat(tabInput)).toThrow(PrivilegedCommandError);
      expect(isPrivilegedCommand(tabInput)).toBe(true);

      const nbspInput = '/\u00A0op attacker';
      expect(() => assertAllowedMinecraftChat(nbspInput)).toThrow(PrivilegedCommandError);
      expect(isPrivilegedCommand(nbspInput)).toBe(true);
    });

    it('T2-SAN-12: strips multi-slash prefixes //gamemode and ///tp to root command and blocks', () => {
      const doubleSlash = '//gamemode c';
      expect(() => assertAllowedMinecraftChat(doubleSlash)).toThrow(PrivilegedCommandError);
      expect(isPrivilegedCommand(doubleSlash)).toBe(true);

      const tripleSlash = '///tp 10 10 10';
      expect(() => assertAllowedMinecraftChat(tripleSlash)).toThrow(PrivilegedCommandError);
      expect(isPrivilegedCommand(tripleSlash)).toBe(true);
    });

    it('T2-SAN-13: handles mixed-case bypass attempts (/GaMeMoDe CrEaTiVe, /oP)', () => {
      const mixedGamemode = '/GaMeMoDe CrEaTiVe';
      expect(() => assertAllowedMinecraftChat(mixedGamemode)).toThrow(PrivilegedCommandError);
      expect(isPrivilegedCommand(mixedGamemode)).toBe(true);

      const mixedOp = '/oP attacker';
      expect(() => assertAllowedMinecraftChat(mixedOp)).toThrow(PrivilegedCommandError);
      expect(isPrivilegedCommand(mixedOp)).toBe(true);
    });

    it('T2-SAN-14: multiline newline scanner detects hidden privileged command on subsequent lines', () => {
      const injection = '/say Hello world\n/op attacker';
      expect(() => assertAllowedMinecraftChat(injection)).toThrow(PrivilegedCommandError);
      expect(isPrivilegedCommand(injection)).toBe(true);

      const semicolonInjection = 'hello world;/gamemode creative';
      expect(() => assertAllowedMinecraftChat(semicolonInjection)).toThrow(PrivilegedCommandError);
      expect(isPrivilegedCommand(semicolonInjection)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Conversational & Edge Syntax Pass-Through (T2-SAN-15 to T2-SAN-17)
  // --------------------------------------------------------------------------
  describe('Conversational & Edge Syntax (T2-SAN-15 to T2-SAN-17)', () => {
    it('T2-SAN-15: permits regular chat containing blocked command words mid-sentence ("I want to op the door")', () => {
      const input = 'I want to op the door';
      expect(() => assertAllowedMinecraftChat(input)).not.toThrow();
      expect(assertAllowedMinecraftChat(input)).toBe(input);
      expect(isPrivilegedCommand(input)).toBe(false);

      const res = sanitizeMinecraftMessage(input);
      expect(res.isCommand).toBe(false);
      expect(res.allowed).toBe(true);
      expect(res.cleanedText).toBe(input);
    });

    it('T2-SAN-16: permits questions and command mentions in chat ("How to use /tp?")', () => {
      const input = 'How to use /tp?';
      expect(() => assertAllowedMinecraftChat(input)).not.toThrow();
      expect(isPrivilegedCommand(input)).toBe(false);

      const res = sanitizeMinecraftMessage(input);
      expect(res.isCommand).toBe(false);
      expect(res.allowed).toBe(true);
    });

    it('T2-SAN-17: handles bare slashes ("/" and "///") gracefully without throwing uncaught exceptions', () => {
      expect(() => sanitizeMinecraftMessage('/')).not.toThrow();
      expect(() => sanitizeMinecraftMessage('///')).not.toThrow();

      const singleSlash = sanitizeMinecraftMessage('/');
      expect(singleSlash).toBeDefined();

      const multiSlash = sanitizeMinecraftMessage('///');
      expect(multiSlash).toBeDefined();
    });
  });
});
