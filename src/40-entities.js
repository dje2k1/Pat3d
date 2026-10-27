(() => {
'use strict';
// ===================== ENTITIES (rings, badniks, objects, Dr Boulon, capsule) + FX =====================
if (typeof THREE === 'undefined') return;

const V3 = THREE.Vector3;
const TAU = Math.PI * 2, STEP = 1 / 60;
const VIS_D2 = 235 * 235, ACT_D2 = 120 * 120;
const clamp = (v, a, b) => (v > b ? b : v >= a ? v : a);
const lerp = (a, b, t) => a + (b - a) * t;
const fin = v => typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;
const finV = v => !!v && fin(v.x) && fin(v.y) && fin(v.z);
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeOut = t => { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t) * (1 - t); };
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d || 0; };
const hash = n => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
const lin = h => new THREE.Color(h); // r186 colour management: sRGB hex -> linear working space
const { uniform, attribute, float, vec2, vec3, vec4, mix, pow: tpow, max: tmax, min: tmin, dot: tdot, clamp: tclamp, smoothstep, sin: tsin, cos: tcos,
  normalize: tnormalize, abs: tabs, fract: tfract, length: tlength, select, positionGeometry, normalGeometry, positionView, normalView, faceDirection,
  cameraPosition, cameraViewMatrix, texture: ttexture, uv: tuv, mod: tmod, floor: tfloor, instancedBufferAttribute } = TSL;
const rand = Math.random;
const hd2 = (a, b) => { const x = a.x - b.x, z = a.z - b.z; return x * x + z * z; };
const d2 = (a, b) => { const x = a.x - b.x, y = a.y - b.y, z = a.z - b.z; return x * x + y * y + z * z; };
const UPV = new V3(0, 1, 0), ZV = new V3(0, 0, 1);

// ---------- safe bridges to the other modules ----------
function sfx(n, a) { try { const A = K.audio; if (A && typeof A.sfx === 'function') A.sfx(n, a); } catch (e) { /* audio never breaks play */ } }
function shake(a) { try { const C = K.camera; if (C && typeof C.shake === 'function') C.shake(a); } catch (e) { /* optional */ } }
// HDR effects (K.vfx) when they run; false sends the caller to the built-in particles
function vfx(name, a, b, c, d) {
  const X = K.vfx;
  if (!X || !X.ready || typeof X[name] !== 'function') return false;
  try { X[name](a, b, c, d); } catch (e) { return false; }
  return true;
}
function postFx(name, a, b) { const Q = K.post; if (Q && Q.ok && typeof Q[name] === 'function') { try { Q[name](a, b); } catch (e) { /* optional */ } } }
function gcall(fn, a, b) {
  const g = K.game;
  if (!g || typeof g[fn] !== 'function') return undefined;
  try { return g[fn](a, b); } catch (e) { console.error(e); return undefined; }
}
function pcall(fn, a, b, c) {
  const p = K.player;
  if (!p || typeof p[fn] !== 'function') return undefined;
  try { return p[fn](a, b, c); } catch (e) { console.error(e); return undefined; }
}
function gstate() { const g = K.game; return g && typeof g.state === 'string' ? g.state : 'play'; }
function bossDone() { return !!(K.game && K.game.bossDone); }
function surf() { const C = K.city; return ST.away && C && C.entered && typeof C.ground === 'function' ? C : K.world; }
function seaY() { const W = surf(); return W && fin(W.seaLevel) ? W.seaLevel : 0; }
function deathY() { const W = surf(); return W && fin(W.deathY) ? W.deathY : -40; }
const GR = { y: 0, n: new V3(0, 1, 0), solid: null };
function ground(x, z, top) {
  const W = surf();
  if (!W || typeof W.ground !== 'function' || !fin(x) || !fin(z)) return null;
  let g = null;
  try { g = W.ground(x, z, fin(top) ? top : 1e6); } catch (e) { g = null; }
  if (!g || !fin(g.y)) return null;
  GR.y = g.y; GR.solid = g.solid || null;
  if (g.n && finV(g.n) && g.n.lengthSq() > 1e-8) { GR.n.copy(g.n).normalize(); if (GR.n.y < 0) GR.n.negate(); } else GR.n.set(0, 1, 0);
  return GR;
}
function terrainY(x, z) {
  const W = K.world;
  if (ST.away || !W || typeof W.terrainY !== 'function') return -1e3;
  let h = -1e3;
  try { h = W.terrainY(x, z); } catch (e) { h = -1e3; }
  return fin(h) ? h : -1e3;
}
function solidsList() { const W = K.world; return W && Array.isArray(W.solids) ? W.solids : null; }
function addSolid(s) { const L = solidsList(); if (L && s && L.indexOf(s) < 0) L.push(s); }
function removeSolid(s) { const L = solidsList(); if (!L || !s) return; const i = L.indexOf(s); if (i >= 0) L.splice(i, 1); }

// ---------- player snapshot (read once per tick) ----------
const PL = { ok: false, pos: new V3(), c: new V3(), vel: new V3(), atk: false, onGround: true, dead: true, homing: false, shield: false };
function readPlayer() {
  const P = K.player;
  PL.ok = false;
  if (!P || !finV(P.pos)) return;
  PL.pos.copy(P.pos);
  let c = null;
  if (typeof P.center === 'function') { try { c = P.center(); } catch (e) { c = null; } }
  if (finV(c)) PL.c.copy(c); else { PL.c.copy(P.pos); PL.c.y += 0.6; }
  if (finV(P.vel)) PL.vel.copy(P.vel); else PL.vel.set(0, 0, 0);
  let atk = false;
  if (typeof P.isAttacking === 'function') { try { atk = !!P.isAttacking(); } catch (e) { atk = false; } }
  else atk = !!(P.ball || P.star > 0);
  PL.atk = atk;
  PL.onGround = !!P.onGround;
  PL.dead = !!P.dead;
  PL.homing = !!P.homing;
  PL.shield = !!P.shield;
  PL.ok = !PL.dead && gstate() !== 'title';
}
// does the moving player sphere (center c, velocity v over time t) come within r of point p?
function sweepHit(p, r, t) {
  const c = PL.c, v = PL.vel;
  let ax = p.x - c.x, ay = p.y - c.y, az = p.z - c.z;
  if (ax * ax + ay * ay + az * az < r * r) return true;
  const vx = v.x * t, vy = v.y * t, vz = v.z * t, vv = vx * vx + vy * vy + vz * vz;
  if (vv < 1e-8) return false;
  const k = clamp((ax * vx + ay * vy + az * vz) / vv, 0, 1);
  ax -= vx * k; ay -= vy * k; az -= vz * k;
  return ax * ax + ay * ay + az * az < r * r;
}
// segment c → c + v·t against an AABB (slab test)
function sweepBox(minx, miny, minz, maxx, maxy, maxz, t) {
  const c = PL.c, v = PL.vel;
  let t0 = 0, t1 = 1;
  const o = [c.x, c.y, c.z], d = [v.x * t, v.y * t, v.z * t], lo = [minx, miny, minz], hi = [maxx, maxy, maxz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) return false; continue; }
    let a = (lo[i] - o[i]) / d[i], b = (hi[i] - o[i]) / d[i];
    if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return false;
  }
  return true;
}

// ---------- scratch ----------
const _v = new V3(), _w = new V3(), _u = new V3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();
const _bx = new V3(), _by = new V3(), _bz = new V3(), _bm = new THREE.Matrix4();
function orient(obj, up, yaw) {
  _bz.set(Math.sin(yaw), 0, Math.cos(yaw));
  _by.copy(up);
  _bz.addScaledVector(_by, -_bz.dot(_by));
  if (_bz.lengthSq() < 1e-6) _bz.set(0, 0, 1);
  _bz.normalize();
  _bx.crossVectors(_by, _bz).normalize();
  _bm.makeBasis(_bx, _by, _bz);
  obj.quaternion.setFromRotationMatrix(_bm);
}

// ===================== colors =====================
const COL = {
  red: lin('#e3232c'), redD: lin('#8a0c16'), black: lin('#15131b'), ink: lin('#24222c'),
  steel: lin('#4f5770'), steelD: lin('#2a2f42'), steelL: lin('#9aa3b8'), silver: lin('#e2e6f0'), white: lin('#f4f6fb'), grey: lin('#c3c9d6'),
  yellow: lin('#ffd20a'), yellowD: lin('#e09400'), orange: lin('#ff8a1f'), eyeW: lin('#ffffff'),
  lensR: lin('#ff2a2a'), eyeR: lin('#d40f1c'), cyan: lin('#7ef0ff'), tire: lin('#23262f'), hub: lin('#c8cedc'),
  waspY: lin('#ffcf26'), waspK: lin('#1d1a22'), gun: lin('#3a3f55'),
  fishB: lin('#2f86ea'), fishBD: lin('#173f98'), fishW: lin('#eef4ff'), fin: lin('#ff5a3a'), finD: lin('#c8321c'), mouth: lin('#6e0b1a'), tooth: lin('#ffffff'),
  bunny: lin('#fffaf2'), bunnyS: lin('#efe2d6'), pink: lin('#ff9ab8'), bird: lin('#4fb8ff'), birdD: lin('#2b86e0'), birdL: lin('#d4f0ff'), beak: lin('#ffb020'),
  skin: lin('#ffd2ad'), nose: lin('#ffab80'), stache: lin('#6b3410'), coat: lin('#c8302a'), coatD: lin('#8f1c18'), glove: lin('#fbfbff'),
  blue: lin('#2a4fc0'), blueL: lin('#6c97ff'), lampR: lin('#ff3b3b'), lampB: lin('#53d6ff'), navy: lin('#1b2033'), panel: lin('#1d2440'),
  ring: lin('#ffb52e'), ringE: lin('#7a4200')
};

