// weapons.js — the arsenal: five guns, three grenades, one shared shot solver.
//
// Player and bots fire through the same code path (fireHitscan), so a bot's
// rifle obeys the same spread, falloff and headshot rules as yours. Accuracy
// is priced from the shooter's body: moving, airborne or spraying all widen
// the cone; crouching, standing still and aiming down sights narrow it. That
// is the whole tactical argument of the game, in one function (spreadFor).

import * as THREE from 'three';
import { S, hear } from './state.js';
import { WORLD } from './world.js';
import { rayHit, rayActor } from './physics.js';
import { aimDir, PlayerCtl } from './player.js';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { tracer, muzzle, impact, dust, explosionFx, smokeBloom, flashFx } from './fx.js';
import { damageActor, segmentClear } from './rounds.js';

export const WEAPONS = {
  pistol: { name: 'P9 Sidearm', kind: 'pistol', slot: 2, price: 0, dmg: 26, headMult: 4, rpm: 400, auto: false, mag: 12, reserve: 60, reload: 1.5, spread: 0.011, moveSpread: 0.026, recoil: 0.010, range: 55, pellets: 1, adsFov: 58 },
  smg: { name: 'Raptor-9', kind: 'smg', slot: 1, price: 1250, dmg: 19, headMult: 3.4, rpm: 800, auto: true, mag: 30, reserve: 90, reload: 2.1, spread: 0.017, moveSpread: 0.030, recoil: 0.0072, range: 38, pellets: 1, adsFov: 55 },
  shotgun: { name: 'Breach-12', kind: 'shotgun', slot: 1, price: 1100, dmg: 9, headMult: 2.2, rpm: 72, auto: false, mag: 6, reserve: 24, reload: 2.9, spread: 0.046, moveSpread: 0.046, recoil: 0.052, range: 15, pellets: 8, adsFov: 60 },
  rifle: { name: 'VK-7 Rifle', kind: 'rifle', slot: 1, price: 2700, dmg: 33, headMult: 4, rpm: 600, auto: true, mag: 30, reserve: 90, reload: 2.4, spread: 0.0085, moveSpread: 0.030, recoil: 0.0105, range: 85, pellets: 1, adsFov: 50 },
  sniper: { name: 'Longbow .338', kind: 'sniper', slot: 1, price: 4300, dmg: 97, headMult: 4, rpm: 42, auto: false, mag: 5, reserve: 25, reload: 3.1, spread: 0.0012, moveSpread: 0.05, recoil: 0.055, range: 150, pellets: 1, adsFov: 22 },
};
export const PRIMARY = ['smg', 'shotgun', 'rifle', 'sniper'];

export const NADES = {
  he: { name: 'Frag', price: 300, desc: 'High-explosive. 110 damage at the core, falls off fast.' },
  flash: { name: 'Flash', price: 200, desc: 'Blinds anyone looking at the pop. Turn away or eat it.' },
  smoke: { name: 'Smoke', price: 300, desc: 'A 12-second wall of grey. Cuts sight lines dead.' },
};

