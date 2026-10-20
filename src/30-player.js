(() => {
'use strict';
// ===================== PLAYER (Kit) + CAMERA =====================
if (typeof THREE === 'undefined') return;

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const STEP = 1 / 60;
const clamp = (v, a, b) => (v > b ? b : v >= a ? v : a);
const lerp = (a, b, t) => a + (b - a) * t;
const fin = v => typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;
const finV = v => !!v && fin(v.x) && fin(v.y) && fin(v.z);
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const dk = (lambda, dt) => 1 - Math.exp(-lambda * dt);
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d || 0; };
const yawOf = (x, z) => Math.atan2(-x, -z);
const dirX = y => -Math.sin(y);
const dirZ = y => -Math.cos(y);
const hash = n => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
const lin = hex => new THREE.Color(hex); // r186 colour management: sRGB hex -> linear working space
const UP = new V3(0, 1, 0);

// Feel constants (units/s, 60 Hz)
const PH = {
  acc: 28, top: 20, max: 42, frc: 14, grav: 42, jump: 15.5, jumpCut: 6, fallMax: 60,
  skidDec: 56, skidMin: 7, skidAng: 1.95,
  rollMin: 4, rollFrc: 7, rollBrake: 24, rollStop: 2,
  airAcc: 18, airBrake: 26,
  homing: 34, airDash: 22, homingMax: 0.75,
  spinMin: 26, spinMax: 40, spinLevels: 5,
  shoesTop: 28, shoesAcc: 40, overDecay: 4,
  slopeDown: 0.6, slopeUp: 1.0, rollDown: 1.25, rollUp: 0.8,
  loopGrav: 0.2, loopFall: 8, loopLat: 2.5, loopSlow: 1.2, loopCamMin: 10,
  walkNY: 0.55, stickNY: 0.82, stick: 4.5, ledge: 0.6, unstick: 0.8,
  radius: 0.45, height: 1.2, ballHeight: 1.0
};

// ---------- safe bridges to the other modules ----------
function sfx(name, arg) { try { if (K.audio && typeof K.audio.sfx === 'function') K.audio.sfx(name, arg); } catch (e) { /* audio never breaks play */ } }
function burst(pos, kind, n) { try { if (K.fx && typeof K.fx.burst === 'function') K.fx.burst(pos, kind, n); } catch (e) { /* optional fx */ } }
function vfx(name, a, b, c) { const X = K.vfx; if (X && X.ready && typeof X[name] === 'function') { try { X[name](a, b, c); } catch (e) { /* optional fx */ } } }
function hit(n) { const I = K.input; try { return !!(I && typeof I.hit === 'function' && I.hit(n)); } catch (e) { return false; } }
function held(n) { const I = K.input; return !!(I && I.held && I.held[n]); }
function shake(a) { try { K.camera.shake(a); } catch (e) { /* ignore */ } }
function camMode(m, o) { try { K.camera.setMode(m, o); } catch (e) { /* ignore */ } }
function gameState() { return K.game && typeof K.game.state === 'string' ? K.game.state : 'play'; }

const GR = { y: 0, n: new V3(0, 1, 0), solid: null };
function ground(x, z, top) {
  const W = K.world;
  const ext = EX.on && EX.ground;
  if ((!ext && (!W || typeof W.ground !== 'function')) || !fin(x) || !fin(z)) return null;
  let g = null;
  try { g = ext ? EX.ground(x, z, fin(top) ? top : 1e6) : W.ground(x, z, fin(top) ? top : 1e6); } catch (e) { g = null; }
  if (!g || !fin(g.y)) return null;
  GR.y = g.y; GR.solid = g.solid || null;
  if (g.n && finV(g.n) && g.n.lengthSq() > 1e-8) { GR.n.copy(g.n).normalize(); if (GR.n.y < 0) GR.n.negate(); }
  else GR.n.set(0, 1, 0);
  return GR;
}
function terrainY(x, z) {
  const W = K.world;
  if (!W || typeof W.terrainY !== 'function') return -1e3;
  let h = -1e3;
  try { h = W.terrainY(x, z); } catch (e) { h = -1e3; }
  return fin(h) ? h : -1e3;
}
const LP = { pos: new V3(), up: new V3(), fwd: new V3() };
function loopAt(lp, th) {
  const W = K.world;
  if (W && typeof W.loopPoint === 'function') {
    try { W.loopPoint(lp, th, LP); if (finV(LP.pos) && finV(LP.up) && finV(LP.fwd)) return LP; } catch (e) { /* fallback below */ }
  }
  const R = lp.radius > 0 ? lp.radius : 7, s = Math.sin(th), c = Math.cos(th), k = (lp.shift || 0) / TAU;
  const d = lp.dir, sd = lp.side, e = lp.entry;
  LP.pos.set(e.x + d.x * R * s + sd.x * k * th, e.y + R * (1 - c), e.z + d.z * R * s + sd.z * k * th);
  LP.up.set(-d.x * s, c, -d.z * s);
  LP.fwd.set(d.x * R * c + sd.x * k, R * s, d.z * R * c + sd.z * k);
  const l = LP.fwd.length();
  if (l > 1e-8) LP.fwd.multiplyScalar(1 / l); else LP.fwd.set(d.x, 0, d.z);
  return LP;
}

// ===================== state =====================
const P = K.player = {
  pos: new V3(), vel: new V3(), forward: new V3(0, 0, -1),
  onGround: true, ball: false, dead: false, invT: 0, star: 0, shoes: 0, shield: false, homing: false,
  radius: 0.5,
  // read-only extras for the other modules
  speed: 0, state: 'idle', rolling: false, spinDash: false, crouch: false, inLoop: false, up: new V3(0, 1, 0),
  external: false, pose: null,
  create, init, update, center, isAttacking, bounce, hurt, kill, launch, dash, setExternal, setPose
};

const S = {
  built: false, mode: 'ground', t: 0, frame: 0,
  n: new V3(0, 1, 0), solid: null,
  faceYaw: 0, refYaw: 0, stickA: 0, stickOn: false, inYaw: 0, inMag: 0, inX: 0, inZ: -1,
  rolling: false, crouch: false, spinning: false, rev: 0, skid: false,
  jumping: false, airT: 0, coyote: 0, airKind: 'fall', homingUsed: false, homingT: 0, homingRef: null,
  homingPos: new V3(), homingArrived: false, airDashT: 0,
  lock: 0, springPose: false, hurtState: false,
  offLoop: 0, loop: null, loopTh: 0, loopSpd: 0, loopLat: 0, loopFrom: 0, loopCool: 0, loopCam: false, loopHold: 0, camYawHold: 0, loopUp: new V3(0, 1, 0), loopFwd: new V3(0, 0, -1),
  deathT: 0, deathKind: 'pop', deathDone: false, deathY: 0,
  lastDashT: -9, lastSpringT: -9, splashed: false, idleT: 0, landSq: 0, jumpSq: 0, revPulse: 0,
  good: new V3(), prev: new V3(), turnRate: 0, lastFace: 0, ph: 0, vt: 0
};

// scratch
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _e = new V3(), _gt = new V3(), _cen = new V3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

function center() {
  const up = P.up;
  return _cen.copy(P.pos).addScaledVector(up, P.ball ? 0.5 : 0.6);
}
function isAttacking() { return !!(P.ball || P.star > 0); }

// ===================== model =====================
const COL = {
  fur: lin('#f47a1f'), furD: lin('#c4510f'), furL: lin('#ffb35e'), white: lin('#fff4e6'), glove: lin('#fbfbff'),
  line: lin('#3d1707'), shoe: lin('#17b6c3'), shoeD: lin('#0c7480'), sole: lin('#f2f4f8'), scarf: lin('#2f5bff'), scarfD: lin('#1c39b4'),
  eye: lin('#22c36a'), eyeD: lin('#0b6e36'), pupil: lin('#08130c'), inner: lin('#6a2408'), nose: lin('#1a0b05'), eyeW: lin('#ffffff'),
  earTip: lin('#7a3410')
};
const _tc = new THREE.Color();
const mix = (a, b, t) => _tc.copy(a).lerp(b, clamp(t, 0, 1));

// merges transformed primitives into one vertex-coloured geometry with a per-vertex roughness attribute
const _bv = new V3(), _bn = new V3(), _bl = new V3(), _bm3 = new THREE.Matrix3();
class GB {
  constructor() { this.p = []; this.n = []; this.c = []; this.r = []; this.i = []; this.v = 0; }
  add(geo, m, col, rough, fn) {
    const pa = geo.attributes.position, na = geo.attributes.normal, ix = geo.index;
    _bm3.getNormalMatrix(m);
    const flip = m.determinant() < 0;
    for (let k = 0; k < pa.count; k++) {
      _bl.fromBufferAttribute(pa, k);
      _bv.copy(_bl).applyMatrix4(m);
      _bn.fromBufferAttribute(na, k).applyMatrix3(_bm3).normalize();
      this.p.push(_bv.x, _bv.y, _bv.z); this.n.push(_bn.x, _bn.y, _bn.z);
      const c = fn ? fn(_bl, _bv, _bn) : col;
      this.c.push(c.r, c.g, c.b); this.r.push(rough);
    }
    const o = this.v;
    if (ix) {
      for (let k = 0; k + 2 < ix.count; k += 3) {
        const a = ix.getX(k) + o, b = ix.getX(k + 1) + o, c = ix.getX(k + 2) + o;
        if (flip) this.i.push(a, c, b); else this.i.push(a, b, c);
      }
    } else {
      for (let k = 0; k + 2 < pa.count; k += 3) { if (flip) this.i.push(o + k, o + k + 2, o + k + 1); else this.i.push(o + k, o + k + 1, o + k + 2); }
    }
    this.v += pa.count;
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('rough', new THREE.Float32BufferAttribute(this.r, 1));
    g.setIndex(this.v > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    return g;
  }
}
const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _e4 = new THREE.Euler(), _p4 = new V3(), _s4 = new V3();
function TRS(x, y, z, rx, ry, rz, sx, sy, sz) {
  _e4.set(rx || 0, ry || 0, rz || 0);
  _q4.setFromEuler(_e4);
  _p4.set(x, y, z);
  if (sy == null) sy = sx;
  if (sz == null) sz = sx;
  _s4.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz);
  return _m4.compose(_p4, _q4, _s4);
}

let GEO = null;
function prims() {
  if (GEO) return;
  const arc = new THREE.TorusGeometry(1, 0.13, 6, 16, Math.PI * 0.8);
  arc.rotateZ(-Math.PI * 0.9); // centre the arc on the bottom so it reads as a smile / closed lid
  GEO = {
    sph: new THREE.SphereGeometry(1, 30, 22),
    sphM: new THREE.SphereGeometry(1, 20, 14),
    sphS: new THREE.SphereGeometry(1, 12, 9),
    cone: new THREE.ConeGeometry(1, 1, 20, 3),
    tor: new THREE.TorusGeometry(1, 0.32, 10, 30),
    box: new THREE.BoxGeometry(1, 1, 1),
    arc,
    ball: new THREE.SphereGeometry(1, 40, 28)
  };
}
function limb(rt, rb, len) {
  const g = new THREE.CylinderGeometry(rt, rb, len, 14, 2, true);
  g.translate(0, -len / 2, 0);
  return g;
}

const { uniform, attribute, float, vec3, clamp: tclamp, abs: tabs, dot: tdot, normalize: tnormalize, pow: tpow, sin: tsin,
  atan: tatan, mix: tmix, normalView, positionView, positionGeometry, instancedBufferAttribute } = TSL;
const RIM = uniform(lin('#fff1d6').multiplyScalar(0.55));
// Kit's body material: vertex colours, per-vertex roughness (attribute 'rough') and a warm rim light.
// PORT(kit): v2 = the same through MeshStandardMaterial shader injection (rim added to the outgoing light); v3: fur
// shells, SSS / wrap lighting, eyes with iris textures, fabric textures for scarf/gloves/shoes (SPEC3 §5).
function kitMaterial(double, map) {
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, side: double ? THREE.DoubleSide : THREE.FrontSide, map: map || null });
  m.roughnessNode = tclamp(attribute('rough', 'float'), 0.04, 1.0);
  const rim = float(1).sub(tclamp(tabs(tdot(tnormalize(normalView), tnormalize(positionView.negate()))), 0, 1));
  m.emissiveNode = RIM.mul(rim.mul(rim).mul(rim)).mul(tclamp(normalView.y.mul(0.5).add(0.5), 0, 1).mul(0.65).add(0.35));
  return m;
}
function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const R = {}; // rig: groups and meshes
const FX = {}; // effect meshes

