// state.js — the one place match state lives.
//
// Every module reads and writes through S, so a round can be reset, staged for a
// screenshot, or inspected from the console (`window.__ironhold`) without hunting
// through closures. Actors (the player and every bot) share one shape so combat
// code never branches on who it is hurting.

export const TEAM = { ATK: 'atk', DEF: 'def' };

export const S = {
  phase: 'menu', // menu | buy | live | over | matchover
  paused: false,
  shotMode: null, // 'start' | 'play' | 'buy' | 'end' when staged for screenshots
  time: 0, // simulation seconds since boot
  round: 0,
  scoreAtk: 0,
  scoreDef: 0,
  winsNeeded: 7,
  maxRounds: 13,
  phaseLeft: 0, // seconds left in the current phase
  roundClock: 105, // seconds on the round clock while live
  lossStreak: { atk: 0, def: 0 },
  actors: [], // every combatant, player first
  player: null,
  smokes: [], // { pos, r, until } — vision blockers, read by bots and LOS
  noise: [], // { pos, radius, t, kind } — recent sounds bots can react to
  bomb: {
    state: 'carried', // carried | dropped | planting | planted | defusing | detonated | defused
    carrier: null, pos: null, site: null, timer: 0, channel: 0, channelBy: null,
  },
  lastRound: null, // { winner, reason, mvp } for the banner
  feed: [], // killfeed entries the HUD has not shown yet
  bannerQueue: [],
  shake: 0, // camera shake impulse, decays in the player update
  slowmo: 1,
};

let nextId = 1;

// One actor shape for the human and the bots. Combat stats that differ per
// combatant (skill, reaction) live on the bot brain, not here.
export function makeActor(team, name, isPlayer) {
  return {
    id: nextId++, team, name, isPlayer: !!isPlayer,
    alive: true, hp: 100, armor: 0, helmet: false,
    pos: null, vel: null, // Vector3, filled at spawn (feet position)
    yaw: 0, pitch: 0, crouch: 0, grounded: true,
    radius: 0.36, standHeight: 1.78, eyeHeight: 1.62,
    money: 800, kills: 0, deaths: 0, plants: 0, defuses: 0,
    loadout: null, // weapons.js WeaponKit
    brain: null, // bots.js brain (null for the player)
    mesh: null, // bots.js view (null for the player)
    lastHurtBy: null, lastHurtAt: -9, lastShotAt: -9,
    deadAt: 0,
  };
}

export function aliveOn(team) {
  let n = 0;
  for (const a of S.actors) if (a.alive && a.team === team) n++;
  return n;
}

export function hear(pos, radius, kind, team = null) {
  S.noise.push({ pos: pos.clone(), radius, t: S.time, kind, team });
  if (S.noise.length > 24) S.noise.splice(0, S.noise.length - 24);
}

// Sounds older than a second and a half are forgotten; called once per step.
export function pruneNoise() {
  while (S.noise.length && S.time - S.noise[0].t > 1.5) S.noise.shift();
}

export function resetBomb() {
  S.bomb.state = 'carried';
  S.bomb.carrier = null;
  S.bomb.pos = null;
  S.bomb.site = null;
  S.bomb.timer = 0;
  S.bomb.channel = 0;
  S.bomb.channelBy = null;
}