// ===================== geometry helpers =====================
// surface kinds of the shared entity material (aMat.w): micro-detail, clearcoat, sheen are chosen per vertex
const K_PAINT = 0, K_METAL = 1, K_CHROME = 2, K_RUBBER = 3, K_PLASTIC = 4, K_SOFT = 5, K_HULL = 6, K_GLOW = 7;
// per-vertex material [roughness, metalness, emission 0..1, kind]
const MT = {
  paint: [0.36, 0.2, 0, K_PAINT],     // clearcoated painted metal (robot shells, hull colours)
  gloss: [0.2, 0, 0, K_PLASTIC],      // glossy plastic / enamel (eyes, caps, buttons)
  metal: [0.42, 0.85, 0, K_METAL],    // machined / brushed steel (bases, frames, thrusters)
  chrome: [0.07, 1, 0, K_CHROME],     // polished chrome (trims, coils, spikes, bolts)
  rubber: [0.78, 0, 0, K_RUBBER],     // tyres, pads
  soft: [0.66, 0, 0, K_SOFT],         // skin, cloth, fur (animals, the pilot)
  hull: [0.3, 0.25, 0, K_HULL],       // painted hull panels with seams (lathe UVs: boss pod, capsule)
  glow: [0.35, 0, 1, K_GLOW]          // emissive (eyes, lamps, LEDs): blooms
};
const IDM = new THREE.Matrix4();
const _gv = new V3(), _gn = new V3(), _gc = new THREE.Color(), _nm = new THREE.Matrix3();
class GB {
  constructor() { this.p = []; this.n = []; this.c = []; this.u = []; this.m = []; this.i = []; this.count = 0; this.mt = MT.paint; }
  add(geo, color, mat) {
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const pa = geo.attributes.position, na = geo.attributes.normal, ua = geo.attributes.uv;
    const m = mat || IDM;
    _nm.getNormalMatrix(m);
    const base = this.count, fn = typeof color === 'function';
    for (let k = 0; k < pa.count; k++) {
      _gv.fromBufferAttribute(pa, k);
      if (fn) color(_gv.x, _gv.y, _gv.z, _gc); else _gc.copy(color);
      _gv.applyMatrix4(m);
      _gn.fromBufferAttribute(na, k).applyMatrix3(_nm);
      const l = _gn.length();
      if (l > 1e-8) _gn.multiplyScalar(1 / l); else _gn.set(0, 1, 0);
      this.p.push(_gv.x, _gv.y, _gv.z); this.n.push(_gn.x, _gn.y, _gn.z); this.c.push(_gc.r, _gc.g, _gc.b);
      if (ua) this.u.push(ua.getX(k), ua.getY(k)); else this.u.push(0, 0);
      const mt = this.mt;
      this.m.push(mt[0], mt[1], mt[2], mt[3]);
    }
    const i0 = this.i.length;
    if (geo.index) { const ia = geo.index.array; for (let k = 0; k < ia.length; k++) this.i.push(base + ia[k]); }
    else for (let k = 0; k < pa.count; k++) this.i.push(base + k);
    if (m.determinant() < 0) for (let k = i0; k + 2 < this.i.length; k += 3) { const t = this.i[k + 1]; this.i[k + 1] = this.i[k + 2]; this.i[k + 2] = t; }
    this.count += pa.count;
    geo.dispose();
    return this;
  }
  // merges an already built part (its own colours / surfaces), transformed by mat
  addBuilt(geo, mat) {
    const pa = geo.attributes.position, na = geo.attributes.normal, ca = geo.attributes.color, ua = geo.attributes.uv, ma = geo.attributes.aMat;
    const m = mat || IDM;
    _nm.getNormalMatrix(m);
    const base = this.count;
    for (let k = 0; k < pa.count; k++) {
      _gv.fromBufferAttribute(pa, k).applyMatrix4(m);
      _gn.fromBufferAttribute(na, k).applyMatrix3(_nm).normalize();
      this.p.push(_gv.x, _gv.y, _gv.z); this.n.push(_gn.x, _gn.y, _gn.z);
      this.c.push(ca.getX(k), ca.getY(k), ca.getZ(k)); this.u.push(ua.getX(k), ua.getY(k));
      this.m.push(ma.getX(k), ma.getY(k), ma.getZ(k), ma.getW(k));
    }
    const i0 = this.i.length, ia = geo.index.array;
    for (let k = 0; k < ia.length; k++) this.i.push(base + ia[k]);
    if (m.determinant() < 0) for (let k = i0; k + 2 < this.i.length; k += 3) { const t = this.i[k + 1]; this.i[k + 1] = this.i[k + 2]; this.i[k + 2] = t; }
    this.count += pa.count;
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.m, 4));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}
function TRS(x, y, z, rx, ry, rz, sx, sy, sz) {
  _e.set(rx || 0, ry || 0, rz || 0);
  _q.setFromEuler(_e);
  const s1 = sx == null ? 1 : sx;
  return new THREE.Matrix4().compose(new V3(x, y, z), _q, new V3(s1, sy == null ? s1 : sy, sz == null ? s1 : sz));
}
function TRq(x, y, z, q, sx, sy, sz) {
  const s1 = sx == null ? 1 : sx;
  return new THREE.Matrix4().compose(new V3(x, y, z), q, new V3(s1, sy == null ? s1 : sy, sz == null ? s1 : sz));
}
// templates are built twice: LQ = 1 (near LOD) and LQ < 1 (far LOD: fewer segments, no small details, see lodTpl)
let LQ = 1;
const sg = (n, min) => Math.max(min, Math.round(n * LQ));
const HI = () => LQ >= 1;
const sph = (r, w, h) => new THREE.SphereGeometry(r, sg(w || 16, 5), sg(h || 12, 3));
const cyl = (rt, rb, h, s, open) => new THREE.CylinderGeometry(rt, rb, h, sg(s || 16, 5), 1, !!open);
const cone = (r, h, s) => new THREE.ConeGeometry(r, h, sg(s || 12, 4));
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const tor = (R, r, rs, ts, arc) => new THREE.TorusGeometry(R, r, sg(rs || 8, 3), sg(ts || 24, 6), arc || TAU);
const lathe = (pts, s) => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(Math.max(0, p[0]), p[1])), sg(s || 24, 8));
const sphPart = (w, h, p0, pl, t0, tl) => new THREE.SphereGeometry(1, sg(w, 5), sg(h, 3), p0, pl, t0, tl);
function rbox(w, h, d, r, seg) {
  seg = sg(seg || 4, 2);
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const p = g.attributes.position, nr = g.attributes.normal;
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const cx = clamp(x, -hx, hx), cy = clamp(y, -hy, hy), cz = clamp(z, -hz, hz);
    let nx = x - cx, ny = y - cy, nz = z - cz;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    p.setXYZ(i, cx + nx * r, cy + ny * r, cz + nz * r);
    nr.setXYZ(i, nx, ny, nz);
  }
  return g;
}
// tube along a smooth curve with a varying radius rf(t)
function tubeVar(points, rf, seg, rad) {
  seg = sg(seg || 20, 6); rad = sg(rad || 10, 5);
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, seg, 1, rad, false);
  const pa = g.attributes.position, c = new V3(), v = new V3();
  for (let i = 0; i <= seg; i++) {
    curve.getPointAt(i / seg, c);
    const r = rf(i / seg);
    for (let j = 0; j <= rad; j++) {
      const k = i * (rad + 1) + j;
      if (k >= pa.count) break;
      v.fromBufferAttribute(pa, k).sub(c).multiplyScalar(r).add(c);
      pa.setXYZ(k, v.x, v.y, v.z);
    }
  }
  return g;
}
// cylinder between two points (top radius at b)
function stick(gb, ax, ay, az, bx, by, bz, r0, r1, col, seg) {
  const d = new V3(bx - ax, by - ay, bz - az), len = d.length();
  if (len < 1e-5) return;
  d.multiplyScalar(1 / len);
  const q = new THREE.Quaternion().setFromUnitVectors(UPV, d);
  gb.add(cyl(r1, r0, len, seg || 8), col, TRq((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, q));
}
function vgrad(top, bot, y0, y1) { return (x, y, z, o) => o.copy(bot).lerp(top, smooth((y - y0) / (y1 - y0 || 1))); }
// left-hand copy of a part (mirrored in x, winding kept front-facing): mirrored instances would show their back faces
function mirrorX(geo) {
  const g = geo.clone();
  g.userData = {};
  if (geo.userData.far) g.userData.far = mirrorX(geo.userData.far);
  g.scale(-1, 1, 1);
  const ix = g.index.array;
  for (let k = 0; k + 2 < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; }
  g.computeBoundingSphere();
  return g;
}
// one merged geometry per model part; each view sets the surface of what it adds: g.paint.add(geo, colour, matrix)
function partsOf(build) {
  const gb = new GB();
  const view = mt => ({ add(geo, color, mat) { gb.mt = mt; gb.add(geo, color, mat); return this; } });
  const g = { mat: view };
  for (const k in MT) g[k] = view(MT[k]);
  build(g);
  return gb.count ? gb.build() : null;
}

// ===================== textures =====================
function canvas(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (g) fn(g, w, h);
  return c;
}
function texOf(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
// Kit's head (same drawing as the 2D game, origin = head center, facing right)
const FC = { fur: '#f47a1f', furD: '#c4510f', white: '#fff4e6', line: '#3d1707', shoe: '#17b6c3', sole: '#f2f4f8', eye: '#22c36a', inner: '#6a2408' };
function fs(g, fill) { g.fillStyle = fill; g.fill(); g.strokeStyle = FC.line; g.stroke(); }
function drawHead(g) {
  g.lineWidth = 1; g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath(); g.moveTo(-6, -4); g.lineTo(-6, -15); g.lineTo(0, -6.5); g.closePath(); fs(g, FC.furD);
  g.fillStyle = FC.inner; g.beginPath(); g.moveTo(-5, -5.4); g.lineTo(-5.2, -12.2); g.lineTo(-1.6, -6.4); g.fill();
  g.beginPath(); g.moveTo(-8, -1); g.lineTo(-13, 2.4); g.lineTo(-7.4, 3.6); g.closePath(); fs(g, FC.fur);
  g.beginPath(); g.ellipse(0, 0, 8.4, 8, 0, 0, TAU); fs(g, FC.fur);
  g.beginPath(); g.moveTo(-2, -6); g.lineTo(2.5, -17.5); g.lineTo(5.6, -5.6); g.closePath(); fs(g, FC.fur);
  g.fillStyle = FC.inner; g.beginPath(); g.moveTo(-0.6, -6.6); g.lineTo(2.5, -14.6); g.lineTo(4.2, -6.6); g.fill();
  g.beginPath(); g.moveTo(-1.5, 2); g.quadraticCurveTo(5, -1.5, 12.6, 0.4); g.lineTo(12, 3.2); g.quadraticCurveTo(5.5, 8.6, -3.4, 6.4);
  g.quadraticCurveTo(-4.2, 4, -1.5, 2); g.closePath(); fs(g, FC.white);
  g.fillStyle = FC.fur; g.beginPath(); g.moveTo(3, -3.4); g.quadraticCurveTo(8, -2.4, 12.4, 0.2); g.lineTo(4, 1.2); g.closePath(); g.fill();
  g.beginPath(); g.ellipse(12.6, 0.8, 1.8, 1.5, 0, 0, TAU); fs(g, '#1a0b05');
  g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(-3, -3.5, 3.2, 1.6, -0.5, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(3.8, -2.8, 2.7, 3.7, 0.1, 0, TAU); fs(g, '#ffffff');
  g.fillStyle = FC.eye; g.beginPath(); g.ellipse(4.7, -2.6, 1.75, 2.7, 0.1, 0, TAU); g.fill();
  g.fillStyle = '#08130c'; g.beginPath(); g.ellipse(5.2, -2.5, 0.95, 1.6, 0, 0, TAU); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(4.4, -3.8, 0.7, 0, TAU); g.fill();
  g.strokeStyle = FC.line; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(0.8, -7); g.quadraticCurveTo(4, -7.6, 7, -5.8); g.stroke();
  g.beginPath(); g.moveTo(7.8, 4.2); g.quadraticCurveTo(9.6, 5.2, 11, 4); g.stroke(); g.lineWidth = 1;
}
function drawShoe(g) {
  g.lineWidth = 1; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(-3, -0.5); g.quadraticCurveTo(-3.6, -5.4, 1.5, -5); g.quadraticCurveTo(7.6, -4.4, 7.6, -1.2);
  g.lineTo(7.4, 0.6); g.lineTo(-3, 0.6); g.closePath(); fs(g, FC.shoe);
  g.fillStyle = FC.sole; g.fillRect(-3, -0.6, 10.4, 1.6);
  g.strokeStyle = '#ffffff'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(0.4, -4.6); g.lineTo(2.4, -1.4); g.stroke(); g.lineWidth = 1;
}
function drawIcon(g, k) {
  if (k === 'ring') {
    g.lineWidth = 2.6; g.strokeStyle = '#8a5200'; g.beginPath(); g.ellipse(0, 0, 3.9, 4.5, 0, 0, TAU); g.stroke();
    const gr = g.createLinearGradient(-4, -4, 4, 4); gr.addColorStop(0, '#fff3a0'); gr.addColorStop(0.45, '#ffd23f'); gr.addColorStop(1, '#e09000');
    g.lineWidth = 1.7; g.strokeStyle = gr; g.beginPath(); g.ellipse(0, 0, 3.9, 4.5, 0, 0, TAU); g.stroke();
    g.lineWidth = 0.6; g.strokeStyle = '#fffde8'; g.beginPath(); g.ellipse(0, 0, 3.7, 4.3, 0, Math.PI * 1.05, Math.PI * 1.5); g.stroke();
  } else if (k === 'shield') {
    const gr = g.createRadialGradient(-1.6, -1.8, 0.4, 0, 0, 5.2); gr.addColorStop(0, '#f2fbff'); gr.addColorStop(0.55, '#6fc0ff'); gr.addColorStop(1, '#1f6fe8');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 5.2, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 0.7; g.beginPath(); g.arc(0, 0, 4.3, Math.PI * 1.1, Math.PI * 1.5); g.stroke();
    g.strokeStyle = '#0c3d99'; g.lineWidth = 0.5; g.beginPath(); g.arc(0, 0, 5.2, 0, TAU); g.stroke();
  } else if (k === 'shoes') { g.scale(0.95, 0.95); g.translate(-2.3, 3); drawShoe(g); }
  else if (k === 'star') {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 2.3 : 5.6, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath();
    const gr = g.createLinearGradient(0, -5, 0, 5); gr.addColorStop(0, '#fff7b0'); gr.addColorStop(1, '#ffb400');
    g.fillStyle = gr; g.fill(); g.strokeStyle = '#9a6200'; g.lineWidth = 0.6; g.stroke();
  } else if (k === 'life') { g.scale(0.52, 0.52); g.translate(-1.5, 2.5); drawHead(g); }
}
function screenCanvas(kind) {
  return canvas(128, 128, (g) => {
    const bg = g.createRadialGradient(64, 54, 6, 64, 64, 92);
    bg.addColorStop(0, '#36479a'); bg.addColorStop(0.6, '#18215a'); bg.addColorStop(1, '#090c26');
    g.fillStyle = bg; g.fillRect(0, 0, 128, 128);
    g.save(); g.translate(64, 64); g.scale(8.6, 8.6); drawIcon(g, kind); g.restore();
    g.fillStyle = 'rgba(0,0,20,.16)'; for (let y = 0; y < 128; y += 4) g.fillRect(0, y, 128, 2);
    const gl = g.createLinearGradient(0, 0, 128, 128); gl.addColorStop(0, 'rgba(255,255,255,.22)'); gl.addColorStop(0.42, 'rgba(255,255,255,.05)'); gl.addColorStop(0.43, 'rgba(255,255,255,0)');
    g.fillStyle = gl; g.fillRect(0, 0, 128, 128);
  });
}
// the monitors' screen images in one atlas (3 x 2 tiles of 256 px: ring, shield, shoes, star, life, blank); the screen
// material adds the CRT look (scanlines, glow, static, roll bar) and picks the tile per instance
const ICONS = ['ring', 'shield', 'shoes', 'star', 'life'];
function iconAtlasCanvas() {
  return canvas(768, 512, (g) => {
    for (let i = 0; i < 6; i++) {
      const x = (i % 3) * 256, y = Math.floor(i / 3) * 256;
      g.save(); g.translate(x, y);
      const bg = g.createRadialGradient(128, 112, 10, 128, 128, 182);
      bg.addColorStop(0, '#3a52b8'); bg.addColorStop(0.55, '#16206a'); bg.addColorStop(1, '#060a2a');
      g.fillStyle = bg; g.fillRect(0, 0, 256, 256);
      if (i < 5) { g.translate(128, 128); g.scale(17.5, 17.5); drawIcon(g, ICONS[i]); }
      g.restore();
    }
  });
}
function atlasCanvas() {
  return canvas(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    // 0: soft glow
    let r = g.createRadialGradient(32, 32, 0, 32, 32, 31);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.22, 'rgba(255,255,255,.8)'); r.addColorStop(0.55, 'rgba(255,255,255,.22)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    // 1: four-point sparkle
    g.save(); g.translate(96, 32);
    r = g.createRadialGradient(0, 0, 0, 0, 0, 14); r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(-16, -16, 32, 32);
    const star = (s, rot) => {
      g.save(); g.rotate(rot); g.beginPath(); g.moveTo(0, -s); g.quadraticCurveTo(0, 0, s, 0); g.quadraticCurveTo(0, 0, 0, s);
      g.quadraticCurveTo(0, 0, -s, 0); g.quadraticCurveTo(0, 0, 0, -s); g.fill(); g.restore();
    };
    g.fillStyle = 'rgba(255,255,255,1)'; star(30, 0);
    g.fillStyle = 'rgba(255,255,255,.6)'; star(15, Math.PI / 4);
    g.restore();
    // 2: smoke puff
    g.save(); g.translate(32, 96);
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4, d = i ? 9 : 0, x = Math.cos(a) * d, y = Math.sin(a) * d, rr = i ? 15 : 20;
      r = g.createRadialGradient(x, y, 0, x, y, rr); r.addColorStop(0, 'rgba(255,255,255,.55)'); r.addColorStop(0.6, 'rgba(255,255,255,.3)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
    }
    g.restore();
    // 3: droplet / disc
    r = g.createRadialGradient(96, 96, 0, 96, 96, 30);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.5, 'rgba(255,255,255,.95)'); r.addColorStop(0.75, 'rgba(255,255,255,.4)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(64, 64, 64, 64);
  });
}

// ===================== environment map + materials =====================
const MAT = {};
const TEX = {};
// live TSL uniforms: time (screens, dash arrows), emission gain (HDR: blooms), micro-bump strength (per preset), rings
const U = { time: uniform(0), glow: uniform(1.9), bump: uniform(1), ring: uniform(1) };
// fallback sky for the metals when the scene has no environment map (normally scene.environment, K.post's capture of
// the island sky, lights every entity material)
function makeEnv() {
  const R = K.view && K.view.renderer;
  if (!R || typeof THREE.PMREMGenerator !== 'function') return null;
  let pm = null, geo = null, mat = null;
  try {
    const W = K.world;
    const sd = W && finV(W.sunDir) && W.sunDir.lengthSq() > 1e-6 ? W.sunDir.clone().normalize() : new V3(0.5, 0.7, -0.42).normalize();
    const sc = new THREE.Scene();
    geo = new THREE.SphereGeometry(20, 48, 24);
    mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
    {
      const d = tnormalize(positionGeometry), y = d.y, uSun = uniform(sd);
      const zen = vec3(0.09, 0.30, 0.86), hor = vec3(0.86, 0.93, 1.0), gnd = vec3(0.13, 0.34, 0.08), deep = vec3(0.05, 0.11, 0.04);
      let c = select(y.greaterThan(0), mix(hor, zen, tpow(tmax(y, 0), 0.55)), mix(mix(hor, gnd, 0.55), mix(gnd, deep, tclamp(y.mul(-1.5), 0, 1)), smoothstep(0.0, 0.2, y.negate())));
      const cl = smoothstep(0.55, 0.8, tsin(d.x.mul(7).add(1.3)).mul(tsin(d.z.mul(5).sub(0.4))).mul(0.5).add(0.5)).mul(smoothstep(0.03, 0.18, y)).mul(smoothstep(0.7, 0.3, y));
      c = mix(c, vec3(1.15), cl.mul(0.7));
      const sv = tmax(tdot(d, uSun), 0);
      mat.colorNode = c.add(vec3(1.0, 0.92, 0.75).mul(tpow(sv, 600).mul(40).add(tpow(sv, 14).mul(0.7))));
    }
    sc.add(new THREE.Mesh(geo, mat));
    pm = new THREE.PMREMGenerator(R);
    const rt = pm.fromScene(sc, 0);
    return rt && rt.texture ? rt.texture : null;
  } catch (e) {
    console.warn('Kit Rush 3D: environment map unavailable', e);
    return null;
  } finally {
    if (pm) pm.dispose();
    if (geo) geo.dispose();
    if (mat) mat.dispose();
  }
}
// generated textures (K.tex, assets/tex/entities): the texture nodes sample a private 1x1 placeholder until K.tex has the
// real image, then switch to it (a K.tex texture is never uploaded before its WebP arrived)
const TXR = {};
function texRef(name, opts, fb) {
  let r = TXR[name];
  if (r) return r;
  const ph = new THREE.DataTexture(new Uint8Array(fb), 1, 1);
  ph.wrapS = ph.wrapT = THREE.RepeatWrapping;
  ph.colorSpace = opts && opts.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  ph.needsUpdate = true;
  r = TXR[name] = { cur: ph, nodes: [], ready: false };
  const T = K.tex;
  if (T && typeof T.load === 'function' && typeof T.preload === 'function' && (typeof T.has !== 'function' || T.has(name))) {
    const t = T.load(name, opts);
    T.preload([name]).then(() => { r.cur = t; r.ready = true; for (const n of r.nodes) n.value = t; }).catch(() => { /* keep the placeholder */ });
  }
  return r;
}
const rtex = (r, uvn) => { const n = ttexture(r.cur, uvn); r.nodes.push(n); return n; };
let DETAIL = null;
// triplanar lookup in the model's own space (the procedural models have no UVs; with instancing positionGeometry stays
// local, so the detail sticks to each robot)
function triplanar(r, scale) {
  const n = normalGeometry.abs(), w0 = n.mul(n).mul(n).mul(n);
  const w = w0.div(w0.x.add(w0.y).add(w0.z));
  const p = positionGeometry.mul(scale);
  return rtex(r, p.zy).mul(w.x).add(rtex(r, p.xz).mul(w.y)).add(rtex(r, p.xy).mul(w.z));
}
// bump mapping from a height in metres (screen-space derivatives, Mikkelsen's surface gradient): works on any mapping
function bumpN(hgt) {
  const dh = vec2(hgt.dFdx(), hgt.dFdy());
  const sx = positionView.dFdx(), sy = positionView.dFdy(), n = tnormalize(normalView);
  const r1 = sy.cross(n), r2 = n.cross(sx);
  const det = sx.dot(r1).mul(faceDirection);
  const g = det.sign().mul(dh.x.mul(r1).add(dh.y.mul(r2)));
  return det.abs().mul(n).sub(g).normalize();
}
const fresnelV = () => float(1).sub(tclamp(tabs(tdot(tnormalize(normalView), tnormalize(positionView.negate()))), 0, 1));
// THE entity material: every robot, spring, monitor, post, the boss and the capsule. Per vertex: colour + aMat
// [roughness, metalness, emission, kind]; per instance: iTint [emission tint rgb, white flash]. Kinds: clearcoated paint
// (orange-peel micro bump), brushed metal, chrome, rubber (pebbled), glossy plastic, soft (sheen: skin, cloth, animals),
// hull panels (paint + seams between 12 panels around a lathe's UVs), emissive (HDR, blooms).
function entMaterial() {
  const m = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.5, metalness: 0 });
  const col = attribute('color', 'vec3'), am = attribute('aMat', 'vec4'), it = attribute('iTint', 'vec4');
  const kind = am.w;
  const wk = k => tclamp(float(1).sub(tabs(kind.sub(k)).mul(2)), 0, 1);
  const mPaint = wk(K_PAINT), mMetal = wk(K_METAL), mChrome = wk(K_CHROME), mRubber = wk(K_RUBBER), mPlast = wk(K_PLASTIC), mSoft = wk(K_SOFT), mHull = wk(K_HULL);
  const d = triplanar(DETAIL, 1.7);
  const u = tuv();
  const seam = smoothstep(0.94, 0.985, tabs(tfract(u.x.mul(12)).sub(0.5)).mul(2)).mul(mHull);
  const h = d.x.sub(0.5).mul(mPaint.add(mHull).mul(0.0009))
    .add(d.y.sub(0.5).mul(mMetal.mul(0.002).add(mChrome.mul(0.0005))))
    .add(d.z.mul(mRubber.mul(0.0035)))
    .sub(seam.mul(0.0035));
  m.normalNode = bumpN(h.mul(U.bump));
  const wear = d.w.sub(0.5);
  const worn = mPaint.add(mHull).add(mMetal).add(mRubber);
  m.colorNode = col.mul(float(1).sub(am.z)).mul(float(1).sub(wear.mul(0.16).mul(worn))).mul(float(1).sub(seam.mul(0.6)));
  m.roughnessNode = tclamp(am.x.add(wear.mul(mPaint.add(mHull).mul(0.1).add(mMetal.mul(0.3)).add(mChrome.mul(0.05)).add(mRubber.mul(0.15)))), 0.03, 1);
  m.metalnessNode = am.y;
  m.clearcoatNode = mPaint.add(mHull).add(mPlast.mul(0.6)).mul(float(1).sub(seam));
  m.clearcoatRoughnessNode = tclamp(wear.mul(0.08).add(0.05), 0.02, 0.2);
  m.sheenNode = col.mul(0.5).add(0.04).mul(mSoft);
  m.sheenRoughnessNode = float(0.55);
  m.emissiveNode = col.mul(am.z).mul(U.glow).mul(it.xyz).add(vec3(it.w.mul(0.85)));
  m.specularIntensityNode = float(1).sub(wk(K_GLOW).mul(0.85)); // lamps and LEDs keep their colour (no sky sheen)
  return m;
}
// polished gold rings: mirror-like metal (env + sun highlights bloom) with a warm fresnel glow so they read as gold even
// against the blue sky or in shade
const GOLD = new THREE.Color(1.0, 0.5, 0.07);
function ringMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.2, metalness: 1 });
  const gold = vec3(GOLD.r, GOLD.g, GOLD.b), f = fresnelV(), nv = tnormalize(normalView);
  // studio-like bands in view space (bright top edge, warm sides) on top of the real reflections
  const band = smoothstep(0.35, 0.95, nv.y).mul(0.55).add(smoothstep(-0.2, -0.9, nv.y).mul(0.12));
  m.colorNode = gold;
  m.roughnessNode = float(0.2);
  m.metalnessNode = float(1);
  m.emissiveNode = gold.mul(tpow(f, 2).mul(0.6).add(0.22)).add(vec3(1.0, 0.78, 0.3).mul(band)).mul(U.ring);
  return m;
}
// monitor screens: black glossy glass (reflections) showing the item through a CRT (scanlines, barrel, vignette,
// roll bar, static noise while flickering). Per instance (iTint): x = icon tile, y = static 0..1, z = brightness.
function screenMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.06, metalness: 0 });
  const it = attribute('iTint', 'vec4'), u = tuv();
  const p = u.mul(2).sub(1);
  const q = p.mul(float(1).add(tdot(p, p).mul(0.07)));
  const uv2 = tclamp(q.mul(0.5).add(0.5), 0.004, 0.996);
  const cx = tmod(it.x, 3), cy = tfloor(it.x.div(3).add(0.01));
  const img = ttexture(TEX.icons, vec2(uv2.x.add(cx).div(3), uv2.y.add(float(1).sub(cy)).div(2))).rgb;
  const scan = tsin(u.y.mul(Math.PI * 2 * 70)).mul(0.5).add(0.5).mul(0.3).add(0.7);
  const cell = tfloor(u.mul(vec2(70, 52))).add(tfloor(U.time.mul(24)).mul(vec2(17.13, 3.37)));
  const nz = tfract(tsin(tdot(cell, vec2(12.9898, 78.233))).mul(43758.5453));
  const stat = vec3(0.75, 0.8, 1.0).mul(nz.mul(nz).mul(0.9).add(0.05));
  const vig = float(1).sub(tpow(tlength(p).mul(0.7), 3).mul(0.6));
  const roll = smoothstep(0.86, 1, tfract(u.y.mul(0.6).sub(U.time.mul(0.3)))).mul(0.18).add(1);
  m.colorNode = vec3(0.006, 0.008, 0.012);
  m.emissiveNode = mix(img, stat, it.y).mul(scan).mul(vig).mul(roll).mul(it.z).mul(U.glow.mul(0.5));
  return m;
}
// dash panels: procedural chevrons scrolling forward (uv v grows towards the panel's front), additive HDR
function arrowMaterial() {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const u = tuv();
  const ax = tabs(u.x.sub(0.5));
  const y = tfract(u.y.mul(2.6).add(ax.mul(1.25)).sub(U.time.mul(1.9)));
  const band = smoothstep(0.0, 0.05, y).mul(smoothstep(0.46, 0.38, y));
  const edge = smoothstep(0.02, 0.1, u.x).mul(smoothstep(0.98, 0.9, u.x)).mul(smoothstep(0.0, 0.06, u.y)).mul(smoothstep(1.0, 0.94, u.y));
  const c = mix(vec3(1.0, 0.3, 0.03), vec3(1.0, 0.9, 0.45), smoothstep(0.1, 0.42, y));
  m.colorNode = c.mul(band.mul(edge).mul(tsin(U.time.mul(9)).mul(0.18).add(0.82)).mul(2.6));
  m.opacityNode = float(1);
  return m;
}
// wasp wings: thin iridescent film
function wingMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.12, metalness: 0 });
  const f = fresnelV();
  m.colorNode = vec3(0.82).add(tcos(f.mul(9).add(vec3(0, 2.1, 4.2))).mul(0.16));
  m.opacityNode = f.mul(0.5).add(0.22);
  return m;
}
// the boss's glass dome: clear at the centre, reflective at grazing angles
function glassMaterial() {
  const m = new THREE.MeshPhysicalNodeMaterial({ transparent: true, depthWrite: false, roughness: 0.04, metalness: 0 });
  const f = fresnelV();
  m.colorNode = vec3(0.72, 0.9, 1.0);
  m.opacityNode = tpow(f, 3).mul(0.75).add(0.1);
  m.emissiveNode = vec3(0.2, 0.32, 0.4).mul(tpow(f, 4)).mul(0.5);
  return m;
}
function makeMaterials() {
  const scene = ST.scene;
  const env = scene && scene.environment ? null : makeEnv();
  ST.env = env || (scene && scene.environment) || null;
  DETAIL = texRef('entities/detail', { colorSpace: 'linear' }, [128, 160, 64, 128]);
  TEX.icons = texOf(iconAtlasCanvas(), true);
  TEX.screen = {};
  for (const k of ICONS) TEX.screen[k] = texOf(screenCanvas(k), true); // the item popping out of a broken monitor
  MAT.ent = entMaterial();
  MAT.ring = ringMaterial();
  MAT.screen = screenMaterial();
  MAT.arrow = arrowMaterial();
  MAT.wing = wingMaterial();
  MAT.glass = glassMaterial();
  if (env) for (const k of ['ent', 'ring', 'screen', 'wing', 'glass']) MAT[k].envMap = env;
  try { if (K.post && typeof K.post.ssr === 'function') K.post.ssr(MAT.glass, 0.5, 0.04); } catch (e) { /* optional */ }
}
// micro-bump strength per preset: Économie has no temporal AA, so the fine bumps would sparkle
function onGfx(g) {
  const q = g && g.preset;
  U.bump.value = q === 'low' ? 0.35 : 1;
  const lite = q === 'medium' || q === 'low';
  RING_FAR2 = lite ? 160 * 160 : 190 * 190;
  RING_NEAR2 = lite ? 18 * 18 : 26 * 26;
  LOD_D2 = lite ? 18 * 18 : 30 * 30;
}

