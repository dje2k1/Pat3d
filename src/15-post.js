(() => {
'use strict';
// ===================== POST: cinematic HDR pipeline ("rendu Unreal") =====================
// ultra / high / medium: scene -> half-float HDR target (MSAA on WebGL2, else FXAA in the grade pass; 24-bit depth
// texture) -> ambient occlusion (ultra) -> light shafts (sky mask from the depth, low-res radial blur) -> physically
// based bloom (THREE.UnrealBloomPass mip chain kept in HDR, soft-knee prefilter) -> depth of field (cinematics) ->
// ACES filmic + grade + lens (vignette, grain, chromatic aberration, radial speed blur, ghosts, letterbox, flash) ->
// "Super Résolution": reduced internal resolution reconstructed to the screen with a Catmull-Rom upscale + RCAS
// contrast-adaptive sharpening (the FSR1 idea).
// low: direct rendering (FXAA upscale when Super Résolution is on). Without the jsDelivr example scripts (or without
// half-float targets) the pipeline never starts: ok stays false and main renders directly, as before.
const NOOP = () => {};
const post = K.post = {
  ok: false, quality: 'high', superRes: false, hdr: false, envMap: null,
  uHDR: { value: 0 }, // 1 while frames go through the HDR pipeline (world shaders read it)
  init() { return false; }, render: NOOP, setQuality: NOOP, setSuperRes: NOOP, cinematic: NOOP, speed: NOOP,
  flash: NOOP, setSun: NOOP, refreshEnvironment() { return null; },
  stats() { return { passes: [], scale: 1, quality: post.quality, ok: false }; }
};
if (typeof THREE === 'undefined') return;

const V2 = THREE.Vector2, V3 = THREE.Vector3;
const QUALITIES = ['ultra', 'high', 'medium', 'low'];
// sr: internal resolution scale with Super Résolution on; rays: light-shaft buffer scale (0 = off); msaa: samples
const PRESETS = {
  ultra: { hdr: true, msaa: 4, bloom: 1, rays: 0.5, raysN: 24, ao: 12, blur: 12, dof: 32, ca: true, flare: true, grain: 0.03, sr: 0.77 },
  high: { hdr: true, msaa: 4, bloom: 1, rays: 0.25, raysN: 16, ao: 0, blur: 8, dof: 24, ca: true, flare: true, grain: 0.026, sr: 0.71 },
  medium: { hdr: true, msaa: 2, bloom: 0.5, rays: 0, raysN: 0, ao: 0, blur: 6, dof: 16, ca: true, flare: false, grain: 0.022, sr: 0.67 },
  low: { hdr: false, msaa: 0, bloom: 0, rays: 0, raysN: 0, ao: 0, blur: 0, dof: 0, ca: false, flare: false, grain: 0, sr: 0.6 }
};
// the look (linear HDR in, display out)
const LOOK = {
  exposure: 1.04, bloomStrength: 0.5, bloomRadius: 0.6, bloomThreshold: 1.35, knee: 0.4,
  sat: 1.12, curve: 0.2, ao: 0.8, aoRadius: 0.9, vignette: 0.32, rays: 0.45, ca: 0.0022, caSpeed: 0.02, flare: 0.045, sharp: 0.8,
  shadowTint: [0.95, 0.99, 1.07], highTint: [1.05, 1.0, 0.93], directExposure: 1.05, envCap: 0.5
};

const S = {
  inited: false, active: false, direct: true, why: '', caps: null, cfg: PRESETS.high, sizeDirty: false,
  iw: 1, ih: 1, ow: 1, oh: 1, dpr: 1,
  rtScene: null, rtRaysA: null, rtRaysB: null, rtAO: null, rtDof: null, rtLDR: null, rtLow: null,
  bloom: null, quad: null, mats: null, overlay: null,
  clk: -1, time: 0, dt: 1 / 60,
  spd: 0, spdTarget: 0, spdAt: -1,
  flashT: 0, flashDur: 0, flashCol: new THREE.Color(1, 1, 1),
  cine: { on: false, k: 0, letter: true, dof: true, focus: null },
  sunDir: new V3(0.5, 0.7, -0.42).normalize(), sunCol: new THREE.Color(1, 0.94, 0.82),
  sunUV: new V2(0.5, 0.5), sunVis: 0,
  env: null, envPos: new V3(0, 30, 0), envHasPos: false, envMean: 0, envScale: 1,
  fog: { obj: null, src: 0, out: -1 }, bg: { obj: null, src: 0, out: -1 },
  sceneCalls: 0, sceneTris: 0, calls: 0, tris: 0, np: 0, passes: []
};
const _v = new V3(), _fw = new V3(), _sz = new V2(), _cc = new THREE.Color(), _black = new THREE.Color(0, 0, 0);

// ---------- shaders ----------
const VERT = `varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const COMMON = `
float pHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 pToSRGB(vec3 c){ return mix(pow(max(c, 0.0), vec3(0.41666)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
float pLuma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;
// final grade: HDR scene + bloom + shafts -> ACES -> grade -> display (sRGB)
const FINAL_FRAG = `
uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tRays; uniform sampler2D tDepth;
uniform sampler2D tAO; uniform vec2 uAOTexel; uniform float uAO; uniform vec2 uSrcTexel;
uniform vec2 uRes; uniform float uAspect; uniform float uTime;
uniform float uExposure; uniform float uBloom; uniform vec3 uRays; uniform float uFlare;
uniform float uSpeed; uniform float uCA; uniform float uVig; uniform float uGrain; uniform float uBars; uniform vec4 uFlash;
uniform float uSat; uniform float uCurve; uniform vec3 uShadowTint; uniform vec3 uHighTint;
varying vec2 vUv;
${COMMON}
vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 acesFilmic(vec3 c){
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  return clamp(O * RRTAndODTFit(I * (c / 0.6)), 0.0, 1.0);
}
#ifdef FXAA
// no multisampling available for the HDR target: FXAA on luma-compressed HDR (c / (1 + luma)), then expanded back
vec3 fxTap(vec2 o){ vec3 c = texture2D(tScene, vUv + o * uSrcTexel).rgb; return c / (1.0 + pLuma(c)); }
vec3 fxaa(){
  vec3 nw = fxTap(vec2(-0.5, -0.5)), ne = fxTap(vec2(0.5, -0.5)), sw = fxTap(vec2(-0.5, 0.5)), se = fxTap(vec2(0.5, 0.5)), m = fxTap(vec2(0.0));
  float lnw = pLuma(nw), lne = pLuma(ne), lsw = pLuma(sw), lse = pLuma(se), lm = pLuma(m);
  float lmin = min(lm, min(min(lnw, lne), min(lsw, lse))), lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
  vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
  float red = max((lnw + lne + lsw + lse) * 0.03125, 1.0 / 128.0);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), vec2(-8.0), vec2(8.0));
  vec3 a = 0.5 * (fxTap(-dir / 6.0) + fxTap(dir / 6.0));
  vec3 b = a * 0.5 + 0.25 * (fxTap(-dir * 0.5) + fxTap(dir * 0.5));
  float lb = pLuma(b);
  vec3 c = (lb < lmin || lb > lmax) ? a : b;
  return c / max(1.0 - pLuma(c), 0.02);
}
#endif
void main(){
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  vec2 da = d * vec2(uAspect, 1.0);
  float r2 = dot(da, da) / (0.25 * uAspect * uAspect + 0.25);
  vec3 col;
#if defined(FXAA) && defined(CA)
  vec2 co = d * (uCA * r2);
  vec3 c0 = texture2D(tScene, uv).rgb;
  col = max(fxaa() + vec3(texture2D(tScene, uv - co).r - c0.r, 0.0, texture2D(tScene, uv + co).b - c0.b), 0.0);
#elif defined(FXAA)
  col = fxaa();
#elif defined(CA)
  vec2 co = d * (uCA * r2);
  col = vec3(texture2D(tScene, uv - co).r, texture2D(tScene, uv).g, texture2D(tScene, uv + co).b);
#else
  col = texture2D(tScene, uv).rgb;
#endif
#if BLUR_N > 0
  if (uSpeed > 0.003) {
    float len = uSpeed * 0.085 * smoothstep(0.02, 0.6, r2);
    vec3 acc = col;
    for (int i = 1; i <= BLUR_N; i++) acc += texture2D(tScene, uv - d * (len * float(i) / float(BLUR_N))).rgb;
    col = acc / float(BLUR_N + 1);
  }
#endif
#ifdef AO
  float ao = (texture2D(tAO, uv + vec2(-1.0, -1.0) * uAOTexel).r + texture2D(tAO, uv + vec2(1.0, -1.0) * uAOTexel).r
            + texture2D(tAO, uv + vec2(-1.0, 1.0) * uAOTexel).r + texture2D(tAO, uv + vec2(1.0, 1.0) * uAOTexel).r) * 0.25;
  col *= mix(1.0, ao, uAO);
#endif
  col += texture2D(tBloom, uv).rgb * uBloom;
#ifdef RAYS
  // shafts scatter in the air: full over the sky, softer over the occluders themselves (silhouettes stay readable)
  col += texture2D(tRays, uv).rgb * uRays * mix(0.3, 1.0, step(0.99999, texture2D(tDepth, uv).x));
#endif
#ifdef FLARE
  vec3 gh = texture2D(tBloom, 0.5 - d * 0.55).rgb * vec3(0.45, 0.7, 1.0)
          + texture2D(tBloom, 0.5 - d * 1.35).rgb * vec3(1.0, 0.75, 0.45);
  col += gh * uFlare * smoothstep(1.2, 0.2, length(d) * 2.0);
#endif
  col = acesFilmic(col * uExposure);
  float l = pLuma(col);
  col *= mix(uShadowTint, uHighTint, smoothstep(0.0, 0.65, l));
  l = pLuma(col);
  col = max(mix(vec3(l), col, uSat), 0.0);
  col *= 1.0 - uVig * smoothstep(0.12, 1.05, r2);
  col = pToSRGB(clamp(col, 0.0, 1.0));
  col = mix(col, col * col * (3.0 - 2.0 * col), uCurve);
#ifdef OUT_SCREEN
  col += uFlash.rgb * uFlash.a;
  col += (pHash(uv * uRes + fract(uTime * 7.31) * 213.0) - 0.5) * (uGrain + 1.0 / 255.0);
  col *= 1.0 - step(uv.y, uBars) - step(1.0 - uBars, uv.y);
#else
  col += (pHash(uv * uRes) - 0.5) / 255.0;
#endif
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
// Super Résolution: Catmull-Rom reconstruction + RCAS (robust contrast-adaptive sharpening) to the screen
const SR_FRAG = `
uniform sampler2D tSrc; uniform vec2 uSrcSize; uniform vec2 uOutTexel; uniform vec2 uRes;
uniform float uSharp; uniform float uTime; uniform float uGrain; uniform float uBars; uniform vec4 uFlash;
varying vec2 vUv;
${COMMON}
vec3 catmullRom(vec2 uv){
  vec2 sp = uv * uSrcSize;
  vec2 t1 = floor(sp - 0.5) + 0.5;
  vec2 f = sp - t1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (t1 - 1.0) / uSrcSize, t3 = (t1 + 2.0) / uSrcSize, t12 = (t1 + w2 / w12) / uSrcSize;
  vec3 c = texture2D(tSrc, vec2(t12.x, t0.y)).rgb * (w12.x * w0.y)
         + texture2D(tSrc, vec2(t0.x, t12.y)).rgb * (w0.x * w12.y)
         + texture2D(tSrc, t12).rgb * (w12.x * w12.y)
         + texture2D(tSrc, vec2(t3.x, t12.y)).rgb * (w3.x * w12.y)
         + texture2D(tSrc, vec2(t12.x, t3.y)).rgb * (w12.x * w3.y);
  float ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return clamp(c / ws, 0.0, 1.0);
}
void main(){
  vec3 e = catmullRom(vUv);
  vec3 b = texture2D(tSrc, vUv - vec2(0.0, uOutTexel.y)).rgb;
  vec3 d = texture2D(tSrc, vUv - vec2(uOutTexel.x, 0.0)).rgb;
  vec3 f = texture2D(tSrc, vUv + vec2(uOutTexel.x, 0.0)).rgb;
  vec3 h = texture2D(tSrc, vUv + vec2(0.0, uOutTexel.y)).rgb;
  vec3 mn4 = min(min(b, d), min(f, h)), mx4 = max(max(b, d), max(f, h));
  vec3 hitMin = min(mn4, e) / (4.0 * mx4 + 1e-4);
  vec3 hitMax = (1.0 - max(mx4, e)) / (4.0 * mn4 - 4.0 - 1e-4);
  vec3 lobeRGB = max(-hitMin, hitMax);
  float lobe = max(-0.1875, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * uSharp;
  vec3 col = (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0);
  col += uFlash.rgb * uFlash.a;
  col += (pHash(vUv * uRes + fract(uTime * 7.31) * 213.0) - 0.5) * (uGrain + 1.0 / 255.0);
  col *= 1.0 - step(vUv.y, uBars) - step(1.0 - uBars, vUv.y);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
// low + Super Résolution: FXAA on the reduced image while upscaling, then the overlays
const LOW_FRAG = `
uniform sampler2D tSrc; uniform vec2 uSrcTexel; uniform float uBars; uniform vec4 uFlash;
varying vec2 vUv;
${COMMON}
void main(){
  vec3 nw = texture2D(tSrc, vUv + vec2(-0.5, -0.5) * uSrcTexel).rgb, ne = texture2D(tSrc, vUv + vec2(0.5, -0.5) * uSrcTexel).rgb;
  vec3 sw = texture2D(tSrc, vUv + vec2(-0.5, 0.5) * uSrcTexel).rgb, se = texture2D(tSrc, vUv + vec2(0.5, 0.5) * uSrcTexel).rgb;
  vec3 m = texture2D(tSrc, vUv).rgb;
  float lnw = pLuma(nw), lne = pLuma(ne), lsw = pLuma(sw), lse = pLuma(se), lm = pLuma(m);
  float lmin = min(lm, min(min(lnw, lne), min(lsw, lse))), lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
  vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
  float red = max((lnw + lne + lsw + lse) * 0.03125, 1.0 / 128.0);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), vec2(-8.0), vec2(8.0)) * uSrcTexel;
  vec3 a = 0.5 * (texture2D(tSrc, vUv - dir / 6.0).rgb + texture2D(tSrc, vUv + dir / 6.0).rgb);
  vec3 bb = a * 0.5 + 0.25 * (texture2D(tSrc, vUv - dir * 0.5).rgb + texture2D(tSrc, vUv + dir * 0.5).rgb);
  float lb = pLuma(bb);
  vec3 col = (lb < lmin || lb > lmax) ? a : bb;
  col += uFlash.rgb * uFlash.a;
  col *= 1.0 - step(vUv.y, uBars) - step(1.0 - uBars, vUv.y);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
// low without Super Résolution: bars and flash drawn over the directly rendered frame
const OVERLAY_FRAG = `
uniform float uBars; uniform vec4 uFlash;
varying vec2 vUv;
void main(){
  float bar = step(vUv.y, uBars) + step(1.0 - uBars, vUv.y);
  gl_FragColor = bar > 0.0 ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(uFlash.rgb, clamp(uFlash.a, 0.0, 1.0));
}`;
// light shafts: sky-only source around the sun (depth == far), then two radial blur passes toward the sun
const RAYS_MASK_FRAG = `
uniform sampler2D tScene; uniform sampler2D tDepth; uniform vec2 uTexel; uniform vec2 uSun; uniform float uAspect;
varying vec2 vUv;
vec3 tap(vec2 o){ vec2 u = vUv + o * uTexel; return max(min(texture2D(tScene, u).rgb, vec3(8.0)) - 0.75, 0.0) * step(0.99999, texture2D(tDepth, u).x); }
void main(){
  vec3 c = (tap(vec2(-1.5, -1.5)) + tap(vec2(1.5, -1.5)) + tap(vec2(-1.5, 1.5)) + tap(vec2(1.5, 1.5))) * 0.25;
  float fall = 1.0 - smoothstep(0.0, 0.55, length((vUv - uSun) * vec2(uAspect, 1.0)));
  gl_FragColor = vec4(c * fall * fall, 1.0);
}`;
const RAYS_BLUR_FRAG = `
uniform sampler2D tSrc; uniform vec2 uSun; uniform float uLen; uniform float uDecay;
varying vec2 vUv;
void main(){
  vec2 delta = (vUv - uSun) * (uLen / float(RAYS_N));
  vec2 uv = vUv; vec3 acc = vec3(0.0); float w = 1.0, ws = 0.0;
  for (int i = 0; i < RAYS_N; i++) { acc += texture2D(tSrc, uv).rgb * w; ws += w; w *= uDecay; uv -= delta; }
  gl_FragColor = vec4(acc / ws, 1.0);
}`;
// depth of field (cinematics): gather on a golden-angle spiral; a sample counts when its own blur covers this pixel,
// and the background never bleeds over a sharper foreground
const DOF_FRAG = `
uniform sampler2D tScene; uniform sampler2D tDepth; uniform vec2 uTexel; uniform float uNear; uniform float uFar;
uniform float uFocus; uniform float uRange; uniform float uMaxR;
varying vec2 vUv;
float dist(vec2 uv){ float d = texture2D(tDepth, uv).x; return (uNear * uFar) / (uFar - (uFar - uNear) * d); }
float coc(float z){ return clamp((abs(z - uFocus) - uRange) / max(z, 0.1) * 2.2, 0.0, 1.0) * uMaxR; }
void main(){
  float zc = dist(vUv), cc = coc(zc);
  vec3 acc = texture2D(tScene, vUv).rgb; float ws = 1.0;
  for (int i = 1; i < DOF_N; i++) {
    float fi = float(i);
    float r = sqrt(fi / float(DOF_N)) * uMaxR;
    float a = fi * 2.39996323;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uTexel;
    float zs = dist(uv);
    float cs = coc(zs);
    float w = smoothstep(r - 1.0, r + 0.5, zs < zc ? cs : min(cs, cc));
    acc += texture2D(tScene, uv).rgb * w; ws += w;
  }
  gl_FragColor = vec4(acc / ws, 1.0);
}`;
// ambient occlusion (ultra): Alchemy-style AO from the depth alone at half resolution; normals from the depth's
// smaller neighbour differences; a 4x4 interleaved rotation pattern that the grade pass's 4x4 box filter cancels
const AO_FRAG = `
uniform sampler2D tDepth; uniform vec2 uTexel; uniform vec2 uTanHalf; uniform float uNear; uniform float uFar;
uniform float uRadius; uniform float uProj;
varying vec2 vUv;
float dist(vec2 uv){ return (uNear * uFar) / (uFar - (uFar - uNear) * texture2D(tDepth, uv).x); }
vec3 viewPos(vec2 uv){ float z = dist(uv); return vec3((uv * 2.0 - 1.0) * uTanHalf * z, -z); }
void main(){
  // a half-resolution pixel centre falls on a depth texel edge: snap to a texel centre so the nearest-filtered
  // neighbours used for the normal are consistent (otherwise every other row reconstructs a wrong normal)
  vec2 uv = (floor(vUv / uTexel) + 0.5) * uTexel;
  if (texture2D(tDepth, uv).x >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(uv);
  vec3 px = viewPos(uv + vec2(uTexel.x, 0.0)) - P, nx = P - viewPos(uv - vec2(uTexel.x, 0.0));
  vec3 py = viewPos(uv + vec2(0.0, uTexel.y)) - P, ny = P - viewPos(uv - vec2(0.0, uTexel.y));
  vec3 N = normalize(cross(abs(px.z) < abs(nx.z) ? px : nx, abs(py.z) < abs(ny.z) ? py : ny));
  float z = -P.z;
  float rPx = clamp(uRadius * uProj / z, 2.0, 48.0);
  vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
  float ang = (cell.x + cell.y * 4.0) * 0.3926991;
  float occ = 0.0;
  for (int i = 0; i < AO_N; i++) {
    float fi = (float(i) + 0.5) / float(AO_N);
    float a = ang + float(i) * 2.39996323;
    vec3 v = viewPos(uv + vec2(cos(a), sin(a)) * (sqrt(fi) * rPx) * uTexel) - P;
    float vv = dot(v, v);
    occ += max(dot(v, N) - 0.012 * z, 0.0) / (vv + 0.03) * step(vv, uRadius * uRadius * 4.0);
  }
  float ao = clamp(1.0 - 1.6 * uRadius * occ / float(AO_N), 0.0, 1.0);
  gl_FragColor = vec4(vec3(mix(ao, 1.0, smoothstep(55.0, 110.0, z))), 1.0);
}`;
// UnrealBloomPass prefilter, replaced: 4-tap box downsample, firefly clamp, soft knee threshold (HDR in, HDR out)
const BRIGHT_FRAG = `
uniform sampler2D tDiffuse; uniform float luminosityThreshold; uniform float smoothWidth; uniform vec3 defaultColor; uniform float defaultOpacity;
uniform vec2 uTexel; uniform float uKnee;
varying vec2 vUv;
vec3 tap(vec2 o){ return min(texture2D(tDiffuse, vUv + o * uTexel).rgb, vec3(24.0)); }
void main(){
  vec3 c = (tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0))) * 0.25;
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - luminosityThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  gl_FragColor = vec4(c * (max(soft, br - luminosityThreshold) / max(br, 1e-4)), 1.0);
}`;

function shaderMat(frag, uniforms, defines, extra) {
  return new THREE.ShaderMaterial(Object.assign({
    uniforms, defines: defines || {}, vertexShader: VERT, fragmentShader: frag,
    depthTest: false, depthWrite: false, toneMapped: false, fog: false
  }, extra || {}));
}

// ---------- capabilities ----------
function makeRT(w, h, o) {
  const opts = {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat,
    type: o.type || THREE.UnsignedByteType, depthBuffer: !!o.depth, stencilBuffer: false
  };
  const rt = o.msaa ? new THREE.WebGLMultisampleRenderTarget(w, h, opts) : new THREE.WebGLRenderTarget(w, h, opts);
  if (o.msaa) rt.samples = o.msaa;
  rt.texture.generateMipmaps = false;
  // a depth texture of unsigned ints gives the target (and its MSAA renderbuffer) 24-bit depth, as on the canvas
  if (o.depth) rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
  return rt;
}
function freeRT(rt) {
  if (!rt) return null;
  if (rt.depthTexture) rt.depthTexture.dispose();
  rt.dispose();
  return null;
}
// Renders a known quad into an HDR (optionally MSAA) target with a depth texture, reads colour and depth back
// through an 8-bit target: proves half-float rendering, the MSAA resolve and the depth copy work on this device.
function probeTarget(r, msaa) {
  const gl = r.getContext();
  let rt = null, out = null, sc = null, quad = null, mat = null, rd = null;
  const prev = r.getRenderTarget(), ac = r.autoClear, ca = r.getClearAlpha();
  r.getClearColor(_cc);
  try {
    rt = makeRT(16, 16, { type: THREE.HalfFloatType, depth: true, msaa });
    r.setRenderTarget(rt);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return false;
    sc = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    mat = new THREE.ShaderMaterial({
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'void main(){ gl_FragColor = vec4(2.0, 0.25, 0.5, 1.0); }', toneMapped: false
    });
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    sc.add(quad);
    r.autoClear = true;
    r.setClearColor(_black, 1);
    r.render(sc, cam);
    rd = shaderMat('uniform sampler2D tC; uniform sampler2D tD; varying vec2 vUv;\nvoid main(){ vec4 c = texture2D(tC, vUv); gl_FragColor = vec4(c.r * 0.25, c.g, texture2D(tD, vUv).x, 1.0); }',
      { tC: { value: rt.texture }, tD: { value: rt.depthTexture } });
    out = makeRT(4, 4, {});
    const fq = new THREE.FullScreenQuad(rd);
    r.setRenderTarget(out);
    fq.render(r);
    const px = new Uint8Array(4);
    r.readRenderTargetPixels(out, 1, 1, 1, 1, px);
    // expected: r 0.5 (proves > 1 survived), g 0.25, depth 0.5 (quad at ndc z 0)
    return Math.abs(px[0] - 128) < 14 && Math.abs(px[1] - 64) < 14 && Math.abs(px[2] - 128) < 20;
  } catch (e) {
    return false;
  } finally {
    r.setRenderTarget(prev);
    r.autoClear = ac;
    r.setClearColor(_cc, ca);
    freeRT(rt); freeRT(out);
    if (quad) quad.geometry.dispose();
    if (mat) mat.dispose();
    if (rd) rd.dispose();
    for (let i = 0; i < 8 && gl.getError() !== gl.NO_ERROR; i++) { /* the probe's own errors stay here */ }
  }
}
function probe(r) {
  const gl2 = !!r.capabilities.isWebGL2;
  const has = n => { try { return r.extensions.has(n); } catch (e) { return false; } };
  const caps = { gl2, depth: gl2 || has('WEBGL_depth_texture'), half: false, msaa: 0, hdr: false };
  const halfOk = gl2 ? (has('EXT_color_buffer_float') || has('EXT_color_buffer_half_float'))
    : (has('OES_texture_half_float') && has('OES_texture_half_float_linear') && has('EXT_color_buffer_half_float'));
  if (halfOk && caps.depth) caps.half = probeTarget(r, 0);
  if (caps.half && gl2 && (r.capabilities.maxSamples || 0) >= 2) caps.msaa = probeTarget(r, Math.min(4, r.capabilities.maxSamples)) ? Math.min(4, r.capabilities.maxSamples) : 0;
  caps.hdr = caps.half && caps.depth;
  return caps;
}

// ---------- bloom (UnrealBloomPass internals kept, its final additive blend skipped: the grade pass composites) ----------
function makeBloom(w, h, sw, sh) {
  const b = new THREE.UnrealBloomPass(new V2(w, h), LOOK.bloomStrength, LOOK.bloomRadius, LOOK.bloomThreshold);
  const rts = [b.renderTargetBright].concat(b.renderTargetsHorizontal, b.renderTargetsVertical);
  for (const rt of rts) rt.texture.type = THREE.HalfFloatType;
  b.highPassUniforms.uTexel = { value: new V2(1 / sw, 1 / sh) };
  b.highPassUniforms.uKnee = { value: LOOK.knee };
  b.materialHighPassFilter.fragmentShader = BRIGHT_FRAG;
  b.materialHighPassFilter.needsUpdate = true;
  const warm = [[1, 1, 1], [1, 0.99, 0.97], [1, 0.97, 0.92], [1, 0.95, 0.88], [1, 0.93, 0.84]];
  for (let i = 0; i < b.bloomTintColors.length; i++) b.bloomTintColors[i].set(warm[i][0], warm[i][1], warm[i][2]);
  return b;
}
function renderBloom(r, b, src) {
  S.np += 2 + b.nMips * 2;
  b.highPassUniforms.tDiffuse.value = src;
  b.highPassUniforms.luminosityThreshold.value = b.threshold;
  b.fsQuad.material = b.materialHighPassFilter;
  r.setRenderTarget(b.renderTargetBright);
  b.fsQuad.render(r);
  let input = b.renderTargetBright;
  const BX = THREE.UnrealBloomPass.BlurDirectionX, BY = THREE.UnrealBloomPass.BlurDirectionY;
  for (let i = 0; i < b.nMips; i++) {
    const m = b.separableBlurMaterials[i];
    b.fsQuad.material = m;
    m.uniforms.colorTexture.value = input.texture; m.uniforms.direction.value = BX;
    r.setRenderTarget(b.renderTargetsHorizontal[i]);
    b.fsQuad.render(r);
    m.uniforms.colorTexture.value = b.renderTargetsHorizontal[i].texture; m.uniforms.direction.value = BY;
    r.setRenderTarget(b.renderTargetsVertical[i]);
    b.fsQuad.render(r);
    input = b.renderTargetsVertical[i];
  }
  const cm = b.compositeMaterial;
  b.fsQuad.material = cm;
  cm.uniforms.bloomStrength.value = b.strength;
  cm.uniforms.bloomRadius.value = b.radius;
  cm.uniforms.bloomTintColors.value = b.bloomTintColors;
  r.setRenderTarget(b.renderTargetsHorizontal[0]);
  b.fsQuad.render(r);
  return b.renderTargetsHorizontal[0].texture;
}
function freeBloom() {
  const b = S.bloom;
  if (!b) return;
  b.dispose();
  b.materialHighPassFilter.dispose(); b.compositeMaterial.dispose(); b.materialCopy.dispose(); b.basic.dispose();
  for (const m of b.separableBlurMaterials) m.dispose();
  S.bloom = null;
}

// ---------- pipeline build ----------
function buildMaterials() {
  const c = S.cfg, M = S.mats = {};
  const fd = { BLUR_N: c.blur | 0 };
  if (c.ca) fd.CA = '';
  if (!S.direct && !(Math.min(c.msaa, S.caps ? S.caps.msaa : 0) > 0)) fd.FXAA = '';
  if (c.rays > 0) fd.RAYS = '';
  if (c.ao > 0) fd.AO = '';
  if (c.flare) fd.FLARE = '';
  if (!S.superRes) fd.OUT_SCREEN = '';
  M.final = shaderMat(FINAL_FRAG, {
    tScene: { value: null }, tBloom: { value: null }, tRays: { value: null }, tDepth: { value: null },
    tAO: { value: null }, uAOTexel: { value: new V2() }, uAO: { value: LOOK.ao }, uSrcTexel: { value: new V2(1, 1) },
    uRes: { value: new V2(1, 1) }, uAspect: { value: 1 }, uTime: { value: 0 },
    uExposure: { value: LOOK.exposure }, uBloom: { value: 1 }, uRays: { value: new V3() }, uFlare: { value: LOOK.flare },
    uSpeed: { value: 0 }, uCA: { value: LOOK.ca }, uVig: { value: LOOK.vignette }, uGrain: { value: c.grain }, uBars: { value: 0 },
    uFlash: { value: new THREE.Vector4() }, uSat: { value: LOOK.sat }, uCurve: { value: LOOK.curve },
    uShadowTint: { value: new V3().fromArray(LOOK.shadowTint) }, uHighTint: { value: new V3().fromArray(LOOK.highTint) }
  }, fd);
  M.sr = shaderMat(SR_FRAG, {
    tSrc: { value: null }, uSrcSize: { value: new V2(1, 1) }, uOutTexel: { value: new V2(1, 1) }, uRes: { value: new V2(1, 1) },
    uSharp: { value: LOOK.sharp }, uTime: { value: 0 }, uGrain: { value: c.grain }, uBars: { value: 0 }, uFlash: { value: new THREE.Vector4() }
  });
  if (c.rays > 0) {
    M.raysMask = shaderMat(RAYS_MASK_FRAG, { tScene: { value: null }, tDepth: { value: null }, uTexel: { value: new V2() }, uSun: { value: S.sunUV }, uAspect: { value: 1 } });
    M.raysBlur = shaderMat(RAYS_BLUR_FRAG, { tSrc: { value: null }, uSun: { value: S.sunUV }, uLen: { value: 0.1 }, uDecay: { value: 1 } }, { RAYS_N: c.raysN | 0 });
  }
  if (c.ao > 0) {
    M.ao = shaderMat(AO_FRAG, {
      tDepth: { value: null }, uTexel: { value: new V2() }, uTanHalf: { value: new V2(1, 1) }, uNear: { value: 0.1 }, uFar: { value: 900 },
      uRadius: { value: LOOK.aoRadius }, uProj: { value: 500 }
    }, { AO_N: c.ao | 0 });
  }
  if (c.dof > 0) {
    M.dof = shaderMat(DOF_FRAG, {
      tScene: { value: null }, tDepth: { value: null }, uTexel: { value: new V2() }, uNear: { value: 0.1 }, uFar: { value: 900 },
      uFocus: { value: 8 }, uRange: { value: 1 }, uMaxR: { value: 6 }
    }, { DOF_N: c.dof | 0 });
  }
  M.low = shaderMat(LOW_FRAG, { tSrc: { value: null }, uSrcTexel: { value: new V2() }, uBars: { value: 0 }, uFlash: { value: new THREE.Vector4() } });
  M.overlay = shaderMat(OVERLAY_FRAG, { uBars: { value: 0 }, uFlash: { value: new THREE.Vector4() } }, null, { transparent: true });
}
function freeMaterials() {
  if (!S.mats) return;
  for (const k in S.mats) S.mats[k].dispose();
  S.mats = null;
}
function freeTargets() {
  S.rtScene = freeRT(S.rtScene); S.rtRaysA = freeRT(S.rtRaysA); S.rtRaysB = freeRT(S.rtRaysB); S.rtAO = freeRT(S.rtAO);
  S.rtDof = freeRT(S.rtDof); S.rtLDR = freeRT(S.rtLDR); S.rtLow = freeRT(S.rtLow);
  freeBloom();
}
// (re)creates the targets for the current preset, Super Résolution and drawing-buffer size
function buildTargets() {
  freeTargets();
  const r = K.view.renderer, c = S.cfg;
  r.getDrawingBufferSize(_sz);
  S.ow = Math.max(1, _sz.x | 0); S.oh = Math.max(1, _sz.y | 0); S.dpr = K.view.dpr;
  const sc = S.superRes ? c.sr : 1;
  S.iw = Math.max(1, Math.round(S.ow * sc)); S.ih = Math.max(1, Math.round(S.oh * sc));
  const half = THREE.HalfFloatType;
  if (S.direct) {
    if (S.superRes) {
      S.rtLow = makeRT(S.iw, S.ih, { depth: true });
      S.rtLow.texture.encoding = THREE.sRGBEncoding;
    }
    return;
  }
  S.rtScene = makeRT(S.iw, S.ih, { type: half, depth: true, msaa: Math.min(c.msaa, S.caps.msaa) });
  if (c.rays > 0) {
    const rw = Math.max(1, Math.round(S.iw * c.rays)), rh = Math.max(1, Math.round(S.ih * c.rays));
    S.rtRaysA = makeRT(rw, rh, { type: half });
    S.rtRaysB = makeRT(rw, rh, { type: half });
  }
  if (c.ao > 0) S.rtAO = makeRT(Math.max(1, Math.round(S.iw / 2)), Math.max(1, Math.round(S.ih / 2)), {});
  if (S.superRes) S.rtLDR = makeRT(S.iw, S.ih, {});
  S.bloom = makeBloom(Math.max(2, Math.round(S.iw * c.bloom)), Math.max(2, Math.round(S.ih * c.bloom)), S.iw, S.ih);
}
function ensureDof() {
  if (!S.rtDof || S.rtDof.width !== S.iw || S.rtDof.height !== S.ih) {
    freeRT(S.rtDof);
    S.rtDof = makeRT(S.iw, S.ih, { type: THREE.HalfFloatType });
  }
  return S.rtDof;
}

// every material's program bakes the renderer's tone mapping in (r128 does not notice a change on its own)
function invalidatePrograms() {
  const sc = K.view.scene;
  if (!sc) return;
  sc.traverse(o => {
    const m = o.material;
    if (!m) return;
    if (Array.isArray(m)) for (const x of m) x.needsUpdate = true;
    else m.needsUpdate = true;
  });
}
// Fog and clear colours are authored in display space for direct rendering (r128 mixes the fog after the output
// encoding). In the linear HDR targets they must be linear, so the pipeline converts them and restores them in
// direct mode; a colour its owner changes is picked up again.
function syncColor(color, slot, hdr) {
  const hex = color.getHex();
  if (color !== slot.obj) { slot.obj = color; slot.src = hex; } // a new colour: as authored
  else if (hex !== slot.out) slot.src = hex; // its owner changed it since
  else return;
  color.setHex(slot.src);
  if (hdr) color.convertSRGBToLinear();
  slot.out = color.getHex();
}
function syncColors(scene, hdr) {
  const f = scene.fog;
  if (f && f.color) {
    syncColor(f.color, S.fog, hdr);
    // an owner can give its fog the exact linear colour to use in HDR (e.g. its sky's horizon)
    if (hdr && f.hdrColor && f.hdrColor.isColor && f.color.getHex() !== f.hdrColor.getHex()) { f.color.copy(f.hdrColor); S.fog.out = f.color.getHex(); }
  }
  if (scene.background && scene.background.isColor) syncColor(scene.background, S.bg, hdr);
}
function restoreColors(scene) {
  for (const slot of [S.fog, S.bg]) {
    if (slot.obj && ((scene.fog && scene.fog.color === slot.obj) || scene.background === slot.obj)) slot.obj.setHex(slot.src);
    slot.obj = null; slot.out = -1;
  }
}

function applyConfig() {
  const V = K.view, r = V.renderer;
  const want = PRESETS[post.quality] || PRESETS.high;
  const hdr = !!(want.hdr && S.caps && S.caps.hdr);
  const wasDirect = S.direct;
  S.cfg = want; S.superRes = post.superRes;
  S.direct = !hdr;
  post.hdr = hdr;
  post.uHDR.value = hdr ? 1 : 0;
  r.toneMapping = hdr ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = LOOK.directExposure;
  restoreColors(V.scene);
  freeMaterials();
  buildMaterials();
  buildTargets();
  if (wasDirect !== S.direct) {
    invalidatePrograms();
    if (S.env) refreshEnvironment(S.envPos);
  }
  S.passes = listPasses();
}
function listPasses() {
  const c = S.cfg, p = [];
  if (S.direct) {
    p.push('scene(direct)');
    if (S.superRes) p.push('fxaa-upscale');
    else p.push('overlay(when needed)');
    return p;
  }
  p.push('scene(hdr' + (S.rtScene && S.rtScene.isWebGLMultisampleRenderTarget ? ',msaa' + S.rtScene.samples : '') + ')');
  if (c.ao > 0) p.push('ssao(half)');
  if (c.rays > 0) p.push('shafts-mask', 'shafts-blur', 'shafts-blur');
  p.push('bloom-prefilter', 'bloom-blur x' + (S.bloom ? S.bloom.nMips * 2 : 0), 'bloom-composite');
  if (c.dof > 0) p.push('dof(cinematic)');
  p.push('aces-grade-lens' + (S.mats && 'FXAA' in S.mats.final.defines ? '+fxaa' : '') + (S.superRes ? '' : '(screen)'));
  if (S.superRes) p.push('superres-rcas(screen)');
  return p;
}

// ---------- per-frame state ----------
function tick(dt) {
  let clk = K.game && Number.isFinite(K.game.clock) ? K.game.clock : performance.now() / 1000;
  if (!(dt > 0 && dt < 0.25)) dt = S.clk < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, clk - S.clk));
  S.clk = clk;
  S.dt = dt;
  S.time += dt;
  if (S.time > 1e4) S.time -= 1e4;
  // speed effects follow the last value main reported, fading out when it stops reporting
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
function updateSun(cam) {
  cam.getWorldDirection(_fw);
  const facing = _fw.dot(S.sunDir);
  _v.copy(cam.position).addScaledVector(S.sunDir, 400).project(cam);
  S.sunUV.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
  const edge = Math.max(Math.abs(_v.x), Math.abs(_v.y));
  const a = Math.min(1, Math.max(0, (facing - 0.05) / 0.3)), b = Math.min(1, Math.max(0, (1.9 - edge) / 0.9));
  S.sunVis = facing > 0 ? a * a * b : 0;
}

// ---------- render paths ----------
function quadTo(r, target, mat) {
  S.quad.material = mat;
  r.setRenderTarget(target);
  S.quad.render(r);
  S.np++;
}
function renderDirect(r, scene, cam) {
  const M = S.mats, bars = barsNow();
  if (S.superRes && S.rtLow) {
    r.setRenderTarget(S.rtLow);
    r.render(scene, cam);
    S.sceneCalls = r.info.render.calls; S.sceneTris = r.info.render.triangles;
    const m = M.low;
    m.uniforms.tSrc.value = S.rtLow.texture;
    m.uniforms.uSrcTexel.value.set(1 / S.iw, 1 / S.ih);
    m.uniforms.uBars.value = bars;
    flashNow(m.uniforms.uFlash.value);
    r.autoClear = false;
    quadTo(r, null, m);
    return;
  }
  r.setRenderTarget(null);
  r.render(scene, cam);
  S.sceneCalls = r.info.render.calls; S.sceneTris = r.info.render.triangles;
  const m = M.overlay;
  flashNow(m.uniforms.uFlash.value);
  if (bars > 0 || m.uniforms.uFlash.value.w > 0.002) {
    m.uniforms.uBars.value = bars;
    r.autoClear = false;
    quadTo(r, null, m);
  }
}
function renderHDR(r, scene, cam) {
  const M = S.mats, c = S.cfg, rt = S.rtScene;
  r.autoClear = true;
  r.setRenderTarget(rt);
  r.render(scene, cam);
  S.sceneCalls = r.info.render.calls; S.sceneTris = r.info.render.triangles;
  r.autoClear = false;
  // contact shadows
  if (c.ao > 0 && M.ao && S.rtAO) {
    const am = M.ao, au = am.uniforms, pe = cam.projectionMatrix.elements;
    au.tDepth.value = rt.depthTexture; au.uTexel.value.set(1 / S.iw, 1 / S.ih);
    au.uTanHalf.value.set(1 / pe[0], 1 / pe[5]); au.uNear.value = cam.near; au.uFar.value = cam.far;
    au.uProj.value = 0.5 * S.ih * pe[5];
    quadTo(r, S.rtAO, am);
    M.final.uniforms.tAO.value = S.rtAO.texture;
    M.final.uniforms.uAOTexel.value.set(1 / S.rtAO.width, 1 / S.rtAO.height);
  }
  // light shafts
  let rays = false;
  if (c.rays > 0 && M.raysMask && S.sunVis > 0.002) {
    const mk = M.raysMask;
    mk.uniforms.tScene.value = rt.texture; mk.uniforms.tDepth.value = rt.depthTexture;
    mk.uniforms.uTexel.value.set(1 / S.iw, 1 / S.ih); mk.uniforms.uAspect.value = S.iw / S.ih;
    quadTo(r, S.rtRaysA, mk);
    const bl = M.raysBlur;
    bl.uniforms.tSrc.value = S.rtRaysA.texture; bl.uniforms.uLen.value = 0.14; bl.uniforms.uDecay.value = 1;
    quadTo(r, S.rtRaysB, bl);
    bl.uniforms.tSrc.value = S.rtRaysB.texture; bl.uniforms.uLen.value = 0.92; bl.uniforms.uDecay.value = 0.965;
    quadTo(r, S.rtRaysA, bl);
    rays = true;
  }
  const bloomTex = renderBloom(r, S.bloom, rt.texture);
  // depth of field
  let src = rt.texture;
  const ck = S.cine;
  if (ck.dof && ck.k > 0.01 && M.dof) {
    const dm = M.dof, dst = ensureDof();
    let fd = 8;
    const P = K.player, fp = typeof ck.focus === 'function' ? ck.focus() : P && (typeof P.center === 'function' ? P.center() : P.pos);
    if (fp && Number.isFinite(fp.x + fp.y + fp.z)) { _v.copy(fp).applyMatrix4(cam.matrixWorldInverse); fd = Math.max(0.5, -_v.z); }
    dm.uniforms.tScene.value = rt.texture; dm.uniforms.tDepth.value = rt.depthTexture;
    dm.uniforms.uTexel.value.set(1 / S.iw, 1 / S.ih);
    dm.uniforms.uNear.value = cam.near; dm.uniforms.uFar.value = cam.far;
    dm.uniforms.uFocus.value = fd; dm.uniforms.uRange.value = 0.6 + fd * 0.08;
    dm.uniforms.uMaxR.value = Math.max(1.5, (c.dof >= 32 ? 11 : c.dof >= 24 ? 9 : 7) * (S.ih / 720) * ck.k);
    quadTo(r, dst, dm);
    src = dst.texture;
  }
  // grade
  const f = M.final, u = f.uniforms;
  u.uSrcTexel.value.set(1 / S.iw, 1 / S.ih);
  u.tScene.value = src; u.tBloom.value = bloomTex; u.tRays.value = rays ? S.rtRaysA.texture : bloomTex; u.tDepth.value = rt.depthTexture;
  const vis = rays ? S.sunVis * LOOK.rays : 0;
  u.uRays.value.set(S.sunCol.r * vis, S.sunCol.g * vis, S.sunCol.b * vis);
  u.uAspect.value = S.iw / S.ih; u.uTime.value = S.time;
  u.uSpeed.value = S.spd;
  u.uCA.value = LOOK.ca + LOOK.caSpeed * S.spd;
  u.uFlare.value = LOOK.flare * (0.35 + 0.65 * S.sunVis);
  const bars = barsNow();
  if (S.superRes) {
    u.uRes.value.set(S.iw, S.ih);
    quadTo(r, S.rtLDR, f);
    const s = M.sr, su = s.uniforms;
    su.tSrc.value = S.rtLDR.texture; su.uSrcSize.value.set(S.iw, S.ih);
    su.uOutTexel.value.set(1 / S.ow, 1 / S.oh); su.uRes.value.set(S.ow, S.oh);
    su.uTime.value = S.time; su.uBars.value = bars; flashNow(su.uFlash.value);
    quadTo(r, null, s);
  } else {
    u.uRes.value.set(S.ow, S.oh); u.uBars.value = bars; flashNow(u.uFlash.value);
    quadTo(r, null, f);
  }
}

// ---------- environment (PMREM of the current surroundings) ----------
// The surroundings are captured from a vantage point (sky, clouds, far scenery and the ground below). The env map
// stands for light from far away, so the ground half is dimmed by a translucent floor under the vantage point:
// the bounce stays tinted by the ground without lighting undersides like a second sun.
// The capture's mean radiance is measured on the GPU; a capture brighter than LOOK.envCap (a blazing sunset sky) is
// taken again through a uniform dimmer so image-based light stays in the range the materials were balanced for.
// refreshEnvironment(pos?, {floor: false | floorOpacity: 0..1, floorColor, intensity: 0..1}) — pos: the vantage point
// (kept for later calls); intensity: an extra scale of the captured light (default 1).
let envFloor = null, envDim = null, envProbe = null;
function dimMesh() {
  if (!envDim) {
    envDim = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false, toneMapped: false, side: THREE.BackSide }));
    envDim.renderOrder = 1e6 + 1;
    envDim.frustumCulled = false;
  }
  return envDim;
}
// mean linear luminance of a cube capture (256 Fibonacci directions), read back from a 1x1 RGBA8 target as 16-bit fixed point / 8
function envMean(r, cubeTex) {
  if (!envProbe) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { tCube: { value: null } }, depthTest: false, depthWrite: false,
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform samplerCube tCube;
void main(){
  vec3 s = vec3(0.0);
  for (int i = 0; i < 256; i++) {
    float fi = float(i) + 0.5, y = 1.0 - fi / 128.0, rr = sqrt(max(0.0, 1.0 - y * y)), a = fi * 2.39996323;
    s += min(textureCube(tCube, vec3(cos(a) * rr, y, sin(a) * rr)).rgb, vec3(64.0));
  }
  float L = clamp(dot(s / 256.0, vec3(0.2126, 0.7152, 0.0722)) * 0.125, 0.0, 1.0) * 255.0;
  gl_FragColor = vec4(floor(L) / 255.0, fract(L), 0.0, 1.0);
}`
    });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    q.frustumCulled = false;
    envProbe = { q, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), rt: new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false }), px: new Uint8Array(4) };
  }
  const P = envProbe;
  P.q.material.uniforms.tCube.value = cubeTex;
  r.setRenderTarget(P.rt);
  r.render(P.q, P.cam);
  r.readRenderTargetPixels(P.rt, 0, 0, 1, 1, P.px);
  P.q.material.uniforms.tCube.value = null;
  const L = (P.px[0] + P.px[1] / 255) / 255 * 8;
  return Number.isFinite(L) ? L : 0;
}
function floorMesh() {
  if (!envFloor) {
    envFloor = new THREE.Mesh(new THREE.CircleGeometry(2400, 32),
      new THREE.MeshBasicMaterial({ color: 0x0c140e, transparent: true, opacity: 0.6, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide }));
    envFloor.rotation.x = -Math.PI / 2;
    envFloor.renderOrder = 1e6;
    envFloor.frustumCulled = false;
  }
  return envFloor;
}
function refreshEnvironment(pos, opts) {
  const V = K.view, r = V && V.renderer, scene = V && V.scene;
  if (!r || !scene || typeof THREE.PMREMGenerator !== 'function' || typeof THREE.CubeCamera !== 'function') return null;
  if (pos && Number.isFinite(pos.x + pos.y + pos.z)) { S.envPos.copy(pos); S.envHasPos = true; }
  else if (!S.envHasPos && V.camera) S.envPos.copy(V.camera.position);
  let cubeRT = null, pm = null;
  const hidden = [];
  const prevRT = r.getRenderTarget();
  try {
    const half = S.caps ? S.caps.half : !!r.capabilities.isWebGL2 && r.extensions.has('EXT_color_buffer_float');
    cubeRT = new THREE.WebGLCubeRenderTarget(V.isTouch ? 64 : 128, {
      type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat,
      generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, stencilBuffer: true
    });
    const cc = new THREE.CubeCamera(0.5, (V.camera && V.camera.far) || 900, cubeRT);
    cc.position.copy(S.envPos);
    cc.updateMatrixWorld(true);
    const fl = opts && opts.floor === false ? null : floorMesh();
    if (fl) {
      fl.material.opacity = opts && opts.floorOpacity >= 0 ? Math.min(1, opts.floorOpacity) : 0.6;
      fl.material.color.set(opts && opts.floorColor != null ? opts.floorColor : 0x0c140e);
      fl.position.set(S.envPos.x, S.envPos.y - 2, S.envPos.z);
      fl.updateMatrixWorld(true);
      scene.add(fl);
    }
    scene.traverse(o => { if (o.visible && o.userData && o.userData.noEnv) { o.visible = false; hidden.push(o); } });
    if (S.active) syncColors(scene, !S.direct);
    cc.update(r, scene);
    const mean = envMean(r, cubeRT.texture);
    const want = opts && opts.intensity >= 0 ? Math.min(1, opts.intensity) : 1;
    const k = Math.min(want, mean > LOOK.envCap ? LOOK.envCap / mean : 1);
    S.envMean = mean; S.envScale = k;
    if (k < 0.995) {
      const dm = dimMesh();
      dm.material.opacity = 1 - k;
      dm.position.copy(S.envPos);
      dm.updateMatrixWorld(true);
      scene.add(dm);
      cc.update(r, scene);
    }
    pm = new THREE.PMREMGenerator(r);
    const envRT = pm.fromCubemap(cubeRT.texture);
    if (S.env) S.env.dispose();
    S.env = envRT;
    scene.environment = envRT.texture;
    post.envMap = envRT.texture;
    return envRT.texture;
  } catch (e) {
    console.warn('Kit Rush 3D: environment capture failed', e);
    return null;
  } finally {
    if (envFloor && envFloor.parent) envFloor.parent.remove(envFloor);
    if (envDim && envDim.parent) envDim.parent.remove(envDim);
    for (const o of hidden) o.visible = true;
    if (pm) pm.dispose();
    if (cubeRT) cubeRT.dispose();
    r.setRenderTarget(prevRT);
  }
}

