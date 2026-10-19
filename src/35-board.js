(() => {
'use strict';
// ===================== ACT 2: THE SKATEBOARD AND THE BUMPER FLIGHT (K.board) =====================
// Drives Kit through K.city while Act 2 runs: skate physics on the city's surfaces (slopes, crests that launch, curbs,
// ramps, car roofs), carving, ollies, tricks with combo scoring, the grind rail, traffic hits, dash hoops, then the pier
// bumper -> slow-motion 360 degree orbit -> Superman flight through the sky rings -> landing on the goal pad.
// K.player stays in external mode meanwhile (animation, timers, hurt blink and the death sequence live there) and the
// camera is driven from here (K.camera mode 'external' calls K.board.camera each tick).
if (typeof THREE === 'undefined') return;

const V3 = THREE.Vector3, TAU = Math.PI * 2;
const clamp = (v, a, b) => (v > b ? b : v >= a ? v : a);
const lerp = (a, b, t) => a + (b - a) * t;
const fin = v => typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;
const finV = v => !!v && fin(v.x) && fin(v.y) && fin(v.z);
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const dk = (l, dt) => 1 - Math.exp(-l * dt);
const yawOf = (x, z) => Math.atan2(-x, -z);
const dirX = y => -Math.sin(y), dirZ = y => -Math.cos(y);
function angD(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; }
function wrapA(a) { return a > Math.PI || a < -Math.PI ? a - Math.round(a / TAU) * TAU : a; }

// ---------- tuning (fixed 60 Hz ticks, units per second) ----------
const PH = {
  gAir: 30, holdG: 0.5, hold: 0.24, ollie: 11.2, slope: 42, launch: 32,
  drag: 0.0058, dragTuck: 0.0034, roll: 0.35, soft: 44, cap: 56,
  push: 10, pushTop: 25, cruise: 15, cruiseAcc: 7, brake: 18,
  turnLo: 2.8, turnHi: 1.6, assist: 2.4, airTurn: 1.3,
  stepUp: 0.55, radius: 0.45, height: 1.2, snapDown: 0.6,
  hoop: 46, fly: 46, flyBoost: 64, wipe: 0.9
};
const SLOW = 0.3, SLOW_T = 3.0, ORBIT_T = 3.2;
const TRICKS = {
  kickflip: { name: 'KICKFLIP', dur: 0.42, pts: 150, flip: 1, spin: 0, salto: 0 },
  spinL: { name: '360', dur: 0.56, pts: 250, flip: 0, spin: 1, salto: 0 },
  spinR: { name: '360', dur: 0.56, pts: 250, flip: 0, spin: -1, salto: 0 },
  salto: { name: 'SALTO', dur: 0.66, pts: 400, flip: 0, spin: 0, salto: 1 }
};

const B = K.board = {
  active: false, mode: null, timeScale: 1, speed: 0, completed: false,
  // last trick event for the HUD: event 'trick' | 'land' | 'fail' | 'grind' | 'hoop' | 'bumper', t = seconds since it
  trick: { event: '', name: '', points: 0, combo: 0, total: 0, t: 99 },
  start, stop, update, camera, stats
};

const S = {
  hd: new V3(0, 0, -1), yaw: 0, v: 0, n: new V3(0, 1, 0), grounded: true, airT: 0, hold: 0,
  lean: 0, pushK: 0, crouch: 0, idle: 0, wipeT: 0, wipeSpin: 0, impact: 0, t: 0, airLong: 0,
  tk: { def: null, t: 0, p: 0 }, airPts: 0, airN: 0, grabT: 0, grabbed: false, chainN: 0, chainT: 0,
  grind: null, gs: 0, gT: 0, gTick: 0, offT: 0, recov: false, lineD: 0,
  prevC: new V3(), curC: new V3(), started: false,
  n0: { ollies: 0, tricks: 0, landed: 0, wipes: 0, carHits: 0, hoops: 0, grinds: 0, grindT: 0, roofs: 0, airMax: 0 }
};
const F = { u: 0, spd: 0, ox: 0, oy: 0, vx: 0, vy: 0, boost: 0, t: 0, bank: 0, pitch: 0, blend: 1, cine: false,
  landT: -1, touch: false, touchT: 0, done: false, start: new V3(), yaw: 0, c1: new V3(), c2: new V3() };
const FA = { pos: new V3(), dir: new V3(), right: new V3() };
const CAM = { pos: new V3(), look: new V3(), yaw: 0, air: 0, manual: 0, manualT: 0, shake: 0, snap: true, fov: 62,
  a0: 0, lastA: 0, sweep: 0, orbiting: false, fromPos: new V3(), k: 1 };
const POSE = { yaw: 0, up: new V3(0, 1, 0), ground: true, lean: 0, crouch: 0, push: 0, spin: 0, flip: 0, salto: 0, tuck: 0, grab: 0, bank: 0, pitch: 0, impact: 0 };
const CINE = { focus: () => (K.player && K.player.center ? K.player.center() : CAM.look), letterbox: true, dof: true };
const NP = new V3(), GN = new V3(), _v = new V3(), _w = new V3(), _c = new V3(), _q = new THREE.Quaternion(), _up = new V3(0, 1, 0);

// ---------- guarded access to the other modules ----------
const PL = () => K.player;
function fx(name, a, b, c, d) { const X = K.vfx; if (X && typeof X[name] === 'function') { try { X[name](a, b, c, d); } catch (e) { /* effects never break play */ } } }
function sfx(name, arg) { try { if (K.audio && typeof K.audio.sfx === 'function') K.audio.sfx(name, arg); } catch (e) { /* ignore */ } }
function post(name, a, b) { const Q = K.post; if (Q && typeof Q[name] === 'function') { try { Q[name](a, b); } catch (e) { /* ignore */ } } }
function pose(name) { const P = PL(); if (P && typeof P.setPose === 'function') { try { P.setPose(name, POSE); } catch (e) { console.error(e); } } }
function addScore(n, pos) { const G = K.game; if (G && typeof G.addScore === 'function') { try { G.addScore(n, pos); } catch (e) { console.error(e); } } }
function inX() { const I = K.input; return I && I.move && fin(I.move.x) ? clamp(I.move.x, -1, 1) : 0; }
function inY() { const I = K.input; return I && I.move && fin(I.move.y) ? clamp(I.move.y, -1, 1) : 0; }
function held(n) { const I = K.input; return !!(I && I.held && I.held[n]); }
function hit(n) { const I = K.input; try { return !!(I && typeof I.hit === 'function' && I.hit(n)); } catch (e) { return false; } }
function reduced() { return !!(K.view && K.view.reduceMotion); }
function event(kind, name, pts) {
  const T = B.trick;
  T.event = kind; T.name = name || ''; T.points = pts || 0; T.combo = S.chainN; T.t = 0;
  const G = K.game;
  if (G && typeof G.onTrick === 'function') { try { G.onTrick(kind, T.name, T.points, T.combo); } catch (e) { console.error(e); } }
}
function shake(a) { if (!reduced()) CAM.shake = Math.max(CAM.shake, a); }

// ===================== start / stop =====================
function start(spawn) {
  const P = PL(), C = K.city;
  if (!P || !C) return false;
  if (!C.built && typeof C.build === 'function') C.build(K.view && K.view.scene);
  if (!C.built) return false;
  spawn = spawn && finV(spawn.pos) ? spawn : C.start;
  if (!spawn || !finV(spawn.pos)) return false;
  if (typeof P.setExternal === 'function') P.setExternal(true, { ground: C.ground });
  const yaw = fin(spawn.yaw) ? spawn.yaw : 0;
  if (typeof P.init === 'function') P.init(spawn.pos, yaw);
  B.active = true; B.mode = 'skate'; B.timeScale = 1; B.completed = false; B.speed = 0;
  S.yaw = yaw; S.hd.set(dirX(yaw), 0, dirZ(yaw));
  const cp = spawn !== C.start;
  S.v = cp ? 12 : 0;
  S.n.set(0, 1, 0);
  const g = C.ground(P.pos.x, P.pos.z, P.pos.y + 1);
  if (g) { P.pos.y = g.y; S.n.copy(g.n); }
  S.grounded = true; S.airT = 0; S.hold = 0; S.lean = 0; S.pushK = 0; S.crouch = 0; S.idle = 0; S.wipeT = 0; S.impact = 0; S.t = 0; S.airLong = 0;
  S.tk.def = null; S.airPts = 0; S.airN = 0; S.grabT = 0; S.grabbed = false; S.chainN = 0; S.chainT = 0;
  S.grind = null; S.gT = 0; S.offT = 0; S.recov = false; S.lineD = 0;
  P.vel.set(S.hd.x * S.v, 0, S.hd.z * S.v);
  if (P.center) S.prevC.copy(P.center()); else S.prevC.copy(P.pos);
  F.cine = false; F.done = false; F.touch = false; F.landT = -1;
  post('cinematic', false);
  B.trick.t = 99; B.trick.event = ''; B.trick.combo = 0;
  if (!S.started) { B.trick.total = 0; for (const k in S.n0) S.n0[k] = 0; }
  S.started = true;
  if (K.vfx && typeof K.vfx.setGround === 'function') { try { K.vfx.setGround(C.ground); } catch (e) { /* ignore */ } }
  if (K.camera && typeof K.camera.setMode === 'function') K.camera.setMode('external');
  CAM.snap = true; CAM.manual = 0; CAM.manualT = 0; CAM.shake = 0; CAM.orbiting = false; CAM.sweep = 0; CAM.yaw = yaw; CAM.k = 1;
  POSE.yaw = yaw; POSE.up.copy(S.n); POSE.ground = true;
  clearPose(); POSE.push = cp ? 0 : 1;
  pose('skate');
  camera(1 / 60);
  return true;
}
function stop() {
  if (!B.active) return;
  B.active = false; B.mode = null; B.timeScale = 1; B.speed = 0;
  S.started = false;
  if (F.cine) { post('cinematic', false); F.cine = false; }
  post('speed', 0);
  fx('speedLines', 0);
  const P = PL();
  if (P && typeof P.setPose === 'function') P.setPose(null);
  if (P && typeof P.setExternal === 'function') P.setExternal(false);
  if (K.vfx && typeof K.vfx.setGround === 'function') { try { K.vfx.setGround(null); } catch (e) { /* ignore */ } }
}
function clearPose() {
  POSE.lean = POSE.crouch = POSE.push = POSE.spin = POSE.flip = POSE.salto = POSE.tuck = POSE.grab = POSE.bank = POSE.pitch = POSE.impact = 0;
}

// ===================== per tick =====================
function update(dt) {
  if (!B.active) return;
  if (!(dt > 0 && dt < 0.25)) dt = 1 / 60;
  const P = PL(), C = K.city;
  if (!P || !C || !C.built) return;
  S.t += dt;
  B.trick.t += dt;
  if (P.dead) { post('speed', 0); fx('speedLines', 0); return; }
  if (B.mode === 'flight') { flightStep(dt); return; }
  if (B.mode === 'land') { landStep(dt); return; }
  S.prevC.copy(P.center ? P.center() : P.pos);
  if (S.wipeT > 0) S.wipeT = Math.max(0, S.wipeT - dt);
  if (S.chainT > 0 && S.grounded && !S.grind) { S.chainT -= dt; if (S.chainT <= 0) S.chainN = 0; }
  S.impact = Math.max(0, S.impact - dt * 3);
  if (S.grind) grindStep(dt);
  else if (S.grounded) skateStep(dt);
  else airStep(dt);
  if (P.dead) return;
  S.curC.copy(P.center ? P.center() : P.pos);
  carHits();
  if (P.dead) return;
  hoops(false);
  if (bumperCheck()) return;
  if (P.pos.y < (fin(C.deathY) ? C.deathY : -3) || S.airLong > 6) { if (typeof P.kill === 'function') P.kill('fall'); return; }
  B.mode = S.grounded || S.grind ? 'skate' : 'air';
  B.speed = S.grounded || S.grind ? S.v : Math.hypot(P.vel.x, P.vel.z);
  skatePose(dt);
  const sp = clamp((B.speed - 27) / 20, 0, 1);
  post('speed', sp);
  fx('speedLines', sp * 0.8, P.vel);
}

// ---------- on the ground ----------
function surfVel(out) {
  const n = S.n, vx = S.hd.x * S.v, vz = S.hd.z * S.v;
  out.set(vx, -(n.x * vx + n.z * vz) / Math.max(0.25, n.y), vz);
}
function skateStep(dt) {
  const P = PL(), C = K.city;
  const steer = inX(), thr = inY(), tuck = held('action'), wipe = S.wipeT > 0;
  S.airLong = 0;
  if (!wipe && hit('jump')) { ollie(PH.ollie); return; }
  const ra = C.routeAt(P.pos.x, P.pos.z);
  let rk = 0, ryaw = S.yaw, back = 0;
  if (ra) {
    rk = fin(ra.k) ? ra.k : 0; ryaw = yawOf(ra.dir.x, ra.dir.z);
    // the resting stick also eases Kit out of the parking lanes and the cross streets, and after a knock-down back
    // to the line he was riding (any steering hands control back)
    const dd = fin(ra.d) ? ra.d : 0;
    if (S.recov && Math.abs(steer) > 0.12 && !wipe) S.recov = false;
    const over = dd - (S.recov ? S.lineD : clamp(dd, -4.4, 4.4));
    if (S.recov && !wipe && Math.abs(over) < 0.4) S.recov = false;
    if (over !== 0) back = Math.atan2(over, Math.max(8, S.v * 0.5)); // (yaw grows to the left)
  }
  // heading: the street's own bend, the stick's carve, and a gentle return along the street when the stick rests
  const along = Math.cos(angD(S.yaw, ryaw));
  const wmax = lerp(PH.turnLo, PH.turnHi, smooth(S.v / 40)) * (tuck ? 0.8 : 1);
  let w = -rk * S.v * Math.max(0, along);
  if (wipe) { w += clamp(angD(S.yaw, ryaw + back) * 3, -2, 2); S.idle = 0; }
  else if (Math.abs(steer) > 0.12) { w += -steer * wmax; S.idle = 0; }
  else { S.idle += dt; w += clamp(angD(S.yaw, ryaw + back) * PH.assist, -wmax, wmax) * smooth((S.idle - 0.15) / 0.35); }
  S.yaw = wrapA(S.yaw + w * dt);
  S.hd.set(dirX(S.yaw), 0, dirZ(S.yaw));
  S.lean = lerp(S.lean, clamp(-w / Math.max(1, wmax), -1, 1), dk(9, dt));
  // speed: slope, drag (less when tucked), kick-push on the flat, foot brake
  const n = S.n, nh = n.x * S.hd.x + n.z * S.hd.z;
  let a = PH.slope * nh * n.y - (tuck ? PH.dragTuck : PH.drag) * S.v * S.v - PH.roll;
  if (S.v > PH.soft) a -= (S.v - PH.soft) * 1.6;
  let push = 0;
  if (wipe) a -= 8;
  else {
    if (thr > 0.3 && S.v < PH.pushTop) push = PH.push * thr;
    else if (!tuck && thr > -0.3 && S.v < PH.cruise) push = PH.cruiseAcc;
    if (thr < -0.3) a -= PH.brake * -thr;
  }
  a += push;
  S.pushK = lerp(S.pushK, push > 0 && nh < 0.06 ? 1 : 0, dk(push > 0 ? 5 : 9, dt));
  S.crouch = lerp(S.crouch, tuck ? 1 : 0, dk(10, dt));
  S.v = clamp(S.v + a * dt, 0, PH.cap);
  surfVel(P.vel);
  NP.copy(P.pos).addScaledVector(P.vel, dt);
  const wh = C.collideWalls(NP, PH.radius, PH.height);
  if (wh && wh.hit) wallSlide(wh.nx, wh.nz, true);
  if (railOnGround(NP)) return;
  const g = C.ground(NP.x, NP.z, P.pos.y + PH.stepUp);
  if (!g) { P.pos.copy(NP); takeOff(); return; }
  GN.copy(g.n);
  const gy = g.y, sol = g.solid;
  const gr0 = -(n.x * S.hd.x + n.z * S.hd.z) / Math.max(0.2, n.y);
  const gr1 = -(GN.x * S.hd.x + GN.z * S.hd.z) / Math.max(0.2, GN.y);
  const need = (gr1 - gr0) * S.v / dt;
  const expect = P.pos.y + P.vel.y * dt;
  if ((need < -PH.launch && S.v > 9) || gy < expect - PH.snapDown) {
    // over a crest at speed, off a kicker or a roof: airborne with the surface velocity
    P.pos.copy(NP);
    takeOff();
    return;
  }
  NP.y = gy;
  P.pos.copy(NP);
  S.n.copy(GN);
  P.vel.y = gr1 * S.v;
  if (sol && sol.half && sol.vel) S.n0.roofs += dt; // riding a moving car's roof
  // skating fast along a curb or a parked car's side kicks up a few sparks
  if (wh && wh.hit && S.v > 12 && (S.t * 60 | 0) % 3 === 0) { _v.set(P.pos.x - wh.nx * 0.3, P.pos.y + 0.08, P.pos.z - wh.nz * 0.3); fx('wheelSparks', _v, P.vel); }
}
function wallSlide(nx, nz, ground) {
  const P = PL();
  const d = S.hd.x * nx + S.hd.z * nz;
  if (ground) {
    if (d >= -0.02) return;
    _w.set(S.hd.x - nx * d, 0, S.hd.z - nz * d);
    if (_w.lengthSq() < 1e-6) {
      // head-on: slide off toward the middle of the street
      _w.set(-nz, 0, nx);
      const ra = K.city.routeAt(P.pos.x, P.pos.z);
      if (ra && fin(ra.d) && (_w.x * ra.right.x + _w.z * ra.right.z) * ra.d > 0) _w.negate();
    }
    _w.normalize();
    S.yaw = yawOf(_w.x, _w.z); S.hd.copy(_w);
    const loss = -d;
    S.v *= 1 - clamp(loss * 0.65, 0, 0.7);
    surfVel(P.vel);
    if (loss > 0.35 && S.v > 6) {
      _v.set(P.pos.x - nx * 0.4, P.pos.y + 0.5, P.pos.z - nz * 0.4);
      _w.set(nx, 0.4, nz);
      fx('sparks', _v, _w, 10, 0xffc070);
      shake(0.12);
      sfx('bounce');
    }
  } else {
    const vd = P.vel.x * nx + P.vel.z * nz;
    if (vd < 0) { P.vel.x -= nx * vd; P.vel.z -= nz * vd; }
  }
}
function ollie(vy) {
  const P = PL();
  surfVel(P.vel);
  P.vel.y = Math.max(P.vel.y, 0) * 0.5 + Math.min(P.vel.y, 0) * 0.25 + vy;
  takeOff();
  S.hold = PH.hold;
  S.n0.ollies++;
  _c.copy(P.pos);
  fx('jump', _c, S.n);
  sfx('jump');
  POSE.impact = 0;
}
function takeOff() {
  const P = PL();
  S.grounded = false; S.airT = 0; S.airN = 0; S.airPts = 0; S.grabT = 0; S.grabbed = false; S.hold = 0;
  S.tk.def = null;
  S.v = Math.hypot(P.vel.x, P.vel.z);
}

// ---------- in the air ----------
function airStep(dt) {
  const P = PL(), C = K.city;
  S.airT += dt; S.airLong += dt;
  if (S.airT > S.n0.airMax) S.n0.airMax = S.airT;
  const steer = inX(), tuck = held('action'), wipe = S.wipeT > 0;
  if (!wipe && S.airT > 0.05 && hit('jump') && !S.tk.def) startTrick();
  if (S.tk.def) {
    S.tk.t += dt; S.tk.p = S.tk.t / S.tk.def.dur;
    if (S.tk.p >= 1) finishTrick();
  }
  // grab: hold the action button with no trick going
  if (!wipe && tuck && !S.tk.def) {
    S.grabT += dt;
    if (!S.grabbed && S.grabT > 0.35) { S.grabbed = true; S.airPts += 100; S.airN++; S.n0.tricks++; event('trick', 'GRAB', 100); sfx('spin'); }
  } else S.grabT = Math.max(0, S.grabT - dt * 3);
  let g = PH.gAir;
  if (S.hold > 0) { S.hold -= dt; if (held('jump')) g *= PH.holdG; else S.hold = 0; }
  P.vel.y = Math.max(-60, P.vel.y - g * dt);
  if (!wipe && Math.abs(steer) > 0.12) {
    const a = -steer * PH.airTurn * dt, c = Math.cos(a), s = Math.sin(a);
    const vx = P.vel.x, vz = P.vel.z;
    P.vel.x = vx * c + vz * s; P.vel.z = -vx * s + vz * c;
  }
  const vh = Math.hypot(P.vel.x, P.vel.z);
  if (vh > 1 && !wipe) { S.yaw = yawOf(P.vel.x, P.vel.z); S.hd.set(dirX(S.yaw), 0, dirZ(S.yaw)); }
  S.v = vh;
  S.lean = lerp(S.lean, steer * 0.6, dk(6, dt));
  NP.copy(P.pos).addScaledVector(P.vel, dt);
  const wh = C.collideWalls(NP, PH.radius, PH.height);
  if (wh && wh.hit) wallSlide(wh.nx, wh.nz, false);
  if (catchRail(NP)) return;
  const top = Math.max(P.pos.y, NP.y) + 0.05;
  const gr = C.ground(NP.x, NP.z, top);
  if (gr && NP.y <= gr.y) { land(gr); return; }
  P.pos.copy(NP);
}
function land(g) {
  const P = PL();
  NP.y = g.y;
  P.pos.copy(NP);
  S.n.copy(g.n);
  const vy = P.vel.y;
  let vh = Math.hypot(P.vel.x, P.vel.z);
  if (vh > 0.5 && S.wipeT <= 0) S.yaw = yawOf(P.vel.x, P.vel.z);
  S.hd.set(dirX(S.yaw), 0, dirZ(S.yaw));
  const nh = S.n.x * S.hd.x + S.n.z * S.hd.z;
  if (nh > 0 && vy < 0) vh += -vy * nh * 0.9; // a landing on a downhill turns the fall into speed
  S.v = clamp(vh, 0, PH.cap);
  S.grounded = true; S.hold = 0; S.airLong = 0;
  const imp = clamp((-vy - 3) / 20, 0, 1);
  S.impact = Math.max(S.impact, imp);
  POSE.impact = imp;
  if (S.wipeT > 0) S.v *= 0.75;
  else if (S.tk.def && S.tk.p < 0.78) { failLanding(); return; }
  else { if (S.tk.def) finishTrick(); bankAir(); }
  S.tk.def = null;
  surfVel(P.vel);
  if (imp > 0.12) { fx('land', P.pos, S.n, -vy); if (imp > 0.5) shake(0.08 + imp * 0.12); }
}
function startTrick() {
  const x = inX(), y = inY();
  const def = Math.abs(x) > 0.5 ? (x > 0 ? TRICKS.spinR : TRICKS.spinL) : y < -0.5 ? TRICKS.salto : TRICKS.kickflip;
  S.tk.def = def; S.tk.t = 0; S.tk.p = 0;
  sfx('spin');
  const P = PL();
  _c.copy(P.center ? P.center() : P.pos);
  fx('twinkle', _c, 8, 0xfff2c0);
}
function finishTrick() {
  const d = S.tk.def;
  if (!d) return;
  S.tk.def = null;
  S.airPts += d.pts; S.airN++; S.n0.tricks++;
  event('trick', d.name, d.pts);
}
function bankAir() {
  if (S.airN <= 0) return;
  S.chainN += S.airN; S.chainT = 1.4;
  const pts = S.airPts * Math.max(1, S.chainN);
  const P = PL();
  _c.copy(P.pos); _c.y += 2.4;
  addScore(pts, _c);
  B.trick.total += pts;
  S.n0.landed++;
  event('land', 'TRICK !', pts);
  sfx('item');
  fx('twinkle', _c, 10, 0xffd23f);
  S.airN = 0; S.airPts = 0;
}
function failLanding() {
  const P = PL();
  S.tk.def = null;
  _c.copy(P.pos).addScaledVector(S.hd, 1.2); _c.y += 0.6;
  wipeout(_c);
  if (P.dead) return;
  // tumble on down the street
  S.v *= 0.55;
  surfVel(P.vel);
  P.vel.y = 5.5;
  S.grounded = false; S.airT = 0;
}
function wipeout(from) {
  const P = PL();
  S.chainN = 0; S.chainT = 0; S.airN = 0; S.airPts = 0; S.tk.def = null; S.grind = null;
  try { if (typeof P.hurt === 'function') P.hurt(from); } catch (e) { console.error(e); }
  if (P.dead) return;
  S.wipeT = PH.wipe; S.wipeSpin = 0; S.n0.wipes++;
  event('fail', 'CHUTE', 0);
  shake(0.25);
}

// ---------- tricks shown on the body ----------
function skatePose(dt) {
  const P = PL();
  clearPose();
  POSE.yaw = S.yaw;
  POSE.up.copy(S.grounded || S.grind ? S.n : _up);
  POSE.ground = S.grounded || !!S.grind;
  if (S.wipeT > 0) {
    S.wipeSpin += dt * 9;
    POSE.spin = S.wipeSpin;
    pose('wipeout');
    return;
  }
  if (S.grounded || S.grind) {
    POSE.lean = S.lean;
    POSE.crouch = S.grind ? 0.55 : clamp(Math.max(S.crouch, S.impact * 0.8), 0, 1);
    POSE.push = S.grind ? 0 : S.pushK;
    POSE.impact = S.impact > 0.6 ? 0 : POSE.impact;
    pose('skate');
    return;
  }
  const tk = S.tk;
  if (tk.def) {
    const p = clamp(tk.p, 0, 1), e = 1 - (1 - p) * (1 - p);
    POSE.spin = tk.def.spin * TAU * e;
    POSE.flip = tk.def.flip * TAU * e;
    POSE.salto = tk.def.salto * TAU * smooth(p);
    POSE.tuck = 0.55 + 0.35 * Math.sin(p * Math.PI);
  } else POSE.tuck = clamp(0.25 + (P.vel.y > 0 ? 0.2 : 0), 0, 1);
  POSE.grab = clamp(S.grabT / 0.2, 0, 1);
  pose('skateAir');
}

// ---------- the grind rail along the cable-car tracks ----------
const RT = { s: 0, d: 0, y: 0 };
function railFor(s, d, tol) {
  const R = K.city.rails;
  if (!R) return null;
  for (let i = 0; i < R.length; i++) { const r = R[i]; if (s > r.s0 - 0.5 && s < r.s1 - 0.8 && Math.abs(d - r.d) < tol) return r; }
  return null;
}
function catchRail(np) {
  const P = PL(), C = K.city;
  if (S.wipeT > 0 || P.vel.y > 0.5) return false;
  const ra = C.routeAt(np.x, np.z);
  if (!ra) return false;
  const r = railFor(ra.s, ra.d, 0.8);
  if (!r) return false;
  const top = ra.y + r.h;
  if (P.pos.y < top - 0.2 || np.y > top + 0.15) return false;
  if (Math.cos(angD(S.yaw, yawOf(ra.dir.x, ra.dir.z))) < 0.6) return false;
  startGrind(r, ra.s);
  railPlace(r);
  return true;
}
function railOnGround(np) {
  // on the street the rail is a low bar to slide along (getting on it takes an ollie)
  const P = PL(), C = K.city, R = C.rails;
  if (!R || !R.length || S.wipeT > 0) return false;
  const ra = C.routeAt(np.x, np.z);
  if (!ra) return false;
  for (let i = 0; i < R.length; i++) {
    const r = R[i], dd = ra.d - r.d;
    if (ra.s > r.s0 && ra.s < r.s1 && Math.abs(dd) < 0.55) {
      const side = Math.sign(dd || 1), nx = ra.right.x * side, nz = ra.right.z * side;
      np.x += nx * (0.55 - Math.abs(dd)); np.z += nz * (0.55 - Math.abs(dd));
      wallSlide(nx, nz, true);
    }
  }
  return false;
}
function startGrind(r, s) {
  const P = PL();
  S.grind = r; S.gs = s; S.gT = 0; S.gTick = 0; S.offT = 0;
  if (S.tk.def) { if (S.tk.p >= 0.78) finishTrick(); else S.tk.def = null; }
  S.grounded = false; S.hold = 0; S.airLong = 0;
  S.v = Math.max(S.v, 10);
  S.n0.grinds++;
  sfx('skid');
  event('grind', 'GRIND', 0);
  void P;
}
function grindStep(dt) {
  const P = PL(), C = K.city, r = S.grind;
  const ra = C.route(S.gs);
  if (!ra) { S.grind = null; takeOff(); return; }
  const g = ra.g;
  const a = -PH.slope * g / Math.sqrt(1 + g * g) * 0.9 - 0.004 * S.v * S.v - 0.4;
  S.v = clamp(S.v + a * dt, 6, PH.cap);
  if (hit('jump')) { S.grind = null; bankGrind(); ollie(PH.ollie); return; }
  const steer = inX();
  if (Math.abs(steer) > 0.7) S.offT += dt; else S.offT = 0;
  const yaw = yawOf(ra.dir.x, ra.dir.z);
  S.yaw = yaw; S.hd.set(dirX(yaw), 0, dirZ(yaw)); S.n.set(0, 1, 0);
  S.gs += S.v * dt;
  S.gT += dt; S.n0.grindT += dt; S.gTick += dt;
  if (S.gTick >= 0.25) { S.gTick -= 0.25; S.airPts += 50; }
  S.lean = Math.sin(S.t * 7) * 0.25;
  const off = S.offT > 0.15;
  if (S.gs >= r.s1 || off) {
    S.grind = null;
    const ex = C.route(Math.min(S.gs, r.s1));
    _v.set(ex.right.x, 0, ex.right.z).multiplyScalar(off ? Math.sign(steer) * 4.5 : 0);
    P.vel.set(ex.dir.x * S.v + _v.x, ex.g * S.v + (off ? 5 : 2.5), ex.dir.z * S.v + _v.z);
    bankGrind();
    S.grounded = false; S.airT = 0; S.hold = 0; S.tk.def = null; S.grabT = 0; S.grabbed = false;
    return;
  }
  railPlace(r);
  if ((S.t * 60 | 0) % 2 === 0) { _c.copy(P.pos); _c.y += 0.05; fx('wheelSparks', _c, P.vel); }
}
function railPlace(r) {
  const P = PL(), rb = K.city.route(S.gs);
  P.pos.set(rb.pos.x + rb.right.x * r.d, rb.y + r.h - 0.04, rb.pos.z + rb.right.z * r.d);
  P.vel.set(rb.dir.x * S.v, rb.g * S.v, rb.dir.z * S.v);
}
function bankGrind() {
  // the grind counts as a trick of the chain (scored with the next landing)
  if (S.gT > 0.3) { S.airN++; S.n0.tricks++; event('trick', 'GRIND', Math.round(S.gT * 200)); }
  S.gT = 0;
}

// ---------- traffic ----------
const _cl = new V3();
function carHits() {
  const P = PL(), C = K.city, cars = C.cars;
  if (!cars || !cars.length) return;
  const cx = P.pos.x, cy = P.pos.y + 0.6, cz = P.pos.z;
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i];
    if (!c || !c.half || !finV(c.pos)) continue;
    const dx = cx - c.pos.x, dy = cy - c.pos.y, dz = cz - c.pos.z, R = c.half.x + c.half.z + 1.5;
    if (dx * dx + dz * dz > R * R || Math.abs(dy) > c.half.y + 2) continue;
    _q.copy(c.quat).conjugate();
    _cl.set(dx, dy, dz).applyQuaternion(_q);
    const hx = c.half.x * 0.86 + 0.32, hz = c.half.z * 0.9 + 0.32;
    if (Math.abs(_cl.x) > hx || Math.abs(_cl.z) > hz) continue;
    if (_cl.y - 0.6 > c.half.y - 0.1 || _cl.y + 0.6 < -c.half.y) continue;
    // riding it: the surface under Kit is this car's roof (or hood) within a step
    const g = C.ground(P.pos.x, P.pos.z, P.pos.y + 0.45);
    if (g && g.solid === c) continue;
    if (P.invT > 0 || P.star > 0 || S.wipeT > 0) { nudge(c); continue; }
    carHit(c);
    return;
  }
}
function nudge(c) {
  // invulnerable: slide off the car's flank instead of going through it
  const P = PL();
  let ax = P.pos.x - c.pos.x, az = P.pos.z - c.pos.z;
  const l = Math.hypot(ax, az) || 1; ax /= l; az /= l;
  P.pos.x += ax * 0.12; P.pos.z += az * 0.12;
}
function carHit(c) {
  const P = PL();
  S.n0.carHits++;
  // after the knock-down Kit rides back to his line, or past a stopped vehicle on its side toward the crown
  let ra = K.city.routeAt(P.pos.x, P.pos.z), ld = ra && fin(ra.d) ? ra.d : 0;
  if (c.vel && c.vel.lengthSq() < 4) { ra = K.city.routeAt(c.pos.x, c.pos.z); const cd = ra && fin(ra.d) ? ra.d : 0; if (Math.abs(cd) > 1.5) ld = cd - Math.sign(cd) * (c.half.x + 1.5); }
  S.lineD = clamp(ld, -4.4, 4.4); S.recov = true;
  _c.copy(P.pos); _c.y += 0.7;
  _w.set(P.pos.x - c.pos.x, 0, P.pos.z - c.pos.z);
  if (_w.lengthSq() < 1e-6) _w.set(-S.hd.x, 0, -S.hd.z);
  _w.normalize();
  fx('sparks', _c, _w, 18, 0xffd080);
  fx('impact', _c, 0xffa040, 1.6);
  wipeout(c.pos);
  if (P.dead) return;
  // knocked away from the car, carried a little by its motion
  const cv = c.vel && finV(c.vel) ? c.vel : _up;
  P.vel.set(_w.x * 7 + cv.x * 0.6, 8.5, _w.z * 7 + cv.z * 0.6);
  S.grind = null; S.grounded = false; S.airT = 0; S.hold = 0;
  S.v = Math.hypot(P.vel.x, P.vel.z);
  shake(0.35);
}

