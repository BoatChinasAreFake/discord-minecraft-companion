const assert = require('assert');

const BLOCKED_COMMANDS = new Set([
  // Teleportation / Movement cheats
  'tp', 'teleport', 'tphere', 's', 'tpa', 'tpaccept', 'warp', 'home', 'back', 'spawn',
  'fly', 'god', 'speed', 'heal', 'feed',
  // Item / Block cheats
  'give', 'i', 'item', 'setblock', 'fill', 'clone', 'replaceitem', 'loot',
  // World / Gamemode exploits
  'gamemode', 'gm', 'gamerule', 'difficulty', 'time', 'weather', 'seed', 'locate', 'locatebiome', 'defaultgamemode',
  // Entity / Combat manipulation
  'summon', 'kill', 'effect', 'enchant', 'attribute', 'damage', 'tag', 'data', 'scoreboard', 'team',
  // Administrative / Server management
  'op', 'deop', 'stop', 'kick', 'ban', 'ban-ip', 'pardon', 'pardon-ip', 'whitelist', 'reload', 'save-all', 'save-off', 'save-on', 'publish', 'debug',
  // Execution wrappers / Scripting
  'execute', 'function', 'advancement', 'recipe', 'experience', 'xp', 'bossbar', 'forceload', 'particle', 'playsound', 'stopsound', 'title', 'tellraw',
  // Additional vanilla OP commands
  'clear', 'spectate', 'datapack'
]);

class PrivilegedCommandError extends Error {
  constructor(command, reason) {
    super(`CommandSanitizer Blocked Privileged OP Command: "${command}" (${reason})`);
    this.name = 'PrivilegedCommandError';
  }
}

function sanitizeSingleSegment(segment) {
  const trimmed = segment.trim();
  if (!trimmed.startsWith('/')) {
    return { isCommand: false, allowed: true, cleanedText: trimmed };
  }

  // Reject malformed whitespace after leading slashes (e.g. '/  gamemode')
  if (/^\/+[\s\t]/.test(trimmed)) {
    return { isCommand: true, allowed: false, cleanedText: trimmed, reason: 'MALFORMED_COMMAND' };
  }

  const slashMatch = trimmed.match(/^\/+(.*)$/s);
  if (!slashMatch) {
    return { isCommand: false, allowed: true, cleanedText: trimmed };
  }

  const rest = slashMatch[1];
  if (!rest || rest.startsWith(':')) {
    return { isCommand: true, allowed: false, cleanedText: trimmed, reason: 'MALFORMED_COMMAND' };
  }

  // Check if first token contains a colon or matches namespace pattern
  let rootCommand;
  const firstWord = rest.split(/\s+/)[0];
  if (firstWord.includes(':') || rest.match(/^[a-zA-Z0-9_-]+:\s*/)) {
    const nsMatch = rest.match(/^([a-zA-Z0-9_-]+):\s*([a-zA-Z0-9_-]+)/i);
    if (!nsMatch) {
      return { isCommand: true, allowed: false, cleanedText: trimmed, reason: 'MALFORMED_COMMAND' };
    }
    rootCommand = nsMatch[2].toLowerCase();
  } else {
    const plainMatch = rest.match(/^([a-zA-Z0-9_-]+)/i);
    if (!plainMatch) {
      return { isCommand: true, allowed: false, cleanedText: trimmed, reason: 'MALFORMED_COMMAND' };
    }
    rootCommand = plainMatch[1].toLowerCase();
  }

  if (BLOCKED_COMMANDS.has(rootCommand)) {
    return {
      isCommand: true,
      allowed: false,
      commandName: rootCommand,
      cleanedText: trimmed,
      reason: `PRIVILEGED_OP_COMMAND_${rootCommand.toUpperCase()}`
    };
  }

  return {
    isCommand: true,
    allowed: true,
    commandName: rootCommand,
    cleanedText: trimmed
  };
}

