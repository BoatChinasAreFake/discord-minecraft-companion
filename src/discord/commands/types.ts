import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder
} from 'discord.js';
import type { RBACTier } from '../rbac.js';
import type { CommandContext } from '../types.js';

export interface CommandDefinition {
  name: string;
  description: string;
  tier: RBACTier;
  deferImmediately?: boolean;
  deferEphemeral?: boolean;
  data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder | any;
  execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void>;
}
