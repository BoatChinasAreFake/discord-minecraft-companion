import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { RBACTier } from '../rbac.js';
import type { CommandDefinition } from './types.js';
import type { CommandContext } from '../types.js';

export const connectCommand: CommandDefinition = {
  name: 'connect',
  description: 'Connect the bot to a Minecraft server.',
  tier: RBACTier.ADMIN,
  deferImmediately: true,
  deferEphemeral: true,
  data: new SlashCommandBuilder()
    .setName('connect')
    .setDescription('Connect the bot to a Minecraft server.')
    .addStringOption((opt) =>
      opt.setName('host').setDescription('Target Minecraft server host or IP').setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt.setName('port').setDescription('Target Minecraft server port').setMinValue(1).setMaxValue(65535).setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('username').setDescription('In-game bot player username').setRequired(false)
    ),
  async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
    const current = context.coordinator.getMinecraftStatus();
    if (current && current.connected) {
      const msg = `⚠️ Bot is already connected to ${current.server?.host || 'server'}:${current.server?.port || 25565}. Use /disconnect first.`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: msg });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
      return;
    }

    const host = interaction.options.getString('host') || 'localhost';
    const port = interaction.options.getInteger('port') || 25565;
    const username = interaction.options.getString('username') || 'DiscordSurvivalBot';

    await context.coordinator.connectMinecraft({ host, port, username });

    const replyMsg = `✅ Successfully initiated connection to ${host}:${port} as ${username}.`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: replyMsg });
    } else {
      await interaction.reply({ content: replyMsg, ephemeral: true });
    }
  }
};
