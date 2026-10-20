// ===================== materials =====================
const { Fn, If, uniform, attribute, vec2, vec3, vec4, float, mix, smoothstep, clamp: tclamp, abs: tabs, max: tmax, min: tmin,
  fract: tfract, floor: tfloor, sin: tsin, cos: tcos, pow: tpow, exp: texp, dot: tdot, normalize: tnormalize, reflect: treflect,
  length: tlength, step: tstep, select, positionWorld, positionLocal, positionGeometry, normalGeometry, cameraPosition,
  cameraViewMatrix, cameraProjectionMatrix, modelViewMatrix, modelWorldMatrix, varyingProperty, texture: ttexture, uv: tuv } = TSL;
const TL = K.tsl;
const U = { time: uniform(0), hdr: K.post && K.post.uHDR && K.post.uHDR.isNode ? K.post.uHDR : uniform(1) };
// city surfaces: vertex colour + a surface kind (procedural detail), uv in metres (or 0..1 for openings), emission
const KIND = {
  plain: 0, siding: 1, window: 2, shingle: 3, asphalt: 4, paint: 5, slab: 6, brick: 7, plank: 8, metal: 9, glow: 10,
  leaf: 11, rail: 12, dentil: 13, scales: 14, facade: 15, ground: 16, seawall: 17, stone: 18, awning: 19, glass: 20, tar: 21
};
// The v2 city shader (per-kind procedural surfaces) ported to TSL: colour, roughness, metalness and emission per kind.
// opts.position(p) -> displaced local position node (flags, gulls); opts.vehicle: kinds 30 (paint: takes the instance
// colour, glossy) and 31 (blinkers).
// PORT(city): v2 also bent the normal per kind (siding / shingle / brick / dentil / stone bumps, cBump) and the
// vehicles' paint only took the instance colour (here: vertex colour / instance colour on non-paint kinds); v3 replaces
// this with K.tex PBR sets (wood siding, shingles, asphalt with cracks and puddles, concrete), interior-mapped windows.
function cityMaterial(opts) {
  opts = opts || {};
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: false, roughness: 0.8, metalness: 0 });
  const aK = attribute('aKind', 'float'), u = attribute('aUv', 'vec2'), aE = attribute('aEmit', 'float');
  const kk = tfloor(aK.add(0.5));
  const lp = positionGeometry;
  const H = TL.hash21, N = TL.vnoise;
  let vc = attribute('color', 'vec3');
  const hdr = U.hdr, uTime = U.time;
  if (opts.vehicle) {
    // three multiplies the diffuse by the instance colour on every vertex; v2 only tinted the paint (kind 30)
    const ic = varyingProperty('vec3', 'vInstanceColor');
    vc = select(aK.greaterThan(29.5), vc, vc.div(tmax(ic, vec3(1e-3))));
  }
  const isWin = kk.equal(2).or(kk.equal(20));
  const fr = tstep(u.x, 0.08).add(tstep(0.92, u.x)).add(tstep(u.y, 0.06)).add(tstep(0.94, u.y)).add(tstep(tabs(u.y.sub(0.52)), 0.03))
    .add(tstep(tabs(u.x.sub(0.5)), 0.022).mul(tstep(0.52, u.y)).mul(select(kk.equal(2), float(1), float(0))));
  const glass = isWin.and(fr.lessThanEqual(0));
  const lit = glass.and(aE.greaterThan(0));
  const warm = mix(vec3(1.0, 0.56, 0.22), vec3(1.0, 0.78, 0.45), H(tfloor(lp.xz.mul(0.3)).add(tfloor(lp.y))));
  // background facades (kind 15): window grid, some lit
  const fq = u.div(vec2(2.7, 3.3)), ff = tfract(fq), fid = tfloor(fq);
  const fw = tstep(0.3, ff.x).mul(tstep(ff.x, 0.7)).mul(tstep(0.25, ff.y)).mul(tstep(ff.y, 0.85)).mul(tstep(0.5, fq.y));
  const flit = tstep(0.62, H(fid.add(tfloor(lp.xz.mul(0.05)))));
  const asN = N(lp.xz.mul(0.45)).mul(0.55).add(N(lp.xz.mul(2.7)).mul(0.3)).add(H(tfloor(lp.xz.mul(9))).mul(0.15));
  const wheel = texp(tpow(tabs(u.x).sub(3.1 + 0.85), 2).mul(-3)).add(texp(tpow(tabs(u.x).sub(3.1 - 0.85), 2).mul(-3)));
  m.colorNode = Fn(() => {
    const c = vec3(vc).toVar();
    If(kk.equal(1), () => { const b = tfract(lp.y.mul(4.6).add(0.2)); c.mulAssign(smoothstep(0.0, 0.16, b).mul(0.16).add(0.84)); })
      .ElseIf(glass, () => {
        c.assign(mix(vec3(0.02, 0.025, 0.035), vec3(0.05, 0.06, 0.08), smoothstep(0.1, 1.0, u.y)));
        If(lit, () => { c.assign(warm.mul(0.12)); });
      })
      .ElseIf(kk.equal(3), () => {
        const q = u.mul(vec2(2.4, 3.6)).toVar(); q.x.addAssign(tfloor(q.y).mul(0.5));
        const e = tfract(q.y), t = H(tfloor(q));
        c.mulAssign(smoothstep(0.0, 0.3, e).mul(0.3).add(0.7).mul(t.mul(0.24).add(0.88)));
      })
      .ElseIf(kk.equal(4), () => {
        const pch = smoothstep(0.62, 0.66, N(lp.xz.mul(0.09).add(3.7)));
        c.mulAssign(asN.mul(0.34).add(0.78).mul(float(1).sub(pch.mul(0.18))).mul(float(1).sub(wheel.mul(0.1))));
      })
      .ElseIf(kk.equal(5), () => { c.mulAssign(N(lp.xz.mul(1.9)).mul(0.28).add(0.78)); })
      .ElseIf(kk.equal(6), () => {
        const g = tfract(u.div(1.55)), j = tmin(tmin(g.x, float(1).sub(g.x)), tmin(g.y, float(1).sub(g.y)));
        c.mulAssign(smoothstep(0.0, 0.035, j).mul(0.14).add(0.86).mul(N(lp.xz.mul(1.3)).mul(0.16).add(0.9)));
      })
      .ElseIf(kk.equal(7), () => {
        const q = u.mul(vec2(4.2, 12.5)).toVar(); q.x.addAssign(tfloor(q.y).mul(0.5));
        const f = tfract(q), mm = tstep(0.08, f.x).mul(tstep(0.12, f.y)), t = H(tfloor(q));
        c.mulAssign(mix(vec3(0.78, 0.76, 0.72), vec3(t.mul(0.3).add(0.85), t.mul(0.15).add(0.9), 0.9), mm));
      })
      .ElseIf(kk.equal(8), () => {
        const p = u.y.mul(3.6), f = tfract(p), t = H(vec2(tfloor(p), tfloor(u.x.mul(0.35).add(tfloor(p).mul(7)))));
        const g = N(vec2(u.x.mul(0.6), p.mul(3)));
        c.mulAssign(t.mul(0.18).add(0.78).add(g.mul(0.12)).mul(smoothstep(0.0, 0.08, f).mul(smoothstep(1.0, 0.92, f)).mul(0.38).add(0.62)));
      })
      .ElseIf(kk.equal(11), () => { c.mulAssign(N(lp.xz.mul(1.7).add(lp.y.mul(2))).mul(0.5).add(0.7)); })
      .ElseIf(kk.equal(12), () => { c.mulAssign(N(lp.xz.mul(3)).mul(0.2).add(0.9)); })
      .ElseIf(kk.equal(13), () => { const s = tstep(0.42, tfract(u.x.mul(2.6))); c.mulAssign(s.mul(0.28).add(0.72)); })
      .ElseIf(kk.equal(14), () => {
        const q = u.mul(vec2(5, 6)).toVar(); q.x.addAssign(tfloor(q.y).mul(0.5));
        const f = tfract(q).sub(vec2(0.5, 0)), cc = tlength(f.mul(vec2(1, 1.25)));
        c.mulAssign(smoothstep(0.62, 0.45, cc).mul(0.22).add(0.78));
      })
      .ElseIf(kk.equal(15), () => { c.assign(mix(c.mul(tfract(lp.y.mul(4.6)).mul(0.1).add(0.9)), vec3(0.05, 0.06, 0.08), fw)); })
      .ElseIf(kk.equal(16), () => { c.mulAssign(N(lp.xz.mul(0.05)).mul(0.6).add(N(lp.xz.mul(0.21)).mul(0.4)).mul(0.5).add(0.7)); })
      .ElseIf(kk.equal(17), () => {
        const f = tfract(u.mul(vec2(0.45, 1.2))), j = tmin(tmin(f.x, float(1).sub(f.x)), tmin(f.y, float(1).sub(f.y)));
        const stain = smoothstep(0.0, 1.2, float(1.4).sub(lp.y));
        c.mulAssign(smoothstep(0.0, 0.05, j).mul(0.18).add(0.82).mul(float(1).sub(stain.mul(0.35))).mul(N(lp.xz.mul(0.8).add(lp.y)).mul(0.2).add(0.9)));
      })
      .ElseIf(kk.equal(18), () => {
        const q = u.mul(vec2(1.4, 2.6)).toVar(); q.x.addAssign(tfloor(q.y).mul(0.5));
        const f = tfract(q), j = tmin(tmin(f.x, float(1).sub(f.x)), tmin(f.y, float(1).sub(f.y)));
        c.mulAssign(smoothstep(0.0, 0.08, j).mul(0.3).add(0.7).mul(H(tfloor(q)).mul(0.2).add(0.9)));
      })
      .ElseIf(kk.equal(19), () => { c.assign(mix(c, vec3(0.92, 0.9, 0.85), tstep(0.5, tfract(u.x.mul(1.1))))); })
      .ElseIf(kk.equal(21), () => { c.mulAssign(N(lp.xz.mul(0.9)).mul(0.3).add(0.8)); });
    return c;
  })();
  m.roughnessNode = Fn(() => {
    const r = float(0.82).toVar();
    If(kk.equal(1), () => { r.assign(0.74); })
      .ElseIf(isWin, () => { r.assign(select(glass, select(lit, float(0.4), float(0.05)), float(0.55))); })
      .ElseIf(kk.equal(3), () => { r.assign(0.86); })
      .ElseIf(kk.equal(4), () => { r.assign(float(0.9).sub(wheel.mul(0.25)).sub(asN.mul(0.1))); })
      .ElseIf(kk.equal(5), () => { r.assign(0.62); })
      .ElseIf(kk.equal(6), () => { r.assign(0.88); })
      .ElseIf(kk.equal(7), () => { r.assign(0.9); })
      .ElseIf(kk.equal(8), () => { r.assign(0.8); })
      .ElseIf(kk.equal(9), () => { r.assign(0.32); })
      .ElseIf(kk.equal(10), () => { r.assign(0.3); })
      .ElseIf(kk.equal(11), () => { r.assign(0.9); })
      .ElseIf(kk.equal(12), () => { r.assign(0.18); })
      .ElseIf(kk.equal(14), () => { r.assign(0.7); })
      .ElseIf(kk.equal(15), () => { r.assign(mix(float(0.75), float(0.1), fw)); })
      .ElseIf(kk.equal(16).or(kk.equal(21)), () => { r.assign(0.95); })
      .ElseIf(kk.equal(17), () => { r.assign(0.9); })
      .ElseIf(kk.equal(18), () => { r.assign(0.85); })
      .ElseIf(kk.equal(19), () => { r.assign(0.7); })
      .ElseIf(kk.equal(30), () => { r.assign(0.28); })
      .ElseIf(kk.equal(31), () => { r.assign(0.3); });
    return r;
  })();
  m.metalnessNode = select(glass, float(0.15), select(kk.equal(9), float(0.75), select(kk.equal(12), float(0.9), select(kk.equal(30), float(0.35), float(0)))));
  m.emissiveNode = Fn(() => {
    const e = vec3(0).toVar();
    If(lit, () => {
      const cur = smoothstep(0.0, 0.25, tabs(u.x.sub(0.5)).sub(0.16)).mul(0.55);
      const lamp = N(lp.xz.mul(0.7).add(lp.y)).mul(0.25).add(0.75);
      e.assign(warm.mul(aE).mul(lamp).mul(float(1).sub(cur)).mul(mix(float(1.15), float(3.2), hdr)));
    }).ElseIf(kk.equal(10), () => { e.assign(vc.mul(aE).mul(mix(float(1), float(2.6), hdr))); })
      .ElseIf(kk.equal(15), () => { e.assign(vec3(1.0, 0.62, 0.3).mul(fw.mul(flit)).mul(mix(float(0.9), float(2.2), hdr)).mul(aE)); })
      .ElseIf(kk.equal(31), () => { const bl = tstep(0.45, tfract(uTime.mul(1.4))); e.assign(vc.mul(aE).mul(mix(float(0.04), float(1), bl)).mul(mix(float(1), float(2.6), hdr))); });
    return e;
  })();
  if (opts.position) m.positionNode = opts.position(positionLocal);
  return m;
}
