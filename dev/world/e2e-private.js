// End-to-end test of the assembled game (test.html, built by ./build.sh), three.js r186 WebGPURenderer.
// Usage: node test/e2e.js [--only=name1,name2] [--no-phone] [--webgpu]
//   default: every suite on the renderer's WebGL 2 backend (test.html?gl, Chromium + SwiftShader through ANGLE)
//   --webgpu: the WebGPU suite (boot, Act 1 sample, Act 2 sample, presets, no errors) on WebGPU (SwiftShader Vulkan)
//   --only=: desktop, valley, boss, act2, post, fullrun, regress, present, regress2, phone, v3 (backend, textures,
//            budgets, legacy page, no GLSL), webgpu (same as --webgpu)
// ES modules do not load from file://: test/serve.js serves the repository on 127.0.0.1 (a free port).
// The game's rAF loop is driven deterministically by the test (fixed 60 Hz ticks, rendering only when a frame is
// needed). Keyboard input goes through real key events; scripted bots set the analog stick through K.input.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const { serve } = require('../../test/serve.js');
const ROOT = path.resolve(__dirname, '../..');
const SHOTS = path.join(ROOT, 'dev/world/e2eshots');
fs.mkdirSync(SHOTS, { recursive: true });
const argv = process.argv.slice(2);
const onlyArg = argv.find(a => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice(7).split(',') : null;
const WEBGPU = argv.includes('--webgpu') || (!!ONLY && ONLY.includes('webgpu'));
const PHONE = !WEBGPU && !argv.includes('--no-phone') && (!ONLY || ONLY.includes('phone'));
// SPEC3 §7: WebGL 2 backend through SwiftShader ANGLE; WebGPU through SwiftShader Vulkan on an http://127.0.0.1 page
const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const GPU_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'];
let BASE = '';                         // http://127.0.0.1:<port>/ once the server runs
const gameUrl = q => BASE + 'dev/world/site/test.html' + (q != null ? q : WEBGPU ? '' : '?gl');
const BOOT_MS = WEBGPU ? 900000 : 300000; // SwiftShader compiles every pipeline on the CPU (WebGPU: minutes)

const results = [];
const info = {};
function check(name, pass, notes) {
  results.push({ name, pass: !!pass, notes: typeof notes === 'string' ? notes : JSON.stringify(notes) });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (notes ? '  ' + (typeof notes === 'string' ? notes : JSON.stringify(notes)) : ''));
}
// a v3 target that depends on a builder's work (SPEC3 roles): reported (PEND / pass), never fails the run; the builder
// named in `owner` turns it into a check() when the work lands
function pending(owner, name, pass, notes) {
  results.push({ name, pass: true, pending: owner, met: !!pass, notes: typeof notes === 'string' ? notes : JSON.stringify(notes) });
  console.log((pass ? 'PASS ' : 'PEND ') + '[' + owner + '] ' + name + (notes ? '  ' + (typeof notes === 'string' ? notes : JSON.stringify(notes)) : ''));
}
const want = n => !ONLY || ONLY.includes(n);

const RAF_SHIM = `(() => {
  const q = [];
  window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  let t = 0;
  window.__pump = ms => { if (!t) t = performance.now(); t += ms; const l = q.splice(0); for (const cb of l) cb(t); };
})();`;

