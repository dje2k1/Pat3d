import { CSMShadowNode as CityCSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
(() => {
'use strict';
// ===================== ACT 2: SAN FRANCISCO (K.city) =====================
// Golden-hour descent of an original San Francisco: steep streets stepping down to the bay, painted ladies, cable-car
// tracks, traffic, the waterfront, a long pier ending at a giant pinball bumper, and the red bridge in the fog.
// Everything lives in K.city.group, translated far east of the island (OX) so no Act 1 query ever overlaps it.
// Geometry is built in the group's local frame; the physics API takes and returns world coordinates.
if (typeof THREE === 'undefined') return;

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const OX = 4000, OZ = 0;
const clamp = (v, a, b) => (v > b ? b : v >= a ? v : a);
const lerp = (a, b, t) => a + (b - a) * t;
const fin = v => typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;
const finV = v => !!v && fin(v.x) && fin(v.y) && fin(v.z);
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const hash = n => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
const lin = hex => new THREE.Color(hex); // r186 colour management: sRGB hex -> linear working space
const LIGHT_PI = Math.PI; // r128 multiplied punctual / hemisphere light by PI in its shaders; r155+ light units do not
const yawOf = (x, z) => Math.atan2(-x, -z);
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function isTouch() { const V = K.view; return V ? (typeof V.isTouch === 'function' ? !!V.isTouch() : !!V.isTouch) : false; }

// ---------- dimensions of a street (d = signed distance from the centre line, + = right of travel) ----------
const ROAD = 8;          // asphalt half width (curb face)
const WALK = 11.5;       // facade line
const WALLD = 10.9;      // where Kit is stopped (stoops and lamps stay outside the play space)
const LANE = 3.1;        // travel lane centres at +-LANE (Kit's direction on the right)
const PARK = 6.35;       // parking lane centres
const CURB = 0.18;       // curb height
const XHALF = 11;        // half size of an intersection along the route
const XSIDE = 30;        // how far the intersection plateau reaches into the cross street

// ===================== route =====================
// Corners of the descent (local x, z; -z = north) with their arc radii.
const CORNERS = [
  { x: 0, z: 70 },
  { x: 0, z: -750, r: 20 },
  { x: 360, z: -750, r: 20 },
  { x: 360, z: -1380, r: 22 },
  { x: 20, z: -1380, r: 26 },
  { x: 20 - 0.5 * 300, z: -1380 - 0.8660254 * 300 }
];
const RT = { n: 0, len: 0, x: null, z: null, dx: null, dz: null, k: null, zone: null, y: null, g: null, built: false };
function buildRoute() {
  const pts = [];
  const push = (x, z) => pts.push([x, z]);
  push(CORNERS[0].x, CORNERS[0].z);
  const arcs = [];
  for (let i = 1; i < CORNERS.length - 1; i++) {
    const a = CORNERS[i - 1], b = CORNERS[i], c = CORNERS[i + 1];
    let ix = b.x - a.x, iz = b.z - a.z; const il = Math.hypot(ix, iz); ix /= il; iz /= il;
    let ox = c.x - b.x, oz = c.z - b.z; const ol = Math.hypot(ox, oz); ox /= ol; oz /= ol;
    const th = Math.acos(clamp(ix * ox + iz * oz, -1, 1)), t = b.r * Math.tan(th / 2);
    const cross = ix * oz - iz * ox; // > 0: turning right (toward +right)
    arcs.push({ sx: b.x - ix * t, sz: b.z - iz * t, ex: b.x + ox * t, ez: b.z + oz * t, ix, iz, ox, oz, th, r: b.r, turn: cross > 0 ? 1 : -1 });
  }
  // walk the polyline: straight, arc, straight ... sampling every 1 unit of arc length
  const X = [], Z = [], DX = [], DZ = [], KK = [];
  let px = CORNERS[0].x, pz = CORNERS[0].z;
  const straight = (tx, tz) => {
    const l = Math.hypot(tx - px, tz - pz), ux = (tx - px) / l, uz = (tz - pz) / l;
    const s0 = X.length ? X.length : 0;
    void s0;
    for (let d = X.length ? 1 : 0; d <= l; d++) {
      if (!X.length && d > 0) { /* first sample handled at d = 0 */ }
      X.push(px + ux * d); Z.push(pz + uz * d); DX.push(ux); DZ.push(uz); KK.push(0);
    }
    const rem = l - Math.floor(l);
    px = px + ux * Math.floor(l); pz = pz + uz * Math.floor(l);
    return rem;
  };
  let carry = 0;
  for (const a of arcs) {
    // straight up to the arc start (sampling continues on the unit grid of arc length)
    let l = Math.hypot(a.sx - px, a.sz - pz);
    const ux = (a.sx - px) / l, uz = (a.sz - pz) / l;
    let d = X.length ? 1 - carry : 0;
    for (; d <= l + 1e-9; d++) { X.push(px + ux * d); Z.push(pz + uz * d); DX.push(ux); DZ.push(uz); KK.push(0); }
    carry = l - (d - 1);
    px = a.sx; pz = a.sz;
    // the arc: centre to the right (turn = 1) or left of the travel direction
    const rx = -a.iz, rz = a.ix; // right of the incoming direction
    const cx = a.sx + rx * a.r * a.turn, cz = a.sz + rz * a.r * a.turn;
    const alen = a.th * a.r;
    d = 1 - carry;
    for (; d <= alen + 1e-9; d++) {
      const ang = (d / a.r) * a.turn;
      const vx = px - cx, vz = pz - cz, c = Math.cos(ang), s = Math.sin(ang);
      const qx = cx + vx * c - vz * s, qz = cz + vx * s + vz * c;
      const tx = a.ix * c - a.iz * s, tz = a.ix * s + a.iz * c;
      X.push(qx); Z.push(qz); DX.push(tx); DZ.push(tz); KK.push(a.turn / a.r);
    }
    carry = alen - (d - 1);
    px = a.ex; pz = a.ez;
  }
  {
    const last = CORNERS[CORNERS.length - 1];
    const l = Math.hypot(last.x - px, last.z - pz), ux = (last.x - px) / l, uz = (last.z - pz) / l;
    let d = 1 - carry;
    for (; d <= l + 1e-9; d++) { X.push(px + ux * d); Z.push(pz + uz * d); DX.push(ux); DZ.push(uz); KK.push(0); }
  }
  void straight;
  RT.n = X.length; RT.len = RT.n - 1;
  RT.x = Float32Array.from(X); RT.z = Float32Array.from(Z); RT.dx = Float32Array.from(DX); RT.dz = Float32Array.from(DZ); RT.k = Float32Array.from(KK);
  RT.arcs = arcs;
  buildRouteGrid();
}
// spatial index: 16 u cells -> route samples within reach
const RG = { cell: 16, x0: 0, z0: 0, nx: 0, nz: 0, cells: null };
function buildRouteGrid() {
  let mnx = 1e9, mnz = 1e9, mxx = -1e9, mxz = -1e9;
  for (let i = 0; i < RT.n; i++) { mnx = Math.min(mnx, RT.x[i]); mxx = Math.max(mxx, RT.x[i]); mnz = Math.min(mnz, RT.z[i]); mxz = Math.max(mxz, RT.z[i]); }
  const pad = 80, C = RG.cell;
  RG.x0 = mnx - pad; RG.z0 = mnz - pad;
  RG.nx = Math.ceil((mxx - mnx + 2 * pad) / C) + 1; RG.nz = Math.ceil((mxz - mnz + 2 * pad) / C) + 1;
  const lists = new Array(RG.nx * RG.nz);
  const reach = 64;
  for (let i = 0; i < RT.n; i += 2) {
    const ax = Math.floor((RT.x[i] - reach - RG.x0) / C), bx = Math.floor((RT.x[i] + reach - RG.x0) / C);
    const az = Math.floor((RT.z[i] - reach - RG.z0) / C), bz = Math.floor((RT.z[i] + reach - RG.z0) / C);
    for (let gz = Math.max(0, az); gz <= Math.min(RG.nz - 1, bz); gz++) for (let gx = Math.max(0, ax); gx <= Math.min(RG.nx - 1, bx); gx++) {
      const k = gz * RG.nx + gx;
      (lists[k] || (lists[k] = [])).push(i);
    }
  }
  RG.cells = lists;
}
// nearest route point to local (x, z): writes LOC {s, d, i} and returns it, or null when far from every street
const LOC = { s: 0, d: 0, i: 0, ok: false };
function locate(x, z) {
  const gx = Math.floor((x - RG.x0) / RG.cell), gz = Math.floor((z - RG.z0) / RG.cell);
  if (gx < 0 || gz < 0 || gx >= RG.nx || gz >= RG.nz) return null;
  const list = RG.cells[gz * RG.nx + gx];
  if (!list) return null;
  let best = -1, bd = 1e18;
  for (let k = 0; k < list.length; k++) {
    const i = list[k], ex = x - RT.x[i], ez = z - RT.z[i], d2 = ex * ex + ez * ez;
    if (d2 < bd) { bd = d2; best = i; }
  }
  // refine on the neighbouring samples (1 u apart) then project on the local tangent
  let i = best;
  for (let it = 0; it < 3; it++) {
    const a = i > 0 ? i - 1 : i, b = i < RT.n - 1 ? i + 1 : i;
    const da = (x - RT.x[a]) ** 2 + (z - RT.z[a]) ** 2, db = (x - RT.x[b]) ** 2 + (z - RT.z[b]) ** 2, di = (x - RT.x[i]) ** 2 + (z - RT.z[i]) ** 2;
    if (da < di && da <= db) i = a; else if (db < di) i = b; else break;
  }
  const ex = x - RT.x[i], ez = z - RT.z[i];
  const t = clamp(ex * RT.dx[i] + ez * RT.dz[i], -0.5, 0.5);
  LOC.s = clamp(i + t, 0, RT.len);
  LOC.i = i;
  // signed lateral distance (right of travel = +)
  LOC.d = ex * -RT.dz[i] + ez * RT.dx[i];
  LOC.ok = true;
  return LOC;
}
// route frame at arc length s (local coordinates)
const FR = { x: 0, z: 0, dx: 0, dz: -1, rx: 1, rz: 0, y: 0, g: 0, k: 0 };
function frame(s, out) {
  out = out || FR;
  s = clamp(fin(s) ? s : 0, 0, RT.len);
  const i = Math.min(RT.n - 2, Math.floor(s)), f = s - i;
  out.x = lerp(RT.x[i], RT.x[i + 1], f); out.z = lerp(RT.z[i], RT.z[i + 1], f);
  let dx = lerp(RT.dx[i], RT.dx[i + 1], f), dz = lerp(RT.dz[i], RT.dz[i + 1], f);
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  out.dx = dx; out.dz = dz; out.rx = -dz; out.rz = dx;
  out.k = lerp(RT.k[i], RT.k[i + 1], f);
  out.y = profY(s); out.g = profG(s);
  return out;
}

// ===================== profile (road height along the route) =====================
// knots: [s, y, L] = grade change at s smoothed over a parabolic vertical curve of length L (small L = a lip)
const PROF = { knots: null, tab: null, gtab: null, step: 0.25 };
function sOf(x, z) { const r = locate(x, z); return r ? r.s : 0; }
const FEAT = {}; // named arc lengths of the features (filled by planRoute)
function planRoute() {
  const S = name => FEAT[name];
  // intersections (centres on the route)
  FEAT.iA0 = sOf(0, 0); FEAT.iA1 = sOf(0, -150); FEAT.iA2 = sOf(0, -300); FEAT.iA3 = sOf(0, -450); FEAT.iA4 = sOf(0, -600);
  const a1 = RT.arcs[0], a2 = RT.arcs[1], a3 = RT.arcs[2], a4 = RT.arcs[3];
  FEAT.t1a = sOf(a1.sx, a1.sz); FEAT.t1b = sOf(a1.ex, a1.ez);
  FEAT.iB = sOf(180, -750);
  FEAT.t2a = sOf(a2.sx, a2.sz); FEAT.t2b = sOf(a2.ex, a2.ez);
  FEAT.iC1 = sOf(360, -900); FEAT.iC2 = sOf(360, -1050); FEAT.iC3 = sOf(360, -1200);
  FEAT.t3a = sOf(a3.sx, a3.sz); FEAT.t3b = sOf(a3.ex, a3.ez);
  FEAT.iW = sOf(190, -1380);
  FEAT.t4a = sOf(a4.sx, a4.sz); FEAT.t4b = sOf(a4.ex, a4.ez);
  FEAT.end = RT.len;
  FEAT.pier0 = FEAT.t4b + 6;
  FEAT.bumper = RT.len - 14;
  const h = XHALF;
  const k = [];
  const kn = (s, y, L) => k.push([s, y, L]);
  kn(0, 128, 0);
  kn(S('iA0') + h, 128, 8);            // plaza edge: over the top
  kn(S('iA1') - h, 104, 14);
  kn(S('iA1') + h, 104, 4);
  kn(S('iA2') - h - 16, 78.5, 10);     // the dip before jump 1
  kn(S('iA2') - h, 86, 2.5);           // the lip: the street kicks up into the crossing
  kn(S('iA2') + h, 86, 4);
  kn(S('iA3') - h, 68, 12);
  kn(S('iA3') + h, 68, 4);
  kn(S('iA4') - h, 52, 12);
  kn(S('iA4') + h, 52, 4);
  kn(S('t1a') - 4, 44, 10);
  kn(S('t1b') + 4, 44, 6);
  kn(S('iB') - h, 40, 8);
  kn(S('iB') + h, 40, 6);
  kn(S('t2a') - 4, 38, 8);
  kn(S('t2b') + 4, 38, 6);
  kn(S('iC1') - h, 30, 10);
  kn(S('iC1') + h, 30, 4);
  kn(S('iC2') - h - 16, 12.5, 10);      // dip before jump 2 (the bay straight ahead)
  kn(S('iC2') - h, 19.5, 2.5);
  kn(S('iC2') + h, 19.5, 4);
  kn(S('iC3') - h, 10, 10);
  kn(S('iC3') + h, 10, 4);
  kn(S('t3a') - 10, 4, 12);
  kn(S('t4b') + 2, 4, 4);
  kn(S('pier0') + 16, 5.6, 5);
  kn(RT.len, 5.6, 0);
  PROF.knots = k;
  // tabulate (y and grade) on a 0.25 u grid
  const n = Math.ceil(RT.len / PROF.step) + 2;
  const Y = new Float32Array(n), G = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const s = j * PROF.step;
    let y = k[0][1], g = 0;
    // linear between knots
    for (let q = 0; q < k.length - 1; q++) {
      if (s <= k[q + 1][0] || q === k.length - 2) {
        const a = k[q], b = k[q + 1], gr = (b[1] - a[1]) / Math.max(1e-6, b[0] - a[0]);
        y = a[1] + gr * (Math.min(s, b[0]) - a[0]); g = gr;
        if (s > b[0]) { y = b[1]; g = 0; }
        break;
      }
    }
    // parabolic vertical curves at the knots
    for (let q = 1; q < k.length - 1; q++) {
      const L = k[q][2];
      if (!(L > 0)) continue;
      const s0 = k[q][0] - L / 2, s1 = k[q][0] + L / 2;
      if (s <= s0 || s >= s1) continue;
      const g0 = (k[q][1] - k[q - 1][1]) / (k[q][0] - k[q - 1][0]), g1 = (k[q + 1][1] - k[q][1]) / (k[q + 1][0] - k[q][0]);
      const u = s - s0;
      y = k[q][1] - g0 * L / 2 + g0 * u + (g1 - g0) * u * u / (2 * L);
      g = g0 + (g1 - g0) * u / L;
    }
    Y[j] = y; G[j] = g;
  }
  PROF.tab = Y; PROF.gtab = G;
}
function profY(s) {
  const t = clamp(s, 0, RT.len) / PROF.step, i = Math.min(PROF.tab.length - 2, Math.floor(t)), f = t - i;
  return PROF.tab[i] + (PROF.tab[i + 1] - PROF.tab[i]) * f;
}
function profG(s) {
  const t = clamp(s, 0, RT.len) / PROF.step, i = Math.min(PROF.gtab.length - 2, Math.floor(t)), f = t - i;
  return PROF.gtab[i] + (PROF.gtab[i + 1] - PROF.gtab[i]) * f;
}

// ===================== zones along the route =====================
// kind per 1 u sample: 0 street block, 1 intersection, 2 turn (corner berm), 3 waterfront, 4 pier
const Z_BLOCK = 0, Z_X = 1, Z_TURN = 2, Z_WATER = 3, Z_PIER = 4;
const XS = []; // intersections: {s, cross: bool (has a cross street both sides), side: -1|0|1 (T-junction side), traffic: bool, jump: bool}
const TURNS = []; // {s0, s1, sc, turn (+1 right), cx, cz, r}
function planZones() {
  const n = RT.n, Zn = new Uint8Array(n);
  const f = FEAT;
  const isect = (s, o) => XS.push(Object.assign({ s, side: 0, traffic: true, jump: false, wide: XHALF }, o || {}));
  isect(f.iA0, { traffic: false });
  isect(f.iA1);
  isect(f.iA2, { jump: true });
  isect(f.iA3, { traffic: false });
  isect(f.iA4);
  isect(f.iB);
  isect(f.iC1);
  isect(f.iC2, { jump: true });
  isect(f.iC3);
  isect(f.iW, { side: -1, traffic: false });
  for (let i = 0; i < n; i++) {
    let z = Z_BLOCK;
    if (i >= f.t3b) z = Z_WATER;
    if (i >= f.t4a) z = Z_PIER;
    Zn[i] = z;
  }
  for (const x of XS) for (let i = Math.max(0, Math.floor(x.s - x.wide)); i <= Math.min(n - 1, Math.ceil(x.s + x.wide)); i++) Zn[i] = Zn[i] === Z_WATER ? Z_WATER : Z_X;
  const arcs = RT.arcs;
  for (let q = 0; q < 3; q++) {
    const a = arcs[q], s0 = sOf(a.sx, a.sz), s1 = sOf(a.ex, a.ez);
    const rx = -a.iz, rz = a.ix;
    TURNS.push({ s0, s1, sc: (s0 + s1) / 2, turn: a.turn, r: a.r, cx: a.sx + rx * a.r * a.turn, cz: a.sz + rz * a.r * a.turn, kx: CORNERS[q + 1].x, kz: CORNERS[q + 1].z });
    for (let i = Math.max(0, Math.floor(s0 - XHALF + 2)); i <= Math.min(n - 1, Math.ceil(s1 + XHALF - 2)); i++) if (q < 2 || Zn[i] !== Z_PIER) Zn[i] = Z_TURN;
  }
  RT.zone = Zn;
}
function zoneAt(s) { return RT.zone[clamp(Math.round(s), 0, RT.n - 1)]; }
function turnAt(s) { for (let q = 0; q < TURNS.length; q++) { const t = TURNS[q]; if (s > t.s0 - XHALF - 2 && s < t.s1 + XHALF + 2) return t; } return null; }
function isectAt(s) { for (let q = 0; q < XS.length; q++) { const x = XS[q]; if (Math.abs(s - x.s) <= x.wide + 0.5) return x; } return null; }

// ===================== surfaces =====================
// cross-section height at (s, d) relative to the profile, and where the walls are. Writes SURF.
const SURF = { y: 0, gx: 0, gd: 0, wall: false, kind: 0, edge: 0 };
const PIER_HALF = 7, PIER_END_R = 13;
function berm(t, s, d) {
  // corner bank on the outside of a turn: a concrete quarter-pipe rising from 6 u off the line to 3 u high
  const out = d * t.turn; // > 0 toward the outside of the turn? (turning right: outside is the left = -d)
  const o = -out;
  if (o <= 6) return 0;
  const u = clamp((o - 6) / 7, 0, 1);
  // fade the bank in and out along the corner
  const w = smooth((s - (t.s0 - 8)) / 10) * smooth(((t.s1 + 8) - s) / 10);
  return (u * u * 2.6 + u * 0.4) * w;
}
function surface(s, d) {
  const z = zoneAt(s);
  SURF.wall = false; SURF.gd = 0; SURF.kind = 0; SURF.edge = WALLD;
  const ad = Math.abs(d);
  if (z === Z_PIER) {
    SURF.edge = PIER_HALF - 0.35;
    const fs = FEAT.end - s;
    // round platform at the end
    if (fs < PIER_END_R + 4) {
      const ce = FEAT.end - PIER_END_R, ds = s - ce;
      if (ds > 0 || ad > PIER_HALF) {
        const rr = Math.hypot(Math.max(0, ds), d);
        SURF.edge = PIER_END_R - 0.4;
        if (rr > PIER_END_R - 0.4) { SURF.wall = true; }
        SURF.y = 0; SURF.kind = 4; return SURF;
      }
    }
    if (ad > PIER_HALF - 0.35) SURF.wall = true;
    SURF.y = 0; SURF.kind = 4;
    // the waterfront sidewalk leads onto the pier: before the deck starts, the avenue's surface
    if (s < FEAT.pier0) { SURF.edge = WALLD; SURF.wall = ad > WALLD; SURF.y = ad > ROAD ? CURB : 0; SURF.kind = ad > ROAD ? 1 : 0; }
    return SURF;
  }
  if (z === Z_X) {
    const x = isectAt(s);
    const reach = x && x.side ? (d * x.side > 0 ? XSIDE : WALLD) : XSIDE;
    SURF.edge = reach;
    // inside the crossing: road; at the corners (outside both roadways): sidewalk and corner buildings
    const ds = x ? Math.abs(s - x.s) : 0;
    const inCross = ds < ROAD + 0.01;
    if (ad <= ROAD || (inCross && ad <= reach)) { SURF.y = 0; SURF.kind = 0; }
    else { SURF.y = CURB; SURF.kind = 1; }
    if (ad > reach) SURF.wall = true;
    else if (!inCross && ad > WALLD) SURF.wall = true;
    return SURF;
  }
  if (z === Z_TURN) {
    const t = turnAt(s);
    SURF.edge = 16;
    const b = t ? berm(t, s, d) : 0;
    if (b > 0) { SURF.y = b; SURF.kind = 2; const h = 0.05, b2 = berm(t, s, d + h); SURF.gd = (b2 - b) / h; }
    else if (ad <= ROAD + 8) { SURF.y = 0; SURF.kind = 0; }
    else { SURF.y = CURB; SURF.kind = 1; }
    if (ad > 15.5) SURF.wall = true;
    return SURF;
  }
  if (z === Z_WATER) {
    // waterfront: the bay side (left of travel, west-bound) is a promenade with a sea wall
    SURF.edge = WALLD;
    if (ad <= ROAD) { SURF.y = 0; SURF.kind = 0; } else { SURF.y = CURB; SURF.kind = 1; }
    if (ad > WALLD) SURF.wall = true;
    return SURF;
  }
  if (ad <= ROAD) { SURF.y = 0; SURF.kind = 0; } else { SURF.y = CURB; SURF.kind = 1; }
  if (ad > WALLD) SURF.wall = true;
  return SURF;
}

// ===================== static solids (OBBs in local coordinates) =====================
// {x, y, z (centre), hx, hy, hz (half extents), c, s (cos / sin of yaw), kind, top: walkable top, ramp: rise along +z}
const SOL = { list: [], cell: 24, x0: 0, z0: 0, nx: 0, nz: 0, grid: null };
function addSolid(o) {
  o.c = Math.cos(o.yaw || 0); o.s = Math.sin(o.yaw || 0);
  if (o.top === undefined) o.top = true;
  o.r = Math.hypot(o.hx, o.hz);
  SOL.list.push(o);
  return o;
}
function indexSolids() {
  let mnx = 1e9, mnz = 1e9, mxx = -1e9, mxz = -1e9;
  for (const o of SOL.list) { mnx = Math.min(mnx, o.x - o.r); mxx = Math.max(mxx, o.x + o.r); mnz = Math.min(mnz, o.z - o.r); mxz = Math.max(mxz, o.z + o.r); }
  if (!SOL.list.length) { mnx = mnz = 0; mxx = mxz = 1; }
  const C = SOL.cell;
  SOL.x0 = mnx - C; SOL.z0 = mnz - C;
  SOL.nx = Math.ceil((mxx - mnx) / C) + 3; SOL.nz = Math.ceil((mxz - mnz) / C) + 3;
  SOL.grid = new Array(SOL.nx * SOL.nz);
  SOL.list.forEach((o, i) => {
    const ax = Math.floor((o.x - o.r - 1 - SOL.x0) / C), bx = Math.floor((o.x + o.r + 1 - SOL.x0) / C);
    const az = Math.floor((o.z - o.r - 1 - SOL.z0) / C), bz = Math.floor((o.z + o.r + 1 - SOL.z0) / C);
    for (let gz = Math.max(0, az); gz <= Math.min(SOL.nz - 1, bz); gz++) for (let gx = Math.max(0, ax); gx <= Math.min(SOL.nx - 1, bx); gx++) {
      const k = gz * SOL.nx + gx; (SOL.grid[k] || (SOL.grid[k] = [])).push(i);
    }
  });
}
const NO_SOLIDS = [];
function solidsNear(x, z) {
  const gx = Math.floor((x - SOL.x0) / SOL.cell), gz = Math.floor((z - SOL.z0) / SOL.cell);
  if (gx < 0 || gz < 0 || gx >= SOL.nx || gz >= SOL.nz) return NO_SOLIDS;
  return SOL.grid[gz * SOL.nx + gx] || NO_SOLIDS;
}
// local OBB coordinates of a point (writes OL)
const OL = { x: 0, z: 0 };
function toBox(o, x, z) { const ex = x - o.x, ez = z - o.z; OL.x = ex * o.c - ez * o.s; OL.z = ex * o.s + ez * o.c; return OL; }
function boxTop(o, lz) { return o.ramp ? lerp(o.y0, o.y1, clamp((lz + o.hz) / (2 * o.hz), 0, 1)) : o.y + o.hy; }

// ===================== materials =====================
const { Fn, If, uniform, uniformArray, attribute, vec2, vec3, vec4, float, int, mix, smoothstep, clamp: tclamp, abs: tabs, max: tmax, min: tmin,
  fract: tfract, floor: tfloor, sin: tsin, cos: tcos, pow: tpow, exp: texp, dot: tdot, normalize: tnormalize, reflect: treflect,
  length: tlength, step: tstep, select, positionWorld, positionLocal, positionGeometry, normalGeometry, cameraPosition,
  cameraViewMatrix, cameraProjectionMatrix, modelViewMatrix, modelWorldMatrix, varyingProperty, texture: ttexture, uv: tuv,
  positionView, normalView, normalViewGeometry, dFdx, dFdy, cross: tcross, inverseSqrt, sqrt: tsqrt, sign: tsign, faceDirection } = TSL;
const TL = K.tsl;
const U = { time: uniform(0), hdr: K.post && K.post.uHDR && K.post.uHDR.isNode ? K.post.uHDR : uniform(1) };
// city surfaces: vertex colour + a surface kind, uv in metres (or 0..1 for openings), emission
const KIND = {
  plain: 0, siding: 1, window: 2, shingle: 3, asphalt: 4, paint: 5, slab: 6, brick: 7, plank: 8, metal: 9, glow: 10,
  leaf: 11, rail: 12, dentil: 13, scales: 14, facade: 15, ground: 16, seawall: 17, stone: 18, awning: 19, glass: 20, tar: 21,
  shop: 22, manhole: 23, concrete: 24
};
// ---- the city's PBR material layers: two texture ARRAYS (tools/tex/city_tex.py, assets/tex/city/city_{alb,nrm}.webp)
// alb: RGB albedo (sRGB), A = 0.5 + 0.5 * tint (1 = takes the vertex colour); nrm: RG normal xy, B roughness,
// A = 0.5 + 0.5 * AO. The WebP strips are converted to THREE.DataArrayTexture once K.tex has them (and again when the
// texture set switches full <-> half); until then 1x1 neutral layers.
const LY = { paintwood: 0, siding: 1, shingle: 2, asphalt: 3, slab: 4, brick: 5, planks: 6, metal: 7, leaves: 8, dentil: 9,
  scales: 10, ground: 11, stone: 12, canvas: 13, tar: 14, concrete: 15, window: 16, manhole: 17 };
const NLAYER = 18;
const CT = { names: ['city/city_alb', 'city/city_nrm'], tex: [null, null], src: [null, null], nodes: [[], []], loaded: 0, res: [0, 0] };
function cityArray(data, w, srgb) {
  const t = new THREE.DataArrayTexture(data, w, w, NLAYER);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = w > 1; t.anisotropy = 8; t.flipY = false; t.unpackAlignment = 4;
  t.needsUpdate = true;
  return t;
}
function cityArrays() {
  if (!CT.tex[0]) {
    const a = new Uint8Array(4 * NLAYER), n = new Uint8Array(4 * NLAYER);
    // per-layer means from the manifest (tools/tex/city_tex.py): before the strips arrive the city is shaded like the
    // textured one, minus the detail (also keeps the e2e luma probes independent of the download timing)
    const man = K.tex && K.tex.manifest, ma = man && man['city/city_alb'] && man['city/city_alb'].means, mn = man && man['city/city_nrm'] && man['city/city_nrm'].means;
    for (let i = 0; i < NLAYER; i++) {
      a.set(ma && ma[i] ? ma[i] : [188, 188, 188, 255], i * 4);
      n.set(mn && mn[i] ? mn[i] : [128, 128, 204, 230], i * 4);
    }
    CT.tex[0] = cityArray(a, 1, true); CT.tex[1] = cityArray(n, 1, false);
  }
  return CT.tex;
}
// a sampling node of array i (0 alb, 1 nrm) at uv, layer (int node); registered so a swap updates every material
function citySample(i, uvNode, layerNode) {
  const n = ttexture(cityArrays()[i], uvNode);
  n.depthNode = layerNode;
  CT.nodes[i].push(n);
  return n;
}
// K.tex hands the strips over as ImageBitmaps (flipped at decode: the rows are already the array's memory layout)
function cityTexSync() {
  if (!K.tex || typeof K.tex.load !== 'function') return;
  if (!FT.tex) {
    const ft = K.tex.load(FT.name, { wrap: 'clamp' });
    if (ft && ft.image && ft.image.width > 1) { FT.tex = ft; for (const n of FT.nodes) n.value = ft; }
  }
  for (let i = 0; i < 2; i++) {
    const t = K.tex.load(CT.names[i]), img = t && t.image;
    if (!img || img === CT.src[i] || !(img.width > 1) || img.height !== img.width * NLAYER) continue;
    CT.src[i] = img;
    let data = null;
    try {
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      data = new Uint8Array(g.getImageData(0, 0, img.width, img.height).data.buffer);
      cv.width = cv.height = 1;
    } catch (e) { console.warn('Kit Rush 3D: city texture ' + CT.names[i] + ' not converted', e); continue; }
    const nt = cityArray(data, img.width, i === 0), old = CT.tex[i];
    CT.tex[i] = nt; CT.res[i] = img.width;
    for (const n of CT.nodes[i]) n.value = nt;
    if (old) old.dispose();
    // the bitmap is no longer needed (K.tex closes it when it switches sets)
    try { if (typeof img.close === 'function') img.close(); } catch (e) { /* closed */ }
    CT.loaded++;
  }
}
// per kind: [layer, tiles per metre along u, along v, uv source (0 aUv, 1 local XZ, 2 local side), normal strength,
// roughness = map * mul + add, metalness, chipped-paint metal (metal = 1 - tint), anti-tiling (2nd rotated sample), AO]
const KDEF = [];
const kd = (k, a) => { KDEF[k] = a; };
kd(KIND.plain, [LY.paintwood, 1, 1, 0, 0.7, 1, 0, 0, 0, 0, 1]);
kd(KIND.siding, [LY.siding, 0.92, 0.92, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.window, [LY.window, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.shingle, [LY.shingle, 0.667, 0.667, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.asphalt, [LY.asphalt, 0.42, 0.42, 1, 0.5, 1, 0, 0, 0, 1, 1]);
kd(KIND.paint, [LY.asphalt, 0.42, 0.42, 1, 0.55, 1, 0, 0, 0, 1, 0.6]);
kd(KIND.slab, [LY.slab, 0.333, 0.333, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.brick, [LY.brick, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.plank, [LY.planks, 0.5, 0.5, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.metal, [LY.metal, 2, 2, 0, 0.7, 1, 0, 0, 1, 0, 0.6]);
kd(KIND.glow, [LY.paintwood, 1, 1, 0, 0, 0, 0.35, 0, 0, 0, 0]);
kd(KIND.leaf, [LY.leaves, 1.1, 1.1, 2, 1, 1, 0, 0, 0, 1, 1]);
kd(KIND.rail, [LY.metal, 2, 2, 0, 0.35, 0.5, 0.0, 0.9, 0, 0, 0.3]);
kd(KIND.dentil, [LY.dentil, 0.65, 1, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.scales, [LY.scales, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.facade, [LY.siding, 0.92, 0.92, 0, 0.8, 1, 0, 0, 0, 0, 1]);
kd(KIND.ground, [LY.ground, 0.25, 0.25, 1, 1, 1, 0, 0, 0, 1, 1]);
kd(KIND.seawall, [LY.stone, 0.5, 0.5, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.stone, [LY.stone, 0.67, 0.67, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.awning, [LY.canvas, 2, 2, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.glass, [LY.paintwood, 1, 1, 0, 0, 0, 0.05, 0, 0, 0, 0]);
kd(KIND.tar, [LY.tar, 0.5, 0.5, 0, 1, 1, 0, 0, 0, 1, 1]);
kd(KIND.shop, [LY.paintwood, 1, 1, 0, 0, 0, 0.05, 0, 0, 0, 0]);
kd(KIND.manhole, [LY.manhole, 1, 1, 0, 1, 1, 0, 0.35, 0, 0, 1]);
kd(KIND.concrete, [LY.concrete, 0.5, 0.5, 0, 1, 1, 0, 0, 0, 1, 1]);
kd(30, [LY.paintwood, 1, 1, 0, 0.12, 0, 0.28, 0.35, 0, 0, 0.5]);
kd(31, [LY.paintwood, 1, 1, 0, 0, 0, 0.3, 0, 0, 0, 0]);
function kindTables(over) {
  const P0 = [], P1 = [], P2 = [];
  for (let k = 0; k < 32; k++) {
    const d = (over && over[k]) || KDEF[k] || KDEF[0];
    P0.push(new THREE.Vector4(d[0], d[1], d[2], d[3]));
    P1.push(new THREE.Vector4(d[4], d[5], d[6], d[7]));
    P2.push(new THREE.Vector4(d[8], d[9], d[10], 0));
  }
  return [uniformArray(P0, 'vec4'), uniformArray(P1, 'vec4'), uniformArray(P2, 'vec4')];
}
const ASPH_LIN = new THREE.Color('#67666b');
// hash of a vec3 (0..1)
const h31 = p => tfract(tsin(tdot(p, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
// The v2 city shader (per-kind procedural surfaces) rebuilt on PBR texture layers, branch-free (select / mix only:
// every texture read happens in uniform control flow, see the TSL notes in docs/SPEC3.md):
//  - albedo = layer albedo, tinted by the vertex colour where the layer says so; normal map through a cotangent frame
//    built from screen-space derivatives (the city geometry has no tangents); roughness / AO from the layer;
//  - asphalt: a second rotated sample against tiling, repair patches, worn paint for the markings, puddles on the flat
//    parts (SSR opt-in through K.post.ssr);
//  - windows (kind 2: sash frame from the WINDOW layer) and shop fronts (kind 22): interior mapping (a room behind the
//    glass: walls, floor, ceiling, back-wall decor, curtains and blinds, lamp-lit or dark) under a reflective glass;
//  - glow / blinkers / the far facades' lit windows as emission (HDR, bloom).
// opts.position(p) -> displaced local position node (flags, gulls); opts.vehicle: kinds 30 (paint: takes the instance
// colour, glossy) and 31 (blinkers); opts.side: THREE side (double-sided cloth).
function cityMaterial(opts) {
  opts = opts || {};
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: false, roughness: 0.8, metalness: 0 });
  if (opts.side != null) m.side = opts.side;
  // NOTE: no If / select() over computed values in here: TSL turns a select() whose branches hold expressions into an
  // if / else and emits shared temporaries inside the first branch only (garbage in the other one), and texture reads
  // must stay in uniform control flow. Everything is straight-line arithmetic; masks are 0 / 1 floats (mk) and every
  // division / normalisation is guarded so the unused paths never produce NaN.
  const mk = c => select(c, float(1), float(0));
  const snorm = v => v.mul(inverseSqrt(tmax(tdot(v, v), 1e-12)));
  const aK = attribute('aKind', 'float'), aUv = attribute('aUv', 'vec2'), aE = attribute('aEmit', 'float');
  const kk = tfloor(aK.add(0.5)), ki = int(kk);
  const lp = positionGeometry;
  const hdr = U.hdr, uTime = U.time;
  let vc = attribute('color', 'vec3');
  if (opts.vehicle) {
    // three multiplies the diffuse by the instance colour on every vertex; v2 only tinted the paint (kind 30)
    const ic = varyingProperty('vec3', 'vInstanceColor');
    vc = mix(vc.div(tmax(ic, vec3(1e-3))), vc, mk(aK.greaterThan(29.5)));
  }
  const [P0, P1, P2] = kindTables(opts.vehicle ? { 0: [LY.paintwood, 1, 1, 0, 0.15, 0.6, 0.1, 0, 0, 0, 0.5] } : null);
  const p0 = P0.element(ki), p1 = P1.element(ki), p2 = P2.element(ki);
  const isK = n => mk(kk.equal(n));
  const mWin = isK(KIND.window), mShop = isK(KIND.shop), mGlass = isK(KIND.glass), mPaint = isK(KIND.paint);
  const mRoad = tmax(isK(KIND.asphalt), mPaint), mFac = isK(KIND.facade), mWS = tmax(mWin, mShop);
  // ---- uv per kind: 0 = aUv, 1 = local XZ (asphalt, ground), 2 = local "side" (foliage)
  const mXZ = mk(p0.w.greaterThan(0.5).and(p0.w.lessThan(1.5))), mSide = mk(p0.w.greaterThan(1.5));
  const uvSrc = aUv.mul(float(1).sub(mXZ).sub(mSide)).add(vec2(lp.x, lp.z.negate()).mul(mXZ)).add(vec2(lp.x.add(lp.z).mul(0.7071), lp.y).mul(mSide));
  const uv = uvSrc.mul(p0.yz).toVar('cUv');
  const layer = int(p0.x);
  // anti-tiling: a second sample, rotated and scaled, blended by a large-scale noise
  const RC = 0.8253, RS = 0.5646; // cos / sin 0.6 rad
  const uv2 = vec2(uv.x.mul(RC).sub(uv.y.mul(RS)), uv.x.mul(RS).add(uv.y.mul(RC))).mul(0.437).add(vec2(0.37, 0.71)).toVar('cUv2');
  const wb = smoothstep(0.3, 0.7, TL.vnoise(lp.xz.mul(0.045).add(lp.y.mul(0.03)))).mul(p2.y).toVar('cAnti');
  const A1 = citySample(0, uv, layer).toVar('cA1'), N1 = citySample(1, uv, layer).toVar('cN1');
  const A2 = citySample(0, uv2, layer).toVar('cA2'), N2 = citySample(1, uv2, layer).toVar('cN2');
  const A = mix(A1, A2, wb).toVar('cA');
  const n2xy = N2.xy.mul(2).sub(1);
  const n2r = vec2(n2xy.x.mul(RC).add(n2xy.y.mul(RS)), n2xy.y.mul(RC).sub(n2xy.x.mul(RS)));
  const nxy0 = mix(N1.xy.mul(2).sub(1), n2r, wb).toVar('cNxy');
  const rgh0 = mix(N1.z, N2.z, wb), ao0 = mix(N1.w, N2.w, wb).mul(2).sub(1);
  const tint = tclamp(A.w.mul(2).sub(1), 0, 1).toVar('cTint');
  const texC = A.xyz;
  // ---- base colour: the layer albedo, tinted by the vertex colour where the layer says so
  let base = mix(texC, texC.mul(vc).mul(2), tint).toVar('cBase0');
  // road markings: worn paint over the asphalt (chipped where the aggregate peaks)
  const lumT = tdot(texC, vec3(0.2126, 0.7152, 0.0722)).toVar('cLum');
  const wearN = TL.vnoise(lp.xz.mul(1.7)).mul(0.6).add(TL.vnoise(lp.xz.mul(6.3)).mul(0.4));
  const paintCover = smoothstep(0.17, 0.25, wearN.sub(lumT.sub(0.5).mul(0.4))).toVar('cPaint');
  const asphC = texC.mul(vec3(ASPH_LIN.r, ASPH_LIN.g, ASPH_LIN.b)).mul(2);
  base = mix(base, mix(asphC, vc.mul(0.85), paintCover), mPaint);
  // asphalt repair patches (darker, smoother, rectangular) on a 9 m grid
  const pc = lp.xz.div(9), pid = tfloor(pc), pf = tfract(pc);
  const ph = TL.hash21(pid), ph2 = TL.hash21(pid.add(7.31));
  const pbox = tstep(ph.mul(0.3).add(0.1), pf.x).mul(tstep(pf.x, ph.mul(0.3).add(0.55))).mul(tstep(ph2.mul(0.3).add(0.1), pf.y)).mul(tstep(pf.y, ph2.mul(0.35).add(0.5)));
  const patch = pbox.mul(tstep(0.62, TL.hash21(pid.add(3.1)))).mul(mRoad).toVar('cPatch');
  base = base.mul(float(1).sub(patch.mul(0.28))).mul(mix(float(1), float(0.86), isK(KIND.asphalt)));
  // large-scale colour variation (asphalt stains, ground, roofs)
  const macro = TL.vnoise(lp.xz.mul(0.021)).mul(0.6).add(TL.vnoise(lp.xz.mul(0.083)).mul(0.4));
  base = base.mul(float(1).add(macro.sub(0.5).mul(mix(mix(float(0.12), float(0.35), isK(KIND.ground)), float(0.14), mRoad))));
  // awnings: v2's stripes over the canvas
  base = mix(base, vec3(0.83, 0.8, 0.74).mul(texC.mul(2)), tstep(0.5, tfract(aUv.x.mul(1.1))).mul(isK(KIND.awning)));
  // the sea wall darkens and greens toward the water line
  const wetWall = float(1).sub(smoothstep(-0.4, 1.4, lp.y)).mul(isK(KIND.seawall));
  base = base.mul(float(1).sub(wetWall.mul(0.45))).mul(mix(vec3(1), vec3(0.85, 0.95, 0.85), wetWall));
  // ---- puddles on the flat parts of the streets (local noise, edges broken by the aggregate)
  const flat = smoothstep(0.985, 0.997, normalGeometry.y);
  const pn = TL.fbm(lp.xz.mul(0.075).add(vec2(13.1, 7.7)));
  const wet = smoothstep(0.6, 0.7, pn.add(lumT.sub(0.5).mul(0.25))).mul(flat).mul(mRoad).toVar('cWet');
  const pud = smoothstep(0.55, 0.85, wet).toVar('cPud');
  base = base.mul(float(1).sub(wet.mul(0.25)).sub(pud.mul(0.12)));
  // ---- normal: cotangent frame from derivatives of the sampling uv (view space)
  const pV = positionView, Ng = snorm(normalView.mul(faceDirection)).toVar('cNg');
  const dp1 = dFdx(pV).toVar('cDp1'), dp2 = dFdy(pV).toVar('cDp2'), du1 = dFdx(uv), du2 = dFdy(uv);
  const dp2p = tcross(dp2, Ng), dp1p = tcross(Ng, dp1);
  const Tv = dp2p.mul(du1.x).add(dp1p.mul(du2.x)).toVar('cTv'), Bv = dp2p.mul(du1.y).add(dp1p.mul(du2.y)).toVar('cBv');
  const inv = inverseSqrt(tmax(tmax(tdot(Tv, Tv), tdot(Bv, Bv)), 1e-24)).toVar('cInv');
  // ---- windows and shop fronts: interior mapping in world space (a room behind every pane)
  const pW = positionWorld;
  const dw1 = dFdx(aUv), dw2 = dFdy(aUv), dq1 = dFdx(pW), dq2 = dFdy(pW);
  const det0 = dw1.x.mul(dw2.y).sub(dw1.y.mul(dw2.x));
  const det = mix(tmax(det0, 1e-12), tmin(det0, -1e-12), mk(det0.lessThan(0))).toVar('cDet');
  const dpdu = dq1.mul(dw2.y).sub(dq2.mul(dw1.y)).div(det).toVar('cDpdu'), dpdv = dq2.mul(dw1.x).sub(dq1.mul(dw2.x)).div(det).toVar('cDpdv');
  const Ww = tclamp(tlength(dpdu), 0.05, 40).toVar('cWw'), Hh = tclamp(tlength(dpdv), 0.05, 40).toVar('cHh');
  const Tw = dpdu.div(Ww), Bw = dpdv.div(Hh), Nw = snorm(tcross(Tw, Bw)).toVar('cNw');
  const rd = snorm(pW.sub(cameraPosition)).toVar('cRd');
  const sgnSafe = d => mix(tmax(d, 1e-3), tmin(d, -1e-3), mk(d.lessThan(0)));
  const ddx = sgnSafe(tdot(rd, Tw)).toVar('cDdx'), ddy = sgnSafe(tdot(rd, Bw)).toVar('cDdy'), dz0 = tmin(tdot(rd, Nw), -0.02).toVar('cDz');
  const ox = aUv.x.mul(Ww), oy = aUv.y.mul(Hh);
  const rmx = mix(float(0.9), float(0.25), mShop), rlo = mix(float(-0.85), float(-0.45), mShop), rhi = Hh.add(mix(float(0.55), float(0.25), mShop));
  const rD = mix(float(3.4), float(5.5), mShop);
  const tX = mix(rmx.negate().sub(ox), Ww.add(rmx).sub(ox), mk(ddx.greaterThan(0))).div(ddx);
  const tY = mix(rlo.sub(oy), rhi.sub(oy), mk(ddy.greaterThan(0))).div(ddy);
  const tZ = rD.negate().div(dz0);
  const tH = tmax(tmin(tmin(tX, tY), tZ), 0).toVar('cTh');
  const hx = ox.add(ddx.mul(tH)), hy = oy.add(ddy.mul(tH)), hz = dz0.mul(tH); // hz in -rD..0
  const mBack = mk(tZ.lessThanEqual(tmin(tX, tY))), mSideW = mk(tX.lessThanEqual(tY)).mul(float(1).sub(mBack));
  const mFloor = float(1).sub(mBack).sub(mSideW).mul(mk(ddy.lessThan(0)));
  const mCeil = float(1).sub(mBack).sub(mSideW).sub(mFloor);
  const org = pW.sub(dpdu.mul(aUv.x)).sub(dpdv.mul(aUv.y));
  const wid = tfloor(org.mul(1.7)).add(0.5);
  const r1 = h31(wid).toVar('cR1'), r2 = h31(wid.add(3.7)).toVar('cR2'), r3 = h31(wid.add(9.1)).toVar('cR3'), r4 = h31(wid.add(5.3)).toVar('cR4');
  const pal = (t, a, b, c, d) => mix(mix(a, b, mk(t.greaterThan(0.25))), mix(c, d, mk(t.greaterThan(0.75))), mk(t.greaterThan(0.5)));
  const wallC = pal(r1, vec3(0.78, 0.68, 0.52), vec3(0.52, 0.6, 0.5), vec3(0.55, 0.6, 0.72), vec3(0.8, 0.58, 0.55)).toVar('cWall');
  const fy = hy.sub(rlo); // height above the room floor
  const plank = tstep(0.5, tfract(hx.mul(3.3))).mul(0.08).add(0.92);
  const floorC = mix(vec3(0.32, 0.2, 0.12).mul(plank), vec3(0.42, 0.38, 0.34), mShop);
  const ceilC = vec3(0.86, 0.84, 0.8);
  // back wall decor: a picture (house) or shelves (shop), a dresser / counter at the bottom
  const bx = hx.div(Ww);
  const pic = tstep(0.28, bx).mul(tstep(bx, 0.72)).mul(tstep(1.25, fy)).mul(tstep(fy, 1.95)).mul(tstep(r2, 0.7));
  const shelf = tstep(0.5, tfract(fy.mul(2.2))).mul(tstep(fy, 2.0)).mul(0.25);
  const dresser = tstep(fy, mix(float(0.8), float(0.95), mShop)).mul(tstep(r3.mul(0.4).add(0.1), bx)).mul(tstep(bx, r3.mul(0.4).add(0.55)));
  const backHouse = mix(wallC, vec3(0.25, 0.32, 0.4).mul(r4.add(0.6)), pic);
  const backShop = wallC.mul(float(0.85).sub(shelf)).add(vec3(0.25, 0.15, 0.1).mul(shelf));
  const backC = mix(mix(backHouse, backShop, mShop), vec3(0.3, 0.19, 0.12), dresser);
  const roomC = backC.mul(mBack).add(wallC.mul(0.82).mul(mSideW)).add(floorC.mul(mFloor)).add(ceilC.mul(mCeil));
  // lamp light: warm, brighter high in the room and near the window; dark rooms keep a dim cool ambient
  const mLit = mk(aE.greaterThan(0.01));
  const depthK = float(1).sub(hz.negate().div(rD).mul(0.45));
  const lampK = mix(float(1), float(0.7), mFloor).mul(depthK).mul(float(0.75).add(fy.div(rhi.sub(rlo)).mul(0.35)));
  const warm = mix(vec3(1.0, 0.62, 0.32), vec3(1.0, 0.82, 0.55), r4);
  const roomL = mix(vec3(0.05, 0.055, 0.07).mul(depthK), warm.mul(lampK).mul(aE.mul(0.6).add(0.4)), mLit);
  // curtains and blinds just behind the glass (house windows)
  const cl = r2.mul(0.22).add(0.06), cr = r3.mul(0.22).add(0.06);
  const curt = tstep(aUv.x, cl).add(tstep(float(1).sub(cr), aUv.x)).mul(tstep(0.25, r4)).mul(mWin);
  const curtC = pal(r3, vec3(0.6, 0.18, 0.15), vec3(0.85, 0.8, 0.68), vec3(0.85, 0.8, 0.68), vec3(0.25, 0.4, 0.32)).mul(tsin(aUv.x.mul(Ww).mul(30)).mul(0.18).add(0.82));
  const blind = tstep(r1.mul(0.5).add(0.5), aUv.y).mul(tstep(0.7, r2)).mul(mWin);
  const blindC = vec3(0.86, 0.82, 0.72).mul(tstep(0.5, tfract(aUv.y.mul(Hh).mul(14))).mul(0.15).add(0.8));
  const front = tclamp(curt.add(blind), 0, 1);
  const frontL = mix(vec3(0.09, 0.09, 0.1), warm.mul(0.55), mLit);
  const inC = mix(roomC.mul(roomL), mix(curtC, blindC, blind).mul(frontL), front);
  // shop fronts: a thin frame round the glass (metres from the edge)
  const sEdge = tmin(tmin(aUv.x.mul(Ww), Ww.sub(aUv.x.mul(Ww))), tmin(aUv.y.mul(Hh), Hh.sub(aUv.y.mul(Hh))));
  const shopFrame = float(1).sub(smoothstep(0.05, 0.07, sEdge)).mul(mShop);
  const glassM = float(1).sub(tint).mul(mWin).add(float(1).sub(shopFrame).mul(mShop)).toVar('cGlassM');
  const NdV = tclamp(tdot(Nw, rd.negate()), 0, 1);
  const transm = float(1).sub(tpow(float(1).sub(NdV), 5).mul(0.96).add(0.04));
  const interior = inC.mul(transm).mul(glassM).mul(mix(float(0.9), float(2.4), hdr)).mul(mWS).toVar('cIn');
  // frame colours: sash = vertex colour (trim), shop frame = dark bronze; the glass itself is near black (reflective)
  base = mix(base, mix(vec3(0.015), vec3(0.06, 0.05, 0.04), shopFrame), mShop);
  base = mix(base, vec3(0.012, 0.014, 0.018), glassM.mul(mWS));
  // plain dark glass (vehicles, the mixer, the towers): v2's gradient
  base = mix(base, mix(vec3(0.02, 0.025, 0.035), vec3(0.05, 0.06, 0.08), smoothstep(0.1, 1.0, aUv.y)), mGlass);
  // ---- far facades (kind 15): a procedural window grid, some lit (v2), with frames
  const fq = aUv.div(vec2(2.7, 3.3)), ff = tfract(fq), fid = tfloor(fq);
  const fwin = tstep(0.3, ff.x).mul(tstep(ff.x, 0.7)).mul(tstep(0.25, ff.y)).mul(tstep(ff.y, 0.85)).mul(tstep(0.5, fq.y)).mul(mFac).toVar('cFwin');
  const fframe = tstep(0.27, ff.x).mul(tstep(ff.x, 0.73)).mul(tstep(0.21, ff.y)).mul(tstep(ff.y, 0.88)).mul(tstep(0.5, fq.y)).mul(mFac).sub(fwin);
  const flit = tstep(0.62, TL.hash21(fid.add(tfloor(lp.xz.mul(0.05)))));
  base = mix(mix(base, vec3(0.85, 0.83, 0.78), fframe), vec3(0.03, 0.035, 0.05), fwin);
  m.colorNode = vec4(base, 1);
  // ---- roughness / metalness / AO
  let rough = tclamp(rgh0.mul(p1.y).add(p1.z), 0.03, 1);
  rough = mix(rough, mix(rough, float(0.58), paintCover), mPaint);
  rough = mix(rough, rough.mul(0.75), patch);
  rough = mix(rough, rough.mul(0.45), wet);
  rough = mix(rough, float(0.04), pud);
  rough = mix(rough, float(0.04), glassM.mul(mWS));
  rough = mix(rough, float(0.12), fwin);
  rough = mix(rough, float(0.3), wetWall.mul(0.6));
  m.roughnessNode = rough;
  m.metalnessNode = mix(tmax(p1.w, p2.x.mul(float(1).sub(tint))), float(0.15), mGlass);
  m.aoNode = mix(float(1), tclamp(ao0, 0, 1), p2.z);
  // ---- normal: the map (flat glass with a faint waviness of old panes)
  const nStr = p1.x.mul(float(1).sub(pud)).mul(mix(float(1), mix(float(1), float(0.45), paintCover), mPaint));
  const nxy = nxy0.mul(nStr);
  const nz = tsqrt(tmax(float(1).sub(tdot(nxy, nxy)), 0.0));
  const wav = vec2(TL.vnoise(aUv.mul(vec2(9, 13)).add(r1.mul(10))), TL.vnoise(aUv.mul(vec2(13, 9)).add(r2.mul(10)))).sub(0.5).mul(0.035);
  const gW = glassM.mul(mWS);
  const nxyF = mix(nxy, wav, gW), nzF = mix(nz, float(1), gW);
  m.normalNode = snorm(Tv.mul(inv).mul(nxyF.x).add(Bv.mul(inv).mul(nxyF.y)).add(Ng.mul(nzF)));
  // ---- emission: interiors, lamp globes, lit glass, the far facades' windows, blinkers
  const hk = mix(float(1), float(2.6), hdr);
  const warmG = mix(vec3(1.0, 0.56, 0.22), vec3(1.0, 0.78, 0.45), TL.hash21(tfloor(lp.xz.mul(0.3)).add(tfloor(lp.y))));
  const bl = tstep(0.45, tfract(uTime.mul(1.4)));
  m.emissiveNode = interior
    .add(vc.mul(aE).mul(hk).mul(isK(KIND.glow)))
    .add(warmG.mul(aE).mul(0.6).mul(hk).mul(mGlass))
    .add(vec3(1.0, 0.62, 0.3).mul(fwin.mul(flit)).mul(mix(float(0.9), float(2.2), hdr)).mul(aE))
    .add(vc.mul(aE).mul(mix(float(0.04), float(1), bl)).mul(hk).mul(isK(31)));
  // screen-space reflections (Ultra / Élevé): puddles, wet patches, glass, vehicle paint
  if (K.post && typeof K.post.ssr === 'function') {
    try { K.post.ssr(m, tmax(tmax(pud.mul(0.85), wet.mul(0.3)), tmax(gW.mul(0.35), isK(30).mul(0.2)))); }
    catch (e) { console.warn('Kit Rush 3D: city SSR opt-in failed', e); }
  }
  m.userData.dbg = { A, A1, A2, N1, uv, uv2, wb, tint, base, interior, glassM, nxy, vc, texC, macro, wet, pud, patch };
  if (opts.position) m.positionNode = opts.position(positionLocal);
  return m;
}

// ===================== geometry builder =====================
// collects vertices (position, normal, colour, kind, uv, emission) and indices; quads take corners counter-clockwise
// as seen from the front (p0 bottom-left, p1 bottom-right, p2 top-right, p3 top-left)
class MB {
  constructor() { this.p = []; this.n = []; this.c = []; this.k = []; this.u = []; this.e = []; this.i = []; this.v = 0; }
  vert(x, y, z, nx, ny, nz, col, kind, u, v, emit) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(col.r, col.g, col.b); this.k.push(kind); this.u.push(u, v); this.e.push(emit || 0);
    return this.v++;
  }
  quad(p0, p1, p2, p3, col, kind, emit, us, vs, u0, v0) {
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    us = us == null ? 1 : us; vs = vs == null ? 1 : vs; u0 = u0 || 0; v0 = v0 || 0;
    const a = this.vert(p0[0], p0[1], p0[2], nx, ny, nz, col, kind, u0, v0, emit);
    this.vert(p1[0], p1[1], p1[2], nx, ny, nz, col, kind, u0 + us, v0, emit);
    this.vert(p2[0], p2[1], p2[2], nx, ny, nz, col, kind, u0 + us, v0 + vs, emit);
    this.vert(p3[0], p3[1], p3[2], nx, ny, nz, col, kind, u0, v0 + vs, emit);
    this.i.push(a, a + 1, a + 2, a, a + 2, a + 3);
  }
  tri(p0, p1, p2, col, kind, emit, uv) {
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const a = this.vert(p0[0], p0[1], p0[2], nx, ny, nz, col, kind, uv ? uv[0] : 0, uv ? uv[1] : 0, emit);
    this.vert(p1[0], p1[1], p1[2], nx, ny, nz, col, kind, uv ? uv[2] : 1, uv ? uv[3] : 0, emit);
    this.vert(p2[0], p2[1], p2[2], nx, ny, nz, col, kind, uv ? uv[4] : 0.5, uv ? uv[5] : 1, emit);
    this.i.push(a, a + 1, a + 2);
  }
  // a THREE template geometry under matrix m (uv taken from the template, scaled)
  geo(g, m, col, kind, emit, us, vs) {
    const pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv, ix = g.index;
    _nm3.getNormalMatrix(m);
    const flip = m.determinant() < 0, o = this.v;
    for (let k = 0; k < pa.count; k++) {
      _gv.fromBufferAttribute(pa, k).applyMatrix4(m);
      _gn.fromBufferAttribute(na, k).applyMatrix3(_nm3).normalize();
      this.vert(_gv.x, _gv.y, _gv.z, _gn.x, _gn.y, _gn.z, col, kind, ua ? ua.getX(k) * (us || 1) : 0, ua ? ua.getY(k) * (vs || 1) : 0, emit);
    }
    if (ix) for (let k = 0; k + 2 < ix.count; k += 3) { const a = ix.getX(k) + o, b = ix.getX(k + 1) + o, c = ix.getX(k + 2) + o; if (flip) this.i.push(a, c, b); else this.i.push(a, b, c); }
    else for (let k = 0; k + 2 < pa.count; k += 3) { if (flip) this.i.push(o + k, o + k + 2, o + k + 1); else this.i.push(o + k, o + k + 1, o + k + 2); }
  }
  get count() { return this.v; }
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
const _gv = new V3(), _gn = new V3(), _nm3 = new THREE.Matrix3();
const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _e4 = new THREE.Euler(), _p4 = new V3(), _s4 = new V3();
function TRS(x, y, z, rx, ry, rz, sx, sy, sz) {
  _e4.set(rx || 0, ry || 0, rz || 0); _q4.setFromEuler(_e4); _p4.set(x, y, z);
  _s4.set(sx == null ? 1 : sx, sy == null ? (sx == null ? 1 : sx) : sy, sz == null ? (sx == null ? 1 : sx) : sz);
  return _m4.compose(_p4, _q4, _s4);
}
// a frame on the ground: origin, unit axis a (along), up, unit axis b (out of the facade). fp() maps (a, y, b) -> local xyz
function frameAt(ox, oy, oz, bx, bz) { const l = Math.hypot(bx, bz) || 1; bx /= l; bz /= l; return { ox, oy, oz, ax: bz, az: -bx, bx, bz }; }
function fp(F, a, y, b) { return [F.ox + F.ax * a + F.bx * b, F.oy + y, F.oz + F.az * a + F.bz * b]; }
// axis-aligned box in frame F: faces bit mask 1 +a, 2 -a, 4 top, 8 bottom, 16 front (+b), 32 back (-b)
function fbox(mb, F, a0, a1, y0, y1, b0, b1, col, kind, emit, faces, colTop) {
  faces = faces == null ? 63 : faces;
  const w = a1 - a0, h = y1 - y0, d = b1 - b0;
  if (faces & 16) mb.quad(fp(F, a0, y0, b1), fp(F, a1, y0, b1), fp(F, a1, y1, b1), fp(F, a0, y1, b1), col, kind, emit, w, h, a0, y0 + F.oy);
  if (faces & 32) mb.quad(fp(F, a1, y0, b0), fp(F, a0, y0, b0), fp(F, a0, y1, b0), fp(F, a1, y1, b0), col, kind, emit, w, h, -a1, y0 + F.oy);
  if (faces & 1) mb.quad(fp(F, a1, y0, b1), fp(F, a1, y0, b0), fp(F, a1, y1, b0), fp(F, a1, y1, b1), col, kind, emit, d, h, -b1, y0 + F.oy);
  if (faces & 2) mb.quad(fp(F, a0, y0, b0), fp(F, a0, y0, b1), fp(F, a0, y1, b1), fp(F, a0, y1, b0), col, kind, emit, d, h, b0, y0 + F.oy);
  if (faces & 4) mb.quad(fp(F, a0, y1, b1), fp(F, a1, y1, b1), fp(F, a1, y1, b0), fp(F, a0, y1, b0), colTop || col, kind, emit, w, d);
  if (faces & 8) mb.quad(fp(F, a0, y0, b0), fp(F, a1, y0, b0), fp(F, a1, y0, b1), fp(F, a0, y0, b1), col, kind, emit, w, d);
}
// world-aligned box (centre, half sizes, yaw)
function wbox(mb, x, y, z, hx, hy, hz, yaw, col, kind, emit, faces) {
  const c = Math.cos(yaw || 0), s = Math.sin(yaw || 0);
  const F = { ox: x, oy: y, oz: z, ax: c, az: -s, bx: s, bz: c };
  fbox(mb, F, -hx, hx, -hy, hy, -hz, hz, col, kind, emit, faces);
}
let TPL = null;
function templates() {
  if (TPL) return TPL;
  TPL = {
    cyl8: new THREE.CylinderGeometry(1, 1, 1, 8, 1),
    cyl12: new THREE.CylinderGeometry(1, 1, 1, 12, 1),
    cyl16: new THREE.CylinderGeometry(1, 1, 1, 16, 1),
    cone8: new THREE.ConeGeometry(1, 1, 8, 1),
    cone12: new THREE.ConeGeometry(1, 1, 12, 1),
    sph8: new THREE.SphereGeometry(1, 10, 7),
    sph12: new THREE.SphereGeometry(1, 14, 10),
    sph6: new THREE.SphereGeometry(1, 7, 5),
    cyl6o: new THREE.CylinderGeometry(1, 1, 1, 6, 1, true),
    ico: new THREE.IcosahedronGeometry(1, 1),
    box: new THREE.BoxGeometry(1, 1, 1),
    tor: new THREE.TorusGeometry(1, 0.1, 6, 20)
  };
  return TPL;
}

// ===================== palette =====================
const PAL = {
  body: ['#eaa3b9', '#a6dcc5', '#bca9dd', '#f3d88b', '#a0c9eb', '#f5b98f', '#abc69d', '#efe3c6', '#eb8f7f', '#7cb7b3', '#5e82b8', '#5f9170', '#a9586c', '#e8c35f', '#d7a1d1', '#f0c9a8', '#c7e0a0'],
  trim: ['#f7f3ea', '#fffaf0', '#f2e9d6'],
  accent: ['#2f4c7a', '#7a2f43', '#2f6b5a', '#c8962e', '#6b3f7a', '#b04a2f', '#3a6f8f', '#8f5a2f'],
  roof: ['#4e525d', '#5c5960', '#6b4b43', '#46494f', '#5a4e58'],
  base: ['#b9b1a4', '#a8a39a', '#c2b8a6', '#9f9890']
};
const COLS = {};
function col(hex) { return COLS[hex] || (COLS[hex] = lin(hex)); }
function pick(arr, r) { return arr[Math.floor(r() * arr.length) % arr.length]; }
const C_DARK = lin('#2b2420'), C_WHITE = lin('#f4f1ea'), C_GREY = lin('#8d8f94');

const FH = 3.35; // storey height
// One painted lady. F: frame on the facade line (oy = raised first floor), w: lot width, yA / yB: sidewalk height at
// a = -w/2 / +w/2 (absolute), opts: {floors, style 'gable'|'flat'|'edw'|'shop', exposedA, exposedB, depth, r: rng, turret}
function house(mb, px, F, w, yA, yB, o) {
  const LOD = mb.lod;
  if (mb.hd) mb = mb.hd;
  const r = o.r, floors = o.floors, style = o.style, depth = o.depth || 13;
  const body = col(o.body || pick(PAL.body, r)), trim = col(o.trim || pick(PAL.trim, r)), acc = col(o.accent || pick(PAL.accent, r)), roof = col(pick(PAL.roof, r)), base = col(pick(PAL.base, r));
  const lit = () => (r() < 0.3 ? 1 : 0);
  const a0 = -w / 2, a1 = w / 2, H = floors * FH;
  const oy = F.oy;
  const lowA = yA - oy, lowB = yB - oy; // (negative) foundation bottoms relative to the floor
  // foundation (stone) with a garage on the low side when there is room
  mb.quad(fp(F, a0, lowA - 0.3, 0.03), fp(F, a1, lowB - 0.3, 0.03), fp(F, a1, 0.05, 0.03), fp(F, a0, 0.05, 0.03), base, KIND.stone, 0, w, 1, a0, 0);
  const lowSide = yA < yB ? -1 : 1, drop = -Math.min(lowA, lowB);
  const doorA = lowSide < 0 ? a1 - 1.5 : a0 + 1.5; // entry on the uphill side
  if (drop > 2.3 && w > 6) {
    const ga = lowSide < 0 ? a0 + 0.6 : a1 - 3.2, gb = ga + 2.6, gy = Math.min(lowA, lowB) + 0.05;
    mb.quad(fp(F, ga, gy, 0.05), fp(F, gb, gy, 0.05), fp(F, gb, gy + 2.15, 0.05), fp(F, ga, gy + 2.15, 0.05), lin('#e9e4da'), KIND.dentil, 0, 2.2, 1);
  }
  // facade: siding with corner boards and a belt course between floors
  const shop = style === 'shop';
  if (shop) {
    // ground floor shop front: big windows under a striped awning, siding above
    mb.quad(fp(F, a0, 0, 0), fp(F, a1, 0, 0), fp(F, a1, FH, 0), fp(F, a0, FH, 0), acc, KIND.plain, 0, w, FH);
    mb.quad(fp(F, a0 + 0.5, 0.5, 0.02), fp(F, a1 - 0.5, 0.5, 0.02), fp(F, a1 - 0.5, FH - 0.5, 0.02), fp(F, a0 + 0.5, FH - 0.5, 0.02), trim, KIND.shop, 1, 1, 1);
    const ac = col(pick(['#c0392b', '#1f7a5c', '#2c5d9e', '#d17a22'], r));
    mb.quad(fp(F, a0 + 0.2, FH - 0.2, 0.05), fp(F, a1 - 0.2, FH - 0.2, 0.05), fp(F, a1 - 0.2, FH - 1.05, 1.3), fp(F, a0 + 0.2, FH - 1.05, 1.3), ac, KIND.awning, 0, w, 1);
    mb.quad(fp(F, a0 + 0.2, FH - 1.05, 1.3), fp(F, a1 - 0.2, FH - 1.05, 1.3), fp(F, a1 - 0.2, FH - 0.2, 0.05), fp(F, a0 + 0.2, FH - 0.2, 0.05), ac, KIND.awning, 0, w, 1);
    mb.quad(fp(F, a0, FH, 0), fp(F, a1, FH, 0), fp(F, a1, H, 0), fp(F, a0, H, 0), body, KIND.siding, 0, w, H - FH, a0, FH);
  } else mb.quad(fp(F, a0, 0, 0), fp(F, a1, 0, 0), fp(F, a1, H, 0), fp(F, a0, H, 0), body, KIND.siding, 0, w, H, a0, 0);
  mb.quad(fp(F, a0, 0, 0.04), fp(F, a0 + 0.2, 0, 0.04), fp(F, a0 + 0.2, H, 0.04), fp(F, a0, H, 0.04), trim, KIND.plain, 0, 1, 1);
  mb.quad(fp(F, a1 - 0.2, 0, 0.04), fp(F, a1, 0, 0.04), fp(F, a1, H, 0.04), fp(F, a1 - 0.2, H, 0.04), trim, KIND.plain, 0, 1, 1);
  for (let f = 1; f < floors; f++) fbox(mb, F, a0, a1, f * FH - 0.12, f * FH + 0.12, 0, 0.12, trim, KIND.plain, 0, 4 | 8 | 16);
  // bay window over the first two storeys on the downhill side
  const bayW = Math.min(3.1, w * 0.42), bayD = 0.8, bayC = (lowSide < 0 ? a0 : a1) - lowSide * (bayW / 2 + 0.55);
  const bayN = shop ? 0 : Math.min(2, floors);
  if (style === 'edw' && w > 9.5) bayWindow(mb, F, a1 - bayW / 2 - 0.55, bayW, bayD, shop ? 1 : 0, floors, body, trim, roof, lit, true);
  if (bayN) bayWindow(mb, F, bayC, bayW, bayD, 0, style === 'edw' ? floors : bayN, body, trim, roof, lit, style !== 'flat');
  // windows and door on the other side
  const wa = shop ? 0 : doorA;
  if (!shop) {
    // stoop + door (with a transom) on the first floor
    const steps = 3, run = 0.24, rise = 0.55 / steps;
    for (let k = 0; k < steps; k++) {
      const y0 = -0.55 + k * rise, b1 = run * (steps - k);
      fbox(mb, F, doorA - 0.85, doorA + 0.85, y0 - 0.02, y0 + rise, 0, b1, lin('#d8d2c6'), KIND.slab, 0, 4 | 16 | 1 | 2);
    }
    mb.quad(fp(F, doorA - 0.75, 0, 0.03), fp(F, doorA + 0.75, 0, 0.03), fp(F, doorA + 0.75, 2.75, 0.03), fp(F, doorA - 0.75, 2.75, 0.03), trim, KIND.plain, 0, 1, 1);
    mb.quad(fp(F, doorA - 0.55, 0, 0.05), fp(F, doorA + 0.55, 0, 0.05), fp(F, doorA + 0.55, 2.2, 0.05), fp(F, doorA - 0.55, 2.2, 0.05), acc, KIND.plain, 0, 1, 1);
    // raised panels below, a glazed panel above, a brass knob
    for (const pa of [-0.27, 0.27]) fbox(mb, F, doorA + pa - 0.19, doorA + pa + 0.19, 0.18, 1.05, 0.05, 0.075, acc, KIND.plain, 0, 1 | 2 | 4 | 8 | 16);
    mb.quad(fp(F, doorA - 0.4, 1.3, 0.06), fp(F, doorA + 0.4, 1.3, 0.06), fp(F, doorA + 0.4, 2.0, 0.06), fp(F, doorA - 0.4, 2.0, 0.06), trim, KIND.window, hash(F.ox * 3.1 + F.oz) < 0.4 ? 1 : 0, 1, 1);
    mb.geo(templates().sph6, TRS(...fp(F, doorA + 0.4, 1.0, 0.1), 0, 0, 0, 0.045, 0.045, 0.045), lin('#d6b25a'), KIND.metal, 0);
    mb.quad(fp(F, doorA - 0.55, 2.28, 0.05), fp(F, doorA + 0.55, 2.28, 0.05), fp(F, doorA + 0.55, 2.62, 0.05), fp(F, doorA - 0.55, 2.62, 0.05), trim, KIND.glass, lit(), 1, 1);
    // pediment over the entry
    fbox(mb, F, doorA - 0.95, doorA + 0.95, 2.78, 2.95, 0, 0.35, trim, KIND.plain, 0, 4 | 8 | 16 | 1 | 2);
  }
  // remaining windows: the free strip between the bay and the edge on each floor
  const free0 = bayN ? (lowSide < 0 ? bayC + bayW / 2 + 0.3 : a0 + 0.35) : a0 + 0.35;
  const free1 = bayN ? (lowSide < 0 ? a1 - 0.35 : bayC - bayW / 2 - 0.3) : a1 - 0.35;
  for (let f = 0; f < floors; f++) {
    if (shop && f === 0) continue;
    const y0 = f * FH + 0.85, y1 = f * FH + 2.75;
    let n = Math.max(1, Math.floor((free1 - free0) / 1.7));
    if (f === 0 && !shop) n = Math.max(0, n - 1); // the door takes one slot
    for (let k = 0; k < n; k++) {
      let c = free0 + ((k + 0.5) * (free1 - free0)) / n;
      if (f === 0 && !shop) { const lo = doorA > (free0 + free1) / 2 ? free0 : doorA + 1.1, hi = doorA > (free0 + free1) / 2 ? doorA - 1.1 : free1; if (hi - lo < 1.3) continue; c = lo + ((k + 0.5) * (hi - lo)) / n; }
      windowAt(mb, F, c, y0, y1, 1.05, trim, lit());
    }
  }
  void wa;
  // crown: gable with fish-scale shingles, flat Italianate false front, or an Edwardian cornice
  if (style === 'gable') {
    const gh = Math.min(4.2, w * 0.5);
    fbox(mb, F, a0 - 0.12, a1 + 0.12, H - 0.05, H + 0.25, 0, 0.32, trim, KIND.plain, 0, 4 | 8 | 16 | 1 | 2);
    mb.quad(fp(F, a0, H - 0.5, 0.06), fp(F, a1, H - 0.5, 0.06), fp(F, a1, H - 0.05, 0.06), fp(F, a0, H - 0.05, 0.06), trim, KIND.dentil, 0, w, 1);
    mb.tri(fp(F, a0 + 0.1, H + 0.25, 0.1), fp(F, a1 - 0.1, H + 0.25, 0.1), fp(F, 0, H + 0.25 + gh, 0.1), acc, KIND.scales, 0, [a0, 0, a1, 0, 0, gh]);
    // attic window
    windowAt(mb, F, 0, H + 0.6, H + 1.9, 0.75, trim, lit(), 0.14);
    // rake boards and roof planes back to the ridge
    const ov = 0.45;
    const A = fp(F, a0 - ov, H + 0.25 - ov * 0.8, 0.5), B = fp(F, 0, H + 0.35 + gh, 0.5), C = fp(F, a1 + ov, H + 0.25 - ov * 0.8, 0.5);
    const A2 = fp(F, a0 - ov, H + 0.25 - ov * 0.8, -depth), B2 = fp(F, 0, H + 0.35 + gh, -depth), C2 = fp(F, a1 + ov, H + 0.25 - ov * 0.8, -depth);
    const sl = Math.hypot(w / 2 + ov, gh + ov * 0.8);
    mb.quad(A2, A, B, B2, roof, KIND.shingle, 0, depth + 0.5, sl, 0, 0);
    mb.quad(C, C2, B2, B, roof, KIND.shingle, 0, depth + 0.5, sl, 0, 0);
    const rb = 0.22;
    mb.quad(A, fp(F, a0 - ov, H + 0.25 - ov * 0.8 + rb, 0.5), fp(F, 0, H + 0.35 + gh + rb, 0.5), B, trim, KIND.plain, 0, 1, 1);
    mb.quad(B, fp(F, 0, H + 0.35 + gh + rb, 0.5), fp(F, a1 + ov, H + 0.25 - ov * 0.8 + rb, 0.5), C, trim, KIND.plain, 0, 1, 1);
    mb.tri(fp(F, a1, H + 0.25, -depth), fp(F, a0, H + 0.25, -depth), fp(F, 0, H + 0.25 + gh, -depth), body, KIND.siding, 0);
    px.push({ F, a0, a1, y0: Math.min(lowA, lowB) - 0.3, y1: H + gh * 0.6, b0: -depth, b1: -0.3 });
  } else {
    const ph = style === 'flat' ? 1.5 : 0.7;
    mb.quad(fp(F, a0, H, 0), fp(F, a1, H, 0), fp(F, a1, H + ph, 0), fp(F, a0, H + ph, 0), body, KIND.siding, 0, w, ph, a0, H);
    const cb = style === 'flat' ? 0.7 : 0.5;
    fbox(mb, F, a0 - 0.15, a1 + 0.15, H + ph - 0.05, H + ph + 0.4, 0, cb, trim, KIND.plain, 0, 4 | 8 | 16 | 1 | 2);
    // scrolled brackets under the cornice (Italianate)
    const nbk = Math.max(2, Math.round(w / 0.95));
    for (let k = 0; k <= nbk; k++) {
      const ca = lerp(a0 + 0.1, a1 - 0.1, k / nbk);
      fbox(mb, F, ca - 0.07, ca + 0.07, H + ph - 0.6, H + ph - 0.05, 0, cb - 0.1, trim, KIND.plain, 0, 1 | 2 | 8 | 16);
      fbox(mb, F, ca - 0.09, ca + 0.09, H + ph - 0.72, H + ph - 0.58, 0, 0.16, trim, KIND.plain, 0, 1 | 2 | 8 | 16);
    }
    mb.quad(fp(F, a0, H + ph - 0.65, 0.05), fp(F, a1, H + ph - 0.65, 0.05), fp(F, a1, H + ph - 0.05, 0.05), fp(F, a0, H + ph - 0.05, 0.05), acc, KIND.dentil, 0, w, 1);
    mb.quad(fp(F, a0, H + ph * 0.4, -depth), fp(F, a1, H + ph * 0.4, -depth), fp(F, a1, H + ph * 0.4, 0), fp(F, a0, H + ph * 0.4, 0), lin('#55534f'), KIND.tar, 0, w, depth);
    px.push({ F, a0, a1, y0: Math.min(lowA, lowB) - 0.3, y1: H + ph, b0: -depth, b1: -0.3 });
  }
  // side walls where the row ends (corner lots, gaps), back wall
  const sideH = H + (style === 'gable' ? 0.25 : style === 'flat' ? 1.5 : 0.7);
  if (o.exposedA) sideWall(mb, F, a0, -1, depth, lowA, sideH, body, trim, lit);
  if (o.exposedB) sideWall(mb, F, a1, 1, depth, lowB, sideH, body, trim, lit);
  mb.quad(fp(F, a1, Math.min(lowA, lowB) - 0.3, -depth), fp(F, a0, Math.min(lowA, lowB) - 0.3, -depth), fp(F, a0, sideH, -depth), fp(F, a1, sideH, -depth), body, KIND.siding, 0, w, sideH, 0, 0);
  if (o.turret) turret(mb, F, lowSide < 0 ? a0 + 0.3 : a1 - 0.3, H, body, trim, roof, lit);
  // a brick chimney on most houses (position from a hash of the lot: the layout's random sequence is untouched)
  {
    const hh = hash(F.ox * 0.731 + F.oz * 1.913);
    if (hh > 0.3) {
      const ca = lerp(a0 + 1.2, a1 - 1.2, hash(hh * 91.7)), cbk = -depth * (0.45 + 0.3 * hash(hh * 17.3));
      const top = H + (style === 'gable' ? Math.min(4.2, w * 0.5) * 0.85 + 1.2 : style === 'flat' ? 2.6 : 1.9);
      const bc = col(pick(['#8f4a3a', '#a4553e', '#7f5a4a'], () => hash(hh * 5.1)));
      fbox(mb, F, ca - 0.42, ca + 0.42, H - 0.5, top, cbk - 0.32, cbk + 0.32, bc, KIND.brick, 0, 1 | 2 | 16 | 32);
      fbox(mb, F, ca - 0.5, ca + 0.5, top, top + 0.16, cbk - 0.4, cbk + 0.4, lin('#5a524c'), KIND.concrete, 0, 63);
      for (const pa of [-0.18, 0.18]) mb.geo(templates().cyl8, TRS(...fp(F, ca + pa, top + 0.36, cbk), 0, 0, 0, 0.09, 0.4, 0.09), lin('#8a5a44'), KIND.plain, 0);
    }
  }
  if (LOD) lodHouse(LOD, F, a0, a1, Math.min(lowA, lowB) - 0.3, H, depth, style, body, trim, roof, acc, w);
}
// the far version of a house: one box with the procedural window grid and its roof
function lodHouse(L, F, a0, a1, lo, H, depth, style, body, trim, roof, acc, w) {
  if (style === 'gable') {
    const gh = Math.min(4.2, w * 0.5), top = H + 0.25;
    fbox(L, F, a0, a1, lo, top, -depth, 0, body, KIND.facade, 1, 1 | 2 | 16);
    L.tri(fp(F, a0, top, 0.05), fp(F, a1, top, 0.05), fp(F, 0, top + gh, 0.05), acc, KIND.scales, 0, [a0, 0, a1, 0, 0, gh]);
    L.quad(fp(F, a0 - 0.3, top - 0.15, -depth), fp(F, a0 - 0.3, top - 0.15, 0.4), fp(F, 0, top + 0.1 + gh, 0.4), fp(F, 0, top + 0.1 + gh, -depth), roof, KIND.shingle, 0, depth, gh);
    L.quad(fp(F, a1 + 0.3, top - 0.15, 0.4), fp(F, a1 + 0.3, top - 0.15, -depth), fp(F, 0, top + 0.1 + gh, -depth), fp(F, 0, top + 0.1 + gh, 0.4), roof, KIND.shingle, 0, depth, gh);
  } else {
    const top = H + (style === 'flat' ? 1.5 : 0.7);
    fbox(L, F, a0, a1, lo, top, -depth, 0, body, KIND.facade, 1, 1 | 2 | 16);
    fbox(L, F, a0 - 0.15, a1 + 0.15, top - 0.05, top + 0.4, -0.3, 0.5, trim, KIND.plain, 0, 4 | 16 | 1 | 2);
    L.quad(fp(F, a0, top, -depth), fp(F, a1, top, -depth), fp(F, a1, top, -0.3), fp(F, a0, top, -0.3), lin('#55534f'), KIND.tar, 0, w, depth);
  }
}
function windowAt(mb, F, c, y0, y1, hw, trim, emit, out) {
  const b = out || 0.03;
  mb.quad(fp(F, c - hw / 2 - 0.16, y0 - 0.12, b - 0.01), fp(F, c + hw / 2 + 0.16, y0 - 0.12, b - 0.01), fp(F, c + hw / 2 + 0.16, y1 + 0.1, b - 0.01), fp(F, c - hw / 2 - 0.16, y1 + 0.1, b - 0.01), trim, KIND.plain, 0, 1, 1);
  mb.quad(fp(F, c - hw / 2, y0, b), fp(F, c + hw / 2, y0, b), fp(F, c + hw / 2, y1, b), fp(F, c - hw / 2, y1, b), trim, KIND.window, emit, 1, 1);
  // hood and sill
  mb.quad(fp(F, c - hw / 2 - 0.3, y1 + 0.1, b + 0.18), fp(F, c + hw / 2 + 0.3, y1 + 0.1, b + 0.18), fp(F, c + hw / 2 + 0.3, y1 + 0.42, b + 0.18), fp(F, c - hw / 2 - 0.3, y1 + 0.42, b + 0.18), trim, KIND.dentil, 0, hw + 0.6, 1);
  fbox(mb, F, c - hw / 2 - 0.3, c + hw / 2 + 0.3, y1 + 0.1, y1 + 0.42, b - 0.01, b + 0.18, trim, KIND.plain, 0, 1 | 2 | 4 | 8);
  fbox(mb, F, c - hw / 2 - 0.36, c + hw / 2 + 0.36, y1 + 0.42, y1 + 0.5, b - 0.01, b + 0.24, trim, KIND.plain, 0, 1 | 2 | 4 | 8 | 16);
  fbox(mb, F, c - hw / 2 - 0.2, c + hw / 2 + 0.2, y0 - 0.2, y0 - 0.1, b - 0.01, b + 0.14, trim, KIND.plain, 0, 1 | 2 | 4 | 8 | 16);
}
// slanted bay: centre face parallel to the facade, two 45° cheeks; windows on every face and storey
function bayWindow(mb, F, c, bw, bd, f0, nf, body, trim, roof, lit, slanted) {
  const fw = slanted ? bw - 2 * bd : bw;
  const pts = slanted
    ? [[c - bw / 2, 0], [c - fw / 2, bd], [c + fw / 2, bd], [c + bw / 2, 0]]
    : [[c - bw / 2, 0], [c - bw / 2, bd], [c + bw / 2, bd], [c + bw / 2, 0]];
  const yb = f0 * FH + 0.15, yt = (f0 + nf) * FH - 0.15;
  for (let e = 0; e < 3; e++) {
    const p = pts[e], q = pts[e + 1], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    mb.quad(fp(F, p[0], yb, p[1]), fp(F, q[0], yb, q[1]), fp(F, q[0], yt, q[1]), fp(F, p[0], yt, p[1]), body, KIND.siding, 0, len, yt - yb, 0, yb + F.oy);
    // the window of each storey, a little proud of the face (offset along the face normal)
    const ux = (q[0] - p[0]) / len, uz = (q[1] - p[1]) / len, nx = -uz * 0.03, nz = ux * 0.03;
    const m = Math.min(0.18, len * 0.1);
    const pa = p[0] + ux * m + nx, pb = p[1] + uz * m + nz, qa = q[0] - ux * m + nx, qb = q[1] - uz * m + nz;
    for (let f = 0; f < nf; f++) {
      const y0 = (f0 + f) * FH + 0.85, y1 = (f0 + f) * FH + 2.75;
      mb.quad(fp(F, pa, y0, pb), fp(F, qa, y0, qb), fp(F, qa, y1, qb), fp(F, pa, y1, pb), trim, KIND.window, lit(), 1, 1);
    }
    // panels between storeys
    for (let f = 1; f < nf; f++) {
      const y = (f0 + f) * FH;
      mb.quad(fp(F, p[0], y - 0.3, p[1] + 0.04), fp(F, q[0], y - 0.3, q[1] + 0.04), fp(F, q[0], y + 0.3, q[1] + 0.04), fp(F, p[0], y + 0.3, p[1] + 0.04), trim, KIND.dentil, 0, len, 1);
    }
  }
  // cap and soffit
  const ov = 0.18;
  const P = pts.map(([a, b]) => [a + (a < c ? -ov : a > c ? ov : 0), b + (b > 0 ? ov : 0)]);
  for (let e = 0; e < 3; e++) {
    const p = P[e], q = P[e + 1];
    mb.quad(fp(F, p[0], yt, p[1]), fp(F, q[0], yt, q[1]), fp(F, q[0], yt + 0.35, q[1]), fp(F, p[0], yt + 0.35, p[1]), trim, KIND.plain, 0, 1, 1);
  }
  mb.quad(fp(F, P[0][0], yt + 0.35, 0), fp(F, P[1][0], yt + 0.35, P[1][1]), fp(F, P[2][0], yt + 0.35, P[2][1]), fp(F, P[3][0], yt + 0.35, 0), roof, KIND.tar, 0, 1, 1);
  mb.quad(fp(F, P[3][0], yb, 0), fp(F, P[2][0], yb, P[2][1]), fp(F, P[1][0], yb, P[1][1]), fp(F, P[0][0], yb, 0), trim, KIND.plain, 0, 1, 1);
  void roof;
}
function sideWall(mb, F, a, sgn, depth, low, top, body, trim, lit) {
  const b0 = -depth, b1 = 0;
  const q = sgn > 0
    ? [fp(F, a, low - 0.3, b1), fp(F, a, low - 0.3, b0), fp(F, a, top, b0), fp(F, a, top, b1)]
    : [fp(F, a, low - 0.3, b0), fp(F, a, low - 0.3, b1), fp(F, a, top, b1), fp(F, a, top, b0)];
  mb.quad(q[0], q[1], q[2], q[3], body, KIND.siding, 0, depth, top - low + 0.3, 0, low - 0.3 + F.oy);
  // a column of windows on the side
  const Fs = { ox: fp(F, a, 0, 0)[0], oy: F.oy, oz: fp(F, a, 0, 0)[2], ax: -F.bx * sgn, az: -F.bz * sgn, bx: F.ax * sgn, bz: F.az * sgn };
  for (let f = 0; f * FH + 2.8 < top; f++) {
    for (const bb of [-3, -8]) if (-bb < depth - 1) windowAt(mb, Fs, -bb * sgn, f * FH + 0.85, f * FH + 2.6, 0.95, trim, lit());
  }
}
function turret(mb, F, a, H, body, trim, roof, lit) {
  const T = templates(), p = fp(F, a, 0, 0.2), rad = 1.5, h = H + 1.2;
  mb.geo(T.cyl12, TRS(p[0], F.oy + FH + h / 2 - FH / 2, p[2], 0, 0, 0, rad, h - FH, rad), body, KIND.siding, 0);
  mb.geo(T.cone12, TRS(p[0], F.oy + H + 1.2 + 1.9, p[2], 0, 0, 0, rad + 0.35, 3.8, rad + 0.35), roof, KIND.shingle, 0, 4, 4);
  mb.geo(T.cyl8, TRS(p[0], F.oy + H + 1.2 + 4.1, p[2], 0, 0, 0, 0.05, 0.9, 0.05), lin('#c9a24a'), KIND.metal, 0);
  // three windows around the street side
  for (const ang of [-0.7, 0, 0.7]) {
    const cx = Math.sin(ang) * (rad + 0.02), cz = Math.cos(ang) * (rad + 0.02);
    const Ft = { ox: p[0] + F.ax * cx + F.bx * cz, oy: F.oy, oz: p[2] + F.az * cx + F.bz * cz, ax: 0, az: 0, bx: 0, bz: 0 };
    const nbx = F.ax * Math.sin(ang) + F.bx * Math.cos(ang), nbz = F.az * Math.sin(ang) + F.bz * Math.cos(ang);
    Ft.bx = nbx; Ft.bz = nbz; Ft.ax = nbz; Ft.az = -nbx;
    for (let f = 1; f * FH < H; f++) {
      mb.quad(fp(Ft, -0.45, f * FH + 0.8, 0.02), fp(Ft, 0.45, f * FH + 0.8, 0.02), fp(Ft, 0.45, f * FH + 2.6, 0.02), fp(Ft, -0.45, f * FH + 2.6, 0.02), trim, KIND.window, lit(), 1, 1);
    }
  }
  fbox(mb, { ox: p[0], oy: F.oy, oz: p[2], ax: F.ax, az: F.az, bx: F.bx, bz: F.bz }, -rad - 0.2, rad + 0.2, H + 1.0, H + 1.3, -rad - 0.2, rad + 0.2, trim, KIND.plain, 0, 4 | 8 | 16 | 1 | 2 | 32);
}
// background building: a box with a procedural facade and a gable or flat roof (used away from the route)
function simpleHouse(mb, px, F, w, depth, h, r, gable, colHex) {
  const body = col(colHex || pick(PAL.body, r)), roof = col(pick(PAL.roof, r)), trim = col(pick(PAL.trim, r));
  fbox(mb, F, -w / 2, w / 2, -3, h, -depth, 0, body, KIND.facade, 1, 1 | 2 | 16 | 32);
  mb.quad(fp(F, -w / 2, h - 0.3, 0.25), fp(F, w / 2, h - 0.3, 0.25), fp(F, w / 2, h + 0.2, 0.25), fp(F, -w / 2, h + 0.2, 0.25), trim, KIND.dentil, 0, w, 1);
  if (gable) {
    const gh = w * 0.42;
    mb.tri(fp(F, -w / 2, h, 0.01), fp(F, w / 2, h, 0.01), fp(F, 0, h + gh, 0.01), body, KIND.plain, 0);
    mb.tri(fp(F, w / 2, h, -depth), fp(F, -w / 2, h, -depth), fp(F, 0, h + gh, -depth), body, KIND.plain, 0);
    const sl = Math.hypot(w / 2, gh);
    mb.quad(fp(F, -w / 2 - 0.3, h - 0.2, -depth), fp(F, -w / 2 - 0.3, h - 0.2, 0.3), fp(F, 0, h + gh, 0.3), fp(F, 0, h + gh, -depth), roof, KIND.shingle, 0, depth, sl);
    mb.quad(fp(F, w / 2 + 0.3, h - 0.2, 0.3), fp(F, w / 2 + 0.3, h - 0.2, -depth), fp(F, 0, h + gh, -depth), fp(F, 0, h + gh, 0.3), roof, KIND.shingle, 0, depth, sl);
    if (px) px.push({ F, a0: -w / 2, a1: w / 2, y0: -3, y1: h + gh * 0.5, b0: -depth, b1: -0.2 });
  } else {
    fbox(mb, F, -w / 2, w / 2, h, h + 0.6, -depth, 0, trim, KIND.plain, 0, 4 | 16 | 1 | 2);
    mb.quad(fp(F, -w / 2, h + 0.62, -depth), fp(F, w / 2, h + 0.62, -depth), fp(F, w / 2, h + 0.62, 0), fp(F, -w / 2, h + 0.62, 0), lin('#57554f'), KIND.tar, 0, w, depth);
    if (px) px.push({ F, a0: -w / 2, a1: w / 2, y0: -3, y1: h + 0.6, b0: -depth, b1: -0.2 });
  }
}
// a row of houses along a straight frontage. line(t) -> {x, z, y} gives the sidewalk point at distance t along the
// frontage (t in [t0, t1]); normal (bx, bz) points to the street. detailed: painted ladies, else simple boxes.
function houseRow(mb, px, t0, t1, line, bx, bz, r, detailed, opts) {
  opts = opts || {};
  let t = t0;
  let first = true;
  while (t1 - t > 5.5) {
    let w = 7 + r() * 2.2;
    const edw = detailed && r() < 0.14 && t1 - t > 13;
    const shop = detailed && opts.shops && r() < 0.35;
    if (edw) w = 10.5 + r() * 3;
    if (t1 - t - w < 5.5) w = t1 - t;
    if (w > 15) w = 15;
    const pa = line(t), pb = line(t + w), pc = line(t + w / 2);
    const yA = pa.y, yB = pb.y;
    const last = t1 - (t + w) < 5.5;
    if (detailed) {
      const F = frameAt(pc.x, Math.max(yA, yB) + 0.55, pc.z, bx, bz);
      const floors = edw ? 3 + (r() < 0.5 ? 1 : 0) : shop ? 3 : r() < 0.55 ? 2 : 3;
      const style = shop ? 'shop' : edw ? 'edw' : r() < 0.55 ? 'gable' : 'flat';
      house(mb, px, F, w, yA, yB, {
        floors, style, r, depth: opts.depth || 13,
        exposedA: first && opts.openA !== false, exposedB: last && opts.openB !== false,
        turret: !shop && (first || last) && r() < 0.35 && floors >= 3
      });
    } else {
      const F = frameAt(pc.x, Math.min(yA, yB), pc.z, bx, bz);
      simpleHouse(mb, px, F, w - 0.1, opts.depth || 12, 6 + Math.floor(r() * 3) * FH * 0.9 + Math.abs(yA - yB), r, r() < 0.55);
    }
    first = false;
    t += w;
  }
}
// shadow proxies: plain boxes merged into one mesh that only draws into the shadow map
function proxyMesh(list) {
  const mb = new MB(), c = C_GREY;
  for (const o of list) fbox(mb, o.F, o.a0, o.a1, o.y0, o.y1, o.b0, o.b1, c, 0, 0, 1 | 2 | 4 | 16 | 32);
  return mb;
}

// ===================== static city: streets =====================
const ASPH = lin('#67666b'), SLAB = lin('#c9c2b4'), CURBC = lin('#b5ada0'), WHITEP = lin('#f2f0e8'), YELLOWP = lin('#f2c230');
const BANKC = lin('#b3ab9e');
const IRON = lin('#2c2f33'), POLE = lin('#1f2a26'), LAMPC = lin('#ffd9a0'), STEEL = lin('#a9adb3'), WOOD = lin('#9a7a58'), CONC = lin('#bdb6aa');
const CHUNK = 150;
const CK = { list: [] };          // chunks along the route: {mb, wires: [], s0}
const PXL = [];                    // shadow proxy boxes
const LAMPS = [];                  // lamp head positions (local) for the glow sprites
const STEAMS = [];                 // steam vents (local)
const PARKED = [];                 // parked vehicles {x, y, z, yaw, pitch, type}
const PALMS = [];                  // palm crowns (animated? static)
const FLAGS = [];                  // flag poles {x, y, z, yaw, w, h, colors}
function chunk(s) { return CK.list[clamp(Math.floor(s / CHUNK), 0, CK.list.length - 1)]; }
const FB = { x: 0, z: 0, dx: 0, dz: -1, rx: 1, rz: 0, y: 0, g: 0, k: 0 };
// route point at (s, d, height above the profile) in local coordinates
function rp(s, d, h) { frame(s, FB); return [FB.x + FB.rx * d, FB.y + (h || 0), FB.z + FB.rz * d]; }
function samples(s0, s1) {
  const out = [s0];
  let s = s0;
  while (s < s1 - 1e-6) {
    let st = 1;
    for (const k of PROF.knots) if (k[2] > 0 && k[2] < 7 && Math.abs(s - k[0]) < k[2] / 2 + 1.2) st = 0.25;
    if (Math.abs(FB.k) > 0 || RT.k[clamp(Math.round(s), 0, RT.n - 1)] !== 0) st = Math.min(st, 1);
    s = Math.min(s1, s + st);
    out.push(s);
  }
  return out;
}
// a ribbon along the route between lateral offsets d0 < d1 at heights h0 / h1 above the profile.
// vertical ribbons (d0 == d1) face +right when face > 0.
function band(mb, ss, d0, d1, h0, h1, c, kind, face) {
  const vert = Math.abs(d1 - d0) < 1e-6;
  let prev = -1;
  for (let j = 0; j < ss.length; j++) {
    const s = ss[j];
    frame(s, FB);
    let nx, ny, nz;
    if (vert) { nx = FB.rx * face; ny = 0; nz = FB.rz * face; }
    else { const g = FB.g, l = Math.hypot(g, 1); nx = -g * FB.dx / l; ny = 1 / l; nz = -g * FB.dz / l; }
    const a = mb.vert(FB.x + FB.rx * d0, FB.y + h0, FB.z + FB.rz * d0, nx, ny, nz, c, kind, vert ? s : d0, vert ? h0 : s, 0);
    mb.vert(FB.x + FB.rx * d1, FB.y + h1, FB.z + FB.rz * d1, nx, ny, nz, c, kind, vert ? s : d1, vert ? h1 : s, 0);
    if (prev >= 0) {
      if (!vert || face < 0) mb.i.push(prev, prev + 1, a + 1, prev, a + 1, a);
      else mb.i.push(prev, a + 1, prev + 1, prev, a, a + 1);
    }
    prev = a;
  }
}
// a surface over the route from d0 to d1 in nd columns whose heights come from surface()
function gridBand(mb, ss, d0, d1, nd, c, kind) {
  let prev = -1;
  const cols = nd + 1;
  for (let j = 0; j < ss.length; j++) {
    const s = ss[j];
    const base = mb.v;
    for (let q = 0; q <= nd; q++) {
      const d = d0 + (d1 - d0) * q / nd;
      frame(s, FB);
      const h = surface(s, d).y, h2 = surface(s, d + 0.1).y, gx = FB.g;
      let nx = -gx * FB.dx - (h2 - h) / 0.1 * FB.rx, ny = 1, nz = -gx * FB.dz - (h2 - h) / 0.1 * FB.rz;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      // the corner bank reads as poured concrete, the flat as asphalt
      const bank = h > 0.04;
      mb.vert(FB.x + FB.rx * d, FB.y + h, FB.z + FB.rz * d, nx, ny, nz, bank ? BANKC : c, bank ? KIND.slab : kind, d, s, 0);
    }
    if (prev >= 0) for (let q = 0; q < nd; q++) { const a = prev + q, b = base + q; mb.i.push(a, a + 1, b + 1, a, b + 1, b); }
    prev = base;
    void cols;
  }
}
function stripe(mb, s0, s1, d0, d1, c, kind, h) {
  const ss = samples(s0, s1);
  band(mb, ss, d0, d1, h || 0.012, h || 0.012, c, kind == null ? KIND.paint : kind, 0);
}
// the asphalt, curbs, sidewalks and markings of the route, run by run
function buildRouteSurface() {
  const n = RT.n;
  let s = 0;
  while (s < RT.len) {
    const z = zoneAt(s + 0.5);
    let e = s + 1;
    while (e < RT.len && zoneAt(e + 0.5) === z && Math.floor(e / CHUNK) === Math.floor(s / CHUNK)) e++;
    e = Math.min(e, RT.len);
    const mb = chunk(s + 0.1).mb;
    const ss = samples(s, e);
    if (z === Z_BLOCK || z === Z_WATER) {
      band(mb, ss, -ROAD, ROAD, 0, 0, ASPH, KIND.asphalt, 0);
      band(mb, ss, ROAD, ROAD, 0, CURB, CURBC, KIND.slab, -1);
      band(mb, ss, -ROAD, -ROAD, 0, CURB, CURBC, KIND.slab, 1);
      band(mb, ss, -WALK - 0.2, -ROAD, CURB, CURB, SLAB, KIND.slab, 0);
      band(mb, ss, ROAD, z === Z_WATER ? 17 : WALK + 0.2, CURB, CURB, SLAB, KIND.slab, 0);
      if (z === Z_BLOCK) { stripe(mb, s, e, -0.32, -0.16, YELLOWP); stripe(mb, s, e, 0.16, 0.32, YELLOWP); }
      else { stripe(mb, s, e, -0.08, 0.08, WHITEP); }
    } else if (z === Z_X) {
      const x = isectAt(s + 0.5) || isectAt(e - 0.5);
      band(mb, ss, -ROAD, ROAD, 0, 0, ASPH, KIND.asphalt, 0);
      // sidewalk and curb only on the corner parts (outside the cross street's roadway)
      const sides = [];
      if (x) { sides.push([s, Math.min(e, x.s - ROAD)], [Math.max(s, x.s + ROAD), e]); } else sides.push([s, e]);
      for (const [a, b] of sides) {
        if (b - a < 0.05) continue;
        const s2 = samples(a, b);
        band(mb, s2, ROAD, ROAD, 0, CURB, CURBC, KIND.slab, -1);
        band(mb, s2, -ROAD, -ROAD, 0, CURB, CURBC, KIND.slab, 1);
        if (!x || x.side >= 0 || true) band(mb, s2, -WALK - 0.2, -ROAD, CURB, CURB, SLAB, KIND.slab, 0);
        band(mb, s2, ROAD, x && x.side < 0 ? 17 : WALK + 0.2, CURB, CURB, SLAB, KIND.slab, 0);
      }
    } else if (z === Z_TURN) {
      gridBand(mb, ss, -16, 16, 32, ASPH, KIND.asphalt);
    } else if (z === Z_PIER) {
      if (s < FEAT.pier0) {
        band(mb, ss, -ROAD, ROAD, 0, 0, ASPH, KIND.asphalt, 0);
        band(mb, ss, -WALK - 0.2, -ROAD, CURB, CURB, SLAB, KIND.slab, 0);
        band(mb, ss, ROAD, 17, CURB, CURB, SLAB, KIND.slab, 0);
        band(mb, ss, ROAD, ROAD, 0, CURB, CURBC, KIND.slab, -1);
        band(mb, ss, -ROAD, -ROAD, 0, CURB, CURBC, KIND.slab, 1);
      } else {
        const ce = FEAT.end - PIER_END_R;
        const s2 = samples(s, Math.min(e, ce));
        if (s2.length > 1) {
          band(mb, s2, -PIER_HALF, PIER_HALF, 0, 0, WOOD, KIND.plank, 0);
          band(mb, s2, PIER_HALF, PIER_HALF, -0.6, 0, lin('#6b5440'), KIND.plank, 1);
          band(mb, s2, -PIER_HALF, -PIER_HALF, -0.6, 0, lin('#6b5440'), KIND.plank, -1);
        }
      }
    }
    s = e;
  }
  void n;
}
// a straight street that is not on the route (cross streets, the dead ends at the corners): road, curbs, sidewalks,
// houses on both sides, lamps. p0: start (local x, z), dir unit, len, y0 at the start, slope (rise per unit).
// The streets are only planned here and built together by buildSideStreets, once their crossings are known.
const SIDE = [];
function sideStreet(p0x, p0z, dx, dz, t0, len, y0, slope, r, opts) {
  SIDE.push({ p0x, p0z, dx, dz, t0, len, y0, slope, opts: opts || {} });
  void r;
}
function buildSideStreets() {
  // two side streets that would cross: the one that does not go through stops behind the other one's houses,
  // graded to meet its level there (no houses standing on a street, no street floating over another)
  for (let j = 1; j < SIDE.length; j++) for (let i = 0; i < j; i++) {
    const A = SIDE[i], B = SIDE[j];
    const den = A.dx * B.dz - A.dz * B.dx;
    if (Math.abs(den) < 0.3) continue;
    const ex = A.p0x - B.p0x, ez = A.p0z - B.p0z;
    const tA = (B.dx * ez - B.dz * ex) / den, tB = (A.dx * ez - A.dz * ex) / den;
    if (tA < -12 || tA > A.len + 30 || tB < -12 || tB > B.len + 30) continue;
    const stubA = tA > A.len - 10 && tB <= B.len - 10;
    const S = stubA ? A : B, W = stubA ? B : A, tS = stubA ? tA : tB, tW = stubA ? tB : tA;
    if (tS - 26 < 30) continue;
    const yW = W.y0 + W.slope * Math.max(0, tW - (W.opts.flat || 0));
    S.len = Math.min(S.len, tS - 26);
    S.slope = clamp((yW - S.y0) / Math.max(1, tS - (S.opts.flat || 0)), -0.25, 0.25);
  }
  const r = rng(1906);
  for (const X of XS) { X.slopeL = X.slopeR = 0; X.reachL = X.reachR = WALLD; }
  for (const st of SIDE) {
    const X = st.opts.xs;
    if (X) { if (st.opts.sd > 0) { X.slopeR = st.slope; X.reachR = XSIDE + st.len; } else { X.slopeL = st.slope; X.reachL = XSIDE + st.len; } }
    buildSideStreet(st.p0x, st.p0z, st.dx, st.dz, st.t0, st.len, st.y0, st.slope, r, st.opts);
  }
}
function buildSideStreet(p0x, p0z, dx, dz, t0, len, y0, slope, r, opts) {
  const rx = -dz, rz = dx;
  const yAt = t => y0 + slope * Math.max(0, t - (opts.flat || 0));
  const mbOf = (x, z) => { const L = locate(x, z); return chunk(L ? L.s : 0).mb; };
  const mb = opts.mb || mbOf(p0x + dx * (t0 + 20), p0z + dz * (t0 + 20));
  const P = (t, d, h) => [p0x + dx * t + rx * d, yAt(t) + (h || 0), p0z + dz * t + rz * d];
  // the land and the background grid make room for it (buildTerrain / buildBackground run after the streets)
  STREETS.push({ x0: p0x, z0: p0z, dx, dz, len, y0, slope, flat: opts.flat || 0 });
  const step = 6;
  for (let t = t0; t < len - 1e-6; t += step) {
    const t2 = Math.min(len, t + step);
    // road (two halves keep the quads planar enough on slopes), curbs, sidewalks
    mb.quad(P(t, -ROAD, 0), P(t, ROAD, 0), P(t2, ROAD, 0), P(t2, -ROAD, 0), ASPH, KIND.asphalt, 0, 16, t2 - t);
    for (const sd of [-1, 1]) {
      const a = sd < 0 ? -WALK - 0.2 : ROAD, b = sd < 0 ? -ROAD : WALK + 0.2;
      mb.quad(P(t, a, CURB), P(t, b, CURB), P(t2, b, CURB), P(t2, a, CURB), SLAB, KIND.slab, 0, 3.5, t2 - t, 0, t);
      const cd = sd * ROAD;
      if (sd > 0) mb.quad(P(t2, cd, 0), P(t, cd, 0), P(t, cd, CURB), P(t2, cd, CURB), CURBC, KIND.slab, 0, 1, 1);
      else mb.quad(P(t, cd, 0), P(t2, cd, 0), P(t2, cd, CURB), P(t, cd, CURB), CURBC, KIND.slab, 0, 1, 1);
    }
    mb.quad(P(t, -0.3, 0.012), P(t, -0.15, 0.012), P(t2, -0.15, 0.012), P(t2, -0.3, 0.012), YELLOWP, KIND.paint, 0, 1, 1);
    mb.quad(P(t, 0.15, 0.012), P(t, 0.3, 0.012), P(t2, 0.3, 0.012), P(t2, 0.15, 0.012), YELLOWP, KIND.paint, 0, 1, 1);
  }
  // houses: the line function returns the sidewalk point at distance t along the street
  const det = opts.detail == null ? 70 : opts.detail;
  for (const sd of [-1, 1]) {
    if (opts.noSide === sd) continue;
    const off = sd * WALK;
    const line = t => ({ x: p0x + dx * t + rx * off, z: p0z + dz * t + rz * off, y: yAt(t) + CURB });
    const bx = -rx * sd, bz = -rz * sd;
    const h0 = opts.houseStart != null ? opts.houseStart : t0 + 13;
    // rows read left to right as seen from the street: on the right side the frontage runs back toward the start
    const ta = h0, tb = Math.min(len, h0 + det);
    const flip = (u0, u1) => (sd > 0 ? t => line(u0 + u1 - t) : line);
    houseRow(mb, PXL, ta, tb, flip(ta, tb), bx, bz, r, true, { openA: true, openB: true });
    if (len > tb + 6) houseRow(mb, PXL, tb, len, flip(tb, len), bx, bz, r, false);
    // lamps
    for (let t = t0 + 14; t < Math.min(len, t0 + 90); t += 32) lamp(mb, P(t, sd * (ROAD + 0.9), CURB), sd, rx, rz);
  }
}
// street lamp: dark post, curved arm over the road, lantern with a warm globe
// street lamp (visual only, no collider): octagonal plinth, fluted column, collar, slim upper pole, a curved arm with
// a scroll brace, an acorn lantern (cap, finial, warm glass globe that blooms, bottom collar) over the curb
function lamp(mb, p, side, rx, rz) {
  if (mb.hd) mb = mb.hd; // a detail: drawn near the camera only
  const T = templates();
  const x = p[0], y = p[1], z = p[2];
  mb.geo(T.cyl8, TRS(x, y + 0.22, z, 0, 0, 0, 0.24, 0.44, 0.24), POLE, KIND.metal, 0);
  mb.geo(T.cyl8, TRS(x, y + 0.47, z, 0, 0, 0, 0.19, 0.08, 0.19), POLE, KIND.metal, 0);
  mb.geo(LAMP_TPL.col, TRS(x, y + 1.15, z, 0, 0, 0, 1, 1.3, 1), POLE, KIND.metal, 0);
  mb.geo(T.cyl8, TRS(x, y + 1.84, z, 0, 0, 0, 0.15, 0.09, 0.15), POLE, KIND.metal, 0);
  mb.geo(T.cyl8, TRS(x, y + 3.6, z, 0, 0, 0, 0.075, 3.5, 0.075), POLE, KIND.metal, 0);
  mb.geo(T.sph6, TRS(x, y + 5.42, z, 0, 0, 0, 0.11, 0.11, 0.11), POLE, KIND.metal, 0);
  // the arm: rises then droops toward the street (three segments), a brace below
  const ux = -rx * side, uz = -rz * side, yaw = Math.atan2(ux, uz);
  const P = (d, h) => [x + ux * d, y + h, z + uz * d];
  const seg = (a, b, w) => {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, mz = (a[2] + b[2]) / 2, L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _q4.setFromUnitVectors(_gv.set(0, 1, 0), _gn.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize());
    _m4.compose(_p4.set(mx, my, mz), _q4, _s4.set(w, L + 0.02, w));
    mb.geo(T.cyl6o, _m4, POLE, KIND.metal, 0);
  };
  const a0 = P(0, 5.3), a1 = P(0.45, 5.52), a2 = P(1.0, 5.55), a3 = P(1.32, 5.4);
  seg(a0, a1, 0.05); seg(a1, a2, 0.045); seg(a2, a3, 0.04);
  seg(P(0, 4.75), P(0.5, 5.45), 0.025);
  mb.geo(T.tor, TRS(x + ux * 0.32, y + 5.08, z + uz * 0.32, 0, Math.atan2(-uz, ux), 0, 0.16, 0.16, 0.16), POLE, KIND.metal, 0);
  void yaw;
  // the lantern
  const hx = a3[0], hz = a3[2], hy = y + 5.12;
  mb.geo(T.cone8, TRS(hx, hy + 0.36, hz, 0, 0, 0, 0.3, 0.24, 0.3), POLE, KIND.metal, 0);
  mb.geo(T.cyl8, TRS(hx, hy + 0.22, hz, 0, 0, 0, 0.3, 0.05, 0.3), POLE, KIND.metal, 0);
  mb.geo(T.sph6, TRS(hx, hy + 0.53, hz, 0, 0, 0, 0.05, 0.08, 0.05), POLE, KIND.metal, 0);
  mb.geo(T.sph8, TRS(hx, hy, hz, 0, 0, 0, 0.22, 0.27, 0.22), LAMPC, KIND.glow, 1.6);
  mb.geo(T.cyl8, TRS(hx, hy - 0.26, hz, 0, 0, 0, 0.08, 0.08, 0.08), POLE, KIND.metal, 0);
  LAMPS.push([hx, hy - 0.02, hz]);
  PXL.push({ F: { ox: x, oy: y, oz: z, ax: 1, az: 0, bx: 0, bz: 1 }, a0: -0.08, a1: 0.08, y0: 0, y1: 5.5, b0: -0.08, b1: 0.08 });
}
// a fluted column (8 flutes): r 0.14 at the bottom -> 0.1 at the top, unit height, centred
const LAMP_TPL = { get col() {
  if (this._c) return this._c;
  const g = new THREE.CylinderGeometry(0.1, 0.14, 1, 16, 1, true), pa = g.attributes.position;
  for (let k = 0; k < pa.count; k++) { const x = pa.getX(k), z = pa.getZ(k), a = Math.atan2(z, x), f = 1 - 0.12 * Math.max(0, Math.cos(a * 8)); pa.setX(k, x * f); pa.setZ(k, z * f); }
  g.computeVertexNormals();
  return (this._c = g);
} };
function hydrant(mb, p) {
  if (mb.hd) mb = mb.hd; // a detail: drawn near the camera only
  const T = templates(), c = lin('#f2e7cf'), cap = lin('#e0b33a');
  mb.geo(T.cyl8, TRS(p[0], p[1] + 0.35, p[2], 0, 0, 0, 0.17, 0.7, 0.17), c, KIND.plain, 0);
  mb.geo(T.sph6, TRS(p[0], p[1] + 0.72, p[2], 0, 0, 0, 0.18, 0.14, 0.18), cap, KIND.metal, 0);
  mb.geo(T.cyl8, TRS(p[0], p[1] + 0.48, p[2], 0, 0, Math.PI / 2, 0.07, 0.5, 0.07), cap, KIND.metal, 0);
}
// ---- foliage: trees and palms are alpha-tested cards + bark on the city_foliage atlas, in one mesh per chunk (drawn
// near the camera, with the detailed houses) that casts its own dappled shadows. aEmit = atlas tile (0 broadleaf
// cluster, 1 palm frond, 2 bark, 3 needles), aUv = uv in the tile (bark: repeating), normals bent round the crown
const FOL_FAR = { mb: null };
const FT = { name: 'city/city_foliage', ph: null, tex: null, nodes: [] };
function folOf(mb) { return mb.fol || (mb.hd && mb.hd.fol) || FOL_FAR.mb; }
const _fa = new V3(), _fb = new V3(), _fn = new V3(), _fo = new V3(), _fc = new V3();
// one card: centre c, half size s, plane normal n (unit), spin, crown centre o (normals), colour, tile
function folCard(fb, cx, cy, cz, s, nx, ny, nz, spin, ox, oy, oz, col, tile) {
  _fn.set(nx, ny, nz).normalize();
  _fa.set(0, 1, 0); if (Math.abs(_fn.y) > 0.9) _fa.set(1, 0, 0);
  _fa.cross(_fn).normalize(); _fb.copy(_fn).cross(_fa);
  const c = Math.cos(spin), sn = Math.sin(spin);
  const ax = (_fa.x * c + _fb.x * sn) * s, ay = (_fa.y * c + _fb.y * sn) * s, az = (_fa.z * c + _fb.z * sn) * s;
  const bx = (_fb.x * c - _fa.x * sn) * s, by = (_fb.y * c - _fa.y * sn) * s, bz = (_fb.z * c - _fa.z * sn) * s;
  const P = [[cx - ax - bx, cy - ay - by, cz - az - bz, 0, 0], [cx + ax - bx, cy + ay - by, cz + az - bz, 1, 0], [cx + ax + bx, cy + ay + by, cz + az + bz, 1, 1], [cx - ax + bx, cy - ay + by, cz - az + bz, 0, 1]];
  const v0 = fb.v;
  for (const q of P) {
    // crown normal (soft, round shading) with a little of the card's own facing
    _fo.set(q[0] - ox, q[1] - oy, q[2] - oz).normalize().multiplyScalar(0.8).addScaledVector(_fn, 0.2).normalize();
    fb.vert(q[0], q[1], q[2], _fo.x, _fo.y, _fo.z, col, KIND.leaf, q[3], q[4], tile);
  }
  fb.i.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
}
// a crown: n cards on a sphere of radius rad round (x, y, z), squashed vertically by sy
function folCrown(fb, x, y, z, rad, sy, n, size, col, tile, r) {
  for (let k = 0; k < n; k++) {
    const u = r() * 2 - 1, a = r() * TAU, rr = Math.sqrt(1 - u * u);
    const nx = rr * Math.cos(a), ny = u, nz = rr * Math.sin(a);
    const d = rad * (0.55 + 0.45 * Math.sqrt(r()));
    folCard(fb, x + nx * d, y + ny * d * sy, z + nz * d, size * (0.8 + r() * 0.45), nx + (r() - 0.5) * 0.9, ny + (r() - 0.5) * 0.9, nz + (r() - 0.5) * 0.9, r() * TAU, x, y, z, col, tile);
  }
}
// a tapered trunk / branch from p to q (radii r0 -> r1), bark tile, u round, v in metres / 1.2
function folLimb(fb, p, q, r0, r1, col, sides) {
  sides = sides || 6;
  _fc.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  const len = _fc.length(); _fc.normalize();
  _fa.set(0, 0, 1); if (Math.abs(_fc.z) > 0.9) _fa.set(1, 0, 0);
  _fa.cross(_fc).normalize(); _fb.copy(_fc).cross(_fa);
  const v0 = fb.v;
  for (let e = 0; e < 2; e++) {
    const o = e ? q : p, rr = e ? r1 : r0;
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const nx = _fa.x * ca + _fb.x * sa, ny = _fa.y * ca + _fb.y * sa, nz = _fa.z * ca + _fb.z * sa;
      fb.vert(o[0] + nx * rr, o[1] + ny * rr, o[2] + nz * rr, nx, ny, nz, col, KIND.leaf, k / sides, e * len / 1.2, 2);
    }
  }
  for (let k = 0; k < sides; k++) { const a = v0 + k, b = v0 + sides + 1 + k; fb.i.push(a, a + 1, b + 1, a, b + 1, b); }
}
const LEAF_COLS = ['#5f8a43', '#6f9a48', '#4f7d3d', '#7f9c45', '#8aa64c', '#5c8a52'];
// The city is laid out with ONE random sequence (houses, parked cars = colliders, hazards...): a visual builder must
// draw exactly as many numbers from it as v2's did, and takes its own randomness from a local generator seeded by them.
function burn(r, n) { let a = 0; for (let i = 0; i < n; i++) a = (a * 7.31 + r()) % 1; return rng(1 + Math.floor(a * 4294967000)); }
const BARK = lin('#6e5a48');
function tree(mb, p, r0, big) {
  const r = burn(r0, 19); // v2: pick + 3 blobs x 6
  const fb = folOf(mb);
  if (!fb) return;
  const s = (big ? 1.35 : 1) * (0.9 + r() * 0.25);
  const g = col(pick(LEAF_COLS, r));
  const x = p[0], y = p[1], z = p[2];
  const top = [x + (r() - 0.5) * 0.3, y + 2.6 * s, z + (r() - 0.5) * 0.3];
  folLimb(fb, [x, y - 0.1, z], top, 0.16 * s, 0.1 * s, BARK, 6);
  const n = big ? 5 : 4;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + r() * 0.8, d = (0.8 + r() * 0.5) * s;
    const cx = x + Math.cos(a) * d, cz = z + Math.sin(a) * d, cy = y + (3.3 + r() * 1.2) * s;
    folLimb(fb, top, [cx * 0.7 + x * 0.3, cy - 0.4 * s, cz * 0.7 + z * 0.3], 0.08 * s, 0.035 * s, BARK, 4);
    folCrown(fb, cx, cy, cz, (1.05 + r() * 0.35) * s, 0.8, 11, 0.85 * s, g, 0, r);
  }
  folCrown(fb, x, y + 4.5 * s, z, 1.2 * s, 0.75, 12, 0.9 * s, g, 0, r);
}
// a cypress / pine for the wooded hill (needle clusters stacked in a cone)
function conifer(fb, x, y, z, h, r) {
  const g = col(pick(['#3b5a34', '#43603a', '#35523a', '#4a6a3c'], r));
  folLimb(fb, [x, y - 0.5, z], [x, y + h * 0.9, z], 0.35, 0.1, BARK, 5);
  const n = 5;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1), rad = h * (0.32 - 0.22 * t);
    folCrown(fb, x, y + h * (0.3 + 0.6 * t), z, rad, 0.7, 7, h * (0.2 - 0.08 * t), g, 3, r);
  }
}
function palm(mb, p, r0) {
  const r = burn(r0, 29); // v2: height, lean, 9 fronds x 3
  const fb = folOf(mb);
  if (!fb) return;
  const h = 8 + r() * 3, lean = (r() - 0.5) * 0.25, la = r() * TAU;
  const lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
  // a slightly curved, ringed trunk in five pieces
  let prev = [p[0], p[1] - 0.2, p[2]];
  for (let k = 1; k <= 5; k++) {
    const t = k / 5, bend = t * t;
    const q = [p[0] + lx * h * bend, p[1] + h * t, p[2] + lz * h * bend];
    folLimb(fb, prev, q, lerp(0.3, 0.21, (k - 1) / 5), lerp(0.3, 0.21, k / 5), lin('#8a7660'), 7);
    prev = q;
  }
  const top = prev, g = col(pick(['#5f8c3c', '#6a9640', '#57823a'], r));
  // fronds: drooping strips (3 segments), the frond tile along their length
  const nf = 11;
  for (let k = 0; k < nf; k++) {
    const a = k * TAU / nf + r() * 0.3, len = 3.6 + r() * 0.9, up = 0.55 - r() * 0.35, w = 0.75;
    const dx = Math.cos(a), dz = Math.sin(a), wx = -dz * w, wz = dx * w;
    const pts = [];
    for (let j = 0; j <= 3; j++) {
      const t = j / 3, el = up - t * t * 1.6;
      pts.push([top[0] + dx * len * t, top[1] + 0.2 + len * t * el * 0.55, top[2] + dz * len * t]);
    }
    const v0 = fb.v;
    for (let j = 0; j <= 3; j++) {
      const q = pts[j], t = j / 3, ww = 1 - t * 0.15;
      _fo.set(dx * 0.3, 1, dz * 0.3).normalize();
      fb.vert(q[0] - wx * ww, q[1] - 0.12 * t, q[2] - wz * ww, _fo.x, _fo.y, _fo.z, g, KIND.leaf, t, 0, 1);
      fb.vert(q[0] + wx * ww, q[1] - 0.12 * t, q[2] + wz * ww, _fo.x, _fo.y, _fo.z, g, KIND.leaf, t, 1, 1);
    }
    for (let j = 0; j < 3; j++) { const a0 = v0 + j * 2; fb.i.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2); }
  }
  // the crown's knot of young fronds and dates
  folCrown(fb, top[0], top[1] - 0.2, top[2], 0.45, 1, 5, 0.45, lin('#7a6a3a'), 3, r);
}
function foliageMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.72, metalness: 0 });
  const aUv = attribute('aUv', 'vec2'), aT = attribute('aEmit', 'float'), vc = attribute('color', 'vec3');
  const t = tfloor(aT.add(0.5));
  const bark = select(t.equal(2), float(1), float(0));
  const off = vec2(tfract(t.mul(0.5)).mul(2), tfloor(t.mul(0.5))).mul(0.5);
  const luv = mix(tclamp(aUv, 0.004, 0.996), vec2(tfract(aUv.x), tclamp(tfract(aUv.y), 0.004, 0.996)), bark);
  // a 1x1 placeholder until K.tex has the atlas (swapped in by cityTexSync: no 1x1 upload of the real texture)
  if (!FT.ph) { FT.ph = new THREE.DataTexture(new Uint8Array([120, 140, 100, 255]), 1, 1); FT.ph.colorSpace = THREE.SRGBColorSpace; FT.ph.needsUpdate = true; }
  const txn = ttexture(FT.tex || FT.ph, off.add(luv.mul(0.5)));
  FT.nodes.push(txn);
  const tx = txn.toVar('fTx');
  const leaf = float(1).sub(bark);
  // per-plant tint (the texture is authored grey-green), darker inside the crown (normal pointing down / inwards)
  const albedo = tx.xyz.mul(vc).mul(mix(float(2.0), float(2.6), leaf));
  m.colorNode = vec4(albedo, tx.w);
  m.alphaTest = 0.5;
  m.maskShadowNode = tx.w.greaterThan(0.5);
  m.normalNode = normalViewGeometry;
  m.roughnessNode = mix(float(0.85), float(0.62), leaf);
  // translucency: leaves between the camera and the low sun glow (golden-hour backlight)
  const rdir = tnormalize(positionWorld.sub(cameraPosition));
  const back = tpow(tmax(tdot(rdir, SKY_UNI.uSun), 0), 4).mul(leaf);
  m.emissiveNode = albedo.mul(vec3(1.0, 0.8, 0.45)).mul(back).mul(mix(float(0.35), float(0.9), U.hdr));
  // a breeze in the crowns (shadows follow: the shadow pass uses the same position node)
  const pl = positionLocal;
  const sw = tsin(U.time.mul(1.3).add(pl.x.mul(0.21)).add(pl.z.mul(0.17))).mul(0.05).add(tsin(U.time.mul(2.7).add(pl.y.mul(0.9))).mul(0.02));
  m.positionNode = pl.add(vec3(sw, 0, sw.mul(0.7)).mul(leaf));
  return m;
}
function bench(mb, p, yaw) {
  if (mb.hd) mb = mb.hd; // a detail: drawn near the camera only
  wbox(mb, p[0], p[1] + 0.45, p[2], 0.9, 0.05, 0.25, yaw, WOOD, KIND.plank, 0);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  wbox(mb, p[0] - s * 0.25, p[1] + 0.75, p[2] - c * 0.25, 0.9, 0.22, 0.04, yaw, WOOD, KIND.plank, 0);
  for (const k of [-0.75, 0.75]) wbox(mb, p[0] + c * k, p[1] + 0.22, p[2] - s * k, 0.05, 0.22, 0.22, yaw, IRON, KIND.metal, 0);
}
// sawhorse barrier with orange / white boards and a blinking lamp
function barrier(mb, p, yaw, w) {
  if (mb.hd) mb = mb.hd; // a detail: drawn near the camera only
  w = w || 1.2;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const h of [0.55, 0.95]) wbox(mb, p[0], p[1] + h, p[2], w, 0.11, 0.03, yaw, lin('#ff7a1a'), KIND.awning, 0);
  for (const k of [-w + 0.1, w - 0.1]) wbox(mb, p[0] + c * k, p[1] + 0.5, p[2] - s * k, 0.05, 0.5, 0.25, yaw, lin('#d9d2c4'), KIND.plain, 0);
  const T = templates();
  mb.geo(T.sph8, TRS(p[0] + c * (w - 0.1), p[1] + 1.18, p[2] - s * (w - 0.1), 0, 0, 0, 0.09, 0.09, 0.09), lin('#ffb020'), KIND.glow, 2.2);
}
function cone(mb, p) {
  if (mb.hd) mb = mb.hd; // a detail: drawn near the camera only
  const T = templates();
  mb.geo(T.cone8, TRS(p[0], p[1] + 0.36, p[2], 0, 0, 0, 0.2, 0.72, 0.2), lin('#ff6a10'), KIND.plain, 0);
  mb.geo(T.cyl8, TRS(p[0], p[1] + 0.42, p[2], 0, 0, 0, 0.14, 0.12, 0.14), lin('#f5f5f0'), KIND.plain, 0);
  mb.geo(T.box, TRS(p[0], p[1] + 0.02, p[2], 0, 0, 0, 0.5, 0.04, 0.5), lin('#222222'), KIND.plain, 0);
}
function stopSign(mb, p, yaw) {
  if (mb.hd) mb = mb.hd; // a detail: drawn near the camera only
  const T = templates();
  mb.geo(T.cyl8, TRS(p[0], p[1] + 1.2, p[2], 0, 0, 0, 0.04, 2.4, 0.04), STEEL, KIND.metal, 0);
  mb.geo(new THREE.CylinderGeometry(0.38, 0.38, 0.03, 8), TRS(p[0], p[1] + 2.35, p[2], Math.PI / 2, yaw, Math.PI / 8), lin('#c8102e'), KIND.plain, 0);
}
function manhole(mb, p, s) {
  const T = templates();
  mb.geo(T.cyl12, TRS(p[0], p[1] + 0.008, p[2], 0, 0, 0, 0.42, 0.02, 0.42), IRON, KIND.manhole, 0);
  void s;
}

// ===================== the route's buildings, crossings, corners =====================
function blockRanges() {
  // street blocks between consecutive crossings / corners: [s0, s1] of the free frontage
  const stops = [];
  for (const x of XS) stops.push([x.s - XHALF - 0.5, x.s + XHALF + 0.5, 'x', x]);
  for (const t of TURNS) stops.push([t.s0 - XHALF + 1.5, t.s1 + XHALF - 1.5, 't', t]);
  stops.push([FEAT.t3b + 1, FEAT.t3b + 1, 'w', null]);
  stops.sort((a, b) => a[0] - b[0]);
  const out = [];
  let s = -40;
  for (const st of stops) { if (st[0] > s + 6) out.push([Math.max(s, 0), st[0]]); s = Math.max(s, st[1]); }
  return out.filter(b => b[1] <= FEAT.t3b + 2);
}
function buildRouteHouses(r) {
  const blocks = blockRanges();
  for (const [s0, s1] of blocks) {
    for (const sd of [-1, 1]) {
      // the start plaza: a little park on the left (the view over the bay); turn insides stay open
      let a = s0, b = s1;
      if (sd < 0 && a < FEAT.iA0 + 40 && b > FEAT.iA0) { a = Math.max(a, FEAT.iA0 + 75); }
      if (b - a < 6) continue;
      const off = sd * WALK;
      const bx = sd < 0 ? FB.rx : -FB.rx; void bx;
      const mb = chunk((a + b) / 2).mb;
      // the frontage runs with s on the left side and against s on the right (rows read left to right)
      if (sd < 0) {
        const line = t => { const p = rp(t, off, 0); return { x: p[0], z: p[2], y: p[1] + CURB }; };
        frame((a + b) / 2, FB);
        houseRow(chunk(a + 5).mb, PXL, a, b, line, FB.rx, FB.rz, r, true, { shops: true });
      } else {
        const line = t => { const p = rp(a + b - t, off, 0); return { x: p[0], z: p[2], y: p[1] + CURB }; };
        frame((a + b) / 2, FB);
        houseRow(chunk(b - 5).mb, PXL, a, b, line, -FB.rx, -FB.rz, r, true, { shops: true });
      }
      void mb;
    }
  }
}
// cross streets at every crossing (both sides unless a T junction), crossing paint, stop signs
function buildCrossings(r) {
  for (const x of XS) {
    frame(x.s, FB);
    const cx = FB.x, cz = FB.z, y = FB.y, dx = FB.dx, dz = FB.dz, rx = FB.rx, rz = FB.rz;
    const mb = chunk(x.s).mb;
    for (const sd of [-1, 1]) {
      if (x.side && sd !== x.side) continue;
      // plateau of the crossing out to XSIDE, then the cross street with the hill's slope
      const P = (d, o, h) => [cx + rx * d + dx * o, y + (h || 0), cz + rz * d + dz * o];
      const dA = sd * ROAD, dB = sd * XSIDE;
      const q = sd > 0 ? [P(dA, ROAD), P(dB, ROAD), P(dB, -ROAD), P(dA, -ROAD)] : [P(dB, ROAD), P(dA, ROAD), P(dA, -ROAD), P(dB, -ROAD)];
      mb.quad(q[3], q[2], q[1], q[0], ASPH, KIND.asphalt, 0, 22, 16);
      // corner sidewalks along the plateau
      for (const so of [-1, 1]) {
        const o0 = so * ROAD, o1 = so * (WALK + 0.2);
        const a = so > 0 ? [P(dA, o0, CURB), P(dB, o0, CURB), P(dB, o1, CURB), P(dA, o1, CURB)] : [P(dA, o1, CURB), P(dB, o1, CURB), P(dB, o0, CURB), P(dA, o0, CURB)];
        if (sd > 0) mb.quad(a[0], a[1], a[2], a[3], SLAB, KIND.slab, 0, 22, 3.5); else mb.quad(a[1], a[0], a[3], a[2], SLAB, KIND.slab, 0, 22, 3.5);
        const c0 = P(dA, o0, 0), c1 = P(dB, o0, 0), c2 = P(dB, o0, CURB), c3 = P(dA, o0, CURB);
        if ((so > 0) === (sd > 0)) mb.quad(c1, c0, c3, c2, CURBC, KIND.slab, 0, 1, 1); else mb.quad(c0, c1, c2, c3, CURBC, KIND.slab, 0, 1, 1);
      }
      // the cross street beyond the plateau
      const far = [cx + rx * sd * 260, cz + rz * sd * 260];
      const yf = cityH(far[0], far[1]);
      const slope = clamp((yf - y) / 230, -0.16, 0.16);
      sideStreet(cx + rx * sd * XSIDE, cz + rz * sd * XSIDE, rx * sd, rz * sd, 0, 230, y, slope, r, { detail: 80, houseStart: WALK + 13 - XSIDE, flat: 0, mb, xs: x, sd });
      // stop line and stop sign for the cross traffic
      const sl = [P(sd * (WALK + 1.2), -ROAD, 0.013), P(sd * (WALK + 1.5), -ROAD, 0.013), P(sd * (WALK + 1.5), 0, 0.013), P(sd * (WALK + 1.2), 0, 0.013)];
      if (sd > 0) mb.quad(sl[0], sl[1], sl[2], sl[3], WHITEP, KIND.paint, 0, 1, 1); else mb.quad(sl[1], sl[0], sl[3], sl[2], WHITEP, KIND.paint, 0, 1, 1);
      stopSign(mb, P(sd * (WALK + 0.8), -ROAD - 0.9, CURB), Math.atan2(rx * sd, rz * sd));
      // zebra across the cross street (pedestrians on the main street's sidewalks)
      for (let k = -7; k <= 7; k += 1.4) {
        const zq = [P(sd * 8.4, k - 0.4, 0.013), P(sd * 11.2, k - 0.4, 0.013), P(sd * 11.2, k + 0.4, 0.013), P(sd * 8.4, k + 0.4, 0.013)];
        if (sd > 0) mb.quad(zq[3], zq[2], zq[1], zq[0], WHITEP, KIND.paint, 0, 1, 1); else mb.quad(zq[2], zq[3], zq[0], zq[1], WHITEP, KIND.paint, 0, 1, 1);
      }
      hydrant(mb, P(sd * (ROAD + 0.7), -WALK + 1.2, CURB));
    }
    // zebras across the main street on both sides of the crossing
    for (const so of [-1, 1]) {
      const o0 = so * 8.5, o1 = so * 11.1;
      for (let k = -7; k <= 7; k += 1.4) stripe(mb, Math.min(x.s + o0, x.s + o1), Math.max(x.s + o0, x.s + o1), k - 0.4, k + 0.4, WHITEP);
    }
    // lamps at the four corners
    for (const so of [-1, 1]) for (const sd of [-1, 1]) {
      if (x.side && sd !== x.side && so > 0) continue;
      lamp(mb, rp(x.s + so * (ROAD + 1.0), sd * (ROAD + 0.9), CURB), sd, rx, rz);
    }
  }
}
// corners: dead-end continuations behind barriers, the bank on the outside, a small park on the inside
function buildCorners(r) {
  for (let q = 0; q < TURNS.length; q++) {
    const t = TURNS[q], a = RT.arcs[q];
    const kx = t.kx, kz = t.kz;
    const ky = profY(t.sc);
    const mb = chunk(t.sc).mb;
    // the street ahead continues (blocked) and the street behind the outgoing one
    for (const [dx, dz, ahead] of [[a.ix, a.iz, true], [-a.ox, -a.oz, false]]) {
      const far = [kx + dx * 200, kz + dz * 200];
      const slope = clamp((cityH(far[0], far[1]) - ky) / 180, -0.16, 0.16);
      if (q === 2 && ahead) continue; // T3: ahead is the bay
      sideStreet(kx + dx * 16, kz + dz * 16, dx, dz, 0, 200, ky, slope, r, { detail: 80, houseStart: 20, mb });
      // barriers across the blocked street
      const rx = -dz, rz = dx;
      for (let k = -6.6; k <= 6.6; k += 2.6) barrier(mb, [kx + dx * 16.5 + rx * k, ky, kz + dz * 16.5 + rz * k], Math.atan2(dx, dz) + Math.PI / 2, 1.2);
    }
    // the bank: chevron boards along its top edge
    const n = 14;
    for (let k = 0; k <= n; k++) {
      const s = lerp(t.s0 - 4, t.s1 + 4, k / n), d = -t.turn * 13.2;
      const p = rp(s, d, surface(s, d).y);
      frame(s, FB);
      wbox(mb, p[0], p[1] + 0.5, p[2], 1.1, 0.5, 0.06, Math.atan2(FB.dx, FB.dz), k % 2 ? lin('#ff7a1a') : WHITEP, KIND.plain, 0);
      if (k % 3 === 0) barrier(mb, rp(s, -t.turn * 14.6, surface(s, -t.turn * 14.6).y), Math.atan2(FB.dx, FB.dz), 1.3);
    }
    // the park inside the corner (outside the corridor): lawn, trees, benches, a lamp
    const icx = t.cx, icz = t.cz;
    for (let k = 0; k < 4; k++) {
      const ang = Math.atan2(kz - icz, kx - icx) + Math.PI + (k - 1.5) * 0.5;
      const rr = 2.5 + (k % 2) * 1.4;
      tree(mb, [icx + Math.cos(ang) * rr, ky + CURB, icz + Math.sin(ang) * rr], r, true);
    }
    // the corner building behind the bank
    {
      const ox = kx + (a.ix - a.ox) * 17, oz = kz + (a.iz - a.oz) * 17;
      const F = frameAt(ox, ky + 0.5, oz, -(a.ix - a.ox), -(a.iz - a.oz));
      house(mb, PXL, F, 14, ky + CURB, ky + CURB, { floors: 4, style: 'edw', r, depth: 14, exposedA: true, exposedB: true, turret: true });
    }
  }
}
// route props: lamps along the blocks, hydrants, trees, the trolley wires, parked cars, manholes and steam
function buildRouteProps(r) {
  const blocks = blockRanges();
  for (const [s0, s1] of blocks) {
    for (const sd of [-1, 1]) {
      const water = s0 >= FEAT.t3b - 1;
      for (let s = s0 + 8 + (sd > 0 ? 14 : 0); s < s1 - 4; s += 30) {
        frame(s, FB);
        lamp(chunk(s).mb, rp(s, sd * (ROAD + 0.9), CURB), sd, FB.rx, FB.rz);
      }
      if (!water && r() < 0.6) for (let s = s0 + 20; s < s1 - 10; s += 16) if (r() < 0.75) tree(chunk(s).mb, rp(s, sd * (ROAD + 1.6), CURB), r, false);
      if (!water) hydrant(chunk(s0 + 4).mb, rp(s0 + 4, sd * (ROAD + 0.6), CURB));
    }
  }
}
function buildWires() {
  // trolley wires over both lanes hung from span wires (lines, per chunk)
  for (let s = 6; s < FEAT.t4a - 4; s += 2) {
    const c = chunk(s), s2 = Math.min(s + 2, FEAT.t4a);
    for (const d of [-LANE - 0.3, -LANE + 0.3, LANE - 0.3, LANE + 0.3]) {
      const p = rp(s, d, 6.1), q = rp(s2, d, 6.1);
      const sg = Math.sin(((s % 30) / 30) * Math.PI) * 0.25, sg2 = Math.sin(((s2 % 30) / 30) * Math.PI) * 0.25;
      c.wires.push(p[0], p[1] - sg, p[2], q[0], q[1] - sg2, q[2]);
    }
  }
  for (let s = 30; s < FEAT.t4a - 4; s += 30) {
    const c = chunk(s), z = zoneAt(s);
    if (z === Z_TURN) continue;
    const a = rp(s, -WALK + 0.3, 7.2), b = rp(s, WALK - 0.3, 7.2), m = rp(s, 0, 6.6);
    c.wires.push(a[0], a[1], a[2], m[0], m[1], m[2], m[0], m[1], m[2], b[0], b[1], b[2]);
  }
}
function buildTracks() {
  // cable-car tracks: two rails and the cable slot in each lane, polished steel flush with the street
  const end = FEAT.t4a - 2;
  for (let s = 0; s < end; s += CHUNK) {
    const e = Math.min(end, s + CHUNK);
    const mb = chunk(s + 1).mb;
    for (const ln of [-LANE, LANE]) {
      for (const o of [-0.55, 0.55]) stripe(mb, s, e, ln + o - 0.045, ln + o + 0.045, STEEL, KIND.rail, 0.014);
      stripe(mb, s, e, ln - 0.025, ln + 0.025, IRON, KIND.metal, 0.011);
    }
  }
}
function buildManholes(r) {
  for (let s = 40; s < FEAT.t4a - 20; s += 55 + r() * 40) {
    if (zoneAt(s) !== Z_BLOCK) continue;
    const d = (r() < 0.5 ? -1 : 1) * (LANE + (r() - 0.5) * 2);
    const p = rp(s, d, 0);
    manhole(chunk(s).mb, p, s);
    if (r() < 0.55) STEAMS.push([p[0], p[1], p[2], r()]);
  }
}
function buildParked(r) {
  const blocks = blockRanges();
  for (const [s0, s1] of blocks) {
    if (s0 >= FEAT.t3b - 1) continue;
    for (const sd of [-1, 1]) {
      if (s0 < CON.s1 && s1 > CON.s0 && sd > 0) continue; // the construction zone
      for (let s = s0 + 6; s < s1 - 6; s += 6.4 + r() * 1.5) {
        if (r() < 0.3) { s += 4; continue; }
        const type = r() < 0.12 ? 2 : r() < 0.18 ? 1 : 0;
        frame(s, FB);
        const yaw = Math.atan2(FB.dx, FB.dz) + (sd < 0 ? Math.PI : 0); // parked along the traffic of their side
        PARKED.push({ s, d: sd * PARK, type, yaw, dir: sd > 0 ? 1 : -1 });
      }
    }
  }
}

// ===================== special places =====================
const CON = { s0: 0, s1: 0, ramp: 0 };     // construction zone (street B)
const RAIL = { s0: 0, s1: 0, d: 0, h: 0.62 };  // grind rail along the cable-car tracks (street C)
const RAILS = [];
function planSpecials() {
  CON.s0 = FEAT.t1b + XHALF + 12; CON.s1 = FEAT.iB - XHALF - 3; CON.ramp = CON.s0 + 26;
  RAIL.s0 = FEAT.t2b + XHALF + 14; RAIL.s1 = FEAT.iC1 - XHALF - 8;
  RAILS.length = 0;
  RAILS.push({ s0: RAIL.s0, s1: RAIL.s1, d: RAIL.d, h: RAIL.h });
}
// threats on the crown of the street: road works islands, delivery vans double-parked in Kit's lane (the first car queued
// behind one pulls out over the centre line as Kit comes down) and, at two crossings, a driver who runs the stop sign
const HZ = []; // {type, s, d, car, armed}
function planHazards() {
  HZ.length = 0;
  const F = FEAT;
  HZ.push({ type: 6, s: F.iA1 + 72, d: 0 });   // the long drop to jump 1
  HZ.push({ type: 7, s: F.iA4 + 92, d: LANE });
  HZ.push({ type: 7, s: F.iB + 74, d: LANE });
  HZ.push({ type: 6, s: F.iC1 + 82, d: 0 });   // street C, before the dip of jump 2
  HZ.push({ type: 7, s: F.iC3 + 87, d: LANE });
  HZ.push({ type: 6, s: F.t3b + 95, d: 0 });   // the waterfront
  for (const X of XS) X.runner = X.traffic && !X.jump && (X.s === F.iA4 || X.s === F.iC3);
}
function routeYaw(s) { frame(s, FB); return Math.atan2(FB.dx, FB.dz); }
// an OBB solid aligned with the route at (s, d), height above the profile
function routeSolid(s, d, h0, hx, hy, hz, kind, extra) {
  const p = rp(s, d, h0 + hy);
  return addSolid(Object.assign({ x: p[0], y: p[1], z: p[2], hx, hy, hz, yaw: routeYaw(s), kind }, extra || {}));
}
function buildConstruction(r) {
  const mb = chunk(CON.ramp).mb;
  const s0 = CON.ramp, len = 7.5, rise = 2.7, d0 = 4.35, d1 = 7.55;
  // wooden kicker: deck, sides, back
  const A = rp(s0, d0, 0.02), B = rp(s0, d1, 0.02), C = rp(s0 + len, d1, rise), D = rp(s0 + len, d0, rise);
  const yb = profY(s0 + len);
  mb.quad(A, B, C, D, lin('#b98a55'), KIND.plank, 0, 3.2, len);
  const C0 = [C[0], yb, C[2]], D0 = [D[0], yb, D[2]];
  mb.quad(C0, D0, D, C, lin('#8a6440'), KIND.plank, 0, 3.2, rise);
  mb.tri(A, D0, D, lin('#8a6440'), KIND.plank, 0);
  mb.tri(B, C, C0, lin('#8a6440'), KIND.plank, 0);
  // striped lip
  mb.quad(rp(s0, d0, 0.03), rp(s0, d1, 0.03), rp(s0 + 0.6, d1, 0.03 + rise * 0.6 / len), rp(s0 + 0.6, d0, 0.03 + rise * 0.6 / len), lin('#ffcf1a'), KIND.awning, 0, 3.2, 1);
  {
    const p = rp(s0 + len / 2, (d0 + d1) / 2, 0);
    // walkable top: from the street at the toe (y0) up to the lip (y1), along the box's +z (the route direction)
    const y0 = profY(s0) + 0.02, y1 = profY(s0 + len) + rise, lo = Math.min(y0, profY(s0 + len));
    addSolid({ x: p[0], y: (lo + y1) / 2, z: p[2], hx: (d1 - d0) / 2, hy: (y1 - lo) / 2, hz: len / 2, yaw: routeYaw(s0 + len / 2), kind: 'ramp', ramp: rise, y0, y1 });
  }
  // the cement mixer to jump over, dumpsters, an excavator, barriers and cones along the lane
  mixer(mb, CON.ramp + 18, 6.0);
  routeSolid(CON.ramp + 18, 6.0, 0, 1.25, 1.7, 4.3, 'truck');
  for (const k of [0, 1]) {
    const s = CON.ramp + 30 + k * 5.2;
    const p = rp(s, 6.1, 0.65);
    wbox(mb, p[0], p[1], p[2], 1.0, 0.65, 2.1, routeYaw(s), lin(k ? '#2f6b4f' : '#1f4f8a'), KIND.metal, 0);
    routeSolid(s, 6.1, 0, 1.0, 0.65, 2.1, 'box');
  }
  excavator(mb, CON.s1 - 18, 8.6);
  for (let s = CON.s0; s < CON.s1; s += 3.2) {
    if (s > CON.ramp - 6 && s < CON.ramp + 0.5) continue; // the way onto the ramp
    if (Math.floor((s - CON.s0) / 3.2) % 3 === 0) barrier(mb, rp(s, 4.25, 0), routeYaw(s) + Math.PI / 2, 1.3);
    else cone(mb, rp(s, 4.25, 0));
  }
  // hoarding along the sidewalk side
  for (let s = CON.s0; s < CON.s1 - 4; s += 4) {
    const a = rp(s, 10.6, CURB), b = rp(s + 4, 10.6, CURB);
    mb.quad(b, a, [a[0], a[1] + 2.2, a[2]], [b[0], b[1] + 2.2, b[2]], lin(Math.floor(s / 4) % 2 ? '#2f5c8a' : '#3a6c9a'), KIND.plank, 0, 4, 2.2);
  }
  // arrows painted toward the ramp
  for (const ds of [-14, -8]) stripe(mb, CON.ramp + ds, CON.ramp + ds + 2.2, 5.6, 6.3, lin('#f2c230'));
  void r;
}
function mixer(mb, s, d) {
  const T = templates(), yaw = routeYaw(s), p = rp(s, d, 0);
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const at = (a, y, b) => [p[0] + sn * b + c * a, p[1] + y, p[2] + c * b - sn * a];
  const cab = at(0, 1.45, 2.9);
  wbox(mb, cab[0], cab[1], cab[2], 1.2, 1.05, 1.1, yaw, lin('#f0f0ea'), KIND.plain, 0);
  const win = at(0, 2.0, 4.02);
  wbox(mb, win[0], win[1], win[2], 1.0, 0.35, 0.02, yaw, lin('#203040'), KIND.glass, 0);
  const ch = at(0, 0.75, -0.8);
  wbox(mb, ch[0], ch[1], ch[2], 1.15, 0.3, 3.4, yaw, lin('#3a3a3c'), KIND.metal, 0);
  const dr = at(0, 2.2, -1.2);
  mb.geo(T.cyl12, TRS(dr[0], dr[1], dr[2], Math.PI / 2 - 0.22, yaw, 0, 1.25, 4.6, 1.25), lin('#f2b632'), KIND.plain, 0);
  mb.geo(T.cone12, TRS(at(0, 2.75, -4.0)[0], at(0, 2.75, -4.0)[1], at(0, 2.75, -4.0)[2], -Math.PI / 2 - 0.22, yaw, 0, 1.1, 1.4, 1.1), lin('#e0a02a'), KIND.plain, 0);
  for (const a of [-1.1, 1.1]) for (const b of [-3.0, -1.5, 2.7]) {
    const w = at(a, 0.5, b);
    mb.geo(T.cyl12, TRS(w[0], w[1], w[2], 0, yaw, Math.PI / 2, 0.5, 0.35, 0.5), lin('#1a1a1a'), KIND.plain, 0);
  }
  PXL.push({ F: { ox: p[0], oy: p[1], oz: p[2], ax: c, az: -sn, bx: sn, bz: c }, a0: -1.2, a1: 1.2, y0: 0, y1: 3.3, b0: -4.2, b1: 4.0 });
}
function excavator(mb, s, d) {
  const T = templates(), yaw = routeYaw(s) + 0.4, p = rp(s, d, CURB);
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const at = (a, y, b) => [p[0] + sn * b + c * a, p[1] + y, p[2] + c * b - sn * a];
  const Y = lin('#f2b21b');
  for (const a of [-1.1, 1.1]) { const q = at(a, 0.45, 0); wbox(mb, q[0], q[1], q[2], 0.4, 0.45, 2.0, yaw, lin('#2a2a2a'), KIND.metal, 0); }
  const b = at(0, 1.5, -0.3); wbox(mb, b[0], b[1], b[2], 1.3, 0.6, 1.5, yaw, Y, KIND.plain, 0);
  const cb = at(0.5, 2.6, 0.4); wbox(mb, cb[0], cb[1], cb[2], 0.7, 0.75, 0.7, yaw, Y, KIND.plain, 0);
  const g = at(0.5, 2.7, 1.12); wbox(mb, g[0], g[1], g[2], 0.6, 0.55, 0.02, yaw, lin('#203040'), KIND.glass, 0);
  // boom and stick raised over the street
  const b0 = at(-0.4, 2.0, 1.0), b1 = at(-0.4, 5.2, 3.6), b2 = at(-0.4, 3.2, 5.6);
  const seg = (u, v, w) => {
    const mx = (u[0] + v[0]) / 2, my = (u[1] + v[1]) / 2, mz = (u[2] + v[2]) / 2, L = Math.hypot(v[0] - u[0], v[1] - u[1], v[2] - u[2]);
    _q4.setFromUnitVectors(_gv.set(0, 1, 0), _gn.set(v[0] - u[0], v[1] - u[1], v[2] - u[2]).normalize());
    _m4.compose(_p4.set(mx, my, mz), _q4, _s4.set(w, L, w));
    mb.geo(T.box, _m4, Y, KIND.plain, 0);
  };
  seg(b0, b1, 0.35); seg(b1, b2, 0.28);
  const bk = at(-0.4, 2.6, 5.9); wbox(mb, bk[0], bk[1], bk[2], 0.5, 0.45, 0.4, yaw, lin('#5a5a5a'), KIND.metal, 0);
  PXL.push({ F: { ox: p[0], oy: p[1], oz: p[2], ax: c, az: -sn, bx: sn, bz: c }, a0: -1.4, a1: 1.4, y0: 0, y1: 3.3, b0: -2, b1: 1.5 });
}
function buildRail() {
  const mb = chunk((RAIL.s0 + RAIL.s1) / 2).mb, T = templates();
  // rail bar (segmented along the profile) on yellow posts
  for (let s = RAIL.s0; s < RAIL.s1 - 1e-6; s += 2) {
    const e = Math.min(RAIL.s1, s + 2);
    const a = rp(s, RAIL.d, RAIL.h - 0.05), b = rp(e, RAIL.d, RAIL.h - 0.05);
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, mz = (a[2] + b[2]) / 2, L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _q4.setFromUnitVectors(_gv.set(0, 1, 0), _gn.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize());
    _m4.compose(_p4.set(mx, my, mz), _q4, _s4.set(0.07, L + 0.02, 0.07));
    mb.geo(T.cyl8, _m4, lin('#d8dde3'), KIND.rail, 0);
  }
  for (let s = RAIL.s0 + 0.5; s < RAIL.s1; s += 4.5) {
    const p = rp(s, RAIL.d, 0);
    mb.geo(T.cyl8, TRS(p[0], p[1] + RAIL.h / 2 - 0.05, p[2], 0, 0, 0, 0.06, RAIL.h - 0.1, 0.06), lin('#f2c230'), KIND.metal, 0);
    mb.geo(T.cyl8, TRS(p[0], p[1] + 0.03, p[2], 0, 0, 0, 0.16, 0.06, 0.16), IRON, KIND.metal, 0);
  }
  // end caps
  for (const s of [RAIL.s0, RAIL.s1]) { const p = rp(s, RAIL.d, RAIL.h - 0.05); mb.geo(T.sph8, TRS(p[0], p[1], p[2], 0, 0, 0, 0.09, 0.09, 0.09), lin('#f2c230'), KIND.metal, 0); }
  // hazard stripes on the street under the rail
  stripe(mb, RAIL.s0 - 3, RAIL.s1 + 3, -0.75, -0.6, lin('#f2c230'));
  stripe(mb, RAIL.s0 - 3, RAIL.s1 + 3, 0.6, 0.75, lin('#f2c230'));
}
// the waterfront: warehouses on the land side, promenade with palms, a sea wall, finger piers with sheds
function warehouse(mb, F, w, h, r) {
  const LOD = mb.lod;
  if (mb.hd) mb = mb.hd;
  const brick = col(pick(['#a4553e', '#9a4a3a', '#b0644a', '#8f4f3f', '#c9b48a', '#d6c7a2'], r));
  const trim = col(pick(PAL.trim, r)), acc = col(pick(PAL.accent, r));
  const kind = brick.r > 0.5 ? KIND.plain : KIND.brick;
  mb.quad(fp(F, -w / 2, -1, 0), fp(F, w / 2, -1, 0), fp(F, w / 2, h, 0), fp(F, -w / 2, h, 0), brick, kind, 0, w, h + 1, -w / 2, -1);
  fbox(mb, F, -w / 2, w / 2, -1, h, -18, 0, brick, kind, 0, 1 | 2 | 32);
  fbox(mb, F, -w / 2 - 0.2, w / 2 + 0.2, h, h + 0.8, -0.3, 0.4, trim, KIND.plain, 0, 4 | 8 | 16 | 1 | 2);
  mb.quad(fp(F, -w / 2, h + 0.8, -18), fp(F, w / 2, h + 0.8, -18), fp(F, w / 2, h + 0.8, 0), fp(F, -w / 2, h + 0.8, 0), lin('#55534f'), KIND.tar, 0, w, 18);
  // a band for a (wordless) sign, big ground-floor openings, upper windows
  mb.quad(fp(F, -w / 2 + 1, 4.2, 0.05), fp(F, w / 2 - 1, 4.2, 0.05), fp(F, w / 2 - 1, 5.2, 0.05), fp(F, -w / 2 + 1, 5.2, 0.05), acc, KIND.plain, 0, 1, 1);
  const n = Math.max(2, Math.floor(w / 5));
  for (let k = 0; k < n; k++) {
    const c = -w / 2 + (k + 0.5) * w / n;
    mb.quad(fp(F, c - 1.7, 0.2, 0.04), fp(F, c + 1.7, 0.2, 0.04), fp(F, c + 1.7, 3.8, 0.04), fp(F, c - 1.7, 3.8, 0.04), trim, KIND.shop, r() < 0.6 ? 1 : 0, 1, 1);
    for (let y = 6.2; y + 2.3 < h; y += 3.6) windowAt(mb, F, c, y, y + 2.3, 1.3, trim, r() < 0.35 ? 1 : 0);
  }
  // striped awning
  const ac = col(pick(['#c0392b', '#1f7a5c', '#2c5d9e', '#d17a22'], r));
  mb.quad(fp(F, -w / 2 + 0.5, 3.9, 0.05), fp(F, w / 2 - 0.5, 3.9, 0.05), fp(F, w / 2 - 0.5, 3.1, 1.6), fp(F, -w / 2 + 0.5, 3.1, 1.6), ac, KIND.awning, 0, w, 1);
  PXL.push({ F, a0: -w / 2, a1: w / 2, y0: -1, y1: h + 0.8, b0: -18, b1: -0.3 });
  if (LOD) {
    fbox(LOD, F, -w / 2, w / 2, -1, h + 0.8, -18, 0, brick, KIND.facade, 1, 1 | 2 | 16);
    LOD.quad(fp(F, -w / 2, h + 0.8, -18), fp(F, w / 2, h + 0.8, -18), fp(F, w / 2, h + 0.8, 0), fp(F, -w / 2, h + 0.8, 0), lin('#55534f'), KIND.tar, 0, w, 18);
  }
}
function buildWaterfront(r) {
  const s0 = FEAT.t3b + 4, s1 = FEAT.t4a - 4;
  // land side (left, d < 0): warehouses and restaurants
  {
    let s = s0 + 2;
    while (s < s1 - 10) {
      const w = 14 + r() * 10;
      if (s + w > s1) break;
      const m = s + w / 2;
      if (Math.abs(m - FEAT.iW) < XHALF + w / 2) { s = FEAT.iW + XHALF + 0.5; continue; }
      frame(m, FB);
      const p = rp(m, -WALK, CURB);
      warehouse(chunk(m).mb, frameAt(p[0], p[1], p[2], FB.rx, FB.rz), w - 0.4, 8 + r() * 6, r);
      s += w;
    }
  }
  // bay side (right): promenade, palms, railing, sea wall, finger piers
  const mbAt = s => chunk(s).mb, T = templates();
  for (let s = s0; s < s1; s += 4) {
    const e = Math.min(s1, s + 4), mb = mbAt(s);
    const a = rp(s, 17, CURB), b = rp(e, 17, CURB);
    mb.quad([b[0], -1.5, b[2]], [a[0], -1.5, a[2]], a, b, CONC, KIND.seawall, 0, 4, a[1] + 1.5, s, -1.5);
    // railing
    const ra = rp(s, 16.7, CURB + 1.05), rb = rp(e, 16.7, CURB + 1.05);
    const mx = (ra[0] + rb[0]) / 2, mz = (ra[2] + rb[2]) / 2;
    mb.geo(T.box, TRS(mx, ra[1], mz, 0, routeYaw(s), 0, 0.08, 0.08, 4.05), lin('#2e3a40'), KIND.metal, 0);
    mb.geo(T.box, TRS(mx, ra[1] - 0.5, mz, 0, routeYaw(s), 0, 0.05, 0.05, 4.05), lin('#2e3a40'), KIND.metal, 0);
    mb.geo(T.cyl8, TRS(ra[0], ra[1] - 0.55, ra[2], 0, 0, 0, 0.05, 1.1, 0.05), lin('#2e3a40'), KIND.metal, 0);
  }
  for (let s = s0 + 6; s < s1; s += 19) palm(mbAt(s), rp(s, 13, CURB), r);
  for (let s = s0 + 15; s < s1; s += 38) { frame(s, FB); bench(mbAt(s), rp(s, 15.3, CURB), Math.atan2(-FB.rx, -FB.rz)); }
  // finger piers with long sheds between open water
  for (let s = s0 + 30; s < s1 - 40; s += 92) {
    frame(s + 16, FB);
    const mb = mbAt(s), p = rp(s + 16, 17, 0);
    const F = frameAt(p[0] + FB.rx * 60, 1.2, p[2] + FB.rz * 60, -FB.rx, -FB.rz);
    // deck on piles
    fbox(mb, F, -15, 15, -0.6, 0.2, -60, 60, lin('#8a7a66'), KIND.plank, 0, 4 | 16 | 1 | 2);
    // the shed: long gabled hall with a big arched door facing the avenue
    const shedC = col(pick(['#d9cdb4', '#c8d8d0', '#e0c7a8', '#b9c9d9'], r));
    fbox(mb, F, -12, 12, 0.2, 9, -50, 58, shedC, KIND.siding, 0, 1 | 2 | 16 | 32);
    const ga = fp(F, -12.6, 9, 58.3), gb = fp(F, 12.6, 9, 58.3), gc = fp(F, 0, 15, 58.3);
    mb.tri(ga, gb, gc, shedC, KIND.plain, 0);
    mb.quad(fp(F, -12.6, 9, -50.3), fp(F, -12.6, 9, 58.4), fp(F, 0, 15, 58.4), fp(F, 0, 15, -50.3), lin('#6c7276'), KIND.shingle, 0, 108, 13);
    mb.quad(fp(F, 12.6, 9, 58.4), fp(F, 12.6, 9, -50.3), fp(F, 0, 15, -50.3), fp(F, 0, 15, 58.4), lin('#6c7276'), KIND.shingle, 0, 108, 13);
    mb.quad(fp(F, -5, 0.2, 58.05), fp(F, 5, 0.2, 58.05), fp(F, 5, 7.5, 58.05), fp(F, -5, 7.5, 58.05), lin('#2c4a5a'), KIND.plank, 0, 10, 7.5);
    for (const a of [-9, 9]) mb.quad(fp(F, a - 1.6, 3, 58.06), fp(F, a + 1.6, 3, 58.06), fp(F, a + 1.6, 7, 58.06), fp(F, a - 1.6, 7, 58.06), lin('#f4f0e6'), KIND.window, r() < 0.5 ? 1 : 0, 1, 1);
    PXL.push({ F, a0: -12, a1: 12, y0: 0, y1: 13, b0: -50, b1: 58 });
    FLAGS.push({ p: fp(F, 0, 15, 58.4), yaw: Math.atan2(F.bx, F.bz) + Math.PI / 2, w: 2.6, h: 1.6, c: r() < 0.5 ? 0 : 1 });
  }
}
function buildPier(r) {
  const T = templates(), ce = FEAT.end - PIER_END_R;
  const y0 = profY(FEAT.pier0 + 20);
  // pilings under the deck edges
  for (let s = FEAT.pier0; s < ce; s += 5) for (const d of [-PIER_HALF + 0.3, 0, PIER_HALF - 0.3]) {
    const p = rp(s, d, 0); chunk(s).mb.geo(T.cyl8, TRS(p[0], (p[1] - 0.6 - 3) / 2, p[2], 0, 0, 0, 0.32, p[1] - 0.6 + 3, 0.32), lin('#5a4836'), KIND.plain, 0);
  }
  // railing and lamps along the sides
  for (let s = FEAT.pier0 + 2; s < ce - 2; s += 3) {
    const mb = chunk(s).mb;
    for (const sd of [-1, 1]) {
      const p = rp(s, sd * (PIER_HALF - 0.12), 0);
      mb.geo(T.box, TRS(p[0], p[1] + 0.55, p[2], 0, 0, 0, 0.09, 1.1, 0.09), lin('#f2efe6'), KIND.plain, 0);
      const q = rp(s + 1.5, sd * (PIER_HALF - 0.12), 1.08);
      mb.geo(T.box, TRS(q[0], q[1], q[2], 0, routeYaw(s), 0, 0.07, 0.07, 3.0), lin('#f2efe6'), KIND.plain, 0);
      const q2 = rp(s + 1.5, sd * (PIER_HALF - 0.12), 0.6);
      mb.geo(T.box, TRS(q2[0], q2[1], q2[2], 0, routeYaw(s), 0, 0.05, 0.05, 3.0), lin('#f2efe6'), KIND.plain, 0);
    }
  }
  for (let s = FEAT.pier0 + 10; s < ce - 6; s += 22) { frame(s, FB); for (const sd of [-1, 1]) lamp(chunk(s).mb, rp(s, sd * (PIER_HALF + 0.35), 0), -sd, FB.rx, FB.rz); }
  for (let s = FEAT.pier0 + 26; s < ce - 10; s += 44) for (const sd of [-1, 1]) {
    const p = rp(s, sd * (PIER_HALF + 0.6), 0);
    chunk(s).mb.geo(T.cyl8, TRS(p[0], p[1] + 4.5, p[2], 0, 0, 0, 0.06, 9, 0.06), lin('#f0f0f0'), KIND.metal, 0);
    FLAGS.push({ p: [p[0], p[1] + 8.6, p[2]], yaw: routeYaw(s) + Math.PI, w: 2.4, h: 1.5, c: (s / 44 | 0) % 3 });
  }
  // the round platform at the end
  {
    frame(ce, FB);
    const mb = chunk(ce).mb, cx = FB.x, cz = FB.z, cy = profY(ce), R0 = PIER_END_R, N = 40;
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * TAU, a1 = ((k + 1) / N) * TAU;
      const p0 = [cx + Math.cos(a0) * R0, cy, cz + Math.sin(a0) * R0], p1 = [cx + Math.cos(a1) * R0, cy, cz + Math.sin(a1) * R0];
      mb.tri([cx, cy, cz], p1, p0, WOOD, KIND.plank, 0, [0, 0, Math.cos(a1) * R0, Math.sin(a1) * R0, Math.cos(a0) * R0, Math.sin(a0) * R0]);
      mb.quad([p0[0], cy - 0.6, p0[2]], [p1[0], cy - 0.6, p1[2]], p1, p0, lin('#6b5440'), KIND.plank, 0, 2, 0.6);
      // piles and railing round the edge (open toward the pier)
      const mid = (a0 + a1) / 2, back = Math.cos(mid) * FB.dx + Math.sin(mid) * FB.dz;
      if (k % 2 === 0) mb.geo(T.cyl8, TRS(p0[0], (cy - 3.6) / 2, p0[2], 0, 0, 0, 0.34, cy + 3, 0.34), lin('#5a4836'), KIND.plain, 0);
      if (back < -0.45) continue;
      const q0 = [cx + Math.cos(a0) * (R0 - 0.15), cy, cz + Math.sin(a0) * (R0 - 0.15)];
      mb.geo(T.box, TRS(q0[0], cy + 0.55, q0[2], 0, 0, 0, 0.09, 1.1, 0.09), lin('#f2efe6'), KIND.plain, 0);
      const mx = cx + Math.cos(mid) * (R0 - 0.15), mz = cz + Math.sin(mid) * (R0 - 0.15), ln = 2 * R0 * Math.sin(Math.PI / N);
      mb.geo(T.box, TRS(mx, cy + 1.08, mz, 0, -mid, 0, 0.07, 0.07, ln + 0.1), lin('#f2efe6'), KIND.plain, 0);
      mb.geo(T.box, TRS(mx, cy + 0.6, mz, 0, -mid, 0, 0.05, 0.05, ln + 0.1), lin('#f2efe6'), KIND.plain, 0);
    }
    // light ring painted on the deck around the bumper
    const bp = rp(FEAT.bumper, 0, 0);
    for (let k = 0; k < 24; k++) {
      const a0 = (k / 24) * TAU, a1 = ((k + 0.5) / 24) * TAU, r0 = 5.2, r1 = 6.0;
      mb.quad([bp[0] + Math.cos(a0) * r0, cy + 0.015, bp[2] + Math.sin(a0) * r0], [bp[0] + Math.cos(a0) * r1, cy + 0.015, bp[2] + Math.sin(a0) * r1],
        [bp[0] + Math.cos(a1) * r1, cy + 0.015, bp[2] + Math.sin(a1) * r1], [bp[0] + Math.cos(a1) * r0, cy + 0.015, bp[2] + Math.sin(a1) * r0], k % 2 ? lin('#ff4fa0') : lin('#ffd23f'), KIND.glow, 0.9, 1, 1);
    }
    void y0;
  }
  void r;
}
// the hilltop at the start: a small park with a view (lawn, trees, benches, a coin telescope, railing)
function buildSummit(r) {
  const s0 = FEAT.iA0 + XHALF + 1, s1 = FEAT.iA0 + 75, mb = chunk(s0).mb, T = templates();
  for (let s = s0; s < s1; s += 3) {
    const a = rp(s, -WALK - 0.2, CURB + 0.05), b = rp(s + 3, -WALK - 0.2, CURB + 0.05), c2 = rp(s + 3, -40, CURB - 0.5), d2 = rp(s, -40, CURB - 0.5);
    mb.quad(d2, c2, b, a, lin('#6f9a45'), KIND.ground, 0, 1, 1);
  }
  for (let s = s0 + 4; s < s1 - 2; s += 2.5) {
    const p = rp(s, -WALK + 0.1, CURB);
    mb.geo(T.box, TRS(p[0], p[1] + 0.5, p[2], 0, 0, 0, 0.06, 1.0, 0.06), IRON, KIND.metal, 0);
    const q = rp(s + 1.25, -WALK + 0.1, CURB + 1.0);
    mb.geo(T.box, TRS(q[0], q[1], q[2], 0, routeYaw(s), 0, 0.05, 0.05, 2.55), IRON, KIND.metal, 0);
  }
  for (let k = 0; k < 7; k++) tree(mb, rp(s0 + 6 + k * 9, -18 - r() * 16, CURB), r, k % 2 === 0);
  for (const s of [s0 + 12, s0 + 34, s0 + 56]) { frame(s, FB); bench(mb, rp(s, -14, CURB), Math.atan2(-FB.rx, -FB.rz)); }
  const tp = rp(s0 + 24, -12.5, CURB);
  mb.geo(T.cyl8, TRS(tp[0], tp[1] + 0.6, tp[2], 0, 0, 0, 0.08, 1.2, 0.08), lin('#3a6b8a'), KIND.metal, 0);
  mb.geo(T.box, TRS(tp[0], tp[1] + 1.35, tp[2], 0.2, 0.9, 0, 0.35, 0.3, 0.6), lin('#3a6b8a'), KIND.metal, 0);
  // behind the start the street goes on over the crest, closed by barriers for the race
  frame(0, FB);
  sideStreet(FB.x, FB.z, -FB.dx, -FB.dz, 0, 170, profY(0), -0.05, r, { detail: 90, houseStart: 0, flat: 40, mb });
  const byaw = Math.atan2(FB.dx, FB.dz) + Math.PI / 2;
  for (let k = -9.6; k <= 9.7; k += 2.4) {
    const p = rp(0, k, Math.abs(k) > ROAD ? CURB : 0);
    barrier(mb, [p[0] - FB.dx * 0.75, p[1], p[2] - FB.dz * 0.75], byaw, 1.15);
  }
}

// ===================== the land, the background city, the bay's far shores =====================
function shoreZ(x) {
  // the city's north shore (water to the north of it)
  return -1395 - 75 * smooth((-x - 250) / 300) + 380 * smooth((x - 950) / 520);
}
function cityHFar(x, z) {
  const t = clamp((z - shoreZ(x)) / 1500, 0, 1);
  let h = 2.2 + 120 * Math.pow(smooth(t), 0.85);
  h += 24 * Math.exp(-((x + 60) ** 2 + (z - 20) ** 2) / (230 * 230));
  h += 64 * Math.exp(-((x - 720) ** 2 + (z + 1120) ** 2) / (140 * 140));
  h += 30 * Math.exp(-((x - 650) ** 2 + (z + 380) ** 2) / (260 * 260));
  h += 48 * Math.exp(-((x + 760) ** 2 + (z + 1220) ** 2) / (280 * 280));
  // below the shore the land dives under the bay
  const under = z - shoreZ(x);
  if (under < 0) h = Math.min(h, 2.2 + under * 0.25);
  return h;
}
const STREETS = []; // straight side streets for the terrain carve: {x0, z0, dx, dz, len, y0, slope, flat}
function streetH(x, z) {
  // highest street surface constraint near (x, z): returns the street height or null when no street is close
  let best = null;
  const L = locate(x, z);
  // the land grid is coarse (16 u): stay under the road's lowest point nearby so dips never show grass through it
  if (L && Math.abs(L.d) < 40) best = Math.min(profY(L.s - 12), profY(L.s - 6), profY(L.s), profY(L.s + 6), profY(L.s + 12));
  for (const st of STREETS) {
    const ex = x - st.x0, ez = z - st.z0, t = ex * st.dx + ez * st.dz, d = Math.abs(ex * -st.dz + ez * st.dx);
    if (t < -6 || t > st.len + 6 || d > 30) continue;
    const y = st.y0 + st.slope * Math.max(0, t - st.flat);
    best = best == null ? y : Math.min(best, y);
  }
  return best;
}
function cityH(x, z) {
  const hf = cityHFar(x, z);
  const L = locate(x, z);
  if (!L) return hf;
  const w = smooth((Math.abs(L.d) - 30) / 120);
  return lerp(profY(L.s), hf, w);
}
const LAND = { x0: -1300, x1: 1600, z0: -1600, z1: 460, step: 16, H: null, nx: 0, nz: 0 };
// height of the land mesh at (x, z) (bilinear on its grid), once buildTerrain has run
function landY(x, z) {
  if (!LAND.H) return cityH(x, z);
  const fx = clamp((x - LAND.x0) / LAND.step, 0, LAND.nx - 1.001), fz = clamp((z - LAND.z0) / LAND.step, 0, LAND.nz - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, H = LAND.H, w = LAND.nx;
  return lerp(lerp(H[j * w + i], H[j * w + i + 1], u), lerp(H[(j + 1) * w + i], H[(j + 1) * w + i + 1], u), v);
}
function buildTerrain() {
  const nx = Math.round((LAND.x1 - LAND.x0) / LAND.step) + 1, nz = Math.round((LAND.z1 - LAND.z0) / LAND.step) + 1;
  const pos = new Float32Array(nx * nz * 3), colr = new Float32Array(nx * nz * 3), nor = new Float32Array(nx * nz * 3);
  const H = new Float32Array(nx * nz);
  const g1 = lin('#8a8a5a'), g2 = lin('#5f7a45'), g3 = lin('#a89a7a'), tmp = new THREE.Color();
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = LAND.x0 + i * LAND.step, z = LAND.z0 + j * LAND.step;
    let h = cityH(x, z);
    const sh = streetH(x, z);
    if (sh != null) h = Math.min(h, sh - 0.7);
    H[j * nx + i] = h;
  }
  LAND.H = H; LAND.nx = nx; LAND.nz = nz;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = LAND.x0 + i * LAND.step, z = LAND.z0 + j * LAND.step, h = H[k];
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    const hx = H[j * nx + Math.min(nx - 1, i + 1)] - H[j * nx + Math.max(0, i - 1)];
    const hz = H[Math.min(nz - 1, j + 1) * nx + i] - H[Math.max(0, j - 1) * nx + i];
    let ax = -hx, ay = 4 * LAND.step, az = -hz; const l = Math.hypot(ax, ay, az); ax /= l; ay /= l; az /= l;
    nor[k * 3] = ax; nor[k * 3 + 1] = ay; nor[k * 3 + 2] = az;
    const n = hash(Math.floor(x / 40) * 7.1 + Math.floor(z / 40) * 3.3);
    tmp.copy(g1).lerp(g2, n * 0.8).lerp(g3, smooth((ay - 0.9) * -6));
    if (h < 3.2) tmp.lerp(lin('#b8a888'), 0.7);
    colr[k * 3] = tmp.r; colr[k * 3 + 1] = tmp.g; colr[k * 3 + 2] = tmp.b;
  }
  // tiles (frustum culled one by one); cells entirely under the bay are left out
  const out = [], TX = 4, TZ = 3;
  for (let tj = 0; tj < TZ; tj++) for (let ti = 0; ti < TX; ti++) {
    const i0 = Math.floor((nx - 1) * ti / TX), i1 = Math.floor((nx - 1) * (ti + 1) / TX);
    const j0 = Math.floor((nz - 1) * tj / TZ), j1 = Math.floor((nz - 1) * (tj + 1) / TZ);
    const w = i1 - i0 + 1, vp = [], vn = [], vc = [], idx = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = (j * nx + i) * 3;
      vp.push(pos[k], pos[k + 1], pos[k + 2]); vn.push(nor[k], nor[k + 1], nor[k + 2]); vc.push(colr[k], colr[k + 1], colr[k + 2]);
    }
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const g0 = j * nx + i;
      if (Math.max(H[g0], H[g0 + 1], H[g0 + nx], H[g0 + nx + 1]) < -0.6) continue;
      const a = (j - j0) * w + (i - i0), b = a + 1, c = a + w, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    if (!idx.length) continue;
    const n = vp.length / 3, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vp, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(vn, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(vc, 3));
    g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(n).fill(KIND.ground), 1));
    g.setAttribute('aUv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    g.setAttribute('aEmit', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    out.push(g);
  }
  return out;
}
// background city: rows of houses on a street grid away from the built streets (one long box per block side, the
// shader draws each house's colour, windows and lights)
function buildBackground(r) {
  const area = new Map();
  const get = (x, z) => { const k = Math.floor((x + 3000) / 400) * 1000 + Math.floor((z + 3000) / 400); let m = area.get(k); if (!m) { m = new MB(); area.set(k, m); } return m; };
  const XS_ = [-560, -440, -330, -220, -110, 0, 120, 240, 360, 480, 600, 720, 840, 960, 1080, 1200];
  const ZS_ = [300, 150, 0, -150, -300, -450, -600, -750, -900, -1050, -1200, -1350];
  const near = (x, z) => { const L = locate(x, z); if (L && Math.abs(L.d) < 60) return true; for (const st of STREETS) { const ex = x - st.x0, ez = z - st.z0, t = ex * st.dx + ez * st.dz, d = Math.abs(ex * -st.dz + ez * st.dx); if (t > -20 && t < st.len + 20 && d < 50) return true; } return false; };
  // the built streets with their houses (route: 40 u corridor, side streets: 30 u)
  const nearStreet = (x, z) => { const L = locate(x, z); if (L && Math.abs(L.d) < 32) return true; for (const st of STREETS) { const ex = x - st.x0, ez = z - st.z0, t = ex * st.dx + ez * st.dz, d = Math.abs(ex * -st.dz + ez * st.dx); if (t > -8 && t < st.len + 8 && d < 30) return true; } return false; };
  const asph = lin('#626166');
  for (let i = 0; i < XS_.length - 1; i++) for (let j = 0; j < ZS_.length - 1; j++) {
    const xa = XS_[i] + 9, xb = XS_[i + 1] - 9, za = ZS_[j + 1] + 9, zb = ZS_[j] - 9;
    const cx = (xa + xb) / 2, cz = (za + zb) / 2;
    if (cz < shoreZ(cx) + 30) continue;
    if (near(cx, cz)) continue;
    const mb = get(cx, cz);
    // four sides of the block, each a row of narrow houses (12 deep), roofs as one prism per side
    const sides = [[xa, za, xb, za, 0, -1], [xb, zb, xa, zb, 0, 1], [xa, zb, xa, za, -1, 0], [xb, za, xb, zb, 1, 0]];
    for (const [x0, z0, x1, z1, bx, bz] of sides) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      if (near(mx, mz)) continue;
      const y0 = Math.min(cityH(x0, z0), cityH(x1, z1)), y1 = Math.max(cityH(x0, z0), cityH(x1, z1));
      const F = frameAt(mx, y0, mz, bx, bz);
      const h = 8 + r() * 4 + (y1 - y0);
      fbox(mb, F, -len / 2 + 6, len / 2 - 6, -2, h, -12, 0, lin(pick(PAL.body, r)), KIND.facade, 1, 1 | 2 | 16 | 32);
      const gh = 3.5;
      mb.quad(fp(F, -len / 2 + 6, h, 0.3), fp(F, len / 2 - 6, h, 0.3), fp(F, len / 2 - 6, h + gh, -6), fp(F, -len / 2 + 6, h + gh, -6), lin(pick(PAL.roof, r)), KIND.shingle, 0, len, 7);
      mb.quad(fp(F, len / 2 - 6, h, -12.3), fp(F, -len / 2 + 6, h, -12.3), fp(F, -len / 2 + 6, h + gh, -6), fp(F, len / 2 - 6, h + gh, -6), lin(pick(PAL.roof, r)), KIND.shingle, 0, len, 7);
    }
    // the grid street south of the block (plain asphalt laid on the land), cut where it would reach a built street
    for (let x = xa - 9; x < xb + 9 - 1e-6; x += 23) {
      const x2 = Math.min(xb + 9, x + 23), z0 = zb, z1 = zb + 9;
      if (nearStreet(x, z0) || nearStreet(x2, z0) || nearStreet(x, z1) || nearStreet(x2, z1) || nearStreet((x + x2) / 2, (z0 + z1) / 2)) continue;
      mb.quad([x, landY(x, z1) + 0.3, z1], [x2, landY(x2, z1) + 0.3, z1], [x2, landY(x2, z0) + 0.3, z0], [x, landY(x, z0) + 0.3, z0], asph, KIND.asphalt, 0, 1, 1);
    }
  }
  return area;
}
// downtown towers on the east waterfront and the fluted tower on the hill
function buildSkyline(mb, r) {
  const T = templates();
  for (let k = 0; k < 26; k++) {
    const x = 860 + r() * 520, z = -820 - r() * 520;
    if (z < shoreZ(x) + 25) continue;
    const y = cityHFar(x, z) - 2, w = 16 + r() * 22, d = 16 + r() * 22, h = 35 + Math.pow(r(), 1.6) * 120;
    const c = col(pick(['#c9c4ba', '#9fa8b3', '#d8cdb8', '#7d8794', '#e2d9c6', '#b7aa97'], r));
    const F = frameAt(x, y, z, 0, 1);
    fbox(mb, F, -w / 2, w / 2, 0, h, -d / 2, d / 2, c, KIND.facade, 1, 1 | 2 | 4 | 16 | 32);
  }
  // the slender pyramid
  {
    const x = 1010, z = -1010, y = cityHFar(x, z) - 2;
    const g = new THREE.CylinderGeometry(0.8, 17, 170, 4, 1);
    mb.geo(g, TRS(x, y + 85, z, 0, Math.PI / 4, 0), lin('#e8e2d6'), KIND.facade, 1, 22, 50);
  }
  // fluted tower on the hill
  {
    const x = 720, z = -1120, y = cityHFar(x, z) - 1;
    mb.geo(T.cyl16, TRS(x, y + 26, z, 0, 0, 0, 4.6, 52, 4.6), lin('#efe6d2'), KIND.siding, 0);
    mb.geo(T.cyl16, TRS(x, y + 53, z, 0, 0, 0, 5.6, 2.4, 5.6), lin('#e2d7c0'), KIND.plain, 0);
    for (let k = 0; k < 12; k++) {
      const a = k * TAU / 12; mb.geo(T.box, TRS(x + Math.cos(a) * 4.7, y + 49, z + Math.sin(a) * 4.7, 0, -a, 0, 0.5, 4, 1.2), lin('#3a3a40'), KIND.glass, 1);
    }
    for (let k = 0; k < 14; k++) tree(mb, [x + (r() - 0.5) * 60, cityHFar(x, z) - 1 + (r() - 0.5) * 4, z + (r() - 0.5) * 60], r, true);
  }
}
function buildPresidio(mb, r) {
  // the wooded hill west of the city, toward the bridge: cypresses and pines (foliage cards, far mesh)
  const fb = FOL_FAR.mb;
  for (let k = 0; k < 160; k++) {
    const x = -760 + (r() - 0.5) * 520, z = -1180 + (r() - 0.5) * 480;
    if (z < shoreZ(x) + 6) continue;
    const q = burn(r, 4); // v2: size, 2 rotations, colour
    conifer(fb, x, cityHFar(x, z), z, 9 + q() * 9, q);
  }
  void mb;
}
// ===================== far shores =====================
function hillField(x0, x1, z0, z1, n, m, hfn, cfn) {
  const pos = [], colr = [], idx = [];
  const c = new THREE.Color();
  for (let j = 0; j <= m; j++) for (let i = 0; i <= n; i++) {
    const x = lerp(x0, x1, i / n), z = lerp(z0, z1, j / m), h = hfn(x, z);
    pos.push(x, h, z);
    cfn(x, z, h, c); colr.push(c.r, c.g, c.b);
  }
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, cc = a + n + 1, d = cc + 1; idx.push(a, cc, b, b, cc, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  const N = pos.length / 3;
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(new Float32Array(N).fill(KIND.ground), 1));
  g.setAttribute('aUv', new THREE.Float32BufferAttribute(new Float32Array(N * 2), 2));
  g.setAttribute('aEmit', new THREE.Float32BufferAttribute(new Float32Array(N), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
function marinH(x, z) {
  const shore = -2140 - 420 * smooth((x - 200) / 700) + 260 * smooth((x - 1200) / 600);
  const t = clamp((shore - z) / 700, 0, 1);
  const n = Math.sin(x * 0.004 + 1.3) * 0.5 + Math.sin(x * 0.011 + z * 0.006) * 0.3 + Math.sin(x * 0.023 - z * 0.013) * 0.2;
  let h = Math.pow(t, 0.7) * (230 + 90 * n) - 8;
  if (z > shore) h = -8 - (z - shore) * 0.3;
  return h;
}
const BRIDGE = { x: -600, zS: -1560, zN: -2040, zA: -1450, zB: -2150, deck: 28, top: 116, half: 13, goalZ: -1640 };
// the red suspension bridge (visual; the deck slab under the goal is the walkable solid added by goalMesh): stepped
// tapered tower legs with vertical ribs, art-deco portal struts, the main cables (catenary), steel suspenders, a deck
// with lane paint, walkways, railings and lamps, a Warren truss under it, concrete piers and approach pillars
function buildBridge(mb, r) {
  const T = templates(), RED = lin('#c2402f'), REDD = lin('#962b21'), RIB = lin('#a8352a'), STEELW = lin('#d8d0c4');
  const B = BRIDGE, x = B.x, K_M = KIND.metal;
  for (const zt of [B.zS, B.zN]) {
    for (const sx of [-1, 1]) {
      const segs = 6;
      for (let k = 0; k < segs; k++) {
        const y0 = (k / segs) * B.top, y1 = ((k + 1) / segs) * B.top, w = lerp(3.4, 2.3, k / segs), d = lerp(5.4, 3.6, k / segs);
        const cx = x + sx * B.half, cy = (y0 + y1) / 2 - 4, hy = (y1 - y0) / 2 + 0.3;
        wbox(mb, cx, cy, zt, w, hy, d, 0, RED, K_M, 0);
        wbox(mb, cx, y1 - 4, zt, w + 0.35, 0.5, d + 0.35, 0, REDD, K_M, 0);
        // vertical ribs on the faces along the deck and across it
        for (const f of [-1, 1]) {
          for (const o of [-0.55, 0.55]) wbox(mb, cx + o * w, cy, zt + f * (d + 0.08), 0.18, hy - 0.4, 0.1, 0, RIB, K_M, 0);
          wbox(mb, cx + f * (w + 0.08), cy, zt, 0.1, hy - 0.4, 0.2, 0, RIB, K_M, 0);
        }
      }
    }
    for (const yy of [B.deck + 16, B.deck + 38, B.deck + 58, B.top - 10]) {
      wbox(mb, x, yy, zt, B.half, 2.2, 2.0, 0, RED, K_M, 0);
      wbox(mb, x, yy - 2.6, zt, B.half - 2, 0.4, 1.6, 0, REDD, K_M, 0);
      wbox(mb, x, yy + 2.5, zt, B.half - 1, 0.3, 1.8, 0, REDD, K_M, 0);
      for (let k = -3; k <= 3; k++) wbox(mb, x + k * 3.2, yy, zt + 2.05, 0.35, 1.7, 0.08, 0, RIB, K_M, 0);
    }
    wbox(mb, x, B.deck - 2.5, zt, B.half + 3, 1.5, 3.5, 0, REDD, K_M, 0);
    // pier in the water
    wbox(mb, x, -2, zt, B.half + 6, 4.5, 9, 0, lin('#9a958c'), KIND.concrete, 0);
    wbox(mb, x, 2.8, zt, B.half + 4.5, 0.4, 7.5, 0, lin('#8a857c'), KIND.concrete, 0);
    // aviation lights
    for (const sx of [-1, 1]) LAMPS.push([x + sx * B.half, B.top - 3.4, zt, 1]);
  }
  // deck: slab, lane paint, walkways with railings and lamps; the stiffening truss under it
  const dz0 = B.zA, dz1 = B.zB, dt = B.deck + 0.45;
  for (let z = dz0; z > dz1; z -= 20) {
    const z2 = Math.max(dz1, z - 20), zm = (z + z2) / 2, L = (z - z2) / 2;
    wbox(mb, x, B.deck, zm, B.half + 1, 0.45, L, 0, lin('#4a4846'), KIND.asphalt, 0);
    for (const sx of [-1, 1]) {
      wbox(mb, x + sx * (B.half + 0.6), B.deck - 2.6, zm, 0.35, 2.4, L, 0, RED, K_M, 0, 1 | 2 | 16 | 32);
      wbox(mb, x + sx * (B.half - 0.6), dt + 0.12, zm, 1.2, 0.12, L, 0, lin('#b8b0a2'), KIND.concrete, 0, 4 | 1 | 2);
      wbox(mb, x + sx * (B.half + 0.45), dt + 1.15, zm, 0.06, 0.05, L, 0, RED, K_M, 0);
      wbox(mb, x + sx * (B.half + 0.45), dt + 0.65, zm, 0.04, 0.04, L, 0, RED, K_M, 0);
      // lane lines (dashed) and the double yellow
      for (let q = z - 1; q > z2; q -= 6) wbox(mb, x + sx * 4.2, dt + 0.005, q - 1.5, 0.08, 0.004, 1.5, 0, WHITEP, KIND.paint, 0, 4);
      wbox(mb, x + sx * 0.18, dt + 0.005, zm, 0.06, 0.004, L, 0, YELLOWP, KIND.paint, 0, 4);
    }
    wbox(mb, x, B.deck - 5.1, zm, B.half + 0.6, 0.25, L, 0, REDD, K_M, 0);
  }
  for (const sx of [-1, 1]) {
    // railing posts, deck lamps
    for (let z = dz0 - 2; z > dz1; z -= 4) wbox(mb, x + sx * (B.half + 0.45), dt + 0.6, z, 0.06, 0.6, 0.06, 0, RED, K_M, 0, 1 | 2 | 16 | 32);
    for (let z = dz0 - 25; z > dz1; z -= 50) {
      mb.geo(T.cyl8, TRS(x + sx * (B.half + 0.6), dt + 3, z, 0, 0, 0, 0.09, 6, 0.09), RED, K_M, 0);
      mb.geo(T.sph8, TRS(x + sx * (B.half - 0.2), dt + 5.9, z, 0, 0, 0, 0.22, 0.26, 0.22), LAMPC, KIND.glow, 1.4);
      LAMPS.push([x + sx * (B.half - 0.2), dt + 5.85, z]);
    }
    // Warren truss under the deck edge: posts and alternating diagonals
    let flip = 1;
    for (let z = dz0; z > dz1 + 7.5; z -= 7.5) {
      const xs = x + sx * (B.half + 0.6), yb = B.deck - 5.0, yt = B.deck - 0.4;
      wbox(mb, xs, (yb + yt) / 2, z, 0.25, (yt - yb) / 2, 0.25, 0, RED, K_M, 0, 1 | 2 | 16 | 32);
      const za = flip > 0 ? z : z - 7.5, zb = flip > 0 ? z - 7.5 : z;
      const mz = (za + zb) / 2, my = (yb + yt) / 2, Ld = Math.hypot(7.5, yt - yb);
      _q4.setFromUnitVectors(_gv.set(0, 1, 0), _gn.set(0, yt - yb, zb - za).normalize());
      _m4.compose(_p4.set(xs, my, mz), _q4, _s4.set(0.35, Ld, 0.3));
      mb.geo(T.box, _m4, REDD, K_M, 0);
      flip = -flip;
    }
  }
  // approach pillars to the shores
  for (let z = dz0 + 10; z > dz1; z -= 60) if (z > B.zS + 20 || z < B.zN - 20) {
    wbox(mb, x, (B.deck - 5) / 2 - 3, z, 6, (B.deck - 5) / 2 + 3, 2.4, 0, RED, K_M, 0);
    wbox(mb, x, B.deck - 6.2, z, 6.6, 0.6, 2.8, 0, REDD, K_M, 0);
  }
  // main cables (catenary between the towers, straight to the anchorages) and steel suspenders
  const cableY = z => {
    if (z > B.zS) return lerp(B.deck + 2, B.top - 2, (B.zA + 20 - z) / (B.zA + 20 - B.zS));
    if (z < B.zN) return lerp(B.top - 2, B.deck + 2, (B.zN - z) / (B.zN - B.zB + 20));
    const u = (z - (B.zS + B.zN) / 2) / ((B.zS - B.zN) / 2);
    return B.deck + 3.5 + (B.top - 2 - B.deck - 3.5) * u * u;
  };
  B.cableY = cableY;
  for (const sx of [-1, 1]) {
    let prev = null;
    for (let z = B.zA + 20; z >= B.zB - 20; z -= 8) {
      const p = [x + sx * B.half, cableY(z), z];
      if (prev) {
        const mx = (p[0] + prev[0]) / 2, my = (p[1] + prev[1]) / 2, mz = (p[2] + prev[2]) / 2;
        const L = Math.hypot(p[1] - prev[1], p[2] - prev[2]);
        _q4.setFromUnitVectors(_gv.set(0, 1, 0), _gn.set(0, p[1] - prev[1], p[2] - prev[2]).normalize());
        _m4.compose(_p4.set(mx, my, mz), _q4, _s4.set(0.55, L + 0.1, 0.55));
        mb.geo(T.cyl8, _m4, RED, K_M, 0);
      }
      prev = p;
      if (z < B.zS - 4 && z > B.zN + 4) {
        const h = p[1] - dt;
        wbox(mb, p[0], dt + h / 2, z, 0.09, h / 2, 0.09, 0, RIB, K_M, 0, 1 | 2 | 16 | 32);
      }
    }
  }
  // the goal pad at mid-span
  const gz = B.goalZ;
  for (let k = 0; k < 20; k++) {
    const a0 = (k / 20) * TAU, a1 = ((k + 1) / 20) * TAU, r0 = 6.5;
    mb.tri([x, B.deck + 0.5, gz], [x + Math.cos(a1) * r0, B.deck + 0.5, gz + Math.sin(a1) * r0], [x + Math.cos(a0) * r0, B.deck + 0.5, gz + Math.sin(a0) * r0], k % 2 ? lin('#ffd23f') : lin('#2f5bff'), KIND.glow, 0.5);
  }
  void r; void STEELW;
  return [];
}
function buildIsland(mb, r) {
  const ix = 380, iz = -2100, T = templates();
  const g = new THREE.SphereGeometry(1, 28, 10, 0, TAU, 0, Math.PI / 2);
  const pa = g.attributes.position;
  for (let k = 0; k < pa.count; k++) {
    const x = pa.getX(k), y = pa.getY(k), z = pa.getZ(k);
    const n = 0.85 + 0.3 * hash(Math.round(x * 40) * 3.1 + Math.round(z * 40) * 7.7);
    pa.setXYZ(k, x * 95 * (y > 0.05 ? n : 1), Math.pow(y, 0.55) * 26 - 3, z * 62 * (y > 0.05 ? n : 1));
  }
  g.computeVertexNormals();
  mb.geo(g, TRS(ix, 0, iz, 0, 0.3, 0), lin('#8c7d68'), KIND.stone, 0, 30, 10);
  // green cap, cell house, lighthouse, water tower
  mb.geo(T.sph12, TRS(ix - 10, 19, iz + 4, 0, 0.3, 0, 60, 6, 36), lin('#5d6e45'), KIND.leaf, 0);
  const F = frameAt(ix + 6, 22, iz - 4, Math.sin(0.3), Math.cos(0.3));
  fbox(mb, F, -32, 32, 0, 13, -9, 9, lin('#d9d2c2'), KIND.facade, 0.4, 1 | 2 | 4 | 16 | 32);
  fbox(mb, frameAt(ix - 40, 18, iz + 10, 0, 1), -10, 10, 0, 7, -8, 8, lin('#cfc6b4'), KIND.facade, 0.3, 1 | 2 | 4 | 16 | 32);
  mb.geo(T.cyl8, TRS(ix + 44, 33, iz - 6, 0, 0, 0, 2.2, 26, 2.2), lin('#efeae0'), KIND.plain, 0);
  mb.geo(T.sph8, TRS(ix + 44, 47, iz - 6, 0, 0, 0, 1.8, 1.8, 1.8), lin('#fff1c0'), KIND.glow, 3.0);
  LAMPS.push([ix + 44, 47, iz - 6, 2]);
  mb.geo(T.cyl8, TRS(ix - 28, 32, iz - 20, 0, 0, 0, 4.5, 6, 4.5), lin('#bfb6a6'), KIND.plain, 0);
  for (const [a, b] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) mb.geo(T.cyl8, TRS(ix - 28 + a, 24, iz - 20 + b, 0, 0, 0, 0.3, 12, 0.3), lin('#6a6460'), KIND.metal, 0);
  void r;
}

// ===================== golden hour: sun, sky, haze, the bay =====================
const SUN_DIR = new V3(-0.92, 0.2, -0.33).normalize();
const SUN_HEX = '#ffb47a';
const FOG_HEX = '#d9a184';
const SKY_UNI = {
  uSun: uniform(SUN_DIR.clone()), uTime: U.time, uHDR: U.hdr,
  uZen: uniform(lin('#232a63')), uMid: uniform(lin('#b47d93')), uHor: uniform(lin('#ffb27a')),
  uHaze: uniform(lin(FOG_HEX)), uSunCol: uniform(lin('#ffd2a0'))
};
// cloud fbm: value noise, 5 octaves, rotated between octaves (no grid streaks)
function skyFbm(p, oct) {
  let s = float(0), a = 0.5, q = p, tot = 0;
  for (let i = 0; i < oct; i++) {
    s = s.add(TL.vnoise(q).mul(a)); tot += a; a *= 0.5;
    q = vec2(q.x.mul(1.6).sub(q.y.mul(1.2)), q.x.mul(1.2).add(q.y.mul(1.6))).add(vec2(3.1, 1.7));
  }
  return s.div(tot);
}
// golden-hour sky toward direction d (unit vec3 node); clouds: 0..1 (JS number of cloud octaves' weight)
// Gradient: warm horizon toward the low sun, the pink "belt" and the cool earth shadow opposite it, a violet zenith;
// a deck of altocumulus projected on a plane (domain-warped fbm) lit from the sun's side (gold edges near it, lavender
// undersides away from it); haze under the horizon. Branch-free (masks), shared by the dome, the bay and the PMREM.
function skyCol(d, hdr, t, clouds) {
  const S = SKY_UNI, h = d.y;
  const sd = tmax(tdot(d, S.uSun), 0);
  const hd = vec3(d.x, 0, d.z), sh = vec3(S.uSun.x, 0, S.uSun.z);
  const azc = tdot(hd.mul(inverseSqrt(tmax(tdot(hd, hd), 1e-6))), sh.mul(inverseSqrt(tmax(tdot(sh, sh), 1e-6))));
  const az = tpow(tmax(azc, 0), 2), anti = tpow(tmax(azc.negate(), 0), 1.5);
  // horizon: gold toward the sun, pink belt / cool earth shadow away from it
  const belt = vec3(0.86, 0.55, 0.62), earth = vec3(0.42, 0.42, 0.62);
  const horAway = mix(mix(S.uHaze, belt, 0.5), mix(earth, belt, smoothstep(0.02, 0.09, h)), anti);
  const hor = mix(horAway, S.uHor, az);
  let col = mix(mix(hor, S.uMid, smoothstep(0.0, 0.24, h)), S.uZen, smoothstep(0.14, 0.8, h));
  // broad warm Mie glow round the low sun
  col = col.add(vec3(1.0, 0.5, 0.2).mul(tpow(sd, 6).mul(0.32).add(tpow(sd, 24).mul(0.22))).mul(float(1).sub(smoothstep(-0.05, 0.45, h))));
  // under the horizon: haze
  col = mix(col, S.uHaze.mul(0.9), float(1).sub(smoothstep(-0.08, 0.0, h)));
  if (clouds > 0) {
    const cp = d.xz.div(tmax(h.add(0.1), 0.04)).mul(0.9);
    const wind = vec2(t.mul(0.012), t.mul(0.004));
    const warp = vec2(skyFbm(cp.mul(0.35).add(wind), 3), skyFbm(cp.mul(0.35).add(vec2(5.2, 1.3)), 3)).sub(0.5).mul(2.4);
    const q = cp.add(warp).add(wind.mul(2));
    const n = skyFbm(q, 5);
    // density toward the sun (projected): lit edges where the cloud thins toward the light
    const sdir = vec2(S.uSun.x, S.uSun.z).mul(0.35);
    const n2 = skyFbm(q.add(sdir), 5);
    const band = smoothstep(0.025, 0.1, h).mul(float(1).sub(smoothstep(0.42, 0.75, h)));
    const cov = mix(float(0.5), float(0.42), TL.vnoise(cp.mul(0.12)));
    const c = smoothstep(cov, cov.add(0.22), n).mul(band);
    const lightT = tclamp(n.sub(n2).mul(5).add(0.55), 0, 1);
    const litC = mix(vec3(0.98, 0.55, 0.52), vec3(1.0, 0.7, 0.42), az).mul(hdr.mul(0.45).mul(az).add(0.82));
    const shadeC = mix(vec3(0.33, 0.27, 0.43), vec3(0.52, 0.33, 0.4), az);
    let cc = mix(shadeC, litC, lightT);
    // silver lining: thin cloud edges next to the sun
    const edge = c.mul(float(1).sub(c)).mul(4).mul(tpow(sd, 12)).mul(hdr.mul(1.6).add(0.4));
    cc = cc.add(vec3(1.0, 0.75, 0.45).mul(edge));
    col = mix(col, cc, c.mul(0.9 * clouds));
  }
  return col;
}
function skyMaterial() {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
  const S = SKY_UNI, hdr = S.uHDR;
  const d = tnormalize(positionGeometry);
  let col = skyCol(d, hdr, S.uTime, 1);
  const sd = tmax(tdot(d, S.uSun), 0);
  col = col.add(S.uSunCol.mul(tpow(sd, 900).mul(1.6).add(tpow(sd, 90).mul(0.45)).add(tpow(sd, 12).mul(0.12))));
  // the disc (limb-darkened) and its core, HDR so the bloom and the lens flare pick it up
  const disc = smoothstep(0.99955, 0.9998, sd);
  col = col.add(S.uSunCol.mul(hdr).mul(disc.mul(smoothstep(0.99955, 0.99995, sd).mul(0.4).add(0.6)).mul(22).add(tpow(sd, 400).mul(2))));
  m.colorNode = mix(tmin(col, vec3(1)), col, hdr);
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(positionLocal.add(cameraPosition), 1));
  m.vertexNode = vec4(clip.xy, clip.w.mul(0.99999), clip.w);
  return m;
}
// The bay: the golden-hour sky reflected analytically (crisp clouds, Fresnel), wind waves (directional swells + two
// noise ripple layers, calmer with distance), a dark teal body with sun-side scattering, the sun's glitter path and
// sparkles (HDR), foam where the water meets the piles, the sea wall and the piers (scene depth, when the pipeline runs),
// and screen-space reflections of the city and the bridge on Ultra / Élevé (K.post.ssr; the wave normal goes to the
// G-buffer through normalNode). Transparent (drawn after the opaque scene so it can read its depth), depth-writing.
function waterMaterial() {
  const m = new THREE.MeshBasicNodeMaterial({ fog: true, transparent: true, depthWrite: true });
  const S = SKY_UNI, hdr = S.uHDR, t = S.uTime;
  const uDeep = uniform(lin('#0f2f3f')), uShallow = uniform(lin('#2b6670'));
  const wp = positionWorld, p = wp.xz;
  const Vd = tnormalize(cameraPosition.sub(wp));
  const dist = tlength(cameraPosition.sub(wp));
  let g = vec2(0.8, 0.3).mul(tcos(tdot(p, vec2(0.11, 0.05)).add(t.mul(1.1))).mul(0.11))
    .add(vec2(-0.3, 0.9).mul(tcos(tdot(p, vec2(-0.04, 0.17)).add(t.mul(1.4))).mul(0.085)))
    .add(vec2(0.6, -0.7).mul(tcos(tdot(p, vec2(0.31, -0.27)).add(t.mul(2.2))).mul(0.05)))
    .add(vec2(-0.9, -0.2).mul(tcos(tdot(p, vec2(-0.52, 0.21)).add(t.mul(2.9))).mul(0.03)))
    .add(vec2(TL.vnoise(p.mul(0.9).add(t.mul(0.6))), TL.vnoise(p.mul(0.9).sub(t.mul(0.5)).add(7))).sub(0.5).mul(0.15))
    .add(vec2(TL.vnoise(p.mul(3.3).sub(t.mul(0.9))), TL.vnoise(p.mul(3.3).add(t.mul(1.1)).add(3))).sub(0.5).mul(0.08))
    .add(vec2(TL.vnoise(p.mul(8.1).add(t.mul(1.7))), TL.vnoise(p.mul(8.1).sub(t.mul(1.3)).add(11))).sub(0.5).mul(0.035));
  g = g.mul(mix(float(1), float(0.3), smoothstep(60.0, 900.0, dist)));
  const N = tnormalize(vec3(g.x.negate(), 1, g.y.negate()));
  const fr = tpow(float(1).sub(tmax(tdot(N, Vd), 0)), 5).mul(0.97).add(0.03);
  const Rr = treflect(Vd.negate(), N);
  const refl = skyCol(vec3(Rr.x, tabs(Rr.y), Rr.z), hdr, t, 0.7);
  // body: dark teal, a little lighter on the wave faces lit through by the low sun
  const scat = tpow(tmax(tdot(Vd, vec3(S.uSun.x, 0, S.uSun.z).negate().normalize()), 0), 3).mul(tclamp(g.x.mul(S.uSun.x).add(g.y.mul(S.uSun.z)).mul(-3).add(0.3), 0, 1));
  const base = mix(uShallow, uDeep, smoothstep(0.0, 0.6, Vd.y)).mul(0.6).add(vec3(0.25, 0.45, 0.35).mul(scat).mul(0.35));
  let col = mix(base, refl, tclamp(fr.mul(1.1), 0, 1));
  const Hh = tnormalize(S.uSun.add(Vd));
  const nh = tmax(tdot(N, Hh), 0);
  const sp = tpow(nh, 280).mul(hdr.mul(5.5).add(1.4)).add(tpow(nh, 40).mul(0.2));
  const sparkle = tstep(0.86, TL.hash21(tfloor(p.mul(2)).add(tfloor(t.mul(6))))).mul(tpow(nh, 30)).mul(hdr.mul(6).add(0.8));
  col = col.add(S.uSunCol.mul(sp.add(sparkle)).mul(vec3(1.0, 0.82, 0.6)));
  // foam where something stands in the water (opaque depth just behind the surface)
  let foam = float(0);
  const sdN = K.post && typeof K.post.sceneDepth === 'function' ? K.post.sceneDepth() : null;
  if (sdN && TSL.perspectiveDepthToViewZ && TSL.cameraNear && TSL.cameraFar) {
    const zs = TSL.perspectiveDepthToViewZ(sdN.x, TSL.cameraNear, TSL.cameraFar);
    const thick = tmax(positionView.z.sub(zs), 0);
    const fn = TL.vnoise(p.mul(1.6).add(vec2(t.mul(0.3), t.mul(-0.2)))).mul(0.6).add(TL.vnoise(p.mul(5.3).sub(t.mul(0.5))).mul(0.4));
    foam = float(1).sub(smoothstep(0.0, 1.6, thick.add(fn.mul(0.9)))).mul(smoothstep(0.25, 0.6, fn.add(float(1).sub(smoothstep(0.0, 0.5, thick)).mul(0.5)))).mul(float(1).sub(smoothstep(150.0, 400.0, dist)));
    foam = foam.toVar('cFoam');
  }
  col = mix(col, vec3(0.95, 0.9, 0.86).mul(mix(float(0.8), float(1.1), hdr)), foam.mul(0.85));
  m.colorNode = mix(tmin(col, vec3(1)), col, hdr);
  m.normalNode = tnormalize(cameraViewMatrix.mul(vec4(N, 0)).xyz);
  if (K.post && typeof K.post.ssr === 'function') {
    try { K.post.ssr(m, float(0.9).mul(float(1).sub(foam)), 0.03); } catch (e) { console.warn('Kit Rush 3D: water SSR opt-in failed', e); }
  }
  return m;
}
// camera-facing billboard: clip position of an instance centre c (local vec3 node) with the quad corner scaled by size
const billboard = (c, size) => cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(c, 1)).add(vec4(positionGeometry.xy.mul(size), 0, 0)));
const viewDepth = c => modelViewMatrix.mul(vec4(c, 1)).z.negate();
// soft glow billboards (lamps, aviation lights, the lighthouse): one instanced quad, camera-facing, additive
// PORT(city): v2 GLSL billboards ported 1:1 to TSL (vertexNode); v3: real emissive lamp heads + bloom, light cones.
function glowMesh(points) {
  const n = Math.max(1, points.length);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const off = new Float32Array(n * 4);
  points.forEach((p, i) => { off[i * 4] = p[0]; off[i * 4 + 1] = p[1]; off[i * 4 + 2] = p[2]; off[i * 4 + 3] = p[3] || 0; });
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  g.instanceCount = points.length;
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const aOff = attribute('aOff', 'vec4'), kind = aOff.w;
  const c = select(kind.lessThan(0.5), vec3(1.0, 0.72, 0.38), select(kind.lessThan(1.5), vec3(1.0, 0.12, 0.08), vec3(1.0, 0.92, 0.7)));
  const blink = select(kind.greaterThan(0.5).and(kind.lessThan(1.5)), tstep(0.5, tfract(U.time.mul(0.7).add(aOff.x.mul(0.01)))).mul(0.65).add(0.35), float(1));
  const d = viewDepth(aOff.xyz);
  const size = select(kind.lessThan(0.5), float(1.1).mul(d.mul(0.004).add(1)), select(kind.lessThan(1.5), float(6), float(9)).mul(d.mul(0.0015).add(1)));
  m.vertexNode = billboard(aOff.xyz, size);
  const q = positionGeometry.xy, r = tlength(q);
  const a = texp(r.mul(r).mul(-5)).mul(0.8).add(texp(r.mul(r).mul(-40)).mul(0.6)).mul(float(1).sub(smoothstep(0.85, 1.0, r)));
  m.colorNode = c.mul(a).mul(smoothstep(2.0, 12.0, d).mul(blink)).mul(mix(float(0.55), float(1.6), U.hdr));
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = 5;
  return mesh;
}
// manhole steam: rising, growing, fading puffs lit by the sunset
function steamMesh(vents) {
  const per = 7, n = Math.max(1, vents.length * per);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const off = new Float32Array(n * 4);
  vents.forEach((v, i) => { for (let k = 0; k < per; k++) { const j = (i * per + k) * 4; off[j] = v[0]; off[j + 1] = v[1]; off[j + 2] = v[2]; off[j + 3] = k / per + v[3] * 0.13; } });
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  g.instanceCount = vents.length * per;
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  const aOff = attribute('aOff', 'vec4');
  const ph = tfract(U.time.mul(0.16).add(aOff.w));
  const c0 = aOff.xyz.add(vec3(tsin(ph.mul(6).add(aOff.w.mul(30))).mul(0.6).add(ph.mul(2.5)), ph.mul(7).add(0.2), tcos(ph.mul(5).add(aOff.w.mul(20))).mul(0.6)));
  m.vertexNode = billboard(c0, ph.mul(3.2).add(0.6));
  const q = positionGeometry.xy, r = tlength(q);
  const vA = smoothstep(0.0, 0.12, ph).mul(float(1).sub(smoothstep(0.45, 1.0, ph)));
  const uLit = uniform(lin('#ffc9a0')), uShade = uniform(lin('#9a8ea8'));
  m.colorNode = mix(uShade, uLit.mul(mix(float(1), float(1.6), U.hdr)), smoothstep(-0.6, 0.8, q.x.mul(0.7).add(q.y.mul(0.5))));
  m.opacityNode = smoothstep(1.0, 0.1, r).mul(vA).mul(0.32);
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = 6;
  return mesh;
}
// fog banks rolling in under the bridge from the ocean: big soft billboards lit by the low sun
function fogTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const R = rng(77);
  for (let k = 0; k < 40; k++) {
    const x = 20 + R() * 88, y = 40 + R() * 50, rr = 12 + R() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}
