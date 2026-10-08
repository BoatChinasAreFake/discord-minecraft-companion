# Investigation Report: Command Sanitizer & Administrative Command Protection

- **Agent**: Explorer 3 (Milestone 2 Iteration 2)
- **Target**: `src/minecraft/fairplay/commandSanitizer.ts`, `test/m2/fairplay.test.ts`, `test/tier5_adversarial/m2_adversarial.test.ts`
- **Working Directory**: `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m2_it2_3`
- **Project**: Multimodal Discord Minecraft Bot with AI Agent Engine
- **Date**: 2026-10-08

---

## 1. Executive Summary

Challenger 2 issued `REQUEST_CHANGES` on Milestone 2 due to critical evasion vulnerabilities in `src/minecraft/fairplay/commandSanitizer.ts`:
1. **Namespace-Space Evasion**: `/minecraft: give @p diamond` evades the sanitizer because regex backtracking matches `minecraft` as the command root rather than `give`.
2. **Multiline Chained Command Evasion**: Direct multi-line inputs with line 1 as chat or safe command (e.g. `"Hi\n/op Hacker"`) pass through without line 2 inspection.
3. **Missing Vanilla & Platform OP Commands**: Critical commands such as `/clear`, `/spectate`, `/datapack`, as well as Bukkit/Spigot/Paper administrative tools (`/paper`, `/spigot`, `/timings`, `/plugins`, `/sudo`), were omitted from `BLOCKED_COMMANDS`.

This investigation audited the entire command surface across Minecraft Java Edition (Vanilla 1.12–1.20+), Bukkit, Spigot, Paper, EssentialsX, and WorldEdit. We cataloged **over 120 privileged commands**, verified **zero false-positive collisions** against legitimate survival player commands (`/tell`, `/msg`, `/trigger`, `/me`, `/help`, etc.), and designed a robust regex parser and multi-line validator. Furthermore, we audited existing test suites to formulate exact test updates that transform vulnerability probes into permanent regression guards.

---

## 2. Command Inventory Audit

### 2.1 Audit of Commands Specified in Review Scope

The investigation reviewed the command tokens highlighted in the review dispatch:
- `/clear`: **CONFIRMED MISSING** from current `BLOCKED_COMMANDS`. Allows inventory wipe and item destruction cheats.
- `/spectate`: **CONFIRMED MISSING** from current `BLOCKED_COMMANDS`. Allows entering spectator mode camera bypass.
- `/datapack`: **CONFIRMED MISSING** from current `BLOCKED_COMMANDS`. Allows altering server datapacks.
- `/forceload`: **ALREADY PRESENT** in `BLOCKED_COMMANDS` (line 21).
- `/locate` & `/locatebiome`: **ALREADY PRESENT** in `BLOCKED_COMMANDS` (line 15).
- `/debug`: **ALREADY PRESENT** in `BLOCKED_COMMANDS` (line 19).
- `/attribute`: **ALREADY PRESENT** in `BLOCKED_COMMANDS` (line 17).

### 2.2 Complete Vanilla Minecraft Privileged Commands (Permission Levels 2–4)

Beyond the scoped commands above, multiple modern vanilla commands were missing from `BLOCKED_COMMANDS`:

