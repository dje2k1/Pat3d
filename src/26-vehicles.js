// ===================== 26-vehicles.js — K.vehicles: traffic and parked vehicles of Act 2 (v3) =====================
// The vehicle types (VT half extents = the collision boxes), the walkable top profile, the paint palette, the models
// (two LODs per type), the vehicle material and the instancing of every traffic and parked vehicle of the city.
// 25-city.js keeps traffic logic, parking, collisions and asks this part for everything vehicle-shaped.
//   K.vehicles.VT                    [{name, hx, hy, hz}] per type: 0 sedan, 1 taxi, 2 van, 3 bus, 4 cable car, 5 tram,
//                                    6 road works, 7 double-parked delivery van — half extents of the collision box
//                                    (the box sits on the road: centre y = hy). PHYSICS AND TESTS DEPEND ON THEM.
//   K.vehicles.vehicleTop(type, lz)  walkable height above the road at local z (roofs, windshields, hoods). Same rule.
//   K.vehicles.build(type)           -> { geometry, material }: the detailed model (LOD 0) in the local frame (+z = front,
//                                    y = 0 on the road, x lateral) for an InstancedMesh; instance colour = paint.
//   K.vehicles.buildLOD(type, lod)   -> { geometry, material } of LOD 0 (detailed) or 1 (far)
//   K.vehicles.material()            the shared vehicle material (MeshPhysicalNodeMaterial, see vehicleMaterial)
//   K.vehicles.paint(type, i)        THREE.Color of traffic instance i of a type (taxis yellow, delivery vans by i)
//   K.vehicles.parkedPaint(type, s)  THREE.Color of a parked vehicle at route distance s
//   K.vehicles.addTo(mb, type, M, paint)  a parked vehicle at M (THREE.Matrix4, city-group frame), paint (THREE.Color):
//                                    registered in the LOD instancing below when the city is being built (the city
//                                    passes its street chunk builder); with a plain builder the far model is written into
//                                    it with the city's surface kinds (old behaviour, kept for compatibility)
//   K.vehicles.update(dt, t)         lamp / blinker clock (called by K.city.update; t = the city clock in seconds)
//   K.vehicles.stats()               { types, near:[count per type], far:[...], tris:{lod0:[], lod1:[]}, parked, hooked }
//   K.vehicles.PAINT (30), BLINK (31) surface kinds: per-instance paint, flashing amber lamps; PAINTS: palette (hex)
// LOD instancing (v3): every vehicle of the city (traffic + parked) is drawn by two InstancedMeshes per type that this
// part adds to K.city.group: 'veh-near-<t>' (LOD 0) and 'veh-far-<t>' (LOD 1). The city still creates one traffic
// InstancedMesh per type from build(type) and moves its cars with setMatrixAt: those meshes are found in the city group,
// hidden, and their setMatrixAt only records the pose. Slots are assigned once per drawn frame, from onBeforeRender of
// the LOD meshes (after every update of the frame, so the drawn car is exactly where its collision box is): near / far /
// culled by distance to the camera (per preset, with hysteresis), far ones also by the view frustum; a vehicle keeps its
// slot while it stays in the same LOD; count = highest used slot + 1 (count 0 = no draw call).
// Models: lofted bodies (sections along z with smooth normals: rounded plan and sides, tumblehome, wheel arches cut in
// the sills), separate inset glass behind rubber seals, bumpers swept along the plan outline, lamps / plates / handles
// projected onto the body (ray cast on the loft), tyres (lathe, tread + sidewall in the shader) on 5-spoke alloys or
// steel discs, mirrors, wipers; the far LOD is a coarse loft with octagon wheels. Material: clearcoat paint with metal
// flakes (per-instance colour, metallic or solid by colour), tinted glass with interiors, chrome, rubber, HDR lamps that
// bloom, blinkers on the city clock, plates and signs from a generated atlas (tools/tex/vehicles_tex.py), SSR opt-in.
import { RoundedBoxGeometry as vehRoundedBox } from 'three/addons/geometries/RoundedBoxGeometry.js';
(() => {
'use strict';
const { attribute, uniform, uniformArray, vec2, vec3, vec4, float, int, mix: tmix, smoothstep: tsmooth, clamp: tclamp,
  abs: tabs, max: tmax, min: tmin, fract: tfract, floor: tfloor, sin: tsin, cos: tcos, dot: tdot, normalize: tnorm,
  cross: tcross, length: tlen, step: tstep, select: tselect, positionGeometry, normalGeometry, positionView, normalView,
  varyingProperty, texture: ttexture, dFdx, dFdy, sign: tsign, sqrt: tsqrt, pow: tpow, inverseSqrt } = TSL;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lib = () => K.cityLib; // 25-city.js publishes its mesh builder & co. at load time (used at call time only)
const VT = [
  { name: 'sedan', hx: 0.93, hy: 0.73, hz: 2.3 },
  { name: 'taxi', hx: 0.93, hy: 0.73, hz: 2.3 },
  { name: 'van', hx: 1.0, hy: 1.08, hz: 2.6 },
  { name: 'bus', hx: 1.3, hy: 1.58, hz: 6.0 },
  { name: 'cable', hx: 1.25, hy: 1.68, hz: 4.3 },
  { name: 'tram', hx: 1.35, hy: 1.72, hz: 7.0 },
  { name: 'works', hx: 1.2, hy: 0.6, hz: 1.9 },
  { name: 'dvan', hx: 1.0, hy: 1.08, hz: 2.6 }
];
const BLINK = 31; // amber lamps that flash (works, hazard lights)
const PAINT = 30;
const PAINTS = ['#f2f2ef', '#1d1f24', '#b8bec6', '#c0392b', '#2e5c9a', '#2f6b4f', '#e2d4b0', '#8a1f2e', '#5a6470', '#f0c419', '#3a8fb7', '#d9662b'];
const col = hex => new THREE.Color(hex);
function vehicleTop(type, lz) {
  // walkable top height above the road at local z (roof, windshield ramps, hood)
  if (type <= 1) {
    if (lz > 1.2 || lz < -1.45) return 0.98;
    if (lz > 0.6) return lerp(1.45, 0.98, (lz - 0.6) / 0.6);
    if (lz < -0.95) return lerp(1.45, 1.0, (-0.95 - lz) / 0.5);
    return 1.45;
  }
  if (type === 2 || type === 7) return lz > 1.7 ? lerp(2.15, 1.2, (lz - 1.7) / 0.9) : 2.15;
  if (type === 6) return 1.02;
  return VT[type].hy * 2;
}
function paint(type, i) {
  return type === 1 ? col('#f4c21b') : type === 7 ? col(['#7a5230', '#f2f2ef', '#c0392b'][i % 3]) : type >= 3 ? col('#ffffff') : col(PAINTS[(i * 5 + type) % PAINTS.length]);
}
function parkedPaint(type, s) {
  const h = lib().hash;
  return type === 1 ? col('#f4c21b') : col(PAINTS[Math.floor(h(s * 1.7) * PAINTS.length) % PAINTS.length]);
}

// ===================== surface kinds of the vehicle material =====================
// (30 / 31 keep their v2 meaning: paint takes the instance colour, blinkers flash with the city clock)
const VK = {
  PAINT: 30, BLINK: 31, GLASS: 32, CHROME: 33, TYRE: 34, TRIM: 35, HEAD: 36, TAIL: 37, ATLAS: 38, RIM: 39, PLAIN: 40,
  LIVERY: 41, WOOD: 42, STRIPE: 43, EARTH: 44, SEAL: 45, INTERIOR: 46, DECAL: 47, GRILLE: 48, AMBER: 49, WHEELFAR: 50,
  LENS: 51
};
const NK = 22;
// per kind: [roughness, metalness, clearcoat, SSR strength]
const KP = {
  30: [0.4, 0, 1, 0.22], 31: [0.12, 0, 0.6, 0.15], 32: [0.03, 0, 0, 0.55], 33: [0.07, 1, 0, 0.8], 34: [0.86, 0, 0, 0],
  35: [0.5, 0, 0, 0], 36: [0.1, 0.9, 0.7, 0.3], 37: [0.08, 0, 0.9, 0.25], 38: [0.42, 0.05, 0.4, 0], 39: [0.24, 1, 0, 0.45],
  40: [0.62, 0, 0, 0], 41: [0.36, 0, 0.9, 0.2], 42: [0.5, 0, 0.55, 0.05], 43: [0.38, 0, 0.3, 0], 44: [0.95, 0, 0, 0],
  45: [0.38, 0, 0, 0.05], 46: [0.88, 0, 0, 0], 47: [0.4, 0, 1, 0.2], 48: [0.5, 0.2, 0, 0], 49: [0.1, 0, 0.7, 0.15],
  50: [0.6, 0.4, 0, 0], 51: [0.05, 0, 0.8, 0.3]
};
// paint "schemes" (aEmit of the paint vertices): panel gaps drawn in the shader (z of the door seams, y range)
// 1 sedan, 2 van, 3 delivery van, 4 taxi
const SEAMS = [[99, 99, 99, 99, 0, 0], [1.13, -0.13, -1.3, 99, 0.3, 0.97], [1.22, 0.62, -2.46, 99, 0.42, 2.0], [1.22, -2.46, 99, 99, 0.42, 2.0], [1.13, -0.13, -1.3, 99, 0.3, 0.97]];
// the atlas (tools/tex/vehicles_tex.py): pixel rectangles [x0, y0, x1, y1] of a 512 x 512 image -> uv (v up)
const ATL = {
  plate: k => [(k % 2) * 128 + 3, Math.floor(k / 2) * 64 + 4, (k % 2) * 128 + 125, Math.floor(k / 2) * 64 + 60],
  taxi: [256, 0, 512, 64], bus: [256, 64, 512, 128], tram: [256, 128, 512, 192], cable: [256, 192, 512, 256],
  van: [0, 256, 256, 384], works: [256, 256, 384, 384], grille: [384, 256, 512, 384], tyre: [0, 384, 512, 416],
  band: [0, 416, 512, 480], cabin: [0, 480, 512, 512]
};
const auv = (r, u, v) => [lerp(r[0], r[2], u) / 512, 1 - lerp(r[3], r[1], v) / 512]; // u, v in 0..1 of the rect (v up)

// ===================== geometry builder =====================
const lc = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const WHITE = [1, 1, 1];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addv = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mulv = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const crossv = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lenv = a => Math.hypot(a[0], a[1], a[2]);
const normv = a => { const l = lenv(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
class VB {
  constructor() { this.p = []; this.n = []; this.c = []; this.k = []; this.u = []; this.e = []; this.i = []; this.v = 0; }
  vert(p, n, c, k, u, v, e) {
    this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.c.push(c[0], c[1], c[2]); this.k.push(k); this.u.push(u, v); this.e.push(e || 0);
    return this.v++;
  }
  // a b c d counter-clockwise seen from the outside; smooth normals (na..nd) or the flat one
  quad(a, b, c, d, col, kind, emit, uv, na, nb, nc, nd) {
    const fn = normv(crossv(sub(b, a), sub(d, a)));
    uv = uv || [0, 0, 1, 0, 1, 1, 0, 1];
    const o = this.vert(a, na || fn, col, kind, uv[0], uv[1], emit);
    this.vert(b, nb || fn, col, kind, uv[2], uv[3], emit);
    this.vert(c, nc || fn, col, kind, uv[4], uv[5], emit);
    this.vert(d, nd || fn, col, kind, uv[6], uv[7], emit);
    this.i.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  tri(a, b, c, col, kind, emit, uv, na, nb, nc) {
    const fn = normv(crossv(sub(b, a), sub(c, a)));
    uv = uv || [0, 0, 1, 0, 0.5, 1];
    const o = this.vert(a, na || fn, col, kind, uv[0], uv[1], emit);
    this.vert(b, nb || fn, col, kind, uv[2], uv[3], emit);
    this.vert(c, nc || fn, col, kind, uv[4], uv[5], emit);
    this.i.push(o, o + 1, o + 2);
  }
  // a THREE template geometry under matrix m; uv = the template's (scaled) or uvFn(p, n) -> [u, v]
  geo(g, m, col, kind, emit, uvFn) {
    const pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv, ix = g.index;
    const nm = new THREE.Matrix3().getNormalMatrix(m), flip = m.determinant() < 0, o = this.v;
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    for (let k = 0; k < pa.count; k++) {
      v.fromBufferAttribute(pa, k).applyMatrix4(m); n.fromBufferAttribute(na, k).applyMatrix3(nm).normalize();
      const P = [v.x, v.y, v.z], N = [n.x, n.y, n.z];
      const uv = uvFn ? uvFn(P, N, ua ? [ua.getX(k), ua.getY(k)] : [0, 0]) : ua ? [ua.getX(k), ua.getY(k)] : [0, 0];
      this.vert(P, N, col, kind, uv[0], uv[1], emit);
    }
    if (ix) for (let k = 0; k + 2 < ix.count; k += 3) { const a = ix.getX(k) + o, b = ix.getX(k + 1) + o, c = ix.getX(k + 2) + o; if (flip) this.i.push(a, c, b); else this.i.push(a, b, c); }
    else for (let k = 0; k + 2 < pa.count; k += 3) { if (flip) this.i.push(o + k, o + k + 2, o + k + 1); else this.i.push(o + k, o + k + 1, o + k + 2); }
  }
  // mirror everything added since mark m across x = 0 (symmetric parts are built once)
  mirrorFrom(m) {
    const v0 = m.v, i0 = m.i, v1 = this.v, i1 = this.i.length;
    for (let k = v0; k < v1; k++) {
      this.vert([-this.p[k * 3], this.p[k * 3 + 1], this.p[k * 3 + 2]], [-this.n[k * 3], this.n[k * 3 + 1], this.n[k * 3 + 2]],
        [this.c[k * 3], this.c[k * 3 + 1], this.c[k * 3 + 2]], this.k[k], this.u[k * 2], this.u[k * 2 + 1], this.e[k]);
    }
    const off = v1 - v0;
    for (let k = i0; k < i1; k += 3) this.i.push(this.i[k] + off, this.i[k + 2] + off, this.i[k + 1] + off);
  }
  mark() { return { v: this.v, i: this.i.length }; }
  get tris() { return this.i.length / 3; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.k, 1));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('aEmit', new THREE.Float32BufferAttribute(this.e, 1));
    g.setIndex(this.v > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
const TM = (x, y, z, rx, ry, rz, sx, sy, sz) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)), new THREE.Vector3(sx == null ? 1 : sx, sy == null ? (sx == null ? 1 : sx) : sy, sz == null ? (sx == null ? 1 : sx) : sz));
let TPL = null;
function tpl() {
  if (!TPL) TPL = { box: new THREE.BoxGeometry(1, 1, 1), cyl6: new THREE.CylinderGeometry(1, 1, 1, 6), cyl8: new THREE.CylinderGeometry(1, 1, 1, 8), cyl12: new THREE.CylinderGeometry(1, 1, 1, 12), sph: new THREE.SphereGeometry(1, 10, 7), sphLo: new THREE.SphereGeometry(1, 7, 5), rb: new Map() };
  return TPL;
}
// boxes: centre, size, optional rotation; rounded boxes cached per size
const box = (vb, x, y, z, w, h, d, c, k, e, rx, ry, rz, uvFn) => vb.geo(tpl().box, TM(x, y, z, rx, ry, rz, w, h, d), c, k, e, uvFn);
function rbox(vb, x, y, z, w, h, d, r, c, k, e, rx, ry, rz, seg) {
  const key = [w, h, d, r, seg || 2].map(v => v.toFixed(3)).join(',');
  let g = tpl().rb.get(key);
  if (!g) { g = new vehRoundedBox(w, h, d, seg || 2, Math.min(r, w / 2, h / 2, d / 2) * 0.999); tpl().rb.set(key, g); }
  vb.geo(g, TM(x, y, z, rx, ry, rz), c, k, e);
}
const cyl = (vb, x, y, z, r, h, c, k, e, rx, ry, rz, seg) => vb.geo(tpl()[seg === 6 ? 'cyl6' : seg === 12 ? 'cyl12' : 'cyl8'], TM(x, y, z, rx, ry, rz, r, h, r), c, k, e);
// grid of points G[i][j] -> quads with smooth normals. cell(i, j) -> null | [kind, col, emit, uvFn?]; uv(i, j) -> [u, v];
// closedJ: j wraps; inset(i, j) -> distance pushed along -normal (glass behind its seal); orient: outward hint fn(p)
function gridMesh(vb, G, o) {
  const ni = G.length, nj = G[0].length, closed = !!o.closedJ, J = closed ? nj : nj - 1;
  const N = [];
  for (let i = 0; i < ni; i++) {
    const row = [];
    for (let j = 0; j < nj; j++) {
      const pi0 = G[Math.max(0, i - 1)][j], pi1 = G[Math.min(ni - 1, i + 1)][j];
      const jm = closed ? (j - 1 + nj) % nj : Math.max(0, j - 1), jp = closed ? (j + 1) % nj : Math.min(nj - 1, j + 1);
      let n = crossv(sub(G[i][jp], G[i][jm]), sub(pi1, pi0));
      const l = lenv(n);
      row.push(l > 1e-12 ? mulv(n, 1 / l) : null);
    }
    N.push(row);
  }
  // degenerate points (collapsed rings): borrow from the neighbours
  for (let pass = 0; pass < 3; pass++) for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) if (!N[i][j]) {
    let s = [0, 0, 0], c = 0;
    for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) { const bb = closed ? (b + nj) % nj : b; if (a >= 0 && a < ni && bb >= 0 && bb < nj && N[a][bb]) { s = addv(s, N[a][bb]); c++; } }
    if (c) N[i][j] = normv(s);
  }
  for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) if (!N[i][j]) N[i][j] = [0, 1, 0];
  if (o.orient) {
    let vote = 0;
    for (let i = 0; i < ni; i += Math.max(1, ni >> 3)) for (let j = 0; j < nj; j += Math.max(1, nj >> 3)) vote += Math.sign(dotv(N[i][j], o.orient(G[i][j])));
    if (vote < 0) { for (let i = 0; i < ni; i++) { G[i] = G[i].slice().reverse(); } return gridMesh(vb, G, Object.assign({}, o, { orient: null, flipJ: true })); }
  }
  // inset vertices: pushed in when any neighbouring cell asks for it
  const P = G.map(r => r.slice());
  if (o.inset) {
    for (let i = 0; i < ni - 1; i++) for (let j = 0; j < J; j++) {
      const d = o.inset(i, o.flipJ ? J - 1 - j : j);
      if (!d) continue;
      const jp = (j + 1) % nj;
      for (const [a, b] of [[i, j], [i, jp], [i + 1, j], [i + 1, jp]]) P[a][b] = sub(G[a][b], mulv(N[a][b], d));
    }
  }
  for (let i = 0; i < ni - 1; i++) for (let j = 0; j < J; j++) {
    const jj = o.flipJ ? J - 1 - j : j;
    const cell = o.cell(i, jj);
    if (!cell) continue;
    const jp = (j + 1) % nj;
    const uvf = cell[3] || o.uv;
    const uv = uvf ? [...uvf(i, j, P[i][j]), ...uvf(i, jp, P[i][jp]), ...uvf(i + 1, jp, P[i + 1][jp]), ...uvf(i + 1, j, P[i + 1][j])] : null;
    vb.quad(P[i][j], P[i][jp], P[i + 1][jp], P[i + 1][j], cell[1], cell[0], cell[2], uv, N[i][j], N[i][jp], N[i + 1][jp], N[i + 1][j]);
  }
  return { G: P, N };
}
// ray cast on a grid surface (build time only): nearest hit -> { p, n } (barycentric normal) or null
function rayGrid(S, o, d, closed) {
  const G = S.G, N = S.N, ni = G.length, nj = G[0].length, J = closed ? nj : nj - 1;
  let best = null, bt = 1e9;
  const tryTri = (a, b, c, na, nb, nc) => {
    const e1 = sub(b, a), e2 = sub(c, a), pv = crossv(d, e2), det = dotv(e1, pv);
    if (Math.abs(det) < 1e-12) return;
    const inv = 1 / det, tv = sub(o, a), u = dotv(tv, pv) * inv;
    if (u < 0 || u > 1) return;
    const qv = crossv(tv, e1), v = dotv(d, qv) * inv;
    if (v < 0 || u + v > 1) return;
    const t = dotv(e2, qv) * inv;
    if (t > 1e-6 && t < bt) { bt = t; best = { p: addv(o, mulv(d, t)), n: normv(addv(addv(mulv(na, 1 - u - v), mulv(nb, u)), mulv(nc, v))) }; }
  };
  for (let i = 0; i < ni - 1; i++) for (let j = 0; j < J; j++) {
    const jp = (j + 1) % nj;
    tryTri(G[i][j], G[i][jp], G[i + 1][jp], N[i][j], N[i][jp], N[i + 1][jp]);
    tryTri(G[i][j], G[i + 1][jp], G[i + 1][j], N[i][j], N[i + 1][jp], N[i + 1][j]);
  }
  return best;
}
// the outer surface seen along -d from far outside (projector): first hit of a ray coming from o + 20 d
const hitOut = (S, o, d) => rayGrid(S, [Math.abs(o[0]) < 1e-4 ? 1e-4 : o[0], o[1], o[2]].map((v, i) => v + d[i] * 20), mulv(d, -1), true);
// a patch projected onto a surface: the point org(u, v) seen from outside along dir(u, v) (the outward direction);
// points pushed out by off along the surface normal
function patch(vb, S, closed, nu, nv, org, dir, off, kind, colr, emit, uvFn) {
  const G = [];
  for (let a = 0; a <= nu; a++) {
    const row = [];
    for (let b = 0; b <= nv; b++) {
      const h = hitOut(S, org(a / nu, b / nv), dir(a / nu, b / nv));
      if (!h) return false;
      row.push(addv(h.p, mulv(h.n, off)));
    }
    G.push(row);
  }
  const ref = hitOut(S, org(0.5, 0.5), dir(0.5, 0.5));
  gridMesh(vb, G, { cell: () => [kind, colr, emit], uv: uvFn || ((i, j) => [i / nu, j / nv]), orient: () => ref.n });
  return true;
}
// monotone cubic interpolation through knots [[x, y], ...] (Fritsch-Carlson), clamped outside
function pchip(pts) {
  const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), h = [], d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) { h.push(xs[i + 1] - xs[i]); d.push((ys[i + 1] - ys[i]) / h[i]); }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  return x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}
