// A/B of the sun glare terms on the flight view (looking into the low sun): screenshots per variant
const { chromium } = require('playwright');
const path = require('path');
const { serve } = require('../../test/serve.js');
const RAF_SHIM = `(() => { const q = []; window.requestAnimationFrame = cb => { q.push(cb); return q.length; }; window.cancelAnimationFrame = () => {};
  let t = 0; window.__pump = ms => { if (!t) t = performance.now(); t += ms; const l = q.splice(0); for (const cb of l) cb(t); }; })();`;
const VAR = JSON.parse(process.argv[2] || '{"base":{}}');
const VIEW = process.argv[3] || 'flight';
(async () => {
  const srv = await serve(path.join(__dirname, '../..'), 0);
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.addInitScript(RAF_SHIM);
  await p.addInitScript({ path: path.join(__dirname, '../../test/page-helpers.js') });
  await p.goto(srv.url + 'dev/integrator/site/test.html?gl');
  await p.waitForFunction(() => window.__K && window.__K.game && window.__K.game.booted, null, { timeout: 900000, polling: 250 });
  await p.evaluate(async (VIEW) => {
    window.__installT();
    const K = __K, G = K.game, P = K.player, C = K.city, B = K.board;
    document.getElementById('hud').style.visibility = 'hidden';
    T.ticks(30); T.key('ArrowRight', true); T.ticks(3); T.key('ArrowRight', false); T.ticks(3); T.tapKey('Space'); T.ticks(4);
    T.until(() => G.state === 'card', 600); T.until(() => G.state === 'play', 600);
    await K.tex.preloadGroup('act2');
    if (VIEW === 'flight') {
      T.place2(C.feature('bumper') - 60, 0, 30); P.invT = 0; T.key('ArrowUp', true); T.until(() => B.mode === 'flight', 600); T.key('ArrowUp', false);
      T.until(() => B.timeScale >= 1 && B.stats().flightU > 0.38, 3000);
    } else if (VIEW === 'waterfront') { T.place2(C.feature('t3b') + 40, 0, 12); T.ticks(30); P.invT = 0; T.ticks(2); }
    else if (VIEW === 'pier') { T.place2(C.feature('bumper') - 46, 0, 12); T.ticks(20); P.invT = 0; T.ticks(2); }
    window.__freeze = () => { const f = B.camera; B.camera = () => {}; return f; };
    window.__freeze();
    for (let i = 0; i < 2; i++) T.frame();
  }, VIEW);
  for (const [name, v] of Object.entries(VAR)) {
    const st = await p.evaluate(v => {
      const U = __K.post.uniforms, L = __K.post.look;
      const keep = {};
      for (const k in v) { if (k in U) { keep[k] = U[k].value; U[k].value = v[k]; } }
      __K.post._override = v;
      for (let i = 0; i < 6; i++) T.renderNow();
      const g = T.glStats();
      for (const k in keep) U[k].value = keep[k];
      return { mean: g.mean, std: g.std, sunVis: __K.post.stats().sunVis };
    }, v);
    await p.screenshot({ path: path.join(__dirname, 'shots', 'glare-' + VIEW + '-' + name + '.png') });
    console.log(name, JSON.stringify(st));
  }
  await b.close(); await srv.close();
})();