// page setup shared by every suite: error capture, fonts stubbed, deterministic rAF, the in-page helpers
async function preparePage(page, errors, opts) {
  opts = opts || {};
  page.on('pageerror', e => errors.push('pageerror: ' + (e.stack || e.message)));
  page.on('console', m => { if (m.type() === 'error' && !(opts.ignore && opts.ignore.test(m.text()))) errors.push('console.error: ' + m.text()); });
  // Google Fonts are unreachable from the sandbox: answer with an empty stylesheet (fallback font) instead of failing
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  if (opts.raf !== false) await page.addInitScript(RAF_SHIM);
  if (opts.helpers !== false) await page.addInitScript({ path: path.join(__dirname, '../../test/page-helpers.js') });
}
// boot is async (renderer init, textures, shader precompile): wait for K.game.booted (or the fatal overlay)
async function bootPage(page, url) {
  const t0 = Date.now();
  await page.goto(url || gameUrl(), { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => (window.__K && window.__K.game && window.__K.game.booted) || (document.getElementById('fatal') && !document.getElementById('fatal').hidden), null, { timeout: BOOT_MS, polling: 250 });
  const ms = Date.now() - t0;
  const fatal = await page.evaluate(() => !document.getElementById('fatal').hidden);
  if (fatal) throw new Error('the game showed its fatal error screen: ' + await page.evaluate(() => document.getElementById('fatal-msg').textContent));
  await page.evaluate(() => window.__installT());
  return ms;
}
async function openGame(browser, ctxOpts, url) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  await preparePage(page, errors);
  const bootMs = await bootPage(page, url);
  return { ctx, page, errors, bootMs };
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
async function shot(page, name, prep) {
  await ev(page, () => { T.frame(); });
  if (prep) await ev(page, prep);
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  const s = await ev(page, () => T.drawStats());
  info.shots = info.shots || {};
  info.shots[name] = s;
  return s;
}

async function desktop(browser) {
  const { page, errors, bootMs } = await openGame(browser, { viewport: { width: 1280, height: 720 } });
  info.bootMs = bootMs;

  // ---------- load + title ----------
  await ev(page, () => { T.ticks(40); });
  const title = await ev(page, () => ({ state: __K.game.state, gl: T.glStats(), hud: (T.frame(), T.hudStats()), level: { rings: __K.level.rings.length, enemies: __K.level.enemies.length, loops: __K.level.loops.length, cps: __K.level.checkpoints.length } }));
  check('page loads without errors', errors.length === 0, { bootMs, errors: errors.slice(0, 3) });
  check('title renders (3D scene + HUD logo)', title.state === 'title' && title.gl.mean > 40 && title.gl.std > 12 && title.gl.colors > 30 && title.gl.dark < 0.2 && title.hud.cover > 0.05, { gl: title.gl, hud: title.hud });
  await shot(page, '01-title');

  // ---------- solids: no double registration across resets ----------
  const solids = await ev(page, () => {
    const W = __K.world, n0 = W.solids.length, mon0 = W.solids.filter(s => s.kind === 'monitor').length;
    for (let i = 0; i < 3; i++) __K.entities.reset();
    const n1 = W.solids.length, uniq = new Set(W.solids).size;
    return { n0, n1, uniq, monitors: mon0, monitorDefs: __K.level.monitors.length };
  });
  check('world solids registered once (monitors, resets)', solids.n0 === solids.n1 && solids.uniq === solids.n1 && solids.monitors === solids.monitorDefs, solids);

  // ---------- Space starts the act ----------
  await page.keyboard.press('Space');
  await ev(page, () => T.ticks(2));
  const card = await ev(page, () => ({ s: __K.game.state, lives: __K.game.lives, rings: __K.game.rings }));
  await ev(page, () => T.ticks(60));
  await shot(page, '02-card');
  const toPlay = await ev(page, () => T.until(() => __K.game.state === 'play', 300));
  check('Space starts the act (title -> card -> play)', card.s === 'card' && toPlay >= 0 && card.lives === 3, { card, ticksToPlay: toPlay });

  // ---------- run forward with W ----------
  await page.keyboard.down('KeyW');
  const run = await ev(page, () => {
    const P = __K.player, z0 = P.pos.z, sp = [];
    for (let i = 0; i < 6; i++) { T.ticks(12); sp.push(+T.hs().toFixed(1)); }
    return { dz: +(P.pos.z - z0).toFixed(1), sp, ground: P.onGround, rings: __K.game.rings, state: P.state };
  });
  await shot(page, '03-start');
  check('holding W runs forward and gains speed', run.dz < -8 && run.sp[5] > 15 && run.sp[5] > run.sp[0] && run.sp[1] > run.sp[0], run);
  const rings = await ev(page, () => { T.ticks(30); return { rings: __K.game.rings, z: +__K.player.pos.z.toFixed(1) }; });
  check('rings are collected along the start', rings.rings >= 5, rings);

  // ---------- jump ----------
  const jump = await ev(page, () => {
    const P = __K.player, X = __K.vfx;
    const g0 = P.onGround, y0 = P.pos.y;
    const sp0 = X && X.ready ? X.stats().spawned : 0;
    T.key('Space', true);
    const left = T.until(() => !P.onGround, 10);
    T.ticks(3);
    const vs = X && X.ready ? X.stats() : null;
    window.__jumpVfx = { ready: !!(X && X.ready), spawned: vs ? vs.spawned - sp0 : 0, live: vs ? vs.live : 0, glow: vs ? vs.glow : 0 };
    T.ticks(11); T.key('Space', false);
    let maxY = P.pos.y;
    const back = T.until(() => { maxY = Math.max(maxY, P.pos.y); return P.onGround; }, 150);
    return { g0, left, back, rise: +(maxY - y0).toFixed(2), alive: !P.dead };
  });
  await page.keyboard.up('KeyW');
  check('jump leaves the ground and lands again', jump.g0 && jump.left >= 0 && jump.back > 0 && jump.rise > 1.5 && jump.alive, jump);
  const jv = await ev(page, () => window.__jumpVfx);
  check('VFX: a jump bursts into golden sparkles (K.vfx particles spawned and alive)', jv.ready && jv.spawned >= 12 && jv.live >= 10 && jv.glow >= 10, jv);

  // ---------- pause ----------
  const pause = await ev(page, () => {
    const G = __K.game; T.tapKey('Escape'); T.ticks(3); const p1 = G.paused; const t1 = G.time; T.ticks(30); const frozen = G.time === t1;
    T.tapKey('Escape'); T.ticks(3); return { p1, frozen, p2: G.paused };
  });
  check('pause menu (Esc) freezes and resumes', pause.p1 && pause.frozen && !pause.p2, pause);

  // ---------- valley at speed (route-following bot) ----------
  if (want('valley') || !ONLY) {
    const valley = await ev(page, () => {
      const P = __K.player;
      T.teleport(-6, -66, T.routeDirYaw(-6, -66), 22);
      T.follow(0);
      let maxSp = 0;
      for (let i = 0; i < 10; i++) { T.ticks(6); maxSp = Math.max(maxSp, T.hs()); }
      return { st: T.st(), maxSp: +maxSp.toFixed(1) };
    });
    await shot(page, '04-valley-speed');
    await ev(page, () => { T.ticks(60); });
    const valley2 = await ev(page, () => ({ st: T.st(), dashes: T.cnt['P.dash'] || 0 }));
    await ev(page, () => T.stop());
    check('valley run at speed (bot follows the route)', valley.maxSp > 18 && !valley2.st.dead && valley2.st.p[2] < -95, { valley, valley2 });
  }

  // ---------- loops ----------
  const loops = await ev(page, () => __K.level.loops.length);
  for (let li = 0; li < loops; li++) {
    const r = await ev(page, li => {
      const K = __K, P = K.player, lp = K.level.loops[li];
      const back = 18, x = lp.entry.x - lp.dir.x * back, z = lp.entry.z - lp.dir.z * back;
      const yaw = T.yawOf(lp.dir.x, lp.dir.z);
      T.teleport(x, z, yaw, 24);
      T.pre = () => { if (!P.inLoop) T.steerYaw(yaw, 1); };
      let inLoop = false, maxY = -1e9, camLoop = false, maxTh = 0;
      const y0 = P.pos.y;
      for (let i = 0; i < 260; i++) {
        T.ticks(1);
        if (P.inLoop) inLoop = true;
        if (K.camera.mode === 'loop') camLoop = true;
        maxY = Math.max(maxY, P.pos.y);
        if (i === 34 && li === 0) window.__midLoop = T.st();
        if (P.dead) break;
        const along = (P.pos.x - lp.entry.x) * lp.dir.x + (P.pos.z - lp.entry.z) * lp.dir.z;
        if (inLoop && !P.inLoop && along > 6 && P.onGround) break;
      }
      T.stop();
      const along = (P.pos.x - lp.entry.x) * lp.dir.x + (P.pos.z - lp.entry.z) * lp.dir.z;
      const lat = (P.pos.x - lp.entry.x) * lp.side.x + (P.pos.z - lp.entry.z) * lp.side.z;
      return { inLoop, camLoop, rise: +(maxY - y0).toFixed(2), along: +along.toFixed(1), lat: +lat.toFixed(2), shift: lp.shift, dead: P.dead, ground: P.onGround, mid: window.__midLoop || null };
    }, li);
    check(`loop ${li + 1} completes when entered with speed`, r.inLoop && r.rise > 12 && r.along > 5 && !r.dead && r.ground && Math.abs(r.lat - r.shift) < 2.6, r);
  }
  // loop screenshot: mid-traversal of loop 1
  {
    await ev(page, () => {
      const K = __K, P = K.player, lp = K.level.loops[0];
      const yaw = T.yawOf(lp.dir.x, lp.dir.z);
      T.teleport(lp.entry.x - lp.dir.x * 18, lp.entry.z - lp.dir.z * 18, yaw, 24);
      T.pre = () => { if (!P.inLoop) T.steerYaw(yaw, 1); };
      T.until(() => P.inLoop, 120);
      T.until(() => P.pos.y > lp.entry.y + lp.radius * 1.2, 60);
      T.stop();
    });
    await shot(page, '05-loop');
    await ev(page, () => T.ticks(90));
  }

  // ---------- springs ----------
  const springs = await ev(page, () => {
    const K = __K, P = K.player, out = [];
    const L = K.level.springs;
    const pick = [L[2], L[7], L[10]].filter(Boolean);
    for (const s of pick) {
      // approach over level ground: prefer coming from behind the launch direction, else the flattest side
      const hl = Math.hypot(s.dir.x, s.dir.z);
      const base = hl > 0.05 ? T.yawOf(s.dir.x, s.dir.z) : T.routeDirYaw(s.pos.x, s.pos.z);
      let yaw = base, bestErr = 1e9;
      for (let k = 0; k < 16; k++) {
        const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 8;
        let err = 0;
        for (const d of [1.5, 3, 4.5]) { const g = K.world.ground(s.pos.x + Math.sin(a) * d, s.pos.z + Math.cos(a) * d, s.pos.y + 1.5); err = Math.max(err, g ? Math.abs(g.y - s.pos.y) : 99); }
        if (err < bestErr - 0.05) { bestErr = err; yaw = a; }
        if (err < 0.35) break;
      }
      const bx = s.pos.x + Math.sin(yaw) * 4.5, bz = s.pos.z + Math.cos(yaw) * 4.5;
      const n0 = T.cnt['P.launch'] || 0;
      T.teleport(bx, bz, yaw, 6);
      T.pre = () => T.steerYaw(yaw, 1);
      let vyMax = 0;
      const hit = T.until(() => { vyMax = Math.max(vyMax, P.vel.y); return (T.cnt['P.launch'] || 0) > n0; }, 120);
      T.ticks(3); vyMax = Math.max(vyMax, P.vel.y);
      T.stop();
      const landed = T.until(() => P.onGround || P.dead, 400);
      out.push({ z: s.pos.z, power: s.power, hit, vy: +vyMax.toFixed(1), want: +(s.dir.y * s.power).toFixed(1), landedAt: T.st().p, dead: P.dead, ticksAir: landed });
    }
    return out;
  });
  check('springs fire (launch with dir*power)', springs.length === 3 && springs.every(s => s.hit >= 0 && s.vy > s.want * 0.8), springs);
  check('spring gate lands Kit on the upper cliff', springs[0] && !springs[0].dead && springs[0].landedAt[1] > 24, springs[0]);
  check('1UP pillar spring reaches the pillar top', springs[2] && !springs[2].dead && springs[2].landedAt[1] > 14.5, springs[2]);

  // ---------- dash panels ----------
  const dash = await ev(page, () => {
    const K = __K, P = K.player, out = [];
    for (const d of K.level.dashPanels) {
      const yaw = T.yawOf(d.dir.x, d.dir.z);
      const n0 = T.cnt['P.dash'] || 0;
      T.teleport(d.pos.x - d.dir.x * 5, d.pos.z - d.dir.z * 5, yaw, 8);
      T.pre = () => T.steerYaw(yaw, 1);
      let best = 0;
      const hit = T.until(() => { best = Math.max(best, P.vel.length()); return (T.cnt['P.dash'] || 0) > n0; }, 90);
      for (let i = 0; i < 6; i++) { T.ticks(1); best = Math.max(best, P.vel.length()); }
      T.stop();
      out.push({ z: +d.pos.z.toFixed(0), want: d.speed, hit, best: +best.toFixed(1) });
    }
    return out;
  });
  check('dash panels fire (speed boost)', dash.every(d => d.hit >= 0 && d.best >= d.want * 0.9), dash);

  // ---------- chasm screenshot ----------
  await ev(page, () => {
    const K = __K;
    T.teleport(0, -222, 0, 6); T.ticks(50);
  });
  await shot(page, '06-chasm');

  // ---------- checkpoints ----------
  const cps = await ev(page, () => {
    const K = __K, P = K.player, G = K.game, out = [];
    K.level.checkpoints.forEach((c, i) => {
      const yaw = T.routeDirYaw(c.pos.x, c.pos.z);
      // run past the post 3.5 u to the side: the post acts as a gate across the route
      const ox = Math.cos(yaw) * 3.5, oz = -Math.sin(yaw) * 3.5;
      T.teleport(c.pos.x + Math.sin(yaw) * 7 + ox, c.pos.z + Math.cos(yaw) * 7 + oz, yaw, 8);
      T.pre = () => T.steerYaw(yaw, 1);
      const t = T.until(() => G.cpIndex >= i, 90);
      T.stop(); T.ticks(10);
      out.push({ i, t, cp: G.cpIndex, cpTime: +G.cpTime.toFixed(2) });
    });
    return out;
  });
  check('each checkpoint activates in order (passing beside the post)', cps.length === 3 && cps.every(c => c.t >= 0 && c.cp === c.i), cps);

  // ---------- chasm death -> respawn at the checkpoint ----------
  const death = await ev(page, () => {
    const K = __K, P = K.player, G = K.game, W = K.world;
    // checkpoint 1 (index 0, after the chasm) is the respawn point
    G.cpIndex = 0; G.cpTime = 50; K.entities.reset();
    let px = null, pz = null;
    for (let z = -237; z > -262 && px === null; z -= 0.25) for (let x = -1; x <= 1 && px === null; x += 0.5) {
      let open = true;
      for (let a = 0; a < 8; a++) if (W.ground(x + Math.cos(a) * 1.2, z + Math.sin(a) * 1.2, 100)) open = false;
      if (open && !W.ground(x, z, 100)) { px = x; pz = z; }
    }
    if (px === null) return { err: 'no open chasm spot' };
    G.rings = 12;
    const lives0 = G.lives;
    T.teleport(px, pz, 0, 0, 27);
    const died = T.until(() => P.dead, 240);
    const cardAt = T.until(() => G.state === 'card', 400);
    T.ticks(2);
    const cp = K.level.checkpoints[0];
    const d = Math.hypot(P.pos.x - cp.pos.x, P.pos.z - cp.pos.z);
    const res = { spot: [px, pz], died, cardAt, lives0, lives: G.lives, rings: G.rings, time: G.time, distToCp: +d.toFixed(2), alive: !P.dead, y: +P.pos.y.toFixed(2) };
    T.until(() => G.state === 'play', 200);
    return res;
  });
  check('falling into the chasm kills and respawns at the checkpoint', death.died >= 0 && death.cardAt >= 0 && death.lives === death.lives0 - 1 && death.rings === 0 && death.distToCp < 1 && death.alive && Math.abs(death.time - 50) < 0.01, death);

  // ---------- descent + bridge screenshots ----------
  await ev(page, () => { T.teleport(4, -306, T.routeDirYaw(4, -306), 20); T.follow(0); T.ticks(40); });
  await shot(page, '07-descent');
  const descent = await ev(page, () => { T.ticks(150); const s = T.st(); T.stop(); return s; });
  check('descent: bot keeps running downhill alive', !descent.dead && descent.p[2] < -335, descent);
  await ev(page, () => { const x = __K.world.spots.bridge.x; T.teleport(x, -428, T.routeDirYaw(x, -428), 16); T.follow(0); T.ticks(44); });
  await shot(page, '08-bridge');
  const bridge = await ev(page, () => { T.ticks(60); const s = T.st(); T.stop(); return s; });
  check('bridge crossing (solid planks over water)', !bridge.dead && bridge.p[1] > 2 && bridge.p[2] < -455, bridge);

  // ---------- boss ----------
  if (want('boss') || !ONLY) {
    const trig = await ev(page, () => {
      const K = __K, P = K.player, G = K.game, B = K.level.boss;
      G.bossDone = false; G.cpIndex = 2; G.cpTime = 90; K.entities.reset();
      const cp = K.level.checkpoints[2];
      T.teleport(cp.pos.x, cp.pos.z, cp.yaw, 0);
      T.pre = () => { const dx = B.center.x - P.pos.x, dz = B.center.z - P.pos.z; T.steerYaw(T.yawOf(dx, dz), 1); };
      const t = T.until(() => G.bossActive, 600);
      T.stop();
      const bi = K.entities.bossInfo();
      return { t, active: bi && bi.active, hp: bi && bi.hp, max: bi && bi.max, cam: K.camera.mode, music: K.audio.track, st: T.st() };
    });
    check('boss triggers when entering the arena', trig.t >= 0 && trig.active && trig.cam === 'boss' && trig.hp === 8, trig);

    const fight = await ev(page, () => {
      const E = __K.entities, P = __K.player, B = __K.level.boss;
      __K.game.lives = 9;
      // stop once for the screenshot: pod not flashing, Kit airborne near it
      const r = T.bossBot({ keepRings: true, stopWhen: () => { const s = E.stats(); return E.bossInfo().hp <= 6 && s.bossFlash <= 0 && !P.onGround && Math.hypot(s.bossPos.x - P.pos.x, s.bossPos.z - P.pos.z) < 7; } });
      return r;
    });
    await shot(page, '09-boss-fight');
    const fight2 = await ev(page, () => T.bossBot({ keepRings: true }));
    const totalHits = fight.hits + fight2.hits;
    check('boss defeated by the scripted bot (8 hits)', totalHits >= 8 && fight2.hp === 0 && (fight2.boss === 'dying' || fight2.boss === 'flee' || fight2.boss === 'gone'), { fight, fight2, seconds: +((fight.k + fight2.k) / 60).toFixed(1) });

    const capsule = await ev(page, () => T.capsuleBot());
    check('capsule lands, opens on the button and results appear', capsule.defeatedAt >= 0 && capsule.landedAt >= 0 && capsule.opened >= 0 && capsule.resultsAt >= 0 && capsule.state === 'results' && capsule.onCapsule === 1, capsule);

    const res = await ev(page, () => {
      const G = __K.game;
      const t0 = G.score;
      T.ticks(60 * 7);
      return { state: G.state, scoreBefore: t0, score: G.score, done: !!(G.res && G.res.done), time: +G.time.toFixed(2) };
    });
    await shot(page, '10-results');
    const end = await ev(page, () => {
      const K = __K, G = K.game;
      const score = G.score, lives = G.lives;
      T.tapKey('Space'); T.ticks(2); const s1 = G.state;
      const loadAt = T.until(() => G.state === 'card', 300);
      const s2 = G.state;
      return { s1, s2, loadAt, act: G.act, score0: score, score: G.score, lives0: lives, lives: G.lives, city: K.city.entered, island: K.world.visible, ents: K.entities.active,
        board: K.board.active, mode: K.board.mode, best: K.store.get('best', null), bestG: G.best };
    });
    await ev(page, () => T.ticks(45));
    await shot(page, '14-act1-to-act2-card');
    check('results tally -> Act 2 ("Chargement…" card, SAN FRANCISCO card), score and lives carried, record saved', res.state === 'results' && res.done && res.score > res.scoreBefore &&
      end.s1 === 'loading' && end.s2 === 'card' && end.act === 2 && end.city && !end.island && !end.ents && end.board && end.score === end.score0 && end.lives === end.lives0 &&
      end.best && end.best.score === res.score, { res, end });
    const back = await ev(page, () => {
      const K = __K, G = K.game, P = K.player;
      T.until(() => G.state === 'play', 300); T.ticks(30);
      T.tapKey('Escape'); T.ticks(2);
      for (let i = 0; i < 3; i++) { T.key('ArrowDown', true); T.ticks(2); T.key('ArrowDown', false); T.ticks(2); }
      const sel = G.pauseSel;
      T.tapKey('Enter'); T.ticks(4);
      return { sel, state: G.state, act: G.act, city: K.city.entered, island: K.world.visible, ents: K.entities.active, board: K.board.active, ext: !!P.external, cam: K.camera.mode, fog: !!K.view.scene.fog, far: K.view.camera.far };
    });
    await shot(page, '15-back-to-title');
    check('Act 2 pause menu "Retour au titre" brings the island back (city hidden, board off)', back.sel === 3 && back.state === 'title' && back.act === 1 && !back.city && back.island && back.ents && !back.board && !back.ext && back.cam === 'title', back);
  }

  // ---------- game over ----------
  const over = await ev(page, () => {
    const K = __K, G = K.game, P = K.player;
    if (G.state !== 'title') { /* make sure we are on the title */ }
    T.ticks(40); T.tapKey('Space'); T.ticks(4);
    const s0 = G.state;
    T.until(() => G.state === 'play', 300);
    G.lives = 0;
    P.kill('hurt');
    const overAt = T.until(() => G.state === 'over', 400);
    const music = K.audio.track;
    T.ticks(80);
    T.tapKey('Space'); T.ticks(4);
    return { s0, overAt, music, after: G.state, lives: G.lives };
  });
  check('game over path (last life lost -> GAME OVER -> title)', over.s0 === 'card' && over.overAt >= 0 && over.after === 'title', over);

  // ---------- frame time ----------
  const perf = await ev(page, () => {
    const K = __K, G = K.game, R = K.view.renderer;
    T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300);
    T.teleport(0, -10, 0, 10); T.follow(0);
    T.ticks(30);
    const n = 24, ft = [];
    let calls = 0, tris = 0;
    T.sync();
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      T.frame();
      T.sync(); // wait for the GPU so the frame cost is real
      const ds = T.drawStats();
      ft.push(performance.now() - t0); calls = Math.max(calls, ds.calls); tris = Math.max(tris, ds.tris);
    }
    const t1 = performance.now(); T.ticks(240); const simMs = (performance.now() - t1) / 240;
    T.stop();
    ft.sort((a, b) => a - b);
    const avg = ft.reduce((a, b) => a + b, 0) / n;
    return { avgFrameMs: +avg.toFixed(1), medianFrameMs: +ft[n >> 1].toFixed(1), simTickMs: +simMs.toFixed(3), calls, tris, dpr: K.view.dpr, W: K.view.W, H: K.view.H, nan: T.nan, ticks: T.ticksRun };
  });
  info.perf = perf;
  check('frame time measured (headless SwiftShader, CPU rendering)', perf.avgFrameMs > 0 && perf.calls < 300 && perf.simTickMs < 4, perf);
  check('no NaN in player/camera state during the run', perf.nan === 0, { nan: perf.nan, ticks: perf.ticks });
  const maxCalls = Math.max(...Object.values(info.shots || {}).map(s => s.calls));
  check('draw calls under budget (< 300) in every screenshot view', maxCalls < 300, info.shots);
  check('no page errors or console errors during the desktop run', errors.length === 0, errors.slice(0, 5));
}