function ell(b, x, y, z, rx, ry, rz, col, rough, ax, ay, az, fn, geo) {
  b.add(geo || GEO.sph, TRS(x, y, z, ax, ay, az, rx, ry, rz), col, rough, fn);
}
function group(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
function meshIn(parent, geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = false;
  parent.add(m);
  return m;
}
const furGrad = (l, w, n) => mix(COL.fur, COL.furL, smooth(n.y * 1.2 - 0.1) * 0.32);

function buildTorso() {
  const b = new GB();
  ell(b, 0, 0.02, -0.005, 0.135, 0.12, 0.125, COL.fur, 0.65, 0, 0, 0, furGrad);
  ell(b, 0, 0.17, 0, 0.158, 0.19, 0.142, COL.fur, 0.65, 0, 0, 0, furGrad);
  ell(b, 0, 0.13, 0.048, 0.112, 0.165, 0.108, COL.white, 0.7);
  ell(b, 0, 0.255, 0.085, 0.085, 0.06, 0.06, COL.white, 0.7, 0.3);
  b.add(GEO.tor, TRS(0, 0.315, 0.005, Math.PI / 2 + 0.16, 0, 0, 0.125, 0.125, 0.15), null, 0.55,
    (l, w, n) => mix(COL.scarf, COL.scarfD, smooth(-n.y * 1.5 + 0.2) * 0.8));
  ell(b, 0, 0.3, -0.142, 0.058, 0.048, 0.04, COL.scarfD, 0.55);
  return b.build();
}
function buildHead() {
  const b = new GB();
  const headFn = (l, w, n) => mix(COL.fur, COL.furL, smooth(n.y * 1.1) * 0.35);
  ell(b, 0, 0.2, 0, 0.245, 0.228, 0.222, COL.fur, 0.62, 0, 0, 0, headFn);
  // back-of-head and cheek tufts (fox silhouette)
  b.add(GEO.cone, TRS(0, 0.075, -0.17, -2.45, 0, 0, 0.1, 0.16, 0.06), COL.fur, 0.65);
  b.add(GEO.cone, TRS(0.075, 0.09, -0.155, -2.4, 0.35, 0, 0.07, 0.13, 0.05), COL.fur, 0.65);
  b.add(GEO.cone, TRS(-0.075, 0.09, -0.155, -2.4, -0.35, 0, 0.07, 0.13, 0.05), COL.fur, 0.65);
  b.add(GEO.cone, TRS(0.205, 0.085, 0.03, 0.15, 0, -2.1, 0.065, 0.14, 0.055), COL.white, 0.7);
  b.add(GEO.cone, TRS(-0.205, 0.085, 0.03, 0.15, 0, 2.1, 0.065, 0.14, 0.055), COL.white, 0.7);
  // muzzle and snout
  ell(b, 0, 0.105, 0.15, 0.138, 0.105, 0.14, COL.white, 0.7);
  ell(b, 0, 0.12, 0.255, 0.08, 0.066, 0.12, COL.white, 0.7, -0.08);
  ell(b, 0, 0.175, 0.2, 0.07, 0.045, 0.14, COL.fur, 0.62, 0.28, 0, 0, headFn);
  ell(b, 0, 0.142, 0.368, 0.044, 0.034, 0.034, COL.nose, 0.18);
  ell(b, 0.012, 0.156, 0.392, 0.012, 0.008, 0.006, COL.eyeW, 0.1);
  // smile on Kit's right side, like the 2D portrait
  b.add(GEO.arc, TRS(-0.045, 0.085, 0.3, -0.25, -0.5, 0.25, 0.045, 0.03, 0.03), COL.line, 0.6);
  // brows
  ell(b, 0.094, 0.352, 0.16, 0.058, 0.0095, 0.02, COL.line, 0.6, -0.55, 0.4, 0.14, null, GEO.sphM);
  ell(b, -0.094, 0.352, 0.16, 0.058, 0.0095, 0.02, COL.line, 0.6, -0.55, -0.4, -0.14, null, GEO.sphM);
  return b.build();
}
function buildEye(side) {
  const open = new GB(), shut = new GB(), xx = new GB();
  const ins = -side; // toward the nose
  ell(open, 0, 0, -0.008, 0.08, 0.112, 0.036, COL.eyeW, 0.12);
  open.add(GEO.sph, TRS(ins * 0.012, -0.008, 0.012, 0, 0, 0, 0.056, 0.08, 0.024), null, 0.12,
    (l) => mix(COL.eye, COL.eyeD, smooth((Math.hypot(l.x, l.y) - 0.5) / 0.45) * 0.8 + smooth(l.y * 0.9) * 0.2));
  ell(open, ins * 0.016, -0.008, 0.029, 0.029, 0.048, 0.011, COL.pupil, 0.08, 0, 0, 0, null, GEO.sphM);
  ell(open, ins * -0.006 + 0.004, 0.03, 0.037, 0.018, 0.022, 0.007, COL.eyeW, 0.05, 0, 0, 0.3, null, GEO.sphS);
  ell(open, ins * 0.03, -0.042, 0.033, 0.008, 0.008, 0.004, COL.eyeW, 0.05, 0, 0, 0, null, GEO.sphS);
  shut.add(GEO.arc, TRS(0, 0.0, 0.012, 0, 0, 0, 0.06, 0.045, 0.03), COL.line, 0.6);
  xx.add(GEO.box, TRS(0, 0, 0.012, 0, 0, 0.8, 0.12, 0.024, 0.02), COL.line, 0.6);
  xx.add(GEO.box, TRS(0, 0, 0.012, 0, 0, -0.8, 0.12, 0.024, 0.02), COL.line, 0.6);
  return { open: open.build(), shut: shut.build(), x: xx.build() };
}
function buildEar() {
  const b = new GB();
  b.add(GEO.cone, TRS(0, 0.155, 0, 0, 0, 0, 0.105, 0.31, 0.056), null, 0.65,
    (l) => mix(COL.fur, COL.earTip, smooth((l.y - 0.15) / 0.3)));
  b.add(GEO.cone, TRS(0, 0.125, 0.028, 0, 0, 0, 0.07, 0.23, 0.028), COL.inner, 0.8);
  b.add(GEO.cone, TRS(0, 0.09, 0.034, 0, 0, 0, 0.04, 0.13, 0.02), COL.white, 0.8);
  return b.build();
}
function buildUpperArm() {
  const b = new GB();
  ell(b, 0, 0, 0, 0.046, 0.046, 0.046, COL.fur, 0.65, 0, 0, 0, null, GEO.sphM);
  b.add(limb(0.036, 0.032, 0.16), TRS(0, 0, 0), COL.fur, 0.65);
  return b.build();
}
function buildForearm(side) {
  const b = new GB();
  ell(b, 0, 0, 0, 0.034, 0.034, 0.034, COL.fur, 0.65, 0, 0, 0, null, GEO.sphM);
  b.add(limb(0.032, 0.035, 0.11), TRS(0, 0, 0), COL.fur, 0.65);
  b.add(GEO.tor, TRS(0, -0.112, 0, Math.PI / 2, 0, 0, 0.05, 0.05, 0.075), COL.glove, 0.45);
  ell(b, 0, -0.112, 0, 0.052, 0.022, 0.052, COL.glove, 0.45, 0, 0, 0, null, GEO.sphM);
  ell(b, 0, -0.178, 0.006, 0.066, 0.07, 0.066, COL.glove, 0.45);
  ell(b, -side * 0.038, -0.152, 0.052, 0.024, 0.026, 0.044, COL.glove, 0.45, -0.25, 0, 0, null, GEO.sphM);
  return b.build();
}
function buildThigh() {
  const b = new GB();
  ell(b, 0, 0, 0, 0.06, 0.06, 0.06, COL.fur, 0.65, 0, 0, 0, null, GEO.sphM);
  b.add(limb(0.052, 0.045, 0.175), TRS(0, 0, 0), COL.fur, 0.65);
  return b.build();
}
function buildShin() {
  const b = new GB();
  ell(b, 0, 0, 0, 0.047, 0.047, 0.047, COL.fur, 0.65, 0, 0, 0, null, GEO.sphM);
  b.add(limb(0.045, 0.038, 0.175), TRS(0, 0, 0), COL.fur, 0.65);
  return b.build();
}
function buildShoe() {
  const b = new GB();
  b.add(GEO.tor, TRS(0, -0.008, -0.004, Math.PI / 2, 0, 0, 0.052, 0.052, 0.07), COL.shoeD, 0.35);
  const shoeFn = (l, w, n) => mix(COL.shoe, COL.shoeD, smooth(-n.y * 1.4 + 0.1) * 0.55);
  ell(b, 0, -0.05, 0.065, 0.108, 0.08, 0.195, COL.shoe, 0.28, 0, 0, 0, shoeFn);
  ell(b, 0, -0.068, 0.17, 0.104, 0.066, 0.11, COL.shoe, 0.28, 0, 0, 0, shoeFn);
  ell(b, 0, -0.114, 0.07, 0.114, 0.028, 0.218, COL.sole, 0.55);
  b.add(GEO.tor, TRS(0, -0.035, 0.07, -0.45, 0, 0, 0.1, 0.082, 0.07), COL.sole, 0.4);
  ell(b, 0, -0.03, 0.215, 0.05, 0.018, 0.03, COL.sole, 0.4, -0.95, 0, 0, null, GEO.sphM);
  return b.build();
}
function buildTail() {
  const s0 = new GB(), s1 = new GB(), s2 = new GB();
  ell(s0, 0, 0, -0.09, 0.06, 0.06, 0.11, COL.fur, 0.7, 0, 0, 0, furGrad);
  ell(s1, 0, 0.01, -0.165, 0.138, 0.13, 0.215, COL.fur, 0.72, 0, 0, 0,
    (l, w, n) => mix(mix(COL.fur, COL.furL, smooth(n.y) * 0.3).clone(), COL.white, smooth((-l.z - 0.55) / 0.35)));
  ell(s2, 0, 0, -0.07, 0.125, 0.118, 0.15, COL.white, 0.75);
  ell(s2, 0, 0.005, -0.19, 0.075, 0.072, 0.11, COL.white, 0.75);
  return [s0.build(), s1.build(), s2.build()];
}
// the 2D game's curled-up Kit, painted once and projected along the spin axis (X) on both sides of the ball
function ballTex() {
  return canvasTex(256, 256, (g, w) => {
    const k = w / 24;
    g.setTransform(k, 0, 0, k, w / 2, w / 2);
    const r = 11;
    let gr = g.createRadialGradient(-3, -4, 1, 0, 0, r);
    gr.addColorStop(0, '#ffb35e'); gr.addColorStop(0.7, '#f47a1f'); gr.addColorStop(1, '#c4510f');
    g.fillStyle = '#b8490d'; g.fillRect(-12, -12, 24, 24);
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
    g.lineCap = 'round';
    g.strokeStyle = '#fff4e6'; g.lineWidth = 3.2; g.beginPath(); g.arc(0, 0, r - 3.2, 0.2, 1.7); g.stroke();
    g.strokeStyle = '#c4510f'; g.lineWidth = 2.2; g.beginPath(); g.arc(0, 0, r - 3.6, 2.4, 3.9); g.stroke();
    g.strokeStyle = '#2f5bff'; g.lineWidth = 2.4; g.beginPath(); g.arc(0, 0, r - 6.5, 4.2, 5.6); g.stroke();
    g.fillStyle = '#17b6c3'; g.beginPath(); g.arc(r - 5, 2, 2.4, 0, TAU); g.fill();
    g.fillStyle = '#f2f4f8'; g.beginPath(); g.arc(r - 5, 3.6, 1.1, 0, Math.PI); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.2; g.beginPath(); g.arc(0, 0, r - 1.4, 3.6, 4.6); g.stroke();
    g.strokeStyle = 'rgba(61,23,7,0.55)'; g.lineWidth = 0.7; g.beginPath(); g.arc(0, 0, r - 0.3, 0, TAU); g.stroke();
  });
}
function buildBall() {
  const g = new THREE.SphereGeometry(0.5, 40, 28);
  const pa = g.attributes.position, n = pa.count, uv = g.attributes.uv, k = 11 / 12;
  const col = new Float32Array(n * 3).fill(1), rough = new Float32Array(n).fill(0.5);
  for (let i = 0; i < n; i++) {
    const y = pa.getY(i) / 0.5, z = pa.getZ(i) / 0.5;
    uv.setXY(i, 0.5 + 0.5 * z * k, 0.5 + 0.5 * y * k);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('rough', new THREE.BufferAttribute(rough, 1));
  return g;
}
function streakTex() {
  return canvasTex(256, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) {
      const x = hash(i * 3.1) * w, len = 30 + hash(i * 7.7) * 90, y = 4 + hash(i * 5.3) * (h - 8), th = 1.5 + hash(i * 1.9) * 4;
      const gr = g.createLinearGradient(x, 0, x + len, 0);
      const col = i % 3 === 0 ? '255,255,255' : i % 3 === 1 ? '255,196,120' : '255,150,60';
      gr.addColorStop(0, `rgba(${col},0)`); gr.addColorStop(0.75, `rgba(${col},0.55)`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr;
      g.fillRect(x, y, len, th); g.fillRect(x - w, y, len, th);
    }
  });
}
function wheelTex() {
  return canvasTex(256, 256, (g, w, h) => {
    const c = w / 2, R0 = c * 0.96;
    g.clearRect(0, 0, w, h);
    // leg blur: soft orange disc
    let gr = g.createRadialGradient(c, c, 0, c, c, R0);
    gr.addColorStop(0, 'rgba(244,122,31,0.0)'); gr.addColorStop(0.35, 'rgba(244,122,31,0.35)'); gr.addColorStop(0.62, 'rgba(214,100,25,0.5)');
    gr.addColorStop(0.7, 'rgba(23,182,195,0.55)'); gr.addColorStop(0.97, 'rgba(23,182,195,0.6)'); gr.addColorStop(1, 'rgba(23,182,195,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(c, c, R0, 0, TAU); g.fill();
    // two shoes smeared around the rim, with white soles
    g.lineCap = 'round';
    for (const s0 of [0, Math.PI]) {
      for (let k = 0; k < 16; k++) {
        const a = s0 - k * 0.11, al = Math.pow(1 - k / 16, 1.6);
        g.globalAlpha = 0.95 * al; g.strokeStyle = '#17b6c3'; g.lineWidth = w * 0.13;
        g.beginPath(); g.arc(c, c, R0 * 0.8, a, a + 0.16); g.stroke();
        g.globalAlpha = 0.9 * al; g.strokeStyle = '#f2f4f8'; g.lineWidth = w * 0.035;
        g.beginPath(); g.arc(c, c, R0 * 0.94, a, a + 0.16); g.stroke();
        g.globalAlpha = 0.5 * al; g.strokeStyle = '#f47a1f'; g.lineWidth = w * 0.06;
        g.beginPath(); g.arc(c, c, R0 * 0.5, a + 0.3, a + 0.42); g.stroke();
      }
    }
    g.globalAlpha = 1;
  });
}
function drumTex() {
  return canvasTex(256, 32, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    let gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(244,122,31,0.0)'); gr.addColorStop(0.5, 'rgba(244,122,31,0.28)'); gr.addColorStop(1, 'rgba(244,122,31,0.0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (const u0 of [0, w / 2]) {
      gr = g.createLinearGradient(u0, 0, u0 + w * 0.42, 0);
      gr.addColorStop(0, 'rgba(23,182,195,0.95)'); gr.addColorStop(0.25, 'rgba(23,182,195,0.6)'); gr.addColorStop(1, 'rgba(23,182,195,0)');
      g.fillStyle = gr; g.fillRect(u0, h * 0.12, w * 0.42, h * 0.76);
      gr = g.createLinearGradient(u0, 0, u0 + w * 0.3, 0);
      gr.addColorStop(0, 'rgba(242,244,248,0.95)'); gr.addColorStop(1, 'rgba(242,244,248,0)');
      g.fillStyle = gr; g.fillRect(u0, h * 0.4, w * 0.3, h * 0.2);
    }
  });
}
function radialTex(stops) {
  return canvasTex(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    for (const [t, c] of stops) gr.addColorStop(t, c);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}
function sparkleTex() {
  return canvasTex(64, 64, (g, w, h) => {
    const c = w / 2;
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath(); g.moveTo(c, 2); g.quadraticCurveTo(c, c, w - 2, c); g.quadraticCurveTo(c, c, c, h - 2); g.quadraticCurveTo(c, c, 2, c); g.quadraticCurveTo(c, c, c, 2); g.fill();
  });
}

// shield bubble: Fresnel rim + travelling bands + swirl, additive-ish transparent
// PORT(kit): v2 GLSL shield ported 1:1 to TSL (MeshBasicNodeMaterial colour/opacity nodes)
function shieldMaterial(U) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const p = positionGeometry, t = U.uT;
  const f = float(1).sub(tabs(tdot(tnormalize(normalView), tnormalize(positionView.negate()))));
  const rim = tpow(f, 2.4);
  const band = tpow(tsin(p.y.mul(10).sub(t.mul(4)).add(tsin(p.x.mul(6).add(t)).mul(1.5))).mul(0.5).add(0.5), 10);
  const swirl = tpow(tsin(tatan(p.z, p.x).mul(3).add(p.y.mul(4)).add(t.mul(3))).mul(0.5).add(0.5), 16);
  m.colorNode = tmix(vec3(0.42, 0.78, 1.0), vec3(0.92, 0.99, 1.0), rim).mul(band.mul(0.6).add(swirl.mul(0.5)).add(1));
  m.opacityNode = tclamp(rim.mul(0.75).add(0.07).add(band.mul(0.18)).add(swirl.mul(0.22)).mul(U.uA), 0, 0.95);
  return m;
}

function create(scene) {
  scene = scene || (K.view && K.view.scene);
  if (S.built || !scene) return;
  prims();
  const mat = kitMaterial(false);
  const mat2 = kitMaterial(true);
  R.mat = mat;

  const root = R.root = new THREE.Group();
  root.name = 'kit';
  scene.add(root);
  const rig = R.rig = group(root, 0, 0, 0);
  const hips = R.hips = group(rig, 0, 0.5, 0);
  const torso = R.torso = group(hips, 0, 0.0, 0);
  R.torsoMesh = meshIn(torso, buildTorso(), mat);
  R.knot = group(torso, 0, 0.31, -0.165);
  const neck = R.neck = group(torso, 0, 0.33, 0.0);
  R.headMesh = meshIn(neck, buildHead(), mat);
  const ear = buildEar();
  R.earL = group(neck, 0.125, 0.375, -0.03); meshIn(R.earL, ear, mat);
  R.earR = group(neck, -0.125, 0.375, -0.03); meshIn(R.earR, ear, mat);
  R.eyes = [];
  for (const side of [1, -1]) {
    const e = buildEye(side);
    const g = group(neck, side * 0.092, 0.245, 0.198);
    g.rotation.set(-0.18, side * 0.4, 0);
    const open = meshIn(g, e.open, mat), shut = meshIn(g, e.shut, mat), xx = meshIn(g, e.x, mat);
    open.castShadow = shut.castShadow = xx.castShadow = false;
    shut.visible = xx.visible = false;
    R.eyes.push({ g, open, shut, x: xx });
  }
  const ua = buildUpperArm();
  R.shL = group(torso, 0.18, 0.265, -0.01); meshIn(R.shL, ua, mat);
  R.shL.rotation.order = 'ZYX';
  R.elL = group(R.shL, 0, -0.16, 0); meshIn(R.elL, buildForearm(1), mat);
  R.shR = group(torso, -0.18, 0.265, -0.01); meshIn(R.shR, ua, mat);
  R.shR.rotation.order = 'ZYX';
  R.elR = group(R.shR, 0, -0.16, 0); meshIn(R.elR, buildForearm(-1), mat);
  const th = buildThigh(), sh = buildShin(), shoe = buildShoe();
  R.legs = [];
  for (const side of [1, -1]) {
    const lg = group(hips, side * 0.085, -0.01, 0);
    meshIn(lg, th, mat);
    const kn = group(lg, 0, -0.175, 0);
    meshIn(kn, sh, mat);
    const an = group(kn, 0, -0.175, 0);
    meshIn(an, shoe, mat);
    R.legs.push({ lg, kn, an });
  }
  const tg = buildTail();
  R.t0 = group(hips, 0, 0.03, -0.115); meshIn(R.t0, tg[0], mat);
  R.t1 = group(R.t0, 0, 0, -0.15); meshIn(R.t1, tg[1], mat);
  R.t2 = group(R.t1, 0, 0, -0.32); meshIn(R.t2, tg[2], mat);

  // peel-out leg wheel
  const wt = wheelTex(); wt.center.set(0.5, 0.5);
  const wg = new THREE.BufferGeometry();
  {
    const c = new THREE.CircleGeometry(0.27, 40);
    const parts = [];
    for (const sd of [1, -1]) { const g = c.clone(); g.rotateY(Math.PI / 2 + sd * 0.22); g.translate(sd * 0.085, 0, 0); parts.push(g); }
    let n = 0; for (const g of parts) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o * 3); uv.set(g.attributes.uv.array, o * 2);
      const ix = g.index; for (let k = 0; k < ix.count; k++) idx.push(ix.getX(k) + o);
      o += g.attributes.position.count;
    }
    wg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    wg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    wg.setIndex(idx);
    wg.computeBoundingSphere();
  }
  R.wheelTex = wt;
  R.wheel = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ map: wt, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  R.wheel.position.set(0, -0.24, 0.06);
  R.wheel.visible = false;
  R.wheel.renderOrder = 2;
  hips.add(R.wheel);
  {
    const parts = [];
    for (const sd of [1, -1]) { const g = new THREE.CylinderGeometry(0.255, 0.255, 0.1, 36, 1, true); g.rotateZ(Math.PI / 2); g.translate(sd * 0.085, 0, 0); parts.push(g); }
    const g = new THREE.BufferGeometry();
    const n = parts[0].attributes.position.count;
    const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx = [];
    parts.forEach((p, k) => {
      pos.set(p.attributes.position.array, k * n * 3); uv.set(p.attributes.uv.array, k * n * 2);
      const ix = p.index; for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + k * n);
    });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeBoundingSphere();
    R.drumTex = drumTex(); R.drumTex.wrapS = THREE.RepeatWrapping;
    R.drum = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: R.drumTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    R.drum.position.copy(R.wheel.position);
    R.drum.renderOrder = 2;
    R.drum.visible = false;
    hips.add(R.drum);
  }

  // ball form
  R.ballG = group(root, 0, 0.5, 0);
  R.ballSpin = group(R.ballG, 0, 0, 0);
  R.ballMesh = meshIn(R.ballSpin, buildBall(), kitMaterial(false, ballTex()));
  const shellGeo = new THREE.SphereGeometry(0.57, 28, 14);
  shellGeo.rotateZ(Math.PI / 2);
  R.shellTex = streakTex(); R.shellTex.wrapS = THREE.RepeatWrapping;
  R.shellMat = new THREE.MeshBasicMaterial({ map: R.shellTex, transparent: true, depthWrite: false, opacity: 0 });
  R.shell = new THREE.Mesh(shellGeo, R.shellMat);
  R.shell.renderOrder = 2;
  R.ballSpin.add(R.shell);
  R.ballG.visible = false;

  R.bodyParts = [];
  root.traverse(o => { if (o.isMesh && o !== R.wheel && o !== R.drum && o !== R.shell && o !== R.ballMesh) R.bodyParts.push(o); });

  // scarf tails (verlet ribbons in world space)
  {
    const N = SC.n, nv = 2 * N * 2;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), rough = new Float32Array(nv), nor = new Float32Array(nv * 3);
    const idx = [];
    for (let k = 0; k < 2; k++) {
      const base = k * N * 2;
      for (let i = 0; i < N; i++) {
        const c = k ? COL.scarfD : COL.scarf, t = i / (N - 1);
        const cc = mix(c, COL.scarfD, t * 0.35);
        for (let s = 0; s < 2; s++) { const v = base + i * 2 + s; col[v * 3] = cc.r; col[v * 3 + 1] = cc.g; col[v * 3 + 2] = cc.b; rough[v] = 0.6; nor[v * 3 + 1] = 1; }
        if (i < N - 1) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      for (let i = 0; i < N; i++) { SC.pts[k].push(new V3()); SC.old[k].push(new V3()); }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('rough', new THREE.BufferAttribute(rough, 1));
    g.setIndex(idx);
    SC.geo = g;
    SC.mesh = new THREE.Mesh(g, mat2);
    SC.mesh.frustumCulled = false;
    SC.mesh.castShadow = true;
    scene.add(SC.mesh);
  }

  // blob shadow
  {
    const g = new THREE.CircleGeometry(0.62, 28); g.rotateX(-Math.PI / 2);
    const tex = radialTex([[0, 'rgba(255,255,255,1)'], [0.55, 'rgba(255,255,255,0.65)'], [1, 'rgba(255,255,255,0)']]);
    FX.blob = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    FX.blob.renderOrder = 1;
    scene.add(FX.blob);
  }
  // shield bubble
  {
    FX.shieldU = { uT: uniform(0), uA: uniform(1) };
    FX.shield = new THREE.Mesh(new THREE.SphereGeometry(0.92, 36, 24), shieldMaterial(FX.shieldU));
    FX.shield.renderOrder = 3;
    FX.shield.visible = false;
    scene.add(FX.shield);
  }
  // invincibility sparkles
  {
    const n = FX.sparkN = 26;
    // PORT(kit): v2 invincibility sparkles were GL points (PointsMaterial, size 0.42); WebGPU draws THREE.Points 1 px
    // wide, so they are instanced sprites (SpriteNodeMaterial, count = 26) here
    FX.sparkPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    FX.sparkCol = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const sm = new THREE.SpriteNodeMaterial({ map: sparkleTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    sm.positionNode = instancedBufferAttribute(FX.sparkPos);
    sm.colorNode = instancedBufferAttribute(FX.sparkCol).mul(TSL.texture(sm.map).rgb);
    sm.opacityNode = TSL.texture(sm.map).a;
    sm.scaleNode = float(0.25);
    FX.spark = new THREE.Sprite(sm);
    FX.spark.count = n;
    FX.spark.frustumCulled = false;
    FX.spark.visible = false;
    FX.spark.renderOrder = 4;
    FX.sparkCols = ['#ffe45c', '#ffffff', '#7ff3ff', '#ff8fd8', '#a8ff7a'].map(lin);
    FX.trail = []; for (let i = 0; i < 40; i++) FX.trail.push(new V3());
    FX.trailI = 0;
    scene.add(FX.spark);
  }
  S.built = true;
  // afterimages: bake a run-pose silhouette from the live rig
  {
    root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.set(1, 1, 1);
    resetPose(); S.ph = 0.6; poseRun(14, false); for (const k of KEYS) Q[k] = T[k];
    applyPose();
    root.updateMatrixWorld(true);
    const b = new GB();
    _m.copy(root.matrixWorld).invert();
    for (const m of R.bodyParts) {
      if (!m.visible || R.eyes.some(e => e.open === m || e.shut === m || e.x === m)) continue;
      b.add(m.geometry, new THREE.Matrix4().multiplyMatrices(_m, m.matrixWorld), COL.white, 1);
    }
    const ghostRun = b.build();
    const gb = new GB(); gb.add(GEO.sphM, TRS(0, 0.5, 0, 0, 0, 0, 0.5), COL.white, 1);
    const ghostBall = gb.build();
    FX.ghostGeo = [ghostRun, ghostBall];
    FX.ghosts = [];
    for (let i = 0; i < 4; i++) {
      const gm = new THREE.Mesh(ghostRun, new THREE.MeshBasicMaterial({ color: lin('#6fe9ff'), transparent: true, opacity: 0.3, depthWrite: false }));
      gm.visible = false; gm.renderOrder = 1;
      scene.add(gm);
      FX.ghosts.push(gm);
    }
    FX.snaps = [];
    for (let i = 0; i < 16; i++) FX.snaps.push({ on: false, pos: new V3(), q: new THREE.Quaternion(), ball: false });
    FX.snapI = 0;
    resetPose();
  }
  init(P.pos, 0);
}

// ===================== pose system =====================
const KEYS = ['rigY', 'rigX', 'rigZ', 'hipsX', 'hipsY', 'hipsZ', 'torX', 'torY', 'torZ', 'hedX', 'hedY', 'hedZ',
  'earLX', 'earLZ', 'earRX', 'earRZ',
  'shLX', 'shLY', 'shLZ', 'elL', 'fwL', 'shRX', 'shRY', 'shRZ', 'elR', 'fwR',
  'lgLX', 'lgLZ', 'knL', 'anL', 'lgRX', 'lgRZ', 'knR', 'anR',
  't0X', 't0Y', 't1X', 't1Y', 't2X', 't2Y'];
const Q = {}, T = {};
for (const k of KEYS) { Q[k] = 0; T[k] = 0; }
const V = { state: 'idle', ballSpin: 0, mYaw: 0, mUp: new V3(0, 1, 0), blink: 2.5, blinkT: 0, plant: true, bob: 0 };

function base() {
  T.rigY = 0; T.rigX = 0; T.rigZ = 0; T.hipsX = 0; T.hipsY = 0; T.hipsZ = 0;
  T.torX = 0.02; T.torY = 0; T.torZ = 0; T.hedX = -0.03; T.hedY = 0; T.hedZ = 0;
  T.earLX = 0; T.earLZ = 0; T.earRX = 0; T.earRZ = 0;
  T.shLX = 0.05; T.shLY = 0; T.shLZ = 0.17; T.elL = 0.32; T.fwL = 0;
  T.shRX = 0.05; T.shRY = 0; T.shRZ = 0.17; T.elR = 0.32; T.fwR = 0;
  T.lgLX = 0; T.lgLZ = 0.035; T.knL = 0.08; T.anL = 0; T.lgRX = 0; T.lgRZ = 0.035; T.knR = 0.08; T.anR = 0;
  T.t0X = 0.55; T.t0Y = 0; T.t1X = -0.15; T.t1Y = 0; T.t2X = -0.25; T.t2Y = 0;
  V.plant = true; V.bob = 0;
}
function resetPose() { base(); for (const k of KEYS) Q[k] = T[k]; V.mUp.set(0, 1, 0); }
function wag(t, f, a0, a1, a2) {
  T.t0Y = Math.sin(t * f) * a0; T.t1Y = Math.sin(t * f - 0.8) * a1; T.t2Y = Math.sin(t * f - 1.6) * a2;
}
function poseIdle(t) {
  base();
  const br = Math.sin(t * 2.1);
  T.torX = 0.02 + br * 0.018; T.hedX = -0.05 - br * 0.025;
  T.shLZ = T.shRZ = 0.17 + br * 0.025;
  T.elL = T.elR = 0.32 + br * 0.04;
  wag(t, 2.4, 0.3, 0.42, 0.45); T.t0X = 0.6 + Math.sin(t * 4.8) * 0.04;
  const it = S.idleT;
  T.hedY = Math.sin(t * 0.5) * 0.28 * smooth((it - 2.5) / 1.5);
  T.hedZ = Math.sin(t * 0.5 + 1) * 0.06 * smooth((it - 2.5) / 1.5);
  if (it > 6.5) {
    // impatient: hands on hips, tapping a foot
    const k = smooth((it - 6.5) / 0.4);
    T.shLZ = lerp(T.shLZ, 0.62, k); T.shRZ = lerp(T.shRZ, 0.62, k);
    T.shLY = lerp(0, -1.45, k); T.shRY = lerp(0, -1.45, k);
    T.shLX = lerp(T.shLX, 0.15, k); T.shRX = lerp(T.shRX, 0.15, k);
    T.elL = lerp(T.elL, 1.75, k); T.elR = lerp(T.elR, 1.75, k);
    const tap = Math.max(0, Math.sin(t * 8.5));
    T.lgRX = -0.22 * k; T.knR = 0.12; T.anR = (0.22 - tap * 0.35) * k;
    T.lgLZ = 0.06; T.hipsZ = 0.04 * k; T.torZ = -0.05 * k;
  }
}
function legCycle(ph, amp, kAmp, kBase, lift) {
  const s = Math.sin(ph), c = Math.cos(ph);
  T.lgLX = -s * amp; T.lgRX = s * amp;
  T.knL = kBase + Math.max(0, c) * kAmp; T.knR = kBase + Math.max(0, -c) * kAmp;
  T.anL = -(T.lgLX + T.knL) * 0.85 + (c > 0 ? -0.25 * c : 0.2 * s * lift);
  T.anR = -(T.lgRX + T.knR) * 0.85 + (c < 0 ? 0.25 * c : -0.2 * s * lift);
}
function poseWalk(sp, t) {
  base();
  const k = smooth(sp / 7), ph = S.ph, s = Math.sin(ph);
  legCycle(ph, lerp(0.35, 0.62, k), lerp(0.55, 0.95, k), 0.12, 1);
  T.shLX = s * lerp(0.35, 0.6, k); T.shRX = -s * lerp(0.35, 0.6, k);
  T.shLZ = T.shRZ = 0.15; T.elL = T.elR = 0.45;
  T.torX = lerp(0.04, 0.12, k); T.torY = s * 0.1; T.hedX = -T.torX * 0.6; T.hedY = -s * 0.07;
  T.hipsY = -s * 0.06;
  V.bob = Math.cos(ph * 2) * lerp(0.012, 0.025, k);
  wag(t, 3, 0.2, 0.3, 0.3); T.t0X = lerp(0.5, 0.3, k); T.t0Y += s * 0.15;
  T.earLX = T.earRX = -0.1 * k;
}
function poseRun(sp, peel) {
  base();
  const k = smooth((sp - 7) / 10), ph = S.ph, s = Math.sin(ph);
  if (!peel) {
    legCycle(ph, lerp(0.75, 1.0, k), lerp(1.2, 1.6, k), 0.2, 1);
    V.bob = Math.cos(ph * 2) * 0.04;
  } else {
    legCycle(ph, 1.15, 1.75, 0.35, 1);
    V.plant = false; V.bob = Math.sin(S.t * 40) * 0.01;
    T.rigY = -0.03;
  }
  const pump = peel ? Math.sin(S.t * 26) * 0.05 : s * 0.22;
  T.shLX = (peel ? 1.4 : 1.0) + pump; T.shRX = (peel ? 1.4 : 1.0) - pump;
  T.shLZ = T.shRZ = peel ? 0.38 : 0.28;
  T.elL = T.elR = peel ? 0.18 : 0.55;
  T.hipsX = lerp(0.16, 0.26, k) + (peel ? 0.1 : 0);
  T.torX = lerp(0.08, 0.14, k); T.torY = peel ? 0 : s * 0.12;
  T.hedX = -(T.hipsX + T.torX) * 0.75; T.hedY = peel ? 0 : -s * 0.08;
  T.t0X = peel ? -0.15 : 0.08; T.t1X = 0.02; T.t2X = 0.02;
  T.t0Y = Math.sin(S.t * 13) * 0.08; T.t1Y = Math.sin(S.t * 13 - 0.8) * 0.12; T.t2Y = Math.sin(S.t * 13 - 1.6) * 0.14;
  T.earLX = T.earRX = peel ? -0.75 : -0.45;
}
function poseSkid() {
  base();
  T.hipsX = -0.28; T.torX = -0.12; T.hedX = 0.2;
  T.lgLX = -0.85; T.knL = 0.15; T.anL = 0.55;
  T.lgRX = 0.15; T.knR = 0.75; T.anR = -0.5;
  T.shLX = -0.9; T.shRX = -0.6; T.shLZ = T.shRZ = 0.7; T.elL = T.elR = 0.35;
  T.t0X = 1.0; T.t1X = 0.2; T.earLX = T.earRX = 0.3;
  T.rigZ = 0;
}
function poseCrouch(t) {
  base();
  T.hipsX = 0.32; T.torX = 0.22; T.hedX = -0.42;
  T.lgLX = T.lgRX = -1.15; T.knL = T.knR = 1.85; T.anL = T.anR = -0.7;
  T.lgLZ = T.lgRZ = 0.12;
  T.shLX = T.shRX = -0.55; T.shLZ = T.shRZ = 0.25; T.elL = T.elR = 0.7;
  T.t0X = 0.15; wag(t, 2, 0.15, 0.2, 0.2);
  T.earLX = T.earRX = -0.15;
}
function poseSpring(t) {
  base();
  T.torX = -0.08; T.hedX = -0.35;
  T.shLX = T.shRX = -2.85; T.shLZ = T.shRZ = 0.3; T.elL = T.elR = 0.12;
  T.lgLX = 0.08; T.lgRX = -0.05; T.knL = 0.12; T.knR = 0.2; T.anL = T.anR = 0.55;
  T.lgLZ = T.lgRZ = 0.0;
  T.t0X = -0.55; T.t1X = 0.15; T.t2X = 0.1; wag(t, 6, 0.12, 0.15, 0.15);
  T.earLX = T.earRX = -0.4;
  V.plant = false;
}
function poseFall(t) {
  base();
  const f = Math.sin(t * 9), g = Math.sin(t * 7 + 1);
  T.torX = 0.08; T.hedX = 0.1;
  T.shLX = -1.5 + f * 0.35; T.shRX = -1.5 - f * 0.35; T.shLZ = T.shRZ = 1.05; T.elL = T.elR = 0.45;
  T.lgLX = -0.55 + g * 0.3; T.lgRX = -0.15 - g * 0.3; T.knL = 0.75; T.knR = 0.55; T.anL = T.anR = 0.2;
  T.t0X = 0.9; T.t1X = 0.15; wag(t, 5, 0.2, 0.25, 0.25);
  T.earLX = T.earRX = 0.25;
  V.plant = false;
}
function poseHurt(t) {
  base();
  T.hipsX = -0.3; T.torX = -0.35; T.hedX = -0.35;
  T.shLX = T.shRX = 0.7; T.shLZ = T.shRZ = 1.15; T.elL = T.elR = 0.25;
  T.lgLX = -0.7; T.knL = 0.9; T.lgRX = 0.25; T.knR = 0.4; T.anL = T.anR = 0.3;
  T.t0X = 1.0; T.t1X = 0.3; T.earLX = T.earRX = -0.6;
  V.plant = false;
  void t;
}
function poseDead(t) {
  base();
  T.torX = -0.2; T.hedX = -0.3;
  T.shLX = T.shRX = -2.3; T.shLZ = T.shRZ = 0.95; T.elL = T.elR = 0.3;
  T.lgLX = -0.4; T.lgRX = -0.1; T.lgLZ = T.lgRZ = 0.35; T.knL = T.knR = 0.7;
  T.t0X = 0.3; wag(t, 4, 0.3, 0.3, 0.3);
  T.earLX = T.earRX = -0.5;
  V.plant = false;
}
function poseVictory(t, vt) {
  base();
  const k = smooth(vt / 0.35);
  T.torX = -0.04; T.torZ = 0.06 * k; T.hedZ = 0.14 * k; T.hedX = -0.1; T.hipsZ = -0.04 * k;
  T.shRX = lerp(0.05, -1.3, k); T.shRZ = lerp(0.17, 0.85, k); T.shRY = 0; T.elR = lerp(0.3, 0.5, k); T.fwR = 0;
  T.shLX = lerp(0.05, 0.15, k); T.shLZ = lerp(0.17, 0.62, k); T.shLY = -1.45 * k; T.elL = lerp(0.3, 1.75, k);
  T.lgLZ = T.lgRZ = 0.09; T.lgRX = -0.12; T.anR = 0.12;
  const fl = Math.max(0, Math.sin(t * 5.5));
  T.t0X = 0.9; T.t0Y = Math.sin(t * 5.5) * 0.5; T.t1Y = Math.sin(t * 5.5 - 0.8) * 0.55; T.t2Y = Math.sin(t * 5.5 - 1.6) * 0.5; T.t1X = -0.1 - fl * 0.2;
  T.earLX = 0.1; T.earRX = 0.1;
}

function applyPose() {
  R.rig.position.y = Q.rigY;
  // external poses tip the body about its centre (flight: lying flat), not about the feet
  if (EX.on && Q.rigX !== 0) { R.rig.position.y += EXT_PIVOT * (1 - Math.cos(Q.rigX)); R.rig.position.z = -EXT_PIVOT * Math.sin(Q.rigX); }
  else R.rig.position.z = 0;
  R.rig.rotation.set(Q.rigX, 0, Q.rigZ);
  R.hips.rotation.set(Q.hipsX, Q.hipsY, Q.hipsZ);
  R.torso.rotation.set(Q.torX, Q.torY, Q.torZ);
  R.neck.rotation.set(Q.hedX, Q.hedY, Q.hedZ);
  R.earL.rotation.set(-0.12 + Q.earLX, 0, -0.3 - Q.earLZ);
  R.earR.rotation.set(-0.12 + Q.earRX, 0, 0.3 + Q.earRZ);
  R.shL.rotation.set(Q.shLX, Q.shLY, Q.shLZ);
  R.elL.rotation.set(-Q.elL, Q.fwL, 0);
  R.shR.rotation.set(Q.shRX, -Q.shRY, -Q.shRZ);
  R.elR.rotation.set(-Q.elR, -Q.fwR, 0);
  const L = R.legs[0], Rr = R.legs[1];
  L.lg.rotation.set(Q.lgLX, 0, Q.lgLZ); L.kn.rotation.x = Q.knL; L.an.rotation.x = Q.anL;
  Rr.lg.rotation.set(Q.lgRX, 0, -Q.lgRZ); Rr.kn.rotation.x = Q.knR; Rr.an.rotation.x = Q.anR;
  R.t0.rotation.set(Q.t0X, Q.t0Y, 0);
  R.t1.rotation.set(Q.t1X, Q.t1Y, 0);
  R.t2.rotation.set(Q.t2X, Q.t2Y, 0);
}

// ===================== scarf =====================
const SC = { n: 8, seg: 0.062, pts: [[], []], old: [[], []], geo: null, mesh: null, ok: false };
const _kw = new V3(), _lw = new V3(), _fw = new V3(), _uw = new V3(), _nw = new V3(), _sv = new V3(), _sd = new V3();
function scarfStep(dt, visible) {
  if (!SC.mesh) return;
  SC.mesh.visible = visible;
  if (!visible) { SC.ok = false; return; }
  R.knot.getWorldPosition(_kw);
  const e = R.torso.matrixWorld.elements;
  _lw.set(e[0], e[1], e[2]).normalize();
  _uw.set(e[4], e[5], e[6]).normalize();
  _fw.set(e[8], e[9], e[10]).normalize();
  R.neck.getWorldPosition(_nw);
  if (!finV(_kw)) return;
  const N = SC.n, seg = SC.seg;
  if (!SC.ok || SC.pts[0][0].distanceToSquared(_kw) > 4) {
    for (let k = 0; k < 2; k++) for (let i = 0; i < N; i++) {
      SC.pts[k][i].copy(_kw).addScaledVector(_fw, -seg * i).addScaledVector(_uw, -seg * 0.3 * i);
      SC.old[k][i].copy(SC.pts[k][i]);
    }
    SC.ok = true;
  }
  const sp = P.speed, t = S.t;
  const flut = 1.2 + Math.min(sp, 40) * 0.5;
  const d2 = dt * dt;
  for (let k = 0; k < 2; k++) {
    const a = SC.pts[k], o = SC.old[k];
    a[0].copy(_kw).addScaledVector(_lw, k ? -0.03 : 0.03).addScaledVector(_uw, k ? -0.012 : 0);
    o[0].copy(a[0]);
    for (let i = 1; i < N; i++) {
      const p = a[i];
      _sv.subVectors(p, o[i]).multiplyScalar(0.9);
      o[i].copy(p);
      const w = Math.sin(t * (15 + k * 3) + i * 0.95 + k * 1.7) * flut;
      const w2 = Math.cos(t * (11 + k * 2) + i * 1.3) * flut * 0.6;
      p.add(_sv);
      p.x += (_lw.x * w + _uw.x * w2) * d2 * (i / N);
      p.y += (-7 + _lw.y * w + _uw.y * w2) * d2 * (i / N) - 3 * d2;
      p.z += (_lw.z * w + _uw.z * w2) * d2 * (i / N);
    }
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < N; i++) {
        _sd.subVectors(a[i], a[i - 1]);
        const l = _sd.length();
        if (l > 1e-6) a[i].copy(a[i - 1]).addScaledVector(_sd, seg / l);
        else a[i].copy(a[i - 1]).addScaledVector(_fw, -seg);
        // keep the ribbon behind the neck
        _sd.subVectors(a[i], _nw);
        const f = _sd.dot(_fw);
        if (f > -0.12 && _sd.lengthSq() < 0.16) a[i].addScaledVector(_fw, -0.12 - f);
      }
    }
  }
  const pa = SC.geo.attributes.position.array, na = SC.geo.attributes.normal.array;
  for (let k = 0; k < 2; k++) {
    const a = SC.pts[k];
    for (let i = 0; i < N; i++) {
      const p = a[i];
      _sd.subVectors(i < N - 1 ? a[i + 1] : p, i < N - 1 ? p : a[i - 1]);
      if (_sd.lengthSq() < 1e-10) _sd.copy(_fw).negate();
      _sd.normalize();
      const tw = (k ? -0.75 : 0.75) + i * 0.12 + Math.sin(t * 9 + i * 0.7 + k * 2) * 0.45 * smooth(sp / 12);
      _sv.copy(_lw).multiplyScalar(Math.cos(tw)).addScaledVector(_uw, Math.sin(tw));
      _sv.addScaledVector(_sd, -_sv.dot(_sd));
      if (_sv.lengthSq() < 1e-8) _sv.copy(_lw);
      _sv.normalize();
      const w = lerp(0.04, 0.03, i / (N - 1)) * (i === N - 1 ? 0.6 : 1);
      const v = (k * N + i) * 2;
      pa[v * 3] = p.x + _sv.x * w; pa[v * 3 + 1] = p.y + _sv.y * w; pa[v * 3 + 2] = p.z + _sv.z * w;
      pa[v * 3 + 3] = p.x - _sv.x * w; pa[v * 3 + 4] = p.y - _sv.y * w; pa[v * 3 + 5] = p.z - _sv.z * w;
      _c.crossVectors(_sd, _sv).normalize();
      for (let s = 0; s < 2; s++) { na[(v + s) * 3] = _c.x; na[(v + s) * 3 + 1] = _c.y; na[(v + s) * 3 + 2] = _c.z; }
    }
  }
  for (let i = 0; i < pa.length; i++) if (!fin(pa[i])) { SC.ok = false; SC.mesh.visible = false; return; }
  SC.geo.attributes.position.needsUpdate = true;
  SC.geo.attributes.normal.needsUpdate = true;
}