// ===================== instanced part pools =====================
// Every model part (one merged template geometry) is drawn by ONE InstancedMesh shared by all the entities that use it.
// The entities keep their Object3D hierarchies for posing (outside the scene); each part is a holder whose world matrix
// is copied into its pool every tick (flush). A visible holder keeps its instance slot while it stays visible (stable
// indices: the motion vectors of the post pipeline stay right); a hidden one releases it (zero-scale matrix). The
// instance count follows the highest slot in use and the pool's bounding sphere covers its visible instances only, so
// the camera and every shadow cascade cull a whole pool at once.
const POOLS = [], POOLMAP = new Map(), ROOTS = [];
function poolOf(geo, opts) {
  let P = POOLMAP.get(geo);
  if (P) return P;
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  P = {
    geo, mat: (opts && opts.mat) || null, cast: !(opts && opts.cast === false), name: (opts && opts.name) || 'e-part', order: (opts && opts.order) || 0,
    slots: [], mesh: null, tint: null, taken: null, rel: [], c0: geo.boundingSphere.center.clone(), r0: geo.boundingSphere.radius
  };
  POOLMAP.set(geo, P); POOLS.push(P);
  return P;
}
// a part of an entity: holder under `group` + an instance of the pool of `geo`; returns the slot (s.t = tint)
// A part whose geometry has a far LOD (geo.userData.far, see lodTpl) gets a twin slot in the far pool, which casts no
// shadow: within LOD_D of the camera the near instance is drawn, beyond it the far one.
let LOD_D2 = 30 * 30; // 18 m on Moyen / Économie (onGfx)
function part(group, geo, opts) {
  if (!geo) return null;
  const h = new THREE.Object3D();
  group.add(h);
  const P = poolOf(geo, opts);
  const s = { P, h, idx: -1, t: [1, 1, 1, 0], lod: 0 };
  P.slots.push(s);
  const far = geo.userData.far;
  if (far) {
    const FP = poolOf(far, Object.assign({}, opts, { cast: false, name: ((opts && opts.name) || 'e-part') + '-far' }));
    s.lod = 1;
    FP.slots.push({ P: FP, h, idx: -1, t: s.t, lod: 2 });
  }
  return s;
}
// builds a template twice (near detail, then far LOD with LQ segments) and links each far part to its near part
function lodTpl(fn, q) {
  LQ = 1;
  const a = fn();
  let b = null;
  LQ = q || 0.45;
  try { b = fn(); } finally { LQ = 1; }
  const tris = g => (g.index ? g.index.count : g.attributes.position.count) / 3;
  for (const k in a) {
    const n = a[k], f = b && b[k];
    if (n && n.isBufferGeometry && f && f.isBufferGeometry && tris(f) < tris(n) * 0.8) n.userData.far = f;
    else if (f && f.isBufferGeometry && f !== n) f.dispose();
  }
  return a;
}
function addRoot(r) { ROOTS.push(r); return r; }
function tint(sl, c) { if (sl) { sl.t[0] = c.r; sl.t[1] = c.g; sl.t[2] = c.b; } }
function poolMesh(geo, mat, n, name) {
  const ta = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { ta[i * 4] = 1; ta[i * 4 + 1] = 1; ta[i * 4 + 2] = 1; }
  const tint = new THREE.InstancedBufferAttribute(ta, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iTint', tint);
  const M = new THREE.InstancedMesh(geo, mat, n);
  M.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  M.instanceMatrix.array.fill(0);
  M.count = 0; M.visible = false; M.name = name;
  M.receiveShadow = true;
  M.boundingSphere = new THREE.Sphere(new V3(), 1);
  M.userData.noEnv = true; // never captured into the environment map
  return { M, tint };
}
function makePools(scene) {
  for (const P of POOLS) {
    if (P.mesh) continue;
    const n = Math.max(1, P.slots.length);
    const { M, tint } = poolMesh(P.geo, P.mat || MAT.ent, n, P.name);
    M.castShadow = P.cast;
    M.renderOrder = P.order;
    P.mesh = M; P.tint = tint; P.taken = new Uint8Array(n);
    scene.add(M);
  }
}
const _bb = new THREE.Box3(), _bc = new V3(), _bw = new V3(), _cp = new V3();
function visChain(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }
function lodWant(s) {
  if (!s.lod) return true;
  const e = s.h.matrixWorld.elements, dx = e[12] - _cp.x, dy = e[13] - _cp.y, dz = e[14] - _cp.z;
  return (dx * dx + dy * dy + dz * dz < LOD_D2) === (s.lod === 1);
}
function flushPool(P) {
  const M = P.mesh;
  if (!M) return;
  const arr = M.instanceMatrix.array, ta = P.tint.array, tk = P.taken;
  let dirty = false, any = false;
  _bb.makeEmpty();
  for (const s of P.slots) {
    if (visChain(s.h) && lodWant(s)) {
      if (s.idx < 0) { let i = 0; while (tk[i]) i++; tk[i] = 1; s.idx = i; dirty = true; }
      const mw = s.h.matrixWorld, e = mw.elements, o = s.idx * 16;
      for (let k = 0; k < 16; k++) if (arr[o + k] !== e[k]) { arr[o + k] = e[k]; dirty = true; }
      const t = s.t, q = s.idx * 4;
      if (ta[q] !== t[0] || ta[q + 1] !== t[1] || ta[q + 2] !== t[2] || ta[q + 3] !== t[3]) {
        ta[q] = t[0]; ta[q + 1] = t[1]; ta[q + 2] = t[2]; ta[q + 3] = t[3];
        P.tint.needsUpdate = true;
      }
      _bc.copy(P.c0).applyMatrix4(mw);
      const r = P.r0 * mw.getMaxScaleOnAxis();
      _bb.expandByPoint(_bw.set(_bc.x - r, _bc.y - r, _bc.z - r));
      _bb.expandByPoint(_bw.set(_bc.x + r, _bc.y + r, _bc.z + r));
      any = true;
    } else if (s.idx >= 0) {
      const o = s.idx * 16;
      for (let k = 0; k < 12; k++) arr[o + k] = 0; // zero scale, keeps the translation (bounds stay sane)
      P.rel.push(s.idx); s.idx = -1; dirty = true;
    }
  }
  if (P.rel.length) { for (const i of P.rel) tk[i] = 0; P.rel.length = 0; }
  let c = tk.length;
  while (c > 0 && !tk[c - 1]) c--;
  M.count = c;
  M.visible = any;
  if (any) _bb.getBoundingSphere(M.boundingSphere);
  if (dirty) M.instanceMatrix.needsUpdate = true;
}
function flush() {
  const cam = K.view && K.view.camera;
  if (cam && finV(cam.position)) _cp.copy(cam.position);
  for (const r of ROOTS) if (r.visible) r.updateMatrixWorld(true);
  for (const P of POOLS) flushPool(P);
}
// geometry that never moves and is unique per object (spring pedestals, spike beds): baked in world space, one draw per
// 100 m chunk along the route (each chunk is culled on its own by the camera and the shadow cascades)
const STATIC = new Map();
function staticGB(z) { const k = Math.floor(z / 100); let g = STATIC.get(k); if (!g) STATIC.set(k, g = new GB()); return g; }
function buildStatic() { for (const gb of STATIC.values()) if (gb.count) part(addRoot(new THREE.Group()), gb.build(), { name: 'e-static' }); }

// ===================== FX (pooled point sprites) =====================
const FXS = { ready: false, add: null, alp: null, scale: { value: 700 }, map: null };
const GLOW_MAX = 220;
const glowBuf = new Float32Array(GLOW_MAX * 10);
let glowN = 0;
function glow(x, y, z, size, c, a, tile, rot) {
  if (glowN >= GLOW_MAX || !fin(x) || !fin(y) || !fin(z)) return;
  const o = glowN++ * 10;
  glowBuf[o] = x; glowBuf[o + 1] = y; glowBuf[o + 2] = z; glowBuf[o + 3] = size;
  glowBuf[o + 4] = c.r; glowBuf[o + 5] = c.g; glowBuf[o + 6] = c.b; glowBuf[o + 7] = a;
  glowBuf[o + 8] = tile || 0; glowBuf[o + 9] = rot || 0;
}
// built-in particles (the K.vfx fallback, plus a few small effects of the entities themselves): instanced sprites (atlas
// tile, rotation, size in world units; count = live particles), additive ones unfogged, alpha ones fogged.
function fxMaterial(additive) {
  return { additive, sprites: [] };
}
// fade = [near0, near1, far0, far1]: opacity rises from near0 to near1 metres from the camera, falls from far0 to far1
function fxSprite(n, additive, attrs, fade) {
  const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, fog: !additive, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  m.positionNode = instancedBufferAttribute(attrs.aPos);
  m.scaleNode = instancedBufferAttribute(attrs.aSize);
  m.rotationNode = instancedBufferAttribute(attrs.aRot);
  const col = instancedBufferAttribute(attrs.aCol), tile = instancedBufferAttribute(attrs.aTile);
  const u = tuv();
  const tuvn = vec2(u.x, float(1).sub(u.y)).add(vec2(tmod(tile, 2), tfloor(tile.mul(0.5).add(0.01)))).mul(0.5);
  const t = ttexture(FXS.map, tuvn);
  m.colorNode = col.xyz.mul(t.rgb);
  let a = col.w.mul(t.a);
  if (fade) {
    const dist = tlength(instancedBufferAttribute(attrs.aPos).sub(cameraPosition));
    a = a.mul(smoothstep(fade[0], fade[1], dist)).mul(float(1).sub(smoothstep(fade[2], fade[3], dist)));
  }
  m.opacityNode = a;
  m.alphaTest = 0.003;
  const sp = new THREE.Sprite(m);
  sp.count = 0;
  sp.frustumCulled = false;
  return sp;
}
function fxSystem(n, mat, order, scene) {
  const mk = size => new THREE.InstancedBufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage);
  const S = {
    n, cur: 0, parts: [],
    aPos: mk(3), aCol: mk(4), aSize: mk(1), aRot: mk(1), aTile: mk(1)
  };
  const pts = fxSprite(n, mat.additive, S);
  pts.renderOrder = order;
  // v2 kept a draw range on a point geometry: the sprite's instance count plays that part
  S.geo = { setDrawRange: (a, k) => { pts.count = k; } };
  scene.add(pts);
  S.pts = pts;
  for (let i = 0; i < n; i++) {
    S.parts.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, s0: 1, s1: 1, r0: 1, g0: 1, b0: 1, r1: 1, g1: 1, b1: 1, a0: 1, a1: 0, rot: 0, rv: 0, tile: 0, grav: 0, drag: 0, fade: 0, curve: 0 });
  }
  return S;
}
function initFX(scene) {
  FXS.map = new THREE.CanvasTexture(atlasCanvas());
  FXS.map.flipY = false; FXS.map.generateMipmaps = false;
  FXS.map.minFilter = THREE.LinearFilter; FXS.map.magFilter = THREE.LinearFilter;
  FXS.matAdd = fxMaterial(true);
  FXS.matAlp = fxMaterial(false);
  FXS.alp = fxSystem(520, FXS.matAlp, 20, scene);
  FXS.add = fxSystem(760, FXS.matAdd, 22, scene);
  FXS.ready = true;
}
function P_(S) {
  const p = S.parts[S.cur];
  S.cur = (S.cur + 1) % S.n;
  p.on = true; p.age = 0; p.grav = 0; p.drag = 0; p.rot = rand() * TAU; p.rv = 0; p.fade = 0; p.curve = 0; p.tile = 0;
  p.vx = p.vy = p.vz = 0;
  return p;
}
function pc(p, c0, c1, a0, a1) {
  p.r0 = c0.r; p.g0 = c0.g; p.b0 = c0.b;
  const c = c1 || c0;
  p.r1 = c.r; p.g1 = c.g; p.b1 = c.b;
  p.a0 = a0; p.a1 = a1;
}
function rdir(o, upBias) {
  let x, y, z, l;
  do { x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 1e-4);
  l = Math.sqrt(l);
  o.set(x / l, y / l + (upBias || 0), z / l);
  return o.normalize();
}
const FCOL = {
  white: lin('#ffffff'), cream: lin('#fff3c4'), gold: lin('#ffcf3a'), goldD: lin('#ff9a00'),
  fireW: lin('#fff8dc'), fireY: lin('#ffd76a'), fireO: lin('#ff7a1a'), fireR: lin('#b8220a'),
  smoke: lin('#55545e'), smokeL: lin('#9a98a4'), smokeD: lin('#2c2b33'), dust: lin('#f1e6cf'), dustD: lin('#cdbb98'),
  water: lin('#e6f7ff'), foam: lin('#ffffff'), ringGlow: lin('#ffb72e'), shot: lin('#ff9a1e'), shotC: lin('#fff2c0'),
  blue: lin('#59d8ff'), red: lin('#ff3a2a'), flame: lin('#ff8c2a'), flameC: lin('#fff0b0')
};
function fxSpark(pos, n) {
  const A = FXS.add;
  let p = P_(A); p.x = pos.x; p.y = pos.y; p.z = pos.z; p.life = 0.26; p.s0 = 1.7; p.s1 = 0.15; p.tile = 1; p.rot = rand() * 0.6; p.rv = 3;
  pc(p, FCOL.white, FCOL.gold, 1, 0.3);
  p = P_(A); p.x = pos.x; p.y = pos.y; p.z = pos.z; p.life = 0.22; p.s0 = 1.6; p.s1 = 0.4; p.tile = 0;
  pc(p, FCOL.cream, FCOL.goldD, 0.8, 0);
  for (let i = 0; i < n; i++) {
    p = P_(A); rdir(_u, 0.2);
    const s = 2.6 + rand() * 2.2;
    p.x = pos.x; p.y = pos.y; p.z = pos.z; p.vx = _u.x * s; p.vy = _u.y * s; p.vz = _u.z * s; p.drag = 3.2;
    p.life = 0.34 + rand() * 0.18; p.s0 = 0.55 + rand() * 0.25; p.s1 = 0.05; p.tile = 1; p.rv = (rand() - 0.5) * 6;
    pc(p, FCOL.cream, FCOL.gold, 1, 0);
  }
}
function fxTwinkle(pos, n, spread) {
  const A = FXS.add, sp = spread == null ? 0.35 : spread;
  for (let i = 0; i < n; i++) {
    const p = P_(A);
    p.x = pos.x + (rand() - 0.5) * sp * 2; p.y = pos.y + (rand() - 0.5) * sp * 2; p.z = pos.z + (rand() - 0.5) * sp * 2;
    p.vy = 0.4 + rand() * 0.5; p.life = 0.35 + rand() * 0.25; p.s0 = 0.05; p.s1 = 0.5 + rand() * 0.3; p.curve = 1; p.tile = 1; p.rot = 0; p.rv = (rand() - 0.5) * 2;
    pc(p, i % 2 ? FCOL.white : FCOL.gold, FCOL.cream, 1, 0.8);
  }
}
function fxDust(pos, n, col) {
  const S = FXS.alp;
  for (let i = 0; i < n; i++) {
    const p = P_(S), a = rand() * TAU, s = 1.1 + rand() * 1.4;
    p.x = pos.x + Math.cos(a) * 0.25; p.y = pos.y + 0.12 + rand() * 0.15; p.z = pos.z + Math.sin(a) * 0.25;
    p.vx = Math.cos(a) * s; p.vz = Math.sin(a) * s; p.vy = 0.4 + rand() * 0.7; p.drag = 3.4;
    p.life = 0.5 + rand() * 0.3; p.s0 = 0.45 + rand() * 0.2; p.s1 = 1.3 + rand() * 0.5; p.tile = 2; p.rv = (rand() - 0.5) * 1.5;
    pc(p, col || FCOL.dust, FCOL.dustD, 0.62, 0);
  }
}
function fxSmoke(pos, n, dark) {
  const S = FXS.alp;
  for (let i = 0; i < n; i++) {
    const p = P_(S);
    p.x = pos.x + (rand() - 0.5) * 0.5; p.y = pos.y + (rand() - 0.5) * 0.4; p.z = pos.z + (rand() - 0.5) * 0.5;
    p.vx = (rand() - 0.5) * 0.8; p.vy = 1.2 + rand() * 0.8; p.vz = (rand() - 0.5) * 0.8; p.drag = 0.8;
    p.life = 1.0 + rand() * 0.5; p.s0 = 0.7 + rand() * 0.3; p.s1 = 2.0 + rand() * 0.8; p.tile = 2; p.fade = 0.12; p.rv = (rand() - 0.5);
    pc(p, dark ? FCOL.smokeD : FCOL.smoke, FCOL.smokeL, dark ? 0.75 : 0.55, 0);
  }
}
function fxSplash(pos, n) {
  const S = FXS.alp;
  for (let i = 0; i < n; i++) {
    const p = P_(S), a = rand() * TAU, h = 1.4 + rand() * 1.8;
    p.x = pos.x + Math.cos(a) * 0.2; p.y = pos.y + 0.05; p.z = pos.z + Math.sin(a) * 0.2;
    p.vx = Math.cos(a) * h; p.vz = Math.sin(a) * h; p.vy = 4 + rand() * 4; p.grav = 22;
    p.life = 0.55 + rand() * 0.3; p.s0 = 0.2 + rand() * 0.14; p.s1 = 0.1; p.tile = 3;
    pc(p, FCOL.water, FCOL.foam, 0.95, 0.5);
  }
  const k = Math.max(1, Math.round(n / 5));
  for (let i = 0; i < k; i++) {
    const p = P_(S);
    p.x = pos.x + (rand() - 0.5) * 0.6; p.y = pos.y + 0.15; p.z = pos.z + (rand() - 0.5) * 0.6; p.vy = 0.6;
    p.life = 0.55 + rand() * 0.2; p.s0 = 0.7; p.s1 = 2.0 + rand() * 0.6; p.tile = 2;
    pc(p, FCOL.foam, FCOL.foam, 0.75, 0);
  }
}
function fxBoom(pos, sc) { if (!vfx('boom', pos, sc)) fxBoomP(pos, sc); }
function fxBoomP(pos, sc) {
  const A = FXS.add, S = FXS.alp;
  let p = P_(A);
  p.x = pos.x; p.y = pos.y; p.z = pos.z; p.life = 0.17; p.s0 = 3.4 * sc; p.s1 = 1.2 * sc; p.tile = 0;
  pc(p, FCOL.fireW, FCOL.fireY, 1, 0);
  const nf = Math.round(8 * sc);
  for (let i = 0; i < nf; i++) {
    p = P_(A); rdir(_u, 0.35);
    const s = (2.4 + rand() * 2.6) * sc;
    p.x = pos.x + _u.x * 0.2; p.y = pos.y + _u.y * 0.2; p.z = pos.z + _u.z * 0.2;
    p.vx = _u.x * s; p.vy = _u.y * s; p.vz = _u.z * s; p.drag = 4.2;
    p.life = 0.36 + rand() * 0.22; p.s0 = (0.9 + rand() * 0.5) * sc; p.s1 = (1.8 + rand() * 0.6) * sc; p.tile = 0;
    pc(p, FCOL.fireY, FCOL.fireR, 1, 0);
  }
  const ns = Math.round(5 * sc);
  for (let i = 0; i < ns; i++) {
    p = P_(S); rdir(_u, 0.5);
    const s = (1.0 + rand() * 1.4) * sc;
    p.x = pos.x; p.y = pos.y; p.z = pos.z;
    p.vx = _u.x * s; p.vy = _u.y * s + 1.1; p.vz = _u.z * s; p.drag = 2;
    p.life = 0.8 + rand() * 0.4; p.s0 = 0.8 * sc; p.s1 = (2.2 + rand() * 0.8) * sc; p.tile = 2; p.fade = 0.18; p.rv = (rand() - 0.5) * 2;
    pc(p, FCOL.smoke, FCOL.smokeL, 0.62, 0);
  }
  const nk = Math.round(7 * sc);
  for (let i = 0; i < nk; i++) {
    p = P_(A); rdir(_u, 0.6);
    const s = (5.5 + rand() * 4) * sc;
    p.x = pos.x; p.y = pos.y; p.z = pos.z; p.vx = _u.x * s; p.vy = _u.y * s; p.vz = _u.z * s; p.grav = 16; p.drag = 1.2;
    p.life = 0.35 + rand() * 0.2; p.s0 = 0.38 * sc; p.s1 = 0.05; p.tile = 1; p.rv = 8;
    pc(p, FCOL.fireW, FCOL.fireO, 1, 0.2);
  }
}
function burst(pos, kind, n) {
  if (!FXS.ready || !finV(pos)) return;
  const k = fin(n) && n > 0 ? Math.min(Math.floor(n), 48) : 0;
  switch (kind) {
    case 'boom': for (let i = 0, c = clamp(k || 1, 1, 5); i < c; i++) { if (i) { rdir(_w); _w.multiplyScalar(0.7).add(pos); fxBoom(_w, 0.85); } else fxBoom(pos, 1); } break;
    case 'bigboom': for (let i = 0, c = clamp(k || 1, 1, 4); i < c; i++) { if (i) { rdir(_w); _w.multiplyScalar(1.2).add(pos); fxBoom(_w, 1.4); } else fxBoom(pos, 1.9); } break;
    case 'spark': fxSpark(pos, k || 4); break;
    case 'twinkle': fxTwinkle(pos, k || 3); break;
    case 'dust': fxDust(pos, k || 4); break;
    case 'splash': fxSplash(pos, k || 10); break;
    case 'smoke': fxSmoke(pos, k || 1, false); break;
    default: fxSpark(pos, k || 3);
  }
}
function updFX(dt) {
  if (!FXS.ready) return;
  for (const S of [FXS.alp, FXS.add]) {
    for (let i = 0; i < S.n; i++) {
      const p = S.parts[i];
      if (!p.on) continue;
      p.age += dt;
      if (p.age >= p.life) { p.on = false; continue; }
      if (p.grav) p.vy -= p.grav * dt;
      if (p.drag) { const f = Math.max(0, 1 - p.drag * dt); p.vx *= f; p.vy *= f; p.vz *= f; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rot += p.rv * dt;
    }
  }
}
function writeSys(S, extra) {
  const pos = S.aPos.array, col = S.aCol.array, siz = S.aSize.array, rot = S.aRot.array, til = S.aTile.array;
  let k = 0;
  for (let i = 0; i < S.n; i++) {
    const p = S.parts[i];
    if (!p.on) continue;
    const t = p.age / p.life;
    let a = p.a0 + (p.a1 - p.a0) * t;
    if (p.fade > 0 && t < p.fade) a *= t / p.fade;
    const s = p.curve ? p.s0 + (p.s1 - p.s0) * Math.sin(t * Math.PI) : p.s0 + (p.s1 - p.s0) * easeOut(t);
    pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z;
    col[k * 4] = p.r0 + (p.r1 - p.r0) * t; col[k * 4 + 1] = p.g0 + (p.g1 - p.g0) * t; col[k * 4 + 2] = p.b0 + (p.b1 - p.b0) * t; col[k * 4 + 3] = a;
    siz[k] = s; rot[k] = p.rot; til[k] = p.tile;
    k++;
  }
  if (extra) {
    for (let j = 0; j < glowN && k < S.n; j++, k++) {
      const o = j * 10;
      pos[k * 3] = glowBuf[o]; pos[k * 3 + 1] = glowBuf[o + 1]; pos[k * 3 + 2] = glowBuf[o + 2];
      siz[k] = glowBuf[o + 3];
      col[k * 4] = glowBuf[o + 4]; col[k * 4 + 1] = glowBuf[o + 5]; col[k * 4 + 2] = glowBuf[o + 6]; col[k * 4 + 3] = glowBuf[o + 7];
      til[k] = glowBuf[o + 8]; rot[k] = glowBuf[o + 9];
    }
  }
  S.geo.setDrawRange(0, k);
  if (k > 0) {
    for (const [a, sz] of [[S.aPos, 3], [S.aCol, 4], [S.aSize, 1], [S.aRot, 1], [S.aTile, 1]]) {
      a.clearUpdateRanges(); a.addUpdateRange(0, k * sz); a.needsUpdate = true;
    }
  }
}
function writeFX() {
  if (!FXS.ready) return;
  const V = K.view, R = V && V.renderer, cam = V && V.camera;
  if (R && cam && R.domElement) {
    const h = R.domElement.height || 540, f = fin(cam.fov) ? cam.fov : 62;
    FXS.scale.value = h / (2 * Math.tan(f * Math.PI / 360));
  }
  writeSys(FXS.alp, false);
  writeSys(FXS.add, true);
}
function clearFX() {
  if (!FXS.ready) return;
  for (const S of [FXS.alp, FXS.add]) { for (const p of S.parts) p.on = false; S.geo.setDrawRange(0, 0); }
  glowN = 0;
}

// ===================== state =====================
const ST = { built: false, scene: null, T: 0, frame: 0, chain: 0, env: null, away: false, own: [] };
const CHAIN = [100, 200, 500, 1000];
const ents = [];           // generic {root, home, vis, show} for distance culling

// ===================== rings =====================
// Every ring is an instance of one of two InstancedMeshes: a detailed ring near the camera, a light one farther out
// (stable slots per ring, see the part pools), spun by its instance matrix; no shadows (a spinning ring's shadow is a
// flicker that costs one draw per cascade). A soft halo sprite keeps the far ones sparkling.
const RG = { n: 0, pos: [], got: [], near: null, far: null, spin: 0, lost: [], lostMesh: null, lostSpin: 0, glowGeo: null, glowAttr: null, twk: 0, lostDirty: false };
let RING_FAR2 = 190 * 190;   // farther rings are a few pixels wide: only their glow sprite is drawn (160 m on Moyen / Économie)
let RING_NEAR2 = 26 * 26;    // detailed rings within this distance of the camera (18 m on Moyen / Économie)
// polished ring: a superellipse cross-section (flat faces, rounded edges -> crisp highlight bands) swept around Z
function ringGeometry(seg, prof) {
  const R = 0.44, a = 0.092, b = 0.068, e = 2.6;
  const pos = [], nor = [], uvs = [], am = [], col = [], idx = [], P = [];
  for (let j = 0; j < prof; j++) {
    const t = j / prof * TAU, c = Math.cos(t), s = Math.sin(t);
    const x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / e), z = b * Math.sign(s) * Math.pow(Math.abs(s), 2 / e);
    const nx = Math.sign(x) * Math.pow(Math.abs(x / a), e - 1) / a, nz = Math.sign(z) * Math.pow(Math.abs(z / b), e - 1) / b;
    const l = Math.hypot(nx, nz) || 1;
    P.push([R + x, z, nx / l, nz / l]);
  }
  for (let i = 0; i <= seg; i++) {
    const f = i / seg * TAU, cf = Math.cos(f), sf = Math.sin(f);
    for (let j = 0; j < prof; j++) {
      const [r, z, nr, nz] = P[j];
      pos.push(r * cf, r * sf, z); nor.push(nr * cf, nr * sf, nz); uvs.push(i / seg, j / prof);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < prof; j++) {
    const a0 = i * prof + j, a1 = i * prof + (j + 1) % prof, b0 = a0 + prof, b1 = a1 + prof;
    idx.push(a0, b0, a1, a1, b0, b1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
// ring instance matrix: spin about the world Y axis, then the ring's position
function setRingMatrix(arr, i, x, y, z, sc, c, s) {
  const o = i * 16;
  if (c === undefined) { c = 1; s = 0; }
  arr[o] = c * sc; arr[o + 1] = 0; arr[o + 2] = -s * sc; arr[o + 3] = 0;
  arr[o + 4] = 0; arr[o + 5] = sc; arr[o + 6] = 0; arr[o + 7] = 0;
  arr[o + 8] = s * sc; arr[o + 9] = 0; arr[o + 10] = c * sc; arr[o + 11] = 0;
  arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
}
function ringPool(geo, n, name) {
  const { M } = poolMesh(geo, MAT.ring, n, name);
  M.castShadow = false;
  const S = new Int16Array(RG.n);
  S.fill(-1);
  return { M, S, taken: new Uint8Array(n), rel: [] };
}
function buildRings(scene) {
  const L = K.level && Array.isArray(K.level.rings) ? K.level.rings : [];
  for (const r of L) if (finV(r)) RG.pos.push(new V3(r.x, r.y, r.z));
  RG.n = RG.pos.length;
  RG.got = new Uint8Array(RG.n);
  if (RG.n) {
    RG.near = ringPool(ringGeometry(40, 14), RG.n, 'e-ring');
    RG.far = ringPool(ringGeometry(14, 6), RG.n, 'e-ring-far');
    scene.add(RG.near.M, RG.far.M);
    // soft golden halo behind every ring (one static sprite cloud), only away from the camera
    const p = new Float32Array(RG.n * 3), c = new Float32Array(RG.n * 4), s = new Float32Array(RG.n), r = new Float32Array(RG.n), t = new Float32Array(RG.n);
    for (let i = 0; i < RG.n; i++) {
      p[i * 3] = RG.pos[i].x; p[i * 3 + 1] = RG.pos[i].y; p[i * 3 + 2] = RG.pos[i].z;
      c[i * 4] = FCOL.ringGlow.r; c[i * 4 + 1] = FCOL.ringGlow.g; c[i * 4 + 2] = FCOL.ringGlow.b; c[i * 4 + 3] = 0.3;
      s[i] = 1.6;
    }
    RG.glowAttr = new THREE.InstancedBufferAttribute(c, 4);
    const pts = fxSprite(RG.n, true, { aPos: new THREE.InstancedBufferAttribute(p, 3), aCol: RG.glowAttr, aSize: new THREE.InstancedBufferAttribute(s, 1), aRot: new THREE.InstancedBufferAttribute(r, 1), aTile: new THREE.InstancedBufferAttribute(t, 1) }, [10, 30, 170, 235]);
    pts.count = RG.n;
    pts.renderOrder = 19;
    pts.name = 'e-ringglow';
    pts.userData.noEnv = true;
    scene.add(pts);
    RG.glowGeo = pts;
  }
  for (let i = 0; i < 32; i++) RG.lost.push({ on: false, pos: new V3(), vel: new V3(), t: 0 });
  const { M } = poolMesh(ringGeometry(36, 12), MAT.ring, 32, 'e-lostring');
  M.castShadow = false; M.frustumCulled = false;
  RG.lostMesh = M;
  scene.add(M);
}
function setRingGot(i, got) {
  RG.got[i] = got ? 1 : 0;
  if (RG.glowAttr) { RG.glowAttr.array[i * 4 + 3] = got ? 0 : 0.3; RG.glowAttr.needsUpdate = true; }
}
function ringSlot(R, i, on, p, c, s) {
  const arr = R.M.instanceMatrix.array;
  let k = R.S[i];
  if (on) {
    if (k < 0) { k = 0; while (R.taken[k]) k++; R.taken[k] = 1; R.S[i] = k; }
    setRingMatrix(arr, k, p.x, p.y, p.z, 1, c, s);
  } else if (k >= 0) {
    setRingMatrix(arr, k, p.x, p.y, p.z, 0);
    R.rel.push(k); R.S[i] = -1;
  }
}
function ringDone(R, box) {
  for (const k of R.rel) R.taken[k] = 0;
  R.rel.length = 0;
  let c = R.taken.length;
  while (c > 0 && !R.taken[c - 1]) c--;
  R.M.count = c;
  R.M.visible = c > 0;
  if (c > 0) { box.expandByScalar(0.6); box.getBoundingSphere(R.M.boundingSphere); }
  R.M.instanceMatrix.needsUpdate = true;
}
const _rbN = new THREE.Box3(), _rbF = new THREE.Box3();
// every tick: spin + LOD + distance cull; a ring keeps its slot while it stays in the same LOD
function writeRings() {
  if (!RG.near) return;
  const cam = K.view && K.view.camera, cp = cam && finV(cam.position) ? cam.position : null;
  const c = Math.cos(RG.spin), s = Math.sin(RG.spin), N = RG.near, F = RG.far;
  _rbN.makeEmpty(); _rbF.makeEmpty();
  for (let i = 0; i < RG.n; i++) {
    const p = RG.pos[i];
    let lod = 0;
    if (!RG.got[i]) {
      lod = 2;
      if (cp) { const dx = p.x - cp.x, dy = p.y - cp.y, dz = p.z - cp.z, dd = dx * dx + dy * dy + dz * dz; lod = dd > RING_FAR2 ? 0 : dd > RING_NEAR2 ? 2 : 1; }
    }
    ringSlot(N, i, lod === 1, p, c, s);
    ringSlot(F, i, lod === 2, p, c, s);
    if (lod === 1) _rbN.expandByPoint(p); else if (lod === 2) _rbF.expandByPoint(p);
  }
  ringDone(N, _rbN);
  ringDone(F, _rbF);
}
function resetRings() {
  for (let i = 0; i < RG.n; i++) if (RG.got[i]) setRingGot(i, false);
  for (const r of RG.lost) r.on = false;
  RG.lostDirty = true;
}
function updRings(dt) {
  RG.spin = (RG.spin + dt * 4.4) % TAU;
  RG.lostSpin = (RG.lostSpin + dt * 10) % TAU;
  writeRings();
  if (PL.ok && RG.n) {
    const cx = PL.c.x, cy = PL.c.y, cz = PL.c.z, R = 1.3, R2 = R * R;
    for (let i = 0; i < RG.n; i++) {
      if (RG.got[i]) continue;
      const p = RG.pos[i], dz = p.z - cz;
      if (dz > R || dz < -R) continue;
      const dx = p.x - cx;
      if (dx > R || dx < -R) continue;
      const dy = p.y - cy;
      if (dx * dx + dy * dy + dz * dz < R2) {
        setRingGot(i, true);
        gcall('addRings', 1);
        ringFx(p);
      }
    }
  }
  // occasional glints on nearby rings
  RG.twk -= dt;
  if (RG.twk <= 0 && RG.n && finV(PL.pos)) {
    RG.twk = 0.07;
    const i = Math.floor(rand() * RG.n);
    if (!RG.got[i] && d2(RG.pos[i], PL.pos) < 40 * 40) {
      const p = RG.pos[i], a = rand() * TAU;
      _w.set(p.x + Math.cos(a) * 0.38 * Math.cos(RG.spin), p.y + Math.sin(a) * 0.4, p.z - Math.cos(a) * 0.38 * Math.sin(RG.spin));
      fxTwinkle(_w, 1, 0.02);
    }
  }
  updLostRings(dt);
}
// a ring line would bury Kit under starbursts: the full burst at most every 0.15 s, twinkles between
let ringFxT = -9;
function ringFx(p) {
  if (ST.T - ringFxT > 0.15) { if (vfx('ringPickup', p, PL.vel)) { ringFxT = ST.T; return; } }
  else if (vfx('twinkle', p, 4, 0xffd23f)) return;
  burst(p, 'spark', 4);
}
function scatterRings(center, n) {
  if (!ST.built || !finV(center)) return;
  n = Math.min(32, Math.floor(fin(n) ? n : 0));
  if (n <= 0) return;
  const a0 = rand() * TAU;
  for (let i = 0; i < n; i++) {
    let r = null;
    for (const q of RG.lost) if (!q.on) { r = q; break; }
    if (!r) { r = RG.lost[0]; for (const q of RG.lost) if (q.t > r.t) r = q; }
    const layer = i < 16 ? 0 : 1, k = i % 16;
    const a = a0 + k * (TAU / 16) + layer * (TAU / 32);
    const hs = layer ? 4.2 : 7.2, vs = layer ? 12 : 9;
    r.on = true; r.t = 0;
    r.pos.set(center.x, center.y + 0.2, center.z);
    r.vel.set(Math.cos(a) * hs, vs + rand() * 1.5, Math.sin(a) * hs);
  }
  RG.lostDirty = true;
}
function updLostRings(dt) {
  const arr = RG.lostMesh ? RG.lostMesh.instanceMatrix.array : null;
  if (!arr) return;
  let any = RG.lostDirty;
  RG.lostDirty = false;
  const sea = seaY(), dy0 = deathY(), lc = Math.cos(RG.lostSpin), ls = Math.sin(RG.lostSpin);
  for (let i = 0; i < RG.lost.length; i++) {
    const r = RG.lost[i];
    if (!r.on) { if (any) setRingMatrix(arr, i, 0, -1e4, 0, 0); continue; }
    any = true;
    r.t += dt;
    if (r.t >= 4.5) { r.on = false; setRingMatrix(arr, i, 0, -1e4, 0, 0); continue; }
    const v = r.vel, p = r.pos;
    v.y -= 26 * dt;
    const ox = p.x, oz = p.z;
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
    if (terrainY(p.x, p.z) > p.y + 0.6) { p.x = ox; p.z = oz; v.x *= -0.5; v.z *= -0.5; }
    const g = ground(p.x, p.z, p.y + 0.6);
    if (g && p.y - 0.45 < g.y && v.y < 0) {
      p.y = g.y + 0.45;
      v.y = -v.y * 0.62;
      if (v.y < 1.6) v.y = 0;
      v.x *= 0.82; v.z *= 0.82;
    } else if (!g && p.y < sea) {
      _w.set(p.x, sea, p.z); fxSplash(_w, 4); r.on = false; setRingMatrix(arr, i, 0, -1e4, 0, 0); continue;
    }
    if (p.y < dy0 - 10) { r.on = false; setRingMatrix(arr, i, 0, -1e4, 0, 0); continue; }
    if (r.t > 1 && PL.ok && d2(p, PL.c) < 1.3 * 1.3) {
      r.on = false; setRingMatrix(arr, i, 0, -1e4, 0, 0);
      gcall('addRings', 1); ringFx(p);
      continue;
    }
    const blink = r.t > 3 && (Math.floor(r.t * (r.t > 3.8 ? 16 : 10)) % 2 === 1);
    setRingMatrix(arr, i, p.x, p.y, p.z, blink ? 0 : 1, lc, ls);
  }
  if (any) {
    let last = -1;
    for (let i = 0; i < RG.lost.length; i++) if (RG.lost[i].on) last = i;
    RG.lostMesh.count = last + 1;
    RG.lostMesh.visible = last >= 0;
    RG.lostMesh.instanceMatrix.needsUpdate = true;
  }
}

// ===================== models =====================
// Procedural models (same proportions and pivots as v2), one merged geometry per animated part; surfaces from MT.
const TPL = {};
const EYE = [0.25, 0, 0.6, K_GLOW];   // emissive eye domes: lit from inside, still shaded
function bolts(g, n, r, y, size, col, a0) { for (let i = 0; i < n; i++) { const a = (a0 || 0) + i / n * TAU; g.chrome.add(sph(size, 8, 6), col || COL.silver, TRS(Math.cos(a) * r, y, Math.sin(a) * r)); } }
function tplBug() {
  const shell = (x, y, z, o) => o.copy(COL.red).lerp(COL.redD, clamp((1 - y) * 0.55, 0, 0.6));
  const body = partsOf((g) => {
    g.metal.add(cyl(0.5, 0.56, 0.16, 32), COL.steelD, TRS(0, 0.33, 0, 0, 0, 0, 1, 1, 1.18));
    g.chrome.add(tor(0.53, 0.045, 10, 40), COL.silver, TRS(0, 0.41, 0, Math.PI / 2, 0, 0, 1, 1.18, 1));
    g.paint.add(sphPart(28, 12, 0, TAU, 0, Math.PI / 2), COL.black, TRS(0, 0.4, -0.04, 0, 0, 0, 0.56, 0.49, 0.68));
    for (const s of [-1, 1]) {
      g.paint.add(sphPart(28, 16, s > 0 ? Math.PI / 2 : -Math.PI / 2, Math.PI, 0, Math.PI / 2), shell, TRS(s * 0.035, 0.41, -0.04, 0, 0, 0, 0.6, 0.53, 0.72));
      for (const [a, b, c, r] of HI() ? [[0.62, 0.6, 0.45, 0.1], [0.42, 0.82, -0.2, 0.12], [0.9, 0.32, -0.25, 0.09], [0.4, 0.5, -0.78, 0.1], [0.75, 0.25, 0.55, 0.07]] : [[0.62, 0.6, 0.45, 0.12], [0.42, 0.82, -0.2, 0.13], [0.4, 0.5, -0.78, 0.12]]) {
        _v.set(a, b, c).normalize();
        const px = s * _v.x * 0.6 + s * 0.035, py = 0.41 + _v.y * 0.53, pz = -0.04 + _v.z * 0.72;
        _w.set(s * _v.x / 0.6, _v.y / 0.53, _v.z / 0.72).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(ZV, _w);
        g.paint.add(sph(1, 12, 6), COL.black, TRq(px, py, pz, q, r, r, 0.03));
      }
      // eyes: chrome bezel, white ball, glowing red lens, glint
      g.chrome.add(tor(0.118, 0.03, 10, 24), COL.silver, TRS(s * 0.13, 0.56, 0.775, 0, s * 0.3, 0));
      g.gloss.add(sph(0.108, 20, 14), COL.eyeW, TRS(s * 0.13, 0.56, 0.76));
      g.glow.add(sph(0.05, 14, 10), COL.lensR, TRS(s * 0.145, 0.565, 0.86, 0, 0, 0, 1, 1, 0.45));
      g.glow.add(sph(0.018, 8, 6), COL.eyeW, TRS(s * 0.12, 0.6, 0.875));
      // antennae
      stick(g.chrome, s * 0.08, 0.68, 0.62, s * 0.2, 1.02, 0.82, 0.022, 0.016, COL.silver, 8);
      g.glow.add(sph(0.055, 12, 8), COL.yellow, TRS(s * 0.205, 1.04, 0.83));
      if (HI()) g.chrome.add(tor(0.03, 0.012, 6, 12), COL.silver, TRS(s * 0.197, 1.0, 0.82, Math.PI / 2, 0, 0));
      // mandibles
      g.chrome.add(cone(0.045, 0.2, 10), COL.silver, TRS(s * 0.09, 0.36, 0.86, Math.PI / 2, 0, -s * 0.35));
      // side bolts + an exhaust grille
      if (HI()) for (const z of [0.3, 0, -0.3]) g.chrome.add(sph(0.038, 10, 8), COL.silver, TRS(s * 0.565, 0.34, z));
    }
    if (HI()) for (let i = 0; i < 4; i++) g.metal.add(box(0.26, 0.018, 0.03), COL.ink, TRS(0, 0.36 + i * 0.03, -0.66 + i * 0.012, -0.35, 0, 0));
    g.gloss.add(sph(0.27, 24, 16), COL.ink, TRS(0, 0.47, 0.6, 0, 0, 0, 1.06, 0.88, 0.9));
    g.chrome.add(tor(0.2, 0.02, 6, 24), COL.steelL, TRS(0, 0.47, 0.62, 0.15, 0, 0, 1.2, 1, 1));
  });
  const axle = partsOf((g) => {
    for (const s of [-1, 1]) {
      g.rubber.add(cyl(0.165, 0.165, 0.12, 28), COL.tire, TRS(s * 0.47, 0, 0, 0, 0, Math.PI / 2));
      if (HI()) g.rubber.add(tor(0.15, 0.03, 6, 28), COL.tire, TRS(s * 0.47 + s * 0.06, 0, 0, 0, Math.PI / 2, 0));
      g.chrome.add(cyl(0.09, 0.09, 0.135, 16), COL.hub, TRS(s * 0.475, 0, 0, 0, 0, Math.PI / 2));
      g.chrome.add(box(0.02, 0.25, 0.05), COL.hub, TRS(s * 0.54, 0, 0));
      g.chrome.add(box(0.02, 0.05, 0.25), COL.hub, TRS(s * 0.54, 0, 0));
      if (HI()) g.metal.add(cyl(0.03, 0.03, 0.03, 10), COL.steelD, TRS(s * 0.555, 0, 0, 0, 0, Math.PI / 2));
    }
  });
  return { body, axle };
}
function tplWasp() {
  const body = partsOf((g) => {
    g.paint.add(sph(0.27, 24, 18), (x, y, z, o) => o.copy(COL.gun).lerp(COL.waspY, y > 0.12 && y < 0.2 ? 1 : 0), TRS(0, 0, 0, 0, 0, 0, 1, 0.95, 1.1));
    g.paint.add(tor(0.262, 0.04, 10, 32), COL.waspY, TRS(0, 0, 0.0, 0, 0, 0, 1, 0.95, 1));
    g.chrome.add(tor(0.16, 0.045, 10, 24), COL.silver, TRS(0, 0.03, 0.27));
    g.paint.add(sph(0.245, 26, 18), (x, y, z, o) => o.copy(COL.gun).lerp(COL.waspY, smooth((z - 0.02) / 0.14) * (1 - smooth((y + 0.02) / 0.1))), TRS(0, 0.05, 0.42));
    g.metal.add(tor(0.2, 0.03, 8, 26), COL.waspK, TRS(0, 0.06, 0.39, 0, 0, 0, 1, 1.05, 1));
    for (const s of [-1, 1]) {
      g.mat(EYE).add(sph(1, 20, 16), COL.eyeR, TRS(s * 0.155, 0.1, 0.53, 0, s * 0.5, 0, 0.1, 0.15, 0.115));
      g.glow.add(sph(0.026, 8, 6), COL.eyeW, TRS(s * 0.17, 0.18, 0.6));
      g.glow.add(sph(0.014, 6, 5), COL.eyeW, TRS(s * 0.2, 0.06, 0.6));
      stick(g.chrome, s * 0.07, 0.26, 0.46, s * 0.2, 0.5, 0.8, 0.02, 0.014, COL.silver, 8);
      g.glow.add(sph(0.045, 10, 8), COL.yellow, TRS(s * 0.205, 0.51, 0.81));
      g.chrome.add(cone(0.035, 0.16, 10), COL.silver, TRS(s * 0.07, -0.1, 0.62, Math.PI / 2 + 0.4, 0, -s * 0.4));
      for (const z of [0.12, 0, -0.12]) stick(g.metal, s * 0.13, -0.18, z, s * 0.24, -0.42, z + 0.08, 0.018, 0.014, COL.steelL, 6);
      if (HI()) g.chrome.add(sph(0.03, 8, 6), COL.silver, TRS(s * 0.25, 0.02, 0.08));
    }
  });
  const prof = [[0.0, 0], [0.17, 0.05], [0.27, 0.18], [0.31, 0.36], [0.29, 0.56], [0.22, 0.76], [0.12, 0.9], [0.0, 0.98]];
  const rAt = (y) => {
    for (let i = 1; i < prof.length; i++) if (y <= prof[i][1]) { const a = prof[i - 1], b = prof[i]; return lerp(a[0], b[0], (y - a[1]) / (b[1] - a[1] || 1)); }
    return 0;
  };
  const abd = partsOf((g) => {
    const bands = [[0, 0.17, COL.waspK], [0.17, 0.33, COL.waspY], [0.33, 0.47, COL.waspK], [0.47, 0.63, COL.waspY], [0.63, 0.75, COL.waspK], [0.75, 0.98, COL.waspY]];
    for (const [a, b, col] of bands) {
      const pts = [];
      const nb = HI() ? 6 : 2;
      for (let i = 0; i <= nb; i++) { const y = a + (b - a) * i / nb; pts.push([rAt(y), y]); }
      g.paint.add(lathe(pts, 28), col, TRS(0, 0, 0, -Math.PI / 2, 0, 0));
    }
    if (HI()) for (const y of [0.17, 0.47, 0.75]) g.chrome.add(tor(rAt(y) + 0.004, 0.012, 6, 28), COL.steelL, TRS(0, 0, -y, 0, 0, 0));
    g.chrome.add(cone(0.075, 0.32, 12), COL.silver, TRS(0, 0, -1.12, -Math.PI / 2, 0, 0));
    g.glow.add(sph(0.05, 10, 8), COL.orange, TRS(0, 0, -1.28));
  });
  const wing = (() => {
    const gb = new GB();
    gb.add(sph(1, 20, 6), COL.white, TRS(0.36, 0, 0.02, 0, 0.28, 0, 0.38, 0.012, 0.13));
    gb.add(sph(1, 20, 6), COL.white, TRS(0.26, -0.02, -0.16, 0, 0.5, 0, 0.27, 0.01, 0.1));
    return gb.build();
  })();
  return { body, abd, wing };
}
function tplFish() {
  const skin = (x, y, z, o) => {
    o.copy(COL.fishB).lerp(COL.fishBD, smooth((y - 0.1) / 0.8));
    const belly = smooth((-y - 0.15) / 0.45) * smooth((z + 0.6) / 0.6);
    o.lerp(COL.fishW, belly);
  };
  const body = partsOf((g) => {
    g.paint.add(sph(1, 30, 20), skin, TRS(0, 0, 0, 0, 0, 0, 0.37, 0.45, 0.6));
    g.chrome.add(tor(0.36, 0.035, 10, 32), COL.silver, TRS(0, 0, -0.24, 0, 0, 0, 0.95, 1.12, 1));
    if (HI()) for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; g.chrome.add(sph(0.03, 8, 6), COL.silver, TRS(Math.cos(a) * 0.36, Math.sin(a) * 0.42, -0.2)); }
    g.soft.add(sph(1, 18, 12), COL.mouth, TRS(0, -0.14, 0.42, 0, 0, 0, 0.25, 0.14, 0.18));
    for (const s of [-1, 1]) {
      if (HI()) g.chrome.add(tor(0.13, 0.018, 6, 20), COL.silver, TRS(s * 0.2, 0.17, 0.37, 0, s * 0.5, 0));
      g.gloss.add(sph(0.13, 18, 14), COL.eyeW, TRS(s * 0.2, 0.17, 0.36));
      g.mat(EYE).add(sph(0.062, 14, 10), COL.lensR, TRS(s * 0.245, 0.18, 0.455));
      g.glow.add(sph(0.02, 6, 5), COL.eyeW, TRS(s * 0.23, 0.21, 0.5));
      g.paint.add(box(0.2, 0.05, 0.08), COL.fishBD, TRS(s * 0.2, 0.32, 0.38, 0, 0, s * 0.42));
      g.paint.add(sph(1, 14, 8), COL.fin, TRS(s * 0.38, -0.1, 0.02, 0.3, s * 0.5, s * 0.6, 0.05, 0.16, 0.24));
    }
    for (let i = 0; i < 6; i++) { const x = (i - 2.5) * 0.072; g.gloss.add(cone(0.034, 0.1, 8), COL.tooth, TRS(x, -0.09, 0.565 - x * x * 2.2, Math.PI, 0, 0)); }
    g.paint.add(cone(0.22, 0.42, 16), COL.fin, TRS(0, 0.48, -0.08, -0.45, 0, 0, 0.22, 1, 1));
  });
  const jaw = partsOf((g) => {
    g.paint.add(sphPart(22, 8, 0, TAU, Math.PI / 2, Math.PI / 2), (x, y, z, o) => o.copy(COL.fishW).lerp(COL.fishB, smooth(-y * 1.4)), TRS(0, 0.0, 0.14, 0, 0, 0, 0.28, 0.14, 0.34));
    g.soft.add(cyl(1, 1, 0.02, 22), COL.mouth, TRS(0, 0.0, 0.14, 0, 0, 0, 0.265, 1, 0.325));
    for (let i = 0; i < 5; i++) { const x = (i - 2) * 0.08; g.gloss.add(cone(0.032, 0.1, 8), COL.tooth, TRS(x, 0.045, 0.44 - x * x * 3)); }
  });
  const tail = partsOf((g) => {
    g.chrome.add(sph(0.09, 12, 10), COL.silver, TRS(0, 0, 0));
    g.paint.add(cone(0.2, 0.5, 14), COL.fin, TRS(0, 0.17, -0.22, -2.3, 0, 0, 0.2, 1, 1));
    g.paint.add(cone(0.2, 0.5, 14), COL.fin, TRS(0, -0.17, -0.22, -0.84, 0, 0, 0.2, 1, 1));
  });
  return { body, jaw, tail };
}
function tplAnimals() {
  const bunny = partsOf((g) => {
    g.soft.add(sph(0.17, 18, 14), (x, y, z, o) => o.copy(COL.bunny).lerp(COL.bunnyS, smooth(-y / 0.17)), TRS(0, 0.17, -0.02, 0, 0, 0, 1, 0.92, 1.15));
    g.soft.add(sph(0.13, 18, 14), COL.bunny, TRS(0, 0.36, 0.12));
    for (const s of [-1, 1]) {
      g.soft.add(sph(1, 12, 8), COL.bunny, TRS(s * 0.055, 0.55, 0.07, -0.15, 0, -s * 0.2, 0.042, 0.15, 0.03));
      g.soft.add(sph(1, 12, 8), COL.pink, TRS(s * 0.058, 0.55, 0.095, -0.15, 0, -s * 0.2, 0.022, 0.11, 0.012));
      g.gloss.add(sph(0.026, 10, 8), COL.black, TRS(s * 0.062, 0.39, 0.225));
      g.soft.add(sph(1, 8, 6), COL.bunnyS, TRS(s * 0.08, 0.03, 0.08, 0, 0, 0, 0.05, 0.035, 0.09));
      g.soft.add(sph(1, 8, 6), COL.pink, TRS(s * 0.08, 0.33, 0.2, 0, 0, 0, 0.03, 0.02, 0.01));
    }
    g.gloss.add(sph(0.022, 8, 6), COL.pink, TRS(0, 0.355, 0.252));
    g.soft.add(sph(0.065, 10, 8), COL.eyeW, TRS(0, 0.2, -0.2));
  });
  const bird = partsOf((g) => {
    g.soft.add(sph(0.13, 18, 14), (x, y, z, o) => o.copy(COL.bird).lerp(COL.birdL, smooth((-y + 0.02) / 0.1) * smooth((z + 0.05) / 0.12)), TRS(0, 0, 0, 0, 0, 0, 1, 0.95, 1.2));
    g.soft.add(sph(0.1, 16, 12), COL.bird, TRS(0, 0.12, 0.11));
    g.gloss.add(cone(0.035, 0.1, 10), COL.beak, TRS(0, 0.1, 0.24, Math.PI / 2, 0, 0));
    for (const s of [-1, 1]) {
      g.gloss.add(sph(0.034, 10, 8), COL.eyeW, TRS(s * 0.055, 0.15, 0.19));
      g.gloss.add(sph(0.02, 8, 6), COL.black, TRS(s * 0.062, 0.152, 0.212));
    }
    g.soft.add(cone(0.07, 0.16, 10), COL.birdD, TRS(0, 0.02, -0.19, -Math.PI / 2 - 0.3, 0, 0, 1, 1, 0.35));
    g.gloss.add(sph(0.03, 6, 5), COL.beak, TRS(0.03, -0.12, 0.02));
    g.gloss.add(sph(0.03, 6, 5), COL.beak, TRS(-0.03, -0.12, 0.02));
  });
  const wing = partsOf((g) => { g.soft.add(sph(1, 12, 6), COL.birdD, TRS(0.1, 0, -0.02, 0, 0.2, 0, 0.12, 0.018, 0.075)); });
  return { bunny, bird, wing, wingL: mirrorX(wing) };
}
function tplSpring() {
  const helix = (() => {
    class Helix extends THREE.Curve {
      getPoint(t, out) { const o = out || new V3(); const a = t * TAU * 3.5; return o.set(Math.cos(a) * 0.48, t, Math.sin(a) * 0.48); }
    }
    return new THREE.TubeGeometry(new Helix(), sg(96, 36), 0.06, sg(8, 5), false);
  })();
  const coil = partsOf((g) => { g.chrome.add(helix, COL.silver); });
  const base = partsOf((g) => {
    g.metal.add(cyl(0.8, 0.88, 0.16, 36), COL.steelD, TRS(0, 0.08, 0));
    g.chrome.add(tor(0.8, 0.03, 8, 40), COL.silver, TRS(0, 0.16, 0, Math.PI / 2, 0, 0));
    g.metal.add(cyl(0.2, 0.2, 0.06, 16), COL.steel, TRS(0, 0.19, 0));
    if (HI()) bolts(g, 8, 0.68, 0.165, 0.03, COL.silver, 0.2);
  });
  const capOf = (col, colD) => partsOf((g) => {
    g.paint.add(lathe([[0, 0], [0.7, 0], [0.77, 0.04], [0.79, 0.12], [0.75, 0.2], [0.6, 0.225], [0, 0.225]], 40), vgrad(col, colD, 0.2, 0));
    g.gloss.add(tor(0.43, 0.05, 8, 32), COL.white, TRS(0, 0.225, 0, Math.PI / 2, 0, 0, 1, 1, 0.45));
    g.gloss.add(cyl(0.16, 0.16, 0.02, 24), COL.white, TRS(0, 0.232, 0));
    g.rubber.add(tor(0.775, 0.035, 6, 36), COL.tire, TRS(0, 0.11, 0, Math.PI / 2, 0, 0));
    g.metal.add(cyl(0.62, 0.62, 0.06, 32), COL.steelD, TRS(0, -0.03, 0));
  });
  return { coil, base, capY: capOf(COL.yellow, COL.yellowD), capR: capOf(lin('#ff4b3a'), lin('#b8160f')) };
}
function tplDash() {
  const base = partsOf((g) => {
    g.metal.add(rbox(2.6, 0.14, 3.5, 0.06, 3), COL.panel, TRS(0, 0.07, 0));
    for (const s of [-1, 1]) {
      g.paint.add(rbox(0.14, 0.17, 3.5, 0.05, 2), COL.yellow, TRS(s * 1.23, 0.085, 0));
      g.chrome.add(box(0.06, 0.04, 3.2), COL.silver, TRS(s * 1.12, 0.16, 0));
      if (HI()) for (const z of [-1.17, -0.39, 0.39, 1.17]) g.chrome.add(sph(0.025, 8, 6), COL.silver, TRS(s * 1.23, 0.17, z));
    }
    g.paint.add(rbox(2.6, 0.17, 0.14, 0.05, 2), COL.yellow, TRS(0, 0.085, 1.68));
    g.paint.add(rbox(2.6, 0.17, 0.14, 0.05, 2), COL.yellow, TRS(0, 0.085, -1.68));
    for (const s of [-1, 1]) for (const z of [-1.35, 0, 1.35]) g.glow.add(sph(0.05, 10, 8), COL.orange, TRS(s * 1.23, 0.18, z));
  });
  const arrows = new THREE.PlaneGeometry(2.1, 3.1);
  arrows.rotateX(-Math.PI / 2);
  arrows.translate(0, 0.145, 0);
  return { base, arrows };
}
function tplMonitor() {
  const body = partsOf((g) => {
    g.metal.add(rbox(0.92, 0.12, 0.92, 0.04, 3), COL.steelD, TRS(0, 0.06, 0));
    g.paint.add(rbox(1.04, 1.0, 1.04, 0.12, 6), vgrad(COL.white, lin('#aab2c4'), 0.5, -0.5), TRS(0, 0.62, 0));
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2, sx = Math.sin(a), cz = Math.cos(a);
      g.metal.add(rbox(0.82, 0.74, 0.06, 0.05, 2), COL.navy, TRS(sx * 0.505, 0.64, cz * 0.505, 0, a, 0));
      // chrome bezel around the screen
      for (const [w, h, x, y] of [[0.72, 0.03, 0, 0.305], [0.72, 0.03, 0, -0.305], [0.03, 0.64, 0.345, 0], [0.03, 0.64, -0.345, 0]]) {
        g.chrome.add(box(w, h, 0.02), COL.silver, TRS(sx * 0.538 + Math.cos(a) * x, 0.64 + y, cz * 0.538 - Math.sin(a) * x, 0, a, 0));
      }
      if (HI()) g.glow.add(sph(0.018, 8, 6), i === 0 ? lin('#56ff7a') : COL.lampR, TRS(sx * 0.538 + Math.cos(a) * 0.3, 0.2, cz * 0.538 - Math.sin(a) * 0.3));
    }
    if (HI()) for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.chrome.add(sph(0.05, 10, 8), COL.silver, TRS(sx * 0.4, 1.12, sz * 0.4));
    g.chrome.add(cyl(0.12, 0.16, 0.06, 20), COL.silver, TRS(0, 1.14, 0));
  });
  const sg = new GB();
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    sg.add(new THREE.PlaneGeometry(0.66, 0.58), COL.white, TRS(Math.sin(a) * 0.54, 0.64, Math.cos(a) * 0.54, 0, a, 0));
  }
  const wreck = partsOf((g) => {
    g.metal.add(rbox(0.92, 0.12, 0.92, 0.04, 3), COL.steelD, TRS(0, 0.06, 0));
    g.metal.add(cyl(0.42, 0.46, 0.08, 14), COL.ink, TRS(0, 0.15, 0));
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * TAU + 0.3, h = 0.16 + hash(i * 3.1) * 0.26;
      g.paint.add(box(0.2, h, 0.05), lin('#9aa3b8'), TRS(Math.sin(a) * 0.42, 0.12 + h / 2, Math.cos(a) * 0.42, (hash(i) - 0.5) * 0.6, a, (hash(i + 7) - 0.5) * 0.7));
    }
  });
  return { body, screens: sg.build(), wreck };
}
function tplStarPost() {
  const post = partsOf((g) => {
    g.metal.add(cyl(0.38, 0.47, 0.16, 28), COL.steelD, TRS(0, 0.08, 0));
    g.chrome.add(tor(0.38, 0.03, 8, 32), COL.silver, TRS(0, 0.16, 0, Math.PI / 2, 0, 0));
    if (HI()) bolts(g, 6, 0.3, 0.165, 0.025);
    g.paint.add(cyl(0.085, 0.1, 1.72, 20), vgrad(COL.blueL, COL.blue, 1.0, -0.5), TRS(0, 1.02, 0));
    for (const y of [0.52, 1.02, 1.52]) g.gloss.add(tor(0.1, 0.024, 8, 22), COL.white, TRS(0, y, 0, Math.PI / 2, 0, 0));
    g.chrome.add(sph(0.17, 22, 16), COL.silver, TRS(0, 1.9, 0));
    g.chrome.add(cyl(0.05, 0.05, 0.42, 10), COL.silver, TRS(0, 1.9, 0, 0, 0, Math.PI / 2));
  });
  const arm = partsOf((g) => { g.chrome.add(cyl(0.032, 0.04, 0.36, 10), COL.silver, TRS(0, 0.2, 0)); });
  const lamp = partsOf((g) => {
    g.glow.add(sph(0.155, 20, 14), COL.white);
    g.chrome.add(tor(0.16, 0.012, 6, 24), COL.silver, TRS(0, 0, 0, Math.PI / 2, 0, 0));
    g.chrome.add(tor(0.16, 0.012, 6, 24), COL.silver);
  });
  return { post, arm, lamp };
}
function tplBoss() {
  const hullCol = (x, y, z, o) => { o.copy(COL.white).lerp(lin('#9aa3b8'), smooth((-y - 0.2) / 0.8)); };
  const pod = partsOf((g) => {
    g.hull.add(lathe([[0, -1.05], [0.45, -1.02], [0.95, -0.9], [1.4, -0.64], [1.78, -0.32], [2.02, -0.02], [2.1, 0.16], [2.06, 0.32], [1.88, 0.43], [1.62, 0.47], [1.5, 0.4]], 48), hullCol);
    g.paint.add(tor(2.07, 0.075, 10, 64), COL.yellow, TRS(0, 0.17, 0, Math.PI / 2, 0, 0));
    g.chrome.add(tor(1.6, 0.085, 10, 56), COL.silver, TRS(0, 0.45, 0, Math.PI / 2, 0, 0));
    g.metal.add(tor(1.25, 0.05, 8, 48), COL.steelL, TRS(0, -0.75, 0, Math.PI / 2, 0, 0));
    // rivets along the rim and under the yellow band
    for (let i = 0; i < 40; i++) { const a = i / 40 * TAU; g.chrome.add(sph(0.032, 6, 5), COL.silver, TRS(Math.cos(a) * 2.035, 0.02, Math.sin(a) * 2.035)); }
    for (let i = 0; i < 28; i++) { const a = i / 28 * TAU; g.chrome.add(sph(0.03, 6, 5), COL.silver, TRS(Math.cos(a) * 1.8, 0.44, Math.sin(a) * 1.8)); }
    for (const s of [-1, 1]) {
      g.metal.add(cyl(0.3, 0.38, 0.5, 20), COL.steelL, TRS(s * 1.15, -0.78, -0.35));
      g.metal.add(cyl(0.22, 0.22, 0.06, 18), COL.steelD, TRS(s * 1.15, -1.04, -0.35));
      g.chrome.add(tor(0.33, 0.025, 6, 24), COL.silver, TRS(s * 1.15, -0.62, -0.35, Math.PI / 2, 0, 0));
      g.glow.add(cyl(0.17, 0.17, 0.02, 16), COL.orange, TRS(s * 1.15, -1.075, -0.35));
      g.paint.add(box(0.12, 0.55, 0.5), COL.coat, TRS(s * 1.25, 0.55, -1.15, -0.5, 0, s * 0.2));
    }
    g.metal.add(cyl(0.12, 0.2, 0.25, 16), COL.steelL, TRS(0, -1.12, 0));
    g.chrome.add(tor(0.13, 0.045, 8, 18), COL.silver, TRS(0, -1.28, 0, 0, Math.PI / 2, 0));
    g.chrome.add(cyl(0.025, 0.025, 0.6, 8), COL.silver, TRS(0, 0.75, -1.45, -0.35, 0, 0));
    g.glow.add(sph(0.07, 12, 10), COL.lampR, TRS(0, 1.03, -1.55));
    // Dr Boulon
    g.soft.add(sph(1, 26, 18), COL.coat, TRS(0, 0.58, -0.05, 0, 0, 0, 0.74, 0.6, 0.58));
    g.soft.add(tor(0.26, 0.085, 10, 24), COL.white, TRS(0, 1.06, 0, Math.PI / 2, 0, 0));
    g.gloss.add(sph(0.05, 10, 8), COL.yellow, TRS(0, 0.88, 0.5));
    g.gloss.add(sph(0.05, 10, 8), COL.yellow, TRS(0, 0.68, 0.55));
    g.soft.add(box(0.06, 0.5, 0.04), COL.coatD, TRS(0, 0.78, 0.535, -0.25, 0, 0));
    for (const s of [-1, 1]) {
      stick(g.soft, s * 0.6, 0.86, 0.02, s * 0.42, 0.62, 0.78, 0.15, 0.12, COL.coat, 14);
      g.soft.add(sph(0.15, 14, 12), COL.glove, TRS(s * 0.42, 0.62, 0.8));
      g.soft.add(sph(0.1, 12, 10), COL.skin, TRS(s * 0.47, 1.4, 0));
    }
    g.soft.add(sph(0.48, 30, 22), COL.skin, TRS(0, 1.42, 0.02));
    g.soft.add(sph(0.16, 16, 12), COL.nose, TRS(0, 1.33, 0.49));
    for (const s of [-1, 1]) {
      const pts = [new V3(s * 0.02, 1.22, 0.5), new V3(s * 0.25, 1.2, 0.49), new V3(s * 0.52, 1.24, 0.38), new V3(s * 0.74, 1.38, 0.24), new V3(s * 0.8, 1.58, 0.16)];
      g.soft.add(tubeVar(pts, t => 0.14 * Math.pow(1 - t, 0.75) + 0.02, 24, 12), COL.stache);
      g.soft.add(sph(0.14, 14, 12), COL.stache, TRS(s * 0.04, 1.22, 0.5));
      g.soft.add(sph(0.022, 8, 6), COL.stache, TRS(s * 0.8, 1.58, 0.16));
      g.chrome.add(cyl(0.17, 0.17, 0.1, 22), COL.silver, TRS(s * 0.19, 1.52, 0.43, Math.PI / 2 - 0.15, 0, 0));
    }
    g.metal.add(tor(0.475, 0.05, 10, 36), COL.steelD, TRS(0, 1.52, 0.01, Math.PI / 2 - 0.15, 0, 0));
    g.metal.add(box(0.95, 0.24, 0.32), COL.steelD, TRS(0, 0.46, 0.95, -0.4, 0, 0));
    g.glow.add(sph(0.045, 8, 6), COL.lampR, TRS(-0.25, 0.6, 0.93));
    g.glow.add(sph(0.045, 8, 6), lin('#56ff7a'), TRS(0, 0.6, 0.93));
    g.glow.add(sph(0.045, 8, 6), COL.yellow, TRS(0.25, 0.6, 0.93));
  });
  const lens = partsOf((g) => { for (const s of [-1, 1]) g.glow.add(cyl(0.135, 0.135, 0.02, 20), COL.white, TRS(s * 0.19, 1.528, 0.485, Math.PI / 2 - 0.15, 0, 0)); });
  const lightsA = partsOf((g) => { for (let i = 0; i < 8; i += 2) { const a = i / 8 * TAU + Math.PI / 8; g.glow.add(sph(0.09, 12, 10), COL.lampR, TRS(Math.sin(a) * 1.97, -0.12, Math.cos(a) * 1.97)); } });
  const lightsB = partsOf((g) => { for (let i = 1; i < 8; i += 2) { const a = i / 8 * TAU + Math.PI / 8; g.glow.add(sph(0.09, 12, 10), COL.yellow, TRS(Math.sin(a) * 1.97, -0.12, Math.cos(a) * 1.97)); } });
  const dome = new THREE.SphereGeometry(1.58, 40, 16, 0, TAU, 0, Math.PI / 2);
  dome.translate(0, 0.45, 0);
  const ball = partsOf((g) => {
    for (let k = 0; k < 4; k++) for (let h = 0; h < 2; h++) {
      g.paint.add(new THREE.SphereGeometry(1.05, 12, 10, k * Math.PI / 2, Math.PI / 2, h * Math.PI / 2, Math.PI / 2), (k + h) % 2 ? lin('#e8ebf2') : lin('#23262f'));
    }
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) dirs.push([a, b, c]);
    for (const [x, y, z] of dirs) {
      _v.set(x, y, z).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(UPV, _v);
      g.chrome.add(cone(0.17, 0.52, 14), COL.silver, TRq(_v.x * 1.18, _v.y * 1.18, _v.z * 1.18, q));
      g.metal.add(cyl(0.2, 0.22, 0.06, 14), COL.steelD, TRq(_v.x * 1.03, _v.y * 1.03, _v.z * 1.03, q));
    }
    g.metal.add(cyl(0.16, 0.2, 0.22, 14), COL.steelL, TRS(0, 1.1, 0));
    g.chrome.add(tor(0.14, 0.045, 8, 16), COL.silver, TRS(0, 1.3, 0));
  });
  const link = partsOf((g) => { g.chrome.add(new THREE.TorusGeometry(0.16, 0.05, 8, 16), COL.silver, TRS(0, 0, 0, 0, 0, 0, 1, 1.5, 1)); });
  const bomb = partsOf((g) => {
    g.paint.add(sph(0.42, 24, 16), COL.ink);
    g.metal.add(cyl(0.15, 0.17, 0.12, 16), COL.steelL, TRS(0, 0.43, 0));
    g.chrome.add(tor(0.16, 0.02, 6, 18), COL.silver, TRS(0, 0.37, 0, Math.PI / 2, 0, 0));
    stick(g.soft, 0, 0.48, 0, 0.06, 0.66, 0.04, 0.025, 0.02, lin('#e8d7a8'), 6);
  });
  return { pod, lens, lightsA, lightsB, dome, ball, link, bomb };
}
// candy-striped band of the capsule: slanted stripes as geometry (crisp at any distance, no texture)
function stripeBand(r, h, y, pairs, slant) {
  const gb = new GB();
  gb.mt = MT.paint;
  const cols = pairs * 2, sub = 3;
  for (let k = 0; k < cols; k++) {
    const col = k % 2 ? COL.white : lin('#d8322a');
    const g = new THREE.BufferGeometry(), p = [], n = [], u = [], idx = [];
    for (let j = 0; j <= sub; j++) {
      const a = (k + j / sub) / cols * TAU;
      for (const t of [0, 1]) {
        const aa = a + t * slant;
        p.push(Math.cos(aa) * r, y - h / 2 + t * h, Math.sin(aa) * r); n.push(Math.cos(aa), 0, Math.sin(aa)); u.push((k + j / sub) / cols, t);
      }
    }
    for (let j = 0; j < sub; j++) { const a0 = j * 2, b0 = a0 + 2; idx.push(a0, a0 + 1, b0, b0, a0 + 1, b0 + 1); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    g.setIndex(idx);
    gb.add(g, col);
  }
  return gb.build();
}
function tplCapsule() {
  const body = partsOf((g) => {
    g.metal.add(cyl(2.05, 2.25, 0.45, 8), COL.steel, TRS(0, 0.225, 0, 0, Math.PI / 8, 0));
    g.paint.add(tor(2.03, 0.06, 8, 8), COL.yellow, TRS(0, 0.45, 0, Math.PI / 2, 0, Math.PI / 8));
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.metal.add(box(0.5, 0.25, 0.5), COL.steelL, TRS(Math.cos(a) * 1.9, 0.12, Math.sin(a) * 1.9, 0, -a, 0)); }
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + Math.PI / 8; g.chrome.add(sph(0.05, 8, 6), COL.silver, TRS(Math.cos(a) * 2.0, 0.42, Math.sin(a) * 2.0)); }
    g.hull.add(cyl(1.7, 1.76, 0.65, 48), COL.white, TRS(0, 0.775, 0));
    g.hull.add(cyl(1.7, 1.7, 0.6, 48), COL.white, TRS(0, 2.05, 0));
    g.chrome.add(tor(1.72, 0.05, 8, 64), COL.silver, TRS(0, 1.1, 0, Math.PI / 2, 0, 0));
    g.chrome.add(tor(1.72, 0.05, 8, 64), COL.silver, TRS(0, 1.75, 0, Math.PI / 2, 0, 0));
    g.metal.add(cyl(1.55, 1.55, 0.04, 40), COL.ink, TRS(0, 2.36, 0));
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; g.glow.add(sph(0.08, 12, 10), COL.lampR, TRS(Math.cos(a) * 1.76, 0.75, Math.sin(a) * 1.76)); }
  });
  const band = stripeBand(1.72, 0.62, 1.425, 16, 0.18);
  const lid = partsOf((g) => {
    g.hull.add(lathe([[1.76, 0], [1.74, 0.12], [1.5, 0.3], [1.0, 0.42], [0.75, 0.44], [0, 0.44]], 48), vgrad(COL.white, COL.grey, 0.44, 0), TRS(0, 2.33, 0));
    g.chrome.add(cyl(0.8, 0.86, 0.14, 40), COL.silver, TRS(0, 2.81, 0));
    g.metal.add(tor(0.79, 0.04, 8, 40), COL.steelL, TRS(0, 2.88, 0, Math.PI / 2, 0, 0));
  });
  const button = partsOf((g) => {
    g.paint.add(lathe([[0, -0.04], [0.68, -0.04], [0.7, 0.14], [0.67, 0.3], [0.52, 0.4], [0, 0.43]], 40), vgrad(COL.yellow, COL.yellowD, 0.42, 0));
  });
  return { body, band, lid, button };
}

