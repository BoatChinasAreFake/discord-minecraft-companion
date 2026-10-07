# Milestone 1 Handoff Report: Adversarial Challenge Verdict

**Author**: `challenger_m1_2` (Roles: Critic, Specialist)  
**Milestone**: Milestone 1  
**Project**: Multimodal Discord Minecraft Bot with AI Agent Engine  
**Working Directory**: `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\challenger_m1_2`  
**Date**: 2026-10-07  
**Verdict**: **REQUEST_CHANGES**  

---

## 1. Observation

Adversarial stress-testing of Milestone 1 components was conducted via `test/tier5_adversarial/m1_adversarial.test.ts`.

### 1.1 Tool Commands & Test Execution
Command executed:
```powershell
npm.cmd test test/tier5_adversarial/m1_adversarial.test.ts
```
Direct output:
```
 FAIL  test/tier5_adversarial/m1_adversarial.test.ts > Adversarial Challenge: AntiLoopbackFilter > 1.1 @everyone and @here Injection Tests > ADV-ALF-2: [VULNERABILITY PROBE] checks uppercase and mixed-case @everyone and @here
AssertionError: Failed to sanitize case variant in: Alert @EVERYONE now! -> Alert @EVERYONE now!: expected true to be false

 FAIL  test/tier5_adversarial/m1_adversarial.test.ts > Adversarial Challenge: AntiLoopbackFilter > 1.2 256-Character Boundary & Split Invariants > ADV-ALF-4: [VULNERABILITY PROBE] splits single massive unbroken token (no spaces) <= 256 chars
AssertionError: Chunk [2/2] exceeded 256 characters! Length: 331, content: "[Discord] <VeryLongUsername123...": expected 331 to be less than or equal to 256

 FAIL  test/tier5_adversarial/m1_adversarial.test.ts > Adversarial Challenge: AntiLoopbackFilter > 1.4 Flood Message & Leaky Bucket Resilience > ADV-ALF-11: [VULNERABILITY PROBE] checks Minecraft 1.16+ hex color codes (§x) stripping in sanitizeForMinecraft
AssertionError: Failed to strip section sign from hex color: §xGolden Text: expected true to be false

 FAIL  test/tier5_adversarial/m1_adversarial.test.ts > Adversarial Challenge: AntiLoopbackFilter > 1.4 Flood Message & Leaky Bucket Resilience > ADV-ALF-12: [VULNERABILITY PROBE] zero-width space normalization for deduplication
AssertionError: Zero-width space survived normalization: "d​iamonds here": expected 'd​iamonds here' to be 'diamonds here'

 FAIL  test/tier5_adversarial/m1_adversarial.test.ts > Adversarial Challenge: ChatBridge Lifecycle & Formatting > ADV-BRG-1: [VULNERABILITY PROBE] stops listeners from leaking on stop()
AssertionError: CRITICAL: Chat listener was not removed on bridge.stop(), causing memory leak and duplicate handlers on restart!: expected 1 to be +0

 FAIL  test/tier5_adversarial/m1_adversarial.test.ts > Adversarial Challenge: ChatBridge Lifecycle & Formatting > ADV-BRG-2: [VULNERABILITY PROBE] Discord username Minecraft formatting code injection
AssertionError: Username allowed Minecraft section code injection into Minecraft chat: "[Discord] <§4§lADMIN§r>: I am the server admin!": expected true to be false

 FAIL  test/tier5_adversarial/m1_adversarial.test.ts > Adversarial Challenge: RBACService > 2.3 Missing Context & Edge Context Cases > ADV-RBAC-7: [VULNERABILITY PROBE] checks undefined ownerId and undefined userId match vulnerability
AssertionError: CRITICAL: undefined user.id matched undefined guild.ownerId, granting unauthenticated ADMIN!: expected true to be false

Test Files  1 failed (1)
     Tests  7 failed | 17 passed (24)
```

### 1.2 Verbatim Code Observations
1. **`src/discord/rbac.ts:78-80`**:
   ```typescript
   // Check Guild Owner
   if (guild && guild.ownerId === userId) {
     return RBACTier.ADMIN;
   }
   ```
   When `user.id` is `undefined` and `guild.ownerId` is `undefined`, `guild.ownerId === userId` evaluates to `true`, returning `RBACTier.ADMIN`.
