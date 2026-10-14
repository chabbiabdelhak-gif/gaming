(() => {
'use strict';
const $ = id => document.getElementById(id);
const cv = $('gameCanvas'), ctx = cv.getContext('2d');
const dk = document.createElement('canvas'), dctx = dk.getContext('2d');
const mm = $('minimapCanvas'), mctx = mm.getContext('2d');
const WW = 1800, WH = 1300;
let W = 0, H = 0, dpr = 1;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  for (const c of [cv, dk]) { c.width = W * dpr; c.height = H * dpr; }
}
addEventListener('resize', resize);
resize();

/* ---------- World ---------- */
const walls = [];
const rect = (x, y, w, h) => walls.push({ x, y, w, h });
function box(x, y, w, h, t, gaps = {}) {
  const side = (sx, sy, len, horiz, gap) => {
    const segs = gap ? [[0, gap[0]], [gap[0] + gap[1], len - gap[0] - gap[1]]] : [[0, len]];
    for (const [o, l] of segs) { if (l <= 0) continue; horiz ? rect(sx + o, sy, l, t) : rect(sx, sy + o, t, l); }
  };
  side(x, y, w, true, gaps.top); side(x, y + h - t, w, true, gaps.bottom);
  side(x, y, h, false, gaps.left); side(x + w - t, y, h, false, gaps.right);
}
rect(0, 0, WW, 20); rect(0, WH - 20, WW, 20); rect(0, 0, 20, WH); rect(WW - 20, 0, 20, WH);
box(150, 120, 380, 220, 16, { bottom: [160, 60] });
box(1270, 120, 380, 220, 16, { bottom: [160, 60] });
box(120, 520, 260, 200, 16, { bottom: [100, 60] });
box(1420, 520, 260, 220, 16, { left: [80, 60] });
const crates = [[600, 900, 80, 60], [1000, 800, 100, 60], [1150, 1000, 60, 90], [450, 1000, 90, 60],
  [800, 560, 60, 100], [1300, 880, 90, 60], [700, 350, 120, 40], [1000, 350, 40, 120]];
const crateStart = walls.length;
crates.forEach(c => rect(...c));
const zones = [
  { x: 150, y: 120, w: 380, h: 220, c: '#16222c', l: 'مركز القيادة' },
  { x: 1270, y: 120, w: 380, h: 220, c: '#1d2430', l: 'خوادم الأسلحة' },
  { x: 120, y: 520, w: 260, h: 200, c: '#1b2a26', l: 'غرفة الرادار' },
  { x: 1420, y: 520, w: 260, h: 220, c: '#241f1c', l: 'الثكنات' },
  { x: 800, y: 960, w: 300, h: 300, c: '#161c20', l: 'ساحة الحاويات' }
];
const lamps = [[900, 1050, 260], [500, 300, 200], [1460, 300, 200], [900, 300, 260], [1100, 700, 220],
  [300, 850, 200], [1550, 1000, 220], [700, 700, 200], [250, 610, 150], [1550, 630, 150]].map(a => ({ x: a[0], y: a[1], r: a[2] }));
const lasersDef = [{ x1: 310, y1: 332, x2: 370, y2: 332 }, { x1: 1430, y1: 332, x2: 1490, y2: 332 }];
const helipad = { x: 900, y: 110, r: 70 };

/* ---------- Geometry helpers ---------- */
function segRectT(x1, y1, x2, y2, r) {
  let t0 = 0, t1 = 1; const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy], q = [x1 - r.x, r.x + r.w - x1, y1 - r.y, r.y + r.h - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; }
    else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
      else { if (t < t0) return null; if (t < t1) t1 = t; }
    }
  }
  return t0;
}
function segCircle(x1, y1, x2, y2, c) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1;
  const t = clamp(((c.x - x1) * dx + (c.y - y1) * dy) / l2, 0, 1);
  const px = x1 + t * dx - c.x, py = y1 + t * dy - c.y;
  return px * px + py * py < c.r * c.r;
}
function blocked(x1, y1, x2, y2) {
  for (const w of walls) if (segRectT(x1, y1, x2, y2, w) !== null) return true;
  for (const s of S.smokes) if (segCircle(x1, y1, x2, y2, s)) return true;
  return false;
}
function rayDist(x, y, a, max) {
  let tm = 1; const x2 = x + Math.cos(a) * max, y2 = y + Math.sin(a) * max;
  for (const w of walls) { const t = segRectT(x, y, x2, y2, w); if (t !== null && t < tm) tm = t; }
  return tm * max;
}
function collides(x, y, r) {
  for (const w of walls) {
    const cx = clamp(x, w.x, w.x + w.w), cy = clamp(y, w.y, w.y + w.h);
    if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
  }
  return false;
}
function slide(e, dx, dy) {
  let moved = false;
  if (!collides(e.x + dx, e.y, e.r)) { e.x += dx; moved = moved || dx !== 0; }
  if (!collides(e.x, e.y + dy, e.r)) { e.y += dy; moved = moved || dy !== 0; }
  return moved;
}

/* ---------- Audio ---------- */
let ac = null, soundOn = true, noiseBuf = null;
function audio() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ } }
  if (ac && ac.state === 'suspended') ac.resume();
  return ac;
}
function tone(f, d, type = 'square', v = 0.05, slideTo = 0) {
  if (!soundOn) return; const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + d);
}
function burst(d, v, freq) {
  if (!soundOn) return; const a = audio(); if (!a) return;
  if (!noiseBuf) { noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate); const ch = noiseBuf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1; }
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime;
  s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = freq;
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  s.connect(f); f.connect(g); g.connect(a.destination); s.start(t); s.stop(t + d);
}

