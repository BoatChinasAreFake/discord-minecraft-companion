# Handoff Report: Multiline Command Evasion Investigation & Fix Strategy

- **Sender**: Explorer 2 (Milestone 2 Iteration 2)
- **Recipient**: Parent Agent (`e026c1ee-5533-4b5b-93ce-229eafdae44b`) / Worker Implementer
- **Working Directory**: `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m2_it2_2`
- **Scope**: Multiline Command Evasion in `src/minecraft/fairplay/commandSanitizer.ts`
- **Deliverables**: `report.md`, `proposed_commandSanitizer.ts`, `test_all_adversarial.cjs`, `handoff.md`

---

## 1. Observation

### Observation 1.1: Single-Line Regex and Prefix Checks in `commandSanitizer.ts`
In `src/minecraft/fairplay/commandSanitizer.ts`:
- Line 45:
  ```typescript
  // 2. If it does not start with '/', it is regular in-game chat
  if (!normalized.startsWith('/')) {
    return { isCommand: false, allowed: true, cleanedText: normalized };
  }
  ```
- Line 50:
  ```typescript
  // 3. Extract root command after leading slashes and optional namespace (e.g., /minecraft:tp, //give)
  const match = normalized.match(/^\/+(?:([a-zA-Z0-9_-]+):)?([a-zA-Z0-9_-]+)/i);
  ```
- When a multiline string is passed where line 1 is regular chat and line 2 is an OP command:
  - Input: `"Good morning everyone!\n/op Hacker"`
  - Tool output:
    ```json
    {
      "isCommand": false,
      "allowed": true,
      "cleanedText": "Good morning everyone!\n/op Hacker"
    }
    ```
  - `isPrivilegedCommand("Good morning everyone!\n/op Hacker")` evaluates to `false`.
  - `assertAllowedMinecraftChat("Good morning everyone!\n/op Hacker")` does NOT throw `PrivilegedCommandError`.

### Observation 1.2: Allowed Line 1 Command Masking Subsequent OP Commands
In `src/minecraft/fairplay/commandSanitizer.ts`:
- Input: `"/tell Alice hi\n/give @p diamond 64"`
- Tool output:
  ```json
  {
    "isCommand": true,
    "allowed": true,
    "commandName": "tell",
    "cleanedText": "/tell Alice hi\n/give @p diamond 64"
  }
  ```
- Because `match` lacks the multiline `/m` flag, it matches only line 1 (`tell`), certifying the entire string as `allowed: true`.
- `isPrivilegedCommand` returns `false`.
- `assertAllowedMinecraftChat` returns without throwing.

### Observation 1.3: Semicolon Command Separators
- Input: `"/tell Alice hi; /give @p diamond 64"` or `"/tell Alice hi;/op hacker"`
- Current behavior treats the entire line as a single `/tell` command, leaving `/give` and `/op` uninspected.

### Observation 1.4: Namespace Space Evasion & Missing OP Commands
- Space after colon (Observation 1.1 of Challenger 2):
  `/minecraft: give @p diamond 64` matches `minecraft` as root command, bypassing blocklist (`allowed: true`).
- Missing OP commands in `BLOCKED_COMMANDS`:
  `/clear @a`, `/datapack disable vanilla`, and `/spectate Steve` return `isPrivilegedCommand === false`.

---

## 2. Logic Chain

1. **Anti-Cheat Requirement**: Per `ORIGINAL_REQUEST.md` R2, the agent must operate strictly under fair-play survival rules and block all privileged server commands (`/tp`, `/give`, `/gamemode`, `/op`, etc.).
2. **Defect in Single-Line Assumption (Obs 1.1 & 1.2)**: `sanitizeMinecraftMessage` currently assumes a one-to-one mapping between an input message and a single command. By only checking `startsWith('/')` and `^\/+` at index 0, any message where line 1 is chat or an allowed command leaves all subsequent lines uninspected.
3. **Exploitability**: An attacker or prompt injection can execute arbitrary privileged commands by prepending a chat message or an allowed command (`/tell Alice hi\n/op Hacker`), or using command separators (`;`).
4. **Decomposition Invariant**: A compound or multiline message is safe if and only if **EVERY** segment is safe. If any segment contains a privileged command (e.g. `op`, `give`, `tp`) or a malformed command (e.g. `/   tp`), the entire message must be rejected (`allowed: false`) and trigger `PrivilegedCommandError` in `assertAllowedMinecraftChat`.
5. **Comprehensive Delimitation**: Lines can be split by CRLF (`\r\n`), LF (`\n`), CR (`\r`), Unicode line breaks (`\u2028`, `\u2029`), and command separator semicolons (`;`).
6. **Unified Sanitization**: Splitting into segments and delegating each segment to `sanitizeSingleSegment` handles multiline commands, single-line commands, space-padded namespaces, and chat uniformly without interface changes.