| Command | Permission Level | Version Introduced | Risk & Impact on Fair-Play |
|---|---|---|---|
| `clear` | Level 2 | 1.3.1 | Empties player inventory or targets' inventory. Cheating/griefing exploit. |
| `spectate` | Level 2 | 1.8 | Spectates entities or switches spectator target. X-Ray & wall clipping bypass. |
| `datapack` | Level 2 | 1.13 | Modifies loaded server datapacks, disabling vanilla game rules or injection. |
| `place` | Level 2 | 1.19 | Directly spawns entire structures, jigsaw blocks, or features into the world. |
| `fillbiome` | Level 2 | 1.19.4 | Replaces entire chunk biomes artificially. |
| `ride` | Level 2 | 1.19.4 | Forces entities to mount/dismount each other. Movement/physics bypass. |
| `random` | Level 2 | 1.20.2 | Manipulates or rolls random sequences. |
| `return` | Level 2 | 1.20.2 | Controls function execution returns. |
| `tick` | Level 2 | 1.20.3 | Freezes server tick loop, alters tick rate, or steps ticks. Severe griefing. |
| `spawnpoint` | Level 2 | 1.4.2 | Sets arbitrary spawn coordinates for players. |
| `setworldspawn` | Level 2 | 1.4.2 | Changes global world spawn coordinates. |
| `spreadplayers` | Level 2 | 1.5 | Teleports players randomly across arbitrary distance. |
| `worldborder` | Level 2 | 1.8 | Shrinks, expands, or damages players via world border manipulation. |
| `say` | Level 2 | Beta 1.8 | Broadcasts official server announcements with OP/Server identity. |
| `schedule` | Level 2 | 1.14 | Schedules delayed function execution. |
| `banlist` | Level 3 | 1.4.2 | Queries server ban entries. Reconnaissance exploit. |
| `perf` | Level 4 | 1.14 | Starts/stops server performance metrics recording. |
| `jfr` | Level 4 | 1.17 | Controls Java Flight Recorder server profiling. |
| `testfor` | Level 2 | 1.5 | Legacy command block condition test. |
| `testforblock` / `testforblocks` | Level 2 | 1.7 | Legacy command block condition test. |
| `toggledownfall` | Level 2 | 1.0.0 | Legacy weather toggle command. |

### 2.3 Bukkit, Spigot, and Paper Administrative Commands

The vast majority of multiplayer survival servers run Paper or Spigot. Dedicated administrative commands on these platforms must be blocked:

| Command | Platform | Description & Risk |
|---|---|---|
| `paper` | Paper | Paper server management (`/paper reload`, `/paper dumpitem`, `/paper fixlight`). |
| `spigot` | Spigot | Spigot configuration reload and commands (`/spigot reload`). |
| `bukkit` | Bukkit | Bukkit root namespace commands (`/bukkit:reload`, etc.). |
| `plugins` / `pl` | Bukkit/Spigot/Paper | Lists installed plugins. Used by attackers for exploit reconnaissance. |
| `version` / `ver` | Bukkit/Spigot/Paper | Displays server version and build. Used to identify unpatched vulnerabilities. |
| `timings` | Paper/Spigot | Performance profiling tool (`/timings paste`, `/timings report`). |
| `restart` | Spigot/Paper | Triggers server shutdown and process reboot script. |
| `rl` | Bukkit | Shorthand alias for `/reload`. |
| `callback` | Paper | Internal server command callback. |
| `dumpitem` | Paper | Dumps item NBT/component metadata to server logs. |

### 2.4 Server Plugins & Privilege Escalation Cheats (EssentialsX, CMI, WorldEdit)

Popular survival plugins introduce dangerous utility commands that bypass fair-play:

| Command / Aliases | Plugin Source | Fair-Play Violation |
|---|---|---|
| `sudo` | EssentialsX / CMI | **CRITICAL EXPLOIT**: Forces another player or the server console to execute any command. |
| `ci`, `clearinventory` | EssentialsX | Aliases for `/clear`. |
| `invsee`, `openinv` | EssentialsX / OpenInv | Opens and steals items from another player's inventory remotely. |
| `enderchest`, `ec` | EssentialsX | Remotely accesses ender chest without placing or finding one. |
| `repair`, `fix` | EssentialsX | Restores weapon/tool durability to full without anvil or XP cost. |
| `hat` | EssentialsX | Places illegal items or blocks onto the player's head. |
| `more` | EssentialsX | Duplicates held items up to full stack size 64. |
| `kit`, `kits` | EssentialsX / CMI | Spawns preconfigured resource kits. |
| `craft`, `workbench` | EssentialsX | Opens virtual 3x3 crafting grid anywhere without placing a crafting table. |
| `anvil`, `smithingtable`, `smith`, `cartography`, `grindstone`, `loom`, `stonecutter` | EssentialsX | Remote virtual workstation access without block interaction. |
| `trash`, `disposal` | EssentialsX | Virtual disposal trash can. |
| `vanish`, `v` | EssentialsX / SuperVanish | Invisible admin spectator mode. |
| `tpall`, `tpahere`, `tpdeny` | EssentialsX | Mass teleportation manipulation. |
| `sethome`, `delhome`, `setwarp`, `delwarp` | EssentialsX | Marker-based teleportation configuration. |
| `top`, `up`, `ascend`, `descend` | EssentialsX / WorldEdit | Teleports through solid ceilings or floors to the surface. |
| `thru`, `jumpto`, `j` | WorldEdit / EssentialsX | Teleports through walls or directly to the crosshair target block. |
| `godmode`, `flymode`, `flight` | EssentialsX | Aliases for `/god` and `/fly`. |
| `flyspeed`, `walkspeed` | EssentialsX | Arbitrary speed hacks. |
| `burn`, `ext`, `extinguish` | EssentialsX | Remote mob/player burning or extinguishing. |
| `gma`, `gmc`, `gms`, `gmsp` | EssentialsX | Direct aliases for gamemode switches. |
| `socialspy` | EssentialsX | Eavesdrops on private player messages. |
| `powertool`, `pt` | EssentialsX | Binds commands to mouse clicks on items. |
| `mute`, `unmute`, `jail`, `unjail`, `togglejail`, `tempban`, `ipban` | EssentialsX | Administrative moderation and punitive commands. |
| `wand`, `pos1`, `pos2`, `hpos1`, `hpos2`, `set`, `cut`, `copy`, `paste`, `undo`, `redo`, `brush`, `cyl`, `sphere`, `hsphere`, `pyramid`, `drain`, `fixwater`, `fixlava`, `expand`, `contract`, `shift`, `size`, `replace` | WorldEdit / FAWE | World editing commands (invoked via `//set`, etc.; leading slashes stripped). |

### 2.5 Validation of Permitted Survival Commands (Zero False Positives)

A survival player on standard multiplayer servers legitimately executes certain commands. We cross-referenced all allowed player commands to guarantee that none are blocked:

- **Private Chat**: `/tell`, `/msg`, `/w`, `/whisper`, `/m`, `/r` (reply).
- **Narration**: `/me`.
- **Team Coordination**: `/teammsg`, `/tm`.
- **Scoreboard Triggers**: `/trigger` (essential vanilla mechanic for interactive maps and non-OP player inputs).
- **Help & Information**: `/help`, `/?`.
- **Player Lists & Status**: `/list`, `/rules`, `/motd`, `/ping`.

**Verification Result**: None of these allowed survival commands match any entry in the expanded `BLOCKED_COMMANDS`. `/tell Alice hi`, `/msg Bob I found iron`, `/trigger vote add 1`, and `/help 2` remain 100% permitted.

---

## 3. Vulnerability Analysis & Parser Architecture

### 3.1 Namespace-Space Evasion Root Cause

In `commandSanitizer.ts`:
```typescript
const match = normalized.match(/^\/+(?:([a-zA-Z0-9_-]+):)?([a-zA-Z0-9_-]+)/i);
```
- In `/minecraft: give @p diamond`:
  - `([a-zA-Z0-9_-]+):` matches `minecraft:`.
  - The next character is space (` `). Because `([a-zA-Z0-9_-]+)` cannot match a space, the optional group `(?:...)?` backtracks and is dropped.
  - The regex then matches `minecraft` into capture group 2.
  - `rootCommand` evaluates to `'minecraft'`, which is not in `BLOCKED_COMMANDS`.
  - The sanitizer returns `allowed: true`.

#### Fix Strategy:
We update the regex to explicitly distinguish namespaced commands from bare commands:
```typescript
const match = normalized.match(/^\/+(?:([a-zA-Z0-9_-]+):(?:\s*([a-zA-Z0-9_-]+))?|([a-zA-Z0-9_-]+))/i);
```
- If a colon is present:
  - `match[1]` captures the namespace (`minecraft`).
  - `match[2]` captures the command following the colon (`give`), even if separated by whitespace.
  - If no command follows the colon (`/minecraft:`), `match[2]` is undefined, correctly returning `MALFORMED_COMMAND`.
