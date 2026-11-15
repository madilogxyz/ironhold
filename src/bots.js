// bots.js — the other nine operators: low-poly bodies and the brains in them.
//
// A brain perceives on a tick (vision cone + line of sight + smoke + hearing),
// thinks on a slower tick (a small state machine: route, hold, engage, hunt,
// plant, defuse, cover), and moves on the same physics as the player. Defenders
// hold posts at the sites, attackers run lanes toward the charge's target, and
// both sides burst-fire with human-ish discipline: a reaction delay when a
// target first appears, short bursts, a pause to re-aim, worse aim on the move.

import * as THREE from 'three';
import { S } from './state.js';
import { WORLD, nearestNode, findPath, siteAt } from './world.js';
import { moveAndSlide } from './physics.js';
import { segmentClear, channelInteract } from './rounds.js';
import { tryFire, throwGrenade, tickKit, BUY_ITEMS } from './weapons.js';
import { PAL, mat, teamColor } from './palette.js';

const _eye = new THREE.Vector3(), _chest = new THREE.Vector3(), _dir = new THREE.Vector3();
const _to = new THREE.Vector3();

// ---------- buying ----------
function primaryOf(a) {
  for (const id of ['rifle', 'sniper', 'smg', 'shotgun']) if (a.loadout.owned[id]) return id;
  return null;
}
export function botBuy(a) {
  const buy = (id) => {
    const it = BUY_ITEMS.find((b) => b.id === id);
    if (it && a.money >= it.price && it.apply(a)) { a.money -= it.price; return true; }
    return false;
  };
  if (!primaryOf(a)) {
    if (a.money >= 3350) buy('rifle');
    else if (a.money >= 1250) buy(Math.random() < 0.7 ? 'smg' : 'shotgun');
    else if (a.money >= 1100 && Math.random() < 0.35) buy('shotgun');
  }
  if (a.armor < 100) {
    if (a.money >= 1000 && Math.random() < 0.55) buy('armorhelm');
    else if (a.money >= 650) buy('armor');
  }
  if (a.money >= 300 && Math.random() < 0.5) buy('he');
  if (a.money >= 200 && Math.random() < 0.3) buy('flash');
  const p = primaryOf(a);
  if (p) a.loadout.current = p;
  if (a.mesh) a.mesh.equip(a.loadout.current);
}

// ---------- brains ----------
export function makeBrain(actor, seedSkill) {
  return {
    skill: seedSkill, // 0..1, set once per bot for the whole match
    spreadMul: 1.5 - seedSkill * 0.55,
    reaction: 0.5 - seedSkill * 0.22,
    post: null, site: 'mid', lane: 'A',
    state: 'route', path: [], pathI: 0, goal: null,
    enemy: null, lastSeenPos: null, lastSeenAt: -9,
    nextPerceive: Math.random() * 0.12, nextThink: Math.random() * 0.2,
    reactionAt: 0, burstLeft: 0, nextBurstAt: 0,
    strafeDir: 1, strafeAt: 0, crouchAt: 0, crouching: false,
    scanBase: actor.yaw, nadeAt: 0,
    onHurt(attacker) {
      if (!attacker || !attacker.alive || attacker.team === actor.team) return;
      this.lastSeenPos = attacker.pos.clone();
      this.lastSeenAt = S.time;
      if (!this.enemy) this.alertYaw = Math.atan2(-(attacker.pos.x - actor.pos.x), -(attacker.pos.z - actor.pos.z));
    },
  };
}

export function resetBrain(a) {
  const b = a.brain;
  b.state = 'route'; b.path = []; b.pathI = 0; b.goal = null; b.goalId = -1;
  b.enemy = null; b.lastSeenPos = null; b.lastSeenAt = -9;
  b.burstLeft = 0; b.nextBurstAt = 0;
  b.scanBase = a.yaw;
}

