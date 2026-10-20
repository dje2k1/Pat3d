// ===================== 16-vfx.js — K.vfx: HDR particles, ribbon trails, debris, speed lines =====================
// Two instanced particle pools (soft = smoke/dust/confetti, glow = sparks/stars/fire) whose motion is evaluated in the
// vertex shader from spawn data (one buffer write per spawn, nothing per particle per frame), premultiplied blending
// with a per-particle additive/alpha mix, ribbon trails, lit debris chunks and camera-space wind streaks.
// Colours are linear HDR (> 1) so a bloom pass makes them glow; tone mapping/encoding follow the renderer settings.
(() => {
const TAU = Math.PI * 2;
// xorshift32: inlines into the emitters (no boxed doubles from the Math.random builtin in the hot path)
const SEED = new Int32Array([((Math.random() * 4294967295) >>> 0) || 0x9e3779b9]);
function rnd() { let s = SEED[0]; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; SEED[0] = s; return (s >>> 0) * 2.3283064365386963e-10; }
const fin = v => typeof v === 'number' && v - v === 0;
const okV = v => !!v && fin(v.x) && fin(v.y) && fin(v.z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// particle shapes, orientations and size curves (mirrored in the shaders)
const GLOW = 0, STAR = 1, PUFF = 2, FIRE = 3, STREAK = 4, RING = 5, PAPER = 6, FLARE = 7;
const BILL = 0, VEL = 1, PLANE = 2, WIDE = 3;
const EASE = 0, LIN = 1, POP = 2, EXPO = 3;

// linear RGB palette; effects scale these into HDR
const PAL = {
  white: [1, 1, 1], gold: [1, 0.55, 0.1], goldD: [1, 0.32, 0.03], goldS: [1, 0.42, 0.045], warm: [1, 0.86, 0.62], cream: [1, 0.9, 0.66], amber: [1, 0.5, 0.08],
  sky: [0.6, 0.85, 1], cyan: [0.3, 0.78, 1], blue: [0.12, 0.38, 1], spark: [1, 0.46, 0.1], hot: [1, 0.82, 0.55],
  fire: [1, 0.55, 0.2], smoke: [0.095, 0.09, 0.095], smokeL: [0.3, 0.29, 0.3], metal: [0.45, 0.47, 0.52],
  dark: [0.09, 0.09, 0.1], red: [0.75, 0.06, 0.04], yellow: [0.95, 0.66, 0.05],
  dust: [0.8, 0.68, 0.5], dustD: [0.6, 0.5, 0.37], asphalt: [0.5, 0.48, 0.47], asphaltD: [0.33, 0.32, 0.32],
  pebble: [0.36, 0.24, 0.13], grass: [0.16, 0.5, 0.08], stone: [0.42, 0.4, 0.38]
};
const CONF = [[1, 0.32, 0.02], [0, 0.66, 0.58], [0.06, 0.26, 1], [1, 0.76, 0.04], [1, 0.12, 0.38], [0.22, 0.8, 0.1], [0.92, 0.92, 0.96]];
const FIREWORK = [[1, 0.62, 0.16], [0.3, 0.78, 1], [1, 0.25, 0.55]];
// ribbon presets: life, head width, tail width, head colour, tail colour, additive share
const RB_HOM = { life: 0.3, w0: 0.38, w1: 0.04, h: [0.9, 1.9, 4.4], t: [0.05, 0.2, 2.0], add: 0.85 };
const RB_BALL = { life: 0.18, w0: 0.21, w1: 0.03, h: [0.6, 1.65, 3.8], t: [0.05, 0.24, 2.0], add: 0.88 };
const RB_FLY = { life: 0.55, w0: 0.15, w1: 0.01, h: [2.6, 1.7, 0.6], t: [1.6, 0.5, 0.06], add: 0.85 };
const CH_HOM = 0, CH_B0 = 1, CH_B1 = 2, CH_F0 = 3, CH_F1 = 4, CH_N = 5;

const STRIDE = 32;                 // floats per particle slot (8 vec4)
const RIB_P = 40;                  // points per ribbon
const RV = 14;                     // floats per ribbon vertex
const CHK = 20;                    // floats per debris chunk
const CULL2 = 260 * 260;           // spawns farther than this from the camera are skipped

const ST = {
  ready: false, failed: false, scene: null, touch: false, T: 0, clock: 0, D: 1, warm: 0,
  hasCam: false, camX: 0, camY: 0, camZ: 0, pcx: 0, pcy: 0, pcz: 0, rX: 1, rY: 0, rZ: 0, fX: 0, fY: 0, fZ: -1,
  bX: 0, bY: 0, bZ: 1, uX: 0, uY: 1, uZ: 0, cvx: 0, cvy: 0, cvz: 0,
  soft: null, glow: null, mat: null, uTime: null, uPx: null, uClock: null, tex: null,
  spawned: 0, dropped: 0, ground: null, tm: -1, enc: -1, ts: NaN, dt: 0.5,
  hX: 0, hY: 0, hZ: 0, hT: -1, hvx: 0, hvy: 0, hvz: 0,
  // ribbons
  rib: null, ribs: [], chan: null, chanT: null, ribMat: null, ribMax: 0,
  // ball helix frame (parallel transported)
  hbX: 1, hbY: 0, hbZ: 0, fbX: 1, fbY: 0, fbZ: 0,
  // debris
  chk: null, chkN: 0, chkCap: 0, chkMesh: null, chkM: null, chkQ: null, chkE: null, chkP: null, chkS: null, chkDirty: false,
  // speed lines
  sl: null, slI: 0, slTarget: 0, slLast: -1, sdX: 0, sdY: 0, sdZ: -1, sdLast: -1, flX: 0, flY: 0, flZ: -1
};

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
      const cr = tcos(rot).toVar(), sr = tsin(rot).toVar();
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
  m.outputNode = Fn(() => {
    // every value shared by several If branches is a var set before the branches: TSL would otherwise emit it inside
    // the first branch that uses it and read it uninitialised in the others
    const p = vec2(vUv).toVar(), shape = float(vInfo.x).toVar(), r2 = tdot(p, p).toVar();
    // the puff atlas is sampled once, outside the branches (WGSL needs uniform control flow for implicit LOD)
    const cell = tfloor(tfract(vMisc.x.mul(7.13)).mul(3.999));
    const poff = vec2(tmod(cell, 2), tfloor(cell.mul(0.5))).mul(0.5);
    const puffA = ttexture(U.uPuff, poff.add(0.25).add(p.mul(0.24))).a.toVar();
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
  m.outputNode = Fn(() => {
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
  m.outputNode = Fn(() => {
    const x01 = aCorner.x.mul(0.5).add(0.5);
    const a = vA.mul(texp(aCorner.y.mul(aCorner.y).mul(-3))).mul(tsin(x01.mul(3.14159))).mul(float(1).sub(x01).mul(0.65).add(0.35));
    If(a.lessThan(0.003), () => { Discard(); });
    return vec4(u.uCol.mul(a), a.mul(0.2));
  })();
  m.uniforms = u;
  return m;
}

// ---------------------------------------------------------------- procedural puff atlas (4 noisy cloud puffs, 2x2)
function puffTexture() {
  const S = 256, H = 128, data = new Uint8Array(S * S * 4);
  const L = 64, lat = new Float32Array(L * L);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const vn = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const x0 = xi & (L - 1), x1 = (xi + 1) & (L - 1), y0 = (yi & (L - 1)) * L, y1 = ((yi + 1) & (L - 1)) * L;
    const a = lat[y0 + x0], b = lat[y0 + x1], c = lat[y1 + x0], d = lat[y1 + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell & 1) * H, oy = (cell >> 1) * H, sx = 11.3 + cell * 17.7, sy = 5.1 + cell * 9.3;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < H; x++) {
        const u = (x + 0.5) / H * 2 - 1, v = (y + 0.5) / H * 2 - 1, r = Math.sqrt(u * u + v * v);
        let f = 0, amp = 0.5, fr = 2.6;
        for (let o = 0; o < 4; o++) { f += amp * vn(u * fr + sx + o * 7.7, v * fr + sy + o * 3.3); amp *= 0.5; fr *= 2.03; }
        f /= 0.9375;
        let d = 1 - sm(0.28, 0.96, r + (f - 0.5) * 0.62);
        d *= 0.5 + 0.62 * f;
        d *= 1 - sm(0.86, 1.0, r);
        const k = ((oy + y) * S + ox + x) * 4, b = Math.round(clamp(d, 0, 1) * 255);
        data[k] = 255; data[k + 1] = 255; data[k + 2] = 255; data[k + 3] = b;
      }
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- particle pools
function quadGeometry() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3)); // degenerate under foreign materials
  g.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  g.instanceCount = 0;
  return g;
}
function makePool(cap, order, name, mat) {
  const arr = new Float32Array(cap * STRIDE);
  const ib = new THREE.InstancedInterleavedBuffer(arr, STRIDE, 1);
  ib.setUsage(THREE.DynamicDrawUsage);
  const geo = quadGeometry();
  for (let k = 0; k < 8; k++) geo.setAttribute('i' + k, new THREE.InterleavedBufferAttribute(ib, 4, k * 4));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name; mesh.frustumCulled = false; mesh.renderOrder = order; mesh.matrixAutoUpdate = false;
  const P = { cap, arr, ib, geo, mesh, cur: 0, hw: 0, end: -1, dmin: cap, dmax: -1, n: 0, budget: Math.ceil(cap / 3) };
  // an upload happens while the render list is built, before any draw: once drawn, the dirty span is consumed
  mesh.onBeforeRender = () => { P.dmin = P.cap; P.dmax = -1; };
  return P;
}

const E = {
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, delay: 0, s0: 1, s1: 1, drag: 0, grav: 0,
  r0: 1, g0: 1, b0: 1, a0: 1, r1: 1, g1: 1, b1: 1, a1: 0, shape: 0, orient: 0, rot: 0, spin: 0,
  tw: 0, add: 1, par: 0, fin: 0, curve: 0, wob: 0, str: 0, cx: 0, cy: 0, cz: 0
};
function e(shape, life) {
  E.shape = shape; E.life = life; E.orient = BILL; E.delay = 0; E.vx = E.vy = E.vz = 0; E.drag = 0; E.grav = 0;
  E.rot = rnd() * TAU; E.spin = 0; E.tw = 0; E.add = 1; E.par = 0; E.fin = 0; E.curve = EASE; E.wob = 0; E.str = 0;
  E.cx = E.cy = E.cz = 0;
  E.s0 = E.s1 = 1; E.a1 = 0;
  return E;
}
function at(x, y, z) { E.x = x; E.y = y; E.z = z; }
function vel(x, y, z) { E.vx = x; E.vy = y; E.vz = z; }
function c0(c, k, a) { E.r0 = c[0] * k; E.g0 = c[1] * k; E.b0 = c[2] * k; E.a0 = a; }
function c1(c, k, a) { E.r1 = c[0] * k; E.g1 = c[1] * k; E.b1 = c[2] * k; E.a1 = a; }
function put(P) {
  if (P.n >= P.budget) { ST.dropped++; return; }
  if (ST.hasCam) {
    const ddx = E.x - ST.camX, ddy = E.y - ST.camY, ddz = E.z - ST.camZ;
    if (ddx * ddx + ddy * ddy + ddz * ddz > CULL2) return;
  }
  if (!(fin(E.x) && fin(E.y) && fin(E.z) && fin(E.vx) && fin(E.vy) && fin(E.vz) && fin(E.cx + E.cy + E.cz) && E.life > 0)) return;
  const i = P.cur;
  P.cur = i + 1 >= P.cap ? 0 : i + 1;
  if (i >= P.hw) P.hw = i + 1;
  const a = P.arr, o = i * STRIDE, t0 = ST.T + E.delay;
  a[o] = E.x; a[o + 1] = E.y; a[o + 2] = E.z; a[o + 3] = t0;
  a[o + 4] = E.vx; a[o + 5] = E.vy; a[o + 6] = E.vz; a[o + 7] = E.life;
  a[o + 8] = E.s0; a[o + 9] = E.s1; a[o + 10] = E.drag; a[o + 11] = E.grav;
  a[o + 12] = E.r0; a[o + 13] = E.g0; a[o + 14] = E.b0; a[o + 15] = E.a0;
  a[o + 16] = E.r1; a[o + 17] = E.g1; a[o + 18] = E.b1; a[o + 19] = E.a1;
  a[o + 20] = E.shape + E.orient * 8 + E.curve * 32; a[o + 21] = E.cx; a[o + 22] = E.rot; a[o + 23] = E.spin;
  a[o + 24] = rnd(); a[o + 25] = E.tw; a[o + 26] = E.add; a[o + 27] = E.orient === VEL ? E.str : E.par;
  a[o + 28] = E.fin; a[o + 29] = E.cy; a[o + 30] = E.wob; a[o + 31] = E.cz;
  const end = t0 + E.life;
  if (end > P.end) P.end = end;
  if (i < P.dmin) P.dmin = i;
  if (i > P.dmax) P.dmax = i;
  P.ib.clearUpdateRanges();
  P.ib.addUpdateRange(P.dmin * STRIDE, (P.dmax - P.dmin + 1) * STRIDE);
  P.ib.needsUpdate = true;
  P.geo.instanceCount = P.hw;
  P.mesh.visible = true;
  P.n++; ST.spawned++;
}
function idlePool(P) {
  P.hw = 0; P.cur = 0; P.end = -1;
  P.geo.instanceCount = 0;
  P.mesh.visible = false;
}

// ---------------------------------------------------------------- small vector helpers (results in module scalars)
// scratch results of the vector helpers: fields of one object (unboxed doubles), not closure variables, so the
// per-tick emitters do not allocate a heap number on every write
const Q = { dx: 0.5, dy: 0.5, dz: 0.5, nx: 0.5, ny: 0.5, nz: 0.5, ux: 0.5, uy: 0.5, uz: 0.5, wx: 0.5, wy: 0.5, wz: 0.5,
  gnx: 0.5, gny: 0.5, gnz: 0.5, kvx: 0.5, kvy: 0.5, kvz: 0.5, rx: 0.5, ry: 0.5, rz: 0.5, ram: 0.5 };
function ribAt(x, y, z, am) { Q.rx = x; Q.ry = y; Q.rz = z; Q.ram = am; }
const CC = [1, 1, 1], CW = [1, 1, 1];
function rdir() {
  let x, y, z, l;
  do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 1e-4);
  l = 1 / Math.sqrt(l); Q.dx = x * l; Q.dy = y * l; Q.dz = z * l;
}
function cone(ax, ay, az, spread) {
  rdir();
  let x = ax + Q.dx * spread, y = ay + Q.dy * spread, z = az + Q.dz * spread, l = Math.sqrt(x * x + y * y + z * z);
  if (l < 1e-6) { x = ax; y = ay; z = az; l = Math.sqrt(x * x + y * y + z * z) || 1; }
  Q.dx = x / l; Q.dy = y / l; Q.dz = z / l;
}
function upBias(b) { Q.dy = Q.dy * (1 - b) + b; const l = Math.sqrt(Q.dx * Q.dx + Q.dy * Q.dy + Q.dz * Q.dz) || 1; Q.dx /= l; Q.dy /= l; Q.dz /= l; }
function nrm(v, x, y, z) {
  if (okV(v)) { const l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); if (l > 1e-6) { Q.nx = v.x / l; Q.ny = v.y / l; Q.nz = v.z / l; return true; } }
  Q.nx = x; Q.ny = y; Q.nz = z; return false;
}
function basis(x, y, z) {
  let ax = 0, ay = 1, az = 0;
  if (Math.abs(y) > 0.95) { ax = 1; ay = 0; }
  let px = y * az - z * ay, py = z * ax - x * az, pz = x * ay - y * ax;
  const l = 1 / (Math.sqrt(px * px + py * py + pz * pz) || 1);
  Q.ux = px * l; Q.uy = py * l; Q.uz = pz * l;
  Q.wx = y * Q.uz - z * Q.uy; Q.wy = z * Q.ux - x * Q.uz; Q.wz = x * Q.uy - y * Q.ux;
}
const s2l = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
// colour argument: hex number / THREE.Color / {r,g,b} are sRGB; an [r,g,b] array is linear
function colour(c, def) {
  if (typeof c === 'number' && fin(c)) { CC[0] = s2l(((c >> 16) & 255) / 255); CC[1] = s2l(((c >> 8) & 255) / 255); CC[2] = s2l((c & 255) / 255); }
  else if (c && fin(c.r) && fin(c.g) && fin(c.b)) { CC[0] = s2l(clamp(c.r, 0, 1)); CC[1] = s2l(clamp(c.g, 0, 1)); CC[2] = s2l(clamp(c.b, 0, 1)); }
  else if (Array.isArray(c) && fin(c[0]) && fin(c[1]) && fin(c[2])) { CC[0] = Math.max(0, c[0]); CC[1] = Math.max(0, c[1]); CC[2] = Math.max(0, c[2]); }
  else { CC[0] = def[0]; CC[1] = def[1]; CC[2] = def[2]; }
  const m = Math.max(CC[0], CC[1], CC[2], 1e-4);
  if (m > 1) { CC[0] /= m; CC[1] /= m; CC[2] /= m; }
  // a whiter version for hot cores
  CW[0] = CC[0] * 0.45 + 0.55; CW[1] = CC[1] * 0.45 + 0.55; CW[2] = CC[2] * 0.45 + 0.55;
  return CC;
}
function cnt(n) { const v = n * ST.D, k = Math.floor(v); return k + (rnd() < v - k ? 1 : 0); }
function go(p) { return ST.ready && okV(p); }
function isCity() { return !!(K.game && K.game.act === 2); }
// ground height below a point (NaN when none); its normal is left in Q.gnx/Q.gny/Q.gnz
function groundY(x, y, z) {
  Q.gnx = 0; Q.gny = 1; Q.gnz = 0;
  try {
    let g = null;
    if (typeof ST.ground === 'function') g = ST.ground(x, z, y + 0.5);
    else if (isCity() && K.city && typeof K.city.ground === 'function') g = K.city.ground(x, z, y + 0.5);
    else if (K.world && typeof K.world.ground === 'function') g = K.world.ground(x, z, y + 0.5);
    const gy = typeof g === 'number' ? g : g && g.y;
    if (g && okV(g.n) && g.n.y > 0.2) { const l = Math.sqrt(g.n.x * g.n.x + g.n.y * g.n.y + g.n.z * g.n.z); Q.gnx = g.n.x / l; Q.gny = g.n.y / l; Q.gnz = g.n.z / l; }
    return fin(gy) ? gy : NaN;
  } catch (err) { return NaN; }
}

// carry velocity for the effect being spawned: an emitter's velocity (else the camera's, which follows the player),
// projected onto the plane across `up` so a jump's own climb is not inherited
function carryFrom(v, ax, ay, az) {
  let x = ST.cvx, y = ST.cvy, z = ST.cvz;
  if (okV(v)) { x = v.x; y = v.y; z = v.z; }
  const d = x * ax + y * ay + z * az;
  x -= ax * d; y -= ay * d; z -= az * d;
  const l = Math.sqrt(x * x + y * y + z * z);
  if (!(l > 0.75)) { Q.kvx = Q.kvy = Q.kvz = 0; return; }
  const m = Math.min(l, 45) / l;
  Q.kvx = x * m; Q.kvy = y * m; Q.kvz = z * m;
}
function carry(k) { E.cx = Q.kvx * k; E.cy = Q.kvy * k; E.cz = Q.kvz * k; }

// ---------------------------------------------------------------- ribbons
function makeRibbons(n) {
  const verts = n * RIB_P * 2;
  const arr = new Float32Array(verts * RV);
  const ib = new THREE.InterleavedBuffer(arr, RV);
  ib.setUsage(THREE.DynamicDrawUsage);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
  geo.setAttribute('aTan', new THREE.InterleavedBufferAttribute(ib, 3, 3));
  geo.setAttribute('aCol', new THREE.InterleavedBufferAttribute(ib, 4, 6));
  geo.setAttribute('aSide', new THREE.InterleavedBufferAttribute(ib, 4, 10));
  const idx = new Uint16Array(n * (RIB_P - 1) * 6);
  let k = 0;
  for (let r = 0; r < n; r++) {
    for (let s = 0; s < RIB_P - 1; s++) {
      const a = (r * RIB_P + s) * 2;
      idx[k++] = a; idx[k++] = a + 1; idx[k++] = a + 2;
      idx[k++] = a + 1; idx[k++] = a + 3; idx[k++] = a + 2;
    }
  }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  geo.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geo, ST.ribMat);
  mesh.name = 'vfx-ribbons'; mesh.frustumCulled = false; mesh.renderOrder = 25; mesh.matrixAutoUpdate = false;
  const R = { n, arr, ib, geo, mesh, dmin: 1e9, dmax: -1 };
  mesh.onBeforeRender = () => { R.dmin = 1e9; R.dmax = -1; };
  for (let i = 0; i < n; i++) {
    ST.ribs.push({ on: false, ch: -1, n: 0, h: 0, xs: new Float64Array(RIB_P * 4), life: 0.3, w0: 0.3, w1: 0.05, h0: [1, 1, 1], t0: [1, 1, 1], add: 1, am: 1, last: -1e9, written: 0 });
  }
  return R;
}
function ribDirty(a, b) { const R = ST.rib; if (a < R.dmin) R.dmin = a; if (b > R.dmax) R.dmax = b; }
// appends the point (Q.rx, Q.ry, Q.rz) with alpha scale Q.ram to channel `ch` (scalars passed through Q: no boxing)
function rib(ch, pr) {
  const x = Q.rx, y = Q.ry, z = Q.rz, am = Q.ram;
  if (!(fin(x) && fin(y) && fin(z))) return;
  let ri = ST.chan[ch], r = ri >= 0 ? ST.ribs[ri] : null;
  if (r && (!r.on || r.ch !== ch || ST.clock - ST.chanT[ch] > 0.075)) { if (r.ch === ch) r.ch = -1; r = null; }
  if (!r) {
    ri = -1;
    let best = -1, bt = 1e18;
    for (let i = 0; i < ST.ribs.length; i++) {
      const q = ST.ribs[i];
      if (!q.on) { ri = i; break; }
      if (q.last < bt && q.ch < 0) { bt = q.last; best = i; }
    }
    if (ri < 0) ri = best;
    if (ri < 0) return;
    r = ST.ribs[ri];
    if (r.on && r.ch >= 0 && ST.chan[r.ch] === ri) ST.chan[r.ch] = -1;
    r.on = true; r.ch = ch; r.n = 0; r.h = 0;
    r.life = pr.life; r.w0 = pr.w0; r.w1 = pr.w1; r.add = pr.add;
    r.h0[0] = pr.h[0]; r.h0[1] = pr.h[1]; r.h0[2] = pr.h[2]; r.t0[0] = pr.t[0]; r.t0[1] = pr.t[1]; r.t0[2] = pr.t[2];
    ST.chan[ch] = ri;
    if (ri + 1 > ST.ribMax) ST.ribMax = ri + 1;
  }
  ST.chanT[ch] = ST.clock;
  r.am = fin(am) ? clamp(am, 0, 2) : 1;
  r.last = ST.clock;
  const xs = r.xs;
  if (r.n > 0) {
    const o = r.h * 4, ex = x - xs[o], ey = y - xs[o + 1], ez = z - xs[o + 2];
    if (ex * ex + ey * ey + ez * ez < 4e-4) { xs[o] = x; xs[o + 1] = y; xs[o + 2] = z; xs[o + 3] = ST.clock; return; }
    r.h = r.h + 1 >= RIB_P ? 0 : r.h + 1;
  }
  const o = r.h * 4;
  xs[o] = x; xs[o + 1] = y; xs[o + 2] = z; xs[o + 3] = ST.clock;
  if (r.n < RIB_P) r.n++;
  ST.rib.mesh.visible = true;
}
function writeRibbon(ri, r) {
  const A = ST.rib.arr, xs = r.xs, base = ri * RIB_P * 2, P = RIB_P;
  let u = 0, px = 0, py = 0, pz = 0;
  for (let k = 0; k < r.n; k++) {
    const i = (r.h - k + P) % P, o = i * 4;
    const x = xs[o], y = xs[o + 1], z = xs[o + 2];
    const ia = (k > 0 ? (r.h - k + 1 + P) % P : i) * 4, ib = (k < r.n - 1 ? (r.h - k - 1 + P) % P : i) * 4;
    const tx = xs[ia] - xs[ib], ty = xs[ia + 1] - xs[ib + 1], tz = xs[ia + 2] - xs[ib + 2];
    if (k > 0) u += Math.sqrt((x - px) * (x - px) + (y - py) * (y - py) + (z - pz) * (z - pz));
    px = x; py = y; pz = z;
    const age = clamp((ST.clock - xs[o + 3]) / r.life, 0, 1), f = 1 - age;
    const al = f * f * r.am * Math.min(1, (r.n - 1 - k) / 3);
    const w = r.w0 + (r.w1 - r.w0) * Math.sqrt(age);
    const cr = r.h0[0] + (r.t0[0] - r.h0[0]) * age, cg = r.h0[1] + (r.t0[1] - r.h0[1]) * age, cb = r.h0[2] + (r.t0[2] - r.h0[2]) * age;
    for (let s = 0; s < 2; s++) {
      const v = (base + k * 2 + s) * RV;
      A[v] = x; A[v + 1] = y; A[v + 2] = z; A[v + 3] = tx; A[v + 4] = ty; A[v + 5] = tz;
      A[v + 6] = cr; A[v + 7] = cg; A[v + 8] = cb; A[v + 9] = al;
      A[v + 10] = s ? 1 : -1; A[v + 11] = w; A[v + 12] = u; A[v + 13] = r.add;
    }
  }
  // collapse the rest of what this ribbon drew last frame onto its last point (always the vertex pair right after
  // the tail too: the index buffer joins it to the tail)
  const end = Math.min(RIB_P, Math.max(r.written, r.n + 1));
  for (let k = r.n; k < end; k++) {
    for (let s = 0; s < 2; s++) {
      const v = (base + k * 2 + s) * RV;
      A[v] = px; A[v + 1] = py; A[v + 2] = pz; A[v + 9] = 0; A[v + 11] = 0;
    }
  }
  const hi = end;
  if (hi > 0) ribDirty(base * RV, (base + hi * 2) * RV - 1);
  r.written = r.n;
}
function updateRibbons() {
  const R = ST.rib, P = RIB_P;
  let any = false, top = 0;
  for (let ri = 0; ri < ST.ribMax; ri++) {
    const r = ST.ribs[ri];
    if (!r.on) continue;
    while (r.n > 0) {
      const oi = ((r.h - r.n + 1) % P + P) % P;
      if (ST.clock - r.xs[oi * 4 + 3] > r.life) r.n--; else break;
    }
    if (r.n === 0) {
      r.on = false;
      if (r.ch >= 0 && ST.chan[r.ch] === ri) ST.chan[r.ch] = -1;
      r.ch = -1;
    }
    writeRibbon(ri, r);
    if (r.on) { any = true; top = ri + 1; }
  }
  if (R.dmax >= 0) {
    R.ib.clearUpdateRanges();
    R.ib.addUpdateRange(R.dmin, R.dmax - R.dmin + 1);
    R.ib.needsUpdate = true;
  }
  ST.ribMax = top;
  R.geo.setDrawRange(0, top * (P - 1) * 6);
  R.mesh.visible = any;
}