// ---------- dash hoops (street and sky) ----------
function hoops(flight) {
  const D = K.city.dash;
  if (!D) return;
  const a = S.prevC, b = S.curC;
  for (let i = 0; i < D.length; i++) {
    const o = D[i];
    if (!o || !!o.flight !== flight) continue;
    const sa = (a.x - o.pos.x) * o.dir.x + (a.y - o.pos.y) * o.dir.y + (a.z - o.pos.z) * o.dir.z;
    const sb = (b.x - o.pos.x) * o.dir.x + (b.y - o.pos.y) * o.dir.y + (b.z - o.pos.z) * o.dir.z;
    if (!(sa < 0 && sb >= 0)) continue;
    const t = sa / (sa - sb);
    _v.copy(a).lerp(b, t);
    if (_v.distanceTo(o.pos) > o.r + 0.6) continue;
    hoopBoost(o, i, flight);
  }
}
function hoopBoost(o, i, flight) {
  const P = PL(), C = K.city;
  if (typeof C.dashHit === 'function') C.dashHit(i);
  S.n0.hoops++;
  fx('impact', o.pos, 0x5fe6ff, o.r * 1.5, o.dir);
  sfx('dash');
  event('hoop', 'TURBO', 0);
  if (flight) { F.boost = 1.6; return; }
  _w.set(o.dir.x, 0, o.dir.z);
  if (_w.lengthSq() < 1e-6) return;
  _w.normalize();
  S.yaw = yawOf(_w.x, _w.z); S.hd.copy(_w);
  S.v = Math.max(S.v, PH.hoop);
  if (S.grounded) surfVel(P.vel);
  else { P.vel.x = _w.x * S.v; P.vel.z = _w.z * S.v; }
  shake(0.1);
}

