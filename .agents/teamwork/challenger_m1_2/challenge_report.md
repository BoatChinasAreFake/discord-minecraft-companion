# Adversarial Challenge Report: Milestone 1 (Chat Bridge, RBAC, Status Embed)

**Agent**: `challenger_m1_2` (Roles: Critic, Specialist)  
**Date**: 2026-10-07  
**Verdict**: **REQUEST_CHANGES**  
**Overall Risk Assessment**: **CRITICAL**  

---

## 1. Executive Summary

Milestone 1 introduced core Discord bot capabilities, the three-tier RBAC service, the live status embed manager, and the bidirectional chat bridge with triple-lock anti-loopback filtering.

While baseline happy paths passed (`test/m1/` passed 69/69 tests), empirical adversarial testing via `test/tier5_adversarial/m1_adversarial.test.ts` uncovered **2 CRITICAL**, **1 HIGH**, and **4 MEDIUM/LOW** vulnerabilities and reliability bugs across `RBACService`, `AntiLoopbackFilter`, and `ChatBridge`.

Most notably:
1. **Critical Privilege Escalation in RBAC**: An unauthenticated user with missing `id` in a partial guild with missing `ownerId` evaluates `undefined === undefined`, granting full **ADMIN** access.
2. **Critical Protocol Violation in Chat Bridge**: Pasting or relaying unbroken text (e.g. long URL, 500-char string) generates Minecraft chat chunks of **331 characters**, exceeding Minecraft's vanilla 256-character packet limit and triggering instant connection drop/kick by the Minecraft server Netty decoder.
3. **High Security Mention Bypass**: Chat messages containing `@EVERYONE`, `@Everyone`, `@HERE`, or `@Here` pass through `sanitizeForDiscord` without neutralization due to missing case-insensitive regex flags, allowing in-game players to ping all Discord members.

The `StatusEmbedManager` subsystem demonstrated good resilience against rapid state oscillations and dirty check suppression, but the critical and high-severity flaws in RBAC and Chat Bridge require code fixes before Milestone 1 can be approved.

---

## 2. Empirical Challenge Findings

### [CRITICAL] Challenge 1: Privilege Escalation via Undefined Context in `RBACService`
- **File & Line**: `src/discord/rbac.ts:78-80`
- **Assumption Challenged**: Assumed `guild.ownerId === userId` is only evaluated when both `guild.ownerId` and `userId` are valid non-empty string IDs.
- **Attack Scenario**: An interaction is received in a partial guild object (where `guild.ownerId` is `undefined`) or with a synthetic/mock/malformed user object (where `user.id` is `undefined`).
  ```typescript
  // src/discord/rbac.ts:78-80
  if (guild && guild.ownerId === userId) {
    return RBACTier.ADMIN;
  }
  ```
  Since `user.id` is `undefined` and `guild.ownerId` is `undefined`, `guild && undefined === undefined` evaluates to `true`, instantly returning `RBACTier.ADMIN`.
- **Blast Radius**: Complete authentication bypass. Any unauthenticated, malformed, or webhook interaction can execute `/connect`, `/disconnect`, or any future administrative commands.
- **Empirical Proof**: Test `ADV-RBAC-7` in `test/tier5_adversarial/m1_adversarial.test.ts`:
  ```
  FAIL ADV-RBAC-7: checks undefined ownerId and undefined userId match vulnerability
  AssertionError: CRITICAL: undefined user.id matched undefined guild.ownerId, granting unauthenticated ADMIN!
  Expected: false, Received: true
  ```
- **Mitigation**:
  Ensure both IDs are non-empty strings before comparison:
  ```typescript
  if (guild && Boolean(guild.ownerId) && Boolean(userId) && guild.ownerId === userId) {
    return RBACTier.ADMIN;
  }
  ```

---