function routeTo(a, nodeId) {
  const b = a.brain;
  const from = nearestNode(a.pos.x, a.pos.z);
  b.path = findPath(from, nodeId);
  b.pathI = 0;
  b.goal = WORLD.nodes[nodeId];
  b.goalId = nodeId;
}
// Think runs five times a second; re-routing on every tick would restart the
// path at the bot's own nearest node forever and pin it in place. Only route
// when the destination node actually changed or the old path ran out.
function routeSmart(a, x, z) {
  const b = a.brain;
  const nid = nearestNode(x, z);
  if (b.goalId !== nid || b.pathI >= b.path.length) routeTo(a, nid);
}

// Can this bot see this enemy right now? Vision cone, range, line of sight,
// and smoke all count; a flash in the eyes counts most of all.
function canSee(a, other) {
  if (S.time < (a.blindUntil || 0)) return false;
  _eye.set(a.pos.x, a.pos.y + 1.52 - 0.4 * a.crouch, a.pos.z);
  _chest.set(other.pos.x, other.pos.y + 1.25 - 0.35 * other.crouch, other.pos.z);
  const d = _eye.distanceTo(_chest);
  if (d > 68) return false;
  if (d > 4) {
    _dir.copy(_chest).sub(_eye).normalize();
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    if (_dir.x * fx + _dir.z * fz < 0.42) return false; // ~65° half-cone
  }
  if (!segmentClear(_eye, _chest)) return false;
  // smoke between the eyes and the target kills the sight line
  for (const s of S.smokes) {
    if (S.time > s.until) continue;
    if (segmentNearPoint(_eye, _chest, s.pos) < s.r) return false;
  }
  return true;
}
function segmentNearPoint(a, b, p) {
  _to.copy(b).sub(a);
  const len2 = _to.lengthSq();
  let t = len2 > 0 ? ((p.x - a.x) * _to.x + (p.y - a.y) * _to.y + (p.z - a.z) * _to.z) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = a.x + _to.x * t - p.x, dy = a.y + _to.y * t - p.y, dz = a.z + _to.z * t - p.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function perceive(a) {
  const b = a.brain;
  let best = null, bd = Infinity;
  for (const o of S.actors) {
    if (!o.alive || o.team === a.team) continue;
    if (canSee(a, o)) {
      const d = a.pos.distanceTo(o.pos);
      if (d < bd) { bd = d; best = o; }
    }
  }
  if (best) {
    if (b.enemy !== best) { b.enemy = best; b.reactionAt = S.time + b.reaction * (0.7 + Math.random() * 0.6); }
    b.lastSeenPos = best.pos.clone();
    b.lastSeenAt = S.time;
  } else if (b.enemy && (!b.enemy.alive || S.time - b.lastSeenAt > 1.2)) {
    b.enemy = null;
  }
  // hearing: enemy gunfire and the charge being planted carry across the yard,
  // but a defender only leaves a post for sounds that are actually close
  for (const n of S.noise) {
    if (n.team && n.team === a.team) continue;
    if (S.time - n.t > 1.4) continue;
    if (a.pos.distanceTo(n.pos) < Math.min(n.radius, 20) && !b.enemy) {
      b.lastSeenPos = n.pos.clone();
      b.lastSeenAt = S.time;
    }
  }
}

function think(a) {
  const b = a.brain;
  const bomb = S.bomb;
  // the charge changes everything, for both teams
  if (bomb.state === 'planted') {
    if (a.team === 'def') {
      const imNearest = S.actors.filter((o) => o.alive && o.team === 'def')
        .every((o) => o === a || o.pos.distanceTo(bomb.pos) >= a.pos.distanceTo(bomb.pos));
      if (imNearest && bomb.channelBy === null) { b.state = 'defuse'; routeSmart(a, bomb.pos.x, bomb.pos.z); return; }
      b.state = 'cover'; routeSmart(a, bomb.pos.x + 6, bomb.pos.z + 4); return;
    }
    b.state = 'cover'; // attackers fall back and guard the site
    const s = WORLD.sites[bomb.site];
    routeSmart(a, s.x + (a.id % 3 - 1) * 6, s.z + 5 + (a.id % 2) * 3);
    return;
  }
  if (b.enemy) { b.state = 'engage'; return; }
  if (a.team === 'atk') {
    if (bomb.carrier === a) {
      const s = WORLD.sites[b.lane];
      if (siteAt(a.pos.x, a.pos.z)) { b.state = 'plant'; return; }
      b.state = 'route'; routeSmart(a, s.x, s.z); return;
    }
    if (bomb.state === 'dropped') { b.state = 'route'; routeSmart(a, bomb.pos.x, bomb.pos.z); return; }
    if (bomb.carrier && bomb.carrier.isPlayer) {
      // support the human: take the site they are walking toward
      b.lane = Math.abs(bomb.carrier.pos.x - WORLD.sites.A.x) < Math.abs(bomb.carrier.pos.x - WORLD.sites.B.x) ? 'A' : 'B';
    }
    const s = WORLD.sites[b.lane];
    b.state = 'route';
    if (a.pos.distanceTo(_chest.set(s.x, a.pos.y, s.z)) > 9) routeSmart(a, s.x, s.z);
    else b.state = 'hold'; // arrived: watch the site until the charge shows
    return;
  }
  // defenders
  if (S.time - b.lastSeenAt < 5 && b.lastSeenPos) { b.state = 'hunt'; routeSmart(a, b.lastSeenPos.x, b.lastSeenPos.z); return; }
  b.state = 'route';
  if (b.post) {
    const d = Math.hypot(a.pos.x - b.post.x, a.pos.z - b.post.z);
    if (d < 1.2) b.state = 'hold';
    else routeSmart(a, b.post.x, b.post.z);
  }
}

// Move along the current path; returns true when the path is finished.
function followPath(a, dt, speed) {
  const b = a.brain;
  if (b.pathI >= b.path.length) return true;
  const node = WORLD.nodes[b.path[b.pathI]];
  const dx = node.x - a.pos.x, dz = node.z - a.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1.15) { b.pathI++; return b.pathI >= b.path.length; }
  moveToward(a, dt, dx / d, dz / d, speed);
  return false;
}

