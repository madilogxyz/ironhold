// player.js — the human's body: mouse look and Source-style movement.
//
// Acceleration and friction, not velocity snapping: stopping is fast, starting
// is weighty, air control is weak, and jumping throws your aim off — the sim
// numbers the gunplay in weapons.js reads to price accuracy. Crouching is a
// stance you slide into, sprinting is loud, and footsteps are real noise the
// bots can hear (state.hear).

import * as THREE from 'three';
import { S, hear } from './state.js';
import { Input } from './input.js';
import { moveAndSlide } from './physics.js';
import { WORLD } from './world.js';
import { AudioSys } from './audio.js';

const WALK = 4.35, SPRINT = 5.7, CROUCH_SPEED = 2.15;
const GRAVITY = 20, JUMP_VEL = 6.0;
const _wish = new THREE.Vector3();
const _fwd = new THREE.Vector3(), _rgt = new THREE.Vector3();

export function aimDir(actor, out) {
  const p = actor.pitch + (actor.recPitch || 0);
  const cp = Math.cos(p);
  out.set(-Math.sin(actor.yaw) * cp, Math.sin(p), -Math.cos(actor.yaw) * cp);
  return out;
}
export function flatForward(actor, out) {
  out.set(-Math.sin(actor.yaw), 0, -Math.cos(actor.yaw));
  return out;
}

export const PlayerCtl = {
  bobPhase: 0, landDip: 0, landVel: 0, stepAcc: 0, wasGrounded: true, airTime: 0,

  spawn(actor, def) {
    actor.pos.set(def.x, 0, def.z);
    actor.vel.set(0, 0, 0);
    actor.yaw = def.yaw;
    actor.pitch = 0;
    actor.crouch = 0;
    actor.recPitch = 0; actor.recYaw = 0;
    actor.eyePos = new THREE.Vector3(def.x, 1.62, def.z);
    this.bobPhase = 0; this.landDip = 0; this.stepAcc = 0;
  },

  update(dt) {
    const a = S.player;
    if (!a.alive) return;
    const { dx, dy } = Input.consume();
    const sens = (a.adsAmount > 0.5 && a.loadout?.current === 'sniper') ? 0.0009 : 0.0021;
    a.yaw -= dx * sens;
    a.pitch = Math.max(-1.45, Math.min(1.45, a.pitch - dy * sens));

    // stance
    const wantCrouch = Input.held('ControlLeft') || Input.held('KeyC');
    a.crouch += ((wantCrouch ? 1 : 0) - a.crouch) * Math.min(1, dt * 9);
    const fwdKey = Input.held('KeyW') || Input.held('ArrowUp');
    const sprinting = Input.held('ShiftLeft') && fwdKey && a.crouch < 0.3 && a.adsAmount < 0.2;
    a.sprinting = sprinting;

    flatForward(a, _fwd);
    _rgt.set(-_fwd.z, 0, _fwd.x);
    _wish.set(0, 0, 0);
    if (fwdKey) _wish.add(_fwd);
    if (Input.held('KeyS') || Input.held('ArrowDown')) _wish.sub(_fwd);
    if (Input.held('KeyD')) _wish.add(_rgt);
    if (Input.held('KeyA')) _wish.sub(_rgt);
    const wishLen = _wish.length();
    if (wishLen > 0) _wish.multiplyScalar(1 / wishLen);
    const wishSpeed = a.crouch > 0.5 ? CROUCH_SPEED : sprinting ? SPRINT : WALK;

    const vel = a.vel;
    const wasGrounded = a.grounded;
    if (a.grounded) {
      // friction, then accelerate toward the wish direction
      const sp = Math.hypot(vel.x, vel.z);
      if (sp > 0) {
        const drop = sp * 9 * dt;
        const k = Math.max(0, sp - drop) / sp;
        vel.x *= k; vel.z *= k;
      }
      accelerate(vel, _wish, wishSpeed, 11, dt);
      if (Input.tapped('Space')) {
        vel.y = JUMP_VEL;
        a.grounded = false;
        AudioSys.jump();
      }
    } else {
      // weak air control, and no way to gain speed by strafing in the air
      const sp = Math.hypot(vel.x, vel.z);
      accelerate(vel, _wish, Math.min(wishSpeed, sp + 0.55), 0.9, dt);
      this.airTime += dt;
    }
    vel.y -= GRAVITY * dt;
    const fallSpeed = -vel.y;
    a.grounded = moveAndSlide(a.pos, vel, dt, a.radius, a.standHeight - 0.55 * a.crouch, WORLD.colliders);
    a.speedNow = Math.hypot(vel.x, vel.z);
    if (a.grounded && !wasGrounded) {
      this.landVel = Math.min(0.16, fallSpeed * 0.012);
      AudioSys.land();
      if (fallSpeed > 6) hear(a.pos, 9, 'land', a.team);
      this.airTime = 0;
    }
    // footsteps: distance-based, and sprinting carries across the yard
    if (a.grounded && a.speedNow > 0.6) {
      this.stepAcc += a.speedNow * dt;
      const stride = sprinting ? 3.1 : 2.3;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        AudioSys.step(sprinting);
        if (a.crouch < 0.5) hear(a.pos, sprinting ? 15 : 7.5, 'step', a.team);
      }
      this.bobPhase += dt * a.speedNow * 1.55;
    }
    // eye position, with a landing dip that springs back
    this.landDip += this.landVel;
    this.landVel += (-this.landDip * 90 - this.landVel * 12) * dt;
    const bobY = Math.sin(this.bobPhase * 2) * 0.026 * Math.min(1, a.speedNow / WALK);
    a.eyeHeight = 1.62 - 0.5 * a.crouch;
    a.eyePos.set(a.pos.x, a.pos.y + a.eyeHeight + bobY - this.landDip, a.pos.z);
  },

  updateCamera(camera, dt) {
    const a = S.player;
    S.shake = Math.max(0, S.shake - dt * 2.6);
    const sh = S.shake * S.shake * 0.05;
    const t = performance.now() * 0.001;
    camera.position.copy(a.eyePos);
    camera.position.x += Math.sin(t * 61) * sh;
    camera.position.y += Math.cos(t * 53) * sh;
    camera.rotation.order = 'YXZ';
    camera.rotation.y = a.yaw + (a.recYaw || 0);
    camera.rotation.x = a.pitch + (a.recPitch || 0);
    camera.rotation.z = Math.sin(this.bobPhase) * 0.0035 * Math.min(1, a.speedNow / WALK) + Math.sin(t * 47) * sh * 0.4;
    // field of view: ADS narrows it (weapons.js drives adsFov), sprint widens a touch
    const target = a.adsFov || (a.sprinting && a.speedNow > 4.6 ? 76 : 73);
    camera.fov += (target - camera.fov) * Math.min(1, dt * 11);
    camera.updateProjectionMatrix();
  },
};

function accelerate(vel, wishDir, wishSpeed, accel, dt) {
  const proj = vel.x * wishDir.x + vel.z * wishDir.z;
  const add = wishSpeed - proj;
  if (add <= 0) return;
  const acc = Math.min(accel * wishSpeed * dt, add);
  vel.x += wishDir.x * acc;
  vel.z += wishDir.z * acc;
}
