(() => {
// ================= util =================
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v > b ? b : v >= a ? v : a); // NaN collapses to the lower bound
const util = K.util = {
  TAU,
  clamp,
  lerp: (a, b, t) => a + (b - a) * t,
  smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); },
  damp: (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt)),
  angleDiff(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
    return d || 0;
  },
  hash(n) { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); },
  rng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  easeOut: t => 1 - Math.pow(1 - clamp(t, 0, 1), 3),
  // Spins a (shared, instanced) geometry about its local Y axis to angle a (radians), in place: positions and normals
  // are rewritten from a copy of the originals (x' = cos a x - sin a z, z' = sin a x + cos a z). r186 applies the
  // instance matrix before a material's positionNode, so a per-instance local spin is done here on the CPU.
  spinY(geo, a) {
    if (!geo || !geo.attributes || !geo.attributes.position || !Number.isFinite(a)) return;
    const P = geo.attributes.position, N = geo.attributes.normal;
    let o = geo.userData.spin0;
    if (!o) o = geo.userData.spin0 = { p: Float32Array.from(P.array), n: N ? Float32Array.from(N.array) : null, a: NaN };
    if (o.a === a) return;
    o.a = a;
    const c = Math.cos(a), s = Math.sin(a), pa = P.array, p0 = o.p;
    for (let i = 0; i < p0.length; i += 3) { const x = p0[i], z = p0[i + 2]; pa[i] = c * x - s * z; pa[i + 2] = s * x + c * z; }
    P.needsUpdate = true;
    if (N && o.n) {
      const na = N.array, n0 = o.n;
      for (let i = 0; i < n0.length; i += 3) { const x = n0[i], z = n0[i + 2]; na[i] = c * x - s * z; na[i + 2] = s * x + c * z; }
      N.needsUpdate = true;
    }
  },
  sign: v => (v < 0 ? -1 : v > 0 ? 1 : 0)
};

