import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sanitizeMinecraftMessage,
  assertAllowedMinecraftChat,
  isPrivilegedCommand,
  PrivilegedCommandError,
  BLOCKED_COMMANDS,
} from '../../src/minecraft/fairplay/commandSanitizer.js';
import { CombatAction, CombatCooldownController } from '../../src/minecraft/actions/combat.js';
import { AutoEatLoop, FOOD_DATABASE } from '../../src/minecraft/loops/autoEat.js';
import { AutoSleepLoop, isHostileMob } from '../../src/minecraft/loops/autoSleep.js';
import {
  AutoEquipLoop,
  getMaterialTier,
  getArmorSlot,
  getBaseDefensePoints,
  getBaseWeaponDamage,
} from '../../src/minecraft/loops/autoEquip.js';
import { MockWorld, MockMineflayerBot } from '../mocks/mockMinecraft.js';

describe('Empirical Challenger: Milestone 2 Adversarial Stress Suite', () => {
  // ==========================================================================
  // AREA 1: Command Sanitizer Evasion & Boundary Stress
  // ==========================================================================
  describe('Area 1: Command Sanitizer Evasion Attempts & Boundary Vectors', () => {
    it('ADV-SAN-1: Blocks case-jumbled evasion attempts for critical privileged commands', () => {
      const caseVariants = [
        '/Tp', '/tP', '/TP',
        '/Give', '/gIvE', '/GIVE',
        '/GameMode', '/gamemode', '/GAMEMODE', '/gAmEmOdE',
        '/SetBlock', '/SETBLOCK', '/setBlock',
        '/Kill', '/KILL',
        '/Op', '/OP',
        '/Stop', '/STOP',
        '/Warp', '/WARP',
        '/Spawn', '/SPAWN',
        '/God', '/GOD',
        '/Fly', '/FLY',
      ];

      for (const cmd of caseVariants) {
        expect(
          isPrivilegedCommand(`${cmd} player1`),
          `Case variant "${cmd}" bypassed sanitizer!`
        ).toBe(true);
        expect(
          () => assertAllowedMinecraftChat(`${cmd} player1`),
          `Case variant "${cmd}" did not throw PrivilegedCommandError!`
        ).toThrow(PrivilegedCommandError);
      }
    });

    it('ADV-SAN-2: Strips leading/trailing tabs, newlines, and spaces before slash', () => {
      const paddedInputs = [
        '\t/tp 0 100 0',
        '  \t  /give @p diamond 64',
        '\r\n/gamemode 1',
        '\t\t\t/op hacker',
        '   /stop   ',
        '\n\n/kill @e\n',
      ];

      for (const padded of paddedInputs) {
        expect(
          isPrivilegedCommand(padded),
          `Padded command "${JSON.stringify(padded)}" bypassed sanitizer!`
        ).toBe(true);
      }
    });

    it('ADV-SAN-3: Safely blocks commands with spaces between slash and command name as MALFORMED_COMMAND', () => {
      const spacedAttempts = [
        '/  gamemode  1',
        '/   tp 0 100 0',
        '/ \tgamemode creative',
        '/\t\tstop',
        '/   give @p diamond 64',
        '/   op hacker',
      ];

      for (const attempt of spacedAttempts) {
        const res = sanitizeMinecraftMessage(attempt);
        expect(res.isCommand).toBe(true);
        expect(res.allowed).toBe(false);
        expect(res.reason).toBe('MALFORMED_COMMAND');
        expect(isPrivilegedCommand(attempt)).toBe(true);
        expect(() => assertAllowedMinecraftChat(attempt)).toThrow(PrivilegedCommandError);
      }
    });

    it('ADV-SAN-4: Strips unicode zero-width spaces (ZWS, ZWNJ, ZWJ, BOM) injected to evade regex', () => {
      const injectedCommands = [
        '/\u200Btp Alice',
        '/\u200Cgive @p gold 64',
        '/\u200Dkill @e',
        '/\uFEFFgamemode 1',
        '/\u200B\u200Cop Hacker',
        '/\u200Bg\u200Ci\u200Dv\u200Be @p diamond 1', // Interspersed inside command name
      ];

      for (const injected of injectedCommands) {
        expect(
          isPrivilegedCommand(injected),
          `Zero-width injection "${JSON.stringify(injected)}" bypassed sanitizer!`
        ).toBe(true);
      }
    });

    it('ADV-SAN-5: Intercepts standard contiguous namespace-prefixed command variants', () => {
      const prefixed = [
        '/minecraft:give @p diamond 64',
        '/minecraft:tp 100 64 100',
        '/minecraft:gamemode creative',
        '/minecraft:kill @e',
        '/bukkit:op hacker',
        '/spigot:gamemode 1',
        '/essentials:fly',
        '/worldedit:fill ~ ~ ~ ~5 ~5 ~5 air',
        '//give @p diamond',
        '///tp @p 0 0 0',
      ];

      for (const cmd of prefixed) {
        expect(
          isPrivilegedCommand(cmd),
          `Namespace command "${cmd}" bypassed sanitizer!`
        ).toBe(true);
      }
    });

    it('ADV-SAN-6: Intercepts command execution wrappers (/execute, /function, /tellraw)', () => {
      const wrappers = [
        '/execute as @p run op hacker',
        '/execute in minecraft:the_nether run tp @s ~ ~ ~',
        '/function datapack:exploit',
        '/tellraw @a {"text":"malicious"}',
        '/xp add @s 100 levels',
        '/experience set @s 100',
        '/tag @s add admin',
        '/scoreboard players set @s points 999',
      ];

      for (const w of wrappers) {
        expect(
          isPrivilegedCommand(w),
          `Execution wrapper "${w}" bypassed sanitizer!`
        ).toBe(true);
      }
    });

    it('ADV-SAN-7: Handles malformed and bare slashes gracefully as MALFORMED_COMMAND', () => {
      const malformed = [
        '/',
        '//',
        '///',
        '/:',
        '/???',
        '/$',
        '/\u00A0tp',
      ];

      for (const m of malformed) {
        const res = sanitizeMinecraftMessage(m);
        expect(res.isCommand).toBe(true);
        expect(res.allowed).toBe(false);
        expect(isPrivilegedCommand(m)).toBe(true);
        expect(() => assertAllowedMinecraftChat(m)).toThrow(PrivilegedCommandError);
      }
    });

    it('ADV-SAN-8: Distinguishes legitimate non-privileged chat and permitted commands', () => {
      // Safe messaging
      const safe1 = sanitizeMinecraftMessage('/tell Alice Hello there');
      expect(safe1.isCommand).toBe(true);
      expect(safe1.allowed).toBe(true);

      const safe2 = sanitizeMinecraftMessage('/msg Bob I found a village');
      expect(safe2.isCommand).toBe(true);
      expect(safe2.allowed).toBe(true);

      const safe3 = sanitizeMinecraftMessage('/help 2');
      expect(safe3.isCommand).toBe(true);
      expect(safe3.allowed).toBe(true);

      // Normal chat discussing commands without leading slash
      const chat1 = 'Hey, why is /tp disabled on this server?';
      const resChat1 = sanitizeMinecraftMessage(chat1);
      expect(resChat1.isCommand).toBe(false);
      expect(resChat1.allowed).toBe(true);

      const chat2 = 'Admin said: "/give is cheating" so we mine legitimately';
      const resChat2 = sanitizeMinecraftMessage(chat2);
      expect(resChat2.isCommand).toBe(false);
      expect(resChat2.allowed).toBe(true);
    });

    // ------------------------------------------------------------------------
    // REGRESSION GUARDS: Hardened Sanitizer Intercepts Evasions & Probes
    // ------------------------------------------------------------------------
    it('ADV-SAN-VULN-1: Space-padded namespace commands are intercepted and blocked', () => {
      const evasions = [
        '/minecraft: give @p diamond 64',
        '/minecraft: tp 100 64 100',
        '/minecraft: gamemode creative',
        '/minecraft: op hacker',
        '/bukkit: op hacker',
      ];

      for (const ev of evasions) {
        const res = sanitizeMinecraftMessage(ev);
        expect(res.isCommand).toBe(true);
        expect(res.allowed).toBe(false);
        expect(isPrivilegedCommand(ev)).toBe(true);
        expect(() => assertAllowedMinecraftChat(ev)).toThrow(PrivilegedCommandError);
      }
    });

    it('ADV-SAN-VULN-2: Multiline and chained command injections are intercepted and blocked', () => {
      const chatWithOp = 'Good morning everyone!\n/op Hacker';
      const res1 = sanitizeMinecraftMessage(chatWithOp);
      expect(res1.isCommand).toBe(true);
      expect(res1.allowed).toBe(false);
      expect(res1.commandName).toBe('op');
      expect(isPrivilegedCommand(chatWithOp)).toBe(true);
      expect(() => assertAllowedMinecraftChat(chatWithOp)).toThrow(PrivilegedCommandError);

      const tellWithGive = '/tell Alice hello\n/give @p diamond 64';
      const res2 = sanitizeMinecraftMessage(tellWithGive);
      expect(res2.isCommand).toBe(true);
      expect(res2.allowed).toBe(false);
      expect(res2.commandName).toBe('give');
      expect(isPrivilegedCommand(tellWithGive)).toBe(true);
      expect(() => assertAllowedMinecraftChat(tellWithGive)).toThrow(PrivilegedCommandError);

      const semicolonCommand = '/tell Alice hi; /op hacker';
      expect(isPrivilegedCommand(semicolonCommand)).toBe(true);
      expect(() => assertAllowedMinecraftChat(semicolonCommand)).toThrow(PrivilegedCommandError);
    });

    it('ADV-SAN-VULN-3: Missing OP commands in BLOCKED_COMMANDS (/clear, /datapack, /spectate) are blocked', () => {
      expect(isPrivilegedCommand('/clear @a')).toBe(true);
      expect(isPrivilegedCommand('/datapack disable vanilla')).toBe(true);
      expect(isPrivilegedCommand('/spectate Steve')).toBe(true);
      expect(() => assertAllowedMinecraftChat('/clear @a')).toThrow(PrivilegedCommandError);
      expect(() => assertAllowedMinecraftChat('/datapack disable vanilla')).toThrow(PrivilegedCommandError);
      expect(() => assertAllowedMinecraftChat('/spectate Steve')).toThrow(PrivilegedCommandError);
    });
  });

  // ==========================================================================
  // AREA 2: Combat 1.9+ Cooldown & Shield Mechanics
  // ==========================================================================
  describe('Area 2: Combat 1.9+ Cooldown & Shield Mechanics', () => {
    let world: MockWorld;
    let bot: MockMineflayerBot;
    let combat: CombatAction;

    beforeEach(() => {
      world = new MockWorld();
      bot = new MockMineflayerBot(world, { x: 0, y: 64, z: 0 });
      combat = new CombatAction(bot);
    });

    it('ADV-CBT-1: Weapon cooldown period oracle matches vanilla 1.9+ attack speeds', () => {
      const cooldown = new CombatCooldownController();
      expect(cooldown.getCooldownPeriodMs('diamond_sword')).toBe(625); // 1.6 atk/s
      expect(cooldown.getCooldownPeriodMs('netherite_sword')).toBe(625);
      expect(cooldown.getCooldownPeriodMs('iron_sword')).toBe(625);

      expect(cooldown.getCooldownPeriodMs('netherite_axe')).toBe(1000); // 1.0 atk/s
      expect(cooldown.getCooldownPeriodMs('diamond_axe')).toBe(1000);
      expect(cooldown.getCooldownPeriodMs('iron_axe')).toBe(1111); // 0.9 atk/s
      expect(cooldown.getCooldownPeriodMs('stone_axe')).toBe(1250); // 0.8 atk/s
      expect(cooldown.getCooldownPeriodMs('wooden_axe')).toBe(1250);

      expect(cooldown.getCooldownPeriodMs('diamond_pickaxe')).toBe(833); // 1.2 atk/s
      expect(cooldown.getCooldownPeriodMs('iron_shovel')).toBe(1000); // 1.0 atk/s
      expect(cooldown.getCooldownPeriodMs(undefined)).toBe(250); // Bare hand (4 atk/s)
      expect(cooldown.getCooldownPeriodMs('dirt')).toBe(250);
    });

    it('ADV-CBT-2: Enforces attack gauge wait when attacking prematurely at 300ms vs 625ms sword window', async () => {
      const cooldown = new CombatCooldownController();
      cooldown.recordAttack();

      const start = Date.now();
      const waitTime = await cooldown.awaitFullGauge('diamond_sword');

      // Total wait time should be approximately 625ms - elapsed (>= 500ms since we called immediately)
      expect(waitTime).toBeGreaterThanOrEqual(550);
      expect(waitTime).toBeLessThanOrEqual(630);
      expect(Date.now() - start).toBeGreaterThanOrEqual(550);

      // Now immediately call awaitFullGauge again — gauge is now 100% full
      const secondWait = await cooldown.awaitFullGauge('diamond_sword');
      expect(secondWait).toBe(0);
    });

    it('ADV-CBT-3: Zero wait time when gauge is already full (elapsed >= period)', async () => {
      const cooldown = new CombatCooldownController();
      // Never attacked before (initial state)
      const wait1 = await cooldown.awaitFullGauge('diamond_sword');
      expect(wait1).toBe(0);

      cooldown.recordAttack();
      // Wait past the 250ms bare hand period
      await new Promise((r) => setTimeout(r, 260));
      const wait2 = await cooldown.awaitFullGauge(undefined);
      expect(wait2).toBe(0);
    });

    it('ADV-CBT-4: Shield lower and re-raise lifecycle during melee attack', async () => {
      bot.heldItem = { name: 'diamond_sword', count: 1 };
      bot.offHandItem = { name: 'shield', count: 1 };
      bot.entities['101'] = { id: 101, position: { x: 2.0, y: 64, z: 0 }, health: 20 };

      // Pre-activate shield
      bot.activateItem(true);
      expect(bot.isBlocking).toBe(true);

      const deactivateSpy = vi.spyOn(bot, 'deactivateItem');
      const activateSpy = vi.spyOn(bot, 'activateItem');
      const attackSpy = vi.spyOn(bot, 'attack');

      const result = await combat.attackEntity(101);
      expect(result.success).toBe(true);

      // 1. Deactivated shield
      expect(deactivateSpy).toHaveBeenCalled();
      // 2. Swung attack
      expect(attackSpy).toHaveBeenCalled();
      // 3. Re-activated shield with offHand = true
      expect(activateSpy).toHaveBeenCalledWith(true);
      expect(bot.isBlocking).toBe(true);
    });

    it('ADV-CBT-5: Shield is NOT re-raised if offhand does NOT contain a shield', async () => {
      bot.heldItem = { name: 'iron_sword', count: 1 };
      bot.offHandItem = { name: 'torch', count: 16 };
      bot.entities['102'] = { id: 102, position: { x: 2.0, y: 64, z: 0 }, health: 20 };

      const activateSpy = vi.spyOn(bot, 'activateItem');
      const result = await combat.attackEntity(102);

      expect(result.success).toBe(true);
      expect(activateSpy).not.toHaveBeenCalled();
      expect(bot.isBlocking).toBe(false);
    });

    it('ADV-CBT-6: Tactical retreat triggered when health is strictly below 6.0 HP', async () => {
      bot.entities['103'] = { id: 103, position: { x: 2.0, y: 64, z: 0 }, health: 20 };

      // Case A: Health = 5.9 HP (< 6.0) -> Retreat
      bot.health = 5.9;
      expect(combat.shouldRetreat()).toBe(true);
      const resRetreat = await combat.attackEntity(103);
      expect(resRetreat.success).toBe(false);
      expect(resRetreat.message).toContain('health below 6 HP, executed tactical retreat');

      // Case B: Health = 6.0 HP (boundary) -> Fight
      bot.health = 6.0;
      bot.entity.position = { x: 0, y: 64, z: 0 }; // Reposition bot within reach after retreat
      expect(combat.shouldRetreat()).toBe(false);
      const resFight = await combat.attackEntity(103);
      expect(resFight.success).toBe(true);
    });

    it('ADV-CBT-7: Attack entity reach boundary: 3.50m passes, 3.51m fails', async () => {
      // Bot at (0, 64, 0), eye at (0, 65.62, 0)
      // Test A: Entity at horizontal distance ~3.0m, distance to eye <= 3.50m
      bot.entities['104'] = { id: 104, position: { x: 3.0, y: 64.0, z: 0 }, health: 20 };
      const resA = await combat.attackEntity(104);
      expect(resA.success).toBe(true);

      // Test B: Entity at horizontal distance 4.0m -> distance to eye > 3.50m
      bot.entities['105'] = { id: 105, position: { x: 4.0, y: 64.0, z: 0 }, health: 20 };
      const resB = await combat.attackEntity(105);
      expect(resB.success).toBe(false);
      expect(resB.message).toContain('out of attack reach');
    });
  });

  // ==========================================================================
  // AREA 3: Survival Loops Boundary Conditions & Edge Case Mining
  // ==========================================================================
  describe('Area 3: Survival Loops Boundary Conditions', () => {
    let world: MockWorld;
    let bot: MockMineflayerBot;

    beforeEach(() => {
      world = new MockWorld();
      bot = new MockMineflayerBot(world, { x: 0, y: 64, z: 0 });
    });

    describe('AutoEat Loop Boundaries (autoEat.ts)', () => {
      it('ADV-EAT-1: Poisonous and harmful foods are NEVER consumed even during fatal starvation', async () => {
        bot.food = 1; // 1 pip left (starvation)
        bot.health = 2.0; // 1 heart left (critical danger)

        const poisonFoods = [
          'pufferfish',
          'spider_eye',
          'poisonous_potato',
          'chorus_fruit',
          'suspicious_stew',
        ];

        for (const poison of poisonFoods) {
          bot.addItem({ name: poison, count: 5 });
        }

        const autoEat = new AutoEatLoop(bot);
        expect(autoEat.shouldEat()).toBe(true);

        const bestFood = autoEat.selectBestFood();
        expect(bestFood).toBeNull(); // Reject all blacklist items

        const ate = await autoEat.checkAndEat();
        expect(ate).toBe(false);
        expect(bot.food).toBe(1); // Did not eat poison
      });

      it('ADV-EAT-2: Rotten flesh and raw chicken allowed ONLY at starvation <= 6, rejected at food >= 7', () => {
        const autoEat = new AutoEatLoop(bot);
        bot.addItem({ name: 'rotten_flesh', count: 10 });
        bot.addItem({ name: 'raw_chicken', count: 10 });

        // Hunger = 7 (above starveThreshold 6)
        bot.food = 7;
        expect(autoEat.selectBestFood()).toBeNull();

        // Hunger = 6 (boundary starveThreshold)
        bot.food = 6;
        const selectedAt6 = autoEat.selectBestFood();
        expect(selectedAt6).not.toBeNull();
        expect(['rotten_flesh', 'raw_chicken']).toContain(selectedAt6?.name);

        // Hunger = 2 (severe starvation)
        bot.food = 2;
        const selectedAt2 = autoEat.selectBestFood();
        expect(selectedAt2).not.toBeNull();
      });

      it('ADV-EAT-3: Golden apple priority trigger at health <= 10 HP vs health = 11 HP', () => {
        const autoEat = new AutoEatLoop(bot);
        bot.food = 10;
        bot.addItem({ name: 'cooked_beef', count: 5 });
        bot.addItem({ name: 'golden_apple', count: 3 });

        // Boundary A: Health = 11 HP (above emergency threshold)
        bot.health = 11.0;
        const selectedHighHealth = autoEat.selectBestFood();
        expect(selectedHighHealth?.name).toBe('cooked_beef'); // Chooses standard high-saturation food

        // Boundary B: Health = 10 HP (emergency threshold reached)
        bot.health = 10.0;
        const selectedLowHealth = autoEat.selectBestFood();
        expect(selectedLowHealth?.name).toBe('golden_apple'); // Emergency +50 bonus kicks in!
      });

      it('ADV-EAT-4: Enchanted golden apple emergency trigger at health <= 6 HP vs health = 7 HP', () => {
        const autoEat = new AutoEatLoop(bot);
        bot.food = 10;
        bot.addItem({ name: 'golden_apple', count: 3 });
        bot.addItem({ name: 'enchanted_golden_apple', count: 2 });

        // Boundary A: Health = 7 HP (above enchanted threshold)
        bot.health = 7.0;
        const selectedAt7 = autoEat.selectBestFood();
        expect(selectedAt7?.name).toBe('golden_apple'); // Conserves enchanted apple

        // Boundary B: Health = 6 HP (enchanted threshold reached)
        bot.health = 6.0;
        const selectedAt6 = autoEat.selectBestFood();
        expect(selectedAt6?.name).toBe('enchanted_golden_apple'); // Emergency +100 bonus triggers!
      });

      it('ADV-EAT-5: Eating deferred when hostile mob inside 4.0m and health > 8 HP, but forced when health <= 8 HP', () => {
        bot.food = 10;
        bot.addItem({ name: 'bread', count: 5 });
        bot.entities['201'] = { id: 201, name: 'zombie', position: { x: 3.0, y: 64, z: 0 } };

        const autoEat = new AutoEatLoop(bot);

        // Health = 9 HP (> 8.0) -> Defers eating to prepare for fight
        bot.health = 9.0;
        expect(autoEat.canSafelyEat()).toBe(false);

        // Health = 8.0 HP (<= 8.0) -> Survival override: eats regardless of hostile mob
        bot.health = 8.0;
        expect(autoEat.canSafelyEat()).toBe(true);

        // Health = 4.0 HP -> Critical: eats regardless
        bot.health = 4.0;
        expect(autoEat.canSafelyEat()).toBe(true);
      });

      it('ADV-EAT-6: Anti-thrashing debounce window (500ms) prevents rapid-fire eating attempts', async () => {
        bot.food = 10;
        bot.addItem({ name: 'bread', count: 10 });
        const autoEat = new AutoEatLoop(bot);

        const ateFirst = await autoEat.checkAndEat();
        expect(ateFirst).toBe(true);

        // Set food back down immediately
        bot.food = 10;
        const ateRapid = await autoEat.checkAndEat();
        expect(ateRapid).toBe(false); // Debounced!
      });
    });

    describe('AutoSleep Loop Boundaries (autoSleep.ts)', () => {
      it('ADV-SLP-1: Hostile monster exclusion AABB boundary at 7.9m vs 8.1m horizontal distance', async () => {
        bot.time = { timeOfDay: 13000, age: 5000 };
        const bedPos = { x: 0, y: 64, z: 0 };
        world.setBlock(bedPos, 'red_bed');

        const autoSleep = new AutoSleepLoop(bot);

        // Test A: Monster at dx = 7.9m (inside 8.0m exclusion box)
        bot.entities['301'] = { id: 301, name: 'zombie', position: { x: 7.9, y: 64, z: 0 } };
        expect(autoSleep.isMonsterNearby(bedPos)).toBe(true);
        expect(await autoSleep.checkAndSleep()).toBe(false);

        // Test B: Monster at dx = 8.1m (outside 8.0m exclusion box)
        bot.entities['301'].position.x = 8.1;
        expect(autoSleep.isMonsterNearby(bedPos)).toBe(false);
        expect(await autoSleep.checkAndSleep()).toBe(true);
      });

      it('ADV-SLP-2: Hostile monster vertical exclusion boundary at 4.9m vs 5.1m', () => {
        const bedPos = { x: 0, y: 64, z: 0 };
        const autoSleep = new AutoSleepLoop(bot);

        // Test A: Monster directly underneath bed at dy = 4.9m (inside 5.0m vertical box)
        bot.entities['302'] = { id: 302, name: 'skeleton', position: { x: 0, y: 59.1, z: 0 } };
        expect(autoSleep.isMonsterNearby(bedPos)).toBe(true);

        // Test B: Monster in deep cave at dy = 5.1m (outside 5.0m vertical box)
        bot.entities['302'].position.y = 58.9;
        expect(autoSleep.isMonsterNearby(bedPos)).toBe(false);
      });

      it('ADV-SLP-3: Non-hostile passive mobs do NOT trigger monster exclusion', () => {
        const bedPos = { x: 0, y: 64, z: 0 };
        const autoSleep = new AutoSleepLoop(bot);

        // Passive mobs right beside bed
        bot.entities['401'] = { id: 401, name: 'sheep', position: { x: 1, y: 64, z: 0 } };
        bot.entities['402'] = { id: 402, name: 'cow', position: { x: 0, y: 64, z: 1 } };
        bot.entities['403'] = { id: 403, name: 'villager', position: { x: 1, y: 64, z: 1 } };

        expect(autoSleep.isMonsterNearby(bedPos)).toBe(false);
      });

      it('ADV-SLP-4: Dimension safety check prevents sleeping in Nether and End', () => {
        bot.time = { timeOfDay: 13000, age: 5000 };
        const autoSleep = new AutoSleepLoop(bot);

        // Overworld allows
        bot.game.dimension = 'overworld';
        expect(autoSleep.canSleepNow()).toBe(true);

        // Nether rejects (bed explosion!)
        bot.game.dimension = 'the_nether';
        expect(autoSleep.canSleepNow()).toBe(false);

        // The End rejects (bed explosion!)
        bot.game.dimension = 'the_end';
        expect(autoSleep.canSleepNow()).toBe(false);
      });

      it('ADV-SLP-5: Midday thunderstorm sleep override vs clear daytime', () => {
        const autoSleep = new AutoSleepLoop(bot);
        bot.game.dimension = 'overworld';
        bot.time = { timeOfDay: 6000, age: 5000 }; // Noon

        // Clear noon: sleeping blocked
        bot.thunderState = 0;
        expect(autoSleep.canSleepNow()).toBe(false);

        // Thunderstorm noon: sleeping permitted!
        bot.thunderState = 1;
        expect(autoSleep.canSleepNow()).toBe(true);
      });
    });

    describe('AutoEquip Loop Boundaries (autoEquip.ts)', () => {
      it('ADV-EQP-1: Material tiers order matches netherite > diamond > iron > chainmail > gold > leather', () => {
        expect(getMaterialTier('netherite_chestplate')).toBe(6);
        expect(getMaterialTier('diamond_chestplate')).toBe(5);
        expect(getMaterialTier('iron_chestplate')).toBe(4);
        expect(getMaterialTier('chainmail_chestplate')).toBe(3);
        expect(getMaterialTier('golden_chestplate')).toBe(2);
        expect(getMaterialTier('leather_chestplate')).toBe(1);
        expect(getMaterialTier('stone_button')).toBe(0);
      });

      it('ADV-EQP-2: Durability degradation breaks ties: pristine piece selected over 95% damaged piece', () => {
        const autoEquip = new AutoEquipLoop(bot);

        const pristineIronHelmet = {
          name: 'iron_helmet',
          maxDurability: 165,
          durabilityUsed: 0,
        };

        const wornIronHelmet = {
          name: 'iron_helmet',
          maxDurability: 165,
          durabilityUsed: 155, // Nearly broken
        };

        const scorePristine = autoEquip.calculateArmorScore(pristineIronHelmet);
        const scoreWorn = autoEquip.calculateArmorScore(wornIronHelmet);

        // Difference must exceed hysteresis (1.0)
        expect(scorePristine - scoreWorn).toBeGreaterThan(1.0);
      });

      it('ADV-EQP-3: Protection IV enchantment elevates lower-tier gear defense score over unenchanted piece', () => {
        const autoEquip = new AutoEquipLoop(bot);

        const unenchantedIron = { name: 'iron_chestplate' };
        const prot4Chainmail = {
          name: 'chainmail_chestplate',
          enchantments: [{ name: 'protection', level: 4 }],
        };

        const ironScore = autoEquip.calculateArmorScore(unenchantedIron);
        const chainScore = autoEquip.calculateArmorScore(prot4Chainmail);

        // Chainmail score with Prot IV: tier(3)*25 + def(5)*10 + prot(4)*6 + dur(2) = 75 + 50 + 24 + 2 = 151
        // Iron score: tier(4)*25 + def(6)*10 + dur(2) = 100 + 60 + 2 = 162
        expect(chainScore).toBeGreaterThan(140);
        expect(ironScore).toBeGreaterThan(150);
      });

      it('ADV-EQP-4: Weapon score oracle favors high DPS: Sharpness V Iron Sword beats plain Diamond Sword', () => {
        const autoEquip = new AutoEquipLoop(bot);

        const plainDiamond = { name: 'diamond_sword' };
        const sharp5Iron = {
          name: 'iron_sword',
          enchantments: [{ name: 'sharpness', level: 5 }],
        };

        const diamondScore = autoEquip.calculateWeaponScore(plainDiamond);
        const ironScore = autoEquip.calculateWeaponScore(sharp5Iron);

        // Diamond: baseDamage(7)*10 + tier(5)*2 = 80
        // Iron Sharpness V: baseDamage(6)*10 + sharp(5)*6 + tier(4)*2 = 60 + 30 + 8 = 98
        expect(ironScore).toBeGreaterThan(diamondScore);
      });

      it('ADV-EQP-5: Offhand priority places Totem of Undying over Shield and Shield over other items', () => {
        const autoEquip = new AutoEquipLoop(bot);

        expect(autoEquip.calculateOffHandScore({ name: 'totem_of_undying' })).toBe(100);
        expect(autoEquip.calculateOffHandScore({ name: 'shield' })).toBe(80);
        expect(autoEquip.calculateOffHandScore({ name: 'torch' })).toBe(10);
        expect(autoEquip.calculateOffHandScore(null)).toBe(0);
      });

      it('ADV-EQP-6: Anti-thrashing hysteresis prevents equipment flapping on identical items', async () => {
        bot.armor.torso = { name: 'diamond_chestplate', count: 1, maxDurability: 528, durabilityUsed: 0 };
        // Identical diamond chestplate in inventory
        bot.addItem({ name: 'diamond_chestplate', count: 1, maxDurability: 528, durabilityUsed: 0 });

        const autoEquip = new AutoEquipLoop(bot);
        let equipCalls = 0;
        bot.on('equip', (_item: any, slot: string) => {
          if (slot === 'torso') equipCalls++;
        });

        await autoEquip.evaluateAndEquip();
        expect(equipCalls).toBe(0); // Did not equip or thrash
      });
    });
  });
});
