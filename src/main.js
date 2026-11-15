// main.js — boot, the fixed-step loop, cameras, and the screenshot stagings.
//
// The simulation advances in fixed 1/60 steps from an accumulator, apart from
// rendering: the same machine at any refresh rate plays the same game. The
// render side only reads state — the player camera (or a slow orbit behind
// the menu), the HUD, and the pooled effects.
//
// The ?shot= modes stage deterministic scenes (start menu, a live firefight,
// the buy phase, the end screen) so the entry's screenshots are real renders
// of this code on this map, taken by script — see shots.json.

import * as THREE from 'three';
import { S, makeActor, pruneNoise } from './state.js';
import { buildWorld, WORLD } from './world.js';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { initFx, updateFx } from './fx.js';
import { PlayerCtl } from './player.js';
import { updatePlayerWeapons, updateViewmodel, updateGrenades, makeKit } from './weapons.js';
import { createBotMesh, makeBrain, updateBot } from './bots.js';
import { Rounds, initRounds } from './rounds.js';
import { Hud } from './hud.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const shot = params.get('shot');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.domElement.className = 'webgl';
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(73, innerWidth / innerHeight, 0.05, 300);
scene.add(camera);
// a soft warm fill riding the camera so the held weapon reads even in shadow
const fill = new THREE.PointLight(0xffd9a8, 5, 6, 1.8);
fill.position.set(0.15, 0.05, -0.1);
camera.add(fill);
S.scene = scene;

buildWorld(scene);
initFx(scene);
initRounds(scene);

// ---------- the cast ----------
function newActor(team, name, isPlayer, skill) {
  const a = makeActor(team, name, isPlayer);
  a.pos = new THREE.Vector3();
  a.vel = new THREE.Vector3();
  a.loadout = null;
  if (!isPlayer) {
    a.brain = makeBrain(a, skill);
    createBotMesh(a, scene);
  }
  S.actors.push(a);
  return a;
}
S.player = newActor('atk', 'YOU', true, 0);
newActor('atk', 'Rook', false, 0.5);
newActor('atk', 'Sable', false, 0.58);
newActor('atk', 'Ivo', false, 0.44);
newActor('atk', 'Pell', false, 0.52);
newActor('def', 'Maren', false, 0.55);
newActor('def', 'Kost', false, 0.62);
newActor('def', 'Vera', false, 0.5);
newActor('def', 'Hale', false, 0.66);
newActor('def', 'Odo', false, 0.47);
for (const a of S.actors) a.loadout = makeKit();
Rounds.setupRound(); // populate the yard behind the menu