// ===================== controller =====================
function init(pos, yaw) {
  const p = finV(pos) ? pos : _a.set(0, 0, 0);
  P.pos.copy(p);
  yaw = fin(yaw) ? yaw : 0;
  S.n.set(0, 1, 0); S.solid = null;
  const g = ground(P.pos.x, P.pos.z, P.pos.y + 2);
  if (g) { P.pos.y = g.y; if (g.n.y >= PH.walkNY) S.n.copy(g.n); S.solid = g.solid; }
  P.vel.set(0, 0, 0);
  P.forward.set(dirX(yaw), 0, dirZ(yaw));
  P.onGround = true; P.ball = false; P.dead = false; P.invT = 0; P.star = 0; P.shoes = 0; P.shield = false; P.homing = false;
  P.speed = 0; P.state = 'idle'; P.rolling = false; P.spinDash = false; P.crouch = false; P.inLoop = false; P.up.set(0, 1, 0);
  S.mode = 'ground'; S.faceYaw = yaw; S.refYaw = yaw; S.stickOn = false; S.inMag = 0; S.inYaw = yaw;
  S.rolling = S.crouch = S.spinning = S.skid = false; S.rev = 0;
  S.jumping = false; S.airT = 0; S.coyote = 0; S.airKind = 'fall'; S.homingUsed = false; S.homingRef = null; S.homingArrived = false; S.airDashT = 0;
  S.lock = 0; S.springPose = false; S.hurtState = false;
  S.loop = null; S.loopCool = 0; S.loopCam = false; S.loopHold = 0; S.offLoop = 0;
  S.deathT = 0; S.deathDone = false; S.splashed = false; S.idleT = 0; S.landSq = 0; S.jumpSq = 0; S.revPulse = 0; S.vt = 0;
  S.good.copy(P.pos); S.prev.copy(P.pos); S.turnRate = 0; S.lastFace = yaw;
  if (S.built) {
    V.mYaw = yaw; V.mUp.copy(S.n); V.state = 'idle'; resetPose();
    SC.ok = false;
    if (FX.snaps) for (const s of FX.snaps) s.on = false;
    if (FX.ghosts) for (const gm of FX.ghosts) gm.visible = false;
    R.root.visible = true;
    finishFrame(0);
  }
}

