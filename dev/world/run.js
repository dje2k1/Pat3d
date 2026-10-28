// dev harness: boots test.html (WebGL 2 backend unless --webgpu) with the e2e page helpers (deterministic rAF, T.*),
// runs a JS snippet in the page (string after --eval, or a file with --file), optional screenshot (--shot=path).
// usage: node dev/foundation/run.js --eval="T.ticks(40); return __K.game.state" --shot=dev/foundation/shots/x.png [--webgpu] [--phone] [--q=?gl&nopost]
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const { serve } = require('../../test/serve.js');
const arg = n => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : null; };
const WEBGPU = process.argv.includes('--webgpu');
const RAF_SHIM = `(() => { const q = []; window.requestAnimationFrame = cb => { q.push(cb); return q.length; }; window.cancelAnimationFrame = () => {};
  let t = 0; window.__pump = ms => { if (!t) t = performance.now(); t += ms; const l = q.splice(0); for (const cb of l) cb(t); }; })();`;
(async () => {
  const srv = await serve(path.join(__dirname, '../..'), 0);
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  if (WEBGPU) args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader');
  const b = await chromium.launch({ args });
  const phone = process.argv.includes('--phone');
  const ctx = await b.newContext(phone ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + (e.stack || e.message).slice(0, 1500)));
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('LOG')) errs.push(m.type() + ': ' + m.text().slice(0, 1500)); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.addInitScript(RAF_SHIM);
  await p.addInitScript({ path: path.join(__dirname, '../../test/page-helpers.js') });
  const q = arg('q') != null ? arg('q') : (WEBGPU ? '' : '?gl');
  const t0 = Date.now();
  await p.goto(srv.url + (arg('page') || 'dev/world/site/test.html') + q);
  await p.waitForFunction(() => (window.__K && window.__K.game && window.__K.game.booted) || !document.getElementById('fatal').hidden, null, { timeout: 900000, polling: 250 });
  console.log('boot', Date.now() - t0, 'ms');
  await p.evaluate(() => window.__installT());
  let code = arg('eval');
  if (arg('file')) code = fs.readFileSync(arg('file'), 'utf8');
  if (code) {
    const shots = (arg('shots') || '').split(',').filter(Boolean);
    const res = await p.evaluate(new Function('return (async () => { ' + code + ' })()'));
    if (arg('out')) fs.writeFileSync(arg('out'), typeof res === 'string' ? res : JSON.stringify(res, null, 1));
    console.log(JSON.stringify(res, null, 0).slice(0, 6000));
  }
  if (arg('shot')) { await p.evaluate(() => T.frame()); await p.screenshot({ path: arg('shot'), timeout: 240000 }); }
  console.log('ERRORS (' + errs.length + '):\n' + errs.slice(0, 12).join('\n---\n'));
  await b.close(); await srv.close();
})();
