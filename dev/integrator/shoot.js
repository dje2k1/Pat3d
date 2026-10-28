// integrator screenshot harness: boots a test page once, then for each view switches to its act (title -> act select ->
// play), stages Kit / the camera and saves <out>/<prefix><view>.png with draw stats (scene pass incl. shadows), the
// K.post passes and K.tex numbers. Views of both acts can be mixed in one run.
// usage: node dev/integrator/shoot.js --views=a1start,a2hill,... [--page=dev/integrator/site/test.html] [--prefix=x-]
//        [--out=shots] [--preset=high] [--sr] [--webgpu] [--phone] [--q=?gl] [--hud] [--json=file.json] [--w= --h=]
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const { serve } = require('../../test/serve.js');
const arg = n => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : null; };
const flag = n => process.argv.includes('--' + n);
const WEBGPU = flag('webgpu'), PHONE = flag('phone');
const RAF_SHIM = `(() => { const q = []; window.requestAnimationFrame = cb => { q.push(cb); return q.length; }; window.cancelAnimationFrame = () => {};
  let t = 0; window.__pump = ms => { if (!t) t = performance.now(); t += ms; const l = q.splice(0); for (const cb of l) cb(t); }; })();`;

// in-page staging helpers (installed once after boot)
const STAGE = () => {
  const K = __K, G = K.game, P = K.player, V3 = THREE.Vector3;
  const S = window.S = {};
  S.hud = on => {
    document.getElementById('hud').style.visibility = on ? 'visible' : 'hidden';
    for (const id of ['btnSound', 'btnPause', 'btnFull', 'touch']) { const e = document.getElementById(id); if (e) e.style.visibility = on ? '' : 'hidden'; }
  };
  // settle: draw a few frames that each advance one tick (motion blur = one tick of motion, TAA history converged)
  S.settle = n => { for (let i = 0; i < (n || 6); i++) T.frame(); };
  // still: frames without ticking (free cameras)
  S.still = n => { for (let i = 0; i < (n || 6); i++) T.renderNow(); };
  S.act = a => {
    if (G.act === a && (G.state === 'play' || G.state === 'card')) { if (G.state === 'card') T.until(() => G.state === 'play', 600); return G.state; }
    if (G.state !== 'title') T.toTitle();
    T.ticks(30);
    if (G.sel !== a) { const k = a === 2 ? 'ArrowRight' : 'ArrowLeft'; T.key(k, true); T.ticks(3); T.key(k, false); T.ticks(3); }
    T.tapKey('Space'); T.ticks(4);
    T.until(() => G.state === 'card', 600); T.until(() => G.state === 'play', 600);
    return G.state;
  };
  // ---- Act 1
  const W = K.world;
  S.at = (z, d) => {
    let x = 0;
    for (let i = 0; i < 6; i++) { const ri = W.routeInfo(x, z); if (!ri) break; x -= ri.right.x * ri.d; }
    const ri = W.routeInfo(x, z);
    return { x: x + ri.right.x * d, z: z + ri.right.z * d, yaw: Math.atan2(-ri.dir.x, -ri.dir.z) };
  };
  S.follow1 = (z, d, ticks) => {
    S.thaw1();
    const a = S.at(z, d || 0), g = W.ground(a.x, a.z, 1e4);
    P.init(new V3(a.x, g ? g.y : 30, a.z), a.yaw); P.invT = 0;
    K.camera.setMode('follow', { snap: true, yaw: a.yaw });
    T.ticks(ticks || 60);
  };
  S.freeze1 = () => { if (!S._cu1) { S._cu1 = K.camera.update; K.camera.update = () => {}; } };
  S.thaw1 = () => { if (S._cu1) { K.camera.update = S._cu1; S._cu1 = null; } };
  S.cam1 = (c) => {
    const a = S.at(c[0], c[1]), b = S.at(c[3], c[4]);
    const ga = W.terrainY(a.x, a.z), gb = W.terrainY(b.x, b.z);
    const cam = K.view.camera;
    cam.position.set(a.x, Math.max(ga, 0) + c[2], a.z);
    cam.lookAt(b.x, Math.max(gb, 0) + c[5], b.z);
    cam.fov = c[6] || 62; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    S.freeze1();
  };
  // camera around Kit: yaw angle a from Kit's facing, distance d, height h above the feet, aim height ty
  S.orbit = (a, d, h, ty, fov) => {
    const cam = K.view.camera, c = P.pos, f = P.forward, ang = Math.atan2(f.x, f.z) + a;
    cam.position.set(c.x + Math.sin(ang) * d, c.y + h, c.z + Math.cos(ang) * d);
    cam.lookAt(c.x, c.y + (ty == null ? 0.6 : ty), c.z);
    cam.fov = fov || 35; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  };
  S.restoreFov = () => { const cam = K.view.camera; cam.fov = 62; cam.updateProjectionMatrix(); };
  // ---- Act 2
  const C = () => K.city, B = () => K.board;
  S.f = n => C().feature(n);
  S.place = (s, d, v) => { S.thaw2(); T.place2(s, d, v); P.invT = 9; };
  S.freeze2 = () => { if (!S._cu2) { S._cu2 = B().camera; B().camera = () => {}; } };
  S.thaw2 = () => { if (S._cu2) { B().camera = S._cu2; S._cu2 = null; } };
  S.cam2 = (s, d, h, s2, d2, h2, fov) => {
    const cam = K.view.camera, a = C().routePoint(s, d, h), b = C().routePoint(s2, d2, h2);
    cam.position.copy(a); cam.lookAt(b); cam.fov = fov || 62; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    S.freeze2();
  };
  S.camXYZ = (p, q, fov) => { const cam = K.view.camera; cam.position.set(p[0], p[1], p[2]); cam.lookAt(q[0], q[1], q[2]); cam.fov = fov || 62; cam.updateProjectionMatrix(); cam.updateMatrixWorld(); };
  S.toFlight = () => { S.place(S.f('bumper') - 60, 0, 30); P.invT = 0; T.key('ArrowUp', true); T.until(() => B().mode === 'flight', 600); T.key('ArrowUp', false); };
  // vehicle line-up (from dev/vehicles/shoot.js): hides the traffic, one InstancedMesh per entry along the route
  S.trafficVis = on => { const KV = K.vehicles; if (KV._dbg && KV._dbg.show) KV._dbg.show(on); };
  S.lineup = (s0, list, d, gap) => {
    S.lineEnd();
    S.lu = []; S.trafficVis(false);
    const MS = C()._dbg && C()._dbg.MESH; S.hid = [];
    if (MS) for (const o of [MS.rings, MS.dash, MS.dashDisc]) if (o && o.visible) { o.visible = false; S.hid.push(o); }
    let s = s0; const KV = K.vehicles, M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
    for (const it of list) {
      const t = KV.VT[it.type]; s += t.hz;
      const p = C().routePoint(s, d, 0), pf = C().routePoint(s + 1, d, 0), pb = C().routePoint(s - 1, d, 0);
      const dir = it.rev ? -1 : 1, yaw = Math.atan2((pf.x - pb.x) * dir, (pf.z - pb.z) * dir), pitch = Math.atan2((pf.y - pb.y) * dir, Math.hypot(pf.x - pb.x, pf.z - pb.z));
      e.set(-pitch, yaw, 0, 'YXZ'); q.setFromEuler(e); M.compose(p, q, new THREE.Vector3(1, 1, 1));
      const b = KV.build(it.type);
      const im = new THREE.InstancedMesh(b.geometry, b.material, 1);
      im.setMatrixAt(0, M); im.setColorAt(0, it.paint ? new THREE.Color(it.paint) : KV.paint(it.type, it.i || 0));
      im.castShadow = im.receiveShadow = true; im.frustumCulled = false;
      K.view.scene.add(im); S.lu.push(im);
      it.s = s; s += t.hz + (gap || 1.5);
    }
    return list;
  };
  S.lineEnd = () => { if (S.lu) { for (const m of S.lu) m.removeFromParent(); S.lu = null; S.trafficVis(true); for (const o of S.hid || []) o.visible = true; S.hid = []; } };
  S.restore = () => { S.thaw1(); S.thaw2(); S.lineEnd(); S.restoreFov(); if (K.player.mesh) K.player.mesh.visible = true; };
  return true;
};