// ===================== enemies =====================
const EN = [];
const SHOTS = [];
function buildEnemies(scene) {
  const L = K.level && Array.isArray(K.level.enemies) ? K.level.enemies : [];
  const need = { bug: false, wasp: false, fish: false };
  for (const d of L) if (d && finV(d.pos)) need[d.type === 'wasp' || d.type === 'fish' ? d.type : 'bug'] = true;
  if (need.bug) TPL.bug = lodTpl(tplBug);
  if (need.wasp) { TPL.wasp = lodTpl(tplWasp); TPL.wasp.wingL = mirrorX(TPL.wasp.wing); }
  if (need.fish) TPL.fish = lodTpl(tplFish);
  let idx = 0;
  for (const d of L) {
    if (!d || !finV(d.pos)) continue;
    const type = d.type === 'wasp' || d.type === 'fish' ? d.type : 'bug';
    let dx = d.dir && fin(d.dir.x) ? d.dir.x : 1, dz = d.dir && fin(d.dir.z) ? d.dir.z : 0;
    const l = Math.hypot(dx, dz);
    if (l > 1e-6) { dx /= l; dz /= l; } else { dx = 1; dz = 0; }
    const e = {
      type, idx: idx++, home: new V3(d.pos.x, d.pos.y, d.pos.z), dir: new V3(dx, 0, dz), range: fin(d.range) && d.range > 0 ? d.range : 3,
      alive: true, pos: new V3(), c: new V3(), up: new V3(0, 1, 0), yaw: Math.atan2(dx, dz), t: 0, root: new THREE.Group(), vis: true, show: true,
      sdir: 1, wait: 0, wheel: 0, alert: 0, cool: 0, charge: 0, recoil: 0, curl: 0, leap: false, lt: 0, T: 1.6, apex: 5.5, A: new V3(), B: new V3(), bub: false, hitR: 0.85,
      calm: !!d.calm // a wasp placed as a homing stepping stone over a pit never shoots
    };
    if (type === 'bug') {
      const body = new THREE.Group(); e.root.add(body); e.body = body;
      part(body, TPL.bug.body, { name: 'e-bug' });
      e.axles = [];
      for (const z of [0.36, -0.36]) { const a = new THREE.Group(); a.position.set(0, 0.165, z); part(a, TPL.bug.axle, { name: 'e-bug-wheels', cast: false }); body.add(a); e.axles.push(a); }
      e.hitR = 0.85;
    } else if (type === 'wasp') {
      const body = new THREE.Group(); e.root.add(body); e.body = body;
      part(body, TPL.wasp.body, { name: 'e-wasp' });
      const abd = new THREE.Group(); abd.position.set(0, -0.02, -0.2); part(abd, TPL.wasp.abd, { name: 'e-wasp-abd' }); body.add(abd); e.abd = abd;
      e.wings = [];
      for (const s of [-1, 1]) {
        const w = new THREE.Group();
        w.position.set(s * 0.12, 0.2, 0.02);
        part(w, s < 0 ? TPL.wasp.wingL : TPL.wasp.wing, { mat: MAT.wing, cast: false, name: 'e-wasp-wing', order: 5 });
        body.add(w); e.wings.push(w);
      }
      e.hitR = 0.9;
    } else {
      const body = new THREE.Group(); e.root.add(body); e.body = body;
      part(body, TPL.fish.body, { name: 'e-fish' });
      const jaw = new THREE.Group(); jaw.position.set(0, -0.14, 0.18); part(jaw, TPL.fish.jaw, { name: 'e-fish-jaw', cast: false }); body.add(jaw); e.jaw = jaw;
      const tail = new THREE.Group(); tail.position.set(0, 0, -0.56); part(tail, TPL.fish.tail, { name: 'e-fish-tail' }); body.add(tail); e.tail = tail;
      e.hitR = 0.85;
      setupFish(e);
    }
    addRoot(e.root);
    EN.push(e);
    ents.push(e);
    resetEnemy(e);
  }
  for (let i = 0; i < 16; i++) SHOTS.push({ on: false, pos: new V3(), vel: new V3(), t: 0, refl: false });
}
function setupFish(e) {
  const sea = seaY();
  e.home.y = sea;
  e.A.copy(e.home);
  let best = null;
  for (const f of [1, 0.85, 0.7, 0.55, 0.4]) {
    const L = e.range * 2 * f;
    const bx = e.home.x + e.dir.x * L, bz = e.home.z + e.dir.z * L;
    if (terrainY(bx, bz) < sea - 0.25) { best = L; break; }
  }
  if (best == null) best = 0.01;
  e.B.set(e.home.x + e.dir.x * best, sea, e.home.z + e.dir.z * best);
  let top = -1e9;
  for (let i = 1; i < 10; i++) {
    const t = i / 10, x = lerp(e.A.x, e.B.x, t), z = lerp(e.A.z, e.B.z, t);
    const g = ground(x, z, sea + 30);
    if (g && g.y > top) top = g.y;
  }
  e.apex = Math.max(5.5, top > sea - 5 ? top - sea + 1.5 : 5.5);
  const L = e.A.distanceTo(e.B);
  e.T = clamp(1.05 + L * 0.055, 1.25, 1.9) * Math.sqrt(e.apex / 5.5);
  e.pathYaw = L > 0.1 ? Math.atan2(e.B.x - e.A.x, e.B.z - e.A.z) : e.yaw;
}
function resetEnemy(e) {
  e.alive = true; e.show = true; e.t = hash(e.idx * 7.7) * 10;
  e.pos.copy(e.home); e.up.set(0, 1, 0); e.yaw = Math.atan2(e.dir.x, e.dir.z);
  e.sdir = 1; e.wait = 0; e.alert = 0; e.cool = 1.5 + hash(e.idx) * 1.5; e.charge = 0; e.recoil = 0; e.curl = 0;
  if (e.type === 'bug') {
    const g = ground(e.home.x, e.home.z, e.home.y + 1.5);
    if (g) { e.pos.y = g.y; e.up.copy(g.n); }
  }
  if (e.type === 'fish') {
    e.leap = false; e.lt = 0; e.wait = 0.6 + hash(e.idx * 3.3) * 1.6; e.bub = false;
    if (e.flip) { const t = e.A.clone(); e.A.copy(e.B); e.B.copy(t); e.flip = false; e.pathYaw += Math.PI; }
    e.pos.copy(e.A); e.pos.y = seaY() - 2; e.show = false;
  }
  poseEnemy(e);
}
function poseEnemy(e) {
  const r = e.root;
  r.position.copy(e.pos);
  if (e.type === 'bug') {
    orient(r, e.up, e.yaw);
    e.body.position.y = Math.abs(Math.sin(e.wheel * 1.3)) * 0.025;
    for (const a of e.axles) a.rotation.x = e.wheel;
    e.c.copy(e.pos).addScaledVector(e.up, 0.52);
  } else if (e.type === 'wasp') {
    r.rotation.set(0, e.yaw, 0);
    e.body.rotation.x = -0.12 + e.curl * 0.15;
    const f = Math.sin(ST.T * 62 + e.idx) * 0.75;
    e.wings[0].rotation.z = -0.25 - f; e.wings[1].rotation.z = 0.25 + f;
    e.abd.rotation.x = lerp(-0.42, -1.85, e.curl) + Math.sin(ST.T * 3 + e.idx) * 0.06;
    e.c.copy(e.pos);
  } else {
    r.rotation.set(-e.pitch || 0, e.pathYaw, 0, 'YXZ');
    e.tail.rotation.y = Math.sin(ST.T * 16 + e.idx) * 0.45;
    e.jaw.rotation.x = 0.08 + (Math.sin(ST.T * 11 + e.idx) * 0.5 + 0.5) * 0.45;
    e.c.copy(e.pos);
  }
}
function updEnemies(dt) {
  for (const e of EN) {
    if (!e.alive) continue;
    const near = hd2(e.home, PL.pos) < ACT_D2;
    if (!near && !e.leap) continue;
    e.t += dt;
    if (e.type === 'bug') updBug(e, dt);
    else if (e.type === 'wasp') updWasp(e, dt);
    else {
      updFish(e, dt);
      const v = e.vis && e.show;
      if (e.root.visible !== v) e.root.visible = v;
    }
    if (e.root.visible || e.type !== 'fish') poseEnemy(e);
    if (!PL.ok || !e.alive) continue;
    if (e.type === 'fish' && (!e.leap || e.pos.y < seaY() - 0.3)) continue;
    if (sweepHit(e.c, e.hitR + 0.5, STEP)) {
      if (PL.atk) destroyEnemy(e, true);
      else pcall('hurt', e.c);
    }
  }
  updShots(dt);
}
function updBug(e, dt) {
  let tx, tz, spd;
  const chase = PL.ok && Math.abs(PL.pos.y - e.pos.y) < 2.5 && hd2(PL.pos, e.pos) < 64;
  if (chase) {
    tx = PL.pos.x; tz = PL.pos.z;
    const ox = tx - e.home.x, oz = tz - e.home.z, ol = Math.hypot(ox, oz), lim = e.range + 1.5;
    if (ol > lim && ol > 1e-6) { tx = e.home.x + ox / ol * lim; tz = e.home.z + oz / ol * lim; }
    spd = 3.7; e.alert = Math.min(1, e.alert + dt * 3);
  } else {
    e.alert = Math.max(0, e.alert - dt);
    if (e.wait > 0) {
      e.wait -= dt;
      if (e.wait <= 0) e.sdir = -e.sdir;
      tx = e.pos.x; tz = e.pos.z; spd = 0;
    } else {
      tx = e.home.x + e.dir.x * e.range * e.sdir; tz = e.home.z + e.dir.z * e.range * e.sdir; spd = 2.3;
    }
  }
  const dx = tx - e.pos.x, dz = tz - e.pos.z, dl = Math.hypot(dx, dz);
  if (!chase && e.wait <= 0 && dl < 0.08) { e.wait = 0.75; return; }
  if (dl < 0.05 || spd <= 0) return;
  const want = Math.atan2(dx, dz), da = angDiff(e.yaw, want);
  e.yaw += clamp(da, -5.5 * dt, 5.5 * dt);
  const align = Math.max(0, Math.cos(da));
  const stp = Math.min(dl, spd * dt * align * align);
  if (stp < 1e-4) return;
  const nx = e.pos.x + dx / dl * stp, nz = e.pos.z + dz / dl * stp;
  const g = ground(nx, nz, e.pos.y + 0.9);
  if (g && Math.abs(g.y - e.pos.y) < 0.9 && g.n.y > 0.55) {
    e.pos.set(nx, g.y, nz);
    e.up.lerp(g.n, 0.15).normalize();
    e.wheel += stp / 0.165;
  } else if (!chase) { e.wait = 0.5; }
}
function updWasp(e, dt) {
  const w = clamp(1.7 / e.range, 0.3, 1.4);
  const off = Math.sin(e.t * w) * e.range, vel = Math.cos(e.t * w);
  e.pos.set(e.home.x + e.dir.x * off, e.home.y + Math.sin(e.t * 2.3 + e.idx) * 0.25, e.home.z + e.dir.z * off);
  let want = e.yaw;
  const seen = PL.ok && hd2(PL.c, e.pos) < 26 * 26;
  if (seen) want = Math.atan2(PL.c.x - e.pos.x, PL.c.z - e.pos.z);
  else if (Math.abs(vel) > 0.05) want = Math.atan2(e.dir.x * Math.sign(vel), e.dir.z * Math.sign(vel));
  e.yaw += clamp(angDiff(e.yaw, want), -4 * dt, 4 * dt);
  e.cool -= dt;
  if (e.recoil > 0) e.recoil -= dt;
  if (e.charge > 0) {
    e.charge -= dt;
    poseEnemy(e);
    e.root.updateMatrixWorld(true);
    _v.set(0, 0, -1.3).applyMatrix4(e.abd.matrixWorld);
    const k = 1 - clamp(e.charge / 0.65, 0, 1);
    glow(_v.x, _v.y, _v.z, 0.25 + k * 0.75, FCOL.shot, 0.5 + k * 0.5, 0, 0);
    glow(_v.x, _v.y, _v.z, 0.12 + k * 0.3, FCOL.shotC, 1, 0, 0);
    if (e.charge <= 0) fireShot(e, _v);
  } else if (!e.calm && e.cool <= 0 && PL.ok && hd2(PL.c, e.pos) < 22 * 22 && PL.c.y < e.pos.y + 1.5 && PL.c.y > e.pos.y - 18 && onScreen(e.pos) && !springRide()) {
    e.charge = 0.65; e.cool = 2.7 + rand() * 0.9;
  }
  e.curl = damp(e.curl, e.charge > 0 || e.recoil > 0 ? 1 : 0, 9, dt);
}
// no new charge while Kit rides a spring (controls locked, he cannot dodge)
function springRide() { const P = K.player; return !!P && P.state === 'spring'; }
// a wasp only opens fire from where the player can see it (never from behind the camera)
function onScreen(p) {
  const cam = K.view && K.view.camera;
  if (!cam || !finV(cam.position) || !cam.quaternion) return true;
  const q = cam.quaternion, c = cam.position;
  const fx = -2 * (q.x * q.z + q.w * q.y), fy = -2 * (q.y * q.z - q.w * q.x), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  return (p.x - c.x) * fx + (p.y - c.y) * fy + (p.z - c.z) * fz > 1;
}
function fireShot(e, tip) {
  e.recoil = 0.35;
  let s = null;
  for (const q of SHOTS) if (!q.on) { s = q; break; }
  if (!s) { s = SHOTS[0]; for (const q of SHOTS) if (q.t > s.t) s = q; }
  _w.copy(PL.c).addScaledVector(PL.vel, 0.22).sub(tip);
  const l = _w.length();
  if (l > 1e-4) _w.multiplyScalar(1 / l); else _w.set(Math.sin(e.yaw), -0.3, Math.cos(e.yaw)).normalize();
  s.on = true; s.t = 0; s.refl = false;
  s.pos.copy(tip); s.vel.copy(_w).multiplyScalar(11.5);
  sfx('bounce');
}
const SHOT_FROM = new V3();
function updShots(dt) {
  const dy0 = deathY();
  for (const s of SHOTS) {
    if (!s.on) continue;
    s.t += dt;
    s.pos.addScaledVector(s.vel, dt);
    if (s.t > 3.4 || s.pos.y < dy0 - 5) { s.on = false; continue; }
    const g = ground(s.pos.x, s.pos.z, s.pos.y + 0.5);
    if (g && s.pos.y < g.y + 0.12) { fxSpark(s.pos, 3); s.on = false; continue; }
    const pulse = 1 + Math.sin(s.t * 30) * 0.12;
    glow(s.pos.x, s.pos.y, s.pos.z, 1.25 * pulse, FCOL.shot, 0.55, 0, 0);
    glow(s.pos.x, s.pos.y, s.pos.z, 0.5 * pulse, FCOL.shotC, 1, 0, 0);
    glow(s.pos.x, s.pos.y, s.pos.z, 0.75, FCOL.fireY, 0.9, 1, s.t * 9);
    for (let k = 1; k <= 3; k++) {
      const b = k * 0.028;
      glow(s.pos.x - s.vel.x * b, s.pos.y - s.vel.y * b, s.pos.z - s.vel.z * b, 0.5 - k * 0.1, FCOL.shot, 0.5 - k * 0.12, 0, 0);
    }
    if (s.refl) {
      for (const e of EN) {
        if (e.alive && e.type === 'wasp' && d2(e.c, s.pos) < 1.0) { destroyEnemy(e, false); s.on = false; break; }
      }
      continue;
    }
    if (PL.ok && d2(s.pos, PL.c) < 0.82 * 0.82) {
      if (PL.shield) {
        s.refl = true; s.vel.multiplyScalar(-1.3); s.t = Math.min(s.t, 2.2);
        fxSpark(s.pos, 4); sfx('tick');
      } else if (PL.homing) {
        // a homing attack cuts straight through a shot (it is a committed move: no knock-back into a gap)
        fxSpark(s.pos, 6); sfx('tick'); s.on = false;
      } else {
        fxSpark(s.pos, 5); s.on = false;
        // knock Kit back along the shot's path (from where it came), not toward wherever it grazed him
        SHOT_FROM.copy(s.pos).addScaledVector(s.vel, -0.4);
        pcall('hurt', SHOT_FROM);
      }
    }
  }
}
function updFish(e, dt) {
  const sea = seaY();
  if (!e.leap) {
    e.show = false;
    e.wait -= dt;
    if (!e.bub && e.wait < 0.45) { e.bub = true; _w.set(e.A.x, sea, e.A.z); fxSplash(_w, 3); }
    if (e.wait <= 0) {
      if (hd2(e.A, PL.pos) < 50 * 50 && gstate() !== 'title') {
        e.leap = true; e.lt = 0; e.show = true;
        _w.set(e.A.x, sea, e.A.z); fxSplash(_w, 12);
      } else e.wait = 0.5;
    }
    return;
  }
  e.lt += dt;
  const u = e.lt / e.T;
  if (u >= 1) {
    _w.set(e.B.x, sea, e.B.z); fxSplash(_w, 12);
    e.leap = false; e.show = false; e.bub = false; e.wait = 1.1 + rand() * 1.0;
    const t = _u.copy(e.A); e.A.copy(e.B); e.B.copy(t); e.flip = !e.flip; e.pathYaw += Math.PI;
    e.pos.set(e.A.x, sea - 2, e.A.z);
    return;
  }
  const h = e.apex + 0.7;
  e.pos.set(lerp(e.A.x, e.B.x, u), sea - 0.7 + h * 4 * u * (1 - u), lerp(e.A.z, e.B.z, u));
  const vy = h * 4 * (1 - 2 * u) / e.T, vh = Math.max(0.6, e.A.distanceTo(e.B) / e.T);
  e.pitch = Math.atan2(vy, vh) * (e.A.distanceTo(e.B) > 0.2 ? 1 : 0.6);
}
function destroyEnemy(e, byPlayer) {
  if (!e.alive) return;
  e.alive = false; e.show = false; e.root.visible = false; e.charge = 0;
  _v.copy(e.c);
  burst(_v, 'boom', 1);
  sfx('pop');
  spawnAnimal(_v, rand() < 0.5 ? 'bunny' : 'bird', null);
  const pts = CHAIN[Math.min(ST.chain, CHAIN.length - 1)];
  ST.chain++;
  _w.copy(_v); _w.y += 0.9;
  gcall('addScore', pts, _w);
  if (byPlayer && !PL.onGround) pcall('bounce', 9);
}