// ================= store =================
const store = K.store = {
  get(key, dflt) {
    try { const v = localStorage.getItem('kitrush3d.' + key); return v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; }
  },
  set(key, value) {
    try { localStorage.setItem('kitrush3d.' + key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  }
};

// ================= view =================
const stageEl = document.getElementById('stage');
const gameEl = document.getElementById('game');
const glCv = document.getElementById('gl');
const hudCv = document.getElementById('hud');
const touchUI = document.getElementById('touch');
const rotateHint = document.getElementById('rotate');
const mq = q => { try { return matchMedia(q).matches; } catch (e) { return false; } };

const fatalEl = document.getElementById('fatal');
const view = K.view = {
  renderer: null, scene: null, camera: null,
  W: 640, H: 360, dpr: 1, hudDpr: 1,
  isTouch: false, reduceMotion: false, shadowSize: 2048,
  hud: null, onResize: [], ok: false, lost: false, error: '',
  qualityCap: 2,
  // 'webgpu' | 'webgl2' once init() resolved; forceGL: ?gl in the URL forces the renderer's WebGL 2 backend
  backend: '', forceGL: false, initMs: 0,
  // Creates the three.js r186 WebGPURenderer on #gl (WebGPU when the browser has it, the renderer's own WebGL 2 backend
  // otherwise or with ?gl) and waits for its init. Resolves true when the renderer is ready, false with view.error
  // (French) when no backend could start. Shadows on (PCF), sRGB output, ACES (K.post overrides the tone mapping
  // when its pipeline runs).
  async init() {
    if (this.ok) return true;
    const t0 = performance.now();
    this.isTouch = mq('(pointer: coarse)') || (navigator.maxTouchPoints > 0 && !mq('(pointer: fine)'));
    this.reduceMotion = mq('(prefers-reduced-motion: reduce)');
    this.shadowSize = this.isTouch ? 1024 : 2048;
    this.qualityCap = this.isTouch ? 1.5 : 2;
    this.hud = hudCv.getContext('2d');
    this.fit();
    let q = '';
    try { q = location.search || ''; } catch (e) { /* no location */ }
    this.forceGL = /[?&]gl(=|&|$)/.test(q);
    let r = null;
    const make = forceWebGL => new THREE.WebGPURenderer({ canvas: glCv, antialias: false, powerPreference: 'high-performance', forceWebGL });
    try {
      r = make(this.forceGL);
      await r.init();
    } catch (e) {
      // the WebGPU backend falls back to WebGL 2 by itself when WebGPU is missing; a failure here is a hard one,
      // try WebGL 2 once more explicitly
      console.warn('Kit Rush 3D: renderer init failed', e);
      r = null;
      if (!this.forceGL) {
        try { r = make(true); await r.init(); } catch (e2) { console.warn('Kit Rush 3D: WebGL 2 init failed', e2); r = null; }
      }
    }
    if (!r || !r.backend) {
      this.error = 'Ni WebGPU ni WebGL 2 ne sont disponibles sur cet appareil.';
      return false;
    }
    this.backend = r.backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.setClearColor(0x9fd8ff, 1);
    // GPU device / WebGL context lost: stop drawing and say so (the renderer cannot be restored in place)
    r.onDeviceLost = info => {
      view.lost = true;
      console.warn('Kit Rush 3D: GPU device lost', info && info.message);
      view.showFatal('Le rendu 3D s’est interrompu (carte graphique réinitialisée). Recharge la page pour reprendre.');
    };
    this.renderer = r;
    // draw-call accounting: three r186 only resets renderer.info inside its own animation loop, the game drives frames
    // itself. beginFrame() resets it, renders of the game scene (scene pass, shadow maps) are summed separately from
    // the post passes; endFrame() publishes view.stats {calls, tris, sceneCalls, sceneTris} (tests and budgets read it).
    const rawRender = r.render.bind(r), inf = r.info.render, st = this.stats;
    let depth = 0; // shadow maps render the scene again from inside its own render: count the outermost call only
    r.render = function (scene, camera) {
      if (scene !== view.scene || depth > 0) return rawRender(scene, camera);
      const c0 = inf.drawCalls, t0 = inf.triangles;
      depth++;
      try { return rawRender(scene, camera); } finally {
        depth--;
        st.sceneCalls += inf.drawCalls - c0; st.sceneTris += inf.triangles - t0;
      }
    };
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 900);
    this.camera.position.set(0, 4, 8);
    this._v = new THREE.Vector3();
    this.ok = true;
    this.fit();
    this.initMs = Math.round(performance.now() - t0);
    return true;
  },
  stats: { calls: 0, tris: 0, sceneCalls: 0, sceneTris: 0, frames: 0 },
  beginFrame() {
    const r = this.renderer; if (!r) return;
    r.info.reset();
    this.stats.sceneCalls = 0; this.stats.sceneTris = 0;
  },
  endFrame() {
    const r = this.renderer; if (!r) return;
    const inf = r.info.render, st = this.stats;
    st.calls = inf.drawCalls; st.tris = inf.triangles; st.frames++;
  },
  // French error overlay (DOM, so it can link to the classic version in legacy/)
  showFatal(msg) {
    if (msg) this.error = msg;
    if (typeof window.__kitFail === 'function') window.__kitFail(msg);
    else if (fatalEl) fatalEl.hidden = false;
  },
  // Lays out the game area, sizes both canvases and notifies listeners.
  fit() {
    const sw = stageEl.clientWidth, sh = stageEl.clientHeight;
    if (!(sw > 0 && sh > 0)) return;
    const ar = clamp(sw / sh, 4 / 3, 2.4);
    let w = sw, h = sw / ar;
    if (h > sh) { h = sh; w = sh * ar; }
    const W = Math.max(1, Math.floor(w)), H = Math.max(1, Math.floor(h));
    this.W = W; this.H = H;
    gameEl.style.width = W + 'px';
    gameEl.style.height = H + 'px';
    const base = window.devicePixelRatio || 1;
    const maxPix = this.isTouch ? 1.45e6 : 3.7e6;
    let dpr = Math.min(base, this.qualityCap);
    if (W * H * dpr * dpr > maxPix) dpr = Math.sqrt(maxPix / (W * H));
    dpr = Math.max(0.75, Math.round(dpr * 100) / 100);
    this.dpr = dpr;
    if (this.renderer) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(W, H, false);
      this.camera.aspect = W / H;
      this.camera.updateProjectionMatrix();
    }
    const hd = Math.min(base, 2);
    this.hudDpr = hd;
    const pw = Math.round(W * hd), ph = Math.round(H * hd);
    if (hudCv.width !== pw || hudCv.height !== ph) { hudCv.width = pw; hudCv.height = ph; }
    if (this.hud) this.hud.setTransform(hd, 0, 0, hd, 0, 0);
    rotateHint.hidden = !(!touchUI.hidden && window.innerHeight > window.innerWidth);
    for (const cb of this.onResize) { try { cb(W, H); } catch (e) { console.error(e); } }
  },
  resize() { this.fit(); },
  // Adaptive quality: a 2 s window averaging more than 24 ms per frame lowers the pixel ratio by 0.25 (never below
  // 0.75, or 1 on a 2x screen). A browser that caps the frame rate itself (Energy Saver, Low Power Mode: a steady
  // 30 or 20 Hz while the frame's own work is far under budget) is not a reason to blur the game. Sustained fast
  // windows raise it back, each drop making the next raise wait longer.
  _acc: 0, _acc2: 0, _n: 0, _win: 0, _work: 0, _warm: 3000, _fast: 0, _need: 3,
  adapt(ms, work) {
    if (!this.renderer || !(ms > 0) || ms > 250 || document.hidden) return;
    if (this._warm > 0) { this._warm -= ms; return; }
    this._acc += ms; this._acc2 += ms * ms; this._n++; this._win += ms; this._work += work > 0 && work < 250 ? work : 0;
    if (this._win < 2000) return;
    const n = Math.max(1, this._n), avg = this._acc / n, sd = Math.sqrt(Math.max(0, this._acc2 / n - avg * avg)), wk = this._work / n;
    this._acc = this._acc2 = this._n = this._win = this._work = 0;
    const capped = sd < 2.5 && wk < avg * 0.45 && (Math.abs(avg - 1000 / 30) < 2 || Math.abs(avg - 50) < 2.5);
    const base = window.devicePixelRatio || 1, floor = base >= 2 ? 1 : 0.75, top = Math.min(base, this.isTouch ? 1.5 : 2);
    if (avg > 24 && !capped && this.dpr > floor + 1e-3) {
      this.qualityCap = Math.max(floor, this.dpr - 0.25);
      this._fast = 0; this._need = Math.min(15, this._need + 3);
      this._warm = 1000;
      this.fit();
    } else if (avg < 19 && this.qualityCap < top - 1e-3) {
      if (++this._fast >= this._need) {
        this._fast = 0;
        this.qualityCap = Math.min(top, this.qualityCap + 0.25);
        this._warm = 1000;
        this.fit();
      }
    } else this._fast = 0;
  },
  // Projects a world point to game-area CSS pixels. out = {x, y, front, visible}.
  toScreen(p, out) {
    out = out || {};
    const cam = this.camera;
    if (!cam || !p) { out.x = out.y = 0; out.front = out.visible = false; return out; }
    const v = this._v.copy(p).applyMatrix4(cam.matrixWorldInverse);
    out.front = v.z < -cam.near;
    v.copy(p).project(cam);
    out.x = (v.x * 0.5 + 0.5) * this.W;
    out.y = (0.5 - v.y * 0.5) * this.H;
    out.visible = out.front && Number.isFinite(out.x) && Number.isFinite(out.y) && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15;
    return out;
  }
};
let fitQueued = 0;
const queueFit = () => { if (fitQueued) return; fitQueued = requestAnimationFrame(() => { fitQueued = 0; view.fit(); }); };
addEventListener('resize', queueFit);
addEventListener('orientationchange', () => setTimeout(() => view.fit(), 120));
document.addEventListener('fullscreenchange', () => setTimeout(() => view.fit(), 60));
document.addEventListener('webkitfullscreenchange', () => setTimeout(() => view.fit(), 60));
if (window.visualViewport) visualViewport.addEventListener('resize', queueFit);
if (window.ResizeObserver) { try { new ResizeObserver(queueFit).observe(stageEl); } catch (e) { /* older browsers: window resize covers it */ } }

