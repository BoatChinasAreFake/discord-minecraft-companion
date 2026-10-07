import { describe, it, expect } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { RBACService, RBACTier } from '../../src/discord/rbac.js';
import type { AppConfig } from '../../src/config/types.js';

function createMockConfig(overrides?: Partial<AppConfig['rbac']>): AppConfig {
  return {
    discord: {
      token: 'mock_token',
      clientId: 'bot_id',
      chatBridgeChannelId: 'bridge_chan',
    },
    rbac: {
      allowedRoleIds: ['op_role_1', 'op_role_2'],
      allowedUserIds: ['op_user_1'],
      adminRoleIds: ['admin_role_1'],
      adminUserIds: ['admin_user_1'],
      ...overrides,
    },
    minecraft: {
      host: 'localhost',
      port: 25565,
      username: 'Bot',
      version: '1.20.4',
      auth: 'offline',
    },
    gemini: {
      apiKey: 'key',
      model: 'gemini-3.8-flash',
      maxToolSteps: 5,
    },
    audio: {
      sttSilenceDurationMs: 500,
      minUtteranceMs: 200,
      maxUtteranceMs: 15000,
      ttsVoiceName: 'en-US-Standard-C',
    },
    status: {
      embedIntervalSec: 5,
    },
    runtime: {
      nodeEnv: 'test',
      logLevel: 'info',
      mockAll: true,
    },
  };
}

describe('RBAC Subsystem (src/discord/rbac.ts)', () => {
  const service = new RBACService(createMockConfig());

  it('TC-RBAC-1: VIEWER tier is universally allowed for all users', () => {
    const res = service.check(null, { id: 'random_user', username: 'Guest' } as any, RBACTier.VIEWER);
    expect(res.allowed).toBe(true);
    expect(res.requiredTier).toBe(RBACTier.VIEWER);
  });

  it('TC-RBAC-2: OPERATOR tier allowed for whitelisted user ID', () => {
    const res = service.check(null, { id: 'op_user_1', username: 'Operator' } as any, RBACTier.OPERATOR);
    expect(res.allowed).toBe(true);
    expect(res.userTier).toBe(RBACTier.OPERATOR);
  });

  it('TC-RBAC-3: OPERATOR tier allowed for user with whitelisted role', () => {
    const member = {
      roles: {
        cache: new Map([['op_role_1', true]]),
      },
    } as any;

    const res = service.check(member, { id: 'regular_user', username: 'Alice' } as any, RBACTier.OPERATOR);
    expect(res.allowed).toBe(true);
    expect(res.userTier).toBe(RBACTier.OPERATOR);
  });

  it('TC-RBAC-4: OPERATOR tier denied for regular user without roles', () => {
    const res = service.check(null, { id: 'unprivileged_user', username: 'Bob' } as any, RBACTier.OPERATOR);
    expect(res.allowed).toBe(false);
    expect(res.userTier).toBe(RBACTier.VIEWER);
    expect(res.reason).toContain('requires Operator privileges');
  });

  it('TC-RBAC-5: ADMIN tier allowed for whitelisted admin user ID', () => {
    const res = service.check(null, { id: 'admin_user_1', username: 'Admin' } as any, RBACTier.ADMIN);
    expect(res.allowed).toBe(true);
    expect(res.userTier).toBe(RBACTier.ADMIN);
  });

  it('TC-RBAC-6: ADMIN tier allowed for Guild Owner', () => {
    const guild = { ownerId: 'guild_owner_id' } as any;
    const res = service.check(null, { id: 'guild_owner_id', username: 'Owner' } as any, RBACTier.ADMIN, guild);
    expect(res.allowed).toBe(true);
    expect(res.userTier).toBe(RBACTier.ADMIN);
  });

  it('TC-RBAC-7: ADMIN tier allowed for member with Discord Administrator permission', () => {
    const member = {
      permissions: {
        has: (flag: bigint) => (flag & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator,
        bitfield: PermissionFlagsBits.Administrator,
      },
    } as any;

    const res = service.check(member, { id: 'server_admin', username: 'Charlie' } as any, RBACTier.ADMIN);
    expect(res.allowed).toBe(true);
    expect(res.userTier).toBe(RBACTier.ADMIN);
  });

  it('TC-RBAC-8: ADMIN tier denied for operator user who lacks admin permissions', () => {
    const res = service.check(null, { id: 'op_user_1', username: 'Operator' } as any, RBACTier.ADMIN);
    expect(res.allowed).toBe(false);
    expect(res.userTier).toBe(RBACTier.OPERATOR);
    expect(res.reason).toContain('requires Administrator privileges');
  });
});
