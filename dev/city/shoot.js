// city role viewpoint shooter: boots a test page once, enters Act 2 (waits for the act2 textures), then for each view
// stages Kit / the camera and takes dev/city/shots/<prefix><view>.png (+ draw stats, K.tex stats).
// usage: node dev/city/shoot.js [--page=dev/city/site/test.html] [--views=hilltop,street,...] [--prefix=x-]
//        [--preset=high] [--webgpu] [--phone] [--q=?gl] [--hud] [--eval=js] [--out=file.json] [--w= --h=]
// views: hilltop street cross air pier orbit flight goal (the v2 Act 2 shots) + facade road bridge overview corner
//        works rail waterfront lowroad
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const { serve } = require('../../test/serve.js');
const arg = n => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : null; };
const WEBGPU = process.argv.includes('--webgpu'), PHONE = process.argv.includes('--phone');
const RAF_SHIM = `(() => { const q = []; window.requestAnimationFrame = cb => { q.push(cb); return q.length; }; window.cancelAnimationFrame = () => {};
  let t = 0; window.__pump = ms => { if (!t) t = performance.now(); t += ms; const l = q.splice(0); for (const cb of l) cb(t); }; })();`;

// in-page staging (runs once after boot)
const STAGE = () => {
  const K = __K, G = K.game, P = K.player, C = K.city, B = K.board, V3 = THREE.Vector3;
  const S = window.S = {};
  window.K = K;
  S.render = n => { for (let i = 0; i < (n || 4); i++) T.renderNow(); };
  S.freeze = () => { if (!S._cu) { S._cu = B.camera; B.camera = () => {}; } };
  S.thaw = () => { if (S._cu) { B.camera = S._cu; S._cu = null; } };
  // free camera: position at route (s, d, h above the street), looking at route (s2, d2, h2)
  S.cam = (s, d, h, s2, d2, h2, fov) => {
    const cam = K.view.camera, a = C.routePoint(s, d, h), b = C.routePoint(s2, d2, h2);
    cam.position.copy(a); cam.lookAt(b); cam.fov = fov || 62; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  };
  S.camXYZ = (p, q, fov) => { const cam = K.view.camera; cam.position.set(p[0], p[1], p[2]); cam.lookAt(q[0], q[1], q[2]); cam.fov = fov || 62; cam.updateProjectionMatrix(); cam.updateMatrixWorld(); };
  S.f = n => C.feature(n);
  S.place = (s, d, v) => { S.thaw(); T.place2(s, d, v); P.invT = 9; };
  S.until = (fn, max) => T.until(fn, max);
  return true;
};
const VIEWS = {
  hilltop: () => { S.place(S.f('iA0') + 20, 0); T.ticks(30); },
  street: () => { S.place(S.f('iA0') + 150, 0, 14); T.ticks(40); },
  cross: () => { S.place(S.f('iA1') - 34, 0, 10); T.ticks(30); },
  air: () => { S.place(S.f('iA2') - 70, 0, 24); T.key('ArrowUp', true); S.until(() => K.board.mode === 'air' && K.board.stats().airT > 0.35, 400); T.key('ArrowUp', false); },
  pier: () => { S.place(S.f('bumper') - 46, 0, 12); T.ticks(20); },
  orbit: () => { S.place(S.f('bumper') - 60, 0, 30); __K.player.invT = 0; T.key('ArrowUp', true); S.until(() => K.board.mode === 'flight', 600); T.key('ArrowUp', false); T.ticks(70); },
  flight: () => { S.place(S.f('bumper') - 60, 0, 30); T.key('ArrowUp', true); S.until(() => K.board.mode === 'flight', 600); T.key('ArrowUp', false); S.until(() => K.board.timeScale >= 1 && K.board.stats().flightU > 0.38, 3000); },
  goal: () => { S.place(S.f('bumper') - 60, 0, 30); T.key('ArrowUp', true); S.until(() => K.board.mode === 'flight', 600); T.key('ArrowUp', false); S.until(() => K.board.mode === 'land' || K.game.state !== 'play', 6000); T.ticks(40); },
  // free cameras (no ticks after placing: S.render only)
  facade: () => { S.place(S.f('iA1') + 40, 0); T.ticks(5); S.freeze(); S.cam(S.f('iA1') + 40, 4, 1.8, S.f('iA1') + 52, 12, 4.5, 55); },
  road: () => { S.place(S.f('iA3') + 60, 0); T.ticks(5); S.freeze(); S.cam(S.f('iA3') + 40, 1.5, 1.6, S.f('iA3') + 52, 1.0, 0, 60); },
  lowroad: () => { S.place(S.f('iC1') + 30, 0); T.ticks(5); S.freeze(); S.cam(S.f('iC1') + 20, -2, 0.9, S.f('iC1') + 40, -1, 0.2, 70); },
  corner: () => { S.place(S.f('t1a') - 30, 0, 10); T.ticks(30); },
  works: () => { S.place(S.f('iB') - 120, 0, 12); T.ticks(30); },
  rail: () => { S.place(S.f('t2b') + 30, 0, 12); T.ticks(30); },
  waterfront: () => { S.place(S.f('t3b') + 40, 0, 12); T.ticks(30); },
  bridge: () => { S.place(S.f('bumper') - 20, 0); T.ticks(5); S.freeze(); const g = __K.city.offset; S.camXYZ([g.x - 260, 22, -1560], [g.x - 600, 40, -1800], 55); },
  // the e2e "shaded streets stay readable" probe (road luma of the lower frame at s 640 / 1120, Élevé + Économie)
  luma: () => {
    const out = {}, q0 = K.post.quality;
    for (const q of ['high', 'low']) {
      K.post.setQuality(q);
      for (const s0 of [640, 1120]) {
        T.place2(s0, 0, 0); K.player.vel.set(0, 0, 0); K.player.invT = 9; T.ticks(90); T.frame();
        const { w, h, px } = T.pixelsGL();
        const L = [];
        for (let y = Math.floor(h * 0.05); y < Math.floor(h * 0.35); y += 2) for (let x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x += 2) { const i = (y * w + x) * 4; L.push(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]); }
        L.sort((a, b) => a - b);
        out[q + s0] = { p10: Math.round(L[Math.floor(L.length * 0.1)]), med: Math.round(L[L.length >> 1]) };
      }
    }
    K.post.setQuality(q0);
    return out;
  },
  skysun: () => { S.place(S.f('iA0') + 20, 0); T.ticks(5); S.freeze(); const a = __K.city.routePoint(S.f('iA0') + 20, -10, 8), d = __K.city.sunDir; S.camXYZ([a.x, a.y, a.z], [a.x + d.x * 100, a.y + 14, a.z + d.z * 100], 70); },
  skyanti: () => { S.place(S.f('iA0') + 20, 0); T.ticks(5); S.freeze(); const a = __K.city.routePoint(S.f('iA0') + 20, -10, 8), d = __K.city.sunDir; S.camXYZ([a.x, a.y, a.z], [a.x - d.x * 100, a.y + 14, a.z - d.z * 100], 70); },
  bumperclose: () => { S.place(S.f('bumper') - 30, 0); T.ticks(5); S.freeze(); const b = __K.city.bumper.base, d = __K.city.route(S.f('bumper')).dir; S.camXYZ([b.x - d.x * 11 + 3, b.y + 4.2, b.z - d.z * 11 + 3], [b.x, b.y + 1.8, b.z], 55); },
  rings: () => { S.place(S.f('iA0') + 20, 0); T.ticks(5); S.freeze(); S.cam(S.f('iA0') + 10, 1.5, 1.6, S.f('iA0') + 20, 0, 1.1, 50); },
  shade640: () => { T.place2(640, 0, 0); K.player.vel.set(0, 0, 0); K.player.invT = 9; T.ticks(90); T.frame(); },
  shade1120: () => { T.place2(1120, 0, 0); K.player.vel.set(0, 0, 0); K.player.invT = 9; T.ticks(90); T.frame(); },
  dash: () => { S.place(S.f('iC2') + 30, 0, 10); T.ticks(5); S.freeze(); S.cam(S.f('iC2') + 38, 2.5, 2.2, S.f('iC2') + 50, 0, 1.6, 60); },
  steam: () => { S.place(S.f('iA1') + 10, 0); T.ticks(5); S.freeze(); S.cam(S.f('iA1') + 10, -6, 4.5, S.f('iA1') + 60, 0, 1.0, 62); },
  overview: () => { S.place(S.f('iA0') + 20, 0); T.ticks(5); S.freeze(); const a = __K.city.routePoint(S.f('iA0') + 10, -30, 45), b = __K.city.routePoint(S.f('iA4'), 0, -10); S.camXYZ([a.x, a.y, a.z], [b.x, b.y, b.z], 60); },
};
(async () => {
  const views = (arg('views') || 'hilltop,street,cross,air,pier,orbit,flight,goal').split(',').filter(Boolean);
  const prefix = arg('prefix') || (WEBGPU ? 'gpu-' : 'gl-');
  const out = path.join(__dirname, 'shots');
  const srv = await serve(path.join(__dirname, '../..'), 0);
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  if (WEBGPU) args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader');
  const b = await chromium.launch({ args });
  const W = +(arg('w') || 1280), H = +(arg('h') || 720);
  const ctx = await b.newContext(PHONE ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: W, height: H } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + (e.stack || e.message).slice(0, 1500)));
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver Message|index count of 0|outsideRenderPass/.test(t)) || t.startsWith('LOG')) errs.push(m.type() + ': ' + t.slice(0, 1500)); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.addInitScript(RAF_SHIM);
  await p.addInitScript({ path: path.join(__dirname, '../../test/page-helpers.js') });
  const page = arg('page') || 'dev/city/site/test.html';
  const q = arg('q') != null ? arg('q') : (WEBGPU ? '' : '?gl');
  const t0 = Date.now();
  await p.goto(srv.url + page + q);
  await p.waitForFunction(() => (window.__K && window.__K.game && window.__K.game.booted) || !document.getElementById('fatal').hidden, null, { timeout: 900000, polling: 250 });
  console.log('boot', Date.now() - t0, 'ms');
  const preset = arg('preset') || (PHONE ? 'medium' : 'high');
  const setup = await p.evaluate(async ({ preset, hud }) => {
    const K = window.__K, G = K.game;
    window.__installT();
    if (K.post && K.post.setQuality) K.post.setQuality(preset);
    if (!hud) { const h = document.getElementById('hud'); if (h) h.style.visibility = 'hidden'; for (const id of ['btnSound', 'btnPause', 'btnFull', 'touch']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; } }
    const t1 = performance.now();
    T.ticks(40); T.key('ArrowRight', true); T.ticks(3); T.key('ArrowRight', false); T.ticks(3);
    T.tapKey('Space'); T.ticks(2);
    T.until(() => G.state === 'card', 400); T.until(() => G.state === 'play', 600);
    const ms = performance.now() - t1;
    await K.tex.preloadGroup('act2');
    await new Promise(r => setTimeout(r, 100));
    return { state: G.state, act: G.act, q: K.post && K.post.quality, enterMs: Math.round(ms), city: K.city.stats() };
  }, { preset, hud: process.argv.includes('--hud') });
  await p.evaluate(STAGE);
  console.log('setup', JSON.stringify(setup));
  if (arg('eval')) console.log('eval', JSON.stringify(await p.evaluate(new Function('return (async () => { ' + arg('eval') + ' })()'))));
  const results = {};
  for (const name of views) {
    const v = VIEWS[name];
    if (!v) { console.log('unknown view', name); continue; }
    const t1 = Date.now();
    const res = await p.evaluate(src => {
      const K = window.__K;
      const extra = (new Function('return ' + src))()();
      S.render(5);
      const d = T.drawStats(), tx = K.tex ? K.tex.stats() : null, ps = K.post && K.post.stats ? K.post.stats() : {};
      return { calls: d.calls, tris: d.tris, sceneCalls: ps.sceneCalls, sceneTris: ps.sceneTris, mode: K.board.mode, extra, tex: tx ? { n: tx.count, loaded: tx.loaded, mb: +(tx.gpuBytes / 1048576).toFixed(1) } : null };
    }, v.toString());
    await p.screenshot({ path: path.join(out, prefix + name + '.png'), timeout: 180000 });
    await p.evaluate(() => S.thaw());
    results[name] = res;
    console.log('[' + name + '] ' + (Date.now() - t1) + ' ms ' + JSON.stringify(res));
  }
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(results, null, 1));
  console.log('ERRORS (' + errs.length + '):\n' + errs.slice(0, 15).join('\n---\n'));
  await b.close(); await srv.close();
})().catch(e => { console.error(e); process.exit(1); });
