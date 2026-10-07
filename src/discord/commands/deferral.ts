import type { ChatInputCommandInteraction } from 'discord.js';

export interface AutoDeferOptions {
  timeoutMs?: number; // Default: 2500ms
  ephemeral?: boolean; // Default: false
}

export async function withAutoDefer<T>(
  interaction: ChatInputCommandInteraction,
  options: AutoDeferOptions,
  task: () => Promise<T>
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 2500;
  const ephemeral = options.ephemeral ?? false;

  let timer: NodeJS.Timeout | null = null;
  let deferredByTimer = false;

  const deferTimerPromise = new Promise<void>((resolve) => {
    timer = setTimeout(async () => {
      try {
        if (!interaction.deferred && !interaction.replied) {
          deferredByTimer = true;
          await interaction.deferReply({ ephemeral });
        }
      } catch {
        // Interaction might have been replied to right as timeout fired
      }
      resolve();
    }, timeoutMs);
  });

  try {
    const taskPromise = task();
    // Await the task, while the timer runs concurrently
    const result = await Promise.race([
      taskPromise,
      deferTimerPromise.then(() => taskPromise)
    ]);
    return result;
  } finally {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }
}