async function fullRun(browser) {
  const { page, errors } = await openGame(browser, { viewport: { width: 1280, height: 720 } });
  await ev(page, () => { T.ticks(40); T.tapKey('Space'); T.ticks(4); T.until(() => __K.game.state === 'play', 300); });
  const mem = () => ev(page, () => { T.frame(); const m = T.mem(), X = __K.vfx.stats(); return { geo: m.geo, tex: m.tex, prog: m.prog, live: X.live, cap: X.cap, dropped: X.dropped, spawned: X.spawned, ribbons: X.ribbons }; });
  await ev(page, () => T.ticks(600));
  const mem0 = await mem();
  const run = await ev(page, () => T.routeBot(60 * 400));
  check('full run: bot plays start -> boss arena through the real game (no teleports)', run.arena && run.state === 'play' && run.cps.length === 3, run);
  const boss = await ev(page, () => T.bossBot({ maxTicks: 60 * 240 }));
  const cap = boss.hp === 0 ? await ev(page, () => T.capsuleBot()) : null;
  check('full run: boss beaten and results reached without help', boss.hp === 0 && cap && cap.state === 'results', { boss, cap });
  const fin = await ev(page, () => { T.ticks(60 * 6); return { state: __K.game.state, time: +__K.game.time.toFixed(2), score: __K.game.score, rings: __K.game.rings, lives: __K.game.lives, nan: T.nan }; });
  const mem1 = await mem();
  // then 2 minutes of effects at their busiest (every effect twice a second, trails every tick, confetti every 5 s):
  // the pools stay under their caps and nothing new is allocated on the GPU
  const stress = await ev(page, () => {
    const K = __K, X = K.vfx, R = K.view.renderer, P = K.player, V3 = THREE.Vector3;
    const memNow = () => { T.frame(); return T.mem(); };
    const c = P.center().clone(), up = new V3(0, 1, 0), dir = new V3(1, 0.2, 0).normalize(), v = new V3(14, 0, -6), q = new V3();
    X.jump(c, up, v); X.ringPickup(c, v); X.boom(c, 1); X.land(c, up, 20); X.impact(c, 0xffd23a, 2, up); X.sparks(c, dir, 20, 0xffc070);
    X.wheelSparks(c, v); X.airJump(c, dir); X.confetti(c); X.twinkle(c, 8, 0xffffff); X.flightTrail(c, v); X.ballTrail(c, v); X.homingTrail(c); X.speedLines(0.8, v);
    T.ticks(400);
    const m0 = memNow();
    let maxLive = 0, maxRib = 0, frames = 0, mA = null;
    // 40 s warm-up (every effect, every pool slot reused), then 2 minutes that must not allocate anything
    for (let i = 0; i < 60 * 160; i++) {
      if (i === 60 * 40) mA = memNow();
      const k = i % 30, a = i * 0.05;
      q.set(c.x + Math.cos(a) * 3, c.y + 0.5, c.z + Math.sin(a) * 3);
      if (k === 0) X.jump(q, up, v);
      else if (k === 5) X.ringPickup(q, v);
      else if (k === 10) X.boom(q, 1.2);
      else if (k === 15) X.land(q, up, 24);
      else if (k === 20) { X.impact(q, 0x5fe6ff, 2, up); X.sparks(q, dir, 24, 0xffc070); }
      else if (k === 25) { X.airJump(q, dir); X.twinkle(q, 10, 0xfff2c0); }
      if (i % 300 === 0) X.confetti(q);
      X.homingTrail(q); X.ballTrail(q, v); X.flightTrail(q, v); X.wheelSparks(q, v); X.speedLines(0.8, v);
      T.ticks(1);
      if (i % 1200 === 600) { T.frame(); frames++; }
      if (i % 30 === 29) { const st = X.stats(); maxLive = Math.max(maxLive, st.live + st.pending); maxRib = Math.max(maxRib, st.ribbons); }
    }
    const m1 = memNow(), st = X.stats();
    X.reset(); T.ticks(2);
    const after = X.stats();
    return { m0, mA, m1, maxLive, cap: st.cap, maxRib, dropped: st.dropped, spawned: st.spawned, afterReset: after.live + after.pending, frames };
  });
  check('VFX: no leak (full run + 2 min effect stress: particles under the cap, GPU geometries/textures/programs unchanged)', mem1.spawned > mem0.spawned + 500 && mem1.live <= mem1.cap &&
    stress.maxLive <= stress.cap && stress.m1.geo === stress.mA.geo && stress.m1.tex === stress.mA.tex && stress.m1.prog === stress.mA.prog && stress.afterReset === 0, { mem0, mem1, stress, simSeconds: +(run.ticks / 60).toFixed(0) });
  info.fullRun = { run: { time: run.time, deaths: run.deaths.length, rings: run.rings }, final: fin };
  check('full run: no NaN and no page/console errors', fin.nan === 0 && errors.length === 0, { fin, errors: errors.slice(0, 3) });
}