// sorted stations without near-duplicates; the two ends are always kept (they close the body)
const uniq = zs => {
  const s = zs.slice().sort((a, b) => a - b), lo = s[0], hi = s[s.length - 1], o = [lo];
  for (const z of s) if (z - o[o.length - 1] > 0.0035 && hi - z > 0.0035) o.push(z);
  o.push(hi);
  return o;
};

// ===================== wheels =====================
// axis along x; s = +1: outer face toward +x. Tyre (lathe, uv: u around, v across the profile), rim by style.
function lathe(vb, cx, cy, cz, s, prof, seg, cellFn, uvFn, a0, a1, inward) {
  a0 = a0 == null ? 0 : a0; a1 = a1 == null ? Math.PI * 2 : a1;
  const full = a1 - a0 > 6.28, G = [];
  for (let i = 0; i < prof.length; i++) {
    const row = [], [r, a] = prof[i];
    for (let j = 0; j < (full ? seg : seg + 1); j++) { const t = a0 + (a1 - a0) * j / seg; row.push([cx + s * a, cy + r * Math.cos(t), cz + r * Math.sin(t)]); }
    G.push(row);
  }
  const am = prof.reduce((q, p) => q + p[1], 0) / prof.length;
  return gridMesh(vb, G, { closedJ: full, cell: cellFn, uv: uvFn, orient: p => mulv(sub(p, [cx + s * am, cy, cz]), inward ? -1 : 1) });
}
function disc(vb, cx, cy, cz, s, r, a, seg, colr, kind, emit, uvFn, rot) {
  const c = [cx + s * a, cy, cz], n = [s, 0, 0];
  for (let j = 0; j < seg; j++) {
    const t0 = (rot || 0) + Math.PI * 2 * j / seg, t1 = (rot || 0) + Math.PI * 2 * (j + 1) / seg;
    const p0 = [c[0], cy + r * Math.cos(t0), cz + r * Math.sin(t0)], p1 = [c[0], cy + r * Math.cos(t1), cz + r * Math.sin(t1)];
    const uv = uvFn ? [...uvFn(0, 0), ...uvFn(1, t0), ...uvFn(1, t1)] : [0.5, 0.5, 0.5 + 0.5 * Math.cos(t0), 0.5 + 0.5 * Math.sin(t0), 0.5 + 0.5 * Math.cos(t1), 0.5 + 0.5 * Math.sin(t1)];
    if (s > 0) vb.tri(c, p0, p1, colr, kind, emit, uv, n, n, n); else vb.tri(c, p1, p0, colr, kind, emit, [uv[0], uv[1], uv[4], uv[5], uv[2], uv[3]], n, n, n);
  }
}
const C_TYRE = lc('#1c1c1e'), C_ALLOY = lc('#c4c8ce'), C_DARK = lc('#18191b'), C_CHROME = lc('#e4e7ec'), C_STEEL = lc('#9aa0a6');
function wheel(vb, x, y, z, r, w, lod, style) {
  const s = Math.sign(x) || 1, hw = w / 2, ri = style === 'bus' ? r * 0.58 : style === 'steel' ? r * 0.6 : r * 0.65;
  if (lod > 0) {
    // far: octagon tread band + one disc (tyre ring / rim by radius in the shader)
    lathe(vb, x, y, z, s, [[r, -hw], [r, hw]], 8, () => [VK.TYRE, C_TYRE, 0], (i, j) => [j / 8, 0.5]);
    disc(vb, x, y, z, s, r, hw, 8, style === 'bus' || style === 'steel' ? C_STEEL : C_ALLOY, VK.WHEELFAR, ri / r, (rad, t) => [t, rad]);
    return;
  }
  const prof = [[ri + 0.004, -hw * 0.84], [r - 0.05, -hw], [r - 0.012, -hw * 0.8], [r, -hw * 0.4], [r, hw * 0.4], [r - 0.012, hw * 0.8], [r - 0.05, hw], [ri + 0.004, hw * 0.84]];
  const tv = [0, 0.18, 0.3, 0.36, 0.64, 0.7, 0.82, 1];
  lathe(vb, x, y, z, s, prof, 16, () => [VK.TYRE, C_TYRE, 0], (i, j) => [j / 16, tv[i]]);
  const lip = hw * 0.84, rc = style === 'steel' || style === 'bus' ? C_STEEL : C_ALLOY;
  // rim lip (chrome ring) and the barrel behind it
  lathe(vb, x, y, z, s, [[ri + 0.006, lip], [ri - 0.016, lip + 0.004]], 16, () => [VK.CHROME, C_CHROME, 0]);
  lathe(vb, x, y, z, s, [[ri - 0.016, lip + 0.004], [ri - 0.016, -hw * 0.3]], 16, () => [VK.RIM, lc('#5a5e64'), 0], null, 0, Math.PI * 2, true);
  disc(vb, x, y, z, s, ri - 0.014, -hw * 0.25, 10, C_DARK, VK.TRIM, 0);
  if (style === 'alloy') {
    // brake disc + calliper behind the spokes, 5 dished spokes, centre cap
    box(vb, x - s * hw * 0.08, y + ri * 0.45, z - ri * 0.35, 0.05, ri * 0.4, ri * 0.32, lc('#9a2420'), VK.LIVERY, 0, 0.7, 0, 0);
    const sw0 = 0.05, sw1 = 0.034, r0 = 0.05, r1 = ri - 0.012;
    for (let k = 0; k < 5; k++) {
      const t = Math.PI * 2 * k / 5 + 0.3, ct = Math.cos(t), st = Math.sin(t), px = -st, pz = ct;
      const P = (rr, ww, aa) => [x + s * aa, y + rr * ct + px * ww, z + rr * st + pz * ww];
      const a0 = lip - 0.005, a1 = lip - 0.035;
      const f = [P(r0, -sw0 / 2, a0), P(r1, -sw1 / 2, a1), P(r1, sw1 / 2, a1), P(r0, sw0 / 2, a0)];
      const bk = f.map(p => [p[0] - s * 0.03, p[1], p[2]]);
      const q = (a, b, c, d) => (s > 0 ? vb.quad(a, b, c, d, rc, VK.RIM, 0) : vb.quad(a, d, c, b, rc, VK.RIM, 0));
      q(f[0], f[1], f[2], f[3]);
      q(bk[0], bk[1], f[1], f[0]);
      q(f[3], f[2], bk[2], bk[3]);
    }
    disc(vb, x, y, z, s, 0.062, lip - 0.002, 10, rc, VK.RIM, 0);
    disc(vb, x, y, z, s, 0.03, lip + 0.002, 8, lc('#2a2c30'), VK.CHROME, 0);
  } else {
    // steel / bus wheel: dished disc with a chrome hub, a ring of vent holes (dark) and nuts
    lathe(vb, x, y, z, s, [[ri - 0.016, lip - 0.02], [ri * 0.75, lip - 0.045], [ri * 0.5, lip - 0.03], [ri * 0.36, lip - 0.01]], 16, (i, j) => [VK.RIM, i === 1 && j % 2 === 0 ? C_DARK : rc, 0]);
    disc(vb, x, y, z, s, ri * 0.36, lip - 0.01, 12, C_CHROME, VK.CHROME, 0);
    for (let k = 0; k < (style === 'bus' ? 8 : 5); k++) { const n = style === 'bus' ? 8 : 5, t = Math.PI * 2 * k / n; box(vb, x + s * (lip - 0.005), y + Math.cos(t) * ri * 0.25, z + Math.sin(t) * ri * 0.25, 0.02, 0.022, 0.022, C_CHROME, VK.CHROME, 0); }
  }
}