function fogMesh() {
  const R = rng(4242), pts = [];
  // a bank along the ocean side of the bridge, thinning over the bay
  for (let k = 0; k < 46; k++) {
    const z = lerp(BRIDGE.zA + 60, BRIDGE.zB - 120, R());
    const x = BRIDGE.x - 60 - R() * 700;
    pts.push([x, 6 + R() * 22, z, 70 + R() * 90]);
  }
  for (let k = 0; k < 14; k++) pts.push([BRIDGE.x + 40 + R() * 260, 4 + R() * 8, lerp(-1700, -2200, R()), 60 + R() * 60]);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, -1, 0.5, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const off = new Float32Array(pts.length * 4);
  pts.forEach((p, i) => off.set(p, i * 4));
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  g.instanceCount = pts.length;
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  const aOff = attribute('aOff', 'vec4');
  const c0 = aOff.xyz.add(vec3(tsin(U.time.mul(0.05).add(aOff.x)).mul(8), 0, 0));
  m.vertexNode = billboard(c0, aOff.w);
  const tx = ttexture(fogTexture(), tuv());
  const uLit = uniform(lin('#ffd4b0')), uShade = uniform(lin('#b9a3b3'));
  m.colorNode = mix(uShade, uLit.mul(mix(float(1), float(1.35), U.hdr)), smoothstep(0.2, 0.9, tuv().y));
  m.opacityNode = tx.a.mul(0.85).mul(smoothstep(30.0, 160.0, viewDepth(c0)));
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = 4;
  return mesh;
}
// flags and pennants: cloth waving in a vertex shader
function flagMesh(list) {
  const mb = new MB();
  const cols = [['#ff7a1a', '#17b6c3'], ['#2f5bff', '#ffd23f'], ['#e8344a', '#fff4e6']];
  for (const f of list) {
    const [ca, cb] = cols[f.c % cols.length].map(lin);
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
    const NX = 8;
    for (let i = 0; i < NX; i++) {
      const u0 = i / NX, u1 = (i + 1) / NX;
      for (const [v0, v1, cc] of [[0, 0.5, ca], [0.5, 1, cb]]) {
        const P = (u, v) => [f.p[0] + c * u * f.w, f.p[1] - v * f.h, f.p[2] - s * u * f.w];
        mb.quad(P(u0, v1), P(u1, v1), P(u1, v0), P(u0, v0), cc, KIND.plain, 0, u1 - u0, v1 - v0, u0, 1 - v1);
        mb.quad(P(u1, v1), P(u0, v1), P(u0, v0), P(u1, v0), cc, KIND.plain, 0, u0 - u1, v1 - v0, u1, 1 - v1);
      }
    }
  }
  const g = mb.build();
  // cloth waving (vertex animation along the fly, aUv.x = 0 at the hoist) — PORT(city): v2 GLSL ported 1:1 (positionNode)
  const m = cityMaterial({
    position: p => {
      const fu = attribute('aUv', 'vec2').x, t = U.time;
      const wave = tsin(t.mul(6).sub(fu.mul(7)).add(positionGeometry.x.mul(0.3))).mul(0.35).mul(fu).add(tsin(t.mul(9.3).sub(fu.mul(12))).mul(0.08).mul(fu));
      return p.add(vec3(normalGeometry.x.mul(wave), wave.mul(0.25), normalGeometry.z.mul(wave)));
    }
  });
  m.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = false;
  return mesh;
}
// gulls circling over the waterfront and the pier
function gullMesh(center) {
  const mb = new MB(), W = lin('#f4f2ee'), G = lin('#8a8f96');
  const N = 9;
  for (let k = 0; k < N; k++) {
    const id = k / N;
    // each gull: two wing quads; aUv.x = wing side (-1 / 1), aUv.y = gull id
    mb.quad([0, 0, -0.3], [0, 0, 0.3], [-1.1, 0.15, 0.1], [-1.1, 0.15, -0.2], W, KIND.plain, 0, 0, 0, -1, id);
    mb.quad([0, 0, 0.3], [0, 0, -0.3], [1.1, 0.15, -0.2], [1.1, 0.15, 0.1], W, KIND.plain, 0, 0, 0, 1, id);
    mb.quad([-0.12, -0.05, -0.5], [0.12, -0.05, -0.5], [0.12, -0.05, 0.5], [-0.12, -0.05, 0.5], G, KIND.plain, 0, 0, 0, 0, id);
  }
  const g = mb.build();
  // each gull flaps and circles (vertex animation: aUv.x = wing side, aUv.y = gull id) — PORT(city): v2 GLSL ported 1:1
  const C = uniform(new V3(center[0], center[1], center[2]));
  const m = cityMaterial({
    position: p => {
      const t = U.time, au = attribute('aUv', 'vec2'), id = au.y, side = au.x;
      const flap = tsin(t.mul(7).add(id.mul(40))).mul(0.6);
      const y = p.y.add(select(side.notEqual(0), tabs(p.x).mul(flap), float(0)));
      const a = t.mul(id.mul(0.15).add(0.25)).add(id.mul(6.283));
      const rad = id.mul(26).add(18);
      const c = C.add(vec3(tcos(a).mul(rad), id.mul(9).add(10).add(tsin(t.mul(0.7).add(id.mul(9))).mul(2)), tsin(a).mul(rad)));
      const yaw = a.negate(), cy = tcos(yaw), sy = tsin(yaw);
      return vec3(p.x.mul(cy).sub(p.z.mul(sy)), y, p.x.mul(sy).add(p.z.mul(cy))).mul(1.3).add(c);
    }
  });
  m.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return mesh;
}
function buildSails(mb, r) {
  for (let k = 0; k < 9; k++) {
    const x = -300 + r() * 1300, z = -1520 - r() * 520;
    if (Math.hypot(x - 380, z + 2100) < 140) continue;
    const yaw = r() * TAU, c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (a, y, b) => [x + c * a + s * b, y, z - s * a + c * b];
    wbox(mb, x, 0.4, z, 1.0, 0.45, 3.2, yaw, lin('#f2f0ea'), KIND.plain, 0);
    mb.tri(P(0, 1, -2.4), P(0, 1, 1.6), P(0, 11, 0.6), lin('#fbf8f0'), KIND.plain, 0);
    mb.tri(P(0, 1, 1.6), P(0, 1, -2.4), P(0, 11, 0.6), lin('#fbf8f0'), KIND.plain, 0);
    mb.tri(P(0, 1, 1.8), P(0, 1, 3.4), P(0, 8, 1.8), lin('#ff8a3a'), KIND.plain, 0);
    mb.tri(P(0, 1, 3.4), P(0, 1, 1.8), P(0, 8, 1.8), lin('#ff8a3a'), KIND.plain, 0);
  }
}

