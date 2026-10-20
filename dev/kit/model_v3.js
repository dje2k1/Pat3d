// ===================== model =====================
// v3 (SPEC3 §5). Kit keeps the v2 rig (same groups, pivots and pose code: the groups are now THREE.Bone) and the v2
// shapes and proportions, but the body is sculpted: every v2 part becomes a signed-distance primitive (ellipsoids,
// cones, tori, tapered limbs) blended with smooth unions / carves / paint regions, meshed once at load time with
// surface nets and skinned to the rig with soft weights (smooth elbows, knees, tail). One skinned body draw, one face
// detail draw (eyes with iris, cornea, blinking lids and gaze; glossy nose; mouth), one shell-fur draw (K.gfx.furShells
// layers in a single geometry, strand map, motion / wind lag) and the scarf.
const COL = {
  fur: lin('#f47a1f'), furD: lin('#c4510f'), furL: lin('#ffb35e'), white: lin('#fff4e6'), glove: lin('#fbfbff'),
  line: lin('#3d1707'), shoe: lin('#17b6c3'), shoeD: lin('#0c7480'), sole: lin('#f2f4f8'), scarf: lin('#2f5bff'), scarfD: lin('#1c39b4'),
  eye: lin('#22c36a'), eyeD: lin('#0b6e36'), pupil: lin('#08130c'), inner: lin('#6a2408'), nose: lin('#1a0b05'), eyeW: lin('#ffffff'),
  earTip: lin('#7a3410')
};
const _tc = new THREE.Color();
const mix = (a, b, t) => _tc.copy(a).lerp(b, clamp(t, 0, 1));

// merges transformed primitives into one vertex-coloured geometry with a per-vertex roughness attribute (board parts)
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
      this.c.push(c.r, c.g, c.b); this.r.push(typeof rough === 'function' ? rough(_bl, _bv, _bn) : rough);
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
  const arc = new THREE.TorusGeometry(1, 0.13, 8, 20, Math.PI * 0.8);
  arc.rotateZ(-Math.PI * 0.9); // centre the arc on the bottom so it reads as a smile
  GEO = {
    sph: new THREE.SphereGeometry(1, 30, 22),
    sphM: new THREE.SphereGeometry(1, 20, 14),
    sphS: new THREE.SphereGeometry(1, 12, 9),
    cone: new THREE.ConeGeometry(1, 1, 20, 3),
    tor: new THREE.TorusGeometry(1, 0.32, 10, 30),
    box: new THREE.BoxGeometry(1, 1, 1),
    arc,
    eye: new THREE.SphereGeometry(1, 40, 30)
  };
}
function limb(rt, rb, len, rs) {
  const g = new THREE.CylinderGeometry(rt, rb, len, rs || 14, 2, true);
  g.translate(0, -len / 2, 0);
  return g;
}