// ---------------------------------------------------------------- debris chunks (lit, tumbling, bouncing)
function chunkGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.attributes.position, h = (a, b, c) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.7 + 0.55 * h(Math.round(x * 100), Math.round(y * 100), Math.round(z * 100));
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}
function makeChunks(cap) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.3, flatShading: true });
  const mesh = new THREE.InstancedMesh(chunkGeometry(), mat, cap);
  mesh.name = 'vfx-debris';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const col = new THREE.Color(1, 1, 1);
  for (let i = 0; i < cap; i++) mesh.setColorAt(i, col);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  mesh.castShadow = !ST.touch; mesh.receiveShadow = false;
  ST.chk = new Float32Array(cap * CHK);
  ST.chkCap = cap; ST.chkN = 0; ST.chkMesh = mesh;
  ST.chkM = new THREE.Matrix4(); ST.chkQ = new THREE.Quaternion(); ST.chkE = new THREE.Euler();
  ST.chkP = new THREE.Vector3(); ST.chkS = new THREE.Vector3();
  return mesh;
}
function chunk(x, y, z, vx, vy, vz, size, c, k, floorY, life) {
  if (!ST.chkMesh || !(fin(x) && fin(y) && fin(z) && fin(vx) && fin(vy) && fin(vz))) return;
  let i = ST.chkN;
  if (i >= ST.chkCap) {
    // replace the oldest-looking piece
    let best = 0, ba = -1;
    for (let j = 0; j < ST.chkN; j++) { const a = ST.chk[j * CHK + 15] / ST.chk[j * CHK + 16]; if (a > ba) { ba = a; best = j; } }
    i = best;
  } else ST.chkN++;
  const D = ST.chk, o = i * CHK;
  D[o] = x; D[o + 1] = y; D[o + 2] = z; D[o + 3] = vx; D[o + 4] = vy; D[o + 5] = vz;
  D[o + 6] = rnd() * TAU; D[o + 7] = rnd() * TAU; D[o + 8] = rnd() * TAU;
  D[o + 9] = (rnd() - 0.5) * 22; D[o + 10] = (rnd() - 0.5) * 22; D[o + 11] = (rnd() - 0.5) * 22;
  D[o + 12] = size * (0.7 + rnd() * 0.6); D[o + 13] = size * (0.45 + rnd() * 0.5); D[o + 14] = size * (0.7 + rnd() * 0.6);
  D[o + 15] = 0; D[o + 16] = life; D[o + 17] = fin(floorY) ? floorY : -1e9; D[o + 18] = 0;
  const ca = ST.chkMesh.instanceColor.array, j = rnd() * 0.25 + 0.88;
  ca[i * 3] = c[0] * k * j; ca[i * 3 + 1] = c[1] * k * j; ca[i * 3 + 2] = c[2] * k * j;
  ST.chkDirty = true;
  ST.chkMesh.visible = true;
}
function updateChunks() {
  const dt = ST.dt;
  const D = ST.chk, mesh = ST.chkMesh;
  if (!mesh || ST.chkN === 0) { if (mesh) { mesh.visible = false; mesh.count = 0; } return; }
  const ca = mesh.instanceColor.array, G = 22;
  let n = ST.chkN;
  for (let i = 0; i < n; i++) {
    let o = i * CHK;
    D[o + 15] += dt;
    if (D[o + 15] >= D[o + 16]) {
      n--;
      if (i < n) {
        const s = n * CHK;
        for (let q = 0; q < CHK; q++) D[o + q] = D[s + q];
        ca[i * 3] = ca[n * 3]; ca[i * 3 + 1] = ca[n * 3 + 1]; ca[i * 3 + 2] = ca[n * 3 + 2];
        ST.chkDirty = true;
        i--;
      }
      continue;
    }
    if (D[o + 18] < 0.5) {
      D[o + 4] -= G * dt;
      D[o] += D[o + 3] * dt; D[o + 1] += D[o + 4] * dt; D[o + 2] += D[o + 5] * dt;
      D[o + 6] += D[o + 9] * dt; D[o + 7] += D[o + 10] * dt; D[o + 8] += D[o + 11] * dt;
      const fy = D[o + 17] + D[o + 13] * 0.6;
      if (D[o + 1] < fy) {
        D[o + 1] = fy;
        if (Math.abs(D[o + 4]) < 2.2) { D[o + 18] = 1; D[o + 4] = 0; }
        else { D[o + 4] = -D[o + 4] * 0.36; D[o + 3] *= 0.6; D[o + 5] *= 0.6; D[o + 9] *= 0.55; D[o + 10] *= 0.55; D[o + 11] *= 0.55; }
      }
    }
  }
  ST.chkN = n;
  const M = ST.chkM, Q = ST.chkQ, Eu = ST.chkE, Pv = ST.chkP, Sv = ST.chkS;
  for (let i = 0; i < n; i++) {
    const o = i * CHK, age = D[o + 15], life = D[o + 16];
    const k = Math.min(1, age * 18) * Math.min(1, (life - age) / 0.35);
    Pv.set(D[o], D[o + 1], D[o + 2]);
    Eu.set(D[o + 6], D[o + 7], D[o + 8]);
    Q.setFromEuler(Eu);
    Sv.set(D[o + 12] * k + 1e-4, D[o + 13] * k + 1e-4, D[o + 14] * k + 1e-4);
    M.compose(Pv, Q, Sv);
    mesh.setMatrixAt(i, M);
  }
  mesh.count = n;
  mesh.visible = n > 0;
  if (n > 0) {
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, n * 16);
    mesh.instanceMatrix.needsUpdate = true;
    if (ST.chkDirty) { mesh.instanceColor.needsUpdate = true; ST.chkDirty = false; }
  }
}

