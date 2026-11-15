// world.js — the Foundry District: one original map, built from a data table.
//
// Every block in BLOCKS becomes a mesh and a collider from the same numbers, so
// what you see is exactly what stops a bullet. The map is a smelter yard at
// dusk: a furnace hall anchors site A in the north-west, container rows make
// site B in the north-east, and a pump house with double doors chokes the
// middle. Three lanes, two links, no dead ground.

import * as THREE from 'three';
import { PAL, mat } from './palette.js';
import { concreteTex, rustTex, crateTex, containerTex, hazardTex, groundTex } from './textures.js';
import { boxCollider } from './physics.js';

export const WORLD = {
  size: 84,
  colliders: [],
  minimapRects: [],
  nodes: [],
  sites: {
    A: { name: 'Furnace Yard', x: -22, z: -20, r: 7 },
    B: { name: 'Container Row', x: 22, z: -18, r: 7 },
  },
  spawns: {
    atk: [{ x: 0, z: 36, yaw: 0 }, { x: -4.5, z: 35, yaw: 0 }, { x: 4.5, z: 35, yaw: 0 }, { x: -8, z: 33, yaw: 0 }, { x: 8, z: 33, yaw: 0 }],
    def: [{ x: -13, z: -36, yaw: Math.PI }, { x: 9, z: -36, yaw: Math.PI }, { x: 0, z: -37.5, yaw: Math.PI }, { x: 20, z: -34, yaw: Math.PI }, { x: -24, z: -34, yaw: Math.PI }],
  },
  // where defenders settle at round start, per site, plus the mid watcher
  holds: {
    A: [{ x: -24.5, z: -25.5 }, { x: -15.5, z: -18.5 }],
    B: [{ x: 16.5, z: -14.5 }, { x: 26.5, z: -21.5 }],
    mid: [{ x: -2.2, z: -11.5 }],
  },
};

// [x, z, w, d, h, kind, baseY] — the whole map in one table.
const BLOCKS = [
  // perimeter
  [0, -42, 86, 1.2, 4.6, 'wall'], [0, 42, 86, 1.2, 4.6, 'wall'],
  [-42, 0, 1.2, 86, 4.6, 'wall'], [42, 0, 1.2, 86, 4.6, 'wall'],
  // attacker yard dressing
  [-14, 30, 2.2, 2.2, 0.95, 'crate'], [-14, 30, 2.2, 2.2, 0.95, 'crate', 0.95],
  [15, 32, 2.2, 2.2, 0.95, 'crate'], [14, 27, 6.4, 2.6, 2.6, 'containerO'],
  [-20, 22, 2.2, 2.2, 0.95, 'crate'], [-6, 20, 3.4, 1.1, 1.0, 'sandbag'],
  [8, 19, 2.2, 2.2, 0.95, 'crate'],
  // mid-south walls splitting the lanes
  [-11, 12, 8, 1, 3.2, 'wall'], [11, 12, 8, 1, 3.2, 'wall'],
  [-3, 10, 2.2, 2.2, 0.95, 'crate'], [4, 8, 2.2, 2.2, 0.95, 'crate'], [4, 8, 2.2, 2.2, 0.95, 'crate', 0.95],
  // pump house (mid): four walls, door gaps east and west
  [-3.4, -2, 1, 6, 3.4, 'wallDark'], [3.4, -2, 1, 6, 3.4, 'wallDark'],
  [0, -5.4, 5.8, 1, 3.4, 'wallDark'], [-1.9, 1.4, 2, 1, 3.4, 'wallDark'], [1.9, 1.4, 2, 1, 3.4, 'wallDark'],
  [0, -2, 7.8, 8, 0.35, 'metal', 3.4], // roof slab (visual + ceiling)
  // double doors choke, north of the pump house
  [-4.9, -8.5, 7.4, 1, 3.2, 'wall'], [4.9, -8.5, 7.4, 1, 3.2, 'wall'],
  [-9, -8.5, 1, 1, 3.2, 'wall'], [9, -8.5, 1, 1, 3.2, 'wall'],
  // mid cover
  [-6, -13, 2.2, 2.2, 0.95, 'crate'], [7, -15, 3.4, 1.1, 1.0, 'sandbag'],
  [0, -22, 2.2, 2.2, 0.95, 'crate'], [0, -22, 2.2, 2.2, 0.95, 'crate', 0.95], [-3, -25, 2.2, 2.2, 0.95, 'crate'],
  // A lane (west): containers make a corridor, crates break the sightline
  [-36, 14, 2.6, 12, 2.6, 'containerT'], [-30, 2, 2.2, 2.2, 0.95, 'crate'],
  [-24, 6, 6.4, 2.6, 2.6, 'containerO'], [-36, -6, 2.6, 10, 2.6, 'containerT'],
  [-27, -6, 3.4, 1.1, 1.0, 'sandbag'], [-18, -2, 2.2, 2.2, 0.95, 'crate'],
  // A site: the furnace and its yard
  [-28, -27, 11, 8, 5.2, 'furnace'], [-28, -27, 3, 6.5, 3, 'metal', 5.2], // chimney base on the roof
  [-13.5, -25, 6, 5, 3, 'wallDark'], [-22, -20, 2.2, 2.2, 0.95, 'crate'], [-22, -20, 2.2, 2.2, 0.95, 'crate', 0.95],
  [-17.5, -14.5, 3.4, 1.1, 1.0, 'sandbag'], [-26, -13, 2.2, 2.2, 0.95, 'crate'],
  [-31, -16, 1, 7, 3.2, 'wall'], [-15, -27.5, 1, 6, 3.2, 'wall'],
  // B lane (east)
  [36, 12, 2.6, 12, 2.6, 'containerT'], [28, 4, 2.2, 2.2, 0.95, 'crate'],
  [24, 8, 6.4, 2.6, 2.6, 'containerO'], [36, -6, 2.6, 10, 2.6, 'containerT'],
  [27, -5, 3.4, 1.1, 1.0, 'sandbag'], [17, -1, 2.2, 2.2, 0.95, 'crate'],
  // B site: container row, one stacked pair you can climb
  [15, -25, 12, 2.6, 2.6, 'containerT'], [15, -25, 12, 2.6, 2.6, 'containerO', 2.6],
  [27, -9, 2.6, 10, 2.6, 'containerT'], [8.6, -25, 2.2, 2.2, 0.95, 'crate'], [8.6, -22.8, 2.2, 2.2, 0.95, 'crate'],
  [20, -13.5, 3.4, 1.1, 1.0, 'sandbag'], [24, -19, 2.2, 2.2, 0.95, 'crate'],
  [31, -20, 1, 8, 3.2, 'wall'],
  // north wall behind the sites, with two gaps the Watch rotates through
  [-29, -30.5, 26, 1, 3.4, 'wall'], [-2, -30.5, 16, 1, 3.4, 'wall'], [27, -30.5, 30, 1, 3.4, 'wall'],
  // defender yard dressing
  [-20, -37, 2.2, 2.2, 0.95, 'crate'], [16, -38, 6.4, 2.6, 2.6, 'containerO'], [30, -36, 2.2, 2.2, 0.95, 'crate'],
  // scattered barrels and barriers (low cover)
  [-9, -19, 1.1, 1.1, 0.95, 'barrel'], [12, -20, 1.1, 1.1, 0.95, 'barrel'],
  [-33, 22, 1.1, 1.1, 0.95, 'barrel'], [33, 20, 1.1, 1.1, 0.95, 'barrel'],
  [0, 27, 4.2, 0.5, 1.05, 'hazard'], [-16, -8, 4.2, 0.5, 1.05, 'hazard'], [16, 13, 4.2, 0.5, 1.05, 'hazard'],
];