// ===================== lofted bodies =====================
// spec: { L, W(z), yb(z), belt(z), top(z), xr(z), sh, crown(z), roofR, stations0, stations1, gh(h) -> greenhouse t's,
//         cell(lod, zm, c, side) -> [kind, col, emit] }
// LOD 0 half section (17 points): 0 bottom centre, 1-2 bottom corner, 3-6 side (character line at sh), 7 belt,
// 8..8+n greenhouse (window sill -> roof edge), then roof edge rounding and the roof to the centre line.
function section(spec, z, lod) {
  const W = Math.max(0, spec.W(z)), yb = spec.yb(z), belt = Math.max(spec.belt(z), yb + 0.08), top = Math.max(spec.top(z), belt);
  const h = top - belt, f = W / Math.max(1e-6, spec.W0);
  const sh = Math.min(Math.max(spec.sh, yb + 0.16), belt - 0.06), cr = spec.crown(z), rr = spec.roofR;
  const x7 = Math.max(0, W - 0.05 * f), xr = Math.min(spec.xr(z, h), x7 - 0.012 * f), xb = Math.min(x7, Math.max(W - (spec.beltIn || 0.075) * f, xr));
  const pts = [];
  if (lod === 0) {
    pts.push([0, yb], [Math.max(0, W - 0.06 * f), yb + 0.008], [Math.max(0, W - 0.012 * f), Math.min(yb + 0.045, sh - 0.02)],
      [W, Math.min(yb + 0.12, sh - 0.012)], [W + 0.004 * f, lerp(Math.min(yb + 0.12, sh - 0.012), sh, 0.5)], [W, sh],
      [Math.max(0, W - 0.02 * f), Math.max(sh + 0.005, belt - 0.06)], [x7, belt]);
    const ts = spec.gh(h);
    for (const t of ts) { const bow = Math.sin(Math.PI * t) * 0.012 * Math.min(1, h / 0.3); pts.push([lerp(xb, xr, t) + bow * f, belt + 0.004 + (h - 0.004) * t]); }
    pts.push([Math.max(0, xr - rr * 0.35), top + rr * 0.12 + cr * 0.3], [Math.max(0, xr - rr), top + rr * 0.2 + cr * 0.6], [xr * 0.5, top + rr * 0.2 + cr * 0.92], [0, top + rr * 0.2 + cr]);
  } else {
    pts.push([0, yb], [Math.max(0, W - 0.04 * f), yb + 0.02], [W, Math.min(yb + 0.13, sh - 0.01)], [W, sh], [Math.max(0, W - 0.05 * f), belt],
      [xr, top], [Math.max(0, xr - rr), top + rr * 0.2 + cr * 0.6], [0, top + rr * 0.2 + cr]);
  }
  return pts;
}
function loftBody(vb, spec, lod) {
  const zs = (lod === 0 ? spec.stations0 : spec.stations1).filter(z => Math.abs(z) <= spec.L + 1e-6);
  const rings = zs.map(z => section(spec, z, lod));
  const n = rings[0].length;
  // full ring: right half bottom -> top, then the left half top -> bottom (mirrored), centre points not repeated
  const G = rings.map((r, i) => {
    const z = zs[i], row = [];
    for (let j = 0; j < n; j++) row.push([r[j][0], r[j][1], z]);
    for (let j = n - 2; j >= 1; j--) row.push([-r[j][0], r[j][1], z]);
    return row;
  });
  const R = G[0].length, half = n - 1;
  const cellOf = (i, j) => {
    const zm = (zs[i] + zs[i + 1]) / 2, side = j < half ? 1 : -1, c = j < half ? j : R - 1 - j;
    return spec.cell(lod, zm, c, side, i);
  };
  return gridMesh(vb, G, {
    closedJ: true,
    cell: cellOf,
    inset: lod === 0 ? (i, j) => { const k = cellOf(i, j); return k && k[0] === VK.GLASS ? (spec.glassInset || 0.014) : 0; } : null,
    uv: (i, j, p) => [p[2], p[1]]
  });
}
// window bookkeeping: glass in [z0, z1] (seal bands of width s outside), helpers for cell classification
const inR = (z, r) => z > r[0] && z < r[1];
function winState(zm, ranges, s) {
  for (const r of ranges) { if (inR(zm, r)) return 2; if (inR(zm, [r[0] - s, r[0]]) || inR(zm, [r[1], r[1] + s])) return 1; }
  return 0;
}
const rangeStations = (ranges, s) => ranges.flatMap(r => [r[0] - s, r[0], r[1], r[1] + s]);
const archStations = (zw, Ra, n) => { const o = []; for (let k = 0; k < n; k++) { const t = -Math.PI / 2 + Math.PI * k / (n - 1); o.push(zw + Ra * Math.sin(t)); } return o; };
// plan outline (superellipse): half width at z
const planW = (W0, L, m, n) => z => { const q = Math.min(1, Math.abs(z) / L); return W0 * Math.pow(Math.max(0, 1 - Math.pow(q, m)), 1 / n); };
const archY = (arches, base) => z => { let y = base(z); for (const a of arches) { const dz = z - a.z; if (Math.abs(dz) < a.Ra) y = Math.max(y, a.r + Math.sqrt(a.Ra * a.Ra - dz * dz)); } return y; };
// a swept bar (bumpers, rubbing strips): path [[x, z], ...] in plan at height y, profile [[out, up], ...]
function sweep(vb, path, y, prof, cellFn, ctr) {
  const G = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    let ox = tz, oz = -tx; // outward = tangent rotated; flipped below to point away from the centre
    if (ox * (path[i][0] - ctr[0]) + oz * (path[i][1] - ctr[1]) < 0) { ox = -ox; oz = -oz; }
    G.push(prof.map(([o, u]) => [path[i][0] + ox * o, y + u, path[i][1] + oz * o]));
  }
  return gridMesh(vb, G, { cell: cellFn, orient: p => [p[0] - ctr[0], 0, p[2] - ctr[1]], uv: (i, j) => [i / (path.length - 1), j / (prof.length - 1)] });
}
// plan outline points of the front (dir = 1) or rear (-1) end, from the side at z0 round to the other side
function endPath(Wf, L, z0, dir, off, n) {
  const pts = [];
  // walk z from z0 to the tip on the right, across, back on the left: parametrised by angle on a squashed circle
  for (let k = 0; k <= n; k++) {
    const t = -Math.PI / 2 + Math.PI * k / n, s = Math.sin(t), c = Math.cos(t);
    // ease towards the tip: more points round the corners
    const z = dir * lerp(Math.abs(z0), L, Math.pow(c, 0.35));
    let x = Wf(z);
    if (Math.abs(c) > 0.999) x = 0;
    x *= Math.sign(s) || 0;
    pts.push([x, z]);
  }
  // offset outward (plan normal)
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1;
    let ox = tz / l, oz = -tx / l; if (ox * p[0] + oz * p[1] < 0) { ox = -ox; oz = -oz; }
    if (Math.abs(p[0]) <= 1e-3) { ox = 0; oz = dir; }
    return [p[0] + ox * off, p[1] + oz * off];
  });
}
const plateQuad = (vb, x, y, z, w, h, dir, k) => {
  const r = ATL.plate(k), u0 = r[0] / 512, u1 = r[2] / 512, v0 = 1 - r[3] / 512, v1 = 1 - r[1] / 512;
  const a = [x - dir * w / 2, y - h / 2, z], b = [x + dir * w / 2, y - h / 2, z], c = [x + dir * w / 2, y + h / 2, z], d = [x - dir * w / 2, y + h / 2, z];
  vb.quad(a, b, c, d, WHITE, VK.ATLAS, 0, [u0, v0, u1, v0, u1, v1, u0, v1]);
};

// ===================== sedan / taxi =====================
function carSpec(taxi) {
  const L = 2.25, W0 = 0.915;
  const arches = [{ z: 1.42, r: 0.335, Ra: 0.38 }, { z: -1.42, r: 0.335, Ra: 0.38 }];
  const belt = pchip([[-2.25, 0.72], [-2.215, 0.86], [-2.14, 0.955], [-2.0, 0.99], [-1.6, 1.0], [-1.0, 0.995], [0, 0.982], [1.2, 0.962], [1.85, 0.935], [2.06, 0.905], [2.17, 0.85], [2.225, 0.77], [2.25, 0.68]]);
  const roof = pchip([[-1.47, 0.99], [-1.33, 1.17], [-1.15, 1.33], [-0.95, 1.395], [-0.55, 1.425], [-0.1, 1.432], [0.3, 1.425], [0.52, 1.405], [0.72, 1.33], [0.95, 1.16], [1.2, 0.962]]);
  const base = pchip([[-2.25, 0.42], [-2.17, 0.34], [-1.95, 0.26], [-1.62, 0.205], [1.62, 0.205], [1.95, 0.245], [2.15, 0.31], [2.25, 0.4]]);
  const side = [[-1.36, -0.21], [-0.05, 1.17]], wsh = [0.64, 1.14], rear = [-1.4, -0.99], S = 0.03;
  const spec = {
    L, W0, W: planW(W0, L, 12, 4), yb: archY(arches, base), belt, sh: 0.79, roofR: 0.07, beltIn: 0.075, glassInset: 0.012,
    top: z => (z < -1.47 || z > 1.2 ? belt(z) : Math.max(belt(z), roof(z))),
    crown: z => (z > -1.47 && z < 1.2 ? 0.012 : 0.018),
    xr: (z, h) => 0.705 + 0.085 * (1 - Math.min(1, h / 0.46)),
    gh: h => { const a = Math.min(0.35, 0.03 / Math.max(h, 1e-3)), b = Math.min(0.35, 0.026 / Math.max(h, 1e-3)); return [0, a, 0.5, 1 - b, 1]; },
    arches, side, wsh, rear,
    stations0: uniq([-2.25, -2.244, -2.232, -2.21, -2.17, -2.1, -1.98, ...archStations(-1.42, 0.38, 7), ...archStations(1.42, 0.38, 7),
      ...rangeStations(side, S), ...rangeStations([wsh, rear], S), -0.6, 0.3, 0.85, 1.98, 2.1, 2.17, 2.21, 2.232, 2.244, 2.25]),
    stations1: uniq([-2.25, -2.235, -2.18, -2.08, -1.8, -1.6, -1.42, -1.24, -1.04, -0.97, -0.21, -0.05, 0.64, 1.04, 1.24, 1.42, 1.6, 1.8, 2.08, 2.18, 2.235, 2.25]),
    cell(lod, zm, c, sd) {
      const P = [WHITE, VK.PAINT, taxi ? 4 : 1];
      const paint = [VK.PAINT, WHITE, taxi ? 4 : 1], trim = [VK.TRIM, lc('#1a1b1d'), 0], under = [VK.TRIM, lc('#0c0c0d'), 0];
      void P;
      if (lod > 0) {
        if (c === 0) return under;
        if (c === 1) return trim;
        if (c === 4) return winState(zm, side, 0) === 2 && !inR(zm, [-0.21, -0.05]) ? [VK.GLASS, WHITE, 0] : paint;
        if (c === 6) return inR(zm, wsh) || inR(zm, rear) ? [VK.GLASS, WHITE, 0] : paint;
        if (c === 5) return inR(zm, [0.6, 1.2]) || inR(zm, [-1.45, -0.95]) ? trim : paint;
        if (taxi && c === 3 && inR(zm, [-1.0, 0.95])) return [VK.DECAL, WHITE, 2];
        return paint;
      }
      if (c === 0) return under;
      if (c === 1 || c === 2) return trim; // black rocker strip / arch lips
      if (taxi && c === 4 && inR(zm, [-1.05, 0.98])) return [VK.DECAL, WHITE, 2]; // checker band (shader)
      if (c >= 3 && c <= 6) return paint;
      const ws = winState(zm, side, S), bp = inR(zm, [-0.21, -0.05]);
      if (c === 7) return ws ? [VK.CHROME, C_CHROME, 0] : paint; // beltline chrome under the side windows
      if (c >= 8 && c <= 11) {
        if (bp) return [VK.TRIM, lc('#0e0f11'), 0]; // B pillar (gloss black)
        if (c === 8 || c === 11) return ws ? [VK.SEAL, C_DARK, 0] : paint;
        return ws === 2 ? [VK.GLASS, WHITE, 0] : ws === 1 ? [VK.SEAL, C_DARK, 0] : paint;
      }
      if (c === 12) return paint;
      const wf = winState(zm, [wsh, rear], S);
      if (c === 13) return wf ? [VK.SEAL, C_DARK, 0] : paint;
      return wf === 2 ? [VK.GLASS, WHITE, 0] : wf === 1 ? [VK.SEAL, C_DARK, 0] : paint;
    }
  };
  return spec;
}
const PARTS = {};
const partMark = (vb, name, t0) => { PARTS[name] = (PARTS[name] || 0) + vb.tris - t0; return vb.tris; };
function taxiSign(vb, lod) {
  // roof sign: a black foot, a yellow rounded shell, the lit "TAXI" panels front and back (atlas)
  box(vb, 0, 1.47, -0.2, 0.5, 0.04, 0.18, C_DARK, VK.TRIM, 0);
  rbox(vb, 0, 1.56, -0.2, 0.62, 0.15, 0.2, 0.04, lc('#f2c21a'), VK.PLAIN, 0, 0, 0, 0, lod ? 1 : 2);
  const r = ATL.taxi;
  for (const dir of [1, -1]) vb.geo(new THREE.PlaneGeometry(0.56, 0.13), TM(0, 1.56, -0.2 + dir * 0.101, 0, dir > 0 ? 0 : Math.PI, 0), WHITE, VK.ATLAS, 1.0, (p, n, uv0) => auv(r, uv0[0], uv0[1]));
}
function buildCar(lod, taxi) {
  const vb = new VB(), sp = carSpec(taxi);
  let t0 = 0;
  const S = loftBody(vb, sp, lod);
  t0 = partMark(vb, 'car' + lod + ':body', t0);
  const L = sp.L, wr = sp.arches[0].r, sch = taxi ? 4 : 1, red = lc('#ff2a1a');
  // wheels
  for (const sx of [-1, 1]) for (const a of sp.arches) wheel(vb, sx * 0.795, wr, a.z, wr, 0.215, lod, 'alloy');
  t0 = partMark(vb, 'car' + lod + ':wheels', t0);
  const amber = lc('#ff9a1a');
  if (lod > 0) {
    // lamps projected on the coarse body, plates as dark patches, the roof sign
    for (const sx of [-1, 1]) {
      patch(vb, S, true, 1, 1, (u, v) => [sx * lerp(0.5, 0.86, u), lerp(0.69, 0.82, v), 0], () => [0, 0, 1], 0.01, VK.HEAD, WHITE, 1.2, (i, j) => [0.3 + 0.4 * (sx > 0 ? i : 1 - i), 0.48]);
      patch(vb, S, true, 1, 1, (u, v) => [sx * lerp(0.42, 0.88, u), lerp(0.76, 0.92, v), 0], () => [0, 0, -1], 0.01, VK.TAIL, red, 1.0, (i, j) => [i, 0.5]);
    }
    if (taxi) taxiSign(vb, 1);
    return vb.build();
  }
  // wheel well liners (dark half cylinders) and the flat underbody between the arches
  for (const a of sp.arches) for (const sx of [-1, 1]) {
    lathe(vb, sx * 0.73, a.r, a.z, sx, [[a.Ra - 0.005, 0.2], [a.Ra - 0.005, -0.12]], 10, () => [VK.TRIM, lc('#0b0b0c'), 0], null, -Math.PI / 2 - 0.2, Math.PI / 2 + 0.2, true);
  }
  box(vb, 0, 0.2, 0, 1.4, 0.02, 1.9, lc('#0b0b0c'), VK.TRIM, 0);
  t0 = partMark(vb, 'car0:liners', t0);
  // bumpers: body colour shell, black lower lip with a chrome strip
  for (const dir of [1, -1]) {
    const path = endPath(z => sp.W(z), L, 1.86, dir, 0.012, 11);
    sweep(vb, path, dir > 0 ? 0.36 : 0.4, [[-0.05, -0.15], [0.02, -0.14], [0.036, -0.06], [0.038, -0.02], [0.038, 0.01], [0.03, 0.08], [-0.04, 0.12]],
      (i, j) => (j <= 1 ? [VK.TRIM, lc('#141416'), 0] : j === 3 ? [VK.CHROME, C_CHROME, 0] : [VK.PAINT, WHITE, sch]), [0, 0]);
  }
  t0 = partMark(vb, 'car0:bumpers', t0);
  // front: honeycomb grille in a chrome frame between the head lamps; fog lamps in the bumper
  const fr = (x0, x1, y0, y1, nu, nv, off, kind, c, e, uv) => patch(vb, S, true, nu, nv, (u, v) => [lerp(x0, x1, u), lerp(y0, y1, v), 0], () => [0, 0, 1], off, kind, c, e, uv);
  fr(-0.47, 0.47, 0.5, 0.68, 5, 2, 0.008, VK.GRILLE, WHITE, 0, (i, j) => [i / 5 * 4, j / 2 * 0.7]);
  fr(-0.5, 0.5, 0.68, 0.705, 5, 1, 0.012, VK.CHROME, C_CHROME, 0);
  fr(-0.5, 0.5, 0.48, 0.5, 5, 1, 0.012, VK.CHROME, C_CHROME, 0);
  for (const sx of [-1, 1]) {
    fr(sx * 0.47, sx * 0.5, 0.5, 0.68, 1, 2, 0.012, VK.CHROME, C_CHROME, 0);
    // head lamps wrap round the front corners; tail lamps round the rear corners (with an amber indicator strip)
    patch(vb, S, true, 6, 2, (u, v) => [sx * lerp(0.52, 0.88, u), lerp(0.69, 0.83, v), 0], () => [0, 0, 1], 0.01, VK.HEAD, WHITE, 0.9, (i, j) => [sx > 0 ? i / 6 : 1 - i / 6, j / 2]);
    patch(vb, S, true, 6, 2, (u, v) => [sx * lerp(0.44, 0.89, u), lerp(0.78, 0.93, v), 0], () => [0, 0, -1], 0.01, VK.TAIL, red, 0.7, (i, j) => [sx > 0 ? i / 6 : 1 - i / 6, j / 2]);
    patch(vb, S, true, 2, 1, (u, v) => [sx * lerp(0.6, 0.86, u), lerp(0.74, 0.78, v), 0], () => [0, 0, -1], 0.008, VK.AMBER, amber, 0.4);
    patch(vb, S, true, 1, 1, (u, v) => [0, lerp(0.73, 0.77, v), lerp(2.0, 2.1, u)], () => [sx, 0, 0], 0.005, VK.AMBER, amber, 0.5);
    const fg = hitOut(S, [sx * 0.6, 0.6, 0], [0, 0, 1]);
    if (fg) vb.geo(new THREE.CircleGeometry(0.045, 10), TM(sx * 0.62, 0.3, L + 0.0475), WHITE, VK.HEAD, 0.5, () => [0.32, 0.48]);
    // door handles, mirror, wiper
    for (const zh of [0.42, -0.72]) {
      const h = hitOut(S, [0, 0.9, zh], [sx, 0, 0]);
      if (h) box(vb, h.p[0] + sx * 0.008, h.p[1], h.p[2], 0.022, 0.03, 0.15, C_CHROME, VK.CHROME, 0);
    }
    const hm = hitOut(S, [0, 1.02, 0.86], [sx, 0, 0]);
    if (hm) {
      rbox(vb, hm.p[0] + sx * 0.07, 1.05, 0.83, 0.13, 0.11, 0.16, 0.035, WHITE, VK.PAINT, sch, 0, sx * 0.15, 0, 1);
      box(vb, hm.p[0] + sx * 0.075, 1.05, 0.745, 0.11, 0.085, 0.01, WHITE, VK.GLASS, 0, 0, sx * 0.15, 0);
      box(vb, hm.p[0] + sx * 0.02, 1.0, 0.86, 0.05, 0.03, 0.08, C_DARK, VK.TRIM, 0);
    }
    box(vb, sx * 0.28, 0.985, 1.19, 0.5, 0.012, 0.022, C_DARK, VK.TRIM, 0, 0, sx * 0.12, 0);
  }
  t0 = partMark(vb, 'car0:lamps+handles+mirrors', t0);
  // plates (front on the bumper, rear in a recess between the tail lamps), exhaust
  plateQuad(vb, 0, 0.37, L + 0.05 + 0.002, 0.34, 0.16, 1, taxi ? 3 : 0);
  const rp = hitOut(S, [0, 0.66, 0], [0, 0, -1]);
  const rz = rp ? rp.p[2] : -L;
  box(vb, 0, 0.66, rz + 0.004, 0.4, 0.21, 0.02, C_DARK, VK.TRIM, 0);
  plateQuad(vb, 0, 0.66, rz - 0.008, 0.34, 0.16, -1, taxi ? 5 : 2);
  cyl(vb, -0.55, 0.24, -L + 0.02, 0.035, 0.12, C_CHROME, VK.CHROME, 0, Math.PI / 2, 0, 0, 8);
  if (taxi) taxiSign(vb, 0);
  return vb.build();
}