function sanitizeMinecraftMessage(input) {
  if (!input || typeof input !== 'string') {
    return { isCommand: false, allowed: true, cleanedText: '' };
  }

  const normalized = input.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (normalized.length === 0) {
    return { isCommand: false, allowed: true, cleanedText: '' };
  }

  // Split into lines/command segments
  // Line separators: \r\n, \r, \n, \u2028, \u2029
  // Command separator: ;
  const segments = normalized.split(/(?:\r\n|[\r\n\u2028\u2029;])/).map(s => s.trim()).filter(Boolean);

  if (segments.length === 0) {
    return { isCommand: false, allowed: true, cleanedText: normalized };
  }

  let hasCommand = false;
  let firstAllowedCommand = undefined;

  for (const seg of segments) {
    const res = sanitizeSingleSegment(seg);
    if (res.isCommand) {
      hasCommand = true;
      if (!res.allowed) {
        // Any blocked or malformed command immediately fails the whole message
        return {
          isCommand: true,
          allowed: false,
          commandName: res.commandName,
          cleanedText: normalized,
          reason: res.reason
        };
      }
      if (!firstAllowedCommand && res.commandName) {
        firstAllowedCommand = res.commandName;
      }
    }
  }

  return {
    isCommand: hasCommand,
    allowed: true,
    commandName: firstAllowedCommand,
    cleanedText: normalized
  };
}

function assertAllowedMinecraftChat(message) {
  const result = sanitizeMinecraftMessage(message);
  if (result.isCommand && !result.allowed) {
    throw new PrivilegedCommandError(result.commandName || message, result.reason || 'DISALLOWED_COMMAND');
  }
  return result.cleanedText;
}

function isPrivilegedCommand(input) {
  const result = sanitizeMinecraftMessage(input);
  return result.isCommand && !result.allowed;
}

// ==========================================
// TEST SUITE EXECUTION
// ==========================================

console.log('Testing ADV-SAN-1...');
const caseVariants = [
  '/Tp', '/tP', '/TP',
  '/Give', '/gIvE', '/GIVE',
  '/GameMode', '/gamemode', '/GAMEMODE', '/gAmEmOdE',
  '/SetBlock', '/SETBLOCK', '/setBlock',
  '/Kill', '/KILL',
  '/Op', '/OP',
  '/Stop', '/STOP',
  '/Warp', '/WARP',
  '/Spawn', '/SPAWN',
  '/God', '/GOD',
  '/Fly', '/FLY',
];
for (const cmd of caseVariants) {
  assert.strictEqual(isPrivilegedCommand(`${cmd} player1`), true);
  assert.throws(() => assertAllowedMinecraftChat(`${cmd} player1`), PrivilegedCommandError);
}

console.log('Testing ADV-SAN-2...');
const paddedInputs = [
  '\t/tp 0 100 0',
  '  \t  /give @p diamond 64',
  '\r\n/gamemode 1',
  '\t\t\t/op hacker',
  '   /stop   ',
  '\n\n/kill @e\n',
];
for (const padded of paddedInputs) {
  assert.strictEqual(isPrivilegedCommand(padded), true);
}

console.log('Testing ADV-SAN-3...');
const spacedAttempts = [
  '/  gamemode  1',
  '/   tp 0 100 0',
  '/ \tgamemode creative',
  '/\t\tstop',
  '/   give @p diamond 64',
  '/   op hacker',
];
for (const attempt of spacedAttempts) {
  const res = sanitizeMinecraftMessage(attempt);
  assert.strictEqual(res.isCommand, true);
  assert.strictEqual(res.allowed, false);
  assert.strictEqual(res.reason, 'MALFORMED_COMMAND');
  assert.strictEqual(isPrivilegedCommand(attempt), true);
  assert.throws(() => assertAllowedMinecraftChat(attempt), PrivilegedCommandError);
}

console.log('Testing ADV-SAN-4...');
const injectedCommands = [
  '/\u200Btp Alice',
  '/\u200Cgive @p gold 64',
  '/\u200Dkill @e',
  '/\uFEFFgamemode 1',
  '/\u200B\u200Cop Hacker',
  '/\u200Bg\u200Ci\u200Dv\u200Be @p diamond 1',
];
for (const injected of injectedCommands) {
  assert.strictEqual(isPrivilegedCommand(injected), true);
}

console.log('Testing ADV-SAN-5...');
const prefixed = [
  '/minecraft:give @p diamond 64',
  '/minecraft:tp 100 64 100',
  '/minecraft:gamemode creative',
  '/minecraft:kill @e',
  '/bukkit:op hacker',
  '/spigot:gamemode 1',
  '/essentials:fly',
  '/worldedit:fill ~ ~ ~ ~5 ~5 ~5 air',
  '//give @p diamond',
  '///tp @p 0 0 0',
];
for (const cmd of prefixed) {
  assert.strictEqual(isPrivilegedCommand(cmd), true);
}

