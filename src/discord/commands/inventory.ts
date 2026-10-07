import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { RBACTier } from '../rbac.js';
import type { CommandDefinition } from './types.js';
import type { CommandContext } from '../types.js';

export const inventoryCommand: CommandDefinition = {
  name: 'inventory',
  description: 'View current equipped gear and inventory storage.',
  tier: RBACTier.VIEWER,
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('View current equipped gear and inventory storage.'),
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

    const inv = context.coordinator.getInventory();
    const gear = inv.gear ?? status.gear;

    const used = inv.usedSlots ?? 0;
    const total = inv.totalSlots ?? 36;
    const free = inv.freeSlots ?? Math.max(0, total - used);

    const embed = {
      title: `🎒 Inventory & Equipment: ${status.username}`,
      color: 0x3498db,
      fields: [
        {
          name: '⚔️ Weapons & Tools',
          value: `Main Hand: \`${gear?.mainHand || 'Air'}\`\nOff Hand: \`${gear?.offHand || 'Air'}\``,
          inline: false
        },
        {
          name: '🛡️ Armor',
          value: `Helmet: \`${gear?.helmet || 'None'}\`\nChestplate: \`${gear?.chestplate || 'None'}\`\nLeggings: \`${gear?.leggings || 'None'}\`\nBoots: \`${gear?.boots || 'None'}\``,
          inline: false
        },
        {
          name: '📦 Capacity',
          value: `Used: **${used}/${total}** slots\nFree: **${free}** slots`,
          inline: true
        },
        {
          name: '💎 Key Items',
          value: inv.keyItemsSummary || 'None',
          inline: true
        }
      ],
      footer: { text: 'Survival AI Companion • Inventory' },
      timestamp: new Date().toISOString()
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [embed as any] });
    } else {
      await interaction.reply({ embeds: [embed as any] });
    }
  }
};
