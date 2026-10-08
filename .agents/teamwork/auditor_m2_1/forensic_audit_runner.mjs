import { evaluateBlockExposure, CARDINAL_FACES, isExposingBlock } from '../../../dist/minecraft/perception/exposure.js';
import { checkLineOfSight, hasBlockLineOfSight } from '../../../dist/minecraft/perception/raycast.js';
import { getBlockDistanceToEye, getEntityDistanceToEye, assertBlockReach, assertEntityAttackReach, MAX_BLOCK_REACH_METERS, MAX_ENTITY_ATTACK_REACH_METERS } from '../../../dist/minecraft/fairplay/reach.js';
import { sanitizeMinecraftMessage, assertAllowedMinecraftChat, isPrivilegedCommand, BLOCKED_COMMANDS } from '../../../dist/minecraft/fairplay/commandSanitizer.js';
import { CombatCooldownController, CombatAction } from '../../../dist/minecraft/actions/combat.js';
import { AutoEatLoop, FOOD_DATABASE } from '../../../dist/minecraft/loops/autoEat.js';
import { AutoSleepLoop, isHostileMob } from '../../../dist/minecraft/loops/autoSleep.js';
import { AutoEquipLoop } from '../../../dist/minecraft/loops/autoEquip.js';

console.log('=== FORENSIC EMPIRICAL AUDIT: MILESTONE 2 ===\n');

// -------------------------------------------------------------
// CHECK 1: Surface exposure checks (anti-xray) 6 cardinal neighbors
// -------------------------------------------------------------
console.log('--- CHECK 1: Surface Exposure & Anti-Xray Analysis ---');
console.log('1.1 Cardinal faces count:', CARDINAL_FACES.length);
const faceDirections = CARDINAL_FACES.map(f => f.face);
console.log('1.2 Face directions defined:', faceDirections.join(', '));
const expected6 = ['+x', '-x', '+y', '-y', '+z', '-z'];
const hasAll6 = expected6.every(d => faceDirections.includes(d));
console.log('1.3 Genuinely includes all 6 cardinal directions:', hasAll6);

const worldStore = new Map();
const key = (p) => `${p.x},${p.y},${p.z}`;
const accessor = {
  getBlock: (p) => worldStore.get(key(p)) || null
};

const targetOre = { x: 10, y: 30, z: 10 };
worldStore.set(key(targetOre), { name: 'diamond_ore' });

// Case A: 6 solid neighbors
worldStore.set(key({ x: 11, y: 30, z: 10 }), { name: 'stone' }); // +x
worldStore.set(key({ x: 9, y: 30, z: 10 }), { name: 'stone' });  // -x
worldStore.set(key({ x: 10, y: 31, z: 10 }), { name: 'stone' }); // +y
worldStore.set(key({ x: 10, y: 29, z: 10 }), { name: 'stone' }); // -y
worldStore.set(key({ x: 10, y: 30, z: 11 }), { name: 'stone' }); // +z
worldStore.set(key({ x: 10, y: 30, z: 9 }), { name: 'stone' });  // -z

const fullyEncased = evaluateBlockExposure(accessor, targetOre);
console.log('1.4 Fully encased underground ore isExposed:', fullyEncased.isExposed);
console.log('1.5 Encased exposedFaces length:', fullyEncased.exposedFaces.length);

// Case B: Test exposure through EACH individual cardinal face independently
let exposedFaceVerificationPassed = true;
for (const { face, normal, faceCenterOffset } of CARDINAL_FACES) {
  // Reset all to stone
  worldStore.set(key({ x: 11, y: 30, z: 10 }), { name: 'stone' });
  worldStore.set(key({ x: 9, y: 30, z: 10 }), { name: 'stone' });
  worldStore.set(key({ x: 10, y: 31, z: 10 }), { name: 'stone' });
  worldStore.set(key({ x: 10, y: 29, z: 10 }), { name: 'stone' });
  worldStore.set(key({ x: 10, y: 30, z: 11 }), { name: 'stone' });
  worldStore.set(key({ x: 10, y: 30, z: 9 }), { name: 'stone' });

  // Open this face with air
  const nPos = { x: targetOre.x + normal.x, y: targetOre.y + normal.y, z: targetOre.z + normal.z };
  worldStore.set(key(nPos), { name: 'air' });

  const res = evaluateBlockExposure(accessor, targetOre);
  const center = res.exposedFaceCenters[0];
  const expectedCenter = {
    x: targetOre.x + faceCenterOffset.x,
    y: targetOre.y + faceCenterOffset.y,
    z: targetOre.z + faceCenterOffset.z
  };
  const match = res.isExposed && res.exposedFaces[0] === face &&
    center.x === expectedCenter.x && center.y === expectedCenter.y && center.z === expectedCenter.z;
  if (!match) exposedFaceVerificationPassed = false;
  console.log(`1.6 Face ${face}: exposed=${res.isExposed}, centerMatch=${match}`);
}
console.log('1.7 All 6 cardinal faces independently validated:', exposedFaceVerificationPassed);

