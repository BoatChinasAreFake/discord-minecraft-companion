# Milestone 1 Implementation Plan: Project Scaffold, Environment Configuration, Discord Slash Commands & RBAC Security

**Author**: Explorer M1.1 (`teamwork_preview_explorer`)  
**Scope**: Project Scaffold (`package.json`, `tsconfig.json`, `vitest.config.ts`), Environment Configuration (`.env.example`, `src/config/env.ts`), Discord Slash Commands (`src/discord/commands/`), RBAC Security (`src/discord/rbac.ts`), and Discord Client Wrapper (`src/discord/client.ts`).  
**Working Directory**: `c:\Users\rando\Documents\antigravity\wise-pasteur\.agents\teamwork\explorer_m1_1`  
**Date**: 2026-10-07  

---

## 1. Executive Summary & Architectural Positioning

Milestone 1 establishes the bedrock infrastructure of the **Multimodal Discord & Fair-Play Minecraft Agent Bot**. This plan delivers the concrete, production-ready specifications for:
1. **Scaffolding & Tooling**: Node.js v24+ ESM environment with TypeScript 5.6+ (`ES2022`/`NodeNext`), Vitest in-memory test runner, and cross-platform npm scripts compatible with Windows PowerShell execution environments.
2. **Configuration Subsystem**: Strict Zod-backed environment validation loading `.env.example` with fallback mocks for 100% offline CI testing.
3. **Role-Based Access Control (RBAC)**: A 3-tier security model (`VIEWER`, `OPERATOR`, `ADMIN`) with role/user snowflake whitelisting, Discord `Administrator` bypass, and structured security audit logging.
4. **Discord Slash Commands Engine**: 8 comprehensive slash commands (`/status`, `/connect`, `/disconnect`, `/task`, `/stop`, `/inventory`, `/voice`, `/help`), backed by a 2.5s auto-deferral wrapper preventing Discord 10062 timeouts.
5. **Discord Client Wrapper**: An implementation of `IDiscordGateway` encapsulating Discord.js v14 client lifecycle, gateway intents, interaction routing, and dependency-injected services.

---

## 2. Component 1: `package.json` Scaffold & Dependency Architecture

### 2.1 File Location: `package.json`

```json
{
  "name": "discord-minecraft-companion",
  "version": "1.0.0",
  "description": "Multimodal Discord & Fair-Play Minecraft Agent Bot with Gemini AI Planner",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "clean": "rimraf dist",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:offline": "cross-env NODE_ENV=test MOCK_ALL=true vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@discordjs/opus": "^0.9.0",
    "@discordjs/voice": "^0.17.1",
    "@google/genai": "^2.3.0",
    "discord.js": "^14.16.3",
    "dotenv": "^16.4.5",
    "mineflayer": "^4.20.1",
    "mineflayer-pathfinder": "^2.4.5",
    "opusscript": "^0.1.0",
    "prism-media": "^1.3.5",
    "vec3": "^0.1.10",
    "winston": "^3.14.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.7.4",
    "@vitest/coverage-v8": "^2.1.1",
    "cross-env": "^7.0.3",
    "rimraf": "^6.0.1",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

### 2.2 Key Architectural Decisions & Rationale

1. **`"type": "module"`**:
   - Modern standard for Node.js 20+ and Node.js 24.
   - Enforces ECMAScript modules throughout the codebase.
   - Requires relative local imports to include the `.js` extension (e.g., `import { env } from './config/env.js';`) under TypeScript's `NodeNext` resolution.
2. **Audio Stack Compatibility (`@discordjs/opus` + `opusscript` fallback)**:
   - `@discordjs/opus` provides high-performance native C++ Opus encoding/decoding.
   - On Windows environments or CI pipelines without C++ build tools (Visual Studio build tools / python), native compilation may fail.
   - `opusscript` is included as a 100% pure JavaScript fallback codec, ensuring seamless installation and operation across all platforms.
3. **Official Google GenAI SDK (`@google/genai` >= 2.3.0)**:
   - Deprecated packages (`@google/generative-ai` and `google-generativeai`) are strictly prohibited per Survey 3 and PROJECT.md.
   - `@google/genai` supports `gemini-3.8-flash` with structured tool calling and typed multi-turn interactions.
4. **Windows PowerShell Safe Scripts**:
   - Uses `cross-env` for environment variable setting across POSIX and Windows PowerShell.
   - Uses `rimraf` instead of platform-specific `rm -rf` or `Remove-Item`.
   - In documentation and setup scripts, invoke `npm.cmd` when on Windows PowerShell to bypass `PSSecurityException`.

---

## 3. Component 2: `tsconfig.json` Compiler Configuration

### 3.1 File Location: `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test", ".agents"]
}
```

### 3.2 Compilation Discipline & Edge Case Mitigation

1. **`rootDir: "./src"` and Test Exclusion**:
   - The production build (`npm run build`) compiles only `src/` to `dist/`.
   - Test files in `test/` are excluded from `tsconfig.json` so they do not pollute `dist/` or cause rootDir conflicts.
   - Vitest directly compiles TypeScript files in `test/` on the fly using Vite's internal esbuild engine, eliminating the need for separate tsc output for test execution.
2. **Explicit `.js` Extension Rule**:
   - Because `module: "NodeNext"` and `moduleResolution: "NodeNext"` are enabled with `"type": "module"`, all relative imports in TypeScript source code MUST specify the `.js` extension (e.g., `import { RBACService } from './rbac.js';`).
   - Implementers must follow this strictly to prevent TypeScript error `TS2835: Relative import paths need explicit file extensions`.

---

## 4. Component 3: `vitest.config.ts` Test Runner Configuration

### 4.1 File Location: `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    pool: 'forks',
    env: {
      NODE_ENV: 'test',
      MOCK_ALL: 'true',
      DISCORD_BOT_TOKEN: 'mock_test_token_never_used_externally',
      DISCORD_CLIENT_ID: '123456789012345678',
      DISCORD_CHAT_BRIDGE_CHANNEL_ID: '123456789012345679',
      GEMINI_API_KEY: 'mock_gemini_api_key_test_only',
      MINECRAFT_HOST: 'localhost',
      MINECRAFT_PORT: '25565',
      MINECRAFT_USERNAME: 'TestBot'
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts']
    }
  }
});
```

### 4.2 Test Execution Isolation

- **In-Memory Guarantee**: Vitest executes with `MOCK_ALL=true` and default dummy credentials pre-populated into `process.env`.
- **Fast Feedback Loop**: Node environment without headless browser overhead executes hundreds of unit and simulation tests in < 3 seconds.
- **Coverage Mapping**: Targets all files in `src/` to verify test coverage across Tiers 1-4.

---

## 5. Component 4: `.env.example` Environment Specification

### 5.1 File Location: `.env.example`

```env
# ==============================================================================
# DISCORD & MINECRAFT SURVIVAL BOT CONFIGURATION (.env)
# ==============================================================================