// ---------- signed-distance sculpting (CPU, once at load) ----------
// A primitive lives in a bone's local frame (the v2 TRS of the part); its distance is evaluated in rig space at the
// bind pose. ops: 'u' smooth union (k), 's' smooth carve (k), 'p' paint only (colour / material inside, soft edge).
// mat = [roughness, fur length (0 = none, 1 = body, > 1 longer), fabric, thinness (translucency)].
const MAT = {
  fur: [0.62, 1, 0, 0.12], furW: [0.66, 1, 0, 0.16], face: [0.64, 0.32, 0, 0.12], muzzle: [0.68, 0.16, 0, 0.14],
  cheek: [0.66, 1.55, 0, 0.3], tuft: [0.64, 1.25, 0, 0.2], ear: [0.6, 0.75, 0, 0.85], earIn: [0.72, 0.3, 0, 1], earW: [0.7, 1.15, 0, 0.9],
  tail: [0.66, 1.65, 0, 0.42], brow: [0.7, 0.2, 0, 0.1],
  scarf: [0.86, 0, 1, 0], glove: [0.6, 0, 0.55, 0], shoe: [0.24, 0, 0, 0], shoeD: [0.42, 0, 0.2, 0], sole: [0.72, 0, 0, 0], stripe: [0.4, 0, 0, 0]
};
const smin = (a, b, k) => { if (!(k > 0)) return a < b ? a : b; const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
function sdEll(x, y, z, rx, ry, rz) {
  const ax = x / rx, ay = y / ry, az = z / rz;
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const bx = ax / rx, by = ay / ry, bz = az / rz;
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  return k1 > 1e-12 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
}
// capped cone, base radius r1 at y = -0.5, top radius r2 at y = +0.5 (three's ConeGeometry(1, 1) frame)
function sdCone(x, y, z, r1, r2) {
  const h = 0.5, qx = Math.hypot(x, z), qy = y;
  const k2x = r2 - r1, k2y = 2 * h;
  const cax = qx - Math.min(qx, qy < 0 ? r1 : r2), cay = Math.abs(qy) - h;
  const t = clamp(((r2 - qx) * k2x + (h - qy) * k2y) / (k2x * k2x + k2y * k2y), 0, 1);
  const cbx = qx - r2 + k2x * t, cby = qy - h + k2y * t;
  const s = cbx < 0 && cay < 0 ? -1 : 1;
  return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
}
const _pm = new THREE.Matrix4();
// type: 'E' ellipsoid (s = radii), 'C' cone (s = scale of the unit cone, o.tip = top radius), 'T' torus (unit ring in
// XY, o.tube), 'L' tapered limb from (0,0,0) to (0,-len,0) of the frame (s = [r1, r2, len])
function mkPrim(type, bindM, x, y, z, ax, ay, az, s, o) {
  _pm.copy(bindM).multiply(TRS(x, y, z, ax, ay, az, 1, 1, 1));
  const e = _pm.elements;
  const r00 = e[0], r10 = e[1], r20 = e[2], r01 = e[4], r11 = e[5], r21 = e[6], r02 = e[8], r12 = e[9], r22 = e[10];
  const cx = e[12], cy = e[13], cz = e[14];
  const P = Object.assign({ t: type, op: 'u', k: 0, kc: 0, col: null, mat: null, fn: null, soft: 0.01, bone: 0, fur: null }, o);
  P.loc = (px, py, pz, out) => {
    const dx = px - cx, dy = py - cy, dz = pz - cz;
    out[0] = r00 * dx + r10 * dy + r20 * dz; out[1] = r01 * dx + r11 * dy + r21 * dz; out[2] = r02 * dx + r12 * dy + r22 * dz;
    return out;
  };
  const L = [0, 0, 0];
  let R = 0;
  if (type === 'E') {
    const [rx, ry, rz] = s;
    P.d = (px, py, pz) => { P.loc(px, py, pz, L); return sdEll(L[0], L[1], L[2], rx, ry, rz); };
    P.unit = (px, py, pz, out) => { P.loc(px, py, pz, out); out[0] /= rx; out[1] /= ry; out[2] /= rz; return out; };
    R = Math.max(rx, ry, rz);
  } else if (type === 'C') {
    const [sx, sy, sz] = s, mn = Math.min(sx, sy, sz), tip = P.tip != null ? P.tip : 0.06;
    P.d = (px, py, pz) => { P.loc(px, py, pz, L); return sdCone(L[0] / sx, L[1] / sy, L[2] / sz, 1, tip) * mn; };
    P.unit = (px, py, pz, out) => { P.loc(px, py, pz, out); out[0] /= sx; out[1] /= sy; out[2] /= sz; return out; };
    R = Math.max(sx, sy, sz) * 1.12;
  } else if (type === 'T') {
    const [sx, sy, sz] = s, mn = Math.min(sx, sy, sz), tube = P.tube != null ? P.tube : 0.32;
    P.d = (px, py, pz) => { P.loc(px, py, pz, L); const ux = L[0] / sx, uy = L[1] / sy, uz = L[2] / sz; return (Math.hypot(Math.hypot(ux, uy) - 1, uz) - tube) * mn; };
    P.unit = (px, py, pz, out) => { P.loc(px, py, pz, out); out[0] /= sx; out[1] /= sy; out[2] /= sz; return out; };
    R = Math.max(sx, sy, sz) * (1 + tube);
  } else { // 'L': iq's round cone between a = origin (radius r1) and b = (0, -len, 0) (radius r2)
    const [r1, r2, len] = s;
    const bax = 0, bay = -len, baz = 0, l2 = len * len, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
    P.d = (px, py, pz) => {
      P.loc(px, py, pz, L);
      const pax = L[0], pay = L[1], paz = L[2];
      const yy = pax * bax + pay * bay + paz * baz, zz = yy - l2;
      const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy;
      const x2 = qx * qx + qy * qy + qz * qz, y2 = yy * yy * l2, z2 = zz * zz * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
      if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
      return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
    };
    P.unit = (px, py, pz, out) => { P.loc(px, py, pz, out); out[1] /= len; return out; };
    R = Math.max(r1, r2) + len * 0.5;
    // centre of the bound: the middle of the segment
    const mx = cx - r01 * len * 0.5, my = cy - r11 * len * 0.5, mz = cz - r21 * len * 0.5;
    P.bb = [mx - R, my - R, mz - R, mx + R, my + R, mz + R];
  }
  if (!P.bb) P.bb = [cx - R, cy - R, cz - R, cx + R, cy + R, cz + R];
  return P;
}

// one surface: grid -> field (primitive-major, bounded) -> naive surface nets -> projection onto the zero set ->
// colours / materials / bone weights from the primitives that own each vertex
const _u3 = [0, 0, 0], _n3 = new V3(), _cc = new THREE.Color();
function sculpt(ch, h, opts) {
  opts = opts || {};
  const U = ch.prims.filter(p => p.op !== 'p'), Pn = ch.prims.filter(p => p.op === 'p');
  const off = ch.off || 0;
  let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  for (const p of U) if (p.op === 'u') { x0 = Math.min(x0, p.bb[0]); y0 = Math.min(y0, p.bb[1]); z0 = Math.min(z0, p.bb[2]); x1 = Math.max(x1, p.bb[3]); y1 = Math.max(y1, p.bb[4]); z1 = Math.max(z1, p.bb[5]); }
  const pad = 3 * h;
  x0 -= pad; y0 -= pad; z0 -= pad; x1 += pad; y1 += pad; z1 += pad;
  const nx = Math.ceil((x1 - x0) / h) + 1, ny = Math.ceil((y1 - y0) / h) + 1, nz = Math.ceil((z1 - z0) / h) + 1, sxy = nx * ny;
  const F = new Float32Array(nx * ny * nz).fill(1);
  for (const p of U) {
    const m = (p.k || 0) + 2.5 * h;
    const i0 = Math.max(0, Math.floor((p.bb[0] - m - x0) / h)), i1 = Math.min(nx - 1, Math.ceil((p.bb[3] + m - x0) / h));
    const j0 = Math.max(0, Math.floor((p.bb[1] - m - y0) / h)), j1 = Math.min(ny - 1, Math.ceil((p.bb[4] + m - y0) / h));
    const k0 = Math.max(0, Math.floor((p.bb[2] - m - z0) / h)), k1 = Math.min(nz - 1, Math.ceil((p.bb[5] + m - z0) / h));
    const un = p.op === 'u', k = p.k || 0;
    for (let kk = k0; kk <= k1; kk++) {
      const z = z0 + kk * h;
      for (let j = j0; j <= j1; j++) {
        const y = y0 + j * h;
        let idx = kk * sxy + j * nx + i0;
        for (let i = i0; i <= i1; i++, idx++) {
          const d = p.d(x0 + i * h, y, z);
          F[idx] = un ? smin(F[idx], d, k) : smax(F[idx], -d, k);
        }
      }
    }
  }
  if (off) for (let i = 0; i < F.length; i++) F[i] += off;
  const field = (x, y, z) => {
    let d = 1;
    for (let i = 0; i < U.length; i++) { const p = U[i], di = p.d(x, y, z); d = p.op === 'u' ? smin(d, di, p.k) : smax(d, -di, p.k); }
    return d + off;
  };
  // cells crossing the surface -> one vertex each (mean of the edge crossings)
  const cw = nx - 1, chh = ny - 1, cd = nz - 1;
  const cellV = new Int32Array(cw * chh * cd).fill(-1);
  const VP = [];
  const cv = new Float32Array(8);
  for (let kk = 0; kk < cd; kk++) for (let j = 0; j < chh; j++) for (let i = 0; i < cw; i++) {
    const b = kk * sxy + j * nx + i;
    cv[0] = F[b]; cv[1] = F[b + 1]; cv[2] = F[b + nx]; cv[3] = F[b + nx + 1];
    cv[4] = F[b + sxy]; cv[5] = F[b + sxy + 1]; cv[6] = F[b + sxy + nx]; cv[7] = F[b + sxy + nx + 1];
    let mask = 0;
    for (let c = 0; c < 8; c++) if (cv[c] < 0) mask |= 1 << c;
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let a = 0; a < 8; a++) for (const bit of [1, 2, 4]) {
      if (a & bit) continue;
      const c2 = a | bit, va = cv[a], vb = cv[c2];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      const ax = a & 1, ay = (a >> 1) & 1, az = (a >> 2) & 1;
      sx += ax + (bit === 1 ? t : 0); sy += ay + (bit === 2 ? t : 0); sz += az + (bit === 4 ? t : 0); n++;
    }
    cellV[kk * cw * chh + j * cw + i] = VP.length / 3;
    VP.push(x0 + (i + sx / n) * h, y0 + (j + sy / n) * h, z0 + (kk + sz / n) * h);
  }
  const cell = (i, j, kk) => cellV[kk * cw * chh + j * cw + i];
  const IDX = [];
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    const dac = (VP[a * 3] - VP[c * 3]) ** 2 + (VP[a * 3 + 1] - VP[c * 3 + 1]) ** 2 + (VP[a * 3 + 2] - VP[c * 3 + 2]) ** 2;
    const dbd = (VP[b * 3] - VP[d * 3]) ** 2 + (VP[b * 3 + 1] - VP[d * 3 + 1]) ** 2 + (VP[b * 3 + 2] - VP[d * 3 + 2]) ** 2;
    if (dac <= dbd) IDX.push(a, b, c, a, c, d); else IDX.push(a, b, d, b, c, d);
  };
  for (let kk = 1; kk < nz - 1; kk++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = F[kk * sxy + j * nx + i], b = F[kk * sxy + j * nx + i + 1];
    if ((a < 0) === (b < 0)) continue;
    const c00 = cell(i, j - 1, kk - 1), c10 = cell(i, j, kk - 1), c11 = cell(i, j, kk), c01 = cell(i, j - 1, kk);
    if (a < 0) quad(c00, c10, c11, c01); else quad(c00, c01, c11, c10);
  }
  for (let kk = 1; kk < nz - 1; kk++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = F[kk * sxy + j * nx + i], b = F[kk * sxy + (j + 1) * nx + i];
    if ((a < 0) === (b < 0)) continue;
    const c00 = cell(i - 1, j, kk - 1), c10 = cell(i - 1, j, kk), c11 = cell(i, j, kk), c01 = cell(i, j, kk - 1);
    if (a < 0) quad(c00, c10, c11, c01); else quad(c00, c01, c11, c10);
  }
  for (let kk = 0; kk < nz - 1; kk++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = F[kk * sxy + j * nx + i], b = F[(kk + 1) * sxy + j * nx + i];
    if ((a < 0) === (b < 0)) continue;
    const c00 = cell(i - 1, j - 1, kk), c10 = cell(i, j - 1, kk), c11 = cell(i, j, kk), c01 = cell(i - 1, j, kk);
    if (a < 0) quad(c00, c10, c11, c01); else quad(c00, c01, c11, c10);
  }
  // project the vertices onto the zero set (Newton steps along the gradient) and take the gradient as the normal
  const nv = VP.length / 3, E = h * 0.2;
  const NRM = new Float32Array(nv * 3);
  const grad = (x, y, z, out) => {
    const a = field(x + E, y - E, z - E), b = field(x - E, y - E, z + E), c = field(x - E, y + E, z - E), d = field(x + E, y + E, z + E);
    out.set(a - b - c + d, -a - b + c + d, -a + b - c + d);
    return out;
  };
  for (let v = 0; v < nv; v++) {
    let x = VP[v * 3], y = VP[v * 3 + 1], z = VP[v * 3 + 2];
    for (let it = 0; it < 3; it++) {
      const d = field(x, y, z);
      grad(x, y, z, _n3);
      const g2 = _n3.lengthSq();
      if (!(g2 > 1e-20)) break;
      let st = d / Math.sqrt(g2);
      if (st > h) st = h; else if (st < -h) st = -h;
      _n3.normalize();
      x -= _n3.x * st; y -= _n3.y * st; z -= _n3.z * st;
      if (Math.abs(d) < h * 0.01) break;
    }
    grad(x, y, z, _n3); if (_n3.lengthSq() < 1e-20) _n3.set(0, 1, 0); _n3.normalize();
    VP[v * 3] = x; VP[v * 3 + 1] = y; VP[v * 3 + 2] = z;
    NRM[v * 3] = _n3.x; NRM[v * 3 + 1] = _n3.y; NRM[v * 3 + 2] = _n3.z;
  }
  // per-vertex attributes from the owning primitives
  const COLS = new Float32Array(nv * 3), MATS = new Float32Array(nv * 4), SI = new Uint16Array(nv * 4), SW = new Float32Array(nv * 4);
  const dist = new Float32Array(U.length), bw = new Map();
  const kw = ch.kw || 0.03, hasCarve = U.some(p => p.op === 's');
  for (let v = 0; v < nv; v++) {
    const x = VP[v * 3], y = VP[v * 3 + 1], z = VP[v * 3 + 2];
    _n3.set(NRM[v * 3], NRM[v * 3 + 1], NRM[v * 3 + 2]);
    let dmin = 1e9, own = 0, uin = 1e9;
    for (let i = 0; i < U.length; i++) {
      const un = U[i].op === 'u', di = U[i].d(x, y, z) + (un ? off : -off); dist[i] = di;
      if (un && di < uin) uin = di;
    }
    // a carve surface owns the vertex when the vertex is inside the union (the carved cup)
    const carved = hasCarve && uin < -0.004;
    for (let i = 0; i < U.length; i++) {
      const p = U[i], e = p.op === 'u' ? (carved ? 1e9 : Math.max(0, dist[i])) : (carved ? Math.abs(dist[i]) : 1e9);
      if (e < dmin) { dmin = e; own = i; }
    }
    const kco = Math.max(U[own].kc || U[own].k || 0, 0.004);
    let wt = 0, cr = 0, cg = 0, cb = 0, m0 = 0, m1 = 0, m2 = 0, m3 = 0;
    bw.clear();
    for (let i = 0; i < U.length; i++) {
      const p = U[i];
      const e = p.op === 'u' ? (carved ? 1e9 : Math.max(0, dist[i])) : (carved ? Math.abs(dist[i]) : 1e9);
      const kc = Math.max(Math.min(Math.max(p.kc || p.k || 0, 0.004), kco), 0.004);
      const a = Math.max(0, 1 - (e - dmin) / kc), w = a * a;
      if (w > 0) {
        const c = p.fn ? p.fn(p.unit(x, y, z, _u3), _n3, x, y, z) : p.col;
        cr += c.r * w; cg += c.g * w; cb += c.b * w;
        const mt = p.mat || MAT.fur;
        m0 += mt[0] * w; m1 += mt[1] * w; m2 += mt[2] * w; m3 += mt[3] * w;
        wt += w;
      }
      const ab = Math.max(0, 1 - (e - dmin) / kw), wb = ab * ab;
      if (wb > 0) bw.set(p.bone, (bw.get(p.bone) || 0) + wb);
    }
    cr /= wt; cg /= wt; cb /= wt; m0 /= wt; m1 /= wt; m2 /= wt; m3 /= wt;
    for (const p of Pn) {
      const d = p.d(x, y, z);
      if (d > p.soft) continue;
      const a = (1 - smooth((d + p.soft) / (2 * p.soft))) * (p.str == null ? 1 : p.str);
      if (p.col || p.fn) {
        const c = p.fn ? p.fn(p.unit(x, y, z, _u3), _n3, x, y, z) : p.col;
        cr += (c.r - cr) * a; cg += (c.g - cg) * a; cb += (c.b - cb) * a;
      }
      if (p.mat) { m0 += (p.mat[0] - m0) * a; m1 += (p.mat[1] - m1) * a; m2 += (p.mat[2] - m2) * a; m3 += (p.mat[3] - m3) * a; }
    }
    COLS[v * 3] = cr; COLS[v * 3 + 1] = cg; COLS[v * 3 + 2] = cb;
    MATS[v * 4] = m0; MATS[v * 4 + 1] = m1; MATS[v * 4 + 2] = m2; MATS[v * 4 + 3] = m3;
    const top = [...bw.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    let ws = 0; for (const t of top) ws += t[1];
    for (let q = 0; q < 4; q++) { const t = top[q]; SI[v * 4 + q] = t ? t[0] : 0; SW[v * 4 + q] = t ? t[1] / ws : 0; }
  }
  return { pos: VP, nrm: NRM, col: COLS, mat: MATS, si: SI, sw: SW, idx: IDX, n: nv, grid: [nx, ny, nz] };
}
// concatenates sculpted surfaces into one skinned geometry; opts.shells = n copies with a 'kshell' index (inner -> outer),
// opts.minFur drops the triangles that grow no fur
function skinGeometry(parts, opts) {
  opts = opts || {};
  const copies = opts.shells || 1;
  const keepTri = (s, a, b, c) => !opts.minFur || Math.max(s.mat[a * 4 + 1], s.mat[b * 4 + 1], s.mat[c * 4 + 1]) >= opts.minFur;
  let nv = 0, ni = 0;
  const tris = parts.map(s => { const t = []; for (let i = 0; i < s.idx.length; i += 3) if (keepTri(s, s.idx[i], s.idx[i + 1], s.idx[i + 2])) t.push(s.idx[i], s.idx[i + 1], s.idx[i + 2]); return t; });
  parts.forEach((s, i) => { nv += s.n; ni += tris[i].length; });
  const P = new Float32Array(nv * 3 * copies), N = new Float32Array(nv * 3 * copies), C = new Float32Array(nv * 3 * copies),
    M = new Float32Array(nv * 4 * copies), SI = new Uint16Array(nv * 4 * copies), SW = new Float32Array(nv * 4 * copies);
  const SH = copies > 1 ? new Float32Array(nv * copies) : null;
  const I = nv * copies > 65535 ? new Uint32Array(ni * copies) : new Uint16Array(ni * copies);
  let vo = 0, io = 0;
  for (let c = 0; c < copies; c++) {
    parts.forEach((s, k) => {
      P.set(s.pos, vo * 3); N.set(s.nrm, vo * 3); C.set(s.col, vo * 3); M.set(s.mat, vo * 4); SI.set(s.si, vo * 4); SW.set(s.sw, vo * 4);
      if (SH) SH.fill(c, vo, vo + s.n);
      const t = tris[k];
      for (let i = 0; i < t.length; i++) I[io + i] = t[i] + vo;
      vo += s.n; io += t.length;
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('kcol', new THREE.BufferAttribute(C, 3));
  g.setAttribute('kmat', new THREE.BufferAttribute(M, 4));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
  if (SH) g.setAttribute('kshell', new THREE.BufferAttribute(SH, 1));
  g.setIndex(new THREE.BufferAttribute(I, 1));
  g.userData.perCopy = ni; // indices per shell layer
  g.boundingSphere = new THREE.Sphere(new V3(0, 0.6, 0), 1.5);
  return g;
}

// ---------- TSL materials ----------
const { Fn, uniform, attribute, texture: ttex, float, vec2, vec3, vec4, clamp: tclamp, abs: tabs, dot: tdot, normalize: tnormalize,
  pow: tpow, sin: tsin, atan: tatan, mix: tmix, max: tmax, min: tmin, smoothstep: tsmooth, select, length: tlen, fwidth,
  normalView, positionView, positionGeometry, normalGeometry, positionLocal, normalLocal, faceDirection, uv: tuv,
  instancedBufferAttribute } = TSL;
// shared look uniforms (one Kit): rim light, fur shells, lids / gaze
const KU = {
  rim: uniform(lin('#fff1d6').multiplyScalar(0.55)),
  furScale: uniform(3.2), furLen: uniform(0.022), shells: uniform(10), lag: uniform(new V3()), bump: uniform(0.9),
  sss: uniform(0.8),
  lid: uniform(new THREE.Vector4(1.3, 1.3, -1.4, -1.4)), curv: uniform(new THREE.Vector2(0.16, 0.16)), gaze: uniform(new THREE.Vector2()), xeyes: uniform(0)
};
let FURT = null, KNITT = null;
function kitTextures() {
  if (FURT) return;
  const T = K.tex;
  const mk = (name, fb) => (T && typeof T.load === 'function' ? T.load(name, { colorSpace: 'linear', fallback: fb }) : (() => { const t = new THREE.DataTexture(new Uint8Array(fb), 1, 1); t.needsUpdate = true; return t; })());
  FURT = mk('kit/fur', [118, 128, 128, 255]);
  KNITT = mk('kit/knit', [128, 128, 230, 255]);
}
// triplanar lookup on the rest-pose (bind) position: no UVs, no seams, the same strands on every shell layer
function tri(tex, scale) {
  const n = normalGeometry.abs(), w0 = n.mul(n).mul(n).mul(n);
  const w = w0.div(w0.x.add(w0.y).add(w0.z));
  const p = positionGeometry.mul(scale);
  return ttex(tex, p.zy).mul(w.x).add(ttex(tex, p.xz).mul(w.y)).add(ttex(tex, p.xy).mul(w.z));
}
// bump from any height expression (screen-space derivatives, Mikkelsen's surface gradient)
function bumpN(hgt, scale) {
  const dh = vec2(hgt.dFdx(), hgt.dFdy()).mul(scale);
  const sx = positionView.dFdx().normalize(), sy = positionView.dFdy().normalize(), n = normalView;
  const r1 = sy.cross(n), r2 = n.cross(sx);
  const det = sx.dot(r1).mul(faceDirection);
  const g = det.sign().mul(dh.x.mul(r1).add(dh.y.mul(r2)));
  return det.abs().mul(n).sub(g).normalize();
}
const ism = (a, b, x) => float(1).sub(tsmooth(a, b, x)); // 1 below a -> 0 above b
function rimTerm(k) {
  const r = float(1).sub(tclamp(tabs(tdot(tnormalize(normalView), tnormalize(positionView.negate()))), 0, 1));
  return KU.rim.mul(r.mul(r).mul(r)).mul(tclamp(normalView.y.mul(0.5).add(0.5), 0, 1).mul(0.65).add(0.35)).mul(k == null ? 1 : k);
}
// Kit's skin and clothes: vertex albedo + per-vertex [roughness, fur, fabric, thin]; fur strands (bump, tone), knit,
// sheen on fur and fabric, translucency (ears, tail) through MeshSSSNodeMaterial, warm rim light
function bodyMaterial() {
  kitTextures();
  const m = new THREE.MeshSSSNodeMaterial({ roughness: 0.65, metalness: 0 });
  const col = attribute('kcol', 'vec3'), mt = attribute('kmat', 'vec4');
  const fur = tclamp(mt.y, 0, 1), fab = mt.z, thin = mt.w;
  const f = tri(FURT, KU.furScale);
  const kn = tri(KNITT, float(30));
  const tone = float(1).add(f.z.sub(0.5).mul(0.2)).add(f.y.sub(0.5).mul(0.16)).mul(f.x.mul(0.34).add(0.7));
  const ktone = kn.z.mul(0.25).add(0.8).add(kn.y.sub(0.5).mul(0.12));
  m.colorNode = col.mul(tmix(float(1), tone, fur)).mul(tmix(float(1), ktone, fab));
  m.roughnessNode = tclamp(mt.x.add(f.x.oneMinus().mul(fur).mul(0.12)), 0.08, 1);
  m.metalnessNode = float(0);
  m.normalNode = bumpN(f.x.mul(fur).mul(KU.bump).add(kn.x.mul(fab).mul(0.5)), float(1));
  m.sheenNode = col.mul(0.45).add(0.06).mul(fur.mul(0.85).add(fab.mul(0.8)));
  m.sheenRoughnessNode = float(0.45);
  m.thicknessColorNode = col.mul(thin).mul(KU.sss);
  m.thicknessDistortionNode = float(0.3);
  m.thicknessAmbientNode = float(0.14);
  m.thicknessAttenuationNode = float(0.75);
  m.thicknessPowerNode = float(3);
  m.thicknessScaleNode = float(3.2);
  m.emissiveNode = rimTerm().mul(tmix(float(1), col.mul(1.4).add(0.3), fur.mul(0.6)));
  return m;
}
// fur shells: layer h = (i + 1) / n pushed out along the skinned normal, bent by the lag vector (motion, gravity, wind);
// a strand map decides where a layer is opaque (tapered, clumped strands), mip-mapped so it averages smoothly far away
function shellMaterial() {
  kitTextures();
  const m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: 0.8, metalness: 0 });
  m.alphaTest = 0.02;
  const col = attribute('kcol', 'vec3'), mt = attribute('kmat', 'vec4'), si = attribute('kshell', 'float');
  const h = si.add(1).div(KU.shells);
  const len = mt.y.mul(KU.furLen);
  m.positionNode = positionLocal.add(normalLocal.normalize().mul(h.mul(len))).add(KU.lag.mul(h.mul(h)).mul(mt.y));
  const f = tri(FURT, KU.furScale);
  const hv = h.mul(0.94);
  const a = tsmooth(hv.sub(0.07), hv.add(0.05), f.x);
  m.opacityNode = a.mul(tclamp(mt.y.mul(3), 0, 1)).mul(float(1).sub(h.mul(0.3)));
  const tone = float(1).add(f.z.sub(0.5).mul(0.22)).add(f.y.sub(0.5).mul(0.16));
  m.colorNode = col.mul(h.mul(0.5).add(0.5)).mul(tone);
  m.roughnessNode = float(0.78);
  m.emissiveNode = rimTerm(h.mul(0.8).add(0.2)).mul(col.mul(1.2).add(0.35));
  return m;
}
// face details: eyes (sclera, iris with fibres and limbal ring, pupil, catch-lights, cornea clear coat, upper / lower
// lids in the fur colour with a lash line, gaze offset, X when knocked out), glossy nose, mouth line
function detailMaterial() {
  const m = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.5, metalness: 0 });
  const col = attribute('kcol', 'vec3'), part = attribute('kpart', 'float'), e = attribute('kuv', 'vec2'), side = attribute('kside', 'float');
  const ex = e.x, ey = e.y;
  const isEye = part.lessThan(0.5), isNose = part.lessThan(1.5).and(part.greaterThan(0.5));
  const L = KU.lid;
  const up = select(side.greaterThan(0), L.x, L.y), lo = select(side.greaterThan(0), L.z, L.w);
  const cv = select(side.greaterThan(0), KU.curv.x, KU.curv.y);
  const upper = up.sub(ex.mul(ex).mul(cv)), lower = lo.add(ex.mul(ex).mul(0.14));
  const aa = fwidth(ey).mul(1.5).add(0.012);
  const lidM = tmax(tsmooth(upper.sub(aa), upper.add(aa), ey), float(1).sub(tsmooth(lower.sub(aa), lower.add(aa), ey)));
  const gz = vec2(KU.gaze.x.mul(side.negate()), KU.gaze.y);
  const q = e.sub(vec2(0.13, -0.05).add(gz)).div(vec2(0.68, 0.7));
  const r = tlen(q);
  const aR = fwidth(r).mul(1.2).add(0.004);
  const irisM = float(1).sub(tsmooth(float(1).sub(aR), float(1).add(aR), r));
  const rp = tlen(q.div(vec2(0.5, 0.6)));
  const aP = fwidth(rp).mul(1.2).add(0.004);
  const pupM = float(1).sub(tsmooth(float(1).sub(aP), float(1).add(aP), rp));
  const ang = tatan(q.y, q.x);
  const fib = tsin(ang.mul(23).add(tsin(ang.mul(7)).mul(1.3))).mul(0.5).add(0.5).mul(tsin(ang.mul(41).add(1.7)).mul(0.25).add(0.75));
  const eyeC = vec3(COL.eye.r, COL.eye.g, COL.eye.b), eyeD = vec3(COL.eyeD.r, COL.eyeD.g, COL.eyeD.b);
  let iris = tmix(eyeD, eyeC.mul(1.15), ism(0.3, 1.0, r)).mul(fib.mul(0.35).add(0.78));
  iris = iris.add(vec3(0.55, 0.75, 0.25).mul(ism(0.6, 0.8, r).mul(tsmooth(0.42, 0.62, r))).mul(0.35));
  iris = iris.mul(float(1).sub(tsmooth(0.78, 1.0, r).mul(0.65)));
  const scl = vec3(0.86, 0.88, 0.9).mul(float(1).sub(tsmooth(0.55, 1.02, tlen(e)).mul(0.32)));
  let eye = tmix(scl, iris, irisM);
  eye = tmix(eye, vec3(0.006, 0.012, 0.008), pupM);
  eye = eye.mul(float(1).sub(tsmooth(upper.sub(0.5), upper, ey).mul(0.5)));
  const lx = ex.mul(side.negate());
  const c1 = float(1).sub(tsmooth(0.1, 0.15, tlen(vec2(lx, ey).sub(vec2(-0.2, 0.3)).mul(vec2(1, 0.85)))));
  const c2 = float(1).sub(tsmooth(0.045, 0.075, tlen(e.sub(vec2(0.3, -0.4)))));
  const open = float(1).sub(lidM);
  const catchL = c1.add(c2.mul(0.7)).mul(open);
  const lash = float(1).sub(tsmooth(0.02, 0.075, tabs(ey.sub(upper)))).mul(float(1).sub(tsmooth(0.82, 1.0, tabs(ex))));
  const xd = tmin(tabs(ex.mul(0.75).sub(ey.mul(0.55))), tabs(ex.mul(0.75).add(ey.mul(0.55))));
  const xm = float(1).sub(tsmooth(0.07, 0.11, xd)).mul(float(1).sub(tsmooth(0.62, 0.72, tlen(e)))).mul(KU.xeyes);
  const line = vec3(COL.line.r, COL.line.g, COL.line.b);
  let ec = tmix(eye, col, lidM);
  ec = tmix(ec, line.mul(0.6), lash.mul(0.92));
  ec = tmix(ec, line.mul(0.5), xm);
  ec = tmix(ec, vec3(1, 1, 1), catchL.mul(0.9));
  m.colorNode = select(isEye, ec, col);
  m.roughnessNode = select(isEye, tmix(float(0.2), float(0.62), lidM), select(isNose, float(0.24), float(0.6)));
  m.metalnessNode = float(0);
  m.clearcoatNode = select(isEye, open, select(isNose, float(0.8), float(0)));
  m.clearcoatRoughnessNode = select(isEye, float(0.03), float(0.12));
  m.emissiveNode = select(isEye, vec3(1, 1, 1).mul(catchL.mul(0.55)).add(rimTerm(0.6).mul(lidM)), vec3(0, 0, 0));
  return m;
}
// plain lit material from vertex colours + 'rough' (the ball, the board hardware) with the rim light
function kitMaterial(double, map) {
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, side: double ? THREE.DoubleSide : THREE.FrontSide, map: map || null });
  m.roughnessNode = tclamp(attribute('rough', 'float'), 0.04, 1.0);
  m.emissiveNode = rimTerm();
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