// Case C: Unloaded chunk boundary (null) check
const nullAccessor = { getBlock: () => null };
const nullRes = evaluateBlockExposure(nullAccessor, targetOre);
console.log('1.8 Unloaded chunk boundary leaks vision (should be false):', nullRes.isExposed);

// -------------------------------------------------------------
// CHECK 2: Raycasting 3D voxel stepping (DDA) from player eye height
// -------------------------------------------------------------
console.log('\n--- CHECK 2: 3D Voxel Stepping (DDA) Raycasting ---');
const ddaWorld = new Map();
const ddaAccessor = {
  getBlock: (p) => ddaWorld.get(key(p)) || { name: 'air', transparent: true, boundingBox: 'empty' }
};

const eyePos = { x: 0.5, y: 65.62, z: 0.5 }; // Realistic player eye height (feet at y=64 + 1.62)
const targetBlock = { x: 3, y: 65, z: 0 };
const targetCenter = { x: 3.5, y: 65.5, z: 0.5 };
ddaWorld.set(key(targetBlock), { name: 'gold_ore', transparent: false, boundingBox: 'block' });

// Test 2.1: Clear line of sight through air
const clearRay = checkLineOfSight(ddaAccessor, eyePos, targetBlock, targetCenter, 16);
console.log('2.1 Clear path raycast visible:', clearRay.visible, 'distance:', clearRay.distance.toFixed(3));

// Test 2.2: Solid obstruction at intermediate voxel (x=2, y=65, z=0)
ddaWorld.set(key({ x: 2, y: 65, z: 0 }), { name: 'stone', transparent: false, boundingBox: 'block' });
const blockedRay = checkLineOfSight(ddaAccessor, eyePos, targetBlock, targetCenter, 16);
console.log('2.2 Obstructed path visible (should be false):', blockedRay.visible);
console.log('2.3 Obstructed voxel correctly identified:', blockedRay.hitVoxel, 'obstruction:', blockedRay.obstruction);

// Test 2.3: Transparent blocks (glass / water) allow line of sight
ddaWorld.set(key({ x: 2, y: 65, z: 0 }), { name: 'glass', transparent: true, boundingBox: 'block' });
const glassRay = checkLineOfSight(ddaAccessor, eyePos, targetBlock, targetCenter, 16);
console.log('2.4 Transparent glass allows raycast (should be true):', glassRay.visible);

// -------------------------------------------------------------
// CHECK 3: Reach clamping (<= 4.5m blocks, <= 3.5m entities)
// -------------------------------------------------------------
console.log('\n--- CHECK 3: Reach Clamping Mathematical Enforcement ---');
const eye = { x: 0, y: 65.62, z: 0 };

// Block reach tests: boundary at 4.50m
// Block at x=4, y=65, z=0 -> AABB closest point is x=4, y=65, z=0 -> dx=4, dy=-0.62, dz=0 -> dist = sqrt(16 + 0.3844) = 4.047m <= 4.5m
const blockAt4 = { x: 4, y: 65, z: 0 };
const dist4 = getBlockDistanceToEye(eye, blockAt4);
console.log('3.1 Block at 4m distance:', dist4.toFixed(3), 'assertBlockReach passes:', (() => {
  try { assertBlockReach(eye, blockAt4); return true; } catch { return false; }
})());

// Block positioned so closest point is exactly 4.50m
// Eye at (0, 0, 0), block min point at (4.50, 0, 0) -> dist = 4.50m
const eyeOrigin = { x: 0, y: 0, z: 0 };
const blockAt4_5 = { x: 4.50, y: 0, z: 0 };
const distExact4_5 = getBlockDistanceToEye(eyeOrigin, blockAt4_5);
console.log('3.2 Exact 4.50m block distance:', distExact4_5.toFixed(4), 'assert passes:', (() => {
  try { assertBlockReach(eyeOrigin, blockAt4_5); return true; } catch { return false; }
})());

