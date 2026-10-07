# Handoff Report: Milestone 1 Scaffold, Configuration, Slash Commands & RBAC Security

**Author**: Explorer M1.1 (`teamwork_preview_explorer`)  
**Target Milestone**: Milestone 1 (Project Scaffold, Config, Slash Commands, RBAC, Client Wrapper)  
**Date**: 2026-10-07  
**Full Implementation Plan**: `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m1_1\plan.md`  

---

## 1. Observation

1. **System Environment**:
   - Running command `node -v; npm.cmd -v` in project root returned:
     ```text
     v24.21.0
     11.19.0
     ```
   - Windows PowerShell environment with execution policy considerations noted in `explorer_survey_3/survey_report.md` line 730:
     > "On Windows PowerShell, executing `npm` directly may invoke `npm.ps1`, which can be blocked by `RemoteSigned` / `Restricted` ExecutionPolicy (`PSSecurityException`). Solution: Package scripts and developer documentation must explicitly use `npm.cmd` or run via `npx.cmd` on Windows."

2. **Project Directory State**:
   - `list_dir` on `c:\Users\rando\Documents\antigravity\wise-pasteur` returned:
     ```json
     {"name":".agents","isDir":true}
     {"name":".git","isDir":true}
     {"name":"ORIGINAL_REQUEST.md","sizeBytes":"6067"}
     {"name":"PROJECT.md","sizeBytes":"16987"}
     ```
   - No `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, or `src/` directory exists in project root yet.

3. **User & Architectural Requirements**:
   - `ORIGINAL_REQUEST.md` lines 12-18 specifies:
     > "Implement a Discord bot service supporting text commands/slash commands, interactive voice channels, and bidirectional game bridging... Enforce role-based access control (RBAC) so only configured Discord roles or users can command the bot to execute in-game actions."
   - `ORIGINAL_REQUEST.md` lines 38-39:
     > "Project builds cleanly (`npm run build` or equivalent) with TypeScript type checks passing without errors. Automated test suite (`npm test`) runs programmatically and passes 100% of unit and integration tests."
   - `PROJECT.md` lines 120-130 mandates the `IDiscordGateway` contract:
     ```typescript
     export interface IDiscordGateway {
       registerCommands(commands: SlashCommandDefinition[]): Promise<void>;
       sendMessage(channelId: string, content: string | MessagePayload): Promise<string>;
       updateEmbed(channelId: string, messageId: string, embed: EmbedData): Promise<void>;
       joinVoice(channelId: string, guildId: string): Promise<IVoiceSession>;
       leaveVoice(guildId: string): Promise<void>;
       onCommand(handler: (interaction: CommandInteraction) => Promise<void>): void;
       onMessage(handler: (message: UserMessage) => Promise<void>): void;
     }
     ```
   - `PROJECT.md` line 95 lists F43:
     > "Project Build & TypeScript Scaffold | `package.json`, `tsconfig.json` (ES2022/NodeNext/strict), `npm run build`"

4. **SDK Anti-Deprecation & Version Constraints**:
   - `explorer_survey_3/survey_report.md` lines 24-29:
     > "Authorized Package: `@google/genai` (version `^2.3.0` or higher). Prohibited Deprecated Packages: Legacy packages `@google/generative-ai` and `google-generativeai` are strictly banned... Primary Model: `gemini-3.8-flash`"
   - `spec_miner_survey_1/survey_report.md` lines 655-656:
     > "In Node.js environments, `@discordjs/opus` requires native compilation tools. To maintain seamless cross-platform CI testability without build failures, provide fallback to `opusscript` or pure-mock streams in test suites."

5. **Slash Command & RBAC Specifications**:
   - `spec_miner_survey_1/survey_report.md` lines 110-152 details the 8 required slash commands: `/status` (VIEWER), `/connect` (ADMIN), `/disconnect` (ADMIN), `/task` (OPERATOR), `/stop` (OPERATOR), `/inventory` (VIEWER), `/voice` (`join`/`leave`, OPERATOR), and `/help` (VIEWER).
   - `spec_miner_survey_1/survey_report.md` line 72 observes:
     > "Execution of a complex planner task takes > 3000ms. If not deferred immediately, Discord fails with Error 10062 'Unknown interaction'. Must invoke `await interaction.deferReply()` within 2.5 seconds."
   - `spec_miner_survey_1/survey_report.md` lines 421-456 specifies 3-tier RBAC (`VIEWER`, `OPERATOR`, `ADMIN`) with Discord `Administrator` permission bypass.

---

## 2. Logic Chain

1. **Scaffold & Build Setup**:
   - From (1) and (2), we are running Node.js v24.21.0 on Windows PowerShell in an uninitialized repository root.
   - To achieve clean ES2022/NodeNext TypeScript builds (3, 4), `package.json` must declare `"type": "module"` and use `cross-env` / `rimraf` for platform-agnostic npm scripts (`build`, `clean`, `test`, `test:offline`, `typecheck`).
   - Under `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` in `tsconfig.json`, all relative TypeScript imports require explicit `.js` extensions (e.g., `import { env } from './config/env.js'`). This rule must be followed consistently to prevent compiler error TS2835.
   - To avoid Windows build failures where Visual C++ build tools are absent (4), `package.json` includes both `@discordjs/opus` and `opusscript` as fallback.

2. **Environment Validation & Offline Testing**:
   - From (3) and (4), the application requires environment keys for Discord, Gemini, Minecraft, and RBAC, yet automated testing must run 100% offline in CI without live API keys or servers.
   - Therefore, `src/config/env.ts` uses Zod with type coercion and defaults, combined with an automated mock-injection fallback when `NODE_ENV === 'test'` or `MOCK_ALL === 'true'`. This prevents configuration validation throws during test runs while strictly validating live deployments.

3. **Slash Commands & Interaction Lifecycle**:
   - From (3) and (5), 8 commands must be supported. Because AI planning and Minecraft connections can exceed 2500ms, standard synchronous handlers risk Discord 10062 timeouts.
   - The solution is a two-layer deferral design:
     a) Commands with known long latency (`/task`, `/connect`) declare `deferImmediately: true` and call `interaction.deferReply()` immediately upon receipt.
     b) All commands run inside `withAutoDefer`, a race against a 2500ms safety timer that automatically defers if execution has not concluded.

4. **Security & RBAC Enforcement**:
   - From (3) and (5), user permissions must be strictly verified before dispatching tasks to the planner or Minecraft agent.
   - `RBACService` checks the hierarchy: Server Administrator (`PermissionFlagsBits.Administrator`) and Guild Owner bypass checks; otherwise user/role IDs are checked against `adminRoleIds`/`adminUserIds` (for `ADMIN`) and `allowedRoleIds`/`allowedUserIds` (for `OPERATOR`).
   - Unauthorized attempts immediately return an ephemeral `⛔ Permission Denied` message and emit a structured audit log without consuming AI tokens or executing in-game actions.

5. **Client Wrapper Integration**:
   - From (3), `DiscordBotClient` implements `IDiscordGateway`, binding Discord.js v14 events with gateway intents (`Guilds`, `GuildMessages`, `MessageContent`, `GuildVoiceStates`), routing slash commands through RBAC and `withAutoDefer`, and providing message hooks for the chat bridge.

---

## 3. Caveats

1. **Audio Streaming Implementation**:
   - The low-level audio decoding/encoding internals (`@discordjs/voice` Receiver and AudioPlayer pipelines, PCM chunking, STT/TTS services) are within the dedicated scope of Explorer M1.2. The client wrapper exposes `joinVoice` and `leaveVoice` contracts to delegate to those services.
2. **Chat Bridge & Status Embed Implementation**:
   - The live status embed generator (`buildStatusEmbed`), dirty-state SHA256 hashing, and chat bridge anti-loopback filter are within the dedicated scope of Explorer M1.3. Slash commands `/status` and `/inventory` invoke those modules via dependency injection.
3. **Privileged Gateway Intents in Discord Developer Portal**:
   - Live bot operation requires the `MessageContent` intent to be toggled ON in the Discord Developer Portal. The offline simulation harness bypasses this requirement completely.

---

## 4. Conclusion

Milestone 1's project scaffold, configuration schema, RBAC security system, and Discord slash commands architecture have been fully analyzed and specified in a complete, production-grade plan (`.agents/teamwork/explorer_m1_1/plan.md`). 

The architecture guarantees:
- **Clean Builds**: TypeScript `ES2022`/`NodeNext` with zero type errors.
- **Cross-Platform Safety**: Full Windows PowerShell compatibility using `npm.cmd`, `cross-env`, and pure JS Opus fallbacks.
- **Zero-Timeout Interactions**: Immediate deferral and 2.5s `withAutoDefer` preventing Discord 10062 errors.
- **Tiered RBAC Protection**: 3-tier access control preventing unauthorized users from triggering in-game actions or server disconnects.
- **100% Offline Testability**: Zero network or secret dependencies during Vitest execution.

---

## 5. Verification Method

Once implemented by the downstream builder agent, verify the subsystem independently using the following commands in `c:\Users\rando\Documents\antigravity\wise-pasteur`:

1. **Compilation Verification**:
   ```powershell
   npm.cmd run build
   ```
   *Pass Condition*: Process exits with code `0`, generating `./dist/index.js`, `./dist/discord/`, `./dist/config/`, and `.d.ts` declaration files.

2. **Strict Typecheck Verification**:
   ```powershell
   npm.cmd run typecheck
   ```
   *Pass Condition*: TypeScript compiler outputs `0 errors` under strict mode.

3. **Offline Test Suite Execution**:
   ```powershell
   npm.cmd test
   ```
   *Pass Condition*: 100% of unit tests pass, verifying:
   - `env.ts`: Schema parsing passes on valid inputs, fails with descriptive errors on missing keys, and injects fallbacks when `NODE_ENV=test`.
   - `rbac.ts`: Viewer access granted to all; Operator access granted only to whitelisted roles/users/admins; Admin access strictly restricted.
   - `deferral.ts`: 2.5s timer triggers `deferReply` on slow operations; fast tasks resolve without deferral.
   - `commands/`: All 8 slash commands (`/status`, `/connect`, `/disconnect`, `/task`, `/stop`, `/inventory`, `/voice`, `/help`) build valid SlashCommand JSON and route accurately.

4. **Invalidation Conditions**:
   - If `npm run build` fails due to missing `.js` extensions on relative imports, TS2835 is triggered.
   - If `@google/generative-ai` is imported instead of `@google/genai`, the anti-deprecation constraint is violated.
   - If `/task` or `/connect` command executions take > 3000ms without calling `deferReply`, Discord Error 10062 occurs.