// ================= TSL helpers =================
// Small shader functions shared by the node materials of every part (each is emitted once per shader thanks to its
// layout). p: vec2 unless noted. hash21 -> 0..1, vnoise -> 0..1 value noise (smooth), fbm -> 0..1 (4 octaves),
// fw(p) -> pixel footprint max(|dFdx|, |dFdy|) (call it outside If/select branches: WGSL needs uniform control flow
// for derivatives), checker(p, w) -> 0..1 box-filtered checkerboard (w = footprint, e.g. fw(p)).
{
  const { Fn, vec2, vec3, float, fract, floor, dot, mix, abs, max, dFdx, dFdy } = TSL;
  const hash21 = Fn(([p]) => {
    const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
  }).setLayout({ name: 'kHash21', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });
  const vnoise = Fn(([p]) => {
    const i = floor(p).toVar(), f = fract(p).toVar();
    const u = f.mul(f).mul(f.mul(-2).add(3)).toVar();
    const a = hash21(i), b = hash21(i.add(vec2(1, 0))), c = hash21(i.add(vec2(0, 1))), d = hash21(i.add(vec2(1, 1)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }).setLayout({ name: 'kNoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });
  const fbm = Fn(([p]) => {
    const n = vnoise(p).mul(0.5).toVar();
    n.addAssign(vnoise(p.mul(2.03).add(17.1)).mul(0.25));
    n.addAssign(vnoise(p.mul(4.01).add(31.7)).mul(0.125));
    n.addAssign(vnoise(p.mul(7.97).add(5.3)).mul(0.0625));
    return n.div(0.9375);
  }).setLayout({ name: 'kFbm', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });
  const checker = Fn(([p, w0]) => {
    const w = w0.add(1e-4).toVar();
    const i = abs(fract(p.sub(w.mul(0.5)).mul(0.5)).sub(0.5)).sub(abs(fract(p.add(w.mul(0.5)).mul(0.5)).sub(0.5))).mul(2).div(w);
    return float(0.5).sub(i.x.mul(i.y).mul(0.5));
  }).setLayout({ name: 'kChecker', type: 'float', inputs: [{ name: 'p', type: 'vec2' }, { name: 'w', type: 'vec2' }] });
  const fw = p => max(abs(dFdx(p)), abs(dFdy(p)));
  K.tsl = { hash21, vnoise, fbm, checker, fw };
}

// ================= audio =================
const A = { ctx: null, out: null, music: null, sfx: null, fxSend: null, muted: !!store.get('muted', false), noise: null, timer: 0 };
const lastSfx = Object.create(null);
function audioInit() {
  if (A.ctx) { if (A.ctx.state === 'suspended' && !document.hidden) A.ctx.resume().catch(() => {}); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  try { A.ctx = new AC(); } catch (e) { return; }
  const c = A.ctx;
  A.out = c.createGain(); A.out.gain.value = A.muted ? 0 : 0.85;
  const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
  A.out.connect(comp); comp.connect(c.destination);
  // stereo echo used by the lead and arpeggio for a bigger sound
  const dl = c.createDelay(1), dr = c.createDelay(1), fb = c.createGain(), wet = c.createGain(), lp = c.createBiquadFilter();
  dl.delayTime.value = 0.3; dr.delayTime.value = 0.45; fb.gain.value = 0.28; wet.gain.value = 0.32; lp.type = 'lowpass'; lp.frequency.value = 3200;
  A.fxSend = c.createGain(); A.fxSend.connect(lp); lp.connect(dl); lp.connect(dr); dl.connect(fb); fb.connect(dl);
  const merger = c.createChannelMerger(2); dl.connect(merger, 0, 0); dr.connect(merger, 0, 1); merger.connect(wet);
  A.music = c.createGain(); A.music.gain.value = 0.6; A.music.connect(A.out); wet.connect(A.music);
  A.sfx = c.createGain(); A.sfx.gain.value = 0.7; A.sfx.connect(A.out);
  const len = c.sampleRate; const buf = c.createBuffer(1, len, c.sampleRate); const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  A.noise = buf;
  A.timer = setInterval(musicTick, 25);
  if (Music.want) { const w = Music.want; Music.name = null; playMusic(w); }
}
const sndWave = document.getElementById('snd-wave'), sndOff = document.getElementById('snd-off'), btnSound = document.getElementById('btnSound');
function updateSoundBtn() {
  if (!btnSound) return;
  sndWave.style.display = A.muted ? 'none' : ''; sndOff.style.display = A.muted ? '' : 'none';
  btnSound.setAttribute('aria-label', A.muted ? 'Activer le son' : 'Couper le son');
}
function toggleSound() {
  A.muted = !A.muted; store.set('muted', A.muted);
  if (A.out) A.out.gain.setTargetAtTime(A.muted ? 0 : 0.85, A.ctx.currentTime, 0.03);
  updateSoundBtn();
}
updateSoundBtn();
document.addEventListener('visibilitychange', () => {
  if (!A.ctx) return;
  if (document.hidden) { if (A.ctx.state === 'running') A.ctx.suspend().catch(() => {}); }
  else if (A.ctx.state === 'suspended') A.ctx.resume().catch(() => {});
});
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
function tone(type, f0, f1, dur, vol, t0, lp) {
  const c = A.ctx; const t = t0 == null ? c.currentTime : t0;
  const o = c.createOscillator(), g = c.createGain(); o.type = type;
  o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let n = o; if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); n = f; }
  n.connect(g); g.connect(A.sfx); o.start(t); o.stop(t + dur + 0.03);
}
function noise(dur, vol, ftype, f0, f1, t0, dest) {
  const c = A.ctx; const t = t0 == null ? c.currentTime : t0;
  const s = c.createBufferSource(); s.buffer = A.noise;
  const f = c.createBiquadFilter(); f.type = ftype; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(dest || A.sfx); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.03);
}
const SFX = {
  jump() { tone('square', 260, 760, 0.16, 0.14, null, 3000); },
  ring() { const t = A.ctx.currentTime; tone('square', 1318, 1318, 0.08, 0.09, t, 5000); tone('square', 1976, 1976, 0.32, 0.09, t + 0.07, 5000); tone('sine', 3951, 3951, 0.3, 0.04, t + 0.07); },
  spin(l) { l = clamp(+l || 0, 0, 8); tone('sawtooth', 220 + l * 45, 900 + l * 110, 0.25, 0.11, null, 2600); noise(0.2, 0.12, 'bandpass', 1400, 4200); },
  release() { noise(0.35, 0.3, 'bandpass', 700, 3200); tone('square', 160, 980, 0.22, 0.12, null, 2600); },
  roll() { noise(0.2, 0.16, 'bandpass', 500, 2600); },
  skid() { noise(0.18, 0.18, 'highpass', 2400); },
  hurt() { tone('square', 640, 120, 0.38, 0.16, null, 2400); },
  lose() { noise(0.45, 0.2, 'highpass', 3200); const t = A.ctx.currentTime; for (let i = 0; i < 6; i++) tone('square', 1500 + i * 260, 1400 + i * 240, 0.1, 0.05, t + i * 0.045, 5000); },
  pop() { noise(0.38, 0.4, 'lowpass', 2400, 120); tone('square', 240, 55, 0.26, 0.13, null, 1500); },
  spring() { tone('square', 300, 1200, 0.24, 0.12, null, 3000); tone('triangle', 620, 1700, 0.24, 0.12); },
  monitor() { noise(0.3, 0.35, 'lowpass', 3200, 200); },
  check() { const t = A.ctx.currentTime; tone('square', 1175, 1175, 0.12, 0.09, t, 4000); tone('square', 1568, 1568, 0.3, 0.09, t + 0.1, 4000); },
  bosshit() { tone('square', 150, 48, 0.32, 0.22, null, 1800); noise(0.28, 0.3, 'lowpass', 1600, 100); },
  boom() { noise(0.7, 0.45, 'lowpass', 2000, 60); tone('sine', 90, 35, 0.5, 0.25); },
  item() { const t = A.ctx.currentTime; [72, 76, 79, 84].forEach((m, i) => tone('square', mtof(m), mtof(m), 0.14, 0.08, t + i * 0.06, 4000)); },
  oneup() { const t = A.ctx.currentTime; [67, 72, 76, 72, 76, 79, 84].forEach((m, i) => tone('square', mtof(m), mtof(m), 0.16, 0.09, t + i * 0.09, 4000)); },
  die() { tone('square', 820, 90, 0.7, 0.16, null, 2400); },
  tick() { tone('square', 1760, 1760, 0.04, 0.05, null, 5000); },
  button() { tone('square', 520, 200, 0.12, 0.14, null, 2000); },
  bounce() { tone('triangle', 400, 900, 0.12, 0.12); },
  // 3D additions: homing attack whoosh and dash-panel zip
  homing() { noise(0.24, 0.3, 'bandpass', 520, 4600); tone('sawtooth', 300, 1500, 0.2, 0.08, null, 2800); tone('sine', 900, 2400, 0.16, 0.05); },
  dash() { const t = A.ctx.currentTime; tone('square', 420, 1680, 0.12, 0.1, t, 3600); tone('square', 840, 2600, 0.15, 0.07, t + 0.06, 4200); noise(0.22, 0.18, 'highpass', 1800, 7000); }
};
function sfx(name, arg) {
  if (!A.ctx || A.muted || A.ctx.state !== 'running') return;
  const f = SFX[name]; if (!f) return;
  const now = A.ctx.currentTime;
  if (lastSfx[name] != null && now - lastSfx[name] < 0.03 && now >= lastSfx[name]) return; // same sound twice in one tick
  lastSfx[name] = now;
  try { f(arg); } catch (e) { /* a failed voice must never break the game */ }
}

// ================= music =================
// Original compositions, sequenced live with Web Audio (16th-note grid).
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function nm(s) { const m = s.match(/^([A-G])(#?)(\d)$/); return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] ? 1 : 0); }
function parse(str) { const ev = []; let st = 0; for (const tok of str.trim().split(/\s+/)) { const [n, l] = tok.split('-'); if (n !== 'r') ev.push([st, nm(n), +l]); st += +l; } return { ev, len: st }; }
const CH = {
  F: [65, 69, 72, 76], Em: [64, 67, 71, 74], Dm: [62, 65, 69, 72], G: [62, 67, 71, 74], C: [60, 64, 67, 72], Am: [57, 60, 64, 67],
  Am2: [57, 60, 64, 69], Fb: [53, 57, 60, 65], E: [56, 59, 64, 68]
};
function makeTrack(o) {
  const lead = parse(o.lead), len = lead.len, steps = Array.from({ length: len }, () => []);
  for (const [s, m, l] of lead.ev) steps[s].push(['lead', m, l]);
  if (o.harm) { const h = parse(o.harm); for (const [s, m, l] of h.ev) steps[s].push(['harm', m, l]); }
  const halves = len / 8;
  let lastChord = null, lastAt = 0;
  for (let h = 0; h < halves; h++) {
    const root = nm(o.bass[h]), base = h * 8;
    for (const [off, iv, d] of o.bassPat) steps[base + off].push(['bass', root + iv, d]);
    const ch = CH[o.chords[h]];
    if (o.chords[h] !== lastChord) {
      if (lastChord) steps[lastAt].push(['pad', CH[lastChord], base - lastAt]);
      lastChord = o.chords[h]; lastAt = base;
    }
    if (o.arp) for (let i = 0; i < 8; i++) { const ord = [0, 2, 1, 3, 2, 1, 3, 2]; steps[base + i].push(['arp', ch[ord[i]] + 12, 1]); }
  }
  steps[lastAt].push(['pad', CH[lastChord], len - lastAt]);
  for (let s = 0; s < len; s++) { const bar = s >> 4, b = s & 15; for (const d of o.drums(bar, b, len >> 4)) steps[s].push([d, 0, 1]); }
  return { bpm: o.bpm, loop: o.loop, len, steps };
}
const TRACKS = {
  main: makeTrack({ bpm: 150, loop: true, arp: true,
    lead:
      'E5-2 G5-2 A5-3 G5-1 E5-2 C5-2 D5-2 E5-2  r-2 G5-1 r-1 G5-2 B5-2 A5-3 G5-1 E5-4 ' +
      'F5-2 A5-2 C6-3 A5-1 G5-2 F5-2 E5-2 D5-2  D5-3 E5-1 F5-2 G5-6 r-4 ' +
      'E5-2 G5-2 A5-3 G5-1 E5-2 C6-2 B5-2 A5-2  G5-3 E5-1 G5-2 B5-2 D6-4 B5-2 G5-2 ' +
      'A5-2 C6-2 D6-2 C6-2 B5-2 A5-2 B5-2 D6-2  C6-8 r-2 G5-1 A5-1 B5-2 C6-2 ' +
      'A5-4 C6-2 E6-2 D6-3 C6-1 B5-2 A5-2  C6-6 A5-2 G5-2 A5-2 C6-4 ' +
      'G5-3 E5-1 G5-2 C6-2 E6-4 D6-2 C6-2  D6-8 r-2 B5-2 C6-2 D6-2 ' +
      'E6-4 D6-2 C6-2 D6-3 E6-1 G6-2 E6-2  F6-6 E6-2 C6-2 A5-2 C6-4 ' +
      'D6-3 C6-1 A5-2 F5-2 G5-3 A5-1 B5-2 D6-2  G5-6 r-2 F5-2 E5-2 D5-2 B4-2',
    harm:
      'C5-4 E5-4 C5-4 G4-4  r-4 E5-4 D5-4 B4-4  A4-4 C5-4 C5-4 A4-4  B4-4 B4-4 D5-8 ' +
      'C5-4 E5-4 E5-4 E5-4  E5-4 G5-4 G5-4 E5-4  F5-4 F5-4 G5-4 G5-4  E5-8 r-8 ' +
      'E5-8 G5-8  A5-8 F5-8  E5-8 G5-8  B5-8 G5-8 ' +
      'C6-8 B5-8  C6-8 A5-8  A5-8 D5-8  D5-8 r-8',
    bass: ['F2', 'F2', 'E2', 'E2', 'D2', 'D2', 'G2', 'G2', 'F2', 'F2', 'E2', 'E2', 'D2', 'G2', 'C2', 'C2',
           'A2', 'A2', 'F2', 'F2', 'C2', 'C2', 'G2', 'G2', 'A2', 'A2', 'F2', 'F2', 'D2', 'D2', 'G2', 'G2'],
    chords: ['F', 'F', 'Em', 'Em', 'Dm', 'Dm', 'G', 'G', 'F', 'F', 'Em', 'Em', 'Dm', 'G', 'C', 'C',
             'Am', 'Am', 'F', 'F', 'C', 'C', 'G', 'G', 'Am', 'Am', 'F', 'F', 'Dm', 'Dm', 'G', 'G'],
    bassPat: [[0, 12, 2], [2, 24, 1], [3, 12, 1], [4, 24, 1], [6, 12, 1], [7, 19, 1]],
    drums: (bar, b, n) => { const d = [];
      if (b === 0 || b === 7 || b === 8) d.push('kick');
      if (b === 4 || b === 12) d.push('snare');
      if ((bar === 7 || bar === 15) && b >= 13) d.push('snare');
      if (b % 2 === 0 && b !== 14) d.push('hat'); if (b === 14) d.push('ohat');
      if (b === 0 && (bar === 0 || bar === 8)) d.push('crash');
      return d; }
  }),
  boss: makeTrack({ bpm: 168, loop: true, arp: true,
    lead:
      'A5-1 r-1 A5-1 r-1 C6-2 B5-2 A5-2 E5-2 G5-2 F5-2  A5-1 r-1 A5-1 r-1 C6-2 D6-2 E6-4 D6-2 C6-2 ' +
      'F5-2 A5-2 C6-2 A5-2 F6-4 E6-2 C6-2  E5-2 G#5-2 B5-2 E6-2 D6-2 B5-2 G#5-2 E5-2 ' +
      'A5-1 r-1 A5-1 r-1 C6-2 B5-2 A5-2 E5-2 G5-2 F5-2  A5-1 r-1 A5-1 r-1 E6-2 F6-2 G6-4 F6-2 E6-2 ' +
      'F6-2 E6-2 C6-2 A5-2 C6-4 F6-4  E5-2 F5-2 G#5-2 A5-2 B5-2 C6-2 D6-2 E6-2',
    bass: ['A1', 'A1', 'A1', 'A1', 'F1', 'F1', 'E1', 'E1', 'A1', 'A1', 'A1', 'A1', 'F1', 'F1', 'E1', 'E1'],
    chords: ['Am', 'Am', 'Am2', 'Am2', 'Fb', 'Fb', 'E', 'E', 'Am', 'Am', 'Am2', 'Am2', 'Fb', 'Fb', 'E', 'E'],
    bassPat: [[0, 12, 1], [1, 12, 1], [2, 24, 1], [3, 12, 1], [4, 12, 1], [5, 24, 1], [6, 12, 1], [7, 19, 1]],
    drums: (bar, b) => { const d = [];
      if (b % 4 === 0) d.push('kick');
      if (b === 4 || b === 12) d.push('snare');
      if (bar % 4 === 3 && b >= 12) d.push('snare');
      d.push('hat');
      if (b === 0 && bar % 4 === 0) d.push('crash');
      return d; }
  }),
  clear: makeTrack({ bpm: 140, loop: false,
    lead: 'C5-2 E5-2 G5-2 C6-4 B5-2 C6-2 D6-2 E6-8 r-8',
    harm: 'G4-2 C5-2 E5-2 G5-4 G5-2 G5-2 B5-2 C6-8 r-8',
    bass: ['C2', 'C2', 'G2', 'G2', 'C2', 'C2'],
    chords: ['C', 'C', 'G', 'G', 'C', 'C'],
    bassPat: [[0, 12, 2], [4, 24, 2]],
    drums: (bar, b) => { const d = []; if (b % 4 === 0 && !(bar === 2 && b > 4)) d.push('kick'); if (b === 0) d.push('crash'); if (b % 2 === 0 && bar < 2) d.push('hat'); return d; }
  }),
  over: makeTrack({ bpm: 96, loop: false,
    lead: 'C5-4 B4-4 A#4-4 A4-12 r-8',
    bass: ['C2', 'C2', 'G1', 'G1', 'F1', 'F1', 'F1', 'F1'],
    chords: ['C', 'C', 'Em', 'Em', 'Fb', 'Fb', 'Fb', 'Fb'],
    bassPat: [[0, 12, 8]],
    drums: () => []
  })
};
const Music = { cur: null, name: null, want: null, step: 0, next: 0, speed: 1 };
function playMusic(name) {
  if (!TRACKS[name]) return;
  Music.want = name;
  if (!A.ctx) return;
  if (Music.name === name && Music.cur) return;
  Music.name = name; Music.cur = TRACKS[name]; Music.step = 0; Music.next = A.ctx.currentTime + 0.08;
}
function stopMusic() { Music.want = null; Music.name = null; Music.cur = null; }
function musicTick() {
  if (!A.ctx || !Music.cur || A.ctx.state !== 'running') return;
  const now = A.ctx.currentTime;
  if (Music.next < now - 0.25) Music.next = now + 0.05;
  try {
    while (Music.cur && Music.next < now + 0.15) {
      const tr = Music.cur, sd = 60 / tr.bpm / 4 / Music.speed;
      for (const e of tr.steps[Music.step]) voice(e[0], e[1], Music.next, e[2] * sd);
      Music.next += sd; Music.step++;
      if (Music.step >= tr.len) { if (tr.loop) Music.step = 0; else { Music.cur = null; Music.name = null; Music.want = null; } }
    }
  } catch (e) { stopMusic(); }
}
function env(g, t, vol, att, dur, rel) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + att);
  g.gain.setValueAtTime(vol, t + Math.max(att, dur - rel));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + rel);
}
function voice(ch, m, t, dur) {
  const c = A.ctx;
  if (ch === 'lead' || ch === 'harm') {
    const lead = ch === 'lead', f = mtof(m), g = c.createGain(), lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = lead ? 3600 : 2200; lp.Q.value = 1.2;
    const types = lead ? ['square', 'sawtooth'] : ['triangle', 'square'], det = [-6, 7];
    const vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = 5.6; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(dur > 0.3 ? f * 0.006 : 0, t + 0.25); vib.connect(vg);
    types.forEach((ty, i) => { const o = c.createOscillator(); o.type = ty; o.frequency.value = f; o.detune.value = det[i]; vg.connect(o.frequency); o.connect(lp); o.start(t); o.stop(t + dur + 0.12); });
    vib.start(t); vib.stop(t + dur + 0.12);
    lp.connect(g); env(g, t, lead ? 0.06 : 0.03, 0.012, dur * 0.92, 0.08);
    g.connect(A.music); if (lead) { const s = c.createGain(); s.gain.value = 0.5; g.connect(s); s.connect(A.fxSend); }
  } else if (ch === 'bass') {
    const o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = mtof(m); lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(420, t + 0.12);
    o.connect(lp); lp.connect(g); env(g, t, 0.15, 0.005, dur * 0.9, 0.04); g.connect(A.music); o.start(t); o.stop(t + dur + 0.08);
  } else if (ch === 'arp') {
    const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = 'square'; o.frequency.value = mtof(m); lp.type = 'lowpass'; lp.frequency.value = 2800;
    o.connect(lp); lp.connect(g); env(g, t, 0.018, 0.004, Math.min(dur, 0.07), 0.05); g.connect(A.music); g.connect(A.fxSend); o.start(t); o.stop(t + dur + 0.12);
  } else if (ch === 'pad') {
    for (const n of m) { for (const d of [-8, 8]) {
      const o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = mtof(n); o.detune.value = d;
      o.connect(g); env(g, t, 0.012, 0.25, dur, 0.3); g.connect(A.music); o.start(t); o.stop(t + dur + 0.35);
    } }
  } else if (ch === 'kick') {
    const o = c.createOscillator(), g = c.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.connect(g); g.connect(A.music); o.start(t); o.stop(t + 0.22);
  } else if (ch === 'snare') {
    noise(0.15, 0.2, 'bandpass', 1900, null, t, A.music);
    const o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1); o.connect(g); g.connect(A.music); o.start(t); o.stop(t + 0.12);
  } else if (ch === 'hat') { noise(0.035, 0.05, 'highpass', 7800, null, t, A.music); }
  else if (ch === 'ohat') { noise(0.2, 0.045, 'highpass', 7000, null, t, A.music); }
  else if (ch === 'crash') { noise(1.1, 0.08, 'highpass', 4800, null, t, A.music); }
}

K.audio = {
  init: audioInit,
  sfx,
  playMusic,
  stopMusic,
  setSpeed(f) { Music.speed = clamp(+f || 1, 0.5, 2); },
  toggleMute: toggleSound,
  get muted() { return A.muted; },
  get running() { return !!(A.ctx && A.ctx.state === 'running'); },
  get track() { return Music.name || Music.want; }
};

// ================= input =================
const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Space: 'jump', KeyJ: 'jump', KeyK: 'jump',
  ShiftLeft: 'action', ShiftRight: 'action', KeyC: 'action', KeyX: 'action',
  KeyQ: 'camL', KeyE: 'camR',
  Enter: 'start', NumpadEnter: 'start', Escape: 'pause', KeyP: 'pause'
};
const STEP = 1 / 60;
const KEY_LOOK = 2.4, PAD_LOOK_X = 3.0, PAD_LOOK_Y = 1.8; // rad/s
const MOUSE_X = 0.0058, MOUSE_Y = 0.0042, TOUCH_X = 0.0085, TOUCH_Y = 0.006; // rad/px
const BTN = ['jump', 'action', 'start', 'pause', 'tap'];
const down = Object.create(null);
const latch = { jump: false, action: false, start: false, pause: false };
const real = { jump: false, action: false, start: false, pause: false, tap: false };
const prev = { jump: false, action: false, start: false, pause: false, tap: false };
const held = { jump: false, action: false, start: false, pause: false };
const move = { x: 0, y: 0 }, look = { x: 0, y: 0 };
const tap = { x: 0, y: 0 };
const tch = { x: 0, y: 0, jump: false, action: false, jumpLatch: false, actionLatch: false };
let lookAccX = 0, lookAccY = 0, tapLatch = false, blocked = false;
let touchShown = false, padOK = true, padConnected = false, lastDevice = 'kb';
let labels = null;

