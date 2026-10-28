// integrator probe runner: boots a test page (default dev/integrator/site/test.html, WebGL 2 unless --webgpu) with the
// e2e page helpers, runs a snippet (--eval="..." or --file=path; async allowed, `return` the result), optional --shot.
// usage: node dev/integrator/run.js --eval="T.ticks(40); return __K.game.state" [--page=test.html] [--webgpu]
//        [--phone] [--q=?gl&nopost] [--shot=dev/integrator/shots/x.png] [--w=1280 --h=720] [--warn] [--init=js before load]
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const { serve } = require('../../test/serve.js');
const arg = n => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : null; };
const WEBGPU = process.argv.includes('--webgpu'), PHONE = process.argv.includes('--phone');
const RAF_SHIM = `(() => { const q = []; window.requestAnimationFrame = cb => { q.push(cb); return q.length; }; window.cancelAnimationFrame = () => {};
  let t = 0; window.__pump = ms => { if (!t) t = performance.now(); t += ms; const l = q.splice(0); for (const cb of l) cb(t); }; })();`;
(async () => {
  const srv = await serve(path.join(__dirname, '../..'), 0);
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  if (WEBGPU) args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader');
  const b = await chromium.launch({ args });
  const ctx = await b.newContext(PHONE ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
    : { viewport: { width: +(arg('w') || 1280), height: +(arg('h') || 720) } });
  const p = await ctx.newPage();
  const errs = [];
  const WARN = process.argv.includes('--warn');
  p.on('pageerror', e => errs.push('pageerror: ' + (e.stack || e.message).slice(0, 1500)));
  p.on('console', m => {
    const t = m.text();
    if (t.startsWith('LOG')) console.log(t);
    if (m.type() === 'error' || (WARN && m.type() === 'warning' && !/GL Driver Message|index count of 0|outsideRenderPass/.test(t))) errs.push(m.type() + ': ' + t.slice(0, 1500));
  });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.addInitScript(RAF_SHIM);
  if (arg('init')) await p.addInitScript(arg('init'));
  await p.addInitScript({ path: path.join(__dirname, '../../test/page-helpers.js') });
  const page = arg('page') || 'dev/integrator/site/test.html';
  const q = arg('q') != null ? arg('q') : (WEBGPU ? '' : '?gl');
  const t0 = Date.now();
  await p.goto(srv.url + page + q);
  await p.waitForFunction(() => (window.__K && window.__K.game && window.__K.game.booted) || !document.getElementById('fatal').hidden, null, { timeout: 900000, polling: 250 });
  console.log('boot', Date.now() - t0, 'ms');
  await p.evaluate(() => window.__installT());
  let code = arg('eval');
  if (arg('file')) code = fs.readFileSync(arg('file'), 'utf8');
  if (code) {
    const res = await p.evaluate(new Function('return (async () => { ' + code + ' })()'));
    if (arg('out')) fs.writeFileSync(arg('out'), typeof res === 'string' ? res : JSON.stringify(res, null, 1));
    console.log(JSON.stringify(res, null, 0).slice(0, 8000));
  }
  if (arg('shot')) { await p.screenshot({ path: arg('shot'), timeout: 240000 }); }
  console.log('ERRORS (' + errs.length + '):\n' + errs.slice(0, 12).join('\n---\n'));
  await b.close(); await srv.close();
})().catch(e => { console.error(e); process.exit(1); });