# ------------------------------------------------------------------------------
# 1. Discord Bot Credentials & Scope
# ------------------------------------------------------------------------------
# Bot token from Discord Developer Portal -> Bot -> Token (Required)
DISCORD_BOT_TOKEN=your_discord_bot_token_here

# Application Client ID from Discord Developer Portal -> General Information (Required)
DISCORD_CLIENT_ID=123456789012345678

# Discord Guild ID for instant development slash command deployment (Optional)
# If set, slash commands update instantly in this guild. If omitted, deploys globally (takes ~1 hour to propagate).
DISCORD_GUILD_ID=123456789012345678

# ------------------------------------------------------------------------------
# 2. Discord Channel IDs
# ------------------------------------------------------------------------------
# Channel ID for Bidirectional Minecraft <-> Discord text chat relay (Required for bridge)
DISCORD_CHAT_BRIDGE_CHANNEL_ID=123456789012345678

# Channel ID for persistent live status embed (Optional; if unset, /status command displays ephemeral embeds)
DISCORD_STATUS_CHANNEL_ID=123456789012345678

# Default Voice Channel ID for bot auto-join (Optional)
DISCORD_VOICE_CHANNEL_ID=123456789012345678

# Dedicated bot control channel for @mention AI tasks (Optional)
DISCORD_CONTROL_CHANNEL_ID=123456789012345678

# ------------------------------------------------------------------------------
# 3. Role-Based Access Control (RBAC) Security
# ------------------------------------------------------------------------------
# Comma-separated list of Role IDs with OPERATOR permissions (/task, /stop, /voice)
DISCORD_ALLOWED_ROLE_IDS=123456789012345678,234567890123456789

# Comma-separated list of User IDs with OPERATOR permissions
DISCORD_ALLOWED_USER_IDS=345678901234567890

# Comma-separated list of Role IDs with ADMIN permissions (/connect, /disconnect)
DISCORD_ADMIN_ROLE_IDS=123456789012345678

# Comma-separated list of User IDs with ADMIN permissions
DISCORD_ADMIN_USER_IDS=345678901234567890

# ------------------------------------------------------------------------------
# 4. Minecraft Java Edition Server Settings
# ------------------------------------------------------------------------------
# Minecraft server hostname or IP address (Default: localhost)
MINECRAFT_HOST=localhost

# Minecraft server port (Default: 25565)
MINECRAFT_PORT=25565

# Bot in-game player username (Default: DiscordSurvivalBot)
MINECRAFT_USERNAME=DiscordSurvivalBot

# Target Minecraft version (e.g. 1.20.4 or auto; Default: 1.20.4)
MINECRAFT_VERSION=1.20.4

# Authentication mode: 'offline' (cracked/local) or 'microsoft' (Default: offline)
MINECRAFT_AUTH=offline

# ------------------------------------------------------------------------------
# 5. Google Gemini AI Planning Engine
# ------------------------------------------------------------------------------
# Google AI Studio Gemini API Key (Required for AI planning and multimodal voice)
GEMINI_API_KEY=AIzaSyYourGeminiApiKeyHere

# Gemini model identifier (Default: gemini-3.8-flash; legacy models prohibited)
GEMINI_MODEL=gemini-3.8-flash

# Maximum tool call steps per user command loop before termination (Default: 5)
GEMINI_MAX_TOOL_STEPS=5