function camInputYaw() {
  const C = K.camera;
  if (!C) return S.faceYaw;
  const y = fin(C.inputYaw) ? C.inputYaw : C.yaw;
  return fin(y) ? y : S.faceYaw;
}
function readInput() {
  const I = K.input;
  let mx = 0, my = 0;
  if (I && I.move) { mx = +I.move.x || 0; my = +I.move.y || 0; }
  let m = Math.hypot(mx, my);
  if (m > 1) { mx /= m; my /= m; m = 1; }
  const look = I && I.look;
  const manual = !!look && (Math.abs(+look.x || 0) + Math.abs(+look.y || 0) > 1e-5);
  // while a loop is framed from the side, steer relative to the view that preceded it
  const cy = S.loopCam ? S.camYawHold : camInputYaw();
  if (m > 0.1) {
    const sa = Math.atan2(mx, my);
    if (!S.stickOn || manual || Math.abs(angDiff(S.stickA, sa)) > 0.45) { S.refYaw = cy; S.stickA = sa; }
    S.stickOn = true;
    S.inYaw = S.refYaw - sa;
    S.inMag = Math.min(1, m);
  } else { S.stickOn = false; S.inMag = 0; }
  S.inX = dirX(S.inYaw); S.inZ = dirZ(S.inYaw);
}

// unit tangent of the plane with normal n pointing along yaw (horizontally)
function tangent(yaw, n, out) {
  out.set(dirX(yaw), 0, dirZ(yaw));
  out.addScaledVector(n, -out.dot(n));
  const l = out.length();
  if (l > 1e-6) out.multiplyScalar(1 / l); else out.set(dirX(yaw), 0, dirZ(yaw));
  return out;
}

function update(dt) {
  if (!S.built) return;
  if (!(dt > 0 && dt < 0.25)) dt = STEP;
  S.t += dt; S.frame++;
  if (P.dead) { deathStep(dt); finishFrame(dt); return; }
  if (P.invT > 0) P.invT = Math.max(0, P.invT - dt);
  if (P.star > 0) P.star = Math.max(0, P.star - dt);
  if (P.shoes > 0) P.shoes = Math.max(0, P.shoes - dt);
  if (S.lock > 0) S.lock = Math.max(0, S.lock - dt);
  if (S.loopCool > 0) S.loopCool -= dt;
  if (EX.on) { extStep(dt); sanitize(); finishFrame(dt); return; }
  S.prev.copy(P.pos);
  readInput();
  if (S.mode === 'loop') loopStep(dt);
  else if (S.mode === 'ground') groundStep(dt);
  else airStep(dt);
  if (S.mode === 'air' || S.mode === 'ground') unstick();
  if (!P.dead && P.ball && !S.spinning && (S.mode === 'ground' || S.mode === 'loop') && P.vel.lengthSq() > 81) vfx('ballTrail', center(), P.vel);
  if (!P.dead) {
    const W = K.world;
    const sea = W && fin(W.seaLevel) ? W.seaLevel : 0;
    if (!S.splashed && S.mode === 'air' && S.prev.y > sea && P.pos.y <= sea && terrainY(P.pos.x, P.pos.z) < sea - 0.3) {
      S.splashed = true; _a.set(P.pos.x, sea, P.pos.z); burst(_a, 'splash', 14);
    }
    const dy = W && fin(W.deathY) ? W.deathY : -60;
    if (P.pos.y < dy) kill('fall');
  }
  sanitize();
  finishFrame(dt);
}

function sanitize() {
  if (!finV(P.pos) || !finV(P.vel)) {
    P.pos.copy(S.good); P.vel.set(0, 0, 0);
    S.mode = 'air'; S.loop = null; P.homing = false;
    return;
  }
  const v = P.vel.length();
  if (v > 80) P.vel.multiplyScalar(80 / v);
  if (S.mode === 'ground') S.good.copy(P.pos);
}

function groundStep(dt) {
  const v = P.vel, n = S.n;
  if (S.solid && S.solid.delta && finV(S.solid.delta) && S.solid.delta.lengthSq() < 4) P.pos.add(S.solid.delta);
  let speed = v.length();
  const hl = Math.hypot(v.x, v.z);
  let hy = speed > 0.05 && hl > 0.02 ? yawOf(v.x, v.z) : S.faceYaw;
  const m = S.inMag, ctl = S.lock <= 0;
  const top = P.shoes > 0 ? PH.shoesTop : PH.top, acc = P.shoes > 0 ? PH.shoesAcc : PH.acc;

  // crouch / spin dash
  if (S.spinning) {
    if (!held('action')) { releaseSpin(); speed = P.vel.length(); hy = S.faceYaw; }
    else {
      if (hit('jump')) {
        S.rev = Math.min(PH.spinLevels, S.rev + 1); S.revPulse = 1;
        sfx('spin', Math.round(S.rev * 1.6)); burst(P.pos, 'dust', 4);
      }
      S.rev = Math.max(1, S.rev - (S.rev - 1) * 0.55 * dt);
    }
  } else if (S.crouch) {
    if (!held('action')) S.crouch = false;
    else if (hit('jump')) {
      S.spinning = true; S.rev = 1; S.revPulse = 1; P.ball = true;
      sfx('spin', 2); burst(P.pos, 'dust', 4);
    }
  } else if (!S.rolling && ctl && held('action') && speed < 1.5) {
    S.crouch = true;
  }

  if (!S.spinning && !S.crouch && hit('jump')) { doJump(dt); airIntegrate(dt); return; }
  if (!S.spinning && !S.crouch && hit('action')) {
    if (S.rolling) { S.rolling = false; P.ball = false; }
    else if (speed >= PH.rollMin) { S.rolling = true; P.ball = true; S.skid = false; sfx('roll'); }
  }

  if (S.spinning || S.crouch) {
    speed = Math.max(0, speed - 40 * dt);
    if (m > 0) S.faceYaw += clamp(angDiff(S.faceYaw, S.inYaw), -12 * dt, 12 * dt);
    hy = speed > 0.3 ? hy : S.faceYaw;
    S.skid = false;
  } else if (S.rolling) {
    speed = Math.max(0, speed - PH.rollFrc * dt);
    if (m > 0 && ctl) {
      const d = angDiff(hy, S.inYaw);
      if (Math.abs(d) > 2.2) speed = Math.max(0, speed - PH.rollBrake * m * dt);
      else { const rate = lerp(3.2, 1.3, smooth(speed / PH.max)); hy += clamp(d, -rate * dt, rate * dt) * m; }
    }
  } else if (ctl) {
    if (m > 0) {
      const d = angDiff(hy, S.inYaw);
      if (speed > PH.skidMin && Math.abs(d) > PH.skidAng) {
        if (!S.skid) { S.skid = true; sfx('skid'); }
        speed = Math.max(0, speed - PH.skidDec * dt);
        if (S.frame % 4 === 0) burst(P.pos, 'dust', 1);
      } else {
        if (S.skid && speed > 3 && Math.abs(d) > 1.2) {
          speed = Math.max(0, speed - PH.skidDec * dt);
        } else {
          S.skid = false;
          if (speed < 1) hy = S.inYaw;
          else {
            const rate = speed <= PH.top ? lerp(14, 3.4, smooth(speed / PH.top)) : lerp(3.4, 2.2, smooth((speed - PH.top) / (PH.max - PH.top)));
            const turn = clamp(d, -rate * dt, rate * dt);
            hy += turn;
            speed -= Math.abs(turn) * speed * 0.08;
          }
          const tgt = top * m;
          if (speed < tgt) {
            const k = 0.18 + 0.82 * smooth((tgt - speed) / (0.3 * top));
            speed = Math.min(tgt, speed + acc * k * dt);
          } else if (speed > top) speed = Math.max(tgt, speed - PH.overDecay * dt);
          else speed = Math.max(tgt, speed - PH.frc * dt);
        }
      }
    } else {
      S.skid = false;
      speed = Math.max(0, speed - PH.frc * dt);
    }
  }

  tangent(hy, n, _a);
  v.copy(_a).multiplyScalar(speed);
  if (!S.spinning && !S.crouch) {
    const G = PH.grav;
    _gt.set(G * n.y * n.x, -G * (1 - n.y * n.y), G * n.y * n.z);
    if (_gt.lengthSq() > 1e-4) {
      const down = _gt.dot(v) >= 0;
      let f = S.rolling ? (down ? PH.rollDown : PH.rollUp) : (down ? PH.slopeDown : PH.slopeUp);
      if (!S.rolling && speed < 1 && m === 0 && n.y > PH.stickNY) f = 0;
      v.addScaledVector(_gt, f * dt);
    }
  }
  const sp = v.length();
  if (sp > PH.max) v.multiplyScalar(PH.max / sp);
  if (S.rolling && sp < PH.rollStop && !S.spinning) { S.rolling = false; P.ball = false; }

  // facing
  if (S.spinning || S.crouch) { /* aimed above */ }
  else if (sp > 0.5 && !S.skid) S.faceYaw = yawOf(v.x, v.z);
  else if (m > 0 && !S.skid) S.faceYaw = S.inYaw;

  // move
  P.pos.addScaledVector(v, dt);
  wallSlide();
  groundFollow(dt);
  if (S.mode === 'ground') checkLoops();
  if (S.loopCam && S.mode === 'ground') { S.loopHold -= dt; if (S.loopHold <= 0) loopCamOff(); }
}

function groundFollow(dt) {
  const v = P.vel;
  const sp = v.length(), ds = sp * dt;
  const g = ground(P.pos.x, P.pos.z, P.pos.y + 0.35 + ds * 1.25);
  const maxDrop = lerp(0.42, 0.09, smooth((sp - 8) / 8));
  let gy = 0, solid = null;
  let ok = false;
  if (g && P.pos.y - g.y <= maxDrop && g.n.y >= PH.walkNY) {
    // crest: launch when the surface falls away faster than gravity can bend the velocity
    if (sp > 6 && dt > 0) {
      const vn = v.dot(g.n);
      if (vn > 0 && Math.asin(Math.min(1, vn / sp)) > PH.stick * PH.grav * g.n.y * dt / sp) { leaveGround(); return; }
    }
    ok = true; gy = g.y; solid = g.solid; _b.copy(g.n);
  }
  else if (sp < 6) {
    // ledge tolerance: a foot still on the edge keeps Kit standing
    const best = ledge(P.pos.y + 0.3, maxDrop);
    if (best !== null) { ok = true; gy = best; solid = ledgeSolid; _b.set(0, 1, 0); }
  }
  if (!ok) { leaveGround(); return; }
  P.pos.y = gy;
  S.n.copy(_b);
  S.solid = solid;
  const vn = v.dot(_b);
  v.addScaledVector(_b, -vn);
  const l = v.length();
  if (l > 1e-6) v.multiplyScalar(sp / l);
}
let ledgeSolid = null;
function ledge(top, maxDrop) {
  let best = null;
  ledgeSolid = null;
  for (let k = 0; k < 6; k++) {
    const a = k * TAU / 6;
    const g = ground(P.pos.x + Math.cos(a) * 0.3, P.pos.z + Math.sin(a) * 0.3, top);
    if (g && g.n.y >= PH.walkNY && P.pos.y - g.y <= maxDrop && (best === null || g.y > best)) { best = g.y; ledgeSolid = g.solid; }
  }
  return best;
}
function leaveGround() {
  S.mode = 'air'; S.solid = null;
  S.airKind = S.rolling ? 'roll' : 'fall';
  S.coyote = 0.1; S.airT = 0; S.jumping = false; S.skid = false; S.crouch = false; S.spinning = false;
  P.ball = S.rolling;
}

const WN = { x: 0, z: 0 };
function wallSlide() {
  const W = K.world;
  if (!W || typeof W.collideWalls !== 'function') return false;
  let r = null;
  try { r = W.collideWalls(P.pos, PH.radius, P.ball ? PH.ballHeight : PH.height); } catch (e) { r = null; }
  if (!r || !r.hit) return false;
  const nx = fin(r.nx) ? r.nx : 0, nz = fin(r.nz) ? r.nz : 0;
  WN.x = nx; WN.z = nz;
  const v = P.vel, vn = v.x * nx + v.z * nz;
  if (vn < 0) { v.x -= vn * nx; v.z -= vn * nz; }
  return true;
}

function doJump(dt) {
  const v = P.vel, n = S.n;
  v.addScaledVector(n, PH.jump);
  if (v.y < PH.jump * 0.6) v.y = PH.jump * 0.6;
  if (v.y > PH.jump * 1.5) v.y = PH.jump * 1.5;
  if (S.solid && S.solid.delta && finV(S.solid.delta) && S.solid.delta.lengthSq() < 4 && dt > 0) {
    v.x += S.solid.delta.x / dt; v.z += S.solid.delta.z / dt;
  }
  S.mode = 'air'; S.airKind = 'jump'; S.jumping = true; S.airT = 0; S.coyote = 0;
  P.ball = true; S.rolling = false; S.crouch = false; S.spinning = false; S.skid = false; S.springPose = false;
  S.homingUsed = false; S.solid = null; S.jumpSq = 1;
  P.pos.addScaledVector(n, 0.02);
  sfx('jump');
  vfx('jump', P.pos, n, v);
}

function releaseSpin() {
  const lv = clamp(S.rev, 1, PH.spinLevels);
  const sp = PH.spinMin + (lv - 1) / (PH.spinLevels - 1) * (PH.spinMax - PH.spinMin);
  tangent(S.faceYaw, S.n, _a);
  P.vel.copy(_a).multiplyScalar(sp);
  S.spinning = false; S.crouch = false; S.rolling = true; P.ball = true; S.rev = 0;
  sfx('release');
  _b.copy(P.pos).addScaledVector(_a, -0.6);
  burst(_b, 'dust', 8);
  vfx('airJump', center(), _a);
  shake(0.12);
}

function airStep(dt) {
  const v = P.vel;
  S.airT += dt;
  if (S.coyote > 0) S.coyote -= dt;
  if (hit('jump')) {
    if (S.coyote > 0 && (S.airKind === 'fall' || S.airKind === 'roll')) { S.n.set(0, 1, 0); doJump(dt); }
    else if (canHome()) startHoming();
  }
  if (S.loopCam && S.airT > 2.5) loopCamOff();
  if (P.homing) homingStep(dt);
  else {
    if (S.jumping) {
      if (!held('jump') && v.y > PH.jumpCut) v.y = PH.jumpCut;
      if (v.y <= 0) S.jumping = false;
    }
    if (S.lock <= 0 && !S.hurtState && S.airDashT <= 0) airControl(dt);
    let g = PH.grav;
    if (S.airDashT > 0) { S.airDashT -= dt; g = PH.grav * 0.15; }
    v.y -= g * dt;
    if (v.y < -PH.fallMax) v.y = -PH.fallMax;
    if (S.springPose && v.y < -4) S.springPose = false;
  }
  airIntegrate(dt);
}
function canHome() {
  if (S.homingUsed || S.hurtState || P.homing) return false;
  if (S.airKind === 'spring') return S.airT > 0.15;
  if (S.lock > 0) return false;
  return S.airT > 0.06 || S.airKind !== 'jump';
}
function startHoming() {
  S.homingUsed = true; P.ball = true; S.jumping = false; S.springPose = false; S.airKind = 'jump'; S.lock = 0;
  const E = K.entities;
  let t = null;
  if (E && typeof E.homingTarget === 'function') {
    try { t = E.homingTarget(center(), P.forward); } catch (e) { t = null; }
    // facing can lag behind (jumping off a moving platform, drifting): also try where the stick points
    if (!t && S.inMag > 0.3) {
      _d.set(S.inX, 0, S.inZ);
      try { t = E.homingTarget(center(), _d); } catch (e) { t = null; }
    }
  }
  if (t && finV(t.pos)) {
    P.homing = true; S.homingT = 0; S.homingRef = t.ref === undefined ? null : t.ref; S.homingPos.copy(t.pos); S.homingArrived = false;
    sfx('homing');
    _d.subVectors(t.pos, center());
    if (_d.lengthSq() > 1e-6) vfx('airJump', center(), _d.normalize());
  } else {
    const v = P.vel, hs = Math.hypot(v.x, v.z);
    let fx = P.forward.x, fz = P.forward.z;
    const fl = Math.hypot(fx, fz);
    if (fl > 1e-4) { fx /= fl; fz /= fl; } else { fx = dirX(S.faceYaw); fz = dirZ(S.faceYaw); }
    const s = Math.max(PH.airDash, hs);
    v.x = fx * s; v.z = fz * s; v.y = Math.max(0.5, Math.min(v.y, 3));
    S.airDashT = 0.16;
    sfx('homing');
    burst(center(), 'spark', 4);
    _d.set(fx, 0, fz);
    vfx('airJump', center(), _d);
  }
}
function homingStep(dt) {
  S.homingT += dt;
  const c = center();
  if (S.homingArrived) { endHoming(true); return; }
  vfx('homingTrail', c);
  const E = K.entities;
  if (E && typeof E.homingTarget === 'function') {
    _d.subVectors(S.homingPos, c);
    const dl = _d.length();
    if (dl > 1e-4) {
      _d.multiplyScalar(1 / dl);
      let t = null;
      try { t = E.homingTarget(c, _d); } catch (e) { t = null; }
      if (t && finV(t.pos) && t.ref === S.homingRef && t.pos.distanceToSquared(S.homingPos) < 16) S.homingPos.copy(t.pos);
    }
  }
  _d.subVectors(S.homingPos, c);
  const dist = _d.length();
  if (dist < 0.05 || S.homingT > PH.homingMax) { endHoming(true); return; }
  _d.multiplyScalar(1 / dist);
  const step = PH.homing * dt;
  P.vel.copy(_d).multiplyScalar(PH.homing);
  if (dist <= step) { P.vel.multiplyScalar(dist / step); S.homingArrived = true; }
  S.faceYaw = Math.hypot(_d.x, _d.z) > 0.2 ? yawOf(_d.x, _d.z) : S.faceYaw;
}
function endHoming(missed) {
  P.homing = false; S.homingArrived = false;
  if (missed) {
    const v = P.vel;
    v.x *= 0.3; v.z *= 0.3; v.y = Math.max(v.y * 0.3, 5);
  }
}

function airControl(dt) {
  const m = S.inMag;
  if (m <= 0) return;
  const v = P.vel;
  const top = P.shoes > 0 ? PH.shoesTop : PH.top;
  let hs = Math.hypot(v.x, v.z);
  if (hs < 1.5) { v.x += S.inX * PH.airAcc * m * dt; v.z += S.inZ * PH.airAcc * m * dt; return; }
  let hy = yawOf(v.x, v.z);
  const d = angDiff(hy, S.inYaw);
  if (Math.abs(d) > 2.4) hs = Math.max(0, hs - PH.airBrake * m * dt);
  else {
    const rate = lerp(5.0, 1.6, smooth(hs / 30));
    hy += clamp(d, -rate * dt, rate * dt) * m;
    if (hs < top * m) hs = Math.min(top * m, hs + PH.airAcc * dt);
  }
  v.x = dirX(hy) * hs; v.z = dirZ(hy) * hs;
}