// views: { act, fn } (fn runs in the page; returns optional extra info). 'hud' views keep the HUD.
const V = {
  // ---------- Act 1
  title: { act: 0, hud: true, fn: () => { if (__K.game.state !== 'title') T.toTitle(); T.ticks(150); S.settle(6); } },
  a1start: { act: 1, fn: () => { S.follow1(-2, 0, 70); S.settle(); } },
  a1run: { act: 1, fn: () => { S.follow1(-60, -2, 10); T.key('KeyW', true); T.ticks(50); S.settle(4); T.key('KeyW', false); } },
  a1valley: { act: 1, fn: () => { S.follow1(-96, -5, 70); S.settle(); } },
  a1loop: { act: 1, fn: () => {
    const K = __K, P = K.player, lp = K.level.loops[0], yaw = T.yawOf(lp.dir.x, lp.dir.z);
    S.thaw1(); T.teleport(lp.entry.x - lp.dir.x * 18, lp.entry.z - lp.dir.z * 18, yaw, 24);
    T.pre = () => { if (!P.inLoop) T.steerYaw(yaw, 1); };
    T.until(() => P.inLoop, 120); T.until(() => P.pos.y > lp.entry.y + lp.radius * 1.2, 60);
    T.stop(); S.settle(2);
  } },
  a1loopside: { act: 1, fn: () => { S.follow1(-150, -1.5, 10); S.cam1([-172, 16, 5, -180, -1.5, 5]); S.still(); } },
  a1cliffs: { act: 1, fn: () => { S.follow1(-214, 0, 70); S.settle(); } },
  a1lake: { act: 1, fn: () => { S.follow1(-352, 0, 70); S.settle(); } },
  a1lakeside: { act: 1, fn: () => { S.follow1(-352, 0, 10); S.cam1([-366, -9, 6, -392, 4, 0]); S.still(); } },
  a1bridge: { act: 1, fn: () => { S.follow1(-421, 0, 70); S.settle(); } },
  a1boss: { act: 1, fn: () => {
    const K = __K, P = K.player, G = K.game, E = K.entities, B = K.level.boss;
    S.thaw1(); G.bossDone = false; G.cpIndex = 2; G.cpTime = 90; E.reset(); G.lives = 9;
    const cp = K.level.checkpoints[2];
    T.teleport(cp.pos.x, cp.pos.z, cp.yaw, 0);
    T.pre = () => { const dx = B.center.x - P.pos.x, dz = B.center.z - P.pos.z; T.steerYaw(T.yawOf(dx, dz), 1); };
    T.until(() => G.bossActive, 600); T.stop();
    T.bossBot({ keepRings: true, stopWhen: () => { const s = E.stats(); return E.bossInfo().hp <= 7 && s.bossFlash <= 0 && !P.onGround && Math.hypot(s.bossPos.x - P.pos.x, s.bossPos.z - P.pos.z) < 7; } });
    S.settle(1);
  } },
  a1results: { act: 1, hud: true, fn: () => {
    const K = __K, G = K.game, E = K.entities;
    if (!(K.entities.bossInfo() || {}).active) V_A1BOSS();
    const f2 = T.bossBot({ keepRings: true }); const cap = T.capsuleBot();
    T.ticks(60 * 4); S.settle(6);
    return { hp: f2.hp, cap: cap.state, state: G.state };
  } },
  // Kit close-ups (Act 1, a clear spot)
  kitface: { act: 1, fn: () => { const K = __K; S.follow1(-2, 6, 90); S.orbit(0.35, 1.3, 0.95, 0.9, 30); S.still(8); } },
  kit34: { act: 1, fn: () => { const K = __K; S.follow1(-2, 6, 90); S.orbit(0.9, 3.0, 1.0, 0.62, 33); S.still(8); } },
  kitback: { act: 1, fn: () => { const K = __K; S.follow1(-2, 6, 90); S.orbit(2.5, 2.8, 1.3, 0.62, 33); S.still(8); } },
  kitrun: { act: 1, fn: () => { S.follow1(-30, 0, 10); T.key('KeyW', true); T.ticks(40); S.orbit(1.3, 3.2, 1.0, 0.6, 38); S.freeze1(); S.settle(3); T.key('KeyW', false); S.thaw1(); } },
  kitspin: { act: 1, fn: () => { S.follow1(-20, 0, 40); T.key('ShiftLeft', true); T.ticks(10); for (let i = 0; i < 3; i++) { T.tapKey('Space'); T.ticks(8); } S.settle(2); T.key('ShiftLeft', false); T.ticks(30); } },
  // ---------- Act 2
  a2hill: { act: 2, fn: () => { S.place(S.f('iA0') + 20, 0); T.ticks(40); S.settle(); } },
  a2street: { act: 2, fn: () => { S.place(S.f('iA0') + 150, 0, 14); T.ticks(40); S.settle(); } },
  a2traffic: { act: 2, fn: () => { S.place(S.f('iA0') + 205, 0, 14); T.ticks(50); S.settle(); } },
  a2air: { act: 2, fn: () => { S.place(S.f('iA2') - 70, 0, 24); T.key('ArrowUp', true); T.until(() => __K.board.mode === 'air' && __K.board.stats().airT > 0.35, 400); T.key('ArrowUp', false); S.settle(2); } },
  a2works: { act: 2, fn: () => { S.place(S.f('iB') - 120, 0, 12); T.ticks(30); S.settle(); } },
  a2pier: { act: 2, fn: () => { S.place(S.f('bumper') - 46, 0, 12); T.ticks(20); S.settle(); } },
  a2orbit: { act: 2, fn: () => { S.toFlight(); T.ticks(70); S.settle(2); } },
  a2orbit2: { act: 2, fn: () => { S.toFlight(); T.ticks(150); S.settle(2); } },
  a2flight: { act: 2, fn: () => { S.toFlight(); T.until(() => __K.board.timeScale >= 1 && __K.board.stats().flightU > 0.38, 3000); S.settle(2); } },
  a2goal: { act: 2, fn: () => { S.toFlight(); T.until(() => __K.board.mode === 'land' || __K.game.state !== 'play', 6000); T.ticks(40); S.settle(); } },
  a2waterfront: { act: 2, fn: () => { S.place(S.f('t3b') + 40, 0, 12); T.ticks(30); S.settle(); } },
  a2skysun: { act: 2, fn: () => { const K = __K; S.place(S.f('iA0') + 20, 0); T.ticks(5); S.freeze2(); const a = K.city.routePoint(S.f('iA0') + 20, -10, 8), d = K.city.sunDir; S.camXYZ([a.x, a.y, a.z], [a.x + d.x * 100, a.y + 14, a.z + d.z * 100], 70); S.still(); } },
  a2west: { act: 2, fn: () => { const K = __K; S.place(S.f('t3b') + 60, 0, 0); T.ticks(5); S.freeze2(); const a = K.city.routePoint(S.f('t3b') + 60, 0, 2.2), d = K.city.sunDir; S.camXYZ([a.x, a.y, a.z], [a.x + d.x * 100, a.y + 4, a.z + d.z * 100], 62); S.still(); } },
  a2facade: { act: 2, fn: () => { S.place(S.f('iA1') + 40, 0); T.ticks(5); S.cam2(S.f('iA1') + 40, 4, 1.8, S.f('iA1') + 52, 12, 4.5, 55); S.still(); } },
  a2bridge: { act: 2, fn: () => { const K = __K; S.place(S.f('bumper') - 20, 0); T.ticks(5); S.freeze2(); const g = K.city.offset; S.camXYZ([g.x - 260, 22, -1560], [g.x - 600, 40, -1800], 55); S.still(); } },
  kitskate: { act: 2, fn: () => { S.place(S.f('iA0') + 30, 0, 6); T.ticks(30); S.freeze2(); S.orbit(0.7, 2.6, 0.9, 0.6, 38); S.settle(3); } },
  kitflight: { act: 2, fn: () => { S.toFlight(); T.until(() => __K.board.timeScale >= 1 && __K.board.stats().flightU > 0.3, 3000); S.freeze2(); S.orbit(0.9, 3.2, 0.6, 0.5, 40); S.settle(2); } },
  // vehicles: two line-ups (cars / big vehicles) on the waterfront + a close-up
  vehcars: { act: 2, fn: () => {
    const K = __K, LANE = 3.2, base = S.f('t3b') + 30; S.place(base - 30, 0); T.ticks(5); S.freeze2(); if (K.player.mesh) K.player.mesh.visible = false;
    const L = S.lineup(base, [{ type: 0, paint: '#c0392b' }, { type: 1 }, { type: 2, paint: '#2f6b4f' }, { type: 7, i: 0 }, { type: 0, paint: '#2e5c9a' }, { type: 6 }], -LANE, 1.6);
    const b = L[L.length - 1].s, mid = (L[0].s + b) / 2, len = b - L[0].s + 6;
    S.cam2(mid + len * 0.55, -LANE + len * 0.42, len * 0.12 + 1.5, mid + len * 0.05, -LANE, 1.0, 50); S.still(8);
  } },
  vehbig: { act: 2, fn: () => {
    const K = __K, LANE = 3.2, base = S.f('t3b') + 30; S.place(base - 30, 0); T.ticks(5); S.freeze2(); if (K.player.mesh) K.player.mesh.visible = false;
    const L = S.lineup(base, [{ type: 3 }, { type: 4 }, { type: 5 }], -LANE, 3);
    const b = L[L.length - 1].s, mid = (L[0].s + b) / 2, len = b - L[0].s + 6;
    S.cam2(mid - len * 0.55, -LANE - len * 0.4, len * 0.14 + 1.8, mid - len * 0.05, -LANE, 1.0, 50); S.still(8);
  } },
  vehclose: { act: 2, fn: () => {
    const K = __K, LANE = 3.2, base = S.f('t3b') + 30; S.place(base - 30, 0); T.ticks(5); S.freeze2(); if (K.player.mesh) K.player.mesh.visible = false;
    const L = S.lineup(base, [{ type: 0, paint: '#c0392b' }], -LANE, 1.6);
    const s = L[0].s; S.cam2(s + 4.2, -LANE + 3.6, 1.5, s + 0.3, -LANE, 0.75, 45); S.still(8);
  } },
  // pause menu (HUD) in Act 1 play
  pause: { act: 1, hud: true, fn: () => { S.follow1(-30, 0, 30); T.tapKey('Escape'); T.ticks(3); S.settle(1); T.renderNow(); } },
  unpause: { act: 1, fn: () => { if (__K.game.paused) { T.tapKey('Escape'); T.ticks(3); } } },
  loading2: { act: 0, hud: true, fn: () => { const G = __K.game; if (G.state !== 'title') T.toTitle(); T.ticks(30); if (G.sel !== 2) { T.key('ArrowRight', true); T.ticks(3); T.key('ArrowRight', false); T.ticks(3); } T.tapKey('Space'); T.ticks(12); T.renderNow(); return { state: G.state, p: G.loadP }; } }
};
const V_A1BOSS_SRC = V.a1boss.fn.toString();

