# Handoff Report: Milestone 2 Adversarial Challenge & Stress Verification

- **Author**: Challenger 2 (Empirical Challenger: Critic / Specialist)
- **Target**: Milestone 2 (Minecraft Fair-Play Survival Engine)
- **Working Directory**: `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\challenger_m2_2`
- **Scope**: Command Sanitizer (`src/minecraft/fairplay/commandSanitizer.ts`), Combat Cooldown & Shield Mechanics (`src/minecraft/actions/combat.ts`), Survival Loops (`src/minecraft/loops/*.ts`).
- **Verdict**: **REQUEST_CHANGES**

---

## 1. Observation

### Observation 1.1: Namespace Space Evasion in `commandSanitizer.ts`
In `src/minecraft/fairplay/commandSanitizer.ts` (lines 49-60):
```typescript
  // 3. Extract root command after leading slashes and optional namespace (e.g., /minecraft:tp, //give)
  const match = normalized.match(/^\/+(?:([a-zA-Z0-9_-]+):)?([a-zA-Z0-9_-]+)/i);
  if (!match) {
    return {
      isCommand: true,
      allowed: false,
      cleanedText: normalized,
      reason: 'MALFORMED_COMMAND'
    };
  }

  const rootCommand = match[2].toLowerCase();
```
When executed against input with a space or tab immediately following the namespace colon (e.g., `"/minecraft: give @p diamond 64"`):
- Command executed:
  ```bash
  node -e "const { sanitizeMinecraftMessage, isPrivilegedCommand, assertAllowedMinecraftChat } = require('./dist/minecraft/fairplay/commandSanitizer.js'); console.log(sanitizeMinecraftMessage('/minecraft: give @p diamond')); console.log('isPrivileged:', isPrivilegedCommand('/minecraft: give @p diamond')); console.log('assert:', assertAllowedMinecraftChat('/minecraft: give @p diamond'));"
  ```
- Tool output:
  ```json
  {
    "isCommand": true,
    "allowed": true,
    "commandName": "minecraft",
    "cleanedText": "/minecraft: give @p diamond"
  }
  isPrivileged: false
  assert: /minecraft: give @p diamond
  ```
- Verbatim comparison:
  * Contiguous namespace `/minecraft:give` returns `isPrivileged: true` (BLOCKED).
  * Space-padded namespace `/minecraft: give` returns `isPrivileged: false` (ALLOWED, does NOT throw `PrivilegedCommandError`).
  * `/minecraft: tp 100 64 100` returns `isPrivileged: false` (ALLOWED).
  * `/minecraft: gamemode 1` returns `isPrivileged: false` (ALLOWED).
  * `/bukkit: op hacker` returns `isPrivileged: false` (ALLOWED).

### Observation 1.2: Chained Multiline Command Evasion in `commandSanitizer.ts`
In `src/minecraft/fairplay/commandSanitizer.ts` (lines 45-50):
```typescript
  // 2. If it does not start with '/', it is regular in-game chat
  if (!normalized.startsWith('/')) {
    return { isCommand: false, allowed: true, cleanedText: normalized };
  }
```
When a multi-line string is passed directly to `sanitizeMinecraftMessage`:
- If line 1 does not start with `/`:
  * `"Good morning!\n/op Hacker"` -> `isCommand: false, allowed: true` (`isPrivilegedCommand` returns `false`).
- If line 1 is a permitted command:
  * `"/tell Alice hi\n/give @p diamond 64"` -> `commandName: 'tell', allowed: true` (`isPrivilegedCommand` returns `false`).

### Observation 1.3: Omission of Critical Vanilla OP Commands in `BLOCKED_COMMANDS`
In `src/minecraft/fairplay/commandSanitizer.ts` (lines 8-22), `BLOCKED_COMMANDS` defines blocked sets for cheats and admin commands:
- `/clear` (inventory wipe cheat) is missing: `isPrivilegedCommand('/clear @a') === false`.
- `/spectate` (gamemode spectator bypass) is missing: `isPrivilegedCommand('/spectate Steve') === false`.
- `/datapack` (server management) is missing: `isPrivilegedCommand('/datapack disable vanilla') === false`.