// ===================== vehicles =====================
// The vehicle types, their geometry, paints, lamps and the walkable-top profile live in 26-vehicles.js (K.vehicles);
// these aliases are bound in build() (K.vehicles is defined by a later part).
let VT = null, vehicleTop = null;
// ===================== traffic =====================
const TR = { pool: [], active: [], lanes: [[], []], cross: [], built: false, seed: 1, kS: 0, kV: 0 };
function makeCar(type, idx) {
  const t = VT[type];
  return {
    type, idx, on: false, kind: 'main', lane: 0, dir: 1, s: 0, d: 0, v: 0, vWant: 0,
    pos: new V3(), quat: new THREE.Quaternion(), half: new V3(t.hx, t.hy, t.hz), vel: new V3(),
    lx: 0, ly: 0, lz: 0, yaw: 0, pitch: 0, cs: 1, sn: 0, tp: 0, r: Math.hypot(t.hx, t.hz) + 0.5,
    xs: null, xo: 0, xt: 0, xwait: 0, y0: 0, hitT: 0, fixed: false, runner: false, warned: false, dT: 0, dv: 0, pull: 0, hz: null
  };
}
const MESH = { veh: [], beams: null, rings: null, dash: null };
function buildTraffic(group) {
  const KV = K.vehicles;
  const counts = [16, 6, 6, 3, 2, 1, 3, 3];
  let id = 0;
  for (let t = 0; t < VT.length; t++) {
    const { geometry: geo, material: mat } = KV.build(t);
    const im = new THREE.InstancedMesh(geo, mat, counts[t]);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
    const c = new THREE.Color();
    for (let i = 0; i < counts[t]; i++) {
      im.setMatrixAt(i, ZERO_M);
      c.copy(KV.paint(t, i));
      im.setColorAt(i, c);
      const car = makeCar(t, i);
      car.id = id++;
      TR.pool.push(car);
    }
    im.instanceColor.needsUpdate = true;
    group.add(im);
    MESH.veh.push(im);
  }
  TR.built = true;
}
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
function freeCar(type) { for (const c of TR.pool) if (!c.on && c.type === type) return c; return null; }
const _cq = new THREE.Quaternion(), _ce = new THREE.Euler(0, 0, 0, 'YXZ'), _cm = new THREE.Matrix4(), _cs = new V3(1, 1, 1), _cp = new V3();
function placeCar(c) {
  // world pose from (s, d) on the route or the cross street
  const t = VT[c.type];
  let x, y, z, yaw, pitch;
  if (c.kind === 'cross') {
    const X = c.xs;
    frame(X.s, FB);
    const d = c.xt, o = c.xo;
    x = FB.x + FB.rx * d + FB.dx * o; z = FB.z + FB.rz * d + FB.dz * o;
    const sl = d > 0 ? X.slopeR : X.slopeL, ad = Math.abs(d);
    y = FB.y + (ad > XSIDE ? sl * (ad - XSIDE) : 0);
    const fx = FB.rx * c.dir, fz = FB.rz * c.dir;
    yaw = Math.atan2(fx, fz);
    pitch = ad > XSIDE ? Math.atan(sl * Math.sign(d) * c.dir) : 0;
  } else {
    frame(c.s, FB);
    x = FB.x + FB.rx * c.d; z = FB.z + FB.rz * c.d;
    y = FB.y;
    yaw = Math.atan2(FB.dx * c.dir, FB.dz * c.dir);
    if (c.dv !== 0 && c.v > 1) yaw -= Math.atan2(c.dv, c.v) * c.dir;
    pitch = Math.atan(FB.g * c.dir);
  }
  c.lx = x; c.lz = z; c.ly = y; c.yaw = yaw; c.pitch = pitch;
  c.cs = Math.cos(yaw); c.sn = Math.sin(yaw); c.tp = Math.tan(pitch);
  _ce.set(-pitch, yaw, 0, 'YXZ');
  c.quat.setFromEuler(_ce);
  // box centre (world)
  _cp.set(0, t.hy, 0).applyQuaternion(c.quat);
  c.pos.set(x + OX + _cp.x, y + _cp.y, z + OZ + _cp.z);
  _cm.compose(_cp.set(x, y, z), c.quat, _cs);
  MESH.veh[c.type].setMatrixAt(c.idx, _cm);
}
function hideCar(c) { c.on = false; c.vel.set(0, 0, 0); MESH.veh[c.type].setMatrixAt(c.idx, ZERO_M); }
let R_TR = rng(99);
function spawnMain(lane, s) {
  const r = R_TR();
  // buses only climb (Kit's lane queues behind double-parked vans: everything there must be jumpable)
  const type = r < 0.08 ? (lane === 1 ? 3 : 2) : r < 0.24 ? 2 : r < 0.42 ? 1 : 0;
  const c = freeCar(type) || freeCar(0) || freeCar(1);
  if (!c) return null;
  c.on = true; c.kind = 'main'; c.lane = lane; c.dir = lane === 0 ? 1 : -1; c.d = lane === 0 ? LANE : -LANE;
  c.s = s; c.vWant = (lane === 0 ? 12.5 : 11) + R_TR() * 4.5; if (c.type === 3) c.vWant -= 2.5; c.v = c.vWant; c.dv = 0; c.pull = 0; c.hz = null;
  TR.lanes[lane].push(c);
  placeCar(c);
  return c;
}
const MAIN_END = () => FEAT.t4a - 25;
function laneFront(lane) { let m = -1e9; for (const c of TR.lanes[lane]) if (c.s > m) m = c.s; return m; }
function trafficReset(sK, full) {
  for (const c of TR.pool) { hideCar(c); c.fixed = c.runner = c.warned = false; c.pull = 0; c.dv = 0; c.hz = null; }
  TR.lanes[0].length = 0; TR.lanes[1].length = 0; TR.cross.length = 0;
  R_TR = rng(99 + Math.floor(sK));
  TR.kS = sK;
  // fill both lanes ahead of Kit; nothing right in front of him at a (re)start
  for (const lane of [0, 1]) {
    let s = sK + (lane === 0 ? 120 : 160);
    while (s < sK + 520 && s < MAIN_END()) { spawnMain(lane, s); s += 55 + R_TR() * 50; }
  }
  // the special vehicles
  specials(sK);
  // a stop-sign runner goes once per run: respawning at a checkpoint does not replay the same ambush
  for (const X of XS) { X.next = 1 + R_TR() * 3; X.cars = 0; X.ran = !full && !!X.ran; }
  for (const h of HZ) {
    const c = freeCar(h.type);
    h.car = c; h.armed = true;
    if (!c) continue;
    c.on = true; c.kind = 'main'; c.fixed = true; c.lane = -1; c.dir = 1; c.s = h.s; c.d = h.d; c.v = c.vWant = 0; c.dv = 0;
    placeCar(c); c.vel.set(0, 0, 0);
  }
}
function specials(sK) {
  const put = (type, lane, s, v) => {
    const c = freeCar(type);
    if (!c || s < sK + 60 || s > MAIN_END()) return;
    c.on = true; c.kind = 'main'; c.lane = lane; c.dir = lane === 0 ? 1 : -1; c.d = lane === 0 ? LANE : -LANE; c.s = s; c.vWant = c.v = v; c.special = true; c.dv = 0; c.pull = 0; c.hz = null;
    TR.lanes[lane].push(c); placeCar(c);
  };
  // cable cars climbing streets A and C, the vintage streetcar on the waterfront
  if (sK < FEAT.iA4) put(4, 1, Math.max(FEAT.iA3 + 40, Math.min(FEAT.iA4 - 20, sK + 330)), 4.5);
  if (sK < FEAT.iC3) put(4, 1, Math.max(FEAT.iC1 + 60, Math.min(FEAT.iC3 + 40, sK + 360)), 4.5);
  if (sK < FEAT.iW) put(5, 1, Math.max(FEAT.t3b + 80, Math.min(FEAT.t4a - 60, sK + 300)), 6.5);
}
const BY_S_UP = (a, b) => a.s - b.s, BY_S_DOWN = (a, b) => b.s - a.s;
// how far cross traffic runs on one side of a crossing (a dead end ends behind the next street's houses)
function crossReach(X, sd) { return Math.max(XSIDE, Math.min(150, (sd > 0 ? X.reachR : X.reachL) - 8)); }
// a car in Kit's lane meeting a double-parked van: queue behind it; the first in the queue pulls out round it when Kit is
// about 1.4 s behind (once per pass), the others wait for Kit to go by; with Kit far away they simply drive round it
function passVan(c, lead, v, sK, vK) {
  if (c.pull === 1) {
    const h = c.hz;
    if (!h || c.s > h.s + h.car.half.z + c.half.z + 3) { c.pull = 0; c.hz = null; return v; }
    return Math.min(v, 9);
  }
  let h = null;
  for (let k = 0; k < HZ.length; k++) { const q = HZ[k]; if (q.type === 7 && q.car && q.car.on && q.s > c.s && q.s - c.s < 45) { h = q; break; } }
  if (!h) return v;
  const gap = h.s - c.s - h.car.half.z - c.half.z;
  if (lead && lead.s < h.s) return v; // queued behind another car
  // (a bus is too tall to jump: it waits for Kit to go by)
  const kitGap = c.s - sK, near = ST.kitOn && kitGap > -4 && kitGap < 260;
  const go = !near || (h.armed && c.type <= 2 && kitGap > 0 && kitGap < Math.max(vK, 8) * 1.4 + 4) || sK > h.s + 5;
  if (go) {
    if (near && h.armed) h.armed = false;
    c.pull = 1; c.hz = h;
    return Math.min(v, 9);
  }
  return Math.min(v, Math.max(0, (gap - 2.5) * 1.3));
}
const CP_ON = lin('#3a7bff'), CP_ON_E = lin('#2050ff'), CP_OFF = lin('#ff3b30'), CP_OFF_E = lin('#ff2010');
function trafficUpdate(dt, sK, vK) {
  TR.kS = sK; TR.kV = vK;
  // main lanes: follow the leader, recycle cars that Kit has left behind to the front
  for (let lane = 0; lane < 2; lane++) {
    const L = TR.lanes[lane];
    L.sort(lane === 0 ? BY_S_UP : BY_S_DOWN);
    for (let i = 0; i < L.length; i++) {
      const c = L[i], lead = i < L.length - 1 ? L[i + 1] : null;
      let v = c.vWant;
      if (lead) { const gap = Math.abs(lead.s - c.s) - c.half.z - lead.half.z; v = Math.min(v, Math.max(0, (gap - 6) * 1.2)); }
      // same-direction cars never run Kit down from behind: they ease off when he is ahead in their lane
      if (lane === 0 && ST.kitOn && Math.abs(ST.kitD - c.d) < 2.6 && sK > c.s) { const gap = sK - c.s - c.half.z - 0.6; if (gap < 40) v = Math.min(v, vK * 0.9 + Math.max(0, (gap - 7) * 1.1)); }
      let dT = c.lane === 0 ? LANE : -LANE;
      if (lane === 0 && !c.special) v = passVan(c, lead, v, sK, vK);
      if (c.pull === 1) dT = 0.3;
      c.v += clamp(v - c.v, -14 * dt, 6 * dt);
      c.s += c.v * c.dir * dt;
      const dd = clamp(dT - c.d, -2.6 * dt, 2.6 * dt);
      c.d += dd; c.dv = dd / dt;
    }
    for (let i = L.length - 1; i >= 0; i--) {
      const c = L[i];
      const behind = c.s < sK - 70, past = c.s > MAIN_END() + 40 || c.s < 2;
      if (behind || past) {
        L.splice(i, 1); hideCar(c); c.special = false;
      }
    }
    // keep the lane filled ahead (spawns far ahead, out of sight)
    let front = laneFront(lane);
    let guard = 0;
    while (L.length < 6 && guard++ < 3) {
      const s = Math.max(sK + 380, front + 50 + R_TR() * 45);
      if (s > MAIN_END()) break;
      if (!spawnMain(lane, s)) break;
      front = s;
    }
    for (const c of L) { placeCar(c); c.vel.set(FB.dx * c.dir * c.v + FB.rx * c.dv, FB.g * c.dir * c.v, FB.dz * c.dir * c.v + FB.rz * c.dv); }
  }
  // cross traffic at the crossings Kit is about to reach
  for (const X of XS) {
    if (!X.traffic) continue;
    const ds = X.s - sK;
    if (ds < -60 || ds > 420) continue;
    X.next -= dt;
    if (X.next <= 0 && X.cars < 2) {
      const c = freeCar(R_TR() < 0.2 ? 2 : R_TR() < 0.3 ? 1 : 0);
      if (c) {
        const dir = R_TR() < 0.5 ? 1 : -1;
        c.on = true; c.kind = 'cross'; c.xs = X; c.dir = dir; c.xo = -dir * LANE; c.xt = -dir * crossReach(X, -dir); c.v = c.vWant = 12 + R_TR() * 4; c.xwait = 0; c.runner = false;
        TR.cross.push(c); X.cars++;
      }
      X.next = X.jump ? 2.6 + R_TR() * 2 : 4 + R_TR() * 4;
    }
    // the runner: comes down the side street in plain view and does not stop at the line, timed on Kit's arrival
    const eta = ds / Math.max(vK, 6);
    if (X.runner && !X.ran && ds > 0 && vK > 9 && eta < 5.5) {
      X.ran = true;
      const c = freeCar(R_TR() < 0.5 ? 0 : 1);
      if (c) {
        const dir = X.reachL >= X.reachR ? 1 : -1, x0 = Math.min(crossReach(X, -dir), 12 * eta + 6);
        c.on = true; c.kind = 'cross'; c.xs = X; c.dir = dir; c.xo = -dir * LANE; c.xt = -dir * x0; c.v = c.vWant = clamp(x0 / eta, 8, 22); c.xwait = 0; c.runner = true; c.warned = false;
        TR.cross.push(c); X.cars++;
      }
    }
  }
  for (let i = TR.cross.length - 1; i >= 0; i--) {
    const c = TR.cross[i], X = c.xs;
    const eta = (X.s - sK) / Math.max(vK, 6);
    const before = c.xt * c.dir < -(WALK + 1.6);
    const atLine = before && c.xt * c.dir > -(WALK + 5);
    let v = c.vWant;
    if (c.runner) {
      // keeps its rendezvous with Kit's line until 1.2 s before, then commits; tyres screech as it blows the stop
      if (eta > 1.2 && c.xt * c.dir < ST.kitD * c.dir) c.vWant = v = clamp((ST.kitD - c.xt) * c.dir / eta, 8, 22);
      if (!c.warned && eta < 1.6 && eta > 0) { c.warned = true; sfx('skid'); }
    } else {
      // yield to Kit at the stop line (the jump crossings let cars go: Kit flies over them)
      if (atLine && !X.jump && eta > -0.6 && eta < 2.4) v = 0;
      if (atLine && X.jump && eta > -0.4 && eta < 0.75 && vK < 20) v = 0;
    }
    c.v += clamp(v - c.v, -20 * dt, 7 * dt);
    c.xt += c.v * c.dir * dt;
    if (c.xt * c.dir > crossReach(X, c.dir)) { TR.cross.splice(i, 1); X.cars--; c.runner = false; hideCar(c); continue; }
    placeCar(c);
    frame(X.s, FB);
    c.vel.set(FB.rx * c.dir * c.v, 0, FB.rz * c.dir * c.v);
  }
  for (const im of MESH.veh) im.instanceMatrix.needsUpdate = true;
  TR.active.length = 0;
  for (const c of TR.pool) if (c.on) TR.active.push(c);
}