// What the buy menu sells, in grid order. apply() returns false when the
// purchase makes no sense (already owned, full grenades) so the menu can ding.
export const BUY_ITEMS = [
  { id: 'smg', key: '1', name: 'Raptor-9 SMG', price: 1250, desc: 'Fast, cheap, close-range shredder.', apply: (a) => buyGun(a, 'smg') },
  { id: 'shotgun', key: '2', name: 'Breach-12', price: 1100, desc: 'Eight pellets. Owns doorways and corners.', apply: (a) => buyGun(a, 'shotgun') },
  { id: 'rifle', key: '3', name: 'VK-7 Rifle', price: 2700, desc: 'The all-rounder. Accurate, steady, deadly.', apply: (a) => buyGun(a, 'rifle') },
  { id: 'sniper', key: '4', name: 'Longbow .338', price: 4300, desc: 'One shot, one funeral. Scope included.', apply: (a) => buyGun(a, 'sniper') },
  { id: 'armor', key: '5', name: 'Kevlar Vest', price: 650, desc: 'Soaks half of every bullet\u2019s sting.', apply: (a) => { if (a.armor >= 100) return false; a.armor = 100; return true; } },
  { id: 'armorhelm', key: '6', name: 'Vest + Helmet', price: 1000, desc: 'Vest, plus a lid that dulls headshots.', apply: (a) => { if (a.armor >= 100 && a.helmet) return false; a.armor = 100; a.helmet = true; return true; } },
  { id: 'he', key: '7', name: 'Frag Grenade', price: 300, desc: 'For corners you don\u2019t want to peek.', apply: (a) => buyNade(a, 'he') },
  { id: 'flash', key: '8', name: 'Flash Grenade', price: 200, desc: 'Pop it and take the site for free.', apply: (a) => buyNade(a, 'flash') },
  { id: 'smoke', key: '9', name: 'Smoke Grenade', price: 300, desc: 'Cross open ground like it isn\u2019t there.', apply: (a) => buyNade(a, 'smoke') },
];
function buyGun(a, id) {
  const kit = a.loadout;
  if (kit.owned[id]) return false;
  for (const p of PRIMARY) if (p !== id && kit.owned[p]) { // one primary per operator
    delete kit.owned[p]; delete kit.mags[p]; delete kit.reserve[p];
    if (kit.current === p) kit.current = 'pistol';
  }
  kit.owned[id] = true;
  kit.mags[id] = WEAPONS[id].mag;
  kit.reserve[id] = WEAPONS[id].reserve;
  kit.current = id;
  return true;
}
function buyNade(a, kind) {
  if (a.loadout.nades[kind] >= 2) return false;
  a.loadout.nades[kind]++;
  return true;
}

export function makeKit() {
  return {
    owned: { pistol: true }, mags: { pistol: WEAPONS.pistol.mag }, reserve: { pistol: WEAPONS.pistol.reserve },
    current: 'pistol', last: 'pistol',
    nades: { he: 0, flash: 0, smoke: 0 }, nadeSel: 'he',
    nextShotAt: 0, reloadingUntil: 0, reloadStage: -1, switchUntil: 0,
    bloom: 0, kick: 0, wasFiring: false, models: {},
  };
}

const _dir = new THREE.Vector3(), _origin = new THREE.Vector3(), _hitP = new THREE.Vector3();
const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _muzzle = new THREE.Vector3();
const _wallHit = { dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3() };

export function spreadFor(actor, def) {
  const kit = actor.loadout;
  let s = def.spread;
  const ads = actor.adsAmount || 0;
  if (def.kind === 'sniper') s = ads > 0.6 ? def.spread : 0.055; // unscoped sniper is a lottery ticket
  else s *= 1 - 0.45 * ads;
  const move = Math.min(1, (actor.speedNow || 0) / 5.7);
  s += def.moveSpread * move;
  if (!actor.grounded) s += 0.05;
  s *= 1 - 0.28 * (actor.crouch || 0);
  s += Math.min(0.02, kit.bloom);
  return s;
}

function falloff(def, dist) {
  if (dist <= def.range) return 1;
  return Math.max(0.3, 1 - (dist - def.range) / (def.range * 1.7));
}