// ---------- flow control ----------
function startFromMenu() {
  Rounds.startMatch();
  if (!shot) Input.lock(renderer.domElement);
}
function resumeGame() {
  S.paused = false;
  if (!shot) Input.lock(renderer.domElement);
}
function restartMatch() {
  S.paused = false;
  Rounds.startMatch();
  if (!shot) Input.lock(renderer.domElement);
}
Hud.init({ onPlay: startFromMenu, onResume: resumeGame, onRestart: restartMatch, onAgain: restartMatch });
window.__ironholdHud = Hud; // staging/testing handle for the screenshot script
window.__ironholdInput = Input;
Input.attach(renderer.domElement, (locked) => {
  if (shot) return;
  if (!locked && (S.phase === 'buy' || S.phase === 'live')) S.paused = true;
  if (locked) S.paused = false;
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- the simulation step ----------
let frozen = false;
function step(dt) {
  S.time += dt;
  pruneNoise();
  if (S.phase === 'buy' || S.phase === 'live' || S.phase === 'over') Rounds.update(dt);
  if (S.phase === 'live') {
    if (S.player.alive) PlayerCtl.update(dt);
    for (const a of S.actors) if (a.brain) updateBot(a, dt);
    updatePlayerWeapons(dt, camera);
    updateGrenades(dt);
  } else if (S.phase === 'over') {
    updateGrenades(dt);
    for (const a of S.actors) if (a.mesh) a.mesh.update(dt);
  } else if (S.phase === 'buy') {
    updateViewmodel(dt, camera, S.player);
    for (const a of S.actors) if (a.mesh) a.mesh.update(dt);
  }
  Input.endStep();
}

// ---------- screenshot stagings ----------
function stageShot(kind) {
  S.shotMode = kind;
  if (kind === 'start') return; // the menu over the orbiting yard is the shot
  if (kind === 'buy') {
    Rounds.startMatch();
    S.player.money = 4200;
    Hud.setBuyOpen(true);
    Hud.refreshBuy();
    return;
  }
  if (kind === 'end') {
    Rounds.startMatch();
    S.scoreAtk = 7; S.scoreDef = 4;
    const stats = [[9, 4, 2], [6, 5, 0], [4, 6, 1], [3, 5, 0], [2, 7, 0], [7, 6, 0], [5, 7, 0], [4, 4, 0], [2, 8, 0], [1, 6, 0]];
    S.actors.forEach((a, i) => { a.kills = stats[i][0]; a.deaths = stats[i][1]; a.plants = stats[i][2]; });
    S.phase = 'matchover';
    Hud.onPhase();
    return;
  }
  if (kind === 'play') {
    Rounds.startMatch();
    Rounds.startLive();
    const p = S.player;
    // dress the player: rifle, vest, and a staged push into the Furnace Yard —
    // open sky, the furnace ahead, two Watch posted on the site
    const kit = p.loadout;
    kit.owned.rifle = true; kit.mags.rifle = 24; kit.reserve.rifle = 90; kit.current = 'rifle';
    p.armor = 100; p.helmet = true; p.money = 2350;
    PlayerCtl.spawn(p, { x: -21.5, z: -7.5, yaw: 0.05 });
    const defs = S.actors.filter((a) => a.team === 'def');
    defs[0].pos.set(-24.5, 0, -24); defs[0].yaw = Math.PI;
    defs[1].pos.set(-15.5, 0, -17.5); defs[1].yaw = Math.PI - 0.3;
    defs[2].pos.set(-18, 0, -24); defs[2].yaw = Math.PI;
    const mates = S.actors.filter((a) => a.team === 'atk' && !a.isPlayer);
    mates[0].pos.set(-24.5, 0, -4); mates[0].yaw = 0;
    S.roundClock = 74;
    Hud.killfeed(S.actors[1], defs[3], 'VK-7 Rifle', false);
    // run the sim forward deterministically; the player fires in the last
    // steps so the frozen frame holds a tracer and a muzzle flash
    for (let i = 0; i < 72; i++) {
      Input.firing = i >= 63 && i <= 68;
      step(STEP);
    }
    Input.firing = false;
    frozen = true;
  }
}
if (shot) stageShot(shot);
window.__ironhold = S;

// ---------- the frame ----------
const clock = new THREE.Timer();
let acc = 0;
function frame() {
  requestAnimationFrame(frame);
  clock.update();
  const dtReal = Math.min(0.1, clock.getDelta());
  if (!S.paused && !frozen) {
    acc += dtReal;
    while (acc >= STEP) { step(STEP); acc -= STEP; }
  }
  if (S.phase === 'menu' || S.phase === 'matchover') {
    // a slow orbit over the yard behind the menus
    const t = performance.now() * 0.001;
    camera.position.set(Math.sin(t * 0.045) * 33, 19 + Math.sin(t * 0.11) * 2, Math.cos(t * 0.045) * 33 - 4);
    camera.lookAt(0, 0.5, -8);
    camera.fov += (58 - camera.fov) * Math.min(1, dtReal * 3);
    camera.updateProjectionMatrix();
  } else if (S.player.alive) {
    PlayerCtl.updateCamera(camera, dtReal);
  } else {
    // death cam: slumped at the corpse, watching the round play out
    camera.position.set(S.player.pos.x, S.player.pos.y + 0.42, S.player.pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(S.player.pitch, S.player.yaw, 0.5);
  }
  updateFx(dtReal, camera);
  Hud.update(dtReal);
  renderer.render(scene, camera);
}
frame();
