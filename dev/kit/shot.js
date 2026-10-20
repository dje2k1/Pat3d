// KIT role probe: boots test.html (WebGL 2 unless --webgpu), stages Kit in poses and takes close-up / in-game shots.
// usage: node dev/kit/shot.js --scenes=turn,run,jump,spin,hurt,game,skate,flight [--q=ultra|high|medium|low]
//        [--webgpu] [--phone] [--hud] [--prefix=dev/kit/shots/x] [--nopost] [--stats]
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const { serve } = require('../../test/serve.js');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : d; };
const flag = n => process.argv.includes('--' + n);
const WEBGPU = flag('webgpu'), PHONE = flag('phone');
const RAF_SHIM = `(() => { const q = []; window.requestAnimationFrame = cb => { q.push(cb); return q.length; }; window.cancelAnimationFrame = () => {};
  let t = 0; window.__pump = ms => { if (!t) t = performance.now(); t += ms; const l = q.splice(0); for (const cb of l) cb(t); }; })();`;

// in-page staging helpers (installed after boot)
const KS_SRC = () => {
  const K = __K, G = K.game, P = K.player, V3 = THREE.Vector3;
  const KS = window.KS = {};
  KS.hud = on => { document.getElementById('hud').style.visibility = on ? 'visible' : 'hidden'; for (const e of document.querySelectorAll('#touch, .tool, #tools, #ui')) e.style.visibility = on ? 'visible' : 'hidden'; };
  KS.play = () => {
    if (G.state === 'title') { T.ticks(40); T.tapKey('Space'); T.ticks(4); }
    T.until(() => G.state === 'play', 600);
    return G.state;
  };
  KS.act2 = () => {
    if (G.state !== 'title') T.toTitle();
    T.ticks(40);
    T.key('ArrowRight', true); T.ticks(3); T.key('ArrowRight', false); T.ticks(3);
    T.tapKey('Space'); T.ticks(2);
    T.until(() => G.state === 'card', 400); T.until(() => G.state === 'play', 600);
    // the card waits at most 4 s of wall time for the act2 textures, and synchronous ticks starve the event loop:
    // let them arrive before any close-up
    return K.tex.preloadGroup('act2').then(() => new Promise(r => setTimeout(r, 50))).then(() => ({ state: G.state, act: G.act }));
  };
  // camera at (yaw angle a around Kit, distance d, height h above feet), looking at Kit's centre (+ty)
  KS.orbit = (a, d, h, ty, fov) => {
    const cam = K.view.camera, c = P.pos;
    const f = P.forward;
    const fy = Math.atan2(f.x, f.z);
    const ang = fy + a;
    cam.position.set(c.x + Math.sin(ang) * d, c.y + h, c.z + Math.cos(ang) * d);
    cam.lookAt(c.x, c.y + (ty == null ? 0.6 : ty), c.z);
    cam.fov = fov || 35; cam.updateProjectionMatrix();
    // several draws from the same camera: motion blur (camera velocity) and TRAA history settle
    for (let i = 0; i < 4; i++) KS.render();
    return true;
  };
  // the renderer's node frame only advances inside its own rAF callback: pump a zero-length frame before each draw
  KS.render = () => { window.__pump(0); T.renderNow(); };
  // a flat open spot near the start with no ring / entity within 7 m (close-ups)
  KS.stage = (yaw) => {
    const L = K.level, rings = L.rings || [];
    let best = null;
    for (let x = -14; x <= 14; x += 2) for (let z = 6; z >= -40; z -= 2) {
      const g = K.world.ground(x, z, 1e4); if (!g || g.n.y < 0.97) continue;
      let dmin = 1e9;
      for (const r of rings) dmin = Math.min(dmin, Math.hypot(r.x - x, r.z - z));
      for (const k of ['enemies', 'springs', 'monitors', 'dashPanels']) for (const e of (L[k] || [])) dmin = Math.min(dmin, Math.hypot(e.pos.x - x, e.pos.z - z));
      const sc = dmin - Math.abs(x) * 0.05;
      if (!best || sc > best.sc) best = { x, z, sc, dmin };
    }
    T.teleport(best.x, best.z, yaw || 0, 0);
    return best;
  };
  KS.restoreFov = () => { const cam = K.view.camera; cam.fov = 62; cam.updateProjectionMatrix(); };
  // Kit's own cost: render with and without every kit object
  KS.kitCost = () => {
    const sc = K.view.scene, objs = sc.children.filter(o => /^kit/.test(o.name || ''));
    KS.render(); const a = T.drawStats();
    const vis = objs.map(o => o.visible); objs.forEach(o => (o.visible = false));
    KS.render(); const b = T.drawStats();
    objs.forEach((o, i) => (o.visible = vis[i]));
    KS.render();
    return { names: objs.map(o => o.name + (o.visible ? '' : '(hidden)')), calls: a.calls - b.calls, tris: a.tris - b.tris, total: a };
  };
  return true;
};