// The one shot solver. Returns the actor hit, if any.
export function fireHitscan(shooter, def) {
  const kit = shooter.loadout;
  const spread = spreadFor(shooter, def) * (shooter.brain ? shooter.brain.spreadMul : 1);
  if (shooter.isPlayer) _origin.copy(shooter.eyePos);
  else { _origin.copy(shooter.pos); _origin.y += 1.42 - 0.4 * shooter.crouch; }
  aimDir(shooter, _dir);
  _right.set(-_dir.z, 0, _dir.x).normalize();
  _up.crossVectors(_right, _dir);
  // muzzle world position for the tracer and flash: at the viewmodel's barrel
  // for the player (low and right of the eye), at the gun for a bot
  if (shooter.isPlayer) _muzzle.copy(_origin).addScaledVector(_dir, 0.6).addScaledVector(_right, 0.17).addScaledVector(_up, -0.13);
  else _muzzle.copy(_origin).addScaledVector(_dir, 0.5);
  muzzle(_muzzle, _dir);
  let hitAnyone = null;
  for (let p = 0; p < def.pellets; p++) {
    const d = _dir.clone();
    const a1 = (Math.random() + Math.random() + Math.random() - 1.5) * spread;
    const a2 = (Math.random() + Math.random() + Math.random() - 1.5) * spread;
    d.addScaledVector(_right, a1).addScaledVector(_up, a2).normalize();
    const wall = rayHit(_origin, d, 220, WORLD.colliders, _wallHit);
    const wallDist = wall ? wall.dist : 220;
    let bestActor = null, bestHit = null;
    for (const other of S.actors) {
      if (!other.alive || other === shooter || other.team === shooter.team) continue;
      const h = rayActor(_origin, d, other, wallDist);
      if (h && (!bestHit || h.dist < bestHit.dist)) { bestHit = h; bestActor = other; }
    }
    if (bestActor) {
      _hitP.copy(d).multiplyScalar(bestHit.dist).add(_origin);
      tracer(_muzzle, _hitP);
      impact(_hitP, d, 'body');
      const mult = bestHit.part === 'head' ? def.headMult : bestHit.part === 'legs' ? 0.65 : 1;
      damageActor(shooter, bestActor, def.dmg * mult * falloff(def, bestHit.dist), bestHit.part, def.name);
      hitAnyone = bestActor;
    } else if (wall) {
      tracer(_muzzle, wall.point);
      if (wall.normal.y > 0.6) dust(wall.point, 2); else impact(wall.point, wall.normal, 'stone');
    }
  }
  // sound: placed for the listener when someone else is shooting, and real
  // noise on the state bus either way — bots hear gunfire across the yard
  hear(shooter.pos, 36, 'shot', shooter.team);
  if (shooter.isPlayer) {
    AudioSys.shot(def.kind, 1, 0);
  } else {
    const dx = shooter.pos.x - S.player.pos.x, dz = shooter.pos.z - S.player.pos.z;
    const dist = Math.hypot(dx, dz);
    const vol = Math.max(0.04, Math.min(1, 16 / (dist + 6)));
    const rel = Math.atan2(dx, dz) - Math.atan2(-Math.sin(S.player.yaw), -Math.cos(S.player.yaw));
    AudioSys.shot(def.kind, vol, Math.sin(rel) * 0.8);
  }
  kit.bloom = Math.min(0.03, kit.bloom + 0.0045);
  shooter.lastShotAt = S.time;
  return hitAnyone;
}

// Attempts to fire the actor's current weapon once, honouring rate of fire,
// magazines and reloads. Bots call this from their brain; the player path
// below calls it too, so rules can never drift apart.
export function tryFire(actor) {
  const kit = actor.loadout;
  const def = WEAPONS[kit.current];
  const now = S.time;
  if (now < kit.nextShotAt || now < kit.reloadingUntil || now < kit.switchUntil) return false;
  if (kit.mags[kit.current] <= 0) {
    if (actor.isPlayer) AudioSys.dryFire();
    startReload(actor);
    kit.nextShotAt = now + 0.3;
    return false;
  }
  kit.mags[kit.current]--;
  kit.nextShotAt = now + 60 / def.rpm;
  actor.recPitch = Math.min(0.16, (actor.recPitch || 0) + def.recoil * (0.85 + Math.random() * 0.3));
  actor.recYaw = (actor.recYaw || 0) + (Math.random() - 0.5) * def.recoil * 0.6;
  kit.kick = 1;
  fireHitscan(actor, def);
  if (kit.mags[kit.current] === 0) startReload(actor);
  return true;
}

export function startReload(actor) {
  const kit = actor.loadout;
  const def = WEAPONS[kit.current];
  if (S.time < kit.reloadingUntil || kit.mags[kit.current] >= def.mag || kit.reserve[kit.current] <= 0) return;
  kit.reloadingUntil = S.time + def.reload;
  kit.reloadStage = 0;
  if (actor.isPlayer) AudioSys.reload(0);
}

function finishReload(actor) {
  const kit = actor.loadout;
  const def = WEAPONS[kit.current];
  const take = Math.min(def.mag - kit.mags[kit.current], kit.reserve[kit.current]);
  kit.mags[kit.current] += take;
  kit.reserve[kit.current] -= take;
  kit.reloadStage = -1;
  if (actor.isPlayer) AudioSys.reload(2);
}