// ---------------------------------------------------------------- speed lines (camera space)
function makeSpeedLines(n) {
  const geo = quadGeometry();
  const a = new Float32Array(n * 4), b = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    a[i * 4] = rnd() * TAU;
    a[i * 4 + 1] = 2.6 + Math.pow(rnd(), 0.7) * 7.5;
    a[i * 4 + 2] = rnd();
    a[i * 4 + 3] = 38 + rnd() * 34;
    b[i * 4] = 2.5 + rnd() * 5.5;
    b[i * 4 + 1] = 0.016 + rnd() * 0.022;
    b[i * 4 + 2] = (i + 0.5) / n * 0.95;
    b[i * 4 + 3] = 0.6 + rnd() * 0.4;
  }
  geo.setAttribute('iA', new THREE.InstancedBufferAttribute(a, 4));
  geo.setAttribute('iB', new THREE.InstancedBufferAttribute(b, 4));
  geo.instanceCount = n;
  const mat = speedLineMaterial({ uTime: fu(0), uInt: fu(0), uFlow: uniform(new THREE.Vector3(0, 0, -1)), uCol: uniform(new THREE.Vector3(1.3, 1.45, 1.65)) });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'vfx-speedlines'; mesh.frustumCulled = false; mesh.renderOrder = 27; mesh.matrixAutoUpdate = false;
  return { mesh, mat, n };
}

