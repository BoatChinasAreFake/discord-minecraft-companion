/**
 * Test Context & Domain-Specific Assertion Helpers.
 *
 * Wraps SimulationHarness into a clean, ergonomic test harness environment
 * with lifecycle management (setup, teardown, reset) and high-level assertions
 * covering Discord messages, embeds, Minecraft bot state, fair-play anti-cheat,
 * and voice/audio pipelines.
 */

import { expect } from 'vitest';
import {
  SimulationHarness,
  type SimulationHarnessOptions,
} from './simulationHarness.js';
import type { Vec3Location } from '../../src/minecraft/types.js';
import type { RecordedSentMessage } from '../mocks/mockDiscord.js';
import type { RecordedAudioPlayback } from '../mocks/mockVoice.js';
import type { EmbedData } from '../../src/discord/types.js';
import { AudioPriority } from '../../src/audio/types.js';
import { isPrivilegedCommand } from '../../src/minecraft/fairplay/commandSanitizer.js';

export interface TestContextOptions extends SimulationHarnessOptions {
  name?: string;
}

export class TestContext {
  public readonly harness: SimulationHarness;

  constructor(harness: SimulationHarness) {
    this.harness = harness;
  }

  // --------------------------------------------------------------------------
  // Lifecycle Management
  // --------------------------------------------------------------------------

  public async setup(): Promise<void> {
    await this.harness.start();
  }

  public async teardown(): Promise<void> {
    await this.harness.stop();
  }

  public reset(): void {
    this.harness.reset();
  }

  // --------------------------------------------------------------------------
  // Discord Text Assertions
  // --------------------------------------------------------------------------

  public assertDiscordMessageSent(
    matcher: string | RegExp | ((msg: RecordedSentMessage) => boolean),
    channelId?: string
  ): RecordedSentMessage {
    const messages = channelId
      ? this.harness.mockDiscord.getSentMessagesInChannel(channelId)
      : this.harness.mockDiscord.sentMessages;

    const found = messages.find((m) => {
      if (typeof matcher === 'string') {
        return m.content?.includes(matcher);
      }
      if (matcher instanceof RegExp) {
        return matcher.test(m.content ?? '');
      }
      return matcher(m);
    });

    if (!found) {
      const summary = messages.map((m) => `[${m.channelId}] "${m.content ?? ''}"`).join('\n  ');
      throw new Error(
        `Expected Discord message matching ${String(matcher)} was not sent in channel "${channelId ?? 'any'}".\nRecorded messages (${messages.length}):\n  ${summary || '(none)'}`
      );
    }

    return found;
  }

  public assertLastDiscordMessageContains(text: string, channelId?: string): RecordedSentMessage {
    const last = this.harness.mockDiscord.getLastSentMessage(channelId);
    if (!last) {
      throw new Error(
        `Expected Discord message containing "${text}", but no messages were sent in channel "${channelId ?? 'any'}".`
      );
    }

    expect(
      last.content,
      `Last sent Discord message does not contain expected substring "${text}". Actual content: "${last.content}"`
    ).toContain(text);

    return last;
  }

  public assertNoDiscordMessageMatching(
    matcher: string | RegExp | ((msg: RecordedSentMessage) => boolean),
    channelId?: string
  ): void {
    const messages = channelId
      ? this.harness.mockDiscord.getSentMessagesInChannel(channelId)
      : this.harness.mockDiscord.sentMessages;

    const found = messages.find((m) => {
      if (typeof matcher === 'string') {
        return m.content?.includes(matcher);
      }
      if (matcher instanceof RegExp) {
        return matcher.test(m.content ?? '');
      }
      return matcher(m);
    });

    if (found) {
      throw new Error(
        `Expected no Discord message matching ${String(matcher)}, but found matching message in [${found.channelId}]: "${found.content}"`
      );
    }
  }

  // --------------------------------------------------------------------------
  // Discord Embed Assertions
  // --------------------------------------------------------------------------

  private getLatestStatusEmbed(): EmbedData {
    const fromEdited = this.harness.mockDiscord.editedMessages.map((e) => e.embed);
    const fromSent = this.harness.mockDiscord.sentMessages.flatMap((m) => m.embeds || []);
    const allEmbeds = [...fromSent, ...fromEdited];

    if (allEmbeds.length === 0) {
      throw new Error('No Discord status embed has been posted or updated yet.');
    }

    return allEmbeds[allEmbeds.length - 1];
  }

  public assertStatusEmbedUpdated(predicate?: (embed: EmbedData) => boolean): void {
    const fromEdited = this.harness.mockDiscord.editedMessages.map((e) => e.embed);
    const fromSent = this.harness.mockDiscord.sentMessages.flatMap((m) => m.embeds || []);
    const allEmbeds = [...fromSent, ...fromEdited];

    expect(allEmbeds.length, 'Expected at least one status embed to have been sent or updated').toBeGreaterThan(0);

    if (predicate) {
      const match = allEmbeds.some(predicate);
      expect(match, 'None of the sent or updated status embeds satisfied the expected predicate').toBe(true);
    }
  }

  public assertStatusEmbedColor(expectedColor: number): void {
    const latest = this.getLatestStatusEmbed();
    expect(latest.color, `Status embed color mismatch. Expected: ${expectedColor}, Actual: ${latest.color}`).toBe(expectedColor);
  }