const R = {}; // rig: bones, meshes
const FX = {}; // effect meshes

function group(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
const BONES = [];
function bone(parent, x, y, z) { const b = new THREE.Bone(); b.position.set(x, y, z); parent.add(b); BONES.push(b); return b; }
function meshIn(parent, geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = false;
  parent.add(m);
  return m;
}
const furGrad = (l, n) => mix(COL.fur, COL.furL, smooth(n.y * 1.2 - 0.1) * 0.32);
const headGrad = (l, n) => mix(COL.fur, COL.furL, smooth(n.y * 1.1) * 0.35);

// the v2 parts as sculpting primitives, per surface (a surface only blends with itself; surfaces interpenetrate like
// the v2 parts did, the scarf / glove cuffs / shoe collars cover the seams)
function kitSurfaces() {
  const BI = new Map(BONES.map((b, i) => [b, i]));
  const bm = b => b.matrixWorld;
  const P = (type, b, x, y, z, ax, ay, az, s, o) => mkPrim(type, bm(b), x, y, z, ax, ay, az, s, Object.assign({ bone: BI.get(b) }, o));
  const E = (b, x, y, z, rx, ry, rz, ax, ay, az, o) => P('E', b, x, y, z, ax, ay, az, [rx, ry, rz], o);
  const SF = [];
  // torso: belly, chest, white chest and bib, scarf collar + knot
  SF.push({ name: 'torso', h: 0.0085, kw: 0.03, off: 0.004, prims: [
    E(R.torso, 0, 0.02, -0.005, 0.135, 0.12, 0.125, 0, 0, 0, { fn: furGrad, mat: MAT.fur }),
    E(R.torso, 0, 0.17, 0, 0.158, 0.19, 0.142, 0, 0, 0, { k: 0.07, kc: 0.04, fn: furGrad, mat: MAT.fur }),
    E(R.torso, 0, 0.13, 0.048, 0.112, 0.165, 0.108, 0, 0, 0, { k: 0.03, kc: 0.025, col: COL.white, mat: MAT.furW }),
    E(R.torso, 0, 0.255, 0.085, 0.085, 0.06, 0.06, 0.3, 0, 0, { k: 0.03, kc: 0.025, col: COL.white, mat: MAT.furW }),
    P('T', R.torso, 0, 0.315, 0.005, Math.PI / 2 + 0.16, 0, 0, [0.125, 0.125, 0.15], { k: 0.008, kc: 0.004, mat: MAT.scarf, fn: (l, n) => mix(COL.scarf, COL.scarfD, smooth(-n.y * 1.5 + 0.2) * 0.8) }),
    E(R.torso, 0, 0.3, -0.142, 0.058, 0.048, 0.04, 0, 0, 0, { k: 0.012, kc: 0.004, col: COL.scarfD, mat: MAT.scarf })
  ] });
  // head: skull, back-of-head and cheek tufts, muzzle, snout; short fur on the face, painted brows
  const head = [
    E(R.neck, 0, 0.2, 0, 0.245, 0.228, 0.222, 0, 0, 0, { fn: headGrad, mat: MAT.fur }),
    P('C', R.neck, 0, 0.075, -0.17, -2.45, 0, 0, [0.1, 0.16, 0.06], { k: 0.035, kc: 0.03, col: COL.fur, mat: MAT.tuft, tip: 0.1 }),
    P('C', R.neck, 0.075, 0.09, -0.155, -2.4, 0.35, 0, [0.07, 0.13, 0.05], { k: 0.03, kc: 0.03, col: COL.fur, mat: MAT.tuft, tip: 0.1 }),
    P('C', R.neck, -0.075, 0.09, -0.155, -2.4, -0.35, 0, [0.07, 0.13, 0.05], { k: 0.03, kc: 0.03, col: COL.fur, mat: MAT.tuft, tip: 0.1 }),
    E(R.neck, 0, 0.105, 0.15, 0.138, 0.105, 0.14, 0, 0, 0, { k: 0.035, kc: 0.03, col: COL.white, mat: MAT.muzzle }),
    E(R.neck, 0, 0.12, 0.255, 0.08, 0.066, 0.12, -0.08, 0, 0, { k: 0.03, kc: 0.02, col: COL.white, mat: MAT.muzzle }),
    E(R.neck, 0, 0.175, 0.2, 0.07, 0.045, 0.14, 0.28, 0, 0, { k: 0.035, kc: 0.03, fn: headGrad, mat: MAT.face })
  ];
  for (const sd of [1, -1]) {
    head.push(P('C', R.neck, sd * 0.205, 0.085, 0.03, 0.15, 0, -sd * 2.1, [0.065, 0.14, 0.055], { k: 0.025, kc: 0.025, col: COL.white, mat: MAT.cheek, tip: 0.12 }));
    head.push(P('C', R.neck, sd * 0.188, 0.05, 0.065, 0.35, 0, -sd * 2.45, [0.048, 0.1, 0.045], { k: 0.025, kc: 0.025, col: COL.white, mat: MAT.cheek, tip: 0.14 }));
    // brows painted into the fur (dark, very short)
    head.push(E(R.neck, sd * 0.094, 0.352, 0.162, 0.062, 0.016, 0.06, -0.55, sd * 0.4, sd * 0.14, { op: 'p', soft: 0.006, col: COL.line, mat: MAT.brow }));
    // the fur around the eyes is short so the shells never cover them
    head.push(E(R.neck, sd * 0.092, 0.245, 0.19, 0.105, 0.135, 0.07, -0.18, sd * 0.4, 0, { op: 'p', soft: 0.025, mat: MAT.face }));
  }
  head.push(E(R.neck, 0, 0.12, 0.25, 0.16, 0.12, 0.2, 0, 0, 0, { op: 'p', soft: 0.03, mat: MAT.muzzle, str: 0.85 }));
  SF.push({ name: 'head', h: 0.0072, kw: 0.02, off: 0.002, prims: head });
  // ears: a flattened cone carved into a cup (inner colour), dark tip, white tuft inside
  for (const [b, nm] of [[R.earL, 'earL'], [R.earR, 'earR']]) {
    SF.push({ name: nm, h: 0.0062, kw: 0.02, prims: [
      P('C', b, 0, 0.155, 0, 0, 0, 0, [0.105, 0.31, 0.056], { tip: 0.07, mat: MAT.ear, fn: l => mix(COL.fur, COL.earTip, smooth((l[1] - 0.12) / 0.3)) }),
      P('C', b, 0, 0.145, 0.036, 0, 0, 0, [0.074, 0.26, 0.032], { op: 's', k: 0.014, kc: 0.01, tip: 0.05, col: COL.inner, mat: MAT.earIn }),
      E(b, 0, 0.07, 0.022, 0.045, 0.1, 0.035, 0.1, 0, 0, { op: 'p', soft: 0.014, col: COL.white, mat: MAT.earW })
    ] });
  }
  // arms: shoulder -> elbow -> glove (cuff, mitten with knuckles, thumb)
  for (const [sh, el, sd, nm] of [[R.shL, R.elL, 1, 'armL'], [R.shR, R.elR, -1, 'armR']]) {
    SF.push({ name: nm, h: 0.0058, kw: 0.04, prims: [
      P('L', sh, 0, 0, 0, 0, 0, 0, [0.045, 0.034, 0.16], { mat: MAT.fur, fn: furGrad }),
      P('L', el, 0, 0, 0, 0, 0, 0, [0.035, 0.035, 0.1], { k: 0.02, kc: 0.02, mat: MAT.fur, fn: furGrad }),
      P('T', el, 0, -0.112, 0, Math.PI / 2, 0, 0, [0.05, 0.05, 0.075], { k: 0.006, kc: 0.004, col: COL.glove, mat: MAT.glove }),
      E(el, 0, -0.112, 0, 0.052, 0.022, 0.052, 0, 0, 0, { k: 0.008, kc: 0.004, col: COL.glove, mat: MAT.glove }),
      E(el, 0, -0.178, 0.006, 0.066, 0.07, 0.066, 0, 0, 0, { k: 0.014, kc: 0.004, col: COL.glove, mat: MAT.glove }),
      E(el, -sd * 0.038, -0.152, 0.052, 0.024, 0.026, 0.044, -0.25, 0, 0, { k: 0.014, kc: 0.004, col: COL.glove, mat: MAT.glove }),
      E(el, 0.024, -0.214, 0.03, 0.022, 0.026, 0.026, 0, 0, 0, { k: 0.016, kc: 0.004, col: COL.glove, mat: MAT.glove }),
      E(el, -0.002, -0.22, 0.034, 0.022, 0.026, 0.026, 0, 0, 0, { k: 0.016, kc: 0.004, col: COL.glove, mat: MAT.glove }),
      E(el, -0.027, -0.214, 0.03, 0.021, 0.025, 0.025, 0, 0, 0, { k: 0.016, kc: 0.004, col: COL.glove, mat: MAT.glove })
    ] });
  }
  // legs: hip -> knee -> sneaker (padded collar, upper, toe, sole, white stripe, toe cap)
  R.legs.forEach((L, i) => {
    SF.push({ name: i ? 'legR' : 'legL', h: 0.0064, kw: 0.04, prims: [
      P('L', L.lg, 0, 0, 0, 0, 0, 0, [0.058, 0.046, 0.175], { mat: MAT.fur, fn: furGrad }),
      P('L', L.kn, 0, 0, 0, 0, 0, 0, [0.047, 0.038, 0.168], { k: 0.022, kc: 0.02, mat: MAT.fur, fn: furGrad }),
      P('T', L.an, 0, -0.008, -0.004, Math.PI / 2, 0, 0, [0.052, 0.052, 0.07], { k: 0.006, kc: 0.004, col: COL.shoeD, mat: MAT.shoeD }),
      E(L.an, 0, -0.05, 0.065, 0.108, 0.08, 0.195, 0, 0, 0, { k: 0.01, kc: 0.004, mat: MAT.shoe, fn: (l, n) => mix(COL.shoe, COL.shoeD, smooth(-n.y * 1.4 + 0.1) * 0.55) }),
      E(L.an, 0, -0.068, 0.17, 0.104, 0.066, 0.11, 0, 0, 0, { k: 0.03, kc: 0.02, mat: MAT.shoe, fn: (l, n) => mix(COL.shoe, COL.shoeD, smooth(-n.y * 1.4 + 0.1) * 0.55) }),
      E(L.an, 0, -0.114, 0.07, 0.114, 0.028, 0.218, 0, 0, 0, { k: 0.006, kc: 0.003, col: COL.sole, mat: MAT.sole }),
      E(L.an, 0, -0.03, 0.215, 0.05, 0.018, 0.03, -0.95, 0, 0, { k: 0.012, kc: 0.004, col: COL.sole, mat: MAT.stripe }),
      P('T', L.an, 0, -0.035, 0.07, -0.45, 0, 0, [0.1, 0.082, 0.07], { op: 'p', soft: 0.004, col: COL.sole, mat: MAT.stripe })
    ] });
  });
  // tail: three segments blended into one bushy shape (soft weights along it), white tip
  SF.push({ name: 'tail', h: 0.0082, kw: 0.11, off: 0.004, prims: [
    E(R.t0, 0, 0, -0.09, 0.06, 0.06, 0.11, 0, 0, 0, { mat: MAT.tail, fn: furGrad }),
    E(R.t1, 0, 0.01, -0.165, 0.138, 0.13, 0.215, 0, 0, 0, { k: 0.07, kc: 0.06, mat: MAT.tail,
      fn: (l, n) => mix(mix(COL.fur, COL.furL, smooth(n.y) * 0.3).clone(), COL.white, smooth((-l[2] - 0.55) / 0.35)) }),
    E(R.t2, 0, 0, -0.07, 0.125, 0.118, 0.15, 0, 0, 0, { k: 0.07, kc: 0.05, col: COL.white, mat: MAT.tail }),
    E(R.t2, 0, 0.005, -0.19, 0.075, 0.072, 0.11, 0, 0, 0, { k: 0.06, kc: 0.05, col: COL.white, mat: MAT.tail }),
    P('C', R.t2, 0, 0.0, -0.29, -Math.PI / 2, 0, 0, [0.06, 0.12, 0.058], { k: 0.05, kc: 0.05, col: COL.white, mat: MAT.tail, tip: 0.15 })
  ] });
  return SF;
}

// face details (skinned to the neck): eyes with eye-space coordinates for the shader, nose, mouth
function buildDetails(neckIdx) {
  const P = [], N = [], C = [], UVA = [], PA = [], SD = [], I = [];
  let v0 = 0;
  const neckM = R.neck.matrixWorld;
  const add = (geo, local, part, side, col, uvfn) => {
    const m = new THREE.Matrix4().multiplyMatrices(neckM, local), nm = new THREE.Matrix3().getNormalMatrix(m);
    const pa = geo.attributes.position, na = geo.attributes.normal, ix = geo.index;
    for (let k = 0; k < pa.count; k++) {
      _bl.fromBufferAttribute(pa, k); _bv.copy(_bl).applyMatrix4(m); _bn.fromBufferAttribute(na, k).applyMatrix3(nm).normalize();
      P.push(_bv.x, _bv.y, _bv.z); N.push(_bn.x, _bn.y, _bn.z); C.push(col.r, col.g, col.b);
      const u = uvfn ? uvfn(_bl) : [0, 0];
      UVA.push(u[0], u[1]); PA.push(part); SD.push(side);
    }
    for (let k = 0; k < ix.count; k++) I.push(ix.getX(k) + v0);
    v0 += pa.count;
  };
  const eyeG = new THREE.Matrix4(), lidCol = mix(COL.fur, COL.furL, 0.3).clone();
  for (const sd of [1, -1]) {
    eyeG.copy(TRS(sd * 0.092, 0.245, 0.198, -0.18, sd * 0.4, 0, 1, 1, 1));
    const loc = new THREE.Matrix4().multiplyMatrices(eyeG, TRS(0, 0, -0.008, 0, 0, 0, 0.08, 0.112, 0.036));
    add(GEO.eye, loc, 0, sd, lidCol, l => [l.x * -sd, l.y]);
  }
  add(GEO.sph, TRS(0, 0.143, 0.366, 0.18, 0, 0, 0.047, 0.035, 0.037).clone(), 1, 0, COL.nose);
  add(GEO.arc, TRS(-0.045, 0.085, 0.3, -0.25, -0.5, 0.25, 0.045, 0.03, 0.03).clone(), 2, 0, COL.line);
  const g = new THREE.BufferGeometry();
  const n = P.length / 3;
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('kcol', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('kuv', new THREE.Float32BufferAttribute(UVA, 2));
  g.setAttribute('kpart', new THREE.Float32BufferAttribute(PA, 1));
  g.setAttribute('kside', new THREE.Float32BufferAttribute(SD, 1));
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = neckIdx; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
  g.boundingSphere = new THREE.Sphere(new V3(0, 0.6, 0), 1.5);
  return g;
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
  for (let i = 0; i < n; i++) {
    const y = pa.getY(i) / 0.5, z = pa.getZ(i) / 0.5;
    uv.setXY(i, 0.5 + 0.5 * z * k, 0.5 + 0.5 * y * k);
  }
  return g;
}
// the ball: painted curl + fur strands (bump, tone) + sheen + rim
function ballMaterial(map) {
  kitTextures();
  const m = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.62, metalness: 0 });
  const base = ttex(map, tuv());
  const f = tri(FURT, KU.furScale.mul(1.4));
  m.colorNode = base.rgb.mul(f.x.mul(0.3).add(0.74)).mul(float(1).add(f.z.sub(0.5).mul(0.2)));
  m.normalNode = bumpN(f.x.mul(KU.bump), float(1));
  m.sheenNode = base.rgb.mul(0.4).add(0.05);
  m.sheenRoughnessNode = float(0.45);
  m.emissiveNode = rimTerm().mul(base.rgb.mul(1.2).add(0.35));
  return m;
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

// shield bubble: Fresnel rim (HDR, so it blooms) + travelling bands + swirl
function shieldMaterial(U) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const p = positionGeometry, t = U.uT;
  const f = float(1).sub(tabs(tdot(tnormalize(normalView), tnormalize(positionView.negate()))));
  const rim = tpow(f, 2.4);
  const band = tpow(tsin(p.y.mul(10).sub(t.mul(4)).add(tsin(p.x.mul(6).add(t)).mul(1.5))).mul(0.5).add(0.5), 10);
  const swirl = tpow(tsin(tatan(p.z, p.x).mul(3).add(p.y.mul(4)).add(t.mul(3))).mul(0.5).add(0.5), 16);
  m.colorNode = tmix(vec3(0.42, 0.78, 1.0), vec3(0.92, 0.99, 1.0), rim).mul(band.mul(0.6).add(swirl.mul(0.5)).add(1)).mul(rim.mul(0.8).add(1));
  m.opacityNode = tclamp(rim.mul(0.75).add(0.07).add(band.mul(0.18)).add(swirl.mul(0.22)).mul(U.uA), 0, 0.95);
  return m;
}
// scarf ribbons: knitted fabric (bump + cavity tone), sheen, two light stripes near the ends
function scarfMaterial() {
  kitTextures();
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  const col = attribute('kcol', 'vec3'), u = tuv();
  const k = ttex(KNITT, vec2(u.x.mul(6), u.y.mul(1.2)));
  const stripe = tsmooth(0.8, 0.82, u.x).mul(float(1).sub(tsmooth(0.86, 0.88, u.x))).add(tsmooth(0.9, 0.92, u.x).mul(float(1).sub(tsmooth(0.94, 0.96, u.x))));
  const c = tmix(col, vec3(0.7, 0.82, 1.0), stripe.mul(0.75));
  m.colorNode = c.mul(k.z.mul(0.3).add(0.75)).mul(k.y.sub(0.5).mul(0.15).add(1));
  m.normalNode = bumpN(k.x.mul(0.6), float(1));
  m.sheenNode = c.mul(0.5).add(0.08);
  m.sheenRoughnessNode = float(0.4);
  m.emissiveNode = rimTerm(0.7).mul(c.add(0.3));
  return m;
}

