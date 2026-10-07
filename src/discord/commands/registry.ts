import { REST, Routes } from 'discord.js';
import type { CommandDefinition } from './types.js';
import type { AppConfig } from '../../config/types.js';

export class CommandRegistry {
  private commands = new Map<string, CommandDefinition>();

  public register(command: CommandDefinition): void {
    if (this.commands.has(command.name)) {
      throw new Error(`Duplicate command registration for '/${command.name}'`);
    }
    this.commands.set(command.name, command);
  }

  public get(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  public getAll(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  public async deploy(config: AppConfig): Promise<void> {
    const rest = new REST({ version: '10' }).setToken(config.discord.token);
    const body = this.getAll().map((cmd) => (cmd.data.toJSON ? cmd.data.toJSON() : cmd.data));

    if (config.discord.guildId) {
      await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
        { body }
      );
    } else {
      await rest.put(
        Routes.applicationCommands(config.discord.clientId),
        { body }
      );
    }
  }
}
