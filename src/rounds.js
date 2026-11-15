// rounds.js — the match director: buy phase, live rounds, the charge, money.
//
// Everything that makes this Counter-Strike-shaped rather than a deathmatch
// lives here: rounds that end four ways (elimination, detonation, defuse,
// clock), an economy that pays for kills and wins and cushions losing streaks,
// and damageActor — the single funnel every bullet and blast passes through,
// where armour, helmets, kill pay and the killfeed are decided.

import * as THREE from 'three';
import { S, aliveOn, resetBomb, hear } from './state.js';
import { WORLD, siteAt } from './world.js';
import { segmentBlocked } from './physics.js';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { makeKit } from './weapons.js';
import { explosionFx } from './fx.js';
import { PlayerCtl } from './player.js';
import { resetBrain, setDeathPose, botBuy } from './bots.js';
import { Hud } from './hud.js';

const _sd = new THREE.Vector3();
const _sh = { dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3() };
// True when nothing in the map blocks the straight line a→b.
export function segmentClear(a, b) {
  return !segmentBlocked(a, b, WORLD.colliders, _sd, _sh);
}

const ROUND_TIME = 105, BOMB_TIME = 35, PLANT_TIME = 3.0, DEFUSE_TIME = 6.0;
let bombMesh = null, bombLight = null, beepAt = 0;

export function initRounds(scene) {
  bombMesh = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.14),
    new THREE.MeshStandardMaterial({ color: 0x35322c, roughness: 0.5, metalness: 0.4 }));
  body.position.y = 0.1;
  bombMesh.add(body);
  bombLight = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x330d08, emissive: 0xff2a18, emissiveIntensity: 0.4 }));
  bombLight.position.set(0.1, 0.23, 0);
  bombMesh.add(bombLight);
  bombMesh.visible = false;
  scene.add(bombMesh);
}

// ---------- damage and death ----------
export function damageActor(attacker, victim, rawDmg, part, weaponName) {
  if (!victim.alive || S.phase !== 'live') return;
  let dmg = rawDmg;
  if (victim.armor > 0 && (part !== 'head' || victim.helmet)) {
    dmg = rawDmg * 0.5; // kevlar halves what reaches the body
    victim.armor = Math.max(0, victim.armor - rawDmg * 0.35);
  } else if (victim.armor > 0) {
    victim.armor = Math.max(0, victim.armor - rawDmg * 0.2); // bare headshot still ruins the vest
  }
  victim.hp -= dmg;
  victim.lastHurtBy = attacker;
  victim.lastHurtAt = S.time;
  if (victim.isPlayer) {
    AudioSys.hurt();
    S.shake = Math.min(1, S.shake + 0.18);
    Hud.damageFrom(attacker);
  } else if (victim.brain) {
    victim.brain.onHurt(attacker);
  }
  if (attacker && attacker.isPlayer && victim.alive) {
    Hud.hitmark(part === 'head', false);
    AudioSys.hit(part === 'head');
  }
  if (victim.hp <= 0) killActor(attacker, victim, part, weaponName);
}

function killActor(attacker, victim, part, weaponName) {
  victim.alive = false;
  victim.hp = 0;
  victim.deaths++;
  victim.deadAt = S.time;
  if (victim.mesh) setDeathPose(victim);
  if (S.bomb.channelBy === victim) { S.bomb.channel = 0; S.bomb.channelBy = null; }
  if (S.bomb.carrier === victim) {
    S.bomb.carrier = null;
    S.bomb.state = 'dropped';
    S.bomb.pos = victim.pos.clone();
    Hud.toast(victim.team === 'atk' ? 'The charge is down' : '');
  }
  if (attacker && attacker !== victim) {
    attacker.kills++;
    attacker.money = Math.min(16000, attacker.money + 300);
    if (attacker.isPlayer) AudioSys.kill();
  }
  Hud.killfeed(attacker, victim, weaponName, part === 'head');
  if (S.phase === 'live') {
    if (aliveOn('atk') === 0) endRound('def', 'elimination');
    else if (aliveOn('def') === 0) endRound('atk', 'elimination');
  }
}

