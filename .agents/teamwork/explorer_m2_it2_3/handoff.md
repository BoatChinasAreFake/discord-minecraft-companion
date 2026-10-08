# Handoff Report: Explorer 3 — Missing OP Commands & Command Sanitizer Vulnerability Remediation

- **Agent**: Explorer 3 (Milestone 2 Iteration 2)
- **Target**: Milestone 2 (`src/minecraft/fairplay/commandSanitizer.ts`, `test/m2/fairplay.test.ts`, `test/tier5_adversarial/m2_adversarial.test.ts`)
- **Working Directory**: `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m2_it2_3`
- **Parent**: `e026c1ee-5533-4b5b-93ce-229eafdae44b`
- **Handoff Type**: Hard (Investigation complete, actionable fix strategy ready for implementer)

---

## 1. Observation

### 1.1 Direct File Observations in `commandSanitizer.ts`
In `src/minecraft/fairplay/commandSanitizer.ts`:
- **Lines 8–22 (`BLOCKED_COMMANDS`)**:
  ```typescript
  export const BLOCKED_COMMANDS = new Set<string>([
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
    'execute', 'function', 'advancement', 'recipe', 'experience', 'xp', 'bossbar', 'forceload', 'particle', 'playsound', 'stopsound', 'title', 'tellraw'
  ]);
  ```
  - **Omission Verification**: `BLOCKED_COMMANDS.has('clear')` is `false`, `BLOCKED_COMMANDS.has('spectate')` is `false`, and `BLOCKED_COMMANDS.has('datapack')` is `false`.
  - **Presence Verification**: `forceload`, `locate`, `locatebiome`, `debug`, and `attribute` are confirmed present in lines 15, 17, 19, 21.
  - **Missing Modern Vanilla Commands**: `place`, `fillbiome`, `ride`, `tick`, `random`, `return`, `spawnpoint`, `setworldspawn`, `spreadplayers`, `worldborder`, `say`, `schedule`, `banlist`, `perf`, `jfr`, `testfor`, `toggledownfall` are missing.
  - **Missing Server Platform Administrative Commands**: `paper`, `spigot`, `bukkit`, `plugins`, `pl`, `version`, `ver`, `timings`, `restart`, `rl`, `callback`, `dumpitem` are missing.
  - **Missing Plugin Exploits**: `sudo` (command impersonation), `ci`, `invsee`, `enderchest`, `repair`, `hat`, `more`, `kit`, `craft`, `anvil`, `vanish`, `tpall`, etc., are missing.

- **Lines 49–60 (Regex Root Extraction)**:
  ```typescript
  const match = normalized.match(/^\/+(?:([a-zA-Z0-9_-]+):)?([a-zA-Z0-9_-]+)/i);
  if (!match) { ... }
  const rootCommand = match[2].toLowerCase();
  ```
  When tested against `/minecraft: give @p diamond 64`:
  - `match[1]` is `undefined`.
  - `match[2]` is `'minecraft'`.
  - `rootCommand` evaluates to `'minecraft'`, allowing the privileged command to bypass checks.

- **Lines 45–47 (Single-Line Chat Check)**:
  ```typescript
  if (!normalized.startsWith('/')) {
    return { isCommand: false, allowed: true, cleanedText: normalized };
  }
  ```
  When tested against `"Hello\n/op Hacker"`, line 1 is non-slash chat, causing the entire string to return `isCommand: false, allowed: true`.

### 1.2 Observations in Test Suites
- In `test/tier5_adversarial/m2_adversarial.test.ts` (lines 197–244):
  - Vulnerability probe tests `ADV-SAN-VULN-1`, `ADV-SAN-VULN-2`, and `ADV-SAN-VULN-3` currently assert `false` (e.g. `expect(isPrivilegedCommand('/clear @a')).toBe(false)`).
  - When the command sanitizer is fixed, these probes will fail unless updated to regression guards asserting `true` and expecting `PrivilegedCommandError`.
- In `test/m2/fairplay.test.ts` (lines 73–141):
  - Tests `TC-SAN-1` through `TC-SAN-10` cover basic OP commands (`/tp`, `/give`, `/gamemode`, `/op`) and safe commands (`/tell`, `/msg`), but do not verify `/clear`, `/spectate`, `/datapack`, platform administrative commands, or namespace-space evasion.
- In `test/m2/client.test.ts` (lines 164–167):
  - `TC-ACT-4` only tests `/tp` and `/give` via `client.sendChat()`.

---

## 2. Logic Chain

1. **Anti-Cheat Requirements**: Per `ORIGINAL_REQUEST.md` (R2) and `PROJECT.md` (F24, contract IMinecraftAgent), the Minecraft agent must strictly operate as a survival player without OP privileges. All outgoing chat passes through `assertAllowedMinecraftChat()`.
2. **Missing Commands Exploit Vector**: Because `clear`, `spectate`, and `datapack` are omitted from `BLOCKED_COMMANDS`, an attacker or LLM prompt can trigger inventory wipes (`/clear @a`), spectator noclip (`/spectate Steve`), or server modifications (`/datapack disable vanilla`) without raising `PrivilegedCommandError`.
3. **Platform Reconnaissance & Exploits**: In typical multiplayer environments (Paper/Spigot/Bukkit), missing commands like `/paper`, `/spigot`, `/timings`, `/plugins`, and `/version` allow reconnaissance of server software and installed plugins, while `/sudo` allows forcing other players to execute arbitrary commands.
4. **Namespace Regex Flaw**: In `/^\/+(?:([a-zA-Z0-9_-]+):)?([a-zA-Z0-9_-]+)/i`, the optional non-capturing group fails to match when a space follows the colon. The engine backtracks, drops the optional group, and captures the namespace token (`minecraft` or `bukkit`) as the command root. Because `minecraft` is not in `BLOCKED_COMMANDS`, `/minecraft: give` and `/bukkit: op` succeed.
5. **Multiline Bypass**: Checking only `normalized.startsWith('/')` allows line 2 commands (`"Hello\n/op Hacker"`) to bypass the sanitizer entirely when line 1 does not start with `/`.
6. **False-Positive Analysis**: Cross-referencing legitimate survival player commands (`tell`, `msg`, `w`, `whisper`, `m`, `r`, `me`, `teammsg`, `tm`, `trigger`, `help`, `list`, `rules`, `motd`, `ping`) against the expanded list of 125 blocked commands confirms 0 collisions. Legitimate communications remain completely unimpeded.
7. **Test Synchronicity**: If the implementation worker fixes the vulnerabilities without updating the probe assertions in `m2_adversarial.test.ts`, the test suite will break. Hence, updating `m2_adversarial.test.ts` to assert that these evasions are blocked is mandatory.

