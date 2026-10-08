import { getBlockDistanceToEye, assertBlockReach, MAX_BLOCK_REACH_METERS } from '../../../dist/minecraft/fairplay/reach.js';

console.log('--- REFINED BLOCK REACH AABB TEST ---');
// Voxel [5, 6] x [0, 1] x [0, 1]
const blockPos = { x: 5, y: 0, z: 0 };

// Eye at (0.50, 0.50, 0.50):
// Closest point on [5, 6] is (5.0, 0.50, 0.50)
// dx = 0.50 - 5.0 = -4.50
// dy = 0.50 - 0.50 = 0
// dz = 0.50 - 0.50 = 0
// dist = 4.50000m
const eyeAt4_5 = { x: 0.50, y: 0.50, z: 0.50 };
const distExact = getBlockDistanceToEye(eyeAt4_5, blockPos);
console.log('Distance from (0.5, 0.5, 0.5) to voxel [5, 0, 0]:', distExact.toFixed(5));
console.log('Assert passes at exact 4.50m:', (() => {
  try { assertBlockReach(eyeAt4_5, blockPos); return true; } catch { return false; }
})());

// Now shift eye back by 0.02m to (0.48, 0.50, 0.50):
// dx = 0.48 - 5.0 = -4.52m > 4.50m
const eyeAt4_52 = { x: 0.48, y: 0.50, z: 0.50 };
const distBeyond = getBlockDistanceToEye(eyeAt4_52, blockPos);
console.log('Distance from (0.48, 0.5, 0.5) to voxel [5, 0, 0]:', distBeyond.toFixed(5));
let threw = false;
try {
  assertBlockReach(eyeAt4_52, blockPos);
} catch (e) {
  threw = e.name === 'ReachExceededError';
}
console.log('Assert throws ReachExceededError at 4.52m:', threw);

// Test block at integer coordinate x=5 from eye at (0, 0, 0):
// Closest point is x=5.0, distance=5.0m (> 4.5m)
const dist5 = getBlockDistanceToEye({ x: 0, y: 0, z: 0 }, blockPos);
console.log('Distance from origin to voxel [5, 0, 0]:', dist5.toFixed(5));
let threwAt5 = false;
try {
  assertBlockReach({ x: 0, y: 0, z: 0 }, blockPos);
} catch (e) {
  threwAt5 = e.name === 'ReachExceededError';
}
console.log('Assert throws ReachExceededError at 5.0m:', threwAt5);