// ---------- round lifecycle ----------
export const Rounds = {
  startMatch() {
    S.round = 0;
    S.scoreAtk = 0; S.scoreDef = 0;
    S.lossStreak.atk = 0; S.lossStreak.def = 0;
    for (const a of S.actors) {
      a.money = 800; a.kills = 0; a.deaths = 0; a.plants = 0; a.defuses = 0;
      a.loadout = makeKit();
      a.armor = 0; a.helmet = false;
    }
    this.nextRound();
  },

  nextRound() {
    S.round++;
    this.setupRound();
    S.phase = 'buy';
    S.phaseLeft = 15;
    Hud.onPhase();
  },

  setupRound() {
    resetBomb();
    S.smokes.length = 0;
    S.noise.length = 0;
    S.roundClock = ROUND_TIME;
    const atkSpawns = WORLD.spawns.atk, defSpawns = WORLD.spawns.def;
    let ai = 0, di = 0;
    for (const a of S.actors) {
      const survived = a.alive && S.round > 1;
      a.alive = true;
      a.hp = 100;
      if (!survived) { // the dead start over with a sidearm and their savings
        a.loadout = makeKit();
        a.armor = 0; a.helmet = false;
      }
      const def = a.team === 'atk' ? atkSpawns[ai++ % atkSpawns.length] : defSpawns[di++ % defSpawns.length];
      a.pos.set(def.x, 0, def.z);
      a.vel.set(0, 0, 0);
      a.yaw = def.yaw; a.pitch = 0; a.crouch = 0;
      a.recPitch = 0; a.recYaw = 0; a.adsAmount = 0; a.blindUntil = 0;
      a.speedNow = 0; a.grounded = true;
      if (a.mesh) a.mesh.reset();
      if (a.brain) resetBrain(a);
      if (!a.isPlayer) botBuy(a);
    }
    // the player carries the charge; if a bot ever has it, it is by pickup
    S.bomb.carrier = S.player;
    S.bomb.state = 'carried';
    PlayerCtl.spawn(S.player, WORLD.spawns.atk[0]);
    // defender posts and attacker lanes
    const defs = S.actors.filter((a) => a.team === 'def');
    const posts = [...WORLD.holds.A, ...WORLD.holds.B, ...WORLD.holds.mid];
    defs.forEach((d, i) => { d.brain.post = posts[i % posts.length]; d.brain.site = i % 5 < 2 ? 'A' : i % 5 < 4 ? 'B' : 'mid'; });
    const atks = S.actors.filter((a) => a.team === 'atk' && !a.isPlayer);
    atks.forEach((b, i) => { b.brain.lane = ['A', 'A', 'B'][i % 3]; });
  },

  startLive() {
    S.phase = 'live';
    Hud.onPhase();
    Hud.toast(`Round ${S.round} — ${S.player.team === 'atk' ? 'plant the charge or clear the Watch' : 'hold the sites'}`);
  },

  update(dt) {
    // the bomb prop follows its state
    const b = S.bomb;
    if (b.state === 'dropped' || b.state === 'planted') {
      bombMesh.visible = true;
      bombMesh.position.copy(b.pos);
      bombLight.material.emissiveIntensity = b.state === 'planted'
        ? (Math.sin(S.time * (4 + (BOMB_TIME - b.timer))) > 0 ? 3.2 : 0.3)
        : 1.2;
    } else if (b.state === 'carried' && b.carrier && b.carrier.mesh) {
      bombMesh.visible = true;
      bombMesh.position.copy(b.carrier.pos);
      bombMesh.position.y += 0.4;
      bombLight.material.emissiveIntensity = 0.6;
    } else bombMesh.visible = false;

    if (S.phase === 'buy') {
      S.phaseLeft -= dt;
      if (S.phaseLeft <= 0) this.startLive();
      return;
    }
    if (S.phase === 'over') {
      S.phaseLeft -= dt;
      if (S.phaseLeft <= 0) {
        if (S.scoreAtk >= S.winsNeeded || S.scoreDef >= S.winsNeeded || S.round >= S.maxRounds) {
          S.phase = 'matchover';
          if (S.scoreAtk > S.scoreDef) AudioSys.matchWin();
          Hud.onPhase();
        } else this.nextRound();
      }
      return;
    }
    if (S.phase !== 'live') return;

    // planted: the only clock that matters is the charge's
    if (b.state === 'planted') {
      b.timer -= dt;
      if (S.time >= beepAt) {
        AudioSys.beep(b.timer < 5);
        beepAt = S.time + Math.max(0.18, b.timer / BOMB_TIME * 0.9);
        hear(b.pos, 12, 'beep');
      }
      if (b.timer <= 0) {
        explosionFx(b.pos);
        AudioSys.explosion(1, 0);
        b.state = 'detonated';
        endRound('atk', 'detonation');
      }
      return;
    }
    S.roundClock -= dt;
    if (S.roundClock <= 0) { endRound('def', 'time'); return; }

    // a dropped charge is picked up by the first Union hand over it
    if (b.state === 'dropped') {
      for (const a of S.actors) {
        if (a.alive && a.team === 'atk' && a.pos.distanceTo(b.pos) < 1.3) {
          b.carrier = a; b.state = 'carried';
          if (a.isPlayer) Hud.toast('You have the charge');
          break;
        }
      }
    }
    // the player's own plant channel (bots use channelInteract from their brain)
    const p = S.player;
    if (p.alive && b.carrier === p && siteAt(p.pos.x, p.pos.z)) {
      if (Input.held('KeyE')) channelInteract(p, dt);
      else if (b.channelBy === p) { b.channel = 0; b.channelBy = null; }
    } else if (b.channelBy === p) { b.channel = 0; b.channelBy = null; }
  },
};

