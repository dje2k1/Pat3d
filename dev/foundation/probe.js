// dev probe: boots test.html, reports errors, takes screenshots. usage: node probe.js [--webgpu] [--act2] [--play] [--phone]
const { chromium } = require('playwright');
const path = require('path');
const { serve } = require('../../test/serve.js');
const argv = process.argv.slice(2);
const WEBGPU = argv.includes('--webgpu');
(async () => {
  const srv = await serve(path.join(__dirname, '../..'));
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  if (WEBGPU) args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader');
  const b = await chromium.launch({ args });
  const phone = argv.includes('--phone');
  const ctx = await b.newContext(phone ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + (e.stack || e.message).slice(0, 1500)));
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 1500)); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const t0 = Date.now();
  await p.goto(srv.url + 'test.html' + (WEBGPU ? '' : '?gl'));
  try {
    await p.waitForFunction(() => (window.__K && window.__K.game && window.__K.game.booted) || !document.getElementById('fatal').hidden, null, { timeout: 180000 });
  } catch (e) { console.log('TIMEOUT waiting for boot'); }
  console.log('boot ms', Date.now() - t0);
  const st = await p.evaluate(() => { const K = window.__K; return K && { state: K.game.state, backend: K.view.backend, ok: K.view.ok, post: K.post.stats(), fatal: !document.getElementById('fatal').hidden, tex: K.tex && K.tex.stats() }; });
  console.log(JSON.stringify(st));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(__dirname, 'shots', 'title' + (WEBGPU ? '-gpu' : '') + (phone ? '-phone' : '') + '.png') });
  if (argv.includes('--play')) {
    await p.keyboard.press('Space');
    await p.waitForTimeout(3500);
    await p.keyboard.down('KeyW');
    await p.waitForTimeout(2500);
    await p.screenshot({ path: path.join(__dirname, 'shots', 'play' + (WEBGPU ? '-gpu' : '') + '.png') });
    await p.keyboard.up('KeyW');
    console.log(JSON.stringify(await p.evaluate(() => ({ state: __K.game.state, pos: __K.player.pos.toArray().map(v => +v.toFixed(1)), stats: __K.view.stats }))));
  }
  if (argv.includes('--act2')) {
    await p.evaluate(() => { __K.game.state = 'title'; });
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300);
    await p.keyboard.press('Space');
    await p.waitForFunction(() => __K.game.state === 'card' || __K.game.state === 'play' || __K.game.state === 'end', null, { timeout: 180000 }).catch(() => console.log('act2 timeout'));
    await p.waitForTimeout(4000);
    await p.screenshot({ path: path.join(__dirname, 'shots', 'act2' + (WEBGPU ? '-gpu' : '') + '.png') });
    console.log(JSON.stringify(await p.evaluate(() => ({ state: __K.game.state, act: __K.game.act, stats: __K.view.stats }))));
  }
  console.log('ERRORS (' + errs.length + '):\n' + errs.slice(0, 12).join('\n---\n'));
  await b.close(); await srv.close();
})();
