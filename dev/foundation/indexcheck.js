const { chromium } = require('playwright');
const path = require('path');
const { serve } = require('../../test/serve.js');
(async () => {
  const srv = await serve(path.join(__dirname, '../..'));
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.goto(srv.url + '?gl');
  await p.waitForTimeout(60000);
  const st = await p.evaluate(() => {
    const cv = document.getElementById('hud'), g = cv.getContext('2d'), d = g.getImageData(0, 0, cv.width, cv.height).data;
    let on = 0, n = 0; for (let i = 3; i < d.length; i += 4 * 53) { n++; if (d[i] > 40) on++; }
    return { K: typeof window.__K, fatal: !document.getElementById('fatal').hidden, hud: +(on / n).toFixed(3), title: document.title, lang: document.documentElement.lang };
  });
  await p.screenshot({ path: path.join(__dirname, 'shots', 'index.png') });
  console.log(JSON.stringify(st), errs.slice(0, 5));
  await b.close(); await srv.close();
})();
