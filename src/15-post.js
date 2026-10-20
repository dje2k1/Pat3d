// ===================== 15-post.js — K.post ("Unreal-like" render pipeline) + K.gfx (quality presets) =====================
// THREE.RenderPipeline built from the TSL display nodes (SPEC3 §3), one node graph per (preset, Super Résolution):
//
//   scene pass (HDR, MRT: output + view normal + velocity + SSR mask [+ albedo on Ultra], internal resolution)
//     -> lighting composite at the internal resolution: GTAO (Élevé/Moyen, half res) or SSGI (Ultra: AO + one bounce
//        of screen-space GI), SSR on the materials that opted in (Ultra/Élevé, see K.post.ssr())
//     -> temporal reconstruction: TRAA at native resolution, or TAAU ("Super Résolution", the DLSS-like path: internal
//        resolution x0.6..0.85 reconstructed to the screen with jittered history)
//     -> HDR bloom (mip chain), lens flare ghosts (from the bloom), screen-space sun shafts ("godrays": sky mask +
//        two radial blurs at 1/4 or 1/2 res), analytic sun glare (halo + starburst, occlusion-tested), depth of field
//        (cinematics only), velocity motion blur + radial speed streaks (at speed)
//     -> finish: chromatic aberration, ACES filmic + our grade (warm highlights / cool shadows, saturation, contrast
//        curve), vignette, film grain / dither, flash, letterbox.
//   Économie: scene (no MRT) -> glow-lite (1/4 res bloom) -> grade -> FXAA at the internal resolution -> FSR1 (EASU
//   upscale + RCAS sharpening) when Super Résolution is on -> flash, letterbox.
//
// The godrays are screen-space shafts (the GPU Gems 3 / Unreal "light shafts" technique) rather than GodraysNode:
// GodraysNode ray-marches the sun's own shadow map, so it only works inside a single shadow box and breaks with the
// cascaded shadows (CSMShadowNode) that Ultra/Élevé use; the screen-space version follows the sun wherever it is on
// screen, in both acts, at a fraction of the cost.
//
// SSR opt-in (any material): K.post.ssr(material, strength = 1, roughness?) sets material.ssrNode (a float uniform or
// any TSL float node, 0..1 = reflection strength) and optionally material.ssrRoughnessNode (else the material's own
// roughness for standard/physical materials, 0 otherwise). Only those pixels are ray-marched. Transparent or
// depth-less materials never write the normal/velocity/SSR buffers (what is behind them stays), unless opted in.
// Scene materials must not use `fragmentNode` (it bypasses the MRT outputs): use colorNode / outputNode.
import { bloom as postBloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao as postGTAO } from 'three/addons/tsl/display/GTAONode.js';
import { ssgi as postSSGI } from 'three/addons/tsl/display/SSGINode.js';
import { ssr as postSSR } from 'three/addons/tsl/display/SSRNode.js';
import { traa as postTRAA } from 'three/addons/tsl/display/TRAANode.js';
import { taau as postTAAU } from 'three/addons/tsl/display/TAAUNode.js';
import { sharpen as postSharpen } from 'three/addons/tsl/display/SharpenNode.js';
import { fxaa as postFXAA } from 'three/addons/tsl/display/FXAANode.js';
import { lensflare as postLensflare } from 'three/addons/tsl/display/LensflareNode.js';
(() => {
'use strict';
const { Fn, If, Loop, pass, mrt, texture: ttexture, perspectiveDepthToViewZ, sin: tsin, sqrt: tsqrt, output, normalView, velocity, diffuseColor, roughness, rtt, uniform,
  vec2, vec3, vec4, float, uv, mix, step, max: tmax, min: tmin, clamp: tclamp, dot, smoothstep, exp: texp, pow: tpow,
  length: tlength, abs: tabs, fract: tfract, floor: tfloor, cos: tcos, atan: tatan, select, acesFilmicToneMapping, agxToneMapping,
  sRGBTransferOETF } = TSL;
const NOOP = () => {};
const QUALITIES = ['ultra', 'high', 'medium', 'low'];
// depth of the sky dome (drawn at clip w * 0.99999): anything deeper is sky; the farthest scenery (≈ 2 km) stays below
const SKY_D = 0.99996;

// ---------- presets ----------
// content knobs (K.gfx): furShells, grass, texRes, shadows, ssr. Pipeline: sr = internal resolution with Super
// Résolution on; aa: 'traa' | 'fxaa'; ao: 'ssgi' | 'gtao' | ''; aoRes: AO buffer scale (of the internal res); aoN: GTAO
// samples; ssrRes: SSR buffer scale (0 = off); bloom: strength factor; bloomRes: bloom chain scale; shafts: sun shaft
// buffer scale (0 = off); shaftN: radial taps; flare: lens ghosts; dof: max bokeh scale in cinematics (0 = off);
// mb: motion blur taps (0 = off); ca: chromatic aberration; grain; up: upscaler with Super Résolution ('taau' | 'fsr')
const PRESETS = {
  ultra: { sr: 0.77, furShells: 16, grass: 1, texRes: 'full', shadows: 'csm', ssr: true,
    aa: 'traa', ao: 'ssgi', aoRes: 0.5, aoN: 16, ssrRes: 0.75, bloom: 1, bloomRes: 0.5, shafts: 0.5, shaftN: 36, flare: 1, dof: 3, mb: 12, ca: 1, grain: 1, up: 'taau' },
  high: { sr: 0.85, furShells: 10, grass: 0.7, texRes: 'full', shadows: 'csm', ssr: true,
    aa: 'traa', ao: 'gtao', aoRes: 0.5, aoN: 12, ssrRes: 0.5, bloom: 1, bloomRes: 0.5, shafts: 0.25, shaftN: 28, flare: 1, dof: 2.5, mb: 8, ca: 1, grain: 1, up: 'taau' },
  medium: { sr: 0.6, furShells: 6, grass: 0.4, texRes: 'half', shadows: 'single', ssr: false,
    aa: 'traa', ao: 'gtao', aoRes: 0.5, aoN: 8, ssrRes: 0, bloom: 0.85, bloomRes: 0.5, shafts: 0, shaftN: 0, flare: 0, dof: 2, mb: 6, ca: 1, grain: 0.8, up: 'taau' },
  low: { sr: 0.75, furShells: 0, grass: 0, texRes: 'half', shadows: 'cheap', ssr: false,
    aa: 'fxaa', ao: '', aoRes: 0, aoN: 0, ssrRes: 0, bloom: 0.6, bloomRes: 0.25, shafts: 0, shaftN: 0, flare: 0, dof: 0, mb: 0, ca: 0, grain: 0, up: 'fsr' }
};
// the look (linear HDR in, display out); every number is a live uniform (K.post.look) except tone
const LOOK = {
  tone: 'aces', exposure: 1.0, directExposure: 1.05,
  bloomStrength: 0.42, bloomRadius: 0.55, bloomThreshold: 0.95,
  sat: 1.14, curve: 0.18, vignette: 0.34, grain: 0.022,
  shadowTint: [0.94, 0.985, 1.08], highTint: [1.05, 1.0, 0.92],
  ao: 0.85, gi: 0.6, ssr: 1.0, dofScale: 1, dofRange: 0.08, shafts: 0.5, flare: 0.08, glare: 0.35, ca: 0.0022, caSpeed: 0.018, sharp: 0.25
};

// ---------- K.gfx: the active preset's content knobs (other parts rebuild what depends on them in onChange) ----------
const listeners = [];
const gfx = K.gfx = {
  preset: 'high', furShells: 10, grass: 0.7, texRes: 'full', shadows: 'csm', ssr: true,
  presets: PRESETS,
  onChange(fn) { if (typeof fn === 'function' && listeners.indexOf(fn) < 0) listeners.push(fn); return fn; },
  offChange(fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }
};
function applyGfx(q) {
  const p = PRESETS[q] || PRESETS.high;
  const prev = gfx.preset;
  gfx.preset = q; gfx.furShells = p.furShells; gfx.grass = p.grass; gfx.texRes = p.texRes; gfx.shadows = p.shadows; gfx.ssr = p.ssr;
  if (prev !== q) for (const fn of listeners.slice()) { try { fn(gfx, prev); } catch (e) { console.warn('Kit Rush 3D: gfx listener', e); } }
}

const post = K.post = {
  ok: false, quality: 'high', superRes: false, upscaler: 'auto', hdr: false, envMap: null,
  uHDR: uniform(0), // TSL uniform: 1 while frames go through the HDR pipeline (world/city sky shaders use it)
  letterbox: 0,
  init() { return false; }, render: NOOP, setQuality: NOOP, setSuperRes: NOOP, cinematic: NOOP, speed: NOOP,
  flash: NOOP, setSun: NOOP, refreshEnvironment() { return null; },
  stats() { return { passes: [], scale: 1, quality: post.quality, ok: false }; }
};

const S = {
  inited: false, active: false, why: '', cfg: PRESETS.high, pipe: null, G: null, graphs: {}, built: '', builds: 0,
  scale: 1, frameId: -1, time: 0, clk: -1, dt: 1 / 60, rawDt: 1 / 60, fresh: 0,
  spd: 0, spdTarget: 0, spdAt: -1,
  flashT: 0, flashDur: 0, flashCol: new THREE.Color(1, 1, 1),
  cine: { on: false, k: 0, letter: true, dof: true, focus: null },
  sunDir: new THREE.Vector3(0.5, 0.7, -0.42).normalize(), sunCol: new THREE.Color(1, 0.94, 0.82), sunVis: 0,
  sunLight: null, sunScan: -1, sunScene: null,
  envPos: new THREE.Vector3(0, 30, 0), envHasPos: false, envRT: null, cubeCam: null, envScale: 1,
  passes: [], cost: []
};
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _fw = new THREE.Vector3(), _sz = new THREE.Vector2();

// ---------- uniforms (shared by every graph; a rebuild never reallocates them) ----------
const U = {
  exposure: uniform(LOOK.exposure), aspect: uniform(16 / 9), flash: uniform(new THREE.Vector4(0, 0, 0, 0)), bars: uniform(0),
  time: uniform(0), res: uniform(new THREE.Vector2(1280, 720)),
  sat: uniform(LOOK.sat), curve: uniform(LOOK.curve), vig: uniform(LOOK.vignette), grain: uniform(LOOK.grain),
  shadowTint: uniform(new THREE.Vector3(...LOOK.shadowTint)), highTint: uniform(new THREE.Vector3(...LOOK.highTint)),
  ao: uniform(LOOK.ao), gi: uniform(LOOK.gi), ssr: uniform(LOOK.ssr),
  sunUV: uniform(new THREE.Vector2(0.5, 0.2)), sunVis: uniform(0), sunCol: uniform(new THREE.Vector3(1, 0.94, 0.82)),
  shafts: uniform(LOOK.shafts), flare: uniform(LOOK.flare), glare: uniform(LOOK.glare),
  ca: uniform(LOOK.ca), mb: uniform(0), mbVel: uniform(1), speed: uniform(0),
  dof: uniform(0), focus: uniform(8), focal: uniform(1), dofMax: uniform(8), near: uniform(0.1), far: uniform(900),
  texel: uniform(new THREE.Vector2(1 / 1280, 1 / 720))
};
post.look = LOOK;
post.uniforms = U;

function storedQuality(isTouch) {
  const q = K.store.get('gfx', null);
  return QUALITIES.indexOf(q) >= 0 ? q : isTouch ? 'medium' : 'high';
}
function storedSuperRes(isTouch) {
  const s = K.store.get('superres', null);
  return typeof s === 'boolean' ? s : !!isTouch;
}

// ---------- per-material MRT outputs ----------
// One node per auxiliary attachment, built in each scene material's own shader: it reads the material (builder.material)
// at build time. Opaque materials write their view normal, velocity, SSR mask (strength, roughness) and albedo;
// transparent / additive / depth-less ones write zeros, which the material's own blending turns into "keep what is
// behind" (the attachments use the material blending), unless they opted into SSR (then they overwrite).
const NORMAL_BLEND = THREE.NormalBlending, NO_BLEND = THREE.NoBlending;
class PostAuxNode extends THREE.Node {
  static get type() { return 'PostAuxNode'; }
  constructor(kind) { super('vec4'); this.kind = kind; }
  setup(builder) {
    const m = builder.material;
    const sn = m && m.ssrNode && m.ssrNode.isNode ? m.ssrNode : null;
    const see = !!m && !sn && (m.transparent === true || m.depthWrite === false || (m.blending !== NORMAL_BLEND && m.blending !== NO_BLEND));
    if (!m || see) return vec4(0);
    switch (this.kind) {
      case 'normal': return vec4(normalView, 1);
      case 'velocity': return vec4(velocity, 0, 1);
      case 'diffuse': return vec4(diffuseColor.rgb, 1);
      default: {
        if (!sn) return vec4(0, 1, 0, 1);
        const rn = m.ssrRoughnessNode && m.ssrRoughnessNode.isNode ? m.ssrRoughnessNode : m.isMeshStandardNodeMaterial ? roughness : float(0);
        return vec4(tclamp(float(sn), 0, 1), tclamp(float(rn), 0, 1), 0, 1);
      }
    }
  }
}
const AUX = { normal: new PostAuxNode('normal'), velocity: new PostAuxNode('velocity'), ssr: new PostAuxNode('ssr'), diffuse: new PostAuxNode('diffuse') };

// ---------- graph ----------
// small TSL helpers
const W3 = vec3(0.2126, 0.7152, 0.0722);
const hashUV = Fn(([p]) => {
  const p3 = tfract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return tfract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'kPostHash', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });
const toneMap = c => (LOOK.tone === 'agx' ? agxToneMapping(c, U.exposure) : acesFilmicToneMapping(c, U.exposure));
// linear display-referred colour -> the grade (luma-split tint, saturation, vignette) -> sRGB + contrast curve
function gradeLDR(c, r2) {
  let g = c.mul(mix(U.shadowTint, U.highTint, smoothstep(0.0, 0.65, dot(c, W3))));
  g = tmax(mix(vec3(dot(g, W3)), g, U.sat), vec3(0));
  if (r2) g = g.mul(float(1).sub(smoothstep(0.12, 1.05, r2).mul(U.vig)));
  g = sRGBTransferOETF(tclamp(g, 0, 1));
  return mix(g, g.mul(g).mul(float(3).sub(g.mul(2))), U.curve);
}
// screen-space helpers: aspect-corrected squared distance from the centre (1 at the corners)
const radius2 = u => { const d = u.sub(0.5), da = d.mul(vec2(U.aspect, 1)); return dot(da, da).div(U.aspect.mul(U.aspect).mul(0.25).add(0.25)); };
// overlays shared by both finishes: flash, grain/dither, letterbox
function overlays(c, u) {
  let o = c.add(U.flash.xyz.mul(U.flash.w));
  o = o.add(hashUV(u.mul(U.res).add(tfract(U.time.mul(7.31)).mul(213))).sub(0.5).mul(U.grain.add(1 / 255)));
  const bar = tmax(step(u.y, U.bars), step(float(1).sub(U.bars), u.y));
  return vec4(tclamp(mix(o, vec3(0), bar), 0, 1), 1);
}

// spatial Super Résolution (the FSR1 recipe): a Catmull-Rom reconstruction of the low-resolution LDR image at the
// output resolution (5 bilinear taps, the EASU stand-in) followed by RCAS contrast-adaptive sharpening (SharpenNode).
// FSR1Node itself cannot be imported yet: build.sh's import scanner trips on a doc comment inside it (see STATUS).
function spatialUp(G, src) {
  const cr = Fn(() => {
    const size = vec2(src.size());
    const sp = uv().mul(size);
    const t1 = tfloor(sp.sub(0.5)).add(0.5).toVar();
    const f = sp.sub(t1).toVar();
    const w0 = f.mul(f.mul(f.mul(-0.5).add(1)).sub(0.5));
    const w1 = f.mul(f).mul(f.mul(1.5).sub(2.5)).add(1);
    const w2 = f.mul(f.mul(f.mul(-1.5).add(2)).add(0.5)).toVar();
    const w3 = f.mul(f).mul(f.mul(0.5).sub(0.5));
    const w12 = w1.add(w2).toVar();
    const t0 = t1.sub(1).div(size), t3 = t1.add(2).div(size), t12 = t1.add(w2.div(w12)).div(size).toVar();
    const c = src.sample(vec2(t12.x, t0.y)).rgb.mul(w12.x.mul(w0.y))
      .add(src.sample(vec2(t0.x, t12.y)).rgb.mul(w0.x.mul(w12.y)))
      .add(src.sample(t12).rgb.mul(w12.x.mul(w12.y)))
      .add(src.sample(vec2(t3.x, t12.y)).rgb.mul(w3.x.mul(w12.y)))
      .add(src.sample(vec2(t12.x, t3.y)).rgb.mul(w12.x.mul(w3.y)));
    const ws = w12.x.mul(w0.y).add(w0.x.mul(w12.y)).add(w12.x.mul(w12.y)).add(w3.x.mul(w12.y)).add(w12.x.mul(w3.y));
    return vec4(tclamp(c.div(ws), 0, 1), 1);
  })();
  const up = track(G, rtt(cr, null, null, { depthBuffer: false }), 'upscale');
  const sh = track(G, postSharpen(up, LOOK.sharp), 'rcas');
  G.passes.push('upscale(catmull-rom)', 'rcas(sharpen)');
  G.cost.push(['upscale', 1, 1], ['rcas', 1, 1]);
  return sh.getTextureNode();
}
// depth of field helpers: linear distance from a depth sample (camera near/far uniforms), circle of confusion in
// output pixels for that distance
const viewDist = d => perspectiveDepthToViewZ(d, U.near, U.far).negate();
const cocPx = z => tclamp(tabs(z.sub(U.focus)).sub(U.focal).div(tmax(z, 0.1)).mul(2.2), 0, 1).mul(U.dofMax);
function track(G, node, name) { G.nodes.push(node); if (name) G.named[name] = node; return node; }

function buildGraph(cfg, sr) {
  const V = K.view, r = V.renderer, cam = V.camera;
  const G = { nodes: [], named: {}, passes: [], cost: [], s: 1, dyn: {} };
  const s = G.s = sr ? cfg.sr : 1;
  let ao = cfg.ao;
  if (ao === 'ssgi' && r.backend && r.backend.isWebGPUBackend && typeof r.hasFeature === 'function' && !r.hasFeature('rg11b10ufloat-renderable')) ao = 'gtao';
  const useSSR = cfg.ssrRes > 0, temporal = cfg.aa === 'traa', upTAAU = temporal && s < 1 && (post.upscaler === 'taau' || (post.upscaler === 'auto' && cfg.up === 'taau'));
  const needVel = temporal || cfg.mb > 0, needNormal = useSSR || ao === 'ssgi' || ao === 'gtao', needDiffuse = ao === 'ssgi';
  // --- scene pass + MRT ---
  const sp = track(G, pass(V.scene, cam), 'scene');
  sp.setResolutionScale(s);
  const outs = { output };
  if (needNormal) outs.normal = AUX.normal;
  if (needVel) outs.velocity = AUX.velocity;
  if (useSSR) outs.ssr = AUX.ssr;
  if (needDiffuse) outs.diffuse = AUX.diffuse;
  const names = Object.keys(outs);
  if (names.length > 1) {
    const m = mrt(outs);
    for (const n of names) if (n !== 'output') m.setBlendMode(n, new THREE.BlendMode(THREE.MaterialBlending));
    sp.setMRT(m);
    if (useSSR) sp.getTexture('ssr').type = THREE.UnsignedByteType;
    if (needDiffuse) sp.getTexture('diffuse').type = THREE.UnsignedByteType;
  }
  const col = sp.getTextureNode('output'), depth = sp.getTextureNode('depth');
  const nrm = needNormal ? sp.getTextureNode('normal') : null, vel = needVel ? sp.getTextureNode('velocity') : null;
  G.passes.push('scene(' + names.join('+') + (s < 1 ? ',x' + s : '') + ')');
  G.cost.push(['scene', s, names.length]);

  // --- lighting composite at the internal resolution (AO / GI / SSR) ---
  let lit = col.rgb, composite = null;
  const sky = depth.x.greaterThan(SKY_D);
  if (ao === 'gtao') {
    const n = track(G, postGTAO(depth, nrm, cam), 'gtao');
    n.resolutionScale = s * cfg.aoRes;
    n.samples.value = cfg.aoN;
    n.radius.value = 1.1; n.thickness.value = 1.2; n.distanceExponent.value = 1.4; n.scale.value = 1.0;
    n.useTemporalFiltering = true;
    lit = lit.mul(select(sky, float(1), mix(float(1), n.getTextureNode().r, U.ao)));
    G.passes.push('gtao(x' + +(s * cfg.aoRes).toFixed(2) + ')');
    G.cost.push(['gtao', s * cfg.aoRes, cfg.aoN / 4]);
  } else if (ao === 'ssgi') {
    const n = track(G, postSSGI(col, depth, nrm, cam), 'ssgi');
    n.sliceCount.value = 2; n.stepCount.value = 8; n.radius.value = 5; n.giIntensity.value = 2; n.aoIntensity.value = 1;
    n.thickness.value = 1; n.useTemporalFiltering = true;
    const aoT = n.getAONode(), giT = n.getGINode(), alb = sp.getTextureNode('diffuse');
    if (LOOK.debug === 'ssgi-ao') lit = lit.mul(mix(float(1), aoT.r, U.ao));
    else if (LOOK.debug === 'ssgi-gi') lit = lit.add(alb.rgb.mul(giT.rgb).mul(U.gi));
    else if (LOOK.debug === 'alb') lit = alb.rgb;
    else {
      // (a vec3 select() on this condition compiled to black on the WebGL 2 backend: float factors only)
      const ground = select(sky, float(0), float(1));
      lit = lit.mul(mix(float(1), aoT.r, U.ao.mul(ground))).add(alb.rgb.mul(giT.rgb).mul(U.gi.mul(ground)));
    }
    G.passes.push('ssgi(ao+gi)');
    G.cost.push(['ssgi', 1, 6]);
  }
  if (useSSR) {
    const mask = sp.getTextureNode('ssr');
    const n = track(G, postSSR(col, depth, nrm, { metalnessNode: mask.r, roughnessNode: mask.g, camera: cam }), 'ssr');
    n.resolutionScale = s * cfg.ssrRes;
    n.maxDistance.value = 60; n.thickness.value = 0.8; n.quality.value = 0.5; n.screenEdgeFade.value = 0.15;
    lit = lit.add(n.getTextureNode().rgb.mul(U.ssr));
    G.passes.push('ssr(opt-in,x' + +(s * cfg.ssrRes).toFixed(2) + ')');
    G.cost.push(['ssr', s * cfg.ssrRes, 4]);
  }
  if (LOOK.debug === 'ao' && G.named.gtao) lit = vec3(G.named.gtao.getTextureNode().r);
  else if (LOOK.debug === 'ao' && G.named.ssgi) lit = vec3(G.named.ssgi.getAONode().r);
  else if (LOOK.debug === 'gi' && G.named.ssgi) lit = G.named.ssgi.getGINode().rgb;
  if (lit !== col.rgb) {
    composite = track(G, rtt(vec4(lit, 1), null, null, { resolutionScale: s, depthBuffer: false }), 'composite');
    G.passes.push('composite');
    G.cost.push(['composite', s, 1]);
  }
  const beauty = composite || col;

  if (cfg.aa !== 'traa') return finishLow(G, cfg, sp, beauty, s);

  // --- temporal reconstruction (HDR) ---
  let aa;
  if (upTAAU) {
    aa = track(G, postTAAU(beauty, depth, vel, cam), 'taau');
    G.passes.push('taau(x' + s + '->1)');
    G.cost.push(['taau', 1, 2]);
  } else if (s < 1) {
    // Super Résolution with the spatial upscaler on a temporal preset: TRAA at the internal resolution, FSR1 later
    aa = track(G, postTRAA(beauty, depth, vel, cam), 'traa');
    G.passes.push('traa(x' + s + ')');
    G.cost.push(['traa', s, 2]);
  } else {
    aa = track(G, postTRAA(beauty, depth, vel, cam), 'traa');
    G.passes.push('traa');
    G.cost.push(['traa', 1, 2]);
  }
  const hdr = aa.getTextureNode();
  // effects that render their own passes read the TAA result as a plain texture: handing them the TAA node itself
  // would set it up again inside their materials (r186 TempNodes are not meant to be shared that way)
  const hdrRaw = ttexture(hdr.value);

  // --- HDR effects at the output resolution ---
  const bl = track(G, postBloom(hdrRaw, LOOK.bloomStrength * cfg.bloom, LOOK.bloomRadius, LOOK.bloomThreshold), 'bloom');
  bl.setResolutionScale(cfg.bloomRes);
  bl.smoothWidth.value = 0.35;
  const bloomTex = bl.getTextureNode();
  G.passes.push('bloom(hdr,x' + cfg.bloomRes + ')');
  G.cost.push(['bloom', cfg.bloomRes, 4]);
  let flareTex = null;
  if (cfg.flare) {
    const f = track(G, postLensflare(ttexture(bloomTex.value), { ghostTint: vec3(0.9, 0.75, 1.0), threshold: float(0.12), ghostSamples: float(5), ghostSpacing: float(0.28), ghostAttenuationFactor: float(18), downSampleRatio: 4 }), 'flare');
    flareTex = f.getTextureNode();
    G.passes.push('lensflare(ghosts)');
    G.cost.push(['lensflare', 0.25, 5]);
  }
  let shaftTex = null, occTex = null;
  if (cfg.shafts > 0) {
    // sun shafts: sky-only source around the sun (deeper than SKY_D), then a short and a long radial blur toward it
    const N = cfg.shaftN;
    const mask = Fn(() => {
      const u = uv().toVar();
      const a = float(0.0016);
      const tap = o => { const p = u.add(o); return tmax(tmin(col.sample(p).rgb, vec3(8)).sub(0.75), vec3(0)).mul(step(SKY_D, depth.sample(p).x)); };
      const c = tap(vec2(a.negate(), a.negate())).add(tap(vec2(a, a.negate()))).add(tap(vec2(a.negate(), a))).add(tap(vec2(a, a))).mul(0.25);
      const fall = float(1).sub(smoothstep(0.0, 0.55, tlength(u.sub(U.sunUV).mul(vec2(U.aspect, 1)))));
      return vec4(c.mul(fall.mul(fall)), 1);
    })();
    const rad = (src, len, decay) => Fn(() => {
      const p = uv().toVar();
      const delta = p.sub(U.sunUV).mul(len / N).toVar();
      p.subAssign(delta.mul(hashUV(p.mul(U.res))));
      const acc = vec3(0).toVar(), w = float(1).toVar(), ws = float(0).toVar();
      Loop(N, () => { acc.addAssign(src.sample(p).rgb.mul(w)); ws.addAssign(w); w.mulAssign(decay); p.subAssign(delta); });
      return vec4(acc.div(ws), 1);
    })();
    const o = { resolutionScale: cfg.shafts, depthBuffer: false };
    const m0 = track(G, rtt(mask, null, null, o), 'shaftMask');
    const b0 = track(G, rtt(rad(m0, 0.16, 1.0), null, null, o), 'shaftBlur1');
    const b1 = track(G, rtt(rad(b0, 0.9, 0.965), null, null, o), 'shaftBlur2');
    shaftTex = b1;
    G.dyn.shafts = [m0, b0, b1];
    // sun occlusion (1x1): the fraction of a small disc around the sun that is open sky
    const occ = Fn(() => {
      const acc = float(0).toVar();
      for (let i = 0; i < 12; i++) {
        const a = i * 2.39996, rr = 0.004 + 0.012 * Math.sqrt((i + 0.5) / 12);
        acc.addAssign(step(SKY_D, depth.sample(tclamp(U.sunUV.add(vec2(Math.cos(a) * rr, Math.sin(a) * rr * 1.7)), 0.001, 0.999)).x));
      }
      return vec4(acc.div(12), 0, 0, 1);
    })();
    occTex = track(G, rtt(occ, 1, 1, { depthBuffer: false }), 'sunOcclusion');
    G.dyn.shafts.push(occTex);
    G.passes.push('godrays(screen-space,x' + cfg.shafts + ')', 'sun-glare');
    G.cost.push(['godrays', cfg.shafts, 1 + 2 * N / 8]);
  }
  let dofTex = null;
  if (cfg.dof > 0) {
    // depth of field (cinematics): the v2 gather in TSL at half resolution — golden-angle spiral, a sample counts
    // when its own circle of confusion covers this pixel, a farther (blurrier) sample never bleeds over a sharper
    // foreground; the finish blends it in by the pixel's own CoC. (DepthOfFieldNode was tried first: chained after
    // the TAA pass in r186 its passes produced dark/black output.)
    const N = cfg.dof >= 3 ? 32 : cfg.dof >= 2.5 ? 24 : 16;
    const g = Fn(() => {
      const u = uv().toVar();
      const zc = viewDist(depth.sample(u).x).toVar();
      const cc = cocPx(zc).toVar();
      const acc = hdrRaw.sample(u).rgb.toVar(), ws = float(1).toVar();
      for (let i = 1; i < N; i++) {
        const rr = Math.sqrt(i / N), a = i * 2.39996323;
        const r = U.dofMax.mul(rr);
        const q = u.add(vec2(Math.cos(a), Math.sin(a)).mul(r).mul(U.texel));
        const zs = viewDist(depth.sample(q).x);
        const cs = cocPx(zs);
        const w = smoothstep(r.sub(1), r.add(0.5), select(zs.lessThan(zc), cs, tmin(cs, cc)));
        acc.addAssign(hdrRaw.sample(q).rgb.mul(w)); ws.addAssign(w);
      }
      return vec4(acc.div(ws), 1);
    })();
    const d = track(G, rtt(g, null, null, { resolutionScale: 0.5, depthBuffer: false }), 'dof');
    G.dyn.dof = [d];
    dofTex = d;
    G.passes.push('dof(cinematic,x0.5)');
    G.cost.push(['dof', 0, N / 8]);
  }
  let src = hdr;
  let upNote = '';
  if (!upTAAU && s < 1) upNote = 'spatial';
  // --- finish ---
  const mbN = cfg.mb, useCA = cfg.ca > 0;
  const finish = Fn(() => {
    const u = uv().toVar();
    const d = u.sub(0.5).toVar();
    const r2 = radius2(u).toVar();
    const col3 = vec3(0).toVar();
    if (useCA) {
      const co = d.mul(U.ca.mul(r2)).toVar();
      col3.assign(vec3(src.sample(u.sub(co)).r, src.sample(u).g, src.sample(u.add(co)).b));
    } else col3.assign(src.sample(u).rgb);
    if (mbN > 0) {
      If(U.mb.greaterThan(0.002), () => {
        const v = vel.sample(u).xy.mul(vec2(0.5, -0.5)).mul(U.mbVel);
        const dir = v.add(d.mul(U.speed.mul(0.085).mul(smoothstep(0.02, 0.6, r2)))).mul(U.mb).toVar();
        const L = tlength(dir).toVar();
        dir.mulAssign(tmin(float(1), float(0.05).div(tmax(L, 1e-5))));
        const acc = col3.toVar();
        Loop(mbN, ({ i }) => { acc.addAssign(src.sample(u.sub(dir.mul(float(i).add(1).div(mbN)))).rgb); });
        col3.assign(acc.div(mbN + 1));
      });
    }
    if (dofTex) {
      If(U.dof.greaterThan(0.004), () => {
        const k = tclamp(cocPx(viewDist(depth.sample(u).x)).div(1.5), 0, 1);
        col3.assign(mix(col3, dofTex.sample(u).rgb, k.mul(U.dof)));
      });
    }
    col3.addAssign(bloomTex.sample(u).rgb);
    if (flareTex) col3.addAssign(flareTex.sample(u).rgb.mul(U.flare));
    if (shaftTex) {
      If(U.sunVis.greaterThan(0.002), () => {
        const skyHere = step(SKY_D, depth.sample(u).x);
        col3.addAssign(shaftTex.sample(u).rgb.mul(U.sunCol).mul(U.sunVis.mul(U.shafts)).mul(mix(0.35, 1.0, skyHere)));
        // analytic glare: soft halo + 6-point starburst + faint ring, scaled by how much of the sun is open sky
        const occl = occTex.sample(vec2(0.5)).x;
        const sd = u.sub(U.sunUV).mul(vec2(U.aspect, 1)).toVar();
        const dist = tlength(sd).toVar();
        const ang = tatan(sd.y, sd.x);
        const star = tpow(tabs(tcos(ang.mul(3))), 24).mul(texp(dist.mul(-9))).mul(0.6);
        const halo = texp(dist.mul(-14)).mul(0.8).add(texp(dist.mul(-3.2)).mul(0.12));
        const ringE = dist.sub(0.22).div(0.018);
        const ring = texp(ringE.mul(ringE).negate()).mul(0.05);
        col3.addAssign(U.sunCol.mul(star.add(halo).add(ring)).mul(U.glare.mul(U.sunVis).mul(occl)));
      });
    }
    if (LOOK.debug === 'hdrRaw') col3.assign(hdrRaw.sample(u).rgb);
    else if (LOOK.debug === 'dof' && dofTex) col3.assign(dofTex.sample(u).rgb);
    const c = gradeLDR(toneMap(col3), r2);
    return overlays(c, u);
  });
  if (upNote) {
    // spatial Super Résolution on a temporal preset (K.post.setUpscaler('fsr')): grade at the internal resolution,
    // then the spatial upscaler (Catmull-Rom + RCAS) to the screen and the overlays
    const fin = Fn(() => { const u = uv(); const r2 = radius2(u); return vec4(gradeLDR(toneMap(src.sample(u).rgb), r2), 1); })();
    const ldr = track(G, rtt(fin, null, null, { resolutionScale: s, depthBuffer: false }), 'gradeLow');
    G.passes.push('aces-grade');
    G.cost.push(['grade', s, 1]);
    const ft = spatialUp(G, ldr);
    G.out = Fn(() => { const u = uv(); return overlays(ft.sample(u).rgb, u); })();
    return G;
  }
  G.out = finish();
  G.passes.push('finish(' + (useCA ? 'ca+' : '') + (mbN ? 'motionblur+streaks+' : '') + 'aces-grade+vignette+grain+letterbox+flash)');
  G.cost.push(['finish', 1, 2 + (mbN ? 0.5 : 0)]);
  return G;
}
// Économie: no MRT, no temporal pass: glow-lite, grade, FXAA at the internal resolution, FSR1 to the screen with
// Super Résolution, then the overlays
function finishLow(G, cfg, sp, beauty, s) {
  const bl = track(G, postBloom(beauty, LOOK.bloomStrength * cfg.bloom, LOOK.bloomRadius * 0.6, LOOK.bloomThreshold), 'glow');
  bl.setResolutionScale(cfg.bloomRes);
  bl.smoothWidth.value = 0.35;
  const glow = bl.getTextureNode();
  G.passes.push('glow-lite(x' + cfg.bloomRes + ')');
  G.cost.push(['glow-lite', cfg.bloomRes, 3]);
  const gr = Fn(() => { const u = uv(); const r2 = radius2(u); return vec4(gradeLDR(toneMap(beauty.sample(u).rgb.add(glow.sample(u).rgb)), r2), 1); })();
  const ldr = track(G, rtt(gr, null, null, { resolutionScale: s, depthBuffer: false }), 'grade');
  G.passes.push('aces-grade');
  G.cost.push(['grade', s, 1]);
  if (s < 1) {
    const aa = track(G, rtt(postFXAA(ldr), null, null, { resolutionScale: s, depthBuffer: false }), 'fxaa');
    G.passes.push('fxaa(x' + s + ')');
    G.cost.push(['fxaa', s, 1]);
    const ft = spatialUp(G, aa);
    G.out = Fn(() => { const u = uv(); return overlays(ft.sample(u).rgb, u); })();
  } else {
    const fx = postFXAA(ldr);
    G.passes.push('fxaa');
    G.cost.push(['fxaa', 1, 1]);
    G.out = Fn(() => overlays(fx.rgb, uv()))();
  }
  G.passes.push('overlays(grain+letterbox+flash)');
  return G;
}
function disposeGraph(G) {
  if (!G) return;
  for (const n of G.nodes) { try { if (n && typeof n.dispose === 'function') n.dispose(); } catch (e) { console.warn('Kit Rush 3D: post dispose', e); } }
  G.nodes.length = 0;
}
// One RenderPipeline per graph (preset x Super Résolution x upscaler), built on first use and kept: switching back
// to a graph reuses its nodes, materials and the scene pass's MRT render contexts, so the renderer's caches (render
// objects, programs) stop growing once every combination has been seen. A graph that is switched away from frees
// its render targets (GPU memory); they are re-created on its next frame (sized 1x1 first so the temporal nodes
// re-seed their history instead of fading in from black).
function graphKey() {
  const c = S.cfg, s = post.superRes ? c.sr : 1;
  const up = c.aa !== 'traa' ? 'fxaa' : s >= 1 ? 'traa' : (post.upscaler === 'taau' || (post.upscaler === 'auto' && c.up === 'taau')) ? 'taau' : 'traa+spatial';
  return post.quality + ':' + s + ':' + up;
}
function sleepGraph(G) {
  if (!G) return;
  for (const n of G.nodes) {
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (v && v.isRenderTarget) { try { v.setSize(1, 1); v.dispose(); } catch (e) { /* already gone */ } }
    }
  }
}
function buildPipeline() {
  const V = K.view, r = V.renderer;
  const key = graphKey();
  if (S.pipe && S.built === key) return;
  const old = S.G;
  let E = S.graphs[key];
  if (!E) {
    let G = null;
    try { G = buildGraph(S.cfg, post.superRes); }
    catch (e) {
      console.warn('Kit Rush 3D: post graph failed, simple pipeline', e);
      G = buildGraph(PRESETS.low, false);
    }
    const pipe = new THREE.RenderPipeline(r);
    pipe.outputNode = G.out;
    pipe.outputColorTransform = false; // the finish does tone mapping and sRGB itself
    E = S.graphs[key] = { G, pipe };
    S.builds++;
  }
  S.G = E.G;
  S.pipe = E.pipe;
  S.scale = E.G.s;
  S.passes = E.G.passes;
  S.cost = E.G.cost;
  S.built = key;
  S.fresh = 2;
  if (old && old !== E.G) sleepGraph(old);
}
function applyConfig() {
  S.cfg = PRESETS[post.quality] || PRESETS.high;
  applyGfx(post.quality);
  if (S.active) buildPipeline();
}

// ---------- per-frame state ----------
function tick(dt) {
  let clk = K.game && Number.isFinite(K.game.clock) ? K.game.clock : performance.now() / 1000;
  const raw = S.clk < 0 ? 1 / 60 : Math.max(0, clk - S.clk);
  if (!(dt > 0 && dt < 0.25)) dt = S.clk < 0 ? 1 / 60 : Math.min(0.1, raw);
  S.rawDt = raw;
  S.clk = clk; S.dt = dt; S.time += dt;
  if (S.time > 1e4) S.time -= 1e4;
  if (S.spdAt >= 0 && S.time - S.spdAt > 0.3) S.spdTarget = 0;
  S.spd += (S.spdTarget - S.spd) * (1 - Math.exp(-(S.spdTarget > S.spd ? 7 : 3.5) * dt));
  if (S.spd < 1e-4) S.spd = 0;
  if (S.flashT > 0) S.flashT = Math.max(0, S.flashT - dt);
  const ck = S.cine;
  ck.k += ((ck.on ? 1 : 0) - ck.k) * (1 - Math.exp(-(ck.on ? 5 : 3.2) * dt));
  if (!ck.on && ck.k < 0.002) ck.k = 0;
}
function barsNow() {
  const ck = S.cine;
  if (!(ck.k > 0) || !ck.letter) return 0;
  const V = K.view, ar = V.W / Math.max(1, V.H);
  const full = Math.max(0.075, (1 - ar / 2.39) / 2);
  const t = ck.k;
  return full * t * t * (3 - 2 * t);
}
function flashNow(v4) {
  if (S.flashT > 0 && S.flashDur > 0) {
    const t = S.flashT / S.flashDur;
    v4.set(S.flashCol.r, S.flashCol.g, S.flashCol.b, 0.85 * t * t);
  } else v4.set(0, 0, 0, 0);
}
// the scene's sun: the brightest visible shadow-casting directional light (rescanned every 2 s and on setSun),
// else the direction handed to setSun()
function findSun(scene) {
  let best = null, bi = 0;
  scene.traverseVisible(o => { if (o.isDirectionalLight && o.intensity > bi) { best = o; bi = o.intensity; } });
  return best;
}
function updateSun(cam) {
  const V = K.view, scene = V.scene;
  if (S.sunScan < 0 || S.time - S.sunScan > 2 || S.sunScene !== scene) { S.sunScan = S.time; S.sunScene = scene; S.sunLight = findSun(scene); }
  const L = S.sunLight;
  if (L && L.visible && L.parent) {
    L.getWorldPosition(_v); _w.set(0, 0, 0);
    if (L.target) L.target.getWorldPosition(_w);
    _v.sub(_w);
    if (_v.lengthSq() > 1e-6) S.sunDir.copy(_v).normalize();
  }
  cam.getWorldDirection(_fw);
  const facing = _fw.dot(S.sunDir);
  _v.copy(cam.position).addScaledVector(S.sunDir, Math.min(400, cam.far * 0.5)).project(cam);
  U.sunUV.value.set(_v.x * 0.5 + 0.5, 0.5 - _v.y * 0.5);
  const edge = Math.max(Math.abs(_v.x), Math.abs(_v.y));
  const a = Math.min(1, Math.max(0, (facing - 0.05) / 0.3)), b = Math.min(1, Math.max(0, (1.6 - edge) / 0.6));
  S.sunVis = facing > 0 ? a * a * b : 0;
  U.sunVis.value = S.sunVis;
  U.sunCol.value.set(S.sunCol.r, S.sunCol.g, S.sunCol.b);
}
// optional passes (sun shafts, DOF) are RTT nodes: they stay registered with the frame (a pipeline rebuild by three
// must not lose them) and simply skip their render while unused (RTTNode.autoUpdate = false)
function setDyn(list, on) { if (list) for (const n of list) n.autoUpdate = !!on || S.fresh > 0; }
function frameUniforms(cam) {
  const V = K.view, G = S.G, c = S.cfg;
  flashNow(U.flash.value);
  U.bars.value = post.letterbox = barsNow();
  U.aspect.value = V.W / Math.max(1, V.H);
  V.renderer.getDrawingBufferSize(_sz);
  U.res.value.set(_sz.x, _sz.y);
  U.time.value = S.time;
  U.texel.value.set(1 / Math.max(1, _sz.x), 1 / Math.max(1, _sz.y));
  U.near.value = cam.near; U.far.value = cam.far;
  U.grain.value = LOOK.grain * (c.grain || 0);
  U.exposure.value = LOOK.exposure;
  const ck = S.cine;
  // speed: radial streaks + velocity motion blur (scaled to a 1/60 s shutter whatever the frame interval), CA grows
  U.speed.value = S.spd;
  U.mb.value = c.mb > 0 ? Math.min(1, S.spd * 1.6) * (1 - ck.k) : 0;
  U.mbVel.value = (1 / 60) / Math.max(1 / 60, S.rawDt);
  U.ca.value = c.ca > 0 ? LOOK.ca + LOOK.caSpeed * S.spd : 0;
  if (G && G.dyn.shafts) { updateSun(cam); setDyn(G.dyn.shafts, S.sunVis > 0.002); }
  else U.sunVis.value = 0;
  // depth of field in cinematics: focus on Kit (or opts.focus), range grows with the distance
  const dofOn = !!(G && G.dyn.dof && ck.dof && ck.k > 0.01);
  if (G && G.dyn.dof) setDyn(G.dyn.dof, dofOn);
  U.dof.value = dofOn ? Math.min(1, ck.k * 1.25) : 0;
  if (dofOn) {
    let fd = 8;
    const P = K.player, fp = typeof ck.focus === 'function' ? ck.focus() : P && (typeof P.center === 'function' ? P.center() : P.pos);
    if (fp && Number.isFinite(fp.x + fp.y + fp.z)) { _v.copy(fp).applyMatrix4(cam.matrixWorldInverse); fd = Math.max(0.5, -_v.z); }
    U.focus.value = fd; U.focal.value = 0.6 + fd * LOOK.dofRange;
    U.dofMax.value = Math.max(1.5, c.dof * 3.6 * (_sz.y / 720) * ck.k * LOOK.dofScale);
  }
}
// first frames after a (re)build: size the internal targets before the temporal nodes read them for the jitter
function presize() {
  const G = S.G, r = K.view.renderer;
  if (!G || !(S.fresh > 0)) return;
  S.fresh--;
  r.getDrawingBufferSize(_sz);
  const sp = G.named.scene;
  if (sp) sp.setSize(_sz.x, _sz.y);
  const cp = G.named.composite;
  if (cp && cp.renderTarget) cp.renderTarget.setSize(Math.floor(_sz.x * G.s), Math.floor(_sz.y * G.s));
}

// ---------- environment: a cube capture of the surroundings, PMREM-filtered by the node materials ----------
// refreshEnvironment(pos?, {floor: false | floorOpacity: 0..1, floorColor, intensity: 0..1}) — pos: the vantage point
// (kept for later calls). Objects with userData.noEnv are hidden during the capture. scene.environment = the cube
// texture (three's PMREMNode filters it, again after each capture); intensity -> scene.environmentIntensity.
let envFloor = null;
function floorMesh() {
  if (!envFloor) {
    envFloor = new THREE.Mesh(new THREE.CircleGeometry(2400, 32),
      new THREE.MeshBasicMaterial({ color: 0x0c140e, transparent: true, opacity: 0.6, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    envFloor.rotation.x = -Math.PI / 2;
    envFloor.renderOrder = 1e6;
    envFloor.frustumCulled = false;
  }
  return envFloor;
}
function refreshEnvironment(pos, opts) {
  const V = K.view, r = V && V.renderer, scene = V && V.scene;
  if (!r || !scene) return null;
  if (pos && Number.isFinite(pos.x + pos.y + pos.z)) { S.envPos.copy(pos); S.envHasPos = true; }
  else if (!S.envHasPos && V.camera) S.envPos.copy(V.camera.position);
  const hidden = [];
  let fl = null;
  try {
    if (!S.envRT) {
      S.envRT = new THREE.CubeRenderTarget(V.isTouch ? 64 : 128, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      S.cubeCam = new THREE.CubeCamera(0.5, (V.camera && V.camera.far) || 900, S.envRT);
    }
    const cc = S.cubeCam;
    cc.position.copy(S.envPos);
    cc.updateMatrixWorld(true);
    fl = opts && opts.floor === false ? null : floorMesh();
    if (fl) {
      fl.material.opacity = opts && opts.floorOpacity >= 0 ? Math.min(1, opts.floorOpacity) : 0.6;
      fl.material.color.set(opts && opts.floorColor != null ? opts.floorColor : 0x0c140e);
      fl.position.set(S.envPos.x, S.envPos.y - 2, S.envPos.z);
      fl.updateMatrixWorld(true);
      scene.add(fl);
    }
    scene.traverse(o => { if (o.visible && o.userData && o.userData.noEnv) { o.visible = false; hidden.push(o); } });
    cc.update(r, scene);
    const k = opts && opts.intensity >= 0 ? Math.min(1, opts.intensity) : 1;
    S.envScale = k;
    scene.environment = S.envRT.texture;
    scene.environmentIntensity = k;
    post.envMap = S.envRT.texture;
    S.sunScan = -1;
    return S.envRT.texture;
  } catch (e) {
    console.warn('Kit Rush 3D: environment capture failed', e);
    return null;
  } finally {
    if (fl && fl.parent) fl.parent.remove(fl);
    for (const o of hidden) o.visible = true;
  }
}

// ---------- API ----------
// the stored (or device default) preset, known once K.view.init() has run (K.tex calls it before loading anything)
gfx.sync = function () {
  const V = K.view;
  post.quality = storedQuality(V && V.isTouch);
  post.superRes = storedSuperRes(V && V.isTouch);
  const up = K.store.get('upscaler', null);
  post.upscaler = up === 'taau' || up === 'fsr' ? up : 'auto';
  S.cfg = PRESETS[post.quality];
  applyGfx(post.quality);
  return gfx;
};
post.init = function () {
  if (S.inited) return post.ok;
  S.inited = true;
  const V = K.view;
  gfx.sync();
  if (!V || !V.renderer || !V.scene || !V.camera) { S.why = 'no renderer'; return false; }
  const r = V.renderer;
  // ?nopost: no render pipeline, direct rendering with the renderer's own tone mapping (debugging, fallback test)
  let q = '';
  try { q = location.search || ''; } catch (e) { /* no location */ }
  if (/[?&]nopost(=|&|$)/.test(q)) {
    S.why = 'disabled (?nopost): direct rendering';
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = LOOK.directExposure;
    post.ok = false; post.hdr = false; post.uHDR.value = 0;
    return false;
  }
  try {
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = LOOK.exposure;
    S.active = true;
    buildPipeline();
    post.ok = true; post.hdr = true; post.uHDR.value = 1;
  } catch (e) {
    console.warn('Kit Rush 3D: post-processing unavailable, direct rendering', e);
    S.why = 'init failed: ' + (e && e.message);
    S.active = false; post.ok = false; post.hdr = false; post.uHDR.value = 0;
    r.toneMappingExposure = LOOK.directExposure;
  }
  return post.ok;
};
post.render = function (dt) {
  const V = K.view, r = V.renderer, scene = V.scene, cam = V.camera;
  if (!r || !scene || !cam) return;
  if (!S.active) { r.render(scene, cam); return; }
  tick(dt);
  // three r186 advances its node frame (the once-per-frame passes: scene pass, AO, TAA, bloom…) only in its own rAF
  // loop: a second render in the same animation frame (tests' T.renderNow, a screenshot) would reuse the passes of
  // the first one. Each K.post.render() is a new frame.
  const nf = r._nodes && r._nodes.nodeFrame;
  if (nf) { if (nf.frameId === S.frameId) nf.update(); S.frameId = nf.frameId; }
  frameUniforms(cam);
  presize();
  S.pipe.render();
};
// precompiles the scene materials for the pipeline's scene pass (MRT variants); await it behind a loading card
post.compileAsync = async function () {
  const G = S.G, r = K.view && K.view.renderer;
  if (!S.active || !G || !G.named.scene || !r) return false;
  try { await G.named.scene.compileAsync(r); return true; } catch (e) { console.warn('Kit Rush 3D: post compile', e); return false; }
};
post.setQuality = function (q) {
  if (QUALITIES.indexOf(q) < 0) return post.quality;
  post.quality = q;
  K.store.set('gfx', q);
  applyConfig();
  return q;
};
post.setSuperRes = function (on) {
  post.superRes = !!on;
  K.store.set('superres', post.superRes);
  applyConfig();
  return post.superRes;
};
// Super Résolution upscaler: 'auto' (TAAU on Ultra/Élevé/Moyen, FSR1 on Économie), 'taau' or 'fsr' (spatial FSR1 +
// RCAS on every preset); persisted in K.store 'upscaler'
post.setUpscaler = function (m) {
  post.upscaler = m === 'taau' || m === 'fsr' ? m : 'auto';
  K.store.set('upscaler', post.upscaler);
  applyConfig();
  return post.upscaler;
};
post.cinematic = function (on, opts) {
  const ck = S.cine;
  ck.on = !!on;
  if (on) {
    opts = opts || {};
    ck.letter = opts.letterbox !== false;
    ck.dof = opts.dof !== false;
    ck.focus = typeof opts.focus === 'function' ? opts.focus : null;
  }
};
post.speed = function (v) {
  v = +v;
  S.spdTarget = v > 0 ? Math.min(1, v) : 0;
  S.spdAt = S.time;
};
post.flash = function (color, seconds) {
  try { S.flashCol.set(color == null ? 0xffffff : color); } catch (e) { S.flashCol.setRGB(1, 1, 1); }
  const s = +seconds;
  S.flashDur = S.flashT = s > 0.02 ? Math.min(s, 3) : 0.35;
};
post.setSun = function (dir, color) {
  if (dir && Number.isFinite(dir.x + dir.y + dir.z) && dir.lengthSq() > 1e-8) S.sunDir.copy(dir).normalize();
  if (color != null) { try { S.sunCol.set(color); } catch (e) { /* keep the previous colour */ } }
  S.sunScan = -1;
};
// SSR opt-in: strength 0..1 (number -> a uniform, returned so it can be animated; or any TSL float node), roughness
// optional (number or node; default: the material's own roughness on standard/physical materials). Returns the
// strength node. Works whatever the preset: the mask is only read where SSR runs (Ultra / Élevé).
post.ssr = function (material, strength, rough) {
  if (!material) return null;
  const v = strength == null ? 1 : +strength;
  const sn = strength && strength.isNode ? strength : uniform(Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);
  material.ssrNode = sn;
  if (rough != null) material.ssrRoughnessNode = rough.isNode ? rough : float(+rough || 0);
  material.needsUpdate = true;
  return sn;
};
post.refreshEnvironment = refreshEnvironment;
post._state = S; // dev probes (dev/post): the live graph, its nodes and frame state
post.stats = function () {
  const V = K.view, st = V && V.stats, c = S.cfg, G = S.G;
  const out = V ? [Math.round(V.W * V.dpr), Math.round(V.H * V.dpr)] : [0, 0];
  // relative cost: sum over passes of (pixels at that pass's scale) x (weight ~ texture taps / 8), in megapixel units
  let mp = 0;
  for (const [, sc, wgt] of S.cost) mp += out[0] * out[1] * (sc > 0 ? sc * sc : 0) * wgt / 1e6;
  return {
    ok: post.ok, quality: post.quality, superRes: post.superRes, upscaler: post.upscaler, hdr: post.hdr, direct: !S.active, why: S.why,
    backend: V ? V.backend : '', scale: S.scale,
    internal: V ? [Math.round(V.W * V.dpr * S.scale), Math.round(V.H * V.dpr * S.scale)] : [0, 0],
    output: out,
    aa: c.aa === 'fxaa' ? 'fxaa' : G && G.named.taau ? 'taau' : 'traa', ao: G ? (G.named.ssgi ? 'ssgi' : G.named.gtao ? 'gtao' : '') : '',
    ssrOn: !!(G && G.named.ssr), builds: S.builds,
    passes: S.passes.slice(), cost: +mp.toFixed(2),
    gfx: { preset: gfx.preset, furShells: gfx.furShells, grass: gfx.grass, texRes: gfx.texRes, shadows: gfx.shadows, ssr: gfx.ssr },
    calls: st ? st.calls : 0, tris: st ? st.tris : 0, sceneCalls: st ? st.sceneCalls : 0, sceneTris: st ? st.sceneTris : 0,
    speed: +S.spd.toFixed(3), cinematic: +S.cine.k.toFixed(3), letterbox: +post.letterbox.toFixed(3), env: !!S.envRT,
    envScale: +S.envScale.toFixed(3), sunVis: +S.sunVis.toFixed(3), dof: +U.dof.value.toFixed(3)
  };
};
})();