// ===================== the bumper and the flight =====================
function bumperCheck() {
  const P = PL(), b = K.city.bumper;
  if (!b || !b.base) return false;
  const dx = P.pos.x - b.base.x, dz = P.pos.z - b.base.z, r = (b.radius || 3.9) + 1.1;
  if (dx * dx + dz * dz > r * r || P.pos.y > b.base.y + 5.5) return false;
  startFlight();
  return true;
}
function startFlight() {
  const P = PL(), C = K.city, b = C.bumper;
  if (S.tk.def && S.tk.p >= 0.78) finishTrick();
  S.tk.def = null; S.grind = null;
  if (S.airN > 0) bankAir();
  B.mode = 'flight'; B.timeScale = SLOW;
  S.grounded = false; S.wipeT = 0;
  P.invT = 0; // no hurt blink during the cinematic
  F.u = 0; F.spd = 24; F.ox = F.oy = F.vx = F.vy = 0; F.boost = 0; F.t = 0; F.bank = 0;
  F.pitch = 0.15; F.blend = 0; F.start.copy(P.pos); F.landT = -1; F.touch = false; F.done = false; F.yaw = S.yaw;
  // the kick: straight up off the bumper's rim (a little recoil), over the top of its dome, then onto the sky path
  const base = b.base || b.pos, nx = b.normal ? b.normal.x : S.hd.x, nz = b.normal ? b.normal.z : S.hd.z;
  {
    // the kick starts just outside the chrome skirt (Kit may have moved a little into it this tick)
    const ex = P.pos.x - base.x, ez = P.pos.z - base.z, rr = Math.hypot(ex, ez);
    if (rr < 4.8) { if (rr > 0.01) F.start.set(base.x + ex / rr * 4.8, P.pos.y, base.z + ez / rr * 4.8); else F.start.set(base.x - nx * 4.8, P.pos.y, base.z - nz * 4.8); }
  }
  F.c1.set(F.start.x - nx * 1.2, Math.max(F.start.y, base.y) + 8, F.start.z - nz * 1.2);
  F.c2.set(base.x - nx * 0.8, base.y + 9.2, base.z - nz * 0.8);
  if (typeof C.bumperHit === 'function') C.bumperHit();
  post('flash', 0xfff0f8, 0.32);
  _c.copy(b.pos);
  fx('impact', _c, 0xff4fa0, 7, b.normal);
  _w.set(P.pos.x - b.base.x, 0.6, P.pos.z - b.base.z).normalize();
  _v.copy(P.pos); _v.y += 0.8;
  fx('sparks', _v, _w, 30, 0xff70c0);
  fx('jump', P.pos, _up);
  sfx('bounce'); sfx('spring');
  _v.y += 2;
  addScore(1000, _v);
  event('bumper', 'BUMPER !', 1000);
  shake(0.5);
  post('cinematic', true, CINE);
  F.cine = true;
  const cam = K.view && K.view.camera;
  const cx = cam ? cam.position.x : P.pos.x - S.hd.x * 7, cz = cam ? cam.position.z : P.pos.z - S.hd.z * 7;
  CAM.a0 = Math.atan2(cx - P.pos.x, cz - P.pos.z); CAM.lastA = CAM.a0; CAM.sweep = 0; CAM.orbiting = true;
  CAM.fromPos.copy(cam ? cam.position : P.pos);
}
function flightStep(dt) {
  const P = PL(), C = K.city;
  F.t += dt;
  B.timeScale = F.t < SLOW_T ? SLOW : F.t < SLOW_T + 0.6 ? lerp(SLOW, 1, smooth((F.t - SLOW_T) / 0.6)) : 1;
  const gdt = dt * B.timeScale;
  if (F.cine && F.t > ORBIT_T) { post('cinematic', false); F.cine = false; }
  S.prevC.copy(P.center ? P.center() : P.pos);
  const steer = inX(), climb = inY();
  // speed along the sky path: the launch, the cruise, boost hoops, a glide in at the end
  let want = F.boost > 0 ? PH.flyBoost : PH.fly;
  if (F.u > 0.9) want = lerp(want, 16, smooth((F.u - 0.9) / 0.1));
  F.boost = Math.max(0, F.boost - gdt);
  F.spd += clamp(want - F.spd, -24 * gdt, 30 * gdt);
  const L = C.flight && C.flight.len > 1 ? C.flight.len : 1;
  F.u = Math.min(1, F.u + F.spd * gdt / L);
  // gentle steering: offsets from the path that spring back when the stick rests
  const live = F.t > 0.6 ? 1 : 0;
  F.vx = lerp(F.vx, steer * 15 * live, dk(4.5, gdt));
  F.vy = lerp(F.vy, climb * 10 * live, dk(4.5, gdt));
  F.ox = clamp(F.ox + F.vx * gdt, -14, 14);
  F.oy = clamp(F.oy + F.vy * gdt, -8, 9);
  if (Math.abs(steer) < 0.1) F.ox *= 1 - dk(0.45, gdt);
  if (Math.abs(climb) < 0.1) F.oy *= 1 - dk(0.45, gdt);
  const endK = 1 - smooth((F.u - 0.84) / 0.1);
  C.flight.at(F.u, FA);
  NP.copy(FA.pos).addScaledVector(FA.right, F.ox * endK);
  NP.y += F.oy * endK;
  if (F.blend < 1) {
    F.blend = Math.min(1, F.blend + gdt / 0.5);
    const e = smooth(F.blend), q = 1 - e;
    NP.multiplyScalar(e * e * e).addScaledVector(F.start, q * q * q).addScaledVector(F.c1, 3 * q * q * e).addScaledVector(F.c2, 3 * q * e * e);
  }
  if (gdt > 1e-5) P.vel.copy(NP).sub(P.pos).divideScalar(gdt);
  P.pos.copy(NP);
  // body: arms forward along the path, banking into the steer, pitching with the climb
  F.bank = lerp(F.bank, clamp(F.vx / 15, -1, 1) * 0.85, dk(5, gdt));
  const vh = Math.hypot(P.vel.x, P.vel.z);
  const pitchT = vh > 1 ? Math.atan2(P.vel.y, vh) : 0;
  F.pitch = lerp(F.pitch, clamp(pitchT, -0.5, F.t < ORBIT_T ? 0.22 : 0.4), dk(4, gdt));
  if (vh > 1) F.yaw = yawOf(P.vel.x, P.vel.z);
  S.yaw = F.yaw; S.hd.set(dirX(F.yaw), 0, dirZ(F.yaw));
  clearPose();
  POSE.yaw = F.yaw; POSE.up.copy(_up); POSE.ground = false; POSE.bank = F.bank; POSE.pitch = F.pitch;
  pose(F.blend < 0.04 ? 'skateAir' : 'flight');
  S.curC.copy(P.center ? P.center() : P.pos);
  hoops(true);
  B.speed = F.spd;
  if ((S.t * 60 | 0) % 2 === 0 && F.blend > 0.3) fx('flightTrail', S.curC, P.vel);
  const sp = clamp((F.spd * B.timeScale - 24) / 30, 0, 1);
  post('speed', sp);
  fx('speedLines', sp, P.vel);
  if (F.u >= 1) { B.mode = 'land'; F.landT = 0; F.touch = false; B.timeScale = 1; }
}
function landStep(dt) {
  const P = PL(), C = K.city;
  F.landT += dt;
  B.timeScale = 1;
  if (!F.touch) {
    P.vel.x *= 1 - dk(5, dt); P.vel.z *= 1 - dk(5, dt);
    P.vel.y = Math.max(P.vel.y - 30 * dt, -20);
    NP.copy(P.pos).addScaledVector(P.vel, dt);
    const g = C.ground(NP.x, NP.z, Math.max(P.pos.y, NP.y) + 0.05);
    let down = g && NP.y <= g.y;
    if (!down && F.landT > 2.5 && C.goal) { NP.copy(C.goal.pos); down = true; }
    if (down) {
      if (g && NP.y <= g.y) NP.y = g.y;
      P.pos.copy(NP); P.vel.set(0, 0, 0);
      F.touch = true; F.touchT = F.landT;
      if (typeof C.goalHit === 'function') C.goalHit();
      fx('land', P.pos, _up, 14);
      fx('impact', P.pos, 0xffd23f, 3, _up);
      _c.copy(P.pos); _c.y += 1.5;
      fx('confetti', _c);
      post('flash', 0xfff2c0, 0.18);
      sfx('check');
      shake(0.35);
    } else P.pos.copy(NP);
    clearPose();
    POSE.yaw = F.yaw; POSE.up.copy(_up); POSE.ground = !!F.touch;
    POSE.pitch = lerp(F.pitch, -0.2, clamp(F.landT * 3, 0, 1)); POSE.bank = F.bank * (1 - clamp(F.landT * 3, 0, 1));
    if (F.touch) { POSE.impact = 1; pose('land'); } else pose('flight');
  } else {
    P.vel.set(0, 0, 0);
    clearPose();
    POSE.yaw = F.yaw; POSE.up.copy(_up); POSE.ground = true;
    pose('land');
    if (!F.done && F.landT - F.touchT > 1.6) {
      F.done = true; B.completed = true;
      const G = K.game;
      if (G && typeof G.onActComplete === 'function') { try { G.onActComplete(); } catch (e) { console.error(e); } }
    }
  }
  B.speed = Math.hypot(P.vel.x, P.vel.z);
  post('speed', 0);
  fx('speedLines', 0);
}