// ---------------------------------------------------------------- init / update / reset
function build(scene) {
  const touch = !!(K.view && K.view.isTouch);
  ST.touch = touch;
  ST.tex = puffTexture();
  ST.uTime = fu(0); ST.uPx = fu(600); ST.uClock = fu(0);
  const PU = { uTime: ST.uTime, uPx: ST.uPx, uPuff: ST.tex };
  ST.mat = particleMaterial(PU);
  ST.glowMat = particleMaterial(PU);
  ST.soft = makePool(touch ? 800 : 2000, 24, 'vfx-soft', ST.mat);
  ST.glow = makePool(touch ? 1700 : 4000, 26, 'vfx-glow', ST.glowMat);
  ST.ribMat = ribbonMaterial({ uClock: ST.uClock });
  ST.chan = new Int16Array(CH_N).fill(-1);
  ST.chanT = new Float64Array(CH_N).fill(-1e9);
  ST.ribs.length = 0;
  ST.rib = makeRibbons(touch ? 8 : 12);
  makeChunks(touch ? 40 : 96);
  ST.sl = makeSpeedLines(touch ? 56 : 110);
  attach(scene);
  refresh();
  ST.warm = 3;
}
function attach(scene) {
  const list = [ST.soft.mesh, ST.glow.mesh, ST.rib.mesh, ST.chkMesh, ST.sl.mesh];
  for (let i = 0; i < list.length; i++) { if (list[i].parent) list[i].parent.remove(list[i]); scene.add(list[i]); list[i].visible = true; }
  ST.scene = scene;
}
function init(scene) {
  if (typeof THREE === 'undefined' || ST.failed) return false;
  const sc = scene || (K.view && K.view.scene);
  if (!sc) return false;
  if (ST.ready) { if (sc !== ST.scene) { attach(sc); ST.warm = 3; } return true; }
  const R = K.view && K.view.renderer;
  try { build(sc); ST.ready = true; }
  catch (err) { ST.failed = true; ST.ready = false; console.warn('K.vfx disabled:', err && err.message); }
  return ST.ready;
}
function quality() {
  const q = K.post && K.post.ok !== false && K.post.quality;
  const qf = q === 'low' ? 0.55 : q === 'medium' ? 0.8 : q === 'ultra' ? 1.15 : 1;
  return (ST.touch ? 0.6 : 1) * qf;
}
function readCamera(cam) {
  const dt = ST.dt;
  if (!cam || !cam.matrixWorld) return;
  if (typeof cam.updateMatrixWorld === 'function') cam.updateMatrixWorld();
  const m = cam.matrixWorld.elements;
  const x = m[12], y = m[13], z = m[14];
  if (!(fin(x) && fin(y) && fin(z))) return;
  if (ST.hasCam && dt > 0) {
    const ix = (x - ST.pcx) / dt, iy = (y - ST.pcy) / dt, iz = (z - ST.pcz) / dt;
    if (ix * ix + iy * iy + iz * iz > 14400) ST.cvx = ST.cvy = ST.cvz = 0;   // a camera cut, not motion
    else {
      const k = 1 - Math.exp(-10 * dt);
      ST.cvx += (ix - ST.cvx) * k; ST.cvy += (iy - ST.cvy) * k; ST.cvz += (iz - ST.cvz) * k;
    }
    if (!(fin(ST.cvx) && fin(ST.cvy) && fin(ST.cvz))) ST.cvx = ST.cvy = ST.cvz = 0;
  }
  ST.pcx = x; ST.pcy = y; ST.pcz = z;
  ST.camX = x; ST.camY = y; ST.camZ = z; ST.hasCam = true;
  ST.rX = m[0]; ST.rY = m[1]; ST.rZ = m[2]; ST.uX = m[4]; ST.uY = m[5]; ST.uZ = m[6];
  ST.bX = m[8]; ST.bY = m[9]; ST.bZ = m[10]; ST.fX = -m[8]; ST.fY = -m[9]; ST.fZ = -m[10];
  const R = K.view && K.view.renderer, h = R && R.domElement ? R.domElement.height : 0;
  const fov = fin(cam.fov) ? cam.fov : 62;
  if (h > 0) ST.uPx.value = h / (2 * Math.tan(fov * Math.PI / 360));
}
function updateSpeedLines() {
  const dt = ST.dt;
  const S = ST.sl;
  if (ST.clock - ST.slLast > 0.12) ST.slTarget = 0;
  const rm = K.view && K.view.reduceMotion ? 0.5 : 1;
  ST.slI += (ST.slTarget * rm - ST.slI) * (1 - Math.exp(-(ST.slTarget * rm > ST.slI ? 6 : 3.5) * dt));
  if (ST.slI < 0.01) { ST.slI = ST.slI < 1e-3 ? 0 : ST.slI; S.mesh.visible = false; return; }
  // flow = travel direction in view space (explicit direction if given recently, else the camera's own motion)
  let fx = ST.fX, fy = ST.fY, fz = ST.fZ;
  if (ST.clock - ST.sdLast < 0.25) { fx = ST.sdX; fy = ST.sdY; fz = ST.sdZ; }
  else {
    const sp = Math.sqrt(ST.cvx * ST.cvx + ST.cvy * ST.cvy + ST.cvz * ST.cvz);
    if (sp > 2) { fx = ST.cvx / sp; fy = ST.cvy / sp; fz = ST.cvz / sp; }
  }
  const vx = fx * ST.rX + fy * ST.rY + fz * ST.rZ, vy = fx * ST.uX + fy * ST.uY + fz * ST.uZ, vz = fx * ST.bX + fy * ST.bY + fz * ST.bZ;
  const k = 1 - Math.exp(-5 * dt);
  ST.flX += (vx - ST.flX) * k; ST.flY += (vy - ST.flY) * k; ST.flZ += (vz - ST.flZ) * k;
  const l = Math.sqrt(ST.flX * ST.flX + ST.flY * ST.flY + ST.flZ * ST.flZ);
  if (!(l > 1e-3)) { ST.flX = 0; ST.flY = 0; ST.flZ = -1; }
  const u = S.mat.uniforms;
  u.uFlow.value.set(ST.flX, ST.flY, ST.flZ);
  u.uInt.value = ST.slI;
  u.uTime.value = ST.clock % 600;
  S.mesh.visible = true;
}
function rebase(P, off) {
  const a = P.arr;
  for (let i = 0; i < P.hw; i++) a[i * STRIDE + 3] -= off;
  P.end -= off;
  if (P.hw > 0) {
    P.dmin = 0; P.dmax = Math.max(P.dmax, P.hw - 1);
    P.ib.clearUpdateRanges(); P.ib.addUpdateRange(0, (P.dmax + 1) * STRIDE); P.ib.needsUpdate = true;
  }
}
// r128 does not rebuild programs when the renderer's tone mapping changes (post pipeline on/off): do it here.
// Light-type effects blend additively in a linear HDR target, but "screen" (1 - (1-dst)(1-src)) when they are
// tone mapped straight to the display, so glows stay soft on bright skies instead of clipping to white.
function refresh() {
  if (!ST.ready) return;
  const direct = !(K.post && K.post.ok && K.post.hdr);
  const mats = [ST.glowMat, ST.ribMat, ST.sl.mat];
  for (let i = 0; i < mats.length; i++) {
    mats[i].blendDst = direct ? THREE.OneMinusSrcColorFactor : THREE.OneMinusSrcAlphaFactor;
    mats[i].needsUpdate = true;
  }
  ST.mat.needsUpdate = true; ST.glowMat.needsUpdate = true; ST.chkMesh.material.needsUpdate = true;
}
// effects follow the game's slow motion (bumper cinematic): explicit K.vfx.timeScale, else the board's
function timeScale() {
  if (fin(ST.ts) && ST.ts >= 0) return clamp(ST.ts, 0, 4);
  const B = K.board;
  return B && B.active && fin(B.timeScale) ? clamp(B.timeScale, 0.05, 1) : 1;
}
function update(dt, camera) {
  if (!ST.ready) return;
  dt = (fin(dt) ? clamp(dt, 0, 0.1) : 1 / 60) * timeScale();
  const hdrNow = K.post && K.post.ok && K.post.hdr ? 1 : 0;
  if (hdrNow !== ST.tm) { ST.tm = hdrNow; refresh(); }
  ST.T += dt; ST.clock += dt;
  ST.dt = dt;
  readCamera(camera || (K.view && K.view.camera));
  ST.D = quality();
  const S = ST.soft, G = ST.glow;
  S.n = 0; G.n = 0;
  if (ST.warm > 0) { ST.warm--; return; }  // first frames: every program compiles with 0 instances
  const sIdle = ST.T >= S.end, gIdle = ST.T >= G.end;
  if (sIdle && S.mesh.visible) idlePool(S);
  if (gIdle && G.mesh.visible) idlePool(G);
  if (sIdle && gIdle) ST.T = 0;
  else if (ST.T > 1200) { const off = ST.T; rebase(S, off); rebase(G, off); ST.T = 0; }
  ST.uTime.value = ST.T;
  ST.uClock.value = ST.clock % 600;
  updateRibbons();
  updateChunks();
  updateSpeedLines();
}
function reset() {
  if (!ST.ready) return;
  idlePool(ST.soft); idlePool(ST.glow);
  ST.T = 0; ST.uTime.value = 0;
  for (let i = 0; i < ST.ribs.length; i++) { const r = ST.ribs[i]; r.on = false; r.ch = -1; r.n = 0; r.written = 0; r.last = -1e9; }
  ST.chan.fill(-1); ST.chanT.fill(-1e9); ST.ribMax = 0;
  const R = ST.rib;
  R.arr.fill(0);
  R.ib.clearUpdateRanges(); R.ib.needsUpdate = true;
  R.dmin = 1e9; R.dmax = -1;
  R.geo.setDrawRange(0, 0); R.mesh.visible = false;
  ST.chkN = 0; ST.chkMesh.count = 0; ST.chkMesh.visible = false;
  ST.slI = 0; ST.slTarget = 0; ST.slLast = -1; ST.sdLast = -1; ST.sl.mesh.visible = false;
  ST.hasCam = false; ST.cvx = ST.cvy = ST.cvz = 0;
}

