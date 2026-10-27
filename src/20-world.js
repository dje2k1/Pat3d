import { CSMShadowNode as worldCSM } from 'three/addons/csm/CSMShadowNode.js';
(() => {
  'use strict';
  // ======================= WORLD: Collines Émeraude, Acte 1 =======================
  if (typeof THREE === 'undefined') return; // K.boot shows the French error screen
  const TAU = Math.PI * 2;
  const SEA = 0, DEEP = -14, HOLE = -0.4, STEP = 0.3, CELL = 1, WALK_NY = 0.55, EDGE = 0.1;
  const V3 = THREE.Vector3;
  const UP = new V3(0, 1, 0);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  const fin = (v) => typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;
  const lin = (hex) => new THREE.Color(hex); // r186 colour management: sRGB hex -> linear working space
  const SUN_DIR = new V3(0.5, 0.7, -0.42).normalize();
  const LIGHT_PI = Math.PI; // r128 -> r186 light units (see HEMI_BASE)
  const SUN_HEX = '#fff0d4';
  const FOG_HEX = '#cfeaff';

  function rngOf(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function ihash(ix, iz, s) {
    let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, z, s) {
    const ix = Math.floor(x), iz = Math.floor(z);
    let fx = x - ix, fz = z - iz;
    fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    const a = ihash(ix, iz, s), b = ihash(ix + 1, iz, s), c = ihash(ix, iz + 1, s), d = ihash(ix + 1, iz + 1, s);
    return (a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz) * 2 - 1;
  }
  function fbm(x, z, s, oct) {
    let v = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { v += vnoise(x * f, z * f, s + i * 17) * a; n += a; a *= 0.5; f *= 2.03; }
    return v / n;
  }

  // ======================= level design data =======================
  // Route = turtle path. 'Z' runs straight (heading must be 0 = -Z) until that z; 'A' = arc [radius, angle] (+ = left).
  const ROUTE_START = { x: 0, z: 30 };
  const ROUTE = [['Z', -56], ['A', 38, 0.7], ['A', 38, -1.4], ['A', 38, 0.7], ['Z', -290],
    ['A', 60, -0.6], ['A', 60, 0.6], ['Z', -560], ['A', 50, 0.45], ['A', 50, -0.45], ['Z', -640]];
  // keys are [routeZ, value...] with z descending, cosine eased in between
  const FLOOR = [[60, 20], [-50, 20], [-152, 16], [-211, 16], [-211.01, 26], [-290, 26], [-358, 7], [-372, 7],
    [-388, 4], [-482, 4], [-494, 7], [-556, 7], [-586, 12], [-700, 12]];
  const BUMPS = [[-62, -146, 1.5, 21], [-308, -320, 0.9, 12], [-330, -342, 0.9, 12]];
  const RAMP = { z0: -362, z1: -372, rise: 2.5 };
  const HALFW = [[60, 20, 20], [-36, 17, 17], [-56, 11, 11], [-92, 11, 11], [-98, 11, 16.5], [-104, 11, 16.5],
    [-110, 11, 11], [-196, 11, 11], [-203, 5.8, 5.8], [-210, 5.8, 5.8], [-214, 11, 11], [-290, 11, 11], [-330, 12, 12],
    [-350, 9, 9], [-388, 9, 9], [-394, 10, 10], [-411, 10, 10], [-417, 3.6, 3.6], [-473, 3.6, 3.6], [-480, 11, 11],
    [-518, 11, 11], [-525, 5.5, 5.5], [-550, 5.5, 5.5], [-553, 10, 10], [-556, 10, 16.5], [-569, 10, 16.5],
    [-574, 10, 10], [-586, 8, 8], [-594, 7, 7], [-700, 7, 7]];
  const WALLH = [[60, 6], [-40, 7], [-60, 10], [-200, 10], [-212, 9], [-290, 10], [-360, 12], [-470, 12],
    [-500, 10], [-570, 9], [-586, 0], [-700, 0]];
  const COAST = [[60, 26], [-30, 48], [-100, 60], [-300, 66], [-430, 60], [-540, 52], [-574, 38], [-588, 8.5], [-700, 8.5]];
  const CUTS = [{ z0: -236, z1: -262 }, { z0: -420, z1: -470 }, { z0: -532, z1: -550 }];
  const LAKE = { x: 0, z: -379.5, rx: 22, rz: 7 };
  const ARENA = { x: 0, z: -640, y: 12, r: 26, flat: 28.5 };
  const LOOP_DEFS = [{ z: -180, d: -1.5 }, { z: -510, d: -1.5 }];
  const LOOP_R = 7, LOOP_SHIFT = 5, LOOP_W = 4.6, LOOP_THICK = 1.25, LOOP_LOW = 6, LOOP_NUDGE = 0.6;

  function keyInterp(keys, z, idx) {
    const n = keys.length;
    if (!(z < keys[0][0])) return keys[0][idx];
    if (z < keys[n - 1][0]) return keys[n - 1][idx];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (keys[m][0] > z) lo = m; else hi = m; }
    const a = keys[lo], b = keys[hi];
    const span = a[0] - b[0];
    const t = span > 1e-9 ? (a[0] - z) / span : 1;
    return a[idx] + (b[idx] - a[idx]) * (0.5 - 0.5 * Math.cos(Math.PI * t));
  }
  function floorBase(zr) { return keyInterp(FLOOR, zr, 1); }
  function floorAt(zr) {
    let y = keyInterp(FLOOR, zr, 1);
    for (let i = 0; i < BUMPS.length; i++) {
      const b = BUMPS[i];
      if (zr < b[0] && zr > b[1]) { const sn = Math.sin(Math.PI * (b[0] - zr) / b[3]); y += b[2] * sn * sn; }
    }
    if (zr < RAMP.z0 && zr > RAMP.z1 - 1.5) { const t = clamp((RAMP.z0 - zr) / (RAMP.z0 - RAMP.z1), 0, 1); y += RAMP.rise * t * t; }
    return y;
  }

  // ======================= route path =======================
  const PA = { n: 0, x: null, z: null, s: null, yaw: null };
  function buildPath() {
    const xs = [], zs = [], ss = [], ys = [];
    let x = ROUTE_START.x, z = ROUTE_START.z, yaw = 0, s = 0;
    const ds = 0.5;
    const push = () => { xs.push(x); zs.push(z); ss.push(s); ys.push(yaw); };
    push();
    for (const c of ROUTE) {
      if (c[0] === 'Z') {
        if (Math.abs(yaw) < 1e-6) yaw = 0;
        const cy = Math.cos(yaw);
        const L = Math.max(0, (z - c[1]) / (cy > 0.2 ? cy : 1));
        const n = Math.max(1, Math.round(L / ds)), st = L / n;
        for (let i = 0; i < n; i++) { x -= Math.sin(yaw) * st; z -= Math.cos(yaw) * st; s += st; push(); }
      } else {
        const L = c[1] * Math.abs(c[2]), n = Math.max(1, Math.round(L / ds)), dy = c[2] / n;
        const st = 2 * c[1] * Math.sin(Math.abs(dy) / 2);
        for (let i = 0; i < n; i++) {
          const ym = yaw + dy / 2;
          x -= Math.sin(ym) * st; z -= Math.cos(ym) * st; yaw += dy; s += st; push();
        }
      }
    }
    PA.n = xs.length;
    PA.x = Float64Array.from(xs); PA.z = Float64Array.from(zs); PA.s = Float64Array.from(ss); PA.yaw = Float64Array.from(ys);
  }
  // route frame at a given route z (z is monotonic along the route)
  function routeAtZ(zq, out) {
    const n = PA.n, Z = PA.z;
    let i;
    if (!(zq < Z[0])) i = 0;
    else if (!(zq > Z[n - 1])) i = n - 2;
    else {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (Z[m] >= zq) lo = m; else hi = m; }
      i = lo;
    }
    const dz = Z[i] - Z[i + 1];
    const t = dz > 1e-9 ? (Z[i] - zq) / dz : 0;
    const yaw = PA.yaw[i] + (PA.yaw[i + 1] - PA.yaw[i]) * clamp(t, 0, 1);
    out.dx = -Math.sin(yaw); out.dz = -Math.cos(yaw);
    out.rx = -out.dz; out.rz = out.dx;
    out.yaw = yaw;
    out.x = PA.x[i] + (PA.x[i + 1] - PA.x[i]) * t;
    out.z = zq;
    out.s = PA.s[i] + (PA.s[i + 1] - PA.s[i]) * t;
    return out;
  }
  // nearest point on the route polyline (the route is monotonic in z)
  let _nbD = 0, _nbI = 0, _nbT = 0;
  function segTest(j, x, z) {
    const X = PA.x, Z = PA.z;
    const ax = X[j], az = Z[j], vx = X[j + 1] - ax, vz = Z[j + 1] - az;
    const L2 = vx * vx + vz * vz;
    let t = L2 > 1e-12 ? ((x - ax) * vx + (z - az) * vz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + vx * t - x, pz = az + vz * t - z;
    const d2 = px * px + pz * pz;
    if (d2 < _nbD) { _nbD = d2; _nbI = j; _nbT = t; }
  }
  function nearest(x, z, out) {
    const n = PA.n, X = PA.x, Z = PA.z;
    let lo;
    if (z >= Z[0]) lo = 0;
    else if (z <= Z[n - 1]) lo = n - 2;
    else { let a = 0, b = n - 1; while (b - a > 1) { const m = (a + b) >> 1; if (Z[m] >= z) a = m; else b = m; } lo = a; }
    lo = Math.min(lo, n - 2);
    _nbD = 1e18; _nbI = 0; _nbT = 0;
    for (let j = lo; j >= 0; j--) { const g = Z[j + 1] - z; if (g > 0 && g * g > _nbD) break; segTest(j, x, z); }
    for (let j = lo + 1; j <= n - 2; j++) { const g = z - Z[j]; if (g > 0 && g * g > _nbD) break; segTest(j, x, z); }
    const best = _nbD, bi = _nbI, bt = _nbT;
    const ax = X[bi], az = Z[bi], vx = X[bi + 1] - ax, vz = Z[bi + 1] - az;
    const L = Math.sqrt(vx * vx + vz * vz) || 1;
    const px = ax + vx * bt, pz = az + vz * bt;
    out.dx = vx / L; out.dz = vz / L;
    out.px = px; out.zr = pz;
    out.s = PA.s[bi] + (PA.s[bi + 1] - PA.s[bi]) * bt;
    out.d = (x - px) * (-out.dz) + (z - pz) * out.dx;
    out.dist = Math.sqrt(best);
    return out;
  }

  // ======================= terrain =======================
  const T = { XMIN: 0, ZMIN: 0, NX: 0, NZ: 0, H: null, AO: null, RS: null, RD: null, RM: null, MT: null };
  const RF = { X0: 0, Z0: 0, NX: 0, NZ: 0, C: 16, V: null };
  function buildRef() {
    const C = RF.C;
    RF.X0 = T.XMIN - C; RF.Z0 = T.ZMIN - C;
    RF.NX = Math.ceil((T.NX * CELL) / C) + 3; RF.NZ = Math.ceil((T.NZ * CELL) / C) + 3;
    RF.V = new Float32Array(RF.NX * RF.NZ);
    const sig2 = 2 * 26 * 26, n = PA.n;
    for (let j = 0; j < RF.NZ; j++) {
      const z = RF.Z0 + j * C;
      for (let i = 0; i < RF.NX; i++) {
        const x = RF.X0 + i * C;
        let sw = 0, sv = 0, bd = 1e18, bz = 0;
        for (let k = 0; k < n; k += 4) {
          const dz = PA.z[k] - z;
          if (dz > 90 || dz < -90) continue;
          const dx = PA.x[k] - x, d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; bz = PA.z[k]; }
          const w = Math.exp(-d2 / sig2);
          sw += w; sv += w * floorBase(PA.z[k]);
        }
        RF.V[j * RF.NX + i] = sw > 1e-5 ? sv / sw : floorBase(bd < 1e17 ? bz : z);
      }
    }
  }
  function refAt(x, z) {
    let fx = (x - RF.X0) / RF.C, fz = (z - RF.Z0) / RF.C;
    fx = clamp(fx, 0, RF.NX - 1.001); fz = clamp(fz, 0, RF.NZ - 1.001);
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, i = iz * RF.NX + ix;
    const a = RF.V[i], b = RF.V[i + 1], c = RF.V[i + RF.NX], d = RF.V[i + RF.NX + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }
  function heightAt(x, z, nr) {
    const zr = nr.zr, lat = nr.dist;
    const hw = keyInterp(HALFW, zr, nr.d >= 0 ? 2 : 1);
    nr.hw = hw;
    const ax = x - ARENA.x, az = z - ARENA.z, ra = Math.sqrt(ax * ax + az * az);
    const cdb = keyInterp(COAST, zr, 1);
    // open sea far from the coast (coast noise shifts the shore by at most 14)
    if (lat > cdb + 25.5 && ra >= ARENA.flat + 12) return DEEP;
    const fl = floorAt(zr);
    const floorY = fl + sstep(Math.max(hw - 4.5, hw * 0.68), hw, lat) * sstep(3.8, 6, hw);
    const wall = keyInterp(WALLH, zr, 1);
    const wk = Math.min(1, wall / 6);
    const far = sstep(hw + 5, hw + 34, lat);
    let hill = refAt(x, z) + wall + wk * (fbm(x * 0.03, z * 0.03, 11, 3) * (1.5 + 8 * far) + far * 6);
    hill = Math.max(hill, fl + Math.min(5, wall));
    let h = lerp(floorY, hill, sstep(hw, hw + 2.5, lat));
    const cd = cdb + fbm(x * 0.017 + 40, z * 0.017, 23, 3) * clamp(cdb - 10, 0, 14);
    h = lerp(h, -1.6, sstep(cd, cd + 4.5, lat));
    h = lerp(h, DEEP, sstep(cd + 6.5, cd + 11, lat));
    if (ra < ARENA.flat) h = ARENA.y;
    else if (ra < ARENA.flat + 12) {
      let ha = lerp(ARENA.y, -1.6, sstep(ARENA.flat, ARENA.flat + 3.2, ra));
      ha = lerp(ha, DEEP, sstep(ARENA.flat + 5, ARENA.flat + 9, ra));
      h = Math.max(h, ha);
    }
    for (let k = 0; k < CUTS.length; k++) {
      const c = CUTS[k];
      if (z > c.z0 + 3.6 || z < c.z1 - 3.6) continue;
      let z0 = c.z0, z1 = c.z1;
      if (lat > hw + 5) {
        const amp = sstep(hw + 5, hw + 14, lat) * 3.5;
        z0 += fbm(x * 0.09, c.z0 * 0.09, 41, 2) * amp;
        z1 += fbm(x * 0.09, c.z1 * 0.09, 43, 2) * amp;
      }
      if (z < z0 && z > z1) { h = DEEP; break; }
    }
    const lx = (x - LAKE.x) / LAKE.rx, lz = (z - LAKE.z) / LAKE.rz;
    let lr = lx * lx + lz * lz;
    if (lat > hw + 2 && lr < 1.3) lr += fbm(x * 0.1, z * 0.1, 53, 2) * 0.25;
    if (lr < 1) h = DEEP;
    return h;
  }
  function buildTerrain() {
    let mnx = 1e9, mxx = -1e9;
    for (let i = 0; i < PA.n; i++) { mnx = Math.min(mnx, PA.x[i]); mxx = Math.max(mxx, PA.x[i]); }
    const pad = 98;
    T.XMIN = Math.floor((mnx - pad) / CELL) * CELL;
    const XMAX = Math.ceil((mxx + pad) / CELL) * CELL;
    T.ZMIN = Math.floor((PA.z[PA.n - 1] - 46) / CELL) * CELL;
    const ZMAX = Math.ceil((PA.z[0] + 66) / CELL) * CELL;
    T.NX = (XMAX - T.XMIN) / CELL + 1; T.NZ = (ZMAX - T.ZMIN) / CELL + 1;
    const N = T.NX * T.NZ;
    T.H = new Float32Array(N); T.RS = new Float32Array(N); T.RD = new Float32Array(N); T.RM = new Float32Array(N); T.AO = new Float32Array(N);
    T.MT = new Float32Array(N * 4); // shading only: path weight, sand weight, mowing direction (x, z)
    buildRef();
    const nr = {};
    for (let iz = 0; iz < T.NZ; iz++) {
      const z = T.ZMIN + iz * CELL;
      for (let ix = 0; ix < T.NX; ix++) {
        const x = T.XMIN + ix * CELL, i = iz * T.NX + ix;
        nearest(x, z, nr);
        let h = heightAt(x, z, nr);
        if (ix === 0 || iz === 0 || ix === T.NX - 1 || iz === T.NZ - 1) h = Math.min(h, DEEP);
        T.H[i] = h;
        const hw = nr.hw;
        const ra = Math.sqrt((x - ARENA.x) * (x - ARENA.x) + (z - ARENA.z) * (z - ARENA.z));
        const i4 = i * 4;
        if (ra < ARENA.r - 1.5) {
          // the arena lawn is mown in rings around its centre
          T.RS[i] = ra * 1.75 + 3.5; T.RD[i] = ra + 2.75; T.RM[i] = 1.4 * (1 - sstep(ARENA.r - 4, ARENA.r - 2, ra));
          const ia = ra > 1e-3 ? 1 / ra : 0;
          T.MT[i4 + 2] = -(z - ARENA.z) * ia; T.MT[i4 + 3] = (x - ARENA.x) * ia;
        } else {
          T.RS[i] = nr.s; T.RD[i] = nr.d; T.RM[i] = (1 - sstep(hw - 1.5, hw + 0.5, nr.dist)) * sstep(ARENA.r - 2, ARENA.r + 1, ra);
          T.MT[i4 + 2] = nr.dx; T.MT[i4 + 3] = nr.dz;
          // a worn dirt path meandering along the valley floor, in stretches
          const s = nr.s, lim = Math.max(0, hw - 3.4);
          const pc = clamp(3.6 * Math.sin(s * 0.019 + 1.1) + 1.6 * Math.sin(s * 0.047 + 0.3), -lim, lim);
          const pw = 1.2 + 0.35 * Math.sin(s * 0.061 + 2);
          const pres = sstep(0.02, 0.14, vnoise(s * 0.012, 0.5, 71)) * sstep(ARENA.flat, ARENA.flat + 6, ra);
          T.MT[i4] = pres * (1 - sstep(pw - 0.9, pw + 1.1, Math.abs(nr.d - pc))) * (1 - sstep(hw - 1.5, hw + 0.5, nr.dist));
        }
        T.MT[i4 + 1] = h > -6 ? 1 - sstep(0.9, 2.7, h) : 0;
      }
    }
    // cavity darkening (cheap ambient occlusion): the surroundings' mean height above the point at 2 m and 6 m
    const R1 = Math.max(1, Math.round(2 / CELL)), R = Math.max(1, Math.round(6 / CELL)), NX = T.NX, NZ = T.NZ, H = T.H;
    for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
      let s = 0, s1 = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        s += H[clamp(iz + dz * R, 0, NZ - 1) * NX + clamp(ix + dx * R, 0, NX - 1)];
        s1 += H[clamp(iz + dz * R1, 0, NZ - 1) * NX + clamp(ix + dx * R1, 0, NX - 1)];
      }
      const i = iz * NX + ix;
      T.AO[i] = clamp(1 - Math.max(0, s / 8 - H[i]) * 0.045 - Math.max(0, s1 / 8 - H[i]) * 0.07, 0.5, 1);
    }
  }
  function terrainY(x, z) {
    const fx = (x - T.XMIN) / CELL, fz = (z - T.ZMIN) / CELL;
    if (!(fx >= 0 && fz >= 0 && fx <= T.NX - 1 && fz <= T.NZ - 1)) return DEEP;
    let ix = fx | 0, iz = fz | 0;
    if (ix > T.NX - 2) ix = T.NX - 2;
    if (iz > T.NZ - 2) iz = T.NZ - 2;
    const tx = fx - ix, tz = fz - iz, i = iz * T.NX + ix, H = T.H;
    const a = H[i], b = H[i + 1], c = H[i + T.NX], d = H[i + T.NX + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }
  function terrainNormal(x, z, out) {
    const fx = (x - T.XMIN) / CELL, fz = (z - T.ZMIN) / CELL;
    if (!(fx >= 0 && fz >= 0 && fx <= T.NX - 1 && fz <= T.NZ - 1)) return out.set(0, 1, 0);
    let ix = fx | 0, iz = fz | 0;
    if (ix > T.NX - 2) ix = T.NX - 2;
    if (iz > T.NZ - 2) iz = T.NZ - 2;
    const tx = fx - ix, tz = fz - iz, i = iz * T.NX + ix, H = T.H;
    const a = H[i], b = H[i + 1], c = H[i + T.NX], d = H[i + T.NX + 1];
    const k = a - b - c + d;
    const gx = ((b - a) + k * tz) / CELL, gz = ((c - a) + k * tx) / CELL;
    const l = Math.sqrt(gx * gx + 1 + gz * gz);
    return out.set(-gx / l, 1 / l, -gz / l);
  }

  // ======================= shared shader bits (TSL) =======================
  const { Fn, uniform, attribute, vec2, vec3, vec4, float, mix, smoothstep, clamp: tclamp, abs: tabs, max: tmax, min: tmin, fract: tfract,
    floor: tfloor, sin: tsin, cos: tcos, pow: tpow, exp: texp, dot: tdot, normalize: tnormalize, cross: tcross, reflect: treflect, length: tlength,
    atan: tatan, select, dFdx, dFdy, positionWorld, positionLocal, positionGeometry, normalWorld, normalViewGeometry, normalGeometry, cameraPosition,
    cameraViewMatrix, cameraProjectionMatrix, modelWorldMatrix, instanceIndex, texture: ttexture, step: tstep, sqrt: tsqrt, uv: tuv } = TSL;
  const TL = K.tsl;
  const TIME = uniform(0);
  const CAMXZ = uniform(new THREE.Vector2());
  const GM_UNI = {
    gmGrassA: uniform(lin('#3cbd48')), gmGrassB: uniform(lin('#23933a')),
    gmLip: uniform(lin('#1a7a30')), gmLipHi: uniform(lin('#8af078')),
    gmChkA: uniform(lin('#e08c3e')), gmChkB: uniform(lin('#9c5222')),
    gmPath: uniform(lin('#b88a5c')), gmSand: uniform(lin('#f0dcae')), gmStripe: uniform(0.075)
  };
  // ---- generated PBR textures (tools/tex/world_tex.py, group 'act1': preloaded before the island is built)
  const WT = {};
  // mean linear albedo of each tiling texture: the shaders tint by (texture / mean) so the level keeps its palette
  const TEX_MEAN = { grass: [0.0964, 0.283, 0.0344], soil: [0.2437, 0.1275, 0.0593], rock: [0.5936, 0.4743, 0.3299],
    sand: [0.6886, 0.5469, 0.3079], bark: [0.1592, 0.109, 0.0688], leaves: [0.0684, 0.3933, 0.0467], wood: [0.3492, 0.1436, 0.0443] };
  function wtex(name, opts) {
    if (WT[name]) return WT[name];
    let t = null;
    try { t = K.tex && K.tex.load ? K.tex.load('world/' + name, opts) : null; } catch (e) { t = null; }
    if (!t) { t = new THREE.Texture(); t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    WT[name] = t;
    return t;
  }
  const meanInv = k => vec3(1 / TEX_MEAN[k][0], 1 / TEX_MEAN[k][1], 1 / TEX_MEAN[k][2]);
  // tangent-space normal texel (0..1) -> -1..1 xy (OpenGL +Y), scaled
  const nXY = (t, k) => t.xy.mul(2).sub(1).mul(k);
  const rot2 = (p, a) => vec2(p.x.mul(Math.cos(a)).sub(p.y.mul(Math.sin(a))), p.x.mul(Math.sin(a)).add(p.y.mul(Math.cos(a))));
  // macro grass colour: lush / dry patches over tens of metres (v2 palette); the blades take the same tint
  const grassTint = (xz) => {
    const gn1 = TL.vnoise(xz.mul(0.045));
    let t = mix(GM_UNI.gmGrassA, GM_UNI.gmGrassB, smoothstep(0.25, 0.8, gn1));
    const gPatch = TL.vnoise(xz.mul(0.075).add(13));
    t = mix(t, t.mul(vec3(1.16, 1.06, 0.66)), smoothstep(0.6, 0.88, gPatch).mul(0.5));
    return mix(t, t.mul(vec3(0.78, 0.92, 0.86)), smoothstep(0.62, 0.9, float(1).sub(gPatch)).mul(0.45));
  };
  // checkerboard tile colour with bevelled edges (faded out where a square is a few pixels wide)
  const gmCheckerShade = (p, w) => {
    const f = tfract(p), w2 = w.mul(1.5).add(1e-4);
    const fade = tclamp(float(1).sub(tmax(w2.x, w2.y).mul(3.5)), 0, 1);
    const hi = tmax(smoothstep(float(0.92).sub(w2.y), float(0.92).add(w2.y), f.y), float(1).sub(smoothstep(float(0.06).sub(w2.x), float(0.06).add(w2.x), f.x)));
    const lo = tmax(float(1).sub(smoothstep(float(0.06).sub(w2.y), float(0.06).add(w2.y), f.y)), smoothstep(float(0.94).sub(w2.x), float(0.94).add(w2.x), f.x));
    return float(1).add(fade.mul(hi.mul(0.16).sub(lo.mul(0.22))));
  };
  // Emerald grass / lip / checkerboard ground, textured PBR (grass, sandstone, soil path, beach sand).
  // mode: 'terrain' (heightfield: lawn stripes, path / sand weights and baked cavity AO from vertex attributes),
  // 'prop' / 'local' (aLip skirt blend; local = checker in object space), 'checker' (plain checkerboard: loop shells).
  // The checkered cliffs stay the level's identity: each 2.5 m square is a sandstone face (its own offset into the rock
  // texture, light orange / dark brown tint, bevelled edges); grass covers whatever is flat enough, with a darker lip.
  function groundMaterial(mode) {
    const m = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    const terrain = mode === 'terrain', local = mode === 'local', propLip = mode === 'prop' || mode === 'local', chkOnly = mode === 'checker';
    const tGA = wtex('grass_albedo'), tGN = wtex('grass_normal'), tGO = wtex('grass_orm');
    const tRA = wtex('rock_albedo'), tRN = wtex('rock_normal'), tRO = wtex('rock_orm');
    // (pure expressions: no assign outside Fn; derivatives and texture fetches are taken at the top level)
    const gN = tnormalize(normalWorld);
    const gP = local ? positionGeometry : positionWorld;
    const gA = tabs(gN);
    const gqY = gP.xz.mul(0.4), gqX = gP.zy.mul(0.4), gqZ = gP.xy.mul(0.4);
    const gwY = TL.fw(gqY), gwX = TL.fw(gqX), gwZ = TL.fw(gqZ);
    const dxY = dFdx(gqY), dyY = dFdy(gqY), dxX = dFdx(gqX), dyX = dFdy(gqX), dxZ = dFdx(gqZ), dyZ = dFdy(gqZ);
    const gUY = gA.y.greaterThan(gA.x).and(gA.y.greaterThan(gA.z)), gUX = gA.x.greaterThan(gA.z);
    const gq = select(gUY, gqY, select(gUX, gqX, gqZ));
    const gw = select(gUY, gwY, select(gUX, gwX, gwZ));
    const gdx = select(gUY, dxY, select(gUX, dxX, dxZ)), gdy = select(gUY, dyY, select(gUX, dyX, dyZ));
    // ---- checker squares: sandstone, one texture repeat per square at a per-square offset (no visible tiling)
    const tile = tfloor(gq);
    const tileH = TL.hash21(tile.add(vec2(3.7, 1.3)));
    // (two texture repeats per square: the sandstone's strata and cracks stay stone-sized, not plank-sized)
    const rUV = gq.mul(1.9).add(vec2(tileH.mul(7.31), TL.hash21(tile.add(vec2(9.1, 4.2))).mul(5.17)));
    const rdx = gdx.mul(1.9), rdy = gdy.mul(1.9);
    const rA = ttexture(tRA, rUV).grad(rdx, rdy), rN = ttexture(tRN, rUV).grad(rdx, rdy), rO = ttexture(tRO, rUV).grad(rdx, rdy);
    const chkC = TL.checker(gq, gw);
    const gChk = mix(GM_UNI.gmChkA, GM_UNI.gmChkB, chkC).mul(mix(vec3(1), rA.rgb.mul(meanInv('rock')), 0.7))
      .mul(gmCheckerShade(gq, gw)).mul(float(0.9).add(tileH.mul(0.2)));
    const gTf = tfract(gq);
    const bevel = tclamp(float(1).sub(tmax(gw.x, gw.y).mul(5)), 0, 1).mul(0.6);
    const gBv = vec2(smoothstep(0.9, 1.0, gTf.x).sub(smoothstep(0.1, 0.0, gTf.x)), smoothstep(0.9, 1.0, gTf.y).sub(smoothstep(0.1, 0.0, gTf.y))).mul(bevel)
      .add(nXY(rN, 0.6));
    const chkBump = select(gUY, vec3(gBv.x, 0, gBv.y), select(gUX, vec3(0, gBv.y, gBv.x), vec3(gBv.x, gBv.y, 0)));
    const chkRough = rO.g, chkAO = rO.r;
    if (chkOnly) {
      m.colorNode = gChk.mul(mix(float(1), chkAO, 0.7));
      m.roughnessNode = chkRough;
      m.normalNode = tnormalize(normalViewGeometry.add(cameraViewMatrix.mul(vec4(chkBump, 0)).xyz));
      return m;
    }
    // ---- grass: two lookups (rotated, offset) blended by a slow noise so the 2.6 m tile never repeats visibly
    const gx = gP.xz;
    const uv1 = gx.mul(1 / 2.6), uv2 = rot2(gx, 1.13).mul(1 / 2.9).add(vec2(0.37, 0.61));
    const bw = smoothstep(0.32, 0.68, TL.vnoise(gx.mul(0.09).add(2.3)));
    const gA1 = ttexture(tGA, uv1), gA2 = ttexture(tGA, uv2);
    const gN1 = ttexture(tGN, uv1), gN2 = ttexture(tGN, uv2);
    const gO = ttexture(tGO, uv1);
    const gAlb = mix(gA1.rgb, gA2.rgb, bw).mul(meanInv('grass'));
    const gnA = nXY(gN1, 1), gnB = nXY(gN2, 1);
    const gnB2 = rot2(gnB, -1.13); // undo the lookup rotation (tangent frame of the second lookup)
    const grassN = mix(gnA, gnB2, bw).mul(0.8);
    const gTint = grassTint(gx);
    let gGrass = gTint.mul(gAlb);
    let gSt = float(1).sub(gN.y);
    let pathW = float(0), sandW = float(0), stripe = float(0);
    if (terrain) {
      // mowing stripes: bands parallel to the route, one centred on it (no edge down the middle of the screen behind
      // Kit); like a real lawn their shade depends on the view direction (blades bent along / against the mower)
      const R = attribute('aRoute', 'vec3'), MT = attribute('aMat', 'vec4');
      const band = smoothstep(-0.3, 0.3, tcos(R.y.mul(Math.PI / 5.5))).mul(2).sub(1);
      const vxz = tnormalize(cameraPosition.xz.sub(positionWorld.xz).add(vec2(1e-4, 0)));
      stripe = band.mul(tdot(vxz, MT.zw).mul(0.75).add(0.25)).mul(tclamp(R.z, 0, 1));
      // the mown lane is a finer, more even lawn than the rough grass on the hills (texture contrast x 0.7)
      gGrass = gTint.mul(mix(gAlb, mix(vec3(1), gAlb, 0.7), tclamp(R.z, 0, 1)));
      const gFN = tnormalize(tcross(dFdx(positionWorld), dFdy(positionWorld)));
      gSt = mix(gSt, float(1).sub(tabs(gFN.y)), 0.72);
      const nE = TL.vnoise(gx.mul(1.3)).sub(0.5).mul(0.34).add(TL.vnoise(gx.mul(4.1).add(9)).sub(0.5).mul(0.14));
      pathW = smoothstep(0.42, 0.62, MT.x.add(nE));
      sandW = smoothstep(0.35, 0.65, MT.y.add(nE.mul(1.4)));
    }
    gSt = gSt.add(TL.vnoise(gP.xz.mul(0.8).add(gP.y.mul(0.7))).sub(0.5).mul(0.07));
    const gMask = float(1).sub(smoothstep(0.31, 0.34, gSt));
    const gLipM = float(1).sub(smoothstep(0.39, 0.42, gSt));
    gGrass = gGrass.mul(float(1).add(stripe.mul(GM_UNI.gmStripe)));
    // ---- path (soil) and beach sand
    let col = gChk, bump = chkBump, rough = chkRough, ao = chkAO;
    const lipCol = GM_UNI.gmLip.mul(gAlb).mul(0.95);
    col = mix(col, lipCol, gLipM);
    bump = mix(bump, vec3(grassN.x, 0, grassN.y).mul(0.6), gLipM);
    rough = mix(rough, float(0.85), gLipM);
    ao = mix(ao, float(0.85), gLipM);
    let grassCol = gGrass, grassBump = vec3(grassN.x, 0, grassN.y), grassRough = gO.g, grassAO = gO.r;
    if (terrain) {
      const tSA = wtex('soil_albedo'), tSN = wtex('soil_normal'), tDA = wtex('sand_albedo'), tDN = wtex('sand_normal');
      // soil and sand: like the grass, two lookups (the second rotated and offset) blended by the slow noise, so a
      // beach or a long path never shows its 2 m tile
      const sUV = gx.mul(1 / 1.9), dUV = gx.mul(1 / 1.6), dUV2 = rot2(gx, 2.1).mul(1 / 1.75).add(vec2(0.19, 0.53));
      const sUV2 = rot2(gx, 0.7).mul(1 / 2.1).add(vec2(0.41, 0.17));
      const sA = mix(ttexture(tSA, sUV), ttexture(tSA, sUV2), bw), sN = ttexture(tSN, sUV);
      const dA = mix(ttexture(tDA, dUV), ttexture(tDA, dUV2), bw), dN = ttexture(tDN, dUV);
      // worn grass around the path: yellower, flattened
      const worn = smoothstep(0.2, 0.46, attribute('aMat', 'vec4').x).mul(float(1).sub(pathW));
      grassCol = mix(grassCol, grassCol.mul(vec3(1.25, 1.02, 0.7)), worn.mul(0.8));
      const soil = GM_UNI.gmPath.mul(mix(vec3(1), sA.rgb.mul(meanInv('soil')), 0.6));
      const sn2 = nXY(sN, 1.1);
      grassCol = mix(grassCol, soil, pathW);
      grassBump = mix(grassBump, vec3(sn2.x, 0, sn2.y), pathW);
      grassRough = mix(grassRough, float(0.93), pathW);
      grassAO = mix(grassAO, float(1), pathW);
      // beach sand, wet and darker toward the water line
      const wet = smoothstep(0.7, -0.3, positionWorld.y);
      const sand = GM_UNI.gmSand.mul(dA.rgb.mul(meanInv('sand'))).mul(mix(float(1), float(0.62), wet));
      const dn2 = nXY(dN, 0.9);
      grassCol = mix(grassCol, sand, sandW);
      grassBump = mix(grassBump, vec3(dn2.x, 0, dn2.y), sandW);
      grassRough = mix(grassRough, mix(float(0.9), float(0.38), wet), sandW);
      grassAO = mix(grassAO, float(1), sandW);
      // sand also creeps over the low checker faces near the beach
      col = mix(col, sand.mul(0.92), sandW.mul(0.85));
    }
    col = mix(col, grassCol, gMask);
    col = mix(col, GM_UNI.gmLipHi.mul(gAlb), gMask.mul(smoothstep(0.235, 0.3, gSt)).mul(0.35).mul(float(1).sub(pathW)).mul(float(1).sub(sandW)));
    bump = mix(bump, grassBump, gMask);
    rough = mix(rough, grassRough, gMask);
    ao = mix(ao, grassAO, gMask);
    if (propLip) {
      const lipA = tclamp(attribute('aLip', 'float'), 0, 1);
      col = mix(col, GM_UNI.gmLip.mul(gAlb).mul(0.85), lipA);
      bump = mix(bump, vec3(grassN.x, 0, grassN.y), lipA);
      ao = mix(ao, float(0.8), lipA);
    }
    if (terrain) {
      const bao = attribute('aAO', 'float');
      col = col.mul(mix(float(1), bao, 0.55));
      m.aoNode = ao.mul(bao).mul(bao); // the baked cavity term also shades the sky light and reflections
    } else m.aoNode = ao;
    m.colorNode = col;
    m.roughnessNode = rough;
    m.normalNode = tnormalize(normalViewGeometry.add(cameraViewMatrix.mul(vec4(bump, 0)).xyz));
    return m;
  }
  // Gulls: the wings (aAnim = 1 at the tips) flap; each bird has its own phase (instance index hash). The rest of the
  // island's vegetation sways through the decor materials (decorWind).
  function birdMaterial() {
    const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
    const aAnim = attribute('aAnim', 'float');
    const kPh = TL.hash21(vec2(float(instanceIndex).mul(0.37), 1.7)).mul(6.2832);
    m.positionNode = positionLocal.add(vec3(0, tsin(TIME.mul(9).add(kPh.mul(3))).mul(aAnim).mul(0.55), 0));
    return m;
  }

  // ======================= geometry builder =======================
  const _gv = new V3(), _gn = new V3(), _gm3 = new THREE.Matrix3();
  class GB {
    constructor() { this.P = []; this.N = []; this.C = []; this.X = []; this.I = []; this.n = 0; }
    add(geo, color, mat, extra) {
      const pa = geo.attributes.position, na = geo.attributes.normal, cnt = pa.count;
      if (mat) _gm3.getNormalMatrix(mat);
      for (let i = 0; i < cnt; i++) {
        _gv.fromBufferAttribute(pa, i);
        const lx = _gv.x, ly = _gv.y, lz = _gv.z;
        if (mat) _gv.applyMatrix4(mat);
        this.P.push(_gv.x, _gv.y, _gv.z);
        if (na) { _gn.fromBufferAttribute(na, i); if (mat) _gn.applyMatrix3(_gm3).normalize(); } else _gn.set(0, 1, 0);
        this.N.push(_gn.x, _gn.y, _gn.z);
        const c = typeof color === 'function' ? color(_gv, lx, ly, lz) : color;
        this.C.push(c.r, c.g, c.b);
        this.X.push(typeof extra === 'function' ? extra(_gv, lx, ly, lz) : (extra || 0));
      }
      if (geo.index) { const ia = geo.index.array; for (let i = 0; i < ia.length; i++) this.I.push(ia[i] + this.n); }
      else for (let i = 0; i < cnt; i++) this.I.push(i + this.n);
      this.n += cnt;
      geo.dispose();
      return this;
    }
    raw(P, N, color, extra, I) {
      const cnt = P.length / 3;
      for (let i = 0; i < cnt; i++) {
        this.P.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        this.N.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
        const c = Array.isArray(color) ? color[i] : color;
        this.C.push(c.r, c.g, c.b);
        this.X.push(Array.isArray(extra) ? extra[i] : (extra || 0));
      }
      for (let i = 0; i < I.length; i++) this.I.push(I[i] + this.n);
      this.n += cnt;
      return this;
    }
    build(extraName) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
      if (extraName) g.setAttribute(extraName, new THREE.Float32BufferAttribute(this.X, 1));
      g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1));
      g.computeBoundingSphere();
      return g;
    }
  }
  const M4 = () => new THREE.Matrix4();
  function TRS(x, y, z, rx, ry, rz, sx, sy, sz) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0, 'YXZ'));
    return M4().compose(new V3(x, y, z), q, new V3(sx == null ? 1 : sx, sy == null ? (sx == null ? 1 : sx) : sy, sz == null ? (sx == null ? 1 : sx) : sz));
  }

  // ======================= state =======================
  const S = {
    built: false, scene: null, time: 0, simTime: 0, lastWall: 0, focus: new V3(0, 20, 0),
    sun: null, hemi: null, fog: null, sky: null, sunSprite: null, sea: null, seaMat: null,
    touch: false, movers: [], birds: null, birdData: [], mist: null, mistData: [],
    shadowExt: 46, shadowSize: 2048, envPos: new V3(), bg: null, own: [], shown: true
  };
  const _tmpM = new THREE.Matrix4(), _tmpQ = new THREE.Quaternion(), _tmpS = new V3(), _tmpP = new V3(), _tmpE = new THREE.Euler();
  const _n = new V3(), _n2 = new V3(), _ra = {}, _nr = {};

  // ======================= queries (K.world API) =======================
  const _ground = { y: 0, n: new V3(0, 1, 0), solid: null };
  function ground(x, z, yTop) {
    if (!fin(x) || !fin(z)) return null;
    const lim = (fin(yTop) ? yTop : 1e9) + 0.05;
    let best = -Infinity, bs = null;
    const th = terrainY(x, z);
    if (th > HOLE && th <= lim) best = th;
    const sol = W.solids;
    for (let k = 0; k < sol.length; k++) {
      const s = sol[k];
      if (!s || !s.max || !s.min || s.noTop) continue;
      const top = s.max.y;
      if (!(top <= lim) || top < best - 0.02 || (bs && top <= best)) continue;
      if (x < s.min.x - EDGE || x > s.max.x + EDGE || z < s.min.z - EDGE || z > s.max.z + EDGE) continue;
      best = top; bs = s;
    }
    if (best === -Infinity) return null;
    _ground.y = best; _ground.solid = bs;
    if (bs) _ground.n.set(0, 1, 0); else terrainNormal(x, z, _ground.n);
    return _ground;
  }
  // thin walls along polylines (causeway rim): segments with a half thickness and a height range
  const SEGW = { list: [], x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 };
  const _walls = { hit: false, nx: 0, nz: 0 };
  const DC = [], DS = [];
  for (let k = 0; k < 8; k++) { DC.push(Math.cos(k * TAU / 8)); DS.push(Math.sin(k * TAU / 8)); }
  function collideWalls(pos, radius, height) {
    _walls.hit = false; _walls.nx = 0; _walls.nz = 0;
    if (!pos || !fin(pos.x) || !fin(pos.y) || !fin(pos.z)) return _walls;
    const r = fin(radius) && radius > 0 ? radius : 0.45, hgt = fin(height) && height > 0 ? height : 1.2;
    let ax = 0, az = 0;
    const sol = W.solids;
    for (let k = 0; k < sol.length; k++) {
      const s = sol[k];
      if (!s || !s.max || !s.min) continue;
      if (s.max.y <= pos.y + STEP || s.min.y >= pos.y + hgt) continue;
      if (pos.x < s.min.x - r || pos.x > s.max.x + r || pos.z < s.min.z - r || pos.z > s.max.z + r) continue;
      const cx = clamp(pos.x, s.min.x, s.max.x), cz = clamp(pos.z, s.min.z, s.max.z);
      const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let nx, nz, push;
      if (d2 > 1e-10) { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; push = r - d; }
      else {
        const l = pos.x - s.min.x, rr = s.max.x - pos.x, b = pos.z - s.min.z, f = s.max.z - pos.z;
        const m = Math.min(l, rr, b, f);
        if (m === l) { nx = -1; nz = 0; } else if (m === rr) { nx = 1; nz = 0; } else if (m === b) { nx = 0; nz = -1; } else { nx = 0; nz = 1; }
        push = m + r;
      }
      pos.x += nx * (push + 1e-4); pos.z += nz * (push + 1e-4);
      ax += nx; az += nz; _walls.hit = true;
    }
    if (SEGW.list.length && pos.x > SEGW.x0 - 2 && pos.x < SEGW.x1 + 2 && pos.z > SEGW.z0 - 2 && pos.z < SEGW.z1 + 2) {
      for (let k = 0; k < SEGW.list.length; k++) {
        const g = SEGW.list[k];
        if (g.y1 <= pos.y + STEP || g.y0 >= pos.y + hgt) continue;
        const t = clamp((pos.x - g.ax) * g.ux + (pos.z - g.az) * g.uz, 0, g.len);
        let dx = pos.x - (g.ax + g.ux * t), dz = pos.z - (g.az + g.uz * t);
        const R = r + g.ht, d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        // one-sided wall: only pushes a body whose centre is on its outer side
        if (g.one && (pos.x - g.ax) * g.nx + (pos.z - g.az) * g.nz < 0) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-6) { if (g.one) { dx = g.nx; dz = g.nz; } else { dx = g.uz; dz = -g.ux; } d = 1; } // on the line
        const nx = dx / d, nz = dz / d, push = R - Math.min(d, R);
        pos.x += nx * (push + 1e-4); pos.z += nz * (push + 1e-4);
        ax += nx; az += nz; _walls.hit = true;
      }
    }
    for (let it = 0; it < 2; it++) {
      const base = pos.y + STEP;
      let bestD = 0, bnx = 0, bnz = 0;
      const hc = terrainY(pos.x, pos.z), centerIn = hc > base;
      for (let k = 0; k < 8; k++) {
        const dx = DC[k], dz = DS[k];
        const qx = pos.x + dx * r, qz = pos.z + dz * r;
        const h = terrainY(qx, qz);
        if (h <= base || h < HOLE) continue;
        terrainNormal(qx, qz, _n);
        // a one-cell cliff face: the probe beyond it sits on the flat top (walkable normal), but the rise from the
        // centre to the probe is far steeper than any walkable slope
        if (_n.y >= WALK_NY && (centerIn || h - hc <= r * 1.6)) continue;
        let lo = 0, hi = r;
        if (!centerIn) {
          for (let j = 0; j < 6; j++) { const m = (lo + hi) * 0.5; if (terrainY(pos.x + dx * m, pos.z + dz * m) > base) hi = m; else lo = m; }
        }
        const depth = r - (lo + hi) * 0.5;
        if (depth > bestD) {
          bestD = depth;
          const hl = Math.sqrt(_n.x * _n.x + _n.z * _n.z);
          if (hl > 1e-5) { bnx = _n.x / hl; bnz = _n.z / hl; } else { bnx = -dx; bnz = -dz; }
          if (bnx * dx + bnz * dz > 0) { bnx = -dx; bnz = -dz; }
        }
      }
      if (bestD <= 1e-4) break;
      pos.x += bnx * (bestD + 1e-3); pos.z += bnz * (bestD + 1e-3);
      ax += bnx; az += bnz; _walls.hit = true;
    }
    if (_walls.hit) {
      const l = Math.sqrt(ax * ax + az * az);
      if (l > 1e-6) { _walls.nx = ax / l; _walls.nz = az / l; }
    }
    return _walls;
  }
  function loopPoint(loop, theta, out) {
    if (!out) out = { pos: new V3(), up: new V3(), fwd: new V3() };
    if (!out.pos) out.pos = new V3();
    if (!out.up) out.up = new V3();
    if (!out.fwd) out.fwd = new V3();
    if (!loop || !loop.entry) { out.pos.set(0, 0, 0); out.up.set(0, 1, 0); out.fwd.set(0, 0, -1); return out; }
    const th = fin(theta) ? theta : 0;
    const R = loop.radius > 0 ? loop.radius : LOOP_R, sn = Math.sin(th), cs = Math.cos(th), k = (loop.shift || 0) / TAU;
    const d = loop.dir, sd = loop.side, e = loop.entry;
    out.pos.set(e.x + d.x * R * sn + sd.x * k * th, e.y + R * (1 - cs), e.z + d.z * R * sn + sd.z * k * th);
    out.up.set(-d.x * sn, cs, -d.z * sn);
    out.fwd.set(d.x * R * cs + sd.x * k, R * sn, d.z * R * cs + sd.z * k);
    const l = out.fwd.length();
    if (l > 1e-8) out.fwd.multiplyScalar(1 / l); else out.fwd.set(d.x, 0, d.z);
    return out;
  }
  const _ri = { s: 0, d: 0, dist: 0, dir: new V3(), right: new V3(), halfWidth: 11, floorY: 0 };
  function routeInfo(x, z) {
    if (!S.built || !fin(x) || !fin(z)) return null;
    nearest(x, z, _nr);
    _ri.s = _nr.s; _ri.d = _nr.d; _ri.dist = _nr.dist;
    _ri.dir.set(_nr.dx, 0, _nr.dz); _ri.right.set(-_nr.dz, 0, _nr.dx);
    _ri.halfWidth = keyInterp(HALFW, _nr.zr, _nr.d >= 0 ? 2 : 1);
    _ri.floorY = floorAt(_nr.zr);
    return _ri;
  }

  // ======================= builders =======================
  // Sun + shadows, per preset (K.gfx.shadows): 'csm' = cascaded shadow maps (CSMShadowNode, 2048 per cascade, faded
  // between cascades; Ultra 3 cascades out to 200 m, Élevé 2 out to 150 m); 'single' (Moyen) = one map that follows
  // Kit; 'cheap' (Économie) = a small 1024 map close around Kit. The suns share the same direction and colour; only the
  // active one is visible (a light set change rebuilds the materials once, then every variant is cached). The terrain
  // casts through a coarse proxy that only the shadow cameras see (SHADOW_LAYER): one draw per 192 m zone instead of
  // every visible chunk.
  const SHADOW_LAYER = 5;
  const SUN_I = 1.38 * LIGHT_PI;
  const CSM_CFG = { ultra: { cascades: 3, maxFar: 200 }, high: { cascades: 2, maxFar: 150 } };
  function makeSun(scene) {
    const sun = new THREE.DirectionalLight(lin(SUN_HEX), SUN_I);
    sun.castShadow = true;
    sun.shadow.camera.layers.enable(SHADOW_LAYER);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    scene.add(sun); scene.add(sun.target);
    return sun;
  }
  function buildLights(scene) {
    const hemi = new THREE.HemisphereLight(lin('#cfe9ff'), lin('#4f8f3c'), HEMI_BASE);
    scene.add(hemi);
    // single map (Moyen / Économie): its box follows the focus (placeShadow)
    const sun = makeSun(scene);
    sun.shadow.mapSize.set(S.shadowSize, S.shadowSize);
    const c = sun.shadow.camera;
    c.left = -S.shadowExt; c.right = S.shadowExt; c.top = S.shadowExt; c.bottom = -S.shadowExt; c.near = 1; c.far = 360;
    c.updateProjectionMatrix();
    S.sunS = sun;
    // cascades (Ultra / Élevé): the node places one shadow camera per cascade around the view frustum (created on
    // first use; the lights exist from the start so the act switch hides them with the rest of the island)
    S.csmSets = {};
    for (const k in CSM_CFG) {
      const sc = makeSun(scene);
      sc.visible = false;
      sc.shadow.mapSize.set(2048, 2048);
      sc.shadow.camera.near = 1; sc.shadow.camera.far = 700;
      sc.shadow.bias = -0.0004;
      sc.shadow.normalBias = 0.05;
      sc.position.copy(SUN_DIR).multiplyScalar(200); sc.target.position.set(0, 0, 0);
      sc.updateMatrixWorld(); sc.target.updateMatrixWorld();
      S.csmSets[k] = { light: sc, node: null, cam: { aspect: 0, fov: 0, far: 0, near: 0 } };
    }
    S.sun = sun; S.hemi = hemi;
    applyShadows();
    placeShadow();
  }
  // (re)configures the shadows for the current preset (also from K.gfx.onChange)
  function applyShadows() {
    if (!S.sunS) return;
    const mode = (K.gfx && K.gfx.shadows) || (S.touch ? 'single' : 'csm');
    const pre = K.gfx && K.gfx.preset === 'ultra' ? 'ultra' : 'high';
    let set = mode === 'csm' && !S.noCSM ? S.csmSets[pre] : null;
    if (set && !set.node) {
      try {
        const cfg = CSM_CFG[pre];
        const node = new worldCSM(set.light, { cascades: cfg.cascades, maxFar: cfg.maxFar, mode: 'practical', lightMargin: 80 });
        node.fade = true;
        // bind it to the game camera now (left alone, it binds to whichever camera first builds a material: the
        // environment capture's cube camera)
        const V = K.view;
        if (V && V.camera && V.renderer) node._init({ camera: V.camera, renderer: V.renderer });
        set.light.shadow.shadowNode = node;
        set.node = node;
      } catch (e) { console.warn('Kit Rush 3D: cascaded shadows unavailable', e); S.noCSM = true; set = null; }
    }
    S.shadowMode = set ? 'csm' : mode === 'cheap' ? 'cheap' : 'single';
    S.csm = set;
    // (while Act 2 is shown the island's objects are hidden: record what setVisible(true) must restore)
    const setVis = (o, v) => { if (S.shown) o.visible = v; else o.userData.kitWasVisible = v; };
    for (const k in S.csmSets) setVis(S.csmSets[k].light, S.csmSets[k] === set);
    setVis(S.sunS, !set);
    S.sun = set ? set.light : S.sunS;
    W.sun = S.sun;
    if (set) set.cam.aspect = 0; // re-fit the cascades
    else {
      const cheap = S.shadowMode === 'cheap';
      const size = cheap ? 1024 : S.shadowSize, ext = cheap ? 30 : S.shadowExt;
      const sh = S.sunS.shadow;
      if (sh.mapSize.x !== size) {
        sh.mapSize.set(size, size);
        if (sh.map) { sh.map.dispose(); sh.map = null; }
      }
      S.curExt = ext;
      const cam = sh.camera;
      cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext; cam.updateProjectionMatrix();
      placeShadow();
    }
  }
  // the cascades follow the camera's projection (aspect / fov / far change on resize, phones, cinematics)
  function updateCSM() {
    const set = S.csm, cam = K.view && K.view.camera;
    if (!set || !set.node || !cam) return;
    const k = set.cam;
    if (k.aspect !== cam.aspect || k.fov !== cam.fov || k.far !== cam.far || k.near !== cam.near) {
      k.aspect = cam.aspect; k.fov = cam.fov; k.far = cam.far; k.near = cam.near;
      try { set.node.updateFrustums(); } catch (e) { /* not initialised yet */ }
    }
  }
  const _sr = new V3(), _su = new V3(), _sp = new V3();
  function placeShadow() {
    const sun = S.sunS;
    if (!sun) return;
    const f = S.focus, ext = S.curExt || S.shadowExt, size = sun.shadow.mapSize.x || S.shadowSize;
    _sr.crossVectors(UP, SUN_DIR).normalize();
    _su.crossVectors(SUN_DIR, _sr);
    const texel = (2 * ext) / size;
    const u = Math.round(f.dot(_sr) / texel) * texel, v = Math.round(f.dot(_su) / texel) * texel, w = f.dot(SUN_DIR);
    _sp.copy(_sr).multiplyScalar(u).addScaledVector(_su, v).addScaledVector(SUN_DIR, w);
    sun.target.position.copy(_sp);
    sun.position.copy(_sp).addScaledVector(SUN_DIR, 170);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }
  function glowTexture(size, stops) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const s of stops) gr.addColorStop(s[0], s[1]);
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  // the sky, in linear colours: the dome draws it, the water reflects it. uHDR (K.post) deepens it for the
  // tone-mapped HDR pipeline; with 0 it matches the original display-space sky exactly.
  const SKY_UNI = {
    uSkyZen: uniform(lin('#1f4fd0')), uSkyMid: uniform(lin('#4a8cee')), uSkyHor: uniform(lin(FOG_HEX)),
    uSkyZenH: uniform(lin('#1844c6')), uSkyMidH: uniform(lin('#3a82ec')), uSkyHorH: uniform(lin('#98cdff')),
    uSkySun: uniform(SUN_DIR.clone()), uSkySunCol: uniform(lin('#fff4d6')), uTime: TIME,
    uHDR: K.post && K.post.uHDR && K.post.uHDR.isNode ? K.post.uHDR : uniform(0)
  };
  const FAR_HDR = new THREE.Color(lin('#98cdff').r / lin(FOG_HEX).r, lin('#98cdff').g / lin(FOG_HEX).g, 1);
  // sky gradient toward direction d (unit vec3 node), hdr: 0 (display-space sky) .. 1 (deeper HDR sky)
  const skyGradient = (d, hdr) => {
    const U = SKY_UNI, h = d.y;
    const hor = mix(U.uSkyHor, U.uSkyHorH, hdr), mid = mix(U.uSkyMid, U.uSkyMidH, hdr), zen = mix(U.uSkyZen, U.uSkyZenH, hdr);
    const col = mix(mix(hor, mid, smoothstep(0.0, 0.3, h)), zen, smoothstep(0.25, 0.95, h));
    // warm forward scattering low around the sun (HDR only)
    const sd = tmax(tdot(d, U.uSkySun), 0);
    return col.add(vec3(1.0, 0.78, 0.5).mul(hdr).mul(tpow(sd, 5)).mul(0.16).mul(float(1).sub(smoothstep(0.0, 0.6, h))));
  };
  // Cumulus layer of the sky (dome + water reflections): a cloud deck seen through direction d, three octaves of a tiling
  // cloud-noise texture, lit from the sun side (density toward the sun darkens), silver linings, dark bases, fading
  // into the horizon haze. -> { col, cover }
  function skyClouds(d, hdr) {
    const U = SKY_UNI, tSky = wtex('sky_noise'), h = d.y;
    const sd = tmax(tdot(d, U.uSkySun), 0);
    const up = tmax(h, 0);
    const wind = vec2(TIME.mul(0.0021), TIME.mul(0.0009));
    const pc = d.xz.div(up.add(0.085)).mul(0.11).add(wind);
    const cloudAt = q => {
      const a = ttexture(tSky, q.mul(0.42)).r;
      const b = ttexture(tSky, q.mul(1.13).add(vec2(a.mul(0.22), 0.37))).g;
      const c = ttexture(tSky, q.mul(3.1).add(vec2(0.61, b.mul(0.15)))).b;
      return a.mul(0.6).add(b.mul(0.32)).add(c.mul(0.14));
    };
    const dens = cloudAt(pc);
    const cover = smoothstep(0.5, 0.74, dens);
    const sunXZ = vec2(U.uSkySun.x, U.uSkySun.z);
    const dTow = cloudAt(pc.add(sunXZ.mul(0.035)));
    const lit = tclamp(dens.sub(dTow).mul(5).add(0.62), 0, 1);
    const thick = smoothstep(0.55, 0.95, dens);
    const cLit = vec3(1.0, 0.975, 0.93).mul(float(1).add(hdr.mul(0.55)));
    const cShade = vec3(0.56, 0.63, 0.76).mul(float(1).add(hdr.mul(0.25)));
    let col = mix(cShade, cLit, lit.mul(float(1).sub(thick.mul(0.45))).add(0.12));
    col = col.add(U.uSkySunCol.mul(tpow(sd, 7).mul(float(1).sub(thick)).mul(cover).mul(hdr.mul(1.4).add(0.6))));
    const haze = float(1).sub(smoothstep(0.0, 0.3, h));
    col = mix(col, mix(U.uSkyHor, U.uSkyHorH, hdr).mul(1.05), haze.mul(0.55));
    return { col, cover };
  }
  function buildSky(scene) {
    const fog = new THREE.Fog(new THREE.Color(FOG_HEX), 120, 640);
    scene.fog = fog; S.fog = fog;
    scene.background = S.bg = new THREE.Color(FOG_HEX);
    // Sky dome (TSL): the gradient + a layer of cumulus seen through the dome (a cloud deck projected from the camera,
    // three octaves of a tiling cloud-noise texture, lit from the sun side, silver linings and dark bases, fading into
    // the horizon haze) + the sun disc and aureole. The environment map (K.post.refreshEnvironment) captures it, so the
    // PBR materials get the cloudy sky light and reflections.
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
    {
      const U = SKY_UNI, hdr = U.uHDR;
      const d = tnormalize(positionGeometry);
      const h = d.y;
      let col = skyGradient(d, hdr);
      const sd = tmax(tdot(d, U.uSkySun), 0);
      const cl = skyClouds(d, hdr);
      const cover = cl.cover;
      col = mix(col, cl.col, cover.mul(smoothstep(0.012, 0.1, h)).mul(0.96));
      col = col.add(U.uSkySunCol.mul(tpow(sd, 1200).mul(1.4).add(tpow(sd, 60).mul(0.32)).add(tpow(sd, 7).mul(0.12))).mul(float(1).sub(cover.mul(0.7))));
      col = col.add(U.uSkySunCol.mul(hdr).mul(smoothstep(0.99962, 0.99985, sd).mul(24).add(tpow(sd, 600).mul(1.5)).add(tpow(sd, 60).mul(0.1))).mul(float(1).sub(cover.mul(0.85))));
      mat.colorNode = mix(tmin(col, vec3(1)), col, hdr);
      // the dome is centred on the camera and drawn at the far plane (it never clips, even with a short phone far)
      const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(positionLocal.add(cameraPosition), 1));
      mat.vertexNode = vec4(clip.xy, clip.w.mul(0.99999), clip.w);
    }
    const dome = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), mat);
    dome.renderOrder = -100; dome.frustumCulled = false; dome.name = 'w-sky';
    dome.onBeforeRender = (r, sc, cam) => skyFollow(cam);
    scene.add(dome); S.sky = dome;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(256, [[0, 'rgba(255,252,235,1)'], [0.08, 'rgba(255,246,210,0.95)'], [0.22, 'rgba(255,230,170,0.35)'], [0.5, 'rgba(255,220,160,0.08)'], [1, 'rgba(255,220,160,0)']]),
      color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false
    }));
    glow.scale.set(300, 300, 1); glow.frustumCulled = false; glow.renderOrder = -90;
    scene.add(glow); S.sunSprite = glow;
  }
  const FOG_LDR = lin(FOG_HEX), FOG_HDR = lin('#98cdff');
  function skyFollow(cam) {
    if (!cam) return;
    // the HDR pipeline fogs toward its own (linear) horizon
    if (S.fog) S.fog.color.copy(SKY_UNI.uHDR.value ? FOG_HDR : FOG_LDR);
    CAMXZ.value.set(cam.position.x, cam.position.z);
    // the blade grids follow the camera that actually draws (also when a cinematic or a probe moves it between ticks)
    if (K.view && cam === K.view.camera) updateGrass();
    if (S.sunSprite) {
      S.sunSprite.position.copy(cam.position).addScaledVector(SUN_DIR, 700); S.sunSprite.updateMatrixWorld();
      S.sunSprite.material.opacity = SKY_UNI.uHDR.value ? 0.22 : 1;
    }
    // far islands fade into the horizon of whichever sky is drawn
    if (S.farMat) S.farMat.color.copy(SKY_UNI.uHDR.value ? FAR_HDR : WHITE);
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const stale = !S.lastWall || now - S.lastWall > 150;
    if (stale && S._lastRender) animate(clamp((now - S._lastRender) / 1000, 0, 0.1));
    S._lastRender = now;
  }
  function buildSea(scene) {
    const NX = T.NX, NZ = T.NZ, H = T.H;
    const data = new Uint8Array(NX * NZ * 4);
    const cl = new Float32Array(NX * NZ), tmp = new Float32Array(NX * NZ);
    for (let i = 0; i < NX * NZ; i++) cl[i] = clamp(H[i], -6, 6);
    // separable box blur (running sums, clamped edges) of the clamped heights -> shore distance proxy
    const R = Math.max(1, Math.round(6 / CELL)), inv = 1 / (2 * R + 1);
    for (let iz = 0; iz < NZ; iz++) {
      const o = iz * NX;
      let s = 0;
      for (let k = -R; k <= R; k++) s += cl[o + clamp(k, 0, NX - 1)];
      for (let ix = 0; ix < NX; ix++) {
        tmp[o + ix] = s * inv;
        s += cl[o + Math.min(ix + R + 1, NX - 1)] - cl[o + Math.max(ix - R, 0)];
      }
    }
    for (let ix = 0; ix < NX; ix++) {
      let s = 0;
      for (let k = -R; k <= R; k++) s += tmp[clamp(k, 0, NZ - 1) * NX + ix];
      for (let iz = 0; iz < NZ; iz++) {
        const i = iz * NX + ix;
        data[i * 4] = Math.round(clamp((cl[i] + 6) / 12, 0, 1) * 255);
        data[i * 4 + 1] = Math.round(clamp((s * inv + 6) / 12, 0, 1) * 255);
        data[i * 4 + 2] = 0; data[i * 4 + 3] = 255;
        s += tmp[Math.min(iz + R + 1, NZ - 1) * NX + ix] - tmp[Math.max(iz - R, 0) * NX + ix];
      }
    }
    const tex = new THREE.DataTexture(data, NX, NZ, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
    // Sea, lake and channels (one plane at y = 0, TSL). Waves: four long analytic swells + two scrolling detail normal
    // maps. Seen through the surface: the sandy bottom (refracted by the waves, sun caustics dancing on it) absorbed by
    // depth (red first, then green: turquoise shallows, deep blue sea), depth from the island's heightfield. Reflected:
    // the same sky and clouds as the dome (Fresnel), plus the island itself via SSR on Ultra / Élevé (opt-in below).
    // Sun glints, sparkles, shoreline foam (bubbly foam texture in bands rolling in).
    const U = {
      uSun: uniform(SUN_DIR.clone()), uSunCol: uniform(lin('#fff2d0')),
      uDeep: uniform(lin('#0e3f9c')), uMid: uniform(lin('#1f78d0')), uFoam: uniform(lin('#f6fcff')),
      uHB: uniform(new THREE.Vector4(T.XMIN - CELL / 2, T.ZMIN - CELL / 2, 1 / (CELL * NX), 1 / (CELL * NZ)))
    };
    const mat = new THREE.MeshBasicNodeMaterial({ fog: true });
    {
      const t = TIME, hdr = SKY_UNI.uHDR;
      const tWN = wtex('water_n'), tFX = wtex('water_fx'), tSand = wtex('sand_albedo');
      const wp = positionWorld;
      const wg = modelWorldMatrix.mul(vec4(positionGeometry, 1));
      mat.positionNode = positionLocal.add(vec3(0, tsin(wg.x.mul(0.08).add(t.mul(1.1))).mul(0.1).add(tsin(wg.z.mul(0.11).sub(t.mul(0.9))).mul(0.08)), 0));
      const p = wp.xz;
      const dist = tlength(cameraPosition.sub(wp));
      const near = float(1).sub(smoothstep(25.0, 140.0, dist));
      const d1 = vec2(0.8, 0.6), d2 = vec2(-0.5, 0.866), d3 = vec2(0.196, -0.98), d4 = vec2(-0.949, -0.316);
      let g = d1.mul(tcos(tdot(d1, p).mul(0.21).add(t.mul(1.3))).mul(0.021))
        .add(d2.mul(tcos(tdot(d2, p).mul(0.37).add(t.mul(1.7))).mul(0.022)))
        .add(d3.mul(tcos(tdot(d3, p).mul(0.73).add(t.mul(2.3))).mul(0.022)))
        .add(d4.mul(tcos(tdot(d4, p).mul(1.31).add(t.mul(3.1))).mul(0.02)));
      const n1 = ttexture(tWN, p.mul(0.085).add(vec2(t.mul(0.017), t.mul(0.011)))).xy.mul(2).sub(1);
      const n2 = ttexture(tWN, rot2(p, 0.9).mul(0.19).add(vec2(t.mul(-0.012), t.mul(0.021)))).xy.mul(2).sub(1);
      const tn = n1.add(rot2(n2, -0.9).mul(0.7)).mul(float(0.22).add(near.mul(0.18)));
      const N = tnormalize(vec3(g.x.negate().add(tn.x), 1.0, g.y.negate().add(tn.y)));
      const Vd = tnormalize(cameraPosition.sub(wp));
      const huv = p.sub(U.uHB.xy).mul(U.uHB.zw);
      const inside = tstep(0.0, huv.x).mul(tstep(huv.x, 1.0)).mul(tstep(0.0, huv.y)).mul(tstep(huv.y, 1.0));
      const ht = ttexture(tex, tclamp(huv, 0.0, 1.0));
      const hg = mix(float(-6), ht.r.mul(12).sub(6), inside);
      const hb = mix(float(-6), ht.g.mul(12).sub(6), inside);
      const depth = tmax(hg.negate(), 0);
      // the bottom: sand, refracted by the waves, lit by the sun with caustics, absorbed by the water above it
      const pb = p.add(N.xz.mul(depth.mul(0.35).add(0.1)));
      const sandB = GM_UNI.gmSand.mul(ttexture(tSand, pb.div(1.6)).rgb.mul(meanInv('sand'))).mul(0.62);
      const ca = ttexture(tFX, pb.mul(0.16).add(vec2(t.mul(0.021), t.mul(0.013)))).g;
      const cb = ttexture(tFX, rot2(pb, 1.7).mul(0.21).add(vec2(t.mul(-0.016), t.mul(0.019)))).g;
      const caus = tmin(ca, cb).mul(2.2).add(ca.mul(cb).mul(1.2));
      const bottom = sandB.mul(float(0.85).add(caus.mul(float(1).sub(smoothstep(0.5, 4.5, depth))).mul(hdr.mul(0.8).add(1.1))));
      const tr = texp(vec3(0.55, 0.2, 0.14).mul(depth).negate()).mul(smoothstep(5.8, 3.2, depth));
      const body = mix(U.uMid, U.uDeep, smoothstep(1.8, 5.5, depth).mul(0.85).add(smoothstep(5.0, 6.0, hb.negate()).mul(0.15)));
      let col = bottom.mul(tr).add(body.mul(vec3(1).sub(tr)));
      // the sky and its clouds, reflected with Fresnel
      const Rr = treflect(Vd.negate(), N);
      const R = tnormalize(vec3(Rr.x, tabs(Rr.y), Rr.z));
      const cl = skyClouds(R, hdr);
      const refl = mix(skyGradient(R, hdr), cl.col, cl.cover.mul(smoothstep(0.012, 0.1, R.y)).mul(0.9));
      const fr = tpow(float(1).sub(tmax(tdot(N, Vd), 0)), 5);
      col = mix(col, refl, tclamp(fr.mul(0.86).add(0.05), 0, 1));
      const Hh = tnormalize(U.uSun.add(Vd));
      const nh = tmax(tdot(N, Hh), 0);
      col = col.add(U.uSunCol.mul(tpow(nh, 420).mul(3).add(tpow(nh, 60).mul(0.16))));
      col = col.add(U.uSunCol.mul(hdr).mul(tpow(nh, 1800)).mul(40));
      const sp = ttexture(tFX, p.mul(0.33).add(vec2(t.mul(0.05), t.mul(-0.04)))).b.mul(ttexture(tFX, p.mul(0.41).sub(vec2(t.mul(0.03), t.mul(0.06)))).b);
      const gfade = float(1).sub(smoothstep(50.0, 190.0, dist));
      col = col.add(U.uSunCol.mul(smoothstep(0.44, 0.62, sp)).mul(tpow(nh, 24)).mul(hdr.mul(2.5).add(1.6)).mul(gfade));
      // foam: bands rolling onto the shore + a fringe where the water is a few centimetres deep, bubbly texture
      const fnz = ttexture(tFX, p.mul(0.045).add(vec2(t.mul(0.011), t.mul(-0.008)))).b;
      const bub = ttexture(tFX, p.mul(0.31).add(vec2(t.mul(0.02), t.mul(0.012)))).r;
      const shore = smoothstep(-5.4, -1.0, hb);
      const bandW = tsin(hb.mul(2.4).sub(t.mul(1.8)).add(fnz.mul(7))).mul(0.5).add(0.5);
      const foamA = shore.mul(smoothstep(0.55, 0.92, bandW.mul(0.72).add(fnz.mul(0.4)))).mul(bub.mul(1.3).add(0.25));
      const foamB = smoothstep(-1.5, -0.12, hg).mul(bub.mul(0.9).add(fnz.mul(0.5)).add(0.15));
      const foam = tclamp(foamA.add(foamB), 0, 1);
      col = mix(col, U.uFoam.mul(tmax(U.uSun.y, 0).mul(0.25).add(0.9)), foam.mul(0.92));
      mat.colorNode = col;
      // screen-space reflections of the island (Ultra / Élevé), weaker where foam covers the water
      if (K.post && typeof K.post.ssr === 'function') K.post.ssr(mat, float(0.55).mul(float(1).sub(foam)), 0.08);
    }
    const geo = new THREE.PlaneGeometry(2600, 2600, 96, 96);
    geo.rotateX(-Math.PI / 2);
    const sea = new THREE.Mesh(geo, mat);
    sea.name = 'w-sea';
    sea.position.set((T.XMIN + (T.XMIN + (T.NX - 1) * CELL)) / 2, SEA, (T.ZMIN + (T.ZMIN + (T.NZ - 1) * CELL)) / 2);
    sea.frustumCulled = false;
    sea.renderOrder = -10;
    scene.add(sea);
    S.sea = sea; S.seaMat = mat;
  }
  // Terrain chunk index buffer at stride s (1, 2 or 4). Coarse cells are fans around their centre vertex; an edge on
  // the chunk border, or next to a partial cell, keeps every vertex, so chunks at different strides never crack.
  function terrainIndex(cx, cz, ix1, iz1, w, s) {
    const NX = T.NX, H = T.H, out = [];
    const v = (ix, iz) => (iz - cz) * w + (ix - cx);
    const deep = (x0, z0, x1, z1) => {
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) if (H[iz * NX + ix] >= -0.9) return false;
      return true;
    };
    const fine = (x0, z0, x1, z1) => {
      for (let iz = z0; iz < z1; iz++) for (let ix = x0; ix < x1; ix++) {
        const i = iz * NX + ix, ha = H[i], hb = H[i + 1], hc = H[i + NX], hd = H[i + NX + 1];
        if (ha < -0.9 && hb < -0.9 && hc < -0.9 && hd < -0.9) continue;
        const a = v(ix, iz), b = a + 1, c = a + w, d = c + 1;
        if (Math.abs(ha - hd) < Math.abs(hb - hc)) out.push(a, c, d, a, d, b); else out.push(a, c, b, b, c, d);
      }
    };
    if (s <= 1) { fine(cx, cz, ix1, iz1); return out; }
    const full = (x0, z0) => x0 >= cx && z0 >= cz && x0 + s <= ix1 && z0 + s <= iz1;
    const per = [];
    for (let iz = cz; iz < iz1; iz += s) for (let ix = cx; ix < ix1; ix += s) {
      const jx = Math.min(ix + s, ix1), jz = Math.min(iz + s, iz1);
      if (deep(ix, iz, jx, jz)) continue;
      if (!full(ix, iz)) { fine(ix, iz, jx, jz); continue; }
      // which edges keep every vertex: on the chunk border, or shared with a partial neighbour
      const eL = ix === cx || !full(ix - s, iz), eR = jx === ix1 || !full(jx, iz);
      const eT = iz === cz || !full(ix, iz - s), eB = jz === iz1 || !full(ix, jz);
      if (!eL && !eR && !eT && !eB) {
        const i = iz * NX + ix, ha = H[i], hb = H[i + s], hc = H[i + s * NX], hd = H[i + s * NX + s];
        const a = v(ix, iz), b = v(jx, iz), c = v(ix, jz), d = v(jx, jz);
        if (Math.abs(ha - hd) < Math.abs(hb - hc)) out.push(a, c, d, a, d, b); else out.push(a, c, b, b, c, d);
        continue;
      }
      // perimeter, counter-clockwise seen from above: down the left side, along the far side, up the right, back
      per.length = 0;
      const st = k => (k ? 1 : s);
      for (let z = iz; z < jz; z += st(eL)) per.push(v(ix, z));
      for (let x = ix; x < jx; x += st(eB)) per.push(v(x, jz));
      for (let z = jz; z > iz; z -= st(eR)) per.push(v(jx, z));
      for (let x = jx; x > ix; x -= st(eT)) per.push(v(x, iz));
      const ctr = v(ix + s / 2, iz + s / 2);
      for (let k = 0; k < per.length; k++) out.push(ctr, per[k], per[(k + 1) % per.length]);
    }
    return out;
  }
  function buildTerrainMeshes(scene) {
    const mat = groundMaterial('terrain');
    const NX = T.NX, NZ = T.NZ, H = T.H, CH = 96;
    const grp = new THREE.Group(); grp.name = 'terrain';
    S.terrChunks = [];
    for (let cz = 0; cz < NZ - 1; cz += CH) for (let cx = 0; cx < NX - 1; cx += CH) {
      const ix1 = Math.min(cx + CH, NX - 1), iz1 = Math.min(cz + CH, NZ - 1);
      const w = ix1 - cx + 1, hh = iz1 - cz + 1;
      const lods = [1, 2, 4].map(st => terrainIndex(cx, cz, ix1, iz1, w, st));
      if (!lods[0].length) continue;
      const pos = new Float32Array(w * hh * 3), nor = new Float32Array(w * hh * 3), rte = new Float32Array(w * hh * 3), ao = new Float32Array(w * hh);
      const mt = new Float32Array(w * hh * 4);
      const RS = T.RS, RD = T.RD, RM = T.RM, AO = T.AO, X0 = T.XMIN, Z0 = T.ZMIN;
      for (let iz = cz; iz <= iz1; iz++) {
        const za = iz > 0 ? iz - 1 : 0, zb = iz < NZ - 1 ? iz + 1 : NZ - 1, dz = (zb - za) * CELL;
        for (let ix = cx; ix <= ix1; ix++) {
          const v = (iz - cz) * w + (ix - cx), v3 = v * 3, i = iz * NX + ix;
          const xa = ix > 0 ? ix - 1 : 0, xb = ix < NX - 1 ? ix + 1 : NX - 1;
          const gx = (H[iz * NX + xb] - H[iz * NX + xa]) / ((xb - xa) * CELL), gz = (H[zb * NX + ix] - H[za * NX + ix]) / dz;
          const il = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
          pos[v3] = X0 + ix * CELL; pos[v3 + 1] = H[i]; pos[v3 + 2] = Z0 + iz * CELL;
          nor[v3] = -gx * il; nor[v3 + 1] = il; nor[v3 + 2] = -gz * il;
          rte[v3] = RS[i]; rte[v3 + 1] = RD[i]; rte[v3 + 2] = RM[i];
          ao[v] = AO[i];
          for (let c = 0; c < 4; c++) mt[v * 4 + c] = T.MT[i * 4 + c];
        }
      }
      const attrs = { position: new THREE.BufferAttribute(pos, 3), normal: new THREE.BufferAttribute(nor, 3), aRoute: new THREE.BufferAttribute(rte, 3), aAO: new THREE.BufferAttribute(ao, 1), aMat: new THREE.BufferAttribute(mt, 4) };
      const ch = { meshes: [], lod: 0, x0: X0 + cx * CELL, x1: X0 + ix1 * CELL, z0: Z0 + cz * CELL, z1: Z0 + iz1 * CELL };
      let sphere = null;
      for (let k = 0; k < 3; k++) {
        if (!lods[k].length) { ch.meshes.push(ch.meshes[k - 1]); continue; }
        const g = new THREE.BufferGeometry();
        for (const n in attrs) g.setAttribute(n, attrs[n]);
        g.setIndex(new THREE.BufferAttribute(Uint16Array.from(lods[k]), 1));
        if (!sphere) { g.computeBoundingSphere(); sphere = g.boundingSphere; } else g.boundingSphere = sphere.clone();
        const m = new THREE.Mesh(g, mat);
        m.name = 'w-terrain';
        // the terrain receives the sun shadow; it casts it through the coarse proxy (buildShadowProxy)
        m.receiveShadow = true; m.castShadow = false;
        m.matrixAutoUpdate = false;
        m.visible = k === 0;
        grp.add(m);
        ch.meshes.push(m);
      }
      S.terrChunks.push(ch);
    }
    scene.add(grp);
    return grp;
  }
  // distant chunks swap to coarser index buffers (a 1 u cell is under a pixel there, and deep in the fog)
  function updateTerrainLod() {
    const cam = K.view && K.view.camera;
    if (!cam || !S.terrChunks) return;
    const cxp = cam.position.x, czp = cam.position.z;
    const pre = (K.gfx && K.gfx.preset) || (S.touch ? 'medium' : 'high');
    const t1 = pre === 'ultra' ? 160 : pre === 'high' ? 125 : 95, t2 = pre === 'ultra' ? 320 : pre === 'high' ? 260 : 200;
    for (const ch of S.terrChunks) {
      const dx = cxp < ch.x0 ? ch.x0 - cxp : cxp > ch.x1 ? cxp - ch.x1 : 0, dz = czp < ch.z0 ? ch.z0 - czp : czp > ch.z1 ? czp - ch.z1 : 0;
      const d = Math.sqrt(dx * dx + dz * dz), h = ch.lod === 0 ? 6 : -6, h2 = ch.lod === 2 ? -6 : 6;
      const lod = d > t2 + h2 ? 2 : d > t1 + h ? 1 : 0;
      if (lod === ch.lod) continue;
      ch.meshes[ch.lod].visible = false;
      ch.lod = lod;
      ch.meshes[lod].visible = true;
    }
  }

  // Terrain shadow caster: the heightfield at a 2 m step, in 192 m zones, on a layer only the shadow cameras render. Shadow
  // maps take back faces (three's default shadowSide), so only the silhouette of the slopes facing away from the sun
  // matters: at 2 m it stays within a metre of the real ridge line.
  function buildShadowProxy(scene) {
    const NX = T.NX, NZ = T.NZ, H = T.H, st = 2, ZZ = 192;
    const mat = new THREE.MeshBasicNodeMaterial({ colorWrite: false, depthWrite: false });
    mat.shadowSide = THREE.BackSide;
    const xs = [];
    for (let ix = 0; ix < NX - 1; ix += st) xs.push(ix);
    xs.push(NX - 1);
    const grp = new THREE.Group(); grp.name = 'w-shadowproxy';
    for (let z0 = 0; z0 < NZ - 1; z0 += ZZ) {
      const z1 = Math.min(z0 + ZZ, NZ - 1), zs = [];
      for (let iz = z0; iz < z1; iz += st) zs.push(iz);
      zs.push(z1);
      const w = xs.length, pos = new Float32Array(w * zs.length * 3), idx = [];
      for (let j = 0; j < zs.length; j++) for (let i = 0; i < w; i++) {
        const v = (j * w + i) * 3, ix = xs[i], iz = zs[j];
        pos[v] = T.XMIN + ix * CELL; pos[v + 1] = H[iz * NX + ix]; pos[v + 2] = T.ZMIN + iz * CELL;
      }
      for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < w - 1; i++) {
        const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
        if (pos[a * 3 + 1] < -0.9 && pos[b * 3 + 1] < -0.9 && pos[c * 3 + 1] < -0.9 && pos[d * 3 + 1] < -0.9) continue;
        idx.push(a, c, d, a, d, b);
      }
      if (!idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.layers.set(SHADOW_LAYER);
      m.castShadow = true; m.receiveShadow = false;
      m.matrixAutoUpdate = false;
      m.name = 'w-shadowproxy';
      grp.add(m);
    }
    scene.add(grp);
  }

  // ----- prop boxes (pillars, platforms) with a grass skirt
  const WHITE = new THREE.Color(1, 1, 1);
  function addSkirt(gb, x0, z0, x1, z1, top, depth) {
    const o = 0.045;
    const sides = [[x0 - o, z1 + o, x1 + o, z1 + o, 0, 1], [x1 + o, z1 + o, x1 + o, z0 - o, 1, 0], [x1 + o, z0 - o, x0 - o, z0 - o, 0, -1], [x0 - o, z0 - o, x0 - o, z1 + o, -1, 0]];
    for (const sd of sides) {
      const L = Math.hypot(sd[2] - sd[0], sd[3] - sd[1]);
      const n = Math.max(2, Math.round(L / 0.55));
      const P = [], N = [], I = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n, x = lerp(sd[0], sd[2], t), z = lerp(sd[1], sd[3], t);
        const dep = depth * (k % 2 ? 1 : 0.5) * (0.85 + 0.3 * ihash(k, Math.round(x * 7 + z * 13), 5));
        P.push(x, top + 0.02, z, x, top - dep, z);
        N.push(sd[4], 0, sd[5], sd[4], 0, sd[5]);
        if (k < n) { const a = k * 2; I.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
      }
      gb.raw(P, N, WHITE, 1, I);
    }
  }
  function addBox(gb, x0, y0, z0, x1, y1, z1, skirt) {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    gb.add(g, WHITE, M4().makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), 0);
    if (skirt) addSkirt(gb, x0, z0, x1, z1, y1, 0.48);
  }
  function addSolid(min, max, kind, mesh) {
    const s = { min: min.clone(), max: max.clone(), delta: new V3(), kind, mesh: mesh || null };
    W.solids.push(s);
    return s;
  }
  function boxSolid(gb, cx, cz, sx, sz, y0, y1, kind, list) {
    const min = new V3(cx - sx / 2, y0, cz - sz / 2), max = new V3(cx + sx / 2, y1, cz + sz / 2);
    addBox(gb, min.x, min.y, min.z, max.x, max.y, max.z, true);
    const s = addSolid(min, max, kind, null);
    if (list) list.push(s);
    return s;
  }
  function rimGeometry(gb, cx, cz, ri, ro, y0, y1, gapAng, gapHalf) {
    const segs = 160, P = [], N = [], I = [];
    const ang = [];
    for (let k = 0; k <= segs; k++) {
      const a = gapAng + gapHalf + (TAU - 2 * gapHalf) * (k / segs);
      ang.push(a);
    }
    const ring = (r, y, nx, ny, nz) => { for (const a of ang) { const c = Math.cos(a), s = Math.sin(a); P.push(cx + c * r, y, cz + s * r); N.push(nx === null ? c * ny : nx, nx === null ? 0 : ny, nx === null ? s * ny : nz); } };
    // top
    let base = P.length / 3;
    ring(ri, y1, 0, 1, 0); ring(ro, y1, 0, 1, 0);
    for (let k = 0; k < segs; k++) { const a = base + k, b = base + segs + 1 + k; I.push(a, a + 1, b, b, a + 1, b + 1); }
    // outer wall
    base = P.length / 3;
    ring(ro, y1, null, 1, 0); ring(ro, y0, null, 1, 0);
    for (let k = 0; k < segs; k++) { const a = base + k, b = base + segs + 1 + k; I.push(a, a + 1, b, b, a + 1, b + 1); }
    // inner wall
    base = P.length / 3;
    ring(ri, y1, null, -1, 0); ring(ri, y0, null, -1, 0);
    for (let k = 0; k < segs; k++) { const a = base + k, b = base + segs + 1 + k; I.push(a, b, a + 1, a + 1, b, b + 1); }
    fixWinding(P, N, I);
    gb.raw(P, N, WHITE, 0, I);
    // end caps
    for (const a of [ang[0], ang[segs]]) {
      const c = Math.cos(a), s = Math.sin(a), tx = -s, tz = c;
      const sign = a === ang[0] ? -1 : 1;
      const P2 = [cx + c * ri, y0, cz + s * ri, cx + c * ro, y0, cz + s * ro, cx + c * ri, y1, cz + s * ri, cx + c * ro, y1, cz + s * ro];
      const N2 = [tx * sign, 0, tz * sign, tx * sign, 0, tz * sign, tx * sign, 0, tz * sign, tx * sign, 0, tz * sign];
      const I2 = [0, 1, 2, 2, 1, 3];
      fixWinding(P2, N2, I2);
      gb.raw(P2, N2, WHITE, 0, I2);
    }
  }
  // a low checker wall along a polyline [[x, z]...] that follows the ground (width w, h above it); its collision
  // reaches `over` higher than it looks (no jump or air dash carries Kit over it) and is never a floor
  function pathRim(gb, pts, w, h, over) {
    const S = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(L / 0.6));
      for (let k = i ? 1 : 0; k <= n; k++) S.push([lerp(ax, bx, k / n), lerp(az, bz, k / n)]);
    }
    if (S.length < 2) return;
    const hw = w / 2, P = [], N = [], I = [], top = [], bot = [], px = [], pz = [];
    for (let k = 0; k < S.length; k++) {
      const a = S[Math.max(0, k - 1)], b = S[Math.min(S.length - 1, k + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1];
      const l = Math.hypot(dx, dz);
      if (l > 1e-6) { dx /= l; dz /= l; } else { dx = 0; dz = -1; }
      px.push(-dz); pz.push(dx);
      let hi = -1e9, lo = 1e9;
      for (const o of [-hw, 0, hw]) { const t = terrainY(S[k][0] - dz * o, S[k][1] + dx * o); hi = Math.max(hi, t); lo = Math.min(lo, t); }
      top.push(hi + h); bot.push(lo - 1.6);
    }
    const strip = (fa, fb, nrm) => {
      const base = P.length / 3;
      for (let k = 0; k < S.length; k++) {
        for (const f of [fa, fb]) {
          const o = f.o * hw;
          P.push(S[k][0] + px[k] * o, f.top ? top[k] : bot[k], S[k][1] + pz[k] * o);
          const nn = nrm(k); N.push(nn[0], nn[1], nn[2]);
        }
        if (k) { const q = base + (k - 1) * 2; I.push(q, q + 1, q + 2, q + 2, q + 1, q + 3); }
      }
    };
    strip({ o: -1, top: true }, { o: 1, top: true }, () => [0, 1, 0]);
    strip({ o: 1, top: true }, { o: 1, top: false }, k => [px[k], 0, pz[k]]);
    strip({ o: -1, top: true }, { o: -1, top: false }, k => [-px[k], 0, -pz[k]]);
    for (const k of [0, S.length - 1]) {
      const j = k ? k - 1 : 1;
      let tx = S[k][0] - S[j][0], tz = S[k][1] - S[j][1];
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const base = P.length / 3;
      for (const [o, up] of [[-1, 1], [1, 1], [-1, 0], [1, 0]]) {
        P.push(S[k][0] + px[k] * o * hw, up ? top[k] : bot[k], S[k][1] + pz[k] * o * hw);
        N.push(tx, 0, tz);
      }
      I.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
    fixWinding(P, N, I);
    gb.raw(P, N, WHITE, 0, I);
    // collision: true segments (a diagonal row of boxes would catch a sliding Kit on every step)
    for (let k = 0; k < S.length - 1; k++) segWall(S[k][0], S[k][1], S[k + 1][0], S[k + 1][1], hw, Math.min(bot[k], bot[k + 1]), Math.max(top[k], top[k + 1]) + over);
  }
  // A loop's band is only walkable during the scripted traversal, so where it runs low (both ramps) one-sided walls
  // keep a walking Kit out of it: along both edges (beside the rails) and across it underneath, where the shell
  // comes down to head height. A Kit on the band's own lane takes the traversal instead (K.player). The exit ramp
  // comes down right beside the entry lane: its inner wall sits a little under the band, and a short slanted guide
  // in front of it steers a Kit who brushes it into the lane rather than stopping him.
  function loopWalls(loop) {
    const R0 = loop.radius, half = LOOP_W / 2, e = loop.entry, d = loop.dir, sd = loop.side;
    // the ramps count as low until the shell's outer face clears Kit's head (about 1.35 u up)
    const thL = Math.asin(Math.min(0.99, LOOP_LOW / R0)), edge = half + 0.3, n = 6;
    const pt = (a, b) => [e.x + d.x * a + sd.x * b, e.z + d.z * a + sd.z * b];
    const at = (th, lat) => pt(R0 * Math.sin(th), loop.shift * th / TAU + lat);
    const hAt = th => R0 * (1 - Math.cos(th));
    const y0 = e.y - 2;
    for (const exit of [false, true]) {
      const t0 = exit ? TAU - thL : 0, t1 = exit ? TAU : thL;
      for (const sg of [-1, 1]) {
        const off = exit && sg < 0 ? -edge + LOOP_NUDGE : sg * edge;
        for (let k = 0; k < n; k++) {
          const ta = lerp(t0, t1, k / n), tb = lerp(t0, t1, (k + 1) / n);
          const A = at(ta, off), B = at(tb, off);
          segWall(A[0], A[1], B[0], B[1], 0.1, y0, e.y + Math.max(hAt(ta), hAt(tb)) + 0.6, sd.x * sg, sd.z * sg);
        }
      }
      // across, under the arc: pushes away from the low end
      const tc = exit ? t0 : t1, out = exit ? -1 : 1, lo = exit ? -edge + LOOP_NUDGE : -edge;
      const A = at(tc, lo), B = at(tc, edge);
      segWall(A[0], A[1], B[0], B[1], 0.1, y0, e.y + 1.6, d.x * out, d.z * out);
      if (exit) {
        // the guide: from a point behind and outside the inner corner, slanting in to it
        const ac = R0 * Math.sin(tc), bc = loop.shift * tc / TAU + lo;
        const G = pt(ac - 1, bc + 0.9);
        let nx = -(d.x * 0.9 + sd.x), nz = -(d.z * 0.9 + sd.z);
        const nl = Math.hypot(nx, nz) || 1;
        segWall(G[0], G[1], A[0], A[1], 0.1, y0, e.y + 1.6, nx / nl, nz / nl);
      }
    }
  }
  // one thin wall segment; with (nx, nz) it is one-sided and only pushes toward that side
  function segWall(ax, az, bx, bz, ht, y0, y1, nx, nz) {
    const len = Math.hypot(bx - ax, bz - az);
    if (!(len > 1e-4)) return;
    const g = { ax, az, ux: (bx - ax) / len, uz: (bz - az) / len, len, ht, y0, y1, one: nx !== undefined, nx: nx || 0, nz: nz || 0 };
    SEGW.list.push(g);
    SEGW.x0 = Math.min(SEGW.x0, ax, bx); SEGW.x1 = Math.max(SEGW.x1, ax, bx);
    SEGW.z0 = Math.min(SEGW.z0, az, bz); SEGW.z1 = Math.max(SEGW.z1, az, bz);
  }
  // make every triangle's winding agree with its vertex normals
  function fixWinding(P, N, I) {
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const dn = nx * (N[a] + N[b] + N[c]) + ny * (N[a + 1] + N[b + 1] + N[c + 1]) + nz * (N[a + 2] + N[b + 2] + N[c + 2]);
      if (dn < 0) { const tmp = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = tmp; }
    }
  }

  // ----- loops
  // running surface: the lawn texture (mown stripes from the vertex colours), grass normal map; rails: polished steel
  let LOOPM = null, RAILM = null;
  function loopSurfMaterial() {
    if (LOOPM) return LOOPM;
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
    const uvn = tuv(), vc = attribute('color', 'vec3');
    const a = ttexture(wtex('grass_albedo'), uvn), n = ttexture(wtex('grass_normal'), uvn), o = ttexture(wtex('grass_orm'), uvn);
    m.colorNode = vc.mul(a.rgb.mul(meanInv('grass'))).mul(1.05);
    m.normalNode = TSL.normalMap(n.xyz);
    m.roughnessNode = o.g;
    m.aoNode = o.r;
    LOOPM = m;
    return m;
  }
  function loopRailMaterial() {
    if (RAILM) return RAILM;
    RAILM = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.92 });
    return RAILM;
  }
  function buildLoopMesh(scene, loop) {
    const segs = 120, half = LOOP_W / 2, thick = LOOP_THICK;
    const lp = { pos: new V3(), up: new V3(), fwd: new V3() };
    const sd = loop.side;
    const grassA = lin('#3fc252'), grassB = lin('#2b9e40'), edge = lin('#1d8a38');
    // running surface (stripes)
    const P = [], N = [], C = [], I = [], UV = [];
    const pts = [];
    let arc = 0;
    for (let i = 0; i <= segs; i++) {
      loopPoint(loop, (i / segs) * TAU, lp);
      if (i) arc += lp.pos.distanceTo(pts[i - 1].p);
      pts.push({ p: lp.pos.clone(), u: lp.up.clone(), s: arc });
    }
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[i + 1];
      const col = (Math.floor(i / 3) % 2) ? grassA : grassB;
      const base = P.length / 3;
      const quad = [[a, -1], [a, 1], [b, -1], [b, 1]];
      for (const [q, sgn] of quad) {
        const off = sgn * half;
        P.push(q.p.x + sd.x * off, q.p.y, q.p.z + sd.z * off);
        N.push(q.u.x, q.u.y, q.u.z);
        const e = Math.abs(off) > half - 0.01 ? 1 : 0;
        C.push(e ? lerp(col.r, edge.r, 0.25) : col.r, e ? lerp(col.g, edge.g, 0.25) : col.g, e ? lerp(col.b, edge.b, 0.25) : col.b);
        UV.push((off + half) / 2.6, q.s / 2.6);
      }
      I.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
    fixWinding(P, N, I);
    const g1 = new THREE.BufferGeometry();
    g1.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g1.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g1.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g1.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    g1.setIndex(I);
    g1.computeBoundingSphere();
    const surf = new THREE.Mesh(g1, loopSurfMaterial());
    surf.castShadow = true; surf.receiveShadow = true;
    // shell + side walls (world checker)
    const P2 = [], N2 = [], I2 = [];
    const ring = (fn) => { const base = P2.length / 3; for (let i = 0; i <= segs; i++) fn(pts[i], P2, N2); return base; };
    const strip = (b0, b1) => { for (let i = 0; i < segs; i++) I2.push(b0 + i, b0 + i + 1, b1 + i, b1 + i, b0 + i + 1, b1 + i + 1); };
    for (const sg of [-1, 1]) {
      const bi = ring((q, PP, NN) => { PP.push(q.p.x + sd.x * sg * half, q.p.y, q.p.z + sd.z * sg * half); NN.push(sd.x * sg, 0, sd.z * sg); });
      const bo = ring((q, PP, NN) => { PP.push(q.p.x + sd.x * sg * half - q.u.x * thick, q.p.y - q.u.y * thick, q.p.z + sd.z * sg * half - q.u.z * thick); NN.push(sd.x * sg, 0, sd.z * sg); });
      strip(bi, bo);
    }
    const b1 = ring((q, PP, NN) => { PP.push(q.p.x - sd.x * half - q.u.x * thick, q.p.y - q.u.y * thick, q.p.z - sd.z * half - q.u.z * thick); NN.push(-q.u.x, -q.u.y, -q.u.z); });
    const b2 = ring((q, PP, NN) => { PP.push(q.p.x + sd.x * half - q.u.x * thick, q.p.y - q.u.y * thick, q.p.z + sd.z * half - q.u.z * thick); NN.push(-q.u.x, -q.u.y, -q.u.z); });
    strip(b1, b2);
    fixWinding(P2, N2, I2);
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(P2, 3));
    g2.setAttribute('normal', new THREE.Float32BufferAttribute(N2, 3));
    g2.setIndex(I2);
    g2.computeBoundingSphere();
    const shell = new THREE.Mesh(g2, S.checkerMat);
    shell.castShadow = true; shell.receiveShadow = true;
    // rails
    const railPts = [[], []];
    for (let i = 0; i <= 80; i++) {
      loopPoint(loop, (i / 80) * TAU, lp);
      for (let k = 0; k < 2; k++) {
        const sg = k ? 1 : -1, off = sg * (half - 0.12);
        railPts[k].push(new V3(lp.pos.x + sd.x * off + lp.up.x * 0.42, lp.pos.y + lp.up.y * 0.42, lp.pos.z + sd.z * off + lp.up.z * 0.42));
      }
    }
    const gbR = new GB();
    for (let k = 0; k < 2; k++) {
      const curve = new THREE.CatmullRomCurve3(railPts[k]);
      gbR.add(new THREE.TubeGeometry(curve, 140, 0.09, 6, false), lin('#f4f1e6'), null, 0);
      for (let i = 4; i < 80; i += 8) {
        const a = railPts[k][i];
        loopPoint(loop, (i / 80) * TAU, lp);
        const pm = M4().compose(a.clone().addScaledVector(lp.up, -0.21), new THREE.Quaternion().setFromUnitVectors(UP, lp.up), new V3(1, 1, 1));
        gbR.add(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 5), lin('#d9d4c4'), pm, 0);
      }
    }
    const rails = new THREE.Mesh(gbR.build(), loopRailMaterial());
    rails.castShadow = true;
    const grp = new THREE.Group();
    surf.name = 'w-loop-surf'; shell.name = 'w-loop-shell'; rails.name = 'w-loop-rails';
    grp.add(surf, shell, rails);
    scene.add(grp);
    return grp;
  }

  // ----- decorations: templates baked into merged static meshes (one solid + one foliage mesh per zone)
  // Vertex layout: position, normal, color (linear tint), uv, aK = (kind, bend, phase, flutter). bend / flutter are the
  // wind amplitudes in metres at that vertex (0 at the roots): bend leans the whole plant with the gusts, flutter
  // shakes the leaf tips. Kinds pick the material layer (DK).
  const DK = { PLAIN: 0, BARK: 1, ROCK: 2, WOOD: 3, LEAVES: 4, RAWWOOD: 5, FROND: 10, LEAF: 11 };
  const _dv = new V3(), _dn = new V3(), _dm3 = new THREE.Matrix3();
  class DB {
    constructor() { this.P = []; this.N = []; this.C = []; this.U = []; this.K = []; this.I = []; this.n = 0; }
    v(x, y, z, nx, ny, nz, c, u, w, kind, bend, ph, fl) {
      this.P.push(x, y, z); this.N.push(nx, ny, nz); this.C.push(c.r, c.g, c.b); this.U.push(u, w); this.K.push(kind, bend, ph || 0, fl || 0);
      return this.n++;
    }
    tri(a, b, c) { this.I.push(a, b, c); }
    // a three.js geometry through matrix m. o: { col | colFn(p, n), kind, bend | bendFn(p), fl | flFn(p), ph, uv: scale | uvFn(p, n, uv) }
    geo(g, m, o) {
      if (g.index && o.flat) g = g.toNonIndexed();
      const pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv, cnt = pa.count, base = this.n;
      if (m) _dm3.getNormalMatrix(m);
      for (let i = 0; i < cnt; i++) {
        _dv.fromBufferAttribute(pa, i); if (m) _dv.applyMatrix4(m);
        if (na) { _dn.fromBufferAttribute(na, i); if (m) _dn.applyMatrix3(_dm3).normalize(); } else _dn.set(0, 1, 0);
        const c = o.colFn ? o.colFn(_dv, _dn) : o.col;
        let u = 0, w = 0;
        if (o.uvFn) { const t = o.uvFn(_dv, _dn, ua ? [ua.getX(i), ua.getY(i)] : null); u = t[0]; w = t[1]; }
        else if (ua) { const k = o.uv || 1; u = ua.getX(i) * k; w = ua.getY(i) * k; }
        this.v(_dv.x, _dv.y, _dv.z, _dn.x, _dn.y, _dn.z, c, u, w, o.kind || 0, o.bendFn ? o.bendFn(_dv) : (o.bend || 0), o.ph || 0, o.flFn ? o.flFn(_dv) : (o.fl || 0));
      }
      if (g.index) { const ia = g.index.array; for (let i = 0; i < ia.length; i++) this.I.push(ia[i] + base); }
      else for (let i = 0; i < cnt; i++) this.I.push(i + base);
      g.dispose();
      return this;
    }
    // append template t through matrix m (uniform scale s for the wind amplitudes), phase ph, colour tint
    put(t, m, s, ph, tint) {
      _dm3.getNormalMatrix(m);
      const base = this.n, P = t.P, N = t.N, C = t.C, U = t.U, Kk = t.K, e = m.elements;
      const tr = tint ? tint.r : 1, tg = tint ? tint.g : 1, tb = tint ? tint.b : 1, n3 = _dm3.elements;
      for (let i = 0; i < t.n; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        this.P.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
        const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
        let ax = n3[0] * nx + n3[3] * ny + n3[6] * nz, ay = n3[1] * nx + n3[4] * ny + n3[7] * nz, az = n3[2] * nx + n3[5] * ny + n3[8] * nz;
        const l = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
        this.N.push(ax / l, ay / l, az / l);
        this.C.push(C[i * 3] * tr, C[i * 3 + 1] * tg, C[i * 3 + 2] * tb);
        this.U.push(U[i * 2], U[i * 2 + 1]);
        this.K.push(Kk[i * 4], Kk[i * 4 + 1] * s, Kk[i * 4 + 2] + ph, Kk[i * 4 + 3] * s);
      }
      for (let i = 0; i < t.I.length; i++) this.I.push(t.I[i] + base);
      this.n += t.n;
    }
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2));
      g.setAttribute('aK', new THREE.Float32BufferAttribute(this.K, 4));
      g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1));
      g.computeBoundingSphere();
      return g;
    }
  }
  const tintOf = (hex, r, amt) => { const c = lin(hex); const k = 1 + (r() - 0.5) * amt; return c.multiplyScalar(k); };
  // a strip of triangles along a spine (frond, leaf): rows of [left, mid, right] vertices
  function ribbon(db, rows, col, kind, uvs) {
    const base = db.n;
    const nrm = new V3(), a = new V3(), b = new V3();
    for (let j = 0; j < rows.length; j++) {
      const r = rows[j], prev = rows[Math.max(0, j - 1)], next = rows[Math.min(rows.length - 1, j + 1)];
      // the normal agrees with the triangles' winding (front = along x across): double-sided materials flip it (a row
      // of zero width, a pointed tip, keeps the previous row's across direction)
      a.subVectors(next.m, prev.m);
      if (r.r.distanceToSquared(r.l) > 1e-10) b.subVectors(r.r, r.l);
      else if (j === 0) { const r1 = rows[Math.min(rows.length - 1, 1)]; b.subVectors(r1.r, r1.l); }
      nrm.crossVectors(a, b);
      if (nrm.lengthSq() < 1e-12) nrm.set(0, 1, 0); else nrm.normalize();
      for (let k = 0; k < 3; k++) {
        const p = k === 0 ? r.l : k === 1 ? r.m : r.r;
        db.v(p.x, p.y, p.z, nrm.x, nrm.y, nrm.z, col, uvs ? r.u : 0, uvs ? k * 0.5 : 0, kind, r.bend, r.ph, r.fl * (k === 1 ? 0.5 : 1));
      }
      if (j) {
        const q = base + (j - 1) * 3, w = q + 3;
        db.tri(q, w, q + 1); db.tri(q + 1, w, w + 1); db.tri(q + 1, w + 1, q + 2); db.tri(q + 2, w + 1, w + 2);
      }
    }
  }
  // ---- palm: curved bark trunk, a crown of 12-14 textured fronds (two tiers, the lowest ones older and drooping),
  // coconuts. Origin at the foot, +x = lean direction.
  function tplPalm(seed, lite) {
    const r = rngOf(seed), t = new DB();
    const H = 6.4 + r() * 1.8, lean = 1.1 + r() * 1.0, wig = (r() - 0.5) * 0.7;
    const segs = lite ? 6 : 10, sides = lite ? 5 : 8, swayTop = 0.32;
    const cAt = s => new V3(lean * s * s + wig * Math.sin(s * Math.PI) * 0.6, H * s, wig * 0.3 * Math.sin(s * 2.2));
    const bark = tintOf('#a77246', r, 0.15);
    let len = 0, prevC = cAt(0);
    const ring0 = t.n;
    for (let i = 0; i <= segs; i++) {
      const s = i / segs, c = cAt(s);
      len += c.distanceTo(prevC); prevC = c;
      const tg = cAt(Math.min(1, s + 0.01)).sub(cAt(Math.max(0, s - 0.01))).normalize();
      const b1 = new V3().crossVectors(tg, new V3(0, 0, 1)).normalize(), b2 = new V3().crossVectors(b1, tg).normalize();
      const rad = 0.3 * (1 - 0.38 * s) + 0.16 * Math.pow(1 - s, 6) + (i === segs ? -0.03 : 0);
      for (let k = 0; k <= sides; k++) {
        const a = (k / sides) * TAU, ca = Math.cos(a), sa = Math.sin(a);
        const nx = b1.x * ca + b2.x * sa, ny = b1.y * ca + b2.y * sa, nz = b1.z * ca + b2.z * sa;
        t.v(c.x + nx * rad, c.y + ny * rad, c.z + nz * rad, nx, ny, nz, bark, (k / sides) * 2, len / 1.76, DK.BARK, swayTop * s * s, 0, 0);
      }
      if (i) {
        const q = ring0 + (i - 1) * (sides + 1), w = q + sides + 1;
        for (let k = 0; k < sides; k++) { t.tri(q + k, q + k + 1, w + k); t.tri(w + k, q + k + 1, w + k + 1); }
      }
    }
    const top = cAt(1);
    // frond bases + coconuts
    t.geo(new THREE.SphereGeometry(0.34, lite ? 5 : 7, lite ? 3 : 5), M4().makeTranslation(top.x, top.y - 0.05, top.z), { col: lin('#6b6a2c'), kind: DK.PLAIN, bend: swayTop });
    if (!lite) {
      const nc = 3 + Math.floor(r() * 3);
      for (let k = 0; k < nc; k++) {
        const a = (k / nc) * TAU + r(), rr = 0.24;
        t.geo(new THREE.SphereGeometry(0.16, 6, 4), M4().makeTranslation(top.x + Math.cos(a) * rr, top.y - 0.32 - r() * 0.1, top.z + Math.sin(a) * rr),
          { col: r() < 0.5 ? lin('#5e6d22') : lin('#6b4a1f'), kind: DK.PLAIN, bend: swayTop });
      }
    }
    const nf = lite ? 8 : 12 + Math.floor(r() * 3), M = lite ? 5 : 8;
    for (let f = 0; f < nf; f++) {
      const low = f % 3 === 0;
      const az = (f / nf) * TAU + (r() - 0.5) * 0.35;
      const L = (low ? 3.2 : 3.6) + r() * 0.8, W = L * 0.47;
      const el = low ? -0.15 - r() * 0.2 : 0.3 + r() * 0.45, droop = low ? 0.75 : 0.55 + r() * 0.15;
      const dh = new V3(Math.cos(az), 0, Math.sin(az)), sd = new V3(-dh.z, 0, dh.x);
      const twist = (r() - 0.5) * 0.5, fold = W * 0.17;
      const col = low ? tintOf('#e2cf86', r, 0.2) : tintOf('#f4ffe8', r, 0.12);
      const rows = [];
      for (let j = 0; j <= M; j++) {
        const u = j / M, al = L * u;
        const sp = top.clone().addScaledVector(dh, Math.cos(el) * al * (1 - 0.08 * u)).add(new V3(0, Math.sin(el) * al - droop * al * al / L, 0));
        const tw = twist * u, hw = W / 2;
        const side = sd.clone().multiplyScalar(Math.cos(tw)).add(new V3(0, Math.sin(tw), 0));
        const fy = fold * (0.4 + 0.6 * Math.sin(Math.min(1, u * 1.3) * Math.PI * 0.5));
        rows.push({ l: sp.clone().addScaledVector(side, -hw).add(new V3(0, -fy, 0)), m: sp.clone(), r: sp.clone().addScaledVector(side, hw).add(new V3(0, -fy, 0)),
          u, bend: swayTop, ph: f * 0.83, fl: 0.18 * u * u });
      }
      ribbon(t, rows, col, DK.FROND, true);
    }
    return t;
  }
  // ---- sunflower (faces +z): stem, two leaves, seed disc and two rings of petals
  function tplSunflower() {
    const t = new DB(), Hs = 2.1;
    const bendFn = p => 0.09 * Math.max(0, p.y / Hs) * Math.max(0, p.y / Hs);
    t.geo(new THREE.CylinderGeometry(0.045, 0.07, Hs, 6, 3, true), M4().makeTranslation(0, Hs / 2, 0), { col: lin('#3d8a2c'), kind: DK.PLAIN, bendFn });
    for (const [y, a, L] of [[0.72, 0.2, 0.75], [1.25, 3.4, 0.65], [1.6, 1.7, 0.5]]) {
      const d = new V3(Math.cos(a), 0.35, Math.sin(a)).normalize(), sd = new V3(-d.z, 0, d.x);
      const rows = [];
      for (let j = 0; j <= 4; j++) {
        const u = j / 4, w = Math.sin(Math.PI * Math.min(1, u * 1.1)) * 0.17;
        const c = new V3(0, y, 0).addScaledVector(d, L * u).add(new V3(0, -0.25 * u * u, 0));
        rows.push({ l: c.clone().addScaledVector(sd, -w), m: c.clone().add(new V3(0, 0.03, 0)), r: c.clone().addScaledVector(sd, w), u, bend: bendFn(c), ph: a, fl: 0.04 * u });
      }
      ribbon(t, rows, lin('#3f9a34'), DK.LEAF, false);
    }
    const pv = new V3(0, Hs, 0.09), hb = bendFn(pv);
    t.geo(new THREE.CylinderGeometry(0.34, 0.3, 0.14, 14), TRS(pv.x, pv.y, pv.z, Math.PI / 2, 0, 0, 1), { col: lin('#5a3210'), kind: DK.PLAIN, bend: hb });
    t.geo(new THREE.CircleGeometry(0.27, 14), TRS(pv.x, pv.y, pv.z + 0.072, 0, 0, 0, 1), { colFn: (p) => { const d = Math.hypot(p.x - pv.x, p.y - pv.y); return d < 0.12 ? lin('#3b200a') : lin('#7a4a16'); }, kind: DK.PLAIN, bend: hb });
    for (const [n, rI, rO, z, rot, cI, cO] of [[14, 0.28, 0.82, 0.05, 0, '#f5a812', '#ffd23a'], [14, 0.27, 0.72, 0.03, Math.PI / 14, '#e8960e', '#ffc22a']]) {
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + rot, d = new V3(Math.cos(a), Math.sin(a), 0), sd = new V3(-d.y, d.x, 0);
        const rows = [];
        for (let j = 0; j <= 2; j++) {
          const u = j / 2, rr = rI + (rO - rI) * u, w = Math.sin(Math.PI * Math.min(1, 0.15 + u * 0.85)) * 0.075;
          const c = pv.clone().addScaledVector(d, rr).add(new V3(0, 0, z - 0.06 * u * u));
          rows.push({ l: c.clone().addScaledVector(sd, -w), m: c.clone().add(new V3(0, 0, 0.012)), r: c.clone().addScaledVector(sd, w), u, bend: hb, ph: 0, fl: 0.02 * u });
        }
        ribbon(t, rows, lin(cI), DK.LEAF, false);
        // petals: colour from base to tip (the ribbon writes one colour: patch the last 9 vertices)
        const cc = [lin(cI), lin(cI), lin(cI), lin(cO), lin(cO), lin(cO), lin(cO), lin(cO), lin(cO)];
        for (let q = 0; q < 9; q++) { const vi = t.n - 9 + q; t.C[vi * 3] = cc[q].r; t.C[vi * 3 + 1] = cc[q].g; t.C[vi * 3 + 2] = cc[q].b; }
      }
    }
    return t;
  }
  // ---- small flower tuft: 3-5 flowers (five petals) on thin stems + a rosette of leaves
  function tplFlowers(seed) {
    const r = rngOf(seed), t = new DB();
    const pal = [['#b25bff', '#e2b8ff'], ['#ff5f9e', '#ffc0da'], ['#ffffff', '#fff6d6'], ['#ff8a2b', '#ffd27a'], ['#9a4bf0', '#d7b0ff'], ['#ff4a4a', '#ffb0a0']];
    const nfl = 3 + Math.floor(r() * 3);
    for (let i = 0; i < nfl; i++) {
      const a = r() * TAU, d = 0.06 + r() * 0.22, x = Math.cos(a) * d, z = Math.sin(a) * d, h = 0.35 + r() * 0.35;
      const p = pal[Math.floor(r() * pal.length)], bendFn = q => 0.07 * Math.max(0, q.y / 0.7);
      t.geo(new THREE.CylinderGeometry(0.014, 0.02, h, 3, 1, true), M4().makeTranslation(x, h / 2, z), { col: lin('#3d8f2e'), kind: DK.LEAF, bendFn });
      const c = new V3(x, h, z), hb = bendFn(c), tilt = (r() - 0.5) * 0.8, ra = r() * TAU;
      const fq = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, ra, 0, 'YXZ'));
      const n5 = 5, rO = 0.09 + r() * 0.05;
      for (let k = 0; k < n5; k++) {
        const pa = (k / n5) * TAU;
        const d1 = new V3(Math.cos(pa), 0, Math.sin(pa)).applyQuaternion(fq), sd = new V3(-Math.sin(pa), 0, Math.cos(pa)).applyQuaternion(fq), up = new V3(0, 1, 0).applyQuaternion(fq);
        const rows = [];
        for (let j = 0; j <= 2; j++) {
          const u = j / 2, w = Math.sin(Math.PI * Math.min(1, 0.2 + u * 0.8)) * rO * 0.55;
          const cc = c.clone().addScaledVector(d1, 0.015 + rO * u).addScaledVector(up, 0.03 * u * (1 - u) + 0.02 * u);
          rows.push({ l: cc.clone().addScaledVector(sd, -w), m: cc.clone().addScaledVector(up, 0.008), r: cc.clone().addScaledVector(sd, w), u, bend: hb, ph: i, fl: 0.015 * u });
        }
        ribbon(t, rows, lin(p[0]), DK.LEAF, false);
        const ct = lin(p[1]);
        for (let q = 6; q < 9; q++) { const vi = t.n - 9 + q; t.C[vi * 3] = ct.r; t.C[vi * 3 + 1] = ct.g; t.C[vi * 3 + 2] = ct.b; }
      }
      t.geo(new THREE.SphereGeometry(0.025, 4, 3), M4().makeTranslation(c.x, c.y + 0.01, c.z), { col: lin('#ffd42e'), kind: DK.LEAF, bend: hb });
    }
    for (let k = 0; k < 5; k++) {
      const a = k * 1.3 + r(), d = new V3(Math.cos(a), 0.45, Math.sin(a)).normalize(), sd = new V3(-d.z, 0, d.x), L = 0.25 + r() * 0.15;
      const rows = [];
      for (let j = 0; j <= 3; j++) {
        const u = j / 3, w = Math.sin(Math.PI * Math.min(1, 0.1 + u)) * 0.06;
        const c = new V3(0, 0.02, 0).addScaledVector(d, L * u).add(new V3(0, -0.12 * u * u, 0));
        rows.push({ l: c.clone().addScaledVector(sd, -w), m: c.clone().add(new V3(0, 0.012, 0)), r: c.clone().addScaledVector(sd, w), u, bend: 0, ph: k, fl: 0.02 * u });
      }
      ribbon(t, rows, lin('#3a9a38'), DK.LEAF, false);
    }
    return t;
  }
  // ---- bush: lumpy leafy blobs (leaf texture, darker inside / at the bottom)
  function tplBush(seed, lite) {
    const r = rngOf(seed), t = new DB();
    const lo = lin('#2b6f2c'), hi = lin('#7fd36a');
    let blobs = [[-0.72, 0.55, 0, 0.74], [0, 0.82, 0.08, 0.95], [0.76, 0.55, -0.05, 0.78], [0.3, 0.45, 0.62, 0.62], [-0.3, 0.45, -0.6, 0.62]];
    if (r() < 0.5) blobs.push([0.1, 1.3, -0.1, 0.55]);
    if (lite) blobs = [[-0.6, 0.55, 0, 0.82], [0.1, 0.8, 0.05, 1.0], [0.72, 0.55, -0.05, 0.8]];
    let bi = 0;
    for (const [x, y, z, rr] of blobs) {
      const g = new THREE.IcosahedronGeometry(rr, lite ? 0 : 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
        const k = 1 + 0.16 * vnoise(px * 3.1 + bi * 7, pz * 3.1 + py * 2.3, 31 + bi) + 0.07 * vnoise(px * 7.3, py * 7.3 + pz, 37);
        p.setXYZ(i, px * k, py * k * 0.92, pz * k);
      }
      smoothNormals(g);
      const ou = r() * 4, ov = r() * 4, v0 = t.n;
      t.geo(g.index ? g.toNonIndexed() : g, M4().makeTranslation(x, y, z), {
        colFn: (q, n) => { const tt = clamp(q.y / 1.9 + n.y * 0.25, 0, 1); return new THREE.Color(lerp(lo.r, hi.r, tt), lerp(lo.g, hi.g, tt), lerp(lo.b, hi.b, tt)); },
        uvFn: (q) => [Math.atan2(q.z - z, q.x - x) / Math.PI * 1.5 + ou, (q.y - y) * 1.1 + ov], kind: DK.LEAVES, bendFn: q => 0.035 * Math.max(0, q.y / 1.8)
      });
      // the wrap of the azimuth (u spans 3 tiles around): a triangle across it takes the near copy
      for (let i = v0; i + 2 < t.n; i += 3) {
        const us = [t.U[i * 2], t.U[i * 2 + 2], t.U[i * 2 + 4]], mx = Math.max(...us);
        if (mx - Math.min(...us) > 1.5) for (let k = 0; k < 3; k++) if (mx - us[k] > 1.5) t.U[(i + k) * 2] += 3;
      }
      bi++;
    }
    return t;
  }
  // smooth vertex normals for a non-indexed geometry (face normals averaged over vertices at the same position)
  function smoothNormals(g) {
    g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal, acc = new Map(), key = i => Math.round(p.getX(i) * 1e3) + ',' + Math.round(p.getY(i) * 1e3) + ',' + Math.round(p.getZ(i) * 1e3);
    for (let i = 0; i < p.count; i++) { const k = key(i); const a = acc.get(k) || [0, 0, 0]; a[0] += n.getX(i); a[1] += n.getY(i); a[2] += n.getZ(i); acc.set(k, a); }
    for (let i = 0; i < p.count; i++) { const a = acc.get(key(i)), l = Math.hypot(a[0], a[1], a[2]) || 1; n.setXYZ(i, a[0] / l, a[1] / l, a[2] / l); }
  }
  // ---- rock: rounded boulder (noise-displaced, flattened), sandstone texture by box projection, moss on top
  function tplRock(seed, lite) {
    const r = rngOf(seed), t = new DB();
    let g = new THREE.IcosahedronGeometry(1, lite ? 1 : 2);
    if (g.index) g = g.toNonIndexed();
    const p = g.attributes.position;
    const sx = 1.1 + r() * 0.35, sy = 0.62 + r() * 0.25, sz = 0.9 + r() * 0.25;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + 0.22 * vnoise(x * 1.7 + seed, z * 1.7 + y * 1.3, 51) + 0.08 * vnoise(x * 4.1 + y, z * 4.1, 53);
      p.setXYZ(i, x * k * sx, Math.max(y * k * sy, -0.25), z * k * sz);
    }
    smoothNormals(g);
    const stone = tintOf('#a9a194', r, 0.18), moss = lin('#5f8a36');
    const ou = r() * 5, ov = r() * 5;
    // box projection per triangle (each triangle of the non-indexed geometry takes its dominant axis)
    const tmp = new DB();
    tmp.geo(g, null, { colFn: (q, n) => n.y > 0.55 ? stone.clone().lerp(moss, clamp((n.y - 0.55) * 2.2, 0, 0.75)) : stone, kind: DK.ROCK });
    for (let i = 0; i < tmp.n; i += 3) {
      let ax = 0, ay = 0, az = 0;
      for (let k = 0; k < 3; k++) { ax += Math.abs(tmp.N[(i + k) * 3]); ay += Math.abs(tmp.N[(i + k) * 3 + 1]); az += Math.abs(tmp.N[(i + k) * 3 + 2]); }
      for (let k = 0; k < 3; k++) {
        const j = i + k, x = tmp.P[j * 3], y = tmp.P[j * 3 + 1], z = tmp.P[j * 3 + 2];
        const uv = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, y] : [x, y];
        tmp.U[j * 2] = uv[0] * 0.45 + ou; tmp.U[j * 2 + 1] = uv[1] * 0.45 + ov;
      }
    }
    t.put(tmp, M4(), 1, 0, null);
    return t;
  }
  // ---- totem (the level's landmark: three painted wooden blocks, a fox head on top)
  function tplTotem() {
    const t = new DB();
    const box = (x, y, z, w, h, d, hex, rx, ry, rz) => t.geo(new THREE.BoxGeometry(w, h, d), TRS(x, y, z, rx || 0, ry || 0, rz || 0, 1),
      { col: lin(hex), kind: DK.WOOD, uvFn: (q, n, uv) => [uv ? uv[0] * Math.max(w, d) * 0.35 : 0, uv ? uv[1] * h * 0.35 : 0] });
    const S0 = 1.15;
    t.geo(new THREE.BoxGeometry(1.6, 0.3, 1.6), M4().makeTranslation(0, 0.15, 0), { col: lin('#8b8fa8'), kind: DK.ROCK, uv: 0.8 });
    box(0, 0.3 + S0 / 2, 0, S0, S0, S0, '#e8b23a');
    box(0, 0.3 + S0 / 2, 0.02, S0 * 0.3, S0 * 1.002, S0 * 1.004, '#c9921f');
    for (const sx of [-0.25, 0.25]) { box(sx, 0.3 + S0 * 0.62, S0 / 2 + 0.01, 0.2, 0.2, 0.04, '#fff3dc'); box(sx, 0.3 + S0 * 0.6, S0 / 2 + 0.03, 0.09, 0.11, 0.03, '#2a1406'); }
    box(0, 0.3 + S0 * 0.28, S0 / 2 + 0.01, 0.42, 0.09, 0.04, '#2a1406');
    const yb = 0.3 + S0 * 1.5;
    box(0, yb, 0, S0, S0, S0, '#2e8bc0');
    box(0, yb, 0.0, S0 * 1.004, S0 * 0.18, S0 * 1.004, '#1d5f8a');
    for (const sx of [-1, 1]) {
      box(sx * (S0 / 2 + 0.45), yb + 0.2, 0, 0.9, 0.12, 0.6, '#2e8bc0', 0, 0, sx * 0.45);
      box(sx * (S0 / 2 + 0.85), yb + 0.45, 0, 0.5, 0.1, 0.45, '#1d5f8a', 0, 0, sx * 0.7);
    }
    const yt = 0.3 + S0 * 2.5;
    box(0, yt, 0, S0 * 1.08, S0, S0 * 1.02, '#f47a1f');
    box(0, yt - 0.22, S0 / 2 + 0.12, 0.62, 0.42, 0.3, '#fff4e6');
    box(0, yt - 0.1, S0 / 2 + 0.29, 0.16, 0.12, 0.06, '#2a1406');
    for (const sx of [-0.27, 0.27]) {
      box(sx, yt + 0.16, S0 / 2 + 0.02, 0.26, 0.24, 0.04, '#ffffff');
      box(sx + (sx > 0 ? -0.03 : 0.03), yt + 0.15, S0 / 2 + 0.04, 0.12, 0.18, 0.03, '#22c36a');
      box(sx + (sx > 0 ? -0.03 : 0.03), yt + 0.15, S0 / 2 + 0.055, 0.05, 0.09, 0.02, '#0b2a14');
    }
    for (const sx of [-1, 1]) {
      t.geo(new THREE.ConeGeometry(0.32, 0.7, 4), TRS(sx * 0.35, yt + S0 / 2 + 0.3, 0, 0, Math.PI / 4, sx * -0.2, 1), { col: lin('#f47a1f'), kind: DK.WOOD, flat: true, uvFn: q => [q.x * 0.7, q.y * 0.7] });
      t.geo(new THREE.ConeGeometry(0.17, 0.42, 4), TRS(sx * 0.35, yt + S0 / 2 + 0.25, 0.14, 0, Math.PI / 4, sx * -0.2, 1), { col: lin('#6a2408'), kind: DK.WOOD, flat: true, uvFn: q => [q.x * 0.7, q.y * 0.7] });
    }
    return t;
  }
  function birdGeo() {
    const gb = new GB();
    const P = [0, 0, 0.35, 0, 0.02, -0.35, -1.1, 0.1, -0.1, 1.1, 0.1, -0.1, -0.5, 0.05, 0.12, 0.5, 0.05, 0.12];
    const N = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
    const I = [0, 4, 2, 0, 2, 1, 0, 3, 5, 0, 1, 3];
    const w = lin('#ffffff'), g = lin('#c8ccd8');
    gb.raw(P, N, [w, w, g, g, w, w], [0, 0, 1, 1, 0.45, 0.45], I);
    gb.add(new THREE.SphereGeometry(1, 6, 4), lin('#f2f2f2'), TRS(0, 0, 0, 0, 0, 0, 0.12, 0.1, 0.4), 0);
    return gb.build('aAnim');
  }

  const ZONE = 150; // decor zones along z (frustum culling + one solid and one foliage draw each)

  // ======================= level placements =======================
  function R(z, d) { routeAtZ(z, _ra); return { x: _ra.x + _ra.rx * d, z: _ra.z + _ra.rz * d, dx: _ra.dx, dz: _ra.dz, rx: _ra.rx, rz: _ra.rz, yaw: _ra.yaw }; }
  function gyAt(x, z, top) { const g = ground(x, z, top == null ? 1e6 : top); return g ? g.y : null; }
  function onG(z, d, h) { const p = R(z, d); const y = gyAt(p.x, p.z); return new V3(p.x, (y == null ? SEA : y) + (h || 0), p.z); }
  function dirAt(z) { const p = R(z, 0); return new V3(p.dx, 0, p.dz); }
  function yawAt(z) { const p = R(z, 0); return Math.atan2(-p.dx, -p.dz); }

  const LV = { rings: [], enemies: [], springs: [], dashPanels: [], monitors: [], spikes: [], checkpoints: [], loops: [] };
  const RING_H = 1.1;
  function ringLine(z0, z1, n, d0, d1, h) {
    for (let i = 0; i < n; i++) { const t = n > 1 ? i / (n - 1) : 0.5; LV.rings.push(onG(lerp(z0, z1, t), lerp(d0, d1 == null ? d0 : d1, t), h == null ? RING_H : h)); }
  }
  function ringArc(z0, z1, n, d, peak) {
    for (let i = 0; i < n; i++) { const t = n > 1 ? i / (n - 1) : 0.5; LV.rings.push(onG(lerp(z0, z1, t), d, RING_H + Math.sin(Math.PI * t) * peak)); }
  }
  function ringBallistic(p0, v, n, t0, t1) {
    for (let i = 0; i < n; i++) {
      const t = lerp(t0, t1, n > 1 ? i / (n - 1) : 0.5);
      LV.rings.push(new V3(p0.x + v.x * t, p0.y + 0.6 + v.y * t - 21 * t * t, p0.z + v.z * t));
    }
  }
  function enemy(type, pos, range, dir, calm) { const e = { type, pos, range, dir: dir || new V3(1, 0, 0) }; if (calm) e.calm = true; LV.enemies.push(e); }
  function spring(pos, dir, power, lock) { LV.springs.push({ pos, dir: dir.clone().normalize(), power, lock }); }
  // halfW: lateral trigger half-width (default: the panel); reach: the trigger also boosts a grounded player this far
  // past the panel (a launch ramp run-up)
  function dash(z, d, speed, halfW, reach, kick) {
    const e = { pos: onG(z, d, 0), dir: dirAt(z), speed };
    if (halfW) e.halfW = halfW;
    if (reach) e.reach = reach;
    if (kick) e.kick = kick;
    LV.dashPanels.push(e);
  }
  function monitor(pos, kind) { LV.monitors.push({ pos, kind }); }
  function checkpoint(z, d, halfW) { const c = { pos: onG(z, d || 0, 0), yaw: yawAt(z) }; if (halfW) c.halfW = halfW; LV.checkpoints.push(c); }
  function lateralDir(z, sg) { const p = R(z, 0); return new V3(p.rx * sg, 0, p.rz * sg); }

  const SOLIDS_GB = new GB();
  const POI = {};
  function buildSolids(scene) {
    const gb = SOLIDS_GB;
    // ---- section 4: checker pillars on the upper cliff
    POI.pillars = [];
    for (const [z, d, w, h] of [[-223, -7.2, 2.2, 5.5], [-229, 7.4, 2.2, 4.2], [-214.8, 8.6, 2.4, 7]]) {
      const p = R(z, d); const y = terrainY(p.x, p.z);
      const s = boxSolid(gb, p.x, p.z, w, w, y - 2, y + h, 'pillar');
      POI.pillars.push(new V3(p.x, s.max.y, p.z));
    }
    // ---- chasm platforms: a full-speed jump from the near edge (about 15 u) lands on the long middle one; the
    // moving one is the last hop, so a lateral carry-over from it lands on the wide far side
    const cz1 = -242, cz2 = -248.75, cz3 = -256.5, top = 26;
    { const p = R(cz1, 0); boxSolid(gb, p.x, p.z, 4.5, 5, DEEP - 2, top, 'platform'); }
    { const p = R(cz2, 0); boxSolid(gb, p.x, p.z, 5, 6.5, DEEP - 2, top, 'platform'); }
    {
      const p = R(cz3, 0);
      const gbm = new GB(), hs = 2.5;
      addBox(gbm, -hs, -1.7, -hs, hs, 0, hs, true);
      const geo = gbm.build('aLip');
      const mesh = new THREE.Mesh(geo, groundMaterial('local'));
      mesh.name = 'w-mover';
      mesh.position.set(p.x, top, p.z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      scene.add(mesh);
      const s = addSolid(new V3(p.x - hs, top - 1.7, p.z - hs), new V3(p.x + hs, top, p.z + hs), 'moving', mesh);
      S.movers.push({ solid: s, mesh, base: new V3(p.x, top, p.z), cur: new V3(p.x, top, p.z), axis: new V3(p.rx, 0, p.rz), amp: 3.5, period: 5, phase: 0 });
      // underside: a little hover crystal so it reads as a floating platform
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), new THREE.MeshStandardMaterial({ color: lin('#59e3ff'), emissive: lin('#1a8bb0'), roughness: 0.25, metalness: 0.1 }));
      gem.position.set(0, -2.3, 0); gem.scale.set(1, 1.6, 1);
      mesh.add(gem);
    }
    POI.chasm = { z1: cz1, z2: cz2, z3: cz3, top };
    // ---- shield ledge on the descent (left side)
    {
      const p = R(-322, -9.4);
      let hmax = -1e9;
      for (let a = -2.25; a <= 2.25; a += 0.75) for (let b = -2.25; b <= 2.25; b += 0.75) hmax = Math.max(hmax, terrainY(p.x + a, p.z + b));
      const s = boxSolid(gb, p.x, p.z, 4.5, 4.5, hmax - 3, hmax + 1.6, 'ledge');
      POI.ledge = new V3(p.x, s.max.y, p.z);
    }
    // ---- 1UP pillar in the alcove after the gap (right side)
    {
      const p = R(-563, 13);
      const y = terrainY(p.x, p.z);
      const s = boxSolid(gb, p.x, p.z, 2.6, 2.6, y - 2, y + 7, 'pillar');
      POI.oneUp = new V3(p.x, s.max.y, p.z);
    }
    // ---- bridge (deck + rails) over the channel
    {
      const p0 = R(-445, 0);
      const zA = -416, zB = -474, deckY = 4;
      addSolid(new V3(p0.x - 3, deckY - 0.45, zB), new V3(p0.x + 3, deckY, zA), 'bridge', null);
      addSolid(new V3(p0.x + 3, deckY - 0.2, zB + 2), new V3(p0.x + 3.35, deckY + 0.95, zA - 2), 'rail', null);
      addSolid(new V3(p0.x - 3.35, deckY - 0.2, zB + 2), new V3(p0.x - 3, deckY + 0.95, zA - 2), 'rail', null);
      // planks, beams, posts and rails in raw wood (grain along each piece), rope hand lines
      const bg = new DB();
      const woodUV = ax => (q, n) => {
        const a = Math.abs(n.x), b = Math.abs(n.y), c = Math.abs(n.z), k = 0.42;
        if (ax === 'x') return b >= a && b >= c ? [q.x * k, q.z * k] : c >= a ? [q.x * k, q.y * k] : [q.z * k, q.y * k];
        if (ax === 'z') return b >= a && b >= c ? [q.z * k, q.x * k] : a >= c ? [q.z * k, q.y * k] : [q.x * k, q.y * k];
        return a >= c ? [q.y * k, q.z * k] : [q.y * k, q.x * k];
      };
      const wood = (g, m, hex, ax) => bg.geo(g, m, { col: lin(hex), kind: DK.RAWWOOD, uvFn: woodUV(ax) });
      let k = 0;
      for (let z = zA - 0.55; z > zB + 0.4; z -= 1.12, k++) {
        const jit = (ihash(k, 3, 7) - 0.5) * 0.08;
        wood(new THREE.BoxGeometry(6, 0.26, 0.98), TRS(p0.x, deckY - 0.13 + jit * 0.2, z, 0, jit, 0, 1), k % 2 ? '#c99a6a' : '#b88a5c', 'x');
      }
      for (const sx of [-2.3, 2.3]) wood(new THREE.BoxGeometry(0.35, 0.35, zA - zB), M4().makeTranslation(p0.x + sx, deckY - 0.42, (zA + zB) / 2), '#8a6446', 'z');
      for (const sx of [-3.17, 3.17]) {
        for (let z = zA - 2; z >= zB + 2 - 0.01; z -= (zA - zB - 4) / 8) wood(new THREE.CylinderGeometry(0.13, 0.15, 1.5, 8), M4().makeTranslation(p0.x + sx, deckY + 0.3, z), '#8a6446', 'y');
        wood(new THREE.BoxGeometry(0.2, 0.14, zA - zB - 3.6), M4().makeTranslation(p0.x + sx, deckY + 0.95, (zA + zB) / 2), '#b88a5c', 'z');
        bg.geo(new THREE.CylinderGeometry(0.04, 0.04, zA - zB - 4, 5), TRS(p0.x + sx, deckY + 0.5, (zA + zB) / 2, Math.PI / 2, 0, 0, 1), { col: lin('#d9c08a'), kind: DK.PLAIN });
      }
      // stilts down into the water
      for (const z of [-430, -445, -460]) for (const sx of [-2.6, 2.6]) wood(new THREE.CylinderGeometry(0.22, 0.26, deckY + 3, 9), M4().makeTranslation(p0.x + sx, (deckY - 3) / 2 - 0.4, z), '#6e5440', 'y');
      const bm = new THREE.Mesh(bg.build(), decorMaterials().solid);
      bm.name = 'w-bridge';
      bm.castShadow = true; bm.receiveShadow = true;
      scene.add(bm);
      POI.bridge = { x: p0.x, zA, zB, y: deckY };
    }
    // ---- arena rim (low checker wall with an entrance toward the causeway)
    {
      const ri = 26.4, ro = 27.6, y0 = ARENA.y - 0.6, y1 = ARENA.y + 1.1;
      const entry = R(-611, 0);
      const gapAng = Math.atan2(entry.z - ARENA.z, entry.x - ARENA.x), gapHalf = Math.asin(clamp(7.2 / 27, 0, 1));
      rimGeometry(gb, ARENA.x, ARENA.z, ri, ro, y0, y1, gapAng, gapHalf);
      const n = 104;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU;
        if (Math.abs(Math.atan2(Math.sin(a - gapAng), Math.cos(a - gapAng))) < gapHalf + 0.012) continue;
        const cx = ARENA.x + Math.cos(a) * 27, cz = ARENA.z + Math.sin(a) * 27, hs = 0.56;
        // the rim collides well above its visible top (an air dash at the rim must not carry Kit over it into the
        // sea); being taller than it looks, it is never a floor (noTop)
        const s = addSolid(new V3(cx - hs, y0, cz - hs), new V3(cx + hs, ARENA.y + 4.6, cz + hs), 'rim', null);
        s.noTop = true;
      }
      // entrance posts
      const postAt = [];
      for (const sg of [-1, 1]) {
        const a = gapAng + sg * (gapHalf + 0.035);
        const cx = ARENA.x + Math.cos(a) * 27, cz = ARENA.z + Math.sin(a) * 27;
        boxSolid(gb, cx, cz, 1.5, 1.5, y0, ARENA.y + 2.4, 'rim');
        postAt.push({ x: cx, z: cz });
      }
      // causeway rim on the outside of the last bend: beyond it the hill ends in a sheer drop into the sea, so the
      // low checker wall runs from the hillside to the arena's right entrance post and funnels the causeway in
      const rp = postAt[0].x > postAt[1].x ? postAt[0] : postAt[1];
      // [z, x offset east of the route centre at that z]
      const path = [[-573.2, 18], [-587.2, 9.6], [-592.5, 9], [-606, 9.3]].map(([z, dx]) => [R(z, 0).x + dx, z]);
      // the last stretch angles in so a Kit sliding along its inner face passes inside the post, not into it
      path.push([rp.x - 0.5, rp.z + 1.05]);
      pathRim(gb, path, 1.2, 1.1, 3.6);
    }
    const geo = gb.build('aLip');
    const mesh = new THREE.Mesh(geo, groundMaterial('prop'));
    mesh.name = 'w-solids';
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    for (const s of W.solids) if (!s.mesh) s.mesh = mesh;
  }

  function buildLoops(scene) {
    for (const def of LOOP_DEFS) {
      const p = R(def.z, def.d);
      const y = terrainY(p.x, p.z);
      const loop = { entry: new V3(p.x, y, p.z), dir: new V3(p.dx, 0, p.dz).normalize(), side: new V3(p.rx, 0, p.rz).normalize(), radius: LOOP_R, shift: LOOP_SHIFT, minSpeed: 14,
        width: LOOP_W, thick: LOOP_THICK, low: LOOP_LOW, nudge: LOOP_NUDGE };
      LV.loops.push(loop);
      loop.mesh = buildLoopMesh(scene, loop);
      loopWalls(loop);
    }
  }
  function loopRings(loop, n) {
    const lp = { pos: new V3(), up: new V3(), fwd: new V3() };
    for (let i = 0; i < n; i++) {
      const th = 0.55 + (TAU - 1.1) * (i / (n - 1));
      loopPoint(loop, th, lp);
      LV.rings.push(lp.pos.clone().addScaledVector(lp.up, RING_H));
    }
  }

  function buildPlacements() {
    const L = LV;
    // ---- 1. Plage de départ
    const start = onG(0, 0, 0);
    ringLine(-8, -26, 6, 0, 0);
    ringLine(-10, -24, 4, 5.5, 5.5);
    for (let i = 0; i < 8; i++) L.rings.push(onG(-32 - i * 2.8, 3.6 * Math.sin(i * 0.9), RING_H));
    ringArc(-14, -26, 5, -8, 1.6);
    ringArc(-34, -44, 4, 9, 1.4);
    ringLine(-55, -61, 3, 0, 0);
    enemy('bug', onG(-30, -4, 0), 4, lateralDir(-30, 1));
    enemy('bug', onG(-46, 5, 0), 4, lateralDir(-46, 1));
    monitor(onG(-20, 10, 0), 'ring');
    // ---- 2. Vallée des tournesols
    for (const zc of [-72.5, -93.5, -114.5, -135.5]) ringArc(zc + 6, zc - 6, 5, 0, 1.8);
    [-72.5, -93.5, -114.5, -135.5].forEach((zc, i) => ringArc(zc + 4, zc - 4, 3, (i % 2 ? -6 : 6), 1.0));
    for (const [z0, z1, d] of [[-80, -87, -3.5], [-101, -108, 3.5], [-122, -129, -3.5]]) ringLine(z0, z1, 3, d, d);
    ringLine(-144.5, -153.5, 4, -0.4, -1.5);
    dash(-83, -1, 30);
    dash(-125, 1, 30);
    enemy('wasp', onG(-110, 2, 3.4), 5, lateralDir(-110, 1));
    monitor(onG(-100, 14.5, 0), 'ring');
    ringArc(-96, -104, 3, 12, 1.2);
    // ---- 3. Looping 1
    dash(-164, -1.5, 34);
    ringLine(-157, -161, 2, -1.5, -1.5);
    ringLine(-167, -173, 3, -1.5, -1.5);
    loopRings(L.loops[0], 10);
    ringLine(-189, -197, 3, 3.5, 3.5);
    // ---- 4. Falaises en damier
    const springDirA = dirAt(-204).multiplyScalar(0.38).add(UP);
    for (const d of [-4.4, -2.2, 0, 2.2, 4.4]) spring(onG(-204, d, 0), springDirA, 36, 0.45);
    {
      const sp = onG(-204, 0, 0), v = springDirA.clone().normalize().multiplyScalar(36);
      ringBallistic(sp, v, 4, 0.22, 0.85);
    }
    ringLine(-216, -232, 5, 0, 0);
    for (const q of POI.pillars) L.rings.push(q.clone().add(new V3(0, RING_H, 0)));
    enemy('bug', onG(-226, 0, 0), 3.5, lateralDir(-226, 1));
    LV.spikes.push({ pos: onG(-231, -9, 0), sx: 2.4, sz: 3 });
    {
      const c = POI.chasm, y = c.top;
      const ringsZ = [[-237.9, 2.6], [c.z1, RING_H], [-245, 1.9], [c.z2 - 1.6, RING_H], [-253, 2.6], [c.z3, RING_H + 1.2], [-260.5, 2.6]];
      for (const [z, h] of ringsZ) { const p = R(z, 0); L.rings.push(new V3(p.x, y + h, p.z)); }
      // the wasps hover above a plain jump's arc (homing reaches them; a full-speed jump passes under them); they are
      // homing stepping stones over the pit and stay calm (a shot there could only knock Kit into it)
      for (const [z, h] of [[c.z1, 5.9], [c.z2, 6.2], [c.z3, 5.9]]) { const p = R(z, 0); enemy('wasp', new V3(p.x, y + h, p.z), 1.5, lateralDir(z, 1), true); }
    }
    // checkpoint 1 sits well past the chasm wasps' firing range (22 u), so a respawn is never shot in the back
    ringLine(-267, -279, 5, 0, 0);
    checkpoint(-283.5, 0);
    // ---- 5. Grande descente
    dash(-296, 0, 32);
    dash(-327, 0, 34);
    dash(-355, 0, 36);
    // boost strip across the whole lake ramp: whoever reaches the ramp (any lane, any speed) clears the lake
    // (kick: flying low over the lip without touching the ramp still launches like the ramp would)
    for (const d of [-4.2, 0, 4.2]) {
      const zp = RAMP.z0 - 0.6, lipA = zp - RAMP.z1;
      dash(zp, d, 32, d ? 4.8 : 2.2, RAMP.z0 - RAMP.z1 + 2.5, { a0: lipA - 3.5, a1: lipA + 1.8, y: onG(RAMP.z1, d, 0).y, vy: 13 });
    }
    ringLine(-299, -322, 7, 0, 3);
    ringLine(-331, -351, 6, 3, 0);
    ringLine(-336, -348, 4, -4, -4);
    ringLine(-358, -369, 4, 0, 0);
    ringLine(-300, -318, 5, -3.5, -3.5);
    enemy('bug', onG(-306, 5, 0), 3, lateralDir(-306, 1));
    monitor(POI.ledge.clone(), 'shield');
    L.rings.push(POI.ledge.clone().add(new V3(0, RING_H + 1.2, 0)));
    ringLine(-314, -318, 2, -8.2, -8.6, RING_H + 0.6);
    {
      const lip = onG(RAMP.z1, 0, 0);
      const slope = (2 * RAMP.rise) / (RAMP.z0 - RAMP.z1), ang = Math.atan(slope), spd = 32;
      const dd = dirAt(RAMP.z1);
      const v = new V3(dd.x * Math.cos(ang) * spd, Math.sin(ang) * spd, dd.z * Math.cos(ang) * spd);
      ringBallistic(lip, v, 7, 0.1, 0.78);
      POI.ramp = { lip, v };
    }
    for (const [d, sg] of [[-6, 1], [6, -1]]) { const p = R(-380 + (d > 0 ? -2 : 2), d); enemy('fish', new V3(p.x, SEA, p.z), 6, lateralDir(-380, sg)); }
    ringLine(-393, -411, 5, 0, 0);
    ringLine(-415, -419.5, 2, 0, 0);
    ringLine(-396, -408, 3, -4, -4);
    enemy('bug', onG(-404, 4, 0), 3.5, lateralDir(-404, 1));
    LV.spikes.push({ pos: onG(-399, 8, 0), sx: 2.2, sz: 2.2 });
    // ---- 6. Pont des piranhas
    ringLine(-424, -466, 8, -1.3, -1.3);
    ringLine(-427, -463, 7, 1.3, 1.3);
    { const p = R(-436, 6.5); enemy('fish', new V3(p.x, SEA, p.z), 6, lateralDir(-436, -1)); }
    { const p = R(-456, -6.5); enemy('fish', new V3(p.x, SEA, p.z), 6, lateralDir(-456, 1)); }
    checkpoint(-480, 0);
    // ---- 7. Looping 2 + tremplins
    // invincibility on a side spot right after the bridge: it runs out on the way (Dr Boulon's arrival ends it anyway)
    monitor(onG(-488, 7.5, 0), 'star');
    dash(-496, -1.5, 34);
    ringLine(-486, -492, 3, 0, -1.5);
    ringLine(-499, -503, 2, -1.5, -1.5);
    loopRings(L.loops[1], 10);
    ringLine(-519, -523, 2, 3.5, 3.5);
    const springDirB = dirAt(-527).multiplyScalar(Math.cos(0.7)).add(new V3(0, Math.sin(0.7), 0));
    for (const d of [-4.3, -2.15, 0, 2.15, 4.3]) spring(onG(-527, d, 0), springDirB, 33, 0.5);
    {
      const sp = onG(-527, 0, 0), v = springDirB.clone().normalize().multiplyScalar(33);
      ringBallistic(sp, v, 5, 0.12, 0.88);
      for (let i = 0; i < 3; i++) {
        const t = [0.32, 0.55, 0.79][i];
        const p = R(-527 - v.length() * Math.cos(0.7) * t, 0);
        // stepping stones for a homing chain over the gap: calm (a shot there could only knock Kit into the pit)
        enemy('wasp', new V3(p.x, sp.y + 0.6 + v.y * t - 21 * t * t + 2.4, p.z), 1.2, lateralDir(-540, 1), true);
      }
    }
    ringLine(-553, -560, 3, 0, 0);
    monitor(onG(-557, -5, 0), 'shoes');
    {
      const sp = onG(-557.5, 13, 0);
      const dd = dirAt(-557.5).multiplyScalar(0.25).add(UP);
      spring(sp, dd, 28.5, 0.5); // apex clears the pillar top (7.6 u above the spring)
      monitor(POI.oneUp.clone(), 'life');
      for (let i = 0; i < 3; i++) L.rings.push(sp.clone().add(new V3(0, 2.2 + i * 1.8, 0)).addScaledVector(dirAt(-557.5), 0.6 + i * 0.9));
    }
    LV.spikes.push({ pos: onG(-566, -7.5, 0), sx: 2.2, sz: 2.6 });
    enemy('bug', onG(-578, 2, 0), 4, lateralDir(-578, 1));
    ringLine(-564, -580, 5, 0, 0);
    // ---- 8. Arène du Dr Boulon
    checkpoint(-588, 0, 13); // its gate spans the whole walkable width out to the causeway rim
    monitor(onG(-594, 3.5, 0), 'ring');
    ringLine(-591, -611, 6, -2, -2);
    ringLine(-596, -608, 4, 2, 2);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      L.rings.push(new V3(ARENA.x + Math.cos(a) * 19.5, ARENA.y + RING_H, ARENA.z + Math.sin(a) * 19.5));
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      L.rings.push(new V3(ARENA.x + Math.cos(a) * 9, ARENA.y + RING_H, ARENA.z + Math.sin(a) * 9));
    }
    const lvl = K.level || (K.level = {});
    lvl.start = { pos: start, yaw: yawAt(0) };
    lvl.checkpoints = L.checkpoints;
    lvl.rings = L.rings;
    lvl.enemies = L.enemies;
    lvl.springs = L.springs;
    lvl.dashPanels = L.dashPanels;
    lvl.monitors = L.monitors;
    lvl.spikes = L.spikes;
    lvl.loops = L.loops;
    lvl.boss = { center: new V3(ARENA.x, ARENA.y, ARENA.z), radius: ARENA.r };
    lvl.capsule = { pos: new V3(ARENA.x, ARENA.y, ARENA.z - 12) };
  }

  // ======================= decorations =======================
  function buildDecor(scene) {
    const rng = rngOf(20241017);
    const occ = new Set();
    const okey = (x, z) => Math.floor(x / 2) + ',' + Math.floor(z / 2);
    const occupied = (x, z, r) => { const c = Math.ceil(r / 2); const bx = Math.floor(x / 2), bz = Math.floor(z / 2); for (let i = -c; i <= c; i++) for (let j = -c; j <= c; j++) if (occ.has((bx + i) + ',' + (bz + j))) return true; return false; };
    const mark = (x, z, r) => { const c = Math.ceil(r / 2) - 1; const bx = Math.floor(x / 2), bz = Math.floor(z / 2); for (let i = -c; i <= c; i++) for (let j = -c; j <= c; j++) occ.add((bx + i) + ',' + (bz + j)); occ.add(okey(x, z)); };
    const keep = [];
    const lv = K.level;
    const addKeep = (p, r) => { if (p) keep.push([p.x, p.z, r]); };
    lv.rings.forEach((p) => addKeep(p, 1.4));
    lv.enemies.forEach((e) => addKeep(e.pos, 3));
    lv.springs.forEach((e) => addKeep(e.pos, 3.5));
    lv.dashPanels.forEach((e) => addKeep(e.pos, 3));
    lv.monitors.forEach((e) => addKeep(e.pos, 2.5));
    lv.spikes.forEach((e) => addKeep(e.pos, 3));
    lv.checkpoints.forEach((e) => addKeep(e.pos, 3));
    addKeep(lv.start.pos, 4);
    for (const lp of lv.loops) for (let k = -1.2; k <= 1.2; k += 0.4) keep.push([lp.entry.x + lp.dir.x * k * LOOP_R + lp.side.x * 2.5, lp.entry.z + lp.dir.z * k * LOOP_R + lp.side.z * 2.5, 6]);
    for (const s of W.solids) keep.push([(s.min.x + s.max.x) / 2, (s.min.z + s.max.z) / 2, Math.max(s.max.x - s.min.x, s.max.z - s.min.z) / 2 + 1.5]);
    for (const g of SEGW.list) keep.push([g.ax + g.ux * g.len / 2, g.az + g.uz * g.len / 2, g.len / 2 + g.ht + 1.2]);
    const kept = (x, z, r) => { for (let i = 0; i < keep.length; i++) { const k = keep[i], dx = x - k[0], dz = z - k[1], rr = k[2] + r; if (dx * dx + dz * dz < rr * rr) return true; } return false; };
    const items = { palm: [], sunflower: [], flower: [], bush: [], rock: [], totem: [] };
    const valid = (x, z, r, minNY) => {
      const h = terrainY(x, z);
      if (!(h > 1.4)) return null;
      terrainNormal(x, z, _n2);
      if (_n2.y < minNY) return null;
      for (const [dx, dz] of [[r * 0.7, 0], [-r * 0.7, 0], [0, r * 0.7], [0, -r * 0.7]]) if (terrainY(x + dx, z + dz) < 1.2) return null;
      if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.flat + 1) return null;
      if (kept(x, z, r) || occupied(x, z, r)) return null;
      return h;
    };
    const put = (type, x, z, r, minNY, extra) => {
      const h = valid(x, z, r, minNY);
      if (h == null) return false;
      const it = Object.assign({ x, y: h - 0.08, z, ry: rng() * TAU, s: 1 }, extra || {});
      items[type].push(it);
      mark(x, z, r);
      return true;
    };
    const towardRoute = (x, z) => { nearest(x, z, _nr); return Math.atan2(_nr.px - x, _nr.zr - z); };
    // totems: start line, valley mouth, checkpoints, arena gate
    const totemSpots = [[-3, -9.5], [-3, 9.5], [-54, -10.4], [-54, 10.4], [-265, -9.6], [-265, 9.6], [-484, 9.8], [-484, -9.8], [-584, -7.4], [-584, 7.4], [-150, 10], [-372.5, -12]];
    for (const [z, d] of totemSpots) {
      const p = R(z, d);
      const h = terrainY(p.x, p.z);
      if (h > 1.4 && !kept(p.x, p.z, 0.6)) { items.totem.push({ x: p.x, y: h - 0.05, z: p.z, ry: towardRoute(p.x, p.z), s: 1 }); mark(p.x, p.z, 2); }
    }
    const n = PA.n;
    for (let i = 0; i < n; i += 4) {
      const zr = PA.z[i];
      const inSec2 = zr < -56 && zr > -156, inStart = zr > -50;
      for (const sg of [-1, 1]) {
        const hw = keyInterp(HALFW, zr, sg > 0 ? 2 : 1);
        const rx = Math.cos(PA.yaw[i]) * sg, rz = -Math.sin(PA.yaw[i]) * sg;
        const at = (lat) => [PA.x[i] + rx * lat, PA.z[i] + rz * lat];
        // valley edge band
        if (rng() < (inSec2 ? 0.75 : 0.42)) {
          const lat = hw - 0.9 - rng() * 2.6, [x, z] = at(lat);
          const r = rng();
          if (inSec2 && r < 0.55) put('sunflower', x, z, 1.1, 0.8, { ry: towardRoute(x, z) + (rng() - 0.5) * 0.6, s: 0.85 + rng() * 0.35 });
          else if (r < 0.75) put('flower', x, z, 0.8, 0.75, { s: 0.9 + rng() * 0.6 });
          else if (r < 0.88) put('bush', x, z, 1.6, 0.8, { s: 0.7 + rng() * 0.5 });
          else if (inStart || rng() < 0.5) put('palm', x, z, 2.2, 0.85, { ry: Math.atan2(-rx, -rz) + Math.PI + (rng() - 0.5) * 0.8, s: 0.85 + rng() * 0.3 });
          else put('rock', x, z, 1.2, 0.7, { s: 0.5 + rng() * 0.5, rx: (rng() - 0.5) * 0.4, rz: (rng() - 0.5) * 0.4 });
        }
        // cliff-top band (palms line the valley)
        if (rng() < 0.5) {
          const lat = hw + 4.6 + rng() * 4.5, [x, z] = at(lat);
          const r = rng();
          if (r < 0.5) put('palm', x, z, 2.4, 0.8, { ry: Math.atan2(rx, rz) - Math.PI / 2 + Math.PI + (rng() - 0.5) * 1.2, s: 0.85 + rng() * 0.35 });
          else if (r < 0.75) put('bush', x, z, 1.8, 0.75, { s: 0.8 + rng() * 0.6 });
          else if (r < 0.9) put('flower', x, z, 0.8, 0.7, { s: 1 + rng() * 0.5 });
          else if (inSec2) put('sunflower', x, z, 1.1, 0.8, { ry: towardRoute(x, z), s: 1 });
          else put('rock', x, z, 1.4, 0.7, { s: 0.7 + rng() * 0.7, rx: (rng() - 0.5) * 0.4, rz: (rng() - 0.5) * 0.4 });
        }
        // far hills
        if (rng() < 0.55) {
          const lat = hw + 10 + rng() * 44, [x, z] = at(lat);
          const r = rng();
          if (r < 0.38) put('palm', x, z, 2.6, 0.78, { ry: rng() * TAU, s: 0.9 + rng() * 0.45, far: true });
          else if (r < 0.62) put('bush', x, z, 2, 0.72, { s: 0.9 + rng() * 0.8, far: true });
          else if (r < 0.8) put('rock', x, z, 1.6, 0.6, { s: 0.8 + rng() * 1.2, rx: (rng() - 0.5) * 0.5, rz: (rng() - 0.5) * 0.5, far: true });
          else put('flower', x, z, 0.9, 0.7, { s: 1 + rng() * 0.6, far: true });
        }
      }
    }
    // the open start plateau
    for (let k = 0; k < 70; k++) {
      const z = 26 - rng() * 76, d = (rng() - 0.5) * 34;
      if (Math.abs(d) < 7) continue;
      const p = R(z, d), r = rng();
      if (r < 0.3) put('palm', p.x, p.z, 2.4, 0.85, { s: 0.9 + rng() * 0.3 });
      else if (r < 0.75) put('flower', p.x, p.z, 0.8, 0.8, { s: 0.9 + rng() * 0.6 });
      else put('bush', p.x, p.z, 1.6, 0.8, { s: 0.7 + rng() * 0.5 });
    }
    // arena surroundings: a few palms on the causeway sides
    for (const [z, d] of [[-598, -6.3], [-603, 6.3], [-590, 6.2]]) { const p = R(z, d); put('palm', p.x, p.z, 1.6, 0.8, { s: 0.8 }); }
    // ---- dressing: half-buried stones along the foot of the valley walls, boulders on the shore, more flower tufts
    for (let i = 0; i < n; i += 6) {
      const zr = PA.z[i];
      for (const sg of [-1, 1]) {
        const hw = keyInterp(HALFW, zr, sg > 0 ? 2 : 1);
        const rx = Math.cos(PA.yaw[i]) * sg, rz = -Math.sin(PA.yaw[i]) * sg;
        const at = (lat) => [PA.x[i] + rx * lat, PA.z[i] + rz * lat];
        if (rng() < 0.45) {
          const [x, z] = at(hw - 0.4 + rng() * 0.6);
          put('rock', x, z, 0.6, 0.5, { s: 0.22 + rng() * 0.25, y0: -0.12, rx: (rng() - 0.5) * 0.6, rz: (rng() - 0.5) * 0.6, tier: 1 });
        }
        if (rng() < 0.5) {
          const [x, z] = at(hw + 12 + rng() * 30);
          put('flower', x, z, 0.8, 0.7, { s: 1 + rng() * 0.5, tier: 1 });
        }
        // shore: walk out from the hill until the ground meets the sea
        if (i % 12 === 0 && rng() < 0.7) {
          for (let lat = hw + 8; lat < hw + 90; lat += 1.5) {
            const [x, z] = at(lat), h = terrainY(x, z);
            if (h < 0.5) {
              const k = 1 + Math.floor(rng() * 3);
              for (let j = 0; j < k; j++) {
                const xx = x + (rng() - 0.5) * 5, zz = z + (rng() - 0.5) * 5, hh = terrainY(xx, zz);
                if (hh > -1.6 && hh < 1.2 && !kept(xx, zz, 1.5) && Math.hypot(xx - ARENA.x, zz - ARENA.z) > ARENA.flat + 2) {
                  items.rock.push({ x: xx, y: hh - 0.25, z: zz, ry: rng() * TAU, s: 0.7 + rng() * 1.3, rx: (rng() - 0.5) * 0.5, rz: (rng() - 0.5) * 0.5, tier: 1 });
                }
              }
              break;
            }
          }
        }
      }
    }
    if (S.touch) for (const k in items) { let nf = 0, nl = 0; items[k] = items[k].filter(it => (it.far ? nf++ % 4 === 0 : true) && (k === 'flower' ? nl++ % 2 === 0 : true)); }
    // tiers: Moyen / Économie draw tier 0 only (geometry draw range), Ultra / Élevé everything
    { let nf = 0, nl = 0; for (const k in items) for (const it of items[k]) if (it.tier == null) it.tier = (it.far && nf++ % 4 !== 0) || (k === 'flower' && nl++ % 2) ? 1 : 0; }
    // ---- bake: per zone, one solid and one foliage mesh (templates in a few variants)
    const split = t => {
      const s = new DB(), f = new DB(), ms = new Int32Array(t.n).fill(-1), mf = new Int32Array(t.n).fill(-1);
      const cp = (d, map, v) => {
        if (map[v] < 0) map[v] = d.v(t.P[v * 3], t.P[v * 3 + 1], t.P[v * 3 + 2], t.N[v * 3], t.N[v * 3 + 1], t.N[v * 3 + 2], { r: t.C[v * 3], g: t.C[v * 3 + 1], b: t.C[v * 3 + 2] },
          t.U[v * 2], t.U[v * 2 + 1], t.K[v * 4], t.K[v * 4 + 1], t.K[v * 4 + 2], t.K[v * 4 + 3]);
        return map[v];
      };
      for (let i = 0; i < t.I.length; i += 3) {
        const fol = t.K[t.I[i] * 4] >= 10, d = fol ? f : s, map = fol ? mf : ms;
        d.tri(cp(d, map, t.I[i]), cp(d, map, t.I[i + 1]), cp(d, map, t.I[i + 2]));
      }
      return { s, f };
    };
    // [near, far] versions of each template (far: fewer fronds / blobs / facets; a zone swaps at DECOR_LOD metres)
    const both = (fn, ...a) => [split(fn(...a, false)), split(fn(...a, true))];
    const sun = split(tplSunflower()), tot = split(tplTotem());
    const TPL = {
      palm: [0, 1, 2, 3].map(v => both(tplPalm, 101 + v * 17)), sunflower: [[sun, sun]],
      flower: [0, 1, 2, 3].map(v => { const f = split(tplFlowers(301 + v * 13)); return [f, f]; }), bush: [0, 1, 2].map(v => both(tplBush, 401 + v * 7)),
      rock: [0, 1, 2, 3].map(v => both(tplRock, 501 + v * 11)), totem: [[tot, tot]]
    };
    const zones = new Map();
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pv = new V3(), sv = new V3();
    const tierOrder = [0, 1];
    const zoneOf = key => {
      let zn = zones.get(key);
      if (!zn) { zn = { L: [{ s: new DB(), f: new DB(), s0: 0, f0: 0 }, { s: new DB(), f: new DB(), s0: 0, f0: 0 }], x0: 1e9, x1: -1e9 }; zones.set(key, zn); }
      return zn;
    };
    for (const tier of tierOrder) {
      for (const type in items) for (const it of items[type]) {
        if ((it.tier || 0) !== tier) continue;
        const vars = TPL[type], vi = Math.floor(ihash(Math.round(it.x * 10), Math.round(it.z * 10), 77) * vars.length) % vars.length, tp = vars[vi];
        e.set(it.rx || 0, it.ry || 0, it.rz || 0, 'YXZ'); q.setFromEuler(e);
        const s = it.s || 1;
        mt.compose(pv.set(it.x, it.y + (it.y0 || 0) * s, it.z), q, sv.set(s, s, s));
        const ph = ihash(Math.round(it.x * 7), Math.round(it.z * 7), 91) * 40;
        const tint = type === 'totem' ? null : tintOf('#ffffff', rngOf(Math.round(it.x * 13 + it.z * 7)), type === 'flower' ? 0 : 0.16);
        const zn = zoneOf(Math.floor(it.z / ZONE));
        zn.x0 = Math.min(zn.x0, it.x); zn.x1 = Math.max(zn.x1, it.x);
        for (let l = 0; l < 2; l++) { const L = zn.L[l], tl = tp[l]; L.s.put(tl.s, mt, s, ph, tint); L.f.put(tl.f, mt, s, ph, tint); }
      }
      if (tier === 0) for (const zn of zones.values()) for (const L of zn.L) { L.s0 = L.s.I.length; L.f0 = L.f.I.length; }
    }
    const mats = decorMaterials();
    S.decor = []; S.decorZones = [];
    for (const [key, zn] of zones) {
      const z = { z0: key * ZONE, z1: (key + 1) * ZONE, x0: zn.x0 - 4, x1: zn.x1 + 4, lod: 0, meshes: [[], []] };
      for (let l = 0; l < 2; l++) {
        const L = zn.L[l];
        for (const [db, mat, n0, nm] of [[L.s, mats.solid, L.s0, 'w-decor'], [L.f, mats.foliage, L.f0, 'w-foliage']]) {
          if (!db.n) continue;
          const mesh = new THREE.Mesh(db.build(), mat);
          mesh.name = nm;
          mesh.castShadow = true; mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          mesh.userData.tier0 = n0;
          mesh.visible = l === 0;
          scene.add(mesh);
          S.decor.push(mesh);
          z.meshes[l].push(mesh);
        }
      }
      S.decorZones.push(z);
    }
    applyDecorTier();
    S.decorCounts = { palm: items.palm.length, sunflower: items.sunflower.length, flower: items.flower.length, bush: items.bush.length, rock: items.rock.length, totem: items.totem.length };
  }
  // Moyen / Économie draw the tier-0 decor only (the rest of each zone's index buffer is cut off by the draw range)
  function applyDecorTier() {
    if (!S.decor) return;
    const pre = (K.gfx && K.gfx.preset) || 'high', full = pre === 'ultra' || pre === 'high';
    for (const m of S.decor) m.geometry.setDrawRange(0, full ? Infinity : m.userData.tier0);
    S.decorLodDist = pre === 'ultra' ? 170 : full ? 130 : 95;
    for (const z of S.decorZones) z.lod = -1;
    updateDecorLod();
  }
  // decor zones beyond S.decorLodDist (from the camera, to the zone's box) draw their lighter version
  function updateDecorLod() {
    const cam = K.view && K.view.camera;
    if (!cam || !S.decorZones || !S.shown) return;
    const cx = cam.position.x, cz = cam.position.z, D = S.decorLodDist || 130;
    for (const z of S.decorZones) {
      const dx = cx < z.x0 ? z.x0 - cx : cx > z.x1 ? cx - z.x1 : 0, dz = cz < z.z0 ? z.z0 - cz : cz > z.z1 ? cz - z.z1 : 0;
      const d = Math.sqrt(dx * dx + dz * dz), lod = d > D + (z.lod === 1 ? -6 : 6) ? 1 : 0;
      if (lod === z.lod) continue;
      z.lod = lod;
      for (let l = 0; l < 2; l++) for (const m of z.meshes[l]) {
        const on = l === lod && m.geometry.drawRange.count !== 0;
        m.visible = on;
      }
    }
  }
  // Decor materials (every zone shares them). Wind: positionNode (the shadow pass uses it too), gusts travelling over
  // the island + leaf flutter. Solid: bark / rock / painted wood / bush leaves picked by aK.x, with their normal and ORM
  // maps. Foliage: palm fronds (alpha-cut texture), petals and leaves (vertex colour), double-sided, with sun
  // translucency (MeshSSSNodeMaterial: light through the leaves, shadowed like the direct light).
  function decorWind() {
    const K4 = attribute('aK', 'vec4'), pg = positionGeometry;
    const wv = TIME.mul(1.2).add(pg.x.mul(0.045)).add(pg.z.mul(0.035));
    const gust = tsin(wv.add(K4.z.mul(0.12))).mul(0.5).add(tsin(wv.mul(0.37).add(1.3)).mul(0.45)).add(0.3);
    const bend = K4.y.mul(gust);
    const fl = K4.w.mul(tsin(TIME.mul(5.7).add(K4.z).add(pg.x.mul(0.9)).add(pg.z.mul(0.7))));
    return positionLocal.add(vec3(bend.mul(0.8).add(fl.mul(0.3)), fl.mul(0.7).sub(bend.abs().mul(0.15)), bend.mul(0.6).add(fl.mul(0.3))));
  }
  const isKind = (kind, k) => float(1).sub(tstep(0.5, tabs(kind.sub(k))));
  let DMATS = null;
  function decorMaterials() {
    if (DMATS) return DMATS;
    DMATS = makeDecorMaterials();
    return DMATS;
  }
  function makeDecorMaterials() {
    const K4 = attribute('aK', 'vec4'), kind = K4.x, vc = attribute('color', 'vec3'), uvn = tuv();
    const sol = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
    {
      const isB = isKind(kind, DK.BARK), isR = isKind(kind, DK.ROCK), isW = isKind(kind, DK.WOOD), isL = isKind(kind, DK.LEAVES), isRW = isKind(kind, DK.RAWWOOD);
      const isP = float(1).sub(isB).sub(isR).sub(isW).sub(isL).sub(isRW);
      const bA = ttexture(wtex('bark_albedo'), uvn), bN = ttexture(wtex('bark_normal'), uvn), bO = ttexture(wtex('bark_orm'), uvn);
      const rA = ttexture(wtex('rock_albedo'), uvn), rN = ttexture(wtex('rock_normal'), uvn), rO = ttexture(wtex('rock_orm'), uvn);
      const wA = ttexture(wtex('wood_albedo'), uvn), wN = ttexture(wtex('wood_normal'), uvn), wO = ttexture(wtex('wood_orm'), uvn);
      const lA = ttexture(wtex('leaves_albedo'), uvn), lN = ttexture(wtex('leaves_normal'), uvn);
      const alb = bA.rgb.mul(meanInv('bark')).mul(isB).add(rA.rgb.mul(meanInv('rock')).mul(isR))
        .add(mix(vec3(1), wA.rgb.mul(meanInv('wood')), 0.28).mul(isW)).add(lA.rgb.mul(meanInv('leaves')).mul(isL)).add(vec3(1).mul(isP))
        .add(mix(vec3(1), wA.rgb.mul(meanInv('wood')), 0.7).mul(isRW));
      sol.colorNode = vc.mul(alb);
      const flatN = vec3(0.5, 0.5, 1);
      const nT = bN.xyz.mul(isB).add(rN.xyz.mul(isR)).add(mix(flatN, wN.xyz, 0.5).mul(isW)).add(lN.xyz.mul(isL)).add(flatN.mul(isP)).add(wN.xyz.mul(isRW));
      sol.normalNode = TSL.normalMap(nT);
      sol.roughnessNode = bO.g.mul(isB).add(rO.g.mul(isR)).add(float(0.48).mul(isW)).add(float(0.7).mul(isL)).add(float(0.62).mul(isP)).add(wO.g.mul(isRW));
      sol.aoNode = bO.r.mul(isB).add(rO.r.mul(isR)).add(isW).add(isL).add(isP).add(wO.r.mul(isRW));
      sol.positionNode = decorWind();
    }
    const fol = new THREE.MeshSSSNodeMaterial({ side: THREE.DoubleSide, roughness: 0.62, metalness: 0 });
    {
      const isF = isKind(kind, DK.FROND);
      const fA = ttexture(wtex('frond_albedo', { wrap: 'clamp' }), uvn), fN = ttexture(wtex('frond_normal', { wrap: 'clamp' }), uvn);
      const alb = vc.mul(mix(vec3(1), fA.rgb, isF));
      fol.colorNode = alb;
      fol.maskNode = fA.a.greaterThan(0.42).or(isF.lessThan(0.5));
      fol.normalNode = TSL.normalMap(mix(vec3(0.5, 0.5, 1), fN.xyz, isF));
      fol.thicknessColorNode = alb.mul(0.85);
      fol.thicknessDistortionNode = float(0.2);
      fol.thicknessAmbientNode = float(0.0);
      fol.thicknessAttenuationNode = float(0.9);
      fol.thicknessPowerNode = float(3.0);
      fol.thicknessScaleNode = mix(float(0.9), float(3.0), isF); // petals / leaves: less light through (they bleach)
      fol.positionNode = decorWind();
    }
    return { solid: sol, foliage: fol };
  }


  // ======================= grass blades =======================
  // A blade field around the camera, two draws: near (3 m tiles, 7 x 7, dense) and far (6 m tiles, 9 x 9, sparse; both
  // fade out with distance). One 5-vertex blade, instanced; the vertex shader places every blade: the grids follow the
  // camera by whole tiles and the blade layout is the same in every tile (shifted by a hash of the world tile), so
  // snapping never moves a blade. Each blade stands on the heightfield (half-float map: height, density, mown, cavity:
  // no blades on paths, sand, slopes, pads and platforms; short on the mown lawn) and bends with gusts (cloud noise
  // scrolling over the island) and away from Kit. Density: K.gfx.grass (instance count; the instances are blade-major,
  // so any prefix spreads over every tile).
  const GR = { tex: null, meshes: [], kit: uniform(new V3(0, -100, 0)) };
  const GRASS_RINGS = [{ tile: 3, n: 7, blades: 1500, fade: 10.5 }, { tile: 6, n: 9, blades: 520, fade: 26 }];
  function grassField() {
    const NX = T.NX, NZ = T.NZ, H = T.H, MT = T.MT, dens = new Float32Array(NX * NZ);
    for (let iz = 1; iz < NZ - 1; iz++) for (let ix = 1; ix < NX - 1; ix++) {
      const i = iz * NX + ix, h = H[i];
      if (h < 0.9) continue;
      const gx = (H[i + 1] - H[i - 1]) / (2 * CELL), gz = (H[i + NX] - H[i - NX]) / (2 * CELL), ny = 1 / Math.sqrt(gx * gx + gz * gz + 1);
      dens[i] = sstep(0.84, 0.93, ny) * (1 - sstep(0.22, 0.5, MT[i * 4])) * (1 - sstep(0.12, 0.42, MT[i * 4 + 1])) * sstep(0.9, 1.6, h);
    }
    // keep pads, panels, posts, platforms and walls clear
    const stamp = (x, z, r) => {
      const R = r + 0.8, i0 = Math.max(0, Math.floor((x - R - T.XMIN) / CELL)), i1 = Math.min(NX - 1, Math.ceil((x + R - T.XMIN) / CELL));
      const j0 = Math.max(0, Math.floor((z - R - T.ZMIN) / CELL)), j1 = Math.min(NZ - 1, Math.ceil((z + R - T.ZMIN) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(T.XMIN + i * CELL - x, T.ZMIN + j * CELL - z);
        dens[j * NX + i] *= sstep(r, R, d);
      }
    };
    const lv = K.level;
    for (const e of lv.springs) stamp(e.pos.x, e.pos.z, 1.4);
    for (const e of lv.dashPanels) stamp(e.pos.x, e.pos.z, 2.2);
    for (const e of lv.monitors) stamp(e.pos.x, e.pos.z, 1.0);
    for (const e of lv.checkpoints) stamp(e.pos.x, e.pos.z, 1.2);
    for (const e of lv.spikes) stamp(e.pos.x, e.pos.z, 1.8);
    stamp(lv.start.pos.x, lv.start.pos.z, 1.2);
    // solids (pillars, platforms, the bridge deck, the arena rim): their footprint + a margin
    for (const s of W.solids) {
      const m = 0.35, i0 = Math.max(0, Math.floor((s.min.x - m - T.XMIN) / CELL)), i1 = Math.min(NX - 1, Math.ceil((s.max.x + m - T.XMIN) / CELL));
      const j0 = Math.max(0, Math.floor((s.min.z - m - T.ZMIN) / CELL)), j1 = Math.min(NZ - 1, Math.ceil((s.max.z + m - T.ZMIN) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) dens[j * NX + i] = 0;
    }
    for (const g of SEGW.list) for (let t = 0; t <= g.len; t += 1) stamp(g.ax + g.ux * t, g.az + g.uz * t, g.ht + 0.3);
    // erode by one cell: the field is sampled bilinearly, so a blade near a cliff edge or a bank would otherwise stand
    // on the interpolated height, half way up the wall
    const er = Float32Array.from(dens);
    for (let iz = 1; iz < NZ - 1; iz++) for (let ix = 1; ix < NX - 1; ix++) {
      const i = iz * NX + ix;
      let m = dens[i];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) m = Math.min(m, dens[i + dz * NX + dx]);
      er[i] = m;
    }
    dens.set(er);
    const toH = THREE.DataUtils.toHalfFloat, data = new Uint16Array(NX * NZ * 4);
    for (let i = 0; i < NX * NZ; i++) {
      data[i * 4] = toH(H[i]); data[i * 4 + 1] = toH(dens[i]); data[i * 4 + 2] = toH(clamp(T.RM[i], 0, 1)); data[i * 4 + 3] = toH(T.AO[i]);
    }
    const tex = new THREE.DataTexture(data, NX, NZ, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
    GR.tex = tex;
  }
  function grassMaterial(ring, origin) {
    const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.78, metalness: 0 });
    const B = attribute('aB', 'vec4'), pg = positionGeometry, ts = ring.tile;
    const tid = B.w, ti = tfloor(tid.mod(ring.n).add(0.5)), tj = tfloor(tid.div(ring.n).add(0.001));
    const tileW = origin.add(vec2(ti, tj).mul(ts));
    const wt = tfloor(tileW.div(ts).add(0.5));
    const lp = tfract(B.xy.add(vec2(TL.hash21(wt), TL.hash21(wt.add(17.3)))));
    const root = tileW.add(lp.mul(ts));
    const huv = root.sub(vec2(T.XMIN, T.ZMIN)).div(CELL).add(0.5).div(vec2(T.NX, T.NZ));
    const hf = ttexture(GR.tex, huv).level(0);
    const r1 = B.z, r2 = tfract(B.z.mul(91.7).add(B.x.mul(13.1))), r3 = tfract(B.z.mul(47.3).add(B.y.mul(29.7)));
    const dCam = tlength(root.sub(cameraPosition.xz));
    const fade = smoothstep(ring.fade, ring.fade * 0.6, dCam);
    // density: a blade exists where its random number is under the local density
    // (the mown lane in the valley keeps 30 % of the blades, shorter: the lawn texture and its stripes read through)
    const here = tstep(r1, hf.y.mul(fade).mul(mix(float(1), float(0.3), hf.z)));
    const hgt = mix(float(0.4), float(0.16), hf.z).mul(float(0.6).add(r2.mul(0.75))).mul(here).mul(smoothstep(0, 0.35, fade))
      .mul(smoothstep(0.8, 2.6, dCam));
    const wid = float(0.022).add(r3.mul(0.022)).mul(here).mul(float(1).add(smoothstep(4, 20, dCam).mul(1.2)));
    const ang = r2.mul(43.9);
    const across = vec2(tcos(ang), tsin(ang));
    // wind: gust patches drifting over the island + a flutter; Kit parts the grass
    const g = ttexture(wtex('sky_noise'), root.mul(0.021).add(vec2(TIME.mul(0.045), TIME.mul(0.028)))).level(0).r;
    const windAmt = g.sub(0.38).mul(1.6).add(tsin(TIME.mul(2.3).add(r3.mul(6.28)).add(root.x.mul(0.35))).mul(0.1));
    const lean = vec2(tcos(ang.mul(1.7)), tsin(ang.mul(1.7))).mul(r3.mul(0.5).add(0.1));
    const dk = root.sub(GR.kit.xz), dkl = tlength(dk).add(1e-3);
    const push = dk.div(dkl).mul(smoothstep(1.3, 0.25, dkl)).mul(smoothstep(1.8, 0.4, tabs(GR.kit.y.sub(hf.x)))).mul(1.1);
    const bend = vec2(0.8, 0.6).mul(windAmt.mul(0.55)).add(lean).add(push);
    const y = pg.y, taper = float(1).sub(y.mul(0.82));
    const bl = tlength(bend);
    const p = vec3(root.x.add(across.x.mul(pg.x).mul(wid).mul(taper)).add(bend.x.mul(hgt).mul(y).mul(y)),
      hf.x.add(y.mul(hgt).mul(float(1).sub(bl.mul(bl).mul(0.22).mul(y)))).sub(0.02),
      root.y.add(across.y.mul(pg.x).mul(wid).mul(taper)).add(bend.y.mul(hgt).mul(y).mul(y)));
    m.positionNode = p;
    // lit like the lawn below (mostly upward normal, tilted with the bend); colour from the lawn texel under the root
    const nW = tnormalize(vec3(bend.x.mul(-0.6).add(across.y.mul(0.25)), 1, bend.y.mul(-0.6).sub(across.x.mul(0.25))));
    m.normalNode = tnormalize(cameraViewMatrix.mul(vec4(TSL.varying(nW), 0)).xyz);
    const rootV = TSL.varying(root), yV = TSL.varying(y), aoV = TSL.varying(hf.w), tintV = TSL.varying(grassTint(root));
    const alb = ttexture(wtex('grass_albedo'), rootV.div(2.6)).rgb.mul(meanInv('grass'));
    const hueV = TSL.varying(vec3(float(0.95).add(r2.mul(0.1)), float(0.97).add(r3.mul(0.06)), float(0.9).add(r1.mul(0.14))));
    m.colorNode = tintV.mul(alb).mul(hueV).mul(mix(float(0.62), float(1.0), tpow(yV, 0.7))).mul(mix(vec3(1), vec3(1.05, 1.03, 0.84), yV.mul(yV)))
      .mul(mix(float(1), aoV, 0.6));
    m.roughnessNode = float(0.86);
    return m;
  }
  function buildGrass(scene) {
    grassField();
    const blade = new THREE.InstancedBufferGeometry();
    blade.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.38, 0.5, 0, 0.38, 0.5, 0, 0, 1, 0], 3));
    blade.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    blade.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
    GRASS_RINGS.forEach((ring, k) => {
      const r = rngOf(9001 + k * 77), nT = ring.n * ring.n, N = nT * ring.blades, a = new Float32Array(N * 4);
      for (let b = 0; b < ring.blades; b++) {
        const u = r(), v = r(), z = r();
        for (let t = 0; t < nT; t++) { const i = (b * nT + t) * 4; a[i] = u; a[i + 1] = v; a[i + 2] = z; a[i + 3] = t; }
      }
      const g = new THREE.InstancedBufferGeometry();
      g.index = blade.index;
      g.setAttribute('position', blade.attributes.position);
      g.setAttribute('normal', blade.attributes.normal);
      g.setAttribute('aB', new THREE.InstancedBufferAttribute(a, 4));
      g.instanceCount = N;
      g.boundingSphere = new THREE.Sphere(new V3(), 1e5);
      const origin = uniform(new THREE.Vector2());
      const mesh = new THREE.Mesh(g, grassMaterial(ring, origin));
      mesh.name = 'w-grass';
      mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
      mesh.castShadow = false; mesh.receiveShadow = true;
      mesh.userData.noEnv = true;
      mesh.renderOrder = 1;
      scene.add(mesh);
      GR.meshes.push({ mesh, ring, origin, N });
    });
    applyGrass();
  }
  function applyGrass() {
    const k = K.gfx && Number.isFinite(K.gfx.grass) ? K.gfx.grass : (S.touch ? 0.4 : 0.7);
    const pre = (K.gfx && K.gfx.preset) || '';
    for (const G of GR.meshes) {
      const kk = G.ring.tile > 3 && pre !== 'ultra' && pre !== 'high' ? k * 0.4 : k;
      const n = Math.round(G.N * clamp(kk, 0, 1));
      G.mesh.geometry.instanceCount = n;
      const on = n > 0;
      if (S.shown) G.mesh.visible = on; else G.mesh.userData.kitWasVisible = on;
    }
  }
  function updateGrass() {
    const cam = K.view && K.view.camera;
    if (!cam || !GR.meshes.length) return;
    for (const G of GR.meshes) {
      const ts = G.ring.tile, h = (G.ring.n * ts) / 2;
      G.origin.value.set(Math.floor((cam.position.x - h) / ts) * ts, Math.floor((cam.position.z - h) / ts) * ts);
    }
    const P = K.player;
    if (P && P.pos) GR.kit.value.copy(P.pos); else GR.kit.value.set(0, -100, 0);
  }

  // ======================= waterfalls =======================
  // falling water (TSL): streaks of foam and spray scrolling down (two layers of the water fx texture stretched along
  // the fall), clear blue-green between them, a bright lip at the top, soft side edges, a foam skirt at the foot
  function waterfallMaterial() {
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
    const tFX = wtex('water_fx'), u = tuv(), t = TIME;
    const s1 = ttexture(tFX, vec2(u.x.mul(0.55), u.y.mul(0.16).sub(t.mul(0.32)))).b;
    const s2 = ttexture(tFX, vec2(u.x.mul(1.1).add(0.37), u.y.mul(0.3).sub(t.mul(0.55)))).r;
    const s3 = ttexture(tFX, vec2(u.x.mul(2.3).add(0.71), u.y.mul(0.55).sub(t.mul(0.8)))).b;
    const streak = smoothstep(0.42, 0.82, s1.mul(0.6).add(s2.mul(0.45)).add(s3.mul(0.25)));
    const edge = smoothstep(0.0, 0.16, u.x).mul(smoothstep(1.0, 0.84, u.x));
    const top = smoothstep(0.25, 0.0, u.y);
    const hdr = SKY_UNI.uHDR;
    const water = mix(lin('#7cc4e8'), lin('#bfe8ff'), s1);
    const col = mix(water, vec3(1.0, 1.0, 1.0).mul(hdr.mul(0.35).add(1)), tclamp(streak.mul(0.85).add(top.mul(0.4)), 0, 1));
    mat.colorNode = col;
    mat.opacityNode = edge.mul(float(0.5).add(streak.mul(0.45)).add(top.mul(0.2))).mul(0.95);
    return mat;
  }
  function buildWaterfalls(scene) {
    const mat = waterfallMaterial();
    const gb = new GB();
    const mistPts = [];
    const lakeR = R(LAKE.z, 0);
    const spots = [
      [lakeR.x + lakeR.rx * -17, LAKE.z, -lakeR.rx, -lakeR.rz, 5],
      [lakeR.x + lakeR.rx * 17, LAKE.z - 1.5, lakeR.rx, lakeR.rz, 4.5],
      [R(-466, -14).x, -466, 0, -1, 4.5], [R(-466, 15).x, -466, 0, -1, 5.5],
      [R(-258, -15).x, -258, 0, -1, 4.5], [R(-546, 11).x, -546, 0, -1, 4]
    ];
    const P = [], N = [], I = [], UV = [];
    for (const [x0, z0, dx, dz, width] of spots) {
      let t = 0, foot = -1;
      for (; t < 30; t += 0.25) if (terrainY(x0 + dx * t, z0 + dz * t) > 0.4) { foot = t; break; }
      if (foot < 0) continue;
      let topT = foot, topH = terrainY(x0 + dx * foot, z0 + dz * foot);
      for (let k = foot; k < foot + 14; k += 0.25) { const h = terrainY(x0 + dx * k, z0 + dz * k); if (h > topH + 0.05) { topH = h; topT = k; } else if (h < topH - 0.5) break; }
      if (topH < 4) continue;
      const px = -dz, pz = dx;
      const rows = 14, base = P.length / 3;
      const prof = [];
      for (let j = 0; j <= rows; j++) {
        const y = lerp(topH + 0.15, -0.3, j / rows);
        let lo = 0, hi = topT + 0.5;
        for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2; if (terrainY(x0 + dx * m, z0 + dz * m) > y) hi = m; else lo = m; }
        prof.push([lo - 0.7 - (j === 0 ? 0 : 0.25 * Math.sin((j / rows) * Math.PI)), y]);
      }
      prof.unshift([topT + 1.4, topH + 0.12]);
      let vacc = 0;
      for (let j = 0; j < prof.length; j++) {
        const [tt, y] = prof[j];
        if (j > 0) vacc += Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]);
        for (const sg of [-1, 1]) {
          const w = width * (j === 0 ? 0.8 : 1) / 2;
          P.push(x0 + dx * tt + px * sg * w, y, z0 + dz * tt + pz * sg * w);
          N.push(-dx, 0, -dz);
          UV.push(sg < 0 ? 0 : 1, vacc / 9);
        }
        if (j < prof.length - 1) { const a = base + j * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      const bx = x0 + dx * (prof[prof.length - 1][0] - 0.8), bz = z0 + dz * (prof[prof.length - 1][0] - 0.8);
      for (let k = 0; k < 7; k++) mistPts.push({ x: bx + px * (k - 3) * width / 6, z: bz + pz * (k - 3) * width / 6, ph: k * 1.7 });
    }
    if (P.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
      g.setIndex(I);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.name = 'w-waterfalls';
      m.renderOrder = 2;
      scene.add(m);
    }
    if (mistPts.length) {
      // spray at the foot of each fall: instanced soft sprites (one per puff), bobbing and drifting (updateMist)
      const pos = new Float32Array(mistPts.length * 3);
      const attr = new THREE.InstancedBufferAttribute(pos, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      const pm = new THREE.SpriteNodeMaterial({ map: glowTexture(64, [[0, 'rgba(255,255,255,0.9)'], [0.5, 'rgba(240,250,255,0.35)'], [1, 'rgba(240,250,255,0)']]), transparent: true, depthWrite: false, color: 0xffffff });
      pm.positionNode = TSL.instancedBufferAttribute(attr);
      pm.scaleNode = float(2.5);
      const pts = new THREE.Sprite(pm);
      pts.count = mistPts.length;
      pts.frustumCulled = false; pts.renderOrder = 3;
      scene.add(pts);
      S.mist = pts; S.mistAttr = attr; S.mistData = mistPts;
      updateMist();
    }
  }
  function updateMist() {
    if (!S.mist) return;
    const a = S.mistAttr, t = S.time;
    S.mistData.forEach((m, i) => { a.setXYZ(i, m.x + Math.sin(t * 0.9 + m.ph) * 0.4, 0.5 + Math.abs(Math.sin(t * 1.3 + m.ph)) * 1.2, m.z + Math.cos(t * 0.7 + m.ph) * 0.4); });
    a.needsUpdate = true;
  }

  // ======================= sky dressing: birds, far islands =======================
  function buildBirds(scene) {
    const geo = birdGeo();
    const mat = birdMaterial();
    const flocks = [[-10, 46, -40, 22], [25, 52, -250, 28], [-20, 40, -420, 20], [15, 50, -600, 30]];
    for (let f = 0; f < flocks.length; f++) for (let k = 0; k < 4; k++) {
      S.birdData.push({ cx: R(flocks[f][2], 0).x + flocks[f][0], cy: flocks[f][1] + k * 1.3, cz: flocks[f][2], r: flocks[f][3] + k * 2.2, w: (0.28 + 0.05 * f) * (f % 2 ? -1 : 1), ph: k * 0.32 + f });
    }
    const mesh = new THREE.InstancedMesh(geo, mat, S.birdData.length);
    mesh.name = 'w-birds';
    mesh.frustumCulled = false;
    scene.add(mesh);
    S.birds = mesh;
    updateBirds();
  }
  function updateBirds() {
    const m = S.birds; if (!m) return;
    for (let i = 0; i < S.birdData.length; i++) {
      const b = S.birdData[i];
      const a = b.ph + S.time * b.w;
      const x = b.cx + Math.cos(a) * b.r, z = b.cz + Math.sin(a) * b.r, y = b.cy + Math.sin(S.time * 0.8 + b.ph * 3) * 1.2;
      const tx = -Math.sin(a) * Math.sign(b.w), tz = Math.cos(a) * Math.sign(b.w);
      _tmpE.set(0, Math.atan2(tx, tz), (b.w > 0 ? 1 : -1) * 0.25); _tmpQ.setFromEuler(_tmpE); _tmpS.set(1.3, 1.3, 1.3); _tmpP.set(x, y, z);
      _tmpM.compose(_tmpP, _tmpQ, _tmpS); m.setMatrixAt(i, _tmpM);
    }
    m.instanceMatrix.needsUpdate = true;
  }
  function buildFarIslands(scene) {
    const gb = new GB();
    const hor = lin(FOG_HEX), topA = lin('#86b4d8'), topB = lin('#9fc4e2'), snow = lin('#eef6ff');
    const spots = [[-0.6, 600, 95, 130, 0], [-0.25, 680, 60, 90, 1], [0.35, 640, 120, 150, 0], [1.1, 620, 70, 80, 1], [1.7, 700, 140, 170, 0], [2.5, 610, 80, 100, 1], [3.1, 660, 110, 130, 0], [3.8, 630, 70, 85, 1], [4.6, 690, 125, 160, 0], [5.4, 620, 65, 95, 1]];
    for (const [a, dist, h, rad, kind] of spots) {
      const g = new THREE.ConeGeometry(rad, h, 18, 5, true);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const t = (y + h / 2) / h;
        const ang = Math.atan2(z, x);
        const wob = 1 + 0.18 * Math.sin(ang * 3 + a * 5) + 0.1 * Math.sin(ang * 7 + a);
        const k = (1 - t) * wob + t * 0.15;
        p.setXYZ(i, Math.cos(ang) * rad * k, y + h / 2 - 6 + Math.sin(ang * 5 + a) * h * 0.06 * t, Math.sin(ang) * rad * k);
      }
      g.computeVertexNormals();
      const top = kind ? topB : topA;
      const nrm = g.attributes.normal;
      let vi = 0;
      gb.add(g, (v, lx, ly) => {
        const t = clamp((ly + 6) / h, 0, 1);
        const c = new THREE.Color(lerp(hor.r, top.r, Math.pow(t, 0.6)), lerp(hor.g, top.g, Math.pow(t, 0.6)), lerp(hor.b, top.b, Math.pow(t, 0.6)));
        if (!kind && t > 0.78) c.lerp(snow, clamp((t - 0.78) * 6, 0, 1));
        // sunlit / shaded flanks (they are unlit: baked), fading into the haze toward the foot
        const ndl = nrm ? Math.max(0, nrm.getX(vi) * SUN_DIR.x + nrm.getY(vi) * SUN_DIR.y + nrm.getZ(vi) * SUN_DIR.z) : 0.5;
        vi++;
        const k = lerp(1, 0.84 + 0.3 * ndl, Math.pow(t, 0.5));
        return c.multiplyScalar(k);
      }, M4().makeTranslation(Math.cos(a) * dist, 0, Math.sin(a) * dist), 0);
    }
    const mat = new THREE.MeshBasicNodeMaterial({ vertexColors: true, fog: false });
    S.farMat = mat;
    // follows the camera on xz and is kept just inside the far plane (vertexNode): the islands stand beyond the fog,
    // and phones use a shorter view distance
    {
      const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(modelWorldMatrix).mul(vec4(positionLocal.add(vec3(CAMXZ.x, 0, CAMXZ.y)), 1));
      mat.vertexNode = vec4(clip.xy, tmin(clip.z, clip.w.mul(0.99995)), clip.w);
    }
    const mesh = new THREE.Mesh(gb.build(), mat);
    mesh.frustumCulled = false; mesh.renderOrder = -50; mesh.name = 'w-far';
    scene.add(mesh);
  }

  // ======================= animation =======================
  function animate(dt) {
    S.time += dt;
    TIME.value = S.time;
    updateBirds();
    updateMist();
  }

  // ======================= post pipeline + image-based lighting =======================
  // The island hands its sun to the post pipeline (light shafts) and builds the environment map from a vantage
  // point above the start (every PBR material without its own envMap gets sky reflections and sky light from it).
  function startPost() {
    const P = K.post;
    if (!P || typeof P.init !== 'function') return;
    try {
      P.setSun(SUN_DIR, SUN_HEX);
      P.init();
      S.envPos.copy(K.level.start.pos).add(_envUp);
      P.refreshEnvironment(S.envPos, ENV_OPTS);
    } catch (e) { console.warn('Kit Rush 3D: post pipeline not started', e); }
    balanceLights();
  }
  const _envUp = new V3(0, 16, -6);
  // a warm neutral floor under the vantage point: bounce light that lifts the shadow sides without turning the orange
  // checker faces olive (the sunlit lawn below would tint everything green)
  const ENV_OPTS = { floor: true, floorColor: 0x8a8068, floorOpacity: 0.7 };
  // with the environment map lighting the PBR materials, the hemisphere fill steps back (same total ambient)
  function balanceLights() {
    if (!S.hemi) return;
    S.hemi.intensity = S.scene && S.scene.environment ? HEMI_ENV : HEMI_BASE;
  }
  // r155+ physically based light units: three r128 multiplied punctual and hemisphere light by PI in its shaders
  const HEMI_BASE = 0.6 * LIGHT_PI, HEMI_ENV = 0.28 * LIGHT_PI;

  // quality preset changed (pause menu): shadows, grass blades, decor density
  function onGfx() {
    try { applyShadows(); applyDecorTier(); applyGrass(); } catch (e) { console.warn('Kit Rush 3D: island preset change', e); }
  }

  // ======================= public API =======================
  const W = K.world = {
    solids: [],
    deathY: -4,
    seaLevel: SEA,
    sunDir: SUN_DIR,
    sun: null, hemi: null, fog: null,
    bounds: null,
    spots: null,
    terrainY(x, z) { return S.built && fin(x) && fin(z) ? terrainY(x, z) : DEEP; },
    ground(x, z, yTop) { return S.built ? ground(x, z, yTop) : null; },
    collideWalls(pos, radius, height) { return S.built ? collideWalls(pos, radius, height) : (_walls.hit = false, _walls.nx = 0, _walls.nz = 0, _walls); },
    loopPoint,
    routeInfo,
    setFocus(v) { if (v && fin(v.x) && fin(v.y) && fin(v.z)) S.focus.copy(v); },
    build(scene) {
      if (S.built) return;
      scene = scene || (K.view && K.view.scene);
      S.scene = scene;
      const had = new Set(scene.children);
      const touch = K.view ? (typeof K.view.isTouch === 'function' ? !!K.view.isTouch() : !!K.view.isTouch) : false;
      const ss = K.view && K.view.shadowSize;
      S.shadowSize = ss === 1024 || ss === 2048 || ss === 512 || ss === 4096 ? ss : (touch ? 1024 : 2048);
      S.shadowExt = touch ? 40 : 46;
      S.touch = touch;
      // phones: nothing past the fog's end is drawn (the sky and the far islands are kept in front of the far plane)
      if (touch && K.view && K.view.camera) { K.view.camera.far = 660; K.view.camera.updateProjectionMatrix(); }
      buildPath();
      routeAtZ(ARENA.z, _ra); ARENA.x = _ra.x;
      routeAtZ(LAKE.z, _ra); LAKE.x = _ra.x;
      buildTerrain();
      S.built = true;
      S.checkerMat = groundMaterial('checker');
      buildSky(scene);
      buildLights(scene);
      buildSea(scene);
      buildTerrainMeshes(scene);
      buildShadowProxy(scene);
      buildSolids(scene);
      buildLoops(scene);
      buildPlacements();
      buildDecor(scene);
      buildGrass(scene);
      buildWaterfalls(scene);
      buildBirds(scene);
      buildFarIslands(scene);
      W.sun = S.sun; W.hemi = S.hemi; W.fog = S.fog;
      W.bounds = { minX: T.XMIN, maxX: T.XMIN + (T.NX - 1) * CELL, minZ: T.ZMIN, maxZ: T.ZMIN + (T.NZ - 1) * CELL };
      W.spots = {
        start: K.level.start.pos.clone(), loop1: K.level.loops[0].entry.clone(), cliffs: onG(-224, 0, 0), chasm: onG(-236, 0, 0),
        descent: onG(-320, 0, 0), lake: new V3(LAKE.x, SEA, LAKE.z), bridge: new V3(POI.bridge.x, POI.bridge.y, -445),
        loop2: K.level.loops[1].entry.clone(), arena: K.level.boss.center.clone()
      };
      S.focus.copy(K.level.start.pos);
      placeShadow();
      S.lastWall = 0;
      S.own = scene.children.filter(o => !had.has(o));
      if (K.gfx && typeof K.gfx.onChange === 'function') K.gfx.onChange(onGfx);
      startPost();
    },
    // Act switch: hides / shows everything the island put in the scene (objects, lights, fog, clear colour). Shown
    // again, it hands its sun back to the post pipeline and recaptures its environment (call it after the other act
    // has hidden itself, so the capture only sees the island).
    setVisible(on) {
      on = !!on;
      if (!S.built || S.shown === on) return;
      S.shown = on;
      const sc = S.scene;
      for (const o of S.own) {
        if (on) { o.visible = o.userData.kitWasVisible !== false; delete o.userData.kitWasVisible; }
        else { o.userData.kitWasVisible = o.visible; o.visible = false; }
      }
      if (on) {
        sc.fog = S.fog; sc.background = S.bg;
        if (K.post && typeof K.post.refreshEnvironment === 'function') {
          try {
            K.post.setSun(SUN_DIR, SUN_HEX);
            K.post.refreshEnvironment(S.envPos, ENV_OPTS);
          } catch (e) { console.warn('Kit Rush 3D: island environment not restored', e); }
        }
        balanceLights();
      } else {
        if (sc.fog === S.fog) sc.fog = null;
        if (sc.background === S.bg) sc.background = null;
      }
    },
    get visible() { return S.shown; },
    update(dt, t) {
      if (!S.built) return;
      if (!fin(dt) || dt <= 0 || dt > 0.25) dt = 1 / 60;
      S.lastWall = typeof performance !== 'undefined' ? performance.now() : Date.now();
      animate(dt);
      updateTerrainLod();
      updateDecorLod();
      S.simTime += dt;
      for (const m of S.movers) {
        const off = Math.sin((S.simTime * TAU) / m.period + m.phase) * m.amp;
        const nx = m.base.x + m.axis.x * off, ny = m.base.y + m.axis.y * off, nz = m.base.z + m.axis.z * off;
        const s = m.solid;
        s.delta.set(nx - m.cur.x, ny - m.cur.y, nz - m.cur.z);
        s.min.add(s.delta); s.max.add(s.delta);
        m.cur.set(nx, ny, nz);
        m.mesh.position.copy(m.cur);
      }
      placeShadow();
      updateCSM();
      void t;
    },
    get time() { return S.time; },
    _dbg() { return { S, T, GR }; }, // dev probes only
    get decorCounts() { return S.decorCounts; }
  };
})();
