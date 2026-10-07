import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { RBACTier } from '../rbac.js';
import type { CommandDefinition } from './types.js';
import type { CommandContext } from '../types.js';

export const taskCommand: CommandDefinition = {
  name: 'task',
  description: 'Assign a natural language survival goal or task to the Minecraft bot.',
  tier: RBACTier.OPERATOR,
  deferImmediately: true,
  data: new SlashCommandBuilder()
    .setName('task')
    .setDescription('Assign a natural language survival goal or task to the Minecraft bot.')
    .addStringOption((opt) =>
      opt.setName('goal').setDescription('Natural language goal (e.g. gather 10 oak logs)').setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
    const status = context.coordinator.getMinecraftStatus();
    if (!status || !status.connected) {
      const msg = '❌ Bot is offline. An Administrator must run /connect first.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: msg });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
      return;
    }

    const goal = (interaction.options.getString('goal', true) || '').trim();
    if (!goal) {
      const msg = '❌ Task goal cannot be empty.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: msg });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
      return;
    }

    if (goal.length > 500) {
      const msg = '❌ Task goal must be 500 characters or fewer.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: msg });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
      return;
    }

    await context.coordinator.assignTask({
      goal,
      user: interaction.user.tag ?? interaction.user.username
    });

    const replyMsg = `⏳ **Task Assigned**: "${goal}"\nPlanning and executing fair-play actions...`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: replyMsg });
    } else {
      await interaction.reply({ content: replyMsg });
    }
  }
};