# ------------------------------------------------------------------------------
# 6. Audio Pipelines (STT & TTS)
# ------------------------------------------------------------------------------
# Duration of silence in ms before completing user utterance capture (Default: 500)
VOICE_STT_SILENCE_DURATION_MS=500

# Minimum voice utterance length in ms to filter acoustic noise (Default: 200)
VOICE_MIN_UTTERANCE_MS=200

# Maximum voice utterance length in ms before forcing buffer cut-off (Default: 15000)
VOICE_MAX_UTTERANCE_MS=15000

# TTS voice identifier or voice model (Default: en-US-Standard-C)
VOICE_TTS_VOICE_NAME=en-US-Standard-C

# ------------------------------------------------------------------------------
# 7. Status Embed & Throttling
# ------------------------------------------------------------------------------
# Minimum interval in seconds between live status embed updates (Default: 5)
STATUS_EMBED_INTERVAL_SEC=5

# ------------------------------------------------------------------------------
# 8. Runtime & Diagnostics
# ------------------------------------------------------------------------------
# Node runtime environment: 'development' | 'production' | 'test'
NODE_ENV=development

# Logging verbosity: 'debug' | 'info' | 'warn' | 'error' (Default: info)
LOG_LEVEL=info

# Offline test simulation flag: set to 'true' to bypass network sockets (Default: false)
MOCK_ALL=false
```

---

## 6. Component 5: `src/config/env.ts` Environment Loader & Zod Validation

### 6.1 Type Contracts: `src/config/types.ts`

```typescript
export interface AppConfig {
  discord: {
    token: string;
    clientId: string;
    guildId?: string;
    chatBridgeChannelId: string;
    statusChannelId?: string;
    voiceChannelId?: string;
    controlChannelId?: string;
  };
  rbac: {
    allowedRoleIds: string[];
    allowedUserIds: string[];
    adminRoleIds: string[];
    adminUserIds: string[];
  };
  minecraft: {
    host: string;
    port: number;
    username: string;
    version: string;
    auth: 'offline' | 'microsoft';
  };
  gemini: {
    apiKey: string;
    model: string;
    maxToolSteps: number;
  };
  audio: {
    sttSilenceDurationMs: number;
    minUtteranceMs: number;
    maxUtteranceMs: number;
    ttsVoiceName: string;
  };
  status: {
    embedIntervalSec: number;
  };
  runtime: {
    nodeEnv: 'development' | 'production' | 'test';
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    mockAll: boolean;
  };
}
```

### 6.2 Implementation: `src/config/env.ts`

```typescript
import dotenv from 'dotenv';
import { z } from 'zod';
import type { AppConfig } from './types.js';

// Load .env file into process.env if present
dotenv.config();

// Helper to parse comma-delimited strings into clean arrays of trimmed non-empty strings
const commaSeparatedList = z
  .string()
  .optional()
  .transform((val) => {
    if (!val) return [];
    return val
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  });