function moveToward(a, dt, dx, dz, speed) {
  const k = Math.min(1, dt * 9);
  a.vel.x += (dx * speed - a.vel.x) * k;
  a.vel.z += (dz * speed - a.vel.z) * k;
  faceToward(a, dt, Math.atan2(-dx, -dz), 8);
}
function faceToward(a, dt, targetYaw, rate = 6) {
  let diff = targetYaw - a.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  a.yaw += Math.max(-rate * dt, Math.min(rate * dt, diff));
}
function stop(a, dt) {
  const k = Math.max(0, 1 - dt * 10);
  a.vel.x *= k; a.vel.z *= k;
}

export function updateBot(a, dt) {
  const b = a.brain;
  if (!a.alive) return;
  tickKit(a, dt);
  if (S.time >= b.nextPerceive) { b.nextPerceive = S.time + 0.12; perceive(a); }
  if (S.time >= b.nextThink) { b.nextThink = S.time + 0.22; think(a); }
  let wantCrouch = false;

  if (b.state === 'plant' || b.state === 'defuse') {
    stop(a, dt);
    if (b.state === 'plant') faceToward(a, dt, b.scanBase, 3);
    else if (S.bomb.pos) faceToward(a, dt, Math.atan2(-(S.bomb.pos.x - a.pos.x), -(S.bomb.pos.z - a.pos.z)), 5);
    if (!channelInteract(a, dt)) b.state = 'route';
  } else if (b.state === 'engage' && b.enemy && b.enemy.alive) {
    const e = b.enemy;
    const dist = a.pos.distanceTo(e.pos);
    faceToward(a, dt, Math.atan2(-(e.pos.x - a.pos.x), -(e.pos.z - a.pos.z)), 9);
    // aim at the chest, drifting up toward the head on skilled bots
    const aimY = (e.pos.y + 1.32 - 0.35 * e.crouch) - (a.pos.y + 1.5);
    a.pitch = Math.max(-0.6, Math.min(0.6, Math.atan2(aimY, Math.max(1, dist)) + (Math.random() - 0.5) * 0.012));
    if (dist > 24) moveToward(a, dt, (e.pos.x - a.pos.x) / dist, (e.pos.z - a.pos.z) / dist, 4.3);
    else {
      // strafe in bursts of direction, the way people actually peek-fight
      if (S.time > b.strafeAt) { b.strafeAt = S.time + 0.7 + Math.random() * 0.9; b.strafeDir = Math.random() < 0.5 ? -1 : 1; }
      const px = -(e.pos.z - a.pos.z) / dist * b.strafeDir, pz = (e.pos.x - a.pos.x) / dist * b.strafeDir;
      if (dist < 7) moveToward(a, dt, px - (e.pos.x - a.pos.x) / dist * 0.4, pz - (e.pos.z - a.pos.z) / dist * 0.4, 3.4);
      else moveToward(a, dt, px, pz, 3.2);
      if (S.time > b.crouchAt) { b.crouchAt = S.time + 1.2 + Math.random() * 2; b.crouching = Math.random() < 0.3; }
      wantCrouch = b.crouching;
    }
    // fire discipline: react, burst, breathe, burst again
    if (S.time >= b.reactionAt && canSee(a, e)) {
      if (b.burstLeft > 0) { if (tryFire(a)) b.burstLeft--; }
      else if (S.time >= b.nextBurstAt) {
        b.burstLeft = 3 + (Math.random() * 4 | 0);
        b.nextBurstAt = S.time + (0.4 + Math.random() * 0.5) * (1.3 - b.skill * 0.5);
      }
      // a grenade for a camper: known position, mid range, off cooldown
      if (S.time > b.nadeAt && dist > 9 && dist < 26 && (a.loadout.nades.he > 0 || a.loadout.nades.flash > 0)) {
        b.nadeAt = S.time + 9 + Math.random() * 8;
        throwGrenade(a, a.loadout.nades.he > 0 ? 'he' : 'flash', _chest.set(e.pos.x, e.pos.y + 0.4, e.pos.z));
      }
    }
  } else if (b.state === 'hold') {
    stop(a, dt);
    a.yaw = b.scanBase + Math.sin(S.time * 0.45 + a.id * 2.1) * 0.65; // scanning the lane
    a.pitch = 0;
    wantCrouch = a.team === 'def' && a.id % 2 === 0;
  } else { // route, hunt, cover
    const speed = b.state === 'hunt' ? 4.5 : 4.25;
    if (followPath(a, dt, speed)) {
      if (b.state === 'route' && a.team === 'def' && b.post) b.state = 'hold';
      else if (b.state === 'cover') b.state = 'hold';
      else stop(a, dt);
    }
    a.pitch = 0;
  }

  a.crouch += ((wantCrouch ? 1 : 0) - a.crouch) * Math.min(1, dt * 7);
  a.vel.y -= 20 * dt;
  a.grounded = moveAndSlide(a.pos, a.vel, dt, a.radius, a.standHeight - 0.55 * a.crouch, WORLD.colliders);
  a.speedNow = Math.hypot(a.vel.x, a.vel.z);
  if (a.mesh) a.mesh.update(dt);
}