// ---------- API ----------
function storedQuality(isTouch) {
  const q = K.store.get('gfx', null);
  return QUALITIES.indexOf(q) >= 0 ? q : isTouch ? 'medium' : 'high';
}
function storedSuperRes(isTouch) {
  const s = K.store.get('superres', null);
  return typeof s === 'boolean' ? s : !!isTouch;
}

post.init = function () {
  if (S.inited) return post.ok;
  S.inited = true;
  const V = K.view;
  if (!V || !V.renderer || !V.scene || !V.camera) { S.why = 'no renderer'; return false; }
  post.quality = storedQuality(V.isTouch);
  post.superRes = storedSuperRes(V.isTouch);
  const scripts = typeof THREE.UnrealBloomPass === 'function' && typeof THREE.FullScreenQuad === 'function' &&
    !!THREE.CopyShader && !!THREE.LuminosityHighPassShader;
  if (!scripts) { S.why = 'example scripts missing: direct rendering'; post.ok = false; return false; }
  const r = V.renderer;
  try {
    S.caps = probe(r);
    S.quad = new THREE.FullScreenQuad(null);
    S.direct = true;
    applyConfig();
    S.active = true;
    post.ok = true;
    V.onResize.push(() => { S.sizeDirty = true; });
  } catch (e) {
    console.warn('Kit Rush 3D: post-processing unavailable, direct rendering', e);
    S.why = 'init failed: ' + (e && e.message);
    try { freeTargets(); freeMaterials(); } catch (e2) { /* already gone */ }
    restoreColors(V.scene);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = LOOK.directExposure;
    post.hdr = false; post.uHDR.value = 0;
    S.active = false; post.ok = false;
  }
  return post.ok;
};

