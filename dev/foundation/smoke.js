const { chromium } = require('playwright');
const { serve } = require('../../test/serve.js');
(async () => {
  const srv = await serve(require('path').join(__dirname, '../..'));
  const webgpu = process.argv.includes('--webgpu');
  const args = webgpu ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const b = await chromium.launch({ args });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  const page = process.argv.find(a => a.endsWith('.html')) || 'dev/foundation/smoke.html';
  await p.goto(srv.url + page + (webgpu ? '' : '?gl'));
  try { await p.waitForFunction(() => window.__res, null, { timeout: 60000 }); } catch (e) { console.log('TIMEOUT', errs.join('\n')); await b.close(); await srv.close(); return; }
  console.log(JSON.stringify(await p.evaluate(() => window.__res)));
  await p.screenshot({ path: __dirname + '/smoke' + (webgpu ? '-gpu' : '') + '.png' });
  console.log(errs.slice(0, 10).join('\n'));
  await b.close(); await srv.close();
})();