// ===================== rings, dash rings, star posts, bumper, goal =====================
const RINGS = { pos: [], got: null, mesh: null, n: 0, flight0: 0 };
const DASH = [];   // {pos (world), dir, r, s, flight, t}
const CPS = [];    // {s, pos, yaw, mesh, on, spin}
function addRing(x, y, z) { RINGS.pos.push(new V3(x + OX, y, z + OZ)); }
function ringLine(s0, s1, d0, d1, step, h) {
  for (let s = s0; s <= s1 + 1e-6; s += step) { const k = (s - s0) / Math.max(1e-6, s1 - s0); const p = rp(s, lerp(d0, d1, k), h || 1.1); addRing(p[0], p[1], p[2]); }
}
function ringArc(s0, s1, d, n, hMax) {
  for (let i = 0; i < n; i++) { const k = i / (n - 1); const s = lerp(s0, s1, k); const p = rp(s, d, 1.1 + Math.sin(k * Math.PI) * hMax); addRing(p[0], p[1], p[2]); }
}
function planRings() {
  RINGS.pos.length = 0; DASH.length = 0;
  const F = FEAT;
  // teach the first lane, then lines along the best ways down
  ringLine(F.iA0 + 16, F.iA0 + 60, 0, 0, 5);
  ringLine(F.iA0 + 80, F.iA1 - 20, 0, 2.2, 6);
  ringArc(F.iA2 - 6, F.iA2 + 30, 0, 9, 4.2);           // over jump 1
  // the parked-car roofs on street A3 (right side)
  ringLine(F.iA2 + 30, F.iA3 - 25, PARK, PARK, 7, 2.4);
  ringLine(F.iA3 + 15, F.iA4 - 20, -1.2, -1.2, 8);
  ringLine(F.iA4 + 15, F.t1a - 6, 1, 1, 7);
  // round the corner
  for (let k = 0; k < 7; k++) { const s = lerp(F.t1a - 4, F.t1b + 6, k / 6); const p = rp(s, 4 * TURNS[0].turn, 1.1); addRing(p[0], p[1], p[2]); }
  // the ramp at the works: up the kicker and over the mixer
  ringLine(CON.ramp - 12, CON.ramp - 2, 5.9, 5.9, 5);
  ringArc(CON.ramp + 8, CON.ramp + 34, 5.9, 8, 5.2);
  ringLine(F.iB + 15, F.t2a - 8, -0.5, -0.5, 8);
  // the left bends: round the outside, on Kit's side of the street (the oncoming lane on the inside has the cable car)
  for (let k = 0; k < 7; k++) { const s = lerp(F.t2a - 4, F.t2b + 6, k / 6); const p = rp(s, 5.4, 1.1); addRing(p[0], p[1], p[2]); }
  // along the grind rail
  ringLine(RAIL.s0 + 4, RAIL.s1 - 2, RAIL.d, RAIL.d, 6, RAIL.h + 1.1);
  ringArc(F.iC2 - 6, F.iC2 + 32, 0, 10, 5.5);          // over jump 2, the bay ahead
  ringLine(F.iC2 + 36, F.iC3 - 16, -2, 2, 7);
  ringLine(F.iC3 + 14, F.t3a - 4, 0, 0, 7);
  for (let k = 0; k < 7; k++) { const s = lerp(F.t3a - 4, F.t3b + 6, k / 6); const p = rp(s, 5.4, 1.1); addRing(p[0], p[1], p[2]); }
  ringLine(F.t3b + 20, F.t3b + 68, 1.5, 0.5, 8);
  ringLine(F.t3b + 122, F.iW - 16, 0.5, 1.5, 8);
  // a ring arc over each road works island: ollie it
  for (const h of HZ) if (h.type === 6) ringArc(h.s - 15, h.s + 15, h.d, 7, 2.7);
  ringLine(F.iW + 16, F.t4a - 6, -1.5, 1.5, 8);
  ringLine(F.pier0 + 10, F.bumper - 22, 0, 0, 7);
  // dash rings: the long run of street C, the waterfront, the pier
  const dash = (s, d, h) => { const p = rp(s, d, h || 1.5); frame(s, FB); DASH.push({ pos: new V3(p[0] + OX, p[1], p[2] + OZ), dir: new V3(FB.dx, FB.g, FB.dz).normalize(), r: 2.2, s, flight: false, t: 0, spin: 0 }); };
  dash(CON.ramp - 30, 5.9);                         // turbo into the works' kicker: over the mixer truck
  dash(F.iC2 + 50, 0); dash(F.iC3 - 40, 0);
  dash(F.t3b + 40, 0); dash(F.iW + 40, 0);
  dash(F.pier0 + 60, 0); dash(F.pier0 + 140, 0);
  RINGS.flight0 = RINGS.pos.length;
}
// ===================== the flight =====================
const FL = { pts: null, n: 0, len: 0, P: null, T: null, cum: null };
function planFlight() {
  const bp = rp(FEAT.bumper, 0, 0);
  const B = BRIDGE;
  frame(FEAT.bumper, FB);
  const c = [
    [bp[0] + FB.dx * 8, bp[1] + 6, bp[2] + FB.dz * 8],
    [bp[0] + FB.dx * 60, bp[1] + 15, bp[2] + FB.dz * 60],
    [bp[0] + FB.dx * 80 - 70, 40, bp[2] + FB.dz * 80 - 20],
    [-330, 47, -1732],
    [-440, 41, -1690],
    [-540, 33, -1652],
    [B.x, B.deck + 1.2, B.goalZ]
  ];
  const cr = new THREE.CatmullRomCurve3(c.map(p => new V3(p[0], p[1], p[2])), false, 'centripetal');
  const N = 400;
  FL.P = []; FL.T = []; FL.cum = new Float32Array(N + 1);
  let L = 0, prev = null;
  for (let i = 0; i <= N; i++) {
    const p = cr.getPoint(i / N), t = cr.getTangent(i / N).normalize();
    FL.P.push(new V3(p.x + OX, p.y, p.z + OZ)); FL.T.push(t);
    if (prev) L += p.distanceTo(prev);
    FL.cum[i] = L; prev = p;
  }
  FL.n = N; FL.len = L;
  // ring arcs and boost hoops over the bay
  const at = (u, lat, up, out) => { flightAt(u, out); return out; };
  const tmp = { pos: new V3(), dir: new V3(), right: new V3() };
  const ringAt = (u, lat, up) => { at(u, 0, 0, tmp); const p = tmp.pos.clone().addScaledVector(tmp.right, lat); p.y += up; RINGS.pos.push(p); };
  // a gentle line to learn on, then two sweeping arcs (left to right, then back) that ask for a steady steer
  for (let k = 0; k < 10; k++) { const q = k / 9; ringAt(0.17 + q * 0.12, 0, 1.5 * Math.sin(Math.PI * q)); }
  for (let k = 0; k < 12; k++) { const q = k / 11; ringAt(0.40 + q * 0.13, lerp(-3, 6, smooth(q)), 1 + 3.5 * Math.sin(Math.PI * q)); }
  for (let k = 0; k < 12; k++) { const q = k / 11; ringAt(0.62 + q * 0.13, 6 * Math.cos(Math.PI * q * 0.8), -1 + 3 * Math.sin(Math.PI * q)); }
  for (const u of [0.33, 0.55, 0.78]) { at(u, 0, 0, tmp); DASH.push({ pos: tmp.pos.clone(), dir: tmp.dir.clone(), r: 3.4, s: -1, u, flight: true, t: 0, spin: 0 }); }
}
// path frame at u in [0, 1] (arc-length parameter): pos (world), dir, right (horizontal)
function flightAt(u, out) {
  const L = clamp(u, 0, 1) * FL.len;
  let lo = 0, hi = FL.n;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (FL.cum[m] < L) lo = m; else hi = m; }
  const seg = FL.cum[hi] - FL.cum[lo], f = seg > 1e-6 ? (L - FL.cum[lo]) / seg : 0;
  out.pos.copy(FL.P[lo]).lerp(FL.P[hi], f);
  out.dir.copy(FL.T[lo]).lerp(FL.T[hi], f).normalize();
  out.right.set(-out.dir.z, 0, out.dir.x);
  if (out.right.lengthSq() < 1e-8) out.right.set(1, 0, 0);
  out.right.normalize();
  return out;
}

