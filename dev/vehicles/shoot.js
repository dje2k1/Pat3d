// vehicles role viewpoint shooter (adapted from dev/city/shoot.js): boots a test page once, enters Act 2 (waits for the act2 textures), then for each view
// stages Kit / the camera and takes dev/vehicles/shots/<prefix><view>.png (+ draw stats, K.tex stats).
// usage: node dev/city/shoot.js [--page=dev/vehicles/site/test.html] [--views=hilltop,street,...] [--prefix=x-]
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
  // vehicle line-up: hides the traffic, puts one InstancedMesh per entry along the route (s from s0, lateral d)
  S.trafficVis = on => { const KV = K.vehicles; if (KV._dbg && KV._dbg.show) KV._dbg.show(on); else C.group.children.forEach(o => { if (o.isInstancedMesh && o.material === KV.material()) o.visible = on; }); };
  S.lineup = (s0, list, d, gap) => {
    if (S.lu) for (const m of S.lu) { m.removeFromParent(); }
    S.lu = []; S.trafficVis(false);
    const MS = C._dbg && C._dbg.MESH; S.hid = [];
    if (MS) for (const o of [MS.rings, MS.dash, MS.dashDisc]) if (o && o.visible) { o.visible = false; S.hid.push(o); }
    let s = s0; const KV = K.vehicles, M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
    for (const it of list) {
      const t = KV.VT[it.type]; s += t.hz;
      const p = C.routePoint(s, d, 0), pf = C.routePoint(s + 1, d, 0), pb = C.routePoint(s - 1, d, 0);
      const dir = it.rev ? -1 : 1, yaw = Math.atan2((pf.x - pb.x) * dir, (pf.z - pb.z) * dir), pitch = Math.atan2((pf.y - pb.y) * dir, Math.hypot(pf.x - pb.x, pf.z - pb.z));
      e.set(-pitch, yaw, 0, 'YXZ'); q.setFromEuler(e); M.compose(p, q, new THREE.Vector3(1, 1, 1));
      const b = it.lod != null && KV.buildLOD ? KV.buildLOD(it.type, it.lod) : KV.build(it.type);
      const im = new THREE.InstancedMesh(b.geometry, b.material, 1);
      im.setMatrixAt(0, M); im.setColorAt(0, it.paint ? new THREE.Color(it.paint) : KV.paint(it.type, it.i || 0));
      im.castShadow = im.receiveShadow = true; im.frustumCulled = false;
      K.view.scene.add(im); S.lu.push(im);
      it.pos = p.clone(); it.s = s; s += t.hz + (gap || 1.5);
    }
    return list;
  };
  S.vehView = (set, ang) => {
    const LANE = 3.2, base = S.f('t3b') + 30;
    const sets = {
      A: [{ type: 0, paint: '#c0392b' }, { type: 0, paint: '#2e5c9a' }, { type: 1 }, { type: 2, paint: '#2f6b4f' }],
      B: [{ type: 3 }, { type: 4 }, { type: 5 }],
      C: [{ type: 0, paint: '#f2f2ef' }, { type: 0, paint: '#1d1f24' }, { type: 7, i: 0 }, { type: 6 }],
      D: [{ type: 0, paint: '#c0392b' }],
      T0: [{ type: 0, paint: '#2e5c9a' }], T1: [{ type: 1 }], T2: [{ type: 2, paint: '#2f6b4f' }], T3: [{ type: 3 }], T4: [{ type: 4 }], T5: [{ type: 5 }], T6: [{ type: 6 }], T7: [{ type: 7, i: 0 }],
      F: [{ type: 0, paint: '#c0392b', lod: 1 }, { type: 1, lod: 1 }, { type: 2, paint: '#2f6b4f', lod: 1 }, { type: 7, i: 0, lod: 1 }, { type: 6, lod: 1 }, { type: 3, lod: 1 }, { type: 4, lod: 1 }, { type: 5, lod: 1 }]
    };
    S.place(base - 30, 0); T.ticks(5); S.freeze(); K.player.mesh && (K.player.mesh.visible = false);
    const L = S.lineup(base, sets[set].map(o => Object.assign({}, o)), -LANE, set === 'B' ? 3 : 1.6);
    const a = L[0].s - L[0].type * 0, b = L[L.length - 1].s, mid = (L[0].s + b) / 2, len = b - L[0].s + 6;
    if (set === 'D' || set[0] === 'T') {
      const s = L[0].s, t = K.vehicles.VT[L[0].type], k = t.hz / 2.3, h = t.hy / 0.73;
      const cams = { 1: [s + 4.2 * k, -LANE + 3.6 * k, 1.5 * h, s + 0.3 * k, -LANE, 0.75 * h], 2: [s - 0.2 * k, -LANE + 5.4 * k, 1.3 * h, s, -LANE, 0.8 * h], 3: [s - 4.5 * k, -LANE - 3.4 * k, 1.9 * h, s, -LANE, 0.7 * h], 4: [s + 1.2, -LANE + 1.6, 0.6, s + 1.5, -LANE + 0.8, 0.35],
        5: [s + 3.2 * k, -LANE + 0.6, 1.0 * h, s, -LANE, 0.7 * h], 6: [s - 3.4 * k, -LANE + 0.8, 1.3 * h, s, -LANE, 0.8 * h] };
      const c = cams[ang]; S.cam(c[0], c[1], c[2], c[3], c[4], c[5], ang === 4 ? 40 : 45); return;
    }
    const cams = {
      1: [mid + len * 0.55, -LANE + len * 0.42, len * 0.12 + 1.5, mid + len * 0.05, -LANE, 1.0],
      2: [mid, -LANE + len * 0.75, 1.7, mid, -LANE, 1.2],
      3: [mid - len * 0.55, -LANE - len * 0.4, len * 0.14 + 1.8, mid - len * 0.05, -LANE, 1.0],
      4: [mid - len * 0.1, -LANE + len * 0.35, len * 0.45, mid, -LANE, 0.0]
    };
    const c = cams[ang]; S.cam(c[0], c[1], c[2], c[3], c[4], c[5], 50);
  };
  S.lineEnd = () => { if (S.lu) for (const m of S.lu) m.removeFromParent(); S.lu = null; S.trafficVis(true); for (const o of S.hid || []) o.visible = true; S.hid = []; };
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
  // ---- vehicles views
  // line-up A (cars) on the waterfront: sedan x3, taxi, van, delivery van, road works; camera angles 1-4
  lineA1: () => S.vehView('A', 1), lineA2: () => S.vehView('A', 2), lineA3: () => S.vehView('A', 3), lineA4: () => S.vehView('A', 4),
  lineB1: () => S.vehView('B', 1), lineB2: () => S.vehView('B', 2), lineB3: () => S.vehView('B', 3), lineB4: () => S.vehView('B', 4),
  lineC1: () => S.vehView('C', 1), lineC2: () => S.vehView('C', 2), lineC3: () => S.vehView('C', 3), lineC4: () => S.vehView('C', 4),
  lineF1: () => S.vehView('F', 1), lineF2: () => S.vehView('F', 2),
  close1: () => S.vehView('D', 1), close2: () => S.vehView('D', 2), close3: () => S.vehView('D', 3), close4: () => S.vehView('D', 4),
  traffic: () => { S.place(S.f('iA0') + 205, 0, 14); T.ticks(50); },
  pullout: () => { const hz = K.city.cars.filter(c => c.fixed && c.type === 7); const c = hz[0]; S.place(c.s - 40, 0, 12); T.ticks(40); return { van: c && c.s }; },
  runner: () => { S.place(S.f('iB') + 120, 0, 14); T.ticks(40); },
  parked: () => { S.place(S.f('iA0') + 60, 0); T.ticks(5); S.freeze(); S.cam(S.f('iA0') + 52, 4.5, 1.6, S.f('iA0') + 64, 7.5, 0.6, 55); },
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
  const page = arg('page') || 'dev/vehicles/site/test.html';
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
    let v = VIEWS[name];
    const mm = /^c(\d)_(\d)$/.exec(name);
    if (!v && mm) v = new Function('return () => S.vehView("T' + mm[1] + '", ' + mm[2] + ')')();
    if (!v) { console.log('unknown view', name); continue; }
    const t1 = Date.now();
    const res = await p.evaluate(src => {
      const K = window.__K;
      const extra = (new Function('return ' + src))()();
      S.render(5);
      const d = T.drawStats(), tx = K.tex ? K.tex.stats() : null, ps = K.post && K.post.stats ? K.post.stats() : {};
      const vs = K.vehicles.stats ? K.vehicles.stats() : null;
      return { calls: d.calls, tris: d.tris, sceneCalls: ps.sceneCalls, sceneTris: ps.sceneTris, mode: K.board.mode, extra, veh: vs ? { near: vs.near.join(''), far: vs.far.join(','), dist: vs.dist.join(',') } : null, tex: tx ? { n: tx.count, loaded: tx.loaded, mb: +(tx.gpuBytes / 1048576).toFixed(1) } : null };
    }, v.toString());
    await p.screenshot({ path: path.join(out, prefix + name + '.png'), timeout: 180000 });
    await p.evaluate(() => { S.thaw(); if (S.lu) S.lineEnd(); if (__K.player.mesh) __K.player.mesh.visible = true; });
    results[name] = res;
    console.log('[' + name + '] ' + (Date.now() - t1) + ' ms ' + JSON.stringify(res));
  }
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(results, null, 1));
  console.log('ERRORS (' + errs.length + '):\n' + errs.slice(0, 15).join('\n---\n'));
  await b.close(); await srv.close();
})().catch(e => { console.error(e); process.exit(1); });
