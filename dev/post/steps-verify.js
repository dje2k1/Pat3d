// post verification: preset switching stress (memory), Super Résolution sharpness vs native, TAA ghosting, cost per preset
// node dev/post/shoot.js --steps=dev/post/steps-verify.js [--webgpu] --prefix=ver- [--out=dev/post/verify.json]
const ONLY = (process.env.ONLY || 'stress,sharp,ghost,cost').split(',');
const lib = `
window.__V = window.__V || {};
const V = __V;
V.crop = () => { const c = __K.view.renderer.domElement; const w = c.width, h = c.height; return [Math.round(w * 0.3), Math.round(h * 0.3), Math.round(w * 0.4), Math.round(h * 0.4)]; };
V.grab = (r) => { const [x, y, w, h] = r || V.crop(); const p = T.pixels(x, y, w, h); return { w: p.w, h: p.h, px: new Uint8ClampedArray(p.px) }; };
V.lum = (a, i) => 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
// sharpness: mean absolute Laplacian of luma (higher = crisper)
V.sharp = g => { const { w, h, px } = g; let s = 0, n = 0; for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = (y * w + x) * 4; const c = V.lum(px, i) * 4 - V.lum(px, i - 4) - V.lum(px, i + 4) - V.lum(px, i - w * 4) - V.lum(px, i + w * 4); s += Math.abs(c); n++; } return +(s / n).toFixed(3); };
V.psnr = (a, b) => { let e = 0, n = 0; for (let i = 0; i < a.px.length; i += 4) { for (let k = 0; k < 3; k++) { const d = a.px[i + k] - b.px[i + k]; e += d * d; } n += 3; } const m = e / n; return +(10 * Math.log10(255 * 255 / Math.max(m, 1e-6))).toFixed(2); };
V.mad = (a, b, mask) => { let e = 0, n = 0, mx = 0; for (let i = 0, p = 0; i < a.px.length; i += 4, p++) { if (mask && !mask[p]) continue; const d = (Math.abs(a.px[i] - b.px[i]) + Math.abs(a.px[i + 1] - b.px[i + 1]) + Math.abs(a.px[i + 2] - b.px[i + 2])) / 3; e += d; n++; if (d > mx) mx = d; } return { mean: +(e / Math.max(1, n)).toFixed(2), max: +mx.toFixed(1), n }; };
V.still = (n) => { for (let i = 0; i < (n || 24); i++) T.renderNow(); };
V.pose = () => { const K = __K, cam = K.view.camera; return { p: cam.position.clone(), q: cam.quaternion.clone() }; };
V.setPose = (s) => { const cam = __K.view.camera; cam.position.copy(s.p); cam.quaternion.copy(s.q); cam.updateMatrixWorld(true); };
`;
const steps = [
  { name: 'setup', code: lib + `__K.post.setQuality('high'); __K.post.setSuperRes(false); T.ticks(40); const G=__K.game; T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300); T.teleport(-6, -100, T.routeDirYaw(-6, -100), 0); T.ticks(60); T.frame(); return 1;` }
];
if (ONLY.includes('stress')) steps.push({ name: 'stress', code: lib + `
  const K = __K, R = K.view.renderer, out = [];
  const combos = []; for (const q of ['ultra', 'high', 'medium', 'low']) for (const sr of [false, true]) for (const up of ['auto', 'fsr']) combos.push([q, sr, up]);
  const snap = () => { const m = R.info.memory; return { geo: m.geometries, tex: m.textures, prog: m.programs, rt: m.renderTargets, texMB: +((m.texturesSize || 0) / 1e6).toFixed(1) }; };
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const [q, sr, up] of combos) { K.post.setUpscaler(up); K.post.setSuperRes(sr); K.post.setQuality(q); T.frame(); T.frame(); }
    T.frame(); T.frame();
    out.push(Object.assign({ cycle, builds: K.post.stats().builds }, snap()));
  }
  K.post.setUpscaler('auto'); K.post.setSuperRes(false); K.post.setQuality('high'); T.frame();
  return out;` });