// ===================== camera =====================
const _cp = new V3(), _cl2 = new V3();
function camera(dt) {
  const V = K.view, cam = V && V.camera, P = PL(), C = K.city;
  if (!cam || !P || !C || !B.active) return;
  if (!(dt > 0 && dt < 0.25)) dt = 1 / 60;
  if (B.mode === 'flight') flightCam(dt);
  else if (B.mode === 'land') landCam(dt);
  else chaseCam(dt);
  // shake (screen-space jitter of the look point)
  if (CAM.shake > 0.001) {
    const s = CAM.shake, t = S.t * 60;
    _cl2.copy(CAM.look);
    _cl2.x += Math.sin(t * 1.7) * s * 0.35; _cl2.y += Math.sin(t * 2.3 + 1) * s * 0.3; _cl2.z += Math.cos(t * 1.9) * s * 0.35;
    CAM.shake = Math.max(0, CAM.shake - dt * 1.4);
  } else _cl2.copy(CAM.look);
  if (!finV(CAM.pos) || !finV(_cl2)) { CAM.snap = true; return; }
  cam.position.copy(CAM.pos);
  cam.up.set(0, 1, 0);
  cam.lookAt(_cl2);
  if (Math.abs(cam.fov - CAM.fov) > 0.01) { cam.fov = CAM.fov; cam.updateProjectionMatrix(); }
  cam.updateMatrixWorld();
  CAM.snap = false;
}
function manualLook(dt) {
  const I = K.input, lx = I && I.look && fin(I.look.x) ? I.look.x : 0;
  if (Math.abs(lx) > 1e-4) { CAM.manual = clamp(CAM.manual + lx, -Math.PI * 0.9, Math.PI * 0.9); CAM.manualT = 1.1; }
  else if (CAM.manualT > 0) CAM.manualT -= dt;
  else CAM.manual *= 1 - dk(2.2, dt);
}
function chaseCam(dt) {
  const P = PL(), C = K.city;
  manualLook(dt);
  const vh = Math.hypot(P.vel.x, P.vel.z);
  const travel = vh > 3 && S.wipeT <= 0 ? yawOf(P.vel.x, P.vel.z) : S.yaw;
  CAM.yaw = CAM.snap ? travel : wrapA(CAM.yaw + angD(CAM.yaw, travel) * dk(S.grounded || S.grind ? 5 : 2.5, dt));
  const yaw = CAM.yaw + CAM.manual, fx2 = dirX(yaw), fz2 = dirZ(yaw);
  const sp = smooth((B.speed - 10) / 32);
  const air = S.grounded || S.grind ? 0 : smooth((S.airT - 0.15) / 0.5);
  CAM.air = lerp(CAM.air, air, dk(air > CAM.air ? 3 : 2, dt));
  const dist = 6.4 + sp * 1.8 + CAM.air * 0.8, hgt = 2.2 + sp * 0.5 + CAM.air * 1.4;
  const ra = C.routeAt(P.pos.x, P.pos.z);
  const gv = ra && fin(ra.g) ? ra.g * (ra.dir.x * fx2 + ra.dir.z * fz2) : 0;
  const tx = P.pos.x - fx2 * dist, tz = P.pos.z - fz2 * dist;
  // eye height: behind Kit on a downhill the street is higher; in the air the camera lags so jumps read big
  let ty = P.pos.y + hgt - gv * dist * 0.85;
  _cp.set(tx, ty, tz);
  keepInStreet(_cp);
  const g = C.ground(_cp.x, _cp.z, _cp.y + 30);
  if (g && _cp.y < g.y + 1.1) _cp.y = g.y + 1.1;
  if (CAM.snap) CAM.pos.copy(_cp);
  else { CAM.pos.x = lerp(CAM.pos.x, _cp.x, dk(18, dt)); CAM.pos.z = lerp(CAM.pos.z, _cp.z, dk(18, dt)); CAM.pos.y = lerp(CAM.pos.y, _cp.y, dk(S.grounded || S.grind ? 9 : 6, dt)); }
  const ahead = 5 + sp * 3;
  CAM.look.set(P.pos.x + fx2 * ahead, P.pos.y + 1.0 + gv * ahead * 0.8 - CAM.air * 1.2, P.pos.z + fz2 * ahead);
  const want = 62 + 15 * smooth((B.speed - 16) / 28);
  CAM.fov = CAM.snap ? want : lerp(CAM.fov, want, dk(3, dt));
}
function keepInStreet(p) {
  const ra = K.city.routeAt(p.x, p.z);
  if (!ra || !fin(ra.width)) return;
  const lim = Math.max(2, ra.width - 1.2);
  if (Math.abs(ra.d) <= lim) return;
  const k = Math.sign(ra.d) * (Math.abs(ra.d) - lim);
  p.x -= ra.right.x * k; p.z -= ra.right.z * k;
}
function flightCam(dt) {
  const P = PL();
  const c = P.center ? P.center() : P.pos;
  if (F.t < ORBIT_T) {
    // bullet time: a full turn around Kit while he rises off the bumper
    const k = F.t / ORBIT_T, e = k * k * (3 - 2 * k);
    const a = CAM.a0 + TAU * e;
    const r = 7.4 - 1.8 * Math.sin(Math.PI * k);
    const h = 1.1 + 0.9 * Math.cos(TAU * k) - 0.4 * Math.sin(Math.PI * k);
    _cp.set(c.x + Math.sin(a) * r, c.y + h, c.z + Math.cos(a) * r);
    if (F.t < 0.25) _cp.lerpVectors(CAM.fromPos, _cp, smooth(F.t / 0.25));
    CAM.pos.copy(_cp);
    CAM.look.copy(c);
    CAM.fov = lerp(CAM.fov, 54, dk(4, dt));
    const ang = Math.atan2(CAM.pos.x - P.pos.x, CAM.pos.z - P.pos.z);
    CAM.sweep += Math.abs(angD(CAM.lastA, ang));
    CAM.lastA = ang;
    CAM.k = 0;
    return;
  }
  CAM.orbiting = false;
  C_flightDir(_w);
  _cp.copy(c).addScaledVector(_w, -7.2);
  _cp.y += 1.7;
  CAM.k = Math.min(1, CAM.k + dt / 0.8);
  CAM.pos.lerp(_cp, CAM.k >= 1 ? dk(12, dt) : dk(3 + 9 * CAM.k, dt));
  CAM.look.copy(c).addScaledVector(_w, 9);
  CAM.fov = lerp(CAM.fov, 66 + 10 * clamp((F.spd - 40) / 24, 0, 1), dk(3, dt));
}
function C_flightDir(out) {
  const P = PL(), vl = P.vel.length();
  if (vl > 2) out.copy(P.vel).divideScalar(vl); else out.copy(S.hd);
  out.y = clamp(out.y, -0.5, 0.5);
  return out.normalize();
}
function landCam(dt) {
  const P = PL();
  const c = P.center ? P.center() : P.pos;
  if (!F.touch) { flightCamTail(dt, c); return; }
  // the hero landing: swing round to a low three-quarter view from the front, then a slow drift
  const t = F.landT - F.touchT;
  const a = F.yaw + 0.95 + t * 0.1, r = 4.6 + Math.min(t, 3) * 0.25;
  _cp.set(P.pos.x - Math.sin(a) * r, P.pos.y + 0.9 + Math.min(t, 3) * 0.12, P.pos.z - Math.cos(a) * r);
  CAM.pos.lerp(_cp, dk(3.5, dt));
  CAM.look.lerp(_cl2.set(c.x, c.y + 0.25, c.z), dk(6, dt));
  CAM.fov = lerp(CAM.fov, 50, dk(3, dt));
}
function flightCamTail(dt, c) {
  C_flightDir(_w);
  _cp.copy(c).addScaledVector(_w, -7);
  _cp.y += 2.2;
  CAM.pos.lerp(_cp, dk(6, dt));
  CAM.look.lerp(_cl2.copy(c).addScaledVector(_w, 4), dk(8, dt));
}

// ===================== tests / HUD =====================
function stats() {
  const P = PL(), C = K.city;
  let s = 0, d = 0;
  if (P && C && C.built && finV(P.pos)) { const ra = C.routeAt(P.pos.x, P.pos.z); if (ra) { s = ra.s; d = ra.d; } }
  return Object.assign({
    active: B.active, mode: B.mode, v: +S.v.toFixed(2), speed: +B.speed.toFixed(2), s: +s.toFixed(1), d: +d.toFixed(2),
    grounded: S.grounded, grind: !!S.grind, wipe: S.wipeT > 0, combo: S.chainN, trickScore: B.trick.total,
    flightU: +F.u.toFixed(3), timeScale: +B.timeScale.toFixed(2), orbitSweep: +(CAM.sweep * 180 / Math.PI).toFixed(1),
    orbiting: CAM.orbiting, touch: F.touch, completed: B.completed, trickOn: !!S.tk.def, airT: +S.airT.toFixed(2)
  }, S.n0);
}
})();