// Block at 4.51m -> must throw
const blockAt4_51 = { x: 4.51, y: 0, z: 0 };
const dist4_51 = getBlockDistanceToEye(eyeOrigin, blockAt4_51);
let blockExceededCaught = false;
try {
  assertBlockReach(eyeOrigin, blockAt4_51);
} catch (e) {
  blockExceededCaught = e.name === 'ReachExceededError';
}
console.log('3.3 Out of reach block (4.51m) throws ReachExceededError:', blockExceededCaught, 'dist:', dist4_51.toFixed(3));

// Entity combat reach tests: boundary at 3.50m
const entityAt3_4 = { x: 3.4, y: 0, z: 0 };
const entDist3_4 = getEntityDistanceToEye(eyeOrigin, entityAt3_4);
console.log('3.4 Entity at 3.4m distance:', entDist3_4.toFixed(3), 'assert passes:', (() => {
  try { assertEntityAttackReach(eyeOrigin, entityAt3_4); return true; } catch { return false; }
})());

const entityAt3_51 = { x: 3.81, y: 0, z: 0 }; // entity box width 0.6, so minX is 3.81 - 0.3 = 3.51m
const entDist3_51 = getEntityDistanceToEye(eyeOrigin, entityAt3_51);
let entityExceededCaught = false;
try {
  assertEntityAttackReach(eyeOrigin, entityAt3_51);
} catch (e) {
  entityExceededCaught = e.name === 'ReachExceededError';
}
console.log('3.5 Out of reach entity (3.51m) throws ReachExceededError:', entityExceededCaught, 'dist:', entDist3_51.toFixed(3));

// -------------------------------------------------------------
// CHECK 4: Command sanitizer OP blocks & bypass stress tests
// -------------------------------------------------------------
console.log('\n--- CHECK 4: Command Sanitizer Bypass Stress Testing ---');
const cheatVectors = [
  '/tp Alice 100 64 100',
  '/TP Alice 100 64 100',
  '/teleport Bob',
  '/tphere Charlie',
  '//tp 0 100 0',
  '///tp 0 100 0',
  '   /tp Alice 0 100 0   ',
  '/minecraft:tp 100 64 100',
  '/bukkit:tp 100 64 100',
  '/essentials:tp 100 64 100',
  '/\u200Btp 100 64 100',       // Zero-width space
  '/\u200Ctp 100 64 100',       // Zero-width non-joiner
  '/\u200Dtp 100 64 100',       // Zero-width joiner
  '/\uFEFFtp 100 64 100',       // Byte order mark
  '/give @p diamond 64',
  '/GIVE @p diamond 64',
  '/minecraft:give @p diamond',
  '/setblock 0 64 0 diamond_block',
  '/fill 0 0 0 10 10 10 air',
  '/gamemode creative',
  '/gm 1',
  '/op hacker',
  '/deop admin',
  '/stop',
  '/kill @e',
  '/execute as @e run kill @s',
  '/function hack:nuke',
  '/time set day',
  '/weather clear',
];

let allCheatsBlocked = true;
let failedBypasses = [];
for (const cmd of cheatVectors) {
  const isBlocked = isPrivilegedCommand(cmd);
  if (!isBlocked) {
    allCheatsBlocked = false;
    failedBypasses.push(cmd);
  }
}
console.log('4.1 Total cheat/OP attack vectors tested:', cheatVectors.length);
console.log('4.2 All cheat vectors strictly blocked:', allCheatsBlocked);
if (!allCheatsBlocked) {
  console.log('FAILURES:', failedBypasses);
}

// Check safe chat messages
const safeMessages = [
  'hello world',
  'Does anyone know why /tp is disabled?',
  '/tell Alice hi',
  '/msg Bob let us meet at base',
  '/help',
];
let allSafeHandled = true;
for (const msg of safeMessages) {
  const res = sanitizeMinecraftMessage(msg);
  if (!res.allowed) allSafeHandled = false;
}
console.log('4.3 Legitimate chat & non-OP commands correctly allowed:', allSafeHandled);

// -------------------------------------------------------------
// CHECK 5: Combat cooldown timing tracking
// -------------------------------------------------------------
console.log('\n--- CHECK 5: Combat Cooldown Timing Tracking ---');
const cooldown = new CombatCooldownController();
console.log('5.1 Sword cooldown period (ms):', cooldown.getCooldownPeriodMs('diamond_sword'), '(expected: 625)');
console.log('5.2 Diamond axe cooldown period (ms):', cooldown.getCooldownPeriodMs('diamond_axe'), '(expected: 1000)');
console.log('5.3 Iron axe cooldown period (ms):', cooldown.getCooldownPeriodMs('iron_axe'), '(expected: 1111)');
console.log('5.4 Pickaxe cooldown period (ms):', cooldown.getCooldownPeriodMs('diamond_pickaxe'), '(expected: 833)');
console.log('5.5 Hand cooldown period (ms):', cooldown.getCooldownPeriodMs(undefined), '(expected: 250)');