// ===================== van / delivery van =====================
function vanSpec(dvan) {
  const L = 2.53, W0 = 0.982;
  const arches = [{ z: 1.75, r: 0.36, Ra: 0.43 }, { z: -1.7, r: 0.36, Ra: 0.43 }];
  const belt = pchip([[-2.53, 1.16], [-2.47, 1.27], [-2.3, 1.3], [1.3, 1.3], [1.95, 1.4], [2.22, 1.58], [2.4, 1.48], [2.5, 1.32], [2.53, 1.2]]);
  const roof = pchip([[-2.53, 1.88], [-2.49, 2.04], [-2.4, 2.1], [-2.2, 2.11], [1.5, 2.11], [1.66, 2.06], [1.85, 1.93], [2.22, 1.58]]);
  const base = pchip([[-2.53, 0.46], [-2.4, 0.36], [-2.1, 0.3], [2.1, 0.3], [2.38, 0.36], [2.53, 0.46]]);
  const side = dvan ? [[1.08, 2.2]] : [[1.08, 2.2], [-0.05, 0.98], [-1.6, -0.15], [-2.42, -1.7]];
  const wsh = [1.67, 2.2], S = 0.03;
  return {
    L, W0, W: planW(W0, L, 16, 5), yb: archY(arches, base), belt, sh: 0.9, roofR: 0.1, beltIn: 0.06, glassInset: 0.012,
    top: z => (z > 2.22 ? belt(z) : Math.max(belt(z), roof(z))),
    crown: z => (z < 2.22 ? 0.02 : 0.02),
    xr: (z, h) => 0.9 + 0.04 * (1 - Math.min(1, h / 0.5)),
    gh: h => { const a = Math.min(0.3, 0.03 / Math.max(h, 1e-3)); return [0, a, 0.42, 0.62, 0.62 + a, 1]; },
    arches, side, wsh,
    stations0: uniq([-2.53, -2.524, -2.512, -2.49, -2.45, -2.38, ...archStations(-1.7, 0.43, 7), ...archStations(1.75, 0.43, 7), ...rangeStations(side, S), ...rangeStations([wsh], S),
      -0.8, 0.5, 2.3, 2.38, 2.44, 2.48, 2.505, 2.52, 2.53]),
    stations1: uniq([-2.53, -2.51, -2.42, -2.13, -1.7, -1.27, 0.0, 1.0, 1.32, 1.66, 1.75, 2.18, 2.22, 2.4, 2.5, 2.53]),
    cell(lod, zm, c, sd) {
      const paint = [VK.PAINT, WHITE, dvan ? 3 : 2], trim = [VK.TRIM, lc('#1c1d20'), 0], under = [VK.TRIM, lc('#0c0c0d'), 0];
      const glass = [VK.GLASS, WHITE, 0], seal = [VK.SEAL, C_DARK, 0];
      // the delivery van's livery panel (logo from the atlas) on the cargo sides, both bands
      const logo = dvan && inR(zm, [-2.35, 0.95]);
      if (lod > 0) {
        if (c === 0) return under;
        if (c === 1) return trim;
        if (c === 4) return winState(zm, side, 0) === 2 ? glass : logo ? [VK.DECAL, WHITE, 1] : paint;
        if (c === 6) return inR(zm, wsh) ? glass : paint;
        if (logo && (c === 2 || c === 3)) return [VK.DECAL, WHITE, 1];
        return paint;
      }
      if (c === 0) return under;
      if (c === 1 || c === 2) return trim;
      if (c >= 3 && c <= 6) return logo && c >= 4 ? [VK.DECAL, WHITE, 1] : c === 3 ? trim : paint;
      const ws = winState(zm, side, S);
      if (c >= 7 && c <= 12) {
        // greenhouse: 7 sill, 8 seal, 9-10 glass (two rows of cells), 11 seal, 12 upper panel
        if (logo && (c === 7 || c === 12 || !ws)) return [VK.DECAL, WHITE, 1];
        if (c === 7 || c === 12) return paint;
        if (c === 8 || c === 11) return ws ? seal : paint;
        return ws === 2 ? glass : ws === 1 ? seal : paint;
      }
      if (c === 13) return paint;
      const wf = winState(zm, [wsh], S);
      if (c === 14) return wf ? seal : paint;
      return wf === 2 ? glass : wf === 1 ? seal : paint;
    }
  };
}
function buildVan(lod, dvan) {
  const vb = new VB(), sp = vanSpec(dvan), L = sp.L;
  const S = loftBody(vb, sp, lod);
  for (const sx of [-1, 1]) for (const z of [-1.7, 1.75]) wheel(vb, sx * 0.84, 0.36, z, 0.36, 0.23, lod, 'steel');
  const amb = lc('#ffa31a');
  if (lod > 0) {
    for (const sx of [-1, 1]) {
      const q = (a, b, c, d, cc, k, e) => (sx > 0 ? vb.quad(a, b, c, d, cc, k, e) : vb.quad(b, a, d, c, cc, k, e));
      q([sx * 0.45, 0.95, L + 0.002], [sx * 0.85, 0.95, L - 0.03], [sx * 0.85, 1.12, L - 0.035], [sx * 0.45, 1.12, L + 0.0], WHITE, VK.HEAD, 1.6);
      q([sx * 0.95, 0.9, -L - 0.002], [sx * 0.8, 0.9, -L - 0.002], [sx * 0.8, 1.35, -L - 0.002], [sx * 0.95, 1.35, -L - 0.002], lc('#ff2a1a'), VK.TAIL, 1.2);
      if (dvan) q([sx * 0.95, 1.4, -L - 0.004], [sx * 0.8, 1.4, -L - 0.004], [sx * 0.8, 1.52, -L - 0.004], [sx * 0.95, 1.52, -L - 0.004], amb, BLINK, 2.6);
    }
    if (dvan) cyl(vb, 0, 2.2, 0.9, 0.16, 0.14, amb, BLINK, 3.0, 0, 0, 0, 6);
    return vb.build();
  }
  for (const a of sp.arches) for (const sx of [-1, 1]) lathe(vb, sx * 0.76, a.r, a.z, sx, [[a.Ra - 0.005, 0.24], [a.Ra - 0.005, -0.14]], 10, () => [VK.TRIM, lc('#0b0b0c'), 0], null, -Math.PI / 2 - 0.2, Math.PI / 2 + 0.2, true);
  box(vb, 0, 0.29, 0, 1.5, 0.02, 2.6, lc('#0b0b0c'), VK.TRIM, 0);
  // black plastic bumpers with a step at the rear
  for (const dir of [1, -1]) {
    const path = endPath(z => sp.W(z), L, 2.12, dir, 0.02, 11);
    sweep(vb, path, 0.48, [[-0.05, -0.17], [0.0, -0.17], [0.03, -0.14], [0.045, -0.05], [0.045, 0.06], [0.03, 0.12], [-0.04, 0.13]], () => [VK.TRIM, lc('#202124'), 0], [0, 0]);
  }
  // grille, lamps, markers
  patch(vb, S, true, 4, 2, (u, v) => [lerp(-0.5, 0.5, u), lerp(0.66, 0.92, v), 2.25], () => [0, 0, 1], 0.006, VK.GRILLE, WHITE, 0, (i, j) => [i / 4 * 3.5, j / 2 * 0.8]);
  patch(vb, S, true, 4, 1, (u, v) => [lerp(-0.52, 0.52, u), lerp(0.92, 0.95, v), 2.25], () => [0, 0, 1], 0.008, VK.CHROME, C_CHROME, 0);
  for (const sx of [-1, 1]) {
    patch(vb, S, true, 3, 2, (u, v) => [sx * lerp(0.56, 0.9, u), lerp(0.98, 1.2, v), 2.25], () => [0, 0, 1], 0.006, VK.HEAD, WHITE, 2.2, (i, j) => [sx > 0 ? i / 3 : 1 - i / 3, j / 2]);
    patch(vb, S, true, 1, 3, (u, v) => [sx * lerp(0.8, 0.95, u), lerp(0.85, 1.4, v), -2.2], () => [0, 0, -1], 0.006, VK.TAIL, lc('#ff2a1a'), 1.4, (i, j) => [i, j / 3]);
    if (dvan) {
      patch(vb, S, true, 1, 1, (u, v) => [sx * lerp(0.8, 0.95, u), lerp(1.42, 1.54, v), -2.2], () => [0, 0, -1], 0.008, BLINK, amb, 2.6);
      patch(vb, S, true, 1, 1, (u, v) => [sx * lerp(0.88, 0.95, u), lerp(0.85, 0.95, v), 2.25], () => [0, 0, 1], 0.009, BLINK, amb, 2.6);
    }
    const hm = hitOut(S, [0, 1.5, 1.95], [sx, 0, 0]);
    if (hm) {
      box(vb, hm.p[0] + sx * 0.05, 1.42, 1.93, 0.1, 0.03, 0.04, C_DARK, VK.TRIM, 0);
      rbox(vb, hm.p[0] + sx * 0.12, 1.5, 1.92, 0.07, 0.24, 0.14, 0.025, C_DARK, VK.TRIM, 0);
      box(vb, hm.p[0] + sx * 0.12, 1.5, 1.848, 0.05, 0.2, 0.01, WHITE, VK.GLASS, 0);
    }
    for (const zh of [1.0, dvan ? -99 : -0.2]) { const h = hitOut(S, [0, 1.12, zh], [sx, 0, 0]); if (h) rbox(vb, h.p[0] + sx * 0.008, 1.12, zh, 0.022, 0.035, 0.16, 0.01, C_DARK, VK.TRIM, 0); }
  }
  plateQuad(vb, 0, 0.5, L + 0.065 + 0.002, 0.34, 0.16, 1, 4);
  plateQuad(vb, 0, 0.66, -L - 0.004, 0.34, 0.16, -1, 6);
  if (!dvan) {
    // rear door windows (two panes) on the rear face
    for (const sx of [-1, 1]) patch(vb, S, true, 2, 2, (u, v) => [sx * lerp(0.12, 0.8, u), lerp(1.42, 1.92, v), -2.2], () => [0, 0, -1], 0.006, VK.GLASS, WHITE, 0);
    box(vb, 0, 1.2, -L - 0.004, 0.012, 1.6, 0.01, C_DARK, VK.TRIM, 0);
  } else {
    // double-parked with the hazard lights on: the rear door seam and hinges, a beacon on the roof
    box(vb, 0, 1.2, -L - 0.004, 0.012, 1.55, 0.01, C_DARK, VK.TRIM, 0);
    for (const sx of [-1, 1]) for (const y of [0.75, 1.35, 1.85]) box(vb, sx * 0.86, y, -L - 0.006, 0.06, 0.08, 0.02, C_DARK, VK.TRIM, 0);
    box(vb, 0, 2.2, 0.9, 0.5, 0.05, 0.5, C_DARK, VK.TRIM, 0);
    vb.geo(tpl().sph, TM(0, 2.26, 0.9, 0, 0, 0, 0.17, 0.14, 0.17), amb, BLINK, 3.0);
  }
  return vb.build();
}