---

## 3. Caveats

- **ChatBridge Pre-Sanitization**: `antiLoopback.sanitizeForMinecraft` already collapses `[\r\n\t]+` to single spaces for messages relayed from Discord. However, this does not protect direct calls to `sendChat` by the AI planner or internal tools, nor does it collapse semicolons `;`. The defense-in-depth fix in `commandSanitizer.ts` protects all ingress paths.
- **In-Game Chat vs Command**: If a user genuinely wants to type a multi-line poem or chat containing no slashes, the proposed fix preserves multi-line formatting in `cleanedText`.
- **Adversarial Test Suite State**: In `test/tier5_adversarial/m2_adversarial.test.ts`, tests `ADV-SAN-VULN-1`, `ADV-SAN-VULN-2`, and `ADV-SAN-VULN-3` were written as vulnerability probes asserting that the bug existed. When the implementer updates `commandSanitizer.ts`, those 3 tests must be flipped to assert that the commands ARE blocked and throw errors.

---

## 4. Conclusion

The command sanitizer vulnerability is fully diagnosed, and a complete drop-in replacement strategy is verified.

### Recommended Actions for Worker Implementer:
1. **Apply Replacement to `src/minecraft/fairplay/commandSanitizer.ts`**:
   Replace `src/minecraft/fairplay/commandSanitizer.ts` with the implementation in:
   `.agents/teamwork/explorer_m2_it2_2/proposed_commandSanitizer.ts`
   Key enhancements:
   - Add `'clear'`, `'spectate'`, and `'datapack'` to `BLOCKED_COMMANDS`.
   - Implement `sanitizeSingleSegment` supporting namespace space tolerance (`/minecraft: give` parses `give`), rejecting `/namespace:   ` as `MALFORMED_COMMAND`.
   - Update `sanitizeMinecraftMessage` to split by `/(?:\r\n|[\r\n\u2028\u2029;])/`, inspect all trimmed segments, and reject if ANY segment is blocked or malformed.
2. **Update Probes in `test/tier5_adversarial/m2_adversarial.test.ts`**:
   - Update `ADV-SAN-VULN-1`: Assert `isPrivilegedCommand(ev) === true` and `assertAllowedMinecraftChat(ev)` throws `PrivilegedCommandError`.
   - Update `ADV-SAN-VULN-2`: Assert `isPrivilegedCommand(chatWithOp) === true` and `isPrivilegedCommand(tellWithGive) === true`.
   - Update `ADV-SAN-VULN-3`: Assert `isPrivilegedCommand` is `true` for `/clear @a`, `/datapack disable vanilla`, and `/spectate Steve`.
3. **Run Full Verification**:
   - `npm.cmd test` (ensure 287/287 tests pass).
   - `npm.cmd run build` (ensure 0 TypeScript compiler errors).

---

## 5. Verification Method

1. **Run Local Adversarial Suite with Proposed Fix**:
   ```powershell
   node .agents/teamwork/explorer_m2_it2_2/test_all_adversarial.cjs
   ```
   Verified: Output confirms `ALL TESTS PASSED SUCCESSFULLY!`.

2. **Verify TypeScript Strict Compilation**:
   ```powershell
   npx.cmd tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --noEmit .agents/teamwork/explorer_m2_it2_2/proposed_commandSanitizer.ts
   ```
   Verified: Exits with code 0 and 0 errors.

3. **Post-Implementation Verification Commands**:
   ```powershell
   npx.cmd vitest run test/tier5_adversarial/m2_adversarial.test.ts
   npm.cmd test
   npm.cmd run build
   ```
