// world role viewpoint shooter: boots a test page once, then for each view places Kit / the camera, settles and takes a
// screenshot dev/world/shots/<prefix><view>.png (+ prints draw stats). Works with v3 pages (dev/world/site/test.html,
// dev/world/base/test.html, test.html) and the v2 page (dev/world/v2/test.html, three r128).
// usage: node dev/world/shoot.js [--page=dev/world/site/test.html] [--views=start,valley,...] [--prefix=x-]
//        [--preset=high] [--webgpu] [--phone] [--q=?gl] [--hud] [--eval=js run after boot]
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const { serve } = require('../../test/serve.js');
const arg = n => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : null; };
const WEBGPU = process.argv.includes('--webgpu'), PHONE = process.argv.includes('--phone');
const RAF_SHIM = `(() => { const q = []; window.requestAnimationFrame = cb => { q.push(cb); return q.length; }; window.cancelAnimationFrame = () => {};
  let t = 0; window.__pump = ms => { if (!t) t = performance.now(); t += ms; const l = q.splice(0); for (const cb of l) cb(t); }; })();`;
// view: [route z, lateral d, mode, extra]; mode 'follow' = Kit there, camera behind; 'cam' = free camera
// cam: [route z, d, height above ground, look route z, look d, look height]
const VIEWS = {
  start: { follow: [0, 0] },
  valley: { follow: [-96, -5] },
  loop1: { follow: [-150, -1.5] },
  loop1side: { cam: [-172, 16, 5, -180, -1.5, 5] },
  cliffs: { follow: [-214, 0] },
  chasm: { follow: [-233, 0] },
  descent: { follow: [-292, 0] },
  lake: { follow: [-352, 0] },
  lakeview: { cam: [-345, 6, 9, -390, -2, 0] },
  bridge: { follow: [-421, 0] },
  loop2: { follow: [-486, -1.5] },
  arena: { follow: [-600, 0] },
  overview: { cam: [-40, 0, 30, -160, 0, 0] },
  closegrass: { cam: [-20, 6, 1.4, -30, 4, 0] },
  closecliff: { cam: [-120, 0, 2.5, -124, 9, 4] },
};
(async () => {
  const views = (arg('views') || 'start,valley,loop1,cliffs,descent,lake,bridge,arena').split(',').filter(Boolean);
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
  const page = arg('page') || 'dev/world/site/test.html';
  const v2 = /\/v2\//.test(page);
  if (!v2) await p.addInitScript({ path: path.join(__dirname, '../../test/page-helpers.js') });
  const q = arg('q') != null ? arg('q') : (WEBGPU || v2 ? '' : '?gl');
  const t0 = Date.now();
  await p.goto(srv.url + page + q);
  if (v2) {
    await p.waitForFunction(() => window.__K && window.__K.game && window.__K.game.state === 'title', null, { timeout: 600000, polling: 250 });
  } else {
    await p.waitForFunction(() => (window.__K && window.__K.game && window.__K.game.booted) || !document.getElementById('fatal').hidden, null, { timeout: 900000, polling: 250 });
  }
  console.log('boot', Date.now() - t0, 'ms', v2 ? '(v2)' : '');
  const preset = arg('preset') || (PHONE ? 'medium' : 'high');
  const setup = await p.evaluate(({ v2, preset, hud }) => {
    const K = window.__K, G = K.game;
    if (v2) {
      // minimal v2 driver: ticks through the rAF shim (each pump also renders), renderNow = a frame without a tick
      const T = window.T = {};
      T.ticks = n => { const f0 = G.frame; let g = 0; while (G.frame - f0 < n && g++ < n * 2 + 10) window.__pump(n - (G.frame - f0) >= 4 ? 4000 / 60 : 1000 / 60); };
      T.renderNow = () => window.__pump(0.01);
      T.frame = () => window.__pump(1000 / 60);
      T.tapKey = c => { window.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c, bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { code: c, key: c, bubbles: true })); };
      T.until = (fn, max) => { for (let i = 0; i < max; i++) { if (fn()) return i; T.ticks(1); } return -1; };
      T.drawStats = () => { const i = K.view.renderer.info.render; return { calls: i.calls, tris: i.triangles }; };
      K.view._warm = 1e15;
    } else window.__installT();
    if (K.post && K.post.setQuality) K.post.setQuality(preset);
    if (!hud) { const h = document.getElementById('hud'); if (h) h.style.visibility = 'hidden'; for (const id of ['btnSound', 'btnPause', 'btnFull', 'touch']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; } }
    T.ticks(30); T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 400); T.ticks(20);
    return { state: G.state, q: K.post && K.post.quality };
  }, { v2, preset, hud: process.argv.includes('--hud') });
  console.log('setup', JSON.stringify(setup));
  if (arg('eval')) console.log('eval', JSON.stringify(await p.evaluate(new Function('return (async () => { ' + arg('eval') + ' })()'))));
  const results = {};
  for (const name of views) {
    const v = VIEWS[name];
    if (!v) { console.log('unknown view', name); continue; }
    const t1 = Date.now();
    const res = await p.evaluate(({ v, v2 }) => {
      const K = window.__K, THREE = window.THREE, P = K.player, W = K.world;
      const at = (z, d) => {
        let x = 0;
        for (let i = 0; i < 6; i++) { const ri = W.routeInfo(x, z); if (!ri) break; x -= ri.right.x * ri.d; }
        const ri = W.routeInfo(x, z);
        return { x: x + ri.right.x * d, z: z + ri.right.z * d, yaw: Math.atan2(-ri.dir.x, -ri.dir.z) };
      };
      P.invT = 0;
      if (window.__camUpd) { K.camera.update = window.__camUpd; }
      if (v.follow) {
        const a = at(v.follow[0], v.follow[1]);
        const g = W.ground(a.x, a.z, 1e4);
        P.init(new THREE.Vector3(a.x, g ? g.y : 30, a.z), a.yaw);
        K.camera.setMode('follow', { snap: true, yaw: a.yaw });
        T.ticks(70);
      } else {
        const c = v.cam, a = at(c[0], c[1]), b = at(c[3], c[4]);
        const ga = W.terrainY(a.x, a.z), gb = W.terrainY(b.x, b.z);
        T.ticks(5);
        const cam = K.view.camera;
        cam.position.set(a.x, Math.max(ga, 0) + c[2], a.z);
        cam.lookAt(b.x, Math.max(gb, 0) + c[5], b.z);
        cam.updateMatrixWorld();
        // the camera rig must not move it while the frames are drawn (v2 updates it per frame)
        if (!window.__camUpd) window.__camUpd = K.camera.update;
        K.camera.update = () => {};
      }
      for (let i = 0; i < 6; i++) T.renderNow();
      const d = T.drawStats();
      if (window.__camUpd && !v.cam) { K.camera.update = window.__camUpd; }
      const tx = !v2 && K.tex ? K.tex.stats() : null;
      return { calls: d.calls, tris: d.tris, tex: tx ? { n: tx.count, loaded: tx.loaded, mb: +(tx.gpuBytes / 1048576).toFixed(1) } : null };
    }, { v, v2 });
    if (!v2) await p.evaluate(() => { for (let i = 0; i < 3; i++) T.renderNow(); });
    await p.screenshot({ path: path.join(out, prefix + name + '.png'), timeout: 180000 });
    results[name] = res;
    console.log('[' + name + '] ' + (Date.now() - t1) + ' ms ' + JSON.stringify(res));
  }
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(results, null, 1));
  console.log('ERRORS (' + errs.length + '):\n' + errs.slice(0, 15).join('\n---\n'));
  await b.close(); await srv.close();
})().catch(e => { console.error(e); process.exit(1); });