/* ---------- State ---------- */
let S, P;
const weaponsDef = [
  { n: 'USP كاتم', ic: '🔫', cd: 0.35, dmg: 1, noise: 0, mag: 12, res: Infinity, spread: 0.02, rl: 1.0 },
  { n: 'M4A1', ic: '🔫', cd: 0.1, dmg: 1, noise: 520, mag: 30, res: 120, spread: 0.08, rl: 1.6 },
  { n: 'EMP Dart', ic: '⚡', cd: 0.8, dmg: 0, noise: 0, mag: 6, res: 0, spread: 0, rl: 0, emp: true }
];
const input = { mx: 0, my: 0, mouseAim: false, mouseFire: false, keys: {}, aim: 0, tAim: false, tFire: false, tx: 0, ty: 0 };

function mkGuard(type, pts) {
  const heavy = type === 'heavy', sniper = type === 'sniper';
  return {
    type, x: pts[0][0], y: pts[0][1], r: 12, pts, pi: 1, ang: 0, state: 'patrol', det: 0,
    hp: heavy ? 6 : 2, speed: heavy ? 58 : 70, fov: sniper ? 0.4 : 1.05, range: sniper ? 480 : heavy ? 300 : 260,
    stun: 0, tgt: { x: pts[0][0], y: pts[0][1] }, t: 0, wait: 0, cd: 0, lost: 0, stuck: 0, dead: false,
    base: Math.PI / 2, phase: Math.random() * 6
  };
}
function reset() {
  S = {
    running: false, over: false, time: 0, alarm: 0, alerts: 0, kills: 0, loud: 0, hurt: 0, laserCd: 0,
    guards: [
      mkGuard('guard', [[600, 1140], [1200, 1140]]),
      mkGuard('guard', [[500, 700], [1100, 700], [1100, 500], [500, 500]]),
      mkGuard('guard', [[900, 420], [900, 250]]),
      mkGuard('heavy', [[1250, 820], [1600, 820], [1600, 1100], [1250, 1100]]),
      mkGuard('guard', [[200, 880], [200, 1120], [420, 1120], [420, 880]]),
      mkGuard('sniper', [[1000, 240]])
    ],
    cams: [
      { x: 700, y: 330, base: Math.PI / 2, sweep: 0.8, spd: 0.7, range: 300, fov: 0.6, dis: 0, det: 0 },
      { x: 1100, y: 330, base: Math.PI / 2, sweep: 0.8, spd: 0.6, range: 300, fov: 0.6, dis: 0, det: 0 },
      { x: 40, y: 800, base: 0, sweep: 0.7, spd: 0.8, range: 300, fov: 0.6, dis: 0, det: 0 },
      { x: 1760, y: 1000, base: Math.PI, sweep: 0.7, spd: 0.7, range: 300, fov: 0.6, dis: 0, det: 0 }
    ],
    terms: [{ x: 340, y: 200, done: false, n: 'A' }, { x: 1460, y: 200, done: false, n: 'B' }],
    radar: { x: 250, y: 610, done: false },
    bullets: [], smokes: [], decoys: [], rings: [], hack: null, visMul: 1, lit: false, decoyN: 4, smokeN: 2,
    nvg: false, energy: 100, stepT: 0, alarmBeep: 0, ctx: null, ctxKey: ''
  };
  P = { x: 900, y: 1220, r: 11, hp: 100, ang: -Math.PI / 2, crouch: true, wi: 0, cd: 0, rl: 0, moving: false, run: false,
    w: weaponsDef.map(w => ({ ammo: w.mag, res: w.res })) };
}
reset();

/* ---------- Helpers: UI ---------- */
const cache = {};
function setText(id, v) { if (cache[id] !== v) { cache[id] = v; $(id).textContent = v; } }
function setCls(el, c, on) { el.classList.toggle(c, !!on); }
let toastT = 0;
function toast(m, ms = 3200) { const t = $('comms-toast'); t.textContent = m; t.classList.add('show'); toastT = ms / 1000; }

/* ---------- AI events ---------- */
function ring(x, y, max) { S.rings.push({ x, y, r: 5, max, life: 0.7 }); }
function setAlert(g) { g.state = 'alert'; g.lost = 0; g.tgt = { x: P.x, y: P.y }; g.det = 1; }
function raiseAlarm(x, y, src) {
  if (S.alarm <= 0) { S.alerts++; toast('القيادة: تم كشفك! القاعدة في حالة إنذار — اختفِ أو اشتبك!'); }
  S.alarm = Math.max(S.alarm, 14);
  for (const g of S.guards) {
    if (g.dead || g === src || g.stun > 0) continue;
    if (g.state !== 'alert') {
      if (Math.hypot(g.x - x, g.y - y) < 650) { g.state = 'alert'; g.lost = 0; g.tgt = { x, y }; }
      else { g.state = 'search'; g.tgt = { x, y }; g.t = 0; g.wait = 0; }
    }
  }
}
function noise(x, y, r, kind) {
  if (r <= 0) return;
  if (r >= 100) ring(x, y, r);
  let heard = false;
  for (const g of S.guards) {
    if (g.dead || g.stun > 0) continue;
    const d = Math.hypot(g.x - x, g.y - y), eff = blocked(g.x, g.y, x, y) ? r * 0.65 : r;
    if (d > eff) continue;
    if (kind === 'gun' && d < eff * 0.6) heard = true;
    if (g.state === 'alert') continue;
    if (g.type === 'sniper' && kind !== 'gun') continue;
    g.state = 'suspicious'; g.tgt = { x, y }; g.t = 0; g.wait = 0;
  }
  if (heard) raiseAlarm(x, y);
}
function hurt(n) {
  if (S.over) return;
  P.hp -= n; S.hurt = 0.3; tone(120, 0.15, 'sawtooth', 0.08, 60);
  if (P.hp <= 0) { P.hp = 0; finish(false); }
}