function create(scene) {
  scene = scene || (K.view && K.view.scene);
  if (S.built || !scene) return;
  const tc0 = performance.now();
  prims();
  kitTextures();
  const root = R.root = new THREE.Group();
  root.name = 'kit';
  root.userData.noEnv = true;
  scene.add(root);
  // the v2 rig, as bones (the pose code drives the same pivots)
  BONES.length = 0;
  const rig = R.rig = bone(root, 0, 0, 0);
  const hips = R.hips = bone(rig, 0, 0.5, 0);
  const torso = R.torso = bone(hips, 0, 0.0, 0);
  R.knot = group(torso, 0, 0.31, -0.165);
  const neck = R.neck = bone(torso, 0, 0.33, 0.0);
  R.earL = bone(neck, 0.125, 0.375, -0.03);
  R.earR = bone(neck, -0.125, 0.375, -0.03);
  R.shL = bone(torso, 0.18, 0.265, -0.01); R.shL.rotation.order = 'ZYX';
  R.elL = bone(R.shL, 0, -0.16, 0);
  R.shR = bone(torso, -0.18, 0.265, -0.01); R.shR.rotation.order = 'ZYX';
  R.elR = bone(R.shR, 0, -0.16, 0);
  R.legs = [];
  for (const side of [1, -1]) {
    const lg = bone(hips, side * 0.085, -0.01, 0);
    const kn = bone(lg, 0, -0.175, 0);
    const an = bone(kn, 0, -0.175, 0);
    R.legs.push({ lg, kn, an });
  }
  R.t0 = bone(hips, 0, 0.03, -0.115);
  R.t1 = bone(R.t0, 0, 0, -0.15);
  R.t2 = bone(R.t1, 0, 0, -0.32);
  R.eyes = [];
  root.updateMatrixWorld(true);
  const skel = R.skel = new THREE.Skeleton(BONES.slice());

  // sculpted body, fur shells, face details
  const surf = kitSurfaces();
  const parts = surf.map(s => sculpt(s, s.h));
  R.bodyGeo = skinGeometry(parts);
  R.body = new THREE.SkinnedMesh(R.bodyGeo, bodyMaterial());
  R.body.name = 'kit-body';
  R.body.castShadow = true; R.body.receiveShadow = true;
  R.body.boundingSphere = new THREE.Sphere(new V3(0, 0.6, 0), 1.5);
  rig.add(R.body);
  R.body.bind(skel, new THREE.Matrix4());
  const shellParts = surf.map(s => sculpt(s, s.h * 1.7));
  R.shellGeo = skinGeometry(shellParts, { shells: 16, minFur: 0.05 });
  R.fur = new THREE.SkinnedMesh(R.shellGeo, shellMaterial());
  R.fur.name = 'kit-fur';
  R.fur.castShadow = false; R.fur.receiveShadow = true;
  R.fur.renderOrder = 1;
  R.fur.boundingSphere = new THREE.Sphere(new V3(0, 0.6, 0), 1.5);
  rig.add(R.fur);
  R.fur.bind(skel, new THREE.Matrix4());
  R.details = new THREE.SkinnedMesh(buildDetails(BONES.indexOf(neck)), detailMaterial());
  R.details.name = 'kit-face';
  R.details.castShadow = false; R.details.receiveShadow = true;
  R.details.boundingSphere = new THREE.Sphere(new V3(0, 0.6, 0), 1.5);
  rig.add(R.details);
  R.details.bind(skel, new THREE.Matrix4());
  R.mat = R.body.material;
  furShells(K.gfx && K.gfx.furShells);
  if (K.gfx && typeof K.gfx.onChange === 'function') K.gfx.onChange(g => furShells(g.furShells));
  R.stats = { bodyTris: R.bodyGeo.index.count / 3, bodyVerts: R.bodyGeo.attributes.position.count, shellTris: R.shellGeo.userData.perCopy / 3, detailTris: R.details.geometry.index.count / 3 };

  // peel-out leg wheel
  const wt = wheelTex(); wt.center.set(0.5, 0.5);
  const wg = new THREE.BufferGeometry();
  {
    const c = new THREE.CircleGeometry(0.27, 40);
    const parts2 = [];
    for (const sd of [1, -1]) { const g = c.clone(); g.rotateY(Math.PI / 2 + sd * 0.22); g.translate(sd * 0.085, 0, 0); parts2.push(g); }
    let n = 0; for (const g of parts2) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
    let o = 0;
    for (const g of parts2) {
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
    const parts2 = [];
    for (const sd of [1, -1]) { const g = new THREE.CylinderGeometry(0.255, 0.255, 0.1, 36, 1, true); g.rotateZ(Math.PI / 2); g.translate(sd * 0.085, 0, 0); parts2.push(g); }
    const g = new THREE.BufferGeometry();
    const n = parts2[0].attributes.position.count;
    const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx = [];
    parts2.forEach((p, k) => {
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
  R.ballMesh = meshIn(R.ballSpin, buildBall(), ballMaterial(ballTex()));
  const shellGeo = new THREE.SphereGeometry(0.57, 28, 14);
  shellGeo.rotateZ(Math.PI / 2);
  R.shellTex = streakTex(); R.shellTex.wrapS = THREE.RepeatWrapping;
  R.shellMat = new THREE.MeshBasicMaterial({ map: R.shellTex, transparent: true, depthWrite: false, opacity: 0 });
  R.shell = new THREE.Mesh(shellGeo, R.shellMat);
  R.shell.renderOrder = 2;
  R.ballSpin.add(R.shell);
  R.ballG.visible = false;

  // scarf tails (verlet ribbons in world space): knitted fabric
  {
    const N = SC.n, nv = 2 * N * 2;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    const idx = [];
    for (let k = 0; k < 2; k++) {
      const base = k * N * 2;
      for (let i = 0; i < N; i++) {
        const c = k ? COL.scarfD : COL.scarf, t = i / (N - 1);
        const cc = mix(c, COL.scarfD, t * 0.35);
        for (let s = 0; s < 2; s++) { const v = base + i * 2 + s; col[v * 3] = cc.r; col[v * 3 + 1] = cc.g; col[v * 3 + 2] = cc.b; nor[v * 3 + 1] = 1; uv[v * 2] = t; uv[v * 2 + 1] = s; }
        if (i < N - 1) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      for (let i = 0; i < N; i++) { SC.pts[k].push(new V3()); SC.old[k].push(new V3()); }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('kcol', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    SC.geo = g;
    SC.mesh = new THREE.Mesh(g, scarfMaterial());
    SC.mesh.name = 'kit-scarf';
    SC.mesh.userData.noEnv = true;
    SC.mesh.frustumCulled = false;
    SC.mesh.castShadow = true;
    scene.add(SC.mesh);
  }

  // blob shadow
  {
    const g = new THREE.CircleGeometry(0.62, 28); g.rotateX(-Math.PI / 2);
    const tex = radialTex([[0, 'rgba(255,255,255,1)'], [0.55, 'rgba(255,255,255,0.65)'], [1, 'rgba(255,255,255,0)']]);
    FX.blob = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    FX.blob.name = 'kit-blob';
    FX.blob.userData.noEnv = true;
    FX.blob.renderOrder = 1;
    scene.add(FX.blob);
  }
  // shield bubble
  {
    FX.shieldU = { uT: uniform(0), uA: uniform(1) };
    FX.shield = new THREE.Mesh(new THREE.SphereGeometry(0.92, 36, 24), shieldMaterial(FX.shieldU));
    FX.shield.name = 'kit-shield';
    FX.shield.userData.noEnv = true;
    FX.shield.renderOrder = 3;
    FX.shield.visible = false;
    scene.add(FX.shield);
  }
  // invincibility sparkles: instanced sprites (WebGPU draws THREE.Points 1 px wide), additive and HDR so they bloom
  {
    const n = FX.sparkN = 26;
    FX.sparkPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    FX.sparkCol = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const sm = new THREE.SpriteNodeMaterial({ map: sparkleTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    sm.positionNode = instancedBufferAttribute(FX.sparkPos);
    sm.colorNode = instancedBufferAttribute(FX.sparkCol).mul(TSL.texture(sm.map).rgb).mul(1.8);
    sm.opacityNode = TSL.texture(sm.map).a;
    sm.scaleNode = float(0.25);
    FX.spark = new THREE.Sprite(sm);
    FX.spark.name = 'kit-spark';
    FX.spark.userData.noEnv = true;
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
  // afterimages: bake a run-pose silhouette from the skinned body
  {
    root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.set(1, 1, 1);
    resetPose(); S.ph = 0.6; poseRun(14, false); for (const k of KEYS) Q[k] = T[k];
    applyPose();
    root.updateMatrixWorld(true);
    FX.ghostGeo = [bakePose(R.body), (() => { const g = new THREE.SphereGeometry(0.5, 20, 14); g.translate(0, 0.5, 0); return g; })()];
    FX.ghosts = [];
    for (let i = 0; i < 4; i++) {
      const gm = new THREE.Mesh(FX.ghostGeo[0], new THREE.MeshBasicMaterial({ color: lin('#6fe9ff'), transparent: true, opacity: 0.3, depthWrite: false }));
      gm.name = 'kit-ghost';
      gm.userData.noEnv = true;
      gm.visible = false; gm.renderOrder = 1;
      scene.add(gm);
      FX.ghosts.push(gm);
    }
    FX.snaps = [];
    for (let i = 0; i < 16; i++) FX.snaps.push({ on: false, pos: new V3(), q: new THREE.Quaternion(), ball: false });
    FX.snapI = 0;
    resetPose();
    applyPose();
  }
  R.stats.buildMs = Math.round(performance.now() - tc0);
  init(P.pos, 0);
}
// positions of a skinned mesh in its current pose (root space), as a plain geometry
function bakePose(mesh) {
  const g = mesh.geometry, pa = g.attributes.position, n = pa.count;
  const out = new Float32Array(n * 3), v = new V3();
  mesh.skeleton.update();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pa, i); mesh.applyBoneTransform(i, v); v.applyMatrix4(mesh.matrixWorld); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
  const b = new THREE.BufferGeometry();
  b.setAttribute('position', new THREE.BufferAttribute(out, 3));
  b.setIndex(g.index.clone());
  b.computeVertexNormals(); b.computeBoundingSphere();
  return b;
}
// shell count from the quality preset (K.gfx.furShells: Ultra 16, Élevé 10, Moyen 6, Économie 0)
function furShells(n) {
  n = fin(n) ? clamp(Math.round(n), 0, 16) : 10;
  R.furN = n;
  if (!R.fur) return;
  KU.shells.value = Math.max(1, n);
  R.fur.geometry.setDrawRange(0, R.shellGeo.userData.perCopy * n);
  R.fur.visible = n > 0;
  // fewer layers: thicker strands so the coat keeps its density
  KU.bump.value = n > 0 ? 0.9 : 1.4;
}
// fur lag: a damped spring on the body's velocity, plus gravity droop and a little wind, in the mesh's local frame
const FL = { v: new V3(), x: new V3(), q: new THREE.Quaternion(), t: new V3() };
function furLag(dt) {
  if (!R.fur || !R.fur.visible || !(dt > 0)) return;
  const v = P.vel, w = S.t;
  FL.t.set(-v.x * 0.0011, -v.y * 0.0011 - 0.006, -v.z * 0.0011);
  const l = FL.t.length(); if (l > 0.03) FL.t.multiplyScalar(0.03 / l);
  FL.t.x += Math.sin(w * 2.3) * 0.0016; FL.t.z += Math.cos(w * 1.7) * 0.0016;
  // critically damped-ish spring with a little overshoot
  FL.v.addScaledVector(FL.t.sub(FL.x), 260 * dt).multiplyScalar(Math.exp(-22 * dt));
  FL.x.addScaledVector(FL.v, dt);
  R.rig.getWorldQuaternion(FL.q).invert();
  KU.lag.value.copy(FL.x).applyQuaternion(FL.q);
}

