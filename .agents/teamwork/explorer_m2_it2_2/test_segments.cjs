const { BLOCKED_COMMANDS } = require('../../../dist/minecraft/fairplay/commandSanitizer.js');

// Current implementation
function currentSanitize(input) {
  if (!input || typeof input !== 'string') {
    return { isCommand: false, allowed: true, cleanedText: '' };
  }
  const normalized = input.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (!normalized.startsWith('/')) {
    return { isCommand: false, allowed: true, cleanedText: normalized };
  }
  const match = normalized.match(/^\/+(?:([a-zA-Z0-9_-]+):)?([a-zA-Z0-9_-]+)/i);
  if (!match) {
    return { isCommand: true, allowed: false, cleanedText: normalized, reason: 'MALFORMED_COMMAND' };
  }
  const rootCommand = match[2].toLowerCase();
  if (BLOCKED_COMMANDS.has(rootCommand)) {
    return { isCommand: true, allowed: false, commandName: rootCommand, cleanedText: normalized, reason: `PRIVILEGED_OP_COMMAND_${rootCommand.toUpperCase()}` };
  }
  return { isCommand: true, allowed: true, commandName: rootCommand, cleanedText: normalized };
}

// Proposed implementation
const EXPANDED_BLOCKED_COMMANDS = new Set([
  ...BLOCKED_COMMANDS,
  'clear', 'spectate', 'datapack'
]);

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

  if (EXPANDED_BLOCKED_COMMANDS.has(rootCommand)) {
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

function proposedSanitize(input) {
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

const testCases = [
  'Good morning everyone!\n/op Hacker',
  '/tell Alice hi\n/give @p diamond 64',
  '/tell Alice hi; /give @p diamond 64',
  '/tell Alice hi;/op hacker',
  'Hello world; how are you?',
  'Does anyone know why /tp is disabled on this survival server?',
  'Admin said: "/give is cheating" so we mine legitimately',
  '/tell Alice hello; how are you doing?',
  '\t/tp 0 100 0',
  '\r\n/gamemode 1',
  '/  gamemode  1',
  '/\u200Btp Alice',
  '/minecraft:give @p diamond 64',
  '/minecraft: give @p diamond 64',
  '/minecraft:   ',
  '/clear @a',
  '/datapack disable vanilla',
  '/spectate Steve',
  '/execute as @p run op hacker',
  '/',
  '//',
  '/tell Alice Hello there',
  '/msg Bob I found a village',
  '/help 2',
  'Hello\nWorld\nFoo',
  'Hello\n   /op Hacker',
  '   \n\n   '
];

for (const tc of testCases) {
  const cur = currentSanitize(tc);
  const prop = proposedSanitize(tc);
  console.log('--- TEST CASE:', JSON.stringify(tc));
  console.log('  Current : isCmd=' + cur.isCommand + ', allowed=' + cur.allowed + ', cmd=' + cur.commandName + ', reason=' + cur.reason);
  console.log('  Proposed: isCmd=' + prop.isCommand + ', allowed=' + prop.allowed + ', cmd=' + prop.commandName + ', reason=' + prop.reason);
}
