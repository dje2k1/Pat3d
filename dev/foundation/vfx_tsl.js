// ---------------------------------------------------------------- shaders (TSL)
// The v2 GLSL particle / ribbon / speed-line programs ported to TSL node materials: the motion is still evaluated in
// the vertex stage from the spawn data (vertexNode), the shapes in the fragment stage (fragmentNode, premultiplied
// output: the `add` share is pure light, the rest alpha-blended).
// PORT(vfx->post): v2 also fogged the effects (additive share fading out, alpha share mixing toward the fog colour) and
// switched light effects to "screen" blending on the direct (non-HDR) path; v3 (post+vfx builder): soft particles
// against the depth buffer, fog, HDR bloom-friendly intensities, maybe instancedArray / compute.
const { Fn, If, Discard, uniform, attribute, varyingProperty, vec2, vec3, vec4, float, mix, smoothstep, clamp: tclamp,
  abs: tabs, max: tmax, min: tmin, fract: tfract, floor: tfloor, mod: tmod, sin: tsin, cos: tcos, pow: tpow, exp: texp,
  dot: tdot, normalize: tnormalize, cross: tcross, length: tlength, sqrt: tsqrt, select, texture: ttexture,
  modelViewMatrix, cameraProjectionMatrix } = TSL;
const fu = v => uniform(v);
const max3 = c => tmax(c.x, tmax(c.y, c.z));
function blendMat(params) {
  const m = new THREE.MeshBasicNodeMaterial(Object.assign({
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, fog: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor
  }, params || {}));
  return m;
}
// premultiplied output of a colour col with alpha a and additive share add
const premul = (col, a, add) => {
  const aa = a.mul(float(1).sub(add));
  const rgb = select(add.greaterThan(0.004), col.mul(a.mul(add)), vec3(0)).add(col.mul(aa));
  return vec4(rgb, aa);
};
function particleMaterial(U) {
  const m = blendMat();
  const vUv = varyingProperty('vec2', 'vfxUv'), vCol = varyingProperty('vec4', 'vfxCol'), vInfo = varyingProperty('vec4', 'vfxInfo');
  const vMisc = varyingProperty('vec3', 'vfxMisc');
  const sizeCurve = (c, t) => select(c.lessThan(0.5), float(1).sub(float(1).sub(t).mul(float(1).sub(t))),
    select(c.lessThan(1.5), t, select(c.lessThan(2.5), smoothstep(0.0, 0.14, t).mul(float(1).sub(t.mul(t))), float(1).sub(tpow(float(1).sub(t), 4)))));
  m.vertexNode = Fn(() => {
    const i0 = attribute('i0', 'vec4'), i1 = attribute('i1', 'vec4'), i2 = attribute('i2', 'vec4'), i3 = attribute('i3', 'vec4');
    const i4 = attribute('i4', 'vec4'), i5 = attribute('i5', 'vec4'), i6 = attribute('i6', 'vec4'), i7 = attribute('i7', 'vec4');
    const aCorner = attribute('aCorner', 'vec2');
    vUv.assign(aCorner); vCol.assign(vec4(0)); vInfo.assign(vec4(0)); vMisc.assign(vec3(0));
    const out = vec4(0, 0, 2, 1).toVar();
    const age = U.uTime.sub(i0.w).toVar();
    If(age.greaterThanEqual(0).and(age.lessThan(i1.w)), () => {
      const t = age.div(i1.w).toVar();
      // i5.x packs shape + 8 * orientation + 32 * size curve (exact small integers)
      const oc = tfloor(i5.x.div(8).add(0.001)).toVar();
      const shp = i5.x.sub(oc.mul(8)).toVar();
      const curve = tfloor(oc.div(4).add(0.001)).toVar();
      const orient = oc.sub(curve.mul(4)).toVar();
      const planar = orient.greaterThan(1.5).and(orient.lessThan(2.5));
      const pos = vec3(i0.xyz).toVar();
      const vel = vec3(0).toVar();
      If(planar.not(), () => {
        const k = i2.z, g = vec3(0, i2.w.negate(), 0);
        If(k.greaterThan(0.001), () => {
          const ek = texp(k.negate().mul(age));
          const vt = g.div(k);
          pos.addAssign(vt.mul(age).add(i1.xyz.sub(vt).mul(float(1).sub(ek).div(k))));
          vel.assign(vt.add(i1.xyz.sub(vt).mul(ek)));
        }).Else(() => {
          pos.addAssign(i1.xyz.mul(age).add(g.mul(age.mul(age).mul(0.5))));
          vel.assign(i1.xyz.add(g.mul(age)));
        });
        If(i7.z.greaterThan(0), () => {
          const s = i6.x.mul(40);
          pos.addAssign(vec3(tsin(age.mul(2.7).add(s)), tsin(age.mul(1.9).add(s.mul(1.7))).mul(0.45), tcos(age.mul(2.3).add(s.mul(0.6)))).mul(i7.z.mul(tmin(age.mul(2.5), 1))));
        });
        // carried frame: the effect travels with whoever emitted it
        pos.addAssign(vec3(i5.y, i7.y, i7.w).mul(age));
      });
      const size = mix(i2.x, i2.y, sizeCurve(curve, t)).toVar();
      const a = mix(i3.w, i4.w, t).mul(float(1).sub(smoothstep(0.86, 1.0, t))).toVar();
      If(i7.x.greaterThan(0), () => { a.mulAssign(smoothstep(0.0, i7.x, t)); });
      const col = mix(i3.xyz, i4.xyz, t).toVar();
      If(i6.y.greaterThan(0), () => {
        const f0 = tsin(age.mul(i6.y).add(i6.x.mul(6.2832))).mul(0.5).add(0.5);
        const f = f0.mul(f0);
        col.mulAssign(f.mul(1.4).add(0.22));
        size.mulAssign(f.mul(0.42).add(0.7));
      });
      const mvc = modelViewMatrix.mul(vec4(pos, 1)).toVar();
      const depth = tmax(mvc.z.negate(), 0.01).toVar();
      If(planar.not(), () => {
        const px = size.mul(U.uPx).div(depth);
        If(px.lessThan(1.3), () => { a.mulAssign(px.div(1.3)); size.mulAssign(float(1.3).div(tmax(px, 1e-4))); });
        a.mulAssign(smoothstep(0.25, 1.2, depth));
      });
      const rot = i5.z.add(i5.w.mul(age));
      const cr = tcos(rot), sr = tsin(rot);
      const c = vec2(aCorner).toVar();
      const flip = float(1).toVar();
      If(shp.greaterThan(5.5).and(shp.lessThan(6.5)), () => {
        flip.assign(tcos(i6.x.mul(17).add(age.mul(i6.w))));
        c.assign(vec2(c.x, c.y.mul(tmax(tabs(flip), 0.07))));
      });
      const mv = vec4(mvc).toVar();
      const light = float(1).toVar();
      If(planar, () => {
        const n = tnormalize(i1.xyz.add(vec3(0, 1e-6, 0)));
        const ax = select(tabs(n.y).lessThan(0.95), vec3(0, 1, 0), vec3(1, 0, 0));
        const u = tnormalize(tcross(n, ax)), w = tcross(n, u);
        const rc = vec2(cr.mul(c.x).sub(sr.mul(c.y)), sr.mul(c.x).add(cr.mul(c.y)));
        mv.assign(modelViewMatrix.mul(vec4(pos.add(u.mul(rc.x).add(w.mul(rc.y)).mul(size)), 1)));
      }).ElseIf(orient.lessThan(1.5).and(orient.greaterThan(0.5)), () => {
        const vv = modelViewMatrix.mul(vec4(vel, 0)).xyz;
        const d = mvc.xy.mul(vv.z).sub(vv.xy.mul(mvc.z));
        const dl = tlength(d);
        const dir = select(dl.greaterThan(1e-6), d.div(tmax(dl, 1e-6)), vec2(0, 1));
        const len = size.add(i6.w.mul(dl).div(depth));
        const off = dir.mul(mix(len.negate(), size.mul(0.5), c.x.mul(0.5).add(0.5))).add(vec2(dir.y.negate(), dir.x).mul(c.y.mul(size).mul(0.5)));
        mv.assign(vec4(mvc.xy.add(off), mvc.z, mvc.w));
      }).Else(() => {
        // big soft sprites are pulled toward the eye (keeping their projected size) so they cut less into the ground
        const glowish = shp.lessThan(0.5).or(shp.greaterThan(4.5).and(shp.lessThan(5.5))).or(shp.greaterThan(6.5));
        const puffish = shp.greaterThan(1.5).and(shp.lessThan(3.5));
        const pull = select(glowish, tmin(size.mul(1.5), depth.mul(0.75)), select(puffish, tmin(size.mul(0.7), depth.mul(0.45)), float(0)));
        const kf = depth.sub(pull).div(depth);
        const sc = select(orient.greaterThan(2.5), vec2(c.x.mul(i6.w), c.y), vec2(cr.mul(c.x).sub(sr.mul(c.y)), sr.mul(c.x).add(cr.mul(c.y))));
        mv.assign(vec4(mvc.xyz.mul(kf).add(vec3(sc.mul(size).mul(kf), 0)), 1));
        light.assign(tclamp(sc.y.mul(0.38).add(0.5), 0, 1));
      });
      vCol.assign(vec4(col, a));
      vInfo.assign(vec4(shp, i6.z, i6.w, t));
      vMisc.assign(vec3(i6.x, light, flip));
      out.assign(cameraProjectionMatrix.mul(mv));
    });
    return out;
  })();
  m.fragmentNode = Fn(() => {
    const p = vUv, shape = vInfo.x, r2 = tdot(p, p);
    // the puff atlas is sampled once, outside the branches (WGSL needs uniform control flow for implicit LOD)
    const cell = tfloor(tfract(vMisc.x.mul(7.13)).mul(3.999));
    const poff = vec2(tmod(cell, 2), tfloor(cell.mul(0.5))).mul(0.5);
    const puffA = ttexture(U.uPuff, poff.add(0.25).add(p.mul(0.24))).a;
    const col = vec3(vCol.xyz).toVar(), add = float(vInfo.y).toVar(), m0 = float(0).toVar();
    If(shape.lessThan(0.5), () => {
      If(r2.greaterThanEqual(1), () => { Discard(); });
      const q = float(1).sub(r2);
      m0.assign(q.mul(q).mul(0.5).add(texp(r2.mul(-20)).mul(0.8)));
    }).ElseIf(shape.lessThan(1.5), () => {
      const q = tabs(p);
      const wx = float(1).sub(q.x).mul(0.075).add(0.006), wy = float(1).sub(q.y).mul(0.075).add(0.006);
      const rays = texp(q.y.mul(q.y).div(wx.mul(wx)).negate()).mul(float(1).sub(q.x)).add(texp(q.x.mul(q.x).div(wy.mul(wy)).negate()).mul(float(1).sub(q.y)));
      const core = texp(r2.mul(-42));
      m0.assign(rays.mul(0.95).add(core.mul(1.25)).add(texp(r2.mul(-8)).mul(0.16)));
      col.assign(mix(col, vec3(max3(col)), tmin(core.mul(0.75), 1)));
    }).ElseIf(shape.lessThan(2.5), () => {
      If(r2.greaterThanEqual(1), () => { Discard(); });
      m0.assign(puffA);
      col.mulAssign(mix(float(0.68), float(1.22), vMisc.y));
    }).ElseIf(shape.lessThan(3.5), () => {
      If(r2.greaterThanEqual(1), () => { Discard(); });
      const d = puffA;
      const heat = tclamp(d.mul(1.3).sub(vInfo.w.mul(1.35)).add(0.04), 0, 1);
      const f = mix(mix(mix(vec3(0.1, 0.022, 0.012), vec3(1.5, 0.3, 0.035), smoothstep(0.0, 0.3, heat)), vec3(3.0, 1.2, 0.17), smoothstep(0.25, 0.62, heat)), vec3(4.8, 3.4, 1.5), smoothstep(0.62, 1.0, heat));
      col.mulAssign(f);
      add.mulAssign(smoothstep(0.02, 0.32, heat).mul(0.7).add(0.3));
      m0.assign(d);
    }).ElseIf(shape.lessThan(4.5), () => {
      const x01 = p.x.mul(0.5).add(0.5), y2 = p.y.mul(p.y);
      const core = texp(y2.mul(-22));
      m0.assign(texp(y2.mul(-3.5)).mul(0.45).add(core).mul(tpow(x01, 1.4)).mul(smoothstep(1.0, 0.9, x01)));
      col.assign(mix(col, vec3(max3(col)), core.mul(0.25)));
    }).ElseIf(shape.lessThan(5.5), () => {
      const r = tsqrt(r2);
      If(r.greaterThanEqual(1), () => { Discard(); });
      const th = tmax(vInfo.z, 0.03), rr = float(1).sub(th), e = r.sub(rr).div(th);
      m0.assign(texp(e.mul(e).mul(-2.6)).add(smoothstep(0.15, rr, r).mul(select(r.lessThanEqual(rr), float(0.07), float(0)))).mul(smoothstep(1.0, 0.95, r)));
    }).ElseIf(shape.lessThan(6.5), () => {
      m0.assign(smoothstep(1.0, 0.8, tabs(p.x)).mul(smoothstep(0.64, 0.46, tabs(p.y))));
      const fl = tabs(vMisc.z);
      col.assign(col.mul(fl.mul(0.58).add(0.42)).add(vec3(tpow(fl, 40).mul(1.6))));
    }).Else(() => {
      const ax = tabs(p.x);
      m0.assign(texp(p.y.mul(p.y).mul(-18)).mul(tpow(float(1).sub(ax), 2.4)).add(texp(p.x.mul(p.x).mul(50).add(p.y.mul(p.y).mul(3)).negate()).mul(0.7)));
    });
    const a = vCol.w.mul(m0);
    If(a.lessThan(0.002), () => { Discard(); });
    return premul(col, a, add);
  })();
  return m;
}
function ribbonMaterial(U) {
  const m = blendMat();
  const aTan = attribute('aTan', 'vec3'), aCol = attribute('aCol', 'vec4'), aSide = attribute('aSide', 'vec4');
  const mv0 = modelViewMatrix.mul(vec4(attribute('position', 'vec3'), 1));
  const tv = modelViewMatrix.mul(vec4(aTan, 0)).xyz;
  const s0 = tcross(tv, mv0.xyz), l = tlength(s0);
  const s = select(l.greaterThan(1e-7), s0.div(tmax(l, 1e-7)), vec3(0));
  const mv = vec4(mv0.xyz.add(s.mul(aSide.x.mul(aSide.y))), 1);
  m.vertexNode = cameraProjectionMatrix.mul(mv);
  const fade = smoothstep(1.2, 4.0, mv.z.negate()).toVarying('vfxRibFade');
  m.fragmentNode = Fn(() => {
    const v = aSide.x;
    const core = texp(v.mul(v).mul(-14));
    const mm = tmax(texp(v.mul(v).mul(-2.4)).sub(0.09), 0).add(core.mul(0.45));
    const energy = tsin(aSide.z.mul(4).sub(U.uClock.mul(26))).mul(0.2).add(0.8);
    const col = mix(aCol.xyz, vec3(max3(aCol.xyz)), core.mul(0.45)).mul(energy);
    const a = aCol.w.mul(fade).mul(mm);
    If(a.lessThan(0.002), () => { Discard(); });
    return premul(col, a, aSide.w);
  })();
  return m;
}
function speedLineMaterial(u) {
  const m = blendMat();
  const iA = attribute('iA', 'vec4'), iB = attribute('iB', 'vec4'), aCorner = attribute('aCorner', 'vec2');
  const vA = varyingProperty('float', 'vfxSlA');
  m.vertexNode = Fn(() => {
    vA.assign(0);
    const out = vec4(0, 0, 2, 1).toVar();
    If(iB.z.lessThanEqual(u.uInt), () => {
      const f = tnormalize(u.uFlow.add(vec3(0, 0, -1e-4)));
      const ax = select(tabs(f.y).lessThan(0.9), vec3(0, 1, 0), vec3(1, 0, 0));
      const uu = tnormalize(tcross(f, ax)), w = tcross(f, uu);
      const span = 52.0;
      const z = float(44).sub(tmod(iA.z.mul(span).add(u.uTime.mul(iA.w)), span));
      const c = uu.mul(tcos(iA.x)).add(w.mul(tsin(iA.x))).mul(iA.y).add(f.mul(z));
      const len = iB.x.mul(u.uInt.mul(0.9).add(0.55));
      const p = c.add(f.mul(len.mul(aCorner.x.mul(0.5).add(0.5)))).toVar();
      const sd = tcross(f, p), sl = tlength(sd);
      p.addAssign(select(sl.greaterThan(1e-5), sd.div(tmax(sl, 1e-5)), uu).mul(aCorner.y.mul(iB.y)));
      vA.assign(smoothstep(44.0, 26.0, z).mul(smoothstep(-6.0, 1.5, z)).mul(tmin(u.uInt.mul(1.7), 1)).mul(iB.w));
      out.assign(cameraProjectionMatrix.mul(vec4(p, 1)));
    });
    return out;
  })();
  m.fragmentNode = Fn(() => {
    const x01 = aCorner.x.mul(0.5).add(0.5);
    const a = vA.mul(texp(aCorner.y.mul(aCorner.y).mul(-3))).mul(tsin(x01.mul(3.14159))).mul(float(1).sub(x01).mul(0.65).add(0.35));
    If(a.lessThan(0.003), () => { Discard(); });
    return vec4(u.uCol.mul(a), a.mul(0.2));
  })();
  m.uniforms = u;
  return m;
}