console.log('Testing ADV-SAN-6...');
const wrappers = [
  '/execute as @p run op hacker',
  '/execute in minecraft:the_nether run tp @s ~ ~ ~',
  '/function datapack:exploit',
  '/tellraw @a {"text":"malicious"}',
  '/xp add @s 100 levels',
  '/experience set @s 100',
  '/tag @s add admin',
  '/scoreboard players set @s points 999',
];
for (const w of wrappers) {
  assert.strictEqual(isPrivilegedCommand(w), true);
}

console.log('Testing ADV-SAN-7...');
const malformed = [
  '/',
  '//',
  '///',
  '/:',
  '/???',
  '/$',
  '/\u00A0tp',
];
for (const m of malformed) {
  const res = sanitizeMinecraftMessage(m);
  assert.strictEqual(res.isCommand, true);
  assert.strictEqual(res.allowed, false);
  assert.strictEqual(isPrivilegedCommand(m), true);
  assert.throws(() => assertAllowedMinecraftChat(m), PrivilegedCommandError);
}

console.log('Testing ADV-SAN-8...');
const safe1 = sanitizeMinecraftMessage('/tell Alice Hello there');
assert.strictEqual(safe1.isCommand, true);
assert.strictEqual(safe1.allowed, true);

const safe2 = sanitizeMinecraftMessage('/msg Bob I found a village');
assert.strictEqual(safe2.isCommand, true);
assert.strictEqual(safe2.allowed, true);

const safe3 = sanitizeMinecraftMessage('/help 2');
assert.strictEqual(safe3.isCommand, true);
assert.strictEqual(safe3.allowed, true);

const chat1 = 'Hey, why is /tp disabled on this server?';
const resChat1 = sanitizeMinecraftMessage(chat1);
assert.strictEqual(resChat1.isCommand, false);
assert.strictEqual(resChat1.allowed, true);

const chat2 = 'Admin said: "/give is cheating" so we mine legitimately';
const resChat2 = sanitizeMinecraftMessage(chat2);
assert.strictEqual(resChat2.isCommand, false);
assert.strictEqual(resChat2.allowed, true);

console.log('Testing FIX FOR VULN 1 (Namespace Space Evasion)...');
const evasions = [
  '/minecraft: give @p diamond 64',
  '/minecraft: tp 100 64 100',
  '/minecraft: gamemode creative',
  '/minecraft: op hacker',
  '/bukkit: op hacker',
];
for (const ev of evasions) {
  assert.strictEqual(isPrivilegedCommand(ev), true, `Failed on ${ev}`);
  assert.throws(() => assertAllowedMinecraftChat(ev), PrivilegedCommandError);
}

console.log('Testing FIX FOR VULN 2 (Multiline Command Evasion)...');
const chatWithOp = 'Good morning everyone!\n/op Hacker';
assert.strictEqual(isPrivilegedCommand(chatWithOp), true);
assert.throws(() => assertAllowedMinecraftChat(chatWithOp), PrivilegedCommandError);

const tellWithGive = '/tell Alice hello\n/give @p diamond 64';
assert.strictEqual(isPrivilegedCommand(tellWithGive), true);
assert.throws(() => assertAllowedMinecraftChat(tellWithGive), PrivilegedCommandError);

const multilineOpMid = 'Hello\nLine 2\n/gamemode creative\nLine 4';
assert.strictEqual(isPrivilegedCommand(multilineOpMid), true);
assert.throws(() => assertAllowedMinecraftChat(multilineOpMid), PrivilegedCommandError);

const semicolonGive = '/tell Alice hi; /give @p diamond 64';
assert.strictEqual(isPrivilegedCommand(semicolonGive), true);
assert.throws(() => assertAllowedMinecraftChat(semicolonGive), PrivilegedCommandError);

console.log('Testing FIX FOR VULN 3 (Missing OP commands)...');
assert.strictEqual(isPrivilegedCommand('/clear @a'), true);
assert.strictEqual(isPrivilegedCommand('/datapack disable vanilla'), true);
assert.strictEqual(isPrivilegedCommand('/spectate Steve'), true);

console.log('ALL TESTS PASSED SUCCESSFULLY!');