/* ---------- Guards ---------- */
function turnTo(g, a, dt, rate) {
  const d = angDiff(a, g.ang), s = rate * dt;
  g.ang += Math.abs(d) < s ? d : Math.sign(d) * s;
}
function moveToward(g, tx, ty, sp, dt) {
  const dx = tx - g.x, dy = ty - g.y, d = Math.hypot(dx, dy);
  if (d < 4) return true;
  const st = Math.min(d, sp * dt);
  const moved = slide(g, dx / d * st, dy / d * st);
  g.stuck = moved ? 0 : g.stuck + dt;
  turnTo(g, Math.atan2(dy, dx), dt, 6);
  return false;
}
function giveUp(g) {
  g.stuck = 0;
  if (g.state === 'patrol') g.pi = (g.pi + 1) % g.pts.length;
  else if (g.state === 'alert') g.tgt = { x: g.tgt.x + (Math.random() - 0.5) * 120, y: g.tgt.y + (Math.random() - 0.5) * 120 };
  else g.state = 'patrol';
}
function guardShoot(g, d) {
  const sn = g.type === 'sniper', heavy = g.type === 'heavy';
  g.cd = sn ? 1.8 : heavy ? 0.45 : 0.75;
  const a = Math.atan2(P.y - g.y, P.x - g.x) + (Math.random() - 0.5) * (sn ? 0.04 : 0.05 + d / 2500) * (P.crouch ? 1 : 1.3);
  const sp = sn ? 700 : 440;
  S.bullets.push({ x: g.x, y: g.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, own: 'g', dmg: sn ? 22 : heavy ? 11 : 7, life: 1.4 });
  tone(sn ? 180 : 260, 0.08, 'sawtooth', 0.025, 90);
}
function updGuard(g, dt) {
  if (g.dead) return;
  if (g.stun > 0) { g.stun -= dt; return; }
  g.cd -= dt;
  const d = dist(g, P);
  if (g.type === 'sniper' && g.state !== 'alert') g.ang = g.base + Math.sin(S.time * 0.6 + g.phase) * 1.0;
  let sees = false;
  const hidden = S.smokes.some(s => dist(s, P) < s.r);
  const rng = g.range * S.visMul;
  if (!hidden && d < rng) {
    const a = Math.atan2(P.y - g.y, P.x - g.x);
    if ((d < 42 || Math.abs(angDiff(a, g.ang)) < g.fov / 2) && !blocked(g.x, g.y, P.x, P.y)) sees = true;
  }
  if (sees) g.det = Math.min(1.2, g.det + dt * (0.9 + 2.2 * (1 - d / rng)));
  else g.det = Math.max(0, g.det - dt * 0.5);
  if (sees && g.det >= 1 && g.state !== 'alert') { setAlert(g); raiseAlarm(P.x, P.y, g); }
  else if (sees && g.det > 0.4 && g.state === 'patrol') { g.state = 'suspicious'; g.tgt = { x: P.x, y: P.y }; g.t = 0; g.wait = 0; }
  if (g.state === 'alert') {
    if (sees) { g.tgt = { x: P.x, y: P.y }; g.lost = 0; S.alarm = Math.max(S.alarm, 12); } else g.lost += dt;
  }
  const sn = g.type === 'sniper';
  switch (g.state) {
    case 'patrol':
      if (!sn) {
        const p = g.pts[g.pi];
        if (moveToward(g, p[0], p[1], g.speed, dt)) { g.wait += dt; if (g.wait > 0.7) { g.wait = 0; g.pi = (g.pi + 1) % g.pts.length; } }
        if (g.stuck > 0.7) giveUp(g);
      }
      break;
    case 'suspicious': case 'search': {
      g.t += dt;
      if (sn) { g.state = 'patrol'; break; }
      const arrived = moveToward(g, g.tgt.x, g.tgt.y, g.speed * 0.85, dt);
      if (arrived) {
        g.wait += dt; g.ang += dt * 1.3;
        if (g.state === 'search' && g.wait > 1.6 && g.t < 8) { g.wait = 0; g.tgt = { x: g.tgt.x + (Math.random() - 0.5) * 220, y: g.tgt.y + (Math.random() - 0.5) * 220 }; }
        if (g.wait > (g.state === 'search' ? 1.6 : 2.2) && (g.state === 'suspicious' || g.t >= 8)) { g.state = 'patrol'; g.wait = 0; }
      }
      if (g.t > 12) g.state = 'patrol';
      if (g.stuck > 0.7) giveUp(g);
      break;
    }
    case 'alert':
      if (sees) {
        turnTo(g, Math.atan2(P.y - g.y, P.x - g.x), dt, 8);
        if (!sn && d > 190) moveToward(g, P.x, P.y, g.speed * 1.5, dt);
        else if (!sn) slide(g, Math.cos(g.ang + 1.57) * 25 * dt * Math.sin(S.time + g.phase), Math.sin(g.ang + 1.57) * 25 * dt * Math.sin(S.time + g.phase));
        if (g.cd <= 0 && d < (sn ? 520 : 440)) guardShoot(g, d);
      } else if (!sn) {
        moveToward(g, g.tgt.x, g.tgt.y, g.speed * 1.4, dt);
        if (g.stuck > 0.7) giveUp(g);
        if (g.lost > 5) { g.state = 'search'; g.t = 0; g.wait = 0; }
      } else if (g.lost > 4) g.state = 'patrol';
      break;
  }
}

