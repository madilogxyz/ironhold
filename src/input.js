// input.js — keyboard and mouse state, sampled by the fixed-step simulation.
//
// The sim reads held keys from `down`, one-shot presses from `pressed` (cleared
// at the end of each step), and mouse motion accumulated between steps, so the
// game plays identically at any display refresh rate.

export const Input = {
  down: new Set(),
  pressed: new Set(),
  mouseDX: 0,
  mouseDY: 0,
  firing: false,
  aiming: false,
  locked: false,
  enabled: false, // true while a round controls the player

  attach(canvas, onLockChange) {
    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); this.firing = false; this.aiming = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.aiming = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.aiming = false;
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.firing = false; this.aiming = false; }
      if (onLockChange) onLockChange(this.locked);
    });
  },

  lock(canvas) {
    if (this.locked) return;
    try {
      // newer Chrome returns a promise here; a refused lock (synthetic click,
      // wrong document) must never surface as an unhandled rejection
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* the pause menu stays available either way */ }
  },

  // Called by the simulation once per step: hands over accumulated mouse
  // motion and clears the one-shot press set.
  consume() {
    const dx = this.mouseDX, dy = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;
    return { dx, dy };
  },
  endStep() { this.pressed.clear(); },
  held(code) { return this.down.has(code); },
  tapped(code) { return this.pressed.has(code); },
};