export function setDeathPose(a) { if (a.mesh) a.mesh.die(); }

// ---------- bodies ----------
const gunMatsWorld = {
  body: new THREE.MeshStandardMaterial({ color: 0x2e3134, roughness: 0.5, metalness: 0.6 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x1d1f20, roughness: 0.8 }),
};
function wbox(w, h, d, x, y, z, m) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}
function buildWorldGun(kind) {
  const g = new THREE.Group();
  const len = kind === 'sniper' ? 0.85 : kind === 'shotgun' ? 0.7 : kind === 'pistol' ? 0.26 : kind === 'smg' ? 0.5 : 0.62;
  g.add(wbox(0.07, 0.11, len, 0, 0, -len / 2, gunMatsWorld.body));
  g.add(wbox(0.05, 0.14, 0.06, 0, -0.1, 0.05, gunMatsWorld.grip));
  if (kind === 'sniper') g.add(wbox(0.05, 0.05, 0.2, 0, 0.09, -0.2, gunMatsWorld.body));
  return g;
}

export function createBotMesh(a, scene) {
  const team = mat(teamColor(a.team), { rough: 0.85 });
  const dark = mat(PAL.pants, { rough: 0.95 });
  const skin = mat(PAL.skin[a.id % PAL.skin.length], { rough: 0.7 });
  const group = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.98; group.add(hips);
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.11, 0, 0); legR.position.set(0.11, 0, 0);
  legL.add(wbox(0.17, 0.98, 0.2, 0, -0.49, 0, dark));
  legR.add(wbox(0.17, 0.98, 0.2, 0, -0.49, 0, dark));
  hips.add(legL, legR);
  const torso = new THREE.Group(); torso.position.y = 0.98; group.add(torso);
  torso.add(wbox(0.52, 0.64, 0.28, 0, 0.32, 0, team)); // vest
  torso.add(wbox(0.56, 0.2, 0.32, 0, 0.06, 0, dark)); // belt line
  const head = wbox(0.24, 0.26, 0.24, 0, 0.82, 0, skin);
  torso.add(head);
  const cap = wbox(0.27, 0.09, 0.27, 0, 0.97, 0, mat(PAL.charcoal, { rough: 0.8 }));
  torso.add(cap);
  const armL = wbox(0.13, 0.5, 0.13, -0.33, 0.28, -0.1, dark);
  armL.rotation.x = -0.9; torso.add(armL);
  const armR = wbox(0.13, 0.5, 0.13, 0.33, 0.28, -0.14, dark);
  armR.rotation.x = -1.15; torso.add(armR);
  const gunMount = new THREE.Group();
  gunMount.position.set(0.18, 0.42, -0.2);
  torso.add(gunMount);
  let gun = buildWorldGun('pistol');
  gunMount.add(gun);
  group.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  scene.add(group);
  const meshObj = {
    group, swing: Math.random() * 6,
    fallT: 1, // 1 = standing; animates to 0 on death
    equip(kind) {
      gunMount.remove(gun);
      gun = buildWorldGun(kind);
      gunMount.add(gun);
    },
    reset() {
      this.fallT = 1;
      group.rotation.set(0, 0, 0);
      group.visible = true;
    },
    die() { this.fallT = 0.999; },
    update(dt) {
      group.position.copy(a.pos);
      group.rotation.y = a.yaw;
      if (this.fallT < 1) { // topple and settle
        this.fallT = Math.max(0, this.fallT - dt * 2.2);
        const k = 1 - this.fallT;
        group.rotation.x = -k * k * Math.PI / 2;
        group.position.y = a.pos.y + k * 0.12;
        return;
      }
      const sp = a.speedNow || 0;
      this.swing += dt * sp * 2.1;
      const amp = Math.min(1, sp / 4) * (1 - a.crouch * 0.7);
      legL.rotation.x = Math.sin(this.swing) * 0.55 * amp;
      legR.rotation.x = -Math.sin(this.swing) * 0.55 * amp;
      torso.position.y = 0.98 - a.crouch * 0.42 + Math.abs(Math.sin(this.swing)) * 0.03 * amp;
      torso.rotation.x = a.pitch * 0.55;
      gunMount.rotation.x = a.pitch * 0.5;
    },
  };
  a.mesh = meshObj;
  return meshObj;
}