async function phone(browser) {
  const { ctx, page, errors } = await openGame(browser, { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  await ev(page, () => T.ticks(40));
  const ui = await ev(page, () => {
    const r = id => { const e = document.getElementById(id); const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), shown: !e.closest('[hidden]') && b.width > 0 }; };
    return { touch: !document.getElementById('touch').hidden, isTouch: __K.input.isTouch(), stick: r('stick'), jump: r('btnJump'), roll: r('btnRoll'), game: r('game'), W: __K.view.W, H: __K.view.H, dpr: __K.view.dpr, rotate: !document.getElementById('rotate').hidden };
  });
  await shot(page, '11-phone-title');
  const inside = b => b.x >= 0 && b.y >= 0 && b.x + b.w <= 844 && b.y + b.h <= 390;
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  check('phone: touch UI appears (joystick, SAUT, ROULER) inside the screen', ui.touch && ui.isTouch && ui.stick.shown && ui.jump.shown && ui.roll.shown && inside(ui.stick) && inside(ui.jump) && inside(ui.roll) && !overlap(ui.jump, ui.roll) && !ui.rotate, ui);

  // tap to start
  await page.touchscreen.tap(422, 150);
  await ev(page, () => T.ticks(4));
  const st = await ev(page, () => __K.game.state);
  await ev(page, () => T.until(() => __K.game.state === 'play', 300));
  // HUD layout: the counters (top-left) and lives box must not sit under the touch controls
  const hud = await ev(page, () => {
    const V = __K.view, U = Math.max(0.6, Math.min(V.H / 320, V.W / 480));
    const gr = document.getElementById('game').getBoundingClientRect();
    // counters block: x 12..160, y 10..(27+21*2+12+34) logical units on touch (see drawHUD)
    return { U, counters: { x: Math.round(gr.left + 12 * U), y: Math.round(gr.top + 8 * U), w: Math.round(148 * U), h: Math.round(108 * U) }, game: { x: gr.left, y: gr.top, w: gr.width, h: gr.height } };
  });
  check('phone: HUD fits the screen and clears the touch controls', st === 'card' && inside(hud.counters) && !overlap(hud.counters, ui.stick) && !overlap(hud.counters, ui.jump) && hud.game.w <= 844 && hud.game.h <= 390, { st, hud, stick: ui.stick });

  // joystick drag (CDP touch events through the real #stick pointer handlers)
  const cdp = await ctx.newCDPSession(page);
  const cx = ui.stick.x + ui.stick.w / 2, cy = ui.stick.y + ui.stick.h / 2;
  const p0 = await ev(page, () => [__K.player.pos.x, __K.player.pos.z]);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - 30, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + 2, y: cy - 60, id: 1 }] });
  const mv = await ev(page, () => { T.ticks(1); const m = { x: __K.input.move.x, y: __K.input.move.y }; T.ticks(70); return { m, sp: +T.hs().toFixed(1) }; });
  await ev(page, () => T.frame());
  await shot(page, '12-phone-play');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const p1 = await ev(page, () => { T.ticks(2); return { pos: [__K.player.pos.x, __K.player.pos.z], m: { x: __K.input.move.x, y: __K.input.move.y } }; });
  const moved = Math.hypot(p1.pos[0] - p0[0], p1.pos[1] - p0[1]);
  check('phone: joystick moves Kit', mv.m.y > 0.6 && mv.sp > 10 && moved > 8 && p1.m.x === 0 && p1.m.y === 0, { move: mv.m, speed: mv.sp, moved: +moved.toFixed(1), released: p1.m });
  // SAUT button
  const jb = ui.jump;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: jb.x + jb.w / 2, y: jb.y + jb.h / 2, id: 2 }] });
  const jumped = await ev(page, () => { const P = __K.player; const r = T.until(() => !P.onGround, 20); return r; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  check('phone: SAUT button jumps', jumped >= 0, { ticks: jumped });

  // Act 2 on the phone: pause button -> "Retour au titre" row -> tap the ACTE 2 chip, tap it again to start
  const gameBox = await ev(page, () => { const r = document.getElementById('game').getBoundingClientRect(); return { x: r.left, y: r.top }; });
  const tapRect = async r => { await page.touchscreen.tap(gameBox.x + r.x + r.w / 2, gameBox.y + r.y + r.h / 2); await ev(page, () => T.ticks(3)); };
  await ev(page, () => T.ticks(30));
  await page.click('#btnPause');
  await ev(page, () => { T.ticks(2); T.frame(); });
  await shot(page, '16-phone-pause-graphics');
  let rects = await ev(page, () => __K.game.hudRects());
  await tapRect(rects.pause[3]);
  const st0 = await ev(page, () => __K.game.state);
  await ev(page, () => { T.ticks(30); T.frame(); });
  rects = await ev(page, () => __K.game.hudRects());
  await tapRect(rects.chips[1]);
  const sel = await ev(page, () => __K.game.sel);
  await ev(page, () => T.frame());
  await shot(page, '17-phone-title-act2');
  await tapRect(rects.chips[1]);
  const p2 = await ev(page, () => { const G = __K.game; const s1 = G.state; T.until(() => G.state === 'card', 400); const s2 = G.state; T.until(() => G.state === 'play', 300); return { s1, s2, act: G.act, play: G.state }; });
  // joystick to the right: Kit carves right (heading turns clockwise)
  const yaw0 = await ev(page, () => { T.ticks(40); return Math.atan2(-__K.player.forward.x, -__K.player.forward.z); });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 3 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + 60, y: cy, id: 3 }] });
  const carve = await ev(page, y0 => { T.ticks(1); const mx = __K.input.move.x; T.ticks(20); const y1 = Math.atan2(-__K.player.forward.x, -__K.player.forward.z); let d = y1 - y0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return { mx, dYaw: +d.toFixed(3) }; }, yaw0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: jb.x + jb.w / 2, y: jb.y + jb.h / 2, id: 4 }] });
  const ollie = await ev(page, () => { const B = __K.board; const r = T.until(() => B.mode === 'air', 20); T.ticks(4); return { at: r, vy: +__K.player.vel.y.toFixed(1), mode: B.mode }; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await ev(page, () => T.ticks(150));
  const ph2 = await shot(page, '18-phone-act2');
  check('phone: Act 2 from the touch UI (pause row, ACTE 2 chip), joystick carves, SAUT = ollie', st0 === 'title' && sel === 2 && p2.s1 === 'loading' && p2.s2 === 'card' && p2.act === 2 && p2.play === 'play' &&
    carve.mx > 0.5 && carve.dYaw < -0.05 && ollie.at >= 0 && ph2.calls < 300, { st0, sel, p2, carve, ollie, calls: ph2.calls });
  check('phone: no page errors or console errors', errors.length === 0, errors.slice(0, 5));
  await ctx.close();
}

// ---------- Act 2: San Francisco on the skateboard, the bumper flight ----------
async function act2(browser) {
  const { page, errors } = await openGame(browser, { viewport: { width: 1280, height: 720 } });
  // title act select -> loading card -> act card -> play
  await ev(page, () => { T.ticks(40); T.key('ArrowRight', true); T.ticks(3); T.key('ArrowRight', false); T.ticks(3); });
  await shot(page, '20-a2-title-select');
  const sel = await ev(page, () => __K.game.sel);
  await ev(page, () => { T.tapKey('Space'); T.ticks(2); });
  await shot(page, '21-a2-loading');
  const load = await ev(page, () => {
    const K = __K, G = K.game, s1 = G.state, t0 = performance.now();
    const at = T.until(() => G.state === 'card', 300);
    return { s1, at, ms: Math.round(performance.now() - t0), act: G.act, city: K.city.stats(), island: K.world.visible, ents: K.entities.active, cam: K.camera.mode, board: K.board.active };
  });
  await ev(page, () => T.ticks(45));
  const card = await shot(page, '22-a2-card');
  const play = await ev(page, () => T.until(() => __K.game.state === 'play', 300));
  check('Act 2: title act select -> "Chargement…" card -> SAN FRANCISCO card -> play', sel === 2 && load.s1 === 'loading' && load.at >= 0 && load.act === 2 && load.city.entered && !load.island &&
    !load.ents && load.board && load.cam === 'external' && play >= 0 && card.calls < 300, { sel, load, play, card });
  await ev(page, () => T.ticks(30));
  await shot(page, '23-a2-hilltop');

  // ollie: Space jumps the board (sparkles at the wheels)
  const ollie = await ev(page, () => {
    const K = __K, B = K.board, P = K.player, X = K.vfx;
    T.key('ArrowUp', true); T.ticks(40);
    const sp0 = X.stats().spawned, y0 = P.pos.y, n0 = B.stats().ollies;
    T.key('Space', true);
    const at = T.until(() => B.mode === 'air', 10);
    let top = P.pos.y;
    T.ticks(12); T.key('Space', false);
    const back = T.until(() => { top = Math.max(top, P.pos.y); return B.mode === 'skate'; }, 120);
    T.key('ArrowUp', false);
    return { at, back, rise: +(top - y0).toFixed(2), ollies: B.stats().ollies - n0, sparks: X.stats().spawned - sp0, wipe: B.stats().wipe, dead: P.dead };
  });
  check('Act 2: Space = ollie (board leaves the street, lands, sparkles burst)', ollie.at >= 0 && ollie.back > 0 && ollie.rise > 1 && ollie.ollies === 1 && ollie.sparks >= 12 && !ollie.dead, ollie);

  // a car hit hurts (rings scatter on the street, knock-back), never kills while Kit has rings
  const hit = await ev(page, () => {
    const K = __K, C = K.city, B = K.board, P = K.player, G = K.game, E = K.entities;
    let car = null;
    for (const c of C.cars) {
      const r = C.routeAt(c.pos.x, c.pos.z);
      if (r && c.vel.dot(r.dir) < -3 && r.s > 120 && r.s < C.length - 400 && r.zone === 0) { car = c; break; }
    }
    if (!car) return { err: 'no oncoming car', cars: C.cars.length };
    const r = C.routeAt(car.pos.x, car.pos.z), s = r.s, d = r.d;
    G.rings = 12; P.invT = 0;
    T.place2(s - 16, d);
    const h0 = T.cnt['P.hurt'] || 0, lives = G.lives;
    T.move = { x: 0, y: 1 };
    const at = T.until(() => (T.cnt['P.hurt'] || 0) > h0 || P.dead, 150);
    T.move = null;
    T.ticks(40);
    const lost = E.stats().lostPos;
    const onStreet = lost.filter(p => { const g = C.ground(p.x, p.z, p.y + 1); return g && p.y > g.y - 0.2 && p.y < g.y + 6; }).length;
    const res = { at, rings: G.rings, lives0: lives, lives: G.lives, dead: P.dead, lost: lost.length, onStreet, invT: +P.invT.toFixed(2), carHits: B.stats().carHits, s: +s.toFixed(0) };
    T.ticks(120);
    return res;
  });
  check('Act 2: a car hit hurts with rings (scattered rings bounce on the street), no death', hit.at >= 0 && hit.rings === 0 && !hit.dead && hit.lives === hit.lives0 && hit.lost >= 10 && hit.onStreet >= hit.lost * 0.6 && hit.carHits >= 1, hit);

  // ollie over a parked car in the parking lane: over it (or across its roof), no hit
  const over = await ev(page, () => {
    const K = __K, C = K.city, B = K.board, P = K.player;
    let found = null;
    // a parked car with a clear 34 u run-up in its lane (no other parked car or crossing just before it)
    const parkedAt = (s, d) => { const p = C.routePoint(s, d, 0), g = C.ground(p.x, p.z, p.y + 8); return !!(g && g.solid && g.solid.kind === 'car' && !g.solid.vel); };
    for (let s = 150; s < 900 && !found; s += 2) for (const d of [6.35, -6.35]) {
      const p = C.routePoint(s, d, 0), g = C.ground(p.x, p.z, p.y + 8), r = C.route(s);
      if (!(g && g.solid && g.solid.kind === 'car' && !g.solid.vel && r.zone === 0 && Math.abs(r.g) < 0.25)) continue;
      let back = s; while (parkedAt(back - 0.25, d)) back -= 0.25;
      let clear = true;
      for (let q = back - 36; q < back - 0.5 && clear; q += 0.5) if (parkedAt(q, d) || C.route(q).zone !== 0) clear = false;
      if (clear) { found = { s, d, top: g.y }; break; }
    }
    if (!found) return { err: 'no parked car' };
    // find the car's back end along the lane
    let s0 = found.s;
    for (let k = 0; k < 40; k++) { const p = C.routePoint(s0 - 0.25, found.d, 0), g = C.ground(p.x, p.z, p.y + 8); if (g && g.solid && g.solid.kind === 'car') s0 -= 0.25; else break; }
    let s1 = found.s;
    for (let k = 0; k < 40; k++) { const p = C.routePoint(s1 + 0.25, found.d, 0), g = C.ground(p.x, p.z, p.y + 8); if (g && g.solid && g.solid.kind === 'car') s1 += 0.25; else break; }
    P.invT = 0;
    T.place2(s0 - 30, found.d);
    const h0 = T.cnt['P.hurt'] || 0, o0 = B.stats().ollies;
    const route = () => C.routeAt(P.pos.x, P.pos.z);
    let fired = false, maxY = -1e9, minD = 1e9, wallHits = 0, k = 0;
    T.pre = () => {
      const r = route(); if (!r) return;
      const v = Math.hypot(P.vel.x, P.vel.z);
      const yaw = Math.atan2(-P.forward.x, -P.forward.z), want = Math.atan2(-r.dir.x, -r.dir.z) + Math.atan2(-(found.d - r.d), 12);
      let a = want - yaw; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
      T.move = { x: Math.max(-1, Math.min(1, -a * 2.4)), y: 1 };
      if (!fired && B.stats().grounded && s0 - r.s < v * 0.24 + 1.2) { fired = true; T.key('Space', true); k = 0; }
      if (fired && ++k === 14) T.key('Space', false);
    };
    let passed = -1;
    for (let i = 0; i < 300; i++) {
      T.ticks(1);
      const r = route(); if (!r) continue;
      if (r.s > s0 - 0.5 && r.s < s1 + 0.5) { maxY = Math.max(maxY, P.pos.y - found.top); minD = Math.min(minD, Math.abs(r.d - found.d)); }
      if (r.s > s1 + 2) { passed = i; break; }
      if (P.dead) break;
    }
    T.stop(); T.key('Space', false);
    return { car: { s0: +s0.toFixed(1), s1: +s1.toFixed(1), d: found.d }, fired, passed, overRoof: +maxY.toFixed(2), lane: +minD.toFixed(2), hurt: (T.cnt['P.hurt'] || 0) - h0, ollies: B.stats().ollies - o0, wipe: B.stats().wipe, dead: P.dead };
  });
  check('Act 2: ollie over a car (clears it or rides its roof, no hit)', over.fired && over.passed >= 0 && over.overRoof > -0.1 && over.lane < 1.2 && over.hurt === 0 && over.ollies >= 1 && !over.dead, over);

  // death -> respawn at the Act 2 checkpoint, the board restarts there
  const death = await ev(page, () => {
    const K = __K, C = K.city, G = K.game, P = K.player, B = K.board;
    T.place2(C.checkpoints[0].s + 10, 0);
    G.setCheckpoint(0);
    const lives = G.lives, cp = G.cpIndex;
    P.kill('fall');
    const cardAt = T.until(() => G.state === 'card', 400);
    T.ticks(2);
    const c = C.checkpoints[0], d = Math.hypot(P.pos.x - c.pos.x, P.pos.z - c.pos.z);
    const res = { cp, cardAt, lives0: lives, lives: G.lives, act: G.act, dist: +d.toFixed(2), board: B.active, mode: B.mode, alive: !P.dead, rings: G.rings, cam: K.camera.mode };
    T.until(() => G.state === 'play', 200);
    return res;
  });
  check('Act 2: a death respawns at the Act 2 checkpoint on the board', death.cp === 0 && death.cardAt >= 0 && death.lives === death.lives0 - 1 && death.act === 2 && death.dist < 1.5 && death.board && death.mode === 'skate' && death.alive && death.cam === 'external', death);

  // the descent with the skate bot from the top of the hill, screenshots on the way, the bumper, the flight, the goal
  await ev(page, () => {
    const K = __K, G = K.game, C = K.city;
    G.cpIndex = -1; G.rings = 0; G.time = 0; G.lives = Math.max(G.lives, 3);
    C.reset({ full: true });
    T.place2(C.start.s, 0);
    T.watchAct2(); T.skateBot({ ollieCar: true });
  });
  const want = { traffic: 1, air: 1, trick: 1, pier: 1, orbit: 4, flight: 1, goal: 1 };
  const bumperS = await ev(page, () => __K.city.feature('bumper'));
  let orbitN = 0, goalAt = -1, ticks = 0, lastCrest = -1;
  const shotsInfo = {};
  while (ticks < 60 * 170) {
    const r = await ev(page, () => {
      T.ticks(4);
      const K = __K, B = K.board, P = K.player, C = K.city, b = B.stats();
      let ahead = 0;
      for (const c of C.cars) { const q = C.routeAt(c.pos.x, c.pos.z); if (q && q.s > b.s + 8 && q.s < b.s + 50 && Math.abs(q.d) < 8) ahead++; }
      const ev2 = T.bs.events, cr = ev2.filter(e => e[0] === 'crest').length;
      return { st: K.game.state, b, ahead, crests: cr, sweep: T.tw.sweep * 180 / Math.PI };
    });
    ticks += 4;
    const b = r.b;
    if (r.st !== 'play' && r.st !== 'results') break;
    if (r.st === 'results') break;
    if (want.traffic && b.s > 200 && r.ahead >= 2 && b.grounded) { want.traffic = 0; shotsInfo.traffic = await shot(page, '24-a2-traffic'); }
    if (want.air && r.crests > 0 && !b.grounded && b.airT > 0.35 && b.mode === 'air') { want.air = 0; shotsInfo.air = await shot(page, '25-a2-intersection-air'); }
    if (want.trick && b.trickOn && b.airT > 0.25) { want.trick = 0; shotsInfo.trick = await shot(page, '26-a2-trick'); }
    if (want.pier && b.s > bumperS - 42 && b.mode !== 'flight') { want.pier = 0; shotsInfo.pier = await shot(page, '27-a2-pier-bumper'); }
    if (b.mode === 'flight' && b.timeScale < 1 && want.orbit && r.sweep >= 50 + orbitN * 85) { orbitN++; want.orbit--; shotsInfo['orbit' + orbitN] = await shot(page, '28-a2-orbit-' + orbitN); }
    if (want.flight && b.mode === 'flight' && b.timeScale >= 1 && b.flightU > 0.35) { want.flight = 0; shotsInfo.flight = await shot(page, '29-a2-flight'); }
    if (b.mode === 'land' && b.touch && goalAt < 0) goalAt = ticks;
    if (want.goal && goalAt >= 0 && ticks - goalAt > 40) { want.goal = 0; shotsInfo.goal = await shot(page, '30-a2-goal'); }
  }
  const runEnd = await ev(page, () => {
    const K = __K, G = K.game, B = K.board, b = B.stats();
    T.until(() => G.state === 'results', 600);
    return { st: G.state, b, time: +G.time.toFixed(2), rings: G.rings, lives: G.lives, score: G.score, tw: { n: T.tw.n, max: +T.tw.max.toFixed(2), at: T.tw.at, sweep: +(T.tw.sweep * 180 / Math.PI).toFixed(1), orbitTicks: T.tw.orbitTicks, cine: T.tw.cine },
      complete: T.cnt['G.onActComplete'] || 0, tricksEv: T.cnt['G.onTrick'] || 0, events: T.bs.events.slice(0, 16), deaths: T.cnt['G.onDeath'] || 0, post: K.post.ok };
  });
  await ev(page, () => T.stopSkate());
  const b = runEnd.b;
  check('Act 2: the skate bot rides the whole descent to the bumper (real game, no teleports)', b.hoops >= 1 && runEnd.tw.n === 0 && runEnd.complete === 1 && runEnd.deaths <= 2, { time: runEnd.time, tw: runEnd.tw, deaths: runEnd.deaths, stats: b, events: runEnd.events });
  check('Act 2: tricks score points (trick events, combo chain, FIGURES total)', b.landed >= 1 && b.trickScore > 0 && runEnd.tricksEv >= 3, { landed: b.landed, tricks: b.tricks, trickScore: b.trickScore, events: runEnd.tricksEv });
  check('Act 2: bumper -> slow motion -> the camera orbits 360° around Kit (cinematic letterbox) -> flight', runEnd.tw.sweep >= 300 && runEnd.tw.orbitTicks > 60 && (!runEnd.post || runEnd.tw.cine > 0.5) && b.hoops >= 1, { tw: runEnd.tw, post: runEnd.post });
  await ev(page, () => T.ticks(150));
  shotsInfo.results = await shot(page, '31-a2-results');
  const fin = await ev(page, () => {
    const K = __K, G = K.game;
    const r = { st: G.state, act: G.res && G.res.act, tricks: G.res && G.res.tricks };
    T.until(() => G.res && G.res.done, 900);
    T.ticks(70); T.tapKey('Space'); T.ticks(4); r.s1 = G.state;
    return r;
  });
  shotsInfo.end = await shot(page, '32-a2-end');
  const fin2 = await ev(page, () => { const K = __K, G = K.game; T.ticks(50); T.tapKey('Space'); T.ticks(4); return { s2: G.state, act: G.act, island: K.world.visible, city: K.city.entered, best2: K.store.get('best2', null), best1: K.store.get('best', null) }; });
  check('Act 2: goal -> results (FIGURES row) -> end screen -> title, Act 2 record saved', runEnd.st === 'results' && fin.act === 2 && fin.s1 === 'end' && fin2.s2 === 'title' && fin2.act === 1 && fin2.island && !fin2.city && fin2.best2 && fin2.best2.time > 30 && !fin2.best1, { runEnd: { st: runEnd.st, time: runEnd.time, score: runEnd.score }, fin, fin2 });
  const maxCalls = Math.max(...Object.values(shotsInfo).map(s => s.calls));
  check('Act 2: draw calls under budget in every view, no page/console errors', maxCalls < 300 && errors.length === 0, { shots: shotsInfo, errors: errors.slice(0, 5) });
}

// ---------- post-processing pipeline: presets from the pause menu, persistence, fallback without jsDelivr ----------
async function postChecks(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const open = async () => {
    const page = await ctx.newPage();
    const errors = [];
    await preparePage(page, errors);
    await bootPage(page);
    return { page, errors };
  };
  const { page, errors } = await open();
  const st = await ev(page, () => { T.ticks(40); T.frame(); const s = __K.post.stats(); return { ok: s.ok, hdr: s.hdr, quality: s.quality, superRes: s.superRes, passes: s.passes, env: s.env, calls: s.sceneCalls, gfx: s.gfx }; });
  // v3 intent of the v2 check (HDR + bloom + grade): THREE.RenderPipeline with the scene pass, bloom and the ACES/sRGB
  // output transform. PENDING(post): GTAO / SSR / godrays / DOF / TRAA passes and the full grade once ported.
  check('post pipeline: RenderPipeline (scene pass + bloom + ACES grade) active, desktop default "Élevé", env map', st.ok && st.hdr && st.quality === 'high' && !st.superRes && st.passes.some(p => /bloom/.test(p)) && st.passes.some(p => /aces/.test(p)) && st.env && st.calls < 300 && st.gfx.preset === 'high', st);
  // presets through the pause menu rows (Graphismes: right arrow cycles, Super Résolution: Enter toggles)
  const pres = await ev(page, () => {
    const K = __K, G = K.game, out = [];
    T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300); T.ticks(20);
    T.tapKey('Escape'); T.ticks(2);
    T.key('ArrowDown', true); T.ticks(2); T.key('ArrowDown', false); T.ticks(2);
    for (let i = 0; i < 4; i++) {
      T.key('ArrowRight', true); T.ticks(2); T.key('ArrowRight', false); T.ticks(2);
      T.frame();
      const s = K.post.stats(), g = T.glStats();
      out.push({ sel: G.pauseSel, q: K.post.quality, stored: K.store.get('gfx', null), hdr: s.hdr, passes: s.passes, calls: s.sceneCalls, mean: g.mean, gfx: s.gfx, texRes: K.tex.res });
    }
    T.key('ArrowDown', true); T.ticks(2); T.key('ArrowDown', false); T.ticks(2);
    T.tapKey('Enter'); T.ticks(2); T.frame();
    const g = T.glStats();
    const sr = { sel: G.pauseSel, on: K.post.superRes, stored: K.store.get('superres', null), scale: K.post.stats().scale, internal: K.post.stats().internal, mean: g.mean };
    T.key('ArrowUp', true); T.ticks(2); T.key('ArrowUp', false); T.ticks(2);
    T.key('ArrowLeft', true); T.ticks(2); T.key('ArrowLeft', false); T.ticks(2); // back from 'low' (wrapped) to ... one step left
    T.frame();
    return { out, sr, final: K.post.quality, paused: G.paused };
  });
  await shot(page, '33-pause-graphics');
  const qs = pres.out.map(o => o.q), byQ = q => pres.out.find(o => o.q === q) || {};
  // v3 intent: each preset changes the pipeline and the K.gfx content knobs (Économie: no bloom, half textures, no fur
  // shells; Ultra: bloom, full textures, 16 fur shells); Super Résolution renders at a lower internal resolution
  check('quality presets switch from the pause menu (Ultra/Élevé/Moyen/Économie + K.gfx knobs, Super Résolution) without errors', pres.out.every(o => o.sel === 1 && o.stored === o.q && o.calls < 320 && o.mean > 30) &&
    new Set(qs).size === 4 && !byQ('low').passes.some(p => /bloom/.test(p)) && byQ('ultra').passes.some(p => /bloom/.test(p)) &&
    byQ('low').gfx.furShells === 0 && byQ('low').gfx.texRes === 'half' && byQ('low').texRes === 'half' && byQ('ultra').gfx.furShells === 16 && byQ('ultra').gfx.texRes === 'full' &&
    pres.sr.sel === 2 && pres.sr.on === true && pres.sr.stored === true && pres.sr.scale < 1 && pres.sr.mean > 30 && errors.length === 0, { pres, errors: errors.slice(0, 3) });
  // a new page in the same browser profile starts with the saved settings
  const { page: page2, errors: errors2 } = await open();
  const saved = await ev(page2, () => ({ q: __K.post.quality, sr: __K.post.superRes, ok: __K.post.ok, gfx: __K.gfx.preset }));
  check('graphics settings persist across reloads (K.store gfx / superres)', saved.q === pres.final && saved.gfx === pres.final && saved.sr === true && saved.ok && errors2.length === 0, { saved, final: pres.final });
  await ctx.close();

  // v3 intent of the v2 "jsDelivr blocked" fallback: the post pipeline is off (?nopost) -> direct rendering through
  // the renderer's own ACES output, both acts still play
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pg = await ctx2.newPage();
  const errs = [];
  await preparePage(pg, errs);
  await bootPage(pg, gameUrl(WEBGPU ? '?nopost' : '?gl&nopost'));
  const fb1 = await ev(pg, () => { T.ticks(40); T.tapKey('Space'); T.ticks(4); T.until(() => __K.game.state === 'play', 300); T.key('KeyW', true); T.ticks(90); T.key('KeyW', false); const g = T.glStats(); return { ok: __K.post.ok, why: __K.post.stats().why, vfx: __K.vfx.ready, z: +__K.player.pos.z.toFixed(1), mean: g.mean, std: g.std }; });
  await shot(pg, '34-fallback-act1');
  const fb2 = await ev(pg, () => {
    const K = __K, G = K.game;
    T.tapKey('Escape'); T.ticks(2);
    for (let i = 0; i < 3; i++) { T.key('ArrowDown', true); T.ticks(2); T.key('ArrowDown', false); T.ticks(2); }
    T.tapKey('Enter'); T.ticks(30);
    T.key('ArrowRight', true); T.ticks(3); T.key('ArrowRight', false); T.ticks(3);
    T.tapKey('Space'); T.ticks(2);
    T.until(() => G.state === 'play', 900);
    T.key('ArrowUp', true); T.ticks(240); T.key('ArrowUp', false);
    const g = T.glStats(), b = K.board.stats();
    return { act: G.act, state: G.state, s: b.s, mode: b.mode, mean: g.mean, std: g.std, env: !!K.view.scene.environment };
  });
  await shot(pg, '35-fallback-act2');
  check('post fallback: pipeline off (?nopost) -> direct rendering, Act 1 and Act 2 still play without errors', !fb1.ok && fb1.z < -10 && fb1.mean > 40 && fb1.std > 12 && fb2.act === 2 && fb2.state === 'play' && fb2.s > 60 && fb2.mean > 30 && fb2.std > 10 && errs.length === 0, { fb1, fb2, errs: errs.slice(0, 3) });
  await ctx2.close();
}