function updCam(c, dt) {
  if (c.dis > 0) { c.dis -= dt; return; }
  if (S.radar.done) { c.dis = 99999; return; }
  c.ang = c.base + Math.sin(S.time * c.spd) * c.sweep;
  const d = Math.hypot(P.x - c.x, P.y - c.y);
  const hidden = S.smokes.some(s => dist(s, P) < s.r);
  const a = Math.atan2(P.y - c.y, P.x - c.x);
  const sees = !hidden && d < c.range * S.visMul && Math.abs(angDiff(a, c.ang)) < c.fov / 2 && !blocked(c.x, c.y, P.x, P.y);
  c.det = sees ? c.det + dt * 1.3 : Math.max(0, c.det - dt);
  if (c.det >= 1) { c.det = 0.5; raiseAlarm(P.x, P.y); toast('كاميرا مراقبة رصدتك!'); }
}

/* ---------- Player actions ---------- */
function weapon() { return weaponsDef[P.wi]; }
function startReload() {
  const w = weapon(), st = P.w[P.wi];
  if (w.emp || P.rl > 0 || st.ammo >= w.mag || st.res <= 0) return;
  P.rl = w.rl; tone(500, 0.05, 'square', 0.03);
}
function fire() {
  const w = weapon(), st = P.w[P.wi];
  if (P.cd > 0 || P.rl > 0 || S.over) return;
  if (st.ammo <= 0) { startReload(); if (w.emp) tone(200, 0.05); return; }
  st.ammo--; P.cd = w.cd;
  const a = P.ang + (Math.random() - 0.5) * w.spread * (P.crouch ? 0.6 : 1);
  S.bullets.push({ x: P.x + Math.cos(P.ang) * 14, y: P.y + Math.sin(P.ang) * 14, vx: Math.cos(a) * 720, vy: Math.sin(a) * 720, own: 'p', dmg: w.dmg, emp: !!w.emp, life: 1 });
  if (w.noise > 0) { S.loud++; burst(0.12, 0.25, 2500); tone(120, 0.1, 'sawtooth', 0.05, 50); noise(P.x, P.y, w.noise, 'gun'); }
  else if (w.emp) tone(900, 0.2, 'sine', 0.05, 200);
  else { tone(320, 0.07, 'square', 0.025, 120); noise(P.x, P.y, 45, 'soft'); }
  if (st.ammo <= 0) startReload();
}
function throwPos(dd) {
  const dx = Math.cos(P.ang), dy = Math.sin(P.ang);
  const l = Math.min(dd, rayDist(P.x, P.y, P.ang, dd) - 8);
  return { x: P.x + dx * l, y: P.y + dy * l };
}
function useDecoy() {
  if (S.decoyN <= 0 || S.over) return;
  S.decoyN--; const p = throwPos(240); S.decoys.push({ x: p.x, y: p.y, t: 0.5 }); tone(700, 0.05, 'triangle', 0.04);
}
function useSmoke() {
  if (S.smokeN <= 0 || S.over) return;
  S.smokeN--; const p = throwPos(200); S.smokes.push({ x: p.x, y: p.y, r: 95, life: 12 }); burst(0.4, 0.15, 900);
}
function swapWeapon(i) {
  P.wi = (i ?? P.wi + 1) % weaponsDef.length; P.rl = 0; tone(420, 0.04, 'square', 0.03);
}
function context() {
  for (const g of S.guards) {
    if (g.dead) continue;
    const d = dist(g, P);
    if (d < 40) {
      const behind = Math.abs(angDiff(Math.atan2(P.y - g.y, P.x - g.x), g.ang)) > 1.9;
      if (g.stun > 0 || (g.state !== 'alert' && behind)) return { k: 'td' + S.guards.indexOf(g), t: 'اغتيال صامت', g };
    }
  }
  for (const t of S.terms) if (!t.done && dist(t, P) < 48) return { k: 'term' + t.n, t: 'اختراق الخادم ' + t.n, o: t, dur: 2.2 };
  if (!S.radar.done && dist(S.radar, P) < 48) return { k: 'radar', t: 'تعطيل الرادار', o: S.radar, dur: 1.6 };
  return null;
}
function interact() {
  if (S.over || !S.running) return;
  const c = S.ctx; if (!c) return;
  if (c.g) {
    c.g.dead = true; S.kills++; burst(0.1, 0.1, 500); noise(c.g.x, c.g.y, 30, 'soft');
    toast('تم تحييد الحارس بصمت');
  } else if (c.o && !S.hack) S.hack = { o: c.o, t: 0, dur: c.dur };
}
function finish(win) {
  S.over = true; S.running = false;
  const rank = S.alerts === 0 ? (S.loud === 0 ? 'S+' : 'S') : S.alerts === 1 ? 'A' : S.alerts === 2 ? 'B' : 'C';
  $('end-tag').textContent = win ? 'MISSION COMPLETE' : 'MISSION FAILED';
  $('end-title').textContent = win ? 'اكتملت المهمة بنجاح!' : 'سقط العميل في الميدان';
  $('end-subtitle').textContent = win ? 'تم استخراج البيانات السرية ومغادرة القاعدة العسكرية بنجاح.' : 'تم القضاء عليك. حاول التسلل بهدوء أكبر واستخدم الظلال والاستدراج.';
  $('stat-rank').textContent = win ? rank : '—';
  $('stat-kills').textContent = S.kills; $('stat-alerts').textContent = S.alerts;
  $('end-modal').classList.remove('hidden');
}