// ===================== freed animals =====================
const AN = [];
function buildAnimals(scene) {
  TPL.animals = tplAnimals();
  for (let i = 0; i < 24; i++) {
    const a = { on: false, kind: 'bunny', pos: new V3(), vel: new V3(), t: 0, life: 5, yaw: 0, sq: 0, root: new THREE.Group(), bunny: new THREE.Group(), bird: new THREE.Group(), wings: [] };
    part(a.bunny, TPL.animals.bunny, { name: 'e-bunny' });
    part(a.bird, TPL.animals.bird, { name: 'e-bird' });
    for (const s of [-1, 1]) {
      const w = new THREE.Group(); w.position.set(s * 0.09, 0.04, 0);
      part(w, s < 0 ? TPL.animals.wingL : TPL.animals.wing, { name: 'e-bird-wing', cast: false }); a.bird.add(w); a.wings.push(w);
    }
    a.root.add(a.bunny, a.bird);
    a.root.visible = false;
    addRoot(a.root);
    AN.push(a);
  }
}
function spawnAnimal(pos, kind, vel) {
  if (!AN.length || !finV(pos)) return;
  let a = null;
  for (const q of AN) if (!q.on) { a = q; break; }
  if (!a) { a = AN[0]; for (const q of AN) if (q.t > a.t) a = q; }
  a.on = true; a.kind = kind === 'bird' ? 'bird' : 'bunny'; a.t = 0; a.sq = 0;
  a.pos.copy(pos);
  if (vel) a.vel.copy(vel);
  else {
    let ang = rand() * TAU;
    if (finV(PL.pos)) ang = Math.atan2(pos.x - PL.pos.x, pos.z - PL.pos.z) + (rand() - 0.5) * 1.6;
    const hs = a.kind === 'bird' ? 1.5 : 2.6;
    a.vel.set(Math.sin(ang) * hs, a.kind === 'bird' ? 3 : 6, Math.cos(ang) * hs);
  }
  a.life = a.kind === 'bird' ? 4.2 : 5.2;
  a.yaw = Math.atan2(a.vel.x, a.vel.z);
  a.bunny.visible = a.kind === 'bunny'; a.bird.visible = a.kind === 'bird';
  a.root.visible = true; a.root.scale.setScalar(1);
}
function updAnimals(dt) {
  const sea = seaY(), dy0 = deathY();
  for (const a of AN) {
    if (!a.on) continue;
    a.t += dt;
    const v = a.vel, p = a.pos;
    if (a.kind === 'bunny') {
      v.y -= 24 * dt;
      p.addScaledVector(v, dt);
      const g = ground(p.x, p.z, p.y + 0.5);
      if (g && p.y <= g.y && v.y <= 0) {
        p.y = g.y;
        const hs = Math.hypot(v.x, v.z) || 1;
        v.x = v.x / hs * 2.8; v.z = v.z / hs * 2.8; v.y = 5.6; a.sq = 1;
      } else if (!g && p.y < sea) { _w.set(p.x, sea, p.z); fxSplash(_w, 4); a.on = false; }
      a.sq = Math.max(0, a.sq - dt * 6);
      const st = clamp(1 + v.y * 0.025, 0.85, 1.18) - a.sq * 0.25;
      a.bunny.scale.set(1 / Math.sqrt(st), st, 1 / Math.sqrt(st));
    } else {
      if (a.t < 0.45) { v.y -= 10 * dt; }
      else { const hs = Math.hypot(v.x, v.z) || 1; v.x = damp(v.x, v.x / hs * 5, 2, dt); v.z = damp(v.z, v.z / hs * 5, 2, dt); v.y = damp(v.y, 2.6, 2, dt); }
      p.addScaledVector(v, dt);
      const f = Math.sin(a.t * 30) * 0.9;
      a.wings[0].rotation.z = f; a.wings[1].rotation.z = f;
      a.bird.position.y = Math.sin(a.t * 30) * 0.02;
    }
    if (Math.hypot(v.x, v.z) > 0.2) a.yaw = Math.atan2(v.x, v.z);
    a.root.position.copy(p);
    a.root.rotation.set(0, a.yaw, 0);
    const left = a.life - a.t;
    a.root.scale.setScalar(left < 0.4 ? Math.max(0.01, left / 0.4) : Math.min(1, 0.3 + a.t * 5));
    if (left <= 0 || p.y < dy0 - 10) a.on = false;
    if (!a.on) a.root.visible = false;
  }
}

