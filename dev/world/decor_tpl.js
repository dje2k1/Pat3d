  // ----- decorations: templates baked into merged static meshes (one solid + one foliage mesh per zone)
  // Vertex layout: position, normal, color (linear tint), uv, aK = (kind, bend, phase, flutter). bend / flutter are the
  // wind amplitudes in metres at that vertex (0 at the roots): bend leans the whole plant with the gusts, flutter
  // shakes the leaf tips. Kinds pick the material layer (DK).
  const DK = { PLAIN: 0, BARK: 1, ROCK: 2, WOOD: 3, LEAVES: 4, FROND: 10, LEAF: 11 };
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
      // the normal agrees with the triangles' winding (front = along x across): double-sided materials flip it
      a.subVectors(next.m, prev.m); b.subVectors(r.r, r.l);
      nrm.crossVectors(a, b).normalize();
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
  function tplBush(seed) {
    const r = rngOf(seed), t = new DB();
    const lo = lin('#2b6f2c'), hi = lin('#7fd36a');
    const blobs = [[-0.72, 0.55, 0, 0.74], [0, 0.82, 0.08, 0.95], [0.76, 0.55, -0.05, 0.78], [0.3, 0.45, 0.62, 0.62], [-0.3, 0.45, -0.6, 0.62]];
    if (r() < 0.5) blobs.push([0.1, 1.3, -0.1, 0.55]);
    let bi = 0;
    for (const [x, y, z, rr] of blobs) {
      const g = new THREE.IcosahedronGeometry(rr, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
        const k = 1 + 0.16 * vnoise(px * 3.1 + bi * 7, pz * 3.1 + py * 2.3, 31 + bi) + 0.07 * vnoise(px * 7.3, py * 7.3 + pz, 37);
        p.setXYZ(i, px * k, py * k * 0.92, pz * k);
      }
      g.computeVertexNormals();
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
  // ---- rock: rounded boulder (noise-displaced, flattened), sandstone texture by box projection, moss on top
  function tplRock(seed) {
    const r = rngOf(seed), t = new DB();
    let g = new THREE.IcosahedronGeometry(1, 2);
    g = g.toNonIndexed();
    const p = g.attributes.position;
    const sx = 1.1 + r() * 0.35, sy = 0.62 + r() * 0.25, sz = 0.9 + r() * 0.25;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + 0.22 * vnoise(x * 1.7 + seed, z * 1.7 + y * 1.3, 51) + 0.08 * vnoise(x * 4.1 + y, z * 4.1, 53);
      p.setXYZ(i, x * k * sx, Math.max(y * k * sy, -0.25), z * k * sz);
    }
    g.computeVertexNormals();
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
      { col: lin(hex), kind: DK.WOOD, uvFn: (q, n, uv) => [uv ? uv[0] * Math.max(w, d) * 0.6 : 0, uv ? uv[1] * h * 0.6 : 0] });
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