/* ---------- Update ---------- */
function update(dt) {
  S.time += dt;
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('comms-toast').classList.remove('show'); }
  if (S.hurt > 0) S.hurt -= dt;
  if (!S.running) return;

  const k = input.keys;
  const crouch = P.crouch && !k.shift;
  S.lit = lamps.some(l => Math.hypot(l.x - P.x, l.y - P.y) < l.r * 0.9);
  const hid = S.smokes.some(s => dist(s, P) < s.r);
  S.visMul = hid ? 0 : (crouch ? 0.6 : 1) * (S.lit ? 1.25 : 0.75);

  let mx = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0) + input.tx;
  let my = (k.s || k.arrowdown ? 1 : 0) - (k.w || k.arrowup ? 1 : 0) + input.ty;
  const ml = Math.hypot(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
  const sp = (crouch ? 90 : 165) * (S.hack ? 0.4 : 1);
  P.moving = ml > 0.1;
  if (P.moving) {
    slide(P, mx * sp * dt, my * sp * dt);
    if (!crouch) { S.stepT -= dt; if (S.stepT <= 0) { S.stepT = 0.38; noise(P.x, P.y, 170, 'step'); tone(90, 0.04, 'triangle', 0.02); } }
  }

  if (input.mouseAim) P.ang = Math.atan2(input.my - S.sy, input.mx - S.sx);
  else if (input.tAim) {
    let a = input.aim, best = 0.22;
    for (const g of S.guards) {
      if (g.dead || dist(g, P) > 420) continue;
      const ga = Math.atan2(g.y - P.y, g.x - P.x), df = Math.abs(angDiff(ga, a));
      if (df < best && !blocked(P.x, P.y, g.x, g.y)) { best = df; a = ga; }
    }
    P.ang = a;
  } else if (P.moving) P.ang = Math.atan2(my, mx);
  P.cd -= dt;
  if (P.rl > 0) {
    P.rl -= dt;
    if (P.rl <= 0) { const w = weapon(), st = P.w[P.wi], take = Math.min(w.mag - st.ammo, st.res); st.ammo += take; st.res -= take; }
  }
  if (input.mouseFire || input.tFire) fire();

  const c = context(); S.ctx = c; S.ctxKey = c ? c.k : '';
  if (S.hack) {
    if (dist(S.hack.o, P) > 60) S.hack = null;
    else {
      S.hack.t += dt;
      if (Math.floor(S.hack.t * 4) !== Math.floor((S.hack.t - dt) * 4)) tone(900 + Math.random() * 400, 0.04, 'square', 0.02);
      if (S.hack.t >= S.hack.dur) {
        const o = S.hack.o; o.done = true; S.hack = null; tone(1200, 0.25, 'sine', 0.06);
        if (o === S.radar) { toast('الرادار معطّل: الكاميرات وبوابات الليزر خارج الخدمة'); }
        else toast(S.terms.every(t => t.done) ? 'تم اختراق الخادمين! توجه إلى مهبط المروحية للإخلاء' : 'تم نسخ البيانات من الخادم ' + o.n);
      }
    }
  }

  if (S.nvg) { S.energy -= 8 * dt; if (S.energy <= 0) { S.energy = 0; S.nvg = false; } }
  else S.energy = Math.min(100, S.energy + 5 * dt);

  S.guards.forEach(g => updGuard(g, dt));
  S.cams.forEach(c2 => updCam(c2, dt));

  if (!S.radar.done) {
    S.laserCd -= dt;
    for (const l of lasersDef) {
      const t = clamp(((P.x - l.x1) * (l.x2 - l.x1) + (P.y - l.y1) * (l.y2 - l.y1)) / ((l.x2 - l.x1) ** 2 + (l.y2 - l.y1) ** 2), 0, 1);
      if (Math.hypot(P.x - (l.x1 + t * (l.x2 - l.x1)), P.y - (l.y1 + t * (l.y2 - l.y1))) < P.r + 3 && S.laserCd <= 0) {
        S.laserCd = 1.5; hurt(15); raiseAlarm(P.x, P.y); toast('بوابة ليزر! عطّل الرادار أولاً');
      }
    }
  }

  for (const b of S.bullets) {
    b.life -= dt;
    const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
    if (blocked(b.x, b.y, nx, ny)) { b.life = 0; continue; }
    b.x = nx; b.y = ny;
    if (b.own === 'p') {
      for (const g of S.guards) {
        if (g.dead || Math.hypot(g.x - b.x, g.y - b.y) > g.r + 3) continue;
        b.life = 0;
        if (b.emp) { g.stun = 6; g.state = 'patrol'; g.det = 0; toast('تم شلّ الحارس مؤقتاً'); break; }
        const sneak = g.state === 'patrol' || g.state === 'suspicious' ? 2 : 1;
        g.hp -= b.dmg * sneak;
        if (g.hp <= 0) { g.dead = true; S.kills++; burst(0.08, 0.1, 400); }
        else if (g.state !== 'alert') { setAlert(g); raiseAlarm(P.x, P.y, g); }
        break;
      }
      if (b.emp) for (const c2 of S.cams) if (Math.hypot(c2.x - b.x, c2.y - b.y) < 16) { c2.dis = 8; b.life = 0; }
    } else if (Math.hypot(P.x - b.x, P.y - b.y) < P.r + 2) { b.life = 0; hurt(b.dmg); }
  }
  S.bullets = S.bullets.filter(b => b.life > 0);
  for (const d of S.decoys) { d.t -= dt; if (d.t <= 0 && !d.done) { d.done = true; noise(d.x, d.y, 380, 'decoy'); tone(1000, 0.1, 'sine', 0.05); } }
  S.decoys = S.decoys.filter(d => !d.done);
  for (const s of S.smokes) s.life -= dt; S.smokes = S.smokes.filter(s => s.life > 0);
  for (const r of S.rings) { r.life -= dt; r.r += (r.max - r.r) * Math.min(1, dt * 5); } S.rings = S.rings.filter(r => r.life > 0);

  if (S.alarm > 0) {
    S.alarm -= dt; S.alarmBeep -= dt;
    if (S.alarmBeep <= 0) { S.alarmBeep = 0.9; tone(S.time % 1.8 < 0.9 ? 660 : 880, 0.25, 'square', 0.02); }
  }

  const ready = S.terms.every(t => t.done);
  if (Math.hypot(P.x - helipad.x, P.y - helipad.y) < helipad.r - 10 && !S.over) {
    if (ready) finish(true);
    else if (!S.warnHeli) { S.warnHeli = true; toast('لم تكمل الأهداف بعد: اخترق الخادمين A و B'); }
  } else S.warnHeli = false;
}