// ===================== interactable meshes =====================
function ringsMesh() {
  const g = new THREE.TorusGeometry(0.62, 0.12, 10, 32);
  const m = new THREE.MeshPhysicalNodeMaterial({ color: lin('#ffc21a'), metalness: 1, roughness: 0.16, clearcoat: 0.6, clearcoatRoughness: 0.08 });
  m.emissiveNode = vec3(1.0, 0.55, 0.05).mul(mix(float(0.22), float(0.38), U.hdr));
  // PORT(city): v2 spun every ring about its own axis in the vertex shader (angle = time * 3); r186 applies the
  // instance matrix before positionNode, so the shared torus geometry is spun on the CPU instead (K.util.spinY, per frame)
  const n = RINGS.pos.length;
  // only the rings near Kit are drawn: a window along the route (and the sky rings once the pier is close)
  RINGS.cap = Math.min(n, 150);
  const im = new THREE.InstancedMesh(g, m, Math.max(1, RINGS.cap));
  im.frustumCulled = false; im.castShadow = true;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  RINGS.got = new Uint8Array(n);
  RINGS.s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const L = i < RINGS.flight0 ? locate(RINGS.pos[i].x - OX, RINGS.pos[i].z - OZ) : null;
    RINGS.s[i] = L ? L.s : RT.len + 1;
  }
  RINGS.n = n; RINGS.dirty = true; RINGS.key = -1e9;
  im.count = 0;
  return im;
}
const _rm = new THREE.Matrix4();
function ringWindow() {
  const key = Math.floor(ST.sK / 8);
  if (!RINGS.dirty && key === RINGS.key) return;
  RINGS.dirty = false; RINGS.key = key;
  const im = MESH.rings, s0 = ST.sK - 25, s1 = ST.sK + 340, fly = ST.sK > RT.len - 280;
  let k = 0;
  for (let i = 0; i < RINGS.n && k < RINGS.cap; i++) {
    if (RINGS.got[i]) continue;
    if (i < RINGS.flight0 ? RINGS.s[i] < s0 || RINGS.s[i] > s1 : !fly) continue;
    const p = RINGS.pos[i];
    // the sky rings over the bay are bigger (read from afar, generous to fly through)
    const sc = i >= RINGS.flight0 ? 1.7 : 1;
    _rm.makeScale(sc, sc, sc).setPosition(p.x - OX, p.y, p.z - OZ);
    im.setMatrixAt(k++, _rm);
  }
  im.count = k;
  im.instanceMatrix.needsUpdate = true;
}
function dashMesh() {
  const g = new THREE.TorusGeometry(1, 0.11, 10, 40);
  const m = new THREE.MeshStandardMaterial({ color: lin('#c8f6ff'), emissive: lin('#2fd8ff'), emissiveIntensity: 1.5, metalness: 0.4, roughness: 0.3 });
  const im = new THREE.InstancedMesh(g, m, Math.max(1, DASH.length));
  im.frustumCulled = false;
  // a soft disc inside each hoop
  const dg = new THREE.CircleGeometry(1, 32);
  const dm = new THREE.MeshBasicMaterial({ color: lin('#5fe6ff'), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const disc = new THREE.InstancedMesh(dg, dm, Math.max(1, DASH.length));
  disc.frustumCulled = false; disc.renderOrder = 3;
  MESH.dashDisc = disc;
  return im;
}
const _dq = new THREE.Quaternion(), _dz = new V3(0, 0, 1), _ds = new V3();
function placeDash(i) {
  const o = DASH[i], k = 1 + Math.sin(Math.min(1, o.t) * Math.PI) * 0.35;
  _dq.setFromUnitVectors(_dz, o.dir);
  const e = new THREE.Euler();
  void e;
  _ds.set(o.r * k, o.r * k, o.r * k);
  _rm.compose(_p4.set(o.pos.x - OX, o.pos.y, o.pos.z - OZ), _dq, _ds);
  MESH.dash.setMatrixAt(i, _rm);
  _ds.multiplyScalar(0.92);
  _rm.compose(_p4, _dq, _ds);
  MESH.dashDisc.setMatrixAt(i, _rm);
}
function starPost(group, i, s) {
  const sd = 1;
  const p = rp(s, sd * (ROAD + 0.9), CURB);
  const mb = new MB(), T = templates();
  mb.geo(T.cyl8, TRS(0, 0.9, 0, 0, 0, 0, 0.09, 1.8, 0.09), lin('#2f5bff'), KIND.metal, 0);
  mb.geo(T.cyl8, TRS(0, 0.05, 0, 0, 0, 0, 0.3, 0.1, 0.3), lin('#f2f2f2'), KIND.plain, 0);
  mb.geo(T.cyl8, TRS(0, 1.8, 0, 0, 0, 0, 0.16, 0.12, 0.16), lin('#f2f2f2'), KIND.plain, 0);
  const pole = new THREE.Mesh(mb.build(), MESH.cityMat);
  pole.position.set(p[0], p[1], p[2]);
  pole.castShadow = true;
  const headMat = new THREE.MeshStandardMaterial({ color: lin('#ff3b30'), emissive: lin('#ff2010'), emissiveIntensity: 1.2, roughness: 0.3 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), headMat);
  const arm = new THREE.Group();
  arm.position.set(0, 1.98, 0);
  head.position.set(0, 0.22, 0);
  arm.add(head);
  pole.add(arm);
  group.add(pole);
  frame(s, FB);
  CPS.push({ s, pos: new V3(p[0] + OX, p[1], p[2] + OZ), yaw: Math.atan2(-FB.dx, -FB.dz), mesh: pole, arm, head, mat: headMat, on: false, spin: 0 });
}
// the giant pinball bumper (same silhouette as v2: the e2e orbit check models its profile): chrome skirt, red lacquer
// bands (clearcoat), a white body with pink panels, a rubber ring, a chasing neon ring and a crown of chasing bulbs,
// a gold dome with a glowing star. Its pop (scale) and flash are driven from update() through uBump.
const uBump = uniform(0);
function bumperMesh(group) {
  const p = rp(FEAT.bumper, 0, 0);
  const B = new THREE.Group();
  B.position.set(p[0], p[1], p[2]);
  const T = templates();
  const chrome = new THREE.MeshStandardNodeMaterial({ color: lin('#e3e7ee'), metalness: 1, roughness: 0.12 });
  const red = new THREE.MeshPhysicalNodeMaterial({ color: lin('#d6202c'), metalness: 0, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
  const white = new THREE.MeshPhysicalNodeMaterial({ metalness: 0, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  {
    // pink and white panels round the body, a thin gold line between them
    const a = tfract(TSL.atan(positionLocal.z, positionLocal.x).div(TAU).mul(16).add(0.25));
    const panel = tstep(0.5, a), line = tstep(tabs(a.sub(0.5)), 0.02).add(tstep(a, 0.02)).add(tstep(0.98, a));
    white.colorNode = mix(mix(vec3(0.95, 0.93, 0.9), vec3(1.0, 0.45, 0.68), panel), vec3(0.95, 0.7, 0.2), tclamp(line, 0, 1));
  }
  const rubber = new THREE.MeshStandardNodeMaterial({ color: lin('#1c1a20'), metalness: 0, roughness: 0.7 });
  const glowM = new THREE.MeshStandardNodeMaterial({ color: lin('#ffd6f0'), roughness: 0.35 });
  {
    const ang = TSL.atan(positionLocal.y, positionLocal.x).div(TAU).add(0.5);
    const chase = smoothstep(0.55, 1.0, tfract(ang.mul(6).sub(U.time.mul(1.4))));
    glowM.emissiveNode = vec3(1.0, 0.25, 0.7).mul(float(1.6).add(chase.mul(2.2)).add(uBump.mul(12))).mul(mix(float(0.6), float(1.4), U.hdr));
  }
  const capM = new THREE.MeshPhysicalNodeMaterial({ color: lin('#ffcf3a'), metalness: 0.65, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05 });
  capM.emissiveNode = vec3(1.0, 0.6, 0.05).mul(float(0.12).add(uBump.mul(2)));
  const add = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; m.receiveShadow = true; B.add(m); return m; };
  add(new THREE.CylinderGeometry(4.1, 4.3, 0.5, 48), chrome, 0.25);
  add(new THREE.TorusGeometry(4.18, 0.07, 6, 64), chrome, 0.52).rotation.x = Math.PI / 2;
  add(new THREE.CylinderGeometry(3.6, 3.8, 1.0, 48), red, 1.0);
  add(new THREE.TorusGeometry(3.72, 0.16, 8, 64), rubber, 1.18).rotation.x = Math.PI / 2;
  const body = add(new THREE.CylinderGeometry(3.15, 3.25, 1.5, 64, 1, true), white, 2.2);
  const ring = add(new THREE.TorusGeometry(3.32, 0.2, 12, 64), glowM, 2.2);
  ring.rotation.x = Math.PI / 2;
  add(new THREE.CylinderGeometry(3.7, 3.4, 0.35, 48), red, 3.1);
  add(new THREE.TorusGeometry(3.55, 0.05, 6, 64), chrome, 3.28).rotation.x = Math.PI / 2;
  // the neck under the dome (inside the dome's rim radius)
  add(new THREE.CylinderGeometry(2.78, 3.0, 0.95, 64, 1, true), white, 3.72);
  add(new THREE.TorusGeometry(2.8, 0.07, 6, 64), chrome, 4.18).rotation.x = Math.PI / 2;
  const cap = add(new THREE.SphereGeometry(3.3, 48, 14, 0, TAU, 0, Math.PI * 0.32), capM, 2.4);
  // a star on the dome
  const sg = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 0.75 : 1.8; if (i) sg.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else sg.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  const starM = new THREE.MeshStandardNodeMaterial({ color: lin('#ffffff'), side: THREE.DoubleSide, roughness: 0.3 });
  starM.emissiveNode = vec3(1.0, 0.95, 0.85).mul(float(1.4).add(tsin(U.time.mul(4)).mul(0.3)).add(uBump.mul(6))).mul(mix(float(0.7), float(1.3), U.hdr));
  const star = add(new THREE.ShapeGeometry(sg), starM, 3.62);
  star.rotation.x = -Math.PI / 2;
  // light bulbs round the body, chasing
  const bulbM = new THREE.MeshStandardNodeMaterial({ color: lin('#fff2c0'), roughness: 0.2 });
  const bi = TSL.instanceIndex.toFloat().div(24);
  bulbM.emissiveNode = vec3(1.0, 0.78, 0.3).mul(float(0.7).add(smoothstep(0.6, 1.0, tfract(bi.mul(3).sub(U.time.mul(1.2)))).mul(3.2)).add(uBump.mul(5))).mul(mix(float(0.7), float(1.4), U.hdr));
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 10, 8), bulbM, 24);
  for (let i = 0; i < 24; i++) { const a = i * TAU / 24; _rm.makeTranslation(Math.cos(a) * 3.62, 1.55, Math.sin(a) * 3.62); bulbs.setMatrixAt(i, _rm); }
  B.add(bulbs);
  group.add(B);
  void T; void body; void cap;
  MESH.bumper = { g: B, ring, glowM, capM, t: 9, star };
  addSolid({ x: p[0], y: p[1] + 1.8, z: p[2], hx: 3.9, hy: 1.8, hz: 3.9, yaw: 0, kind: 'bumper', top: true, round: 3.9 });
}
function kitFaceTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(128, 128, 124, 0, TAU); g.fill();
  g.lineWidth = 8; g.strokeStyle = '#121845'; g.stroke();
  g.translate(128, 140);
  // ears
  g.fillStyle = '#f47a1f'; g.strokeStyle = '#3d1707'; g.lineWidth = 5;
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 30, -50); g.lineTo(s * 72, -112); g.lineTo(s * 78, -30); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#6a2408'; g.beginPath(); g.moveTo(s * 42, -52); g.lineTo(s * 68, -94); g.lineTo(s * 70, -42); g.closePath(); g.fill(); g.fillStyle = '#f47a1f'; }
  g.beginPath(); g.ellipse(0, 0, 80, 70, 0, 0, TAU); g.fill(); g.stroke();
  g.fillStyle = '#fff4e6'; g.beginPath(); g.ellipse(0, 28, 52, 38, 0, 0, TAU); g.fill();
  for (const s of [-1, 1]) {
    g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(s * 28, -12, 17, 24, 0, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = '#22c36a'; g.beginPath(); g.ellipse(s * 25, -8, 10, 15, 0, 0, TAU); g.fill();
    g.fillStyle = '#08130c'; g.beginPath(); g.ellipse(s * 24, -6, 5, 9, 0, 0, TAU); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(s * 21, -13, 3.5, 0, TAU); g.fill();
  }
  g.fillStyle = '#1a0b05'; g.beginPath(); g.ellipse(0, 14, 10, 7, 0, 0, TAU); g.fill();
  g.strokeStyle = '#3d1707'; g.lineWidth = 4; g.beginPath(); g.arc(-6, 30, 14, 0.2, Math.PI - 0.6); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function goalMesh(group) {
  const B = BRIDGE;
  const G = new THREE.Group();
  G.position.set(B.x + 4.2, B.deck + 0.5, B.goalZ - 4.5);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 3.2, 12), new THREE.MeshStandardMaterial({ color: lin('#d9dee6'), metalness: 0.8, roughness: 0.25 }));
  post.position.y = 1.6; post.castShadow = true; G.add(post);
  const panel = new THREE.Group(); panel.position.y = 3.6; G.add(panel);
  const face = new THREE.Mesh(new THREE.CircleGeometry(1.15, 40), new THREE.MeshStandardMaterial({ map: kitFaceTexture(), roughness: 0.45, emissive: lin('#ffffff'), emissiveIntensity: 0.15, emissiveMap: null }));
  face.position.z = 0.04; panel.add(face);
  const back = new THREE.Mesh(new THREE.CircleGeometry(1.15, 40), new THREE.MeshStandardMaterial({ color: lin('#2f5bff'), roughness: 0.4, emissive: lin('#1030a0'), emissiveIntensity: 0.4 }));
  back.rotation.y = Math.PI; back.position.z = -0.04; panel.add(back);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.17, 0.07, 8, 40), new THREE.MeshStandardMaterial({ color: lin('#ffd23f'), metalness: 0.9, roughness: 0.2 }));
  panel.add(rim);
  group.add(G);
  MESH.goal = { g: G, panel, spin: 0, w: 0 };
  // the deck under the pad is walkable (landing)
  addSolid({ x: B.x, y: B.deck, z: (B.zA + B.zB) / 2, hx: B.half + 1, hy: 0.45, hz: (B.zA - B.zB) / 2, yaw: 0, kind: 'deck', top: true });
}