// ---------------------------------------------------------------- effects
function ringFx(P, x, y, z, planar, r0, r1, life, th, cA, kA, aA, cB, kB, add, delay) {
  e(RING, life); at(x, y, z);
  if (planar) { E.orient = PLANE; vel(Q.nx, Q.ny, Q.nz); }
  E.s0 = r0; E.s1 = r1; E.par = th; E.curve = EXPO; E.add = add; E.delay = delay || 0;
  c0(cA, kA, aA); c1(cB, kB, 0);
  put(P);
}

// The user's jump sparkles: tiny twinkling 4-point stars bursting from the feet + a soft air ring. Optional `vel`
// (the jumper's velocity, else the camera's motion): the sparkles drift along with the player instead of being
// left behind at speed; the air rings stay on the ground where the jump started.
function jump(pos, up, v) {
  if (!go(pos)) return;
  // the user's signature effect keeps (nearly) full density and a larger sprite on small touch screens
  const D0 = ST.D;
  ST.D = Math.max(D0, 0.9);
  try { jumpFx(pos, up, v, ST.touch ? 1.3 : 1); } finally { ST.D = D0; }
}
function jumpFx(pos, up, v, zs) {
  nrm(up, 0, 1, 0);
  const upx = Q.nx, upy = Q.ny, upz = Q.nz;
  carryFrom(v, upx, upy, upz);
  basis(upx, upy, upz);
  const x = pos.x + upx * 0.06, y = pos.y + upy * 0.06, z = pos.z + upz * 0.06, G = ST.glow;
  e(GLOW, 0.16); at(x + upx * 0.2, y + upy * 0.2, z + upz * 0.2); E.s0 = 0.8; E.s1 = 0.25; c0(PAL.cream, 3.2, 0.85); c1(PAL.gold, 2, 0); carry(0.9); put(G);
  ringFx(G, x, y, z, true, 0.3, 1.5, 0.36, 0.2, PAL.sky, 1.5, 0.5, PAL.white, 1, 0.75, 0);
  ringFx(G, x + upx * 0.12, y + upy * 0.12, z + upz * 0.12, true, 0.18, 1.0, 0.27, 0.12, PAL.gold, 2.6, 0.55, PAL.goldD, 1.4, 0.9, 0.04);
  // the burst: a few big slow "hero" stars that float up after the jumper, many tiny fast glints
  const n = Math.max(10, cnt(18)), hero = Math.max(3, Math.round(n * 0.22));
  for (let i = 0; i < n; i++) {
    const big = i < hero;
    const a = (i + rnd() * 0.7) / n * TAU, ca = Math.cos(a), sa = Math.sin(a), lift = big ? 0.45 + rnd() * 0.75 : rnd() * 0.9 - 0.15;
    let ddx = Q.ux * ca + Q.wx * sa + upx * lift, ddy = Q.uy * ca + Q.wy * sa + upy * lift, ddz = Q.uz * ca + Q.wz * sa + upz * lift;
    const l = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz), sp = big ? 3.2 + rnd() * 1.6 : 2.2 + rnd() * 3.4;
    ddx /= l; ddy /= l; ddz /= l;
    e(STAR, big ? 0.85 + rnd() * 0.45 : 0.5 + rnd() * 0.45);
    at(x + ddx * 0.15, y + ddy * 0.15 + upy * 0.05, z + ddz * 0.15);
    vel(ddx * sp, ddy * sp, ddz * sp); E.drag = big ? 3.4 : 4.2; E.grav = big ? 0.35 : 0.7; E.wob = big ? 0.14 : 0.1;
    E.s0 = 0.02; E.s1 = (big ? 0.3 + rnd() * 0.12 : 0.13 + rnd() * 0.12) * zs; E.curve = POP;
    E.tw = big ? 8 + rnd() * 6 : 16 + rnd() * 22; E.rot = (rnd() - 0.5) * 0.4; E.spin = (rnd() - 0.5) * (big ? 1.4 : 3);
    if (big) { c0(PAL.warm, 3.4, 1); c1(PAL.gold, 2.2, 0.1); }
    else if (i % 3 === 0) { c0(PAL.white, 2.8, 1); c1(PAL.cream, 1.8, 0.1); }
    else { c0(PAL.goldS, 3.6, 1); c1(PAL.goldD, 2.2, 0.1); }
    carry(big ? 0.9 : 0.82); put(G);
  }
  // a stream shed from the feet along the first part of the climb (predicted from the jump speed, ~10 u/s if unknown)
  let vup = 10;
  if (okV(v)) vup = clamp(v.x * upx + v.y * upy + v.z * upz, 0, 25);
  const ns = vup > 2 ? cnt(9) : 0;
  for (let i = 0; i < ns; i++) {
    const tau = 0.035 + (i + rnd()) / ns * 0.24, h = Math.max(0, vup * tau - 21 * tau * tau);
    rdir();
    e(STAR, 0.45 + rnd() * 0.35); E.delay = tau;
    at(x + Q.kvx * tau + upx * h + Q.dx * 0.16, y + Q.kvy * tau + upy * h + Q.dy * 0.16, z + Q.kvz * tau + upz * h + Q.dz * 0.16);
    vel(Q.dx * 0.7 - upx * 0.4, Q.dy * 0.7 - upy * 0.4, Q.dz * 0.7 - upz * 0.4); E.drag = 2; E.grav = 0.8; E.wob = 0.06;
    E.s0 = 0.02; E.s1 = (0.12 + rnd() * 0.1) * zs; E.curve = POP; E.tw = 20 + rnd() * 16; E.rot = (rnd() - 0.5) * 0.3;
    if (i & 1) { c0(PAL.white, 2.8, 1); c1(PAL.cream, 1.6, 0); } else { c0(PAL.goldS, 3.6, 1); c1(PAL.goldD, 2, 0); }
    carry(0.55); put(G);
  }
  const m = cnt(10);
  for (let i = 0; i < m; i++) {
    const a = rnd() * TAU, ca = Math.cos(a), sa = Math.sin(a), sp = 4.5 + rnd() * 3.5;
    e(STREAK, 0.2 + rnd() * 0.14); E.orient = VEL; at(x, y + upy * 0.05, z);
    vel((Q.ux * ca + Q.wx * sa) * sp + upx, (Q.uy * ca + Q.wy * sa) * sp + upy * (0.5 + rnd()), (Q.uz * ca + Q.wz * sa) * sp + upz);
    E.drag = 6; E.s0 = 0.05; E.s1 = 0.02; E.str = 0.04; E.curve = LIN;
    c0(PAL.cream, 4.5, 1); c1(PAL.gold, 2, 0); carry(0.6); put(G);
  }
  const S = ST.soft, k = cnt(4);
  for (let i = 0; i < k; i++) {
    const a = rnd() * TAU, ca = Math.cos(a), sa = Math.sin(a), sp = 1.3 + rnd();
    e(PUFF, 0.42 + rnd() * 0.2); at(x + (Q.ux * ca + Q.wx * sa) * 0.2, y + upy * 0.12, z + (Q.uz * ca + Q.wz * sa) * 0.2);
    vel((Q.ux * ca + Q.wx * sa) * sp, (Q.uy * ca + Q.wy * sa) * sp + 0.2, (Q.uz * ca + Q.wz * sa) * sp);
    E.drag = 4; E.s0 = 0.22; E.s1 = 0.75; E.add = 0; E.spin = (rnd() - 0.5) * 2;
    c0(PAL.white, 1, 0.22); c1(PAL.sky, 1, 0); carry(0.3); put(S);
  }
}

// Homing / air dash start: a shockwave ring and a streak of sparkles left behind.
function airJump(pos, dir) {
  if (!go(pos)) return;
  if (!nrm(dir, 0, 0, -1) && ST.hasCam) { Q.nx = ST.fX; Q.ny = ST.fY; Q.nz = ST.fZ; }
  const ax = Q.nx, ay = Q.ny, az = Q.nz, x = pos.x, y = pos.y, z = pos.z, G = ST.glow;
  e(GLOW, 0.12); at(x, y, z); E.s0 = 0.65; E.s1 = 0.25; c0(PAL.white, 3, 0.85); c1(PAL.cyan, 2, 0); put(G);
  ringFx(G, x - ax * 0.2, y - ay * 0.2, z - az * 0.2, true, 0.35, 1.7, 0.3, 0.13, PAL.sky, 2.4, 0.7, PAL.blue, 1.4, 0.85, 0);
  ringFx(G, x - ax * 0.75, y - ay * 0.75, z - az * 0.75, true, 0.22, 1.1, 0.26, 0.1, PAL.white, 2.2, 0.5, PAL.cyan, 1.2, 0.9, 0.05);
  const n = cnt(13);
  for (let i = 0; i < n; i++) {
    cone(-ax, -ay, -az, 0.5);
    const sp = 7 + rnd() * 8;
    e(STREAK, 0.24 + rnd() * 0.16); E.orient = VEL; at(x + Q.dx * 0.3, y + Q.dy * 0.3, z + Q.dz * 0.3);
    vel(Q.dx * sp, Q.dy * sp, Q.dz * sp); E.drag = 5; E.s0 = 0.065; E.s1 = 0.02; E.str = 0.05; E.curve = LIN;
    c0(i & 1 ? PAL.sky : PAL.cream, 4.5, 1); c1(PAL.blue, 2, 0); put(G);
  }
  const m = cnt(9);
  for (let i = 0; i < m; i++) {
    rdir();
    const b = rnd() * 0.9;
    e(STAR, 0.45 + rnd() * 0.4); at(x + Q.dx * 0.3 - ax * b, y + Q.dy * 0.3 - ay * b, z + Q.dz * 0.3 - az * b);
    vel(-ax * (1 + rnd() * 1.6) + Q.dx * 0.7, -ay * (1 + rnd() * 1.6) + Q.dy * 0.7, -az * (1 + rnd() * 1.6) + Q.dz * 0.7);
    E.drag = 2.5; E.wob = 0.08; E.s0 = 0.02; E.s1 = 0.15 + rnd() * 0.12; E.curve = POP; E.tw = 18 + rnd() * 18; E.rot = (rnd() - 0.5) * 0.4;
    if (i & 1) { c0(PAL.white, 3, 1); c1(PAL.sky, 2, 0.1); } else { c0(PAL.gold, 3.4, 1); c1(PAL.goldD, 2, 0.1); }
    put(G);
  }
}

