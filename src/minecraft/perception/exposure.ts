import type { Vec3Location } from '../types.js';

export type BlockFace = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

export interface FaceDefinition {
  face: BlockFace;
  normal: Vec3Location;
  faceCenterOffset: Vec3Location;
}

export const CARDINAL_FACES: FaceDefinition[] = [
  { face: '+x', normal: { x: 1, y: 0, z: 0 }, faceCenterOffset: { x: 1.0, y: 0.5, z: 0.5 } },
  { face: '-x', normal: { x: -1, y: 0, z: 0 }, faceCenterOffset: { x: 0.0, y: 0.5, z: 0.5 } },
  { face: '+y', normal: { x: 0, y: 1, z: 0 }, faceCenterOffset: { x: 0.5, y: 1.0, z: 0.5 } },
  { face: '-y', normal: { x: 0, y: -1, z: 0 }, faceCenterOffset: { x: 0.5, y: 0.0, z: 0.5 } },
  { face: '+z', normal: { x: 0, y: 0, z: 1 }, faceCenterOffset: { x: 0.5, y: 0.5, z: 1.0 } },
  { face: '-z', normal: { x: 0, y: 0, z: -1 }, faceCenterOffset: { x: 0.5, y: 0.5, z: 0.0 } },
];

export interface IBlockAccessor {
  getBlock(pos: Vec3Location): { name: string; transparent?: boolean; boundingBox?: string; material?: string } | null;
}

export interface BlockExposure {
  isExposed: boolean;
  exposedFaces: BlockFace[];
  exposedFaceCenters: Vec3Location[];
}

export const EXPOSING_BLOCK_NAMES = new Set<string>([
  'air',
  'cave_air',
  'void_air',
  'water',
  'flowing_water',
  'lava',
  'flowing_lava',
  'glass',
  'tinted_glass',
  'white_stained_glass',
  'orange_stained_glass',
  'magenta_stained_glass',
  'light_blue_stained_glass',
  'yellow_stained_glass',
  'lime_stained_glass',
  'pink_stained_glass',
  'gray_stained_glass',
  'light_gray_stained_glass',
  'cyan_stained_glass',
  'purple_stained_glass',
  'blue_stained_glass',
  'brown_stained_glass',
  'green_stained_glass',
  'red_stained_glass',
  'black_stained_glass',
  'oak_leaves',
  'birch_leaves',
  'spruce_leaves',
  'jungle_leaves',
  'acacia_leaves',
  'dark_oak_leaves',
  'mangrove_leaves',
  'cherry_leaves',
  'azalea_leaves',
  'flowering_azalea_leaves',
  'short_grass',
  'grass',
  'tall_grass',
  'fern',
  'large_fern',
  'dandelion',
  'poppy',
  'blue_orchid',
  'allium',
  'azure_bluet',
  'red_tulip',
  'orange_tulip',
  'white_tulip',
  'pink_tulip',
  'oxeye_daisy',
  'cornflower',
  'lily_of_the_valley',
  'torch',
  'wall_torch',
  'soul_torch',
  'soul_wall_torch',
  'lantern',
  'soul_lantern',
  'redstone_wire',
  'lever',
  'ladder',
  'scaffolding',
  'cobweb',
  'iron_bars',
  'chain',
  'snow',
  'carpet',
  'vine',
  'glow_lichen',
  'sculk_vein',
  'seagrass',
  'tall_seagrass',
  'kelp',
  'kelp_plant',
  'sugar_cane',
  'bamboo',
  'sweet_berry_bush',
  'fire',
  'soul_fire',
  'campfire',
  'soul_campfire',
]);

/**
 * Checks whether an adjacent block allows light/vision, exposing a face of the target block.
 * Returns false if neighbor is null (unloaded chunk), preventing x-ray leak across boundaries.
 */
export function isExposingBlock(
  block: { name: string; transparent?: boolean; boundingBox?: string; material?: string } | null
): boolean {
  if (!block) {
    return false; // Unloaded chunks do NOT expose faces (prevents x-ray)
  }

  const name = block.name.toLowerCase();

  if (name === 'air' || name === 'cave_air' || name === 'void_air') {
    return true;
  }

  if (block.transparent === true || block.boundingBox === 'empty') {
    return true;
  }

  if (EXPOSING_BLOCK_NAMES.has(name)) {
    return true;
  }

  // Suffix/type checks for Minecraft transparent/partial structures
  if (
    name.endsWith('_leaves') ||
    name.endsWith('_glass') ||
    name.endsWith('_glass_pane') ||
    name.endsWith('_slab') ||
    name.endsWith('_stairs') ||
    name.endsWith('_carpet') ||
    name.endsWith('_door') ||
    name.endsWith('_trapdoor') ||
    name.endsWith('_fence') ||
    name.endsWith('_fence_gate') ||
    name.endsWith('_wall') ||
    name.endsWith('_sapling')
  ) {
    return true;
  }

  return false;
}

/**
 * Checks the 6 cardinal neighbors of a block.
 * A block is exposed if at least one adjacent face borders an exposing (air/transparent) block.
 */
export function evaluateBlockExposure(world: IBlockAccessor, pos: Vec3Location): BlockExposure {
  const exposedFaces: BlockFace[] = [];
  const exposedFaceCenters: Vec3Location[] = [];

  const baseX = Math.floor(pos.x);
  const baseY = Math.floor(pos.y);
  const baseZ = Math.floor(pos.z);

  for (const { face, normal, faceCenterOffset } of CARDINAL_FACES) {
    const neighborPos: Vec3Location = {
      x: baseX + normal.x,
      y: baseY + normal.y,
      z: baseZ + normal.z,
    };

    const neighbor = world.getBlock(neighborPos);
    if (isExposingBlock(neighbor)) {
      exposedFaces.push(face);
      exposedFaceCenters.push({
        x: baseX + faceCenterOffset.x,
        y: baseY + faceCenterOffset.y,
        z: baseZ + faceCenterOffset.z,
      });
    }
  }

  return {
    isExposed: exposedFaces.length > 0,
    exposedFaces,
    exposedFaceCenters,
  };
}
