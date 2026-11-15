// physics.js — axis-aligned collision and ray tests against the map's boxes.
//
// The whole world is AABBs, so movement, cover and hit tests share one small
// vocabulary: moveAndSlide for bodies, rayHit for bullets and sight lines,
// bodyPart for the head/body/legs boxes a shot can strike. No allocations in
// these functions beyond their return values; the hot ones write into `out`.

import * as THREE from 'three';

export function boxCollider(cx, baseY, cz, w, h, d) {
  return {
    min: new THREE.Vector3(cx - w / 2, baseY, cz - d / 2),
    max: new THREE.Vector3(cx + w / 2, baseY + h, cz + d / 2),
  };
}

const STEP = 0.55; // ledges this high or lower are walked up, not blocked

// Highest walkable top under (x, z) at or below feetY + STEP. Ground is y = 0.
export function groundHeight(x, z, feetY, colliders) {
  let g = 0;
  for (const c of colliders) {
    if (x > c.min.x - 0.18 && x < c.max.x + 0.18 && z > c.min.z - 0.18 && z < c.max.z + 0.18) {
      if (c.max.y <= feetY + STEP && c.max.y > g) g = c.max.y;
    }
  }
  return g;
}

// Move a capsule (as an AABB of the given radius/height) one step. pos is the
// feet position; vel is read and corrected in place. Returns true if grounded.
export function moveAndSlide(pos, vel, dt, radius, height, colliders) {
  // vertical first: gravity is the caller's, we just integrate and land
  pos.y += vel.y * dt;
  const g = groundHeight(pos.x, pos.z, pos.y + (vel.y > 0 ? 0 : STEP), colliders);
  let grounded = false;
  if (pos.y <= g) { pos.y = g; if (vel.y < 0) vel.y = 0; grounded = true; }
  // ceiling: a collider whose underside is inside the body while rising
  if (vel.y > 0) {
    for (const c of colliders) {
      if (pos.x > c.min.x - radius && pos.x < c.max.x + radius &&
          pos.z > c.min.z - radius && pos.z < c.max.z + radius &&
          c.min.y > pos.y && c.min.y < pos.y + height) {
        pos.y = c.min.y - height; vel.y = 0;
      }
    }
  }
  // horizontal, one axis at a time so corners slide instead of sticking
  for (const axis of ['x', 'z']) {
    pos[axis] += vel[axis] * dt;
    for (const c of colliders) {
      if (c.max.y <= pos.y + STEP) continue; // walkable ledge, not a wall
      if (c.min.y >= pos.y + height) continue; // overhead, not a wall
      const overlapX = pos.x + radius > c.min.x && pos.x - radius < c.max.x;
      const overlapZ = pos.z + radius > c.min.z && pos.z - radius < c.max.z;
      if (overlapX && overlapZ) {
        if (axis === 'x') pos.x = vel.x > 0 ? c.min.x - radius : c.max.x + radius;
        else pos.z = vel.z > 0 ? c.min.z - radius : c.max.z + radius;
        vel[axis] = 0;
      }
    }
  }
  return grounded;
}

// Ray vs every collider; writes the nearest hit into out and returns it, or
// null. out: { dist, point:Vector3, normal:Vector3 }.
export function rayHit(o, d, maxDist, colliders, out) {
  let best = maxDist;
  let hit = null;
  for (const c of colliders) {
    // slab test
    let tmin = 0, tmax = best;
    let axis = -1, sign = 0;
    for (let i = 0; i < 3; i++) {
      const oi = i === 0 ? o.x : i === 1 ? o.y : o.z;
      const di = i === 0 ? d.x : i === 1 ? d.y : d.z;
      const mn = i === 0 ? c.min.x : i === 1 ? c.min.y : c.min.z;
      const mx = i === 0 ? c.max.x : i === 1 ? c.max.y : c.max.z;
      if (Math.abs(di) < 1e-9) {
        if (oi < mn || oi > mx) { tmin = -1; break; }
      } else {
        let t1 = (mn - oi) / di, t2 = (mx - oi) / di;
        let s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { tmin = -1; break; }
      }
    }
    if (tmin >= 0 && tmin < best) {
      best = tmin;
      hit = { c, axis, sign };
    }
  }
  if (!hit) return null;
  out.dist = best;
  out.point.copy(d).multiplyScalar(best).add(o);
  out.normal.set(0, 0, 0);
  if (hit.axis === 0) out.normal.x = hit.sign; else if (hit.axis === 1) out.normal.y = hit.sign; else out.normal.z = hit.sign;
  return out;
}

// True when the straight line a→b is interrupted by the map (cover, walls).
export function segmentBlocked(a, b, colliders, tmpDir, tmpHit) {
  tmpDir.copy(b).sub(a);
  const len = tmpDir.length();
  if (len < 0.001) return false;
  tmpDir.multiplyScalar(1 / len);
  return rayHit(a, tmpDir, len - 0.05, colliders, tmpHit) !== null;
}

// Body layout of a standing or crouching actor, shared by hit tests and the
// bot meshes so what you see is exactly what a bullet can hit.
export function bodyBoxes(actor) {
  const c = actor.crouch;
  const y = actor.pos.y;
  return {
    headC: { x: actor.pos.x, y: y + 1.56 - 0.46 * c, z: actor.pos.z },
    headR: 0.19,
    body: { minX: actor.pos.x - 0.30, maxX: actor.pos.x + 0.30, minY: y + 0.52 - 0.2 * c, maxY: y + 1.40 - 0.42 * c, minZ: actor.pos.z - 0.30, maxZ: actor.pos.z + 0.30 },
    legs: { minX: actor.pos.x - 0.26, maxX: actor.pos.x + 0.26, minY: y, maxY: y + 0.52 - 0.2 * c, minZ: actor.pos.z - 0.26, maxZ: actor.pos.z + 0.26 },
  };
}

function rayBox(o, d, b, maxDist) {
  let tmin = 0, tmax = maxDist;
  const mins = [b.minX, b.minY, b.minZ], maxs = [b.maxX, b.maxY, b.maxZ];
  const os = [o.x, o.y, o.z], ds = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ds[i]) < 1e-9) { if (os[i] < mins[i] || os[i] > maxs[i]) return -1; }
    else {
      let t1 = (mins[i] - os[i]) / ds[i], t2 = (maxs[i] - os[i]) / ds[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

// Ray vs one actor. Returns { part, dist } for the closest body part struck.
export function rayActor(o, d, actor, maxDist) {
  const bb = bodyBoxes(actor);
  // head sphere
  const ox = bb.headC.x - o.x, oy = bb.headC.y - o.y, oz = bb.headC.z - o.z;
  const tca = ox * d.x + oy * d.y + oz * d.z;
  let best = maxDist, part = null;
  if (tca > 0) {
    const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
    const r2 = bb.headR * bb.headR;
    if (d2 < r2) {
      const t = tca - Math.sqrt(r2 - d2);
      if (t < best) { best = t; part = 'head'; }
    }
  }
  const tb = rayBox(o, d, bb.body, best);
  if (tb >= 0 && tb < best) { best = tb; part = 'body'; }
  const tl = rayBox(o, d, bb.legs, best);
  if (tl >= 0 && tl < best) { best = tl; part = 'legs'; }
  return part ? { part, dist: best } : null;
}