// ===================== bus =====================
function busSpec() {
  const L = 5.94, W0 = 1.27;
  const arches = [{ z: 3.9, r: 0.5, Ra: 0.58 }, { z: -3.6, r: 0.5, Ra: 0.58 }];
  const belt = pchip([[-5.94, 1.5], [-5.4, 1.55], [5.0, 1.55], [5.6, 1.18], [5.94, 1.14]]);
  const base = pchip([[-5.94, 0.4], [-5.6, 0.32], [5.6, 0.32], [5.94, 0.36]]);
  const panes = [[-5.25, -4.1], [-3.98, -2.83], [-2.71, -1.56], [-1.44, -0.29], [-0.17, 0.98], [1.1, 2.25], [2.37, 3.52], [3.64, 4.0]];
  const front = [4.22, 7], doorsR = [[4.32, 5.32], [0.25, 1.35]], S = 0.035;
  return {
    L, W0, W: planW(W0, L, 30, 6), yb: archY(arches, base), belt, sh: 1.0, roofR: 0.24, beltIn: 0.03, glassInset: 0.016,
    top: () => 3.0, crown: () => 0.04, xr: () => 1.2,
    gh: h => { const a = 0.035 / h; return [0, a, 0.4, 0.8 - a, 0.8, 0.8 + a, 1 - a, 1]; },
    arches, stations0: null, stations1: null,
    cell(lod, zm, c, sd) {
      const wh = [VK.LIVERY, lc('#f1ece2'), 0], red = [VK.LIVERY, lc('#c8352c'), 0], yel = [VK.LIVERY, lc('#f0b81e'), 0];
      const trim = [VK.TRIM, lc('#1c1d20'), 0], glass = [VK.GLASS, WHITE, 0], seal = [VK.SEAL, C_DARK, 0], sign = [VK.ATLAS, WHITE, 1.4];
      const door = sd < 0 && doorsR.some(r => inR(zm, r));
      const ws = Math.max(winState(zm, panes, S), winState(zm, [front], S));
      if (lod > 0) {
        if (c === 0) return [VK.TRIM, lc('#0c0c0d'), 0];
        if (c === 1) return trim;
        if (c === 2) return door ? glass : red;
        if (c === 3) return door ? glass : wh;
        if (c === 4) return ws === 2 ? glass : wh;
        return wh;
      }
      if (c === 0) return [VK.TRIM, lc('#0c0c0d'), 0];
      if (c === 1 || c === 2) return trim;
      if (c >= 3 && c <= 6) { if (door) return c === 3 ? trim : glass; return c <= 4 ? red : c === 5 ? yel : wh; }
      // greenhouse: 7 sill, 8 seal, 9-10 glass, 11 seal, 12 seal, 13 sign band (front) / panel, 14 seal, then the roof
      if (c >= 15) return wh;
      if (c === 12 || c === 14) return zm > 4.2 ? seal : wh;
      if (c === 13) return zm > 5.75 ? sign : zm > 4.2 ? trim : wh;
      if (door && c <= 10) return c === 7 || c === 8 ? seal : glass;
      if (c === 7) return wh;
      if (c === 8 || c === 11) return ws ? seal : wh;
      return ws === 2 ? glass : ws === 1 ? seal : wh;
    },
    panes, front
  };
}
function buildBus(lod) {
  const vb = new VB(), sp = busSpec(), L = sp.L;
  const S0 = 0.035;
  sp.stations0 = uniq([-5.94, -5.935, -5.925, -5.91, -5.88, -5.83, -5.76, ...archStations(-3.6, 0.58, 9), ...archStations(3.9, 0.58, 9), ...rangeStations(sp.panes, S0), ...rangeStations([[4.22, 99], [4.32, 5.32], [0.25, 1.35]], S0), 5.6, 5.72, 5.76, 5.83, 5.88, 5.91, 5.925, 5.935, 5.94]);
  sp.stations1 = uniq([-5.94, -5.91, -5.78, -4.18, -3.6, -3.02, 0.25, 1.35, 3.32, 3.9, 4.22, 4.48, 5.32, 5.78, 5.91, 5.94]);
  const S = loftBody(vb, sp, lod);
  for (const sx of [-1, 1]) for (const z of [-3.6, 3.9]) wheel(vb, sx * 1.02, 0.5, z, 0.5, 0.3, lod, 'bus');
  if (lod > 0) {
    for (const sx of [-1, 1]) {
      const q = (a, b, c, d, cc, k, e) => (sx > 0 ? vb.quad(a, b, c, d, cc, k, e) : vb.quad(b, a, d, c, cc, k, e));
      q([sx * 0.7, 0.62, L + 0.004], [sx * 1.1, 0.62, L - 0.01], [sx * 1.1, 0.82, L - 0.012], [sx * 0.7, 0.82, L + 0.003], WHITE, VK.HEAD, 1.6);
      q([sx * 1.18, 0.75, -L - 0.004], [sx * 0.95, 0.75, -L - 0.004], [sx * 0.95, 1.2, -L - 0.004], [sx * 1.18, 1.2, -L - 0.004], lc('#ff2a1a'), VK.TAIL, 1.2);
    }
    box(vb, 0, 3.1, -0.5, 1.5, 0.16, 3.2, lc('#d8d2c6'), VK.PLAIN, 0);
    return vb.build();
  }
  for (const a of sp.arches) for (const sx of [-1, 1]) lathe(vb, sx * 0.95, a.r, a.z, sx, [[a.Ra - 0.005, 0.3], [a.Ra - 0.005, -0.15]], 10, () => [VK.TRIM, lc('#0b0b0c'), 0], null, -Math.PI / 2 - 0.2, Math.PI / 2 + 0.2, true);
  box(vb, 0, 0.33, 0, 2.0, 0.02, 7.0, lc('#0b0b0c'), VK.TRIM, 0);
  for (const dir of [1, -1]) {
    const path = endPath(z => sp.W(z), L, 5.5, dir, 0.02, 12);
    sweep(vb, path, 0.5, [[-0.04, -0.16], [0.0, -0.16], [0.03, -0.12], [0.04, 0.0], [0.03, 0.12], [-0.04, 0.14]], () => [VK.TRIM, lc('#2a2b2e'), 0], [0, 0]);
  }
  for (const sx of [-1, 1]) {
    patch(vb, S, true, 3, 2, (u, v) => [sx * lerp(0.72, 1.12, u), lerp(0.6, 0.82, v), 0], () => [0, 0, 1], 0.008, VK.HEAD, WHITE, 2.2, (i, j) => [sx > 0 ? i / 3 : 1 - i / 3, j / 2]);
    patch(vb, S, true, 1, 3, (u, v) => [sx * lerp(0.95, 1.18, u), lerp(0.75, 1.25, v), 0], () => [0, 0, -1], 0.008, VK.TAIL, lc('#ff2a1a'), 1.4, (i, j) => [i, j / 3]);
    patch(vb, S, true, 1, 1, (u, v) => [sx * lerp(1.0, 1.15, u), lerp(2.86, 2.94, v), 0], () => [0, 0, 1], 0.008, VK.AMBER, lc('#ffb02a'), 0.8);
    // rabbit-ear mirrors in front of the windshield corners
    cyl(vb, sx * 1.22, 2.55, 5.84, 0.018, 0.34, C_DARK, VK.TRIM, 0, 0, 0, sx * 0.9, 6);
    rbox(vb, sx * 1.29, 2.25, 5.86, 0.07, 0.36, 0.2, 0.03, C_DARK, VK.TRIM, 0, 0, 0, 0, 1);
    box(vb, sx * 1.29, 2.25, 5.758, 0.05, 0.32, 0.008, WHITE, VK.GLASS, 0);
  }
  // rear engine grille, plate, roof air conditioning pod, wipers
  patch(vb, S, true, 4, 2, (u, v) => [lerp(-0.85, 0.85, u), lerp(0.66, 1.25, v), 0], () => [0, 0, -1], 0.006, VK.GRILLE, WHITE, 0, (i, j) => [i / 4 * 5, j / 2 * 1.5]);
  plateQuad(vb, 0, 0.5, L + 0.045, 0.34, 0.16, 1, 7);
  plateQuad(vb, 0, 0.5, -L - 0.045, 0.34, 0.16, -1, 1);
  rbox(vb, 0, 3.08, -0.6, 1.6, 0.16, 3.4, 0.06, lc('#e2ddd2'), VK.PLAIN, 0);
  box(vb, 0, 3.165, -0.6, 1.3, 0.01, 2.8, lc('#9aa0a6'), VK.GRILLE, 0, 0, 0, 0, (p) => [p[0] * 4, p[2] * 2]);
  for (const sx of [-1, 1]) box(vb, sx * 0.45, 1.25, 5.935, 0.75, 0.014, 0.025, C_DARK, VK.TRIM, 0, 0, 0, sx * 0.15);
  return vb.build();
}