// ---------- regression checks for the review findings (gameplay) ----------
async function regressGameplay(browser) {
  const { ctx, page, errors } = await openGame(browser, { viewport: { width: 640, height: 360 } });
  await ev(page, () => { try { localStorage.clear(); } catch (e) { /* ignore */ } __K.game.best = null; T.ticks(40); T.tapKey('Space'); T.ticks(4); T.until(() => __K.game.state === 'play', 300); });

  // chasm wasps are homing stepping stones: they never shoot (a shot over the pit could only knock Kit into it)
  const calm = await ev(page, () => {
    const K = __K, P = K.player, G = K.game, E = K.entities;
    const w = K.level.enemies.filter(e => e.type === 'wasp' && e.pos.z < -236 && e.pos.z > -262);
    G.lives = 9; G.cpIndex = -1; E.reset(); G.rings = 10;
    T.teleport(0, -234.5, 0, 0);
    const h0 = T.cnt['P.hurt'] || 0;
    let k = 0;
    for (; k < 420; k++) { P.invT = 0; T.ticks(1); if (P.dead) break; }
    return { wasps: w.length, calm: w.every(e => e.calm), hurtCalls: (T.cnt['P.hurt'] || 0) - h0, dead: P.dead, ticks: k };
  });
  check('regression: the chasm wasps never shoot at a vulnerable Kit (7 s at the edge)', calm.wasps === 3 && calm.calm && calm.hurtCalls === 0 && !calm.dead, calm);

  // a slow approach takes the loop band (Kit runs up and rolls back out); Kit never walks through the band or shell
  const slow = await ev(page, () => {
    const K = __K, P = K.player, G = K.game, out = [];
    const inside = lp => {
      const R0 = lp.radius, half = lp.width / 2; let n = 0;
      for (const dy of [0.05, 0.6, 1.15]) {
        const up = P.up, px = P.pos.x + up.x * dy, py = P.pos.y + up.y * dy, pz = P.pos.z + up.z * dy;
        const rx = px - lp.entry.x, rz = pz - lp.entry.z, a = rx * lp.dir.x + rz * lp.dir.z, b = rx * lp.side.x + rz * lp.side.z;
        const h = py - lp.entry.y, f = Math.hypot(a, h - R0);
        let th = Math.atan2(a, R0 - h); if (th < 0) th += Math.PI * 2;
        if (f > R0 + 0.05 && f < R0 + lp.thick - 0.05 && Math.abs(b - lp.shift * th / (Math.PI * 2)) < half - 0.1) n++;
      }
      return n;
    };
    for (const lp of K.level.loops) for (const [sp, lat] of [[3, 0], [10, 0], [10, 1.5], [13, 0], [16, 0], [10, 3.2]]) {
      if (P.dead || G.state !== 'play') T.until(() => G.state === 'play' && !P.dead, 900);
      const yaw = T.yawOf(lp.dir.x, lp.dir.z);
      T.teleport(lp.entry.x - lp.dir.x * 10 + lp.side.x * lat, lp.entry.z - lp.dir.z * 10 + lp.side.z * lat, yaw, sp);
      T.pre = () => { if (!P.inLoop) T.steerYaw(yaw, sp / 20); };
      let bad = 0, looped = false;
      for (let k = 0; k < 200; k++) { T.ticks(1); if (P.inLoop) looped = true; else bad += inside(lp); }
      T.stop();
      out.push({ sp, lat, looped, bad });
    }
    return out;
  });
  check('regression: slow loop entries take the band and Kit never passes through the loop band or shell', slow.every(c => c.bad === 0) && slow.filter(c => c.lat < 2).every(c => c.looped), slow);

  // the invincibility monitor sits in section 7 and Dr Boulon's arrival ends invincibility before the fight
  const star = await ev(page, () => {
    const K = __K, P = K.player, G = K.game, E = K.entities, B = K.level.boss;
    const mon = K.level.monitors.find(m => m.kind === 'star');
    G.lives = 9; G.cpIndex = 2; G.cpTime = 40; G.bossDone = false; E.reset();
    const cp = K.level.checkpoints[2];
    T.teleport(cp.pos.x, cp.pos.z, cp.yaw, 0);
    P.star = 20;
    T.pre = () => T.steerYaw(T.yawOf(B.center.x - P.pos.x, B.center.z - P.pos.z), 1);
    T.until(() => G.bossActive, 600);
    const atStart = +P.star.toFixed(2);
    T.stop();
    T.until(() => E.stats().boss === 'fight', 400);
    return { monZ: mon && +mon.pos.z.toFixed(1), atBossStart: atStart, atFight: +P.star.toFixed(2), boss: E.stats().boss };
  });
  check('regression: the star monitor is in section 7 and invincibility is gone when the boss fight starts', star.monZ > -560 && star.monZ < -480 && star.atBossStart <= 1.5 && star.atFight === 0 && star.boss === 'fight', star);

  // pausing while a direction is held keeps "Reprendre" selected
  const pause = await ev(page, () => {
    const K = __K, P = K.player, G = K.game;
    G.bossActive = false; G.cpIndex = -1; G.lives = 9; P.kill('fall');
    T.until(() => G.state === 'card', 400); T.until(() => G.state === 'play', 400);
    const out = {};
    for (const [hold, conf] of [['KeyS', 'Space'], ['ArrowDown', 'Enter']]) {
      T.teleport(0, -8, 0, 12); T.ticks(5);
      T.key(hold, true); T.ticks(5); T.tapKey('Escape'); T.ticks(3);
      const sel = G.pauseSel; T.key(hold, false); T.ticks(2);
      T.tapKey(conf); T.ticks(3);
      out[hold] = { sel, state: G.state, paused: G.paused };
      if (G.state !== 'play') { T.ticks(40); T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300); }
    }
    return out;
  });
  check('regression: pausing while holding S / Down keeps "Reprendre" selected and the confirm key resumes', Object.values(pause).every(o => o.sel === 0 && o.state === 'play' && !o.paused), pause);

  // a time over restarts the clock at the checkpoint but that run earns no time bonus and no time record
  const tover = await ev(page, () => {
    const K = __K, P = K.player, G = K.game;
    const best0 = K.store.get('best', null);
    G.lives = 3; G.cpIndex = 2; G.cpTime = 40; P.kill('fall');
    T.until(() => G.state === 'card', 400); T.until(() => G.state === 'play', 400);
    G.time = 599.5;
    T.until(() => P.dead, 120); T.until(() => G.state === 'card', 400); T.until(() => G.state === 'play', 400);
    const after = { time: G.time, flag: G.timeOver };
    T.ticks(120);
    G.onCapsule();
    const tb = G.res ? G.res.tb0 : null;
    T.ticks(60 * 8);
    return { after, timeBonus: tb, state: G.state, newRecord: G.newRecord, best0, best: K.store.get('best', null), finalTime: +G.time.toFixed(2) };
  });
  check('regression: after a time over the finish gives no time bonus and no time record', tover.after.flag === true && tover.after.time === 0 && tover.timeBonus === 0 && tover.newRecord === false && !(tover.best && tover.best.time < 30), tover);

  // holding forward from checkpoint 2 takes checkpoint 3 and reaches the arena (the causeway rim stops the sea fall)
  const cp3 = await ev(page, () => {
    const K = __K, P = K.player, G = K.game, W = K.world;
    // (Act 1 results lead on to Act 2: come back to the title through the pause menu, then start Act 1 again)
    if (G.state !== 'play') { T.toTitle(); T.ticks(40); T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 400); }
    const out = [];
    for (const lat of [null, 10, 14]) {
      G.lives = 9; G.cpIndex = 1; G.cpTime = 10; G.bossActive = false; if (!P.dead) P.kill('fall');
      T.until(() => G.state === 'card', 400); T.until(() => G.state === 'play', 400);
      T.key('KeyW', true);
      let died = null;
      for (let k = 0; k < 60 * 25; k++) {
        if (lat !== null && P.pos.z < -560 && P.pos.z > -580 && !P.dead) {
          const ri = W.routeInfo(P.pos.x, P.pos.z);
          T.steerYaw(T.yawOf(ri.dir.x * 8 + ri.right.x * (lat - ri.d), ri.dir.z * 8 + ri.right.z * (lat - ri.d)), 1);
        } else T.move = null;
        T.ticks(1);
        if (P.dead) { died = P.pos.toArray().map(v => +v.toFixed(1)); break; }
        if (G.bossActive) break;
      }
      T.key('KeyW', false); T.stop();
      out.push({ lat, died, cp: G.cpIndex, boss: G.bossActive });
    }
    return out;
  });
  check('regression: holding forward past checkpoint 3 (centre and right side) takes it and never falls into the sea', cp3.every(c => !c.died && c.cp === 2 && c.boss), cp3);

  // death camera: a non-pit death keeps the scene in view (no flat green frames); the game over backdrop too
  const death = await ev(page, () => {
    const K = __K, G = K.game, P = K.player, res = {};
    T.ticks(30);
    for (const where of ['start', 'arena']) {
      G.bossActive = false; G.cpIndex = -1; G.lives = 5;
      if (G.state !== 'play') T.until(() => G.state === 'play', 400);
      const s = K.world.spots[where]; T.teleport(s.x, s.z + 6, T.routeDirYaw(s.x, s.z + 6)); T.ticks(30);
      G.rings = 0; P.shield = false; P.invT = 0; P.star = 0;
      P.hurt(P.pos.clone().add(new THREE.Vector3(0, 0, -1)));
      let minStd = 1e9, k = 0;
      while (G.state === 'play' && k < 400) { T.ticks(10); k += 10; minStd = Math.min(minStd, T.glStats().std); }
      res[where] = { minStd, ticks: k };
      T.until(() => G.state === 'play', 400);
    }
    G.lives = 0; P.kill('hurt');
    T.until(() => G.state === 'over', 400); T.ticks(60);
    res.over = T.glStats();
    T.ticks(400);
    return res;
  });
  check('regression: death camera never turns into a flat screen; game over shows the scene', death.start.minStd > 10 && death.arena.minStd > 10 && death.over.std > 10 && death.over.colors > 20, death);
  check('regression pages: no page or console errors', errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}