export function switchTo(actor, id) {
  const kit = actor.loadout;
  if (!kit.owned[id] || kit.current === id) return;
  kit.last = kit.current;
  kit.current = id;
  kit.reloadingUntil = 0; kit.reloadStage = -1;
  kit.switchUntil = S.time + 0.42;
  if (actor.isPlayer) AudioSys.draw();
}

// ---------- grenades ----------
const liveNades = [];
let nadeMeshProto = null;
export function throwGrenade(actor, kind, targetPos) {
  const kit = actor.loadout;
  if (kit.nades[kind] <= 0) return false;
  kit.nades[kind]--;
  if (!nadeMeshProto) {
    nadeMeshProto = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x3f4a3a, roughness: 0.5, metalness: 0.4 }),
    );
  }
  const mesh = nadeMeshProto.clone();
  const from = actor.isPlayer ? actor.eyePos : _v1.set(actor.pos.x, actor.pos.y + 1.5, actor.pos.z);
  mesh.position.copy(from);
  const vel = new THREE.Vector3();
  if (targetPos) { // lobbed at a known position: solve a simple ballistic arc
    const t = Math.max(0.65, Math.min(1.7, from.distanceTo(targetPos) / 15));
    vel.set((targetPos.x - from.x) / t, (targetPos.y - from.y + 0.5 * 12 * t * t) / t, (targetPos.z - from.z) / t);
  } else { // thrown where the thrower looks
    aimDir(actor, vel);
    vel.multiplyScalar(15.5);
    vel.y += 2.4;
  }
  liveNades.push({ pos: mesh.position, vel, kind, owner: actor, fuse: kind === 'he' ? 1.7 : 1.45, mesh, rested: false });
  S.scene.add(mesh);
  if (actor.isPlayer) AudioSys.throwNade();
  return true;
}
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

export function updateGrenades(dt) {
  for (let i = liveNades.length - 1; i >= 0; i--) {
    const n = liveNades[i];
    n.fuse -= dt;
    if (!n.rested) {
      n.vel.y -= 12 * dt;
      _v1.copy(n.pos).addScaledVector(n.vel, dt);
      // bounce off the ground and walls, losing energy each time
      if (_v1.y < 0.07) {
        _v1.y = 0.07;
        n.vel.y = Math.abs(n.vel.y) * 0.38;
        n.vel.x *= 0.72; n.vel.z *= 0.72;
        if (Math.abs(n.vel.y) < 0.8) { n.vel.y = 0; if (n.kind === 'smoke') n.rested = true; }
        AudioSys.bounce();
      }
      const wall = rayHit(n.pos, _v2.copy(n.vel).normalize(), n.vel.length() * dt + 0.05, WORLD.colliders, _wallHit);
      if (wall && _v1.y > 0.07) {
        _v1.copy(wall.point).addScaledVector(wall.normal, 0.06);
        const d = 2 * n.vel.dot(wall.normal);
        n.vel.addScaledVector(wall.normal, -d).multiplyScalar(0.45);
      }
      n.pos.copy(_v1);
    }
    if (n.kind === 'smoke' && n.rested && n.fuse > 0.2) n.fuse = 0.2; // blooms on rest
    if (n.fuse <= 0) {
      detonate(n);
      S.scene.remove(n.mesh);
      liveNades.splice(i, 1);
    }
  }
}