export const EnvSchema = z.object({
  // Discord
  DISCORD_BOT_TOKEN: z.string().min(1, 'DISCORD_BOT_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
  DISCORD_GUILD_ID: z.string().optional(),
  DISCORD_CHAT_BRIDGE_CHANNEL_ID: z.string().min(1, 'DISCORD_CHAT_BRIDGE_CHANNEL_ID is required'),
  DISCORD_STATUS_CHANNEL_ID: z.string().optional(),
  DISCORD_VOICE_CHANNEL_ID: z.string().optional(),
  DISCORD_CONTROL_CHANNEL_ID: z.string().optional(),

  // RBAC
  DISCORD_ALLOWED_ROLE_IDS: commaSeparatedList,
  DISCORD_ALLOWED_USER_IDS: commaSeparatedList,
  DISCORD_ADMIN_ROLE_IDS: commaSeparatedList,
  DISCORD_ADMIN_USER_IDS: commaSeparatedList,

  // Minecraft
  MINECRAFT_HOST: z.string().default('localhost'),
  MINECRAFT_PORT: z.coerce.number().int().min(1).max(65535).default(25565),
  MINECRAFT_USERNAME: z.string().min(1).default('DiscordSurvivalBot'),
  MINECRAFT_VERSION: z.string().default('1.20.4'),
  MINECRAFT_AUTH: z.enum(['offline', 'microsoft']).default('offline'),

  // Gemini AI
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_MAX_TOOL_STEPS: z.coerce.number().int().min(1).max(20).default(5),

  // Audio Pipelines
  VOICE_STT_SILENCE_DURATION_MS: z.coerce.number().int().min(100).default(500),
  VOICE_MIN_UTTERANCE_MS: z.coerce.number().int().min(50).default(200),
  VOICE_MAX_UTTERANCE_MS: z.coerce.number().int().min(1000).default(15000),
  VOICE_TTS_VOICE_NAME: z.string().default('en-US-Standard-C'),

  // Status Embed
  STATUS_EMBED_INTERVAL_SEC: z.coerce.number().int().min(1).default(5),

  // Runtime
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  MOCK_ALL: z
    .string()
    .optional()
    .transform((val) => val === 'true')
});

export function loadConfig(overrides?: NodeJS.ProcessEnv): AppConfig {
  const envToValidate = overrides || process.env;

  // In test mode with MOCK_ALL enabled, inject fallbacks for required secrets if missing
  const isTestOrMock =
    envToValidate.NODE_ENV === 'test' ||
    envToValidate.MOCK_ALL === 'true';

  const merged = { ...envToValidate };
  if (isTestOrMock) {
    if (!merged.DISCORD_BOT_TOKEN) merged.DISCORD_BOT_TOKEN = 'mock_discord_bot_token';
    if (!merged.DISCORD_CLIENT_ID) merged.DISCORD_CLIENT_ID = '123456789012345678';
    if (!merged.DISCORD_CHAT_BRIDGE_CHANNEL_ID) merged.DISCORD_CHAT_BRIDGE_CHANNEL_ID = '123456789012345679';
    if (!merged.GEMINI_API_KEY) merged.GEMINI_API_KEY = 'mock_gemini_api_key';
  }

  const result = EnvSchema.safeParse(merged);

  if (!result.success) {
    const errorMessages = result.error.issues
      .map((issue) => `  - [${issue.path.join('.')}] ${issue.message}`)
      .join('\n');
    const fullMessage = `\n=======================================================\n❌ CONFIGURATION VALIDATION FAILED:\n${errorMessages}\n=======================================================\nPlease check your .env file or environment variables.\n`;
    console.error(fullMessage);
    throw new Error(`Environment validation failed:\n${errorMessages}`);
  }

  const data = result.data;

  return {
    discord: {
      token: data.DISCORD_BOT_TOKEN,
      clientId: data.DISCORD_CLIENT_ID,
      guildId: data.DISCORD_GUILD_ID,
      chatBridgeChannelId: data.DISCORD_CHAT_BRIDGE_CHANNEL_ID,
      statusChannelId: data.DISCORD_STATUS_CHANNEL_ID,
      voiceChannelId: data.DISCORD_VOICE_CHANNEL_ID,
      controlChannelId: data.DISCORD_CONTROL_CHANNEL_ID
    },
    rbac: {
      allowedRoleIds: data.DISCORD_ALLOWED_ROLE_IDS,
      allowedUserIds: data.DISCORD_ALLOWED_USER_IDS,
      adminRoleIds: data.DISCORD_ADMIN_ROLE_IDS,
      adminUserIds: data.DISCORD_ADMIN_USER_IDS
    },
    minecraft: {
      host: data.MINECRAFT_HOST,
      port: data.MINECRAFT_PORT,
      username: data.MINECRAFT_USERNAME,
      version: data.MINECRAFT_VERSION,
      auth: data.MINECRAFT_AUTH
    },
    gemini: {
      apiKey: data.GEMINI_API_KEY,
      model: data.GEMINI_MODEL,
      maxToolSteps: data.GEMINI_MAX_TOOL_STEPS
    },
    audio: {
      sttSilenceDurationMs: data.VOICE_STT_SILENCE_DURATION_MS,
      minUtteranceMs: data.VOICE_MIN_UTTERANCE_MS,
      maxUtteranceMs: data.VOICE_MAX_UTTERANCE_MS,
      ttsVoiceName: data.VOICE_TTS_VOICE_NAME
    },
    status: {
      embedIntervalSec: data.STATUS_EMBED_INTERVAL_SEC
    },
    runtime: {
      nodeEnv: data.NODE_ENV,
      logLevel: data.LOG_LEVEL,
      mockAll: data.MOCK_ALL
    }
  };
}

// Global cached config instance initialized on import
let globalConfig: AppConfig | null = null;
export function getConfig(): AppConfig {
  if (!globalConfig) {
    globalConfig = loadConfig();
  }
  return globalConfig;
}

export function resetConfigForTest(): void {
  globalConfig = null;
}
```

---

## 7. Component 6: `src/discord/commands/` Slash Commands Suite & Auto-Deferral Engine

### 7.1 Architecture & Directory Layout

```
src/discord/commands/
├── types.ts          # CommandDefinition, CommandContext, Subcommand interfaces
├── registry.ts       # CommandRegistry collection & deployer
├── deferral.ts       # 2.5s Auto-Deferral wrapper (withAutoDefer)
├── status.ts         # /status command (VIEWER)
├── connect.ts        # /connect command (ADMIN)
├── disconnect.ts     # /disconnect command (ADMIN)
├── task.ts           # /task command (OPERATOR)
├── stop.ts           # /stop command (OPERATOR)
├── inventory.ts      # /inventory command (VIEWER)
├── voice.ts          # /voice join & /voice leave command (OPERATOR)
├── help.ts           # /help command (VIEWER)
└── index.ts          # Public exports
```

### 7.2 The 2.5s Auto-Deferral Engine (`deferral.ts`)

Discord requires interaction acknowledgments within **3.0 seconds (3000ms)**. If an interaction handler takes 3.01s (e.g., executing a Gemini API planning query or connecting to Minecraft), Discord cancels the token and throws Error 10062: "Unknown interaction".

To eliminate this class of bug across all commands, the command dispatcher executes each command inside `withAutoDefer`:

```typescript
import type { ChatInputCommandInteraction } from 'discord.js';

export interface AutoDeferOptions {
  timeoutMs?: number;    // Default: 2500ms
  ephemeral?: boolean;    // Default: false
}

export async function withAutoDefer<T>(
  interaction: ChatInputCommandInteraction,
  options: AutoDeferOptions,
  task: () => Promise<T>
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 2500;
  const ephemeral = options.ephemeral ?? false;

  let timer: NodeJS.Timeout | null = null;

  // Race task completion against a 2.5s deferral timer
  const deferPromise = new Promise<void>((resolve) => {
    timer = setTimeout(async () => {
      try {
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ ephemeral });
        }
      } catch (err) {
        // Interaction might have been replied to right as timeout fired
      }
      resolve();
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      task(),
      deferPromise.then(() => task()) // If deferred, keep awaiting original task
    ]);
    return result;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
```

Furthermore, for commands known *a priori* to be long-running (`/task`, `/connect`), the command definition flags `deferImmediately: true`. The dispatcher invokes `await interaction.deferReply({ ephemeral: command.deferEphemeral })` **immediately** before running the handler.

### 7.3 Command Definitions

#### 1. `/status` (`status.ts`)
- **Tier**: `VIEWER`
- **Options**: None.
- **Description**: "Display current survival status, health, location, and active task of the bot."
- **Execution Flow**:
  1. Check if Minecraft agent is connected via `context.coordinator.getMinecraftStatus()`.
  2. If disconnected: reply with gray embed: `🔴 Bot is currently disconnected from Minecraft.`
  3. If connected: call `buildStatusEmbed(status)` and reply with rich embed (displaying 10-segment visual HP and hunger bars, coordinates, active task).

#### 2. `/connect` (`connect.ts`)
- **Tier**: `ADMIN`
- **Options**:
  - `host` (string, optional): Target Minecraft server hostname/IP (defaults to env `MINECRAFT_HOST`).
  - `port` (integer, optional, min: 1, max: 65535): Target Minecraft server port (defaults to env `MINECRAFT_PORT`).
  - `username` (string, optional): In-game username (defaults to env `MINECRAFT_USERNAME`).
- **Execution Flow**:
  1. Flag `deferImmediately: true`, `deferEphemeral: true`.
  2. Check if agent is already connected. If yes: reply `⚠️ Bot is already connected to ${currentHost}:${currentPort}. Use /disconnect first.`
  3. Invoke `context.coordinator.connectMinecraft({ host, port, username })`.
  4. Edit reply: `✅ Successfully initiated connection to ${host}:${port} as ${username}.`

#### 3. `/disconnect` (`disconnect.ts`)
- **Tier**: `ADMIN`
- **Options**: None.
- **Execution Flow**:
  1. Check if agent is connected. If no: reply ephemeral `⚠️ Bot is not currently connected to any Minecraft server.`
  2. Invoke `context.coordinator.disconnectMinecraft()`.
  3. Reply ephemeral `🔌 Disconnected Minecraft agent from server.`

#### 4. `/task` (`task.ts`)
- **Tier**: `OPERATOR`
- **Options**:
  - `goal` (string, required): The natural language survival goal (e.g., "gather 10 oak logs", "come to coordinates 100 64 -200", "follow Alice").
- **Execution Flow**:
  1. Flag `deferImmediately: true`.
  2. Validate bot connection status. If offline: reply `❌ Bot is offline. An Administrator must run /connect first.`
  3. Extract `goal = interaction.options.getString('goal', true).trim()`.
  4. Check input length (max 500 characters).
  5. Dispatch goal to `context.coordinator.assignTask({ goal, user: interaction.user.tag })`.
  6. Edit reply: rich embed showing `⏳ Task Assigned: "${goal}"` with status `Planning...`.

#### 5. `/stop` (`stop.ts`)
- **Tier**: `OPERATOR`
- **Options**: None.
- **Execution Flow**:
  1. Check if bot is connected. If offline: reply ephemeral `❌ Bot is offline.`
  2. Invoke `context.coordinator.stopCurrentTask()`.
  3. Halts active pathfinder movement, cancels ongoing mining, resets Gemini planner step loop to idle.
  4. Reply `🛑 Emergency Stop: Active task halted. Bot is now standing by.`

#### 6. `/inventory` (`inventory.ts`)
- **Tier**: `VIEWER`
- **Options**: None.
- **Execution Flow**:
  1. Check bot connection. If offline: reply ephemeral `❌ Bot is offline.`
  2. Retrieve inventory snapshot via `context.coordinator.getInventory()`.
  3. Format rich embed listing:
     - Equipped Armor: Helmet, Chestplate, Leggings, Boots.
     - Hand Items: Main Hand, Off Hand (Shield).
     - Storage Capacity: e.g. `Used: 14/36 slots (22 free)`.
     - Key Resources: Grouped count of ores, food, and logs.
  4. Reply with embed.

#### 7. `/voice` (`voice.ts`)
- **Subcommands**:
  - `/voice join [channel]`:
    - **Tier**: `OPERATOR`
    - **Options**: `channel` (Channel, optional, channelTypes: `[ChannelType.GuildVoice]`).
    - **Execution Flow**:
      1. Determine target voice channel: caller's current voice channel (`interaction.member.voice.channel`) or specified `channel` option.
      2. If caller not in voice and no channel specified: reply ephemeral `❌ You must be in a voice channel or specify a voice channel.`
      3. Verify bot permissions in channel (`Connect`, `Speak`).
      4. Invoke `context.coordinator.joinVoiceChannel(targetChannelId)`.
      5. Reply `🔊 Joined voice channel <#${targetChannelId}>. Listening for voice commands.`
  - `/voice leave`:
    - **Tier**: `OPERATOR`
    - **Execution Flow**:
      1. Verify bot is in a voice channel in this guild.
      2. Invoke `context.coordinator.leaveVoiceChannel(guildId)`.
      3. Reply `🔇 Disconnected from voice channel.`

#### 8. `/help` (`help.ts`)
- **Tier**: `VIEWER`
- **Options**: None.
- **Execution Flow**:
  1. Generate rich embed displaying:
     - **Command Directory**: List of commands categorized by tier (Viewer, Operator, Admin).
     - **Fair-Play Survival Rules**: Visible block mining only, 4.5m physical reach, no cheat commands (`/tp`, `/give`).
     - **Voice Controls**: Instructions on voice channel activation.
  2. Reply with embed.

### 7.4 Command Registry & REST Deployer (`registry.ts`)

```typescript
import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import type { CommandDefinition } from './types.js';
import type { AppConfig } from '../config/types.js';

export class CommandRegistry {
  private commands = new Map<string, CommandDefinition>();

  public register(command: CommandDefinition): void {
    if (this.commands.has(command.name)) {
      throw new Error(`Duplicate command registration for '/${command.name}'`);
    }
    this.commands.set(command.name, command);
  }

  public get(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  public getAll(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  public async deploy(config: AppConfig): Promise<void> {
    const rest = new REST({ version: '10' }).setToken(config.discord.token);
    const body = this.getAll().map((cmd) => cmd.data.toJSON());

    if (config.discord.guildId) {
      // Instant deployment scoped to development guild
      await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
        { body }
      );
    } else {
      // Global deployment for production
      await rest.put(
        Routes.applicationCommands(config.discord.clientId),
        { body }
      );
    }
  }
}
```

---

## 8. Component 7: `src/discord/rbac.ts` Multi-Tier Access Control Engine

### 8.1 3-Tier Security Hierarchy

| Tier | Value | Eligible Operations | Default Authorization Criteria |
|---|---|---|---|
| **`VIEWER`** | 0 | `/status`, `/inventory`, `/help`, view embeds | All guild members; anyone with interaction access. |
| **`OPERATOR`** | 1 | `/task`, `/stop`, `/voice join`, `/voice leave`, speech actions | Guild Administrator, Guild Owner, or user ID in `DISCORD_ALLOWED_USER_IDS` / `DISCORD_ADMIN_USER_IDS`, or user holding any role in `DISCORD_ALLOWED_ROLE_IDS` / `DISCORD_ADMIN_ROLE_IDS`. |
| **`ADMIN`** | 2 | `/connect`, `/disconnect`, reconfiguration, shutdown | Guild Administrator, Guild Owner, or user ID in `DISCORD_ADMIN_USER_IDS`, or user holding any role in `DISCORD_ADMIN_ROLE_IDS`. |

### 8.2 Implementation: `src/discord/rbac.ts`

```typescript
import { PermissionFlagsBits } from 'discord.js';
import type { GuildMember, APIInteractionGuildMember, User, Guild } from 'discord.js';
import type { AppConfig } from '../config/types.js';

export enum RBACTier {
  VIEWER = 'VIEWER',
  OPERATOR = 'OPERATOR',
  ADMIN = 'ADMIN'
}

export interface RBACCheckResult {
  allowed: boolean;
  requiredTier: RBACTier;
  userTier: RBACTier;
  reason?: string;
}

export class RBACService {
  constructor(private config: AppConfig) {}

  public check(
    member: GuildMember | APIInteractionGuildMember | null,
    user: User,
    requiredTier: RBACTier,
    guild?: Guild | null
  ): RBACCheckResult {
    // 1. VIEWER is universally allowed
    if (requiredTier === RBACTier.VIEWER) {
      return { allowed: true, requiredTier, userTier: RBACTier.VIEWER };
    }

    // 2. Determine highest user tier
    const userTier = this.resolveUserTier(member, user, guild);

    // 3. Compare tiers
    const tierRanks: Record<RBACTier, number> = {
      [RBACTier.VIEWER]: 0,
      [RBACTier.OPERATOR]: 1,
      [RBACTier.ADMIN]: 2
    };

    const hasAccess = tierRanks[userTier] >= tierRanks[requiredTier];

    if (hasAccess) {
      return { allowed: true, requiredTier, userTier };
    }

    const reason =
      requiredTier === RBACTier.ADMIN
        ? '⛔ Permission Denied: This command requires Administrator privileges.'
        : '⛔ Permission Denied: This command requires Operator privileges to control the Minecraft agent.';

    return {
      allowed: false,
      requiredTier,
      userTier,
      reason
    };
  }

  private resolveUserTier(
    member: GuildMember | APIInteractionGuildMember | null,
    user: User,
    guild?: Guild | null
  ): RBACTier {
    const userId = user.id;

    // Check Admin User ID whitelist
    if (this.config.rbac.adminUserIds.includes(userId)) {
      return RBACTier.ADMIN;
    }

    // Check Guild Owner
    if (guild && guild.ownerId === userId) {
      return RBACTier.ADMIN;
    }

    // Check Discord Server Administrator Permission
    if (member && 'permissions' in member) {
      const perms = typeof member.permissions === 'string'
        ? BigInt(member.permissions)
        : member.permissions.bitfield;
      if ((BigInt(perms) & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) {
        return RBACTier.ADMIN;
      }
    }

    // Check Admin Role IDs
    const memberRoleIds = this.extractRoleIds(member);
    if (memberRoleIds.some((roleId) => this.config.rbac.adminRoleIds.includes(roleId))) {
      return RBACTier.ADMIN;
    }

    // Check Operator User ID whitelist
    if (this.config.rbac.allowedUserIds.includes(userId)) {
      return RBACTier.OPERATOR;
    }

    // Check Operator Role IDs
    if (memberRoleIds.some((roleId) => this.config.rbac.allowedRoleIds.includes(roleId))) {
      return RBACTier.OPERATOR;
    }

    // Default tier
    return RBACTier.VIEWER;
  }

  private extractRoleIds(member: GuildMember | APIInteractionGuildMember | null): string[] {
    if (!member) return [];
    if ('roles' in member) {
      if (Array.isArray(member.roles)) {
        return member.roles; // APIInteractionGuildMember
      }
      if (member.roles && 'cache' in member.roles) {
        return Array.from(member.roles.cache.keys()); // GuildMember
      }
    }
    return [];
  }
}
```

### 8.3 Security Audit Logging

All denied access attempts log structured security events:
```text
[RBAC Audit] DENIED: User Alice (ID: 345678901234567890) attempted tier OPERATOR command '/task' in guild 123456789012345678.
```
This guarantees visibility for server administrators and prevents silent authorization bypasses.

---

## 9. Component 8: `src/discord/client.ts` Discord Bot Client Wrapper

### 9.1 Contract Interface: `src/discord/types.ts`

Aligning with `PROJECT.md` line 120:

```typescript
import type { EmbedBuilder, MessagePayload, MessageCreateOptions } from 'discord.js';

export interface SlashCommandDefinition {
  name: string;
  description: string;
  tier: 'VIEWER' | 'OPERATOR' | 'ADMIN';
}

export interface UserMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorUsername: string;
  isBot: boolean;
  content: string;
}

export interface IDiscordGateway {
  registerCommands(commands: any[]): Promise<void>;
  sendMessage(channelId: string, content: string | MessagePayload | MessageCreateOptions): Promise<string>;
  updateEmbed(channelId: string, messageId: string, embed: EmbedBuilder): Promise<void>;
  joinVoice(channelId: string, guildId: string): Promise<any>;
  leaveVoice(guildId: string): Promise<void>;
  onCommand(handler: (interaction: any) => Promise<void>): void;
  onMessage(handler: (message: UserMessage) => Promise<void>): void;
}
```

### 9.2 Implementation: `src/discord/client.ts`

```typescript
import {
  Client,
  GatewayIntentBits,
  Events,
  ChatInputCommandInteraction,
  Message
} from 'discord.js';
import type { AppConfig } from '../config/types.js';
import type { RBACService } from './rbac.js';
import type { CommandRegistry } from './commands/registry.js';
import { withAutoDefer } from './commands/deferral.js';
import type { IDiscordGateway, UserMessage } from './types.js';

export class DiscordBotClient implements IDiscordGateway {
  private client: Client;
  private messageHandlers: Array<(message: UserMessage) => Promise<void>> = [];

  constructor(
    private config: AppConfig,
    private rbac: RBACService,
    private registry: CommandRegistry,
    private commandContext: any
  ) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
      ]
    });

    this.setupListeners();
  }

  public async start(): Promise<void> {
    if (this.config.runtime.mockAll) {
      console.log('[Discord Client] Running in offline mock mode, skipping live gateway login.');
      return;
    }

    await this.client.login(this.config.discord.token);
    console.log(`[Discord Client] Logged in as ${this.client.user?.tag}`);

    // Deploy slash commands
    await this.registry.deploy(this.config);
    console.log('[Discord Client] Slash commands deployed successfully.');
  }

  public async stop(): Promise<void> {
    this.client.destroy();
    console.log('[Discord Client] Gateway connection destroyed.');
  }

  public onMessage(handler: (message: UserMessage) => Promise<void>): void {
    this.messageHandlers.push(handler);
  }

  public onCommand(handler: (interaction: any) => Promise<void>): void {
    // Allows external subscribers if needed
  }

  public async sendMessage(channelId: string, content: any): Promise<string> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('send' in channel)) {
      throw new Error(`Channel ${channelId} not found or is not text-based`);
    }
    const sent = await channel.send(content);
    return sent.id;
  }

  public async updateEmbed(channelId: string, messageId: string, embed: any): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) {
      throw new Error(`Channel ${channelId} not found or is not text-based`);
    }
    const message = await channel.messages.fetch(messageId);
    await message.edit({ embeds: [embed] });
  }

  public async joinVoice(channelId: string, guildId: string): Promise<any> {
    // Coordinates with audio subsystem
    return null;
  }

  public async leaveVoice(guildId: string): Promise<void> {
    // Coordinates with audio subsystem
  }

  private setupListeners(): void {
    // 1. Interaction Routing with RBAC and Auto-Deferral
    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      await this.handleInteraction(interaction);
    });

    // 2. Inbound Message Handling for Chat Bridge
    this.client.on(Events.MessageCreate, async (msg: Message) => {
      if (msg.author.id === this.client.user?.id) return; // Prevent self-loop

      const userMsg: UserMessage = {
        id: msg.id,
        channelId: msg.channelId,
        authorId: msg.author.id,
        authorUsername: msg.author.username,
        isBot: msg.author.bot,
        content: msg.content
      };

      for (const handler of this.messageHandlers) {
        try {
          await handler(userMsg);
        } catch (err) {
          console.error('[Discord Client] Error in message handler:', err);
        }
      }
    });
  }

  private async handleInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
    const command = this.registry.get(interaction.commandName);
    if (!command) {
      await interaction.reply({ content: `❌ Unknown command: /${interaction.commandName}`, ephemeral: true });
      return;
    }

    // RBAC Security Check
    const rbacResult = this.rbac.check(
      interaction.member,
      interaction.user,
      command.tier,
      interaction.guild
    );

    if (!rbacResult.allowed) {
      console.warn(
        `[RBAC Audit] DENIED: User ${interaction.user.tag} (${interaction.user.id}) attempted /${command.name}`
      );
      await interaction.reply({
        content: rbacResult.reason || '⛔ Permission Denied.',
        ephemeral: true
      });
      return;
    }

    // Execute with Auto-Deferral Guard
    try {
      if (command.deferImmediately) {
        await interaction.deferReply({ ephemeral: command.deferEphemeral ?? false });
        await command.execute(interaction, this.commandContext);
      } else {
        await withAutoDefer(
          interaction,
          { timeoutMs: 2500, ephemeral: command.deferEphemeral ?? false },
          () => command.execute(interaction, this.commandContext)
        );
      }
    } catch (err: any) {
      console.error(`[Discord Client] Error executing command /${command.name}:`, err);
      const errorMessage = '❌ An error occurred while executing this command.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: errorMessage });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
  }
}
```

---

## 10. Concrete Step-by-Step Implementation Sequence

The implementer should execute the build in the following ordered steps:

```
Step 1: Project Root Manifest & Build Config
├── package.json (with exact dependencies, devDependencies, and scripts)
├── tsconfig.json (ES2022 / NodeNext / strict mode / sourceMap / declaration)
├── vitest.config.ts (node environment, test in-memory defaults)
└── .env.example (fully commented schema reference)

Step 2: Configuration & Environment Subsystem
├── src/config/types.ts (AppConfig interface)
└── src/config/env.ts (Zod schema, loadConfig, error reporting)

Step 3: RBAC Security Engine
└── src/discord/rbac.ts (RBACTier enum, RBACService, whitelist matching, admin bypass)

Step 4: Slash Command Architecture & Auto-Deferral
├── src/discord/commands/types.ts (CommandDefinition, CommandContext)
├── src/discord/commands/deferral.ts (withAutoDefer helper)
├── src/discord/commands/status.ts (/status)
├── src/discord/commands/connect.ts (/connect)
├── src/discord/commands/disconnect.ts (/disconnect)
├── src/discord/commands/task.ts (/task)
├── src/discord/commands/stop.ts (/stop)
├── src/discord/commands/inventory.ts (/inventory)
├── src/discord/commands/voice.ts (/voice join, /voice leave)
├── src/discord/commands/help.ts (/help)
├── src/discord/commands/registry.ts (CommandRegistry collection & REST deployer)
└── src/discord/commands/index.ts (Public export of all commands)

Step 5: Discord Client Wrapper
├── src/discord/types.ts (IDiscordGateway, UserMessage)
└── src/discord/client.ts (DiscordBotClient implementing IDiscordGateway)

Step 6: Unit Test Verification
├── test/unit/config/env.test.ts (Validation pass/fail, defaults, comma list parsing)
├── test/unit/discord/rbac.test.ts (Viewer, Operator, Admin tier checks, Administrator bypass)
├── test/unit/discord/deferral.test.ts (2.5s timer triggers deferReply, clean fast-path return)
└── test/unit/discord/commands.test.ts (All 8 commands registered, options verified)
```

---

## 11. Independent Verification Methods & Test Commands

To verify this implementation independently without external network connectivity:

1. **Clean TypeScript Build**:
   ```powershell
   npm.cmd run build
   ```
   *Expected Result*: Compiles cleanly with exit code `0`, outputting declaration files (`.d.ts`), source maps (`.js.map`), and ES modules in `./dist`.

2. **TypeScript Strict Typecheck**:
   ```powershell
   npm.cmd run typecheck
   ```
   *Expected Result*: Zero type errors under `strict: true` and `NodeNext`.

3. **Offline Vitest Suite**:
   ```powershell
   npm.cmd test
   ```
   *Expected Result*: 100% of unit tests pass in memory without external Discord Gateway or API token requirements.