// ===================== tram (streamlined streetcar) =====================
function tramSpec() {
  const L = 6.93, W0 = 1.33;
  const arches = [];
  const belt = pchip([[-6.93, 1.45], [-6.2, 1.55], [6.2, 1.55], [6.93, 1.45]]);
  const base = pchip([[-6.93, 0.55], [-6.5, 0.45], [6.5, 0.45], [6.93, 0.55]]);
  const panes = []; for (let k = -5; k <= 4; k++) panes.push([k * 1.18 + 0.08, k * 1.18 + 1.06]);
  const ends = [[-7.5, -6.1], [6.1, 7.5]], doorsR = [[4.2, 5.4], [-0.55, 0.55]], S = 0.035;
  return {
    L, W0, W: planW(W0, L, 7, 3), yb: archY(arches, base), belt, sh: 1.05, roofR: 0.32, beltIn: 0.04, glassInset: 0.016,
    top: () => 2.92, crown: () => 0.1, xr: () => 1.16,
    gh: h => { const a = 0.035 / h; return [0, a, 0.42, 0.75 - a, 0.75, 0.75 + a, 1 - a, 1]; },
    arches, panes, ends, stations0: null, stations1: null,
    cell(lod, zm, c, sd) {
      const grn = [VK.LIVERY, lc('#2f6b4f'), 0], cream = [VK.LIVERY, lc('#efe4c7'), 0], dk = [VK.LIVERY, lc('#1f4a36'), 0];
      const trim = [VK.TRIM, lc('#1c1d20'), 0], glass = [VK.GLASS, WHITE, 0], seal = [VK.SEAL, C_DARK, 0];
      const door = sd < 0 && doorsR.some(r => inR(zm, r));
      const ws = Math.max(winState(zm, panes, S), winState(zm, ends, S));
      const endz = Math.abs(zm) > 6.1;
      if (lod > 0) {
        if (c === 0) return [VK.TRIM, lc('#0c0c0d'), 0];
        if (c === 1) return dk;
        if (c === 2 || c === 3) return door ? glass : grn;
        if (c === 4) return ws === 2 || door ? glass : cream;
        return grn;
      }
      if (c === 0) return [VK.TRIM, lc('#0c0c0d'), 0];
      if (c === 1 || c === 2) return dk;
      if (c >= 3 && c <= 6) { if (door) return c === 3 ? trim : glass; return c === 6 ? cream : grn; }
      if (c === 7) return cream;
      if (c === 8 || c === 11) return door || ws ? seal : cream;
      if (c === 9 || c === 10) return door || ws === 2 ? glass : ws === 1 ? seal : cream;
      if (c === 12 || c === 14) return endz ? seal : cream;
      if (c === 13) return endz ? [VK.ATLAS, WHITE, 1.4] : cream;
      return grn;
    }
  };
}
function buildTram(lod) {
  const vb = new VB(), sp = tramSpec(), L = sp.L, S0 = 0.035;
  sp.stations0 = uniq([-6.93, -6.92, -6.9, -6.85, -6.77, -6.65, -6.45, -6.25, ...rangeStations(sp.panes, S0), ...rangeStations(sp.ends, S0), ...rangeStations([[4.2, 5.4], [-0.55, 0.55]], 0.03), 6.25, 6.45, 6.65, 6.77, 6.85, 6.9, 6.92, 6.93]);
  sp.stations1 = uniq([-6.93, -6.87, -6.65, -6.3, -6.1, -0.55, 0.55, 4.2, 5.4, 6.1, 6.3, 6.65, 6.87, 6.93]);
  const S = loftBody(vb, sp, lod);
  // the destination signs use the atlas: map their uv over the end band (u across the width)
  const signSet = (vbb) => {
    const r = ATL.tram;
    for (let k = 0; k < vbb.v; k++) if (vbb.k[k] === VK.ATLAS) {
      const x = vbb.p[k * 3], y = vbb.p[k * 3 + 1], z = vbb.p[k * 3 + 2];
      const u = clamp01((x * Math.sign(z) + 0.62) / 1.24), v = clamp01((y - 2.58) / 0.22);
      const uv = auv(r, u, v); vbb.u[k * 2] = uv[0]; vbb.u[k * 2 + 1] = uv[1];
      if (Math.abs(x) > 0.66) vbb.k[k] = VK.LIVERY, vbb.c[k * 3] = 0.03, vbb.c[k * 3 + 1] = 0.03, vbb.c[k * 3 + 2] = 0.03;
    }
  };
  signSet(vb);
  // bogies with wheels under the skirt, the trolley pole, headlamps
  for (const z of [-4.3, 4.3]) {
    box(vb, 0, 0.42, z, 1.9, 0.3, 2.2, lc('#1d1e20'), VK.TRIM, 0);
    for (const sx of [-1, 1]) for (const dz of [-0.75, 0.75]) wheel(vb, sx * 0.72, 0.33, z + dz, 0.33, 0.12, lod, 'steel');
  }
  if (lod > 0) {
    for (const dir of [1, -1]) vb.geo(new THREE.CircleGeometry(0.15, 6), TM(0, 1.22, dir * (L - 0.01), 0, dir > 0 ? 0 : Math.PI, 0), WHITE, VK.HEAD, 1.6, () => [0.32, 0.48]);
    cyl(vb, 0, 4.4, -1.6, 0.04, 3.2, lc('#2a2a2a'), VK.TRIM, 0, -0.9, 0, 0, 6);
    box(vb, 0, 3.1, 0, 1.0, 0.18, 4.0, lc('#3a3c40'), VK.TRIM, 0);
    return vb.build();
  }
  for (const dir of [1, -1]) {
    const hh = hitOut(S, [0, 1.22, 0], [0, 0, dir]);
    // headlamp: chrome ring + lens (a short cylinder along z), anti-climber chrome strips, bumper
    if (hh) {
      const m = TM(0, 1.22, hh.p[2] + dir * 0.02, Math.PI / 2, 0, 0, 0.17, 0.06, 0.17);
      vb.geo(tpl().cyl12, m, C_CHROME, VK.CHROME, 0);
      vb.geo(new THREE.CircleGeometry(0.14, 14), TM(0, 1.22, hh.p[2] + dir * 0.051, 0, dir > 0 ? 0 : Math.PI, 0), WHITE, VK.HEAD, 2.4, (p) => [0.3 + (p[0] + 0.14) / 0.28 * 0.4, (p[1] - 1.08) / 0.28]);
    }
    const path = endPath(z => sp.W(z), L, 6.2, dir, 0.03, 12);
    sweep(vb, path, 0.62, [[-0.03, -0.06], [0.0, -0.06], [0.03, -0.03], [0.035, 0.0], [0.03, 0.03], [0.0, 0.06], [-0.03, 0.06]], () => [VK.CHROME, C_CHROME, 0], [0, 0]);
    for (const sx of [-1, 1]) patch(vb, S, true, 1, 1, (u, v) => [sx * lerp(0.72, 0.86, u), lerp(0.85, 0.95, v), 0], () => [0, 0, dir], 0.008, dir > 0 ? VK.AMBER : VK.TAIL, dir > 0 ? lc('#ffb02a') : lc('#ff2a1a'), dir > 0 ? 0.6 : 1.2);
  }
  // roof: equipment box, resistors, the trolley pole with its shoe, a retriever rope
  rbox(vb, 0, 3.12, 0.4, 1.1, 0.2, 3.6, 0.05, lc('#3a3c40'), VK.TRIM, 0);
  box(vb, 0, 3.23, 0.4, 0.9, 0.02, 3.2, lc('#55585e'), VK.GRILLE, 0, 0, 0, 0, (p) => [p[0] * 3, p[2] * 2]);
  box(vb, 0, 3.12, -2.0, 0.4, 0.14, 0.4, C_DARK, VK.TRIM, 0);
  cyl(vb, 0, 4.42, -1.62, 0.035, 3.2, lc('#2a2a2a'), VK.TRIM, 0, -0.9, 0, 0, 6);
  cyl(vb, 0, 5.62, 0.0, 0.06, 0.14, C_CHROME, VK.CHROME, 0, Math.PI / 2, 0, 0, 6);
  return vb.build();
}

// ===================== cable car =====================
function buildCable(lod) {
  const vb = new VB();
  const mar = lc('#7a1f22'), cream = lc('#efe1bf'), red = lc('#b8322a'), wood = lc('#8a6038'), brass = lc('#d6b25a'), dk = lc('#1d1e20');
  const LIV = VK.LIVERY;
  // underframe, trucks, wheels
  box(vb, 0, 0.38, 0, 1.9, 0.28, 8.2, dk, VK.TRIM, 0);
  for (const sx of [-1, 1]) for (const z of [-2.6, 2.6]) wheel(vb, sx * 0.75, 0.32, z, 0.32, 0.12, lod, 'steel');
  // floor / running boards (wood), maroon skirt with a gold line
  rbox(vb, 0, 0.6, 0, 2.5, 0.1, 8.6, 0.03, wood, VK.WOOD, 0);
  rbox(vb, 0, 0.92, 0, 2.38, 0.56, 8.5, lod ? 0.06 : 0.08, mar, LIV, 0, 0, 0, 0, lod ? 1 : 2);
  if (!lod) for (const sx of [-1, 1]) box(vb, sx * 1.192, 1.1, 0, 0.01, 0.02, 8.3, brass, VK.CHROME, 0);
  // enclosed centre cabin: cream walls, windows with frames, a red belt rail
  const cz = 2.1, wy0 = 1.62, wy1 = 2.42;
  if (lod > 0) {
    box(vb, 0, 1.92, 0, 2.3, 1.36, 4.2, cream, LIV, 0);
    for (const sx of [-1, 1]) box(vb, sx * 1.152, 2.02, 0, 0.01, 0.78, 3.9, WHITE, VK.GLASS, 0);
  } else {
    for (const sx of [-1, 1]) {
      const xw = sx * 1.15;
      // wall panels between windows (7 windows per side)
      const n = 7, ww = 0.44, gap = (cz * 2 - n * ww) / (n + 1);
      const q = (a, b, c, d, cc, k, e, uv) => (sx > 0 ? vb.quad(a, b, c, d, cc, k, e, uv) : vb.quad(b, a, d, c, cc, k, e, uv));
      q([xw, 1.24, cz], [xw, 1.24, -cz], [xw, wy0, -cz], [xw, wy0, cz], cream, LIV, 0);
      q([xw, wy1, cz], [xw, wy1, -cz], [xw, 2.62, -cz], [xw, 2.62, cz], cream, LIV, 0);
      for (let k = 0; k <= n; k++) {
        const z0 = cz - k * (ww + gap), z1 = z0 - gap;
        q([xw, wy0, z0], [xw, wy0, z1], [xw, wy1, z1], [xw, wy1, z0], cream, LIV, 0);
        if (k < n) {
          const g0 = z1, g1 = z1 - ww;
          q([xw - sx * 0.025, wy0 + 0.02, g0 - 0.02], [xw - sx * 0.025, wy0 + 0.02, g1 + 0.02], [xw - sx * 0.025, wy1 - 0.02, g1 + 0.02], [xw - sx * 0.025, wy1 - 0.02, g0 - 0.02], WHITE, VK.GLASS, 0, [g0, wy0, g1, wy0, g1, wy1, g0, wy1]);
          // window frame (varnished wood) round the glass
          q([xw, wy0, g0], [xw, wy0, g1], [xw - sx * 0.025, wy0 + 0.02, g1 + 0.02], [xw - sx * 0.025, wy0 + 0.02, g0 - 0.02], wood, VK.WOOD, 0);
          q([xw - sx * 0.025, wy1 - 0.02, g0 - 0.02], [xw - sx * 0.025, wy1 - 0.02, g1 + 0.02], [xw, wy1, g1], [xw, wy1, g0], wood, VK.WOOD, 0);
          q([xw - sx * 0.025, wy0 + 0.02, g0 - 0.02], [xw, wy0, g0], [xw, wy1, g0], [xw - sx * 0.025, wy1 - 0.02, g0 - 0.02].map(v => v), wood, VK.WOOD, 0);
          q([xw, wy0, g1], [xw - sx * 0.025, wy0 + 0.02, g1 + 0.02], [xw - sx * 0.025, wy1 - 0.02, g1 + 0.02], [xw, wy1, g1], wood, VK.WOOD, 0);
        }
      }
      box(vb, sx * 1.16, 1.3, 0, 0.04, 0.14, cz * 2 + 0.04, red, LIV, 0);
      box(vb, sx * 1.165, 2.52, 0, 0.03, 0.05, cz * 2, brass, VK.CHROME, 0);
    }
    // end walls of the cabin (with a door window), corner posts
    for (const dz of [1, -1]) {
      box(vb, 0, 1.93, dz * cz, 2.3, 1.38, 0.06, cream, LIV, 0);
      box(vb, 0, 2.0, dz * (cz + 0.033), 0.7, 0.75, 0.01, WHITE, VK.GLASS, 0);
      for (const sx of [-1, 1]) cyl(vb, sx * 1.15, 1.93, dz * cz, 0.05, 1.4, red, LIV, 0, 0, 0, 0, 8);
    }
  }
  // open ends: outward benches, brass poles, a low dash with the headlamp and the end board above
  for (const dz of [1, -1]) {
    const zc = dz * 3.2;
    for (const sx of [-1, 1]) {
      rbox(vb, sx * 0.88, 1.18, zc, 0.42, 0.08, 1.9, 0.02, wood, VK.WOOD, 0);
      if (!lod) {
        rbox(vb, sx * 0.62, 1.48, zc, 0.06, 0.5, 1.9, 0.02, wood, VK.WOOD, 0);
        for (const ddz of [-0.85, 0, 0.85]) cyl(vb, sx * 1.12, 1.95, zc + ddz, 0.025, 1.9, brass, VK.CHROME, 0, 0, 0, 0, 6);
      }
    }
    rbox(vb, 0, 1.12, dz * 4.22, 2.3, 0.5, 0.16, 0.05, mar, LIV, 0);
    if (!lod) {
      vb.geo(tpl().cyl12, TM(0, 1.3, dz * 4.255, Math.PI / 2, 0, 0, 0.13, 0.05, 0.13), C_CHROME, VK.CHROME, 0);
      vb.geo(new THREE.CircleGeometry(0.105, 12), TM(0, 1.3, dz * 4.282, 0, dz > 0 ? 0 : Math.PI, 0), WHITE, VK.HEAD, 2.6, (p) => [0.5 + p[0] * dz * 2.2, (p[1] - 1.195) / 0.21]);
      cyl(vb, 0.5 * dz, 1.55, dz * 4.12, 0.02, 0.5, brass, VK.CHROME, 0, 0, 0, 0, 6);
    } else vb.geo(new THREE.CircleGeometry(0.1, 6), TM(0, 1.3, dz * 4.31, 0, dz > 0 ? 0 : Math.PI, 0), WHITE, VK.HEAD, 2.4, () => [0.32, 0.48]);
  }
  // the roof: cream canopy over the whole car, red clerestory with small windows, the end boards
  rbox(vb, 0, 2.86, 0, 2.5, 0.16, 8.6, 0.07, cream, LIV, 0, 0, 0, 0, lod ? 1 : 2);
  rbox(vb, 0, 3.12, 0, 1.4, 0.36, 7.0, 0.05, red, LIV, 0, 0, 0, 0, lod ? 1 : 2);
  if (!lod) {
    for (const sx of [-1, 1]) for (let k = -5; k <= 5; k++) box(vb, sx * 0.703, 3.13, k * 0.6, 0.008, 0.16, 0.42, WHITE, VK.GLASS, 0);
    box(vb, 0, 3.32, 0, 1.2, 0.04, 6.8, lc('#5a3a2a'), VK.WOOD, 0);
    for (const dz of [1, -1]) {
      const r = ATL.cable;
      vb.geo(new THREE.PlaneGeometry(1.4, 0.3), TM(0, 3.1, dz * 3.506, 0, dz > 0 ? 0 : Math.PI, 0), WHITE, VK.ATLAS, 0.5, (p, n, uv0) => auv(r, uv0[0], uv0[1]));
      cyl(vb, 0.55 * dz, 2.75, dz * 4.2, 0.07, 0.1, brass, VK.CHROME, 0, 0, 0, 0, 8); // bell
    }
  }
  return vb.build();
}