/* ---------- Rendering ---------- */
function drawCone(x, y, ang, fov, range, color) {
  ctx.beginPath(); ctx.moveTo(x, y);
  const n = 22;
  for (let i = 0; i <= n; i++) { const a = ang - fov / 2 + fov * i / n, d = rayDist(x, y, a, range); ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); }
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}
function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0a1016'; ctx.fillRect(0, 0, cv.width, cv.height);
  const z = Math.max(0.75, Math.min(1.4, Math.min(W, H) / 520));
  const vw = W / z, vh = H / z;
  const camX = vw >= WW ? (WW - vw) / 2 : clamp(P.x - vw / 2, 0, WW - vw);
  const camY = vh >= WH ? (WH - vh) / 2 : clamp(P.y - vh / 2, 0, WH - vh);
  S.sx = (P.x - camX) * z; S.sy = (P.y - camY) * z;
  const T = () => ctx.setTransform(dpr * z, 0, 0, dpr * z, -camX * z * dpr, -camY * z * dpr);
  T();
  ctx.fillStyle = '#121a21'; ctx.fillRect(0, 0, WW, WH);
  ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1;
  for (let x = 0; x <= WW; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WH); ctx.stroke(); }
  for (let y = 0; y <= WH; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WW, y); ctx.stroke(); }
  ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
  for (const zn of zones) { ctx.fillStyle = zn.c; ctx.fillRect(zn.x, zn.y, zn.w, zn.h); ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillText(zn.l, zn.x + zn.w / 2, zn.y + zn.h - 8); }
  const ready = S.terms.every(t => t.done);
  ctx.beginPath(); ctx.arc(helipad.x, helipad.y, helipad.r, 0, 7);
  ctx.fillStyle = '#1a232b'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = ready ? '#00f5a0' : '#46606a'; ctx.stroke();
  ctx.fillStyle = ready ? '#00f5a0' : '#46606a'; ctx.font = 'bold 40px sans-serif'; ctx.fillText('H', helipad.x, helipad.y + 14);
  ctx.font = '12px sans-serif';

  walls.forEach((w, i) => {
    ctx.fillStyle = i >= crateStart ? '#4b4a35' : '#2b3945'; ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.strokeStyle = i >= crateStart ? '#6d6b4a' : '#4c6273'; ctx.lineWidth = 2; ctx.strokeRect(w.x, w.y, w.w, w.h);
  });
  const pulse = 0.6 + 0.4 * Math.sin(S.time * 5);
  const consoles = [...S.terms.map(t => ({ o: t, c: t.done ? '#00f5a0' : '#00d9f5', e: '🖥' })), { o: S.radar, c: S.radar.done ? '#00f5a0' : '#ffb800', e: '📡' }];
  for (const c of consoles) {
    ctx.fillStyle = '#0a141c'; ctx.fillRect(c.o.x - 16, c.o.y - 12, 32, 24);
    ctx.strokeStyle = c.c; ctx.lineWidth = 2; ctx.strokeRect(c.o.x - 16, c.o.y - 12, 32, 24);
    ctx.fillStyle = c.c; ctx.globalAlpha = c.o.done ? 1 : pulse; ctx.fillRect(c.o.x - 11, c.o.y - 7, 22, 14); ctx.globalAlpha = 1;
  }
  if (!S.radar.done) for (const l of lasersDef) {
    ctx.strokeStyle = `rgba(255,40,70,${0.5 + 0.5 * pulse})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
  }
  for (const c of S.cams) {
    ctx.beginPath(); ctx.arc(c.x, c.y, 7, 0, 7); ctx.fillStyle = c.dis > 0 ? '#555' : '#ff3355'; ctx.fill();
  }
  for (const d of S.decoys) { ctx.beginPath(); ctx.arc(d.x, d.y, 4, 0, 7); ctx.fillStyle = '#ffd34d'; ctx.fill(); }
  for (const s of S.smokes) {
    const g = ctx.createRadialGradient(s.x, s.y, 5, s.x, s.y, s.r);
    g.addColorStop(0, 'rgba(190,200,205,0.85)'); g.addColorStop(1, 'rgba(190,200,205,0)');
    ctx.fillStyle = g; ctx.globalAlpha = Math.min(1, s.life / 3); ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  }
  for (const g of S.guards) {
    ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.ang);
    if (g.dead) { ctx.fillStyle = '#3a3f44'; ctx.beginPath(); ctx.arc(0, 0, 11, 0, 7); ctx.fill(); }
    else {
      ctx.fillStyle = g.stun > 0 ? '#4aa3ff' : g.state === 'alert' ? '#d6314d' : g.type === 'heavy' ? '#6b5a3a' : g.type === 'sniper' ? '#5a4a7a' : '#6a7a4c';
      ctx.beginPath(); ctx.arc(0, 0, g.type === 'heavy' ? 14 : 11, 0, 7); ctx.fill();
      ctx.fillStyle = '#111'; ctx.fillRect(4, -2, 16, 4);
    }
    ctx.restore();
  }
  ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(P.ang);
  ctx.fillStyle = '#00c48c'; ctx.beginPath(); ctx.arc(0, 0, P.crouch ? 10 : 11, 0, 7); ctx.fill();
  ctx.fillStyle = '#e8fff6'; ctx.fillRect(4, -2, 16, 4); ctx.restore();
  ctx.fillStyle = '#ffe36b';
  for (const b of S.bullets) { ctx.beginPath(); ctx.arc(b.x, b.y, 2.5, 0, 7); ctx.fillStyle = b.own === 'p' ? '#ffe36b' : '#ff6b6b'; ctx.fill(); }

  // darkness
  dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dctx.globalCompositeOperation = 'source-over';
  dctx.clearRect(0, 0, W, H);
  dctx.fillStyle = S.nvg ? 'rgba(0,10,4,0.55)' : 'rgba(0,6,12,0.8)'; dctx.fillRect(0, 0, W, H);
  dctx.globalCompositeOperation = 'destination-out';
  const hole = (x, y, r, a) => {
    const sx = (x - camX) * z, sy = (y - camY) * z, g = dctx.createRadialGradient(sx, sy, 0, sx, sy, r * z);
    g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    dctx.fillStyle = g; dctx.fillRect(sx - r * z, sy - r * z, 2 * r * z, 2 * r * z);
  };
  hole(P.x, P.y, S.nvg ? 340 : 190, 1);
  for (const l of lamps) hole(l.x, l.y, l.r, 0.75);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(dk, 0, 0, W * dpr, H * dpr, 0, 0, cv.width, cv.height);

  T();
  for (const g of S.guards) {
    if (g.dead || g.stun > 0) continue;
    const col = g.state === 'alert' ? 'rgba(255,50,80,0.28)' : g.state === 'patrol' ? 'rgba(255,230,120,0.17)' : 'rgba(255,170,40,0.25)';
    drawCone(g.x, g.y, g.ang, g.fov, g.range * S.visMul, col);
  }
  for (const c of S.cams) if (c.dis <= 0) drawCone(c.x, c.y, c.ang ?? c.base, c.fov, c.range * S.visMul, 'rgba(255,60,80,0.2)');
  for (const g of S.guards) {
    if (g.dead) continue;
    if (S.nvg) { ctx.strokeStyle = '#7dffb0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(g.x, g.y, 16, 0, 7); ctx.stroke(); }
    if (g.state === 'alert') { ctx.fillStyle = '#ff3355'; ctx.font = 'bold 20px sans-serif'; ctx.fillText('!', g.x, g.y - 20); }
    else if (g.state === 'suspicious' || g.state === 'search' || g.det > 0.2) { ctx.fillStyle = '#ffb800'; ctx.font = 'bold 20px sans-serif'; ctx.fillText('?', g.x, g.y - 20); }
    if (g.det > 0 && g.state !== 'alert') { ctx.fillStyle = '#ffb800'; ctx.fillRect(g.x - 12, g.y - 17, 24 * Math.min(1, g.det), 3); }
  }
  for (const r of S.rings) { ctx.strokeStyle = `rgba(0,217,245,${r.life})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 7); ctx.stroke(); }
  if (S.running) {
    ctx.strokeStyle = 'rgba(255,70,95,0.35)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(P.x, P.y); const ld = rayDist(P.x, P.y, P.ang, 380); ctx.lineTo(P.x + Math.cos(P.ang) * ld, P.y + Math.sin(P.ang) * ld); ctx.stroke(); ctx.setLineDash([]);
  }
  if (S.hack) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(P.x - 24, P.y - 28, 48, 7);
    ctx.fillStyle = '#00d9f5'; ctx.fillRect(P.x - 23, P.y - 27, 46 * S.hack.t / S.hack.dur, 5);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (S.hurt > 0) { ctx.fillStyle = `rgba(255,0,30,${S.hurt})`; ctx.fillRect(0, 0, cv.width, cv.height); }
  renderMinimap();
}
function renderMinimap() {
  const s = mm.width / WW;
  mctx.clearRect(0, 0, mm.width, mm.height);
  mctx.fillStyle = '#3b5566'; walls.forEach(w => mctx.fillRect(w.x * s, w.y * s, Math.max(1, w.w * s), Math.max(1, w.h * s)));
  mctx.fillStyle = S.terms.every(t => t.done) ? '#00f5a0' : '#46606a'; mctx.beginPath(); mctx.arc(helipad.x * s, helipad.y * s, 6, 0, 7); mctx.fill();
  for (const t of S.terms) { mctx.fillStyle = t.done ? '#00f5a0' : '#00d9f5'; mctx.fillRect(t.x * s - 2, t.y * s - 2, 4, 4); }
  mctx.fillStyle = S.radar.done ? '#00f5a0' : '#ffb800'; mctx.fillRect(S.radar.x * s - 2, S.radar.y * s - 2, 4, 4);
  for (const g of S.guards) if (!g.dead) { mctx.fillStyle = g.state === 'alert' ? '#ff3355' : '#ffb800'; mctx.beginPath(); mctx.arc(g.x * s, g.y * s, 2.5, 0, 7); mctx.fill(); }
  mctx.fillStyle = '#fff'; mctx.beginPath(); mctx.arc(P.x * s, P.y * s, 3, 0, 7); mctx.fill();
}

