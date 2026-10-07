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

    console.warn(
      `[RBAC Audit] DENIED: User ${user?.username ?? 'Unknown'} (ID: ${user?.id ?? 'Unknown'}) attempted tier ${requiredTier} action.`
    );

    return {
      allowed: false,
      requiredTier,
      userTier,
      reason
    };
  }

  public resolveUserTier(
    member: GuildMember | APIInteractionGuildMember | null,
    user: User,
    guild?: Guild | null
  ): RBACTier {
    const userId = user?.id;

    // Check Admin User ID whitelist
    if (userId && this.config.rbac.adminUserIds.includes(userId)) {
      return RBACTier.ADMIN;
    }

    // Check Guild Owner
    if (
      typeof guild?.ownerId === 'string' &&
      guild.ownerId.trim().length > 0 &&
      typeof userId === 'string' &&
      userId.trim().length > 0 &&
      guild.ownerId === userId
    ) {
      return RBACTier.ADMIN;
    }

    // Check Discord Server Administrator Permission
    if (member && 'permissions' in member && member.permissions) {
      try {
        const anyPerms = member.permissions as any;
        if (typeof anyPerms.has === 'function' && anyPerms.has(PermissionFlagsBits.Administrator)) {
          return RBACTier.ADMIN;
        }
        const bitfield = anyPerms.bitfield !== undefined ? anyPerms.bitfield : anyPerms;
        const bitVal = typeof bitfield === 'bigint' ? bitfield : BigInt(bitfield);
        if ((bitVal & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) {
          return RBACTier.ADMIN;
        }
      } catch {
        // Ignore parsing issues and continue
      }
    }

    // Check Admin Role IDs
    const memberRoleIds = this.extractRoleIds(member);
    if (memberRoleIds.some((roleId) => this.config.rbac.adminRoleIds.includes(roleId))) {
      return RBACTier.ADMIN;
    }

    // Check Operator User ID whitelist
    if (userId && this.config.rbac.allowedUserIds.includes(userId)) {
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
      if (member.roles && typeof (member.roles as any).cache?.keys === 'function') {
        return Array.from((member.roles as any).cache.keys()); // GuildMember
      }
    }
    return [];
  }
}