function gestureAudio() { if (K.audio) K.audio.init(); }
function showTouch() {
  if (touchShown) return;
  touchShown = true; touchUI.hidden = false; lastDevice = 'touch';
  view.fit();
}
function setTap(e) {
  const r = hudCv.getBoundingClientRect();
  tap.x = e.clientX - r.left; tap.y = e.clientY - r.top;
  tapLatch = true;
}

addEventListener('keydown', e => {
  gestureAudio();
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'KeyM' || e.key === 'm' || e.key === 'M') { e.preventDefault(); if (!e.repeat) toggleSound(); return; }
  const a = KEYMAP[e.code]; if (!a) return;
  e.preventDefault();
  lastDevice = 'kb';
  if (!down[e.code] && latch[a] === false) latch[a] = true;
  down[e.code] = true;
});
addEventListener('keyup', e => { if (KEYMAP[e.code]) { down[e.code] = false; e.preventDefault(); } });
const releaseAll = () => {
  for (const k in down) down[k] = false;
  tch.x = tch.y = 0; tch.jump = tch.action = false;
  lookAccX = lookAccY = 0;
};
addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
addEventListener('pointerup', gestureAudio);
addEventListener('touchend', gestureAudio, { passive: true });
addEventListener('touchstart', showTouch, { passive: true });
if (mq('(pointer: coarse)')) { touchShown = true; touchUI.hidden = false; lastDevice = 'touch'; }