// Every tick while homing: blue-white comet (ribbon + hot head + shed sparkles).
function homingTrail(pos) {
  if (!go(pos)) return;
  const x = pos.x, y = pos.y, z = pos.z, G = ST.glow;
  ribAt(x, y, z, 1); rib(CH_HOM, RB_HOM);
  // the head: a hollow energy shell carried along with the ball (velocity from the previous call) so Kit reads through
  const hd = ST.clock - ST.hT;
  if (hd > 1e-4 && hd < 0.1) { ST.hvx = (x - ST.hX) / hd; ST.hvy = (y - ST.hY) / hd; ST.hvz = (z - ST.hZ) / hd; }
  else if (hd >= 0.1) ST.hvx = ST.hvy = ST.hvz = 0;
  const hs = Math.sqrt(ST.hvx * ST.hvx + ST.hvy * ST.hvy + ST.hvz * ST.hvz);
  if (!(hs < 80)) { const m = hs > 0 && fin(hs) ? 80 / hs : 0; ST.hvx *= m; ST.hvy *= m; ST.hvz *= m; }
  ST.hX = x; ST.hY = y; ST.hZ = z; ST.hT = ST.clock;
  e(RING, 0.05); at(x, y, z); E.s0 = 0.74; E.s1 = 0.8; E.par = 0.36; E.curve = LIN; c0(PAL.cyan, 2.4, 0.42); c1(PAL.blue, 1.6, 0.1);
  E.cx = ST.hvx; E.cy = ST.hvy; E.cz = ST.hvz; put(G);
  if (rnd() < 0.85 * ST.D) {
    rdir();
    e(STAR, 0.35 + rnd() * 0.3); at(x + Q.dx * 0.32, y + Q.dy * 0.32, z + Q.dz * 0.32); vel(Q.dx * 1.2, Q.dy * 1.2, Q.dz * 1.2);
    E.drag = 2.2; E.s0 = 0.02; E.s1 = 0.12 + rnd() * 0.1; E.curve = POP; E.tw = 22 + rnd() * 10;
    if (rnd() < 0.5) { c0(PAL.white, 3.2, 1); c1(PAL.sky, 2, 0); } else { c0(PAL.sky, 3.4, 1); c1(PAL.blue, 2, 0); }
    put(G);
  }
}

// While rolling / spinning fast: two helical ribbons around the ball (pos = ball centre).
function ballTrail(pos, v) {
  if (!go(pos)) return;
  let vx = 0, vy = 0, vz = 0, sp = 0;
  if (okV(v)) { vx = v.x; vy = v.y; vz = v.z; sp = Math.sqrt(vx * vx + vy * vy + vz * vz); }
  if (sp < 0.5) { vx = ST.fbX; vy = ST.fbY; vz = ST.fbZ; } else { vx /= sp; vy /= sp; vz /= sp; }
  ST.fbX = vx; ST.fbY = vy; ST.fbZ = vz;
  // parallel-transport the helix frame so it never flips on loops or slopes
  let bx = ST.hbX, by = ST.hbY, bz = ST.hbZ;
  const d = bx * vx + by * vy + bz * vz;
  bx -= vx * d; by -= vy * d; bz -= vz * d;
  let l = Math.sqrt(bx * bx + by * by + bz * bz);
  if (l < 0.2) { basis(vx, vy, vz); bx = Q.ux; by = Q.uy; bz = Q.uz; l = 1; }
  bx /= l; by /= l; bz /= l;
  ST.hbX = bx; ST.hbY = by; ST.hbZ = bz;
  const cx = vy * bz - vz * by, cy = vz * bx - vx * bz, cz = vx * by - vy * bx;
  const ph = ST.clock * 26, c = Math.cos(ph), s = Math.sin(ph), R = 0.58;
  const ox = (bx * c + cx * s) * R, oy = (by * c + cy * s) * R, oz = (bz * c + cz * s) * R;
  const k = clamp((sp - 5) / 20, 0.3, 1);
  ribAt(pos.x + ox, pos.y + oy, pos.z + oz, k); rib(CH_B0, RB_BALL);
  ribAt(pos.x - ox, pos.y - oy, pos.z - oz, k); rib(CH_B1, RB_BALL);
  if (rnd() < 0.3 * ST.D) {
    const sg = rnd() < 0.5 ? 1 : -1;
    e(STAR, 0.3 + rnd() * 0.25); at(pos.x + ox * sg, pos.y + oy * sg, pos.z + oz * sg);
    vel(ox * sg * 2, oy * sg * 2 + 0.5, oz * sg * 2); E.drag = 3;
    E.s0 = 0.02; E.s1 = 0.1 + rnd() * 0.08; E.curve = POP; E.tw = 24;
    c0(PAL.sky, 3.2, 1); c1(PAL.blue, 2, 0); put(ST.glow);
  }
}

// Landing: dust ring + puffs + pebbles, all scaled by the impact speed.
function land(pos, normal, speed) {
  if (!go(pos)) return;
  nrm(normal, 0, 1, 0);
  const lx = Q.nx, ly = Q.ny, lz = Q.nz;
  basis(lx, ly, lz);
  const sp = fin(speed) ? Math.abs(speed) : 8, k = clamp((sp - 3) / 25, 0, 1);
  const city = isCity(), dc = city ? PAL.asphalt : PAL.dust, dd = city ? PAL.asphaltD : PAL.dustD;
  const x = pos.x + lx * 0.05, y = pos.y + ly * 0.05, z = pos.z + lz * 0.05, S = ST.soft;
  Q.nx = lx; Q.ny = ly; Q.nz = lz;
  ringFx(S, x, y, z, true, 0.3, 1.0 + 2.6 * k, 0.45 + 0.35 * k, 0.5, dc, 1.1, 0.42 + 0.28 * k, dd, 1, 0, 0);
  const n = cnt(5 + 17 * k);
  for (let i = 0; i < n; i++) {
    const a = (i + rnd() * 0.8) / n * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const ddx = Q.ux * ca + Q.wx * sa, ddy = Q.uy * ca + Q.wy * sa, ddz = Q.uz * ca + Q.wz * sa;
    const s = (1.3 + 5.5 * k) * (0.65 + rnd() * 0.7), up = (0.12 + rnd() * 0.4) * (0.4 + k);
    e(PUFF, 0.45 + rnd() * 0.3 + 0.3 * k); at(x + ddx * 0.35, y + ddy * 0.35 + ly * 0.1, z + ddz * 0.35);
    vel(ddx * s + lx * up, ddy * s + ly * up, ddz * s + lz * up); E.drag = 4; E.grav = -0.1;
    E.s0 = 0.15 + 0.1 * k; E.s1 = (0.42 + 0.7 * k) * (0.8 + rnd() * 0.4); E.add = 0; E.fin = 0.06; E.spin = (rnd() - 0.5) * 1.6;
    c0(dc, 1.12, 0.5 + 0.12 * k); c1(dd, 1, 0); put(S);
  }
  if (k > 0.45) {
    Q.nx = lx; Q.ny = ly; Q.nz = lz;
    ringFx(ST.glow, x, y + 0.02, z, true, 0.2, 1.4 + 1.5 * k, 0.26, 0.07, PAL.white, 1.6, 0.24 * k, PAL.sky, 1, 0.75, 0);
  }
  if (k > 0.22) {
    const np = Math.min(14, cnt(2 + 10 * k));
    for (let i = 0; i < np; i++) {
      const a = rnd() * TAU, ca = Math.cos(a), sa = Math.sin(a), out = 1.2 + rnd() * 3.2 * k, up = 2.4 + rnd() * 3.8 * k;
      const c = city ? (i & 1 ? PAL.stone : PAL.asphaltD) : (i % 3 === 0 ? PAL.grass : i % 3 === 1 ? PAL.pebble : PAL.stone);
      chunk(x, y + 0.08, z, (Q.ux * ca + Q.wx * sa) * out + lx * up, (Q.uy * ca + Q.wy * sa) * out + ly * up, (Q.uz * ca + Q.wz * sa) * out + lz * up,
        0.035 + rnd() * 0.06, c, 1, pos.y, 0.9 + rnd() * 0.7);
    }
  }
}

// Ring pickup: golden starburst + halo + rays + sparkle shower.
function ringPickup(pos, v) {
  if (!go(pos)) return;
  carryFrom(v, 0, 1, 0);
  const x = pos.x, y = pos.y, z = pos.z, G = ST.glow;
  e(STAR, 0.28); at(x, y, z); E.s0 = 0.15; E.s1 = 0.8; E.curve = POP; E.rot = rnd() * 0.3; E.spin = 4.5; c0(PAL.cream, 3.4, 1); c1(PAL.gold, 2.2, 0.2); put(G);
  e(GLOW, 0.18); at(x, y, z); E.s0 = 0.5; E.s1 = 0.16; c0(PAL.gold, 1.8, 0.45); c1(PAL.goldD, 1.2, 0); put(G);
  e(RING, 0.28); at(x, y, z); E.s0 = 0.3; E.s1 = 0.85; E.par = 0.12; E.curve = EXPO; c0(PAL.gold, 2.2, 0.75); c1(PAL.goldD, 1.2, 0); put(G);
  const n = cnt(7);
  for (let i = 0; i < n; i++) {
    rdir();
    const sp = 4 + rnd() * 4;
    e(STREAK, 0.2 + rnd() * 0.1); E.orient = VEL; at(x, y, z); vel(Q.dx * sp, Q.dy * sp, Q.dz * sp);
    E.drag = 7; E.s0 = 0.06; E.s1 = 0.02; E.str = 0.05; E.curve = LIN; c0(PAL.cream, 4.2, 1); c1(PAL.gold, 2, 0); put(G);
  }
  const m = cnt(12);
  for (let i = 0; i < m; i++) {
    rdir(); upBias(0.5);
    const sp = 1.4 + rnd() * 2.8;
    e(STAR, 0.55 + rnd() * 0.5); at(x + Q.dx * 0.2, y + Q.dy * 0.2, z + Q.dz * 0.2); vel(Q.dx * sp, Q.dy * sp, Q.dz * sp);
    E.drag = 2.4; E.grav = 3.4; E.wob = 0.06; E.s0 = 0.02; E.s1 = 0.14 + rnd() * 0.12; E.curve = POP; E.tw = 18 + rnd() * 18;
    if (i % 3 === 0) { c0(PAL.white, 2.8, 1); c1(PAL.cream, 1.8, 0); } else { c0(PAL.gold, 3.0, 1); c1(PAL.goldD, 1.8, 0); }
    carry(0.45); put(G);
  }
}