function airIntegrate(dt) {
  const v = P.vel;
  const prevY = P.pos.y;
  P.pos.addScaledVector(v, dt);
  ceiling(prevY);
  // land before resolving walls: a fast fall can put the feet more than a step below a platform's top in one
  // tick, and the wall push would then eject Kit sideways off the platform instead of landing on it
  const top = Math.max(prevY, P.pos.y) + 0.3;
  let g = ground(P.pos.x, P.pos.z, top);
  if (!g || P.pos.y > g.y) {
    // ledge catch: feet just under a walkable top (a platform's lip, the far side of a gap) climb onto it
    const g2 = ground(P.pos.x, P.pos.z, P.pos.y + PH.ledge);
    g = g2 && g2.y > P.pos.y && g2.n.y >= PH.walkNY ? g2 : null;
  }
  if (g && P.pos.y <= g.y) {
    if (g.n.y >= PH.walkNY && (v.y <= 0.5 || v.dot(g.n) <= 0)) land(g);
    else {
      P.pos.y = g.y;
      const vn = v.dot(g.n);
      if (vn < 0) v.addScaledVector(g.n, -vn);
    }
  }
  _e.copy(v);
  if (S.mode === 'air' && !P.homing && !S.hurtState && v.y <= 6) lipAhead();
  if (wallSlide()) {
    if (P.homing) endHoming(true);
    // touching a lip whose walkable top is just above the feet: step onto it, keeping the run-up speed
    else if (S.mode === 'air' && !S.hurtState && v.y <= 6 && mantle(WN.x, WN.z)) {
      v.x = _e.x; v.z = _e.z;
      if (S.mode === 'ground') { const vn = v.dot(S.n); if (vn < 0) v.addScaledVector(S.n, -vn); }
    }
  }
  if (S.mode === 'air') loopBand();
  if (S.mode !== 'air') return;
  const hs = Math.hypot(v.x, v.z);
  if (!P.homing && hs > 1.5 && !S.springPose) S.faceYaw = yawOf(v.x, v.z);
  else if (!P.homing && S.inMag > 0 && hs <= 1.5) S.faceYaw = S.inYaw;
}
// ledge forgiveness: the body touches a wall (normal nx, nz) whose walkable top is just above the feet (a platform's
// edge, the far side of a gap): step onto it instead of sliding down the face
function mantle(nx, nz) {
  const ax = P.pos.x - nx * (PH.radius + 0.15), az = P.pos.z - nz * (PH.radius + 0.15);
  const g = ground(ax, az, P.pos.y + PH.ledge);
  if (!g || !(g.y > P.pos.y + 0.02) || g.n.y < PH.walkNY || (g.solid && g.solid.kind === 'rail')) return false;
  P.pos.x = ax; P.pos.z = az;
  if (P.vel.y <= 0.5) land(g);
  else P.pos.y = g.y + 0.01;
  return true;
}
// the same forgiveness one step earlier: over a gap or a cliff face, a walkable top just ahead of the body and just
// above the feet is stepped onto before the face is even touched
function lipAhead() {
  const v = P.vel, hs = Math.hypot(v.x, v.z);
  if (hs < 0.5) return false;
  const here = ground(P.pos.x, P.pos.z, P.pos.y + 0.05);
  if (here && here.n.y >= PH.walkNY && here.y > P.pos.y - 1.5) return false;
  const k = PH.radius / hs, ax = P.pos.x + v.x * k, az = P.pos.z + v.z * k;
  const g = ground(ax, az, P.pos.y + PH.ledge);
  if (!g || !(g.y > P.pos.y + 0.02) || g.n.y < PH.walkNY || (g.solid && g.solid.kind === 'rail')) return false;
  P.pos.x = ax; P.pos.z = az;
  if (v.y <= 0.5) land(g);
  else P.pos.y = g.y + 0.01;
  return true;
}
// Kit must never end up inside the heightfield (a fast move across a one-cell cliff face can still put the feet under
// its top): step up onto a walkable top that is close, otherwise back out along the way he came in
function unstick() {
  const x = P.pos.x, z = P.pos.z, y = P.pos.y;
  const th = terrainY(x, z);
  if (!(th > y + 0.02)) return;
  let dx = x - S.prev.x, dz = z - S.prev.z, dl = Math.hypot(dx, dz);
  if (dl < 1e-4) { dx = P.vel.x; dz = P.vel.z; dl = Math.hypot(dx, dz); }
  if (dl > 1e-6) { dx /= dl; dz /= dl; } else { dx = 0; dz = 0; }
  if (th - y <= PH.unstick) {
    // shallow: stand on the walkable top here, or just ahead (Kit is on the steep cell of a one-cell cliff face)
    for (let i = 0; i < 4; i++) {
      const d = i * 0.35, qx = x + dx * d, qz = z + dz * d;
      if (i > 0 && !(dl > 1e-6)) break;
      const g = ground(qx, qz, y + PH.unstick);
      if (!g || g.y < y || g.n.y < PH.walkNY || (g.solid && g.solid.kind === 'rail')) continue;
      P.pos.x = qx; P.pos.z = qz;
      if (S.mode === 'air' && P.vel.y <= 0.5) { land(g); return; }
      P.pos.y = g.y;
      const vn = P.vel.dot(g.n);
      if (vn < 0) P.vel.addScaledVector(g.n, -vn);
      if (S.mode === 'ground') S.n.copy(g.n);
      return;
    }
  }
  let ox = S.prev.x, oz = S.prev.z;
  if (terrainY(ox, oz) > y + 0.02) {
    let found = false;
    for (let rr = 0.5; rr <= 3.01 && !found; rr += 0.5) {
      for (let k = 0; k < 8; k++) {
        const a = k * TAU / 8, qx = x + Math.cos(a) * rr, qz = z + Math.sin(a) * rr;
        if (terrainY(qx, qz) <= y) { ox = qx; oz = qz; found = true; break; }
      }
    }
    if (!found) {
      P.pos.copy(S.good); P.vel.set(0, 0, 0);
      if (S.mode === 'ground') leaveGround();
      return;
    }
  }
  let lo = 0, hi = 1;
  for (let i = 0; i < 10; i++) { const m = (lo + hi) * 0.5; if (terrainY(lerp(ox, x, m), lerp(oz, z, m)) > y + 0.02) hi = m; else lo = m; }
  dx = x - ox; dz = z - oz; dl = Math.hypot(dx, dz);
  if (dl > 1e-6) { dx /= dl; dz /= dl; } else { dx = 0; dz = 0; }
  P.pos.x = lerp(ox, x, lo) - dx * 0.05; P.pos.z = lerp(oz, z, lo) - dz * 0.05;
  const vn = P.vel.x * dx + P.vel.z * dz;
  if (vn > 0) { P.vel.x -= vn * dx; P.vel.z -= vn * dz; }
  if (P.homing) endHoming(true);
  if (S.mode === 'ground') leaveGround();
  wallSlide();
}
function ceiling(prevY) {
  const v = P.vel;
  if (v.y <= 0) return;
  const W = K.world, sol = W && W.solids;
  if (!Array.isArray(sol)) return;
  const H = P.ball ? PH.ballHeight : PH.height, r = 0.25;
  for (let i = 0; i < sol.length; i++) {
    const s = sol[i];
    if (!s || !s.min || !s.max) continue;
    if (prevY + H > s.min.y + 0.02 || P.pos.y + H <= s.min.y) continue;
    if (P.pos.x < s.min.x - r || P.pos.x > s.max.x + r || P.pos.z < s.min.z - r || P.pos.z > s.max.z + r) continue;
    P.pos.y = s.min.y - H - 0.001;
    v.y = 0; S.jumping = false;
    if (P.homing) endHoming(true);
  }
}
function land(g) {
  const v = P.vel;
  const impact = -v.y;
  P.pos.y = g.y;
  S.n.copy(g.n); S.solid = g.solid;
  const vn = v.dot(S.n);
  if (vn < 0) v.addScaledVector(S.n, -vn);
  S.mode = 'ground';
  const keepRoll = !S.hurtState && (S.airKind === 'roll' || (P.ball && held('action') && v.length() > PH.rollMin));
  if (S.hurtState) { S.hurtState = false; v.multiplyScalar(0.15); }
  S.rolling = keepRoll; P.ball = keepRoll;
  P.homing = false; S.homingUsed = false; S.jumping = false; S.springPose = false; S.airDashT = 0; S.airKind = 'fall'; S.lock = 0;
  S.landSq = clamp(impact / 28, 0, 1);
  if (impact > 16) burst(P.pos, 'dust', impact > 30 ? 8 : 4);
  if (impact > 6) vfx('land', P.pos, g.n, impact);
  if (S.loopCam) loopCamOff();
  S.splashed = false;
}

// ---------- loops ----------
function loopCamOn(lp, hold) {
  const m = K.camera && K.camera.mode;
  if (m !== 'follow' && m !== 'loop') return;
  if (!S.loopCam || m !== 'loop') {
    if (!S.loopCam) S.camYawHold = camInputYaw();
    camMode('loop', { loop: lp });
  }
  S.loopCam = true; S.loopHold = Math.max(S.loopHold, hold);
}
function loopCamOff() {
  if (!S.loopCam) return;
  S.loopCam = false; S.loopHold = 0;
  if (K.camera && K.camera.mode === 'loop') camMode('follow', { yaw: S.faceYaw });
}
function checkLoops() {
  if (S.loopCool > 0) return;
  const L = K.level && K.level.loops;
  if (!Array.isArray(L)) return;
  for (let i = 0; i < L.length; i++) {
    const lp = L[i];
    if (!lp || !finV(lp.entry) || !finV(lp.dir) || !finV(lp.side)) continue;
    const ex = lp.entry, d = lp.dir, sd = lp.side;
    if (Math.abs(P.pos.y - ex.y) > 1.5) continue;
    const a1 = (P.pos.x - ex.x) * d.x + (P.pos.z - ex.z) * d.z;
    const a0 = (S.prev.x - ex.x) * d.x + (S.prev.z - ex.z) * d.z;
    const b = (P.pos.x - ex.x) * sd.x + (P.pos.z - ex.z) * sd.z;
    const vd = P.vel.x * d.x + P.vel.z * d.z;
    const minS = fin(lp.minSpeed) ? lp.minSpeed : 14;
    const R0 = lp.radius > 0 ? lp.radius : 7;
    // frame the loop a moment before Kit reaches it, so the follow camera never cuts through the band
    if (a1 < 0 && a1 > -vd * 0.4 - 1 && Math.abs(b) < PH.loopLat + 0.5 && vd >= minS) loopCamOn(lp, 0.2);
    const shift = fin(lp.shift) ? lp.shift : 0, b2 = b - shift;
    // funnel: just before the entry, the lane of the shifted exit runs into the back of the arc; steer a Kit running
    // in that lane onto the entry lane instead of letting him stop dead against the shell
    const bs = shift < 0 ? -b : b, laneEnd = Math.abs(shift) + (fin(lp.width) && lp.width > 0 ? lp.width / 2 : 2.3) + 0.6;
    if (a1 < -0.3 && a1 > -2.4 * R0 && vd > 2 && bs > PH.loopLat * 0.5 && bs < laneEnd) {
      const step = Math.min(bs, Math.max(6, vd * 0.7) * STEP) * (shift < 0 ? -1 : 1);
      P.pos.x -= sd.x * step; P.pos.z -= sd.z * step;
    }
    if ((a0 < 0) !== (a1 < 0)) {
      // any approach on the band's lane takes it: too slow for the whole loop, Kit runs up, then rolls back out
      if (a0 < 0 && a1 >= 0 && Math.abs(b) < PH.loopLat && vd >= PH.loopSlow) { startLoop(lp, a1 / R0, vd, b, 0); return; }
      if (a0 >= 0 && a1 < 0 && Math.abs(b2) < PH.loopLat && -vd >= PH.loopSlow) { startLoop(lp, TAU + a1 / R0, vd, b2, TAU); return; }
    }
    // standing inside a low ramp of the band (a landing, a knock-back): onto the band, which then rolls Kit out
    const low = fin(lp.low) && lp.low > 0 ? Math.min(lp.low, R0 * 0.95) : R0 * 0.75;
    const edge = (fin(lp.width) && lp.width > 0 ? lp.width / 2 : 2.3) + 0.3;
    if (a1 > 0.05 && a1 < low) {
      const th = Math.asin(a1 / R0), lat = b - shift * th / TAU;
      if (Math.abs(lat) < edge) { startLoop(lp, th, vd, lat, th); return; }
    } else if (a1 < -0.05 && a1 > -low) {
      // the exit ramp's inner rail nudges a brushing Kit back toward the entry lane (K.world), so only a Kit well
      // inside the ramp counts on that side
      const th = TAU + Math.asin(a1 / R0), lat = b - shift * th / TAU;
      const nudge = fin(lp.nudge) && lp.nudge > 0 ? lp.nudge : 0;
      if (lat > -edge + nudge && lat < edge) { startLoop(lp, th, vd, lat, th); return; }
    }
  }
}
// Airborne Kit and a loop's band (outside the traversal the band is not ground). Inside the circle its low part is a
// floor (landing on it starts the traversal, which rolls him out) and the rest a wall or ceiling the feet cannot pass;
// from outside, the checker shell is solid (a jump under the arc bumps the head).
function loopBand() {
  const L = K.level && K.level.loops;
  if (!Array.isArray(L)) return;
  for (let i = 0; i < L.length && S.mode === 'air'; i++) {
    const lp = L[i];
    if (!lp || !finV(lp.entry) || !finV(lp.dir) || !finV(lp.side)) continue;
    const R0 = lp.radius > 0 ? lp.radius : 7, ex = lp.entry, d = lp.dir;
    const half = fin(lp.width) && lp.width > 0 ? lp.width / 2 : 2.3, thick = fin(lp.thick) && lp.thick > 0 ? lp.thick : 1.25;
    const shift = fin(lp.shift) ? lp.shift : 0;
    const rx = P.pos.x - ex.x, rz = P.pos.z - ex.z;
    const a = rx * d.x + rz * d.z, h = P.pos.y - ex.y;
    if (a < -R0 - thick - 1 || a > R0 + thick + 1 || h < -2 || h > 2 * R0 + thick + 1) continue;
    const b = rx * lp.side.x + rz * lp.side.z;
    const pa = (S.prev.x - ex.x) * d.x + (S.prev.z - ex.z) * d.z, ph = S.prev.y - ex.y;
    const f = Math.hypot(a, h - R0), pf = Math.hypot(pa, ph - R0);
    let th = Math.atan2(a, R0 - h);
    if (th < 0) th += TAU;
    if (Math.min(f, pf) < R0 - 0.01) {
      // inside the circle: the feet stay on this side of the running surface
      if (Math.abs(b - shift * th / TAU) > half + 0.2 || f < R0 - 0.02) continue;
      loopAt(lp, th);
      if (th <= 1.1 || th >= TAU - 1.1) {
        if (P.vel.dot(LP.up) >= 0) continue;
        const spd = P.vel.dot(LP.fwd);
        P.homing = false; S.homingArrived = false; S.homingUsed = false; S.jumping = false; S.springPose = false;
        S.airDashT = 0; S.lock = 0; S.hurtState = false; S.airKind = 'fall'; P.ball = S.rolling;
        S.landSq = clamp(-P.vel.y / 28, 0, 1);
        startLoop(lp, th, spd, b - shift * th / TAU, th);
        return;
      }
      const k = (R0 - 0.03) / f;
      P.pos.x = ex.x + d.x * (a * k) + lp.side.x * b;
      P.pos.z = ex.z + d.z * (a * k) + lp.side.z * b;
      P.pos.y = ex.y + R0 + (h - R0) * k;
      const vr = -P.vel.dot(LP.up);
      if (vr > 0) P.vel.addScaledVector(LP.up, vr);
      if (P.homing) endHoming(true);
      continue;
    }
    // outside: feet and head keep clear of the shell (not on the low ramps, which the ground walls guard)
    const hh = h + PH.height, fh = Math.hypot(a, hh - R0);
    const useHead = fh < f, py = useHead ? hh : h, pr = useHead ? fh : f;
    const lim = R0 + thick + 0.3;
    if (pr >= lim || pr < 1e-4) continue;
    let tp = Math.atan2(a, R0 - py);
    if (tp < 0) tp += TAU;
    if (tp < 0.5 || tp > TAU - 0.5 || Math.abs(b - shift * tp / TAU) > half + 0.45) continue;
    const ua = a / pr, uh = (py - R0) / pr, push = lim - pr;
    P.pos.x += d.x * ua * push; P.pos.z += d.z * ua * push; P.pos.y += uh * push;
    const vr = P.vel.x * d.x * ua + P.vel.y * uh + P.vel.z * d.z * ua;
    if (vr < 0) { P.vel.x -= vr * d.x * ua; P.vel.y -= vr * uh; P.vel.z -= vr * d.z * ua; }
    if (P.homing) endHoming(true);
  }
}
function startLoop(lp, th, spd, lat, from) {
  S.mode = 'loop'; S.loop = lp; S.loopTh = clamp(th, 0, TAU); S.loopSpd = fin(spd) ? spd : 0; S.loopLat = fin(lat) ? lat : 0; S.loopFrom = from;
  S.skid = false; S.crouch = false; S.spinning = false; S.solid = null;
  // the side view only for a real run at the loop (a slow walk up the ramp keeps the follow camera)
  if (Math.abs(S.loopSpd) >= PH.loopCamMin) loopCamOn(lp, 0.6);
  loopPlace();
}
function loopLatNow() { return S.loopLat * (1 - smooth(Math.abs(S.loopTh - S.loopFrom) / 1.0)); }
function loopArc(lp) { const R0 = lp.radius > 0 ? lp.radius : 7, k = (lp.shift || 0) / TAU; return Math.sqrt(R0 * R0 + k * k); }
function loopPlace() {
  const lp = S.loop;
  loopAt(lp, S.loopTh);
  P.pos.copy(LP.pos).addScaledVector(lp.side, loopLatNow());
  P.vel.copy(LP.fwd).multiplyScalar(S.loopSpd);
  S.n.copy(LP.up);
  S.loopUp.copy(LP.up);
  S.loopFwd.copy(LP.fwd).multiplyScalar(S.loopSpd >= 0 ? 1 : -1);
}
function loopStep(dt) {
  const lp = S.loop;
  if (!lp) { S.mode = 'air'; return; }
  if (S.loopCam) S.loopHold = Math.max(S.loopHold, 0.55);
  loopAt(lp, S.loopTh);
  if (hit('jump')) {
    P.vel.copy(LP.fwd).multiplyScalar(S.loopSpd).addScaledVector(LP.up, PH.jump);
    S.mode = 'air'; S.loop = null; S.loopCool = 0.6;
    S.airKind = 'jump'; S.jumping = true; S.airT = 0; P.ball = true; S.rolling = false; S.homingUsed = false;
    P.pos.addScaledVector(LP.up, 0.05);
    sfx('jump');
    vfx('jump', P.pos, LP.up, P.vel);
    airIntegrate(dt);
    return;
  }
  if (hit('action') && Math.abs(S.loopSpd) >= PH.rollMin) {
    S.rolling = !S.rolling; P.ball = S.rolling;
    if (S.rolling) sfx('roll');
  }
  S.loopSpd -= PH.grav * PH.loopGrav * LP.fwd.y * dt;
  if (S.loopSpd > PH.max) S.loopSpd = PH.max; else if (S.loopSpd < -PH.max) S.loopSpd = -PH.max;
  S.loopTh += S.loopSpd * dt / loopArc(lp);
  if (S.loopTh >= TAU) { exitLoop(1); return; }
  if (S.loopTh <= 0) { exitLoop(-1); return; }
  if (Math.abs(S.loopSpd) < PH.loopFall && S.loopTh > 1.15 && S.loopTh < TAU - 1.15) {
    loopAt(lp, S.loopTh);
    // off the upper half: a firmer push toward the centre, so his body clears the band while he turns upright
    P.vel.copy(LP.fwd).multiplyScalar(S.loopSpd).addScaledVector(LP.up, 1.5 + 4 * Math.max(0, -LP.up.y));
    S.mode = 'air'; S.loop = null; S.loopCool = 0.8; S.offLoop = 0.4;
    S.airKind = S.rolling ? 'roll' : 'fall'; S.airT = 0; S.coyote = 0; S.homingUsed = false; S.jumping = false;
    P.ball = S.rolling;
    return;
  }
  loopPlace();
}
function exitLoop(sign) {
  const lp = S.loop;
  S.loopTh = sign > 0 ? TAU : 0;
  loopAt(lp, S.loopTh);
  P.pos.copy(LP.pos).addScaledVector(lp.side, loopLatNow());
  const s = Math.abs(S.loopSpd);
  const d = lp.dir, dl = Math.hypot(d.x, d.z) || 1;
  P.vel.set(d.x / dl * sign * s, 0, d.z / dl * sign * s);
  S.mode = 'ground'; S.loop = null; S.loopCool = 0.5; S.n.set(0, 1, 0);
  const g = ground(P.pos.x, P.pos.z, P.pos.y + 0.6);
  if (g && Math.abs(g.y - P.pos.y) < 0.8 && g.n.y >= PH.walkNY) { P.pos.y = g.y; S.n.copy(g.n); S.solid = g.solid; }
  if (s > 0.5) S.faceYaw = yawOf(P.vel.x, P.vel.z);
  if (S.loopCam) S.loopHold = 0.55;
}

