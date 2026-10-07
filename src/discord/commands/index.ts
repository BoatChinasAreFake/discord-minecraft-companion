import { CommandRegistry } from './registry.js';
import { statusCommand } from './status.js';
import { connectCommand } from './connect.js';
import { disconnectCommand } from './disconnect.js';
import { taskCommand } from './task.js';
import { stopCommand } from './stop.js';
import { inventoryCommand } from './inventory.js';
import { voiceCommand } from './voice.js';
import { helpCommand } from './help.js';

export * from './types.js';
export * from './deferral.js';
export * from './registry.js';
export * from './status.js';
export * from './connect.js';
export * from './disconnect.js';
export * from './task.js';
export * from './stop.js';
export * from './inventory.js';
export * from './voice.js';
export * from './help.js';

export function createDefaultCommandRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register(statusCommand);
  registry.register(connectCommand);
  registry.register(disconnectCommand);
  registry.register(taskCommand);
  registry.register(stopCommand);
  registry.register(inventoryCommand);
  registry.register(voiceCommand);
  registry.register(helpCommand);
  return registry;
}