// mouse: drag on the game canvas to orbit the camera, click = tap
let mouseId = null, mx = 0, my = 0;
hudCv.addEventListener('pointerdown', e => {
  gestureAudio();
  if (e.pointerType !== 'mouse') return;
  try { hudCv.focus({ preventScroll: true }); } catch (_) { /* old browsers */ }
  if (e.button === 0) setTap(e);
  if (e.button === 0 || e.button === 2) {
    mouseId = e.pointerId; mx = e.clientX; my = e.clientY;
    try { hudCv.setPointerCapture(e.pointerId); } catch (_) { /* capture is optional */ }
    hudCv.classList.add('dragging');
  }
  if (lastDevice === 'touch' && !touchShown) lastDevice = 'kb';
});
hudCv.addEventListener('pointermove', e => {
  if (e.pointerId !== mouseId) return;
  const dx = e.clientX - mx, dy = e.clientY - my; mx = e.clientX; my = e.clientY;
  lookAccX += dx * MOUSE_X; lookAccY -= dy * MOUSE_Y;
});
const mouseEnd = e => { if (e.pointerId === mouseId) { mouseId = null; hudCv.classList.remove('dragging'); } };
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) hudCv.addEventListener(ev, mouseEnd);
addEventListener('contextmenu', e => { if (e.target === hudCv || stageEl.contains(e.target) || touchUI.contains(e.target)) e.preventDefault(); });