// ---------- contract actions ----------
function bounce(vy) {
  if (P.dead || !S.built || EX.on) return;
  vy = fin(vy) ? vy : 9;
  const wasHoming = P.homing;
  P.homing = false; S.homingArrived = false; S.homingUsed = false; S.airDashT = 0;
  if (S.mode === 'loop') return;
  if (S.mode === 'ground') {
    if (vy <= 0) return;
    S.mode = 'air'; S.solid = null; P.pos.y += 0.03;
  }
  P.vel.y = vy;
  if (wasHoming) { P.vel.x *= 0.22; P.vel.z *= 0.22; }
  S.jumping = false; S.airKind = 'jump'; P.ball = true; S.springPose = false; S.lock = 0; S.airT = 1; S.rolling = false;
  S.jumpSq = 0.6;
}
// returns true when the hit counted (shield / rings lost, or death)
function hurt(fromPos) {
  if (P.dead || !S.built || P.invT > 0 || P.star > 0) return false;
  const G = K.game;
  if (P.shield) { P.shield = false; sfx('hurt'); }
  else if (G && G.rings > 0) {
    const n = Math.floor(G.rings);
    const E = K.entities;
    if (E && typeof E.scatterRings === 'function') { try { E.scatterRings(center().clone(), n); } catch (e) { /* ignore */ } }
    G.rings = 0;
    sfx('lose');
  } else { kill('hurt'); return true; }
  if (EX.on) { P.invT = 2.2; shake(0.25); return true; } // external mode: the driver applies its own knock-back
  if (S.mode === 'loop') {
    // knocked off the band toward the loop's centre, so the knock-back never carries him through it
    loopAt(S.loop, S.loopTh); P.pos.addScaledVector(LP.up, 0.12);
    S.loop = null; if (S.loopCam) S.loopHold = 0.55;
  }
  let ax = P.pos.x - (fromPos && fin(fromPos.x) ? fromPos.x : P.pos.x - P.forward.x);
  let az = P.pos.z - (fromPos && fin(fromPos.z) ? fromPos.z : P.pos.z - P.forward.z);
  let al = Math.hypot(ax, az);
  if (al < 0.25) { ax = -P.forward.x; az = -P.forward.z; al = Math.hypot(ax, az) || 1; } // hit from above: knock back
  P.vel.set(ax / al * 5, 10, az / al * 5); // short hop back: a hit on a small platform should not always mean the pit
  S.mode = 'air'; S.solid = null; S.hurtState = true; S.airKind = 'hurt'; S.airT = 0;
  P.ball = false; P.homing = false; S.rolling = S.crouch = S.spinning = S.skid = false; S.jumping = false; S.springPose = false; S.lock = 0;
  S.faceYaw = yawOf(-ax, -az);
  P.pos.y += 0.05;
  P.invT = 2.2;
  shake(0.25);
  return true;
}
function kill(reason) {
  if (P.dead || !S.built) return;
  P.dead = true;
  S.mode = 'dead'; S.deathT = 0; S.deathDone = false;
  S.deathKind = reason === 'fall' ? 'fall' : 'pop';
  // the camera keeps looking at the place of death: Kit drops out of the frame, the scene stays in view
  S.deathY = fin(P.pos.y) ? P.pos.y : 0;
  P.shield = false; P.star = 0; P.shoes = 0; P.invT = 0; P.homing = false; P.ball = false;
  S.rolling = S.crouch = S.spinning = S.skid = false; S.hurtState = false; S.springPose = false; S.loop = null; S.jumping = false;
  if (S.deathKind === 'pop') { P.vel.set(0, 13, 0); shake(0.3); }
  else P.vel.set(P.vel.x * 0.2, Math.min(P.vel.y, 0) * 0.3, P.vel.z * 0.2);
}
function deathStep(dt) {
  S.deathT += dt;
  if (S.deathKind === 'pop') {
    if (S.deathT > 0.4) { P.vel.y -= PH.grav * 0.8 * dt; P.pos.addScaledVector(P.vel, dt); }
  } else {
    P.vel.y = Math.max(P.vel.y - PH.grav * dt, -30);
    P.pos.addScaledVector(P.vel, dt);
  }
  if (!finV(P.pos)) P.pos.copy(S.good);
  const wait = S.deathKind === 'fall' ? 1.5 : 2.6;
  if (!S.deathDone && S.deathT >= wait) {
    S.deathDone = true;
    try { if (K.game && typeof K.game.onDeath === 'function') K.game.onDeath(); } catch (e) { console.error(e); }
  }
}
function launch(vel, lock, spring) {
  if (P.dead || !S.built || !finV(vel) || EX.on) return;
  if (S.mode === 'loop') S.loop = null;
  loopCamOff();
  P.vel.copy(vel);
  const l = P.vel.length();
  if (l > 60) P.vel.multiplyScalar(60 / l);
  S.mode = 'air'; S.solid = null; P.pos.y += 0.05;
  S.lock = fin(lock) ? clamp(lock, 0, 3) : 0;
  S.springPose = !!spring;
  if (spring) P.ball = false;
  S.rolling = false; S.crouch = false; S.spinning = false; S.skid = false;
  P.homing = false; S.homingUsed = false; S.jumping = false; S.airDashT = 0; S.hurtState = false;
  S.airKind = spring ? 'spring' : 'jump'; S.airT = 0; S.coyote = 0;
  if (Math.hypot(vel.x, vel.z) > 1) S.faceYaw = yawOf(vel.x, vel.z);
  if (spring && S.t - S.lastSpringT > 0.25) sfx('spring');
  if (spring) S.lastSpringT = S.t;
}
function dash(dir, speed) {
  if (P.dead || !S.built || !dir || S.mode === 'loop' || EX.on) return;
  let dx = +dir.x || 0, dz = +dir.z || 0;
  const l = Math.hypot(dx, dz);
  if (!(l > 1e-6)) return;
  dx /= l; dz /= l;
  let s = fin(speed) ? clamp(speed, 0, PH.max) : 30;
  const yaw = yawOf(dx, dz);
  if (S.mode === 'ground') {
    tangent(yaw, S.n, _a);
    s = Math.max(s, P.vel.dot(_a));
    P.vel.copy(_a).multiplyScalar(Math.min(s, PH.max));
  } else {
    const vy = P.vel.y;
    P.vel.set(dx * s, vy, dz * s);
  }
  S.faceYaw = yaw; S.lock = Math.max(S.lock, 0.3); S.skid = false; S.crouch = false; S.spinning = false;
  S.refYaw = yaw + S.stickA;
  if (S.t - S.lastDashT > 0.3) sfx('dash');
  S.lastDashT = S.t;
}

// ===================== EXTERNAL CONTROL (Act 2: skateboard, flight) =====================
// K.board drives Kit: it moves P.pos / P.vel itself and describes the body with setPose(); this module keeps the
// animation (poses, scarf, blink, eyes, squash), the timers, hurt / invulnerability blink and the death sequence.
const EX = {
  on: false, ground: null, pose: null, grounded: true, yaw: 0, up: new V3(0, 1, 0), poseT: 0,
  lean: 0, crouch: 0, push: 0, spin: 0, flip: 0, salto: 0, tuck: 0, grab: 0, bank: 0, pitch: 0
};
const EXT_PIVOT = 0.55, DECK = 0.163;
function nv(v, lo, hi) { return fin(v) ? clamp(v, lo, hi) : 0; }
function clearExt() { EX.lean = EX.crouch = EX.push = EX.spin = EX.flip = EX.salto = EX.tuck = EX.grab = EX.bank = EX.pitch = 0; }
// on: hand Kit to an external driver. opts.ground(x, z, yTop): the walkable-surface query to use instead of K.world.ground
// (blob shadow, spawn snapping). Off: back to the island controller (and the follow camera).
function setExternal(on, opts) {
  on = !!on;
  if (on) {
    if (!S.built) return;
    buildBoard();
    if (opts && typeof opts.ground === 'function') EX.ground = opts.ground;
    if (EX.on) return;
    EX.on = true; P.external = true;
    if (S.mode === 'loop') S.loop = null;
    loopCamOff();
    if (!P.dead) S.mode = 'ground';
    S.rolling = S.crouch = S.spinning = S.skid = false; S.rev = 0; S.hurtState = false; S.springPose = false; S.jumping = false;
    S.lock = 0; S.airDashT = 0; S.solid = null; P.homing = false; P.ball = false;
    EX.yaw = S.faceYaw; EX.up.set(0, 1, 0); EX.grounded = true; EX.pose = null; P.pose = null; EX.poseT = 0;
    clearExt();
  } else {
    if (!EX.on) return;
    EX.on = false; P.external = false; EX.ground = null; EX.pose = null; P.pose = null;
    clearExt();
    if (R.board) R.board.visible = false;
    if (R.rig) R.rig.position.z = 0;
    if (!P.dead) { S.mode = EX.grounded ? 'ground' : 'air'; S.airKind = 'fall'; S.airT = 0; S.coyote = 0; S.n.set(0, 1, 0); }
    if (K.camera && K.camera.mode === 'external') camMode('follow', { yaw: S.faceYaw });
  }
}
// name: 'skate' {lean, crouch, push} | 'skateAir' {spin, flip, salto, tuck, grab} | 'wipeout' {spin} |
// 'flight' {bank, pitch} | 'land' | null (plain animation from the speed). Every call may also give
// yaw (heading, 0 = facing -Z), up (surface normal while grounded), ground (bool) and impact (0..1 landing squash).
// Missing numeric fields mean 0; the object is read, never kept.
function setPose(name, p) {
  if (name !== 'skate' && name !== 'skateAir' && name !== 'wipeout' && name !== 'flight' && name !== 'land') name = null;
  if (name !== EX.pose) EX.poseT = 0;
  EX.pose = name; P.pose = name;
  clearExt();
  if (!p || typeof p !== 'object') return;
  if (fin(p.yaw)) EX.yaw = p.yaw;
  if (p.up && finV(p.up) && p.up.lengthSq() > 1e-8) { EX.up.copy(p.up).normalize(); if (EX.up.y < 0.05) EX.up.set(0, 1, 0); }
  if (typeof p.ground === 'boolean') EX.grounded = p.ground;
  EX.lean = nv(p.lean, -1, 1); EX.crouch = nv(p.crouch, 0, 1); EX.push = nv(p.push, 0, 1);
  EX.spin = nv(p.spin, -40, 40); EX.flip = nv(p.flip, -40, 40); EX.salto = nv(p.salto, -40, 40);
  EX.tuck = nv(p.tuck, 0, 1); EX.grab = nv(p.grab, 0, 1);
  EX.bank = nv(p.bank, -1.5, 1.5); EX.pitch = nv(p.pitch, -1.4, 1.4);
  if (fin(p.impact) && p.impact > 0) S.landSq = Math.max(S.landSq, clamp(p.impact, 0, 1));
}
function extStep(dt) {
  S.prev.copy(P.pos);
  EX.poseT += dt;
  S.faceYaw = EX.yaw;
  if (EX.grounded) { S.mode = 'ground'; S.n.copy(EX.up); S.airT = 0; }
  else { S.mode = 'air'; S.airT += dt; S.airKind = 'fall'; }
  S.rolling = S.crouch = S.spinning = S.skid = false; S.hurtState = false; S.springPose = false;
  P.ball = false; P.homing = false;
}
// extra body rotations of the external poses (trick spins, backflips, flight pitch / bank), about the body centre
const _ee = new THREE.Euler(0, 0, 0, 'YXZ'), _qe = new THREE.Quaternion(), _pa = new V3(), _pb = new V3();
function extOrient(st) {
  let yaw = 0, pitch = 0, roll = 0, c = EXT_PIVOT;
  if (st === 'skateAir') { yaw = EX.spin; pitch = -EX.salto; c = 0.45; }
  else if (st === 'flight') { pitch = -EX.pitch; roll = EX.bank; }
  else if (st === 'skate') { roll = EX.lean * 0.1; c = 0; }
  else if (st === 'wipeout') yaw = EX.spin;
  if (yaw === 0 && pitch === 0 && roll === 0) return;
  _pa.set(0, c, 0).applyQuaternion(_q);
  _ee.set(pitch, yaw, roll, 'YXZ');
  _qe.setFromEuler(_ee);
  _q.multiply(_qe);
  _pb.set(0, c, 0).applyQuaternion(_q);
  R.root.position.add(_pa).sub(_pb);
}
function extRigY(st) {
  if (st === 'flight') return Q.rigY * 0.85;
  if (st === 'wipeout') return lerp(Q.rigY, 0.05, 0.2);
  return Q.rigY; // skate / skateAir / land: boardPose plants the feet after applyPose
}
// sole height of a leg in the root frame (from the current local matrices of the rig chain)
const _lm = new THREE.Matrix4(), _lv = new V3();
function soleY(leg) {
  R.rig.updateMatrix(); R.hips.updateMatrix(); leg.lg.updateMatrix(); leg.kn.updateMatrix(); leg.an.updateMatrix();
  _lm.copy(R.rig.matrix).multiply(R.hips.matrix).multiply(leg.lg.matrix).multiply(leg.kn.matrix).multiply(leg.an.matrix);
  _lv.set(0, -0.13, 0.07).applyMatrix4(_lm);
  return _lv.y;
}
function boardPose(st, dt) {
  const B = R.board;
  const on = EX.on && !P.dead && (st === 'skate' || st === 'skateAir' || st === 'wipeout');
  B.visible = on && R.root.visible;
  if (st === 'land' && EX.on && !P.dead) {
    const lo = soleY(R.legs[0]);
    R.rig.position.y -= lo; Q.rigY = R.rig.position.y;
  }
  if (!on) return;
  if (st === 'wipeout') {
    // the board shoots on down the street and tumbles while Kit is knocked back
    const tt = Math.min(EX.poseT, 1.2);
    B.position.set(0.3 * tt, Math.max(0.05, 0.2 + 4.2 * tt - 8 * tt * tt), 6.5 * tt);
    B.rotation.set(tt * 11, tt * 4, tt * 8);
    R.flip.rotation.z = 0;
    return;
  }
  const lift = st === 'skateAir' ? EX.tuck * 0.2 : 0;
  B.position.set(0, lift, 0);
  B.rotation.set(0, 0, 0);
  R.flip.rotation.z = st === 'skateAir' ? EX.flip : 0;
  if (Math.abs(Q.rigX) < 0.05) {
    const front = soleY(R.legs[0]), back = soleY(R.legs[1]);
    const lo = st === 'skate' && EX.push > 0.4 ? front : Math.min(front, back);
    R.rig.position.y += DECK + lift - lo;
    Q.rigY = R.rig.position.y;
  }
  void dt;
}

// ---------- poses ----------
function poseSkate(t) {
  base();
  const c = EX.crouch, l = EX.lean, pu = EX.push;
  const sway = Math.sin(t * 1.9) * 0.05;
  // sideways stance, left foot at the nose: hips across the deck, chest and eyes turned down the street
  T.hipsY = -1.15 + pu * 0.7;
  T.torX = 0.14 + c * 0.42 + l * 0.2; T.torY = 0.45 - pu * 0.3; T.torZ = sway * 0.5;
  T.hedX = -T.torX * 0.85 - 0.04; T.hedY = 0.6 - pu * 0.38; T.hedZ = -l * 0.08;
  T.lgLZ = 0.4; T.lgRZ = 0.42;
  T.lgLX = -0.3 - c * 0.55; T.knL = 0.6 + c * 1.0; T.anL = -(T.lgLX + T.knL) * 0.95;
  T.lgRX = -0.28 - c * 0.55; T.knR = 0.58 + c * 1.0; T.anR = -(T.lgRX + T.knR) * 0.95;
  // arms out for balance, lower when tucked
  T.shLZ = 1.05 - c * 0.5 + sway; T.shRZ = 1.0 - c * 0.5 - sway;
  T.shLX = -0.3 - c * 0.35 - l * 0.15; T.shRX = 0.25 - c * 0.2 + l * 0.15; T.elL = 0.45 + c * 0.6; T.elR = 0.5 + c * 0.6;
  const k = smooth(P.speed / 30);
  T.t0X = lerp(0.45, -0.12, k); T.t1X = lerp(-0.1, 0.02, k); T.t2X = lerp(-0.2, 0.02, k);
  wag(t, 4 + 9 * k, 0.12, 0.16, 0.2);
  T.earLX = T.earRX = lerp(-0.2, -0.75, k);
  if (pu > 0) {
    // kick-push: the back foot leaves the deck and strokes the street
    const ph = S.t * 7.2, s = Math.sin(ph);
    T.lgRZ = lerp(T.lgRZ, 0.06, pu); T.lgRX = lerp(T.lgRX, -0.05 + s * 0.6, pu);
    T.knR = lerp(T.knR, 0.25 + Math.max(0, -Math.cos(ph)) * 0.9, pu); T.anR = lerp(T.anR, 0.15, pu);
  }
  V.plant = false;
}
function poseSkateAir(t) {
  base();
  const k = EX.tuck, gr = EX.grab;
  T.hipsY = -1.15;
  T.torX = 0.3 + k * 0.3 + gr * 0.35; T.torY = 0.42; T.hedX = -0.36 - k * 0.2 - gr * 0.2; T.hedY = 0.6;
  T.lgLZ = 0.36; T.lgRZ = 0.38;
  T.lgLX = -0.5 - k * 0.7; T.knL = 0.95 + k * 0.95; T.anL = -(T.lgLX + T.knL) * 0.9;
  T.lgRX = -0.45 - k * 0.7; T.knR = 0.95 + k * 0.95; T.anR = -(T.lgRX + T.knR) * 0.9;
  T.shLZ = 1.25; T.shRZ = 1.2; T.shLX = -0.5; T.shRX = 0.35; T.elL = 0.6; T.elR = 0.55;
  if (gr > 0) { T.shRX = lerp(T.shRX, -0.25, gr); T.shRZ = lerp(T.shRZ, 0.35, gr); T.elR = lerp(T.elR, 0.15, gr); }
  T.t0X = -0.1; T.t1X = 0.1; wag(t, 9, 0.15, 0.2, 0.25);
  T.earLX = T.earRX = -0.45;
  V.plant = false;
}
function poseWipeout(t) {
  poseHurt(t);
  const f = Math.sin(t * 21);
  T.shLX = 0.6 + f * 0.7; T.shRX = 0.6 - f * 0.7; T.lgLX = -0.7 + f * 0.45; T.lgRX = 0.25 - f * 0.45;
  T.rigX = -Math.min(EX.poseT, 0.5) * 1.6;
}
function poseFlight(t) {
  base();
  const b = EX.bank, pt = EX.pitch, f = Math.sin(t * 12);
  T.rigX = 1.36;
  T.hipsX = 0.04; T.torX = -0.1; T.torY = b * 0.15; T.hedX = -1.12 - pt * 0.15; T.hedY = -b * 0.22;
  // fist forward, the other arm reaching too: the flying-hero line
  T.shRX = -2.95; T.shRZ = 0.14 - b * 0.12; T.elR = 0.05;
  T.shLX = -2.7 + f * 0.03; T.shLZ = 0.34 + b * 0.12; T.elL = 0.25;
  T.lgLX = 0.1; T.lgRX = 0.26; T.lgLZ = T.lgRZ = 0.03; T.knL = 0.2; T.knR = 0.55; T.anL = 0.9; T.anR = 0.75;
  T.t0X = -1.25; T.t1X = 0.04; T.t2X = 0.04;
  T.t0Y = f * 0.1; T.t1Y = Math.sin(t * 12 - 0.8) * 0.18; T.t2Y = Math.sin(t * 12 - 1.6) * 0.24;
  T.earLX = T.earRX = -0.85;
  V.plant = false;
}
function poseLand(t) {
  base();
  // the hero landing: deep forward lean, front foot planted, back knee down, a fist on the ground, the other arm flung back
  T.hipsX = 0.38; T.torX = 0.72; T.torY = 0.12; T.hedX = -1.05; T.hedY = 0.1;
  T.lgLX = -1.55; T.knL = 2.05; T.anL = -0.4; T.lgLZ = 0.16;
  T.lgRX = 0.32; T.knR = 2.35; T.anR = 0.7; T.lgRZ = 0.14;
  T.shRX = -0.35; T.shRZ = 0.32; T.elR = 0.1;
  T.shLX = 1.25; T.shLZ = 1.05; T.elL = 0.25;
  T.t0X = 1.0; T.t1X = 0.15; wag(t, 3, 0.2, 0.25, 0.3);
  T.earLX = T.earRX = -0.35;
  V.plant = false;
}

