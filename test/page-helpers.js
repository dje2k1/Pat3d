// In-page test helpers for Kit Rush 3D (installed into test.html by e2e.js). Everything goes through window.__K.
// The game's own requestAnimationFrame loop is driven by the test (deterministic fixed ticks, rendering on demand).
window.__installT = function () {
  const K = window.__K, G = K.game, P = K.player, V3 = THREE.Vector3;
  const ad = K.util.angleDiff;
  K.view._warm = 1e15; // keep the adaptive pixel ratio out of the deterministic run
  const R = K.view.renderer, realRender = R.render.bind(R);
  const T = window.T = { draw: true, move: null, pre: null, cnt: {}, last: {}, nan: 0, nanWhere: '', ticksRun: 0, simMs: 0 };
  R.render = function (s, c) { if (T.draw) realRender(s, c); };

  // input: optional per-tick hook before the real poll, analog move override after it
  const I = K.input, poll = I.poll.bind(I);
  I.poll = function () {
    if (T.pre) { try { T.pre(); } catch (e) { console.error('test bot error', e); T.pre = null; } }
    poll();
    if (T.move) { I.move.x = T.move.x; I.move.y = T.move.y; }
    T.ticksRun++;
    const p = P.pos, v = P.vel, c = K.view.camera.position;
    if (!(Number.isFinite(p.x + p.y + p.z) && Number.isFinite(v.x + v.y + v.z) && Number.isFinite(c.x + c.y + c.z))) { T.nan++; T.nanWhere = G.state; }
  };
  // call counters on the module APIs (other modules look these up at call time)
  const wrap = (obj, name, tag) => {
    const f = obj[name];
    obj[name] = function (...a) {
      T.cnt[tag] = (T.cnt[tag] || 0) + 1;
      T.last[tag] = a.map(x => (x && x.isVector3 ? [x.x, x.y, x.z] : x));
      return f.apply(this, a);
    };
  };
  for (const n of ['launch', 'dash', 'hurt', 'kill', 'bounce']) wrap(P, n, 'P.' + n);
  for (const n of ['onDeath', 'setCheckpoint', 'onBossStart', 'onBossDefeated', 'onCapsule', 'applyItem']) wrap(G, n, 'G.' + n);

  T.key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
  T.tapKey = code => { T.key(code, true); T.key(code, false); };
  T.ticks = n => {
    const d = T.draw; T.draw = false;
    const f0 = G.frame, t0 = performance.now();
    let guard = 0;
    while (G.frame - f0 < n && guard++ < n * 2 + 10) window.__pump(n - (G.frame - f0) >= 4 ? 4000 / 60 : 1000 / 60);
    T.simMs += performance.now() - t0;
    T.draw = d;
    return G.frame - f0;
  };
  T.frame = () => { const d = T.draw; T.draw = true; window.__pump(1000 / 60); T.draw = d; };
  T.until = (fn, max) => { for (let i = 0; i < max; i++) { if (fn()) return i; T.ticks(1); } return fn() ? max : -1; };
  T.yawOf = (x, z) => Math.atan2(-x, -z);
  T.hs = () => Math.hypot(P.vel.x, P.vel.z);
  T.sp = () => P.vel.length();
  T.st = () => ({
    gs: G.state, p: [P.pos.x, P.pos.y, P.pos.z].map(v => +v.toFixed(2)), v: +P.vel.length().toFixed(2), g: P.onGround,
    ball: P.ball, dead: P.dead, loop: P.inLoop, rings: G.rings, lives: G.lives, cp: G.cpIndex, score: G.score, time: +G.time.toFixed(2), cam: K.camera.mode
  });

  // steering that mirrors the player's stick-reference lock so the requested world heading is exact
  const bot = { ref: 0, sa: 0, on: false, dashN: 0 };
  T.resetBot = () => { bot.on = false; T.move = null; };
  T.steerYaw = (yaw, mag) => {
    if (!(mag > 0)) { T.move = { x: 0, y: 0 }; bot.on = false; return; }
    // a dash panel re-anchors the player's stick reference so the held direction now means the dash direction
    const dn = T.cnt['P.dash'] || 0;
    if (dn !== bot.dashN) {
      bot.dashN = dn;
      const d = T.last['P.dash'] && T.last['P.dash'][0];
      if (bot.on && d && Math.hypot(d[0], d[2]) > 1e-6) bot.ref = T.yawOf(d[0], d[2]) + bot.sa;
    }
    const iy = K.camera.inputYaw;
    let cy = Number.isFinite(iy) ? iy : Number.isFinite(K.camera.yaw) ? K.camera.yaw : yaw;
    if (K.camera.mode === 'loop') {
      // while a loop is framed from the side Kit steers relative to the view before it (about the loop direction)
      let best = null, bd = 1e9;
      for (const lp of K.level.loops) { const d = Math.hypot(P.pos.x - lp.entry.x, P.pos.z - lp.entry.z); if (d < bd) { bd = d; best = lp; } }
      if (best) cy = T.yawOf(best.dir.x, best.dir.z);
    }
    let sa;
    if (bot.on) {
      sa = bot.ref - yaw;
      if (Math.abs(ad(bot.sa, sa)) > 0.45) { sa = cy - yaw; bot.ref = cy; bot.sa = sa; }
    } else { sa = cy - yaw; bot.ref = cy; bot.sa = sa; bot.on = true; }
    T.move = { x: Math.sin(sa) * mag, y: Math.cos(sa) * mag };
  };
  T.routeYaw = (dT, look) => {
    const p = P.pos, ri = K.world.routeInfo(p.x, p.z);
    if (!ri) return null;
    const Lk = look || 7, off = (dT || 0) - ri.d;
    return T.yawOf(ri.dir.x * Lk + ri.right.x * off, ri.dir.z * Lk + ri.right.z * off);
  };
  T.routeDirYaw = (x, z) => { const ri = K.world.routeInfo(x, z); return ri ? T.yawOf(ri.dir.x, ri.dir.z) : 0; };
  // follow the route centre (or lateral target dT) every tick
  T.follow = dT => { T.pre = () => { if (P.inLoop || P.dead) return; const y = T.routeYaw(typeof dT === 'function' ? dT() : dT); if (y != null) T.steerYaw(y, 1); }; };
  T.stop = () => { T.pre = null; T.resetBot(); };

  T.teleport = (x, z, yaw, speed, y) => {
    const g = K.world.ground(x, z, y != null ? y + 0.5 : 1e4);
    P.init(new V3(x, y != null ? y : g ? g.y : 30, z), yaw);
    K.camera.setMode('follow', { snap: true, yaw });
    if (speed) P.vel.set(-Math.sin(yaw) * speed, 0, -Math.cos(yaw) * speed);
    T.resetBot();
  };
  // pixels of the WebGL canvas right after a render (same task, so the drawing buffer is intact)
  T.glStats = () => {
    const d = T.draw; T.draw = true;
    realRender(K.view.scene, K.view.camera);
    T.draw = d;
    const gl = R.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0, sum2 = 0, n = 0, dark = 0;
    const buckets = new Set();
    for (let i = 0; i < px.length; i += 4 * 97) {
      const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      sum += l; sum2 += l * l; n++; if (l < 12) dark++;
      buckets.add((px[i] >> 5) * 64 + (px[i + 1] >> 5) * 8 + (px[i + 2] >> 5));
    }
    const mean = sum / n;
    return { w, h, mean: +mean.toFixed(1), std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1), dark: +(dark / n).toFixed(3), colors: buckets.size, calls: R.info.render.calls, tris: R.info.render.triangles };
  };
  T.hudStats = () => {
    const cv = document.getElementById('hud'), g = cv.getContext('2d');
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let on = 0, n = 0;
    for (let i = 3; i < d.length; i += 4 * 53) { n++; if (d[i] > 40) on++; }
    return { w: cv.width, h: cv.height, cover: +(on / n).toFixed(3) };
  };

  // ---------- scripted bots ----------
  // Boss: run at the pod, jump when close and it is not flashing, then jump again in the air (homing attack).
  T.bossBot = opts => {
    opts = opts || {};
    const E = K.entities, B = K.level.boss;
    let phase = 'approach', jt = 0;
    const r = { tries: 0, hits: 0, log: [], deaths: 0, k: 0 };
    let lastHp = E.bossInfo().hp, wasDead = false;
    T.pre = () => {
      if (opts.keepRings && G.rings < 10) G.rings = 30;
      if (P.dead || G.state !== 'play') { T.move = { x: 0, y: 0 }; if (phase !== 'approach') { T.key('Space', false); phase = 'approach'; } return; }
      const s = E.stats(), bp = s.bossPos;
      const dx = bp.x - P.pos.x, dz = bp.z - P.pos.z, d = Math.hypot(dx, dz);
      if (s.boss !== 'fight' && s.boss !== 'enter') {
        // walk back into the arena after a respawn so the fight restarts
        const cx = B.center.x - P.pos.x, cz = B.center.z - P.pos.z;
        if (Math.hypot(cx, cz) > 3) T.steerYaw(T.yawOf(cx, cz), 1); else T.move = { x: 0, y: 0 };
        return;
      }
      if (phase === 'approach') {
        T.steerYaw(T.yawOf(dx, dz), P.onGround && d < 3 ? 0.4 : 1);
        if (P.onGround && d < 8.5 && s.bossFlash <= 0 && s.boss === 'fight') { T.key('Space', true); phase = 'up'; jt = 0; r.tries++; }
      } else if (phase === 'up') {
        jt++;
        if (jt === 9) T.key('Space', false);
        if (jt === 11) T.key('Space', true);
        if (jt === 12) { T.key('Space', false); phase = 'air'; }
      } else if (++jt > 120 || P.onGround) phase = 'approach';
    };
    const max = opts.maxTicks || 60 * 150;
    while (r.k < max) {
      T.ticks(1); r.k++;
      if (P.dead && !wasDead) r.deaths++;
      wasDead = P.dead;
      const hp = E.bossInfo().hp;
      if (hp < lastHp) { r.hits++; r.log.push(+(r.k / 60).toFixed(1)); }
      lastHp = hp;
      const st = E.stats().boss;
      if (opts.stopWhen && opts.stopWhen()) break;
      if (st === 'dying' || st === 'flee' || st === 'gone' || G.bossDone) break;
      if (G.state === 'over') break;
    }
    T.stop(); T.key('Space', false);
    r.boss = E.stats().boss; r.hp = E.bossInfo().hp;
    return r;
  };
  // Capsule: wait for it to land, walk onto it and jump on the button until it opens, then wait for the results.
  T.capsuleBot = () => {
    const E = K.entities, cp = K.level.capsule.pos;
    const r = {};
    r.defeatedAt = T.until(() => G.bossDone, 400);
    r.landedAt = T.until(() => E.stats().capsule === 'idle', 600);
    let held = 0;
    r.jumps = 0;
    T.pre = () => {
      if (held > 0) { held--; if (held === 0) T.key('Space', false); }
      const dx = cp.x - P.pos.x, dz = cp.z - P.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.35) T.steerYaw(T.yawOf(dx, dz), Math.min(1, d / 2.5 + 0.15)); else T.move = { x: 0, y: 0 };
      if (P.onGround && d < 3.2 && held === 0 && E.stats().capsule === 'idle') { T.key('Space', true); held = 14; r.jumps++; }
    };
    r.opened = T.until(() => E.stats().capsule !== 'idle', 900);
    T.stop(); T.key('Space', false);
    r.resultsAt = T.until(() => G.state === 'results', 600);
    r.capsule = E.stats().capsule; r.state = G.state; r.onCapsule = T.cnt['G.onCapsule'] || 0;
    return r;
  };
  // Whole route: follows the route centre, lines up with the loops, kills the chasm wasps with homing attacks
  // (each hovers over the platform it lands on), times the moving platform, jumps gaps it sees coming and chains
  // the wasps after the gap springs. Deaths and respawns are left to the real game flow.
  // routeBot(maxTicks): run the bot; routeBot(n, true) keeps it installed so T.routeBotMore(n) can continue it
  T.routeBot = (maxTicks0, keep) => {
    const W = K.world, L = K.level;
    const mover = W.solids.find(s => s.kind === 'moving');
    const moverLat = ahead => {
      if (!mover) return 0;
      const cx = (mover.min.x + mover.max.x) / 2, cz = (mover.min.z + mover.max.z) / 2;
      const ri = W.routeInfo(cx, cz);
      const v = (mover.delta.x * ri.right.x + mover.delta.z * ri.right.z) * 60;
      return ri.d + v * ahead;
    };
    const out = { deaths: [], progress: [], cps: [], jumps: 0, homing: 0, maxS: -1e9 };
    let seq = [], lastCp = G.cpIndex, wasDead = false, airT = 0, stuckT = 0, bestS = -1e9, homed = false, retreat = false;
    const busy = () => seq.length > 0;
    const runSeq = () => { for (const q of seq) q[0]--; while (seq.length && seq[0][0] <= 0) seq.shift()[1](); };
    const jumpFull = () => { T.key('Space', true); seq.push([22, () => T.key('Space', false)]); out.jumps++; };
    const jumpHome = () => {
      T.key('Space', true);
      seq.push([8, () => T.key('Space', false)], [11, () => T.key('Space', true)], [12, () => T.key('Space', false)], [40, () => {}]);
      out.jumps++; out.homing++;
    };
    const target = () => { try { return K.entities.homingTarget(P.center(), P.forward); } catch (e) { return null; } };
    T.pre = () => {
      if (P.dead || G.state !== 'play') { T.move = { x: 0, y: 0 }; if (seq.length) { seq = []; T.key('Space', false); } return; }
      runSeq();
      const p = P.pos, ri = W.routeInfo(p.x, p.z);
      if (!ri) return;
      let dT = 0, hold = false;
      const z = p.z;
      for (const lp of L.loops) {
        const along = (lp.entry.x - p.x) * lp.dir.x + (lp.entry.z - z) * lp.dir.z;
        if (along > -1 && along < 32) { const r2 = W.routeInfo(lp.entry.x, lp.entry.z); dT = r2 ? r2.d : 0; }
      }
      const g0 = W.ground(p.x, p.z, p.y + 0.3);
      const onMover = P.onGround && g0 && g0.solid === mover;
      // the static platform right before the moving one: wait there until the mover lines up
      const prePlat = P.onGround && g0 && g0.solid && g0.solid.kind === 'platform' && mover && g0.solid.min.z > mover.max.z && g0.solid.min.z - mover.max.z < 4;
      if (prePlat) { dT = 0; if (z < g0.solid.max.z - 0.7 && Math.abs(moverLat(0.75)) > 0.8) hold = true; }
      // on the moving (last) platform: run straight ahead along the route (it carries Kit sideways) and hop to the far side
      if (onMover) dT = ri.d;
      const chasm = z < -220 && z > -262 && p.y > 20;
      const edge = chasm && z > -237.5 && P.onGround && !g0?.solid;
      if (edge && z < -233.5) hold = true; // stand at the near edge of the chasm
      const Lk = 7, off = dT - ri.d;
      const yaw = T.yawOf(ri.dir.x * Lk + ri.right.x * off, ri.dir.z * Lk + ri.right.z * off);
      const spd = Math.hypot(P.vel.x, P.vel.z);
      if (P.homing) homed = true;
      if (P.onGround) homed = false;
      if (chasm && homed && !P.homing && !P.onGround) {
        // bounced off a wasp: air-steer onto the platform below (the bounce keeps some forward speed)
        let best = null, bd = 1e9;
        for (const sd of W.solids) {
          if ((sd.kind !== 'platform' && sd.kind !== 'moving') || sd.max.y > p.y + 0.3) continue;
          const cx = (sd.min.x + sd.max.x) / 2, cz = (sd.min.z + sd.max.z) / 2, d = Math.hypot(cx - p.x, cz - p.z);
          if (d < bd) { bd = d; best = [cx, cz]; }
        }
        if (best && bd < 6) {
          const tx = best[0], tz = best[1], dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
          const t = Math.max(0.15, (P.vel.y + Math.sqrt(Math.max(0, P.vel.y * P.vel.y + 84 * Math.max(0, p.y - 26)))) / 42); // time to fall to the deck
          const wx = dx / t, wz = dz / t, ex = wx - P.vel.x, ez = wz - P.vel.z, e = Math.hypot(ex, ez);
          // air control: push the horizontal velocity toward the one that lands on the platform centre
          if (e > 0.8) T.steerYaw(T.yawOf(ex, ez) , 1); else T.steerYaw(yaw, 0);
          return;
        }
      }
      if (!P.inLoop && !(busy() && !P.onGround && chasm)) {
        if (chasm && spd > 7.5 && P.onGround) T.steerYaw(yaw + Math.PI, 1);
        else if (hold || (chasm && spd > 6.5)) T.steerYaw(yaw, 0);
        else T.steerYaw(yaw, 1);
      } else if (busy() && chasm) T.steerYaw(yaw, P.homing ? 0 : 0.5);
      airT = P.onGround ? 0 : airT + 1;
      if (busy()) return;
      if (chasm && P.onGround) {
        // homing attack the wasp hovering over the next platform (the bounce drops Kit onto that platform)
        let t = null;
        try { t = K.entities.homingTarget(P.center(), ri.dir); } catch (e) { t = null; }
        if (t && t.ref && t.ref.type === 'wasp' && t.pos.z < z - 2 && t.pos.z > z - 11) {
          const overMover = !!mover && t.pos.z < mover.max.z && t.pos.z > mover.min.z;
          const facing = P.forward.x * ri.dir.x + P.forward.z * ri.dir.z > 0.9;
          if (spd > 2.5) { T.steerYaw(yaw, 0); return; }
          if (!facing) { T.steerYaw(yaw, 0.25); return; }
          T.steerYaw(yaw, 0);
          if (!overMover || Math.abs(moverLat(0.85)) < 0.9) jumpHome();
          return;
        }
        // no wasp left ahead: make room for a run-up before hopping to the next platform
        const sd = g0 && g0.solid && (g0.solid.kind === 'platform' || g0.solid.kind === 'moving') ? g0.solid : null;
        if (sd) {
          const along = (p.x - (sd.min.x + sd.max.x) / 2) * ri.dir.x + (p.z - (sd.min.z + sd.max.z) / 2) * ri.dir.z;
          const front = (sd.max.z - sd.min.z) / 2 - along; // distance to the platform's front edge
          if (front < 2.5 && spd < 5) retreat = true;
          if (retreat && front > 3.4) retreat = false;
          if (retreat) { T.steerYaw(yaw + Math.PI, 0.3); return; }
        } else retreat = false;
      }
      // homing attacks on the wasp chain over the spring gap
      if (!P.onGround && z < -528 && z > -552 && airT > 10 && airT % 8 === 0) {
        const t = target();
        if (t && t.ref && t.ref.type === 'wasp') { T.key('Space', true); T.key('Space', false); out.homing++; return; }
      }
      if (stuckT > 180 && P.onGround) {
        let sp = null, bd = 12;
        for (const q of L.springs) { const d = Math.hypot(p.x - q.pos.x, p.z - q.pos.z); if (d < bd && Math.abs(p.y - q.pos.y) < 2) { bd = d; sp = q; } }
        if (sp) { T.steerYaw(T.yawOf(sp.pos.x - p.x, sp.pos.z - p.z), 1); return; }
      }
      const nearLoop = L.loops.some(lp => Math.hypot(p.x - lp.entry.x, p.z - lp.entry.z) < lp.radius + 4 && p.y > lp.entry.y + 0.3);
      const nearSpring = L.springs.some(sp => Math.hypot(p.x - sp.pos.x, p.z - sp.pos.z) < 6 && Math.abs(p.y - sp.pos.y) < 2);
      if (P.onGround && !hold && !nearLoop && !nearSpring && !P.inLoop && !edge) {
        // on the moving platform the velocity includes its sideways carry: look for the edge along the route instead
        const byVel = spd > 1 && !onMover;
        const hx = byVel ? P.vel.x / spd : ri.dir.x, hz = byVel ? P.vel.z / spd : ri.dir.z;
        const ah = Math.max(1.6, spd * 0.1), ax = p.x + hx * ah, az = p.z + hz * ah;
        const g = W.ground(ax, az, p.y + 0.5);
        const wall = !g && W.terrainY(ax, az) > p.y + 0.5;
        if (!wall && (!g || g.y < p.y - 4)) jumpFull();
      }
    };
    let k = 0;
    const run = (maxTicks, keepGoing) => {
    for (let j = 0; j < maxTicks; j++, k++) {
      T.ticks(1);
      if (P.dead && !wasDead) out.deaths.push({ z: +P.pos.z.toFixed(1), y: +P.pos.y.toFixed(1), x: +P.pos.x.toFixed(1), t: +G.time.toFixed(1), cp: G.cpIndex, why: P.pos.y < (K.world.deathY || -4) ? 'fall' : 'hit' });
      wasDead = P.dead;
      if (G.cpIndex !== lastCp) { out.cps.push({ cp: G.cpIndex, t: +G.time.toFixed(1) }); lastCp = G.cpIndex; }
      const ri = W.routeInfo(P.pos.x, P.pos.z);
      if (ri && ri.s > out.maxS) out.maxS = +ri.s.toFixed(0);
      if (ri && ri.s > bestS + 2) { bestS = ri.s; stuckT = 0; } else if (!P.dead) stuckT++;
      if (P.dead) bestS = -1e9;
      if (T.trace && P.pos.z < T.trace[0] && P.pos.z > T.trace[1]) (out.tr = out.tr || []).push([k, P.pos.x.toFixed(1), P.pos.y.toFixed(1), P.pos.z.toFixed(1), P.onGround ? 'G' : 'A', T.hs().toFixed(1), P.vel.y.toFixed(1), P.homing ? 'H' : '', seq.length, P.state].join(' '));
      if (k % 300 === 0) out.progress.push([+G.time.toFixed(0), +P.pos.z.toFixed(0), +P.pos.y.toFixed(0), +T.hs().toFixed(0)].join(':'));
      if (G.bossActive || G.state === 'over') break;
      if (stuckT > 60 * 20) { out.stuck = [+P.pos.x.toFixed(1), +P.pos.y.toFixed(1), +P.pos.z.toFixed(1)]; break; }
    }
    if (!keepGoing) { T.stop(); T.key('Space', false); T.routeBotMore = null; }
    out.ticks = k; out.arena = G.bossActive; out.time = +G.time.toFixed(1); out.rings = G.rings; out.lives = G.lives; out.state = G.state; out.score = G.score;
    return out;
    };
    T.routeBotMore = run;
    return run(maxTicks0, keep);
  };

  // ---------------- Act 2 (San Francisco skateboard + bumper flight) ----------------
  // offscreen renders (environment captures at act switches) must draw even while T.ticks skips frames
  const forceDraw = (obj, name) => {
    if (!obj || typeof obj[name] !== 'function' || obj[name].__forced) return;
    const f = obj[name];
    obj[name] = function (...a) { const d = T.draw; T.draw = true; try { return f.apply(this, a); } finally { T.draw = d; } };
    obj[name].__forced = true;
  };
  forceDraw(K.post, 'refreshEnvironment');
  forceDraw(K.city, 'enter');
  forceDraw(K.city, 'exit');
  forceDraw(K.world, 'setVisible');
  for (const n of ['onActComplete', 'onTrick']) if (typeof G[n] === 'function') wrap(G, n, 'G.' + n);
  // per-tick watch (teleports, camera sweep around Kit during the bumper cinematic), measured at each poll
  const tw = T.tw = { on: false, n: 0, max: 0, at: null, sweep: 0, lastA: null, orbitTicks: 0, prev: new V3(), v0: 0, ts0: 1, ok: false, cine: 0 };
  T.watchAct2 = () => { tw.on = true; tw.n = 0; tw.max = 0; tw.at = null; tw.sweep = 0; tw.lastA = null; tw.orbitTicks = 0; tw.ok = false; tw.cine = 0; };
  const ad2 = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2; return d; };
  const pollA2 = I.poll;
  I.poll = function () {
    pollA2();
    if (!tw.on) return;
    const B = K.board, cam = K.view.camera;
    const live = G.act === 2 && (G.state === 'play' || G.state === 'results') && B && B.active && !P.dead && !G.paused;
    if (live && tw.ok) {
      const ts = Math.max(B.timeScale || 1, tw.ts0), d = tw.prev.distanceTo(P.pos);
      const lim = Math.max(tw.v0, P.vel.length()) * (1 / 60) * ts + 0.35;
      if (d - lim > tw.max) { tw.max = d - lim; tw.at = { mode: B.mode, d: +d.toFixed(2), lim: +lim.toFixed(2), p: [P.pos.x, P.pos.y, P.pos.z].map(v => +v.toFixed(1)) }; }
      if (d > lim) tw.n++;
    }
    if (live && B.mode === 'flight' && B.timeScale < 1) {
      const a = Math.atan2(cam.position.x - P.pos.x, cam.position.z - P.pos.z);
      if (tw.lastA != null) tw.sweep += Math.abs(ad2(tw.lastA, a));
      tw.lastA = a; tw.orbitTicks++;
      if (K.post && K.post.ok) tw.cine = Math.max(tw.cine, K.post.stats().cinematic);
    }
    tw.ok = live && !G.deathHandled;
    tw.prev.copy(P.pos); tw.v0 = P.vel.length(); tw.ts0 = B && B.active ? B.timeScale || 1 : 1;
  };
  const yawOf2 = (x, z) => Math.atan2(-x, -z);
  // put Kit on the board at route arc length s (lateral d), optional speed v (uses the real K.board.start)
  T.place2 = (s, d, v) => {
    const C = K.city, r = C.route(s), pos = C.routePoint(s, d || 0, 0);
    const g = C.ground(pos.x, pos.z, pos.y + 2); if (g) pos.y = g.y;
    K.board.start({ pos, yaw: yawOf2(r.dir.x, r.dir.z), s });
    if (v) P.vel.multiplyScalar(v / Math.max(1, P.vel.length()));
    tw.ok = false;
  };
  // skate bot: follows the ring lines, keeps off car lanes, ollies a car on purpose (opts.ollieCar), tricks on big air,
  // then steers the flight through the sky rings
  T.skateBot = opts => {
    opts = opts || {};
    const C = K.city, B = K.board, R = C.ringData, n0 = R.flight0;
    const rs = new Float32Array(n0), rd = new Float32Array(n0), rh = new Float32Array(n0);
    for (let i = 0; i < n0; i++) { const ra = C.routeAt(R.pos[i].x, R.pos[i].z); rs[i] = ra ? ra.s : -1; rd[i] = ra ? ra.d : 0; rh[i] = ra ? R.pos[i].y - ra.y : 0; }
    const st = T.bs = { hold: 0, carOllie: 0, carTarget: null, carOver: 0, tricks: 0, wantD: 0, events: [], lastTrickTick: -99, lastCrest: -99, relT: -9, tick: 0 };
    const press = n => { T.key('Space', true); st.hold = n; };
    T.pre = () => {
      st.tick++;
      if (st.hold > 0) { st.hold--; if (st.hold === 0) { T.key('Space', false); st.relT = st.tick; } }
      if (G.state !== 'play' || !B.active || P.dead) { T.move = { x: 0, y: 0 }; T.key('ShiftLeft', false); return; }
      const bs = B.stats();
      if (B.mode === 'flight' || B.mode === 'land') { T.key('ShiftLeft', false); flightBot(); return; }
      const ra = C.routeAt(P.pos.x, P.pos.z);
      if (!ra) { T.move = { x: 0, y: 1 }; return; }
      const s = ra.s, d = ra.d, ry = yawOf2(ra.dir.x, ra.dir.z), g = ra.g, v = Math.hypot(P.vel.x, P.vel.z);
      let want = 0, best = 1e9;
      for (let i = 0; i < n0; i++) {
        if (R.got[i] || rs[i] < s + 3 || rs[i] > s + 45 || rh[i] > 3.2) continue;
        if (rs[i] < best) { best = rs[i]; want = rd[i]; }
      }
      want = Math.max(-6, Math.min(6, want));
      const cars = C.cars;
      let block = null, bd = 1e9;
      // where each car will be across the street when Kit gets there (cars pulling out, cross traffic running the stop)
      const pred = (c, cr, ds) => {
        const vl = c.vel.x * ra.right.x + c.vel.z * ra.right.z, va = c.vel.x * ra.dir.x + c.vel.z * ra.dir.z;
        const tt = Math.max(0, ds - c.half.z) / Math.max(2, v - va);
        return cr.d + vl * Math.min(tt, 1.6);
      };
      let sweep = null;
      for (const c of cars) {
        const cr = C.routeAt(c.pos.x, c.pos.z);
        if (!cr) continue;
        const ds = cr.s - s;
        if (ds < -3 || ds > 55) continue;
        const cd = cr.d, pd = pred(c, cr, ds), cross = Math.abs(c.vel.x * ra.right.x + c.vel.z * ra.right.z) > 2;
        // a car about to sweep across Kit's line: ollie over it at the last moment
        if (cross && ds > 0 && ds < v * 0.34 + 3 && Math.min(cd, pd) - 2.6 < d && Math.max(cd, pd) + 2.6 > d) sweep = c;
        const cy = yawOf2(c.vel.x, c.vel.z);
        const half = Math.abs(c.half.x * Math.cos(cy - ry)) + Math.abs(c.half.z * Math.sin(cy - ry));
        const w = (c.vel.lengthSq() > 1 ? half : Math.max(c.half.x, c.half.z)) + 1.0;
        if (opts.ollieCar && !st.carOver && st.carOllie === 0 && s > 260 && ds > 25 && ds < 60 && Math.abs(cr.d - 3.1) < 0.6 && c.vel.dot(ra.dir) > 4 && cr.zone === 0) { st.carOllie = 1; st.carTarget = c; }
        if (st.carTarget === c) continue;
        const lo = Math.min(d, want) - w, hi = Math.max(d, want) + w;
        if (Math.max(cd, pd) > lo && Math.min(cd, pd) < hi && ds < bd && (ds < 30 || Math.abs(cd - want) < w || Math.abs(pd - want) < w)) { bd = ds; block = { c, cr, ds, w }; }
      }
      if (sweep && bs.grounded && st.hold === 0 && st.carOllie !== 2) { press(14); st.events.push(['ollieSweep', st.tick, Math.round(s)]); }
      if (st.carOllie === 1) {
        const c = st.carTarget, cr = C.routeAt(c.pos.x, c.pos.z);
        if (!cr || !c.on || cr.s < s - 8 || cr.s - s > 90) { st.carOllie = 0; st.carTarget = null; }
        else {
          want = cr.d;
          const gap = cr.s - s - c.half.z, rel = v - c.vel.length();
          if (bs.grounded && gap < Math.max(2.5, rel * 0.32) && gap > 0) { press(14); st.carOllie = 2; st.events.push(['ollieCar', st.tick, +gap.toFixed(1), +rel.toFixed(1), bs.carHits]); }
        }
      } else if (st.carOllie === 2) {
        const c = st.carTarget, cr = c && C.routeAt(c.pos.x, c.pos.z);
        want = cr ? cr.d : 0;
        if (!cr || cr.s < s - c.half.z - 1.5) { st.carOllie = 3; st.carOver = 1; st.events.push(['cleared', st.tick, bs.carHits]); st.carTarget = null; }
        if (bs.grounded && cr && cr.s - s > 6) st.carOllie = 1;
      }
      if (block && st.carOllie !== 1 && st.carOllie !== 2) {
        const cand = [0, -1.3, 1.3, want > 0 ? 4.6 : -4.6];
        let pick = want, pickCost = 1e9;
        for (const cd of cand) {
          let cost = Math.abs(cd - want) * 0.5 + Math.abs(cd - d) * 0.3;
          for (const c of cars) {
            const cr = C.routeAt(c.pos.x, c.pos.z); if (!cr) continue; const ds = cr.s - s; if (ds < -4 || ds > 55) continue;
            const m = Math.max(c.half.x, 1.1) + 1.2, a = cr.d, b = pred(c, cr, ds), lo = Math.min(a, b), hi = Math.max(a, b);
            if (cd > lo - m && cd < hi + m) cost += 50;
            else if (ds < 25 && hi > Math.min(d, cd) - m && lo < Math.max(d, cd) + m) cost += 30;
          }
          if (cost < pickCost) { pickCost = cost; pick = cd; }
        }
        want = pick;
        if (pickCost >= 50 && bs.grounded && block.ds < Math.max(4, v * 0.3)) { press(14); st.events.push(['ollieBlock', st.tick]); }
      }
      st.wantD = want;
      const look = Math.max(10, v * 0.6);
      const desired = ry + Math.atan2(-(want - d), look);
      const yaw = yawOf2(P.forward.x, P.forward.z);
      let x = -ad2(yaw, desired) * 2.4;
      x = Math.max(-1, Math.min(1, x));
      if (Math.abs(x) < 0.13) x = 0;
      let y = 1;
      if (bs.grounded && !bs.grind && Math.abs(g) < 0.03 && v > 22 && st.carOllie !== 1 && st.carOllie !== 2) {
        const ahead = C.route(s + Math.max(3, v * 0.12));
        if (ahead && ahead.g < -0.1 && st.tick - st.lastCrest > 60) { st.lastCrest = st.tick; press(12); st.events.push(['crest', st.tick, Math.round(s)]); }
      }
      if (!bs.grounded && !bs.grind && !bs.wipe && !bs.trickOn && st.tick - st.lastTrickTick > 6 && st.hold === 0 && st.tick - st.relT > 1 && opts.tricks !== false) {
        const gq = C.ground(P.pos.x, P.pos.z, P.pos.y);
        const h = gq ? P.pos.y - gq.y : 0;
        const vy = P.vel.y, tl = (vy + Math.sqrt(Math.max(0, vy * vy + 64 * h))) / 32;
        const pick = st.tricks % 3, need = pick === 0 ? 0.55 : pick === 1 ? 0.7 : 0.82;
        if (tl > need && bs.airT > 0.08) {
          x = pick === 1 ? 1 : 0; y = pick === 2 ? -1 : 0;
          press(2); st.tricks++; st.lastTrickTick = st.tick; st.events.push(['trick', st.tick, pick, +tl.toFixed(2)]);
        }
      }
      T.move = { x, y };
      T.key('ShiftLeft', bs.grounded && g < -0.08 && v < 42);
    };
    function flightBot() {
      const F0 = R.flight0;
      let best = null, bd = 1e9;
      const vx = P.vel.x, vy = P.vel.y, vz = P.vel.z, vl = Math.hypot(vx, vy, vz) || 1;
      for (let i = F0; i < R.n; i++) {
        if (R.got[i]) continue;
        const p = R.pos[i], dx = p.x - P.pos.x, dy = p.y - P.pos.y, dz = p.z - P.pos.z;
        const along = (dx * vx + dy * vy + dz * vz) / vl;
        if (along < 2 || along > 70) continue;
        if (along < bd) { bd = along; best = p; }
      }
      if (!best) { T.move = { x: 0, y: 0 }; return; }
      const rx = -vz, rz = vx, rl = Math.hypot(rx, rz) || 1;
      const lat = ((best.x - P.pos.x) * rx + (best.z - P.pos.z) * rz) / rl;
      const up = best.y - P.pos.y - 0.6;
      T.move = { x: Math.max(-1, Math.min(1, lat / 1.5)), y: Math.max(-1, Math.min(1, up / 1.5)) };
    }
    return st;
  };
  T.stopSkate = () => { T.stop(); T.key('Space', false); T.key('ShiftLeft', false); };
  // back to the title through the game's own screens (results -> Act 2 -> pause -> "Retour au titre", end, game over)
  T.toTitle = () => {
    const down = () => { T.key('ArrowDown', true); T.ticks(2); T.key('ArrowDown', false); T.ticks(2); };
    if (G.state === 'results') { T.until(() => G.res && G.res.done, 900); T.ticks(70); T.tapKey('Space'); T.ticks(4); }
    if (G.state === 'loading') T.until(() => G.state !== 'loading', 400);
    if (G.state === 'end') { T.ticks(40); T.tapKey('Space'); T.ticks(4); }
    if (G.state === 'over') { T.ticks(70); T.tapKey('Space'); T.ticks(4); }
    if (G.state === 'card') T.until(() => G.state === 'play', 400);
    if (G.state === 'play') {
      if (!G.paused) { T.tapKey('Escape'); T.ticks(2); }
      for (let i = 0; i < 3; i++) down();
      T.tapKey('Enter'); T.ticks(4);
    }
    return G.state;
  };
  return true;
};
