// ---- foliage: trees and palms are alpha-tested cards + bark on the city_foliage atlas, in one mesh per chunk (drawn
// near the camera, with the detailed houses) that casts its own dappled shadows. aEmit = atlas tile (0 broadleaf
// cluster, 1 palm frond, 2 bark, 3 needles), aUv = uv in the tile (bark: repeating), normals bent round the crown
const FOL_FAR = { mb: null };
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
const BARK = lin('#6e5a48');
function tree(mb, p, r, big) {
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
function palm(mb, p, r) {
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
  const tex = K.tex && typeof K.tex.load === 'function' ? K.tex.load('city/city_foliage', { wrap: 'clamp', fallback: [120, 140, 100, 255] }) : null;
  const tx = tex ? ttexture(tex, off.add(luv.mul(0.5))).toVar('fTx') : vec4(0.45, 0.5, 0.4, 1);
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