### [CRITICAL] Challenge 2: Vanilla Minecraft 256-Character Packet Limit Breach in `AntiLoopbackFilter.chunkForMinecraft`
- **File & Line**: `src/bridge/antiLoopback.ts:149-164`
- **Assumption Challenged**: Assumed that the hard-slicing fallback in `chunkForMinecraft` guarantees that all returned chunks are $\le 256$ characters.
- **Attack Scenario**: A user sends an unbroken string longer than $2 \times \text{sliceLen}$ (such as a 500-character URL, base64 payload, or text without spaces).
  In `chunkForMinecraft`:
  ```typescript
  // sliceLen = Math.max(1, maxLen - prefix.length - 12);
  chunks.push(word.slice(0, sliceLen));
  currentChunk = word.slice(sliceLen);
  ```
  Because the word loop finishes after 1 word, `currentChunk` (holding the remaining 274 characters) is pushed directly into `chunks` without further slicing!
  When formatted:
  `${prefix} [2/2] ${currentChunk}` produces a string of **331 characters**.
- **Blast Radius**: Vanilla Minecraft Java Edition enforces a strict 256-character limit on inbound `ChatMessagePacket` payloads. When Mineflayer writes a 331-character packet to the server socket, the server Netty decoder throws `DecoderException: The received string length is longer than maximum allowed (331 > 256)` and immediately terminates the bot's connection.
- **Empirical Proof**: Test `ADV-ALF-4` in `test/tier5_adversarial/m1_adversarial.test.ts`:
  ```
  FAIL ADV-ALF-4: splits single massive unbroken token (no spaces) <= 256 chars
  AssertionError: Chunk [2/2] exceeded 256 characters! Length: 331, content: "[Discord] <VeryLongUsername123...": expected 331 to be <= 256
  ```
- **Mitigation**:
  Loop slicing for unbroken words until the remaining substring fits within `sliceLen`, and clamp `currentChunk` additions to ensure `chunks.length < maxChunks` and length $\le \text{sliceLen}$.

---

### [HIGH] Challenge 3: Case-Insensitive `@everyone` / `@here` Mention Bypass in `AntiLoopbackFilter.sanitizeForDiscord`
- **File & Line**: `src/bridge/antiLoopback.ts:120-121`
- **Assumption Challenged**: Assumed that `.replace(/@everyone/g, '@\u200beveryone')` neutralizes Discord mass mentions.
- **Attack Scenario**: An in-game player sends `@EVERYONE`, `@Everyone`, `@HERE`, or `@Here`.
  ```typescript
  // src/bridge/antiLoopback.ts:120-121
  public sanitizeForDiscord(content: string): string {
    return content
      .replace(/@everyone/g, '@\u200beveryone')
      .replace(/@here/g, '@\u200bhere');
  }
  ```
  Because regex flags lack `/i` (case-insensitive), uppercase and mixed-case variants are completely untouched. When relayed to Discord:
  `**[Minecraft] <Troll>** @EVERYONE raid happening now!`
  Discord's markdown renderer evaluates `@EVERYONE` as a live server-wide ping.
- **Blast Radius**: Unprivileged in-game players can trigger mass notifications to all Discord guild members, potentially leading to server disruption, spam penalties, or bot bans from Discord Trust & Safety.
- **Empirical Proof**: Test `ADV-ALF-2` in `test/tier5_adversarial/m1_adversarial.test.ts`:
  ```
  FAIL ADV-ALF-2: checks uppercase and mixed-case @everyone and @here
  AssertionError: Failed to sanitize case variant in: Alert @EVERYONE now! -> Alert @EVERYONE now!
  Expected: false, Received: true
  ```
- **Mitigation**:
  Add `/i` flag to the mention sanitization regular expressions:
  ```typescript
  return content
    .replace(/@everyone/gi, '@\u200beveryone')
    .replace(/@here/gi, '@\u200bhere');
  ```

---

### [MEDIUM] Challenge 4: EventEmitter Memory Leak on Bridge Lifecycle (`ChatBridge.stop`)
- **File & Line**: `src/bridge/chatBridge.ts:47-57`
- **Assumption Challenged**: Assumed `ChatBridge.stop()` cleanly halts bridge operations.
- **Attack Scenario**: The bridge is stopped and restarted (e.g., during network reconnects or configuration updates).
  In `start()`:
  `this.agent.on('chat', this.boundMinecraftHandler);`
  In `stop()`:
  `this.agent.removeListener(...)` is never called.
  On subsequent `start()` calls, another listener is registered.