post.render = function (dt) {
  const V = K.view, r = V.renderer, scene = V.scene, cam = V.camera;
  if (!r || !scene || !cam) return;
  if (!S.active) { r.render(scene, cam); return; }
  tick(dt);
  r.getDrawingBufferSize(_sz);
  if (S.sizeDirty || (_sz.x | 0) !== S.ow || (_sz.y | 0) !== S.oh) { S.sizeDirty = false; buildTargets(); }
  S.np = 0;
  syncColors(scene, !S.direct);
  const ac = r.autoClear;
  try {
    if (S.direct) renderDirect(r, scene, cam);
    else {
      cam.updateMatrixWorld();
      updateSun(cam);
      renderHDR(r, scene, cam);
    }
  } finally {
    r.autoClear = ac;
    r.setRenderTarget(null);
  }
  // renderer.info as main and the tests read it: the scene's draws (as before) plus one per post pass
  S.calls = r.info.render.calls = S.sceneCalls + S.np;
  S.tris = r.info.render.triangles = S.sceneTris + S.np;
};

post.setQuality = function (q) {
  if (QUALITIES.indexOf(q) < 0) return post.quality;
  post.quality = q;
  K.store.set('gfx', q);
  if (S.active) applyConfig();
  return q;
};
post.setSuperRes = function (on) {
  post.superRes = !!on;
  K.store.set('superres', post.superRes);
  if (S.active) applyConfig();
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
  if (!S.active) {
    const inf = K.view && K.view.renderer ? K.view.renderer.info.render : null;
    S.calls = S.sceneCalls = inf ? inf.calls : 0; S.tris = S.sceneTris = inf ? inf.triangles : 0;
  }
  return {
    ok: post.ok, quality: post.quality, superRes: post.superRes, hdr: post.hdr, direct: S.direct, why: S.why,
    scale: S.superRes ? S.cfg.sr : 1, internal: [S.iw, S.ih], output: [S.ow, S.oh],
    msaa: S.rtScene && S.rtScene.isWebGLMultisampleRenderTarget ? S.rtScene.samples : 0,
    caps: S.caps ? Object.assign({}, S.caps) : null, passes: S.passes.slice(),
    calls: S.calls, tris: S.tris, sceneCalls: S.sceneCalls, sceneTris: S.sceneTris,
    speed: +S.spd.toFixed(3), cinematic: +S.cine.k.toFixed(3), sunVis: +S.sunVis.toFixed(3), env: !!S.env,
    envMean: +S.envMean.toFixed(3), envScale: +S.envScale.toFixed(3)
  };
};
})();
