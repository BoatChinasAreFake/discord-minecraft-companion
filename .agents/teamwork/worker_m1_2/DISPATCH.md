## 2026-10-07T20:01:00Z
You are a teamwork_preview_worker implementing Milestone 1 Iteration 2 remediations for the Discord & Minecraft bot project.
Your working directory is: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\worker_m1_2
Project root directory: c:\Users\rando\Documents\antigravity\wise-pasteur

MANDATORY FIRST STEP: Read the user request at:
c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\ORIGINAL_REQUEST.md
Also read the master project scope:
c:\Users\rando\Documents\antigravity\wise-pasteur\PROJECT.md

Read the 3 detailed remediation plans produced by the Iteration 2 Explorers:
- Audio Queue & TTS Fixes: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m1_it2_1\remediation_plan.md
- Bridge & Anti-Loopback Fixes: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m1_it2_2\remediation_plan.md
- Discord Client & RBAC Fixes: c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m1_it2_3\remediation_plan.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

SCOPE OF WORK & FILE WRITE OWNERSHIP:
You exclusively own and will edit:
1. `src/audio/queue.ts`:
   - Preemption tracking / generation token so in-flight synthesis when cancelled/preempted does not clobber active emergency playback.
   - Do not emit false completion / itemCompleted on synthesis or player errors (emit error/failed event instead).
   - Maintain chronological FIFO order for multiple emergency items.
2. `src/audio/tts.ts`:
   - Handle duration <= 0 in generateSyntheticPcmTone safely without unhandled RangeError.
3. `src/audio/types.ts`:
   - Add cancellation / token properties or error event types if needed per explorer plan.
4. `src/bridge/antiLoopback.ts`:
   - In chunkForMinecraft: ensure unbroken strings are hard-sliced so EVERY chunk strictly does not exceed 256 characters (taking chunk prefix length into account).
   - In sanitizeForDiscord: make @everyone and @here regexes case-insensitive (/@everyone/gi and /@here/gi).
   - In normalizeText: strip zero-width characters (\u200B, \u200C, \u200D, \uFEFF).
   - In sanitizeForMinecraft: strip §x and hex color sequences.
5. `src/bridge/chatBridge.ts`:
   - In stop(): properly detach agent.removeListener('chat', listener) to prevent listener leaks.
   - Sanitize Minecraft section codes from Discord usernames before formatting Minecraft chat prefix.
6. `src/discord/rbac.ts`:
   - Fix ownerId check: only grant ADMIN if userId and guild.ownerId are both non-empty and equal. Undefined userId must never match undefined ownerId.
7. `src/discord/client.ts`:
   - In joinVoice: wire real VoicePlayer (from src/audio/player.ts) and AudioQueueManager into returned IVoiceSession so playAudioStream and stopAudio are genuinely functional.
8. `test/tier5_adversarial/`:
   - Verify both `audio_adversarial.test.ts` and `m1_adversarial.test.ts` pass 100%.

VERIFICATION REQUIREMENTS:
- Run `npm.cmd run build` (must pass with 0 errors).
- Run `npm.cmd test` (must run ALL test files and pass 100% of tests with exit code 0).
- Document all verification commands and exact test outputs in your handoff report.

Write your report to:
c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\worker_m1_2\handoff.md
When done, notify me via send_message with a summary and verification results.