2. **`src/bridge/antiLoopback.ts:149-164`**:
   ```typescript
   if (testFormat.length > maxLen) {
     if (currentChunk) {
       chunks.push(currentChunk);
       currentChunk = word;
     } else {
       // Single word longer than max allowed chunk: hard slice
       const sliceLen = Math.max(1, maxLen - prefix.length - 12);
       chunks.push(word.slice(0, sliceLen));
       currentChunk = word.slice(sliceLen);
     }
   }
   // ...
   if (currentChunk && chunks.length < maxChunks) {
     chunks.push(currentChunk);
   }
   ```
   For a single word of 500 characters, `word.slice(sliceLen)` has length 290. Because there are no more words, `chunks.push(currentChunk)` appends the 290-char slice. When formatted with `${prefix} [2/2] ${chunk}`, the resulting string is 331 characters long.
3. **`src/bridge/antiLoopback.ts:120-121`**:
   ```typescript
   public sanitizeForDiscord(content: string): string {
     return content
       .replace(/@everyone/g, '@\u200beveryone')
       .replace(/@here/g, '@\u200bhere');
   }
   ```
   Regex contains no `/i` flag.
4. **`src/bridge/chatBridge.ts:47-57`**:
   `this.agent.on('chat', this.boundMinecraftHandler)` is called in `start()`, but `this.agent.removeListener('chat', ...)` is not called in `stop()`.
5. **`src/bridge/chatBridge.ts:84`**:
   `const prefix = `[Discord] <${message.author.username}>:`;` does not pass `message.author.username` through `sanitizeForMinecraft()`.

---

## 2. Logic Chain

1. **Privilege Escalation (Observation 1.2.1 -> Finding 1)**:
   - Any API interaction missing user ID (or crafted payload) passed into a partial guild where `guild.ownerId` is undefined evaluates `undefined === undefined` to `true`.
   - Therefore, unauthenticated requests obtain `ADMIN` privileges.
2. **Protocol Disconnect Crash (Observation 1.2.2 -> Finding 2)**:
   - Minecraft Java Edition server packet protocol specification defines chat packet maximum string length as 256.
   - Slicing an unbroken string once and dumping the un-sliced remainder into the next chunk creates a 331-character packet.
   - Therefore, sending an unbroken string > 300 characters will cause Mineflayer/Minecraft server Netty decoder to throw `DecoderException` and kick the bot.
3. **Mass Mention Spam (Observation 1.2.3 -> Finding 3)**:
   - Discord client parses `@EVERYONE` and `@Everyone` case-insensitively as broadcast pings.
   - Because regex replacement is case-sensitive, uppercase pings are not neutralized.
   - Therefore, Minecraft players can trigger mass pings in Discord text channels.
4. **Lifecycle Resource Leak (Observation 1.2.4 -> Finding 4)**:
   - `start()` attaches an EventEmitter listener; `stop()` does not detach it.
   - On reconnect, multiple handlers fire for each chat message.
   - Therefore, memory and event handler count leak on every bridge restart.
5. **Chat Formatting Spoofing (Observation 1.2.5 -> Finding 5)**:
   - Discord usernames containing `§4§l` are sent unescaped into Minecraft chat.
   - Therefore, Discord users can spoof colored server staff badges or disrupt Minecraft chat.

---

## 3. Caveats

- **No Caveats**: All findings were directly and empirically reproduced using the automated test suite in `test/tier5_adversarial/m1_adversarial.test.ts`.
- Subsystems outside of Chat Bridge, RBAC, and Status Embed (e.g. voice UDP packets, Mineflayer physics simulation) were not part of this challenge scope and will be evaluated in subsequent milestones.

---

## 4. Conclusion

Final Assessment: **REQUEST_CHANGES**

Milestone 1 is not approved for progression until the worker fixes the identified issues:
1. `src/discord/rbac.ts`: Enforce `Boolean(guild.ownerId) && Boolean(userId) && guild.ownerId === userId`.
2. `src/bridge/antiLoopback.ts`: Fix `chunkForMinecraft` to guarantee no chunk exceeds 256 characters under arbitrary unbroken inputs.
3. `src/bridge/antiLoopback.ts`: Add `/i` flag to mention sanitization regexes.
4. `src/bridge/chatBridge.ts`: Detach listener in `stop()`.
5. `src/bridge/chatBridge.ts`: Sanitize `message.author.username`.

---

## 5. Verification Method

To reproduce all 7 empirical failures:

```powershell
npm.cmd test test/tier5_adversarial/m1_adversarial.test.ts
```

*Expected output*: 7 failed tests out of 24, reproducing all failure modes verbatim.

To verify when fixed:
1. Worker implements fixes in implementation files.
2. Re-run `npm.cmd test` (runs both `test/m1/` and `test/tier5_adversarial/`).
3. 100% of tests (93 / 93) must pass cleanly.