// touch: drag anywhere outside the controls to orbit, tap = menus
let orbitId = null, ox = 0, oy = 0;
const isControl = el => !!(el && el.closest && el.closest('#stick,.tbtn,.tools'));
addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') return;
  showTouch(); lastDevice = 'touch';
  if (isControl(e.target)) return;
  setTap(e);
  if (orbitId === null) { orbitId = e.pointerId; ox = e.clientX; oy = e.clientY; }
}, { passive: true });
addEventListener('pointermove', e => {
  if (e.pointerId !== orbitId) return;
  const dx = e.clientX - ox, dy = e.clientY - oy; ox = e.clientX; oy = e.clientY;
  lookAccX += dx * TOUCH_X; lookAccY -= dy * TOUCH_Y;
}, { passive: true });
const orbitEnd = e => { if (e.pointerId === orbitId) orbitId = null; };
addEventListener('pointerup', orbitEnd); addEventListener('pointercancel', orbitEnd);

// analog joystick
const stickEl = document.getElementById('stick'), knob = stickEl.querySelector('.knob');
let stickId = null;
function stickSet(e) {
  const r = stickEl.getBoundingClientRect();
  const rad = Math.max(1, r.width * 0.5);
  let dx = e.clientX - (r.left + rad), dy = e.clientY - (r.top + rad);
  const d = Math.hypot(dx, dy), lim = rad * 0.62;
  const k = d > lim ? lim / d : 1;
  knob.style.transform = `translate(${(dx * k).toFixed(1)}px,${(dy * k).toFixed(1)}px)`;
  let nx = dx / lim, ny = -dy / lim;
  const m = Math.hypot(nx, ny), dz = 0.12;
  if (m < dz) { nx = ny = 0; }
  else { const s = Math.min(1, (m - dz) / (1 - dz)) / m; nx *= s; ny *= s; }
  tch.x = nx || 0; tch.y = ny || 0;
}
function stickEnd() { stickId = null; tch.x = tch.y = 0; knob.style.transform = ''; stickEl.classList.remove('on'); }
stickEl.addEventListener('pointerdown', e => {
  stickId = e.pointerId; stickEl.classList.add('on');
  try { stickEl.setPointerCapture(e.pointerId); } catch (_) { /* optional */ }
  stickSet(e); gestureAudio(); e.preventDefault();
});
stickEl.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickSet(e); });
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) stickEl.addEventListener(ev, e => { if (e.pointerId === stickId) stickEnd(); });

