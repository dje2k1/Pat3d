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
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const SUN_DIR = new V3(0.5, 0.7, -0.42).normalize();
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
  const T = { XMIN: 0, ZMIN: 0, NX: 0, NZ: 0, H: null, AO: null, RS: null, RD: null, RM: null };
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
        if (ra < ARENA.r - 1.5) { T.RS[i] = ra * 1.75 + 3.5; T.RD[i] = 0; T.RM[i] = 1.4 * (1 - sstep(ARENA.r - 4, ARENA.r - 2, ra)); }
        else { T.RS[i] = nr.s; T.RD[i] = nr.d; T.RM[i] = (1 - sstep(hw - 1.5, hw + 0.5, nr.dist)) * sstep(ARENA.r - 2, ARENA.r + 1, ra); }
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

  // ======================= shared shader bits =======================
  const TIME = { value: 0 };
  const CAMXZ = { value: new THREE.Vector2() };
  const GM_UNI = {
    gmGrassA: { value: lin('#34b846') }, gmGrassB: { value: lin('#1f8f36') },
    gmLip: { value: lin('#16762f') }, gmLipHi: { value: lin('#8af078') },
    gmChkA: { value: lin('#dd8a3c') }, gmChkB: { value: lin('#a35522') }
  };
  const GM_VERT_PARS = `
varying vec3 vGmW; varying vec3 vGmN;
#ifdef GM_TERRAIN
attribute vec3 aRoute; attribute float aAO; varying vec3 vGmR; varying float vGmAO;
#endif
#if defined(GM_PROP) || defined(GM_LOCAL)
attribute float aLip; varying float vGmLip;
#endif
#ifdef GM_LOCAL
varying vec3 vGmL;
#endif
`;
  const GM_VERT_MAIN = `
vec4 gmW = vec4(transformed, 1.0);
vec3 gmN = objectNormal;
#ifdef USE_INSTANCING
gmW = instanceMatrix * gmW; gmN = mat3(instanceMatrix) * gmN;
#endif
gmW = modelMatrix * gmW;
vGmW = gmW.xyz;
vGmN = mat3(modelMatrix) * gmN;
#ifdef GM_TERRAIN
vGmR = aRoute; vGmAO = aAO;
#endif
#if defined(GM_PROP) || defined(GM_LOCAL)
vGmLip = aLip;
#endif
#ifdef GM_LOCAL
vGmL = transformed;
#endif
`;
  const GM_FRAG_PARS = `
varying vec3 vGmW; varying vec3 vGmN;
#ifdef GM_TERRAIN
varying vec3 vGmR; varying float vGmAO;
#endif
#if defined(GM_PROP) || defined(GM_LOCAL)
varying float vGmLip;
#endif
#ifdef GM_LOCAL
varying vec3 vGmL;
#endif
uniform vec3 gmGrassA; uniform vec3 gmGrassB; uniform vec3 gmLip; uniform vec3 gmLipHi; uniform vec3 gmChkA; uniform vec3 gmChkB;
float gmHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gmNoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gmHash(i), gmHash(i + vec2(1.0, 0.0)), f.x), mix(gmHash(i + vec2(0.0, 1.0)), gmHash(i + vec2(1.0, 1.0)), f.x), f.y); }
float gmChecker(vec2 p, vec2 w){ w += 1e-4;
  vec2 i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
  return 0.5 - 0.5 * i.x * i.y; }
vec2 gmFw(vec2 p){ return max(abs(dFdx(p)), abs(dFdy(p))); }
vec3 gmCheckerCol(vec2 p, vec2 w){
  float c = gmChecker(p, w);
  vec3 col = mix(gmChkA, gmChkB, c);
  vec2 f = fract(p); w = w * 1.5 + 1e-4;
  float fade = clamp(1.0 - max(w.x, w.y) * 3.5, 0.0, 1.0);
  float hi = max(smoothstep(0.92 - w.y, 0.92 + w.y, f.y), 1.0 - smoothstep(0.06 - w.x, 0.06 + w.x, f.x));
  float lo = max(1.0 - smoothstep(0.06 - w.y, 0.06 + w.y, f.y), smoothstep(0.94 - w.x, 0.94 + w.x, f.x));
  col *= 1.0 + fade * (0.2 * hi - 0.26 * lo);
  col *= 0.95 + 0.1 * gmNoise(p * 6.0);
  return col;
}
`;
  const GM_FRAG_MAIN = `
vec3 gN = normalize(vGmN);
#ifdef GM_LOCAL
vec3 gP = vGmL;
#else
vec3 gP = vGmW;
#endif
vec3 gA = abs(gN);
vec2 gqY = gP.xz * 0.4; vec2 gqX = gP.zy * 0.4; vec2 gqZ = gP.xy * 0.4;
vec2 gwY = gmFw(gqY); vec2 gwX = gmFw(gqX); vec2 gwZ = gmFw(gqZ);
bool gUY = gA.y > gA.x && gA.y > gA.z; bool gUX = gA.x > gA.z;
vec2 gq = gUY ? gqY : (gUX ? gqX : gqZ);
vec2 gw = gUY ? gwY : (gUX ? gwX : gwZ);
vec3 gChk = gmCheckerCol(gq, gw);
// bevelled tiles: the normal rolls off at every square's edge (faded out where a square is a few pixels wide)
vec2 gTf = fract(gq);
vec2 gBv = vec2(smoothstep(0.9, 1.0, gTf.x) - smoothstep(0.1, 0.0, gTf.x), smoothstep(0.9, 1.0, gTf.y) - smoothstep(0.1, 0.0, gTf.y));
gBv *= 0.6 * clamp(1.0 - max(gw.x, gw.y) * 5.0, 0.0, 1.0);
vec3 gBump = gUY ? vec3(gBv.x, 0.0, gBv.y) : (gUX ? vec3(0.0, gBv.y, gBv.x) : vec3(gBv.x, gBv.y, 0.0));
#ifdef GM_CHECKER
vec3 gCol = gChk;
#else
float gn1 = gmNoise(gP.xz * 0.045);
float gn2 = gmNoise(gP.xz * 0.55 + 7.0);
vec3 gGrass = mix(gmGrassA, gmGrassB, smoothstep(0.25, 0.8, gn1));
gGrass *= 0.92 + 0.14 * gn2;
#ifdef GM_TERRAIN
// mowing stripes: a stripe is centred on the route (no edge down the middle of the screen behind Kit)
vec2 gLq = vec2(vGmR.x / 7.0, vGmR.y / 5.5 + 0.5);
float gLawn = gmChecker(gLq, min(gmFw(gLq), vec2(0.5)));
gGrass *= 1.0 + (gLawn - 0.5) * 0.09 * clamp(vGmR.z, 0.0, 1.0);
#endif
vec3 gFN = normalize(cross(dFdx(vGmW), dFdy(vGmW)));
float gSt = 1.0 - gN.y;
#ifdef GM_TERRAIN
gSt = mix(gSt, 1.0 - abs(gFN.y), 0.72);
#endif
gSt += (gmNoise(gP.xz * 0.8 + gP.y * 0.7) - 0.5) * 0.07;
float gMask = 1.0 - smoothstep(0.31, 0.34, gSt);
float gLipM = 1.0 - smoothstep(0.39, 0.42, gSt);
vec3 gCol = mix(gChk, gmLip * (0.92 + 0.12 * gmNoise(gP.xz * 2.0 + gP.y)), gLipM);
gCol = mix(gCol, gGrass, gMask);
gCol = mix(gCol, gmLipHi, gMask * smoothstep(0.235, 0.3, gSt) * 0.5);
#if defined(GM_PROP) || defined(GM_LOCAL)
gCol = mix(gCol, gmLip * (0.8 + 0.35 * gmNoise(gP.xz * 3.0 + gP.y * 2.0)), clamp(vGmLip, 0.0, 1.0));
#endif
// grass detail: tufts (fine noise, its gradient tilts the normal) and soft mounds, faded with the pixel footprint;
// sun-dried and lush patches
vec2 gFoot = gmFw(gP.xz);
float gFoo = max(gFoot.x, gFoot.y);
float gFine = 1.0 - smoothstep(0.025, 0.11, gFoo), gMidF = 1.0 - smoothstep(0.1, 0.45, gFoo);
vec2 gTq = gP.xz * vec2(7.3, 8.9);
float gT0 = gmNoise(gTq), gTx = gmNoise(gTq + vec2(0.2, 0.0)), gTz = gmNoise(gTq + vec2(0.0, 0.2));
vec2 gUq = gP.xz * vec2(2.9, 3.4) + 5.3;
float gU0 = gmNoise(gUq), gUx = gmNoise(gUq + vec2(0.2, 0.0)), gUz = gmNoise(gUq + vec2(0.0, 0.2));
vec2 gGb = vec2(gTx - gT0, gTz - gT0) * 0.9 * gFine + vec2(gUx - gU0, gUz - gU0) * 0.45 * gMidF;
gBump = mix(gBump, vec3(-gGb.x, 0.0, -gGb.y), gMask);
gCol *= mix(1.0, 0.86 + 0.16 * gT0 + 0.1 * gU0, gMidF * gMask);
float gPatch = gmNoise(gP.xz * 0.075 + 13.0);
gCol = mix(gCol, gCol * vec3(1.16, 1.06, 0.66), smoothstep(0.6, 0.88, gPatch) * gMask * 0.5);
gCol = mix(gCol, gCol * vec3(0.78, 0.92, 0.86), smoothstep(0.62, 0.9, 1.0 - gPatch) * gMask * 0.45);
#ifdef GM_TERRAIN
gCol *= mix(1.0, vGmAO, 0.65);
#endif
#endif
diffuseColor.rgb = gCol;
`;
  // the baked cavity term also shades the sky light and reflections (contact darkening at cliff bases and in hollows)
  const GM_FRAG_AO = `
#ifdef GM_TERRAIN
float gIAO = vGmAO * vGmAO;
reflectedLight.indirectDiffuse *= gIAO;
reflectedLight.indirectSpecular *= gIAO;
#endif
`;
  function groundMaterial(mode) {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    m.extensions = { derivatives: true };
    const def = { terrain: 'GM_TERRAIN', prop: 'GM_PROP', local: 'GM_LOCAL', checker: 'GM_CHECKER' }[mode];
    m.defines = Object.assign({}, m.defines || {}, { [def]: '' });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, GM_UNI);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + GM_VERT_PARS)
        .replace('#include <project_vertex>', '#include <project_vertex>\n' + GM_VERT_MAIN);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GM_FRAG_PARS)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + GM_FRAG_MAIN)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + mat3(viewMatrix) * gBump);')
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + GM_FRAG_AO);
    };
    m.customProgramCacheKey = () => 'kitGM2_' + mode;
    return m;
  }
  const ANIM_PRE = `
#ifdef USE_INSTANCING
vec3 kIP = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
#else
vec3 kIP = vec3(0.0);
#endif
float kPh = kIP.x * 0.37 + kIP.z * 0.23;
`;
  const ANIM = {
    palm: 'transformed.x += sin(uTime * 1.5 + kPh) * aAnim * 0.32; transformed.z += cos(uTime * 1.1 + kPh * 1.3) * aAnim * 0.22; transformed.y += sin(uTime * 2.1 + kPh) * aAnim * 0.1;',
    sunflower: 'if (aAnim > 0.5) { vec3 kp = vec3(0.0, 2.1, 0.09); vec3 kl = transformed - kp; float ka = uTime * 1.4 + kPh; float kc = cos(ka); float ks = sin(ka); transformed = kp + vec3(kc * kl.x - ks * kl.y, ks * kl.x + kc * kl.y, kl.z); } transformed.x += sin(uTime * 1.3 + kPh) * 0.04 * transformed.y;',
    flower: 'transformed.x += sin(uTime * 1.8 + kPh) * aAnim * 0.08; transformed.z += cos(uTime * 1.4 + kPh) * aAnim * 0.06;',
    bird: 'transformed.y += sin(uTime * 9.0 + kPh * 3.0) * aAnim * 0.55;'
  };
  function animMaterial(kind, params) {
    const m = new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.82, metalness: 0 }, params || {}));
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = TIME;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aAnim;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + ANIM_PRE + ANIM[kind]);
    };
    m.customProgramCacheKey = () => 'kitAnim_' + kind;
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
    touch: false, movers: [], clouds: null, cloudData: [], birds: null, birdData: [], wfTex: null, mist: null, mistData: [],
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
  function buildLights(scene) {
    const hemi = new THREE.HemisphereLight(lin('#cfe9ff'), lin('#4f8f3c'), HEMI_BASE);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(lin('#fff0d4'), 1.38);
    sun.castShadow = true;
    sun.shadow.mapSize.set(S.shadowSize, S.shadowSize);
    const c = sun.shadow.camera;
    c.left = -S.shadowExt; c.right = S.shadowExt; c.top = S.shadowExt; c.bottom = -S.shadowExt; c.near = 1; c.far = 360;
    c.updateProjectionMatrix();
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    scene.add(sun); scene.add(sun.target);
    S.sun = sun; S.hemi = hemi;
    placeShadow();
  }
  const _sr = new V3(), _su = new V3(), _sp = new V3();
  function placeShadow() {
    if (!S.sun) return;
    const f = S.focus;
    _sr.crossVectors(UP, SUN_DIR).normalize();
    _su.crossVectors(SUN_DIR, _sr);
    const texel = (2 * S.shadowExt) / S.shadowSize;
    const u = Math.round(f.dot(_sr) / texel) * texel, v = Math.round(f.dot(_su) / texel) * texel, w = f.dot(SUN_DIR);
    _sp.copy(_sr).multiplyScalar(u).addScaledVector(_su, v).addScaledVector(SUN_DIR, w);
    S.sun.target.position.copy(_sp);
    S.sun.position.copy(_sp).addScaledVector(SUN_DIR, 170);
    S.sun.target.updateMatrixWorld();
    S.sun.updateMatrixWorld();
  }
  function glowTexture(size, stops) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const s of stops) gr.addColorStop(s[0], s[1]);
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  // the sky, in linear colours: the dome draws it, the water reflects it. uHDR (K.post) deepens it for the
  // tone-mapped HDR pipeline; with 0 it matches the original display-space sky exactly.
  const POST_HDR = (K.post && K.post.uHDR) || { value: 0 };
  const SKY_UNI = {
    uSkyZen: { value: lin('#1f4fd0') }, uSkyMid: { value: lin('#4a8cee') }, uSkyHor: { value: lin(FOG_HEX) },
    uSkyZenH: { value: lin('#1844c6') }, uSkyMidH: { value: lin('#3a82ec') }, uSkyHorH: { value: lin('#98cdff') },
    uSkySun: { value: SUN_DIR.clone() }, uSkySunCol: { value: lin('#fff4d6') }, uTime: TIME, uHDR: POST_HDR
  };
  const FAR_HDR = new THREE.Color(lin('#98cdff').r / lin(FOG_HEX).r, lin('#98cdff').g / lin(FOG_HEX).g, 1);
  const SKY_GLSL = `uniform vec3 uSkyZen; uniform vec3 uSkyMid; uniform vec3 uSkyHor; uniform vec3 uSkyZenH; uniform vec3 uSkyMidH; uniform vec3 uSkyHorH;
uniform vec3 uSkySun; uniform vec3 uSkySunCol;
vec3 skyGradient(vec3 d, float hdr){
  float h = d.y;
  vec3 hor = mix(uSkyHor, uSkyHorH, hdr), mid = mix(uSkyMid, uSkyMidH, hdr), zen = mix(uSkyZen, uSkyZenH, hdr);
  vec3 col = mix(hor, mid, smoothstep(0.0, 0.3, h));
  col = mix(col, zen, smoothstep(0.25, 0.95, h));
  // warm forward scattering low around the sun (HDR only: the old sky had none)
  float sd = max(dot(d, uSkySun), 0.0);
  col += hdr * vec3(1.0, 0.78, 0.5) * pow(sd, 5.0) * 0.16 * (1.0 - smoothstep(0.0, 0.6, h));
  return col;
}`;
  function buildSky(scene) {
    const fog = new THREE.Fog(new THREE.Color(FOG_HEX), 120, 640);
    fog.hdrColor = SKY_UNI.uSkyHorH.value; // the HDR pipeline fogs toward its own (linear) horizon
    scene.fog = fog; S.fog = fog;
    scene.background = S.bg = new THREE.Color(FOG_HEX);
    const mat = new THREE.ShaderMaterial({
      uniforms: SKY_UNI,
      vertexShader: `varying vec3 vDir;
void main(){ vDir = position; vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); p.z = p.w * 0.99999; gl_Position = p; }`,
      fragmentShader: `uniform float uTime; uniform float uHDR;
varying vec3 vDir;
${SKY_GLSL}
float sh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float sn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(sh(i), sh(i + vec2(1.0, 0.0)), f.x), mix(sh(i + vec2(0.0, 1.0)), sh(i + vec2(1.0, 1.0)), f.x), f.y); }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = skyGradient(d, uHDR);
  float az = atan(d.z, d.x);
  vec2 cp = vec2(az * 7.0 + uTime * 0.004, h * 26.0);
  float cl = sn(cp) * 0.6 + sn(cp * 2.3 + 3.1) * 0.3 + sn(cp * 5.1 + 7.7) * 0.1;
  float band = smoothstep(0.0, 0.035, h) * (1.0 - smoothstep(0.08, 0.2, h));
  float sd = max(dot(d, uSkySun), 0.0);
  vec3 cloudCol = mix(vec3(1.0), vec3(1.0, 0.94, 0.84) * (1.0 + 0.6 * uHDR), pow(sd, 6.0));
  col = mix(col, cloudCol, smoothstep(0.5, 0.75, cl) * band * 0.75);
  col += uSkySunCol * (pow(sd, 1200.0) * 1.4 + pow(sd, 60.0) * 0.32 + pow(sd, 7.0) * 0.12);
  // HDR: a real sun disc and aureole (bloom and light shafts feed on them); direct rendering keeps the old clamp
  col += uHDR * uSkySunCol * (smoothstep(0.99962, 0.99985, sd) * 24.0 + pow(sd, 600.0) * 1.5 + pow(sd, 60.0) * 0.1);
  col = mix(min(col, vec3(1.0)), col, uHDR);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <encodings_fragment>
}`,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), mat);
    dome.renderOrder = -100; dome.frustumCulled = false;
    dome.onBeforeRender = (r, sc, cam) => skyFollow(cam);
    scene.add(dome); S.sky = dome;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(256, [[0, 'rgba(255,252,235,1)'], [0.08, 'rgba(255,246,210,0.95)'], [0.22, 'rgba(255,230,170,0.35)'], [0.5, 'rgba(255,220,160,0.08)'], [1, 'rgba(255,220,160,0)']]),
      color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false
    }));
    glow.scale.set(300, 300, 1); glow.frustumCulled = false; glow.renderOrder = -90;
    scene.add(glow); S.sunSprite = glow;
  }
  function skyFollow(cam) {
    if (!cam) return;
    CAMXZ.value.set(cam.position.x, cam.position.z);
    if (S.sunSprite) {
      S.sunSprite.position.copy(cam.position).addScaledVector(SUN_DIR, 700); S.sunSprite.updateMatrixWorld();
      S.sunSprite.material.opacity = POST_HDR.value ? 0.22 : 1;
    }
    // far islands fade into the horizon of whichever sky is drawn
    if (S.farMat) S.farMat.color.copy(POST_HDR.value ? FAR_HDR : WHITE);
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
    const uni = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uSun: { value: SUN_DIR.clone() }, uSunCol: { value: lin('#fff2d0') },
      uDeep: { value: lin('#1550b4') }, uMid: { value: lin('#2a86dc') }, uShallow: { value: lin('#3fd6d2') },
      uFoam: { value: lin('#f6fcff') },
      uHeight: { value: null }, uHB: { value: new THREE.Vector4(T.XMIN - CELL / 2, T.ZMIN - CELL / 2, 1 / (CELL * NX), 1 / (CELL * NZ)) }
    }]);
    uni.uHeight.value = tex;
    uni.uTime = TIME;
    for (const k in SKY_UNI) if (k !== 'uTime') uni[k] = SKY_UNI[k];
    const mat = new THREE.ShaderMaterial({
      uniforms: uni, fog: true,
      vertexShader: `uniform float uTime; varying vec3 vWP;
#include <fog_pars_vertex>
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.y += sin(wp.x * 0.08 + uTime * 1.1) * 0.1 + sin(wp.z * 0.11 - uTime * 0.9) * 0.08;
  vWP = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
      fragmentShader: `uniform float uTime; uniform float uHDR; uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uDeep; uniform vec3 uMid; uniform vec3 uShallow; uniform vec3 uFoam;
uniform sampler2D uHeight; uniform vec4 uHB; varying vec3 vWP;
${SKY_GLSL}
#include <fog_pars_fragment>
float sh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float sn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(sh(i), sh(i + vec2(1.0, 0.0)), f.x), mix(sh(i + vec2(0.0, 1.0)), sh(i + vec2(1.0, 1.0)), f.x), f.y); }
void main(){
  vec2 p = vWP.xz; float t = uTime;
  float dist = length(cameraPosition - vWP);
  float near = 1.0 - smoothstep(25.0, 130.0, dist);
  vec2 g = vec2(0.0);
  vec2 d1 = vec2(0.8, 0.6); vec2 d2 = vec2(-0.5, 0.866); vec2 d3 = vec2(0.196, -0.98); vec2 d4 = vec2(-0.949, -0.316);
  g += d1 * cos(dot(d1, p) * 0.21 + t * 1.3) * 0.021;
  g += d2 * cos(dot(d2, p) * 0.37 + t * 1.7) * 0.022;
  g += d3 * cos(dot(d3, p) * 0.73 + t * 2.3) * 0.022;
  g += d4 * cos(dot(d4, p) * 1.31 + t * 3.1) * 0.02;
  vec2 q = p * 0.9 + vec2(t * 0.35, t * 0.2);
  float n0 = sn(q); float nx = sn(q + vec2(0.35, 0.0)); float nz = sn(q + vec2(0.0, 0.35));
  g += vec2(nx - n0, nz - n0) * 0.3;
  // fine ripples close to the camera only (they would shimmer far away)
  vec2 q2 = p * 2.6 + vec2(-t * 0.7, t * 0.5);
  float m0 = sn(q2); float mx = sn(q2 + vec2(0.18, 0.0)); float mz = sn(q2 + vec2(0.0, 0.18));
  g += vec2(mx - m0, mz - m0) * 0.2 * near;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vWP);
  vec2 uv = (p - uHB.xy) * uHB.zw;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  vec4 ht = texture2D(uHeight, clamp(uv, 0.0, 1.0));
  float hg = mix(-6.0, ht.r * 12.0 - 6.0, inside);
  float hb = mix(-6.0, ht.g * 12.0 - 6.0, inside);
  float depth = max(-hg, 0.0);
  vec3 col = mix(uShallow, uMid, smoothstep(0.3, 3.2, depth));
  col = mix(col, uDeep, smoothstep(3.0, 5.9, depth) * 0.85 + 0.15 * smoothstep(5.0, 6.0, -hb));
  // sunlight dancing on the shallow bottom
  float cs = sn(p * 0.8 + vec2(t * 0.4, t * 0.25) + g * 6.0) * sn(p * 1.15 - vec2(t * 0.3, -t * 0.35) - g * 5.0);
  col += uSunCol * smoothstep(0.32, 0.62, cs) * (1.0 - smoothstep(0.4, 2.6, depth)) * 0.22 * (0.6 + 0.4 * near);
  // the sky reflected with Fresnel (same sky as the dome)
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  float fr = pow(1.0 - max(dot(N, V), 0.0), 5.0);
  col = mix(col, skyGradient(R, uHDR), clamp(0.06 + fr * 0.82, 0.0, 1.0));
  vec3 Hh = normalize(uSun + V);
  float nh = max(dot(N, Hh), 0.0);
  col += uSunCol * (pow(nh, 420.0) * 3.0 + pow(nh, 60.0) * 0.16);
  col += uHDR * uSunCol * pow(nh, 1800.0) * 40.0;
  float sp = sn(p * 2.7 + vec2(t * 0.9, -t * 0.6)) * sn(p * 3.3 - vec2(t * 0.5, t * 1.1));
  float gfade = 1.0 - smoothstep(50.0, 190.0, dist);
  col += uSunCol * smoothstep(0.6, 0.82, sp) * pow(nh, 16.0) * (2.4 + 4.0 * uHDR) * gfade;
  float fnz = sn(p * 0.45 + vec2(t * 0.22, -t * 0.17));
  float shore = smoothstep(-5.4, -1.0, hb);
  float band = 0.5 + 0.5 * sin(hb * 2.4 - t * 1.8 + fnz * 4.0);
  float foam = shore * smoothstep(0.62, 0.9, band * 0.7 + fnz * 0.45);
  foam += smoothstep(-1.7, -0.25, hg) * (0.6 + 0.4 * fnz);
  col = mix(col, uFoam * (0.9 + 0.25 * max(uSun.y, 0.0)), clamp(foam, 0.0, 1.0) * 0.9);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <encodings_fragment>
  #include <fog_fragment>
}`
    });
    const geo = new THREE.PlaneGeometry(2600, 2600, 96, 96);
    geo.rotateX(-Math.PI / 2);
    const sea = new THREE.Mesh(geo, mat);
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
    const NX = T.NX, NZ = T.NZ, H = T.H, CH = 64;
    const grp = new THREE.Group(); grp.name = 'terrain';
    S.terrChunks = [];
    for (let cz = 0; cz < NZ - 1; cz += CH) for (let cx = 0; cx < NX - 1; cx += CH) {
      const ix1 = Math.min(cx + CH, NX - 1), iz1 = Math.min(cz + CH, NZ - 1);
      const w = ix1 - cx + 1, hh = iz1 - cz + 1;
      const lods = [1, 2, 4].map(st => terrainIndex(cx, cz, ix1, iz1, w, st));
      if (!lods[0].length) continue;
      const pos = new Float32Array(w * hh * 3), nor = new Float32Array(w * hh * 3), rte = new Float32Array(w * hh * 3), ao = new Float32Array(w * hh);
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
        }
      }
      const attrs = { position: new THREE.BufferAttribute(pos, 3), normal: new THREE.BufferAttribute(nor, 3), aRoute: new THREE.BufferAttribute(rte, 3), aAO: new THREE.BufferAttribute(ao, 1) };
      const ch = { meshes: [], lod: 0, x0: X0 + cx * CELL, x1: X0 + ix1 * CELL, z0: Z0 + cz * CELL, z1: Z0 + iz1 * CELL };
      let sphere = null;
      for (let k = 0; k < 3; k++) {
        if (!lods[k].length) { ch.meshes.push(ch.meshes[k - 1]); continue; }
        const g = new THREE.BufferGeometry();
        for (const n in attrs) g.setAttribute(n, attrs[n]);
        g.setIndex(new THREE.BufferAttribute(Uint16Array.from(lods[k]), 1));
        if (!sphere) { g.computeBoundingSphere(); sphere = g.boundingSphere; } else g.boundingSphere = sphere.clone();
        const m = new THREE.Mesh(g, mat);
        // phones: the terrain only receives the sun shadow (casting it doubles the heaviest geometry in the shadow pass)
        m.receiveShadow = true; m.castShadow = !S.touch;
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
    const t1 = S.touch ? 115 : 180, t2 = S.touch ? 230 : 340;
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
  function buildLoopMesh(scene, loop) {
    const segs = 120, half = LOOP_W / 2, thick = LOOP_THICK;
    const lp = { pos: new V3(), up: new V3(), fwd: new V3() };
    const sd = loop.side;
    const grassA = lin('#3fc252'), grassB = lin('#2b9e40'), edge = lin('#1d8a38');
    // running surface (stripes)
    const P = [], N = [], C = [], I = [];
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      loopPoint(loop, (i / segs) * TAU, lp);
      pts.push({ p: lp.pos.clone(), u: lp.up.clone() });
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
      }
      I.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
    fixWinding(P, N, I);
    const g1 = new THREE.BufferGeometry();
    g1.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g1.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g1.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g1.setIndex(I);
    g1.computeBoundingSphere();
    const surf = new THREE.Mesh(g1, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
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
    const rails = new THREE.Mesh(gbR.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.55 }));
    rails.castShadow = true;
    const grp = new THREE.Group();
    grp.add(surf, shell, rails);
    scene.add(grp);
    return grp;
  }

  // ----- decorations geometry
  function palmGeo() {
    const gb = new GB();
    const H = 7.4, lean = 1.7, segs = 9;
    const trunkA = lin('#ad6a32'), trunkB = lin('#8a4f22');
    const pt = (t) => new V3(lean * t * t, H * t, 0);
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs, a = pt(t0), b = pt(t1);
      const r0 = 0.36 - t0 * 0.15, r1 = 0.36 - t1 * 0.15;
      const len = a.distanceTo(b);
      const q = new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize());
      const m = M4().compose(a.clone().add(b).multiplyScalar(0.5), q, new V3(1, 1, 1));
      gb.add(new THREE.CylinderGeometry(r1 * 1.12, r0 * 0.94, len * 1.02, 7, 1, true), i % 2 ? trunkA : trunkB, m, 0);
    }
    const top = pt(1);
    for (const o of [[0.18, -0.25, 0.1], [-0.2, -0.3, 0.12], [0.02, -0.28, -0.22]]) {
      gb.add(new THREE.SphereGeometry(0.22, 6, 4), lin('#6b3a12'), M4().makeTranslation(top.x + o[0], top.y + o[1], top.z + o[2]), 0);
    }
    gb.add(new THREE.SphereGeometry(0.3, 6, 4), lin('#2a8a3a'), M4().makeTranslation(top.x, top.y + 0.05, top.z), 0);
    const fr = [lin('#22a043'), lin('#178534')], rib = lin('#6fdc6c');
    for (let f = 0; f < 9; f++) {
      const ang = (f / 9) * TAU + (f % 2) * 0.18, L = 3.3 + (f % 3) * 0.35;
      const dx = Math.cos(ang), dz = Math.sin(ang), px = -dz, pz = dx;
      const M = 7, P = [], N = [], C = [], X = [], I = [];
      for (let j = 0; j <= M; j++) {
        const u = j / M, r = L * u;
        const y = top.y + 0.75 * Math.sin(u * Math.PI * 0.85) - 2.3 * u * u;
        const w = 0.62 * Math.sin(Math.PI * Math.min(1, u * 1.08 + 0.04)) * (1 - 0.3 * u);
        const cx = top.x + dx * r, cz = top.z + dz * r;
        P.push(cx - px * w, y - 0.16 * w, cz - pz * w, cx, y + 0.1, cz, cx + px * w, y - 0.16 * w, cz + pz * w);
        for (let k = 0; k < 3; k++) N.push(0, 1, 0);
        C.push(fr[f % 2], rib, fr[f % 2]);
        const sw = u * u;
        X.push(sw, sw, sw);
        if (j < M) { const a = j * 3; I.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setIndex(I); g.computeVertexNormals();
      const nn = g.attributes.normal.array;
      gb.raw(P, Array.from(nn), C, X, I);
      g.dispose();
    }
    return gb.build('aAnim');
  }
  // flat star/petal fan (double-sided material), center at origin in the XY plane facing +Z
  function petalFan(gb, m, n, rIn, rOut, colIn, colOut, extra, tilt) {
    const P = [0, 0, 0], N = [0, 0, 1], C = [colIn], X = [extra], I = [];
    for (let k = 0; k < n * 2; k++) {
      const a = (k / (n * 2)) * TAU, r = k % 2 ? rIn : rOut;
      P.push(Math.sin(a) * r, Math.cos(a) * r, (k % 2 ? 0 : -1) * (tilt || 0));
      N.push(0, 0, 1); C.push(k % 2 ? colIn : colOut); X.push(extra);
    }
    for (let k = 0; k < n * 2; k++) I.push(0, 1 + ((k + 1) % (n * 2)), 1 + k);
    const v = new V3(), nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < P.length; i += 3) { v.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(m); P[i] = v.x; P[i + 1] = v.y; P[i + 2] = v.z; v.set(N[i], N[i + 1], N[i + 2]).applyMatrix3(nm).normalize(); N[i] = v.x; N[i + 1] = v.y; N[i + 2] = v.z; }
    gb.raw(P, N, C, X, I);
  }
  function leafQuad(gb, base, dir, len, wid, col, extra) {
    const side = new V3(-dir.z, 0, dir.x).normalize().multiplyScalar(wid / 2);
    const tip = base.clone().addScaledVector(dir, len), mid = base.clone().addScaledVector(dir, len * 0.45);
    const P = [base.x, base.y, base.z, mid.x + side.x, mid.y + 0.05, mid.z + side.z, tip.x, tip.y, tip.z, mid.x - side.x, mid.y + 0.05, mid.z - side.z];
    gb.raw(P, [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], col, extra, [0, 1, 2, 0, 2, 3]);
  }
  function sunflowerGeo() {
    const gb = new GB();
    gb.add(new THREE.CylinderGeometry(0.05, 0.075, 2.1, 5, 1, true), lin('#2a8a2c'), M4().makeTranslation(0, 1.05, 0), 0);
    leafQuad(gb, new V3(0.03, 0.72, 0), new V3(0.8, 0.25, 0.1).normalize(), 0.75, 0.32, lin('#2fa13a'), 0);
    leafQuad(gb, new V3(-0.03, 1.22, 0), new V3(-0.8, 0.3, -0.1).normalize(), 0.65, 0.28, lin('#2a9536'), 0);
    const pv = new V3(0, 2.1, 0.09);
    gb.add(new THREE.CylinderGeometry(0.34, 0.3, 0.14, 12), lin('#7a4210'), TRS(pv.x, pv.y, pv.z, Math.PI / 2, 0, 0, 1), 1);
    gb.add(new THREE.CircleGeometry(0.2, 10), lin('#a8641e'), TRS(pv.x - 0.04, pv.y + 0.04, pv.z + 0.075, 0, 0, 0, 1), 1);
    petalFan(gb, M4().makeTranslation(pv.x, pv.y, pv.z + 0.01), 12, 0.3, 0.86, lin('#ffbd1a'), lin('#ffdc3a'), 1, 0.12);
    petalFan(gb, TRS(pv.x, pv.y, pv.z - 0.02, 0, 0, Math.PI / 12, 1), 12, 0.3, 0.74, lin('#f2a812'), lin('#ffc828'), 1, 0.1);
    return gb.build('aAnim');
  }
  function flowerGeo() {
    const gb = new GB();
    const cols = [lin('#b25bff'), lin('#ff6fae'), lin('#ffffff'), lin('#9a4bf0')];
    const spots = [[0, 0, 0.62, 0], [0.22, 0.12, 0.48, 1], [-0.18, 0.16, 0.54, 2], [0.05, -0.22, 0.42, 3]];
    for (const [x, z, h, ci] of spots) {
      gb.add(new THREE.CylinderGeometry(0.022, 0.03, h, 3, 1, true), lin('#2a8a2c'), M4().makeTranslation(x, h / 2, z), (v, lx, ly) => clamp((ly + h / 2) / 0.7, 0, 1));
      petalFan(gb, TRS(x, h + 0.02, z, -Math.PI / 2 + 0.25, x * 9, 0, 1), 5, 0.04, 0.15, lin('#ffd42e'), cols[ci], h / 0.7, 0.03);
    }
    for (let k = 0; k < 4; k++) {
      const a = k * 1.7;
      leafQuad(gb, new V3(0, 0.03, 0), new V3(Math.cos(a), 0.15, Math.sin(a)).normalize(), 0.32, 0.14, lin('#2d9a3a'), 0);
    }
    return gb.build('aAnim');
  }
  function bushGeo() {
    const gb = new GB();
    const lo = lin('#1a7436'), hi = lin('#4fd062');
    const blobs = [[-0.75, 0.55, 0, 0.75], [0, 0.8, 0.1, 0.95], [0.78, 0.55, -0.05, 0.78], [0.3, 0.45, 0.6, 0.62], [-0.3, 0.45, -0.6, 0.62]];
    for (const [x, y, z, r] of blobs) {
      gb.add(new THREE.IcosahedronGeometry(r, 1), (v) => { const t = clamp(v.y / 1.7, 0, 1); return new THREE.Color(lerp(lo.r, hi.r, t), lerp(lo.g, hi.g, t), lerp(lo.b, hi.b, t)); }, M4().makeTranslation(x, y, z), 0);
    }
    return gb.build();
  }
  function rockGeo() {
    let g = new THREE.IcosahedronGeometry(1, 1);
    if (g.index) g = g.toNonIndexed();
    const p = g.attributes.position;
    const keyOf = (x, y, z) => Math.round(x * 100) + ',' + Math.round(y * 100) + ',' + Math.round(z * 100);
    const off = new Map();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = keyOf(x, y, z);
      if (!off.has(k)) off.set(k, 0.78 + 0.4 * ihash(Math.round(x * 50), Math.round(y * 50 + z * 31), 9));
      const s = off.get(k);
      p.setXYZ(i, x * s * 1.25, Math.max(y * s * 0.75, -0.3), z * s);
    }
    g.computeVertexNormals();
    const gb = new GB();
    const a = lin('#7d86a3'), b = lin('#b8bfd6');
    gb.add(g, (v, lx, ly) => (ly > 0.35 ? b : a), null, 0);
    return gb.build();
  }
  function totemGeo() {
    const gb = new GB();
    const box = (x, y, z, w, h, d, col, rx, ry, rz) => gb.add(new THREE.BoxGeometry(w, h, d), col, TRS(x, y, z, rx || 0, ry || 0, rz || 0, 1), 0);
    const S0 = 1.15;
    box(0, 0.15, 0, 1.6, 0.3, 1.6, lin('#8b8fa8'));
    // bottom block (yellow) with face
    box(0, 0.3 + S0 / 2, 0, S0, S0, S0, lin('#e8b23a'));
    box(0, 0.3 + S0 / 2, 0.02, S0 * 0.3, S0 * 1.002, S0 * 1.004, lin('#c9921f'));
    for (const sx of [-0.25, 0.25]) { box(sx, 0.3 + S0 * 0.62, S0 / 2 + 0.01, 0.2, 0.2, 0.04, lin('#fff3dc')); box(sx, 0.3 + S0 * 0.6, S0 / 2 + 0.03, 0.09, 0.11, 0.03, lin('#2a1406')); }
    box(0, 0.3 + S0 * 0.28, S0 / 2 + 0.01, 0.42, 0.09, 0.04, lin('#2a1406'));
    // middle block (blue) with wings
    const yb = 0.3 + S0 * 1.5;
    box(0, yb, 0, S0, S0, S0, lin('#2e8bc0'));
    box(0, yb, 0.0, S0 * 1.004, S0 * 0.18, S0 * 1.004, lin('#1d5f8a'));
    for (const sx of [-1, 1]) {
      box(sx * (S0 / 2 + 0.45), yb + 0.2, 0, 0.9, 0.12, 0.6, lin('#2e8bc0'), 0, 0, sx * 0.45);
      box(sx * (S0 / 2 + 0.85), yb + 0.45, 0, 0.5, 0.1, 0.45, lin('#1d5f8a'), 0, 0, sx * 0.7);
    }
    // top block: fox head
    const yt = 0.3 + S0 * 2.5;
    box(0, yt, 0, S0 * 1.08, S0, S0 * 1.02, lin('#f47a1f'));
    box(0, yt - 0.22, S0 / 2 + 0.12, 0.62, 0.42, 0.3, lin('#fff4e6'));
    box(0, yt - 0.1, S0 / 2 + 0.29, 0.16, 0.12, 0.06, lin('#2a1406'));
    for (const sx of [-0.27, 0.27]) {
      box(sx, yt + 0.16, S0 / 2 + 0.02, 0.26, 0.24, 0.04, lin('#ffffff'));
      box(sx + (sx > 0 ? -0.03 : 0.03), yt + 0.15, S0 / 2 + 0.04, 0.12, 0.18, 0.03, lin('#22c36a'));
      box(sx + (sx > 0 ? -0.03 : 0.03), yt + 0.15, S0 / 2 + 0.055, 0.05, 0.09, 0.02, lin('#0b2a14'));
    }
    for (const sx of [-1, 1]) {
      gb.add(new THREE.ConeGeometry(0.32, 0.7, 4), lin('#f47a1f'), TRS(sx * 0.35, yt + S0 / 2 + 0.3, 0, 0, Math.PI / 4, sx * -0.2, 1), 0);
      gb.add(new THREE.ConeGeometry(0.17, 0.42, 4), lin('#6a2408'), TRS(sx * 0.35, yt + S0 / 2 + 0.25, 0.14, 0, Math.PI / 4, sx * -0.2, 1), 0);
    }
    return gb.build();
  }
  function cloudGeo() {
    const gb = new GB();
    const top = lin('#ffffff'), bot = lin('#c9dcf6');
    const blobs = [[0, 0, 0, 1.0], [0.95, -0.12, 0.1, 0.78], [-0.95, -0.14, 0.05, 0.8], [0.45, 0.35, -0.2, 0.72], [-0.4, 0.3, 0.25, 0.7], [1.6, -0.3, 0, 0.5], [-1.65, -0.32, 0.1, 0.52]];
    const ws = S.touch ? 8 : 10, hs = S.touch ? 6 : 7;
    for (const [x, y, z, r] of blobs) {
      gb.add(new THREE.SphereGeometry(r, ws, hs), (v) => { const t = clamp((v.y + 0.5) / 1.2, 0, 1); return new THREE.Color(lerp(bot.r, top.r, t), lerp(bot.g, top.g, t), lerp(bot.b, top.b, t)); }, M4().makeTranslation(x, y, z), 0);
    }
    const g = gb.build();
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.45) p.setY(i, -0.45 - (p.getY(i) + 0.45) * 0.15);
    g.computeBoundingSphere();
    return g;
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

  // instanced decorations split into z-zones so frustum culling works per zone
  const ZONE = 100;
  function instanceZones(scene, geo, mat, items, opts) {
    if (!items.length) return [];
    const zones = new Map();
    for (const it of items) { const k = Math.floor(it.z / ZONE); if (!zones.has(k)) zones.set(k, []); zones.get(k).push(it); }
    const out = [];
    geo.computeBoundingSphere();
    const gr = geo.boundingSphere ? geo.boundingSphere.radius : 4;
    for (const list of zones.values()) {
      const g = new THREE.BufferGeometry();
      for (const name in geo.attributes) g.setAttribute(name, geo.attributes[name]);
      g.setIndex(geo.index);
      const mesh = new THREE.InstancedMesh(g, mat, list.length);
      let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9, ms = 1;
      list.forEach((it, i) => {
        _tmpE.set(it.rx || 0, it.ry || 0, it.rz || 0, 'YXZ');
        _tmpQ.setFromEuler(_tmpE);
        _tmpS.set(it.sx || it.s || 1, it.sy || it.s || 1, it.sz || it.s || 1);
        _tmpP.set(it.x, it.y, it.z);
        _tmpM.compose(_tmpP, _tmpQ, _tmpS);
        mesh.setMatrixAt(i, _tmpM);
        mnx = Math.min(mnx, it.x); mny = Math.min(mny, it.y); mnz = Math.min(mnz, it.z);
        mxx = Math.max(mxx, it.x); mxy = Math.max(mxy, it.y); mxz = Math.max(mxz, it.z);
        ms = Math.max(ms, _tmpS.x, _tmpS.y, _tmpS.z);
      });
      const c = new V3((mnx + mxx) / 2, (mny + mxy) / 2, (mnz + mxz) / 2);
      const rad = Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) / 2 + gr * ms + 2;
      g.boundingSphere = new THREE.Sphere(c, rad);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = true; // r128 turns culling off for InstancedMesh; the zone sphere above makes it valid
      mesh.castShadow = !!(opts && opts.cast);
      mesh.receiveShadow = !!(opts && opts.receive);
      scene.add(mesh);
      out.push(mesh);
    }
    return out;
  }

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
      const bg = new GB();
      const woodA = lin('#b77a3e'), woodB = lin('#9a6230'), woodD = lin('#6e421d'), rope = lin('#d9c08a');
      let k = 0;
      for (let z = zA - 0.55; z > zB + 0.4; z -= 1.12, k++) {
        const jit = (ihash(k, 3, 7) - 0.5) * 0.08;
        bg.add(new THREE.BoxGeometry(6, 0.26, 0.98), k % 2 ? woodA : woodB, TRS(p0.x, deckY - 0.13 + jit * 0.2, z, 0, jit, 0, 1), 0);
      }
      for (const sx of [-2.3, 2.3]) bg.add(new THREE.BoxGeometry(0.35, 0.35, zA - zB), woodD, M4().makeTranslation(p0.x + sx, deckY - 0.42, (zA + zB) / 2), 0);
      for (const sx of [-3.17, 3.17]) {
        for (let z = zA - 2; z >= zB + 2 - 0.01; z -= (zA - zB - 4) / 8) bg.add(new THREE.CylinderGeometry(0.13, 0.15, 1.5, 6), woodD, M4().makeTranslation(p0.x + sx, deckY + 0.3, z), 0);
        bg.add(new THREE.BoxGeometry(0.2, 0.14, zA - zB - 3.6), woodA, M4().makeTranslation(p0.x + sx, deckY + 0.95, (zA + zB) / 2), 0);
        bg.add(new THREE.CylinderGeometry(0.04, 0.04, zA - zB - 4, 4), rope, TRS(p0.x + sx, deckY + 0.5, (zA + zB) / 2, Math.PI / 2, 0, 0, 1), 0);
      }
      // stilts down into the water
      for (const z of [-430, -445, -460]) for (const sx of [-2.6, 2.6]) bg.add(new THREE.CylinderGeometry(0.22, 0.26, deckY + 3, 7), woodD, M4().makeTranslation(p0.x + sx, (deckY - 3) / 2 - 0.4, z), 0);
      const bm = new THREE.Mesh(bg.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }));
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
    const palmM = animMaterial('palm', { side: THREE.DoubleSide, roughness: 0.75 });
    const sunM = animMaterial('sunflower', { roughness: 0.7, side: THREE.DoubleSide });
    const flowM = animMaterial('flower', { roughness: 0.7, side: THREE.DoubleSide });
    const plainM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    const rockM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true });
    const totM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
    if (S.touch) {
      // phones: a quarter of the far-hill props and half the flowers, all in the same one mesh per zone as the props
      // along the route (no extra draw calls)
      for (const k in items) {
        let nf = 0, nl = 0;
        items[k] = items[k].filter(it => (it.far ? nf++ % 4 === 0 : true) && (k === 'flower' ? nl++ % 2 === 0 : true));
      }
    }
    const zones = (geo, mat, list, opts) => instanceZones(scene, geo, mat, list, opts);
    zones(palmGeo(), palmM, items.palm, { cast: true });
    zones(sunflowerGeo(), sunM, items.sunflower, { cast: true });
    zones(flowerGeo(), flowM, items.flower, {});
    zones(bushGeo(), plainM, items.bush, { cast: true, receive: true });
    zones(rockGeo(), rockM, items.rock, { cast: true, receive: true });
    instanceZones(scene, totemGeo(), totM, items.totem, { cast: true, receive: true });
    S.decorCounts = { palm: items.palm.length, sunflower: items.sunflower.length, flower: items.flower.length, bush: items.bush.length, rock: items.rock.length, totem: items.totem.length };
  }

  // ======================= waterfalls =======================
  function waterfallTexture() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, 'rgba(170,225,255,0.0)'); gr.addColorStop(0.12, 'rgba(185,232,255,0.82)'); gr.addColorStop(0.88, 'rgba(185,232,255,0.82)'); gr.addColorStop(1, 'rgba(170,225,255,0.0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 256);
    const rng = rngOf(77);
    for (let i = 0; i < 46; i++) {
      const x = 6 + rng() * 52, y = rng() * 256, h = 20 + rng() * 90, w = 1 + rng() * 2.5;
      g.fillStyle = `rgba(255,255,255,${0.35 + rng() * 0.55})`;
      g.fillRect(x, y, w, h); g.fillRect(x, y - 256, w, h);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function buildWaterfalls(scene) {
    const tex = waterfallTexture();
    S.wfTex = tex;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0xffffff });
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
      m.renderOrder = 2;
      scene.add(m);
    }
    if (mistPts.length) {
      const pos = new Float32Array(mistPts.length * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pm = new THREE.PointsMaterial({ size: 4.2, map: glowTexture(64, [[0, 'rgba(255,255,255,0.9)'], [0.5, 'rgba(240,250,255,0.35)'], [1, 'rgba(240,250,255,0)']]), transparent: true, depthWrite: false, sizeAttenuation: true, color: 0xffffff });
      const pts = new THREE.Points(g, pm);
      pts.frustumCulled = false; pts.renderOrder = 3;
      scene.add(pts);
      S.mist = pts; S.mistData = mistPts;
      updateMist();
    }
  }
  function updateMist() {
    if (!S.mist) return;
    const a = S.mist.geometry.attributes.position, t = S.time;
    S.mistData.forEach((m, i) => { a.setXYZ(i, m.x + Math.sin(t * 0.9 + m.ph) * 0.4, 0.5 + Math.abs(Math.sin(t * 1.3 + m.ph)) * 1.2, m.z + Math.cos(t * 0.7 + m.ph) * 0.4); });
    a.needsUpdate = true;
  }

  // ======================= sky dressing: clouds, birds, far islands =======================
  function buildClouds(scene) {
    const rng = rngOf(4242);
    const geo = cloudGeo();
    // clouds are lit by the sun and their own glow, not by the island's environment (its green lower half)
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, emissive: lin('#8ea6c8'), emissiveIntensity: 0.55, envMapIntensity: 0 });
    const n = 26;
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    for (let i = 0; i < n; i++) {
      S.cloudData.push({ x: -380 + rng() * 760, y: 70 + rng() * 70, z: 220 - rng() * 1120, sx: 11 + rng() * 15, sy: 5 + rng() * 4, sz: 8 + rng() * 7, ry: rng() * TAU, v: 1.2 + rng() * 1.6 });
    }
    mesh.frustumCulled = false;
    scene.add(mesh);
    S.clouds = mesh;
    updateClouds();
  }
  function updateClouds() {
    const m = S.clouds; if (!m) return;
    for (let i = 0; i < S.cloudData.length; i++) {
      const c = S.cloudData[i];
      let x = c.x + c.v * S.time;
      x = ((x + 420) % 840 + 840) % 840 - 420;
      _tmpE.set(0, c.ry, 0); _tmpQ.setFromEuler(_tmpE); _tmpS.set(c.sx, c.sy, c.sz); _tmpP.set(x, c.y, c.z);
      _tmpM.compose(_tmpP, _tmpQ, _tmpS); m.setMatrixAt(i, _tmpM);
    }
    m.instanceMatrix.needsUpdate = true;
  }
  function buildBirds(scene) {
    const geo = birdGeo();
    const mat = animMaterial('bird', { roughness: 0.8, side: THREE.DoubleSide });
    const flocks = [[-10, 46, -40, 22], [25, 52, -250, 28], [-20, 40, -420, 20], [15, 50, -600, 30]];
    for (let f = 0; f < flocks.length; f++) for (let k = 0; k < 4; k++) {
      S.birdData.push({ cx: R(flocks[f][2], 0).x + flocks[f][0], cy: flocks[f][1] + k * 1.3, cz: flocks[f][2], r: flocks[f][3] + k * 2.2, w: (0.28 + 0.05 * f) * (f % 2 ? -1 : 1), ph: k * 0.32 + f });
    }
    const mesh = new THREE.InstancedMesh(geo, mat, S.birdData.length);
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
      gb.add(g, (v, lx, ly) => {
        const t = clamp((ly + 6) / h, 0, 1);
        const c = new THREE.Color(lerp(hor.r, top.r, Math.pow(t, 0.6)), lerp(hor.g, top.g, Math.pow(t, 0.6)), lerp(hor.b, top.b, Math.pow(t, 0.6)));
        if (!kind && t > 0.78) c.lerp(snow, clamp((t - 0.78) * 6, 0, 1));
        return c;
      }, M4().makeTranslation(Math.cos(a) * dist, 0, Math.sin(a) * dist), 0);
    }
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false });
    S.farMat = mat;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uCamXZ = CAMXZ;
      // kept just inside the far plane: the islands stand beyond the fog, and phones use a shorter view distance
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec2 uCamXZ;').replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xz += uCamXZ;')
        .replace('#include <project_vertex>', '#include <project_vertex>\ngl_Position.z = min(gl_Position.z, gl_Position.w * 0.99995);');
    };
    mat.customProgramCacheKey = () => 'kitFarIslands';
    const mesh = new THREE.Mesh(gb.build(), mat);
    mesh.frustumCulled = false; mesh.renderOrder = -50;
    scene.add(mesh);
  }

  // ======================= animation =======================
  function animate(dt) {
    S.time += dt;
    TIME.value = S.time;
    if (S.wfTex) S.wfTex.offset.y = (S.wfTex.offset.y + dt * 1.15) % 1;
    updateClouds();
    updateBirds();
    updateMist();
  }

  // ======================= post pipeline + image-based lighting =======================
  // The island hands its sun to the post pipeline (light shafts) and builds the environment map from a vantage
  // point above the start (every PBR material without its own envMap gets sky reflections and sky light from it).
  const SUN_HEX = '#fff0d4';
  function startPost() {
    const P = K.post;
    if (!P || typeof P.init !== 'function') return;
    try {
      P.setSun(SUN_DIR, SUN_HEX);
      P.init();
      S.envPos.copy(K.level.start.pos).add(_envUp);
      P.refreshEnvironment(S.envPos);
    } catch (e) { console.warn('Kit Rush 3D: post pipeline not started', e); }
    balanceLights();
  }
  const _envUp = new V3(0, 16, -6);
  // with the environment map lighting the PBR materials, the hemisphere fill steps back (same total ambient)
  function balanceLights() {
    if (!S.hemi) return;
    S.hemi.intensity = S.scene && S.scene.environment ? HEMI_ENV : HEMI_BASE;
  }
  const HEMI_BASE = 0.6, HEMI_ENV = 0.22;

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
      buildSolids(scene);
      buildLoops(scene);
      buildPlacements();
      buildDecor(scene);
      buildWaterfalls(scene);
      buildClouds(scene);
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
            K.post.refreshEnvironment(S.envPos);
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
      void t;
    },
    get time() { return S.time; },
    get decorCounts() { return S.decorCounts; }
  };
})();
