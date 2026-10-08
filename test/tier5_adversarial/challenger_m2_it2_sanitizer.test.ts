import { describe, it, expect } from 'vitest';
import {
  sanitizeMinecraftMessage,
  assertAllowedMinecraftChat,
  isPrivilegedCommand,
  PrivilegedCommandError,
  BLOCKED_COMMANDS,
} from '../../src/minecraft/fairplay/commandSanitizer.js';

describe('Empirical Challenger 2: Milestone 2 Iteration 2 Adversarial Sanitizer Suite', () => {
  // ==========================================================================
  // AREA 1: Multiline Command Injections with Benign Line 1
  // ==========================================================================
  describe('Area 1: Multiline Command Injections with Benign Line 1', () => {
    it('EMP-SAN-ML-1: Blocks newline injection with benign chat line 1 (\\n, \\r\\n, \\r)', () => {
      const payloads = [
        'Hello world\n/op Hacker',
        'Hello world\r\n/op Hacker',
        'Hello world\r/op Hacker',
        'Just chilling here\n/tp @a 0 100 0',
        'Nice house Bob\r\n/kill @e',
        'Good game\r/gamemode creative',
      ];

      for (const payload of payloads) {
        const res = sanitizeMinecraftMessage(payload);
        expect(res.isCommand, `Expected isCommand=true for "${JSON.stringify(payload)}"`).toBe(true);
        expect(res.allowed, `Expected allowed=false for "${JSON.stringify(payload)}"`).toBe(false);
        expect(isPrivilegedCommand(payload), `Expected isPrivilegedCommand=true for "${JSON.stringify(payload)}"`).toBe(true);
        expect(
          () => assertAllowedMinecraftChat(payload),
          `Expected PrivilegedCommandError for "${JSON.stringify(payload)}"`
        ).toThrow(PrivilegedCommandError);
      }
    });

    it('EMP-SAN-ML-2: Blocks CRLF injection with permitted command line 1: "/tell Bob hi\\r\\n/give @p diamond"', () => {
      const inputs = [
        '/tell Bob hi\r\n/give @p diamond',
        '/tell Bob hi\n/give @p diamond',
        '/msg Alice look at this\r\n/gamemode 1',
        '/help 1\r\n/stop',
      ];

      for (const input of inputs) {
        const res = sanitizeMinecraftMessage(input);
        expect(res.isCommand).toBe(true);
        expect(res.allowed).toBe(false);
        expect(isPrivilegedCommand(input)).toBe(true);
        expect(() => assertAllowedMinecraftChat(input)).toThrow(PrivilegedCommandError);
      }
    });

    it('EMP-SAN-ML-3: Blocks multiline injection with deep line positioning (line 3, line 5, line 10)', () => {
      const deepInputs = [
        'Line 1\nLine 2\n/op hacker',
        'Line 1\r\nLine 2\r\nLine 3\r\nLine 4\r\n/give @p netherite_sword',
        'L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9\n/kill @e',
        'L1\n\n\n\n/tp 0 0 0\n\nL2', // sandwiched between empty lines and trailing chat
      ];

      for (const deep of deepInputs) {
        expect(isPrivilegedCommand(deep)).toBe(true);
        expect(() => assertAllowedMinecraftChat(deep)).toThrow(PrivilegedCommandError);
      }
    });

    it('EMP-SAN-ML-4: Blocks multiline injection with whitespace-padded commands', () => {
      const paddedInputs = [
        'Hello\n   /gamemode creative   ',
        'Hello\r\n\t\t/op hacker\t',
        'Hello\n  /give @p diamond 64  ',
        'Hello\r   /stop   ',
      ];

      for (const input of paddedInputs) {
        expect(isPrivilegedCommand(input)).toBe(true);
        expect(() => assertAllowedMinecraftChat(input)).toThrow(PrivilegedCommandError);
      }
    });

    it('EMP-SAN-ML-5: Blocks multiline injection with namespaced and double-slash commands', () => {
      const namespaced = [
        'Hello\n/minecraft:give @p diamond',
        'Hello\r\n/minecraft:tp 100 64 100',
        'Hello\n/bukkit:op hacker',
        'Hello\r\n/spigot:gamemode 1',
        'Hello\n//wand',
        'Hello\r\n//set 0',
      ];

      for (const cmd of namespaced) {
        expect(isPrivilegedCommand(cmd)).toBe(true);
        expect(() => assertAllowedMinecraftChat(cmd)).toThrow(PrivilegedCommandError);
      }
    });

    it('EMP-SAN-ML-6: Blocks multiline injection with malformed space-after-slash', () => {
      const malformed = [
        'Hello\n/  op hacker',
        'Hello\r\n/\top hacker',
        'Hello\n/\u00A0gamemode creative',
        'Hello\r\n/',
        'Hello\n//',
      ];

      for (const m of malformed) {
        const res = sanitizeMinecraftMessage(m);
        expect(res.isCommand).toBe(true);
        expect(res.allowed).toBe(false);
        expect(isPrivilegedCommand(m)).toBe(true);
        expect(() => assertAllowedMinecraftChat(m)).toThrow(PrivilegedCommandError);
      }
    });
  });

  // ==========================================================================
  // AREA 2: Semicolon-Delimited Command Chaining
  // ==========================================================================
  describe('Area 2: Semicolon-Delimited Command Chaining', () => {
    it('EMP-SAN-SEMI-1: Blocks semicolon chaining after permitted command: "/tell Bob hi; /give @p diamond"', () => {
      const chained = [
        '/tell Bob hi; /give @p diamond',
        '/tell Bob hi;/give @p diamond',
        '/msg Alice howdy;   /tp 0 100 0',
        '/help; /op hacker',
      ];

      for (const c of chained) {
        const res = sanitizeMinecraftMessage(c);
        expect(res.isCommand).toBe(true);
        expect(res.allowed).toBe(false);
        expect(isPrivilegedCommand(c)).toBe(true);
        expect(() => assertAllowedMinecraftChat(c)).toThrow(PrivilegedCommandError);
      }
    });

    it('EMP-SAN-SEMI-2: Blocks semicolon chaining after benign chat without spaces: "hi;/op hacker"', () => {
      const tightChained = [
        'hi;/op hacker',
        'hello;/give @p diamond',
        'yo;/gamemode creative',
        'test;/stop',
        'gg;/kill @e',
      ];

      for (const tc of tightChained) {
        const res = sanitizeMinecraftMessage(tc);
        expect(res.isCommand).toBe(true);
        expect(res.allowed).toBe(false);
        expect(isPrivilegedCommand(tc)).toBe(true);
        expect(() => assertAllowedMinecraftChat(tc)).toThrow(PrivilegedCommandError);
      }
    });

    it('EMP-SAN-SEMI-3: Blocks chained commands with multiple semicolons and empty segments', () => {
      const multiSemi = [
        ';;;/stop;;;',
        'hi;;; /kill @e',
        ';/op hacker',
        'hi; ; ; /tp 0 0 0',
        '/tell Bob hi ;;; /gamemode 1 ;;; bye',
      ];

      for (const ms of multiSemi) {
        expect(isPrivilegedCommand(ms)).toBe(true);
        expect(() => assertAllowedMinecraftChat(ms)).toThrow(PrivilegedCommandError);
      }
    });

    it('EMP-SAN-SEMI-4: Blocks semicolon chaining with namespaced commands', () => {
      const namespaced = [
        'hi; /bukkit:op hacker',
        'hi;/minecraft:tp 0 0 0',
        'hi; /minecraft: give @p diamond',
        'hi;/spigot: gamemode 1',
      ];

      for (const ns of namespaced) {
        expect(isPrivilegedCommand(ns)).toBe(true);
        expect(() => assertAllowedMinecraftChat(ns)).toThrow(PrivilegedCommandError);
      }
    });

    it('EMP-SAN-SEMI-5: Blocks semicolon chaining with WorldEdit double-slash commands', () => {
      const weCmds = [
        'build; //wand',
        'clear; //cut',
        'hello;//set stone',
        'test; //copy',
      ];

      for (const we of weCmds) {
        expect(isPrivilegedCommand(we)).toBe(true);
        expect(() => assertAllowedMinecraftChat(we)).toThrow(PrivilegedCommandError);
      }
    });
  });

  // ==========================================================================
  // AREA 3: Unicode Line Separators (\u2028 and \u2029)
  // ==========================================================================
  describe('Area 3: Unicode Line Separators (\\u2028 and \\u2029)', () => {
    it('EMP-SAN-UNI-1: Blocks Unicode Line Separator (\\u2028) injection: "Hello world\\u2028/op Hacker"', () => {
      const u2028Inputs = [
        'Hello world\u2028/op Hacker',
        '/tell Bob hi\u2028/give @p diamond',
        '\u2028/stop',
        'Line 1\u2028Line 2\u2028/gamemode creative',
        'test\u2028/tp 100 64 100',
      ];

      for (const input of u2028Inputs) {
        const res = sanitizeMinecraftMessage(input);
        expect(res.isCommand, `Failed for ${JSON.stringify(input)}`).toBe(true);
        expect(res.allowed, `Failed for ${JSON.stringify(input)}`).toBe(false);
        expect(isPrivilegedCommand(input), `Failed for ${JSON.stringify(input)}`).toBe(true);
        expect(() => assertAllowedMinecraftChat(input)).toThrow(PrivilegedCommandError);
      }
    });

    it('EMP-SAN-UNI-2: Blocks Unicode Paragraph Separator (\\u2029) injection: "/tell Bob hi\\u2029/give @p diamond"', () => {
      const u2029Inputs = [
        'Hello world\u2029/op Hacker',
        '/tell Bob hi\u2029/give @p diamond',
        '\u2029/kill @e',
        'Line 1\u2029Line 2\u2029/gamemode 1',
        'test\u2029/minecraft:op hacker',
      ];

      for (const input of u2029Inputs) {
        const res = sanitizeMinecraftMessage(input);
        expect(res.isCommand, `Failed for ${JSON.stringify(input)}`).toBe(true);
        expect(res.allowed, `Failed for ${JSON.stringify(input)}`).toBe(false);
        expect(isPrivilegedCommand(input), `Failed for ${JSON.stringify(input)}`).toBe(true);
        expect(() => assertAllowedMinecraftChat(input)).toThrow(PrivilegedCommandError);
      }
    });

    it('EMP-SAN-UNI-3: Blocks mixed Unicode separators (\\u2028, \\u2029, \\r\\n, ;) with privileged payload', () => {
      const mixed = [
        'Hello\r\nworld\u2028/tell Alice hi\u2029/op hacker',
        'test\u2028; /give @p diamond\u2029done',
        '\u2028\u2029;\n\r/tp 0 0 0',
        'first\u2028second\u2029third; fourth\n/stop',
      ];

      for (const m of mixed) {
        expect(isPrivilegedCommand(m)).toBe(true);
        expect(() => assertAllowedMinecraftChat(m)).toThrow(PrivilegedCommandError);
      }
    });

    it('EMP-SAN-UNI-4: Blocks Unicode line separator combined with zero-width evasion', () => {
      const zwAndSep = [
        'Hello\u2028/\u200Bop hacker',
        'Hello\u2029/\u200Cgive @p diamond',
        'hi\u2028/\uFEFFgamemode 1',
        'hi\u2029/\u200Bg\u200Ci\u200Dv\u200Be @p gold',
      ];

      for (const input of zwAndSep) {
        expect(isPrivilegedCommand(input)).toBe(true);
        expect(() => assertAllowedMinecraftChat(input)).toThrow(PrivilegedCommandError);
      }
    });
  });

  // ==========================================================================
  // AREA 4: Purely Benign Multiline and Punctuation Messages (False Positive Defense)
  // ==========================================================================
  describe('Area 4: Purely Benign Multiline and Punctuation Messages', () => {
    it('EMP-SAN-BEN-1: Allows purely benign multiline chat messages without slashes across \\n, \\r\\n, \\r', () => {
      const benignMultiline = [
        'Hello world\nHow are you today?\nNice weather in Minecraft!',
        'First line\r\nSecond line\r\nThird line',
        'Roses are red\rViolets are blue\rMinecraft is great\rAnd so are you',
        'Line 1\n\nLine 2\n\n\nLine 3',
        'Building a stone castle on the hill\nNeed 64 cobblestone and 32 oak logs\nMeet me at coordinates 100, 64, 100',
      ];

      for (const msg of benignMultiline) {
        const res = sanitizeMinecraftMessage(msg);
        expect(res.isCommand, `Unexpected isCommand=true for "${msg}"`).toBe(false);
        expect(res.allowed, `Unexpected allowed=false for "${msg}"`).toBe(true);
        expect(isPrivilegedCommand(msg), `Unexpected isPrivilegedCommand=true for "${msg}"`).toBe(false);
        expect(assertAllowedMinecraftChat(msg)).toBe(msg.trim());
      }
    });

    it('EMP-SAN-BEN-2: Allows purely benign multiline chat messages separated by Unicode \\u2028 and \\u2029', () => {
      const benignUnicode = [
        'Line 1\u2028Line 2\u2028Line 3',
        'Paragraph 1\u2029Paragraph 2\u2029Paragraph 3',
        'Mixed\u2028Lines\u2029And\r\nParagraphs\nEverywhere',
      ];

      for (const msg of benignUnicode) {
        const res = sanitizeMinecraftMessage(msg);
        expect(res.isCommand).toBe(false);
        expect(res.allowed).toBe(true);
        expect(isPrivilegedCommand(msg)).toBe(false);
        expect(assertAllowedMinecraftChat(msg)).toBe(msg.trim());
      }
    });

    it('EMP-SAN-BEN-3: Allows benign chat containing semicolons without slashes', () => {
      const semicolonChat = [
        'Hello; how are you doing today?',
        'Wait; look over there; I see a creeper!',
        'for (let i = 0; i < 10; i++) { doSomething(); }',
        'Item 1; Item 2; Item 3',
        ';;; Just some punctuation ;;;',
      ];

      for (const msg of semicolonChat) {
        const res = sanitizeMinecraftMessage(msg);
        expect(res.isCommand).toBe(false);
        expect(res.allowed).toBe(true);
        expect(isPrivilegedCommand(msg)).toBe(false);
        expect(assertAllowedMinecraftChat(msg)).toBe(msg.trim());
      }
    });

    it('EMP-SAN-BEN-4: Allows chat containing embedded slashes inside words, fractions, or URLs', () => {
      const embeddedSlashChat = [
        'My win ratio is 10/20 in bedwars',
        'Check out https://minecraft.net/download',
        'Option A/B is currently available',
        'Speed is 5 km/h',
        'Either/or is totally fine with me',
      ];

      for (const msg of embeddedSlashChat) {
        const res = sanitizeMinecraftMessage(msg);
        expect(res.isCommand).toBe(false);
        expect(res.allowed).toBe(true);
        expect(isPrivilegedCommand(msg)).toBe(false);
        expect(assertAllowedMinecraftChat(msg)).toBe(msg.trim());
      }
    });

    it('EMP-SAN-BEN-5: Allows chat quoting or discussing commands without leading slashes', () => {
      const discussions = [
        'Hey everyone, did you know /op is permanently disabled on this server?',
        'The admin said: "/give is considered cheating here"\nSo we must mine everything ourselves!',
        'Do not ever use /tp or /gamemode; it ruins the game!',
        'Rule 1: No /kill\nRule 2: No /stop',
      ];

      for (const msg of discussions) {
        const res = sanitizeMinecraftMessage(msg);
        expect(res.isCommand).toBe(false);
        expect(res.allowed).toBe(true);
        expect(isPrivilegedCommand(msg)).toBe(false);
        expect(assertAllowedMinecraftChat(msg)).toBe(msg.trim());
      }
    });

    it('EMP-SAN-BEN-6: Allows multi-segment permitted non-privileged commands', () => {
      const permittedMulti = [
        'Hello everyone\n/tell Bob hi',
        '/tell Bob hi\n/tell Alice bye',
        '/tell Bob hi; /msg Alice yo',
        '/help 1\n/help 2',
        'Good day; /tell Bob see you tomorrow',
      ];

      for (const msg of permittedMulti) {
        const res = sanitizeMinecraftMessage(msg);
        expect(res.isCommand).toBe(true);
        expect(res.allowed).toBe(true);
        expect(isPrivilegedCommand(msg)).toBe(false);
        expect(() => assertAllowedMinecraftChat(msg)).not.toThrow();
      }
    });
  });

  // ==========================================================================
  // AREA 5: Comprehensive Fuzzing & Combinatorial Oracle Invariant Matrix
  // ==========================================================================
  describe('Area 5: Comprehensive Fuzzing & Combinatorial Oracle Invariant Matrix', () => {
    const delimiters = ['\n', '\r\n', '\r', ';', '\u2028', '\u2029'];
    const benignPrefixes = [
      'Hello world',
      'Good morning all',
      'Nice build here',
      'Let us mine some iron',
      'Hey Steve',
    ];
    const blockedCmdSamples = [
      'op hacker',
      'give @p diamond 64',
      'gamemode creative',
      'tp 100 64 100',
      'kill @e',
      'stop',
      'clear @a',
      'spectate Steve',
      'datapack disable vanilla',
      'summon wither',
    ];

    it('EMP-SAN-FUZ-1: Exhaustive combinatorial matrix across delimiters x prefixes x blocked commands', () => {
      let combinationsTested = 0;

      for (const delim of delimiters) {
        for (const prefix of benignPrefixes) {
          for (const cmd of blockedCmdSamples) {
            const attackString = `${prefix}${delim}/${cmd}`;
            const res = sanitizeMinecraftMessage(attackString);

            expect(res.isCommand, `Combinatorial evasion: "${attackString}"`).toBe(true);
            expect(res.allowed, `Combinatorial allowed=true: "${attackString}"`).toBe(false);
            expect(isPrivilegedCommand(attackString), `isPrivilegedCommand=false: "${attackString}"`).toBe(true);
            expect(() => assertAllowedMinecraftChat(attackString)).toThrow(PrivilegedCommandError);

            combinationsTested++;
          }
        }
      }

      // 6 delimiters * 5 prefixes * 10 blocked commands = 300 combinations
      expect(combinationsTested).toBe(300);
    });

    it('EMP-SAN-FUZ-2: High-volume randomized fuzzing (1000 iterations) verifying security invariants', () => {
      const blockedArray = Array.from(BLOCKED_COMMANDS);
      const safeWords = [
        'apple', 'bread', 'crafting', 'diamond_ore', 'emerald', 'furnace', 'gold', 'house',
        'iron_pickaxe', 'journey', 'kingdom', 'lava', 'mountain', 'nether_portal', 'ocean',
      ];

      for (let i = 0; i < 1000; i++) {
        const isAttack = Math.random() < 0.6; // 60% attacks, 40% benign messages
        const numSegments = Math.floor(Math.random() * 4) + 1; // 1 to 4 segments
        const segments: string[] = [];

        for (let s = 0; s < numSegments; s++) {
          const randWords = Array.from({ length: 3 }, () => safeWords[Math.floor(Math.random() * safeWords.length)]).join(' ');
          segments.push(randWords);
        }

        let injectedBlockedCmd: string | null = null;
        if (isAttack) {
          // Inject a blocked command at a random segment
          const injectIndex = Math.floor(Math.random() * numSegments);
          const randBlocked = blockedArray[Math.floor(Math.random() * blockedArray.length)];
          injectedBlockedCmd = randBlocked;

          // Randomize attack format (namespaced, extra spaces, mixed case)
          const formatType = Math.floor(Math.random() * 4);
          let cmdStr = randBlocked;
          if (formatType === 1) {
            cmdStr = `minecraft:${randBlocked}`;
          } else if (formatType === 2) {
            cmdStr = randBlocked.toUpperCase();
          } else if (formatType === 3) {
            cmdStr = `bukkit: ${randBlocked}`;
          }

          segments[injectIndex] = `/${cmdStr} @p`;
        }

        // Join segments using random delimiters
        let fullMessage = segments[0];
        for (let s = 1; s < segments.length; s++) {
          const randDelim = delimiters[Math.floor(Math.random() * delimiters.length)];
          fullMessage += `${randDelim}${segments[s]}`;
        }

        const res = sanitizeMinecraftMessage(fullMessage);

        if (isAttack) {
          // INVARIANT: Any message containing a blocked command MUST be blocked!
          expect(res.isCommand, `Fuzzer failure: attack missed for "${fullMessage}"`).toBe(true);
          expect(res.allowed, `Fuzzer failure: attack allowed for "${fullMessage}"`).toBe(false);
          expect(isPrivilegedCommand(fullMessage), `Fuzzer failure: isPrivilegedCommand false for "${fullMessage}"`).toBe(true);
          expect(() => assertAllowedMinecraftChat(fullMessage)).toThrow(PrivilegedCommandError);
        } else {
          // INVARIANT: Purely benign text segments (no leading slashes) MUST be allowed!
          expect(res.isCommand, `Fuzzer failure: false positive command detection for "${fullMessage}"`).toBe(false);
          expect(res.allowed, `Fuzzer failure: false positive blocking for "${fullMessage}"`).toBe(true);
          expect(isPrivilegedCommand(fullMessage), `Fuzzer failure: false positive privilege for "${fullMessage}"`).toBe(false);
          expect(assertAllowedMinecraftChat(fullMessage)).toBe(fullMessage.trim());
        }
      }
    });
  });
});