function touchButton(id, key) {
  const el = document.getElementById(id); let pid = null;
  el.addEventListener('pointerdown', e => {
    pid = e.pointerId; tch[key] = true; tch[key + 'Latch'] = true; el.classList.add('on');
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* optional */ }
    gestureAudio(); e.preventDefault();
  });
  const end = e => { if (e.pointerId !== pid) return; pid = null; tch[key] = false; el.classList.remove('on'); };
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, end);
  el.addEventListener('click', e => e.preventDefault());
}
touchButton('btnJump', 'jump');
touchButton('btnRoll', 'action');

addEventListener('gamepadconnected', () => { padConnected = true; });
addEventListener('gamepaddisconnected', () => { padConnected = false; });

// physical key labels, so hints read ZQSD / A E on AZERTY keyboards
function guessLabels() {
  const lang = (navigator.language || '').toLowerCase();
  const azerty = /^fr(-fr|-be|-lu|-mc)?$/.test(lang);
  return azerty ? { KeyW: 'Z', KeyA: 'Q', KeyS: 'S', KeyD: 'D', KeyQ: 'A', KeyE: 'E' } : { KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D', KeyQ: 'Q', KeyE: 'E' };
}
labels = guessLabels();
try {
  if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
    navigator.keyboard.getLayoutMap().then(map => {
      for (const code of Object.keys(labels)) { const v = map.get(code); if (v && v.length === 1) labels[code] = v.toUpperCase(); }
    }).catch(() => {});
  }
} catch (e) { /* keyboard map blocked in this frame */ }

