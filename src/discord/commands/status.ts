import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { RBACTier } from '../rbac.js';
import { buildStatusEmbed } from '../embed.js';
import type { CommandDefinition } from './types.js';
import type { CommandContext } from '../types.js';

export const statusCommand: CommandDefinition = {
  name: 'status',
  description: 'Display current survival status, health, location, and active task of the bot.',
  tier: RBACTier.VIEWER,
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Display current survival status, health, location, and active task of the bot.'),
  async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
    const status = context.coordinator.getMinecraftStatus();
    const embed = buildStatusEmbed(status);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [embed as any] });
    } else {
      await interaction.reply({ embeds: [embed as any] });
    }
  }
};