// ===================== physics API =====================
const GOUT = { y: 0, n: new V3(0, 1, 0), solid: null };
const WOUT = { hit: false, nx: 0, nz: 0 };
function edgeAt(s) {
  const z = zoneAt(s);
  if (z === Z_TURN) {
    const t = turnAt(s);
    if (!t) return WALLD;
    const into = Math.min(s - (t.s0 - XHALF + 1.5), (t.s1 + XHALF - 1.5) - s);
    return lerp(WALLD, 15.5, smooth(into / 8));
  }
  if (z === Z_PIER) {
    if (s < FEAT.pier0 - 6) return WALLD;
    return lerp(WALLD, PIER_HALF - 0.35, smooth((s - (FEAT.pier0 - 6)) / 10));
  }
  return WALLD;
}
function cityGround(x, z, yTop) {
  if (!ST.built || !fin(x) || !fin(z)) return null;
  const lx = x - OX, lz = z - OZ, top = fin(yTop) ? yTop + 0.05 : 1e9;
  let best = -1e9, nx = 0, ny = 1, nz = 0, sol = null;
  const L = locate(lx, lz);
  if (L && Math.abs(L.d) < 40) {
    const s = L.s, d = L.d;
    const sf = surface(s, d);
    let y = profY(s) + sf.y;
    // the pier and its round end float over the bay: nothing past their edges
    const pierVoid = zoneAt(s) === Z_PIER && s >= FEAT.pier0 && sf.wall && Math.abs(d) > PIER_HALF + 0.2 && Math.hypot(s - (FEAT.end - PIER_END_R), d) > PIER_END_R + 0.2;
    if (!pierVoid && y <= top) {
      best = y;
      frame(s, FB);
      const g = profG(s), gd = sf.gd;
      nx = -g * FB.dx - gd * FB.rx; nz = -g * FB.dz - gd * FB.rz; ny = 1;
    }
  }
  const list = solidsNear(lx, lz);
  for (let i = 0; i < list.length; i++) {
    const o = SOL.list[list[i]];
    if (!o.top) continue;
    if (o.round) { if (Math.hypot(lx - o.x, lz - o.z) > o.round) continue; toBox(o, lx, lz); }
    else { toBox(o, lx, lz); if (Math.abs(OL.x) > o.hx || Math.abs(OL.z) > o.hz) continue; }
    const y = o.kind === 'car' ? o.y0 + vehicleTop(o.type, OL.z) : boxTop(o, OL.z);
    if (y > top || y <= best) continue;
    best = y; sol = o;
    if (o.ramp) { const sl = (o.y1 - o.y0) / (2 * o.hz); nx = -sl * o.s; ny = 1; nz = -sl * o.c; }
    else if (o.kind === 'car') { const sl = (vehicleTop(o.type, OL.z + 0.05) - vehicleTop(o.type, OL.z - 0.05)) / 0.1; nx = -sl * o.s; ny = 1; nz = -sl * o.c; }
    else { nx = 0; ny = 1; nz = 0; }
  }
  for (let i = 0; i < TR.active.length; i++) {
    const c = TR.active[i];
    const ex = lx - c.lx, ez = lz - c.lz;
    if (ex * ex + ez * ez > c.r * c.r) continue;
    const ax = ex * c.cs - ez * c.sn, az = ex * c.sn + ez * c.cs;
    if (Math.abs(ax) > c.half.x || Math.abs(az) > c.half.z) continue;
    const y = c.ly + vehicleTop(c.type, az) + az * c.tp;
    if (y > top || y <= best) continue;
    best = y; sol = c;
    const sl = (vehicleTop(c.type, az + 0.05) - vehicleTop(c.type, az - 0.05)) / 0.1 + c.tp;
    nx = -sl * c.sn; ny = 1; nz = -sl * c.cs;
  }
  if (best < -1e8) return null;
  const l = Math.hypot(nx, ny, nz) || 1;
  GOUT.y = best; GOUT.n.set(nx / l, ny / l, nz / l); GOUT.solid = sol;
  return GOUT;
}
function cityWalls(pos, radius, height) {
  WOUT.hit = false; WOUT.nx = 0; WOUT.nz = 0;
  if (!ST.built || !finV(pos)) return WOUT;
  radius = fin(radius) ? radius : 0.45; height = fin(height) ? height : 1.2;
  let lx = pos.x - OX, lz = pos.z - OZ;
  {
    // the top of the route is closed: barriers across the street at s = 0
    const ex = lx - RT.x[0], ez = lz - RT.z[0], bk = ex * RT.dx[0] + ez * RT.dz[0];
    if (bk < radius && Math.abs(ex * -RT.dz[0] + ez * RT.dx[0]) < 40) {
      lx += RT.dx[0] * (radius - bk); lz += RT.dz[0] * (radius - bk);
      WOUT.hit = true; WOUT.nx = RT.dx[0]; WOUT.nz = RT.dz[0];
    }
  }
  const L = locate(lx, lz);
  if (L) {
    const s = L.s, z = zoneAt(s);
    let d = L.d, ns = s, push = false;
    if (z === Z_PIER && s >= FEAT.pier0) {
      const ce = FEAT.end - PIER_END_R, rr = Math.hypot(s - ce, d), lim = PIER_END_R - 0.4 - radius, side = edgeAt(s) - radius;
      const onPier = s <= ce && Math.abs(d) <= side;
      if (!onPier && rr > lim) {
        if (s > ce - 1 || Math.abs(d) > side + 0.5) { const k = lim / rr; ns = ce + (s - ce) * k; d *= k; push = true; if (s < ce && rr > lim && Math.abs(d) > side && s < ce - 2) { d = Math.sign(d) * side; ns = s; } }
        else { d = Math.sign(d) * side; push = true; }
      }
    } else if (z === Z_X) {
      const X = isectAt(s), ds = X ? s - X.s : 0, ads = Math.abs(ds), ad = Math.abs(d);
      const reach = (X && X.side ? (d * X.side > 0 ? XSIDE : WALLD) : XSIDE) - radius;
      const ew = WALLD - radius, cb = ROAD - radius;
      if (ad > reach) { d = Math.sign(d) * reach; push = true; }
      if (Math.abs(d) > ew && ads > cb) {
        const pd = Math.abs(d) - ew, ps = ads - cb;
        if (X && ps < pd) { ns = X.s + Math.sign(ds) * cb; } else d = Math.sign(d) * ew;
        push = true;
      }
    } else {
      const e = edgeAt(s) - radius;
      if (Math.abs(d) > e) { d = Math.sign(d) * e; push = true; }
    }
    if (push) {
      frame(ns, FB);
      const nxp = FB.x + FB.rx * d, nzp = FB.z + FB.rz * d;
      const ox = nxp - lx, oz = nzp - lz, ol = Math.hypot(ox, oz);
      if (ol > 1e-6) { WOUT.hit = true; WOUT.nx = ox / ol; WOUT.nz = oz / ol; }
      lx = nxp; lz = nzp;
    }
  }
  const list = solidsNear(lx, lz);
  for (let i = 0; i < list.length; i++) {
    const o = SOL.list[list[i]];
    if (o.kind === 'deck') continue;
    const bottom = o.kind === 'car' ? o.y0 : o.y - o.hy;
    if (pos.y + height < bottom) continue;
    if (o.top) {
      toBox(o, lx, lz);
      const t = o.kind === 'car' ? o.y0 + vehicleTop(o.type, clamp(OL.z, -o.hz, o.hz)) : boxTop(o, clamp(OL.z, -o.hz, o.hz));
      if (pos.y >= t - 0.4) continue;
      if (o.ramp && pos.y >= t - 0.9) continue;
    }
    if (o.round) {
      const ex = lx - o.x, ez = lz - o.z, dd = Math.hypot(ex, ez), lim = o.round + radius;
      if (dd >= lim || dd < 1e-6) continue;
      lx = o.x + ex / dd * lim; lz = o.z + ez / dd * lim;
      WOUT.hit = true; WOUT.nx = ex / dd; WOUT.nz = ez / dd;
      continue;
    }
    toBox(o, lx, lz);
    const px = o.hx + radius - Math.abs(OL.x), pz = o.hz + radius - Math.abs(OL.z);
    if (px <= 0 || pz <= 0) continue;
    let ax = OL.x, az = OL.z, ux = 0, uz = 0;
    if (px < pz) { ax += Math.sign(OL.x || 1) * px; ux = Math.sign(OL.x || 1); } else { az += Math.sign(OL.z || 1) * pz; uz = Math.sign(OL.z || 1); }
    lx = o.x + ax * o.c + az * o.s; lz = o.z - ax * o.s + az * o.c;
    WOUT.hit = true; WOUT.nx = ux * o.c + uz * o.s; WOUT.nz = -ux * o.s + uz * o.c;
  }
  pos.x = lx + OX; pos.z = lz + OZ;
  return WOUT;
}
const RA = { pos: new V3(), dir: new V3(), right: new V3(), width: 0, s: 0, d: 0, y: 0, g: 0, zone: 0 };
function fillRA(s, d) {
  frame(s, FB);
  RA.pos.set(FB.x + OX, FB.y, FB.z + OZ);
  RA.dir.set(FB.dx, 0, FB.dz); RA.right.set(FB.rx, 0, FB.rz);
  RA.width = edgeAt(s); RA.s = s; RA.d = d; RA.y = FB.y; RA.g = FB.g; RA.zone = zoneAt(s); RA.k = FB.k;
  return RA;
}
function routeAt(x, z) { if (!ST.built || !fin(x) || !fin(z)) return null; const L = locate(x - OX, z - OZ); return L ? fillRA(L.s, L.d) : null; }
function route(s) { if (!ST.built) return null; return fillRA(clamp(fin(s) ? s : 0, 0, RT.len), 0); }
function routePoint(s, d, h, out) { const p = rp(s, d, h); return (out || new V3()).set(p[0] + OX, p[1], p[2] + OZ); }