// ===================== springs, dash panels, monitors, spikes, star posts =====================
const SPR = [], DSH = [], MON = [], SPK = [], CPS = [];
function buildSprings(scene) {
  const L = K.level && Array.isArray(K.level.springs) ? K.level.springs : [];
  if (!L.length) return;
  const T = TPL.spring || (TPL.spring = lodTpl(tplSpring));
  for (const d of L) {
    if (!d || !finV(d.pos)) continue;
    const dir = finV(d.dir) && d.dir.lengthSq() > 1e-8 ? d.dir.clone().normalize() : new V3(0, 1, 0);
    const power = fin(d.power) && d.power > 0 ? d.power : 30;
    const tilt = Math.acos(clamp(dir.y, -1, 1));
    const lift = Math.sin(tilt) * 0.88 + 0.02;
    const s = { pos: new V3(d.pos.x, d.pos.y, d.pos.z), dir, power, lock: fin(d.lock) ? d.lock : 0.4, cool: 0, anim: 9, len: 0.3, lift, root: new THREE.Group(), vis: true, show: true };
    s.home = s.pos;
    s.base = s.pos.clone().addScaledVector(UPV, lift);
    // horizontal footprint used for grounded / low players (see updSprings)
    s.hl = Math.hypot(dir.x, dir.z);
    s.hx = s.hl > 1e-4 ? dir.x / s.hl : 0; s.hz = s.hl > 1e-4 ? dir.z / s.hl : -1;
    s.catchW = 0.85;
    const head = new THREE.Group();
    head.position.set(0, lift, 0);
    head.quaternion.setFromUnitVectors(UPV, dir);
    s.root.add(head);
    part(head, T.base, { name: 'e-spring-base', cast: false });
    const coil = new THREE.Group(); coil.position.y = 0.16; part(coil, T.coil, { name: 'e-spring-coil' }); head.add(coil);
    const cap = new THREE.Group(); part(cap, power >= 30 ? T.capR : T.capY, { name: 'e-spring-cap' }); head.add(cap);
    s.coil = coil; s.cap = cap;
    if (lift > 0.1) {
      // wedge pedestal: a vertical cylinder whose top is cut along the spring's tilted base plane
      const R1 = Math.min(0.62, 0.82 * Math.max(0.2, dir.y)), R0 = R1 + 0.08, dy = Math.max(0.2, dir.y);
      const ped = partsOf((g) => {
        const geo = cyl(R1, R0, 1, 24);
        const pa = geo.attributes.position;
        for (let i = 0; i < pa.count; i++) {
          const x = pa.getX(i), z = pa.getZ(i);
          pa.setY(i, pa.getY(i) > 0 ? Math.max(0.05, lift - (x * dir.x + z * dir.z) / dy) - 0.015 : -0.1);
        }
        geo.computeVertexNormals();
        g.metal.add(geo, COL.steelD);
        g.chrome.add(tor(R0 - 0.03, 0.035, 8, 28), COL.silver, TRS(0, 0.06, 0, Math.PI / 2, 0, 0));
      });
      staticGB(s.pos.z).addBuilt(ped, TRS(s.pos.x, s.pos.y, s.pos.z));
      ped.dispose();
    }
    s.root.position.copy(s.pos);
    addRoot(s.root);
    SPR.push(s); ents.push(s);
    poseSpring(s);
  }
  // springs set side by side form one continuous catch strip: each one covers half the gap to its neighbour
  for (const s of SPR) {
    let best = Infinity;
    for (const o of SPR) {
      if (o === s || Math.abs(o.pos.y - s.pos.y) > 0.8) continue;
      const d = Math.hypot(o.pos.x - s.pos.x, o.pos.z - s.pos.z);
      if (d < best) best = d;
    }
    if (best < 3) s.catchW = clamp(best / 2 + 0.1, 0.85, 1.3);
  }
}
function poseSpring(s) {
  let L = 0.3;
  if (s.anim < 0.7) {
    const t = s.anim;
    const f = t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) * 7) * Math.cos((t - 0.05) * 26);
    L = Math.max(0.12, 0.3 + 0.62 * f);
  }
  s.coil.scale.y = L;
  s.cap.position.y = 0.16 + L;
}
let sprLast = -9;
function updSprings(dt) {
  for (const s of SPR) {
    if (s.cool > 0) s.cool -= dt;
    if (s.anim < 0.7) { s.anim += dt; poseSpring(s); }
    if (!PL.ok || s.cool > 0) continue;
    // feet over the pad (running or hopping onto it): a horizontal footprint around the spring's ground point
    const fx = PL.pos.x - s.pos.x, fy = PL.pos.y - s.pos.y, fz = PL.pos.z - s.pos.z;
    if (fx * fx + fz * fz > 12 || fy > 3.5 || fy < -2) continue;
    let fire = false;
    if (fy > -1 && fy < 1.5) {
      if (s.hl > 0.05) {
        const fa = fx * s.hx + fz * s.hz, fl = fx * s.hz - fz * s.hx;
        fire = fa >= -1.2 && fa <= 1.2 && Math.abs(fl) <= s.catchW;
      } else fire = fx * fx + fz * fz <= s.catchW * s.catchW;
    }
    if (!fire) {
      // anything else (falling onto it, flying into its head): the tilted spring axis
      const dx = PL.pos.x - s.base.x, dy = PL.pos.y - s.base.y, dz = PL.pos.z - s.base.z;
      const along = dx * s.dir.x + dy * s.dir.y + dz * s.dir.z;
      if (along < -0.5 || along > 1.5) continue;
      const px = dx - s.dir.x * along, py = dy - s.dir.y * along, pz = dz - s.dir.z * along;
      if (px * px + py * py + pz * pz > 1.0) continue;
    }
    // just launched by this row (rising along it): no retrigger. Running fast INTO a tilted spring still fires it.
    if (ST.T - sprLast < 0.6 && PL.vel.y > 2 && PL.vel.dot(s.dir) > s.power * 0.6) continue;
    s.cool = 0.35; s.anim = 0; poseSpring(s);
    sprLast = ST.T;
    _v.copy(s.dir).multiplyScalar(s.power);
    pcall('launch', _v, s.lock, true);
    _w.copy(s.base).addScaledVector(s.dir, 0.5);
    vfx('impact', _w, 0xffd23a, 2.2, s.dir);
  }
}
function buildDash(scene) {
  const L = K.level && Array.isArray(K.level.dashPanels) ? K.level.dashPanels : [];
  if (!L.length) return;
  const T = TPL.dash || (TPL.dash = lodTpl(tplDash));
  for (const d of L) {
    if (!d || !finV(d.pos)) continue;
    let fx = d.dir && fin(d.dir.x) ? d.dir.x : 0, fz = d.dir && fin(d.dir.z) ? d.dir.z : -1;
    const l = Math.hypot(fx, fz);
    if (l > 1e-6) { fx /= l; fz /= l; } else { fx = 0; fz = -1; }
    const s = { pos: new V3(d.pos.x, d.pos.y, d.pos.z), dir: new V3(fx, 0, fz), speed: fin(d.speed) && d.speed > 0 ? d.speed : 30, cool: 0, root: new THREE.Group(), vis: true, show: true,
      halfW: fin(d.halfW) && d.halfW > 0 ? d.halfW : 1.45, reach: fin(d.reach) && d.reach > 0 ? d.reach : 0,
      kick: d.kick && fin(d.kick.a0) && fin(d.kick.a1) && fin(d.kick.y) && fin(d.kick.vy) ? d.kick : null };
    s.home = s.pos;
    const g = ground(s.pos.x, s.pos.z, s.pos.y + 0.5);
    const n = g && g.n.y > 0.5 ? g.n.clone() : new V3(0, 1, 0);
    // local -Z = forward
    _bz.set(-fx, 0, -fz); _bz.addScaledVector(n, -_bz.dot(n)).normalize();
    _bx.crossVectors(n, _bz).normalize();
    _bm.makeBasis(_bx, n, _bz);
    s.root.quaternion.setFromRotationMatrix(_bm);
    s.root.position.copy(s.pos);
    part(s.root, T.base, { name: 'e-dash', cast: false });
    part(s.root, T.arrows, { mat: MAT.arrow, cast: false, name: 'e-dash-arrows', order: 6 });
    addRoot(s.root);
    DSH.push(s); ents.push(s);
  }
}
function updDash(dt) {
  for (const d of DSH) {
    if (d.cool > 0) d.cool -= dt;
    if (!PL.ok || d.cool > 0) continue;
    const dx = PL.pos.x - d.pos.x, dy = PL.pos.y - d.pos.y, dz = PL.pos.z - d.pos.z;
    const along = dx * d.dir.x + dz * d.dir.z, lat = dx * d.dir.z - dz * d.dir.x;
    if (Math.abs(lat) > d.halfW || along < -1.9 || along > 1.9 + d.reach) continue;
    if (along <= 1.9) { if (dy < -0.7 || dy > 1.0) continue; }
    else if (!PL.onGround) {
      // flying low over the ramp's lip without touching it: launch as the ramp would have
      const k = d.kick, fwd = PL.vel.x * d.dir.x + PL.vel.z * d.dir.z;
      if (!k || along < k.a0 || along > k.a1 || fwd < 2) continue;
      const ly = PL.pos.y - k.y;
      if (ly < -1.2 || ly > 1.4 || (PL.vel.y >= k.vy && fwd >= d.speed - 0.5)) continue;
      d.cool = 0.6;
      _v.set(d.dir.x * Math.max(fwd, d.speed), Math.max(PL.vel.y, k.vy), d.dir.z * Math.max(fwd, d.speed));
      pcall('launch', _v, 0.2, false);
      sfx('dash');
      continue;
    } else {
      // run-up zone past the panel (launch ramp): keeps a grounded player heading forward at the panel's speed
      if (dy < -1 || dy > 4) continue;
      if (PL.vel.x * d.dir.x + PL.vel.z * d.dir.z < 2 || Math.hypot(PL.vel.x, PL.vel.z) >= d.speed - 0.5) continue;
    }
    d.cool = 0.25;
    pcall('dash', d.dir, d.speed);
    _w.copy(d.pos); _w.y += 0.3;
    fxTwinkle(_w, 4, 0.9);
    _w.y -= 0.2;
    vfx('impact', _w, 0x5fe6ff, 1.7, UPV);
  }
}
function buildMonitors(scene) {
  const L = K.level && Array.isArray(K.level.monitors) ? K.level.monitors : [];
  if (!L.length) return;
  const T = TPL.mon || (TPL.mon = lodTpl(tplMonitor));
  let i = 0;
  for (const d of L) {
    if (!d || !finV(d.pos)) continue;
    const kind = ICONS.indexOf(d.kind) >= 0 ? d.kind : 'ring';
    const m = { kind, idx: i++, pos: new V3(d.pos.x, d.pos.y, d.pos.z), broken: false, it: 9, applied: true, flick: 1 + hash(i) * 2, stat: 0, root: new THREE.Group(), vis: true, show: true };
    m.home = m.pos;
    m.intact = new THREE.Group();
    part(m.intact, T.body, { name: 'e-monitor' });
    m.screen = part(m.intact, T.screens, { mat: MAT.screen, cast: false, name: 'e-monitor-screen' });
    m.screen.t[0] = ICONS.indexOf(kind); m.screen.t[1] = 0; m.screen.t[2] = 1; m.screen.t[3] = 0;
    m.wreck = new THREE.Group();
    part(m.wreck, T.wreck, { name: 'e-monitor-wreck' });
    m.wreck.visible = false;
    m.popup = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.screen[kind], transparent: true, depthWrite: false, toneMapped: false }));
    m.popup.scale.set(0.82, 0.82, 0.82); m.popup.visible = false; m.popup.renderOrder = 8;
    m.popup.name = 'e-popup'; m.popup.userData.noEnv = true;
    m.popup.position.set(m.pos.x, m.pos.y + 0.9, m.pos.z);
    scene.add(m.popup);
    m.root.add(m.intact, m.wreck);
    m.root.position.copy(m.pos);
    addRoot(m.root);
    m.solid = { min: new V3(m.pos.x - 0.52, m.pos.y - 0.05, m.pos.z - 0.52), max: new V3(m.pos.x + 0.52, m.pos.y + 1.17, m.pos.z + 0.52), delta: new V3(), kind: 'monitor', mesh: m.root, ref: m };
    MON.push(m); ents.push(m);
  }
}
function resetMonitor(m) {
  m.broken = false; m.it = 9; m.applied = true;
  m.intact.visible = true; m.wreck.visible = false; m.popup.visible = false;
  m.screen.t[1] = 0; m.stat = 0;
  addSolid(m.solid);
}
function breakMonitor(m) {
  if (m.broken) return;
  m.broken = true; m.it = 0; m.applied = false;
  m.intact.visible = false; m.wreck.visible = true; m.popup.visible = true;
  m.popup.material.opacity = 1; m.popup.position.set(m.pos.x, m.pos.y + 0.9, m.pos.z);
  removeSolid(m.solid);
  _v.copy(m.pos); _v.y += 0.6;
  burst(_v, 'boom', 1);
  vfx('twinkle', _v, 10, 0xfff2c0);
  sfx('monitor');
  gcall('addScore', 10);
  if (!PL.onGround) pcall('bounce', 9);
}
function updMonitors(dt) {
  for (const m of MON) {
    if (m.broken) {
      if (m.it < 1.4) {
        m.it += dt;
        const k = easeOut(m.it / 0.45);
        m.popup.position.y = m.pos.y + 0.9 + k * 1.35 + Math.sin(m.it * 6) * 0.03;
        m.popup.material.opacity = m.it > 1.0 ? clamp((1.4 - m.it) / 0.4, 0, 1) : 1;
        if (!m.applied && m.it >= 0.5) { m.applied = true; gcall('applyItem', m.kind); _v.copy(m.pos); _v.y += 2.2; fxTwinkle(_v, 5, 0.4); }
        if (m.it >= 1.4) m.popup.visible = false;
      }
      continue;
    }
    if (m.root.visible) {
      m.flick -= dt;
      if (m.stat > 0) { m.stat -= dt; if (m.stat <= 0) m.screen.t[1] = 0; }
      else if (m.flick <= 0) { m.flick = 1.1 + rand() * 1.6; m.stat = 0.1; m.screen.t[1] = 1; }
    }
    if (!PL.ok || !PL.atk) continue;
    if (hd2(PL.c, m.pos) > 16) continue;
    const r = 0.5 + 0.14, s = m.solid;
    if (!sweepBox(s.min.x - r, s.min.y - r, s.min.z - r, s.max.x + r, s.max.y + r, s.max.z + r, STEP * 1.5)) continue;
    const qx = clamp(PL.c.x, s.min.x, s.max.x), qy = clamp(PL.c.y, s.min.y, s.max.y), qz = clamp(PL.c.z, s.min.z, s.max.z);
    const nx = PL.c.x - qx, ny = PL.c.y - qy, nz = PL.c.z - qz, nl = Math.hypot(nx, ny, nz);
    const approach = nl > 1e-4 ? -(PL.vel.x * nx + PL.vel.y * ny + PL.vel.z * nz) / nl : 1;
    if (PL.homing || approach > 0.5 || nl <= 1e-4) breakMonitor(m);
  }
}
function buildSpikes(scene) {
  const L = K.level && Array.isArray(K.level.spikes) ? K.level.spikes : [];
  for (const d of L) {
    if (!d || !finV(d.pos)) continue;
    const sx = fin(d.sx) && d.sx > 0.3 ? d.sx : 2, sz = fin(d.sz) && d.sz > 0.3 ? d.sz : 2;
    const k = { pos: new V3(d.pos.x, d.pos.y, d.pos.z), hx: sx / 2, hz: sz / 2, root: new THREE.Group(), vis: true, show: true };
    k.home = k.pos;
    const nx = Math.max(2, Math.round(sx / 0.58)), nz = Math.max(2, Math.round(sz / 0.58));
    const parts = partsOf((g) => {
      g.metal.add(rbox(sx, 0.14, sz, 0.04, 2), COL.steelD, TRS(0, 0.07, 0));
      g.paint.add(rbox(sx + 0.06, 0.06, sz + 0.06, 0.02, 2), COL.yellow, TRS(0, 0.02, 0));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const x = (i + 0.5) / nx * sx - sx / 2, z = (j + 0.5) / nz * sz - sz / 2;
        g.chrome.add(cone(0.19, 0.72, 12), COL.silver, TRS(x, 0.14 + 0.36, z));
        g.metal.add(cyl(0.21, 0.23, 0.04, 10), COL.steel, TRS(x, 0.15, z));
      }
    });
    staticGB(k.pos.z).addBuilt(parts, TRS(k.pos.x, k.pos.y, k.pos.z));
    parts.dispose();
    k.root.position.copy(k.pos);
    SPK.push(k); ents.push(k);
  }
}
function updSpikes() {
  if (!PL.ok) return;
  for (const k of SPK) {
    const dx = PL.pos.x - k.pos.x, dz = PL.pos.z - k.pos.z, dy = PL.pos.y - k.pos.y;
    if (Math.abs(dx) < k.hx + 0.35 && Math.abs(dz) < k.hz + 0.35 && dy < 0.85 && dy > -0.6) pcall('hurt', k.pos);
  }
}
function buildStarPosts(scene) {
  const L = K.level && Array.isArray(K.level.checkpoints) ? K.level.checkpoints : [];
  if (!L.length) return;
  const T = TPL.post || (TPL.post = lodTpl(tplStarPost));
  for (let i = 0; i < L.length; i++) {
    const d = L[i];
    if (!d || !finV(d.pos)) continue;
    const gy = fin(d.yaw) ? d.yaw : 0;
    const c = { i, pos: new V3(d.pos.x, d.pos.y, d.pos.z), yaw: Math.atan2(-Math.sin(gy), -Math.cos(gy)), on: false, spin: 0, root: new THREE.Group(), vis: true, show: true,
      fx: -Math.sin(gy), fz: -Math.cos(gy), halfW: 9, prevAlong: NaN };
    // the post also acts as a gate across the route: crossing its line anywhere on the path counts
    if (fin(d.halfW) && d.halfW > 0) c.halfW = clamp(d.halfW, 3, 20);
    else try {
      const ri = K.world && typeof K.world.routeInfo === 'function' ? K.world.routeInfo(c.pos.x, c.pos.z) : null;
      if (ri && fin(ri.halfWidth)) c.halfW = clamp(ri.halfWidth, 3, 14);
    } catch (e) { /* default gate width */ }
    c.home = c.pos;
    part(c.root, T.post, { name: 'e-post' });
    const arm = new THREE.Group(); arm.position.set(0, 1.9, 0);
    part(arm, T.arm, { name: 'e-post-arm', cast: false });
    const lamp = new THREE.Group();
    lamp.position.y = 0.48;
    arm.add(lamp);
    c.lamp = part(lamp, T.lamp, { name: 'e-post-lamp', cast: false });
    c.root.add(arm);
    c.arm = arm;
    c.root.position.copy(c.pos);
    c.root.rotation.y = c.yaw;
    addRoot(c.root);
    CPS.push(c); ents.push(c);
  }
}
function setPost(c, on, spin) {
  c.on = on;
  tint(c.lamp, on ? COL.lampB : COL.lampR);
  c.spin = spin ? 1.2 : 0;
  c.arm.rotation.x = 0;
}
function updStarPosts(dt) {
  for (const c of CPS) {
    if (c.spin > 0) {
      c.spin = Math.max(0, c.spin - dt);
      c.arm.rotation.x = -easeOut(1 - c.spin / 1.2) * TAU * 3;
    }
    if (c.root.visible && d2(c.pos, PL.pos) < 90 * 90) {
      const a = c.arm.rotation.x, ly = 1.9 + Math.cos(a) * 0.48, lz = Math.sin(a) * 0.48;
      const x = c.pos.x + Math.sin(c.yaw) * lz, z = c.pos.z + Math.cos(c.yaw) * lz;
      glow(x, c.pos.y + ly, z, 1.5 + Math.sin(ST.T * 5 + c.i) * 0.15, c.on ? FCOL.blue : FCOL.red, 0.42, 0, 0);
    }
    if (c.on || !PL.ok) { c.prevAlong = NaN; continue; }
    const dy = PL.pos.y - c.pos.y;
    const rx = PL.pos.x - c.pos.x, rz = PL.pos.z - c.pos.z;
    const along = rx * c.fx + rz * c.fz, lat = Math.abs(rx * c.fz - rz * c.fx);
    const crossed = c.prevAlong < 0 && along >= 0 && along < 6 && lat < c.halfW && dy > -3 && dy < 6;
    c.prevAlong = Math.abs(along) < 30 ? along : NaN;
    if (crossed || (hd2(PL.pos, c.pos) < 1.55 * 1.55 && dy > -1.2 && dy < 2.8)) {
      gcall('setCheckpoint', c.i);
      const g = K.game;
      const ci = g && fin(g.cpIndex) ? g.cpIndex : c.i;
      if (ci >= c.i) {
        for (const o of CPS) if (o.i < c.i && !o.on) setPost(o, true, false);
        setPost(c, true, true);
        _v.copy(c.pos); _v.y += 2.4;
        if (!vfx('twinkle', _v, 12, 0x6fa8ff)) fxTwinkle(_v, 8, 0.5);
      }
    }
  }
}
function resetStarPosts() {
  const g = K.game;
  const ci = g && fin(g.cpIndex) ? g.cpIndex : -1;
  for (const c of CPS) setPost(c, c.i <= ci, false);
}

