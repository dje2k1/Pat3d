// entities role viewpoint shooter: boots a test page once, then for each view places Kit / the camera near an entity,
// settles and takes a screenshot dev/entities/shots/<prefix><view>.png (+ prints draw stats).
// usage: node dev/entities/shoot.js [--page=dev/entities/site/test.html] [--views=ring,bug,...] [--prefix=x-]
//        [--preset=high] [--webgpu] [--phone] [--q=?gl] [--hud] [--eval=js run after boot] [--out=json]
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const { serve } = require('../../test/serve.js');
const arg = n => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : null; };
const WEBGPU = process.argv.includes('--webgpu'), PHONE = process.argv.includes('--phone');
const RAF_SHIM = `(() => { const q = []; window.requestAnimationFrame = cb => { q.push(cb); return q.length; }; window.cancelAnimationFrame = () => {};
  let t = 0; window.__pump = ms => { if (!t) t = performance.now(); t += ms; const l = q.splice(0); for (const cb of l) cb(t); }; })();`;
// close-up: [entity list, index, distance, height above entity, side angle (deg, 0 = from the route's back), look height]
// follow: [route z, lateral d]  cam: [route z, d, height, look route z, look d, look height] (world harness format)
const VIEWS = {
  ring: { ent: ['rings', 6, 2.6, 0.3, 25, 0] },
  rings: { follow: [-14, 0] },
  ringsfar: { cam: [-6, 3, 2.2, -40, 0, 1] },
  bug: { ent: ['bug', 0, 2.6, 0.9, 35, 0.45] },
  bug2: { ent: ['bug', 1, 3.2, 1.5, -60, 0.45] },
  wasp: { ent: ['wasp', 0, 2.8, 0.4, 30, 0] },
  fish: { ent: ['fish', 0, 4.5, 0.5, 70, 0], fish: true },
  spring: { ent: ['springs', 3, 3.4, 1.8, 30, 0.6] },
  dash: { ent: ['dashPanels', 0, 4.0, 2.0, 20, 0] },
  monitor: { ent: ['monitors', 0, 2.6, 0.9, 25, 0.6] },
  monitor2: { ent: ['monitors', 2, 3.2, 1.1, -30, 0.6] },
  post: { ent: ['checkpoints', 0, 3.6, 1.2, 40, 1.4] },
  spikes: { ent: ['spikes', 0, 3.6, 1.6, 30, 0.3] },
  boss: { boss: [9, 2.2] },
  bossclose: { boss: [5.5, 1.0] },
  capsule: { capsule: [7, 2.5] },
  // game views (world harness spots) for budgets
  start: { follow: [0, 0] },
  valley: { follow: [-96, -5] },
  chasm: { follow: [-233, 0] },
  lake: { follow: [-352, 0] },
  lakeview: { cam: [-345, 6, 9, -390, -2, 0] },
  bridge: { follow: [-421, 0] },
  loop2: { follow: [-486, -1.5] },
  arena: { follow: [-600, 0] },
};
(async () => {
  const views = (arg('views') || 'ring,rings,bug,wasp,fish,spring,dash,monitor,post,boss,capsule').split(',').filter(Boolean);
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
  const page = arg('page') || 'dev/entities/site/test.html';
  await p.addInitScript({ path: path.join(__dirname, '../../test/page-helpers.js') });
  const q = arg('q') != null ? arg('q') : (WEBGPU ? '' : '?gl');
  const t0 = Date.now();
  await p.goto(srv.url + page + q);
  await p.waitForFunction(() => (window.__K && window.__K.game && window.__K.game.booted) || !document.getElementById('fatal').hidden, null, { timeout: 900000, polling: 250 });
  console.log('boot', Date.now() - t0, 'ms');
  const preset = arg('preset') || (PHONE ? 'medium' : 'high');
  const setup = await p.evaluate(({ preset, hud }) => {
    const K = window.__K, G = K.game;
    window.__installT();
    if (K.post && K.post.setQuality) K.post.setQuality(preset);
    if (!hud) { const h = document.getElementById('hud'); if (h) h.style.visibility = 'hidden'; for (const id of ['btnSound', 'btnPause', 'btnFull', 'touch']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; } }
    T.ticks(30); T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 400); T.ticks(20);
    return { state: G.state, q: K.post && K.post.quality, backend: K.view.backend };
  }, { preset, hud: process.argv.includes('--hud') });
  console.log('setup', JSON.stringify(setup));
  if (arg('eval')) console.log('eval', JSON.stringify(await p.evaluate(new Function('return (async () => { ' + arg('eval') + ' })()'))));
  const results = {};
  for (const name of views) {
    const v = VIEWS[name];
    if (!v) { console.log('unknown view', name); continue; }
    const t1 = Date.now();
    const res = await p.evaluate(({ v }) => {
      const K = window.__K, THREE = window.THREE, P = K.player, W = K.world, G = K.game, L = K.level;
      const at = (z, d) => {
        let x = 0;
        for (let i = 0; i < 6; i++) { const ri = W.routeInfo(x, z); if (!ri) break; x -= ri.right.x * ri.d; }
        const ri = W.routeInfo(x, z);
        return { x: x + ri.right.x * d, z: z + ri.right.z * d, yaw: Math.atan2(-ri.dir.x, -ri.dir.z) };
      };
      P.invT = 0;
      if (window.__camUpd) { K.camera.update = window.__camUpd; }
      const cam = K.view.camera;
      const fix = (px, py, pz, lx, ly, lz) => {
        cam.position.set(px, py, pz); cam.lookAt(lx, ly, lz); cam.updateMatrixWorld();
        if (!window.__camUpd) window.__camUpd = K.camera.update;
        K.camera.update = () => {};
      };
      // park Kit somewhere harmless (behind the camera, invulnerable, standing)
      const park = (x, z) => { const g = W.ground(x, z, 1e4); P.init(new THREE.Vector3(x, g ? g.y : 30, z), 0); P.invT = 0; };
      let info = {};
      if (v.follow) {
        const a = at(v.follow[0], v.follow[1]);
        const g = W.ground(a.x, a.z, 1e4);
        P.init(new THREE.Vector3(a.x, g ? g.y : 30, a.z), a.yaw);
        K.camera.setMode('follow', { snap: true, yaw: a.yaw });
        T.ticks(70);
      } else if (v.cam) {
        const c = v.cam, a = at(c[0], c[1]), b = at(c[3], c[4]);
        const ga = W.terrainY(a.x, a.z), gb = W.terrainY(b.x, b.z);
        T.ticks(5);
        fix(a.x, Math.max(ga, 0) + c[2], a.z, b.x, Math.max(gb, 0) + c[5], b.z);
      } else if (v.ent) {
        const [list, idx, dist, hy, side, ly] = v.ent;
        let arr;
        if (list === 'bug' || list === 'wasp' || list === 'fish') arr = L.enemies.filter(e => (e.type || 'bug') === list);
        else arr = L[list];
        const e = arr[Math.min(idx, arr.length - 1)];
        const p0 = e.pos || e;
        const ri = W.routeInfo(p0.x, p0.z);
        const back = ri ? Math.atan2(ri.dir.x, ri.dir.z) + Math.PI : 0;
        const a = back + side * Math.PI / 180;
        let tx = p0.x, ty = p0.y, tz = p0.z;
        const D = K.entities._dbg && K.entities._dbg();
        park(p0.x + Math.sin(back) * 14, p0.z + Math.cos(back) * 14);
        T.ticks(8);
        if (v.fish && D) {
          const f = D.EN.filter(q => q.type === 'fish')[idx];
          f.leap = true; f.lt = f.T * 0.42; f.show = true; f.wait = 0;
          T.ticks(1);
        }
        if (D && (list === 'bug' || list === 'wasp' || list === 'fish')) { const en = D.EN.filter(q => q.type === list)[idx]; tx = en.c.x; ty = en.c.y; tz = en.c.z; }
        else if (list === 'bug' || list === 'wasp') ty += 0.4;
        const gy = W.terrainY(tx + Math.sin(a) * dist, tz + Math.cos(a) * dist);
        fix(tx + Math.sin(a) * dist, Math.max(ty + hy, gy + 0.4), tz + Math.cos(a) * dist, tx, ty + ly, tz);
        info.at = [+tx.toFixed(1), +ty.toFixed(1), +tz.toFixed(1)];
      } else if (v.boss) {
        const B = L.boss.center;
        if (G.bossDone) { G.bossDone = false; K.entities.reset(); }
        T.teleport(B.x, B.z + 12, 0, 0);
        P.invT = 99;
        T.until(() => K.entities.stats().boss === 'fight', 400);
        T.ticks(40);
        const s = K.entities.stats(), bp = s.bossPos;
        const dx = P.pos.x - bp.x, dz = P.pos.z - bp.z, l = Math.hypot(dx, dz) || 1;
        const [dist, hy] = v.boss;
        fix(bp.x + dx / l * dist, bp.y + hy, bp.z + dz / l * dist, bp.x, bp.y - 0.6, bp.z);
        info.boss = s.boss;
      } else if (v.capsule) {
        const C = L.capsule.pos;
        G.bossDone = true; K.entities.reset();
        park(C.x, C.z + 14);
        T.ticks(3);
        const [dist, hy] = v.capsule;
        fix(C.x + dist * 0.5, C.y + hy, C.z + dist * 0.87, C.x, C.y + 1.0, C.z);
        info.capsule = K.entities.stats().capsule;
      }
      if (!v.follow) T.ticks(7); // entity LOD / distance culling (every 6 ticks) follow the fixed camera
      for (let i = 0; i < 6; i++) T.renderNow();
      const d = T.drawStats();
      const tx = K.tex ? K.tex.stats() : null;
      return Object.assign(info, { calls: d.calls, tris: d.tris, tex: tx ? { n: tx.count, loaded: tx.loaded, mb: +(tx.gpuBytes / 1048576).toFixed(1) } : null });
    }, { v });
    await p.evaluate(() => { for (let i = 0; i < 3; i++) T.renderNow(); });
    await p.screenshot({ path: path.join(out, prefix + name + '.png'), timeout: 180000 });
    results[name] = res;
    console.log('[' + name + '] ' + (Date.now() - t1) + ' ms ' + JSON.stringify(res));
  }
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(results, null, 1));
  console.log('ERRORS (' + errs.length + '):\n' + errs.slice(0, 15).join('\n---\n'));
  await b.close(); await srv.close();
})().catch(e => { console.error(e); process.exit(1); });
