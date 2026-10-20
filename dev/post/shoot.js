// dev harness (post role): boots test.html once (WebGL 2 unless --webgpu), installs the e2e page helpers, then runs the
// steps of a steps file (CommonJS: module.exports = [{ name, code: 'js body (may return)', shot: true|false }]),
// taking a screenshot after each step that asks for one: dev/post/shots/<prefix><name>.png.
// usage: node dev/post/shoot.js --steps=dev/post/steps-a1.js [--prefix=gl-] [--webgpu] [--phone] [--q=?gl] [--w=1280 --h=720]
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const { serve } = require('../../test/serve.js');
const arg = n => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : null; };
const WEBGPU = process.argv.includes('--webgpu'), PHONE = process.argv.includes('--phone');
const RAF_SHIM = `(() => { const q = []; window.requestAnimationFrame = cb => { q.push(cb); return q.length; }; window.cancelAnimationFrame = () => {};
  let t = 0; window.__pump = ms => { if (!t) t = performance.now(); t += ms; const l = q.splice(0); for (const cb of l) cb(t); }; })();`;
(async () => {
  const steps = require(path.resolve(arg('steps')));
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
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver Message|index count of 0/.test(t)) || t.startsWith('LOG')) errs.push(m.type() + ': ' + t.slice(0, 1500)); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.addInitScript(RAF_SHIM);
  await p.addInitScript({ path: path.join(__dirname, '../../test/page-helpers.js') });
  const q = arg('q') != null ? arg('q') : (WEBGPU ? '' : '?gl');
  const t0 = Date.now();
  await p.goto(srv.url + (arg('page') || 'dev/post/site/test.html') + q);
  await p.waitForFunction(() => (window.__K && window.__K.game && window.__K.game.booted) || !document.getElementById('fatal').hidden, null, { timeout: 900000, polling: 250 });
  console.log('boot', Date.now() - t0, 'ms');
  await p.evaluate(() => window.__installT());
  const results = {};
  for (const st of steps) {
    const t1 = Date.now();
    let res;
    try { res = await p.evaluate(new Function('return (async () => { ' + st.code + ' })()')); }
    catch (e) { res = 'STEP ERROR: ' + String(e.message || e).slice(0, 800); }
    if (st.shot) await p.screenshot({ path: path.join(out, prefix + st.name + '.png'), timeout: 180000 });
    results[st.name] = res;
    console.log('[' + st.name + '] ' + (Date.now() - t1) + ' ms ' + JSON.stringify(res === undefined ? null : res).slice(0, 1500));
  }
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(results, null, 1));
  console.log('ERRORS (' + errs.length + '):\n' + errs.slice(0, 15).join('\n---\n'));
  await b.close(); await srv.close();
})().catch(e => { console.error(e); process.exit(1); });