// ===================== road works =====================
function buildWorks(lod) {
  const vb = new VB();
  const leg = lc('#e6e1d6'), amb = lc('#ffa31a'), ora = lc('#ff6a12');
  // sawhorse barriers front and back: red / white striped boards (retroreflective), A-frame legs, flashing lamps
  for (const z of [-1.72, 1.72]) {
    for (const [h, t] of [[0.55, 0.2], [0.9, 0.2]]) box(vb, 0, h, z, 2.4, t, 0.05, WHITE, VK.STRIPE, 0, 0, 0, 0, p => [p[0] * 1.6, p[1]]);
    for (const sx of [-1.07, 1.07]) {
      box(vb, sx, 0.52, z - 0.08, 0.08, 1.04, 0.05, leg, VK.PLAIN, 0, 0.12, 0, 0);
      box(vb, sx, 0.52, z + 0.08, 0.08, 1.04, 0.05, leg, VK.PLAIN, 0, -0.12, 0, 0);
      box(vb, sx, 0.03, z, 0.26, 0.06, 0.34, lc('#2a2a2a'), VK.TRIM, 0);
    }
    for (const sx of [-0.95, 0.95]) {
      cyl(vb, sx, 1.04, z, 0.035, 0.06, C_DARK, VK.TRIM, 0, 0, 0, 0, 6);
      vb.geo(lod ? tpl().sphLo : tpl().sph, TM(sx, 1.1, z, 0, 0, 0, 0.085, 0.085, 0.085), amb, BLINK, 2.8);
    }
  }
  for (const sx of [-1.15, 1.15]) {
    box(vb, sx, 0.48, 0, 0.05, 0.22, 3.4, WHITE, VK.STRIPE, 0, 0, 0, 0, p => [p[2] * 1.6, p[1]]);
    box(vb, sx, 0.24, 0, 0.06, 0.48, 0.08, leg, VK.PLAIN, 0);
  }
  // keep-left signs on poles over each barrier (atlas)
  for (const z of [-1.76, 1.76]) {
    cyl(vb, 0, 1.32, z, 0.03, 0.7, lc('#8a9096'), VK.CHROME, 0, 0, 0, 0, 6);
    const r = ATL.works;
    vb.geo(lod ? new THREE.CircleGeometry(0.3, 10) : new THREE.CircleGeometry(0.3, 18), TM(0, 1.72, z + Math.sign(z) * 0.03, 0, z > 0 ? 0 : Math.PI, 0), WHITE, VK.ATLAS, 0, (p, n, uv0) => auv(r, uv0[0], uv0[1]));
    if (!lod) vb.geo(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 18, 1, true), TM(0, 1.72, z + Math.sign(z) * 0.02, Math.PI / 2, 0, 0), lc('#c9ccd0'), VK.CHROME, 0);
  }
  // inside: an open trench with a heap of earth, a toolbox, a pick, cones at the corners
  box(vb, 0, 0.006, -0.85, 1.5, 0.012, 1.0, lc('#141313'), VK.TRIM, 0);
  vb.geo(lod ? tpl().sphLo : new THREE.IcosahedronGeometry(1, 2), TM(0.05, 0.02, 0.25, 0, 0.4, 0, 0.78, 0.42, 1.0), lc('#6b5236'), VK.EARTH, 0);
  if (!lod) {
    rbox(vb, -0.55, 0.2, -0.95, 0.46, 0.38, 0.3, 0.03, lc('#c0392b'), VK.LIVERY, 0);
    box(vb, -0.55, 0.42, -0.95, 0.2, 0.03, 0.04, C_DARK, VK.TRIM, 0);
    cyl(vb, 0.45, 0.6, 0.35, 0.025, 1.1, lc('#8a6038'), VK.WOOD, 0, 0.5, 0, 0, 6);
    box(vb, 0.45, 1.06, 0.62, 0.05, 0.05, 0.5, lc('#55585e'), VK.CHROME, 0, 0.5, 0, 0);
    for (const [cx, cz] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.4], [0.85, -1.4]]) {
      vb.geo(new THREE.CylinderGeometry(0.03, 0.15, 0.5, 10, 1, true), TM(cx, 0.29, cz), ora, VK.STRIPE, 0, p => [0, p[1] * 3 + 10]);
      box(vb, cx, 0.02, cz, 0.36, 0.04, 0.36, lc('#1c1c1c'), VK.TRIM, 0);
    }
  }
  return vb.build();
}

// ===================== the material =====================
const U = { time: uniform(0), hdr: K.post && K.post.uHDR && K.post.uHDR.isNode ? K.post.uHDR : uniform(1) };
let MAT = null, ATLAS_TEX = null;
const ATLAS_NODES = [];
// the atlas: a neutral 1x1 texture first; once K.tex has the WebP, a new texture made from its image is swapped into
// every sampling node (a texture first uploaded as 1x1 cannot take the bigger image in place on WebGL 2). The atlas is
// tiny (512 px): it keeps the resolution it first arrived with.
function atlasTexture() {
  if (ATLAS_TEX) return ATLAS_TEX;
  const d = new Uint8Array([150, 150, 150, 0]);
  ATLAS_TEX = new THREE.DataTexture(d, 1, 1); ATLAS_TEX.colorSpace = THREE.SRGBColorSpace; ATLAS_TEX.needsUpdate = true;
  const T = K.tex, name = 'vehicles/veh_atlas';
  if (T && typeof T.load === 'function' && T.has && T.has(name)) {
    const kt = T.load(name, { wrap: 'clamp', fallback: [150, 150, 150, 0] });
    Promise.resolve(T.preload([name])).then(() => {
      const img = kt.image;
      if (!img || !(img.width > 1)) return;
      const t = new THREE.Texture(img);
      t.colorSpace = THREE.SRGBColorSpace; t.flipY = kt.flipY; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; t.generateMipmaps = true;
      t.needsUpdate = true;
      ATLAS_TEX = t;
      for (const n of ATLAS_NODES) n.value = t;
    }, () => {});
  }
  return ATLAS_TEX;
}
// hash of a vec3 (0..1)
const h31 = p => tfract(tsin(tdot(p, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
function vehicleMaterial() {
  const m = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.5, metalness: 0 });
  m.name = 'vehicles';
  // the city lights its scene environment at 0.4: car paint, glass and chrome want a stronger sky reflection
  m.envMapIntensity = 2.0;
  // straight-line TSL only (masks and mix, no If / select over computed values; derivatives in uniform control flow)
  const mk = c => tselect(c, float(1), float(0));
  const aK = attribute('aKind', 'float'), aUv = attribute('aUv', 'vec2'), aE = attribute('aEmit', 'float');
  const vc = attribute('color', 'vec3');
  const ic = varyingProperty('vec3', 'vInstanceColor');
  const kk = tfloor(aK.add(0.5));
  const is = n => mk(kk.equal(n));
  const tbl = [];
  for (let k = 30; k < 30 + NK; k++) { const d = KP[k] || [0.6, 0, 0, 0]; tbl.push(new THREE.Vector4(d[0], d[1], d[2], d[3])); }
  const KPa = uniformArray(tbl, 'vec4');
  const kp = KPa.element(int(tclamp(kk.sub(30), 0, NK - 1)));
  const mPaint = is(VK.PAINT), mDecal = is(VK.DECAL), mGlass = is(VK.GLASS), mTyre = is(VK.TYRE), mHead = is(VK.HEAD), mTail = is(VK.TAIL);
  const mAtlas = is(VK.ATLAS), mWood = is(VK.WOOD), mStripe = is(VK.STRIPE), mEarth = is(VK.EARTH), mGrille = is(VK.GRILLE), mFar = is(VK.WHEELFAR);
  const mBlink = is(VK.BLINK), mAmber = is(VK.AMBER), mTrim = is(VK.TRIM);
  const pg = positionGeometry, ng = normalGeometry;
  const sampleA = uvN => { const n = ttexture(atlasTexture(), uvN); ATLAS_NODES.push(n); return n; };
  // ---- per instance: metallic or solid paint (from the colour: a car keeps its finish), the plate variant
  const ih = tfract(tdot(ic, vec3(17.31, 31.73, 11.17)).mul(7.13)).toVar('vIh');
  const scheme = tfloor(aE.add(0.5)).toVar('vScheme');
  const metallic = mk(ih.greaterThan(0.3)).mul(mk(scheme.notEqual(4))).toVar('vMet');
  // ---- panel gaps on the painted sides (door seams per scheme)
  const SE = uniformArray(SEAMS.map(s => new THREE.Vector4(s[0], s[1], s[2], s[3])), 'vec4');
  const SY = uniformArray(SEAMS.map(s => new THREE.Vector4(s[4], s[5], 0, 0)), 'vec4');
  const si = int(tclamp(scheme, 0, SEAMS.length - 1)), se = SE.element(si), sy = SY.element(si);
  const fwz = tmax(tabs(dFdx(pg.z)).add(tabs(dFdy(pg.z))), 1e-4).toVar('vFwz');
  const seamL = z0 => float(1).sub(tsmooth(0.004, tmax(fwz, 0.004).add(0.004), tabs(pg.z.sub(z0))));
  const sideM = tsmooth(0.55, 0.8, tabs(ng.x)).mul(tstep(sy.x, pg.y)).mul(tstep(pg.y, sy.y));
  const seam = tmax(tmax(seamL(se.x), seamL(se.y)), tmax(seamL(se.z), seamL(se.w))).mul(sideM).mul(mPaint).toVar('vSeam');
  // ---- taxi checker band / delivery van logo panel (DECAL: aEmit 2 = checker, 1 = van logo by local position)
  const chk = tabs(tstep(0.5, tfract(pg.z.mul(6.25))).sub(tstep(0.5, tfract(pg.y.mul(6.25)))));
  const logoUv = vec2(tfract(pg.z.add(2.35).div(3.3)), pg.y.sub(0.55).div(1.5));
  const logoUvS = vec2(tmix(logoUv.x, float(1).sub(logoUv.x), mk(ng.x.greaterThan(0))), logoUv.y);
  const vr = ATL.van;
  const logoA = sampleA(vec2(tmix(vr[0] / 512, vr[2] / 512, tclamp(logoUvS.x, 0, 1)), tmix(1 - vr[3] / 512, 1 - vr[1] / 512, tclamp(logoUvS.y, 0, 1))));
  const inLogo = tstep(0, logoUv.y).mul(tstep(logoUv.y, 1)).toVar('vInLogo');
  const mChk = mDecal.mul(mk(aE.greaterThan(1.5))), mLogo = mDecal.mul(mk(aE.lessThan(1.5))).mul(inLogo);
  // ---- base colour (no instance colour yet)
  const atlC = sampleA(aUv).toVar('vAtl');
  let base = vc.toVar('vBase');
  base = tmix(base, vec3(0.012, 0.012, 0.013), seam.mul(0.85));
  base = tmix(base, tmix(vec3(0.03), vec3(0.92), chk), mChk);
  base = tmix(base, logoA.xyz, mLogo);
  // glass: dark tint, darker towards the top (a hint of the cabin: headrests / seat backs below the waist)
  base = tmix(base, vec3(0.014, 0.017, 0.02), mGlass);
  // tyres: tread blocks and sidewall lettering (atlas strip, two turns)
  const tread = tsmooth(0.3, 0.36, aUv.y).mul(float(1).sub(tsmooth(0.64, 0.7, aUv.y)));
  const wallV = tclamp(tmix(aUv.y.div(0.3), float(1).sub(aUv.y).div(0.3), mk(aUv.y.greaterThan(0.5))), 0, 1);
  const tr = ATL.tyre;
  const wallC = sampleA(vec2(tfract(aUv.x.mul(2)).mul((tr[2] - tr[0]) / 512).add(tr[0] / 512), tmix(1 - tr[3] / 512, 1 - tr[1] / 512, wallV)));
  base = tmix(base, tmix(wallC.xyz, vec3(0.03, 0.03, 0.032), tread), mTyre);
  // far wheel disc: tyre ring outside, rim inside (radius in aUv.y, rim fraction in aEmit)
  base = tmix(base, tmix(vc, vec3(0.025), tstep(aE, aUv.y)), mFar);
  // lamps: projector lenses in a chrome reflector (head), light bars (tail)
  const lu = aUv.x, lv = aUv.y;
  const d1 = tlen(vec2(lu.sub(0.32).mul(1.6), lv.sub(0.48))), d2 = tlen(vec2(lu.sub(0.68).mul(1.6), lv.sub(0.48)));
  const lens = float(1).sub(tsmooth(0.2, 0.24, tmin(d1, d2))).toVar('vLens');
  const drl = tsmooth(0.78, 0.84, lv).mul(float(1).sub(tsmooth(0.94, 0.98, lv))).mul(tsmooth(0.04, 0.1, lu)).mul(float(1).sub(tsmooth(0.9, 0.96, lu)));
  base = tmix(base, tmix(vec3(0.62, 0.64, 0.66), vec3(0.85, 0.86, 0.88), lens), mHead);
  const bars = tsmooth(0.15, 0.25, tfract(lv.mul(3))).mul(float(1).sub(tsmooth(0.75, 0.85, tfract(lv.mul(3))))).toVar('vBars');
  base = tmix(base, vc.mul(tmix(float(0.3), float(0.4), bars)), mTail);
  // atlas (plates, signs): the texel colour
  base = tmix(base, atlC.xyz.mul(vc), mAtlas);
  // grille: honeycomb tile from the atlas
  const gr = ATL.grille;
  const grC = sampleA(vec2(tfract(aUv.x).mul(0.25).add(gr[0] / 512), tfract(aUv.y).mul(0.25).add(1 - gr[3] / 512)));
  base = tmix(base, grC.xyz.mul(vc), mGrille);
  // wood grain, barrier stripes (red / white diagonal), earth
  const woodN = tsin(pg.x.mul(3).add(pg.z.mul(0.7)).add(tsin(pg.z.mul(9).add(pg.y.mul(40))).mul(0.6)).mul(18)).mul(0.5).add(0.5);
  base = tmix(base, vc.mul(tmix(float(0.72), float(1.05), woodN)), mWood);
  const stp = tstep(0.5, tfract(aUv.x.add(aUv.y).mul(1.6)));
  base = tmix(base, tmix(tmix(vec3(0.75, 0.04, 0.03), vc, mk(aUv.y.greaterThan(5))), vec3(0.85, 0.85, 0.83), stp), mStripe);
  const eN = h31(tfloor(pg.mul(22))).mul(0.5).add(h31(tfloor(pg.mul(7))).mul(0.5));
  base = tmix(base, vc.mul(tmix(float(0.6), float(1.15), eN)), mEarth);
  // ---- three multiplies the diffuse by the instance colour: keep it on paint (and the decals' paint), undo elsewhere
  const tint = tmax(mPaint, mDecal.mul(float(1).sub(tmax(mChk, mLogo))));
  const icS = tmax(ic, vec3(0.004));
  m.colorNode = vec4(base.mul(tmix(vec3(1).div(icS), vec3(1), tint)), 1);
  // ---- roughness / metal / clearcoat
  let rough = kp.x;
  rough = tmix(rough, tmix(float(0.3), float(0.42), metallic), mPaint);
  rough = tmix(rough, tmix(float(0.6), float(0.82), tread), mTyre);
  rough = tmix(rough, float(0.9), seam);
  rough = tmix(rough, tmix(float(0.35), float(0.12), lens), mHead);
  rough = tmix(rough, float(0.5), mChk.add(mLogo));
  m.roughnessNode = tclamp(rough, 0.03, 1);
  m.metalnessNode = tmix(kp.y, tmix(float(0.05), float(0.55), metallic), mPaint).mul(float(1).sub(seam));
  m.clearcoatNode = kp.z.mul(float(1).sub(seam));
  m.clearcoatRoughnessNode = tmix(float(0.06), float(0.035), mPaint);
  // ---- normal: tyre tread bumps (derivative bump mapping), earth relief, metal flakes in the paint
  const N0 = tnorm(normalView).toVar('vN0');
  const av = tabs(aUv.y.sub(0.5));
  const blocks = tstep(0.18, tfract(aUv.x.mul(64))).mul(float(1).sub(tstep(0.07, av).mul(tstep(av, 0.1)))).mul(tstep(0.012, av));
  const hgt = blocks.mul(tread).mul(mTyre).mul(0.004).add(eN.mul(mEarth).mul(0.03)).toVar('vHgt');
  const dpx = dFdx(positionView), dpy = dFdy(positionView);
  const r1 = tcross(dpy, N0), r2 = tcross(N0, dpx);
  const det = tdot(dpx, r1);
  const grad = tsign(det).mul(dFdx(hgt).mul(r1).add(dFdy(hgt).mul(r2)));
  const Nb = tnorm(tmax(tabs(det), 1e-12).mul(N0).sub(grad));
  // flakes: ~4 mm cells, random tilt, fading out once a cell is smaller than a pixel
  const fp = tmax(tlen(dpx), tlen(dpy));
  const fc = tfloor(pg.mul(320)).toVar('vFc');
  const fl = vec3(h31(fc), h31(fc.add(7.1)), h31(fc.add(3.7))).sub(0.5);
  const flAmp = float(1).sub(tsmooth(0.0007, 0.0025, fp)).mul(0.09).mul(mPaint).mul(metallic).mul(float(1).sub(seam));
  // a faint orange peel / panel waviness everywhere on the paint
  m.normalNode = tnorm(Nb.add(fl.mul(flAmp)));
  m.clearcoatNormalNode = N0;
  // ---- emission (HDR: the bloom picks it up)
  const hk = tmix(float(1), float(2.6), U.hdr);
  const bl = tstep(0.45, tfract(U.time.mul(1.4)));
  const headE = vec3(1.0, 0.9, 0.74).mul(tmax(lens, drl.mul(0.8)).mul(1.0).add(0.04)).mul(mHead);
  const tailE = vec3(1.0, 0.05, 0.025).mul(bars.mul(0.3).add(0.7)).mul(mTail);
  const blinkE = vec3(1.0, 0.5, 0.06).mul(tmix(float(0.03), float(1), bl)).mul(mBlink);
  const amberE = vec3(1.0, 0.45, 0.05).mul(0.5).mul(mAmber);
  const atlE = atlC.xyz.mul(atlC.w).mul(mAtlas);
  m.emissiveNode = headE.add(tailE).add(blinkE).add(amberE).add(atlE).mul(aE).mul(hk);
  // ---- screen-space reflections (Ultra / Élevé): glass, chrome, paint
  if (K.post && typeof K.post.ssr === 'function') {
    try { K.post.ssr(m, kp.w.mul(float(1).sub(seam))); } catch (e) { console.warn('Kit Rush 3D: vehicle SSR opt-in failed', e); }
  }
  void mTrim;
  return m;
}
function material() {
  if (!MAT) MAT = vehicleMaterial();
  return MAT;
}

// ===================== models (cached per type and LOD) =====================
const GEO = [[], []];
function geometry(type, lod) {
  if (!GEO[lod][type]) {
    const f = [() => buildCar(lod, false), () => buildCar(lod, true), () => buildVan(lod, false), () => buildBus(lod), () => buildCable(lod), () => buildTram(lod), () => buildWorks(lod), () => buildVan(lod, true)][type];
    GEO[lod][type] = f();
  }
  return GEO[lod][type];
}
function buildLOD(type, lod) { return { geometry: geometry(type, lod ? 1 : 0), material: material() }; }

// ===================== LOD instancing of the city's vehicles =====================
const LODD = { ultra: [70, 420], high: [48, 320], medium: [22, 200], low: [18, 150] };
const CAP_NEAR = [40, 12, 16, 3, 2, 1, 3, 3];
const POOL = { group: null, near: [], far: [], ents: [], parked: [], hooked: [], cityGeo: [], frame: -1, dirty: true, camKey: '', ck: new Float64Array(7), built: false };
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _fr = new THREE.Frustum(), _sp = new THREE.Sphere(), _cq = new THREE.Quaternion();
const ZERO16 = new Float32Array(16);
function makePool(type, lod, cap) {
  const mesh = new THREE.InstancedMesh(geometry(type, lod), material(), Math.max(1, cap));
  mesh.name = (lod ? 'veh-far-' : 'veh-near-') + VT[type].name;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceMatrix.array.fill(0);
  mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  mesh.onBeforeRender = evaluate;
  return { mesh, slots: new Array(Math.max(1, cap)).fill(null), top: 0, cap: Math.max(1, cap), dirtyM: false, dirtyC: false };
}
function ensurePool() {
  if (POOL.built) return true;
  const g = K.city && K.city.group;
  if (!g) return false;
  POOL.group = g;
  const nParked = VT.map(() => 0);
  for (const e of POOL.parked) nParked[e.type]++;
  const tcount = [16, 6, 6, 3, 2, 1, 3, 3];
  for (let t = 0; t < VT.length; t++) {
    const total = nParked[t] + tcount[t] + 8;
    const N = POOL.near[t] = makePool(t, 0, Math.min(total, CAP_NEAR[t] + Math.ceil(nParked[t] * 0.15)));
    POOL.far[t] = makePool(t, 1, total);
    // the near cars cast their shadow with the far model: a proxy sharing the near pool's instance buffers, drawn in
    // the shadow passes only (count = near count between onBeforeShadow and onAfterShadow, 0 in the colour pass)
    N.mesh.castShadow = false;
    const sh = new THREE.InstancedMesh(geometry(t, 1), material(), 1);
    sh.name = 'veh-shadow-' + VT[t].name;
    sh.instanceMatrix = N.mesh.instanceMatrix; sh.instanceColor = N.mesh.instanceColor;
    sh.count = 0; sh.castShadow = true; sh.receiveShadow = false; sh.frustumCulled = false;
    sh.onBeforeShadow = () => { sh.count = N.mesh.count; };
    sh.onAfterShadow = () => { sh.count = 0; };
    sh.onBeforeRender = evaluate;
    N.shadow = sh;
    g.add(N.mesh); g.add(POOL.far[t].mesh); g.add(sh);
  }
  for (const e of POOL.parked) POOL.ents.push(e);
  POOL.built = true;
  return true;
}
// the city's traffic meshes (made from build(type)): hide them, record their poses
function hookCity() {
  if (!POOL.built || POOL.hooked.length >= VT.length) return;
  const g = POOL.group;
  for (const o of g.children) {
    if (!o.isInstancedMesh || o.userData.vehHooked || o.name.startsWith('veh-')) continue;
    const t = POOL.cityGeo.indexOf(o.geometry);
    if (t < 0) continue;
    o.userData.vehHooked = true;
    o.visible = false;
    const list = [];
    const arr = o.instanceMatrix.array, carr = o.instanceColor ? o.instanceColor.array : null;
    for (let i = 0; i < o.count; i++) {
      const m = new Float32Array(16); m.set(arr.subarray(i * 16, i * 16 + 16));
      const e = { type: t, parked: false, m, col: carr ? [carr[i * 3], carr[i * 3 + 1], carr[i * 3 + 2]] : [1, 1, 1], on: false, lod: -1, slot: -1 };
      e.on = !(m[0] === 0 && m[1] === 0 && m[2] === 0);
      list.push(e); POOL.ents.push(e);
    }
    const proto = THREE.InstancedMesh.prototype;
    o.setMatrixAt = function (i, mat) {
      proto.setMatrixAt.call(this, i, mat);
      const e = list[i];
      if (e) { mat.toArray(e.m); e.on = !(e.m[0] === 0 && e.m[1] === 0 && e.m[2] === 0); POOL.dirty = true; }
    };
    o.setColorAt = function (i, c) {
      proto.setColorAt.call(this, i, c);
      const e = list[i];
      if (e) { e.col = [c.r, c.g, c.b]; e.cdirty = true; POOL.dirty = true; }
    };
    POOL.hooked.push(t);
  }
}
function release(e) {
  if (e.lod < 0) return;
  const P = (e.lod === 0 ? POOL.near : POOL.far)[e.type];
  P.slots[e.slot] = null;
  P.mesh.instanceMatrix.array.set(ZERO16, e.slot * 16);
  P.dirtyM = true;
  while (P.top > 0 && !P.slots[P.top - 1]) P.top--;
  e.lod = -1; e.slot = -1;
}
function alloc(e, lod) {
  const P = (lod === 0 ? POOL.near : POOL.far)[e.type];
  let s = 0;
  while (s < P.cap && P.slots[s]) s++;
  if (s >= P.cap) return false;
  P.slots[s] = e; e.lod = lod; e.slot = s;
  if (s + 1 > P.top) P.top = s + 1;
  const c = P.mesh.instanceColor.array;
  c[s * 3] = Math.max(0.004, e.col[0]); c[s * 3 + 1] = Math.max(0.004, e.col[1]); c[s * 3 + 2] = Math.max(0.004, e.col[2]);
  P.dirtyC = true;
  return true;
}
function evaluate() {
  if (!POOL.built) return;
  hookCity();
  const V = K.view, cam = V && V.camera;
  if (!cam) return;
  const g = POOL.group;
  _v.setFromMatrixPosition(cam.matrixWorld);
  g.worldToLocal(_v);
  cam.getWorldQuaternion(_cq);
  const preset = (K.gfx && K.gfx.preset) || 'high';
  const ck = POOL.ck;
  const same = ck[0] === _v.x && ck[1] === _v.y && ck[2] === _v.z && ck[3] === _cq.x && ck[4] === _cq.y && ck[5] === _cq.z && ck[6] === cam.fov && POOL.camKey === preset;
  if (!POOL.dirty && same) return;
  POOL.dirty = false; POOL.camKey = preset;
  ck[0] = _v.x; ck[1] = _v.y; ck[2] = _v.z; ck[3] = _cq.x; ck[4] = _cq.y; ck[5] = _cq.z; ck[6] = cam.fov;
  const dd = LODD[preset] || LODD.high;
  _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).multiply(g.matrixWorld);
  _fr.setFromProjectionMatrix(_m);
  const cx = _v.x, cy = _v.y, cz = _v.z;
  for (const e of POOL.ents) {
    let want = -1;
    if (e.on) {
      const t = VT[e.type], m = e.m;
      const x = m[12] + m[4] * t.hy, y = m[13] + m[5] * t.hy, z = m[14] + m[6] * t.hy;
      const d = Math.hypot(x - cx, y - cy, z - cz);
      const sz = Math.sqrt(t.hz / 2.3), dn = dd[0] * sz, df = dd[1] * sz;
      if (d < dn * (e.lod === 0 ? 1.12 : 1)) want = 0;
      else if (d < df * (e.lod === 1 ? 1.05 : 1)) {
        _sp.center.set(x, y, z); _sp.radius = Math.hypot(t.hx, t.hy, t.hz) + 3;
        want = d < dn * 1.6 || _fr.intersectsSphere(_sp) ? 1 : -1;
      }
    }
    if (want !== e.lod || (e.cdirty && e.lod >= 0)) {
      release(e); e.cdirty = false;
      if (want >= 0 && !alloc(e, want) && want === 0) alloc(e, 1);
    }
    if (e.lod >= 0) {
      const P = (e.lod === 0 ? POOL.near : POOL.far)[e.type];
      P.mesh.instanceMatrix.array.set(e.m, e.slot * 16);
      P.dirtyM = true;
    }
  }
  for (const L of [POOL.near, POOL.far]) for (const P of L) {
    if (!P) continue;
    P.mesh.count = P.top;
    if (P.dirtyM) { P.mesh.instanceMatrix.clearUpdateRanges(); P.mesh.instanceMatrix.addUpdateRange(0, Math.max(1, P.top) * 16); P.mesh.instanceMatrix.needsUpdate = true; P.dirtyM = false; }
    if (P.dirtyC) { P.mesh.instanceColor.needsUpdate = true; P.dirtyC = false; }
  }
}

