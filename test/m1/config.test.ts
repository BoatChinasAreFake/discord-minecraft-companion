import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig, resetConfigForTest, getConfig } from '../../src/config/env.js';

describe('Configuration Subsystem (src/config/)', () => {
  beforeEach(() => {
    resetConfigForTest();
  });

  it('TC-CFG-1: loads valid configuration with defaults in test mode', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      MOCK_ALL: 'true',
    });

    expect(config.discord.token).toBe('mock_discord_bot_token');
    expect(config.discord.clientId).toBe('123456789012345678');
    expect(config.minecraft.host).toBe('localhost');
    expect(config.minecraft.port).toBe(25565);
    expect(config.gemini.model).toBe('gemini-3.8-flash');
    expect(config.status.embedIntervalSec).toBe(5);
    expect(config.runtime.mockAll).toBe(true);
  });

  it('TC-CFG-2: correctly parses comma-separated lists for RBAC', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      MOCK_ALL: 'true',
      DISCORD_ALLOWED_ROLE_IDS: 'role1, role2 , role3',
      DISCORD_ALLOWED_USER_IDS: 'user1,user2',
      DISCORD_ADMIN_ROLE_IDS: 'admin_role',
      DISCORD_ADMIN_USER_IDS: 'admin_user',
    });

    expect(config.rbac.allowedRoleIds).toEqual(['role1', 'role2', 'role3']);
    expect(config.rbac.allowedUserIds).toEqual(['user1', 'user2']);
    expect(config.rbac.adminRoleIds).toEqual(['admin_role']);
    expect(config.rbac.adminUserIds).toEqual(['admin_user']);
  });

  it('TC-CFG-3: throws error when required variables are missing outside test mode', () => {
    expect(() => {
      loadConfig({
        NODE_ENV: 'production',
        MOCK_ALL: 'false',
        DISCORD_BOT_TOKEN: '',
      });
    }).toThrow(/Environment validation failed/);
  });

  it('TC-CFG-4: enforces port range boundaries (1-65535)', () => {
    expect(() => {
      loadConfig({
        NODE_ENV: 'test',
        MOCK_ALL: 'true',
        MINECRAFT_PORT: '70000',
      });
    }).toThrow(/MINECRAFT_PORT/);
  });

  it('TC-CFG-5: caches global config instance via getConfig()', () => {
    const cfg1 = getConfig();
    const cfg2 = getConfig();
    expect(cfg1).toBe(cfg2);
  });
});