---

## 3. Caveats

- **Vanilla Server Parser Variations**: Some vanilla servers reject `/minecraft: give` as invalid syntax directly in their Brigadier dispatcher, whereas other custom plugin dispatchers or Spigot forks execute the subtoken `give`. The agent's client-side anti-cheat must reject it unconditionally, rather than relying on server-side dispatcher behavior.
- **Single-Letter Plugin Commands**: Commands like `/s` (Essentials summon/tphere) are blocked. `/m` (whisper) and `/r` (reply) are allowed. Single-letter WorldEdit/VoxelSniper brushes like `/b` were not included in `BLOCKED_COMMANDS` to prevent any potential conflict with custom chat channels; instead, full commands like `/brush` are blocked.
- **Read-Only Investigation Compliance**: Per explorer constraints, no project source code was edited during this investigation. Verification was conducted using offline Node.js test harnesses.

---

## 4. Conclusion

The command sanitizer in `src/minecraft/fairplay/commandSanitizer.ts` requires three key modifications:
1. **Expand `BLOCKED_COMMANDS`** with missing Vanilla commands (`clear`, `spectate`, `datapack`, `place`, `fillbiome`, `ride`, `tick`, `random`, `return`, `spawnpoint`, `setworldspawn`, `spreadplayers`, `worldborder`, `say`, `schedule`, `banlist`, `perf`, `jfr`), Bukkit/Spigot/Paper administrative commands (`paper`, `spigot`, `bukkit`, `plugins`, `pl`, `version`, `ver`, `timings`, `restart`, `rl`, `callback`, `dumpitem`), and server plugin cheats (`sudo`, `ci`, `invsee`, `enderchest`, `repair`, `hat`, `more`, `kit`, `craft`, `anvil`, `vanish`, `tpall`, etc.).
2. **Fix Namespace Regex**: Replace line 50 with:
   ```typescript
   const match = normalized.match(/^\/+(?:([a-zA-Z0-9_-]+):(?:\s*([a-zA-Z0-9_-]+))?|([a-zA-Z0-9_-]+))/i);
   const rootCommand = (match[2] || match[3])?.toLowerCase();
   ```
3. **Validate All Lines in Multi-Line Payloads**: In `sanitizeMinecraftMessage`, split on `\r?\n` and ensure every non-empty line satisfies the single-line sanitizer rules.
4. **Upgrade Adversarial Test Probes into Regression Guards**: In `test/tier5_adversarial/m2_adversarial.test.ts`, update `ADV-SAN-VULN-1`, `ADV-SAN-VULN-2`, and `ADV-SAN-VULN-3` to assert that evasions are blocked and throw `PrivilegedCommandError`.

---

## 5. Verification Method

To independently verify the investigation findings and test the proposed fix:

1. **Verify Current Behavior on Vulnerabilities (Reproduce Challenger 2 Findings)**:
   ```powershell
   node -e "const { isPrivilegedCommand } = require('./dist/minecraft/fairplay/commandSanitizer.js'); console.log('/clear @a is privileged:', isPrivilegedCommand('/clear @a')); console.log('/minecraft: give is privileged:', isPrivilegedCommand('/minecraft: give @p diamond')); console.log('multiline is privileged:', isPrivilegedCommand('Hi\n/op Hacker'));"
   ```
   *Expected Output (demonstrates existing gaps)*: All three currently return `false`.

2. **Verify Proposed Fix Logic**:
   Run the isolated test script validating the proposed regex and expanded command set:
   ```powershell
   node -e "
   const BLOCKED = new Set(['clear', 'spectate', 'datapack', 'paper', 'spigot', 'sudo', 'give', 'op', 'tp']);
   function check(s) {
     const norm = s.trim();
     const m = norm.match(/^\/+(?:([a-zA-Z0-9_-]+):(?:\s*([a-zA-Z0-9_-]+))?|([a-zA-Z0-9_-]+))/i);
     const root = (m && (m[2] || m[3])) ? (m[2] || m[3]).toLowerCase() : null;
     return root ? BLOCKED.has(root) : false;
   }
   console.log('/clear:', check('/clear @a'));
   console.log('/minecraft: give:', check('/minecraft: give @p diamond'));
   console.log('/paper reload:', check('/paper reload'));
   console.log('/sudo Steve op:', check('/sudo Steve op Hacker'));
   console.log('/tell Alice hi:', check('/tell Alice hi'));
   "
   ```
   *Expected Output*: `true`, `true`, `true`, `true`, `false`.

3. **Post-Implementation Regression Command**:
   After the implementer applies the changes, run:
   ```powershell
   npm.cmd test
   npm.cmd run build
   ```
   *Success Condition*: 100% test pass rate across all suites with 0 TypeScript compilation errors.