// ---------- regression checks for the review findings (presentation) ----------
async function regressPresentation(browser) {
  // fixed-step judder: drawn motion advances evenly at 75 / 90 / 144 / 165 Hz
  {
    const { ctx, page } = await openGame(browser, { viewport: { width: 320, height: 180 } });
    const r = await ev(page, () => {
      const K = __K, R = K.view.renderer, cam = K.view.camera;
      T.ticks(40); T.tapKey('Space'); T.ticks(4); T.until(() => K.game.state === 'play', 300);
      const kit = K.view.scene.children.find(o => o.name === 'kit');
      const res = {};
      for (const hz of [60, 75, 90, 120, 144, 165]) {
        T.teleport(0, 24, 0, 18); T.move = { x: 0, y: 1 };
        for (let i = 0; i < hz * 0.6; i++) window.__pump(1000 / hz);
        // a frame through the post pipeline is several renderer calls: count frames where they are drawn
        const D = K.post && K.post.ok ? K.post : R;
        const imgs = [], orig = D.render;
        let t = 0;
        D.render = function () { imgs.push([t, kit.position.z, cam.position.z]); };
        for (let i = 0; i < hz * 0.8; i++) { window.__pump(1000 / hz); t += 1000 / hz; }
        D.render = orig;
        const vk = [], vc = [];
        for (let j = 2; j < imgs.length; j++) { const dt = imgs[j][0] - imgs[j - 1][0]; vk.push((imgs[j][1] - imgs[j - 1][1]) / dt); vc.push((imgs[j][2] - imgs[j - 1][2]) / dt); }
        const cv = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length) / Math.abs(m || 1); };
        res[hz] = { perSec: Math.round(imgs.length / 0.8), kitCV: +cv(vk).toFixed(3), camCV: +cv(vc).toFixed(3) };
      }
      T.move = null;
      return res;
    });
    check('regression: drawn motion is even at 60/75/90/120/144/165 Hz (render interpolation)', Object.values(r).every(o => o.kitCV < 0.03 && o.camCV < 0.03), r);
    await ctx.close();
  }
  // adaptive resolution: a browser-capped 30 Hz cadence keeps the pixel ratio; a really slow machine drops it (never
  // below 1 on a 2x screen) and fast frames bring it back
  {
    const pump = (page, ms, n, busy) => ev(page, ([ms, n, busy]) => {
      const R = __K.view.renderer, o = R.render;
      if (busy) R.render = function () { const t = performance.now(); while (performance.now() - t < busy) { /* simulated GPU-bound frame */ } };
      for (let i = 0; i < n; i++) window.__pump(Array.isArray(ms) ? ms[i % ms.length] : ms);
      R.render = o;
      return __K.view.dpr;
    }, [ms, n, busy]);
    const res = {};
    for (const [name, prof] of [['desktop2x', { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 }], ['phone', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }]]) {
      const { ctx, page } = await openGame(browser, prof);
      await ev(page, () => { const V = __K.view; T.draw = false; V._warm = 3000; V._acc = V._acc2 = V._n = V._win = V._work = 0; });
      const d0 = await ev(page, () => __K.view.dpr);
      const capped = await pump(page, 1000 / 30, 30 * 16, 0);
      const slow = await pump(page, [33.3, 50], 60 * 6, 0);
      let up = slow;
      for (let k = 0; k < 4 && up <= slow; k++) up = await pump(page, 1000 / 60, 60 * 12, 0);
      res[name] = { d0, capped30Hz: capped, afterSlow: slow, recovered: up };
      await ctx.close();
    }
    check('regression: adaptive resolution ignores a browser 30 Hz cap, drops when slow (floor 1 on 2x screens) and recovers', Object.values(res).every(o => o.capped30Hz === o.d0 && o.afterSlow < o.d0 && o.afterSlow >= 1 && o.recovered > o.afterSlow), res);
  }
  // three.js blocked (its module cannot load): the French error screen with the link to the classic version
  {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.route(/\/lib\/three\/three\.webgpu\.js$/, r => r.abort());
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto(gameUrl(), { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => !document.getElementById('fatal').hidden, null, { timeout: 20000 }).catch(() => {});
    const st = await page.evaluate(() => {
      const f = document.getElementById('fatal'), a = f.querySelector('a'), r = f.getBoundingClientRect();
      return { shown: !f.hidden, w: Math.round(r.width), h: Math.round(r.height), text: f.textContent.replace(/\s+/g, ' ').trim().slice(0, 160), href: a && a.getAttribute('href'), K: !!window.__K };
    });
    await page.screenshot({ path: path.join(SHOTS, '13-no-threejs.png') });
    check('regression: if three.js cannot load, the French error screen links to the classic version (no exception)', errs.length === 0 && st.shown && st.w >= 800 && /pas pu/.test(st.text) && st.href === 'legacy/', { st, errs: errs.slice(0, 2) });
    await ctx.close();
  }
}