/* ---------- HUD ---------- */
function hud() {
  const w = weapon(), st = P.w[P.wi];
  $('hp-bar').style.width = P.hp + '%'; setText('hp-val', Math.round(P.hp) + '%');
  $('energy-bar').style.width = S.energy + '%'; setText('energy-val', Math.round(S.energy) + '%');
  const crouch = P.crouch && !input.keys.shift;
  setText('stance-badge', crouch ? 'تسلل صامت' : 'جري (مسموع)');
  setCls($('stance-badge'), 'warn', !crouch);
  const hid = S.smokes.some(s => dist(s, P) < s.r);
  setText('visibility-badge', hid ? 'مختفٍ بالدخان' : S.lit ? 'مكشوف للضوء' : 'في الظل');
  setCls($('visibility-badge'), 'warn', S.lit && !hid);
  const anyAlert = S.guards.some(g => !g.dead && g.state === 'alert') || S.alarm > 0;
  const anySus = S.guards.some(g => !g.dead && (g.state === 'suspicious' || g.state === 'search'));
  const bn = $('base-alert-banner');
  setText('alert-status-text', anyAlert ? 'إنذار! القاعدة في حالة تأهب (ALERT)' : anySus ? 'حذر: الحراس يشتبهون بشيء' : 'حالة القاعدة: هدوء تام (STEALTH)');
  bn.style.color = anyAlert ? '#ff3355' : anySus ? '#ffb800' : '#00f5a0';
  const ov = $('tactical-overlay'); setCls(ov, 'alert-active', anyAlert); setCls(ov, 'nvg-active', S.nvg);
  const tdone = S.terms.filter(t => t.done).length, ready = tdone === 2;
  setText('obj-term1', `2. الخوادم السرية (${tdone}/2)`);
  setCls($('obj-radar'), 'done', S.radar.done); setCls($('obj-radar'), 'active', !S.radar.done);
  setCls($('obj-term1'), 'done', ready); setCls($('obj-term1'), 'active', !ready);
  setCls($('obj-extract'), 'active', ready);
  setText('objective-text', ready ? 'الهدف: توجه إلى مهبط المروحية (H) شمال القاعدة للإخلاء' :
    S.radar.done ? 'الهدف: اخترق الخادمين A (غرب) و B (شرق) داخل مباني القيادة' : 'الهدف: عطّل الرادار (غرب) لإيقاف الكاميرات والليزر، ثم اخترق الخادمين');
  setText('weapon-name', w.n); setText('weapon-icon', w.ic);
  setText('weapon-ammo', P.rl > 0 ? 'تعبئة...' : `${st.ammo} / ${st.res === Infinity ? '∞' : st.res}`);
  setText('stance-btn-label', crouch ? 'تسلل' : 'جري');
  setCls($('btn-stance'), 'active', crouch); setCls($('btn-nvg'), 'active', S.nvg);
  setText('decoy-count', 'x' + S.decoyN); setText('smoke-count', 'x' + S.smokeN);
  const c = S.ctx;
  setCls($('context-prompt'), 'visible', !!c && S.running);
  if (c) setText('context-prompt-text', c.t);
  setText('quick-action-label', c ? c.t.split(' ')[0] : 'تفاعل');
  setCls($('quick-action-btn'), 'action-highlight', !!c);
}