// ---------- skateboard (built on first use: deck with grip tape, orange / teal livery, trucks, glowing wheels) ----------
function boardTex() {
  return canvasTex(128, 512, (g, w, h) => {
    const hh = h / 2;
    // bottom half (v 0..0.5): livery
    let gr = g.createLinearGradient(0, hh, 0, h);
    gr.addColorStop(0, '#ff9a3a'); gr.addColorStop(0.5, '#f47a1f'); gr.addColorStop(1, '#e8600f');
    g.fillStyle = gr; g.fillRect(0, hh, w, hh);
    g.fillStyle = '#17b6c3';
    for (let i = 0; i < 4; i++) { const y = hh + 40 + i * 14; g.beginPath(); g.moveTo(8, y); g.lineTo(w / 2, y + 18); g.lineTo(w - 8, y); g.lineTo(w - 8, y + 7); g.lineTo(w / 2, y + 25); g.lineTo(8, y + 7); g.closePath(); g.fill(); }
    for (let i = 0; i < 4; i++) { const y = h - 66 - i * 14; g.beginPath(); g.moveTo(8, y); g.lineTo(w / 2, y - 18); g.lineTo(w - 8, y); g.lineTo(w - 8, y - 7); g.lineTo(w / 2, y - 25); g.lineTo(8, y - 7); g.closePath(); g.fill(); }
    // centre emblem: a white star in a navy ring
    const cx = w / 2, cy = hh + hh / 2;
    g.fillStyle = '#121845'; g.beginPath(); g.arc(cx, cy, 34, 0, TAU); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 11 : 26; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    g.closePath(); g.fill();
    g.strokeStyle = '#ffd23f'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, 30, 0, TAU); g.stroke();
    // top half (v 0.5..1 in uv = canvas 0..hh): grip tape
    g.fillStyle = '#2a2d34'; g.fillRect(0, 0, w, hh);
    for (let i = 0; i < 900; i++) {
      const x = hash(i * 1.37) * w, y = hash(i * 2.91 + 4) * hh, l = hash(i * 0.73 + 9);
      g.fillStyle = l > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.25)'; g.fillRect(x, y, 1.5, 1.5);
    }
    g.fillStyle = '#f47a1f'; g.fillRect(10, 26, w - 20, 4); g.fillRect(10, hh - 30, w - 20, 4);
    g.fillStyle = '#17b6c3'; g.fillRect(10, 34, w - 20, 2); g.fillRect(10, hh - 36, w - 20, 2);
    // maple ply edge band (left strip, both halves)
    g.fillStyle = '#e9c98f'; g.fillRect(0, 0, 4, h);
    g.fillStyle = '#b8864a'; g.fillRect(1, 0, 1, h);
  });
}
function deckGeometry() {
  const L = 0.86, W = 0.125, TH = 0.024, NZ = 30, NX = 9, Y0 = 0.135;
  const pos = [], uv = [], idx = [];
  const yb = z => { const u = Math.max(0, Math.abs(z) - 0.25); return Y0 + 1.6 * u * u + u * 0.08; };
  const hw = z => { const e = Math.abs(z) - (L / 2 - W); return e <= 0 ? W : Math.sqrt(Math.max(0, W * W - e * e)) * 0.98 + 0.002; };
  const conc = x => 0.006 * x * x;
  // top (grip) and bottom (livery) grids
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < NZ; i++) {
      const z = -L / 2 + (L * i) / (NZ - 1), h = hw(z), y = yb(z) + (side ? 0 : TH);
      for (let j = 0; j < NX; j++) {
        const xr = -1 + (2 * j) / (NX - 1);
        pos.push(xr * h, y + conc(xr), z);
        uv.push(0.06 + 0.92 * (j / (NX - 1)), side ? 0.5 * (i / (NZ - 1)) : 0.5 + 0.5 * (i / (NZ - 1)));
      }
    }
  }
  const top = 0, bot = NZ * NX;
  for (let i = 0; i < NZ - 1; i++) {
    for (let j = 0; j < NX - 1; j++) {
      const a = top + i * NX + j, b = a + 1, c = a + NX, d = c + 1;
      idx.push(a, c, b, b, c, d);
      const a2 = bot + i * NX + j, b2 = a2 + 1, c2 = a2 + NX, d2 = c2 + 1;
      idx.push(a2, b2, c2, b2, d2, c2);
    }
  }
  // side walls (own vertices so the ply edge maps to the wood strip)
  const s0 = pos.length / 3;
  for (let i = 0; i < NZ; i++) {
    for (const j of [0, NX - 1]) {
      const t = top + i * NX + j, b = bot + i * NX + j;
      pos.push(pos[t * 3], pos[t * 3 + 1], pos[t * 3 + 2]); uv.push(0.012, i / (NZ - 1));
      pos.push(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]); uv.push(0.012, i / (NZ - 1));
    }
  }
  for (let i = 0; i < NZ - 1; i++) {
    for (let k = 0; k < 2; k++) {
      const a = s0 + (i * 2 + k) * 2, c = s0 + ((i + 1) * 2 + k) * 2;
      if (k === 0) idx.push(a, a + 1, c, c, a + 1, c + 1); else idx.push(a, c, a + 1, c, c + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  const n = pos.length / 3;
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.setAttribute('rough', new THREE.Float32BufferAttribute(new Float32Array(n).fill(0.62), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
function buildBoard() {
  if (R.board || !R.root) return;
  prims();
  const B = R.board = new THREE.Group();
  B.name = 'kit-board';
  const F = R.flip = group(B, 0, 0.12, 0);
  const deck = meshIn(F, deckGeometry(), kitMaterial(false, boardTex()));
  deck.position.y = -0.12;
  const silver = lin('#c3c9d3'), dark = lin('#5b616b');
  const tb = new GB();
  for (const z of [-0.27, 0.27]) {
    tb.add(GEO.box, TRS(0, 0.126, z, 0, 0, 0, 0.07, 0.014, 0.1), dark, 0.4);
    tb.add(GEO.box, TRS(0, 0.104, z + (z > 0 ? -0.012 : 0.012), z > 0 ? 0.5 : -0.5, 0, 0, 0.04, 0.04, 0.05), silver, 0.3);
    tb.add(GEO.sph, TRS(0, 0.084, z, 0, 0, 0, 0.022, 0.026, 0.022), lin('#e8eaf0'), 0.6);
    tb.add(limb(0.017, 0.017, 0.2), TRS(0.1, 0.062, z, 0, 0, Math.PI / 2), silver, 0.3);
    tb.add(limb(0.006, 0.006, 0.26), TRS(0.13, 0.054, z, 0, 0, Math.PI / 2), silver, 0.25);
  }
  const trucks = meshIn(F, tb.build(), kitMaterial(false));
  trucks.position.y = -0.12;
  const wg = new GB(), wh = new THREE.CylinderGeometry(0.052, 0.052, 0.044, 18, 1);
  for (const z of [-0.27, 0.27]) for (const x of [-0.11, 0.11]) wg.add(wh, TRS(x, 0.054, z, 0, 0, Math.PI / 2), COL.white, 0.4);
  R.wheelMat = new THREE.MeshStandardMaterial({ color: lin('#7ff6ff'), emissive: lin('#17d2e0'), emissiveIntensity: 1.6, roughness: 0.35, metalness: 0 });
  const wm = meshIn(F, wg.build(), R.wheelMat);
  wm.position.y = -0.12;
  B.visible = false;
  R.root.add(B);
}

// ===================== presentation =====================
const _up = new V3(), _fwd = new V3(), _xa = new V3();
function visualState() {
  if (P.dead) return 'dead';
  if (EX.on && EX.pose) return EX.pose;
  const gs = gameState();
  const grounded = S.mode === 'ground' || S.mode === 'loop';
  if ((gs === 'results' || gs === 'end') && S.mode === 'ground' && P.speed < 0.6 && !S.spinning) return 'victory';
  if (S.spinning) return 'spindash';
  if (P.ball) return 'ball';
  if (grounded) {
    if (S.crouch) return 'crouch';
    if (S.skid) return 'skid';
    if (P.speed < 0.3) return 'idle';
    if (P.speed < 7) return 'walk';
    if (P.speed < 17) return 'run';
    return 'peel';
  }
  if (S.hurtState) return 'hurt';
  if (S.springPose) return 'spring';
  // a short hop off a crest keeps the running pose instead of flickering into the fall pose
  if (S.airKind === 'fall' && S.airT < 0.35 && P.speed > 8) return P.speed < 17 ? 'run' : 'peel';
  return 'fall';
}

function finishFrame(dt) {
  if (!S.built) return;
  const v = P.vel;
  const grounded = S.mode === 'ground' || S.mode === 'loop';
  P.onGround = grounded && !P.dead;
  P.inLoop = S.mode === 'loop';
  P.rolling = S.rolling; P.spinDash = S.spinning; P.crouch = S.crouch;
  P.speed = grounded ? v.length() : Math.hypot(v.x, v.z);
  P.forward.set(dirX(S.faceYaw), 0, dirZ(S.faceYaw));

  const st = visualState();
  if (st !== V.state) { if (st === 'victory') S.vt = 0; V.state = st; }
  P.state = st;
  const t = S.t;
  if (st === 'idle') S.idleT += dt; else S.idleT = 0;
  if (st === 'victory') S.vt += dt;

  // facing / orientation
  let face = S.faceYaw;
  if (st === 'victory') {
    const cam = K.view && K.view.camera;
    if (cam) { const dx = cam.position.x - P.pos.x, dz = cam.position.z - P.pos.z; if (dx * dx + dz * dz > 0.01) face = yawOf(dx, dz); }
  }
  const turnK = st === 'victory' ? 6 : EX.on && EX.pose ? 40 : grounded && P.speed > 12 ? 30 : 20;
  const dy = angDiff(V.mYaw, face);
  V.mYaw += dy * (dt > 0 ? dk(turnK, dt) : 1);
  const tr = dt > 0 ? angDiff(S.lastFace, V.mYaw) / dt : 0;
  S.lastFace = V.mYaw;
  S.turnRate = lerp(S.turnRate, clamp(tr, -8, 8), dt > 0 ? dk(10, dt) : 1);
  if (S.mode === 'loop') _up.copy(S.loopUp);
  else if (S.mode === 'ground') _up.copy(S.n);
  else _up.set(0, 1, 0);
  if (P.dead) _up.set(0, 1, 0);
  if (S.offLoop > 0) S.offLoop -= dt;
  V.mUp.lerp(_up, dt > 0 ? dk(S.mode === 'loop' ? 40 : S.offLoop > 0 ? 6 : 14, dt) : 1);
  if (V.mUp.lengthSq() < 1e-6) V.mUp.set(0, 1, 0);
  V.mUp.normalize();
  P.up.copy(V.mUp);
  if (S.mode === 'loop') _fwd.copy(S.loopFwd);
  else _fwd.set(dirX(V.mYaw), 0, dirZ(V.mYaw));
  _fwd.addScaledVector(V.mUp, -_fwd.dot(V.mUp));
  if (_fwd.lengthSq() < 1e-6) _fwd.set(dirX(V.mYaw), 0, dirZ(V.mYaw)).addScaledVector(V.mUp, -0.5).normalize();
  _fwd.normalize();
  _xa.crossVectors(V.mUp, _fwd).normalize();
  _m.makeBasis(_xa, V.mUp, _fwd);
  _q.setFromRotationMatrix(_m);
  const root = R.root;
  root.position.copy(P.pos);
  if (EX.on && !P.dead) extOrient(st);
  root.quaternion.copy(_q);

  // phase for gait cycles
  const sp = P.speed;
  if (grounded) {
    const cyc = lerp(1.15, 2.7, smooth(sp / 17));
    S.ph = (S.ph || 0) + (dt * sp / cyc) * TAU;
    if (S.ph > 1e4) S.ph -= TAU * 1000;
  }

  // pose targets
  let blend = 16;
  switch (st) {
    case 'idle': poseIdle(t); break;
    case 'walk': poseWalk(sp, t); blend = 22; break;
    case 'run': poseRun(sp, false); blend = 24; break;
    case 'peel': poseRun(sp, true); blend = 60; break;
    case 'skid': poseSkid(); blend = 20; break;
    case 'crouch': poseCrouch(t); blend = 22; break;
    case 'spring': poseSpring(t); blend = 14; break;
    case 'fall': poseFall(t); blend = 10; break;
    case 'hurt': poseHurt(t); blend = 18; break;
    case 'dead': poseDead(t); blend = 12; break;
    case 'victory': poseVictory(t, S.vt); blend = 14; break;
    case 'skate': poseSkate(t); blend = 18; break;
    case 'skateAir': poseSkateAir(t); blend = 22; break;
    case 'wipeout': poseWipeout(t); blend = 16; break;
    case 'flight': poseFlight(t); blend = 7; break;
    case 'land': poseLand(t); blend = 26; break;
    default: poseIdle(t); break;
  }
  const bk = dt > 0 ? dk(blend, dt) : 1;
  for (let i = 0; i < KEYS.length; i++) { const k = KEYS[i]; Q[k] += (T[k] - Q[k]) * bk; }
  if (!fin(Q.rigY + Q.hipsX + Q.lgLX + Q.lgRX + Q.knL + Q.knR + Q.shLX + Q.shRX + Q.t0Y + Q.hedY)) { for (const k of KEYS) Q[k] = fin(T[k]) ? T[k] : 0; }
  // bank into turns at speed, lean on slopes is handled by the ground normal
  const extPose = EX.on && !!EX.pose && !P.dead;
  const bank = extPose ? (st === 'skate' ? clamp(EX.lean, -1, 1) * 0.3 : 0) : grounded && !P.ball ? clamp(-S.turnRate * sp * 0.012, -0.35, 0.35) : 0;
  Q.rigZ = lerp(Q.rigZ, bank, dt > 0 ? dk(8, dt) : 1);
  // keep the stance foot on the ground
  if (extPose) Q.rigY = extRigY(st);
  else if (V.plant && grounded) {
    const hx = Q.hipsX;
    const eL = 0.175 * Math.cos(hx + Q.lgLX) + 0.175 * Math.cos(hx + Q.lgLX + Q.knL);
    const eR = 0.175 * Math.cos(hx + Q.lgRX) + 0.175 * Math.cos(hx + Q.lgRX + Q.knR);
    Q.rigY = Math.max(eL, eR) - 0.35 + V.bob;
  } else Q.rigY = lerp(Q.rigY, st === 'spring' ? 0.05 : 0, dt > 0 ? dk(10, dt) : 1);
  if (st === 'dead') {
    Q.rigX = S.deathKind === 'pop' ? -Math.min(S.deathT, 2.6) * 1.2 : 0;
  } else if (!extPose) Q.rigX = 0;
  applyPose();
  if (R.board) boardPose(st, dt);
  R.wheel.visible = R.drum.visible = st === 'peel';
  if (R.wheel.visible) {
    R.wheelTex.rotation = (R.wheelTex.rotation - dt * sp * 1.4) % TAU;
    R.drumTex.offset.x = (R.drumTex.offset.x + dt * sp * 0.22) % 1;
    const op = 0.45 + 0.25 * smooth((sp - 17) / 15);
    R.wheel.material.opacity = op; R.drum.material.opacity = op;
  }

  // squash & stretch
  S.landSq = Math.max(0, S.landSq - dt * 5);
  S.jumpSq = Math.max(0, S.jumpSq - dt * 4);
  S.revPulse = Math.max(0, S.revPulse - dt * 6);
  const sq = Math.sin(Math.min(1, 1 - S.landSq) * Math.PI) * S.landSq * 0.9;
  const sy = 1 - sq * 0.22 + S.jumpSq * 0.12, sxz = 1 + sq * 0.14 - S.jumpSq * 0.06;
  root.scale.set(sxz, sy, sxz);

  // ball
  const ballOn = st === 'ball' || st === 'spindash';
  R.ballG.visible = ballOn;
  R.rig.visible = !ballOn;
  if (ballOn) {
    let w;
    if (st === 'spindash') w = 32 + S.rev * 7;
    else if (grounded) w = sp / 0.5;
    else w = P.homing ? 30 : 20 + sp * 0.4;
    V.ballSpin += w * dt;
    if (V.ballSpin > TAU * 1000) V.ballSpin -= TAU * 1000;
    R.ballSpin.rotation.set(V.ballSpin, 0, 0);
    const pulse = st === 'spindash' ? 1 + S.revPulse * 0.12 + Math.sin(t * 50) * 0.02 : 1;
    R.ballG.position.set(st === 'spindash' ? Math.sin(t * 61) * 0.03 : 0, 0.5 * pulse, 0);
    R.ballG.scale.set(pulse, pulse * (st === 'spindash' ? 0.92 : 1), pulse);
    const blur = st === 'spindash' ? 0.55 + S.rev * 0.08 : smooth((w - 14) / 30) * 0.85;
    R.shellMat.opacity = clamp(blur, 0, 0.95);
    R.shell.visible = R.shellMat.opacity > 0.02;
    R.shellTex.offset.x = (R.shellTex.offset.x + dt * w * 0.03) % 1;
  }

  // eyes
  updateEyes(dt, st);

  root.updateMatrixWorld(true);
  scarfStep(dt > 0 ? dt : STEP, !ballOn && root.visible);

  // invulnerability blink
  const blinkOff = P.invT > 0 && P.star <= 0 && !P.dead && (S.frame >> 2) % 2 === 1;
  root.visible = !blinkOff;
  if (SC.mesh) SC.mesh.visible = SC.mesh.visible && !blinkOff;

  updateBlob();
  updatePowerFx(dt, ballOn);
}

function updateEyes(dt, st) {
  V.blink -= dt;
  if (V.blink <= 0) { V.blinkT = 0.13; V.blink = 2.2 + hash(S.t * 3.7) * 3.2; }
  if (V.blinkT > 0) V.blinkT -= dt;
  let mode = 'open';
  if (st === 'dead') mode = 'x';
  else if (st === 'hurt' || st === 'wipeout') mode = 'shut';
  for (let i = 0; i < 2; i++) {
    const e = R.eyes[i];
    let m = mode;
    if (st === 'victory' && i === 1 && S.vt > 0.4) m = 'shut';
    e.open.visible = m === 'open';
    e.shut.visible = m === 'shut';
    e.x.visible = m === 'x';
    const b = V.blinkT > 0 ? Math.max(0.08, Math.abs(V.blinkT - 0.065) / 0.065) : 1;
    e.open.scale.set(1, m === 'open' ? b : 1, 1);
  }
}

function updateBlob() {
  const b = FX.blob;
  if (P.dead || !R.root.visible) { b.visible = false; return; }
  if (S.mode === 'loop') {
    b.visible = true;
    b.position.copy(P.pos).addScaledVector(S.loopUp, 0.03);
    b.quaternion.setFromUnitVectors(UP, S.loopUp);
    b.scale.setScalar(1);
    b.material.opacity = blobAlpha(0.42);
    return;
  }
  const g = ground(P.pos.x, P.pos.z, P.pos.y + 0.3);
  if (!g) { b.visible = false; return; }
  const h = Math.max(0, P.pos.y - g.y);
  const k = smooth(h / 9);
  if (k >= 0.99) { b.visible = false; return; }
  b.visible = true;
  b.position.set(P.pos.x, g.y + 0.04, P.pos.z);
  b.quaternion.setFromUnitVectors(UP, g.n);
  b.scale.setScalar((P.ball ? 0.95 : 1) * (1 - 0.45 * k));
  b.material.opacity = blobAlpha(0.42 * (1 - k));
}
// the blob darkens by (1 - a): blended in sRGB on the direct path, in linear light through the HDR pipeline, where the
// same look needs 1 - (1 - a)^2.2
function blobAlpha(a) {
  const Q = K.post;
  return Q && Q.ok && Q.uHDR && Q.uHDR.value > 0 ? 1 - Math.pow(1 - a, 2.2) : a;
}

function updatePowerFx(dt, ballOn) {
  const t = S.t;
  const c = center();
  // shield
  const sh = FX.shield;
  sh.visible = !!P.shield && !P.dead;
  if (sh.visible) {
    sh.position.copy(c);
    const s = 1 + Math.sin(t * 6) * 0.025;
    sh.scale.set(s, s * (1 + Math.sin(t * 6 + 1.5) * 0.02), s);
    FX.shieldU.uT.value = t % 1000;
    FX.shieldU.uA.value = R.root.visible ? 1 : 0.5;
  }
  // invincibility sparkles
  const on = P.star > 0 && !P.dead;
  FX.spark.visible = on;
  FX.trailI = (FX.trailI + 1) % FX.trail.length;
  FX.trail[FX.trailI].copy(c);
  if (on) {
    const pa = FX.sparkPos.array, ca = FX.sparkCol.array;
    const n = FX.sparkN, fade = P.star < 2 ? (Math.floor(t * 10) % 2 ? 0.3 : 1) : 1;
    for (let i = 0; i < n; i++) {
      let x, y, z;
      if (i < 12) {
        const a = t * (i % 2 ? 6.5 : -5.2) + i * TAU / 12, r = 0.7 + Math.sin(t * 3 + i) * 0.12;
        x = c.x + Math.cos(a) * r; z = c.z + Math.sin(a) * r; y = c.y + Math.sin(t * 4 + i * 1.3) * 0.55;
      } else {
        const back = 3 + (i - 12) * 2;
        const p = FX.trail[(FX.trailI - back + FX.trail.length * 4) % FX.trail.length];
        const j = (i * 7.31 + Math.floor(t * 12)) * 1.7;
        x = p.x + (hash(j) - 0.5) * 0.9; y = p.y + (hash(j + 1) - 0.5) * 0.9; z = p.z + (hash(j + 2) - 0.5) * 0.9;
      }
      pa[i * 3] = x; pa[i * 3 + 1] = y; pa[i * 3 + 2] = z;
      const col = FX.sparkCols[i % FX.sparkCols.length];
      const tw = (0.35 + 0.65 * Math.max(0, Math.sin(t * 19 + i * 2.1))) * fade * (i < 12 ? 1 : 1 - (i - 12) / 16);
      ca[i * 3] = col.r * tw; ca[i * 3 + 1] = col.g * tw; ca[i * 3 + 2] = col.b * tw;
    }
    FX.sparkPos.needsUpdate = true;
    FX.sparkCol.needsUpdate = true;
  }
  // speed-shoes afterimages
  const snaps = FX.snaps;
  if (dt > 0) {
    if (S.frame % 2 === 0) {
      FX.snapI = (FX.snapI + 1) % snaps.length;
      const s = snaps[FX.snapI];
      s.on = P.shoes > 0 && !P.dead && P.speed > 6 && R.root.visible;
      s.pos.copy(R.root.position); s.q.copy(R.root.quaternion); s.ball = ballOn;
    }
  }
  for (let i = 0; i < FX.ghosts.length; i++) {
    const gm = FX.ghosts[i];
    const s = snaps[(FX.snapI - (i + 1) * 2 + snaps.length * 4) % snaps.length];
    if (!s.on || P.shoes <= 0 || P.dead) { gm.visible = false; continue; }
    gm.visible = true;
    gm.geometry = FX.ghostGeo[s.ball ? 1 : 0];
    gm.position.copy(s.pos); gm.quaternion.copy(s.q);
    gm.material.opacity = 0.34 * (1 - i / FX.ghosts.length) * (P.shoes < 2 ? 0.5 : 1);
  }
}

// ===================== CAMERA =====================
const CAM = {
  mode: 'follow', t: 0, yaw: 0, pitch: 0.204, manualT: 9, blend: 1, snap: true,
  pivot: new V3(), pos: new V3(0, 5, 8), look: new V3(), want: new V3(), wantLook: new V3(), ahead: new V3(),
  occl: 1, fov: 62, shake: 0, viewYaw: 0, lift: 0,
  loop: null, loopSide: -1, bossC: new V3(), bossR: 26, bossYaw: 0, bossOff: 0, bossYawOk: false, titleA: 0,
  holdPos: new V3()
};
const PITCH0 = Math.atan2(1.55, 7.5), CAMD = Math.hypot(7.5, 1.55);
const _cv = new V3(), _cw = new V3(), _ct = new V3();

function camInit() {
  const cam = K.view && K.view.camera;
  if (cam) { cam.fov = 62; cam.updateProjectionMatrix(); CAM.fov = 62; }
  CAM.mode = 'follow'; CAM.snap = true; CAM.shake = 0; CAM.occl = 1; CAM.pitch = PITCH0; CAM.manualT = 9; CAM.blend = 1;
}
function camSetMode(mode, opts) {
  opts = opts && typeof opts === 'object' ? opts : {};
  const prev = CAM.mode;
  if (mode !== 'follow' && mode !== 'loop' && mode !== 'boss' && mode !== 'title' && mode !== 'external') mode = 'follow';
  CAM.mode = mode;
  if (fin(opts.yaw)) CAM.yaw = opts.yaw;
  if (mode === 'follow') {
    if (opts.snap) { CAM.snap = true; CAM.pitch = PITCH0; CAM.manualT = 9; CAM.occl = 1; CAM.lift = 0; CAM.ahead.set(0, 0, 0); if (fin(opts.yaw)) CAM.viewYaw = opts.yaw; }
    else if (prev !== 'follow') CAM.blend = 0;
    if (prev === 'loop' || prev === 'boss' || prev === 'title') {
      if (!fin(opts.yaw)) CAM.yaw = CAM.viewYaw;
      CAM.pitch = PITCH0; CAM.manualT = 2;
    }
  } else if (mode === 'loop') {
    const lp = opts.loop;
    if (lp && finV(lp.entry) && finV(lp.dir) && finV(lp.side)) {
      CAM.loop = lp;
      // side view from whichever side has more room
      let best = -1, bestH = Infinity;
      for (const sd of [-1, 1]) {
        loopCamPos(lp, sd, _cw);
        let h = -1e9;
        for (let i = 0; i <= 4; i++) { const k = i / 4; h = Math.max(h, terrainY(lerp(_cv.x, _cw.x, k), lerp(_cv.z, _cw.z, k)) - lerp(_cv.y, _cw.y, k)); }
        if (h < bestH - 0.5) { bestH = h; best = sd; }
      }
      CAM.loopSide = best;
      CAM.blend = 0;
    } else CAM.mode = 'follow';
  } else if (mode === 'boss') {
    if (opts.center && finV(opts.center)) CAM.bossC.copy(opts.center);
    else if (K.level && K.level.boss && finV(K.level.boss.center)) CAM.bossC.copy(K.level.boss.center);
    CAM.bossR = fin(opts.radius) ? opts.radius : 26;
    CAM.bossYawOk = false; CAM.bossOff = 0; CAM.blend = 0;
  } else if (mode === 'title') {
    CAM.snap = true; CAM.titleA = 0; CAM.t = 0;
  }
}
function camShake(a) {
  if (K.view && K.view.reduceMotion) return;
  a = fin(a) ? clamp(a, 0, 2) : 0.2;
  CAM.shake = Math.max(CAM.shake, a);
}

function camFollow(dt, lx, ly, manual) {
  const cam = CAM;
  // pivot follows the player
  _ct.copy(P.pos); _ct.y += 1.05;
  if (cam.snap) cam.pivot.copy(_ct);
  else {
    const kh = dk(S.mode === 'loop' ? 30 : 26, dt);
    cam.pivot.x += (_ct.x - cam.pivot.x) * kh;
    cam.pivot.z += (_ct.z - cam.pivot.z) * kh;
    const kv = dk(P.onGround ? 12 : 5, dt);
    cam.pivot.y += (_ct.y - cam.pivot.y) * kv;
    if (cam.pivot.y < _ct.y - 3) cam.pivot.y = _ct.y - 3;
    if (cam.pivot.y > _ct.y + 3) cam.pivot.y = _ct.y + 3;
  }
  if (manual) {
    cam.yaw -= lx;
    cam.pitch = clamp(cam.pitch - ly, -0.3, 1.1);
    cam.manualT = 0;
  } else cam.manualT += dt;
  const v = P.vel, hs = Math.hypot(v.x, v.z);
  if (cam.manualT > 1 && hs > 2.5 && !P.dead) {
    const my = yawOf(v.x, v.z);
    const dot = (v.x * dirX(cam.yaw) + v.z * dirZ(cam.yaw)) / hs;
    const w = 0.12 + 0.88 * smooth((dot + 0.35) / 1.0);
    const lam = (0.6 + hs * 0.085) * w;
    cam.yaw += angDiff(cam.yaw, my) * dk(lam, dt);
  }
  if (cam.manualT > 1.5) {
    let p0 = PITCH0;
    if (!P.onGround && P.vel.y < -12) p0 += 0.18;
    cam.pitch += (p0 - cam.pitch) * dk(1.6, dt);
  }
  const sp = P.vel.length();
  const dist = CAMD * (1 + 0.1 * smooth((sp - 20) / 20));
  // look-ahead
  _cv.set(v.x, 0, v.z).multiplyScalar(0.1);
  if (_cv.length() > 2.4) _cv.setLength(2.4);
  cam.ahead.lerp(_cv, dk(3, dt));
  const cp = Math.cos(cam.pitch), spch = Math.sin(cam.pitch);
  cam.want.set(cam.pivot.x - dirX(cam.yaw) * cp * dist, cam.pivot.y + spch * dist, cam.pivot.z - dirZ(cam.yaw) * cp * dist);
  // over a drop (cliff edge, arena rim) rise a little so the camera looks down at Kit rather than up at the lip
  const drop = cam.pivot.y - 1.05 - terrainY(cam.want.x, cam.want.z);
  const lift = P.onGround ? clamp((drop - 2) * 0.35, 0, 2.2) : cam.lift;
  cam.lift += (lift - cam.lift) * (cam.snap ? 1 : dk(2.5, dt));
  cam.want.y += cam.lift;
  cam.wantLook.copy(cam.pivot).add(cam.ahead);
  cam.wantLook.y += 0.05;
  avoid(cam.pivot, cam.want, dt, true);
}
// sets _cv to the loop centre and out to the loop camera position for the given side
function loopCamPos(lp, sd, out) {
  const R0 = lp.radius > 0 ? lp.radius : 7;
  _cv.copy(lp.entry).addScaledVector(UP, R0).addScaledVector(lp.side, (lp.shift || 0) * 0.5);
  // far enough out and high enough to frame the whole loop over the valley walls
  out.copy(_cv).addScaledVector(lp.dir, -R0 * 0.3).addScaledVector(lp.side, sd * R0 * 2.0);
  out.y += R0 * 0.95;
  return out;
}
function camLoop(dt) {
  const lp = CAM.loop;
  if (!lp) { CAM.mode = 'follow'; return; }
  loopCamPos(lp, CAM.loopSide, CAM.want);
  CAM.wantLook.copy(_cv).lerp(center(), 0.3);
  CAM.pivot.copy(P.pos); CAM.pivot.y += 1.05;
  CAM.yaw = CAM.viewYaw;
  _ct.copy(CAM.wantLook);
  avoid(_ct, CAM.want, dt, true);
}
function camBoss(dt, lx, ly, manual) {
  const c = CAM.bossC;
  _cv.set(P.pos.x - c.x, 0, P.pos.z - c.z);
  const d = _cv.length();
  const outYaw = d > 1.5 ? yawOf(-_cv.x, -_cv.z) : S.faceYaw;
  if (!CAM.bossYawOk) { CAM.bossYaw = fin(CAM.viewYaw) ? CAM.viewYaw : outYaw; CAM.bossYawOk = true; }
  CAM.bossYaw += angDiff(CAM.bossYaw, outYaw) * dk(d > 4 ? 3 : 1, dt);
  if (manual) { CAM.bossOff -= lx; CAM.manualT = 0; } else { CAM.manualT += dt; if (CAM.manualT > 1.5) CAM.bossOff *= 1 - dk(1.5, dt); }
  void ly;
  const yaw = CAM.bossYaw + CAM.bossOff;
  _ct.copy(P.pos); _ct.y += 1.05;
  CAM.pivot.lerp(_ct, dk(14, dt));
  CAM.want.set(CAM.pivot.x - dirX(yaw) * 9.2, CAM.pivot.y + 3.0, CAM.pivot.z - dirZ(yaw) * 9.2);
  _cw.copy(c); _cw.y += 3.6;
  CAM.wantLook.copy(CAM.pivot).lerp(_cw, 0.32);
  CAM.yaw = yaw;
  avoid(CAM.pivot, CAM.want, dt, true);
}
function camTitle(dt) {
  CAM.titleA += dt * 0.045;
  const W = K.world, b = W && W.bounds;
  let cx = 0, cz = -300;
  if (b && fin(b.minX) && fin(b.maxX) && fin(b.minZ) && fin(b.maxZ)) { cx = (b.minX + b.maxX) / 2; cz = (b.minZ + b.maxZ) / 2; }
  const a = CAM.titleA + 0.6;
  CAM.want.set(cx + Math.sin(a) * 170, 82, cz + Math.cos(a) * 250);
  CAM.wantLook.set(cx, 4, cz);
}
function avoid(pivot, want, dt, occlude) {
  if (occlude && pivot) {
    let frac = 1;
    for (let i = 1; i <= 6; i++) {
      const k = i / 6;
      const x = lerp(pivot.x, want.x, k), y = lerp(pivot.y, want.y, k), z = lerp(pivot.z, want.z, k);
      if (terrainY(x, z) > y - 0.35) { frac = Math.max(0.28, k - 0.12); break; }
    }
    if (frac < CAM.occl) CAM.occl += (frac - CAM.occl) * dk(14, dt);
    else CAM.occl += (frac - CAM.occl) * dk(1.8, dt);
    if (CAM.snap) CAM.occl = frac;
    want.x = pivot.x + (want.x - pivot.x) * CAM.occl;
    want.y = pivot.y + (want.y - pivot.y) * CAM.occl;
    want.z = pivot.z + (want.z - pivot.z) * CAM.occl;
  }
  const h = terrainY(want.x, want.z);
  if (want.y < h + 1.0) want.y = h + 1.0;
}
function camUpdate(dt) {
  const cam = K.view && K.view.camera;
  if (!cam) return;
  if (!(dt > 0 && dt < 0.25)) dt = STEP;
  CAM.t += dt;
  // 'external': another module (K.board in Act 2) places the view; keep the follow state in step for the way back
  if (CAM.mode === 'external') {
    const B = K.board;
    if (B && B.active && typeof B.camera === 'function') { try { B.camera(dt); } catch (e) { console.error(e); } }
    CAM.pos.copy(cam.position);
    cam.getWorldDirection(_cw);
    CAM.look.copy(cam.position).addScaledVector(_cw, 8);
    if (Math.hypot(_cw.x, _cw.z) > 1e-3) { CAM.viewYaw = yawOf(_cw.x, _cw.z); CAM.yaw = CAM.viewYaw; }
    CAM.fov = cam.fov; CAM.shake = 0;
    return;
  }
  const I = K.input;
  let lx = 0, ly = 0;
  if (I && I.look) { lx = fin(+I.look.x) ? +I.look.x : 0; ly = fin(+I.look.y) ? +I.look.y : 0; }
  const manual = Math.abs(lx) + Math.abs(ly) > 1e-5;
  let lam = 60;
  if (P.dead && CAM.mode !== 'title') {
    CAM.want.copy(CAM.pos);
    CAM.wantLook.copy(center());
    if (S.deathKind === 'fall') CAM.wantLook.y = Math.max(CAM.wantLook.y, CAM.pos.y - 9);
    else CAM.wantLook.y = Math.max(CAM.wantLook.y, S.deathY + 0.6);
    lam = 6;
  } else {
    switch (CAM.mode) {
      case 'loop': camLoop(dt); break;
      case 'boss': camBoss(dt, lx, ly, manual); break;
      case 'title': camTitle(dt); lam = 3; break;
      default: camFollow(dt, lx, ly, manual); break;
    }
  }
  if (CAM.snap) {
    CAM.pos.copy(CAM.want); CAM.look.copy(CAM.wantLook); CAM.snap = false; CAM.blend = 1;
  } else {
    CAM.blend = Math.min(1, CAM.blend + dt / 0.8);
    const l = Math.min(lam, lerp(3.5, 60, smooth(CAM.blend)));
    const k = dk(l, dt);
    CAM.pos.lerp(CAM.want, k);
    CAM.look.lerp(CAM.wantLook, P.dead ? dk(8, dt) : Math.max(k, dk(10, dt)));
  }
  if (!finV(CAM.pos) || !finV(CAM.look)) { CAM.snap = true; CAM.pos.set(P.pos.x, P.pos.y + 3, P.pos.z + 8); CAM.look.copy(P.pos); }
  // final safety: never under the ground
  if (CAM.mode !== 'title') { const h = terrainY(CAM.pos.x, CAM.pos.z); if (CAM.pos.y < h + 0.6) CAM.pos.y = h + 0.6; }
  cam.position.copy(CAM.pos);
  if (CAM.shake > 0.001) {
    const s = CAM.shake * 0.5, tt = CAM.t * 60;
    cam.position.x += (hash(tt * 1.17) - 0.5) * s;
    cam.position.y += (hash(tt * 2.31 + 7) - 0.5) * s;
    cam.position.z += (hash(tt * 0.73 + 3) - 0.5) * s;
    CAM.shake *= Math.exp(-7 * dt);
  } else CAM.shake = 0;
  _cw.subVectors(CAM.look, cam.position);
  if (_cw.lengthSq() < 1e-6) CAM.look.set(cam.position.x, cam.position.y, cam.position.z - 1);
  cam.lookAt(CAM.look);
  if (Math.hypot(_cw.x, _cw.z) > 1e-3) CAM.viewYaw = yawOf(_cw.x, _cw.z);
  // speed FOV
  let f = 62;
  if (CAM.mode === 'follow' || CAM.mode === 'boss') f = 62 + 10 * smooth((P.vel.length() - 12) / 26);
  else if (CAM.mode === 'loop') f = 72;
  else if (CAM.mode === 'title') f = 55;
  CAM.fov += (f - CAM.fov) * dk(3, dt);
  if (Math.abs(cam.fov - CAM.fov) > 0.01) { cam.fov = CAM.fov; cam.updateProjectionMatrix(); }
}

K.camera = {
  init: camInit,
  update: camUpdate,
  setMode: camSetMode,
  shake: camShake,
  get mode() { return CAM.mode; },
  get yaw() { return CAM.viewYaw; },
  // the stick's reference: the view, except while the follow camera is still swinging in from a loop / boss / title
  // view, where the view yaw is stale and the follow target yaw is what the camera is about to show
  get inputYaw() { return CAM.mode === 'follow' && CAM.blend < 1 && fin(CAM.yaw) ? CAM.yaw : CAM.viewYaw; }
};
})();