// ---------- regression checks for the v2 review findings (Act 2 city, bumper, traffic, looks) ----------
async function toAct2(page) {
  return ev(page, () => {
    const G = __K.game; T.ticks(40);
    T.key('ArrowRight', true); T.ticks(3); T.key('ArrowRight', false); T.ticks(3);
    T.tapKey('Space'); T.ticks(2);
    T.until(() => G.state === 'card', 400); T.until(() => G.state === 'play', 400);
    return { state: G.state, act: G.act };
  });
}
async function regressAct2(browser) {
  const { page, errors } = await openGame(browser, { viewport: { width: 1280, height: 720 } });
  const a2 = await toAct2(page);
  // the land never covers a cross street (down each side street's centre line, as far as the street goes)
  const side = await ev(page, () => {
    const K = __K, C = K.city, rc = new THREE.Raycaster(), city = C.group, kindOf = h => (h.object.geometry.attributes.aKind ? h.object.geometry.attributes.aKind.getX(h.face.a) : -1);
    const out = { lines: {}, buried: 0, short: [] };
    for (const [nm, sides] of [['iA1', [-1, 1]], ['iA2', [-1, 1]], ['iA4', [-1, 1]], ['iB', [-1, 1]], ['iC1', [-1, 1]], ['iC2', [-1, 1]], ['iC3', [-1, 1]], ['iW', [-1]]]) {
      const s = C.feature(nm), r = C.route(s), y0 = r.y, cx = r.pos.x, cz = r.pos.z, rx = r.right.x, rz = r.right.z;
      for (const sd of sides) {
        let line = '';
        for (let t = 30; t <= 250; t += 10) {
          rc.set(new THREE.Vector3(cx + rx * sd * t, y0 + 300, cz + rz * sd * t), new THREE.Vector3(0, -1, 0)); rc.far = 700;
          const hits = rc.intersectObject(city, true).filter(h => h.object.visible && h.object.isMesh && !h.object.isInstancedMesh && !(h.object.material && h.object.material.transparent));
          const asph = hits.find(h => kindOf(h) === 4), top = hits[0];
          if (!asph) { line += top && top.object.name === 'city-land' ? 'T' : 'B'; continue; }
          const dy = top.point.y - asph.point.y;
          if (top === asph || dy < 0.2) line += '.';
          else if (top.object.name === 'city-land') { line += 't'; out.buried++; }
          else line += 'b';
        }
        out.lines[nm + (sd > 0 ? 'R' : 'L')] = line;
        if (!/^\.{8}/.test(line)) out.short.push(nm + sd);
      }
    }
    return out;
  });
  check('regression: every cross street is carved out of the hill (no land over its asphalt, each street runs >= 100 m)', a2.act === 2 && side.buried === 0 && side.short.length === 0, side);
  // the background city (land + grid blocks) never rises over the route's street (rays down on the whole corridor)
  const corridor = await ev(page, () => {
    const K = __K, C = K.city, rc = new THREE.Raycaster();
    const bg = C.group.children.filter(o => o.isMesh && (o.name === 'city-land' || o.name === 'city-bg'));
    let n = 0, bad = 0, worst = 0;
    const samples = [];
    for (let s = 0; s <= C.feature('t4a'); s += 4) for (let d = -10; d <= 10; d += 2) {
      const p = C.routePoint(s, d, 0), g = C.ground(p.x, p.z, p.y + 0.6);
      if (!g) continue;
      rc.set(new THREE.Vector3(p.x, g.y + 40, p.z), new THREE.Vector3(0, -1, 0)); rc.far = 80;
      const h = rc.intersectObjects(bg, false)[0];
      n++;
      if (h && h.point.y > g.y - 0.1) { bad++; worst = Math.max(worst, h.point.y - g.y); if (samples.length < 8) samples.push([s, d, +(h.point.y - g.y).toFixed(2), h.object.name]); }
    }
    return { n, bad, worst: +worst.toFixed(2), samples, bgMeshes: bg.length };
  });
  check('regression: no background slab or land over the route corridor (|d| <= 10, start -> pier)', corridor.n > 2000 && corridor.bad === 0 && corridor.bgMeshes > 4, corridor);
  // the bumper kicks Kit up and over its dome: never inside it, never hidden behind it during the 360° orbit
  const orbit = await ev(page, () => {
    const K = __K, C = K.city, B = K.board, P = K.player, cam = K.view.camera, out = [];
    const prof = r => (r < 2.79 ? 2.4 + Math.sqrt(3.3 * 3.3 - r * r) : r < 3.7 ? 3.28 : r < 3.8 ? 1.5 : r < 4.3 ? 0.5 : 0);
    for (const d of [0, 2.5, -2.5]) {
      const base = C.bumper.base, kc = new THREE.Vector3();
      P.invT = 0; K.game.rings = Math.max(K.game.rings, 5);
      T.place2(C.feature('bumper') - 60, d, 30);
      T.key('ArrowUp', true); const at = T.until(() => B.mode === 'flight', 600); T.key('ArrowUp', false);
      let n = 0, minClear = 1e9, occl = 0, inside = 0, lowNear = 0, minRhoLow = 1e9;
      for (let k = 0; k < 400 && B.mode === 'flight' && B.timeScale < 1; k++) {
        T.ticks(1); n++;
        const rho = Math.hypot(P.pos.x - base.x, P.pos.z - base.z), up = P.pos.y - base.y;
        minClear = Math.min(minClear, up - prof(Math.max(0, rho - 0.45)));
        if (up < 3.8) { minRhoLow = Math.min(minRhoLow, rho); if (rho < 4.4) lowNear++; }
        const cr = Math.hypot(cam.position.x - base.x, cam.position.z - base.z), cy = cam.position.y - base.y;
        if (cr < 4.35 && cy > -0.2 && cy < 5.8) inside++;
        kc.copy(P.center());
        let hit = false;
        for (let i = 1; i < 24 && !hit; i++) {
          const t = i / 24, x = cam.position.x + (kc.x - cam.position.x) * t - base.x, y = cam.position.y + (kc.y - cam.position.y) * t - base.y, z = cam.position.z + (kc.z - cam.position.z) * t - base.z;
          if (y > 0 && y < prof(Math.hypot(x, z))) hit = true;
        }
        if (hit) occl++;
      }
      out.push({ d, at, n, minClear: +minClear.toFixed(2), lowNear, minRhoLow: +minRhoLow.toFixed(2), occl, inside, sweep: B.stats().orbitSweep });
      T.until(() => B.mode === 'land', 900);
    }
    return out;
  });
  check('regression: the bumper kicks Kit over its dome (never inside the bumper, never hidden from the orbit camera)', orbit.every(o => o.at >= 0 && o.n > 150 && o.minClear >= 0 && o.lowNear === 0 && o.occl === 0 && o.inside === 0 && o.sweep >= 300), orbit);
  // the top of the route is closed: riding back up along a facade stops at the barriers (no slide past s = 0, no snap back)
  const back = await ev(page, () => {
    const K = __K, C = K.city, B = K.board, P = K.player, out = [];
    const top = C.routePoint(0, 0, 0), dir = C.route(0).dir.clone();
    for (const d of [10.2, -10.2, 6]) {
      const pos = C.routePoint(14, d, 0), g = C.ground(pos.x, pos.z, pos.y + 2); if (g) pos.y = g.y;
      const r = C.route(14);
      B.start({ pos, yaw: Math.atan2(r.dir.x, r.dir.z), s: 14 }); P.vel.set(-r.dir.x * 14, 0, -r.dir.z * 14); P.invT = 9;
      T.key('ArrowUp', true);
      let minBack = 1e9, maxJump = 0; const prev = P.pos.clone();
      for (let k = 0; k < 240; k++) {
        T.ticks(1);
        minBack = Math.min(minBack, (P.pos.x - top.x) * dir.x + (P.pos.z - top.z) * dir.z);
        maxJump = Math.max(maxJump, P.pos.distanceTo(prev)); prev.copy(P.pos);
      }
      T.key('ArrowUp', false);
      out.push({ d, minBack: +minBack.toFixed(2), maxJump: +maxJump.toFixed(2), dead: P.dead });
    }
    return out;
  });
  check('regression: barriers close the top of the route (Kit stops at s = 0 along the facades, no 6-12 m snap back)', back.every(o => o.minBack > 0.3 && o.maxJump < 1 && !o.dead), back);
  // the ring arcs round the left bends (turns 2 and 3) stay on Kit's side, clear of the oncoming lane (cable car, streetcar)
  const bends = await ev(page, () => {
    const C = __K.city, R = C.ringData, out = [];
    for (const [a, b] of [['t2a', 't2b'], ['t3a', 't3b']]) {
      const s0 = C.feature(a) - 5, s1 = C.feature(b) + 7;
      let n = 0, onSide = 0, inside = 0;
      for (let i = 0; i < R.flight0; i++) { const q = C.routeAt(R.pos[i].x, R.pos[i].z); if (q && q.s >= s0 && q.s <= s1) { n++; if (q.d >= 4.5) onSide++; if (q.d < -1.5) inside++; } }
      out.push({ bend: a, n, onSide, inside });
    }
    return out;
  });
  check('regression: the turn 2 / turn 3 ring arcs run on Kit\'s side of the street (clear of the oncoming cable car lane)', bends.every(o => o.onSide >= 6 && o.inside === 0), bends);
  // the streets in the shade stay readable (asphalt luma of the lower frame, desktop "Élevé" and "Économie")
  const shade = await ev(page, () => {
    const K = __K, out = {};
    for (const q of ['high', 'low']) {
      if (K.post && K.post.ok) K.post.setQuality(q);
      for (const s0 of [640, 1120]) {
        T.place2(s0, 0, 0); K.player.vel.set(0, 0, 0); K.player.invT = 9; T.ticks(90); T.frame();
        const { w, h, px } = T.pixelsGL();
        const L = [];
        for (let y = Math.floor(h * 0.05); y < Math.floor(h * 0.35); y += 2) for (let x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x += 2) { const i = (y * w + x) * 4; L.push(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]); }
        L.sort((a, b) => a - b);
        out[q + s0] = { p10: Math.round(L[Math.floor(L.length * 0.1)]), med: Math.round(L[L.length >> 1]) };
      }
    }
    if (K.post && K.post.ok) K.post.setQuality('high');
    return out;
  });
  check('regression: shaded Act 2 streets stay readable (road luma p10 >= 30, median 35-60 on Élevé and Économie)', Object.values(shade).every(o => o.p10 >= 30 && o.med >= 35 && o.med <= 60), shade);
  // Act 2 does not play itself: threats on the crown of the street. Holding only forward (real key) meets them and takes
  // hits; the old hands-off ollie onto the grind rail is gone
  const hold = await ev(page, () => {
    const K = __K, G = K.game, C = K.city, P = K.player, B = K.board;
    const fixed = C.cars.filter(c => c.fixed).map(c => ({ t: c.type, s: Math.round(c.s), d: +c.d.toFixed(1) }));
    G.cpIndex = -1; G.rings = 0; G.time = 0; G.lives = Math.max(G.lives, 3);
    C.reset({ full: true }); T.place2(C.start.s, 0); P.invT = 0;
    const g0 = B.stats().grinds, hits = [];
    const hk = P.hurt;
    P.hurt = function (from) {
      if (!(P.invT > 0)) {
        let car = null;
        if (from) for (const c of C.cars) if (c.pos === from || c.pos.distanceTo(from) < 0.01) car = c;
        const ra = C.routeAt(P.pos.x, P.pos.z);
        hits.push({ s: ra ? Math.round(ra.s) : -1, what: car ? (car.fixed ? (car.type === 6 ? 'works' : 'van') : car.runner ? 'runner' : car.pull ? 'pullout' : car.kind) : 'other', rings: G.rings });
      }
      return hk.apply(this, arguments);
    };
    const d0 = T.cnt['G.onDeath'] || 0;
    T.key('ArrowUp', true);
    const flight = T.until(() => B.mode === 'flight' || G.state === 'over', 60 * 170);
    T.key('ArrowUp', false);
    const res = T.until(() => G.state === 'results' || G.state === 'over', 60 * 60);
    P.hurt = hk;
    return { fixed, hits, flight, res, state: G.state, deaths: (T.cnt['G.onDeath'] || 0) - d0, grinds: B.stats().grinds - g0, time: +G.time.toFixed(1) };
  });
  const kinds = new Set(hold.hits.map(h => h.what));
  // Kit may or may not survive a hands-off run (traffic timing varies), but each stop-sign runner strikes at most once:
  // a checkpoint respawn does not replay the same ambush
  const runnerS = hold.hits.filter(h => h.what === 'runner').map(h => h.s);
  check('regression: Act 2 has centre-line threats (works islands, double-parked vans, pull-outs, a stop-sign runner): holding forward takes hits, no hands-off grind, no runner replay after a respawn',
    hold.fixed.filter(f => f.t === 6 && Math.abs(f.d) < 0.5).length >= 3 && hold.fixed.filter(f => f.t === 7).length >= 2 && hold.hits.length >= 2 && kinds.has('works') &&
    (kinds.has('runner') || kinds.has('pullout')) && (hold.state === 'results' || hold.state === 'over') && new Set(runnerS).size === runnerS.length &&
    hold.grinds === 0, hold);
  await ev(page, () => { T.toTitle(); T.ticks(10); });
  // Act 1 start valley: no lawn-stripe edge down the middle of the screen behind Kit (every preset)
  const seam = await ev(page, () => {
    const K = __K, G = K.game;
    if (G.state !== 'title') T.toTitle();
    T.ticks(20);
    if (G.sel !== 1) { T.key('ArrowLeft', true); T.ticks(3); T.key('ArrowLeft', false); T.ticks(3); }
    T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 400);
    const out = { act: G.act };
    for (const q of ['ultra', 'high', 'low']) {
      if (K.post && K.post.ok) K.post.setQuality(q);
      const st = K.level.start; T.teleport(st.pos.x, st.pos.z, st.yaw, 0); K.player.vel.set(0, 0, 0); T.ticks(100);
      T.frame();
      const { w, h, px } = T.pixelsGL();
      // mean luma per column over the grass in front of the camera (bottom quarter of the frame, GL rows from the bottom)
      const y0 = Math.floor(h * 0.03), y1 = Math.floor(h * 0.28), col = x => { let t = 0; for (let y = y0; y < y1; y++) { const i = (y * w + x) * 4; t += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; } return t / (y1 - y0); };
      const k = Math.max(3, Math.floor(w / 200)), step = x0 => { let a = 0, b = 0; for (let x = x0 - 2 * k; x < x0 - k; x++) a += col(x); for (let x = x0 + k; x < x0 + 2 * k; x++) b += col(x); return Math.abs(a - b) / k; };
      const others = [];
      for (let x0 = Math.floor(w / 8); x0 < w - w / 8; x0 += Math.floor(w / 12)) if (Math.abs(x0 - w / 2) > w / 10) others.push(step(x0));
      others.sort((a, b) => a - b);
      out[q] = { centre: +step(Math.floor(w / 2)).toFixed(1), others: +others[others.length >> 1].toFixed(1), othersMax: +others[others.length - 1].toFixed(1) };
    }
    if (K.post && K.post.ok) K.post.setQuality('high');
    return out;
  });
  check('regression: no lawn-stripe seam down the middle of the start valley (centre step like any other column, all presets)', seam.act === 1 && ['ultra', 'high', 'low'].every(q => seam[q] && seam[q].centre < 4.5 && seam[q].centre < seam[q].othersMax + 2), seam);
  // REGRESS2_HOOK
  check('regression Act 2 pages: no page or console errors', errors.length === 0, errors.slice(0, 5));
}