// ===================== API =====================
function build(type) {
  const geo = geometry(type, 0);
  POOL.cityGeo[type] = geo;
  // the city builds its traffic meshes right after the parked cars were registered: make the LOD pools now (so the
  // Act 2 precompile sees them) and hide the city's own meshes as they appear
  if (ensurePool()) hookCity();
  return { geometry: geo, material: material() };
}
const _ac = new THREE.Color();
function addTo(mb, type, M, paintC) {
  if (mb && mb.hd && K.city && K.city.group && !POOL.built) {
    // a parked car of the city being built: drawn by the LOD instancing
    const m = new Float32Array(16); M.toArray(m);
    const c = paintC || _ac.set(1, 1, 1);
    POOL.parked.push({ type, parked: true, m, col: [c.r, c.g, c.b], on: true, lod: -1, slot: -1 });
    return;
  }
  // compatibility: write the far model into a city mesh builder with the city's surface kinds
  const L = lib(), KIND = L.KIND, g = geometry(type, 1);
  if (mb.hd) mb = mb.hd;
  const pa = g.attributes.position, na = g.attributes.normal, ca = g.attributes.color, ka = g.attributes.aKind, ea = g.attributes.aEmit, ix = g.index;
  const nm = new THREE.Matrix3().getNormalMatrix(M), v = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
  const P = paintC || L.C_WHITE, o = mb.count;
  const map = k => (k === VK.PAINT || k === VK.DECAL ? 30 : k === VK.BLINK ? 31 : k === VK.GLASS ? KIND.glass : k === VK.CHROME || k === VK.RIM ? KIND.metal : k === VK.HEAD || k === VK.TAIL || k === VK.AMBER || k === VK.ATLAS ? KIND.glow : KIND.plain);
  for (let k = 0; k < pa.count; k++) {
    v.fromBufferAttribute(pa, k).applyMatrix4(M); n.fromBufferAttribute(na, k).applyMatrix3(nm).normalize();
    const kind = Math.round(ka.getX(k));
    c.setRGB(ca.getX(k), ca.getY(k), ca.getZ(k));
    if (kind === VK.PAINT || kind === VK.DECAL) c.multiply(P);
    if (kind === VK.HEAD) c.setRGB(1, 0.93, 0.8);
    mb.vert(v.x, v.y, v.z, n.x, n.y, n.z, c, map(kind), 0, 0, kind === VK.PAINT || kind === VK.DECAL ? 0 : ea.getX(k));
  }
  for (let k = 0; k < ix.count; k++) mb.i.push(ix.getX(k) + o);
}
function update(dt, t) {
  U.time.value = t;
  POOL.dirty = true;
  if (POOL.built && POOL.hooked.length < VT.length) hookCity();
}
function stats() {
  const near = POOL.near.map(P => (P ? P.mesh.count : 0)), far = POOL.far.map(P => (P ? P.mesh.count : 0));
  const tris = { lod0: GEO[0].map(g => (g ? g.index.count / 3 : 0)), lod1: GEO[1].map(g => (g ? g.index.count / 3 : 0)) };
  return { types: VT.length, near, far, tris, parked: POOL.parked.length, ents: POOL.ents.length, hooked: POOL.hooked.slice(), built: POOL.built };
}
K.vehicles = {
  VT, PAINT, BLINK, PAINTS, vehicleTop, build, buildLOD, material, paint, parkedPaint, addTo, update, stats,
  _dbg: { POOL, VK, PARTS, geometry, evaluate, show(on) { for (const L of [POOL.near, POOL.far]) for (const P of L) if (P) { P.mesh.visible = on; if (P.shadow) P.shadow.visible = on; } } }
};
})();