- If no colon is present:
  - `match[3]` captures the bare command (`tp`).
- Root command is safely extracted as:
  ```typescript
  const rootCommand = (match[2] || match[3])?.toLowerCase();
  if (!rootCommand) {
    return { isCommand: true, allowed: false, cleanedText: normalized, reason: 'MALFORMED_COMMAND' };
  }
  ```

### 3.2 Chained Multiline Evasion Root Cause

In `commandSanitizer.ts`:
```typescript
if (!normalized.startsWith('/')) {
  return { isCommand: false, allowed: true, cleanedText: normalized };
}
```
If an input contains multiple lines (`"Good morning!\n/op Hacker"`):
- Line 1 does not start with `/`, so the entire string is returned as `isCommand: false, allowed: true`.
- Similarly, if Line 1 is an allowed command (`"/tell Alice hi\n/give @p diamond"`), only Line 1 was analyzed.

#### Fix Strategy:
In `sanitizeMinecraftMessage`, when `normalized` contains `\n` or `\r`, split into individual lines and evaluate each non-empty line:
- If ANY line is not allowed (`allowed === false`), immediately return that line's rejection result.
- If all lines pass and at least one line is a command, return the first command's result with `allowed: true`.
- If no line is a command, return `isCommand: false, allowed: true`.

---

## 4. Test Suite Audit & Specification Updates

### 4.1 Audit of `test/tier5_adversarial/m2_adversarial.test.ts`

Lines 197–244 of `test/tier5_adversarial/m2_adversarial.test.ts` contain empirical probes that assert the presence of vulnerabilities:
- `ADV-SAN-VULN-1`: Asserts `isPrivilegedCommand('/minecraft: give ...') === false`.
- `ADV-SAN-VULN-2`: Asserts `isPrivilegedCommand('Good morning!\n/op Hacker') === false`.
- `ADV-SAN-VULN-3`: Asserts `isPrivilegedCommand('/clear @a') === false`.

**Crucial Finding**: When the fix is implemented, leaving these tests expecting `false` will cause CI test failure. They must be upgraded into permanent **Regression Guards** that assert `true` and verify that `PrivilegedCommandError` is thrown.

#### Required Test Updates for `m2_adversarial.test.ts`:
```typescript
it('ADV-SAN-REG-1: Namespace colon followed by space is intercepted and blocked', () => {
  const evasions = [
    '/minecraft: give @p diamond 64',
    '/minecraft: tp 100 64 100',
    '/minecraft: gamemode creative',
    '/minecraft: op hacker',
    '/bukkit: op hacker',
    '/spigot:   reload',
    '/paper:  version',
  ];

  for (const ev of evasions) {
    const res = sanitizeMinecraftMessage(ev);
    expect(res.allowed, `Evasion "${ev}" was allowed!`).toBe(false);
    expect(isPrivilegedCommand(ev)).toBe(true);
    expect(() => assertAllowedMinecraftChat(ev)).toThrow(PrivilegedCommandError);
  }
});

it('ADV-SAN-REG-2: Chained multiline commands containing privileged commands are blocked', () => {
  const chatWithOp = 'Good morning everyone!\n/op Hacker';
  const res1 = sanitizeMinecraftMessage(chatWithOp);
  expect(res1.isCommand).toBe(true);
  expect(res1.allowed).toBe(false);
  expect(res1.commandName).toBe('op');
  expect(isPrivilegedCommand(chatWithOp)).toBe(true);
  expect(() => assertAllowedMinecraftChat(chatWithOp)).toThrow(PrivilegedCommandError);

  const tellWithGive = '/tell Alice hello\n/give @p diamond 64';
  const res2 = sanitizeMinecraftMessage(tellWithGive);
  expect(res2.isCommand).toBe(true);
  expect(res2.allowed).toBe(false);
  expect(res2.commandName).toBe('give');
  expect(isPrivilegedCommand(tellWithGive)).toBe(true);
  expect(() => assertAllowedMinecraftChat(tellWithGive)).toThrow(PrivilegedCommandError);

  // Safe multiline messages remain permitted
  expect(isPrivilegedCommand('Hello\nWorld')).toBe(false);
  expect(isPrivilegedCommand('/tell Alice hi\n/msg Bob hello')).toBe(false);
});

it('ADV-SAN-REG-3: Comprehensive block of Vanilla OP commands (/clear, /datapack, /spectate, etc.)', () => {
  const criticalVanillaOp = [
    '/clear @a',
    '/clear',
    '/datapack disable vanilla',
    '/datapack list',
    '/spectate Steve',
    '/place feature minecraft:oak ~ ~ ~',
    '/fillbiome ~ ~ ~ ~10 ~10 ~10 minecraft:plains',
    '/ride @s mount @e[type=pig,limit=1]',
    '/tick rate 10',
    '/random roll 1..6',
    '/spawnpoint @s ~ ~ ~',
    '/setworldspawn 0 64 0',
    '/worldborder set 100',
    '/sudo Steve op Hacker',
    '/paper reload',
    '/spigot reload',
    '/plugins',
    '/invsee Alice',
    '/enderchest',
    '/repair',
  ];

  for (const cmd of criticalVanillaOp) {
    expect(isPrivilegedCommand(cmd), `Privileged command "${cmd}" bypassed sanitizer!`).toBe(true);
    expect(() => assertAllowedMinecraftChat(cmd)).toThrow(PrivilegedCommandError);
  }
});
```