// ===================== Dr Boulon =====================
const BS = { ok: false, state: 'dormant', hp: 8, max: 8, t: 0, st: 0, flash: 0, C: new V3(), R: 26, pos: new V3(), vel: new V3(), from: new V3(), yaw: 0, orbitA: 0, chaseT: 0, nextChase: 4, ballA: 0, ballR: 0, ball: new V3(), ballVel: new V3(), ballOn: true, bombT: 3, boomT: 0, sfxT: 0, smokeT: 0, away: new V3(), podC: new V3(), anchor: new V3() };
const BOMBS = [];
function buildBoss(scene) {
  const b = K.level && K.level.boss;
  if (!b || !finV(b.center)) return;
  BS.C.copy(b.center);
  BS.R = fin(b.radius) && b.radius > 4 ? b.radius : 26;
  const T = TPL.boss = tplBoss();
  BS.root = addRoot(new THREE.Group());
  BS.slots = [part(BS.root, T.pod, { name: 'e-boss' })];
  BS.lens = part(BS.root, T.lens, { name: 'e-boss-lens', cast: false });
  tint(BS.lens, COL.cyan);
  BS.lightsA = new THREE.Group(); BS.lightsB = new THREE.Group();
  BS.root.add(BS.lightsA, BS.lightsB);
  part(BS.lightsA, T.lightsA, { name: 'e-boss-lights', cast: false });
  part(BS.lightsB, T.lightsB, { name: 'e-boss-lights2', cast: false });
  part(BS.root, T.dome, { mat: MAT.glass, cast: false, name: 'e-boss-dome', order: 7 });
  BS.root.visible = false;
  BS.ballG = addRoot(new THREE.Group());
  part(BS.ballG, T.ball, { name: 'e-boss-ball' });
  BS.ballG.visible = false;
  BS.chain = addRoot(new THREE.Group());
  BS.links = [];
  for (let i = 0; i < 12; i++) BS.links.push(part(BS.chain, T.link, { name: 'e-boss-chain' }).h);
  BS.chain.visible = false;
  for (let i = 0; i < 6; i++) {
    const g = addRoot(new THREE.Group());
    part(g, T.bomb, { name: 'e-bomb' });
    g.visible = false;
    BOMBS.push({ on: false, pos: new V3(), vel: new V3(), t: 0, fuse: 2.6, root: g, spin: 0 });
  }
  BS.ok = true;
}
function resetBoss() {
  if (!BS.ok) return;
  if (BS.state === 'dying' && (gstate() === 'play' || gstate() === 'card') && !bossDone()) gcall('onBossDefeated');
  BS.hp = BS.max; BS.flash = 0; BS.t = 0; BS.st = 0; BS.vel.set(0, 0, 0);
  BS.state = bossDone() ? 'gone' : 'dormant';
  BS.root.visible = false; BS.ballG.visible = false; BS.chain.visible = false; BS.ballOn = true;
  bossFlash(false);
  for (const b of BOMBS) { b.on = false; b.root.visible = false; }
}
function startBoss() {
  const B = BS;
  B.state = 'enter'; B.st = 0; B.hp = B.max; B.flash = 0;
  const a = Math.atan2(PL.pos.z - B.C.z, PL.pos.x - B.C.x) + Math.PI;
  B.orbitA = a;
  B.from.set(B.C.x + Math.cos(a) * 11, B.C.y + 24, B.C.z + Math.sin(a) * 11);
  B.pos.copy(B.from); B.vel.set(0, 0, 0);
  B.ballA = 0; B.ballR = 0; B.ballOn = true; B.nextChase = 4; B.chaseT = 0; B.bombT = 3;
  B.root.visible = true; B.ballG.visible = true; B.chain.visible = true;
  gcall('onBossStart');
}
function bossPhase2() { return BS.hp <= BS.max / 2; }
function updBoss(dt) {
  const B = BS;
  if (!B.ok) return;
  B.t += dt; B.st += dt;
  if (B.flash > 0) B.flash = Math.max(0, B.flash - dt);
  const hy = B.C.y + 4.6;
  if (B.state === 'dormant') {
    if (PL.ok && !bossDone() && hd2(PL.pos, B.C) < B.R * B.R && PL.pos.y > B.C.y - 2.5) startBoss();
    else return;
  }
  if (B.state === 'gone') return;
  const p2 = bossPhase2();
  if (B.state === 'enter') {
    const u = smooth(B.st / 2.4);
    B.pos.set(B.from.x, lerp(B.from.y, hy, u), B.from.z);
    if (B.st >= 2.4) { B.state = 'fight'; B.st = 0; }
  } else if (B.state === 'fight') {
    B.nextChase -= dt;
    if (B.chaseT > 0) B.chaseT -= dt;
    else if (B.nextChase <= 0) { B.chaseT = p2 ? 2.8 : 2.3; B.nextChase = (p2 ? 4.4 : 5.8) + B.chaseT; }
    let tx, tz;
    if (B.chaseT > 0 && finV(PL.pos)) {
      tx = PL.pos.x; tz = PL.pos.z;
      const ox = tx - B.C.x, oz = tz - B.C.z, ol = Math.hypot(ox, oz), lim = B.R * 0.66;
      if (ol > lim && ol > 1e-6) { tx = B.C.x + ox / ol * lim; tz = B.C.z + oz / ol * lim; }
    } else {
      B.orbitA += (p2 ? 0.55 : 0.34) * dt;
      const r = B.R * (p2 ? 0.5 : 0.42);
      tx = B.C.x + Math.cos(B.orbitA) * r; tz = B.C.z + Math.sin(B.orbitA) * r;
    }
    const maxV = p2 ? 9.5 : 6.2;
    let vx = (tx - B.pos.x) * 1.4, vz = (tz - B.pos.z) * 1.4;
    const vl = Math.hypot(vx, vz);
    if (vl > maxV) { vx *= maxV / vl; vz *= maxV / vl; }
    B.vel.x = damp(B.vel.x, vx, 2.5, dt); B.vel.z = damp(B.vel.z, vz, 2.5, dt);
    B.pos.x += B.vel.x * dt; B.pos.z += B.vel.z * dt;
    B.pos.y = damp(B.pos.y, hy + Math.sin(B.t * 1.7) * 0.35, 4, dt);
    if (p2) {
      B.bombT -= dt;
      if (B.bombT <= 0) { B.bombT = 4.2; dropBombs(); }
      B.smokeT -= dt;
      if (B.smokeT <= 0) { B.smokeT = 0.22; _v.set(B.pos.x - Math.sin(B.yaw) * 1.2, B.pos.y + 0.6, B.pos.z - Math.cos(B.yaw) * 1.2); fxSmoke(_v, 1, true); }
    }
  } else if (B.state === 'dying') {
    B.vel.multiplyScalar(Math.max(0, 1 - 3 * dt));
    B.pos.x += B.vel.x * dt; B.pos.z += B.vel.z * dt;
    B.pos.y = damp(B.pos.y, B.C.y + 3.4, 1.4, dt);
    B.boomT -= dt;
    if (B.boomT <= 0) { B.boomT = 0.09 + rand() * 0.07; rdir(_v).multiplyScalar(1.2 + rand() * 1.3).add(B.podC); fxBoom(_v, 0.8 + rand() * 0.5); }
    B.sfxT -= dt;
    if (B.sfxT <= 0) { B.sfxT = 0.27; sfx('boom'); shake(0.16); }
    if (B.ballOn) {
      B.ballVel.y -= 30 * dt;
      B.ball.addScaledVector(B.ballVel, dt);
      const g = ground(B.ball.x, B.ball.z, B.ball.y + 1);
      if (g && B.ball.y - 1.05 < g.y) { B.ball.y = g.y + 1.05; if (B.ballVel.y < -3) { _w.set(B.ball.x, g.y, B.ball.z); fxDust(_w, 6); shake(0.12); } B.ballVel.y = -B.ballVel.y * 0.35; B.ballVel.x *= 0.7; B.ballVel.z *= 0.7; }
    }
    if (B.st >= 2.5) {
      B.state = 'flee'; B.st = 0;
      fxBoom(B.podC, 2); sfx('boom'); shake(0.4);
      if (B.ballOn) { fxBoom(B.ball, 1.6); B.ballOn = false; B.ballG.visible = false; }
      let ax = B.pos.x - PL.pos.x, az = B.pos.z - PL.pos.z;
      const al = Math.hypot(ax, az);
      if (al > 1e-3) { ax /= al; az /= al; } else { ax = 0; az = -1; }
      B.away.set(ax, 0, az);
      gcall('onBossDefeated');
      capsuleDrop();
    }
  } else if (B.state === 'flee') {
    B.vel.set(B.away.x * (3 + B.st * 5), 2.5 + B.st * 6, B.away.z * (3 + B.st * 5));
    B.pos.addScaledVector(B.vel, dt);
    B.smokeT -= dt;
    if (B.smokeT <= 0) { B.smokeT = 0.05; fxSmoke(B.podC, 1, true); if (rand() < 0.25) fxBoom(B.podC, 0.5); }
    if (B.st > 4.2) { B.state = 'gone'; B.root.visible = false; B.chain.visible = false; B.ballG.visible = false; return; }
  }
  // pose
  let wantYaw = B.yaw;
  if (B.state === 'flee') wantYaw = Math.atan2(B.away.x, B.away.z);
  else if (finV(PL.pos)) wantYaw = Math.atan2(PL.pos.x - B.pos.x, PL.pos.z - B.pos.z);
  B.yaw += clamp(angDiff(B.yaw, wantYaw), -2.5 * dt, 2.5 * dt);
  const cy = Math.cos(B.yaw), sy = Math.sin(B.yaw);
  const fwdV = B.vel.x * sy + B.vel.z * cy, latV = B.vel.x * cy - B.vel.z * sy;
  let pitch = clamp(fwdV * 0.035, -0.3, 0.3), roll = clamp(-latV * 0.04, -0.3, 0.3);
  if (B.state === 'flee') pitch = -0.35;
  B.root.position.copy(B.pos);
  if (B.state === 'dying') { B.root.position.x += (rand() - 0.5) * 0.18; B.root.position.y += (rand() - 0.5) * 0.18; roll += Math.sin(B.t * 31) * 0.08; }
  if (B.flash > 0) roll += Math.sin(B.t * 40) * 0.05;
  B.root.rotation.set(pitch, B.yaw, roll, 'YXZ');
  B.podC.copy(B.pos); B.podC.y += 0.3;
  const fl = (B.flash > 0 && Math.floor(B.flash * 16) % 2 === 0) || (B.state === 'dying' && Math.floor(B.st * 14) % 2 === 0);
  bossFlash(fl);
  tint(BS.lens, B.flash > 0 || B.state === 'dying' || B.state === 'flee' ? COL.lensR : COL.cyan);
  const blink = Math.floor(B.t * (p2 ? 7 : 4)) % 2 === 0;
  BS.lightsA.visible = blink; BS.lightsB.visible = !blink;
  // thruster flames
  if (B.state !== 'gone') {
    B.root.updateMatrixWorld(true);
    for (const s of [-1, 1]) {
      _v.set(s * 1.15, -1.12, -0.35).applyMatrix4(B.root.matrixWorld);
      const f = 0.85 + rand() * 0.3;
      glow(_v.x, _v.y - 0.15, _v.z, 0.95 * f, FCOL.flame, 0.75, 0, 0);
      glow(_v.x, _v.y - 0.05, _v.z, 0.45 * f, FCOL.flameC, 1, 0, 0);
      glow(_v.x, _v.y - 0.55 * f, _v.z, 0.6 * f, FCOL.fireO, 0.45, 0, 0);
    }
  }
  // wrecking ball
  if (B.state === 'enter' || B.state === 'fight') {
    const targetR = B.state === 'enter' ? 0 : (p2 ? 4.7 : 3.1);
    B.ballR = damp(B.ballR, targetR, 1.6, dt);
    B.ballA += (p2 ? 2.5 : 1.75) * dt;
    B.anchor.set(0, -1.32, 0).applyMatrix4(B.root.matrixWorld);
    B.ball.set(B.pos.x + Math.cos(B.ballA) * B.ballR, B.pos.y - 3.45 + Math.sin(B.ballA * 2) * 0.3, B.pos.z + Math.sin(B.ballA) * B.ballR);
    B.ball.y = Math.max(B.ball.y, B.C.y + 1.08);
    B.ballVel.set(-Math.sin(B.ballA) * B.ballR * 2, 0, Math.cos(B.ballA) * B.ballR * 2);
  }
  if (B.ballOn) {
    B.ballG.position.copy(B.ball);
    B.ballG.rotation.y += dt * 2.2;
    B.ballG.rotation.z = Math.sin(B.t * 1.3) * 0.15;
  }
  if (B.chain.visible && (B.state === 'enter' || B.state === 'fight')) writeChain();
  else if (B.chain.visible) B.chain.visible = false;
  if (B.state !== 'fight' || !PL.ok) return;
  // interactions
  if (sweepHit(B.podC, 1.95 + 0.5, STEP)) {
    if (PL.atk) {
      if (B.flash <= 0) hitBoss();
      knockPlayer();
    } else pcall('hurt', B.podC);
  }
  if (B.ballOn && d2(PL.c, B.ball) < (1.3 + 0.45) * (1.3 + 0.45)) pcall('hurt', B.ball);
}
const _cq = new THREE.Quaternion(), _cq2 = new THREE.Quaternion(), _cs = new V3(1, 1, 1);
function writeChain() {
  const B = BS, n = 12;
  _u.set(B.ball.x, B.ball.y + 1.32, B.ball.z);
  _w.subVectors(B.anchor, _u);
  const len = _w.length();
  if (len < 1e-4) _w.set(0, 1, 0); else _w.multiplyScalar(1 / len);
  _cq.setFromUnitVectors(UPV, _w);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    _v.copy(_u).lerp(B.anchor, t);
    _cq2.setFromAxisAngle(UPV, i % 2 ? Math.PI / 2 : 0);
    _q.copy(_cq).multiply(_cq2);
    _cs.set(1, clamp(len / n / 0.4, 0.6, 1.6), 1);
    const h = B.links[i];
    h.position.copy(_v); h.quaternion.copy(_q); h.scale.copy(_cs);
  }
}
// the pod flashes white after a hit (emission of every pod instance)
function bossFlash(on) { for (const s of BS.slots) s.t[3] = on ? 1 : 0; }
function hitBoss() {
  const B = BS;
  B.hp = Math.max(0, B.hp - 1); B.flash = 1.2;
  sfx('bosshit'); shake(0.35);
  fxSpark(B.podC, 8);
  _w.copy(PL.c).sub(B.podC); _w.y = Math.max(_w.y, 0.4);
  if (_w.lengthSq() < 1e-6) _w.copy(UPV);
  _w.normalize();
  vfx('sparks', B.podC, _w, 26, 0xffc070);
  postFx('flash', B.hp === 0 ? 0xffffff : 0xffe8c8, B.hp === 0 ? 0.32 : 0.13);
  if (B.hp <= 0) {
    B.state = 'dying'; B.st = 0; B.boomT = 0; B.sfxT = 0.1; B.flash = 0;
    B.ballVel.set(B.ballVel.x * 0.4, 0, B.ballVel.z * 0.4);
    B.chain.visible = false;
    for (const b of BOMBS) if (b.on) explodeBomb(b, false);
    sfx('boom');
  }
}
function knockPlayer() {
  const B = BS, P = K.player;
  let dx = PL.c.x - B.podC.x, dz = PL.c.z - B.podC.z;
  let l = Math.hypot(dx, dz);
  if (l < 1e-3) {
    dx = P && P.forward && fin(P.forward.x) ? -P.forward.x : 0; dz = P && P.forward && fin(P.forward.z) ? -P.forward.z : 1;
    l = Math.hypot(dx, dz) || 1;
  }
  const below = PL.c.y < B.podC.y - 0.9;
  pcall('bounce', below ? -5 : 11);
  if (P && finV(P.vel)) { P.vel.x = dx / l * 9; P.vel.z = dz / l * 9; }
}
function dropBombs() {
  const B = BS;
  const base = finV(PL.pos) ? Math.atan2(PL.pos.z - B.pos.z, PL.pos.x - B.pos.x) : 0;
  let k = 0;
  for (const b of BOMBS) {
    if (b.on) continue;
    const a = base + (k - 1) * 2.1;
    b.on = true; b.t = 0; b.fuse = 2.5 + k * 0.2; b.spin = 0;
    b.pos.set(B.pos.x, B.pos.y - 1.3, B.pos.z);
    b.vel.set(Math.cos(a) * 3.8, 2.5, Math.sin(a) * 3.8);
    b.root.visible = true;
    if (++k >= 3) break;
  }
}
function explodeBomb(b, hurtIt) {
  b.on = false; b.root.visible = false;
  fxBoom(b.pos, 1.15); sfx('boom'); shake(0.15);
  if (hurtIt && PL.ok && d2(PL.c, b.pos) < 2.4 * 2.4) pcall('hurt', b.pos);
}
function updBombs(dt) {
  const sea = seaY(), dy0 = deathY();
  for (const b of BOMBS) {
    if (!b.on) continue;
    b.t += dt;
    b.vel.y -= 26 * dt;
    b.pos.addScaledVector(b.vel, dt);
    const g = ground(b.pos.x, b.pos.z, b.pos.y + 0.6);
    if (g && b.pos.y - 0.42 < g.y && b.vel.y < 0) {
      b.pos.y = g.y + 0.42;
      b.vel.y = b.vel.y < -2.5 ? -b.vel.y * 0.55 : 0;
      b.vel.x *= 0.82; b.vel.z *= 0.82;
    } else if (!g && b.pos.y < sea) { _w.set(b.pos.x, sea, b.pos.z); fxSplash(_w, 8); b.on = false; b.root.visible = false; continue; }
    if (b.pos.y < dy0 - 10) { b.on = false; b.root.visible = false; continue; }
    b.spin += Math.hypot(b.vel.x, b.vel.z) * dt / 0.42;
    b.root.position.copy(b.pos);
    b.root.rotation.set(b.spin * 0.6, b.spin * 0.2, 0);
    const blinkF = b.t > b.fuse - 0.8 ? 14 : 5;
    if (Math.floor(b.t * blinkF) % 2 === 0) glow(b.pos.x, b.pos.y + 0.1, b.pos.z, 1.3, FCOL.red, 0.4, 0, 0);
    _v.set(0.06, 0.68, 0.04).applyEuler(b.root.rotation).add(b.pos);
    glow(_v.x, _v.y, _v.z, 0.45 + rand() * 0.25, FCOL.fireY, 1, 1, rand() * TAU);
    if (b.t >= b.fuse) { explodeBomb(b, true); continue; }
    if (PL.ok && d2(PL.c, b.pos) < (0.42 + 0.5) * (0.42 + 0.5)) explodeBomb(b, true);
  }
}