/* ---------- Input ---------- */
function stick(zid, kid, cb) {
  const z = $(zid), kn = $(kid); let id = null, cx = 0, cy = 0; const R = 48;
  const upd = e => {
    const dx = e.clientX - cx, dy = e.clientY - cy, l = Math.hypot(dx, dy) || 1, m = Math.min(1, l / R);
    const vx = dx / l * m, vy = dy / l * m;
    kn.style.transform = `translate(${vx * R}px,${vy * R}px)`; cb(vx, vy, m, true);
  };
  z.addEventListener('pointerdown', e => {
    e.preventDefault(); id = e.pointerId; z.setPointerCapture(id);
    const r = z.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; upd(e); audio();
  });
  z.addEventListener('pointermove', e => { if (e.pointerId === id) upd(e); });
  const end = e => { if (e.pointerId !== id) return; id = null; kn.style.transform = ''; cb(0, 0, 0, false); };
  z.addEventListener('pointerup', end); z.addEventListener('pointercancel', end);
}
stick('left-joystick-zone', 'left-knob', (vx, vy) => { input.tx = vx; input.ty = vy; });
stick('right-joystick-zone', 'right-knob', (vx, vy, m, on) => {
  input.tAim = on; input.tFire = on && m > 0.3;
  if (on && m > 0.1) { input.aim = Math.atan2(vy, vx); input.mouseAim = false; }
});
cv.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { input.mx = e.clientX; input.my = e.clientY; input.mouseAim = true; } });
cv.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button === 0) { input.mouseFire = true; audio(); } });
addEventListener('pointerup', e => { if (e.pointerType === 'mouse') input.mouseFire = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => {
  const k = e.key.toLowerCase(); input.keys[k] = true;
  if (e.repeat) return;
  if (k === 'q') swapWeapon();
  else if (k >= '1' && k <= '3') swapWeapon(+k - 1);
  else if (k === 'c') P.crouch = !P.crouch;
  else if (k === 'e' || k === 'f') interact();
  else if (k === 'g') useDecoy();
  else if (k === 'x') useSmoke();
  else if (k === 'n') toggleNvg();
  else if (k === 'r') startReload();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
});
addEventListener('keyup', e => { input.keys[e.key.toLowerCase()] = false; });
function toggleNvg() { if (S.nvg) S.nvg = false; else if (S.energy > 10) S.nvg = true; }
$('btn-weapon').addEventListener('click', () => swapWeapon());
$('btn-stance').addEventListener('click', () => { P.crouch = !P.crouch; });
$('btn-decoy').addEventListener('click', useDecoy);
$('btn-smoke').addEventListener('click', useSmoke);
$('btn-nvg').addEventListener('click', toggleNvg);
$('quick-action-btn').addEventListener('click', interact);
$('context-prompt').addEventListener('click', interact);
$('sound-toggle-btn').addEventListener('click', () => { soundOn = !soundOn; $('sound-toggle-btn').textContent = soundOn ? '🔊 صوت' : '🔇 صامت'; });
function start() {
  reset(); input.tx = input.ty = 0; S.running = true;
  $('start-modal').classList.add('hidden'); $('end-modal').classList.add('hidden');
  audio(); toast('القيادة: تم إنزالك جنوب القاعدة. ابقَ في الظلال وتجنب مخاريط الرؤية.', 5000);
}
$('start-mission-btn').addEventListener('click', start);
$('play-again-btn').addEventListener('click', start);
$('restart-btn').addEventListener('click', start);

/* ---------- Loop ---------- */
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt); render(); hud();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.__game = { get S() { return S; }, get P() { return P; }, start };
})();
