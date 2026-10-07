import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
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
    }
  }
});