### Observation 1.4: Empirical Robustness of Combat Cooldown & Shield Mechanics
In `src/minecraft/actions/combat.ts`:
- `cooldown.getCooldownPeriodMs`:
  * `diamond_sword`: 625ms (1.6 atk/s)
  * `netherite_axe`: 1000ms (1.0 atk/s)
  * `iron_axe`: 1111ms (0.9 atk/s)
  * `stone_axe`: 1250ms (0.8 atk/s)
  * `diamond_pickaxe`: 833ms (1.2 atk/s)
  * `iron_shovel`: 1000ms (1.0 atk/s)
  * Bare hand / generic: 250ms (4.0 atk/s)
- Cooldown gauge enforcement (`awaitFullGauge`):
  * When attack is invoked at 0ms, gauge requires 625ms for sword. Calling `awaitFullGauge('diamond_sword')` pauses until the 625ms window expires (verified: elapsed wait time in `ADV-CBT-2` is 629ms).
  * Subsequent invocation when gauge is 100% full returns 0ms immediately without delay.
- Shield lifecycle during melee attack:
  * Offhand holding shield: `bot.deactivateItem()` lowers shield before swing, `bot.attack(entity)` strikes, and `bot.activateItem(true)` re-raises shield immediately.
  * Offhand holding non-shield (e.g., torch): `bot.activateItem` is not invoked.
- Tactical retreat threshold:
  * Health < 6.0 HP (e.g. 5.9 HP) triggers `executeRetreat()`: enables sprint + back, computes inverse-square repulsion vector from entities within 16m, and pathfinds to safe coordinates (`ADV-CBT-6`).
  * Health >= 6.0 HP (e.g. 6.0 HP) allows regular attack execution.
- Attack reach threshold:
  * Entity distance to eye <= 3.50m passes (`ADV-CBT-7`).
  * Entity distance to eye > 3.50m (e.g. 4.0m) returns `{ success: false, message: 'out of attack reach' }`.

### Observation 1.5: Empirical Robustness of Survival Loops
In `src/minecraft/loops/*.ts`:
- `AutoEatLoop` (`autoEat.ts`):
  * Poison blacklist (`pufferfish`, `spider_eye`, `poisonous_potato`, `chorus_fruit`, `suspicious_stew`): `selectBestFood()` returns `null` even at starvation food=1 and critical health=2 (`ADV-EAT-1`).
  * Conditional food (`rotten_flesh`, `raw_chicken`): rejected when food >= 7, but permitted when food <= 6 (`ADV-EAT-2`).
  * Golden Apple emergency threshold: at health <= 10 HP, receives +50 bonus and is selected over cooked beef; at health >= 11 HP, cooked beef is chosen (`ADV-EAT-3`).
  * Enchanted Golden Apple emergency threshold: at health <= 6 HP, receives +100 bonus and is consumed; at health >= 7 HP, regular golden apple is consumed to conserve the enchanted apple (`ADV-EAT-4`).
  * Hostile mob proximity (< 4.0m): eating is deferred when health > 8.0 HP, but permitted when health <= 8.0 HP (survival reflex) (`ADV-EAT-5`).
  * Anti-thrashing debounce: rapid eating attempts within 500ms are debounced (`ADV-EAT-6`).
- `AutoSleepLoop` (`autoSleep.ts`):
  * Vanilla Monster Exclusion AABB (`8.0m horizontal, 5.0m vertical`):
    - Hostile mob at dx = 7.9m blocks sleeping (`isMonsterNearby === true`, `ADV-SLP-1`).
    - Hostile mob at dx = 8.1m permits sleeping (`isMonsterNearby === false`, `ADV-SLP-1`).
    - Hostile mob at dy = 4.9m blocks sleeping; at dy = 5.1m permits sleeping (`ADV-SLP-2`).
    - Passive mobs (sheep, cows, villagers) at 1-2m do NOT block sleeping (`ADV-SLP-3`).
  * Dimension safety: `the_nether` and `the_end` reject sleeping to prevent bed explosion (`ADV-SLP-4`).
  * Weather override: midday (time 6000) permits sleeping during active thunderstorm (`ADV-SLP-5`).