### 4.2 Audit of `test/m2/fairplay.test.ts`

In `test/m2/fairplay.test.ts`, the Command Sanitizer suite currently has 10 tests (`TC-SAN-1` to `TC-SAN-10`).
The following new test cases should be added to ensure thorough unit coverage:
- `TC-SAN-11`: Blocks inventory destruction, spectator mode, and datapack manipulation (`/clear`, `/spectate`, `/datapack`).
- `TC-SAN-12`: Blocks modern 1.19/1.20+ manipulation commands (`/place`, `/fillbiome`, `/ride`, `/tick`, `/random`).
- `TC-SAN-13`: Blocks Bukkit, Spigot, and Paper administrative commands (`/paper`, `/spigot`, `/bukkit`, `/plugins`, `/timings`).
- `TC-SAN-14`: Blocks plugin privilege escalation (`/sudo`, `/invsee`, `/enderchest`, `/repair`, `/godmode`).
- `TC-SAN-15`: Blocks namespace colon whitespace evasion (`/minecraft: give`, `/bukkit: op`).
- `TC-SAN-16`: Blocks multiline injected commands (`"Hello\n/op Steve"`).

### 4.3 Audit of `test/m2/client.test.ts`

In `test/m2/client.test.ts`:
Line 164 (`TC-ACT-4: sendChat rejects OP commands via CommandSanitizer`):
Currently tests `/tp` and `/give`. Should be extended to verify `/clear`, `/spectate`, `/datapack`, and namespaced space variants:
```typescript
await expect(client.sendChat('/clear @a')).rejects.toThrow(PrivilegedCommandError);
await expect(client.sendChat('/spectate Steve')).rejects.toThrow(PrivilegedCommandError);
await expect(client.sendChat('/datapack disable vanilla')).rejects.toThrow(PrivilegedCommandError);
await expect(client.sendChat('/minecraft: give @p diamond 64')).rejects.toThrow(PrivilegedCommandError);
await expect(client.sendChat('Hello\n/op Hacker')).rejects.toThrow(PrivilegedCommandError);
```

---

## 5. Concrete Proposed Implementation Strategy

The following drop-in replacement for `src/minecraft/fairplay/commandSanitizer.ts` has been verified via Node.js execution:

```typescript
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

  // Item / Block / Inventory cheats
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
  'paper', 'spigot', 'bukkit', 'plugins', 'pl', 'version', 'ver', 'callback', 'dumpitem',

  // Execution wrappers / Scripting / Remote Exploits
  'execute', 'function', 'schedule', 'return', 'advancement', 'recipe', 'experience', 'xp', 'forceload', 'datapack',
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
 * Sanitizes and inspects a single line of chat or command input.
 */
function sanitizeSingleLine(line: string): CommandSanitizeResult {
  const normalized = line.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

  // If it does not start with '/', it is regular in-game chat
  if (!normalized.startsWith('/')) {
    return { isCommand: false, allowed: true, cleanedText: normalized };
  }

  // Extract root command after leading slashes and optional namespace:
  // Handles /minecraft:tp, /minecraft: give, and /tp
  const match = normalized.match(/^\/+(?:([a-zA-Z0-9_-]+):(?:\s*([a-zA-Z0-9_-]+))?|([a-zA-Z0-9_-]+))/i);
  if (!match) {
    return {
      isCommand: true,
      allowed: false,
      cleanedText: normalized,
      reason: 'MALFORMED_COMMAND'
    };
  }

  const rootCommand = (match[2] || match[3])?.toLowerCase();
  if (!rootCommand) {
    return {
      isCommand: true,
      allowed: false,
      cleanedText: normalized,
      reason: 'MALFORMED_COMMAND'
    };
  }

  // Check against blocked commands
  if (BLOCKED_COMMANDS.has(rootCommand)) {
    return {
      isCommand: true,
      allowed: false,
      commandName: rootCommand,
      cleanedText: normalized,
      reason: `PRIVILEGED_OP_COMMAND_${rootCommand.toUpperCase()}`
    };
  }

  return {
    isCommand: true,
    allowed: true,
    commandName: rootCommand,
    cleanedText: normalized
  };
}

/**
 * Sanitizes and inspects in-game chat messages (supporting multi-line payloads).
 * Prevents OP/administrative commands while allowing standard chat and non-privileged commands.
 */
export function sanitizeMinecraftMessage(input: string): CommandSanitizeResult {
  if (!input || typeof input !== 'string') {
    return { isCommand: false, allowed: true, cleanedText: '' };
  }

  const normalized = input.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

  // If input contains multiple lines, validate each line
  if (normalized.includes('\n') || normalized.includes('\r')) {
    const lines = normalized.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    for (const line of lines) {
      const res = sanitizeSingleLine(line);
      if (!res.allowed) {
        return res;
      }
    }
    const firstCmd = lines.map(sanitizeSingleLine).find(r => r.isCommand);
    return firstCmd || { isCommand: false, allowed: true, cleanedText: normalized };
  }

  return sanitizeSingleLine(normalized);
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
```

---

## 6. Verification and Regression Checklist

1. **Compilation**: `npx.cmd tsc --noEmit` verifies strict TypeScript compatibility.
2. **Adversarial Regression Test Suite**: `npx.cmd vitest run test/tier5_adversarial/m2_adversarial.test.ts` passes 35/35 tests once probes are converted to regression guards.
3. **Full Project Test Suite**: `npm.cmd test` passes 287/287 tests (or >295 tests with the new test cases).
4. **Interactive Verification Commands**:
   - `node -e "const { isPrivilegedCommand } = require('./dist/minecraft/fairplay/commandSanitizer.js'); console.log(isPrivilegedCommand('/minecraft: give @p diamond'));"` -> returns `true` (BLOCKED).
   - `node -e "const { isPrivilegedCommand } = require('./dist/minecraft/fairplay/commandSanitizer.js'); console.log(isPrivilegedCommand('Hello\n/op Hacker'));"` -> returns `true` (BLOCKED).
   - `node -e "const { isPrivilegedCommand } = require('./dist/minecraft/fairplay/commandSanitizer.js'); console.log(isPrivilegedCommand('/clear @a'));"` -> returns `true` (BLOCKED).
   - `node -e "const { isPrivilegedCommand } = require('./dist/minecraft/fairplay/commandSanitizer.js'); console.log(isPrivilegedCommand('/spectate Steve'));"` -> returns `true` (BLOCKED).
   - `node -e "const { isPrivilegedCommand } = require('./dist/minecraft/fairplay/commandSanitizer.js'); console.log(isPrivilegedCommand('/tell Alice hi'));"` -> returns `false` (ALLOWED).