// Explosion: flash core, anamorphic flare, fireballs, smoke, embers, ground shockwave, smoking debris.
function boom(pos, scale) {
  if (!go(pos)) return;
  const s = fin(scale) ? clamp(scale, 0.25, 4) : 1, sq = Math.sqrt(s), s7 = Math.pow(s, 0.7);
  const x = pos.x, y = pos.y, z = pos.z, G = ST.glow, S = ST.soft;
  e(GLOW, 0.14); at(x, y, z); E.s0 = 1.8 * s; E.s1 = 0.7 * s; E.curve = LIN; c0(PAL.warm, 5, 1); c1(PAL.fire, 2.6, 0); put(G);
  e(GLOW, 0.34); at(x, y, z); E.s0 = 1.5 * s; E.s1 = 3.8 * s; c0(PAL.fire, 2.0, 0.45); c1(PAL.goldD, 0.8, 0); put(G);
  e(FLARE, 0.24); E.orient = WIDE; at(x, y, z); E.par = 7; E.s0 = 1.0 * s; E.s1 = 0.55 * s; E.curve = LIN; c0(PAL.hot, 5, 0.85); c1(PAL.fire, 2, 0); put(G);
  // smoke first: within one pool slots draw in order, so the fire lands on top of it
  const ns = Math.min(24, cnt(12 * s7));
  for (let i = 0; i < ns; i++) {
    rdir(); Q.dy = Math.abs(Q.dy) * 0.8 + 0.25;
    const sp = (0.8 + rnd() * 1.8) * sq;
    e(PUFF, 1.5 + rnd() * 1.2); at(x + Q.dx * 0.45 * s, y + Q.dy * 0.3 * s, z + Q.dz * 0.45 * s); vel(Q.dx * sp, Q.dy * sp, Q.dz * sp);
    E.drag = 1.6; E.grav = -1.5; E.s0 = 0.6 * s; E.s1 = (2.2 + rnd() * 1.4) * s; E.fin = 0.2; E.delay = 0.1 + rnd() * 0.2;
    E.spin = (rnd() - 0.5) * 0.8; E.add = 0; E.wob = 0.25 * s;
    const sh = 0.8 + rnd() * 0.9;
    c0(PAL.smoke, sh, 0.74); c1(PAL.smokeL, 0.7 + rnd() * 0.5, 0); put(S);
  }
  const nf = Math.min(30, cnt(16 * s7));
  for (let i = 0; i < nf; i++) {
    rdir(); upBias(0.3);
    const sp = (1.6 + rnd() * 3.6) * sq;
    e(FIRE, 0.5 + rnd() * 0.4); at(x + Q.dx * 0.3 * s, y + Q.dy * 0.3 * s, z + Q.dz * 0.3 * s); vel(Q.dx * sp, Q.dy * sp, Q.dz * sp);
    E.drag = 3.2; E.grav = -2.4 * sq; E.s0 = (0.5 + rnd() * 0.3) * s; E.s1 = (1.4 + rnd() * 0.9) * s; E.fin = 0.05; E.spin = (rnd() - 0.5) * 2.6;
    E.add = 0.62; E.delay = rnd() * 0.06; c0(PAL.white, 1, 1); c1(PAL.white, 1, 0.6); put(S);
  }
  const nk = Math.min(36, cnt(18 * Math.pow(s, 0.6)));
  for (let i = 0; i < nk; i++) {
    rdir(); upBias(0.3);
    const sp = (7 + rnd() * 10) * sq;
    e(STREAK, 0.4 + rnd() * 0.5); E.orient = VEL; at(x, y, z); vel(Q.dx * sp, Q.dy * sp, Q.dz * sp);
    E.grav = 14; E.drag = 1.4; E.s0 = 0.095 * sq; E.s1 = 0.035; E.str = 0.045; E.curve = LIN;
    c0(PAL.hot, 6, 1); c1(PAL.spark, 3, 0); put(G);
  }
  const gy = groundY(x, y, z);
  const onGround = fin(gy) && y - gy < 3.5 * s && y - gy > -1;
  if (onGround) {
    Q.nx = Q.gnx; Q.ny = Q.gny; Q.nz = Q.gnz;
    ringFx(G, x, gy + 0.07, z, true, 0.4 * s, 5.2 * s, 0.42, 0.06, PAL.hot, 2.0, 0.38, PAL.amber, 1, 0.85, 0);
    const city = isCity();
    ringFx(S, x, gy + 0.05, z, true, 0.6 * s, 4.2 * s, 0.9, 0.55, city ? PAL.asphalt : PAL.dust, 0.9, 0.3, city ? PAL.asphaltD : PAL.dustD, 0.8, 0, 0.03);
  }
  if (!onGround) { e(RING, 0.26); at(x, y, z); E.s0 = 0.3 * s; E.s1 = 3.4 * s; E.par = 0.08; E.curve = EXPO; c0(PAL.hot, 2.4, 0.5); c1(PAL.fire, 1.2, 0); put(G); }
  const floor = onGround ? gy : y - 60;
  const nd = Math.min(22, cnt(9 * s7));
  for (let i = 0; i < nd; i++) {
    rdir(); Q.dy = Math.abs(Q.dy) * 0.9 + 0.35;
    const l = Math.sqrt(Q.dx * Q.dx + Q.dy * Q.dy + Q.dz * Q.dz), sp = (4.5 + rnd() * 6.5) * sq;
    const vx = Q.dx / l * sp, vy = Q.dy / l * sp, vz = Q.dz / l * sp;
    const c = i % 4 === 0 ? PAL.red : i % 4 === 1 ? PAL.dark : i % 4 === 2 ? PAL.metal : PAL.yellow;
    chunk(x, y, z, vx, vy, vz, (0.1 + rnd() * 0.14) * Math.pow(s, 0.6), c, 1, floor, 1.4 + rnd() * 1.1);
    if (i < 5 && s >= 0.7) {
      // smoke puffs laid along the debris arc, appearing as the piece passes
      for (let j = 1; j <= 5; j++) {
        const tau = j * 0.07, py = y + vy * tau - 11 * tau * tau;
        if (py < floor) break;
        e(PUFF, 0.65 + rnd() * 0.3); at(x + vx * tau, py, z + vz * tau); E.delay = tau; vel(0, 0.4, 0);
        E.drag = 1; E.s0 = 0.12 * s; E.s1 = (0.5 + j * 0.06) * s; E.add = 0; E.spin = (rnd() - 0.5);
        c0(PAL.smoke, 1.8, 0.55); c1(PAL.smokeL, 1, 0); put(S);
      }
    }
  }
}

// Metal sparks: hot streaks in a cone around dir, falling under gravity.
function sparks(pos, dir, n, color) {
  if (!go(pos)) return;
  nrm(dir, 0, 1, 0);
  const ax = Q.nx, ay = Q.ny, az = Q.nz, c = colour(color, PAL.spark), G = ST.glow;
  const x = pos.x, y = pos.y, z = pos.z, k = fin(n) ? clamp(Math.round(n), 1, 64) : 12;
  e(GLOW, 0.1); at(x, y, z); E.s0 = 0.5; E.s1 = 0.12; c0(CW, 3.6, 0.9); c1(c, 2.4, 0); put(G);
  const hr = c[0] * 0.7 + 0.3, hg = c[1] * 0.7 + 0.3, hb = c[2] * 0.7 + 0.3;
  const N = Math.max(1, cnt(k));
  for (let i = 0; i < N; i++) {
    cone(ax, ay, az, 0.7);
    const sp = 4 + rnd() * 12;
    e(STREAK, 0.22 + rnd() * 0.4); E.orient = VEL; at(x, y, z); vel(Q.dx * sp, Q.dy * sp, Q.dz * sp);
    E.grav = 20; E.drag = 1.2; E.s0 = 0.06; E.s1 = 0.025; E.str = 0.03 + rnd() * 0.02; E.curve = LIN;
    c0(c, 1, 1); E.r0 = hr * 4.2; E.g0 = hg * 4.2; E.b0 = hb * 4.2; c1(c, 2.2, 0); put(G);
  }
}

// Shockwave disc (springs, dash panels, bumper). Optional 4th argument: plane normal for a flat extra ring.
function impact(pos, color, radius, normal) {
  if (!go(pos)) return;
  const R = fin(radius) ? clamp(Math.abs(radius), 0.2, 24) : 2, c = colour(color, PAL.sky), G = ST.glow;
  const x = pos.x, y = pos.y, z = pos.z;
  e(GLOW, 0.2); at(x, y, z); E.s0 = 0.6 * R; E.s1 = 0.18 * R; c0(CW, 3.4, 0.85); c1(c, 2.2, 0); put(G);
  e(RING, 0.36); at(x, y, z); E.s0 = 0.15 * R; E.s1 = R; E.par = 0.075; E.curve = EXPO; c0(CW, 3.2, 0.85); c1(c, 1.8, 0); put(G);
  e(RING, 0.32); at(x, y, z); E.delay = 0.06; E.s0 = 0.1 * R; E.s1 = 0.72 * R; E.par = 0.06; E.curve = EXPO; c0(c, 2.6, 0.6); c1(c, 1.2, 0); put(G);
  e(FLARE, 0.22); E.orient = WIDE; at(x, y, z); E.par = 6; E.s0 = 0.5 * R; E.s1 = 0.3 * R; E.curve = LIN; c0(CW, 3.2, 0.7); c1(c, 1.6, 0); put(G);
  if (nrm(normal, 0, 1, 0)) ringFx(G, x, y, z, true, 0.2 * R, 1.3 * R, 0.45, 0.07, CW, 2.6, 0.7, c, 1.2, 0.85, 0.02);
  const n = Math.min(28, cnt(10 + R * 2));
  for (let i = 0; i < n; i++) {
    rdir();
    const sp = (5 + rnd() * 5) * Math.sqrt(R);
    e(STREAK, 0.22 + rnd() * 0.14); E.orient = VEL; at(x, y, z); vel(Q.dx * sp, Q.dy * sp, Q.dz * sp);
    E.drag = 6; E.s0 = 0.07; E.s1 = 0.03; E.str = 0.04; E.curve = LIN; c0(CW, 4.5, 1); c1(c, 2.4, 0); put(G);
  }
  const m = cnt(7);
  for (let i = 0; i < m; i++) {
    rdir();
    const sp = 1.5 + rnd() * 2.5;
    e(STAR, 0.45 + rnd() * 0.35); at(x + Q.dx * 0.3 * R, y + Q.dy * 0.3 * R, z + Q.dz * 0.3 * R); vel(Q.dx * sp, Q.dy * sp, Q.dz * sp);
    E.drag = 2.6; E.s0 = 0.02; E.s1 = 0.14 + rnd() * 0.12; E.curve = POP; E.tw = 20 + rnd() * 14; c0(CW, 3.2, 1); c1(c, 2, 0); put(G);
  }
}