// ---------- v3: renderer backend, textures, budgets, legacy page, no GLSL ----------
async function v3Checks(browser) {
  // backend: ?gl forces the WebGL 2 backend; without WebGPU in the browser the renderer falls back to WebGL 2 by itself
  {
    const { ctx, page, errors } = await openGame(browser, { viewport: { width: 960, height: 540 } }, BASE + 'test.html?gl');
    const b1 = await ev(page, () => ({ backend: __K.view.backend, forceGL: __K.view.forceGL, ok: __K.view.ok }));
    await ctx.close();
    const ctx2 = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page2 = await ctx2.newPage();
    const errors2 = [];
    await preparePage(page2, errors2);
    await page2.addInitScript(() => { try { Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true }); } catch (e) { /* ignore */ } });
    await bootPage(page2, BASE + 'dev/world/site/test.html');
    const b2 = await ev(page2, () => { T.ticks(30); const g = T.glStats(); return { backend: __K.view.backend, forceGL: __K.view.forceGL, state: __K.game.state, mean: g.mean, label: (__K.game.state === 'title') }; });
    // the pause menu says which renderer runs
    const pause = await ev(page2, () => { const G = __K.game; T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300); T.tapKey('Escape'); T.ticks(3); T.frame(); return { paused: G.paused, rows: G.hudRects().pause.length }; });
    await shot(page2, '36-pause-renderer');
    await ctx2.close();
    check('renderer backend: ?gl forces WebGL 2, no WebGPU in the browser -> automatic WebGL 2 fallback, pause menu has "Version classique" + "Rendu"', b1.backend === 'webgl2' && b1.forceGL && b2.backend === 'webgl2' && !b2.forceGL && b2.state === 'title' && b2.mean > 40 && pause.paused && pause.rows === 5 && errors.length === 0 && errors2.length === 0, { b1, b2, pause, errors: errors.concat(errors2).slice(0, 3) });
  }
  // textures: the K.tex pipeline (manifest -> WebP -> THREE.Texture with the right colour space, full / half sets)
  {
    const { ctx, page, errors } = await openGame(browser, { viewport: { width: 960, height: 540 } });
    const tx = await page.evaluate(async () => {
      const X = __K.tex, THREE = window.THREE;
      await X.init();
      const names = Object.keys(X.manifest);
      const a = X.load('foundation/sample_albedo'), n = X.load('foundation/sample_normal');
      const fallback = { w: a.image.width, cs: a.colorSpace };
      await X.preload(['foundation/sample_albedo', 'foundation/sample_normal']);
      const full = { w: a.image.width, h: a.image.height, cs: a.colorSpace === THREE.SRGBColorSpace, ncs: n.colorSpace === THREE.NoColorSpace, nw: n.image.width };
      X.set('half');
      const t0 = performance.now();
      while (a.image.width === full.w && performance.now() - t0 < 10000) await new Promise(r => setTimeout(r, 50));
      const half = { w: a.image.width, nw: n.image.width };
      X.set('full');
      while (a.image.width !== full.w && performance.now() - t0 < 20000) await new Promise(r => setTimeout(r, 50));
      const st = X.stats();
      return { names: names.length, fallback, full, half, back: a.image.width, stats: { count: st.count, loaded: st.loaded, failed: st.failed, gpuBytes: st.gpuBytes, res: st.res } };
    });
    await ctx.close();
    check('textures: K.tex loads the generated WebP sample (sRGB albedo / linear normal), 1x1 fallback first, half and full sets swap in place', tx.fallback.w === 1 && tx.full.w >= 256 && tx.full.cs && tx.full.ncs && tx.half.w === tx.full.w / 2 && tx.back === tx.full.w && tx.stats.failed === 0 && tx.stats.loaded >= 2 && errors.length === 0, { tx, errors: errors.slice(0, 3) });
  }
  // assets budget (SPEC3 §4): whole assets/ <= 40 MB, Act 1 initial (groups act1 + common) <= 15 MB, Act 2 extra <= 15 MB
  {
    let total = 0;
    const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, f.name); if (f.isDirectory()) walk(q); else total += fs.statSync(q).size; } };
    if (fs.existsSync(path.join(ROOT, 'assets'))) walk(path.join(ROOT, 'assets'));
    const groups = {};
    const texDir = path.join(ROOT, 'assets/tex');
    for (const role of fs.existsSync(texDir) ? fs.readdirSync(texDir) : []) {
      const mf = path.join(texDir, role, 'manifest.json');
      if (!fs.existsSync(mf)) continue;
      const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
      for (const k in m.textures || {}) { const e = m.textures[k], g = e.group || 'none'; groups[g] = (groups[g] || 0) + (e.bytes || 0); }
    }
    const MB = 1024 * 1024, act1 = (groups.act1 || 0) + (groups.common || 0), act2 = groups.act2 || 0;
    check('assets budget: assets/ <= 40 MB, Act 1 initial <= 15 MB, Act 2 extra <= 15 MB', total <= 40 * MB && act1 <= 15 * MB && act2 <= 15 * MB, { totalMB: +(total / MB).toFixed(2), act1MB: +(act1 / MB).toFixed(2), act2MB: +(act2 / MB).toFixed(2), groups });
  }
  // no GLSL / r128 pipeline left in the sources (build.sh refuses them too)
  {
    const bad = [];
    for (const f of fs.readdirSync(path.join(ROOT, 'src'))) {
      const t = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
      for (const re of [/onBeforeCompile/, /ShaderMaterial/, /RawShaderMaterial/, /EffectComposer/, /gl_FragColor/, /#include </, /WebGLRenderer\(/]) if (re.test(t)) bad.push(f + ': ' + re);
    }
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const ext = (html.match(/https?:\/\/[^"' )<>]+/g) || []).filter(u => !/^https:\/\/fonts\.(googleapis|gstatic)\.com/.test(u));
    check('no GLSL left (TSL only) and no external URL but Google Fonts in index.html', bad.length === 0 && ext.length === 0, { bad, ext });
  }
  // performance budgets per preset (SPEC3 §6, scene pass incl. shadow maps): Ultra <= 350 calls / 2.5 M triangles,
  // Moyen <= 220 / 800 k; Élevé and Économie must stay under the Ultra budget. Views: Act 1 start, valley, arena; Act 2
  {
    const { ctx, page, errors } = await openGame(browser, { viewport: { width: 1280, height: 720 } });
    const views = await ev(page, () => {
      const K = __K, G = K.game, out = {};
      T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300);
      const spots = [[0, -10], [-6, -100], [K.level.boss.center.x, K.level.boss.center.z + 20]];
      for (const q of ['ultra', 'high', 'medium', 'low']) {
        K.post.setQuality(q);
        let calls = 0, tris = 0;
        for (const [x, z] of spots) {
          T.teleport(x, z, T.routeDirYaw(x, z), 0); T.ticks(30); T.renderNow();
          const d = T.drawStats(); calls = Math.max(calls, d.calls); tris = Math.max(tris, d.tris);
        }
        out[q] = { calls, tris };
      }
      K.post.setQuality('high');
      return out;
    });
    await ev(page, () => { T.toTitle(); T.ticks(10); });
    const a2 = await toAct2(page);
    const views2 = await ev(page, () => {
      const K = __K, out = {};
      for (const q of ['ultra', 'high', 'medium', 'low']) {
        K.post.setQuality(q);
        let calls = 0, tris = 0;
        for (const s0 of [200, 640, 1120]) { T.place2(s0, 0, 0); K.player.invT = 9; T.ticks(40); T.renderNow(); const d = T.drawStats(); calls = Math.max(calls, d.calls); tris = Math.max(tris, d.tris); }
        out[q] = { calls, tris };
      }
      K.post.setQuality('high');
      return out;
    });
    await ctx.close();
    const okU = o => o.ultra.calls <= 350 && o.ultra.tris <= 2.5e6 && o.high.calls <= 350 && o.low.calls <= 350;
    const okM = o => o.medium.calls <= 220 && o.medium.tris <= 8e5;
    check('performance budgets: Ultra / Élevé / Économie <= 350 draw calls, Ultra <= 2.5 M triangles (Act 1 and Act 2 views)', a2.act === 2 && okU(views) && okU(views2) && errors.length === 0, { act1: views, act2: views2, errors: errors.slice(0, 3) });
    // the placeholder scene is the same on every preset: Moyen's lighter content (decor density, shadow casters, LOD by
    // K.gfx) is the art roles' work
    pending('world+city+entities', 'performance budget Moyen: <= 220 draw calls / 800 k triangles (Act 1 and Act 2 views)', okM(views) && okM(views2), { act1: views.medium, act2: views2.medium });
  }
  // the frozen v2 build in legacy/ still loads (three r128 from the CDN, served here from vendor/)
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + (e.stack || e.message)));
    page.on('console', m => { if (m.type() === 'error') errs.push('console.error: ' + m.text()); });
    await page.route('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', r => r.fulfill({ path: path.join(ROOT, 'vendor/three.min.js'), contentType: 'application/javascript' }));
    await page.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/examples\/js\/((?:postprocessing|shaders)\/[A-Za-z0-9]+\.js)$/, r => r.fulfill({ path: path.join(ROOT, 'vendor/examples', r.request().url().split('/examples/js/')[1]), contentType: 'application/javascript' }));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto(BASE + 'legacy/', { waitUntil: 'load', timeout: 120000 });
    await page.waitForTimeout(6000);
    const st = await page.evaluate(() => {
      const cv = document.getElementById('hud'), g = cv.getContext('2d'), d = g.getImageData(0, 0, cv.width, cv.height).data;
      let on = 0, n = 0; for (let i = 3; i < d.length; i += 4 * 53) { n++; if (d[i] > 40) on++; }
      return { title: document.title, three: typeof THREE !== 'undefined' && THREE.REVISION, hud: +(on / n).toFixed(3), gl: !!document.getElementById('gl') };
    });
    await page.screenshot({ path: path.join(SHOTS, '37-legacy.png') });
    await ctx.close();
    check('legacy/ (frozen v2, three r128) loads and draws its title screen without errors', st.three === '128' && st.hud > 0.05 && errs.length === 0, { st, errs: errs.slice(0, 3) });
  }
}

// ---------- WebGPU backend: boot, Act 1 sample, Act 2 sample, presets, no errors ----------
async function webgpuSuite(browser) {
  const { page, errors, bootMs } = await openGame(browser, { viewport: { width: 960, height: 540 } }, BASE + 'dev/world/site/test.html');
  const b = await ev(page, () => { T.ticks(30); const g = T.glStats(); return { backend: __K.view.backend, state: __K.game.state, mean: g.mean, std: g.std, colors: g.colors, post: __K.post.ok }; });
  await shot(page, 'gpu-01-title');
  check('WebGPU: the game boots on the WebGPU backend (title drawn)', b.backend === 'webgpu' && b.state === 'title' && b.post && b.mean > 40 && b.std > 12 && b.colors > 30, { bootMs, b });
  const a1 = await ev(page, () => {
    const K = __K, G = K.game, P = K.player;
    T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300);
    T.teleport(-6, -66, T.routeDirYaw(-6, -66), 22); T.follow(0);
    for (let i = 0; i < 6; i++) { T.ticks(30); T.frame(); }
    T.stop();
    const jump0 = P.pos.y; T.key('Space', true); T.ticks(12); T.key('Space', false); T.ticks(4);
    const g = T.glStats();
    return { state: G.state, z: +P.pos.z.toFixed(1), rings: G.rings, rose: +(P.pos.y - jump0).toFixed(2), vfx: K.vfx.stats().spawned, mean: g.mean, std: g.std, dead: P.dead };
  });
  await shot(page, 'gpu-02-act1');
  check('WebGPU: Act 1 plays a few seconds (run, rings, jump sparkles) and draws', a1.state === 'play' && a1.z < -90 && a1.rings > 0 && a1.vfx > 0 && !a1.dead && a1.mean > 40 && a1.std > 12, a1);
  await ev(page, () => { T.toTitle(); T.ticks(10); });
  const a2 = await toAct2(page);
  const a2s = await ev(page, () => {
    const K = __K, G = K.game;
    T.key('ArrowUp', true);
    for (let i = 0; i < 6; i++) { T.ticks(30); T.frame(); }
    T.key('ArrowUp', false);
    const g = T.glStats(), b = K.board.stats();
    return { act: G.act, state: G.state, s: b.s, mode: b.mode, mean: g.mean, std: g.std };
  });
  await shot(page, 'gpu-03-act2');
  check('WebGPU: Act 2 (city, skateboard, traffic) plays a few seconds and draws', a2.act === 2 && a2s.state === 'play' && a2s.s > 30 && a2s.mean > 30 && a2s.std > 10, { a2, a2s });
  const pres = await ev(page, () => {
    const K = __K, out = [];
    for (const q of ['ultra', 'medium', 'low', 'high']) { K.post.setQuality(q); T.frame(); const g = T.glStats(); out.push({ q, passes: K.post.stats().passes.length, mean: g.mean }); }
    K.post.setSuperRes(true); T.frame(); const g = T.glStats(); out.push({ q: 'sr', scale: K.post.stats().scale, mean: g.mean });
    K.post.setSuperRes(false);
    return out;
  });
  check('WebGPU: presets and Super Résolution switch and draw', pres.every(o => o.mean > 30) && pres[4].scale < 1, pres);
  const tx = await page.evaluate(async () => {
    const X = __K.tex, THREE = window.THREE;
    await X.init();
    const a = X.load('foundation/sample_albedo');
    await X.preload(['foundation/sample_albedo']);
    const w = a.image.width;
    T.frame();
    return { w, cs: a.colorSpace === THREE.SRGBColorSpace, failed: X.stats().failed };
  });
  check('WebGPU: K.tex texture upload (sample albedo, sRGB)', tx.w === 256 && tx.cs && tx.failed === 0, tx);
  check('WebGPU: no page errors or console errors', errors.length === 0, errors.slice(0, 5));
}

(async () => {
  const srv = await serve(ROOT, 0);
  BASE = srv.url;
  const browser = await chromium.launch({ args: WEBGPU ? GL_ARGS.concat(GPU_ARGS) : GL_ARGS });
  const t0 = Date.now();
  try {
    if (WEBGPU) await webgpuSuite(browser);
    else {
      const extra = ['phone', 'fullrun', 'regress', 'present', 'act2', 'post', 'regress2', 'v3'];
      if (!ONLY || ONLY.some(o => extra.indexOf(o) < 0)) await desktop(browser);
      if (!ONLY || ONLY.includes('v3')) await v3Checks(browser);
      if (!ONLY || ONLY.includes('act2')) await act2(browser);
      if (!ONLY || ONLY.includes('post')) await postChecks(browser);
      if (!ONLY || ONLY.includes('fullrun')) await fullRun(browser);
      if (!ONLY || ONLY.includes('regress')) await regressGameplay(browser);
      if (!ONLY || ONLY.includes('present')) await regressPresentation(browser);
      if (!ONLY || ONLY.includes('regress2')) await regressAct2(browser);
      if (PHONE) await phone(browser);
    }
  } catch (e) {
    check('test harness ran to completion', false, String(e && e.stack || e).slice(0, 800));
  }
  await browser.close();
  await srv.close();
  const failed = results.filter(r => !r.pass), pend = results.filter(r => r.pending), checks = results.filter(r => !r.pending);
  console.log('\n===== Kit Rush 3D e2e report (' + (WEBGPU ? 'WebGPU' : 'WebGL 2') + ' backend) =====');
  for (const r of results) console.log((r.pending ? (r.met ? '[pass] ' : '[PEND] ') + '[' + r.pending + '] ' : r.pass ? '[pass] ' : '[FAIL] ') + r.name);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed, ${pend.filter(r => !r.met).length}/${pend.length} builder targets pending, in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (info.perf) console.log('frame time (headless SwiftShader):', JSON.stringify(info.perf));
  fs.writeFileSync(path.join(__dirname, WEBGPU ? 'e2e-report-webgpu.json' : 'e2e-report.json'), JSON.stringify({ results, info }, null, 1));
  process.exit(failed.length ? 1 : 0);
})();
