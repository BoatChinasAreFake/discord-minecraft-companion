export class PrivilegedCommandError extends Error {
  constructor(public readonly command: string, public readonly reason: string) {
    super(`CommandSanitizer Blocked Privileged OP Command: "${command}" (${reason})`);
    this.name = 'PrivilegedCommandError';
  }
}

export const BLOCKED_COMMANDS = new Set<string>([
  // Teleportation / Movement cheats
  'tp', 'teleport', 'tphere', 's', 'tpa', 'tpaccept', 'tpdeny', 'tpall', 'tpahere',
  'warp', 'warps', 'setwarp', 'delwarp', 'home', 'homes', 'sethome', 'delhome', 'back', 'spawn', 'setspawn',
  'spawnpoint', 'setworldspawn', 'spreadplayers',
  'fly', 'flymode', 'flight', 'god', 'godmode', 'speed', 'flyspeed', 'walkspeed', 'heal', 'feed',
  'top', 'up', 'ascend', 'descend', 'thru', 'jumpto', 'j',

  // Item / Block cheats
  'clear', 'ci', 'clearinventory',
  'give', 'i', 'item', 'setblock', 'fill', 'fillbiome', 'clone', 'replaceitem', 'loot', 'place', 'more',
  'repair', 'fix', 'hat', 'invsee', 'openinv', 'enderchest', 'ec',
  'craft', 'workbench', 'anvil', 'smithingtable', 'smith', 'cartography', 'cartographytable', 'grindstone', 'loom', 'stonecutter', 'trash', 'disposal',
  'kit', 'kits',

  // World / Gamemode exploits
  'gamemode', 'gm', 'gma', 'gmc', 'gms', 'gmsp', 'defaultgamemode', 'spectate',
  'gamerule', 'difficulty', 'time', 'weather', 'toggledownfall', 'seed', 'locate', 'locatebiome', 'worldborder', 'wb',
  'tick', 'random',

  // Entity / Combat manipulation
  'summon', 'kill', 'damage', 'effect', 'enchant', 'attribute', 'tag', 'data', 'scoreboard', 'team', 'bossbar', 'ride',
  'particle', 'playsound', 'stopsound', 'burn', 'ext', 'extinguish',

  // Administrative / Server management (Vanilla, Bukkit, Spigot, Paper)
  'op', 'deop', 'stop', 'restart', 'kick', 'ban', 'ban-ip', 'banlist', 'pardon', 'pardon-ip', 'unban', 'unban-ip',
  'tempban', 'ipban', 'mute', 'unmute', 'jail', 'unjail', 'togglejail', 'whitelist', 'reload', 'rl',
  'save-all', 'save-off', 'save-on', 'publish', 'debug', 'perf', 'jfr', 'timings',
  'paper', 'spigot', 'bukkit', 'plugins', 'pl', 'version', 'ver', 'callback', 'dumpitem', 'datapack',

  // Execution wrappers / Scripting / Remote Exploits
  'execute', 'function', 'schedule', 'return', 'advancement', 'recipe', 'experience', 'xp', 'forceload',
  'title', 'tellraw', 'say', 'sudo', 'socialspy', 'powertool', 'pt',
  'testfor', 'testforblock', 'testforblocks',

  // WorldEdit / FAWE
  'wand', 'pos1', 'pos2', 'hpos1', 'hpos2', 'set', 'cut', 'copy', 'paste', 'undo', 'redo',
  'brush', 'cyl', 'sphere', 'hsphere', 'pyramid', 'drain', 'fixwater', 'fixlava', 'expand', 'contract', 'shift', 'size', 'replace'
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

  // Reject malformed whitespace after leading slashes (e.g. '/  gamemode', '/\tgamemode', '/\u00A0tp')
  if (/^\/+[\s\t\u00A0]/.test(trimmed)) {
    return {
      isCommand: true,
      allowed: false,
      cleanedText: trimmed,
      reason: 'MALFORMED_COMMAND'
    };
  }

  const slashMatch = trimmed.match(/^\/+(.*)$/s);
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

  // Two-phase deterministic tokenization:
  // Phase 1: Check for namespace syntax: <identifier> followed optionally by whitespace and colon
  // (e.g., "minecraft:give", "minecraft: give", "minecraft :give", "bukkit: op")
  let rootCommand: string;
  const colonMatch = rest.match(/^([a-zA-Z0-9_-]+)\s*:(.*)$/s);

  if (colonMatch) {
    const afterColon = colonMatch[2].trimStart();
    const cmdMatch = afterColon.match(/^([a-zA-Z0-9_-]+)/);
    if (!cmdMatch) {
      return {
        isCommand: true,
        allowed: false,
        cleanedText: trimmed,
        reason: 'MALFORMED_COMMAND'
      };
    }
    rootCommand = cmdMatch[1].toLowerCase();
  } else {
    // Phase 2: Bare command extraction
    const plainMatch = rest.match(/^([a-zA-Z0-9_-]+)/);
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
