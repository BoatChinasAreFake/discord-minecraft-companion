import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from './index.js';
import { AudioPriority } from '../../src/audio/types.js';

describe('Offline Simulation Harness & TestContext Core (test/harness/)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  describe('1. Lifecycle Controls (start, stop, reset)', () => {
    it('TC-HARN-1: initializes DI container with all mock subsystems and connects Minecraft agent', async () => {
      expect(ctx.harness.minecraftAgent.getStatus().connected).toBe(true);
      expect(ctx.harness.mockDiscord.registeredCommands.length).toBeGreaterThan(0);
      expect(ctx.harness.chatBridge.isBridgeRunning()).toBe(true);
    });

    it('TC-HARN-2: reset() restores default state, clears message sinks, and rebuilds terrain', async () => {
      // Modify state
      ctx.harness.simulateWorldBlock({ x: 5, y: 64, z: 5 }, 'diamond_ore');
      ctx.harness.simulateBotDamage(12);
      ctx.harness.simulateBotHunger(8);
      await ctx.harness.mockDiscord.sendMessage('bridge_channel_1', 'dirty message');

      expect(ctx.harness.mockWorld.getBlock({ x: 5, y: 64, z: 5 })?.name).toBe('diamond_ore');
      expect(ctx.harness.mockBot.health).toBe(12);

      // Reset
      ctx.reset();

      expect(ctx.harness.mockBot.health).toBe(20);
      expect(ctx.harness.mockBot.food).toBe(20);
      expect(ctx.harness.mockDiscord.sentMessages).toHaveLength(0);
      expect(ctx.harness.mockWorld.getBlock({ x: 5, y: 64, z: 5 })?.name).toBe('air');
    });

    it('TC-HARN-3: stop() gracefully halts active goals, intervals, and disconnects agent', async () => {
      await ctx.teardown();

      expect(ctx.harness.chatBridge.isBridgeRunning()).toBe(false);
      expect(ctx.harness.minecraftAgent.getStatus().connected).toBe(false);
    });
  });

  describe('2. Deterministic Slash Command Simulation', () => {
    it('TC-HARN-4: simulateSlashCommand executes /status and returns live status embed', async () => {
      const result = await ctx.harness.simulateSlashCommand({
        commandName: 'status',
      });

      expect(result.allowed).toBe(true);
      expect(result.replied).toBe(true);
      expect(result.replyEmbeds?.length).toBeGreaterThan(0);
      const embed = result.replyEmbeds![0];
      expect(embed.title).toContain('Minecraft Agent Status');
    });

    it('TC-HARN-5: simulateSlashCommand enforces RBAC and denies /task for unauthorized viewer', async () => {
      const result = await ctx.harness.simulateSlashCommand({
        commandName: 'task',
        options: { goal: 'mine 5 oak logs' },
        user: { id: 'unauthorized_viewer', username: 'GuestUser', bot: false },
        member: { id: 'unauthorized_viewer', roles: [] },
      });

      expect(result.allowed).toBe(false);
      expect(result.replyContent).toContain('Permission Denied');
    });

    it('TC-HARN-6: simulateSlashCommand executes /inventory and reports bot inventory', async () => {
      ctx.harness.mockBot.addItem({ name: 'iron_ingot', count: 5 });

      const result = await ctx.harness.simulateSlashCommand({
        commandName: 'inventory',
      });

      expect(result.allowed).toBe(true);
      expect(result.replied).toBe(true);
      expect(result.replyEmbeds?.length).toBeGreaterThan(0);
      const fields = result.replyEmbeds![0].fields || [];
      const invField = fields.find((f: any) => f.name.includes('Key Items'));
      expect(invField?.value).toContain('iron_ingot');
    });

    it('TC-HARN-7: simulateSlashCommand executes /help with command catalog', async () => {
      const result = await ctx.harness.simulateSlashCommand({
        commandName: 'help',
      });

      expect(result.allowed).toBe(true);
      expect(result.replied).toBe(true);
      expect(result.replyEmbeds?.[0].title).toContain('Survival Companion');
    });

    it('TC-HARN-8: simulateSlashCommand executes /stop to cancel active tasks', async () => {
      const result = await ctx.harness.simulateSlashCommand({
        commandName: 'stop',
      });

      expect(result.allowed).toBe(true);
      expect(result.replied).toBe(true);
      expect(result.replyContent).toContain('Emergency Stop');
    });
  });

  describe('3. Bidirectional Chat Bridge Simulation', () => {
    it('TC-HARN-9: simulateDiscordChatMessage relays Discord text to Minecraft chat', async () => {
      let relayedMessage: string | null = null;
      ctx.harness.minecraftAgent.on('chat', (_sender, msg) => {
        relayedMessage = msg;
      });

      await ctx.harness.simulateDiscordChatMessage('Hello from Discord!', {
        id: 'user_123',
        username: 'Alex',
        bot: false,
      });

      // Leaky-bucket processes in <= 50ms (interval is 10ms)
      await ctx.harness.waitForChatBridgeFlushed(1000);
      await ctx.harness.waitFor(() => relayedMessage !== null, 1000);

      expect(relayedMessage).toContain('[Discord] <Alex>: Hello from Discord!');
    });

    it('TC-HARN-10: simulateMinecraftChat relays in-game player chat to Discord channel', async () => {
      await ctx.harness.simulateMinecraftChat('Steve', 'Found a village nearby!');

      const msg = await ctx.harness.waitForDiscordMessage('Found a village nearby!');
      expect(msg.content).toContain('**[Minecraft] <Steve>** Found a village nearby!');
    });
  });

  describe('4. Multimodal Voice Simulation & STT/TTS Coordination', () => {
    it('TC-HARN-11: simulateUserVoicePrompt executes goal, streams progress, and synthesizes TTS playback', async () => {
      ctx.harness.simulateWorldBlock({ x: 2, y: 64, z: 0 }, 'oak_log');

      await ctx.harness.simulateUserVoicePrompt('voice_user_1', 'gather 1 oak_log');

      // Await until Gemini planner completes goal execution
      await ctx.harness.waitForPlannerCompletion(3000);

      // Verify progress reporting text sent to Discord
      ctx.assertDiscordMessageSent(/gatherResource/);

      // Verify audio playback was synthesized into voice channel
      const audio = ctx.assertAudioPlayed();
      expect(audio.totalBytes).toBeGreaterThan(44); // Valid WAV audio
      expect(audio.completed).toBe(true);
    });

    it('TC-HARN-12: simulateUserVoicePrompt with "stop" triggers emergency task cancellation', async () => {
      await ctx.harness.simulateUserVoicePrompt('voice_user_1', 'stop');

      await ctx.harness.waitForDiscordMessage(/Emergency Stop/);
      ctx.assertLastDiscordMessageContains('Emergency Stop');
    });
  });

  describe('5. World, Survival Loops & Alert Simulators', () => {
    it('TC-HARN-13: simulateBotDamage triggers low health emergency alert to Discord & AudioQueue', async () => {
      ctx.harness.simulateBotDamage(4.0);

      const alertMsg = await ctx.harness.waitForDiscordMessage(/SURVIVAL EMERGENCY.*Low health/);
      expect(alertMsg.content).toContain('4.0/20 hearts remaining');

      // Verify emergency preemption occurred
      ctx.assertEmergencyAudioPreemptionOccurred();
    });

    it('TC-HARN-14: simulateBotDamage(0) triggers player death survival alert and stops tasks', async () => {
      ctx.harness.simulateBotDamage(0);

      const alertMsg = await ctx.harness.waitForDiscordMessage(/Agent died in-game/);
      expect(alertMsg.content).toContain('Player died');
    });

    it('TC-HARN-15: simulateBotHunger updates bot food and status', () => {
      ctx.harness.simulateBotHunger(12, 4.0);
      ctx.assertBotFood(12);
      expect(ctx.harness.mockBot.foodSaturation).toBe(4.0);
    });

    it('TC-HARN-16: simulateWeather updates environmental conditions for survival loops', () => {
      ctx.harness.simulateWeather(true, true, 18000);
      expect(ctx.harness.mockBot.isRaining).toBe(true);
      expect(ctx.harness.mockBot.thunderState).toBe(1);
      expect(ctx.harness.mockBot.time.timeOfDay).toBe(18000);
    });
  });

  describe('6. Scripted Gemini Turns & Custom Handlers', () => {
    it('TC-HARN-17: scriptGeminiTurn overrides AI planner response with scripted tool calls', async () => {
      ctx.harness.scriptGeminiTurn({
        text: 'Custom plan executed',
        toolCalls: [
          {
            id: 'call_custom_1',
            name: 'reportStatus',
            args: { includeInventory: true, includePosition: true },
          },
        ],
      });

      await ctx.harness.coordinator.assignTask({
        goal: 'do something custom',
        user: 'Admin',
      });

      await ctx.harness.waitForPlannerCompletion(3000);

      ctx.assertDiscordMessageSent(/reportStatus/);
    });

    it('TC-HARN-18: setGeminiCustomHandler intercepts model turn decisions programmatically', async () => {
      ctx.harness.setGeminiCustomHandler(async (input) => {
        if (input.type === 'user') {
          return {
            text: 'I will navigate to 10 64 10',
            toolCalls: [
              {
                id: 'call_nav',
                name: 'goToCoordinates',
                args: { x: 10, y: 64, z: 10 },
              },
            ],
          };
        }
        return {
          text: 'Arrived at custom coordinates successfully.',
        };
      });

      await ctx.harness.coordinator.assignTask({
        goal: 'custom handler goal',
        user: 'Tester',
      });

      await ctx.harness.waitForPlannerCompletion(3000);

      ctx.assertBotPosition({ x: 10, y: 64, z: 10 });
    });
  });

  describe('7. Status Embed Synchronization & Domain Assertions', () => {
    it('TC-HARN-19: triggerStatusEmbedTick updates Discord embed and asserts fields', async () => {
      ctx.harness.mockBot.entity.position.set(100, 65, -200);
      ctx.harness.mockBot.health = 18;
      ctx.harness.mockBot.food = 19;

      const updated = await ctx.harness.triggerStatusEmbedTick(true);
      expect(updated).toBe(true);

      ctx.assertStatusEmbedUpdated();
      ctx.assertStatusEmbedField('Coordinates', '100');
      ctx.assertStatusEmbedField('Health', '18.0');
    });

    it('TC-HARN-20: fair-play assertions confirm no privileged commands or anti-cheat violations', async () => {
      ctx.assertNoPrivilegedCommandsExecuted();
      ctx.assertFairPlayPerceptionHonored();

      // Bot attempts legitimate chat
      ctx.harness.mockBot.chat('Hello world');
      ctx.assertNoPrivilegedCommandsExecuted();

      // Ensure anti-cheat sanitizer blocks OP cheat
      expect(() => {
        ctx.harness.mockBot.chat('/gamemode creative');
      }).toThrow(/CommandSanitizer Blocked/);
    });
  });
});