// ===================== animal capsule =====================
// the model is built tall and squashed by CAP_SY so the button (BTN_TOP) stays within one jump (~2.86 u)
const CAP_SX = 0.9, CAP_SY = 0.7, BTN_Y = 2.88, BTN_DEPTH = 0.3;
const CAP_TOP = 2.6 * CAP_SY, BTN_TOP = (BTN_Y + 0.43) * CAP_SY, CAP_OPEN = 2.35 * CAP_SY;
const CP = { ok: false, state: 'hidden', pos: new V3(), y: 0, vy: 0, t: 0, called: false, lidPos: new V3(), lidVel: new V3(), lidRot: 0 };
function buildCapsule(scene) {
  const c = K.level && K.level.capsule;
  if (!c || !finV(c.pos)) return;
  CP.pos.copy(c.pos);
  const T = tplCapsule();
  CP.root = addRoot(new THREE.Group());
  part(CP.root, T.body, { name: 'e-capsule' });
  part(CP.root, T.band, { name: 'e-capsule-band' });
  CP.lid = new THREE.Group();
  part(CP.lid, T.lid, { name: 'e-capsule-lid' });
  CP.button = new THREE.Group();
  CP.button.position.y = BTN_Y;
  part(CP.button, T.button, { name: 'e-capsule-button' });
  CP.lid.add(CP.button);
  CP.root.add(CP.lid);
  CP.root.position.copy(CP.pos);
  CP.root.scale.set(CAP_SX, CAP_SY, CAP_SX);
  CP.root.visible = false;
  // two boxes: the drum (lid averaged to a flat top) and the button you jump on
  const hd = 1.62 * CAP_SX, hb = 0.66 * CAP_SX;
  CP.solid = { min: new V3(CP.pos.x - hd, CP.pos.y, CP.pos.z - hd), max: new V3(CP.pos.x + hd, CP.pos.y + CAP_TOP, CP.pos.z + hd), delta: new V3(), kind: 'capsule', mesh: CP.root };
  CP.btnSolid = { min: new V3(CP.pos.x - hb, CP.pos.y + CAP_TOP - 0.1, CP.pos.z - hb), max: new V3(CP.pos.x + hb, CP.pos.y + BTN_TOP, CP.pos.z + hb), delta: new V3(), kind: 'capsule', mesh: CP.root };
  CP.ok = true;
}
function capsuleReset(landed) {
  if (!CP.ok) return;
  CP.t = 0; CP.called = false; CP.vy = 0;
  CP.lid.position.set(0, 0, 0); CP.lid.rotation.set(0, 0, 0); CP.lid.visible = true;
  CP.button.position.y = BTN_Y;
  CP.solid.max.y = CP.pos.y + CAP_TOP;
  CP.btnSolid.max.y = CP.pos.y + BTN_TOP;
  if (landed) { CP.state = 'idle'; CP.y = CP.pos.y; CP.root.visible = true; addSolid(CP.solid); addSolid(CP.btnSolid); }
  else { CP.state = 'hidden'; CP.root.visible = false; removeSolid(CP.solid); removeSolid(CP.btnSolid); }
  CP.root.position.set(CP.pos.x, CP.pos.y, CP.pos.z);
}
function capsuleDrop() {
  if (!CP.ok || CP.state !== 'hidden') return;
  capsuleReset(false);
  CP.state = 'drop'; CP.y = CP.pos.y + 32; CP.vy = 0; CP.root.visible = true;
  CP.root.position.y = CP.y;
}
function updCapsule(dt) {
  if (!CP.ok || CP.state === 'hidden') return;
  const c = CP;
  if (c.state === 'drop') {
    c.vy -= 34 * dt; c.y += c.vy * dt;
    if (c.y <= c.pos.y) {
      c.y = c.pos.y; c.state = 'idle';
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; _w.set(c.pos.x + Math.cos(a) * 2.1 * CAP_SX, c.pos.y, c.pos.z + Math.sin(a) * 2.1 * CAP_SX); fxDust(_w, 3); }
      shake(0.32); sfx('boom');
      addSolid(c.solid); addSolid(c.btnSolid);
    }
    c.root.position.y = c.y;
    return;
  }
  if (c.state === 'idle') {
    glow(c.pos.x, c.pos.y + BTN_TOP - 0.1, c.pos.z, 2.0 + Math.sin(ST.T * 4) * 0.25, FCOL.gold, 0.3, 0, 0);
    if (PL.ok && hd2(PL.pos, c.pos) < 0.95 * 0.95 && PL.pos.y >= c.pos.y + BTN_TOP - 0.35 && PL.pos.y < c.pos.y + BTN_TOP + 1.2 && PL.vel.y <= 1) {
      c.state = 'pressed'; c.t = 0;
      sfx('button');
      const g = K.game;
      if (g && typeof g.timerOn === 'boolean') g.timerOn = false;
    }
    return;
  }
  c.t += dt;
  if (c.state === 'pressed') {
    const k = smooth(c.t / 0.15);
    c.button.position.y = BTN_Y - k * BTN_DEPTH;
    c.btnSolid.max.y = c.pos.y + BTN_TOP - k * BTN_DEPTH * CAP_SY;
    if (c.t >= 0.5) openCapsule();
    return;
  }
  if (c.state === 'open') {
    if (c.lid.visible) {
      c.lidVel.y -= 24 * dt;
      c.lid.position.addScaledVector(c.lidVel, dt);
      c.lid.rotation.x += c.lidRot * dt; c.lid.rotation.z += c.lidRot * 0.6 * dt;
      if (c.lid.position.y < -3) c.lid.visible = false;
    }
    if (c.t >= 2.5 && !c.called) { c.called = true; c.state = 'done'; gcall('onCapsule'); }
  }
}
function openCapsule() {
  const c = CP;
  c.state = 'open'; c.t = 0;
  _v.set(c.pos.x, c.pos.y + 2.7 * CAP_SY, c.pos.z);
  fxBoom(_v, 1.8); sfx('boom'); shake(0.35);
  fxTwinkle(_v, 12, 1.2);
  vfx('confetti', _v);
  const a = rand() * TAU;
  c.lidVel.set(Math.cos(a) * 3, 10, Math.sin(a) * 3); c.lidRot = 4 + rand() * 3;
  c.solid.max.y = c.pos.y + CAP_OPEN;
  removeSolid(c.btnSolid);
  for (let i = 0; i < 10; i++) {
    const ang = i / 10 * TAU + rand() * 0.3, bird = i % 2 === 1;
    _w.set(c.pos.x + Math.cos(ang) * 0.8, c.pos.y + CAP_OPEN + 0.1, c.pos.z + Math.sin(ang) * 0.8);
    _u.set(Math.cos(ang) * (bird ? 2 : 3.4), bird ? 4.5 : 6.5 + rand() * 2, Math.sin(ang) * (bird ? 2 : 3.4));
    spawnAnimal(_w, bird ? 'bird' : 'bunny', _u);
  }
}

// ===================== homing target =====================
const HT = { pos: new V3(), ref: null };
let htBest = null, htScore = Infinity;
function htConsider(p, ref, ox, oy, oz, fx, fy, fz, fh, anyFacing) {
  const dx = p.x - ox, dy = p.y - oy, dz = p.z - oz;
  const dd = dx * dx + dy * dy + dz * dz;
  if (dd > 225 || dd < 0.04 || dy < -8 || dy > 9) return;
  const d = Math.sqrt(dd), hd = Math.hypot(dx, dz);
  let dot = (dx * fx + dy * fy + dz * fz) / d;
  if (fh > 0.3 && hd > 0.6) { const dh = (dx * fx + dz * fz) / (hd * fh); if (dh > dot) dot = dh; }
  else if (hd <= 1.2 && dy < 0) dot = Math.max(dot, 0.8);
  if (anyFacing) dot = Math.max(dot, 0.8);
  if (dot < 0.35) return;
  const s = d * (1.6 - dot);
  if (s < htScore) { htScore = s; htBest = ref; HT.pos.copy(p); }
}
function homingTarget(pos, fwd) {
  if (ST.away) return null;
  if (!ST.built || !finV(pos)) return null;
  let fx = 0, fy = 0, fz = -1;
  if (finV(fwd)) { const l = Math.hypot(fwd.x, fwd.y, fwd.z); if (l > 1e-6) { fx = fwd.x / l; fy = fwd.y / l; fz = fwd.z / l; } }
  const fh = Math.hypot(fx, fz);
  htBest = null; htScore = Infinity;
  const ox = pos.x, oy = pos.y, oz = pos.z, sea = seaY();
  for (const e of EN) {
    if (!e.alive) continue;
    if (e.type === 'fish' && (!e.leap || e.pos.y < sea + 0.3)) continue;
    htConsider(e.c, e, ox, oy, oz, fx, fy, fz, fh);
  }
  for (const m of MON) {
    if (m.broken) continue;
    _u.set(m.pos.x, m.pos.y + 0.62, m.pos.z);
    htConsider(_u, m, ox, oy, oz, fx, fy, fz, fh);
  }
  if (BS.ok && BS.state === 'fight' && BS.flash <= 0) {
    // the pod right above Kit is always the target, whichever way he faces (after a knock-back he faces away)
    const bx = BS.podC.x - ox, bz = BS.podC.z - oz, by = BS.podC.y - oy;
    htConsider(BS.podC, BS, ox, oy, oz, fx, fy, fz, fh, bx * bx + bz * bz < 42 && by > -0.5);
  }
  if (!htBest) return null;
  HT.ref = htBest;
  return HT;
}

// ===================== culling =====================
function cullPass() {
  const cam = K.view && K.view.camera;
  const cp = cam && finV(cam.position) ? cam.position : (finV(PL.pos) ? PL.pos : null);
  for (const o of ents) {
    if (cp) o.vis = d2(o.home || o.pos, cp) < VIS_D2;
    const v = o.vis && o.show && (o.alive !== false);
    if (o.root.visible !== v) o.root.visible = v;
  }
}

// ===================== API =====================
function build(scene) {
  if (ST.built) return;
  scene = scene || (K.view && K.view.scene);
  if (!scene) return;
  ST.scene = scene;
  const had = new Set(scene.children);
  makeMaterials();
  const step = (name, fn) => { try { fn(scene); } catch (e) { console.error('Kit Rush 3D: entities/' + name, e); } };
  step('fx', initFX);
  step('rings', buildRings);
  step('enemies', buildEnemies);
  step('animals', buildAnimals);
  step('springs', buildSprings);
  step('dash', buildDash);
  step('monitors', buildMonitors);
  step('spikes', buildSpikes);
  step('posts', buildStarPosts);
  step('boss', buildBoss);
  step('capsule', buildCapsule);
  step('static', buildStatic);
  step('pools', makePools);
  ST.own = scene.children.filter(o => !had.has(o));
  ST.built = true;
  const G = K.gfx;
  if (G && typeof G.onChange === 'function') { try { G.onChange(onGfx); } catch (e) { /* optional */ } }
  onGfx(G);
  reset();
}
// Act switch: away (Act 2) hides the island's entities and keeps only the lost rings (scattered on the city's
// streets) and the particles running; back home, everything shows again (main resets the act right after)
function setActive(on) {
  on = !!on;
  if (!ST.built || ST.away === !on) return;
  ST.away = !on;
  const keep = o => o === RG.lostMesh || (FXS.alp && o === FXS.alp.pts) || (FXS.add && o === FXS.add.pts);
  for (const o of ST.own) {
    if (keep(o)) continue;
    if (on) { o.visible = o.userData.kitWasVisible !== false; delete o.userData.kitWasVisible; }
    else { o.userData.kitWasVisible = o.visible; o.visible = false; }
  }
  for (const r of RG.lost) r.on = false;
  RG.lostDirty = true;
  clearFX();
  if (on) { cullPass(); flush(); writeRings(); }
}
function updAway(dt) {
  RG.lostSpin = (RG.lostSpin + dt * 10) % TAU;
  updLostRings(dt);
}
function reset() {
  if (!ST.built) return;
  readPlayer();
  ST.chain = 0;
  if (ST.away) { for (const r of RG.lost) r.on = false; RG.lostDirty = true; clearFX(); return; }
  resetRings();
  for (const e of EN) resetEnemy(e);
  for (const s of SHOTS) s.on = false;
  for (const a of AN) { a.on = false; a.root.visible = false; }
  for (const s of SPR) { s.cool = 0; s.anim = 9; poseSpring(s); }
  for (const d of DSH) d.cool = 0;
  for (const m of MON) resetMonitor(m);
  resetStarPosts();
  resetBoss();
  capsuleReset(bossDone() && CP.ok);
  clearFX();
  cullPass();
  flush();
  writeRings();
}
function update(dt, t) {
  if (!ST.built) return;
  if (!fin(dt) || dt <= 0) dt = STEP;
  dt = Math.min(dt, 0.1);
  ST.T += dt; ST.frame++;
  U.time.value = ST.T % 600;
  glowN = 0;
  readPlayer();
  if (PL.onGround && !PL.dead) ST.chain = 0;
  const run = (fn) => { try { fn(dt); } catch (e) { console.error(e); } };
  if (ST.away) { run(updAway); run(updFX); writeFX(); return; }
  run(updRings);
  run(updEnemies);
  run(updSprings);
  run(updDash);
  run(updMonitors);
  run(updSpikes);
  run(updStarPosts);
  run(updBoss);
  run(updBombs);
  run(updCapsule);
  run(updAnimals);
  run(updFX);
  if (ST.frame % 6 === 0) cullPass();
  flush();
  writeFX();
}
function bossInfo() {
  const a = !ST.away && BS.ok && (BS.state === 'enter' || BS.state === 'fight' || BS.state === 'dying');
  return { active: !!a, hp: BS.hp, max: BS.max };
}
function stats() {
  let left = 0;
  for (let i = 0; i < RG.n; i++) if (!RG.got[i]) left++;
  let lost = 0;
  for (const r of RG.lost) if (r.on) lost++;
  let parts = 0;
  if (FXS.ready) for (const S of [FXS.alp, FXS.add]) for (const p of S.parts) if (p.on) parts++;
  return {
    rings: RG.n, ringsLeft: left, lost, enemies: EN.length, enemiesAlive: EN.filter(e => e.alive).length,
    monitors: MON.length, monitorsIntact: MON.filter(m => !m.broken).length, springs: SPR.length, dashPanels: DSH.length,
    spikes: SPK.length, posts: CPS.length, postsOn: CPS.filter(c => c.on).length, animals: AN.filter(a => a.on).length,
    shots: SHOTS.filter(s => s.on).length, lostPos: RG.lost.filter(r => r.on).map(r => r.pos.clone()), bombs: BOMBS.filter(b => b.on).length, particles: parts,
    boss: BS.state, bossHp: BS.hp, bossFlash: BS.flash, bossPos: BS.podC.clone(), ballPos: BS.ball.clone(), capsule: CP.state, env: !!ST.env
  };
}

K.entities = {
  build, reset, update, homingTarget, scatterRings, bossInfo, stats, setActive, get active() { return !ST.away; },
  _dbg() { return { EN, MON, SPR, DSH, CPS, AN, BS, CP, RG, POOLS, MAT, U }; } // dev probes only
};
K.fx = { burst };
})();
