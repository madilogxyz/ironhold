// hud.js — everything drawn over the canvas: vitals, ammo, the top bar, the
// minimap, the killfeed, the buy menu, banners and the end screen.
//
// The HUD only reads state and writes DOM; it never touches the simulation.
// Text writes are cached so a steady frame touches the DOM almost nowhere,
// and the minimap redraws at 10 Hz from the same colliders the bullets use.

import { S, aliveOn } from './state.js';
import { WORLD } from './world.js';
import { WEAPONS, BUY_ITEMS, spreadFor } from './weapons.js';
import { AudioSys } from './audio.js';

const $ = (id) => document.getElementById(id);
const els = {};
let buyOpen = false;
let lastPhase = '';
let dmgMark = { yaw: 0, t: -9 };
let hitT = -9, hitKind = '';
let toastTimer = 0;
let scopeEl = null;
const textCache = new Map();
function setText(el, txt) {
  if (textCache.get(el) === txt) return;
  textCache.set(el, txt);
  el.textContent = txt;
}
function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export const Hud = {
  init(callbacks) {
    for (const id of ['hud', 'topbar', 'score-atk', 'score-def', 'timer', 'timer-lab', 'tb-phase', 'minimap', 'killfeed',
      'hpnum', 'hpbar', 'armor', 'money', 'wname', 'ammo', 'slots', 'cross', 'hitmark', 'dmgarc', 'vig', 'flashblind',
      'bombbar', 'bomblab', 'bombfill', 'interact', 'interact-lab', 'interact-fill', 'banner', 'centermsg',
      'menu', 'buy', 'buytimer', 'buymoney', 'buygrid', 'pause', 'endscreen', 'endtitle', 'endsub', 'endtable', 'toast']) {
      els[id] = $(id);
    }
    els.bannerBig = els.banner.querySelector('.big');
    els.bannerSub = els.banner.querySelector('.sub');
    scopeEl = document.createElement('div');
    scopeEl.id = 'scope';
    scopeEl.style.cssText = 'position:fixed;inset:0;z-index:6;pointer-events:none;display:none;' +
      'background:radial-gradient(circle at 50% 50%, transparent 26%, rgba(0,0,0,.97) 27%);';
    const crossLines = document.createElement('div');
    crossLines.style.cssText = 'position:absolute;left:50%;top:50%;width:340px;height:340px;transform:translate(-50%,-50%);' +
      'border:1.5px solid rgba(10,10,10,.85);border-radius:50%;';
    scopeEl.appendChild(crossLines);
    document.body.appendChild(scopeEl);
    $('playbtn').addEventListener('click', () => { AudioSys.init(); AudioSys.resume(); AudioSys.click(); callbacks.onPlay(); });
    $('howbtn').addEventListener('click', () => { $('howtext').classList.toggle('hidden'); AudioSys.click(); });
    $('resumebtn').addEventListener('click', () => callbacks.onResume());
    $('restartbtn').addEventListener('click', () => callbacks.onRestart());
    $('againbtn').addEventListener('click', () => callbacks.onAgain());
    addEventListener('keydown', (e) => {
      if (S.phase === 'buy' && buyOpen) {
        if (e.code === 'KeyB') { buyOpen = false; AudioSys.click(); }
        else if (e.code.startsWith('Digit')) {
          const n = Number(e.code.slice(5));
          if (n >= 1 && n <= BUY_ITEMS.length) this.tryBuy(BUY_ITEMS[n - 1]);
        }
      }
    });
    this.buildBuyGrid();
  },

  buildBuyGrid() {
    els.buygrid.innerHTML = '';
    for (const item of BUY_ITEMS) {
      const b = document.createElement('button');
      b.className = 'buyitem';
      b.dataset.id = item.id;
      b.innerHTML = `<span class="key">${item.key}</span><span class="pr">$${item.price}</span>` +
        `<div class="nm">${item.name}</div><div class="ds">${item.desc}</div>`;
      b.addEventListener('click', () => this.tryBuy(item));
      els.buygrid.appendChild(b);
    }
  },

  tryBuy(item) {
    const p = S.player;
    if (!p || S.phase !== 'buy') return;
    if (p.money < item.price || !item.apply(p)) { AudioSys.denied(); return; }
    p.money -= item.price;
    AudioSys.buy();
    if (item.id === 'armor' || item.id === 'armorhelm' || ['smg', 'shotgun', 'rifle', 'sniper'].includes(item.id)) {
      // bots mirror the purchase visually through botBuy; the player's gun swaps now
      const kit = p.loadout;
      if (kit.models) for (const k of Object.keys(kit.models)) kit.models[k].visible = false;
    }
    this.refreshBuy();
  },

  refreshBuy() {
    const p = S.player;
    if (!p) return;
    setText(els.buymoney, `$${p.money}`);
    for (const child of els.buygrid.children) {
      const item = BUY_ITEMS.find((b) => b.id === child.dataset.id);
      const owned = (item.id === 'armor' && p.armor >= 100) ||
        (item.id === 'armorhelm' && p.armor >= 100 && p.helmet) ||
        (p.loadout.owned[item.id]) || (p.loadout.nades[item.id] >= 2);
      child.classList.toggle('owned', !!owned);
      child.classList.toggle('cant', !owned && p.money < item.price);
    }
  },

  setBuyOpen(v) { buyOpen = v; },

  onPhase() {
    // rounds.js calls this on every phase change; DOM visibility follows state
    if (S.phase === 'buy') { buyOpen = !S.shotMode; this.refreshBuy(); }
    if (S.phase === 'matchover') this.fillEndScreen();
    if (S.phase === 'over' && S.lastRound) {
      const won = S.lastRound.winner === S.player.team;
      els.banner.className = won ? 'win' : 'lose';
      setText(els.bannerBig, won ? 'Round won' : 'Round lost');
      const reasons = {
        elimination: won ? 'Enemy team eliminated' : 'Your team was eliminated',
        detonation: 'The charge detonated',
        defuse: 'The charge was defused',
        time: 'The clock ran out',
      };
      setText(els.bannerSub, reasons[S.lastRound.reason] || '');
    }
  },

  fillEndScreen() {
    const won = S.scoreAtk > S.scoreDef;
    setText(els.endtitle, won ? 'Match won' : 'Match lost');
    setText(els.endsub, `Union ${S.scoreAtk} — ${S.scoreDef} Watch · Foundry District · first to ${S.winsNeeded}`);
    const rows = [...S.actors].sort((a, b) => b.kills - a.kills);
    els.endtable.innerHTML = rows.map((a) =>
      `<tr class="${a.isPlayer ? 'me' : ''}"><td>${a.name}</td><td>${a.team === 'atk' ? 'Union' : 'Watch'}</td>` +
      `<td class="n">${a.kills}</td><td class="n">${a.deaths}</td><td class="n">${a.plants}</td></tr>`).join('');
  },

  killfeed(attacker, victim, weaponName, headshot) {
    if (!els.killfeed) return;
    const div = document.createElement('div');
    div.className = 'kf';
    const an = attacker ? `<b class="${attacker.team}">${attacker.name}</b>` : '<b>World</b>';
    div.innerHTML = `${an} ▸ ${weaponName}${headshot ? ' <span class="hs">HEADSHOT</span>' : ''} ▸ <b class="${victim.team}">${victim.name}</b>`;
    els.killfeed.prepend(div);
    while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
    setTimeout(() => { div.style.transition = 'opacity .6s'; div.style.opacity = '0'; }, 4200);
    setTimeout(() => div.remove(), 4900);
  },

  hitmark(head, kill) {
    hitT = S.time;
    hitKind = kill ? 'kill' : head ? 'head' : '';
    els.hitmark.className = hitKind;
    els.hitmark.style.opacity = '1';
  },

  damageFrom(attacker) {
    if (!attacker || !attacker.pos || !S.player.pos) return;
    dmgMark.yaw = Math.atan2(-(attacker.pos.x - S.player.pos.x), -(attacker.pos.z - S.player.pos.z));
    dmgMark.t = S.time;
  },

  toast(msg) {
    if (!msg) return;
    setText(els.toast, msg);
    els.toast.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.style.opacity = '0'; }, 2300);
  },

  update(dt) {
    const p = S.player;
    if (!p) return;
    const inGame = S.phase !== 'menu';
    els.hud.classList.toggle('hidden', !inGame);
    els.menu.classList.toggle('hidden', S.phase !== 'menu');
    els.buy.classList.toggle('hidden', !(S.phase === 'buy' && buyOpen));
    els.pause.classList.toggle('hidden', !S.paused);
    els.endscreen.classList.toggle('hidden', S.phase !== 'matchover');
    if (!inGame) return;
    if (S.phase !== lastPhase) { lastPhase = S.phase; }
    if (S.phase === 'buy') {
      setText(els.buytimer, String(Math.ceil(S.phaseLeft)));
      if ((this._buyTick || 0) < S.time) { this._buyTick = S.time + 0.15; this.refreshBuy(); }
    }
    // top bar
    setText(els['score-atk'], String(S.scoreAtk));
    setText(els['score-def'], String(S.scoreDef));
    if (S.phase === 'buy') { setText(els['timer-lab'], 'Buy'); setText(els.timer, fmtClock(S.phaseLeft)); }
    else if (S.bomb.state === 'planted') { setText(els['timer-lab'], 'Charge'); setText(els.timer, fmtClock(S.bomb.timer)); }
    else { setText(els['timer-lab'], 'Round'); setText(els.timer, fmtClock(S.roundClock)); }
    setText(els['tb-phase'], S.phase === 'buy' ? `Round ${S.round} · Buy phase` :
      S.phase === 'over' ? `Round ${S.round} · Decided` : `Round ${S.round} · First to ${S.winsNeeded}`);
    // vitals
    setText(els.hpnum, String(Math.max(0, Math.ceil(p.hp))));
    els.hpbar.style.width = `${Math.max(0, p.hp)}%`;
    els.armor.style.width = `${Math.max(0, p.armor)}%`;
    els.vig.style.boxShadow = `inset 0 0 140px rgba(160,20,10,${p.hp < 35 ? 0.55 : S.time - p.lastHurtAt < 0.25 ? 0.4 : 0})`;
    // gun box
    const kit = p.loadout;
    const def = WEAPONS[kit.current];
    setText(els.money, `$${p.money}`);
    setText(els.wname, def.name + (S.bomb.carrier === p ? ' · CARRYING THE CHARGE' : ''));
    const ammoEl = els.ammo;
    setText(ammoEl, '');
    ammoEl.innerHTML = `${kit.mags[kit.current]}<small> / ${kit.reserve[kit.current]}</small>`;
    ammoEl.className = kit.mags[kit.current] === 0 ? 'out' : kit.mags[kit.current] <= def.mag * 0.25 ? 'low' : '';
    const prim = ['rifle', 'sniper', 'smg', 'shotgun'].find((id) => kit.owned[id]);
    setText(els.slots, '');
    els.slots.innerHTML =
      `<span class="${prim && kit.current === prim ? 'on' : ''}">1 ${prim ? WEAPONS[prim].name : '—'}</span>` +
      `<span class="${kit.current === 'pistol' ? 'on' : ''}">2 P9</span>` +
      `<span>4 ${kit.nadeSel === 'he' ? 'Frag' : kit.nadeSel === 'flash' ? 'Flash' : 'Smoke'} ×${kit.nades[kit.nadeSel]}</span>` +
      `<span>G throw</span>`;
    // crosshair follows the true spread; hidden while scoped or dead
    const showCross = p.alive && S.phase === 'live' && !p.scoped;
    els.cross.style.display = showCross ? 'block' : 'none';
    if (showCross) els.cross.style.setProperty('--gap', `${(5 + spreadFor(p, def) * 620).toFixed(1)}px`);
    scopeEl.style.display = p.scoped && p.alive ? 'block' : 'none';
    // hitmarker fade
    if (hitT > 0 && S.time - hitT > (hitKind === 'kill' ? 0.22 : 0.11)) els.hitmark.style.opacity = '0';
    // damage direction arc
    const dAge = S.time - dmgMark.t;
    if (dAge < 0.9) {
      els.dmgarc.style.opacity = String(1 - dAge / 0.9);
      const rel = dmgMark.yaw - p.yaw;
      els.dmgarc.style.transform = `rotate(${(-rel * 180 / Math.PI).toFixed(1)}deg)`;
    } else els.dmgarc.style.opacity = '0';
    // flash blindness: a white sheet that burns off
    if (p.blindUntil && S.time < p.blindUntil) {
      const remain = p.blindUntil - S.time;
      els.flashblind.style.opacity = String(Math.min(p.blindPeak || 1, remain / 1.1));
    } else els.flashblind.style.opacity = '0';
    // bomb and interact bars
    const planted = S.bomb.state === 'planted';
    els.bombbar.classList.toggle('hidden', !planted);
    if (planted) {
      setText(els.bomblab, S.bomb.channelBy ? 'The charge is being defused!' : `Charge planted at ${S.bomb.site} — detonation imminent`);
      els.bombfill.style.width = `${(S.bomb.timer / 35) * 100}%`;
    }
    const channeling = S.bomb.channelBy === p;
    els.interact.classList.toggle('hidden', !channeling);
    if (channeling) {
      setText(els['interact-lab'], 'Planting the charge…');
      els['interact-fill'].style.width = `${(S.bomb.channel / 3) * 100}%`;
    }
    // banner + centre messages
    els.banner.style.opacity = S.phase === 'over' ? '1' : '0';
    let msg = '';
    if (S.phase === 'buy') msg = buyOpen ? '' : 'Buy phase — B to reopen the shop';
    else if (!p.alive && S.phase === 'live') msg = 'You are down — your crew fights on';
    else if (S.phase === 'live' && S.bomb.carrier === p) {
      msg = WORLD && atSite(p) ? 'Hold E to plant the charge' : 'You carry the charge — reach site A or B';
    } else if (S.phase === 'live' && planted && p.team === 'atk') msg = 'Defend the charge';
    setText(els.centermsg, msg);
    this.drawMinimap();
  },

  _mmTick: 0,
  drawMinimap() {
    if (S.time < this._mmTick) return;
    this._mmTick = S.time + 0.1;
    const ctx = els.minimap.getContext('2d');
    const W = 168, scale = W / WORLD.size;
    const px = (x) => (x + WORLD.size / 2) * scale;
    ctx.fillStyle = 'rgba(16,18,17,.9)';
    ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = '#5d5142';
    for (const r of WORLD.minimapRects) ctx.fillRect(px(r.x - r.w / 2), px(r.z - r.d / 2), r.w * scale, r.d * scale);
    for (const key of ['A', 'B']) {
      const s = WORLD.sites[key];
      ctx.strokeStyle = '#e0a458';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(px(s.x), px(s.z), s.r * scale, 0, 7); ctx.stroke();
      ctx.fillStyle = '#e0a458';
      ctx.font = '700 10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(key, px(s.x), px(s.z) + 3);
    }
    const dot = (a, color, r = 3) => {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(px(a.pos.x), px(a.pos.z), r, 0, 7); ctx.fill();
    };
    for (const a of S.actors) {
      if (!a.alive) continue;
      if (a.isPlayer) continue;
      if (a.team === S.player.team) dot(a, '#e0a458');
      else if (S.time - a.lastShotAt < 2.5) dot(a, '#43b8b0');
    }
    if (S.bomb.state === 'dropped' || S.bomb.state === 'planted') {
      ctx.fillStyle = Math.sin(S.time * 6) > 0 ? '#ff5340' : '#ffb0a0';
      ctx.beginPath(); ctx.arc(px(S.bomb.pos.x), px(S.bomb.pos.z), 3.4, 0, 7); ctx.fill();
    }
    // the player: an arrow that turns with the view
    const p = S.player;
    ctx.save();
    ctx.translate(px(p.pos.x), px(p.pos.z));
    ctx.rotate(-p.yaw);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(0, -5.4); ctx.lineTo(3.6, 4.2); ctx.lineTo(-3.6, 4.2); ctx.closePath(); ctx.fill();
    ctx.restore();
  },
};

function atSite(p) {
  for (const key of ['A', 'B']) {
    const s = WORLD.sites[key];
    const dx = p.pos.x - s.x, dz = p.pos.z - s.z;
    if (dx * dx + dz * dz <= s.r * s.r) return true;
  }
  return false;
}
