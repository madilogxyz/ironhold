// fx.js — transient visuals: tracers, muzzle flashes, impact dust, smoke,
// explosions. Everything is pooled and reused; a firefight allocates nothing.

import * as THREE from 'three';
import { S } from './state.js';
import { puffTex } from './textures.js';

const TRACERS = 40, PUFFS = 90;
let scene = null;
let tracerPool = [], puffPool = [], flashLight = null, flashSprite = null;
let puffTexture = null;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

export function initFx(scn) {
  scene = scn;
  puffTexture = puffTex();
  const tGeo = new THREE.BoxGeometry(0.03, 0.03, 1);
  const tMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < TRACERS; i++) {
    const m = new THREE.Mesh(tGeo, tMat.clone());
    m.visible = false;
    scene.add(m);
    tracerPool.push({ mesh: m, until: 0 });
  }
  const pGeo = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < PUFFS; i++) {
    const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({
      map: puffTexture, transparent: true, opacity: 0, depthWrite: false,
    }));
    m.visible = false;
    scene.add(m);
    puffPool.push({ mesh: m, t: 0, dur: 0, grow: 1, rise: 0, spin: 0 });
  }
  flashLight = new THREE.PointLight(0xffc37a, 0, 13, 1.8);
  scene.add(flashLight);
  flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: puffTexture, color: 0xffcf8a, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  flashSprite.scale.set(0.7, 0.7, 1);
  scene.add(flashSprite);
}

function puff(pos, color, size, dur, opacity, grow = 2.2, rise = 0.4) {
  for (const p of puffPool) {
    if (p.t < p.dur) continue;
    p.t = 0; p.dur = dur; p.grow = grow; p.rise = rise; p.spin = (Math.random() - 0.5) * 2;
    p.mesh.visible = true;
    p.mesh.position.copy(pos);
    p.mesh.material.color.set(color);
    p.mesh.material.opacity = opacity;
    p.mesh.scale.set(size, size, 1);
    p.baseOpacity = opacity; p.baseSize = size;
    return;
  }
}

export function tracer(from, to) {
  for (const t of tracerPool) {
    if (S.time < t.until) continue;
    t.until = S.time + 0.055;
    const m = t.mesh;
    m.visible = true;
    _v1.copy(to).sub(from);
    const len = _v1.length();
    m.position.copy(from).addScaledVector(_v1, 0.5);
    m.scale.set(1, 1, len);
    m.lookAt(to);
    m.material.opacity = 0.85;
    return;
  }
}

export function muzzle(pos, dir) {
  flashSprite.position.copy(pos).addScaledVector(dir, 0.1);
  flashSprite.material.opacity = 0.95;
  flashSprite.material.rotation = Math.random() * 6.28;
  flashLight.position.copy(pos);
  flashLight.intensity = 26;
}

export function impact(pos, normal, kind) {
  // kind: 'stone' pale dust, 'metal' sparks, 'body' dark red puff
  if (kind === 'metal') {
    for (let i = 0; i < 3; i++) {
      _v1.copy(pos).addScaledVector(normal, 0.05);
      _v1.x += (Math.random() - 0.5) * 0.1; _v1.y += Math.random() * 0.08;
      puff(_v1, 0xffc46b, 0.14 + Math.random() * 0.1, 0.22, 0.95, 1.4, 0.2);
    }
  } else if (kind === 'body') {
    puff(pos, 0x7d2015, 0.34, 0.4, 0.85, 2.4, 0.15);
    puff(pos, 0x5c150d, 0.22, 0.5, 0.8, 2.0, 0.1);
  } else { // stone and concrete: a pale dust burst kicked off the surface
    for (let i = 0; i < 3; i++) {
      _v1.copy(pos).addScaledVector(normal, 0.06);
      _v1.x += (Math.random() - 0.5) * 0.16; _v1.y += Math.random() * 0.1; _v1.z += (Math.random() - 0.5) * 0.16;
      puff(_v1, 0xd8c9a6, 0.2 + Math.random() * 0.16, 0.45, 0.65, 2.6, 0.3);
    }
  }
}

export function dust(pos, n = 2) {
  for (let i = 0; i < n; i++) {
    _v1.copy(pos);
    _v1.x += (Math.random() - 0.5) * 0.3; _v1.z += (Math.random() - 0.5) * 0.3; _v1.y += 0.05;
    puff(_v1, 0xc9b18c, 0.3 + Math.random() * 0.25, 0.55, 0.5, 2.4, 0.35);
  }
}

// A flashbang pop: one hard white bloom and a light spike.
export function flashFx(pos) {
  puff(pos, 0xffffff, 1.6, 0.28, 1, 2.2, 0.2);
  puff(pos, 0xfff2cf, 0.9, 0.4, 0.95, 2.4, 0.3);
  flashLight.position.copy(pos);
  flashLight.intensity = 160;
}

export function explosionFx(pos) {  puff(pos, 0xffa64d, 2.6, 0.5, 1, 3.2, 1.2);
  puff(pos, 0xff7847, 1.8, 0.7, 0.95, 3.0, 1.6);
  puff(pos, 0x55483a, 2.2, 1.4, 0.7, 2.6, 1.4);
  for (let i = 0; i < 10; i++) {
    _v1.set(pos.x + (Math.random() - 0.5) * 2.4, pos.y + Math.random() * 1.6, pos.z + (Math.random() - 0.5) * 2.4);
    puff(_v1, 0x6b5a44, 0.8, 1 + Math.random(), 0.6, 2.4, 0.9);
  }
  flashLight.position.copy(pos).y += 1;
  flashLight.intensity = 300;
  S.shake = Math.min(1.2, S.shake + 0.7);
}

export function smokeBloom(pos) {
  // the visual half of a smoke grenade; the blocking volume lives in S.smokes
  for (let i = 0; i < 14; i++) {
    _v1.set(pos.x + (Math.random() - 0.5) * 4.4, pos.y + 0.4 + Math.random() * 2.0, pos.z + (Math.random() - 0.5) * 4.4);
    puff(_v1, 0xb9bcbe, 2.6 + Math.random() * 1.6, 11 + Math.random() * 3, 0.34, 1.25, 0.12);
  }
}

export function updateFx(dt, camera) {
  for (const t of tracerPool) {
    if (!t.mesh.visible) continue;
    if (S.time >= t.until) { t.mesh.visible = false; continue; }
    t.mesh.material.opacity = Math.max(0, (t.until - S.time) / 0.055) * 0.85;
  }
  for (const p of puffPool) {
    if (!p.mesh.visible) continue;
    p.t += dt;
    if (p.t >= p.dur) { p.mesh.visible = false; p.mesh.material.opacity = 0; continue; }
    const k = p.t / p.dur;
    const s = p.baseSize * (1 + p.grow * k);
    p.mesh.scale.set(s, s, 1);
    p.mesh.position.y += p.rise * dt;
    p.mesh.material.opacity = p.baseOpacity * (1 - k) * (k < 0.12 ? k / 0.12 : 1);
    p.mesh.material.rotation += p.spin * dt;
    p.mesh.quaternion.copy(camera.quaternion); // billboard
  }
  if (flashSprite.material.opacity > 0) flashSprite.material.opacity = Math.max(0, flashSprite.material.opacity - dt * 16);
  if (flashLight.intensity > 0) flashLight.intensity = Math.max(0, flashLight.intensity - dt * 700);
}
