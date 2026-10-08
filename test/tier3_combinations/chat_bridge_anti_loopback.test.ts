/**
 * Tier 3 Cross-Feature Combination: Chat Bridge & Anti-Loopback Filter
 *
 * Verifies bidirectional relay between Minecraft server and Discord text channel,
 * Triple-Lock anti-loopback protections (Self-ID, Bot Accounts, 10s TTL Hash Deduplication,
 * [Discord] Prefix Echo Lock), death event alerting, and message sanitization/chunking.
 *
 * Test Cases: TC-T3-CBL-1 to TC-T3-CBL-6
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../harness/index.js';
import { AntiLoopbackFilter } from '../../src/bridge/antiLoopback.js';

describe('Tier 3: Chat Bridge & Anti-Loopback Filter (TC-T3-CBL-1 to TC-T3-CBL-6)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  // --------------------------------------------------------------------------
  // TC-T3-CBL-1: In-game player chat passes triple-lock and relays to Discord
  // --------------------------------------------------------------------------
  it('TC-T3-CBL-1: In-game player chat passes triple-lock and relays formatted message to Discord', async () => {
    // Stimulus: Player "Alex" sends in-game chat message
    await ctx.harness.simulateMinecraftChat('Alex', 'Hello world from the mines!');

    // Assert: Formatted message delivered to Discord chat bridge channel
    ctx.assertDiscordMessageSent('**[Minecraft] <Alex>** Hello world from the mines!');
  });

  // --------------------------------------------------------------------------
  // TC-T3-CBL-2: Minecraft server echo dropped via 10s TTL hash collision
  // --------------------------------------------------------------------------
  it('TC-T3-CBL-2: Minecraft server echo of Discord message is dropped via 10s TTL hash collision', async () => {
    const bridgeChannel = ctx.harness.config.discord.chatBridgeChannelId;
    const initialDiscordMessagesCount = ctx.harness.mockDiscord.sentMessages.length;

    // 1. Discord user sends message across the bridge
    await ctx.harness.simulateDiscordChatMessage(
      'Meeting at base coordinates',
      { id: 'user_alex_1', username: 'Alex' },
      bridgeChannel
    );

    // Allow leaky bucket queue to dispatch to Minecraft agent
    await ctx.harness.waitForChatBridgeFlushed();
    expect(ctx.harness.executedCommands.length).toBeGreaterThan(0);

    // 2. Minecraft server broadcasts the message back in-game (server echo)
    await ctx.harness.simulateMinecraftChat('Server', 'Meeting at base coordinates');

    // 3. Filter evaluates inbound echo: matches TTL hash -> DROPPED (DUPLICATE_TTL_HASH)
    // No echo message should be re-sent to Discord
    ctx.assertNoDiscordMessageMatching((m) => m.content?.includes('<Server>') ?? false);
    expect(ctx.harness.mockDiscord.sentMessages.length).toBe(initialDiscordMessagesCount);
  });

  // --------------------------------------------------------------------------
  // TC-T3-CBL-3: In-game chat with [Discord] prefix dropped via Lock 2 prefix check
  // --------------------------------------------------------------------------
  it('TC-T3-CBL-3: In-game chat with [Discord] prefix is dropped via Lock 2 prefix check', async () => {
    // Stimulus: In-game message prefixed with [Discord]
    await ctx.harness.simulateMinecraftChat('EchoBot', '[Discord] <Alice>: Hi there from another bridge');

    // Filter evaluates content.startsWith('[Discord]') -> DROPPED (DISCORD_PREFIX_ECHO)
    ctx.assertNoDiscordMessageMatching((m) => m.content?.includes('Hi there from another bridge') ?? false);
  });

  // --------------------------------------------------------------------------
  // TC-T3-CBL-4: Bot self-ID and bot account filter locks drop loopback from Discord
  // --------------------------------------------------------------------------
  it('TC-T3-CBL-4: Bot self-ID and bot account filter locks drop loopback from Discord', async () => {
    const bridgeChannel = ctx.harness.config.discord.chatBridgeChannelId;

    // 1. Message authored by bot's own Discord clientId (Lock 1: SELF_BOT_ID)
    await ctx.harness.simulateDiscordChatMessage(
      'Self announcement message',
      { id: ctx.harness.config.discord.clientId, username: 'CompanionBot' },
      bridgeChannel
    );

    // 2. Message authored by third-party bot account (Lock 2: BOT_ACCOUNT)
    await ctx.harness.simulateDiscordChatMessage(
      'Automated webhook post',
      { id: 'bot_webhook_99', username: 'WebhookBot', bot: true },
      bridgeChannel
    );

    // Assert: Zero packets queued for Minecraft chat
    expect(ctx.harness.chatBridge.getQueueLength()).toBe(0);
    expect(ctx.harness.executedCommands).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // TC-T3-CBL-5: In-game death message relays to Discord as formatted alert
  // --------------------------------------------------------------------------
  it('TC-T3-CBL-5: In-game death message relays to Discord as formatted alert with skull emoji', async () => {
    // 1. Bot death message
    await ctx.harness.chatBridge.handleMinecraftDeath('CompanionBot was slain by Zombie');
    ctx.assertDiscordMessageSent('💀 **[Minecraft]** CompanionBot was slain by Zombie');

    // 2. Other player death message
    await ctx.harness.chatBridge.handleMinecraftDeath('Alex fell from a high place');
    ctx.assertDiscordMessageSent('💀 **[Minecraft]** Alex fell from a high place');
  });

  // --------------------------------------------------------------------------
  // TC-T3-CBL-6: Discord-to-Minecraft relay sanitizes dangerous control chars and chunks 256+ characters
  // --------------------------------------------------------------------------
  it('TC-T3-CBL-6: Discord-to-Minecraft relay sanitizes control characters, escapes mentions, and chunks 256+ chars', async () => {
    const bridgeChannel = ctx.harness.config.discord.chatBridgeChannelId;

    // Construct a 300+ character message with mentions and control characters
    const repeatedSentence = 'We need to gather iron ingots and cobblestone for the base perimeter defense. ';
    const payload = `<@123456789012345678> <#987654321098765432> \x00\x07\x1F ${repeatedSentence.repeat(4)}`;

    expect(payload.length).toBeGreaterThan(256);

    // Send across Discord chat bridge
    await ctx.harness.simulateDiscordChatMessage(
      payload,
      { id: 'builder_user_1', username: 'Architect' },
      bridgeChannel
    );

    // Chunks should be queued in leaky bucket
    expect(ctx.harness.chatBridge.getQueueLength()).toBeGreaterThanOrEqual(2);

    // Wait for leaky bucket to flush all chunks to Minecraft agent
    await ctx.harness.waitForChatBridgeFlushed();

    expect(ctx.harness.executedCommands.length).toBeGreaterThanOrEqual(2);

    const allCommandsCombined = ctx.harness.executedCommands.join(' ');
    for (const cmd of ctx.harness.executedCommands) {
      // 1. Every chunk must strictly satisfy vanilla Minecraft 256-character limit
      expect(cmd.length).toBeLessThanOrEqual(256);

      // 2. Control characters must be stripped
      expect(cmd).not.toMatch(/[\x00-\x1F\x7F]/);

      // 3. Raw unescaped Discord mentions must not be present
      expect(cmd).not.toContain('<@123456789012345678>');
      expect(cmd).not.toContain('<#987654321098765432>');
    }

    // 4. Combined chunks must contain the sanitized mentions
    expect(allCommandsCombined).toContain('@user_123456789012345678');
    expect(allCommandsCombined).toContain('#channel_987654321098765432');

    // 4. Indexing tags [1/N] and [2/N] must be present in consecutive chunks
    const chunk1 = ctx.harness.executedCommands[0];
    const chunk2 = ctx.harness.executedCommands[1];
    expect(chunk1).toContain('[1/');
    expect(chunk2).toContain('[2/');
  });
});