function detonate(n) {
  const at = n.pos;
  if (n.kind === 'he') {
    explosionFx(at);
    const dx = at.x - S.player.pos.x, dz = at.z - S.player.pos.z;
    const pd = Math.hypot(dx, dz);
    AudioSys.explosion(Math.max(0.1, Math.min(1, 20 / (pd + 5))), 0);
    hear(at, 40, 'boom');
    for (const a of S.actors) {
      if (!a.alive) continue;
      const d = a.pos.distanceTo(at);
      if (d > 7) continue;
      _v1.copy(a.pos); _v1.y += 1;
      if (!segmentClear(at, _v1)) continue;
      const dmg = 110 * Math.max(0, 1 - d / 7) ** 1.4;
      if (dmg > 2) damageActor(n.owner, a, dmg, 'body', 'Frag grenade');
    }
    if (pd < 9) S.shake = Math.min(1.2, S.shake + (1 - pd / 9) * 0.8);
  } else if (n.kind === 'flash') {
    AudioSys.flashPop(1, 0);
    flashFx(at);
    for (const a of S.actors) {
      if (!a.alive) continue;
      const d = a.pos.distanceTo(at);
      if (d > 30) continue;
      _v1.copy(at).sub(a.isPlayer ? a.eyePos : _v2.set(a.pos.x, a.pos.y + 1.5, a.pos.z)).normalize();
      aimDir(a, _v2);
      const facing = _v1.dot(_v2); // 1 = staring at it, -1 = back turned
      _v2.copy(a.pos); _v2.y += 1.2;
      if (facing < -0.15 || !segmentClear(_v2, at)) continue;
      const strength = Math.max(0, (facing + 0.15) / 1.15) * Math.max(0, 1 - d / 30);
      const dur = strength * 4.2;
      if (dur > 0.25) {
        a.blindUntil = S.time + dur;
        a.blindPeak = Math.min(1, strength + 0.25);
      }
    }
  } else { // smoke
    S.smokes.push({ pos: at.clone(), r: 3.6, until: S.time + 12 });
    smokeBloom(at);
    AudioSys.burst(0.3, 900, 1.4);
  }
}

// ---------- viewmodels ----------
const gunMats = {
  body: new THREE.MeshStandardMaterial({ color: 0x596066, roughness: 0.38, metalness: 0.6 }),
  accent: new THREE.MeshStandardMaterial({ color: 0xa8703f, roughness: 0.55, metalness: 0.25 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x35302a, roughness: 0.85, metalness: 0.05 }),
};
function box(w, h, d, x, y, z, m = gunMats.body) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}
export function buildViewmodel(kind) {
  const g = new THREE.Group();
  if (kind === 'pistol') {
    g.add(box(0.055, 0.09, 0.24, 0, 0, 0));
    g.add(box(0.05, 0.13, 0.07, 0, -0.09, 0.07, gunMats.grip));
    g.add(box(0.012, 0.03, 0.012, 0, 0.06, -0.1));
  } else if (kind === 'smg') {
    g.add(box(0.06, 0.1, 0.44, 0, 0, 0));
    g.add(box(0.045, 0.16, 0.06, 0, -0.11, 0.02, gunMats.grip));
    g.add(box(0.05, 0.12, 0.05, 0, -0.1, -0.08, gunMats.grip));
    g.add(box(0.03, 0.03, 0.14, 0, 0.02, -0.28));
  } else if (kind === 'shotgun') {
    g.add(box(0.065, 0.09, 0.62, 0, 0, 0));
    g.add(box(0.055, 0.07, 0.2, 0, -0.045, -0.12, gunMats.accent));
    g.add(box(0.05, 0.13, 0.06, 0, -0.09, 0.16, gunMats.grip));
  } else if (kind === 'sniper') {
    g.add(box(0.055, 0.08, 0.78, 0, 0, 0));
    g.add(box(0.045, 0.045, 0.2, 0, 0.075, -0.05)); // scope
    g.add(box(0.05, 0.14, 0.05, 0, -0.1, 0.03, gunMats.grip));
    g.add(box(0.04, 0.1, 0.04, 0, -0.08, -0.14, gunMats.grip));
  } else { // rifle
    g.add(box(0.06, 0.1, 0.56, 0, 0, 0));
    g.add(box(0.05, 0.17, 0.055, 0, -0.12, -0.02, gunMats.grip));
    g.add(box(0.05, 0.11, 0.05, 0, -0.09, 0.14, gunMats.grip));
    g.add(box(0.055, 0.05, 0.18, 0, 0.03, -0.2, gunMats.accent));
    g.add(box(0.014, 0.035, 0.014, 0, 0.065, -0.24));
    g.add(box(0.05, 0.02, 0.05, 0, 0.055, 0.05));
  }
  g.traverse((m) => { m.frustumCulled = false; });
  return g;
}