cooldown.recordAttack();
const t0 = Date.now();
const waitTime = await cooldown.awaitFullGauge('diamond_sword');
const elapsed = Date.now() - t0;
console.log(`5.6 awaitFullGauge waited ${elapsed}ms (requested wait: ${waitTime}ms, period: 625ms)`);
console.log('5.7 Cooldown timing verified:', elapsed >= 600);

// -------------------------------------------------------------
// CHECK 6: Survival loops (AutoEat, AutoSleep, AutoEquip)
// -------------------------------------------------------------
console.log('\n--- CHECK 6: Survival Loops State & Rule Verification ---');

// 6.1 AutoEat
const mockBotForEat = {
  health: 20,
  food: 14,
  inventory: {
    items: () => [
      { name: 'bread', count: 5 },
      { name: 'golden_carrot', count: 5 },
      { name: 'pufferfish', count: 2 },
      { name: 'rotten_flesh', count: 2 }
    ]
  }
};
const autoEat = new AutoEatLoop(mockBotForEat);
console.log('6.1.1 shouldEat at food=14:', autoEat.shouldEat());
const selectedFood = autoEat.selectBestFood();
console.log('6.1.2 Selected best food (golden_carrot due to saturation):', selectedFood?.name);

mockBotForEat.food = 18;
mockBotForEat.health = 15; // Damaged -> needs regen
console.log('6.1.3 shouldEat when health=15, food=18 (should be false, thresh=17):', autoEat.shouldEat());
mockBotForEat.food = 17;
console.log('6.1.4 shouldEat when health=15, food=17 (should be true for regen):', autoEat.shouldEat());

// 6.2 AutoSleep
const mockBotForSleep = {
  game: { dimension: 'overworld' },
  time: { timeOfDay: 13000 },
  thunderState: 0,
  entities: {}
};
const autoSleep = new AutoSleepLoop(mockBotForSleep);
console.log('6.2.1 canSleepNow at night in overworld:', autoSleep.canSleepNow());

mockBotForSleep.game.dimension = 'the_nether';
console.log('6.2.2 canSleepNow in the Nether (should be false to prevent explosion):', autoSleep.canSleepNow());
mockBotForSleep.game.dimension = 'overworld';

// Monster exclusion check
const bedPosition = { x: 0, y: 64, z: 0 };
mockBotForSleep.entities = {
  '1': { name: 'zombie', position: { x: 7.9, y: 64, z: 0 } } // Within 8m horizontal
};
console.log('6.2.3 isMonsterNearby with zombie at 7.9m (should be true):', autoSleep.isMonsterNearby(bedPosition));

mockBotForSleep.entities = {
  '1': { name: 'zombie', position: { x: 8.5, y: 64, z: 0 } } // Beyond 8m horizontal
};
console.log('6.2.4 isMonsterNearby with zombie at 8.5m (should be false):', autoSleep.isMonsterNearby(bedPosition));

// 6.3 AutoEquip
const mockBotForEquip = {
  armor: {},
  inventory: {
    items: () => [
      { name: 'iron_chestplate', count: 1 },
      { name: 'diamond_chestplate', count: 1, defense: 8 },
      { name: 'diamond_chestplate', count: 1, defense: 8, enchantments: [{ name: 'protection', level: 4 }] },
      { name: 'netherite_chestplate', count: 1, defense: 8, toughness: 3, knockbackResistance: 1 },
    ]
  }
};
const autoEquip = new AutoEquipLoop(mockBotForEquip);
const ironScore = autoEquip.calculateArmorScore({ name: 'iron_chestplate' });
const diaScore = autoEquip.calculateArmorScore({ name: 'diamond_chestplate' });
const diaProt4Score = autoEquip.calculateArmorScore({ name: 'diamond_chestplate', enchantments: [{ name: 'protection', level: 4 }] });
const nethScore = autoEquip.calculateArmorScore({ name: 'netherite_chestplate', toughness: 3, knockbackResistance: 1 });

console.log(`6.3.1 Armor scores: Iron=${ironScore}, Diamond=${diaScore}, DiaProt4=${diaProt4Score}, Netherite=${nethScore}`);
console.log('6.3.2 Strict hierarchy holds (Iron < Diamond < DiaProt4 < Netherite):',
  ironScore < diaScore && diaScore < diaProt4Score && diaProt4Score < nethScore
);

console.log('\n=== AUDIT VERIFICATION COMPLETE ===');
