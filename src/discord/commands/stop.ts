import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { RBACTier } from '../rbac.js';
import type { CommandDefinition } from './types.js';
import type { CommandContext } from '../types.js';

export const stopCommand: CommandDefinition = {
  name: 'stop',
  description: 'Emergency stop: Halts current task, movements, and active actions.',
  tier: RBACTier.OPERATOR,
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Emergency stop: Halts current task, movements, and active actions.'),
  async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
    const status = context.coordinator.getMinecraftStatus();
    if (!status || !status.connected) {
      const msg = '❌ Bot is offline.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: msg });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
      return;
    }

    await context.coordinator.stopCurrentTask();

    const replyMsg = '🛑 Emergency Stop: Active task halted. Bot is now standing by.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: replyMsg });
    } else {
      await interaction.reply({ content: replyMsg });
    }
  }
};