// Per-step upkeep for any actor's kit: reload progress, recoil recovery,
// bloom and viewmodel kick decay. Bots call this from their brain tick, the
// player from updatePlayerWeapons — one place, so the rules stay identical.
export function tickKit(actor, dt) {
  const kit = actor.loadout;
  if (kit.reloadStage >= 0) {
    const defR = WEAPONS[kit.current];
    const remain = kit.reloadingUntil - S.time;
    if (kit.reloadStage === 0 && remain < defR.reload * 0.55) {
      kit.reloadStage = 1;
      if (actor.isPlayer) AudioSys.reload(1);
    }
    if (remain <= 0) finishReload(actor);
  }
  actor.recPitch = Math.max(0, (actor.recPitch || 0) - dt * 0.09 * (1 + (actor.recPitch || 0) * 6));
  actor.recYaw = (actor.recYaw || 0) * Math.max(0, 1 - dt * 7);
  kit.bloom = Math.max(0, kit.bloom - dt * 0.028);
  kit.kick = Math.max(0, kit.kick - dt * 7);
}

// Per-frame player weapon handling: input, ADS, recoil recovery, the works.
export function updatePlayerWeapons(dt, camera) {
  const a = S.player;
  const kit = a.loadout;
  if (!a.alive || S.phase !== 'live' || S.paused) { a.adsAmount = 0; return; }
  const def = WEAPONS[kit.current];
  // weapon selection
  if (Input.tapped('Digit1')) { const p = ['smg', 'shotgun', 'rifle', 'sniper'].find((id) => kit.owned[id]); if (p) switchTo(a, p); }
  if (Input.tapped('Digit2')) switchTo(a, 'pistol');
  if (Input.tapped('KeyQ')) switchTo(a, kit.last);
  if (Input.tapped('Digit4')) {
    const kinds = ['he', 'flash', 'smoke'];
    let i = kinds.indexOf(kit.nadeSel);
    for (let k = 0; k < 3; k++) { i = (i + 1) % 3; if (kit.nades[kinds[i]] > 0) { kit.nadeSel = kinds[i]; break; } }
  }
  if (Input.tapped('KeyG')) throwGrenade(a, kit.nadeSel, null);
  if (Input.tapped('KeyR')) startReload(a);
  // aim down sights
  const wantAds = Input.aiming && S.bomb.channelBy !== a;
  a.adsAmount += ((wantAds ? 1 : 0) - a.adsAmount) * Math.min(1, dt * 10);
  a.adsFov = a.adsAmount > 0.03 ? 73 + (def.adsFov - 73) * a.adsAmount : 0;
  a.scoped = def.kind === 'sniper' && a.adsAmount > 0.75;
  // firing
  const chan = S.bomb.channelBy === a;
  if (!chan && Input.firing && (def.auto || !kit.wasFiring)) tryFire(a);
  kit.wasFiring = Input.firing;
  tickKit(a, dt);
  updateViewmodel(dt, camera, a);
}

const HIP_POS = new THREE.Vector3(0.235, -0.225, -0.45);
const ADS_POS = new THREE.Vector3(0, -0.148, -0.4);
const _vmPos = new THREE.Vector3();
export function updateViewmodel(dt, camera, a) {
  const kit = a.loadout;
  let model = kit.models[kit.current];
  if (!model) {
    model = buildViewmodel(kit.current);
    kit.models[kit.current] = model;
    camera.add(model);
  }
  for (const key of Object.keys(kit.models)) kit.models[key].visible = key === kit.current;
  const ads = a.adsAmount || 0;
  _vmPos.lerpVectors(HIP_POS, ADS_POS, ads);
  // walk bob and look sway, kept subtle so the gun feels held, not glued
  const bob = Math.min(1, (a.speedNow || 0) / 4.35);
  _vmPos.x += Math.sin(PlayerCtl.bobPhase) * 0.008 * bob * (1 - ads);
  _vmPos.y += Math.abs(Math.cos(PlayerCtl.bobPhase)) * 0.006 * bob * (1 - ads);
  _vmPos.z += kit.kick * 0.055;
  model.position.copy(_vmPos);
  model.rotation.set(kit.kick * 0.09 + (kit.reloadStage >= 0 ? Math.sin((WEAPONS[kit.current].reload - (kit.reloadingUntil - S.time)) * 2.4) * 0.35 : 0), 0, 0);
  model.visible = !(a.scoped) && a.alive;
}