if (ONLY.includes('sharp')) steps.push({ name: 'sharp', shot: false, code: lib + `
  const K = __K, out = {}; const pose = V.pose();
  const run = (tag, q, sr, up) => { K.post.setUpscaler(up); K.post.setSuperRes(sr); K.post.setQuality(q); V.setPose(pose); V.still(30); const g = V.grab(); out[tag] = { g, internal: K.post.stats().internal, aa: K.post.stats().aa }; };
  run('native', 'high', false, 'auto');
  run('taau85', 'high', true, 'auto');
  run('fsr85', 'high', true, 'fsr');
  run('taau60', 'medium', true, 'auto');
  run('fsr60', 'medium', true, 'fsr');
  run('low75', 'low', true, 'auto');
  run('lownative', 'low', false, 'auto');
  const ref = out.native.g, res = {};
  for (const k of Object.keys(out)) res[k] = { internal: out[k].internal, aa: out[k].aa, sharp: V.sharp(out[k].g), psnrVsNative: k === 'native' ? null : V.psnr(out[k].g, ref) };
  K.post.setUpscaler('auto'); K.post.setSuperRes(false); K.post.setQuality('high');
  return res;` });
if (ONLY.includes('ghost')) steps.push({ name: 'ghost', shot: true, code: lib + `
  // a bright box crosses the view at ~14 px per frame in front of a static camera; F = after the motion, R = the same
  // final pose with the box resting there (history converged). Ghost = difference behind the box (swept region).
  const K = __K, cam = K.view.camera, out = {};
  const pose = V.pose();
  const fw = new THREE.Vector3(); cam.getWorldDirection(fw);
  const right = new THREE.Vector3().crossVectors(fw, cam.up).normalize();
  const c0 = cam.position.clone().addScaledVector(fw, 9);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardNodeMaterial({ color: 0xffffff, emissive: 0xff3020, emissiveIntensity: 3 }));
  K.view.scene.add(box);
  const r = V.crop();
  const W = K.view.renderer.domElement.width;
  const pxPerUnit = W / (2 * 9 * Math.tan(cam.fov * Math.PI / 360) * cam.aspect);
  const stepU = 14 / pxPerUnit;
  for (const q of ['high', 'medium', 'ultra', 'low']) {
    K.post.setSuperRes(q === 'medium'); K.post.setQuality(q);
    V.setPose(pose);
    const end = c0.clone();
    box.position.copy(end).addScaledVector(right, -stepU * 24); box.updateMatrixWorld(true); V.still(8);
    for (let i = 0; i < 24; i++) { box.position.addScaledVector(right, stepU); box.updateMatrixWorld(true); T.renderNow(); }
    const F = V.grab(r);
    V.still(40); const Rr = V.grab(r);
    box.visible = false; V.still(40); const B = V.grab(r); box.visible = true;
    // swept region = where the background frame differs from nothing ... use the pixels left of the box's final position
    const mask = new Uint8Array(F.w * F.h);
    const pr = end.clone().project(cam); const bx = (pr.x * 0.5 + 0.5) * W - r[0], by = (0.5 - pr.y * 0.5) * K.view.renderer.domElement.height - r[1];
    const halfPx = 0.4 * pxPerUnit * 1.4;
    let nm = 0;
    for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) if (Math.abs(y - by) < halfPx * 0.8 && x < bx - halfPx * 1.3 && x > bx - halfPx * 1.3 - 14 * 10) { mask[y * F.w + x] = 1; nm++; }
    out[q] = { trail: V.mad(F, Rr, mask), trailVsBg: V.mad(F, B, mask), whole: V.mad(F, Rr), maskPx: nm };
  }
  K.view.scene.remove(box); box.geometry.dispose(); box.material.dispose();
  K.post.setSuperRes(false); K.post.setQuality('high'); V.setPose(pose); T.frame();
  return out;` });
if (ONLY.includes('cost')) steps.push({ name: 'cost', code: lib + `
  const K = __K, out = {};
  for (const q of ['ultra', 'high', 'medium', 'low']) for (const sr of [false, true]) {
    K.post.setSuperRes(sr); K.post.setQuality(q); V.still(6); T.sync();
    const t0 = performance.now(); for (let i = 0; i < 8; i++) T.renderNow(); T.sync(); const ms = (performance.now() - t0) / 8;
    const s = K.post.stats();
    out[q + (sr ? '+SR' : '')] = { passes: s.passes.length, list: s.passes.join(' | '), internal: s.internal.join('x'), output: s.output.join('x'), aa: s.aa, ao: s.ao, ssr: s.ssrOn, costMPx: s.cost, swiftshaderMs: +ms.toFixed(1), sceneCalls: s.sceneCalls, frameCalls: s.calls, sceneTris: s.sceneTris };
  }
  K.post.setSuperRes(false); K.post.setQuality('high');
  return out;` });
module.exports = steps;