// Shared plant/defuse channel for the player (E held) and for bots (their
// brain holds position and calls this). Moving or dying cancels it — both are
// checked by the callers and by killActor.
export function channelInteract(actor, dt) {
  const b = S.bomb;
  if (actor.team === 'atk' && b.state === 'carried' && b.carrier === actor) {
    const site = siteAt(actor.pos.x, actor.pos.z);
    if (!site) return false;
    if (b.channelBy !== actor) { b.channelBy = actor; b.channel = 0; }
    b.channel += dt;
    if (Math.floor(b.channel * 4) !== Math.floor((b.channel - dt) * 4)) AudioSys.click();
    if (b.channel >= PLANT_TIME) {
      b.state = 'planted';
      b.site = site;
      b.pos = actor.pos.clone();
      b.timer = BOMB_TIME;
      b.carrier = null;
      b.channel = 0; b.channelBy = null;
      beepAt = S.time;
      actor.plants++;
      actor.money = Math.min(16000, actor.money + 300);
      AudioSys.plantDone();
      Hud.toast(`Charge planted at site ${site}`);
      hear(b.pos, 20, 'plant', 'atk');
    }
    return true;
  }
  if (actor.team === 'def' && b.state === 'planted') {
    if (actor.pos.distanceTo(b.pos) > 2.3) return false;
    if (b.channelBy !== actor) { b.channelBy = actor; b.channel = 0; }
    b.channel += dt;
    if (Math.floor(b.channel * 3) !== Math.floor((b.channel - dt) * 3)) AudioSys.click();
    if (b.channel >= DEFUSE_TIME) {
      b.state = 'defused';
      b.channel = 0; b.channelBy = null;
      actor.defuses++;
      AudioSys.defuseDone();
      endRound('def', 'defuse');
    }
    return true;
  }
  return false;
}

function endRound(winner, reason) {
  if (S.phase !== 'live') return;
  S.phase = 'over';
  S.phaseLeft = 5.5;
  S.bomb.channel = 0; S.bomb.channelBy = null;
  if (winner === 'atk') { S.scoreAtk++; S.lossStreak.atk = 0; S.lossStreak.def++; }
  else { S.scoreDef++; S.lossStreak.def = 0; S.lossStreak.atk++; }
  for (const a of S.actors) {
    if (a.team === winner) a.money = Math.min(16000, a.money + 2700);
    else {
      const streak = Math.min(S.lossStreak[a.team], 4);
      a.money = Math.min(16000, a.money + 1400 + 500 * (streak - 1));
    }
  }
  S.lastRound = { winner, reason };
  if (winner === S.player.team) AudioSys.roundWin(); else AudioSys.roundLose();
  Hud.onPhase();
}
