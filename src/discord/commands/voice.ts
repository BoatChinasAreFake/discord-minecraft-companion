import { ChannelType, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { RBACTier } from '../rbac.js';
import type { CommandDefinition } from './types.js';
import type { CommandContext } from '../types.js';

export const voiceCommand: CommandDefinition = {
  name: 'voice',
  description: 'Manage bot voice channel connections.',
  tier: RBACTier.OPERATOR,
  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Manage bot voice channel connections.')
    .addSubcommand((sub) =>
      sub
        .setName('join')
        .setDescription('Join a voice channel and begin 2-way speech interaction.')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Target voice channel (defaults to your current voice channel)')
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('leave').setDescription('Disconnect from current voice channel.')
    ),
  async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId ?? undefined;

    if (subcommand === 'join') {
      const channelOption = interaction.options.getChannel('channel');
      let targetChannelId = channelOption?.id;

      if (!targetChannelId) {
        const member = interaction.member as GuildMember | null;
        if (member && 'voice' in member && member.voice?.channelId) {
          targetChannelId = member.voice.channelId;
        }
      }

      if (!targetChannelId) {
        const msg = '❌ You must be in a voice channel or specify a voice channel.';
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: msg });
        } else {
          await interaction.reply({ content: msg, ephemeral: true });
        }
        return;
      }

      await context.coordinator.joinVoiceChannel(targetChannelId, guildId);

      const msg = `🔊 Joined voice channel <#${targetChannelId}>. Listening for voice commands.`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: msg });
      } else {
        await interaction.reply({ content: msg });
      }
      return;
    }

    if (subcommand === 'leave') {
      await context.coordinator.leaveVoiceChannel(guildId);
      const msg = '🔇 Disconnected from voice channel.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: msg });
      } else {
        await interaction.reply({ content: msg });
      }
      return;
    }
  }
};