// waypoint graph: [x, z] nodes, edges listed once (undirected)
const NODES = [
  [0, 34], [-7, 26], [7, 26], [-16, 18], [0, 16], [16, 16], [-28, 8], [-6, 3], [6, 3],
  [20, 2], [-30, -4], [0, -6.8], [0, -11], [30, -4], [-22, -12], [22, -10], [-22, -20],
  [22, -18], [-12, -16], [12, -14], [0, -20], [-13, -30], [9, -30], [-13, -36], [9, -36],
  [0, -36], [-24, -33], [-30, -20], [33, -15], [-22, -27], [22, -25], [-6, -24], [6, -24],
  [-5.5, -6.8], [5.5, -6.8],
];
const EDGES = [
  [0, 1], [0, 2], [1, 3], [2, 5], [1, 4], [2, 4], [3, 6], [4, 7], [4, 8], [5, 9],
  [6, 10], [7, 33], [33, 11], [8, 34], [34, 11], [9, 13], [10, 14], [11, 12], [12, 20], [13, 15],
  [14, 16], [15, 17], [14, 18], [15, 19], [16, 29], [17, 30], [18, 20], [19, 20],
  [20, 31], [20, 32], [16, 27], [17, 28], [18, 21], [19, 22], [21, 23], [22, 24],
  [23, 25], [24, 25], [25, 26], [23, 26], [21, 26], [29, 21], [30, 22], [31, 21], [32, 22],
  [12, 31], [12, 32], [7, 18], [8, 19], [3, 4], [4, 5], [9, 15], [13, 28],
];