(async () => {
  const srv = await serve(path.join(__dirname, '../..'));
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  if (WEBGPU) args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader');
  const b = await chromium.launch({ args });
  const ctx = await b.newContext(PHONE ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: +arg('w', 1280), height: +arg('h', 720) } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + (e.stack || e.message).slice(0, 1500)));
  p.on('console', m => { const t = m.text(); if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|index count of 0/.test(t)) errs.push(m.type() + ': ' + t.slice(0, 1500)); if (t.startsWith('LOG')) console.log(t); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.addInitScript(RAF_SHIM);
  await p.addInitScript({ path: path.join(__dirname, '../../test/page-helpers.js') });
  let q = WEBGPU ? '' : '?gl';
  if (flag('nopost')) q += (q ? '&' : '?') + 'nopost';
  const t0 = Date.now();
  await p.goto(srv.url + arg('site', '') + 'test.html' + q); // --site=dev/kit/site/ (private build, dev/kit/mkbuild.sh)
  await p.waitForFunction(() => (window.__K && window.__K.game && window.__K.game.booted) || !document.getElementById('fatal').hidden, null, { timeout: 900000, polling: 250 });
  console.log('boot', Date.now() - t0, 'ms', WEBGPU ? 'webgpu' : 'webgl2');
  await p.evaluate(() => window.__installT());
  await p.evaluate(KS_SRC);
  const ev = (fn, a) => p.evaluate(fn, a);
  const qual = arg('q', 'high');
  await ev(q2 => { __K.post.setQuality(q2); }, qual);
  console.log('backend', await ev(() => __K.view.backend), 'quality', await ev(() => __K.post.quality));
  const prefix = arg('prefix', 'dev/kit/shots/k');
  const hud = flag('hud');
  const shot = async name => { const f = prefix + '-' + name + '.png'; await p.screenshot({ path: f, timeout: 240000 }); console.log('shot', f); };
  const scenes = (arg('scenes', 'turn')).split(',');
  const stats = {};
  for (const sc of scenes) {
    const t1 = Date.now();
    if (sc === 'turn' || sc === 'face' || sc === 'idle') {
      await ev(([h, at]) => { KS.play(); KS.hud(h); const a = at || [0, 24, 3.1]; T.teleport(a[0], a[1], a[2] || 0, 0); T.ticks(90); }, [hud, arg('at') ? arg('at').split(',').map(Number) : null]);
      if (sc === 'face') {
        for (const [i, a] of [[0, 0], [1, 0.6], [2, -1.2]]) { await ev(a2 => KS.orbit(a2, 1.25, 0.95, 0.9, 30), a); await shot('face' + i); }
      } else if (sc === 'idle') {
        await ev(() => KS.orbit(0.5, 2.6, 1.1, 0.6, 35)); await shot('idle');
      } else {
        const angs = (arg('angles', '0,60,120,180,240,300')).split(',').map(Number);
        for (const a of angs) { await ev(a2 => KS.orbit(a2 * Math.PI / 180, 3.0, 0.9, 0.62, 33), a); await shot('turn' + a); }
      }
      stats[sc] = await ev(() => Object.assign(KS.kitCost(), { look: __K.player.lookStats() }));
    } else if (sc === 'title') {
      await ev(h => { if (__K.game.state !== 'title') T.toTitle(); KS.hud(h); KS.restoreFov(); T.ticks(150); KS.render(); KS.render(); }, hud);
      await shot('title');
      stats[sc] = await ev(() => Object.assign(KS.kitCost(), { look: __K.player.lookStats() }));
    } else if (sc === 'shimmer') {
      // temporal stability of Kit's pixels with a still camera: only the TRAA jitter changes between frames.
      // Reports the mean per-pixel temporal std (luma, 0..255) over Kit's screen box for the fur on and off.
      const res = await ev(async () => {
        KS.play(); KS.hud(false); T.teleport(0, 24, 3.1, 0); T.ticks(60);
        const out = {};
        for (const [tag, d, h] of [['near', 2.6, 0.9], ['play', 7.6, 2.4]]) {
          for (const fur of [true, false]) {
            const P = __K.player, sh = P.lookStats().furShells;
            if (!fur) __K.gfx.onChange && (window.__furOff = true);
            const kit = __K.view.scene.children.find(o => o.name === 'kit');
            const furMesh = kit.getObjectByName('kit-fur'); const was = furMesh.visible; furMesh.visible = fur && was;
            KS.orbit(0.5, d, h, 0.6, tag === 'near' ? 35 : 62);
            // Kit's screen box
            const cam = __K.view.camera, V = new THREE.Vector3(), W = __K.view.renderer.domElement.width, H = __K.view.renderer.domElement.height;
            let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
            for (const [dx, dy, dz] of [[-0.5, 0, -0.8], [0.5, 0, -0.8], [-0.5, 1.3, -0.8], [0.5, 1.3, -0.8], [-0.5, 0, 0.5], [0.5, 0, 0.5], [-0.5, 1.3, 0.5], [0.5, 1.3, 0.5]]) {
              V.set(P.pos.x + dx, P.pos.y + dy, P.pos.z + dz).project(cam);
              const sx = (V.x * 0.5 + 0.5) * W, sy = (0.5 - V.y * 0.5) * H;
              x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
            }
            x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
            const w = x1 - x0, hh = y1 - y0, n = w * hh, sum = new Float32Array(n), sum2 = new Float32Array(n);
            const F = 12;
            for (let f = 0; f < 4; f++) { window.__pump(0); T.renderNow(); } // let the history settle
            for (let f = 0; f < F; f++) {
              window.__pump(0);
              const { px } = T.pixels(x0, y0, w, hh);
              for (let i = 0; i < n; i++) { const l = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]; sum[i] += l; sum2[i] += l * l; }
            }
            let acc = 0, hi = 0;
            for (let i = 0; i < n; i++) { const m = sum[i] / F, v = Math.max(0, sum2[i] / F - m * m), sd = Math.sqrt(v); acc += sd; if (sd > 6) hi++; }
            out[tag + (fur ? '_fur' : '_nofur')] = { box: [x0, y0, w, hh], meanStd: +(acc / n).toFixed(2), over6: +(hi / n).toFixed(4) };
            furMesh.visible = was;
          }
        }
        return out;
      });
      console.log('SHIMMER', JSON.stringify(res));
    } else if (sc === 'powers') {
      await ev(h => { KS.play(); KS.hud(h); T.teleport(0, 24, 3.1, 0); T.ticks(10); __K.player.shield = true; T.ticks(30); }, hud);
      await ev(() => KS.orbit(0.6, 3.2, 0.9, 0.6, 35)); await shot('shield');
      await ev(() => { const P = __K.player; P.shield = false; T.teleport(0, 10, 0, 16); P.star = 12; P.shoes = 12; T.move = { x: 0, y: 1 }; T.ticks(40); });
      await ev(() => KS.orbit(1.3, 4.2, 1.2, 0.6, 40)); await shot('starshoes');
      await ev(() => { T.move = null; const P = __K.player; P.star = 0; P.shoes = 0; T.ticks(30); });
    } else if (sc === 'run' || sc === 'peel') {
      await ev(([h, sp]) => { KS.play(); KS.hud(h); T.teleport(0, 10, 0, sp); T.move = { x: 0, y: 1 }; T.ticks(40); }, [hud, sc === 'peel' ? 24 : 13]);
      await ev(() => KS.orbit(0.9, 2.8, 0.9, 0.6, 38)); await shot(sc);
      await ev(() => { T.move = null; });
    } else if (sc === 'jump') {
      await ev(h => { KS.play(); KS.hud(h); T.teleport(0, 10, 0, 12); T.move = { x: 0, y: 1 }; T.ticks(20); T.key('Space', true); T.ticks(12); }, hud);
      await ev(() => KS.orbit(1.2, 3.2, 0.4, 0.5, 38)); await shot('jump');
      await ev(() => { T.key('Space', false); T.move = null; T.ticks(60); });
    } else if (sc === 'spin') {
      await ev(h => { KS.play(); KS.hud(h); T.teleport(0, -10, 0, 0); T.ticks(20); T.key('ShiftLeft', true); T.ticks(8); for (let i = 0; i < 3; i++) { T.tapKey('Space'); T.ticks(6); } }, hud);
      await ev(() => KS.orbit(0.9, 2.6, 0.7, 0.5, 35)); await shot('spin');
      await ev(() => { T.key('ShiftLeft', false); T.ticks(60); });
    } else if (sc === 'hurt') {
      await ev(h => { KS.play(); KS.hud(h); T.teleport(0, 24, 3.1, 0); T.ticks(20); __K.player.shield = true; __K.player.hurt(__K.player.pos.clone().add(new THREE.Vector3(0, 0, -1))); T.ticks(14); __K.player.invT = 0; T.ticks(1); }, hud);
      await ev(() => KS.orbit(0.9, 3.0, 0.8, 0.6, 35)); await shot('hurt');
      await ev(() => { T.ticks(120); });
    } else if (sc === 'victory') {
      await ev(h => { KS.play(); KS.hud(h); T.teleport(0, 24, 3.1, 0); T.ticks(20); __K.game.state = 'results'; T.ticks(60); }, hud);
      await ev(() => KS.orbit(Math.PI + 0.35, 2.6, 0.9, 0.62, 35)); await shot('victory');
      await ev(() => { __K.game.state = 'play'; T.ticks(5); });
    } else if (sc === 'game') {
      await ev(h => { KS.play(); KS.hud(h); KS.restoreFov(); T.teleport(0, -10, 0, 0); T.move = { x: 0, y: 1 }; T.ticks(70); T.move = null; T.ticks(4); KS.render(); }, hud);
      await shot('game');
      stats[sc] = await ev(() => Object.assign(KS.kitCost(), { look: __K.player.lookStats() }));
    } else if (sc === 'skate' || sc === 'skateclose' || sc === 'trick' || sc === 'trickseq' || sc === 'flight' || sc === 'land') {
      await ev(async h => { if (__K.game.act !== 2 || __K.game.state !== 'play') await KS.act2(); KS.hud(h); }, hud);
      if (sc === 'skate' || sc === 'skateclose') {
        await ev(() => { T.place2(200, 0, 0); __K.player.invT = 0; T.ticks(70); KS.render(); });
        if (sc === 'skateclose') { await ev(() => KS.orbit(1.1, 2.4, 0.7, 0.75, 38)); }
        await shot(sc);
        stats[sc] = await ev(() => Object.assign(KS.kitCost(), { look: __K.player.lookStats() }));
      } else if (sc === 'trickseq') {
        await ev(() => { T.place2(200, 0, 0); __K.player.invT = 0; T.ticks(50); T.key('Space', true); T.ticks(14); T.key('Space', false); T.ticks(3); T.tapKey('Space'); });
        for (let k = 0; k < 5; k++) { await ev(() => { T.ticks(4); }); await ev(() => KS.orbit(1.5, 2.6, 0.3, 0.5, 38)); await shot('trickseq' + k); }
        await ev(() => { T.ticks(120); });
      } else if (sc === 'trick') {
        await ev(() => { T.place2(200, 0, 0); __K.player.invT = 9; T.ticks(50); T.key('Space', true); T.ticks(14); T.key('Space', false); T.ticks(4); T.tapKey('Space'); T.ticks(10); __K.player.invT = 0; T.ticks(1); });
        await ev(() => KS.orbit(1.4, 3.0, 0.4, 0.6, 38)); await shot('trick');
        await ev(() => { T.ticks(120); });
      } else if (sc === 'flight') {
        await ev(() => {
          const C = __K.city, B = __K.board, P = __K.player; P.invT = 0; __K.game.rings = Math.max(__K.game.rings, 5);
          T.place2(C.feature('bumper') - 60, 0, 30);
          T.key('ArrowUp', true); T.until(() => B.mode === 'flight', 600); T.key('ArrowUp', false); T.ticks(+(window.__flightTicks || 70));
        });
        await ev(() => KS.render()); await shot('flight');
        await ev(() => KS.orbit(2.2, 2.8, 0.6, 0.55, 38)); await shot('flightclose');
        // --vars="tag:code;tag2:code2" (code runs in the page with K = __K; each variant is shot then the page is left as is)
        if (arg('vars')) for (const v of arg('vars').split(';')) {
          const i = v.indexOf(':'), tag = v.slice(0, i), code = v.slice(i + 1);
          await ev(c => { const K = __K; (new Function('K', c))(K); KS.orbit(2.2, 2.8, 0.6, 0.55, 38); }, code);
          await shot('flightclose-' + tag);
        }
        if (flag('nofur')) {
          await ev(() => { const f = __K.view.scene.getObjectByName('kit-fur'); f.visible = false; KS.orbit(2.2, 2.8, 0.6, 0.55, 38); });
          await shot('flightclose-nofur');
          await ev(() => { const f = __K.view.scene.getObjectByName('kit-fur'); f.visible = true; });
        }
        stats[sc] = await ev(() => Object.assign(KS.kitCost(), { look: __K.player.lookStats() }));
      }
    }
    console.log('scene', sc, Date.now() - t1, 'ms');
  }
  if (Object.keys(stats).length) console.log('KITCOST', JSON.stringify(stats));
  if (flag('stats')) console.log('MEM', JSON.stringify(await ev(() => T.mem())));
  console.log('ERRORS (' + errs.length + '):\n' + errs.slice(0, 12).join('\n---\n'));
  await b.close(); await srv.close();
})().catch(e => { console.error(e); process.exit(1); });
