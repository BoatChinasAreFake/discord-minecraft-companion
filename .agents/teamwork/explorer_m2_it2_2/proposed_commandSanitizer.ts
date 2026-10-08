export class PrivilegedCommandError extends Error {
  constructor(public readonly command: string, public readonly reason: string) {
    super(`CommandSanitizer Blocked Privileged OP Command: "${command}" (${reason})`);
    this.name = 'PrivilegedCommandError';
  }
}

export const BLOCKED_COMMANDS = new Set<string>([
  // Teleportation / Movement cheats
  'tp', 'teleport', 'tphere', 's', 'tpa', 'tpaccept', 'warp', 'home', 'back', 'spawn',
  'fly', 'god', 'speed', 'heal', 'feed',
  // Item / Block cheats
  'give', 'i', 'item', 'setblock', 'fill', 'clone', 'replaceitem', 'loot', 'clear',
  // World / Gamemode exploits
  'gamemode', 'gm', 'gamerule', 'difficulty', 'time', 'weather', 'seed', 'locate', 'locatebiome', 'defaultgamemode', 'spectate',
  // Entity / Combat manipulation
  'summon', 'kill', 'effect', 'enchant', 'attribute', 'damage', 'tag', 'data', 'scoreboard', 'team',
  // Administrative / Server management
  'op', 'deop', 'stop', 'kick', 'ban', 'ban-ip', 'pardon', 'pardon-ip', 'whitelist', 'reload', 'save-all', 'save-off', 'save-on', 'publish', 'debug', 'datapack',
  // Execution wrappers / Scripting
  'execute', 'function', 'advancement', 'recipe', 'experience', 'xp', 'bossbar', 'forceload', 'particle', 'playsound', 'stopsound', 'title', 'tellraw'
]);

export interface CommandSanitizeResult {
  isCommand: boolean;
  allowed: boolean;
  commandName?: string;
  cleanedText: string;
  reason?: string;
}

/**
 * Sanitizes and inspects a single line or command segment.
 */
function sanitizeSingleSegment(segment: string): CommandSanitizeResult {
  const trimmed = segment.trim();

  // If it does not start with '/', it is regular in-game chat
  if (!trimmed.startsWith('/')) {
    return { isCommand: false, allowed: true, cleanedText: trimmed };
  }

  // Reject malformed whitespace after leading slashes (e.g. '/  gamemode')
  if (/^\/+[\s\t]/.test(trimmed)) {
    return {
      isCommand: true,
      allowed: false,
      cleanedText: trimmed,
      reason: 'MALFORMED_COMMAND'
    };
  }

  const slashMatch = trimmed.match(/^\/+(.*)$/);
  if (!slashMatch) {
    return { isCommand: false, allowed: true, cleanedText: trimmed };
  }

  const rest = slashMatch[1];
  if (!rest || rest.startsWith(':')) {
    return {
      isCommand: true,
      allowed: false,
      cleanedText: trimmed,
      reason: 'MALFORMED_COMMAND'
    };
  }

  // Extract root command handling optional namespace and space after colon (e.g., /minecraft:tp, /minecraft: tp)
  let rootCommand: string;
  const firstWord = rest.split(/\s+/)[0];
  if (firstWord.includes(':') || rest.match(/^[a-zA-Z0-9_-]+:\s*/)) {
    const nsMatch = rest.match(/^([a-zA-Z0-9_-]+):\s*([a-zA-Z0-9_-]+)/i);
    if (!nsMatch) {
      return {
        isCommand: true,
        allowed: false,
        cleanedText: trimmed,
        reason: 'MALFORMED_COMMAND'
      };
    }
    rootCommand = nsMatch[2].toLowerCase();
  } else {
    const plainMatch = rest.match(/^([a-zA-Z0-9_-]+)/i);
    if (!plainMatch) {
      return {
        isCommand: true,
        allowed: false,
        cleanedText: trimmed,
        reason: 'MALFORMED_COMMAND'
      };
    }
    rootCommand = plainMatch[1].toLowerCase();
  }

  // Check against blocked commands
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

/**
 * Sanitizes and inspects in-game chat messages.
 * Prevents OP/administrative commands while allowing standard chat and regular non-privileged commands.
 * Handles multiline inputs and command separators, blocking if any segment contains a privileged command.
 */
export function sanitizeMinecraftMessage(input: string): CommandSanitizeResult {
  if (!input || typeof input !== 'string') {
    return { isCommand: false, allowed: true, cleanedText: '' };
  }

  // 1. Strip zero-width, BOM, and invisible unicode control characters
  const normalized = input.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (normalized.length === 0) {
    return { isCommand: false, allowed: true, cleanedText: '' };
  }

  // 2. Split into lines/command segments (\r\n, \r, \n, \u2028, \u2029, and ;)
  const segments = normalized.split(/(?:\r\n|[\r\n\u2028\u2029;])/).map((s) => s.trim()).filter(Boolean);

  if (segments.length === 0) {
    return { isCommand: false, allowed: true, cleanedText: normalized };
  }

  let hasCommand = false;
  let firstAllowedCommand: string | undefined = undefined;

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

/**
 * Asserts that a chat message or command is permitted under fair-play survival rules.
 * Throws PrivilegedCommandError if privileged.
 */
export function assertAllowedMinecraftChat(message: string): string {
  const result = sanitizeMinecraftMessage(message);
  if (result.isCommand && !result.allowed) {
    throw new PrivilegedCommandError(result.commandName || message, result.reason || 'DISALLOWED_COMMAND');
  }
  return result.cleanedText;
}

/**
 * Checks whether an input string is a privileged / prohibited command.
 */
export function isPrivilegedCommand(input: string): boolean {
  const result = sanitizeMinecraftMessage(input);
  return result.isCommand && !result.allowed;
}