function kindMaterial(kind, tex) {
  switch (kind) {
    case 'wall': return mat(PAL.concrete, { map: tex.concrete });
    case 'wallDark': return mat(PAL.concreteDark, { map: tex.concrete });
    case 'furnace': return mat(0x9c8468, { map: tex.concrete });
    case 'metal': return mat(PAL.rust, { map: tex.rust, metal: 0.35, rough: 0.6 });
    case 'crate': return mat(0xffffff, { map: tex.crate });
    case 'containerT': return mat(0xffffff, { map: tex.containerT });
    case 'containerO': return mat(0xffffff, { map: tex.containerO });
    case 'sandbag': return mat(PAL.sandbag, { rough: 1 });
    case 'barrel': return mat(PAL.rust, { map: tex.rust, metal: 0.3, rough: 0.65 });
    case 'hazard': return mat(0xffffff, { map: tex.hazard });
    default: return mat(PAL.concrete);
  }
}

export function buildWorld(scene) {
  const tex = {
    concrete: concreteTex(), rust: rustTex(), crate: crateTex(),
    containerT: containerTex('#2f6f6a', 'WR-2210'), containerO: containerTex('#a86f2e', 'UN-047'),
    hazard: hazardTex(),
  };
  // light: a low sun, warm haze, cool sky fill
  scene.fog = new THREE.Fog(PAL.fog, 55, 165);
  scene.background = new THREE.Color(PAL.sky);
  const hemi = new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, 1.02);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PAL.sun, 2.4);
  sun.position.set(-38, 30, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
  sun.shadow.camera.far = 140;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffe0bd, 0.3));
  // work lamps over the two sites
  for (const s of [WORLD.sites.A, WORLD.sites.B]) {
    const lamp = new THREE.PointLight(0xffc37a, 60, 26, 1.9);
    lamp.position.set(s.x, 6.4, s.z);
    scene.add(lamp);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 6.4, 6), mat(PAL.charcoal, { metal: 0.5, rough: 0.5 }));
    pole.position.set(s.x + 3.4, 3.2, s.z + 3.4);
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.4),
      mat(0x554d3a, { emissive: 0xffc37a, ei: 2.2 }));
    head.position.set(s.x, 6.4, s.z);
    scene.add(head);
  }
  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.size, WORLD.size),
    new THREE.MeshStandardMaterial({ map: groundTex(WORLD.size, WORLD.sites.A, WORLD.sites.B), roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), mat(0x4c4234, { rough: 1 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.05;
  scene.add(apron);
  // distant foundry silhouettes against the dusk
  const silMat = mat(0x2c3540, { rough: 1 });
  const silhouettes = [[-70, -80, 26, 34], [30, -88, 40, 22], [78, -30, 20, 40], [-84, 10, 18, 26], [60, 70, 34, 18], [-60, 76, 28, 24]];
  for (const [x, z, w, h] of silhouettes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 12), silMat);
    m.position.set(x, h / 2, z);
    scene.add(m);
  }
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 46, 10), silMat);
  stack.position.set(-64, 23, -70);
  scene.add(stack);
  // the blocks themselves
  const boxGeoCache = new Map();
  for (const [x, z, w, d, h, kind, baseY = 0] of BLOCKS) {
    const key = `${w}x${h}x${d}`;
    if (!boxGeoCache.has(key)) boxGeoCache.set(key, new THREE.BoxGeometry(w, h, d));
    const mesh = new THREE.Mesh(boxGeoCache.get(key), kindMaterial(kind, tex));
    mesh.position.set(x, baseY + h / 2, z);
    mesh.castShadow = h >= 0.9;
    mesh.receiveShadow = true;
    scene.add(mesh);
    WORLD.colliders.push(boxCollider(x, baseY, z, w, h, d));
    if (h >= 1.8) WORLD.minimapRects.push({ x, z, w, d });
  }
  // nav graph
  WORLD.nodes = NODES.map(([x, z], i) => ({ id: i, x, z, edges: [] }));
  for (const [a, b] of EDGES) {
    WORLD.nodes[a].edges.push(b);
    WORLD.nodes[b].edges.push(a);
  }
  return WORLD;
}

export function siteAt(x, z) {
  for (const key of ['A', 'B']) {
    const s = WORLD.sites[key];
    const dx = x - s.x, dz = z - s.z;
    if (dx * dx + dz * dz <= s.r * s.r) return key;
  }
  return null;
}

export function nearestNode(x, z) {
  let best = 0, bd = Infinity;
  for (const n of WORLD.nodes) {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd) { bd = d; best = n.id; }
  }
  return best;
}

// Breadth-first route over the waypoint graph; returns node ids to walk.
export function findPath(fromId, toId) {
  if (fromId === toId) return [toId];
  const prev = new Map([[fromId, -1]]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    for (const nx of WORLD.nodes[cur].edges) {
      if (prev.has(nx)) continue;
      prev.set(nx, cur);
      if (nx === toId) {
        const path = [toId];
        let p = cur;
        while (p !== -1) { path.unshift(p); p = prev.get(p); }
        return path;
      }
      queue.push(nx);
    }
  }
  return [toId];
}
