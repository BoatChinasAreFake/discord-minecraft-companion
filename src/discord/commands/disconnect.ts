import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { RBACTier } from '../rbac.js';
import type { CommandDefinition } from './types.js';
import type { CommandContext } from '../types.js';

export const disconnectCommand: CommandDefinition = {
  name: 'disconnect',
  description: 'Disconnect the bot from the Minecraft server.',
  tier: RBACTier.ADMIN,
  data: new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('Disconnect the bot from the Minecraft server.'),
  async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
    const current = context.coordinator.getMinecraftStatus();
    if (!current || !current.connected) {
      const msg = '⚠️ Bot is not currently connected to any Minecraft server.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: msg });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
      return;
    }

    await context.coordinator.disconnectMinecraft();

    const replyMsg = '🔌 Disconnected Minecraft agent from server.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: replyMsg });
    } else {
      await interaction.reply({ content: replyMsg, ephemeral: true });
    }
  }
};