- `AutoEquipLoop` (`autoEquip.ts`):
  * Material tiers: Netherite (6) > Diamond (5) > Iron (4) > Chainmail (3) > Golden/Turtle (2) > Leather (1) (`ADV-EQP-1`).
  * Durability ratio: Pristine armor piece is selected over 95% worn piece due to durability ratio overcoming the 1.0 hysteresis threshold (`ADV-EQP-2`).
  * Weapon DPS calculation: Sharpness V Iron Sword (score 98) beats plain Diamond Sword (score 80) (`ADV-EQP-4`).
  * Offhand priority: Totem of Undying (score 100) > Shield (score 80) > Other items (score 10) (`ADV-EQP-5`).
  * Anti-thrashing hysteresis: Gear with identical score does not flap or re-equip (`ADV-EQP-6`).

---

## 2. Logic Chain

1. **Premise 1 (Anti-Cheat Invariant)**: Per `ORIGINAL_REQUEST.md` R2 and `PROJECT.md` F24, the agent must strictly operate as a regular survival player and block all privileged server commands (`/tp`, `/give`, `/gamemode`, etc.).
2. **Step 2 (Regex Matching Defect)**: In `commandSanitizer.ts` line 50, the regex `/^\/+(?:([a-zA-Z0-9_-]+):)?([a-zA-Z0-9_-]+)/i` defines the namespace prefix as an optional group `(?:...:)?` followed by the command name `([a-zA-Z0-9_-]+)`. When an input has whitespace after the colon (e.g. `"/minecraft: give"`), the regex engine cannot match the combined pattern `minecraft:give`. Instead of rejecting the whitespace or capturing `give` as the command, regex backtracking drops the optional namespace group entirely and matches `minecraft` into the command capture group `match[2]`.
3. **Step 3 (Sanitizer Bypass)**: `rootCommand` is set to `match[2].toLowerCase()`, which evaluates to `"minecraft"`. Because `"minecraft"` is not an entry in `BLOCKED_COMMANDS`, `sanitizeMinecraftMessage` determines the command is permitted (`allowed: true`). Consequently, `isPrivilegedCommand` returns `false` and `assertAllowedMinecraftChat` does not throw `PrivilegedCommandError`.
4. **Step 4 (Blast Radius Assessment)**: Any malicious user or subverted AI prompt can execute blocked OP commands by simply prefixing them with `/minecraft: ` (e.g. `/minecraft: give @p diamond 64`, `/minecraft: tp 0 100 0`, `/minecraft: gamemode 1`).
5. **Step 5 (Multiline Evasion Vector)**: In `commandSanitizer.ts`, checking only `normalized.startsWith('/')` on line 45 causes multiline strings with line 1 as chat (e.g. `"Hi\n/op Hacker"`) to be marked as `isCommand: false, allowed: true`, allowing the privileged command on subsequent lines to pass through the sanitizer unchecked.
6. **Step 6 (Combat & Loops Assessment)**: Conversely, the combat cooldown controller (1.9+ attack speeds, shield raise/lower cycle, retreat below 6 HP) and survival loops (autoEat poison blacklist, golden apple health thresholds, autoSleep 7.9m vs 8.1m AABB exclusion, and autoEquip composite defense scoring) are implemented with high precision and passed all 35 adversarial stress tests.
7. **Step 7 (Verdict Derivation)**: Because the command sanitizer fails to prevent the namespace-space evasion vector and allows OP commands to bypass anti-cheat checks, the Milestone 2 implementation cannot be approved as-is.

---

## 3. Caveats

