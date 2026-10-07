import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { RBACTier } from '../rbac.js';
import type { CommandDefinition } from './types.js';
import type { CommandContext } from '../types.js';

export const helpCommand: CommandDefinition = {
  name: 'help',
  description: 'View bot commands, fair-play survival rules, and controls.',
  tier: RBACTier.VIEWER,
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('View bot commands, fair-play survival rules, and controls.'),
  async execute(interaction: ChatInputCommandInteraction, _context: CommandContext): Promise<void> {
    const embed = {
      title: '📖 Discord & Minecraft Survival Companion — Help',
      color: 0x9b59b6,
      fields: [
        {
          name: '👁️ Viewer Commands',
          value: '• `/status` — View real-time health, hunger, coords, and active task\n• `/inventory` — View equipped gear and storage slots\n• `/help` — Display this guide',
          inline: false
        },
        {
          name: '⚙️ Operator Commands',
          value: '• `/task <goal>` — Assign high-level goals (e.g. "gather 10 logs")\n• `/stop` — Emergency halt current movement and task\n• `/voice join [channel]` — Join voice for 2-way speech interaction\n• `/voice leave` — Disconnect bot from voice channel',
          inline: false
        },
        {
          name: '🛡️ Admin Commands',
          value: '• `/connect [host] [port] [username]` — Connect bot to Minecraft server\n• `/disconnect` — Disconnect bot from server',
          inline: false
        },
        {
          name: '⚖️ Strict Fair-Play Survival Rules',
          value: 'The agent operates strictly as a regular survival player:\n• **No X-Ray / Hidden Chunk Querying**: Only mines visible/exposed blocks\n• **Vanilla Reach**: Maximum 4.5 blocks reach distance\n• **No Privileged Commands**: Never uses `/tp`, `/give`, or `/gamemode`\n• **Survival Needs**: Auto-eats food and sleeps in nearby beds at night',
          inline: false
        }
      ],
      footer: { text: 'Survival AI Companion • Help & Rules' },
      timestamp: new Date().toISOString()
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [embed as any] });
    } else {
      await interaction.reply({ embeds: [embed as any] });
    }
  }
};
