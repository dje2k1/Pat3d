// ===================== 15-post.js — K.post (render pipeline) + K.gfx (quality presets) =====================
// FOUNDATION placeholder of the v3 post stack (SPEC3 §3): THREE.RenderPipeline with a scene pass, a bloom (not on
// Économie) and the v2 grade done by hand (outputColorTransform off): ACES filmic + exposure, warm highlights / cool
// shadows, saturation, vignette, sRGB, contrast curve, then flash and letterbox. Internal resolution scaling stands
// in for "Super Résolution" (plain bilinear upscale). The whole SPEC2 K.post API stays callable; K.gfx carries the
// preset's content knobs for the other parts.
// PORT(post): v2 15-post.js did, in GLSL: half-float HDR target with MSAA (or FXAA in the grade pass), half-res SSAO
// (Ultra), light shafts (sky mask from depth + 2 radial blur passes, Élevé/Ultra), UnrealBloom mip chain with soft knee,
// depth of field in cinematics (focus = K.player or opts.focus, radius by preset), the final grade (ACES filmic,
// exposure 1.04, saturation 1.12, contrast curve 0.2, warm highlights / cool shadows tints, vignette 0.32, film grain,
// edge chromatic aberration growing with speed, radial speed blur, lens ghosts/flare from the sun, letterbox, flash),
// and Super Résolution = Catmull-Rom upscale + RCAS sharpening. The env capture measured the cube's mean radiance on
// the GPU and dimmed captures brighter than 0.5 (envCap).
import { bloom as postBloom } from 'three/addons/tsl/display/BloomNode.js';
(() => {
'use strict';
const { pass, uniform, vec2, vec3, vec4, float, uv, mix, step, max, clamp: tclamp, dot, smoothstep, acesFilmicToneMapping, sRGBTransferOETF } = TSL;
const NOOP = () => {};
const QUALITIES = ['ultra', 'high', 'medium', 'low'];
// sr: internal resolution scale with Super Résolution on; bloom: strength (0 = off)
const PRESETS = {
  ultra: { sr: 0.77, bloom: 1, furShells: 16, grass: 1, texRes: 'full', shadows: 'csm', ssr: true },
  high: { sr: 0.85, bloom: 1, furShells: 10, grass: 0.7, texRes: 'full', shadows: 'csm', ssr: true },
  medium: { sr: 0.6, bloom: 0.7, furShells: 6, grass: 0.4, texRes: 'half', shadows: 'single', ssr: false },
  low: { sr: 0.75, bloom: 0, furShells: 0, grass: 0, texRes: 'half', shadows: 'cheap', ssr: false }
};
const LOOK = {
  exposure: 1.04, directExposure: 1.05, bloomStrength: 0.32, bloomRadius: 0.45, bloomThreshold: 0.92,
  sat: 1.12, curve: 0.2, vignette: 0.32, shadowTint: [0.95, 0.99, 1.07], highTint: [1.05, 1.0, 0.93]
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
  ok: false, quality: 'high', superRes: false, hdr: false, envMap: null,
  uHDR: uniform(0), // TSL uniform: 1 while frames go through the HDR pipeline (world/city sky shaders use it)
  letterbox: 0,
  init() { return false; }, render: NOOP, setQuality: NOOP, setSuperRes: NOOP, cinematic: NOOP, speed: NOOP,
  flash: NOOP, setSun: NOOP, refreshEnvironment() { return null; },
  stats() { return { passes: [], scale: 1, quality: post.quality, ok: false }; }
};

const S = {
  inited: false, active: false, why: '', cfg: PRESETS.high, pipe: null, scenePass: null, built: '',
  scale: 1, time: 0, clk: -1, dt: 1 / 60,
  spd: 0, spdTarget: 0, spdAt: -1,
  flashT: 0, flashDur: 0, flashCol: new THREE.Color(1, 1, 1),
  cine: { on: false, k: 0, letter: true, dof: true, focus: null },
  sunDir: new THREE.Vector3(0.5, 0.7, -0.42).normalize(), sunCol: new THREE.Color(1, 0.94, 0.82),
  envPos: new THREE.Vector3(0, 30, 0), envHasPos: false, envRT: null, cubeCam: null, envScale: 1,
  passes: []
};
const uFlash = uniform(new THREE.Vector4(0, 0, 0, 0));
const uBars = uniform(0);

function storedQuality(isTouch) {
  const q = K.store.get('gfx', null);
  return QUALITIES.indexOf(q) >= 0 ? q : isTouch ? 'medium' : 'high';
}
function storedSuperRes(isTouch) {
  const s = K.store.get('superres', null);
  return typeof s === 'boolean' ? s : !!isTouch;
}

// ---------- pipeline ----------
const uExposure = uniform(LOOK.exposure), uAspect = uniform(16 / 9);
// linear HDR in -> display out (v2 FINAL_FRAG grade): ACES, luma-split tint, saturation, vignette, sRGB, S-curve,
// flash, letterbox bars
function grade(col) {
  const u = uv(), d = u.sub(0.5);
  const da = d.mul(vec2(uAspect, 1));
  const r2 = dot(da, da).div(uAspect.mul(uAspect).mul(0.25).add(0.25));
  let c = acesFilmicToneMapping(col.rgb, uExposure);
  const W = vec3(0.2126, 0.7152, 0.0722);
  c = c.mul(mix(vec3(...LOOK.shadowTint), vec3(...LOOK.highTint), smoothstep(0.0, 0.65, dot(c, W))));
  c = max(mix(vec3(dot(c, W)), c, LOOK.sat), vec3(0));
  c = c.mul(float(1).sub(smoothstep(0.12, 1.05, r2).mul(LOOK.vignette)));
  c = sRGBTransferOETF(tclamp(c, 0, 1));
  c = mix(c, c.mul(c).mul(float(3).sub(c.mul(2))), LOOK.curve);
  c = c.add(uFlash.xyz.mul(uFlash.w));
  const y = u.y;
  const bar = max(step(y, uBars), step(float(1).sub(uBars), y));
  return vec4(tclamp(mix(c, vec3(0), bar), 0, 1), 1);
}
function buildPipeline() {
  const V = K.view, r = V.renderer;
  const c = S.cfg;
  const key = post.quality + (post.superRes ? ':sr' : '');
  if (S.pipe && S.built === key) return;
  if (!S.pipe) {
    S.pipe = new THREE.RenderPipeline(r);
    S.scenePass = pass(V.scene, V.camera);
  }
  S.scale = post.superRes ? c.sr : 1;
  S.scenePass.setResolutionScale(S.scale);
  const col = S.scenePass.getTextureNode('output');
  let out = col;
  const passes = ['scene' + (S.scale < 1 ? '(x' + S.scale + ')' : '')];
  if (c.bloom > 0) {
    out = out.add(postBloom(col, LOOK.bloomStrength * c.bloom, LOOK.bloomRadius, LOOK.bloomThreshold));
    passes.push('bloom');
  }
  S.pipe.outputNode = grade(out);
  S.pipe.outputColorTransform = false; // the grade does tone mapping and sRGB itself
  S.pipe.needsUpdate = true;
  passes.push('grade(aces+tint+sat+vignette+srgb+curve)');
  S.passes = passes;
  S.built = key;
}
function applyConfig() {
  S.cfg = PRESETS[post.quality] || PRESETS.high;
  applyGfx(post.quality);
  if (S.active) buildPipeline();
}

// ---------- per-frame state ----------
function tick(dt) {
  let clk = K.game && Number.isFinite(K.game.clock) ? K.game.clock : performance.now() / 1000;
  if (!(dt > 0 && dt < 0.25)) dt = S.clk < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, clk - S.clk));
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
  flashNow(uFlash.value);
  uBars.value = post.letterbox = barsNow();
  uAspect.value = V.W / Math.max(1, V.H);
  S.pipe.render();
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
};
post.refreshEnvironment = refreshEnvironment;
post.stats = function () {
  const V = K.view, st = V && V.stats;
  return {
    ok: post.ok, quality: post.quality, superRes: post.superRes, hdr: post.hdr, direct: !S.active, why: S.why,
    backend: V ? V.backend : '', scale: S.scale,
    internal: V ? [Math.round(V.W * V.dpr * S.scale), Math.round(V.H * V.dpr * S.scale)] : [0, 0],
    output: V ? [Math.round(V.W * V.dpr), Math.round(V.H * V.dpr)] : [0, 0],
    passes: S.passes.slice(), gfx: { preset: gfx.preset, furShells: gfx.furShells, grass: gfx.grass, texRes: gfx.texRes, shadows: gfx.shadows, ssr: gfx.ssr },
    calls: st ? st.calls : 0, tris: st ? st.tris : 0, sceneCalls: st ? st.sceneCalls : 0, sceneTris: st ? st.sceneTris : 0,
    speed: +S.spd.toFixed(3), cinematic: +S.cine.k.toFixed(3), letterbox: +post.letterbox.toFixed(3), env: !!S.envRT,
    envScale: +S.envScale.toFixed(3)
  };
};
})();