- **ChatBridge Mitigation**: When messages originate from Discord text channels, `antiLoopback.sanitizeForMinecraft` converts `[\r\n\t]+` to single spaces. This mitigates multiline injection from Discord chat, but direct callers of `IMinecraftAgent.sendChat()` or internal tool calls bypassing the bridge remain exposed to multiline and namespace-space evasions.
- **Vanilla Server Behavior on Namespace Space**: Depending on the specific Minecraft server implementation (vanilla vs Paper/Spigot), `/minecraft: give` may be treated as invalid syntax by vanilla dispatcher or parsed by lenient plugin dispatchers. Regardless of server parser behavior, the agent's client-side Fair-Play Anti-Cheat layer must reject it rather than certifying it as `allowed: true`.
- **Review-Only Constraint**: In accordance with the Challenger constraints, no implementation code in `src/minecraft/` was modified. All findings are verified by unit tests in `test/tier5_adversarial/m2_adversarial.test.ts`.

---

## 4. Conclusion

**Verdict: REQUEST_CHANGES**

The Milestone 2 Combat Cooldown and Survival Loops subsystems are robust, highly compliant with vanilla Minecraft 1.9+ mechanics, and pass all edge-case boundary checks. However, **`src/minecraft/fairplay/commandSanitizer.ts` contains a critical regex evasion vulnerability** that permits privileged OP commands when a space follows a namespace colon (e.g., `/minecraft: give @p diamond 64`), as well as multiline evasion vectors and omitted OP commands (`/clear`, `/spectate`, `/datapack`).

### Required Changes for Implementation Worker:
1. **Fix Namespace Regex in `src/minecraft/fairplay/commandSanitizer.ts`**:
   Ensure that any colon following leading slashes is strictly part of the namespace syntax and that whitespace following a colon either parses the subsequent token as the root command or is rejected as `MALFORMED_COMMAND`. For example:
   ```typescript
   // Option A: Support optional whitespace but extract the actual command after the colon:
   const match = normalized.match(/^\/+(?:([a-zA-Z0-9_-]+):\s*)?([a-zA-Z0-9_-]+)/i);
   ```
   Or Option B: Reject any command where a colon is followed by whitespace as `MALFORMED_COMMAND`.
2. **Add Multiline Command Detection in `src/minecraft/fairplay/commandSanitizer.ts`**:
   Inspect all lines in multiline inputs. If any line starts with `/`, validate it through `sanitizeMinecraftMessage`, or strip/replace `\r` and `\n` in `normalized`.
3. **Expand `BLOCKED_COMMANDS`**:
   Add `'clear'`, `'spectate'`, and `'datapack'` to `BLOCKED_COMMANDS`.

---

## 5. Verification Method

To independently reproduce and verify all observations and test results:

1. **Run the Milestone 2 Adversarial Stress Suite**:
   ```powershell
   npx.cmd vitest run test/tier5_adversarial/m2_adversarial.test.ts
   ```
   All 35 tests (including vulnerability probes `ADV-SAN-VULN-1`, `ADV-SAN-VULN-2`, and `ADV-SAN-VULN-3`) will execute.

2. **Run Interactive Evasion Proof Commands**:
   ```powershell
   # Proves namespace space evasion bypasses sanitizer:
   node -e "const { isPrivilegedCommand, sanitizeMinecraftMessage } = require('./dist/minecraft/fairplay/commandSanitizer.js'); console.log('Bypass /minecraft: give -> isPrivileged:', isPrivilegedCommand('/minecraft: give @p diamond 64')); console.log('Result:', sanitizeMinecraftMessage('/minecraft: give @p diamond 64'));"
   
   # Proves multiline command bypass:
   node -e "const { isPrivilegedCommand } = require('./dist/minecraft/fairplay/commandSanitizer.js'); console.log('Bypass multiline -> isPrivileged:', isPrivilegedCommand('Hello\n/op Hacker'));"
   ```

3. **Run Entire Project Test Suite & Build**:
   ```powershell
   npm.cmd test
   npm.cmd run build
   ```
   Ensures 100% test pass rate (287/287 tests passing across 21 test files) and 0 TypeScript compilation errors.