  public assertStatusEmbedField(fieldName: string, expectedValueSubstring: string): void {
    const latest = this.getLatestStatusEmbed();
    const fields = latest.fields || [];
    const target = fields.find((f) => f.name.toLowerCase().includes(fieldName.toLowerCase()));

    if (!target) {
      const existing = fields.map((f) => `"${f.name}"`).join(', ');
      throw new Error(
        `Field "${fieldName}" not found in status embed. Existing fields: [${existing}]`
      );
    }

    expect(
      target.value,
      `Field "${target.name}" does not contain expected substring "${expectedValueSubstring}". Actual value: "${target.value}"`
    ).toContain(expectedValueSubstring);
  }

  // --------------------------------------------------------------------------
  // Minecraft State Assertions
  // --------------------------------------------------------------------------

  public assertBotPosition(expected: Vec3Location, tolerance = 0.5): void {
    const status = this.harness.minecraftAgent.getStatus();
    const pos = status.position;

    const dx = Math.abs(pos.x - expected.x);
    const dy = Math.abs(pos.y - expected.y);
    const dz = Math.abs(pos.z - expected.z);

    const within = dx <= tolerance && dy <= tolerance && dz <= tolerance;
    expect(
      within,
      `Bot position (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}) is outside tolerance (${tolerance}) of expected (${expected.x}, ${expected.y}, ${expected.z})`
    ).toBe(true);
  }

  public assertBotHealth(expectedHealth: number): void {
    const actualHealth = this.harness.mockBot.health;
    expect(
      actualHealth,
      `Bot health mismatch: expected ${expectedHealth}, got ${actualHealth}`
    ).toBe(expectedHealth);
  }

  public assertBotFood(expectedFood: number): void {
    const actualFood = this.harness.mockBot.food;
    expect(
      actualFood,
      `Bot food mismatch: expected ${expectedFood}, got ${actualFood}`
    ).toBe(expectedFood);
  }

  public assertInventoryContains(itemName: string, minCount = 1): void {
    const count = this.harness.mockBot.inventory.count(itemName);
    expect(
      count,
      `Inventory does not contain at least ${minCount}x "${itemName}". Actual count: ${count}`
    ).toBeGreaterThanOrEqual(minCount);
  }

  public assertWorldBlockAt(pos: Vec3Location, expectedName: string): void {
    const block = this.harness.mockWorld.getBlock(pos);
    const actualName = block?.name ?? 'air';
    expect(
      actualName,
      `World block at (${pos.x}, ${pos.y}, ${pos.z}) mismatch: expected "${expectedName}", got "${actualName}"`
    ).toBe(expectedName);
  }

  // --------------------------------------------------------------------------
  // Fair-Play & Anti-Cheat Invariant Assertions
  // --------------------------------------------------------------------------

  public assertNoPrivilegedCommandsExecuted(): void {
    for (const cmd of this.harness.executedCommands) {
      if (isPrivilegedCommand(cmd)) {
        throw new Error(
          `Fair-Play Violation: Privileged administrative command executed on Minecraft server: "${cmd}"`
        );
      }
    }

    expect(
      this.harness.fairPlayViolations,
      `Fair-Play Violations recorded during execution:\n  ${this.harness.fairPlayViolations.join('\n  ')}`
    ).toHaveLength(0);
  }

  public assertFairPlayPerceptionHonored(): void {
    expect(
      this.harness.fairPlayViolations,
      `Fair-Play perception violations detected:\n  ${this.harness.fairPlayViolations.join('\n  ')}`
    ).toHaveLength(0);
  }

  // --------------------------------------------------------------------------
  // Voice & Audio Assertions
  // --------------------------------------------------------------------------

  public assertAudioPlayed(
    predicate?: (rec: RecordedAudioPlayback) => boolean
  ): RecordedAudioPlayback {
    const recordings = this.harness.mockVoiceSession.playedRecordings;
    expect(
      recordings.length,
      'Expected synthetic audio playback in voice channel, but no audio was played.'
    ).toBeGreaterThan(0);

    if (predicate) {
      const match = recordings.find(predicate);
      if (!match) {
        throw new Error(
          `Audio was played (${recordings.length} recordings), but none satisfied the expected predicate.`
        );
      }
      return match;
    }

    return recordings[recordings.length - 1];
  }

  public assertEmergencyAudioPreemptionOccurred(): void {
    const hasEmergencyRecording = this.harness.mockVoiceSession.playedRecordings.some(
      (r) => r.priority === AudioPriority.EMERGENCY || r.priority === 'EMERGENCY'
    );
    const hasPreemptionEvent =
      this.harness.emergencyPreemptions.length > 0 || this.harness.preemptedItems.length > 0;

    expect(
      hasEmergencyRecording || hasPreemptionEvent,
      'Expected emergency audio preemption to have occurred, but neither emergency playback nor queue preemption was detected.'
    ).toBe(true);
  }

  public assertNoAudioPlayed(): void {
    const count = this.harness.mockVoiceSession.playedRecordings.length;
    expect(
      count,
      `Expected no audio to be played in voice channel, but found ${count} audio recording(s).`
    ).toBe(0);
  }
}

/**
 * Creates and initializes a TestContext instance wrapping SimulationHarness.
 */
export async function createTestContext(options?: TestContextOptions): Promise<TestContext> {
  const harness = new SimulationHarness(options);
  const context = new TestContext(harness);
  await context.setup();
  return context;
}