- **Blast Radius**:
  After multiple reconnects, `agent.listenerCount('chat')` grows indefinitely, causing Node.js `MaxListenersExceededWarning`, memory leakage, and duplicate execution of chat handlers.
- **Empirical Proof**: Test `ADV-BRG-1` in `test/tier5_adversarial/m1_adversarial.test.ts`:
  ```
  FAIL ADV-BRG-1: stops listeners from leaking on stop()
  AssertionError: CRITICAL: Chat listener was not removed on bridge.stop(), causing memory leak and duplicate handlers on restart!
  Expected: 0, Received: 1
  ```
- **Mitigation**:
  In `ChatBridge.stop()`, explicitly detach the bound handler:
  ```typescript
  if (typeof this.agent.removeListener === 'function') {
    this.agent.removeListener('chat', this.boundMinecraftHandler);
  }
  ```

---

### [MEDIUM] Challenge 5: Discord Username Minecraft Section Sign Formatting Injection
- **File & Line**: `src/bridge/chatBridge.ts:84`
- **Assumption Challenged**: Assumed `sanitizedContent = this.filter.sanitizeForMinecraft(message.content)` is sufficient to protect Minecraft chat.
- **Attack Scenario**: A Discord user sets their server nickname to `§4§lADMIN§r`.
  In `handleDiscordMessage`:
  ```typescript
  const prefix = `[Discord] <${message.author.username}>:`;
  const chunks = this.filter.chunkForMinecraft(prefix, sanitizedContent);
  ```
  `message.author.username` is interpolated raw into `prefix` without passing through `sanitizeForMinecraft()`.
- **Blast Radius**: Discord users can inject arbitrary color codes, obfuscated text, and chat formatting into Minecraft server chat, allowing impersonation of Minecraft server staff or visual chat disruption.
- **Empirical Proof**: Test `ADV-BRG-2` in `test/tier5_adversarial/m1_adversarial.test.ts`:
  ```
  FAIL ADV-BRG-2: Discord username Minecraft formatting code injection
  AssertionError: Username allowed Minecraft section code injection into Minecraft chat: "[Discord] <§4§lADMIN§r>: I am the server admin!"
  Expected: false, Received: true
  ```
- **Mitigation**:
  Sanitize `message.author.username` when constructing `prefix`:
  ```typescript
  const cleanUsername = this.filter.sanitizeForMinecraft(message.author.username);
  const prefix = `[Discord] <${cleanUsername}>:`;
  ```

---

### [MEDIUM] Challenge 6: Zero-Width Space Bypass of Anti-Loopback Hash Deduplication
- **File & Line**: `src/bridge/antiLoopback.ts:21-28`
- **Assumption Challenged**: Assumed `normalizeText()` normalizes all invisible/whitespace characters.
- **Attack Scenario**: An echo or bounced message contains zero-width spaces (e.g. `\u200B`, `\u200C`, `\u200D`, `\uFEFF`).
  JavaScript regex `\s` does not match `\u200B`.
  `normalizeText('diamonds')` -> `'diamonds'`
  `normalizeText('d\u200biamonds')` -> `'d\u200biamonds'`
- **Blast Radius**: Messages echoed with zero-width spaces bypass Lock 3 hash deduplication.
- **Empirical Proof**: Test `ADV-ALF-12` in `test/tier5_adversarial/m1_adversarial.test.ts`:
  ```
  FAIL ADV-ALF-12: zero-width space normalization for deduplication
  AssertionError: Zero-width space survived normalization: "d​iamonds here"
  Expected: "diamonds here", Received: "d​iamonds here"
  ```
- **Mitigation**:
  Strip zero-width characters in `normalizeText`:
  ```typescript
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // ...
  ```

---

