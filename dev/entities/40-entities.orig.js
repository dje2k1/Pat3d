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
const { uniform, attribute, float, vec2, vec3, vec4, mix, pow: tpow, max: tmax, dot: tdot, clamp: tclamp, smoothstep, sin: tsin, normalize: tnormalize,
  select, positionGeometry, texture: ttexture, uv: tuv, mod: tmod, floor: tfloor, instancedBufferAttribute } = TSL;
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
const IDM = new THREE.Matrix4();
const _gv = new V3(), _gn = new V3(), _gc = new THREE.Color(), _nm = new THREE.Matrix3();
class GB {
  constructor() { this.p = []; this.n = []; this.c = []; this.u = []; this.r = []; this.i = []; this.count = 0; this.rm = null; }
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
      if (this.rm) this.r.push(this.rm[0], this.rm[1]);
    }
    const i0 = this.i.length;
    if (geo.index) { const ia = geo.index.array; for (let k = 0; k < ia.length; k++) this.i.push(base + ia[k]); }
    else for (let k = 0; k < pa.count; k++) this.i.push(base + k);
    if (m.determinant() < 0) for (let k = i0; k + 2 < this.i.length; k += 3) { const t = this.i[k + 1]; this.i[k + 1] = this.i[k + 2]; this.i[k + 2] = t; }
    this.count += pa.count;
    geo.dispose();
    return this;
  }
  build(withUV) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (withUV) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    if (this.r.length === this.count * 2 && this.count) g.setAttribute('aRM', new THREE.Float32BufferAttribute(this.r, 2));
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
const sph = (r, w, h) => new THREE.SphereGeometry(r, w || 16, h || 12);
const cyl = (rt, rb, h, s, open) => new THREE.CylinderGeometry(rt, rb, h, s || 16, 1, !!open);
const cone = (r, h, s) => new THREE.ConeGeometry(r, h, s || 12);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const tor = (R, r, rs, ts, arc) => new THREE.TorusGeometry(R, r, rs || 8, ts || 24, arc || TAU);
const lathe = (pts, s) => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(Math.max(0, p[0]), p[1])), s || 24);
function rbox(w, h, d, r, seg) {
  seg = seg || 4;
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
  seg = seg || 20; rad = rad || 10;
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
const RM = { gloss: [0.26, 0.02], paint: [0.62, 0], chrome: [0.2, 0.95] };
function partsOf(build) {
  const std = new GB(), glow = new GB();
  const view = rm => ({ add(geo, color, mat) { std.rm = rm; std.add(geo, color, mat); return this; } });
  build({ gloss: view(RM.gloss), paint: view(RM.paint), chrome: view(RM.chrome), glow });
  return { std: std.count ? std.build() : null, glow: glow.count ? glow.build() : null };
}
function meshesOf(group, geos, mats, cast) {
  const list = [];
  for (const k in geos) {
    if (!geos[k]) continue;
    const m = new THREE.Mesh(geos[k], (mats && mats[k]) || MAT[k]);
    m.castShadow = cast !== false && k !== 'glow';
    m.receiveShadow = k !== 'glow';
    group.add(m); list.push(m);
  }
  return list;
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
function staticCanvas() {
  return canvas(128, 128, (g) => {
    g.fillStyle = '#10142e'; g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 2) for (let x = 0; x < 128; x += 4) {
      const v = Math.floor(hash(x * 7.13 + y * 3.71) * 200 + 40);
      g.fillStyle = `rgb(${v},${v},${Math.min(255, v + 30)})`; g.fillRect(x, y, 4, 2);
    }
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, 40, 128, 6); g.fillRect(0, 92, 128, 3);
  });
}
function chevronCanvas() {
  return canvas(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    const path = () => { g.beginPath(); g.moveTo(64, 14); g.lineTo(118, 66); g.lineTo(118, 100); g.lineTo(64, 48); g.lineTo(10, 100); g.lineTo(10, 66); g.closePath(); };
    g.shadowColor = 'rgba(255,170,40,0.9)'; g.shadowBlur = 14;
    const gr = g.createLinearGradient(0, 14, 0, 100); gr.addColorStop(0, '#fff6b8'); gr.addColorStop(0.5, '#ffd23f'); gr.addColorStop(1, '#ff7a14');
    path(); g.fillStyle = gr; g.fill();
    g.shadowBlur = 0;
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.85)';
    g.beginPath(); g.moveTo(20, 70); g.lineTo(64, 27); g.lineTo(108, 70); g.stroke();
  });
}
function stripeCanvas() {
  return canvas(256, 64, (g) => {
    g.fillStyle = '#f2f5fb'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#d8322a';
    for (let x = -64; x < 300; x += 32) { g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 18, 0); g.lineTo(x + 34, 0); g.lineTo(x + 16, 64); g.closePath(); g.fill(); }
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 0, 256, 3); g.fillRect(0, 61, 256, 3);
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
function makeEnv() {
  const R = K.view && K.view.renderer;
  if (!R || typeof THREE.PMREMGenerator !== 'function') return null;
  let pm = null, geo = null, mat = null;
  try {
    const W = K.world;
    const sd = W && finV(W.sunDir) && W.sunDir.lengthSq() > 1e-6 ? W.sunDir.clone().normalize() : new V3(0.5, 0.7, -0.42).normalize();
    const sc = new THREE.Scene();
    geo = new THREE.SphereGeometry(20, 48, 24);
    // a simple bright island sky (gradient, cloud bands, hot sun) for the metal parts
    // PORT(entities): v2 GLSL sky ported 1:1; v3 can use the world's PMREM (scene.environment) instead
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
// one vertex-coloured PBR material for every procedural model; roughness/metalness come per vertex (aRM)
// PORT(entities): v2 = the same through MeshStandardMaterial shader injection; v3: painted metal, chrome, emissive eyes,
// K.tex PBR sets (SPEC3 §5).
function stdMaterial(env, met) {
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 1, metalness: met, envMap: env || null, envMapIntensity: 1 });
  const rm = attribute('aRM', 'vec2');
  m.roughnessNode = rm.x;
  m.metalnessNode = rm.y.mul(met);
  return m;
}
function makeMaterials(env) {
  const E = env || null, met = E ? 1 : 0.45;
  MAT.std = stdMaterial(E, met);
  MAT.glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  MAT.wing = new THREE.MeshStandardMaterial({ color: lin('#e3f4ff'), transparent: true, opacity: 0.42, roughness: 0.1, metalness: 0.2, envMap: E, side: THREE.DoubleSide, depthWrite: false });
  MAT.glass = new THREE.MeshStandardMaterial({ color: lin('#bfefff'), transparent: true, opacity: 0.26, roughness: 0.04, metalness: 0.1, envMap: E, envMapIntensity: 1.6, depthWrite: false });
  MAT.lampR = new THREE.MeshBasicMaterial({ color: COL.lampR, toneMapped: false });
  MAT.lampB = new THREE.MeshBasicMaterial({ color: COL.lampB, toneMapped: false });
  TEX.screen = {};
  for (const k of ['ring', 'shield', 'shoes', 'star', 'life']) TEX.screen[k] = texOf(screenCanvas(k), true);
  TEX.static = texOf(staticCanvas(), true);
  TEX.static.wrapS = TEX.static.wrapT = THREE.RepeatWrapping;
  MAT.screen = {};
  for (const k in TEX.screen) MAT.screen[k] = new THREE.MeshBasicMaterial({ map: TEX.screen[k], toneMapped: false });
  MAT.static = new THREE.MeshBasicMaterial({ map: TEX.static, toneMapped: false });
  TEX.chev = texOf(chevronCanvas(), true);
  TEX.chev.wrapT = THREE.RepeatWrapping; TEX.chev.wrapS = THREE.ClampToEdgeWrapping;
  TEX.chev.repeat.set(1, 2.4);
  MAT.chev = new THREE.MeshBasicMaterial({ map: TEX.chev, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 1, toneMapped: false });
  TEX.stripe = texOf(stripeCanvas(), true);
  TEX.stripe.wrapS = THREE.RepeatWrapping; TEX.stripe.repeat.set(4, 1);
  MAT.stripe = new THREE.MeshStandardMaterial({ map: TEX.stripe, roughness: 0.32, metalness: 0.05, envMap: E, envMapIntensity: 0.7 });
}

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
// PORT(entities): v2 drew these as GL point sprites (atlas tile, rotation, size in world units, fog: additive ones fade,
// alpha ones mix toward the fog colour); r186/WebGPU points are 1 px, so they are instanced sprites here (count = live).
function fxMaterial(additive) {
  return { additive, sprites: [] };
}
function fxSprite(n, additive, attrs) {
  const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, fog: !additive, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  m.positionNode = instancedBufferAttribute(attrs.aPos);
  m.scaleNode = instancedBufferAttribute(attrs.aSize);
  m.rotationNode = instancedBufferAttribute(attrs.aRot);
  const col = instancedBufferAttribute(attrs.aCol), tile = instancedBufferAttribute(attrs.aTile);
  const u = tuv();
  const tuvn = vec2(u.x, float(1).sub(u.y)).add(vec2(tmod(tile, 2), tfloor(tile.mul(0.5).add(0.01)))).mul(0.5);
  const t = ttexture(FXS.map, tuvn);
  m.colorNode = col.xyz.mul(t.rgb);
  m.opacityNode = col.w.mul(t.a);
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
const RG = { n: 0, pos: [], got: [], mesh: null, spin: { value: 0 }, lost: [], lostMesh: null, lostSpin: { value: 0 }, glowGeo: null, glowAttr: null, twk: 0, lostDirty: false, dirty: true, cullT: 0 };
const RING_FAR2 = 190 * 190; // farther rings are a few pixels wide: only their glow sprite is drawn
// PORT(entities): v2 spun the rings in the vertex shader (uSpin); r186 applies instancing before positionNode, so the
// shared torus is spun on the CPU (K.util.spinY in updRings). v3: polished gold PBR (SPEC3 §5).
function ringMaterial(spinU) {
  return new THREE.MeshStandardMaterial({
    color: COL.ring, metalness: ST.env ? 0.9 : 0.55, roughness: ST.env ? 0.22 : 0.32, envMap: ST.env || null, envMapIntensity: 1.25,
    emissive: COL.ringE, emissiveIntensity: 1
  });
}
function ringGeometry() {
  // phones: half the triangles (up to ~140 rings are on screen at once)
  const V = K.view, touch = !!V && (typeof V.isTouch === 'function' ? !!V.isTouch() : !!V.isTouch);
  const g = touch ? new THREE.TorusGeometry(0.44, 0.088, 8, 20) : new THREE.TorusGeometry(0.44, 0.088, 10, 32);
  g.scale(1, 1, 0.78);
  return g;
}
function setRingMatrix(arr, i, x, y, z, s) {
  const o = i * 16;
  arr[o] = s; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
  arr[o + 4] = 0; arr[o + 5] = s; arr[o + 6] = 0; arr[o + 7] = 0;
  arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = s; arr[o + 11] = 0;
  arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
}
function buildRings(scene) {
  const L = K.level && Array.isArray(K.level.rings) ? K.level.rings : [];
  for (const r of L) if (finV(r)) RG.pos.push(new V3(r.x, r.y, r.z));
  RG.n = RG.pos.length;
  RG.got = new Uint8Array(RG.n);
  const geo = ringGeometry();
  if (RG.n) {
    RG.mesh = new THREE.InstancedMesh(geo, ringMaterial(RG.spin), RG.n);
    RG.mesh.frustumCulled = false;
    const arr = RG.mesh.instanceMatrix.array;
    for (let i = 0; i < RG.n; i++) setRingMatrix(arr, i, RG.pos[i].x, RG.pos[i].y, RG.pos[i].z, 1);
    RG.mesh.instanceMatrix.needsUpdate = true;
    scene.add(RG.mesh);
    // soft golden halo behind every ring (one static point cloud)
    const p = new Float32Array(RG.n * 3), c = new Float32Array(RG.n * 4), s = new Float32Array(RG.n), r = new Float32Array(RG.n), t = new Float32Array(RG.n);
    for (let i = 0; i < RG.n; i++) {
      p[i * 3] = RG.pos[i].x; p[i * 3 + 1] = RG.pos[i].y; p[i * 3 + 2] = RG.pos[i].z;
      c[i * 4] = FCOL.ringGlow.r; c[i * 4 + 1] = FCOL.ringGlow.g; c[i * 4 + 2] = FCOL.ringGlow.b; c[i * 4 + 3] = 0.24;
      s[i] = 1.55;
    }
    RG.glowAttr = new THREE.InstancedBufferAttribute(c, 4);
    const pts = fxSprite(RG.n, true, { aPos: new THREE.InstancedBufferAttribute(p, 3), aCol: RG.glowAttr, aSize: new THREE.InstancedBufferAttribute(s, 1), aRot: new THREE.InstancedBufferAttribute(r, 1), aTile: new THREE.InstancedBufferAttribute(t, 1) });
    pts.count = RG.n;
    pts.renderOrder = 19;
    scene.add(pts);
    RG.glowGeo = pts;
  }
  for (let i = 0; i < 32; i++) RG.lost.push({ on: false, pos: new V3(), vel: new V3(), t: 0 });
  RG.lostMesh = new THREE.InstancedMesh(RG.n ? geo.clone() : geo, ringMaterial(RG.lostSpin), 32);
  RG.lostMesh.frustumCulled = false;
  const la = RG.lostMesh.instanceMatrix.array;
  for (let i = 0; i < 32; i++) setRingMatrix(la, i, 0, -1e4, 0, 0);
  RG.lostMesh.count = 0;
  RG.lostMesh.instanceMatrix.needsUpdate = true;
  scene.add(RG.lostMesh);
}
function setRingGot(i, got) {
  RG.got[i] = got ? 1 : 0;
  RG.dirty = true;
  if (RG.glowAttr) { RG.glowAttr.array[i * 4 + 3] = got ? 0 : 0.24; RG.glowAttr.needsUpdate = true; }
}
// packs the rings still on the field and near the camera into the first instances (instance count = drawn rings)
function writeRings() {
  if (!RG.mesh) return;
  const cam = K.view && K.view.camera, cp = cam && finV(cam.position) ? cam.position : null;
  const arr = RG.mesh.instanceMatrix.array;
  let k = 0;
  for (let i = 0; i < RG.n; i++) {
    if (RG.got[i]) continue;
    const p = RG.pos[i];
    if (cp) { const dx = p.x - cp.x, dy = p.y - cp.y, dz = p.z - cp.z; if (dx * dx + dy * dy + dz * dz > RING_FAR2) continue; }
    setRingMatrix(arr, k++, p.x, p.y, p.z, 1);
  }
  RG.mesh.count = k;
  RG.mesh.instanceMatrix.needsUpdate = true;
  RG.dirty = false; RG.cullT = 6;
}
function resetRings() {
  for (let i = 0; i < RG.n; i++) if (RG.got[i]) setRingGot(i, false);
  for (const r of RG.lost) r.on = false;
  RG.lostDirty = true;
}
function updRings(dt) {
  RG.spin.value = (RG.spin.value + dt * 4.4) % TAU;
  if (RG.mesh) K.util.spinY(RG.mesh.geometry, -RG.spin.value);
  if (RG.dirty || --RG.cullT <= 0) writeRings();
  RG.lostSpin.value = (RG.lostSpin.value + dt * 10) % TAU;
  if (RG.lostMesh) K.util.spinY(RG.lostMesh.geometry, -RG.lostSpin.value);
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
      _w.set(p.x + Math.cos(a) * 0.38 * Math.cos(RG.spin.value), p.y + Math.sin(a) * 0.4, p.z - Math.cos(a) * 0.38 * Math.sin(RG.spin.value));
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
  const sea = seaY(), dy0 = deathY();
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
    setRingMatrix(arr, i, p.x, p.y, p.z, blink ? 0 : 1);
  }
  if (any) {
    let last = -1;
    for (let i = 0; i < RG.lost.length; i++) if (RG.lost[i].on) last = i;
    RG.lostMesh.count = last + 1;
    RG.lostMesh.instanceMatrix.needsUpdate = true;
  }
}

// ===================== models =====================
const TPL = {};
function tplBug() {
  const shell = (x, y, z, o) => o.copy(COL.red).lerp(COL.redD, clamp((1 - y) * 0.55, 0, 0.6));
  const body = partsOf((g) => {
    g.paint.add(cyl(0.5, 0.56, 0.16, 24), COL.steelD, TRS(0, 0.33, 0, 0, 0, 0, 1, 1, 1.18));
    g.chrome.add(tor(0.53, 0.045, 8, 32), COL.silver, TRS(0, 0.41, 0, Math.PI / 2, 0, 0, 1, 1.18, 1));
    g.paint.add(new THREE.SphereGeometry(1, 20, 10, 0, TAU, 0, Math.PI / 2), COL.black, TRS(0, 0.4, -0.04, 0, 0, 0, 0.56, 0.49, 0.68));
    for (const s of [-1, 1]) {
      g.gloss.add(new THREE.SphereGeometry(1, 22, 12, s > 0 ? Math.PI / 2 : -Math.PI / 2, Math.PI, 0, Math.PI / 2), shell, TRS(s * 0.035, 0.41, -0.04, 0, 0, 0, 0.6, 0.53, 0.72));
      for (const [a, b, c, r] of [[0.62, 0.6, 0.45, 0.1], [0.42, 0.82, -0.2, 0.12], [0.9, 0.32, -0.25, 0.09], [0.4, 0.5, -0.78, 0.1], [0.75, 0.25, 0.55, 0.07]]) {
        _v.set(a, b, c).normalize();
        const px = s * _v.x * 0.6 + s * 0.035, py = 0.41 + _v.y * 0.53, pz = -0.04 + _v.z * 0.72;
        _w.set(s * _v.x / 0.6, _v.y / 0.53, _v.z / 0.72).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(ZV, _w);
        g.paint.add(sph(1, 14, 8), COL.black, TRq(px, py, pz, q, r, r, 0.03));
      }
      // eyes: chrome bezel, white ball, red lens
      g.chrome.add(tor(0.118, 0.03, 8, 20), COL.silver, TRS(s * 0.13, 0.56, 0.775, 0, s * 0.3, 0));
      g.gloss.add(sph(0.108, 16, 12), COL.eyeW, TRS(s * 0.13, 0.56, 0.76));
      g.glow.add(sph(0.05, 12, 8), COL.lensR, TRS(s * 0.145, 0.565, 0.86, 0, 0, 0, 1, 1, 0.45));
      g.glow.add(sph(0.018, 8, 6), COL.eyeW, TRS(s * 0.12, 0.6, 0.875));
      // antennae
      stick(g.chrome, s * 0.08, 0.68, 0.62, s * 0.2, 1.02, 0.82, 0.022, 0.016, COL.silver, 6);
      g.glow.add(sph(0.055, 10, 8), COL.yellow, TRS(s * 0.205, 1.04, 0.83));
      // mandibles
      g.chrome.add(cone(0.045, 0.2, 8), COL.silver, TRS(s * 0.09, 0.36, 0.86, Math.PI / 2, 0, -s * 0.35));
      // side bolts
      g.chrome.add(sph(0.04, 8, 6), COL.silver, TRS(s * 0.56, 0.34, 0.25));
      g.chrome.add(sph(0.04, 8, 6), COL.silver, TRS(s * 0.56, 0.34, -0.25));
    }
    g.gloss.add(sph(0.27, 20, 14), COL.ink, TRS(0, 0.47, 0.6, 0, 0, 0, 1.06, 0.88, 0.9));
  });
  const axle = partsOf((g) => {
    for (const s of [-1, 1]) {
      g.paint.add(cyl(0.165, 0.165, 0.12, 20), COL.tire, TRS(s * 0.47, 0, 0, 0, 0, Math.PI / 2));
      g.paint.add(cyl(0.09, 0.09, 0.135, 14), COL.hub, TRS(s * 0.475, 0, 0, 0, 0, Math.PI / 2));
      g.paint.add(box(0.02, 0.25, 0.05), COL.hub, TRS(s * 0.54, 0, 0));
      g.paint.add(box(0.02, 0.05, 0.25), COL.hub, TRS(s * 0.54, 0, 0));
    }
  });
  return { body, axle };
}
function tplWasp() {
  const body = partsOf((g) => {
    g.gloss.add(sph(0.27, 20, 14), (x, y, z, o) => o.copy(COL.gun).lerp(COL.waspY, y > 0.12 && y < 0.2 ? 1 : 0), TRS(0, 0, 0, 0, 0, 0, 1, 0.95, 1.1));
    g.gloss.add(tor(0.262, 0.04, 8, 28), COL.waspY, TRS(0, 0, 0.0, 0, 0, 0, 1, 0.95, 1));
    g.chrome.add(tor(0.16, 0.045, 8, 20), COL.silver, TRS(0, 0.03, 0.27));
    g.gloss.add(sph(0.245, 22, 16), (x, y, z, o) => o.copy(COL.gun).lerp(COL.waspY, smooth((z - 0.02) / 0.14) * (1 - smooth((y + 0.02) / 0.1))), TRS(0, 0.05, 0.42));
    g.gloss.add(tor(0.2, 0.03, 6, 22), COL.waspK, TRS(0, 0.06, 0.39, 0, 0, 0, 1, 1.05, 1));
    for (const s of [-1, 1]) {
      g.gloss.add(sph(1, 18, 14), COL.eyeR, TRS(s * 0.155, 0.1, 0.53, 0, s * 0.5, 0, 0.1, 0.15, 0.115));
      g.glow.add(sph(0.026, 8, 6), COL.eyeW, TRS(s * 0.17, 0.18, 0.6));
      g.glow.add(sph(0.014, 6, 5), COL.eyeW, TRS(s * 0.2, 0.06, 0.6));
      stick(g.chrome, s * 0.07, 0.26, 0.46, s * 0.2, 0.5, 0.8, 0.02, 0.014, COL.silver, 6);
      g.glow.add(sph(0.045, 8, 6), COL.yellow, TRS(s * 0.205, 0.51, 0.81));
      g.chrome.add(cone(0.035, 0.16, 8), COL.silver, TRS(s * 0.07, -0.1, 0.62, Math.PI / 2 + 0.4, 0, -s * 0.4));
      for (const z of [0.12, 0, -0.12]) stick(g.chrome, s * 0.13, -0.18, z, s * 0.24, -0.42, z + 0.08, 0.018, 0.014, COL.steelL, 5);
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
      for (let i = 0; i <= 6; i++) { const y = a + (b - a) * i / 6; pts.push([rAt(y), y]); }
      g.gloss.add(lathe(pts, 24), col, TRS(0, 0, 0, -Math.PI / 2, 0, 0));
    }
    g.chrome.add(cone(0.075, 0.32, 10), COL.silver, TRS(0, 0, -1.12, -Math.PI / 2, 0, 0));
    g.glow.add(sph(0.05, 8, 6), COL.orange, TRS(0, 0, -1.28));
  });
  const wingGeo = () => {
    const gb = new GB();
    gb.add(sph(1, 18, 6), COL.white, TRS(0.36, 0, 0.02, 0, 0.28, 0, 0.38, 0.012, 0.13));
    gb.add(sph(1, 18, 6), COL.white, TRS(0.26, -0.02, -0.16, 0, 0.5, 0, 0.27, 0.01, 0.1));
    return gb.build();
  };
  return { body, abd, wing: wingGeo() };
}
function tplFish() {
  const skin = (x, y, z, o) => {
    o.copy(COL.fishB).lerp(COL.fishBD, smooth((y - 0.1) / 0.8));
    const belly = smooth((-y - 0.15) / 0.45) * smooth((z + 0.6) / 0.6);
    o.lerp(COL.fishW, belly);
  };
  const body = partsOf((g) => {
    g.gloss.add(sph(1, 26, 18), skin, TRS(0, 0, 0, 0, 0, 0, 0.37, 0.45, 0.6));
    g.chrome.add(tor(0.36, 0.035, 8, 28), COL.silver, TRS(0, 0, -0.24, 0, 0, 0, 0.95, 1.12, 1));
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; g.chrome.add(sph(0.03, 6, 5), COL.silver, TRS(Math.cos(a) * 0.36, Math.sin(a) * 0.42, -0.2)); }
    g.paint.add(sph(1, 18, 12), COL.mouth, TRS(0, -0.14, 0.42, 0, 0, 0, 0.25, 0.14, 0.18));
    for (const s of [-1, 1]) {
      g.gloss.add(sph(0.13, 16, 12), COL.eyeW, TRS(s * 0.2, 0.17, 0.36));
      g.paint.add(sph(0.062, 12, 8), COL.black, TRS(s * 0.245, 0.18, 0.455));
      g.glow.add(sph(0.02, 6, 5), COL.eyeW, TRS(s * 0.23, 0.21, 0.5));
      g.paint.add(box(0.2, 0.05, 0.08), COL.fishBD, TRS(s * 0.2, 0.32, 0.38, 0, 0, s * 0.42));
      g.gloss.add(sph(1, 12, 8), COL.fin, TRS(s * 0.38, -0.1, 0.02, 0.3, s * 0.5, s * 0.6, 0.05, 0.16, 0.24));
    }
    for (let i = 0; i < 6; i++) { const x = (i - 2.5) * 0.072; g.gloss.add(cone(0.034, 0.1, 6), COL.tooth, TRS(x, -0.09, 0.565 - x * x * 2.2, Math.PI, 0, 0)); }
    g.gloss.add(cone(0.22, 0.42, 14), COL.fin, TRS(0, 0.48, -0.08, -0.45, 0, 0, 0.22, 1, 1));
  });
  const jaw = partsOf((g) => {
    g.gloss.add(new THREE.SphereGeometry(1, 20, 8, 0, TAU, Math.PI / 2, Math.PI / 2), (x, y, z, o) => o.copy(COL.fishW).lerp(COL.fishB, smooth(-y * 1.4)), TRS(0, 0.0, 0.14, 0, 0, 0, 0.28, 0.14, 0.34));
    g.paint.add(cyl(1, 1, 0.02, 20), COL.mouth, TRS(0, 0.0, 0.14, 0, 0, 0, 0.265, 1, 0.325));
    for (let i = 0; i < 5; i++) { const x = (i - 2) * 0.08; g.gloss.add(cone(0.032, 0.1, 6), COL.tooth, TRS(x, 0.045, 0.44 - x * x * 3)); }
  });
  const tail = partsOf((g) => {
    g.chrome.add(sph(0.09, 10, 8), COL.silver, TRS(0, 0, 0));
    g.gloss.add(cone(0.2, 0.5, 12), COL.fin, TRS(0, 0.17, -0.22, -2.3, 0, 0, 0.2, 1, 1));
    g.gloss.add(cone(0.2, 0.5, 12), COL.fin, TRS(0, -0.17, -0.22, -0.84, 0, 0, 0.2, 1, 1));
  });
  return { body, jaw, tail };
}
function tplAnimals() {
  const bunny = partsOf((g) => {
    g.paint.add(sph(0.17, 16, 12), (x, y, z, o) => o.copy(COL.bunny).lerp(COL.bunnyS, smooth(-y / 0.17)), TRS(0, 0.17, -0.02, 0, 0, 0, 1, 0.92, 1.15));
    g.paint.add(sph(0.13, 16, 12), COL.bunny, TRS(0, 0.36, 0.12));
    for (const s of [-1, 1]) {
      g.paint.add(sph(1, 10, 8), COL.bunny, TRS(s * 0.055, 0.55, 0.07, -0.15, 0, -s * 0.2, 0.042, 0.15, 0.03));
      g.paint.add(sph(1, 10, 8), COL.pink, TRS(s * 0.058, 0.55, 0.095, -0.15, 0, -s * 0.2, 0.022, 0.11, 0.012));
      g.paint.add(sph(0.026, 8, 6), COL.black, TRS(s * 0.062, 0.39, 0.225));
      g.paint.add(sph(1, 8, 6), COL.bunnyS, TRS(s * 0.08, 0.03, 0.08, 0, 0, 0, 0.05, 0.035, 0.09));
      g.paint.add(sph(1, 8, 6), COL.pink, TRS(s * 0.08, 0.33, 0.2, 0, 0, 0, 0.03, 0.02, 0.01));
    }
    g.paint.add(sph(0.022, 8, 6), COL.pink, TRS(0, 0.355, 0.252));
    g.paint.add(sph(0.065, 10, 8), COL.eyeW, TRS(0, 0.2, -0.2));
  });
  const bird = partsOf((g) => {
    g.paint.add(sph(0.13, 16, 12), (x, y, z, o) => o.copy(COL.bird).lerp(COL.birdL, smooth((-y + 0.02) / 0.1) * smooth((z + 0.05) / 0.12)), TRS(0, 0, 0, 0, 0, 0, 1, 0.95, 1.2));
    g.paint.add(sph(0.1, 14, 10), COL.bird, TRS(0, 0.12, 0.11));
    g.paint.add(cone(0.035, 0.1, 8), COL.beak, TRS(0, 0.1, 0.24, Math.PI / 2, 0, 0));
    for (const s of [-1, 1]) {
      g.paint.add(sph(0.034, 8, 6), COL.eyeW, TRS(s * 0.055, 0.15, 0.19));
      g.paint.add(sph(0.02, 8, 6), COL.black, TRS(s * 0.062, 0.152, 0.212));
    }
    g.paint.add(cone(0.07, 0.16, 8), COL.birdD, TRS(0, 0.02, -0.19, -Math.PI / 2 - 0.3, 0, 0, 1, 1, 0.35));
    g.paint.add(sph(0.03, 6, 5), COL.beak, TRS(0.03, -0.12, 0.02));
    g.paint.add(sph(0.03, 6, 5), COL.beak, TRS(-0.03, -0.12, 0.02));
  });
  const wing = partsOf((g) => { g.paint.add(sph(1, 12, 6), COL.birdD, TRS(0.1, 0, -0.02, 0, 0.2, 0, 0.12, 0.018, 0.075)); });
  return { bunny, bird, wing };
}
function tplSpring() {
  const helix = (() => {
    class Helix extends THREE.Curve {
      getPoint(t, out) { const o = out || new V3(); const a = t * TAU * 3.5; return o.set(Math.cos(a) * 0.48, t, Math.sin(a) * 0.48); }
    }
    return new THREE.TubeGeometry(new Helix(), 90, 0.06, 8, false);
  })();
  const coil = partsOf((g) => { g.chrome.add(helix, COL.silver); });
  const base = partsOf((g) => {
    g.paint.add(cyl(0.8, 0.88, 0.16, 28), COL.steelD, TRS(0, 0.08, 0));
    g.chrome.add(tor(0.8, 0.03, 6, 32), COL.silver, TRS(0, 0.16, 0, Math.PI / 2, 0, 0));
    g.paint.add(cyl(0.2, 0.2, 0.06, 12), COL.steel, TRS(0, 0.19, 0));
  });
  const capOf = (col, colD) => partsOf((g) => {
    g.gloss.add(lathe([[0, 0], [0.7, 0], [0.77, 0.04], [0.79, 0.12], [0.75, 0.2], [0.6, 0.225], [0, 0.225]], 32), vgrad(col, colD, 0.2, 0));
    g.gloss.add(tor(0.43, 0.05, 8, 32), COL.white, TRS(0, 0.225, 0, Math.PI / 2, 0, 0, 1, 1, 0.45));
    g.gloss.add(cyl(0.16, 0.16, 0.02, 20), COL.white, TRS(0, 0.232, 0));
    g.paint.add(cyl(0.62, 0.62, 0.06, 28), COL.steelD, TRS(0, -0.03, 0));
  });
  return { coil, base, capY: capOf(COL.yellow, COL.yellowD), capR: capOf(lin('#ff4b3a'), lin('#b8160f')) };
}
function tplDash() {
  const base = partsOf((g) => {
    g.paint.add(rbox(2.6, 0.14, 3.5, 0.06, 3), COL.panel, TRS(0, 0.07, 0));
    for (const s of [-1, 1]) {
      g.gloss.add(rbox(0.14, 0.17, 3.5, 0.05, 2), COL.yellow, TRS(s * 1.23, 0.085, 0));
      g.chrome.add(box(0.06, 0.04, 3.2), COL.silver, TRS(s * 1.12, 0.16, 0));
    }
    g.gloss.add(rbox(2.6, 0.17, 0.14, 0.05, 2), COL.yellow, TRS(0, 0.085, 1.68));
    g.gloss.add(rbox(2.6, 0.17, 0.14, 0.05, 2), COL.yellow, TRS(0, 0.085, -1.68));
    for (const s of [-1, 1]) for (const z of [-1.35, 0, 1.35]) g.glow.add(sph(0.05, 8, 6), COL.orange, TRS(s * 1.23, 0.18, z));
  });
  const arrows = new THREE.PlaneGeometry(2.1, 3.1);
  arrows.rotateX(-Math.PI / 2);
  arrows.translate(0, 0.145, 0);
  return { base, arrows };
}
function tplMonitor() {
  const body = partsOf((g) => {
    g.paint.add(rbox(0.92, 0.12, 0.92, 0.04, 3), COL.steelD, TRS(0, 0.06, 0));
    g.gloss.add(rbox(1.04, 1.0, 1.04, 0.12, 5), vgrad(COL.white, lin('#aab2c4'), 0.5, -0.5), TRS(0, 0.62, 0));
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      g.paint.add(rbox(0.82, 0.74, 0.06, 0.05, 2), COL.navy, TRS(Math.sin(a) * 0.505, 0.64, Math.cos(a) * 0.505, 0, a, 0));
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.chrome.add(sph(0.05, 8, 6), COL.silver, TRS(sx * 0.4, 1.12, sz * 0.4));
    g.chrome.add(cyl(0.12, 0.16, 0.06, 16), COL.silver, TRS(0, 1.14, 0));
  });
  const sg = new GB();
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    sg.add(new THREE.PlaneGeometry(0.66, 0.58), COL.white, TRS(Math.sin(a) * 0.54, 0.64, Math.cos(a) * 0.54, 0, a, 0));
  }
  const wreck = partsOf((g) => {
    g.paint.add(rbox(0.92, 0.12, 0.92, 0.04, 3), COL.steelD, TRS(0, 0.06, 0));
    g.paint.add(cyl(0.42, 0.46, 0.08, 12), COL.ink, TRS(0, 0.15, 0));
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * TAU + 0.3, h = 0.16 + hash(i * 3.1) * 0.26;
      g.gloss.add(box(0.2, h, 0.05), lin('#9aa3b8'), TRS(Math.sin(a) * 0.42, 0.12 + h / 2, Math.cos(a) * 0.42, (hash(i) - 0.5) * 0.6, a, (hash(i + 7) - 0.5) * 0.7));
    }
  });
  return { body, screens: sg.build(true), wreck };
}
function tplStarPost() {
  const post = partsOf((g) => {
    g.paint.add(cyl(0.38, 0.47, 0.16, 20), COL.steelD, TRS(0, 0.08, 0));
    g.chrome.add(tor(0.38, 0.03, 6, 24), COL.silver, TRS(0, 0.16, 0, Math.PI / 2, 0, 0));
    g.gloss.add(cyl(0.085, 0.1, 1.72, 16), vgrad(COL.blueL, COL.blue, 1.0, -0.5), TRS(0, 1.02, 0));
    for (const y of [0.52, 1.02, 1.52]) g.gloss.add(tor(0.1, 0.024, 6, 18), COL.white, TRS(0, y, 0, Math.PI / 2, 0, 0));
    g.chrome.add(sph(0.17, 18, 12), COL.silver, TRS(0, 1.9, 0));
    g.chrome.add(cyl(0.05, 0.05, 0.42, 8), COL.silver, TRS(0, 1.9, 0, 0, 0, Math.PI / 2));
  });
  const arm = partsOf((g) => { g.chrome.add(cyl(0.032, 0.04, 0.36, 8), COL.silver, TRS(0, 0.2, 0)); });
  const lamp = sph(0.155, 18, 12);
  return { post, arm, lamp };
}
function tplBoss() {
  const hullCol = (x, y, z, o) => { o.copy(COL.white).lerp(lin('#9aa3b8'), smooth((-y - 0.2) / 0.8)); };
  const pod = partsOf((g) => {
    g.gloss.add(lathe([[0, -1.05], [0.45, -1.02], [0.95, -0.9], [1.4, -0.64], [1.78, -0.32], [2.02, -0.02], [2.1, 0.16], [2.06, 0.32], [1.88, 0.43], [1.62, 0.47], [1.5, 0.4]], 44), hullCol);
    g.gloss.add(tor(2.07, 0.075, 8, 48), COL.yellow, TRS(0, 0.17, 0, Math.PI / 2, 0, 0));
    g.chrome.add(tor(1.6, 0.085, 8, 44), COL.silver, TRS(0, 0.45, 0, Math.PI / 2, 0, 0));
    g.chrome.add(tor(1.25, 0.05, 6, 40), COL.steelL, TRS(0, -0.75, 0, Math.PI / 2, 0, 0));
    for (const s of [-1, 1]) {
      g.chrome.add(cyl(0.3, 0.38, 0.5, 16), COL.steelL, TRS(s * 1.15, -0.78, -0.35));
      g.paint.add(cyl(0.22, 0.22, 0.06, 14), COL.steelD, TRS(s * 1.15, -1.04, -0.35));
      g.gloss.add(box(0.12, 0.55, 0.5), COL.coat, TRS(s * 1.25, 0.55, -1.15, -0.5, 0, s * 0.2));
    }
    g.chrome.add(cyl(0.12, 0.2, 0.25, 12), COL.steelL, TRS(0, -1.12, 0));
    g.chrome.add(tor(0.13, 0.045, 6, 14), COL.silver, TRS(0, -1.28, 0, 0, Math.PI / 2, 0));
    g.chrome.add(cyl(0.025, 0.025, 0.6, 6), COL.silver, TRS(0, 0.75, -1.45, -0.35, 0, 0));
    g.glow.add(sph(0.07, 10, 8), COL.lampR, TRS(0, 1.03, -1.55));
    // Dr Boulon
    g.gloss.add(sph(1, 22, 16), COL.coat, TRS(0, 0.58, -0.05, 0, 0, 0, 0.74, 0.6, 0.58));
    g.gloss.add(tor(0.26, 0.085, 8, 20), COL.white, TRS(0, 1.06, 0, Math.PI / 2, 0, 0));
    g.gloss.add(sph(0.05, 8, 6), COL.yellow, TRS(0, 0.88, 0.5));
    g.gloss.add(sph(0.05, 8, 6), COL.yellow, TRS(0, 0.68, 0.55));
    g.paint.add(box(0.06, 0.5, 0.04), COL.coatD, TRS(0, 0.78, 0.535, -0.25, 0, 0));
    for (const s of [-1, 1]) {
      stick(g.gloss, s * 0.6, 0.86, 0.02, s * 0.42, 0.62, 0.78, 0.15, 0.12, COL.coat, 12);
      g.gloss.add(sph(0.15, 12, 10), COL.glove, TRS(s * 0.42, 0.62, 0.8));
      g.gloss.add(sph(0.1, 10, 8), COL.skin, TRS(s * 0.47, 1.4, 0));
    }
    g.gloss.add(sph(0.48, 26, 20), COL.skin, TRS(0, 1.42, 0.02));
    g.gloss.add(sph(0.16, 14, 12), COL.nose, TRS(0, 1.33, 0.49));
    for (const s of [-1, 1]) {
      const pts = [new V3(s * 0.02, 1.22, 0.5), new V3(s * 0.25, 1.2, 0.49), new V3(s * 0.52, 1.24, 0.38), new V3(s * 0.74, 1.38, 0.24), new V3(s * 0.8, 1.58, 0.16)];
      g.gloss.add(tubeVar(pts, t => 0.14 * Math.pow(1 - t, 0.75) + 0.02, 24, 10), COL.stache);
      g.gloss.add(sph(0.14, 12, 10), COL.stache, TRS(s * 0.04, 1.22, 0.5));
      g.gloss.add(sph(0.022, 8, 6), COL.stache, TRS(s * 0.8, 1.58, 0.16));
      g.chrome.add(cyl(0.17, 0.17, 0.1, 18), COL.silver, TRS(s * 0.19, 1.52, 0.43, Math.PI / 2 - 0.15, 0, 0));
    }
    g.paint.add(tor(0.475, 0.05, 8, 32), COL.steelD, TRS(0, 1.52, 0.01, Math.PI / 2 - 0.15, 0, 0));
    g.paint.add(box(0.95, 0.24, 0.32), COL.steelD, TRS(0, 0.46, 0.95, -0.4, 0, 0));
    g.glow.add(sph(0.045, 8, 6), COL.lampR, TRS(-0.25, 0.6, 0.93));
    g.glow.add(sph(0.045, 8, 6), lin('#56ff7a'), TRS(0, 0.6, 0.93));
    g.glow.add(sph(0.045, 8, 6), COL.yellow, TRS(0.25, 0.6, 0.93));
  });
  const lens = partsOf((g) => { for (const s of [-1, 1]) g.glow.add(cyl(0.135, 0.135, 0.02, 18), COL.white, TRS(s * 0.19, 1.528, 0.485, Math.PI / 2 - 0.15, 0, 0)); }).glow;
  const lightsA = partsOf((g) => { for (let i = 0; i < 8; i += 2) { const a = i / 8 * TAU + Math.PI / 8; g.glow.add(sph(0.09, 10, 8), COL.lampR, TRS(Math.sin(a) * 1.97, -0.12, Math.cos(a) * 1.97)); } }).glow;
  const lightsB = partsOf((g) => { for (let i = 1; i < 8; i += 2) { const a = i / 8 * TAU + Math.PI / 8; g.glow.add(sph(0.09, 10, 8), COL.yellow, TRS(Math.sin(a) * 1.97, -0.12, Math.cos(a) * 1.97)); } }).glow;
  const dome = new THREE.SphereGeometry(1.58, 36, 14, 0, TAU, 0, Math.PI / 2);
  dome.translate(0, 0.45, 0);
  const ball = partsOf((g) => {
    for (let k = 0; k < 4; k++) for (let h = 0; h < 2; h++) {
      g.gloss.add(new THREE.SphereGeometry(1.05, 10, 8, k * Math.PI / 2, Math.PI / 2, h * Math.PI / 2, Math.PI / 2), (k + h) % 2 ? lin('#e8ebf2') : lin('#23262f'));
    }
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) dirs.push([a, b, c]);
    for (const [x, y, z] of dirs) {
      _v.set(x, y, z).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(UPV, _v);
      g.chrome.add(cone(0.17, 0.52, 10), COL.silver, TRq(_v.x * 1.18, _v.y * 1.18, _v.z * 1.18, q));
    }
    g.chrome.add(cyl(0.16, 0.2, 0.22, 12), COL.steelL, TRS(0, 1.1, 0));
    g.chrome.add(tor(0.14, 0.045, 6, 14), COL.silver, TRS(0, 1.3, 0));
  });
  const link = partsOf((g) => { g.chrome.add(new THREE.TorusGeometry(0.16, 0.05, 6, 14), COL.silver, TRS(0, 0, 0, 0, 0, 0, 1, 1.5, 1)); }).std;
  const bomb = partsOf((g) => {
    g.gloss.add(sph(0.42, 20, 14), COL.ink);
    g.chrome.add(cyl(0.15, 0.17, 0.12, 14), COL.steelL, TRS(0, 0.43, 0));
    stick(g.paint, 0, 0.48, 0, 0.06, 0.66, 0.04, 0.025, 0.02, lin('#e8d7a8'), 6);
    g.gloss.add(sph(1, 10, 6), COL.white, TRS(-0.17, 0.2, 0.3, 0, 0, 0, 0.1, 0.06, 0.04));
  });
  return { pod, lens, lightsA, lightsB, dome, ball, link, bomb };
}
function tplCapsule() {
  const body = partsOf((g) => {
    g.paint.add(cyl(2.05, 2.25, 0.45, 8), COL.steel, TRS(0, 0.225, 0, 0, Math.PI / 8, 0));
    g.gloss.add(tor(2.03, 0.06, 6, 8), COL.yellow, TRS(0, 0.45, 0, Math.PI / 2, 0, Math.PI / 8));
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.chrome.add(box(0.5, 0.25, 0.5), COL.steelL, TRS(Math.cos(a) * 1.9, 0.12, Math.sin(a) * 1.9, 0, -a, 0)); }
    g.gloss.add(cyl(1.7, 1.76, 0.65, 40), COL.white, TRS(0, 0.775, 0));
    g.gloss.add(cyl(1.7, 1.7, 0.6, 40), COL.white, TRS(0, 2.05, 0));
    g.chrome.add(tor(1.72, 0.05, 6, 48), COL.silver, TRS(0, 1.1, 0, Math.PI / 2, 0, 0));
    g.chrome.add(tor(1.72, 0.05, 6, 48), COL.silver, TRS(0, 1.75, 0, Math.PI / 2, 0, 0));
    g.paint.add(cyl(1.55, 1.55, 0.04, 32), COL.ink, TRS(0, 2.36, 0));
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; g.glow.add(sph(0.08, 10, 8), COL.lampR, TRS(Math.cos(a) * 1.76, 0.75, Math.sin(a) * 1.76)); }
  });
  const band = new THREE.CylinderGeometry(1.72, 1.72, 0.62, 48, 1, true);
  band.translate(0, 1.425, 0);
  const lid = partsOf((g) => {
    g.gloss.add(lathe([[1.76, 0], [1.74, 0.12], [1.5, 0.3], [1.0, 0.42], [0.75, 0.44], [0, 0.44]], 40), vgrad(COL.white, COL.grey, 0.44, 0), TRS(0, 2.33, 0));
    g.chrome.add(cyl(0.8, 0.86, 0.14, 32), COL.silver, TRS(0, 2.81, 0));
    g.chrome.add(tor(0.79, 0.04, 6, 32), COL.steelL, TRS(0, 2.88, 0, Math.PI / 2, 0, 0));
  });
  const button = partsOf((g) => {
    g.gloss.add(lathe([[0, -0.04], [0.68, -0.04], [0.7, 0.14], [0.67, 0.3], [0.52, 0.4], [0, 0.43]], 32), vgrad(COL.yellow, COL.yellowD, 0.42, 0));
    g.gloss.add(sph(1, 16, 8), COL.white, TRS(-0.2, 0.36, 0.2, 0, 0, 0.35, 0.16, 0.035, 0.1));
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
  if (need.bug) TPL.bug = tplBug();
  if (need.wasp) TPL.wasp = tplWasp();
  if (need.fish) TPL.fish = tplFish();
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
      meshesOf(body, TPL.bug.body);
      e.axles = [];
      for (const z of [0.36, -0.36]) { const a = new THREE.Group(); a.position.set(0, 0.165, z); meshesOf(a, TPL.bug.axle); body.add(a); e.axles.push(a); }
      e.hitR = 0.85;
    } else if (type === 'wasp') {
      const body = new THREE.Group(); e.root.add(body); e.body = body;
      meshesOf(body, TPL.wasp.body);
      const abd = new THREE.Group(); abd.position.set(0, -0.02, -0.2); meshesOf(abd, TPL.wasp.abd); body.add(abd); e.abd = abd;
      e.wings = [];
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(TPL.wasp.wing, MAT.wing);
        w.position.set(s * 0.12, 0.2, 0.02); w.scale.x = s; w.renderOrder = 5;
        body.add(w); e.wings.push(w);
      }
      e.hitR = 0.9;
    } else {
      const body = new THREE.Group(); e.root.add(body); e.body = body;
      meshesOf(body, TPL.fish.body);
      const jaw = new THREE.Group(); jaw.position.set(0, -0.14, 0.18); meshesOf(jaw, TPL.fish.jaw); body.add(jaw); e.jaw = jaw;
      const tail = new THREE.Group(); tail.position.set(0, 0, -0.56); meshesOf(tail, TPL.fish.tail); body.add(tail); e.tail = tail;
      e.hitR = 0.85;
      setupFish(e);
    }
    scene.add(e.root);
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
    meshesOf(a.bunny, TPL.animals.bunny);
    meshesOf(a.bird, TPL.animals.bird);
    for (const s of [-1, 1]) {
      const w = new THREE.Group(); w.position.set(s * 0.09, 0.04, 0); w.scale.x = s;
      meshesOf(w, TPL.animals.wing); a.bird.add(w); a.wings.push(w);
    }
    a.root.add(a.bunny, a.bird);
    a.root.visible = false;
    scene.add(a.root);
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
  const T = TPL.spring || (TPL.spring = tplSpring());
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
    meshesOf(head, T.base);
    const coil = new THREE.Group(); coil.position.y = 0.16; meshesOf(coil, T.coil); head.add(coil);
    const cap = new THREE.Group(); meshesOf(cap, power >= 30 ? T.capR : T.capY); head.add(cap);
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
        g.paint.add(geo, COL.steelD);
        g.chrome.add(tor(R0 - 0.03, 0.035, 6, 24), COL.silver, TRS(0, 0.06, 0, Math.PI / 2, 0, 0));
      });
      meshesOf(s.root, ped);
    }
    s.root.position.copy(s.pos);
    scene.add(s.root);
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
  const T = TPL.dash || (TPL.dash = tplDash());
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
    meshesOf(s.root, T.base);
    const ar = new THREE.Mesh(T.arrows, MAT.chev);
    ar.renderOrder = 6;
    s.root.add(ar);
    scene.add(s.root);
    DSH.push(s); ents.push(s);
  }
}
function updDash(dt) {
  if (TEX.chev) { TEX.chev.offset.y = (TEX.chev.offset.y - dt * 1.9) % 1; MAT.chev.opacity = 0.78 + Math.sin(ST.T * 9) * 0.22; }
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
  const T = TPL.mon || (TPL.mon = tplMonitor());
  let i = 0;
  for (const d of L) {
    if (!d || !finV(d.pos)) continue;
    const kind = MAT.screen[d.kind] ? d.kind : 'ring';
    const m = { kind, idx: i++, pos: new V3(d.pos.x, d.pos.y, d.pos.z), broken: false, it: 9, applied: true, flick: 1 + hash(i) * 2, stat: 0, root: new THREE.Group(), vis: true, show: true };
    m.home = m.pos;
    m.intact = new THREE.Group();
    meshesOf(m.intact, T.body);
    m.screen = new THREE.Mesh(T.screens, MAT.screen[kind]);
    m.intact.add(m.screen);
    m.wreck = new THREE.Group();
    meshesOf(m.wreck, T.wreck);
    m.wreck.visible = false;
    m.popup = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.screen[kind], transparent: true, depthWrite: false, toneMapped: false }));
    m.popup.scale.set(0.82, 0.82, 0.82); m.popup.visible = false; m.popup.renderOrder = 8;
    m.root.add(m.intact, m.wreck, m.popup);
    m.root.position.copy(m.pos);
    scene.add(m.root);
    m.solid = { min: new V3(m.pos.x - 0.52, m.pos.y - 0.05, m.pos.z - 0.52), max: new V3(m.pos.x + 0.52, m.pos.y + 1.17, m.pos.z + 0.52), delta: new V3(), kind: 'monitor', mesh: m.root, ref: m };
    MON.push(m); ents.push(m);
  }
}
function resetMonitor(m) {
  m.broken = false; m.it = 9; m.applied = true;
  m.intact.visible = true; m.wreck.visible = false; m.popup.visible = false;
  m.screen.material = MAT.screen[m.kind];
  addSolid(m.solid);
}
function breakMonitor(m) {
  if (m.broken) return;
  m.broken = true; m.it = 0; m.applied = false;
  m.intact.visible = false; m.wreck.visible = true; m.popup.visible = true;
  m.popup.material.opacity = 1; m.popup.position.set(0, 0.9, 0);
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
        m.popup.position.y = 0.9 + k * 1.35 + Math.sin(m.it * 6) * 0.03;
        m.popup.material.opacity = m.it > 1.0 ? clamp((1.4 - m.it) / 0.4, 0, 1) : 1;
        if (!m.applied && m.it >= 0.5) { m.applied = true; gcall('applyItem', m.kind); _v.copy(m.pos); _v.y += 2.2; fxTwinkle(_v, 5, 0.4); }
        if (m.it >= 1.4) m.popup.visible = false;
      }
      continue;
    }
    if (m.root.visible) {
      m.flick -= dt;
      if (m.stat > 0) { m.stat -= dt; TEX.static.offset.set(rand(), rand()); if (m.stat <= 0) m.screen.material = MAT.screen[m.kind]; }
      else if (m.flick <= 0) { m.flick = 1.1 + rand() * 1.6; m.stat = 0.1; m.screen.material = MAT.static; }
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
      g.paint.add(rbox(sx, 0.14, sz, 0.04, 2), COL.steelD, TRS(0, 0.07, 0));
      g.gloss.add(rbox(sx + 0.06, 0.06, sz + 0.06, 0.02, 2), COL.yellow, TRS(0, 0.02, 0));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const x = (i + 0.5) / nx * sx - sx / 2, z = (j + 0.5) / nz * sz - sz / 2;
        g.chrome.add(cone(0.19, 0.72, 10), COL.silver, TRS(x, 0.14 + 0.36, z));
      }
    });
    meshesOf(k.root, parts);
    k.root.position.copy(k.pos);
    scene.add(k.root);
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
  const T = TPL.post || (TPL.post = tplStarPost());
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
    meshesOf(c.root, T.post);
    const arm = new THREE.Group(); arm.position.set(0, 1.9, 0);
    meshesOf(arm, T.arm);
    c.lamp = new THREE.Mesh(T.lamp, MAT.lampR);
    c.lamp.position.y = 0.48;
    arm.add(c.lamp);
    c.root.add(arm);
    c.arm = arm;
    c.root.position.copy(c.pos);
    c.root.rotation.y = c.yaw;
    scene.add(c.root);
    CPS.push(c); ents.push(c);
  }
}
function setPost(c, on, spin) {
  c.on = on;
  c.lamp.material = on ? MAT.lampB : MAT.lampR;
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
  const own = { std: stdMaterial(ST.env, ST.env ? 1 : 0.45), glow: MAT.glow };
  BS.mats = [own.std];
  BS.root = new THREE.Group();
  meshesOf(BS.root, T.pod, own);
  BS.lensMat = new THREE.MeshBasicMaterial({ color: COL.cyan, toneMapped: false });
  BS.root.add(new THREE.Mesh(T.lens, BS.lensMat));
  BS.lightsA = new THREE.Mesh(T.lightsA, MAT.glow); BS.lightsB = new THREE.Mesh(T.lightsB, MAT.glow);
  BS.root.add(BS.lightsA, BS.lightsB);
  const dome = new THREE.Mesh(T.dome, MAT.glass);
  dome.renderOrder = 7;
  BS.root.add(dome);
  BS.root.visible = false;
  scene.add(BS.root);
  BS.ballG = new THREE.Group();
  meshesOf(BS.ballG, T.ball);
  BS.ballG.visible = false;
  scene.add(BS.ballG);
  BS.chain = new THREE.InstancedMesh(T.link, own.std, 12);
  BS.chain.frustumCulled = false; BS.chain.castShadow = true;
  BS.chain.visible = false;
  scene.add(BS.chain);
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    meshesOf(g, T.bomb);
    g.visible = false;
    scene.add(g);
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
  for (const m of BS.mats) m.emissive.setRGB(0, 0, 0);
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
  for (const m of BS.mats) { if (fl) m.emissive.setRGB(0.85, 0.85, 0.85); else m.emissive.setRGB(0, 0, 0); }
  BS.lensMat.color.copy(B.flash > 0 || B.state === 'dying' || B.state === 'flee' ? COL.lensR : COL.cyan);
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
    _m.compose(_v, _q, _cs);
    B.chain.setMatrixAt(i, _m);
  }
  B.chain.instanceMatrix.needsUpdate = true;
}
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
  CP.root = new THREE.Group();
  meshesOf(CP.root, T.body);
  const band = new THREE.Mesh(T.band, MAT.stripe);
  band.castShadow = true; band.receiveShadow = true;
  CP.root.add(band);
  CP.lid = new THREE.Group();
  meshesOf(CP.lid, T.lid);
  CP.button = new THREE.Group();
  CP.button.position.y = BTN_Y;
  meshesOf(CP.button, T.button);
  CP.lid.add(CP.button);
  CP.root.add(CP.lid);
  CP.root.position.copy(CP.pos);
  CP.root.scale.set(CAP_SX, CAP_SY, CAP_SX);
  CP.root.visible = false;
  scene.add(CP.root);
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
  ST.env = makeEnv();
  makeMaterials(ST.env);
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
  ST.own = scene.children.filter(o => !had.has(o));
  ST.built = true;
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
  if (on) cullPass();
}
function updAway(dt) {
  RG.lostSpin.value = (RG.lostSpin.value + dt * 10) % TAU;
  if (RG.lostMesh) K.util.spinY(RG.lostMesh.geometry, -RG.lostSpin.value);
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
}
function update(dt, t) {
  if (!ST.built) return;
  if (!fin(dt) || dt <= 0) dt = STEP;
  dt = Math.min(dt, 0.1);
  ST.T += dt; ST.frame++;
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

K.entities = { build, reset, update, homingTarget, scatterRings, bossInfo, stats, setActive, get active() { return !ST.away; } };
K.fx = { burst };
})();