// ===================== state, lights, build =====================
const ST = { built: false, entered: false, time: 0, pickT: -1, sK: 0, vK: 0, kitD: 0, kitOn: false, cp: -1, focus: new V3(), buildMs: 0, prev: null, env: null, sun: null, hemi: null, fog: null, bg: null, kitS: 0, last: new V3() };
// The lights live in their own group at the world origin: CSMShadowNode (Ultra / Élevé) places its cascade lights in
// world space next to the sun. Two suns, one visible at a time (K.gfx.shadows): 'csm' = 3 cascades (fade between them)
// fitted to the camera frustum up to 280 m; 'single' / 'cheap' = v2's one shadow box following Kit.
const SUN_I = 2.3 * LIGHT_PI;
// ambient balance (the e2e 'shaded streets readable' check wants the street in the shade at luma median 35-60)
const ENV_I = 0.4, HEMI_I = 0.4;
function buildLights() {
  const touch = isTouch();
  const L = new THREE.Group();
  L.name = 'city-lights'; L.visible = false;
  const mkSun = (size, ext) => {
    const sun = new THREE.DirectionalLight(lin(SUN_HEX), SUN_I);
    sun.castShadow = true;
    sun.shadow.mapSize.set(size, size);
    const c = sun.shadow.camera;
    c.left = -ext; c.right = ext; c.top = ext; c.bottom = -ext; c.near = 1; c.far = 620;
    c.updateProjectionMatrix();
    sun.shadow.bias = -0.0007; sun.shadow.normalBias = 0.05;
    L.add(sun); L.add(sun.target);
    return sun;
  };
  const size = touch ? 1024 : 2048, ext = touch ? 44 : 56;
  const sunS = mkSun(size, ext);
  ST.shadowExt = ext; ST.shadowSize = size;
  const sunC = mkSun(2048, 60);
  sunC.shadow.bias = -0.0005; sunC.shadow.normalBias = 0.04;
  sunC.visible = false;
  ST.sunS = sunS; ST.sunC = sunC; ST.sun = sunS;
  if (typeof CityCSMShadowNode === 'function') {
    try {
      const csm = new CityCSMShadowNode(sunC, { cascades: 3, maxFar: 280, mode: 'practical', lightMargin: 160 });
      csm.fade = true;
      sunC.shadow.shadowNode = csm;
      ST.csm = csm;
    } catch (e) { console.warn('Kit Rush 3D: city CSM shadows unavailable', e); ST.csm = null; }
  }
  const hemi = new THREE.HemisphereLight(lin('#8f92cc'), lin('#8a6652'), 0.5 * LIGHT_PI);
  L.add(hemi);
  // the open evening sky opposite the sun: a cool fill so the streets in the shade keep their asphalt, cars and Kit readable
  const fill = new THREE.DirectionalLight(lin('#adb7da'), 0.4 * LIGHT_PI);
  fill.position.set(-SUN_DIR.x * 0.55, 0.8, -SUN_DIR.z * 0.55).normalize().multiplyScalar(100);
  L.add(fill); L.add(fill.target);
  ST.hemi = hemi; ST.fill = fill; ST.lights = L;
  const fog = new THREE.Fog(new THREE.Color(FOG_HEX), touch ? 140 : 180, touch ? 1900 : 2900);
  fog.hdrColor = lin(FOG_HEX);
  ST.fog = fog; ST.bg = new THREE.Color(FOG_HEX);
}
// K.gfx.shadows -> which sun casts: the cascades need the scene camera (set before their first build: the environment
// capture renders the city through a CubeCamera first)
function applyShadows(mode) {
  const csm = !!ST.csm && mode === 'csm';
  if (csm && !ST.csm.camera && K.view && K.view.camera && K.view.renderer) {
    try { ST.csm._init({ camera: K.view.camera, renderer: K.view.renderer }); } catch (e) { console.warn('Kit Rush 3D: CSM init failed', e); ST.csm = null; return applyShadows('single'); }
  }
  ST.sunC.visible = csm; ST.sunS.visible = !csm;
  ST.sun = csm ? ST.sunC : ST.sunS;
  ST.shadowMode = csm ? 'csm' : mode === 'cheap' ? 'cheap' : 'single';
  ST.csmKey = '';
  placeSun();
}
const _sr = new V3(), _su = new V3(), _sp = new V3(), UPV = new V3(0, 1, 0);
function placeSun() {
  // the shadow box follows Kit, snapped to its texels (no shimmering); world coordinates (the light group is at 0)
  const f = ST.focus, ext = ST.shadowExt;
  _sr.crossVectors(UPV, SUN_DIR).normalize(); _su.crossVectors(SUN_DIR, _sr);
  const texel = (2 * ext) / ST.shadowSize;
  const u = Math.round(f.dot(_sr) / texel) * texel, v = Math.round(f.dot(_su) / texel) * texel, w = f.dot(SUN_DIR);
  _sp.copy(_sr).multiplyScalar(u).addScaledVector(_su, v).addScaledVector(SUN_DIR, w);
  _sp.x += OX; _sp.z += OZ;
  for (const sun of [ST.sunS, ST.sunC]) {
    sun.target.position.copy(_sp);
    sun.position.copy(_sp).addScaledVector(SUN_DIR, 300);
    sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
  }
  // the cascades follow the camera's projection (fov changes with speed / cinematics)
  if (ST.shadowMode === 'csm' && ST.csm && ST.csm.camera) {
    const cam = ST.csm.camera, key = cam.fov.toFixed(2) + ',' + cam.aspect.toFixed(3) + ',' + cam.near + ',' + cam.far;
    if (key !== ST.csmKey) { ST.csmKey = key; try { ST.csm.updateFrustums(); } catch (e) { /* not ready */ } }
  }
}
function bakeParked(group) {
  for (const p of PARKED) {
    frame(p.s, FB);
    const x = FB.x + FB.rx * p.d, z = FB.z + FB.rz * p.d, y = FB.y;
    const pitch = Math.atan(FB.g * p.dir);
    _ce.set(-pitch, p.yaw, 0, 'YXZ'); _cq.setFromEuler(_ce);
    const M = new THREE.Matrix4().compose(new V3(x, y, z), _cq, new V3(1, 1, 1));
    const paint = K.vehicles.parkedPaint(p.type, p.s);
    K.vehicles.addTo(chunk(p.s).mb, p.type, M, paint);
    const t = VT[p.type];
    addSolid({ x, y: y + t.hy, z, hx: t.hx, hy: t.hy, hz: t.hz, yaw: p.yaw, kind: 'car', type: p.type, y0: y, top: true });
    PXL.push({ F: { ox: x, oy: y, oz: z, ax: Math.cos(p.yaw), az: -Math.sin(p.yaw), bx: Math.sin(p.yaw), bz: Math.cos(p.yaw) }, a0: -t.hx, a1: t.hx, y0: 0, y1: t.hy * 1.9, b0: -t.hz, b1: t.hz });
  }
  void group;
}
function propSolids() {
  // lamp posts, trees and hydrants on the route's sidewalks are posts Kit slides along
  for (const L of LAMP_POSTS) addSolid({ x: L[0], y: L[1] + 3, z: L[2], hx: 0.16, hy: 3, hz: 0.16, yaw: 0, kind: 'post', top: false });
}
const LAMP_POSTS = [];
function build(scene) {
  const KV = K.vehicles;
  if (!KV || !KV.VT) throw new Error('K.vehicles (26-vehicles.js) is missing');
  VT = KV.VT; vehicleTop = KV.vehicleTop;
  if (ST.built) return C.group;
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  scene = scene || (K.view && K.view.scene);
  const group = new THREE.Group();
  group.name = 'city'; group.position.set(OX, 0, OZ); group.visible = false;
  C.group = group;
  buildRoute(); planRoute(); planZones(); planSpecials(); planHazards();
  for (let s = 0; s < RT.len + CHUNK; s += CHUNK) {
    const mb = new MB();
    mb.hd = new MB(); mb.lod = new MB(); mb.fol = new MB();
    CK.list.push({ mb, wires: [], s0: s, mesh: null, hdMesh: null, lodMesh: null, folMesh: null, box: null, far: false });
  }
  FOL_FAR.mb = new MB();
  const r = rng(2024);
  buildRouteSurface();
  buildTracks();
  buildCrossings(r);
  buildCorners(r);
  buildSummit(r);
  buildSideStreets();
  buildRouteHouses(r);
  buildRouteProps(r);
  buildConstruction(r);
  buildRail();
  buildWaterfront(r);
  buildPier(r);
  buildManholes(r);
  buildParked(r);
  bakeParked(group);
  buildWires();
  propSolids();
  const mat = MESH.cityMat = cityMaterial();
  if (K.tex && typeof K.tex.preload === 'function') { K.tex.load(FT.name, { wrap: 'clamp' }); K.tex.preload(CT.names.concat([FT.name])).then(cityTexSync, () => {}); }
  const wires = [];
  for (const c of CK.list) {
    for (const v of c.wires) wires.push(v);
    if (c.mb.count) { const m = new THREE.Mesh(c.mb.build(), mat); m.receiveShadow = true; group.add(m); c.mesh = m; }
    // the painted ladies swap to plain boxes with a window-grid facade far from the camera
    if (c.mb.hd.count) {
      const g = c.mb.hd.build(), m = new THREE.Mesh(g, mat); m.receiveShadow = true; group.add(m); c.hdMesh = m; c.box = g.boundingBox.clone();
      if (c.mb.lod.count) { const l = new THREE.Mesh(c.mb.lod.build(), mat); l.receiveShadow = true; l.visible = false; group.add(l); c.lodMesh = l; }
    }
    if (c.mb.fol.count) {
      const f = new THREE.Mesh(c.mb.fol.build(), MESH.folMat || (MESH.folMat = foliageMaterial()));
      f.castShadow = true; f.receiveShadow = true; f.name = 'city-foliage'; group.add(f); c.folMesh = f;
      if (!c.box) c.box = f.geometry.boundingBox.clone(); else c.box.union(f.geometry.boundingBox);
    }
    c.mb = null; c.wires = null;
  }
  {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
    const w = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: lin('#1c1a1c') }));
    w.frustumCulled = false; group.add(w);
  }
  // the land around, the background city, the far shores
  {
    for (const tg of buildTerrain()) { const tm = new THREE.Mesh(tg, mat); tm.receiveShadow = true; tm.name = 'city-land'; group.add(tm); }
    for (const mb of buildBackground(r).values()) if (mb.count) { const m = new THREE.Mesh(mb.build(), mat); m.receiveShadow = true; m.name = 'city-bg'; group.add(m); }
    const far = new MB();
    buildSkyline(far, r); buildPresidio(far, r); buildIsland(far, r); buildSails(far, r);
    const bl = buildBridge(far, r);
    group.add(new THREE.Mesh(far.build(), mat));
    if (FOL_FAR.mb.count) { const fm = new THREE.Mesh(FOL_FAR.mb.build(), MESH.folMat || (MESH.folMat = foliageMaterial())); fm.name = 'city-foliage-far'; group.add(fm); }
    void bl;
    const hc = (x, z, h, c) => { c.copy(lin('#9a8a52')).lerp(lin('#4f5f3a'), clamp(0.5 + Math.sin(x * 0.013 + z * 0.02) * 0.5, 0, 1) * 0.7); if (h < 2) c.lerp(lin('#8b7d66'), 0.6); };
    group.add(new THREE.Mesh(hillField(-2800, 2200, -2100, -4800, 90, 40, marinH, hc), mat));
    group.add(new THREE.Mesh(hillField(2600, 4200, 900, -3200, 16, 40, (x, z) => (x - 2600) * 0.09 + 60 * Math.sin(z * 0.004) + 40, hc), mat));
  }
  // shadow proxies: casters for the sun only
  {
    const pm = new THREE.Mesh(proxyMesh(PXL).build(), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    pm.castShadow = true; pm.frustumCulled = false; pm.renderOrder = -50;
    group.add(pm);
  }
  // sky dome, the bay
  {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), skyMaterial());
    dome.renderOrder = -100; dome.frustumCulled = false;
    group.add(dome);
    const wg = new THREE.CircleGeometry(5200, 64); wg.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(wg, waterMaterial());
    water.position.set(0, 0, -1500); water.renderOrder = -10;
    group.add(water);
    ST.water = water;
  }
  buildLights();
  if (scene) scene.add(ST.lights);
  applyShadows(K.gfx ? K.gfx.shadows : 'single');
  if (K.gfx && typeof K.gfx.onChange === 'function') K.gfx.onChange(g => { if (ST.built) applyShadows(g.shadows); });
  group.add(glowMesh(LAMPS));
  if (STEAMS.length) group.add(steamMesh(STEAMS));
  group.add(fogMesh());
  if (FLAGS.length) group.add(flagMesh(FLAGS));
  group.add(gullMesh(rp(FEAT.end - 80, 0, 0)));
  // traffic, rings, hoops, star posts, the bumper, the goal
  buildTraffic(group);
  planRings();
  planFlight();
  MESH.rings = ringsMesh(); group.add(MESH.rings);
  MESH.dash = dashMesh(); group.add(MESH.dash); group.add(MESH.dashDisc);
  for (let i = 0; i < DASH.length; i++) placeDash(i);
  MESH.dash.instanceMatrix.needsUpdate = true; MESH.dashDisc.instanceMatrix.needsUpdate = true;
  starPost(group, 0, FEAT.iA3 + 4);
  starPost(group, 1, FEAT.t2b + 14);
  starPost(group, 2, FEAT.t3b + 12);
  bumperMesh(group);
  goalMesh(group);
  indexSolids();
  // spawn
  {
    const s0 = 30;
    frame(s0, FB);
    C.start = { pos: new V3(FB.x + OX, profY(s0), FB.z + OZ), yaw: yawOf(FB.dx, FB.dz), s: s0 };
    C.checkpoints = CPS.map(c => { const s = c.s + 6; frame(s, FB); return { pos: new V3(FB.x + OX, profY(s), FB.z + OZ), yaw: yawOf(FB.dx, FB.dz), s }; });
    const bp = rp(FEAT.bumper, 0, 0);
    frame(FEAT.bumper, FB);
    C.bumper = { pos: new V3(bp[0] + OX, bp[1] + 2.2, bp[2] + OZ), base: new V3(bp[0] + OX, bp[1], bp[2] + OZ), radius: 3.9, normal: new V3(FB.dx, 0, FB.dz), s: FEAT.bumper };
    const B = BRIDGE;
    C.goal = { pos: new V3(B.x + OX, B.deck + 0.45, B.goalZ + OZ), radius: 6.5 };
  }
  if (scene) scene.add(group);
  ST.built = true;
  ST.buildMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
  return group;
}
// ===================== act switch =====================
function enter() {
  if (!ST.built) build();
  if (ST.entered || !C.group) return;
  const V = K.view, sc = V && V.scene, cam = V && V.camera;
  if (!sc || !cam) return;
  ST.entered = true;
  cityTexSync();
  ST.prev = { fog: sc.fog, bg: sc.background, env: sc.environment, near: cam.near, far: cam.far };
  if (K.world && typeof K.world.setVisible === 'function') { try { K.world.setVisible(false); } catch (e) { console.warn(e); } }
  C.group.visible = true;
  if (ST.lights.parent !== sc) sc.add(ST.lights);
  ST.lights.visible = true;
  sc.fog = ST.fog; sc.background = ST.bg;
  cam.near = 0.3; cam.far = isTouch() ? 3200 : 4200; cam.updateProjectionMatrix();
  ST.focus.copy(C.start.pos); placeSun();
  // the post pipeline gets the low sun (light shafts) and an environment captured in the city
  let env = null;
  const P = K.post;
  if (P) {
    try {
      if (typeof P.setSun === 'function') P.setSun(SUN_DIR, SUN_HEX);
      if (typeof P.refreshEnvironment === 'function') env = P.refreshEnvironment(new V3(OX + 300, 70, -1000 + OZ), { intensity: ENV_I });
    } catch (e) { console.warn('Kit Rush 3D: city environment not captured', e); env = null; }
  }
  if (!env) env = ownEnvironment();
  if (env) sc.environment = env;
  ST.hemi.intensity = (sc.environment ? HEMI_I : 0.8) * LIGHT_PI;
  reset({ full: true });
}
function ownEnvironment() {
  // fallback without K.post: a PMREM of the sky alone
  const r = K.view && K.view.renderer;
  if (!r || typeof THREE.PMREMGenerator !== 'function') return null;
  try {
    if (!ST.env) {
      const s = new THREE.Scene();
      s.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial()));
      const pm = new THREE.PMREMGenerator(r);
      ST.env = pm.fromScene(s, 0.02).texture;
      pm.dispose();
    }
    return ST.env;
  } catch (e) { return null; }
}
function exit() {
  if (!ST.entered) return;
  ST.entered = false;
  const V = K.view, sc = V.scene, cam = V.camera, pv = ST.prev || {};
  C.group.visible = false;
  ST.lights.visible = false;
  if (sc.fog === ST.fog) sc.fog = pv.fog || null;
  if (sc.background === ST.bg) sc.background = pv.bg || null;
  sc.environment = pv.env || null;
  if (fin(pv.near)) cam.near = pv.near;
  if (fin(pv.far)) cam.far = pv.far;
  cam.updateProjectionMatrix();
  if (K.world && typeof K.world.setVisible === 'function') { try { K.world.setVisible(true); } catch (e) { console.warn(e); } }
}
function reset(opts) {
  if (!ST.built) return;
  if (opts && opts.full) ST.cp = -1;
  const G = K.game;
  if (G && Number.isInteger(G.cpIndex) && G.cpIndex >= -1 && G.cpIndex < CPS.length && !(opts && opts.full)) ST.cp = Math.max(ST.cp, G.cpIndex);
  const sK = ST.cp >= 0 ? C.checkpoints[ST.cp].s : C.start.s;
  ST.sK = sK;
  for (let i = 0; i < RINGS.n; i++) RINGS.got[i] = 0;
  RINGS.dirty = true;
  for (let i = 0; i < DASH.length; i++) { DASH[i].t = 0; placeDash(i); }
  MESH.dash.instanceMatrix.needsUpdate = true; MESH.dashDisc.instanceMatrix.needsUpdate = true;
  for (let i = 0; i < CPS.length; i++) { const c = CPS[i]; c.on = i <= ST.cp; c.spin = 0; c.mat.color.copy(c.on ? CP_ON : CP_OFF); c.mat.emissive.copy(c.on ? CP_ON_E : CP_OFF_E); c.arm.rotation.set(0, 0, 0); }
  trafficReset(sK, !!(opts && opts.full));
  ringWindow();
  MESH.bumper.t = 9; MESH.bumper.g.scale.set(1, 1, 1);
  MESH.goal.spin = 0; MESH.goal.w = 0; MESH.goal.panel.rotation.y = 0;
}
// ===================== per tick =====================
// detailed houses near the camera, box houses beyond (with a little hysteresis against flicker)
function lodUpdate() {
  const cam = K.view && K.view.camera;
  if (!cam) return;
  const x = cam.position.x - OX, y = cam.position.y, z = cam.position.z - OZ;
  const far = isTouch() ? 270 : 360;
  for (let i = 0; i < CK.list.length; i++) {
    const c = CK.list[i];
    if (!c.box || !c.lodMesh) continue; // (chunks without far versions keep everything)
    const b = c.box;
    const dx = Math.max(b.min.x - x, 0, x - b.max.x), dy = Math.max(b.min.y - y, 0, y - b.max.y), dz = Math.max(b.min.z - z, 0, z - b.max.z);
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const f = c.far ? d > far - 30 : d > far + 30;
    if (f !== c.far) { c.far = f; if (c.hdMesh) c.hdMesh.visible = !f; c.lodMesh.visible = f; if (c.folMesh) c.folMesh.visible = !f; }
  }
}
const _kc = new V3();
function update(dt, t) {
  if (!ST.built || !ST.entered) return;
  if (!(dt > 0 && dt < 0.25)) dt = 1 / 60;
  ST.time += dt;
  U.time.value = ST.time % 3600;
  cityTexSync();
  if (K.vehicles && K.vehicles.update) K.vehicles.update(dt, U.time.value);
  if (MESH.rings) K.util.spinY(MESH.rings.geometry, U.time.value * 3);
  const P = K.player;
  let kx = 0, kz = 0, ky = 0, alive = false;
  if (P && finV(P.pos)) {
    kx = P.pos.x; ky = P.pos.y; kz = P.pos.z; alive = !P.dead;
    const L = locate(kx - OX, kz - OZ);
    ST.kitOn = false;
    if (L && Math.abs(L.d) < 40) { ST.sK = L.s; ST.kitS = L.s; ST.kitD = L.d; ST.kitOn = ky < profY(L.s) + 6; }
    ST.vK = Math.hypot(P.vel.x, P.vel.z);
    ST.focus.set(kx - OX, ky, kz - OZ);
  }
  trafficUpdate(dt, ST.sK, ST.vK);
  // rings
  if (alive && P.center) {
    const c = P.center();
    let got = 0;
    for (let i = 0; i < RINGS.n; i++) {
      if (RINGS.got[i]) continue;
      const p = RINGS.pos[i], dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
      const rr = i >= RINGS.flight0 ? 2.5 : 1.55;
      if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
      RINGS.got[i] = 1; RINGS.dirty = true; got++;
      // a ring line would bury Kit under starbursts: the full burst at most every 0.3 s, small twinkles between
      if (ST.time - ST.pickT > 0.3) { ST.pickT = ST.time; fx('ringPickup', p); } else fx('twinkle', p, 4, 0xffd23f);
    }
    if (got) {
      const G = K.game;
      if (G && typeof G.addRings === 'function') { try { G.addRings(got); } catch (e) { console.error(e); } }
    }
    // star posts
    for (let i = 0; i < CPS.length; i++) {
      const cp = CPS[i];
      if (cp.on || ST.kitS < cp.s - 1) continue;
      if (Math.abs(ST.kitS - cp.s) > 30) continue;
      cp.on = true; cp.spin = 1;
      cp.mat.color.copy(CP_ON); cp.mat.emissive.copy(CP_ON_E);
      if (i > ST.cp) ST.cp = i;
      fx('twinkle', cp.pos, 10, 0x6fa8ff);
      const G = K.game;
      if (G && typeof G.setCheckpoint === 'function') { try { G.setCheckpoint(i); } catch (e) { console.error(e); } }
      else sfx('check');
    }
  }
  ringWindow();
  lodUpdate();
  for (const cp of CPS) if (cp.spin > 0) { cp.spin = Math.max(0, cp.spin - dt * 0.8); cp.arm.rotation.z = (1 - cp.spin) * TAU * 3; }
  // hoops pulse when crossed
  let dirty = false;
  for (let i = 0; i < DASH.length; i++) { const o = DASH[i]; if (o.t > 0) { o.t = Math.min(1.01, o.t + dt * 2.5); if (o.t >= 1.01) o.t = 0; placeDash(i); dirty = true; } }
  if (dirty) { MESH.dash.instanceMatrix.needsUpdate = true; MESH.dashDisc.instanceMatrix.needsUpdate = true; }
  // the bumper's pop, the goal sign's spin
  const Bm = MESH.bumper;
  if (Bm.t < 2) {
    Bm.t += dt;
    // the hit first squeezes the bumper, then it springs back once Kit is clear
    const k = 1 - Math.exp(-Bm.t * 5) * Math.sin(Bm.t * 22) * 0.14;
    Bm.g.scale.set(k, 1 + (k - 1) * 0.5, k);
    uBump.value = Math.exp(-Bm.t * 3);
  } else uBump.value = 0;
  const Gm = MESH.goal;
  if (Gm.w > 0) { Gm.spin += Gm.w * dt; Gm.w = Math.max(0, Gm.w - dt * 7); if (Gm.w === 0) Gm.spin = Math.round(Gm.spin / TAU) * TAU; Gm.panel.rotation.y = Gm.spin; }
  else Gm.panel.rotation.y = Math.sin(ST.time * 1.5) * 0.25;
  placeSun();
  void t;
}
function fx(name, a, b, c) { const X = K.vfx; if (X && typeof X[name] === 'function') { try { X[name](a, b, c); } catch (e) { /* effects never break play */ } } }
function sfx(name, arg) { try { if (K.audio && typeof K.audio.sfx === 'function') K.audio.sfx(name, arg); } catch (e) { /* ignore */ } }
function stats() {
  let left = 0;
  if (RINGS.got) for (let i = 0; i < RINGS.n; i++) if (!RINGS.got[i]) left++;
  return {
    built: ST.built, entered: ST.entered, buildMs: ST.buildMs, len: RT.len, rings: RINGS.n, ringsLeft: left, flightRings: RINGS.n - RINGS.flight0,
    cars: TR.active.length, parked: PARKED.length, cp: ST.cp, cps: CPS.length, s: +ST.sK.toFixed(1), solids: SOL.list.length, dash: DASH.length,
    chunks: CK.list.filter(c => c.mesh).length, lamps: LAMPS.length
  };
}
// city internals the vehicles part builds with (mesh builder, templates, surface kinds, shared colours, material)
K.cityLib = { MB, templates, TRS, KIND, lin, hash, U, cityMaterial, C_WHITE, IRON, STEEL, WOOD };
const C = K.city = {
  group: null, start: null, checkpoints: [], deathY: -3, bumper: null, goal: null, offset: new V3(OX, 0, OZ),
  build, enter, exit, update, reset, stats,
  ground: cityGround, collideWalls: cityWalls, route, routeAt, routePoint,
  get cars() { return TR.active; },
  get rails() { return RAILS; },
  get dash() { return DASH; },
  get ringData() { return RINGS; },
  get length() { return RT.len; },
  get sKit() { return ST.kitS; },
  get entered() { return ST.entered; },
  get built() { return ST.built; },
  get sunDir() { return SUN_DIR; },
  feature(name) { return FEAT[name]; },
  flight: { at: (u, out) => flightAt(u, out), get len() { return FL.len; } },
  dashHit(i) { const o = DASH[i]; if (o) { o.t = 0.001; placeDash(i); } },
  bumperHit() { if (MESH.bumper) MESH.bumper.t = 0; },
  goalHit() { if (MESH.goal) MESH.goal.w = 28; },
  surfaceY(s, d) { return profY(clamp(s, 0, RT.len)) + surface(clamp(s, 0, RT.len), d).y; },
  setFocus(v) { if (finV(v)) ST.focus.set(v.x - OX, v.y, v.z - OZ); },
  _dbg: { MESH, CT, ST, TSL }
};
})();