### [LOW] Challenge 7: Unhandled Minecraft 1.16+ Hex RGB Color Codes (`§x`)
- **File & Line**: `src/bridge/antiLoopback.ts:23, 112`
- **Assumption Challenged**: Assumed `/§[0-9a-fk-or]/gi` matches all Minecraft section codes.
- **Attack Scenario**: Modern Minecraft RGB colors format codes like `§x§f§f§a§a§0§0`.
  The regex strips `[0-9a-fk-or]`, leaving `§x` intact.
- **Blast Radius**: Cosmetic artifacts (`§x`) appear in Discord relay or normalized text.
- **Empirical Proof**: Test `ADV-ALF-11` in `test/tier5_adversarial/m1_adversarial.test.ts`:
  ```
  FAIL ADV-ALF-11: checks Minecraft 1.16+ hex color codes (§x) stripping in sanitizeForMinecraft
  AssertionError: Failed to strip section sign from hex color: §xGolden Text
  Expected: false, Received: true
  ```
- **Mitigation**:
  Update section code regex to `/§[0-9a-fk-orx]/gi` or `/§./gi`.

---

## 3. Subsystems Verified Robust

The following areas were stress-tested and proved empirically sound:

1. **StatusEmbedManager 5-Second Throttling (`ADV-EMB-1`)**:
   - Rapid status oscillations via `updateState` (100 oscillations across 3000ms) resulted in **0** premature Discord API calls.
   - At the 5000ms timer boundary, exactly **1** update occurred.
   - At the 10000ms timer boundary, exactly the **2nd** update occurred.
2. **StatusEmbedManager SHA-256 Dirty-State Check (`ADV-EMB-2`, `ADV-EMB-3`)**:
   - If state oscillated temporarily from 20 HP to 18 HP but returned to 20 HP before the tick boundary, the Discord API edit was suppressed (`updated === false`).
   - Coordinate micro-jitter (< 0.25 blocks) was suppressed by integer rounding.
   - Genuine changes (health $\pm 0.5$, $\ge 1$ block displacement, task name, dimension, equipment, inventory slots) correctly marked state dirty.
3. **StatusEmbedManager Concurrency Protection (`ADV-EMB-4`)**:
   - In-flight pending Discord API requests correctly lock `isUpdating = true`, suppressing concurrent tick race conditions.
4. **RBAC Role & Bitfield Hardening (`ADV-RBAC-1` to `ADV-RBAC-6`)**:
   - Malformed role arrays, prototypes (`__proto__`, `constructor`), and missing cache maps are safely caught and default to `VIEWER`.
   - Edge bitfields (`0n`, `2048n`, throw-on-access permission checks) correctly rejected unauthorized users.
5. **AntiLoopback Flood Resilience (`ADV-ALF-9`, `ADV-ALF-10`)**:
   - 500 identical flood messages all deduplicated under Lock 3 within < 10ms.
   - 5,000 distinct messages recorded in hash cache in < 150ms without memory exhaustion or crash.

---

## 4. Unchallenged Areas

- **Voice Gateway Audio Jitter & Loss**: Voice pipeline under UDP packet loss or Opus frame corruption was not tested in this turn as focus was directed on Chat Bridge, RBAC, and Embed subsystems per dispatch instructions.
- **Mineflayer Real Socket Packets**: Physical Minecraft TCP connection handling was tested with mock agents; full network-level TCP stress testing is scheduled for Milestone 2 and Milestone 4.

---

## 5. Verdict & Recommendation

**Verdict**: **REQUEST_CHANGES**

Milestone 1 **cannot be approved** until the two CRITICAL bugs and one HIGH bug are remediated:
1. `src/discord/rbac.ts`: Fix unauthenticated `guild.ownerId === userId` check when both IDs are `undefined`.
2. `src/bridge/antiLoopback.ts`: Fix `chunkForMinecraft` to guarantee no chunk exceeds 256 characters when dealing with unbroken strings.
3. `src/bridge/antiLoopback.ts`: Add `/i` flag to `@everyone` and `@here` sanitization regexes.
4. `src/bridge/chatBridge.ts`: Clean up `agent.removeListener('chat', ...)` on `stop()`.
5. `src/bridge/chatBridge.ts`: Sanitize `message.author.username` when constructing Minecraft chat prefix.
