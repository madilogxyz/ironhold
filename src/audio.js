// audio.js — all sound is synthesized with WebAudio; no audio files exist.
//
// Gunshots are shaped noise bursts over a low sine thump, hits are short ticks,
// the charge beeps, the defuse kit whirs. Distant shots are passed through a
// lowpass and panned, so a firefight across the yard sounds across the yard.

let ctx = null;
let master = null;
let noiseBuf = null;

export const AudioSys = {
  ready: false,

  init() {
    if (this.ready) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 1.2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.ready = true;
    } catch { /* no audio device: the game stays silent, never broken */ }
  },
  resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },

  // A burst of filtered noise. vol 0..1, freq the lowpass corner, dur seconds,
  // pan -1..1. The workhorse under almost every effect below.
  burst(vol, freq, dur, pan = 0, type = 'lowpass', when = 0) {
    if (!this.ready) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    let node = g;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p); node = p;
    }
    src.connect(f); f.connect(g); node.connect(master);
    src.start(t); src.stop(t + dur + 0.05);
  },

  tone(freq, vol, dur, type = 'sine', slideTo = 0, when = 0) {
    if (!this.ready) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  },

  // vol/pan let callers place other people's shots in the world.
  shot(kind, vol = 1, pan = 0) {
    if (!this.ready) return;
    const near = vol > 0.55;
    if (kind === 'sniper') {
      this.burst(0.9 * vol, near ? 2600 : 500, 0.42, pan);
      this.tone(120, 0.5 * vol, 0.18, 'triangle', 40);
    } else if (kind === 'shotgun') {
      this.burst(0.95 * vol, near ? 1900 : 420, 0.3, pan);
      this.tone(90, 0.5 * vol, 0.16, 'triangle', 45);
    } else if (kind === 'smg') {
      this.burst(0.55 * vol, near ? 3400 : 700, 0.11, pan);
    } else if (kind === 'pistol') {
      this.burst(0.6 * vol, near ? 3000 : 650, 0.13, pan);
      this.tone(160, 0.25 * vol, 0.07, 'triangle', 70);
    } else { // rifle
      this.burst(0.8 * vol, near ? 2400 : 550, 0.2, pan);
      this.tone(110, 0.4 * vol, 0.12, 'triangle', 50);
    }
    this.burst(0.25 * vol, 6000, 0.04, pan, 'highpass'); // mechanical snap
  },
  dryFire() { this.burst(0.2, 4000, 0.04, 0, 'bandpass'); },
  reload(stage) {
    if (stage === 0) { this.burst(0.3, 1800, 0.06, 0, 'bandpass'); this.tone(300, 0.08, 0.05, 'square'); }
    else if (stage === 1) { this.burst(0.35, 1200, 0.07, 0, 'bandpass'); }
    else { this.burst(0.4, 2200, 0.06, 0, 'bandpass'); this.tone(520, 0.1, 0.05, 'square'); }
  },
  draw() { this.burst(0.22, 2600, 0.07, 0, 'bandpass'); },
  hit(head) {
    this.tone(head ? 1560 : 1180, 0.16, 0.06, 'sine');
    if (head) this.tone(2093, 0.12, 0.09, 'sine', 0, 0.03);
  },
  kill() { this.tone(880, 0.14, 0.08, 'sine'); this.tone(1318, 0.14, 0.12, 'sine', 0, 0.06); },
  hurt() { this.burst(0.3, 500, 0.12); this.tone(140, 0.2, 0.12, 'sawtooth', 80); },
  step(run) { this.burst(run ? 0.13 : 0.07, 480, 0.07); },
  land() { this.burst(0.22, 380, 0.1); },
  jump() { this.burst(0.08, 700, 0.06); },
  throwNade() { this.burst(0.15, 1500, 0.1, 0, 'bandpass'); },
  explosion(vol = 1, pan = 0) {
    this.burst(1.0 * vol, 300, 0.9, pan);
    this.burst(0.7 * vol, 120, 1.3, pan);
    this.tone(55, 0.7 * vol, 0.8, 'sine', 30);
  },
  flashPop(vol = 1, pan = 0) {
    this.burst(0.7 * vol, 5000, 0.16, pan, 'highpass');
    this.tone(3400, 0.2 * vol, 0.5, 'sine', 3200);
  },
  bounce() { this.burst(0.18, 900, 0.05, 0, 'bandpass'); },
  beep(final = false) { this.tone(final ? 1560 : 1040, 0.16, final ? 0.3 : 0.08, 'square'); },
  plantDone() { this.tone(784, 0.15, 0.09, 'square'); this.tone(1046, 0.15, 0.12, 'square', 0, 0.09); },
  defuseDone() { this.tone(1046, 0.15, 0.09, 'square'); this.tone(784, 0.15, 0.14, 'square', 0, 0.09); },
  buy() { this.tone(1320, 0.1, 0.06, 'sine'); this.tone(1760, 0.1, 0.08, 'sine', 0, 0.05); },
  denied() { this.tone(220, 0.12, 0.12, 'square', 180); },
  click() { this.tone(980, 0.07, 0.04, 'sine'); },
  roundWin() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.14, 0.16, 'triangle', 0, i * 0.09)); },
  roundLose() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.14, 0.18, 'triangle', 0, i * 0.1)); },
  matchWin() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, 0.22, 'triangle', 0, i * 0.11)); },
};