// Skateboard wheels on a rail or curb: a few trailing sparks per tick and a contact glow.
function wheelSparks(pos, v) {
  if (!go(pos)) return;
  let vx = 0, vy = 0, vz = 0, sp = 0;
  if (okV(v)) { vx = v.x; vy = v.y; vz = v.z; sp = Math.sqrt(vx * vx + vy * vy + vz * vz); }
  let bx = 0, bz = 0;
  if (sp > 0.5) { const h = Math.sqrt(vx * vx + vz * vz) || 1; bx = -vx / h; bz = -vz / h; }
  const x = pos.x, y = pos.y, z = pos.z, G = ST.glow;
  e(GLOW, 0.06); at(x, y, z); vel(vx, vy, vz); E.s0 = 0.26; E.s1 = 0.14; c0(PAL.spark, 4, 0.8); c1(PAL.amber, 2, 0); put(G);
  const n = Math.min(6, Math.max(2, cnt(3.6)));
  for (let i = 0; i < n; i++) {
    cone(bx * 0.85, 0.5, bz * 0.85, 0.55);
    const s = 2 + rnd() * 5 + sp * 0.08;
    e(STREAK, 0.2 + rnd() * 0.28); E.orient = VEL; at(x + (rnd() - 0.5) * 0.1, y, z + (rnd() - 0.5) * 0.1);
    vel(vx * 0.55 + Q.dx * s, vy * 0.3 + Q.dy * s, vz * 0.55 + Q.dz * s);
    E.grav = 18; E.drag = 2; E.s0 = 0.055; E.s1 = 0.022; E.str = 0.04; E.curve = LIN;
    c0(PAL.spark, 1, 1); E.r0 = 4.8; E.g0 = 2.5; E.b0 = 0.8; c1(PAL.spark, 2.4, 0); put(G);
  }
}

// Wind streaks around the camera: call every frame with 0..1 (optional world travel direction).
function speedLines(intensity, dir) {
  if (!ST.ready) return;
  const v = fin(intensity) ? clamp(intensity, 0, 1) : 0;
  ST.slTarget = v; ST.slLast = ST.clock;
  if (okV(dir)) {
    const l = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    if (l > 1e-4) { ST.sdX = dir.x / l; ST.sdY = dir.y / l; ST.sdZ = dir.z / l; ST.sdLast = ST.clock; }
  }
}

// Act clear: confetti cannons, glitter and three fireworks behind the subject.
function confetti(pos) {
  if (!go(pos)) return;
  const x = pos.x, y = pos.y, z = pos.z, S = ST.soft, G = ST.glow;
  let rx = ST.rX, rz = ST.rZ, fx = ST.fX, fz = ST.fZ;
  const rl = Math.sqrt(rx * rx + rz * rz) || 1, fl = Math.sqrt(fx * fx + fz * fz) || 1;
  rx /= rl; rz /= rl; fx /= fl; fz /= fl;
  const n = Math.min(420, cnt(260));
  for (let i = 0; i < n; i++) {
    const side = i & 1 ? 1 : -1;
    cone(rx * side * 0.32, 1, rz * side * 0.32, 0.38);
    const sp = 12 + rnd() * 9, c = CONF[(rnd() * CONF.length) | 0];
    e(PAPER, 4.5 + rnd() * 2.2); at(x + rx * side * 1.1, y + 0.3, z + rz * side * 1.1); vel(Q.dx * sp, Q.dy * sp, Q.dz * sp);
    E.drag = 2.8; E.grav = 4; E.wob = 0.4 + rnd() * 0.45; E.s0 = E.s1 = 0.1 + rnd() * 0.06; E.curve = LIN;
    E.par = 6 + rnd() * 10; E.spin = (rnd() - 0.5) * 5; E.add = 0;
    c0(c, 1.2, 1); c1(c, 1.2, 1); put(S);
  }
  const g = cnt(50);
  for (let i = 0; i < g; i++) {
    cone(0, 1, 0, 0.7);
    const sp = 6 + rnd() * 7;
    e(STAR, 1.4 + rnd() * 1.2); at(x, y + 0.4, z); vel(Q.dx * sp, Q.dy * sp, Q.dz * sp);
    E.drag = 2.2; E.grav = 2.6; E.wob = 0.2; E.s0 = 0.03; E.s1 = 0.13 + rnd() * 0.1; E.curve = POP; E.tw = 12 + rnd() * 20;
    c0(i & 1 ? PAL.white : PAL.gold, 3.2, 1); c1(PAL.goldD, 2, 0.2); put(G);
  }
  for (let f = 0; f < 3; f++) {
    const fc = FIREWORK[f], dl = 0.25 + f * 0.38;
    const cx = x + fx * 18 + rx * (f - 1) * 7, cy = y + 5.5 + f * 0.9 + (f === 1 ? 1.2 : 0), cz = z + fz * 18 + rz * (f - 1) * 7;
    e(GLOW, 0.32); at(cx, cy, cz); E.delay = dl; E.s0 = 2.6; E.s1 = 0.8; c0(fc, 1, 1); E.r0 = fc[0] * 2.4 + 1; E.g0 = fc[1] * 2.4 + 1; E.b0 = fc[2] * 2.4 + 1; c1(fc, 1.6, 0); put(G);
    e(RING, 0.55); at(cx, cy, cz); E.delay = dl; E.s0 = 0.5; E.s1 = 5; E.par = 0.06; E.curve = EXPO; c0(fc, 2.6, 0.5); c1(fc, 1.2, 0); put(G);
    const k = cnt(58);
    for (let i = 0; i < k; i++) {
      rdir();
      const sp = 9 + rnd() * 2.5;
      e(STREAK, 1.2 + rnd() * 0.6); E.orient = VEL; at(cx, cy, cz); E.delay = dl; vel(Q.dx * sp, Q.dy * sp, Q.dz * sp);
      E.drag = 1.8; E.grav = 2.4; E.s0 = 0.13; E.s1 = 0.05; E.str = 0.075; E.curve = LIN;
      c0(CW, 1, 1); E.r0 = fc[0] * 3.5 + 1.5; E.g0 = fc[1] * 3.5 + 1.5; E.b0 = fc[2] * 3.5 + 1.5; c1(fc, 2.2, 0); put(G);
    }
    const t = cnt(16);
    for (let i = 0; i < t; i++) {
      rdir();
      const sp = 3 + rnd() * 4;
      e(STAR, 1.6 + rnd() * 0.8); at(cx, cy, cz); E.delay = dl + 0.15; vel(Q.dx * sp, Q.dy * sp, Q.dz * sp);
      E.drag = 1.6; E.grav = 2.2; E.s0 = 0.05; E.s1 = 0.2 + rnd() * 0.12; E.curve = POP; E.tw = 16 + rnd() * 16;
      c0(fc, 3.4, 1); c1(PAL.white, 2, 0); put(G);
    }
  }
}

// Extra: Superman flight — two golden contrails and a sparkle wake (call every tick).
function flightTrail(pos, v) {
  if (!go(pos)) return;
  let fx = 0, fy = 0, fz = -1;
  if (okV(v)) { const l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); if (l > 0.5) { fx = v.x / l; fy = v.y / l; fz = v.z / l; } }
  let rx = -fz, rz = fx;
  const rl = Math.sqrt(rx * rx + rz * rz) || 1; rx /= rl; rz /= rl;
  const o = 0.34;
  ribAt(pos.x + rx * o, pos.y, pos.z + rz * o, 1); rib(CH_F0, RB_FLY);
  ribAt(pos.x - rx * o, pos.y, pos.z - rz * o, 1); rib(CH_F1, RB_FLY);
  const n = cnt(2.2), G = ST.glow;
  for (let i = 0; i < n; i++) {
    rdir();
    const b = 0.4 + rnd() * 0.6;
    e(STAR, 0.6 + rnd() * 0.5); at(pos.x + Q.dx * 0.35 - fx * b, pos.y + Q.dy * 0.35 - fy * b, pos.z + Q.dz * 0.35 - fz * b);
    vel(Q.dx * 0.8 - fx * 1.2, Q.dy * 0.8 - fy * 1.2, Q.dz * 0.8 - fz * 1.2); E.drag = 1.6; E.grav = 0.5; E.wob = 0.1;
    E.s0 = 0.02; E.s1 = 0.14 + rnd() * 0.12; E.curve = POP; E.tw = 14 + rnd() * 20;
    if (rnd() < 0.4) { c0(PAL.white, 3.2, 1); c1(PAL.cream, 2, 0); } else { c0(PAL.gold, 3.6, 1); c1(PAL.goldD, 2, 0); }
    put(G);
  }
}

// Extra: a few twinkles around a point (star power, items, checkpoints).
function twinkle(pos, n, color) {
  if (!go(pos)) return;
  const c = colour(color, PAL.gold), k = Math.max(1, cnt(fin(n) ? clamp(n, 1, 40) : 3)), G = ST.glow;
  for (let i = 0; i < k; i++) {
    rdir();
    const r = 0.25 + rnd() * 0.45;
    e(STAR, 0.4 + rnd() * 0.35); at(pos.x + Q.dx * r, pos.y + Q.dy * r, pos.z + Q.dz * r); vel(Q.dx * 0.4, 0.5 + rnd() * 0.5, Q.dz * 0.4);
    E.drag = 1.5; E.s0 = 0.02; E.s1 = 0.13 + rnd() * 0.12; E.curve = POP; E.tw = 18 + rnd() * 14;
    c0(i & 1 ? PAL.white : CW, 3.2, 1); c1(c, 2, 0); put(G);
  }
}

function stats() {
  const out = { ready: ST.ready, live: 0, pending: 0, cap: 0, soft: 0, glow: 0, ribbons: 0, chunks: ST.chkN, speed: +ST.slI.toFixed(3), spawned: ST.spawned, dropped: ST.dropped, visible: 0, density: ST.D };
  if (!ST.ready) return out;
  const pools = [ST.soft, ST.glow];
  for (let p = 0; p < 2; p++) {
    const P = pools[p];
    out.cap += P.cap;
    let live = 0;
    for (let i = 0; i < P.hw; i++) {
      const o = i * STRIDE, age = ST.T - P.arr[o + 3];
      if (age >= 0 && age < P.arr[o + 7]) live++; else if (age < 0) out.pending++;
    }
    out.live += live;
    if (p) out.glow = live; else out.soft = live;
  }
  for (let i = 0; i < ST.ribs.length; i++) if (ST.ribs[i].on) out.ribbons++;
  const meshes = [ST.soft.mesh, ST.glow.mesh, ST.rib.mesh, ST.chkMesh, ST.sl.mesh];
  for (let i = 0; i < meshes.length; i++) if (meshes[i].visible) out.visible++;
  return out;
}

K.vfx = {
  get ready() { return ST.ready; },
  init, update, reset,
  jump, airJump, homingTrail, land, ballTrail, ringPickup, boom, sparks, impact, wheelSparks, speedLines, confetti,
  flightTrail, twinkle, stats, refresh,
  setGround(fn) { ST.ground = typeof fn === 'function' ? fn : null; },
  get timeScale() { return timeScale(); },
  set timeScale(v) { ST.ts = fin(v) ? v : NaN; }
};
})();