(async () => {
  const views = (arg('views') || 'a1start').split(',').filter(Boolean);
  const prefix = arg('prefix') || '';
  const outDir = path.resolve(arg('out') || path.join(__dirname, 'shots'));
  fs.mkdirSync(outDir, { recursive: true });
  const srv = await serve(path.join(__dirname, '../..'), 0);
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  if (WEBGPU) args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader');
  const b = await chromium.launch({ args });
  const W = +(arg('w') || 1280), H = +(arg('h') || 720);
  const ctx = await b.newContext(PHONE ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: W, height: H } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + (e.stack || e.message).slice(0, 1500)));
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver Message|index count of 0|outsideRenderPass/.test(t))) errs.push(m.type() + ': ' + t.slice(0, 1500)); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.addInitScript(RAF_SHIM);
  await p.addInitScript({ path: path.join(__dirname, '../../test/page-helpers.js') });
  const page = arg('page') || 'dev/integrator/site/test.html';
  const q = arg('q') != null ? arg('q') : (WEBGPU ? '' : '?gl');
  const t0 = Date.now();
  await p.goto(srv.url + page + q);
  await p.waitForFunction(() => (window.__K && window.__K.game && window.__K.game.booted) || !document.getElementById('fatal').hidden, null, { timeout: 900000, polling: 250 });
  const bootMs = Date.now() - t0;
  const preset = arg('preset') || (PHONE ? 'medium' : 'high');
  const setup = await p.evaluate(({ preset, sr }) => {
    const K = window.__K;
    window.__installT();
    if (K.post && K.post.setQuality) { K.post.setQuality(preset); if (sr != null) K.post.setSuperRes(sr); }
    return { q: K.post && K.post.quality, sr: K.post && K.post.superRes, backend: K.view.backend, W: K.view.W, H: K.view.H, dpr: K.view.dpr };
  }, { preset, sr: flag('sr') ? true : flag('nosr') ? false : null });
  await p.evaluate(STAGE);
  await p.evaluate('window.V_A1BOSS = ' + V_A1BOSS_SRC);
  console.log('boot', bootMs, 'ms', JSON.stringify(setup));
  const results = { setup, bootMs };
  for (const name of views) {
    const v = V[name];
    if (!v) { console.log('unknown view', name); continue; }
    const t1 = Date.now();
    try {
      const res = await p.evaluate(async ({ act, hud, src }) => {
        const K = window.__K;
        S.restore();
        if (act) S.act(act);
        if (act === 2) { await K.tex.preloadGroup('act2'); await new Promise(r => setTimeout(r, 50)); }
        S.hud(!!hud);
        const extra = (new Function('return ' + src))()();
        const d = T.drawStats(), tx = K.tex.stats(), ps = K.post && K.post.ok ? K.post.stats() : {};
        return { calls: d.calls, tris: d.tris, frameCalls: d.frameCalls, state: K.game.state, act: K.game.act, mode: K.board && K.board.mode, extra,
          tex: { n: tx.count, loaded: tx.loaded, mb: +(tx.gpuBytes / 1048576).toFixed(1), res: tx.res }, post: { q: ps.quality, sr: ps.superRes, internal: ps.internal, passes: (ps.passes || []).length } };
      }, { act: v.act, hud: !!v.hud || flag('hud'), src: v.fn.toString() });
      await p.screenshot({ path: path.join(outDir, prefix + name + '.png'), timeout: 240000 });
      results[name] = res;
      console.log('[' + name + '] ' + (Date.now() - t1) + ' ms ' + JSON.stringify(res));
    } catch (e) { console.log('[' + name + '] FAILED ' + String(e).slice(0, 600)); results[name] = { err: String(e).slice(0, 300) }; }
  }
  await p.evaluate(() => S.restore()).catch(() => {});
  results.errors = errs.slice(0, 20);
  if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify(results, null, 1));
  console.log('ERRORS (' + errs.length + '):\n' + errs.slice(0, 15).join('\n---\n'));
  await b.close(); await srv.close();
})().catch(e => { console.error(e); process.exit(1); });
