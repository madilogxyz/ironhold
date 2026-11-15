// palette.js — the Foundry District look, in one place.
//
// Golden-hour light over sandstone, rusted steel and teal paint: warm key light,
// cool shadows, and the two team accents (Union amber, Watch teal) reused by the
// map, the bot uniforms and the HUD so the scene reads at a glance.

import * as THREE from 'three';

export const PAL = {
  sky: 0x33465c,
  fog: 0xb98d63,
  sun: 0xffb877,
  hemiSky: 0x7d93ad,
  hemiGround: 0x5c4a38,
  ground: 0x8a7a63,
  concrete: 0xc9b18c,
  concreteDark: 0x8d8272,
  stone: 0xa4916f,
  metal: 0x6f6a61,
  rust: 0x8a5a3c,
  teal: 0x2f6f6a,
  ochre: 0xa86f2e,
  crate: 0x9a7a4e,
  sandbag: 0x7a6a4f,
  charcoal: 0x3a3d40,
  amber: 0xe0a458,
  watchTeal: 0x43b8b0,
  skin: [0xd9a37e, 0xb97f56, 0x8a5a3b, 0xe8b98f],
  pants: 0x3d4148,
  boots: 0x2a2723,
};

// Shared MeshStandardMaterials. One material per surface keeps draw calls and
// state changes down; textures.js tints some of these with canvas maps.
const cache = new Map();
export function mat(color, opts = {}) {
  const key = color + '|' + (opts.rough ?? 0.92) + '|' + (opts.metal ?? 0.0) + '|' + (opts.map ?? '');
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshStandardMaterial({
    color, roughness: opts.rough ?? 0.92, metalness: opts.metal ?? 0.0,
  });
  if (opts.map) m.map = opts.map;
  if (opts.emissive) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.ei ?? 1; }
  cache.set(key, m);
  return m;
}

export function teamColor(team) {
  return team === 'atk' ? PAL.amber : PAL.watchTeal;
}