const pad = { x: 0, y: 0, rx: 0, ry: 0, jump: false, action: false, start: false, pause: false };
const padT = { x: 0, y: 0 };
function radial(ax, ay, dz, out, kx, ky) {
  const m = Math.hypot(ax, ay);
  if (!(m > dz)) { out[kx] = 0; out[ky] = 0; return; }
  const s = Math.min(1, (m - dz) / (1 - dz)) / m;
  out[kx] = ax * s; out[ky] = ay * s;
}
function readPads() {
  pad.x = pad.y = pad.rx = pad.ry = 0; pad.jump = pad.action = pad.start = pad.pause = false;
  if (!padOK || !navigator.getGamepads) return;
  let list;
  try { list = navigator.getGamepads(); } catch (e) { padOK = false; return; }
  if (!list) return;
  let any = false;
  for (let i = 0; i < list.length; i++) {
    const g = list[i]; if (!g || g.connected === false) continue;
    any = true;
    const ax = g.axes, bt = g.buttons, b = j => !!(bt[j] && bt[j].pressed);
    const lx = ax[0] || 0, ly = ax[1] || 0, rx = ax[2] || 0, ry = ax[3] || 0;
    const t = padT;
    radial(lx, -ly, 0.18, t, 'x', 'y');
    let dx = (b(15) ? 1 : 0) - (b(14) ? 1 : 0), dy = (b(12) ? 1 : 0) - (b(13) ? 1 : 0);
    if (dx || dy) { const m = Math.hypot(dx, dy); t.x = dx / m; t.y = dy / m; }
    if (Math.abs(t.x) + Math.abs(t.y) > Math.abs(pad.x) + Math.abs(pad.y)) { pad.x = t.x; pad.y = t.y; }
    radial(rx, -ry, 0.2, t, 'x', 'y');
    if (Math.abs(t.x) + Math.abs(t.y) > Math.abs(pad.rx) + Math.abs(pad.ry)) { pad.rx = t.x; pad.ry = t.y; }
    if (b(0) || b(3)) pad.jump = true;
    if (b(1) || b(2)) pad.action = true;
    if (b(9)) pad.start = true;
    if (b(8)) pad.pause = true;
  }
  padConnected = any;
  if (pad.x || pad.y || pad.rx || pad.ry || pad.jump || pad.action || pad.start || pad.pause) lastDevice = 'pad';
}

K.input = {
  move, look, held, tap,
  poll() {
    for (const k of BTN) prev[k] = real[k];
    blocked = false;
    let up = 0, dn = 0, lf = 0, rt = 0, cl = 0, cr = 0, kj = false, ka = false, ks = false, kp = false;
    for (const code in down) {
      if (!down[code]) continue;
      switch (KEYMAP[code]) {
        case 'up': up = 1; break; case 'down': dn = 1; break; case 'left': lf = 1; break; case 'right': rt = 1; break;
        case 'camL': cl = 1; break; case 'camR': cr = 1; break;
        case 'jump': kj = true; break; case 'action': ka = true; break; case 'start': ks = true; break; case 'pause': kp = true; break;
      }
    }
    readPads();
    let x = rt - lf, y = up - dn;
    const km = Math.hypot(x, y); if (km > 1) { x /= km; y /= km; }
    x += pad.x + tch.x; y += pad.y + tch.y;
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    move.x = x || 0; move.y = y || 0;
    let lx = (cr - cl) * KEY_LOOK * STEP + pad.rx * PAD_LOOK_X * STEP + lookAccX;
    let ly = pad.ry * PAD_LOOK_Y * STEP + lookAccY;
    lookAccX = lookAccY = 0;
    look.x = clamp(lx, -0.6, 0.6); look.y = clamp(ly, -0.6, 0.6);
    real.jump = kj || pad.jump || tch.jump || latch.jump || tch.jumpLatch;
    real.action = ka || pad.action || tch.action || latch.action || tch.actionLatch;
    real.start = ks || pad.start || latch.start;
    real.pause = kp || pad.pause || latch.pause;
    real.tap = tapLatch;
    latch.jump = latch.action = latch.start = latch.pause = false;
    tch.jumpLatch = tch.actionLatch = false; tapLatch = false;
    held.jump = real.jump; held.action = real.action; held.start = real.start; held.pause = real.pause;
  },
  hit(name) { return !blocked && !!real[name] && !prev[name]; },
  // Hides all input from gameplay for the rest of this tick (menus, cut-scenes) without creating false edges later.
  neutral() {
    blocked = true;
    move.x = move.y = 0; look.x = look.y = 0;
    held.jump = held.action = held.start = held.pause = false;
  },
  isTouch: () => touchShown,
  get device() { return lastDevice; },
  get pad() { return padConnected; },
  keyLabel: code => (labels && labels[code]) || String(code).replace(/^Key/, ''),
  showTouch
};
})();
