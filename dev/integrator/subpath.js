// the shipped index.html served from a sub-path (like GitHub Pages' /Pat3d/): boots to the title with no failed
// request, then Act 2 through the real title screen (keyboard); reports the bytes downloaded for Act 1 and for Act 2.
// usage: node dev/integrator/subpath.js [--webgpu] [--phone]
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const { serve } = require('../../test/serve.js');
const WEBGPU = process.argv.includes('--webgpu'), PHONE = process.argv.includes('--phone');
(async () => {
  const R = path.resolve(__dirname, '../..');
  const site = path.join(__dirname, 'subsite');
  fs.mkdirSync(site, { recursive: true });
  const link = path.join(site, 'Pat3d');
  if (!fs.existsSync(link)) fs.symlinkSync(R, link);
  const srv = await serve(site, 0);
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  if (WEBGPU) args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader');
  const b = await chromium.launch({ args });
  const ctx = await b.newContext(PHONE ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  const errs = [], bad = [], got = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 300)); });
  p.on('response', r => { const u = r.url(); if (r.status() >= 400 && !/fonts\.g/.test(u)) bad.push(r.status() + ' ' + u); });
  p.on('requestfinished', async rq => { try { const r = await rq.response(); const body = r ? await r.body() : null; got.push([rq.url().replace(srv.url, '/'), body ? body.length : 0, Date.now()]); } catch (e) { /* ignore */ } });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const url = srv.url + 'Pat3d/' + (WEBGPU ? '' : '?gl');
  const t0 = Date.now();
  await p.goto(url, { waitUntil: 'load', timeout: 120000 });
  // the shipped page has no test hooks: wait for the title screen (the HUD canvas shows the act chips) or the error
  // (the title's help text rewrites the canvas' accessible name, the shell's initial one says "Flèches pour courir")
  await p.waitForFunction(() => !document.getElementById('fatal').hidden || !/\. Flèches pour courir/.test(document.getElementById('hud').getAttribute('aria-label') || ''), null, { timeout: 900000, polling: 500 });
  await p.waitForTimeout(4000);
  const bootMs = Date.now() - t0;
  const fatal = await p.evaluate(() => !document.getElementById('fatal').hidden);
  const n1 = got.length, bytes1 = got.reduce((a, g) => a + g[1], 0);
  await p.screenshot({ path: path.join(__dirname, 'shots', 'subpath-title' + (WEBGPU ? '-gpu' : '') + '.png') });
  // Act 2 from the title: right arrow, then Space; wait for the city requests to settle
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(800);
  await p.keyboard.press('Space');
  let last = got.length, still = 0;
  for (let i = 0; i < 240 && still < 12; i++) { await p.waitForTimeout(1000); if (got.length === last) still++; else { still = 0; last = got.length; } }
  await p.waitForTimeout(3000);
  await p.screenshot({ path: path.join(__dirname, 'shots', 'subpath-act2' + (WEBGPU ? '-gpu' : '') + '.png') });
  const act2 = got.slice(n1), bytes2 = act2.reduce((a, g) => a + g[1], 0);
  const MB = 1048576;
  const out = { url, bootMs, fatal, errors: errs.slice(0, 5), failedRequests: bad.slice(0, 10),
    act1: { requests: n1, MB: +(bytes1 / MB).toFixed(2), textures: got.slice(0, n1).filter(g => /\.webp/.test(g[0])).length },
    act2: { requests: act2.length, MB: +(bytes2 / MB).toFixed(2), files: act2.map(g => g[0].replace(/^.*\/assets\//, 'assets/')).slice(0, 20) },
    legacyLink: await p.evaluate(() => { const a = document.querySelector('#fatal a'); return a && a.href; }) };
  // the classic version under the same sub-path (three r128 from the CDN: blocked here, only the page itself is checked)
  const lp = await ctx.newPage();
  const lr = await lp.goto(srv.url + 'Pat3d/legacy/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => null);
  out.legacy = { status: lr && lr.status(), title: lr ? await lp.title() : '' };
  console.log(JSON.stringify(out, null, 1));
  await b.close(); await srv.close();
})().catch(e => { console.error(e); process.exit(1); });
