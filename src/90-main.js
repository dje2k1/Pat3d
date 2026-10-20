(() => {
// ================= helpers =================
const STEP = 1 / 60;
const TAU = Math.PI * 2;
const FONT = '"Lilita One","Arial Rounded MT Bold","Trebuchet MS",sans-serif';
const NAVY = '#121845', GOLD = '#ffd23f', WHITE = '#ffffff', RED = '#ff4b4b', GREEN = '#7dff9a';
const clamp = (v, a, b) => (v > b ? b : v >= a ? v : a);
const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const hash = n => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
const num = (v, d) => (v !== null && v !== '' && Number.isFinite(+v) ? +v : d);
const pad2 = n => (n < 10 ? '0' : '') + n;
const fmtN = n => String(Math.max(0, Math.floor(num(n, 0)))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const fmtT = s => {
  const cs = Math.floor(Math.max(0, num(s, 0)) * 100 + 1e-6);
  return Math.floor(cs / 6000) + ':' + pad2(Math.floor(cs / 100) % 60) + '.' + pad2(cs % 100);
};
const $ = id => document.getElementById(id);
const sfx = (name, arg) => K.audio.sfx(name, arg);

// ================= game state =================
const G = K.game = {
  state: 'title', paused: false, rings: 0, score: 0, lives: 3, time: 0, cpIndex: -1, bossDone: false, best: null,
  act: 1, sel: 1, best2: null, runTime: 0, runActs: 0, lastAct: 1, loadErr: false,
  cpTime: 0, timerOn: false, bossActive: false, newRecord: false, newScore: false, timeOver: false,
  st: 0, clock: 0, simT: 0, frame: 0, cardLen: 2.6, res: null, ringUps: 0,
  pauseSel: 0, navLast: 0, navLastX: 0, fast: false, deadSeen: false, deadT: 0, deathHandled: false,
  comboN: 0, comboT: 9, hintT: 99, hintKind: '', flightHint: false,
  addRings, addScore, applyItem, setCheckpoint, onDeath, onBossStart, onBossDefeated, onCapsule, onActComplete, onTrick,
  // HUD hit areas in css px of the game area (title act chips, pause rows), for pointer handling and tests
  hudRects() { const m = r => ({ x: r.x * U, y: r.y * U, w: r.w * U, h: r.h * U }); return { chips: chipRects.map(m), pause: pauseRects.map(m) }; }
};
const ACT2_TEMPO = 1.12;
const QUALITIES = ['ultra', 'high', 'medium', 'low'];
const QLABEL = { ultra: 'Ultra', high: 'Élevé', medium: 'Moyen', low: 'Économie' };

// ----- acts: Act 1 is the island (K.world + K.entities), Act 2 the city (K.city driven by K.board) -----
function act2Ready() {
  const C = K.city, B = K.board, P = K.player;
  return !!(C && B && P && typeof C.build === 'function' && typeof C.enter === 'function' && typeof B.start === 'function' &&
    typeof B.update === 'function' && typeof P.setExternal === 'function');
}
function vfxOn() { return !!(K.vfx && K.vfx.ready); }
function postOn() { return !!(K.post && K.post.ok); }
// the results tally plays in letterbox (no depth of field: the confetti and the panel would only blur Kit)
function cine(on) {
  if (!postOn()) return;
  try { K.post.cinematic(!!on, on ? CINE_OPTS : undefined); } catch (e) { /* optional */ }
}
const CINE_OPTS = { focus: () => K.player.center(), letterbox: true, dof: false };
function checkpoints() {
  if (G.act === 2) return (K.city && Array.isArray(K.city.checkpoints)) ? K.city.checkpoints : [];
  const L = K.level;
  return L && Array.isArray(L.checkpoints) ? L.checkpoints : [];
}
// shows one act and hides the other (scene objects, lights, fog, sky, environment map, the board)
function setAct(n) {
  n = n === 2 && act2Ready() && K.city.built ? 2 : 1;
  const C = K.city;
  if (n === 2) {
    if (G.act === 2 && C.entered) return;
    if (typeof K.entities.setActive === 'function') K.entities.setActive(false);
    C.enter();
    G.act = 2;
  } else {
    if (G.act === 1 && !(C && C.entered)) return;
    const B = K.board;
    if (B && B.active) B.stop();
    if (C && C.entered) C.exit();
    if (typeof K.entities.setActive === 'function') K.entities.setActive(true);
    G.act = 1;
  }
  if (vfxOn()) K.vfx.reset();
  cine(false);
  needDraw = true;
}

let fallbackSpawn = null;
function spawnPoint() {
  const cps = checkpoints();
  const start = G.act === 2 ? K.city && K.city.start : K.level && K.level.start;
  const sp = (G.cpIndex >= 0 && cps[G.cpIndex]) || start;
  if (sp && sp.pos) return sp;
  if (!fallbackSpawn) fallbackSpawn = { pos: new THREE.Vector3(0, 0, 0), yaw: 0 };
  return fallbackSpawn;
}
function placePlayer() {
  const sp = spawnPoint();
  if (G.act === 2 && K.board.start(sp)) return sp;
  K.player.init(sp.pos, num(sp.yaw, 0));
  return sp;
}

function newGame(act) {
  K.audio.init();
  G.score = 0; G.lives = 3; G.cpIndex = -1; G.cpTime = 0; G.bossDone = false; G.timeOver = false;
  G.newRecord = G.newScore = false; G.runTime = 0; G.runActs = 0; G.loadErr = false;
  if (act === 2 && act2Ready()) { beginAct2(); return; }
  setAct(1);
  startAct(2.6);
}
function startAct(cardLen) {
  G.rings = 0; G.ringUps = 0;
  G.time = G.cpIndex >= 0 ? G.cpTime : 0;
  G.timerOn = false; G.paused = false; G.bossActive = false;
  G.deadSeen = false; G.deadT = 0; G.deathHandled = false; G.fast = false; G.res = null;
  G.comboN = 0; G.comboT = 9; G.hintT = 99; G.flightHint = false;
  clearPopups();
  if (vfxOn()) K.vfx.reset();
  cine(false);
  if (G.act === 2) {
    K.city.reset();
    K.entities.reset();
    placePlayer();
    K.audio.setSpeed(ACT2_TEMPO);
  } else {
    K.entities.reset();
    const sp = placePlayer();
    K.camera.setMode('follow', { snap: true, yaw: num(sp.yaw, 0) });
    K.audio.setSpeed(1);
  }
  K.audio.playMusic('main');
  G.state = 'card'; G.st = 0; G.cardLen = cardLen;
  syncPauseBtn();
}
// Act 2 starts behind a short loading card: the city is built the first time it is needed
function beginAct2() {
  G.cpIndex = -1; G.cpTime = 0; G.timeOver = false;
  G.state = 'loading'; G.st = 0; G.paused = false; G.timerOn = false; G.res = null; G.bossActive = false; G.loadBusy = false;
  cine(false);
  K.audio.stopMusic(); K.audio.setSpeed(1);
  clearPopups();
  syncPauseBtn();
}
// Act 2 is built behind the "Chargement…" card: the city is built at once (synchronously, as in v2), its textures
// (K.tex group 'act2') stream in and its shaders compile (compileAsync) in the background; the card waits for both,
// at most ACT2_WAIT seconds (K.tex hands out neutral textures until the real ones arrive, so nothing breaks).
const ACT2_WAIT = 4;
function loadAct2() {
  G.loadBusy = true; G.loadDone = false; G.compileDone = false; G.loadP = 0;
  try {
    const T = K.tex;
    const pre = T && typeof T.preloadGroup === 'function' ? T.preloadGroup('act2', p => { G.loadP = p; needDraw = true; }) : Promise.resolve();
    pre.catch(e => console.warn('Kit Rush 3D: Act 2 textures', e)).then(() => { G.loadDone = true; });
    if (!K.city.built) K.city.build(K.view.scene);
    setAct(2);
    if (G.act !== 2) throw new Error('the city is not available');
    precompile().then(() => { G.compileDone = true; });
  } catch (e) {
    G.loadBusy = false;
    console.error('Kit Rush 3D: Act 2 could not start', e);
    setAct(1);
    placePlayer();
    K.camera.setMode('follow', { snap: true });
    G.loadErr = true; G.state = 'end'; G.st = 0;
    syncPauseBtn();
  }
}
function loadAct2Wait() {
  if ((G.loadDone && G.compileDone) || G.st > ACT2_WAIT) { G.loadBusy = false; startAct(2.6); }
}
// compiles the scene's pipelines for the current camera so the first frames do not stall (lazily otherwise)
function precompile() {
  const V = K.view, r = V.renderer;
  if (!r || typeof r.compileAsync !== 'function') return Promise.resolve();
  let p;
  try { p = r.compileAsync(V.scene, V.camera); } catch (e) { return Promise.resolve(); }
  return Promise.resolve(p).catch(e => console.warn('Kit Rush 3D: precompile', e));
}
function toTitle() {
  setAct(1);
  G.state = 'title'; G.st = 0; G.paused = false; G.timerOn = false; G.bossActive = false;
  G.cpIndex = -1; G.cpTime = 0; G.bossDone = false; G.rings = 0; G.time = 0; G.res = null;
  G.deadSeen = false; G.deathHandled = false; G.fast = false; G.navLastX = 0;
  clearPopups();
  K.entities.reset();
  placePlayer();
  K.camera.setMode('title');
  K.audio.setSpeed(1);
  K.audio.playMusic('main');
  syncPauseBtn();
}
function timeBonus(s, act) {
  if (G.timeOver) return 0;
  if (act === 2) return s < 90 ? 20000 : s < 96 ? 10000 : s < 102 ? 5000 : s < 110 ? 3000 : s < 125 ? 2000 : s < 150 ? 1000 : s < 600 ? 500 : 0;
  return s < 75 ? 50000 : s < 100 ? 10000 : s < 130 ? 5000 : s < 160 ? 4000 : s < 200 ? 3000 : s < 260 ? 2000 : s < 330 ? 1000 : s < 600 ? 500 : 0;
}
function startResults() {
  const tb = timeBonus(G.time, G.act);
  const rb = G.rings * 100;
  const tricks = G.act === 2 && K.board && K.board.trick ? Math.max(0, Math.floor(num(K.board.trick.total, 0))) : 0;
  G.res = { tb, rb, tb0: tb, rb0: rb, done: 0, act: G.act, tricks };
  G.runTime += G.time; G.runActs++; G.lastAct = G.act;
  G.state = 'results'; G.st = 0; G.timerOn = false; G.paused = false;
  K.audio.setSpeed(1);
  K.audio.playMusic('clear');
  cine(true);
  syncPauseBtn();
}
function sanitizeBest(b) {
  if (!b || typeof b !== 'object') return null;
  const time = num(b.time, NaN), score = num(b.score, NaN);
  if (!(time > 0) || !(score >= 0)) return null;
  return { time, score };
}
function bestOf(act) { return act === 2 ? G.best2 : G.best; }
function saveBest() {
  const act = G.act, b = bestOf(act);
  // after a time over the clock restarted at the checkpoint: that time is not a real run's time
  const timed = !G.timeOver;
  G.newRecord = timed && (!b || G.time < b.time);
  G.newScore = !b || G.score > b.score;
  const time = b ? (timed ? Math.min(b.time, G.time) : b.time) : timed ? G.time : 0;
  if (!(time > 0)) return; // a first finish after a time over has no time to record
  const nb = { time, score: Math.max(b ? b.score : 0, G.score) };
  if (act === 2) G.best2 = nb; else G.best = nb;
  K.store.set(act === 2 ? 'best2' : 'best', nb);
}
function selectAct(a) {
  a = a === 2 && act2Ready() ? 2 : 1;
  if (a === G.sel) return;
  G.sel = a;
  K.store.set('act', a);
  sfx('tick');
}

// ----- K.game API used by the other modules -----
function addRings(n) {
  n = Math.trunc(num(n, 0)); if (!n || G.state === 'title') return;
  G.rings = clamp(G.rings + n, 0, 999);
  if (n > 0) {
    sfx('ring');
    const ups = Math.floor(G.rings / 100);
    if (ups > G.ringUps) { G.ringUps = ups; oneUp(); }
  }
}
function addScore(n, worldPos) {
  n = Math.floor(num(n, 0)); if (n <= 0 || G.state === 'title') return;
  G.score = Math.min(99999999, G.score + n);
  if (worldPos) popup(String(n), worldPos, WHITE);
}
function oneUp() {
  G.lives = Math.min(99, G.lives + 1);
  sfx('oneup');
  const P = K.player;
  if (P && P.center) { tmpV.copy(P.center()); tmpV.y += 1.2; popup('1UP', tmpV, GREEN); }
}
function applyItem(kind) {
  const P = K.player;
  if (G.state === 'title' || !P) return;
  switch (kind) {
    case 'ring': addRings(10); break;
    case 'shield': P.shield = true; sfx('item'); break;
    case 'shoes': P.shoes = 20; sfx('item'); break;
    case 'star': P.star = 20; sfx('item'); break;
    case 'life': oneUp(); break;
  }
}
function setCheckpoint(i) {
  i = Math.trunc(num(i, -1));
  const cps = checkpoints();
  if (i <= G.cpIndex || !cps[i] || G.state === 'title') return;
  G.cpIndex = i; G.cpTime = G.time;
  sfx('check');
}
function onDeath() {
  if (G.deathHandled) return;
  if (G.state === 'title') { placePlayer(); return; }
  if (G.state !== 'play' && G.state !== 'card') return;
  G.deathHandled = true;
  G.lives--;
  if (G.lives < 0) {
    G.lives = 0;
    G.state = 'over'; G.st = 0; G.paused = false; G.timerOn = false;
    K.audio.setSpeed(1);
    K.audio.playMusic('over');
    syncPauseBtn();
  } else startAct(1.6);
}
function onBossStart() {
  if (G.act !== 1 || G.bossActive || G.bossDone || (G.state !== 'play' && G.state !== 'card')) return;
  G.bossActive = true;
  // invincibility fades out while Dr Boulon flies in: the fight itself is never won without risk
  const P = K.player;
  if (P && P.star > 1.5) P.star = 1.5;
  K.audio.playMusic('boss');
  const b = K.level && K.level.boss;
  K.camera.setMode('boss', b ? { center: b.center, radius: b.radius } : {});
}
function onBossDefeated() {
  if (G.bossDone) return;
  G.bossDone = true; G.bossActive = false;
  const P = K.player;
  if (P && P.center) { tmpV.copy(P.center()); tmpV.y += 2; addScore(1000, tmpV); } else addScore(1000);
  if (!P || !P.dead) K.audio.playMusic('main');
  K.camera.setMode('follow');
}
function onCapsule() {
  if (G.state !== 'play' || G.act !== 1) return;
  G.timerOn = false;
  startResults();
}
// Act 2: the board lands Kit on the goal pad
function onActComplete() {
  if (G.state !== 'play' || G.act !== 2) return;
  G.timerOn = false;
  startResults();
}
// Act 2 trick events from K.board ('trick' | 'land' | 'fail' | 'grind' | 'hoop' | 'bumper') for the HUD feed
function onTrick(kind, name, points, combo) {
  if (G.act !== 2 || G.state !== 'play') return;
  const e = feed[feed.length - 1];
  for (let i = feed.length - 1; i > 0; i--) feed[i] = feed[i - 1];
  feed[0] = e;
  e.on = true; e.t = 0; e.kind = String(kind || ''); e.name = String(name || '').slice(0, 24);
  e.pts = Math.max(0, Math.floor(num(points, 0))); e.combo = Math.max(0, Math.floor(num(combo, 0)));
  if (e.kind === 'land' && e.combo >= 2) { G.comboN = e.combo; G.comboT = 0; }
  else if (e.kind === 'fail') G.comboT = 9;
  else if (e.kind === 'bumper') { G.comboT = 9; G.hintT = 99; }
}

// ================= simulation =================
// drive: Act 2 only, the board reads the controls (not during the act card)
function simulate(drive) {
  G.simT += STEP;
  const P = K.player;
  if (G.act === 2) {
    const B = K.board;
    if (drive && B.active) B.update(STEP);
    const ts = B.active && B.timeScale > 0 ? B.timeScale : 1;
    P.update(STEP * ts);
    K.city.update(STEP * ts, G.simT);
    K.entities.update(STEP * ts, G.simT);
    K.camera.update(STEP);
  } else {
    P.update(STEP);
    K.entities.update(STEP, G.simT);
    K.world.setFocus(P.pos);
    K.world.update(STEP, G.simT);
    K.camera.update(STEP);
  }
  if (vfxOn()) K.vfx.update(STEP, K.view.camera);
}
// speed effects of the island run (the board drives them itself in Act 2)
function speedFx() {
  if (G.act !== 1) return;
  const P = K.player, v = P.vel;
  const sp = P.dead ? 0 : Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 0;
  if (postOn()) K.post.speed(smooth((sp - 24) / 16) * 0.85);
  if (vfxOn()) K.vfx.speedLines(smooth((sp - 25) / 13), v);
}
function badPos(p) { return !p || !(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)); }
function watchPlayer(timing) {
  const P = K.player;
  if (!P.dead) {
    if (badPos(P.pos) || badPos(P.vel)) { console.warn('Kit Rush 3D: invalid player state, respawning'); placePlayer(); return; }
    const dy = G.act === 2 ? K.city.deathY : K.world.deathY;
    if (Number.isFinite(dy) && P.pos.y < dy - 6) P.kill('fall');
    if (timing && G.timerOn && !P.dead) {
      G.time = Math.round((G.time + STEP) * 1e6) / 1e6;
      // time over: the next try restarts the clock (a checkpoint taken at 9:58 must not chain into game over)
      // (the run is flagged: its final time is no record and earns no time bonus)
      if (G.time >= 600) { G.time = 600; G.cpTime = 0; G.timeOver = true; P.kill('time'); }
    }
  }
  if (P.dead) {
    if (!G.deadSeen) {
      G.deadSeen = true; G.deadT = 0; G.fast = false;
      K.audio.stopMusic(); K.audio.setSpeed(1); sfx('die');
    }
    G.deadT += STEP;
    if (G.deadT > 6) onDeath(); // safety net if the death animation never reports back
    return;
  }
  if (G.act === 2) {
    // the flight over the bay picks the music up a little
    const fl = K.board.mode === 'flight' || K.board.mode === 'land';
    if (fl !== G.fast) { G.fast = fl; K.audio.setSpeed(fl ? 1.22 : ACT2_TEMPO); }
    if (K.board.mode === 'flight' && !G.flightHint && K.board.timeScale >= 1) { G.flightHint = true; G.hintKind = 'flight'; G.hintT = 0; }
    return;
  }
  const fast = P.shoes > 0;
  if (fast !== G.fast) { G.fast = fast; K.audio.setSpeed(fast ? 1.25 : 1); }
}
function tally(go) {
  const R = G.res;
  if (!R || R.done || G.st <= 2.4) return;
  if (go) { G.score += R.tb + R.rb; R.tb = R.rb = 0; }
  const big = R.tb0 + R.rb0 > 20000 ? 500 : 100;
  let moved = false;
  if (R.tb > 0) { const d = Math.min(big, R.tb); R.tb -= d; G.score += d; moved = true; }
  if (R.rb > 0) { const d = Math.min(big, R.rb); R.rb -= d; G.score += d; moved = true; }
  if (moved) { if (G.frame % 4 === 0) sfx('tick'); }
  else { R.done = Math.max(G.st, 0.001); sfx('check'); saveBest(); }
}
function setPaused(p) {
  if (G.state !== 'play') p = false;
  G.paused = !!p; G.pauseSel = 0;
  // a direction still held while pausing is not a menu move ("Quitter" must never be pre-selected)
  const I = K.input;
  const my = p && I && I.move ? I.move.y : 0, mx = p && I && I.move ? I.move.x : 0;
  G.navLast = my > 0.55 ? -1 : my < -0.55 ? 1 : 0;
  G.navLastX = mx > 0.55 ? 1 : mx < -0.55 ? -1 : 0;
  if (p) { if (postOn()) K.post.speed(0); }
  syncPauseBtn();
}
// pause rows: 0 Reprendre, 1 Graphismes, 2 Super Résolution, 3 Retour au titre, 4 Version classique (legacy/, three r128)
function cycleQuality(d) {
  if (!K.post || typeof K.post.setQuality !== 'function') return;
  const i = QUALITIES.indexOf(K.post.quality);
  const n = QUALITIES[(Math.max(0, i) + d + QUALITIES.length) % QUALITIES.length];
  try { K.post.setQuality(n); } catch (e) { console.warn(e); }
  needDraw = true;
}
function toggleSuperRes() {
  if (!K.post || typeof K.post.setSuperRes !== 'function') return;
  try { K.post.setSuperRes(!K.post.superRes); } catch (e) { console.warn(e); }
  needDraw = true;
}
function pauseConfirm(dir) {
  sfx('tick');
  const s = G.pauseSel;
  if (s === 1) cycleQuality(dir || 1);
  else if (s === 2) toggleSuperRes();
  else if (s === 3) { setPaused(false); toTitle(); }
  else if (s === 4) openLegacy();
  else setPaused(false);
}
const PAUSE_ROWS = 5;
// the frozen v2 build (three.js r128, WebGL 1-style rendering) for browsers or GPUs that struggle with this one
function openLegacy() {
  try { K.audio.stopMusic(); } catch (e) { /* ignore */ }
  try { location.href = 'legacy/'; } catch (e) { /* navigation refused by the host */ }
}
function pauseMenu() {
  const I = K.input;
  if (I.hit('pause')) { setPaused(false); return; }
  const ny = I.move.y > 0.55 ? -1 : I.move.y < -0.55 ? 1 : 0;
  if (ny && ny !== G.navLast) {
    const n = clamp(G.pauseSel + ny, 0, PAUSE_ROWS - 1);
    if (n !== G.pauseSel) { G.pauseSel = n; sfx('tick'); }
  }
  G.navLast = ny;
  const nx = I.move.x > 0.55 ? 1 : I.move.x < -0.55 ? -1 : 0;
  if (nx && nx !== G.navLastX && (G.pauseSel === 1 || G.pauseSel === 2)) pauseConfirm(nx);
  G.navLastX = nx;
  if (I.hit('tap')) {
    const i = pauseItemAt(I.tap.x / U, I.tap.y / U);
    if (i >= 0) { G.pauseSel = i; pauseConfirm(1); return; }
  }
  if (I.hit('start') || I.hit('jump')) pauseConfirm(1);
}
function titleInput(go) {
  const I = K.input;
  if (!act2Ready()) return go;
  const nx = I.move.x > 0.55 ? 1 : I.move.x < -0.55 ? -1 : 0;
  if (nx && nx !== G.navLastX && G.st > 0.2) selectAct(nx > 0 ? 2 : 1);
  G.navLastX = nx;
  if (I.hit('tap')) {
    const a = actChipAt(I.tap.x / U, I.tap.y / U);
    if (a) { if (a !== G.sel) { selectAct(a); return false; } return true; }
  }
  return go;
}

function step() {
  const I = K.input;
  I.poll();
  G.frame++; G.clock += STEP; G.st += STEP;
  let go = I.hit('start') || I.hit('jump') || I.hit('tap');
  switch (G.state) {
    case 'title':
      go = titleInput(go);
      if (go && G.st > 0.35) { newGame(G.sel); break; }
      I.neutral(); simulate(false);
      if (K.player.dead || badPos(K.player.pos)) placePlayer();
      break;
    case 'loading':
      I.neutral();
      if (G.loadBusy) loadAct2Wait();
      else if (G.st >= 0.1) loadAct2();
      break;
    case 'boot':
      I.neutral();
      break;
    case 'card':
      I.neutral(); simulate(false); watchPlayer(false);
      if (G.state === 'card' && G.st >= G.cardLen) {
        G.state = 'play'; G.st = 0; G.timerOn = true;
        if (G.act === 2 && G.cpIndex < 0) { G.hintKind = 'skate'; G.hintT = 0; }
      }
      break;
    case 'play':
      if (G.paused) { pauseMenu(); break; }
      if (I.hit('pause') || I.hit('start')) { setPaused(true); break; }
      simulate(true); watchPlayer(true); speedFx();
      break;
    case 'results':
      I.neutral(); simulate(true); tally(go && G.st > 2.6);
      if (G.res && G.res.done && G.st - G.res.done > 1 && go) {
        if (G.act === 1 && act2Ready()) beginAct2();
        else { G.state = 'end'; G.st = 0; cine(false); }
      }
      break;
    case 'end':
      I.neutral(); simulate(true);
      if (G.st > 0.6 && go) toTitle();
      break;
    case 'over':
      I.neutral(); G.simT += STEP;
      if (G.act === 2) K.city.update(STEP, G.simT); else K.world.update(STEP, G.simT);
      if (vfxOn()) K.vfx.update(STEP, K.view.camera);
      if ((G.st > 1 && go) || G.st > 8) toTitle();
      break;
  }
  updatePopups();
}

// ================= popups (score / 1UP floating in the world, Act 2 trick feed) =================
const pops = [];
let tmpV = null;
const scr = { x: 0, y: 0, front: false, visible: false };
const feed = [];
for (let i = 0; i < 4; i++) feed.push({ on: false, t: 0, kind: '', name: '', pts: 0, combo: 0 });
function popup(txt, pos, col) {
  if (!pops.length || !pos || badPos(pos)) return;
  let p = null, oldest = pops[0];
  for (const q of pops) { if (!q.on) { p = q; break; } if (q.t > oldest.t) oldest = q; }
  p = p || oldest;
  p.on = true; p.t = 0; p.txt = txt; p.col = col; p.pos.set(pos.x, pos.y, pos.z);
}
function updatePopups() {
  for (const p of pops) if (p.on) { p.t += STEP; if (p.t > 1.1) p.on = false; }
  if (G.paused) return;
  for (const e of feed) if (e.on) { e.t += STEP; if (e.t > 1.7) e.on = false; }
  if (G.comboT < 9) G.comboT += STEP;
  if (G.hintT < 99 && G.state === 'play') G.hintT += STEP;
}
function clearPopups() {
  for (const p of pops) p.on = false;
  for (const e of feed) e.on = false;
  G.comboT = 9;
}

// ================= HUD drawing =================
let c = null;         // HUD 2D context
let U = 1, LW = 640, LH = 320; // HUD logical units: 1 unit = U css px, LH ≈ 320
const FC = { fur: '#f47a1f', furD: '#c4510f', furL: '#ffb35e', white: '#fff4e6', line: '#3d1707', shoe: '#17b6c3', shoeD: '#0c7480', sole: '#f2f4f8', scarf: '#2f5bff', scarfD: '#1c39b4', eye: '#22c36a', inner: '#6a2408' };

function txt(s, x, y, size, fill, align, skew, maxW) {
  c.save(); c.translate(x, y); if (skew) c.transform(1, 0, -0.16, 1, 0, 0);
  c.font = `${size}px ${FONT}`;
  if (maxW) { const w = c.measureText(s).width; if (w > maxW) { size *= maxW / w; c.font = `${size}px ${FONT}`; } }
  c.textAlign = align || 'left'; c.textBaseline = 'alphabetic'; c.lineJoin = 'round';
  c.lineWidth = Math.max(2, size * 0.24); c.strokeStyle = NAVY; c.strokeText(s, 0, 0);
  c.fillStyle = fill; c.fillText(s, 0, 0); c.restore();
}
function rrect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function star4(g, x, y, r, col) {
  g.fillStyle = col; g.beginPath(); g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r); g.fill();
}
function fs(g, fill) { g.fillStyle = fill; g.fill(); g.strokeStyle = FC.line; g.stroke(); }
// Kit's head, same drawing as the 2D game (origin = head center, facing right)
function drawHead(g, eyes) {
  g.lineWidth = 1; g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath(); g.moveTo(-6, -4); g.lineTo(-6, -15); g.lineTo(0, -6.5); g.closePath(); fs(g, FC.furD);
  g.fillStyle = FC.inner; g.beginPath(); g.moveTo(-5, -5.4); g.lineTo(-5.2, -12.2); g.lineTo(-1.6, -6.4); g.fill();
  g.beginPath(); g.moveTo(-8, -1); g.lineTo(-13, 2.4); g.lineTo(-7.4, 3.6); g.closePath(); fs(g, FC.fur);
  g.beginPath(); g.ellipse(0, 0, 8.4, 8, 0, 0, TAU); fs(g, FC.fur);
  g.beginPath(); g.moveTo(-2, -6); g.lineTo(2.5, -17.5); g.lineTo(5.6, -5.6); g.closePath(); fs(g, FC.fur);
  g.fillStyle = FC.inner; g.beginPath(); g.moveTo(-0.6, -6.6); g.lineTo(2.5, -14.6); g.lineTo(4.2, -6.6); g.fill();
  g.beginPath(); g.moveTo(-1.5, 2); g.quadraticCurveTo(5, -1.5, 12.6, 0.4); g.lineTo(12, 3.2); g.quadraticCurveTo(5.5, 8.6, -3.4, 6.4);
  g.quadraticCurveTo(-4.2, 4, -1.5, 2); g.closePath(); fs(g, FC.white);
  g.fillStyle = FC.fur; g.beginPath(); g.moveTo(3, -3.4); g.quadraticCurveTo(8, -2.4, 12.4, 0.2); g.lineTo(4, 1.2); g.closePath(); g.fill();
  g.beginPath(); g.ellipse(12.6, 0.8, 1.8, 1.5, 0, 0, TAU); fs(g, '#1a0b05');
  g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(-3, -3.5, 3.2, 1.6, -0.5, 0, TAU); g.fill();
  if (eyes === 'x') {
    g.strokeStyle = FC.line; g.lineWidth = 1.4; g.beginPath(); g.moveTo(1.8, -4.6); g.lineTo(5.6, -0.6); g.moveTo(5.6, -4.6); g.lineTo(1.8, -0.6); g.stroke(); g.lineWidth = 1;
  } else if (eyes === 'shut') {
    g.strokeStyle = FC.line; g.lineWidth = 1.3; g.beginPath(); g.moveTo(1.4, -2.4); g.quadraticCurveTo(3.8, -0.6, 6.2, -2.4); g.stroke(); g.lineWidth = 1;
  } else {
    g.beginPath(); g.ellipse(3.8, -2.8, 2.7, 3.7, 0.1, 0, TAU); fs(g, '#ffffff');
    g.fillStyle = FC.eye; g.beginPath(); g.ellipse(4.7, -2.6, 1.75, 2.7, 0.1, 0, TAU); g.fill();
    g.fillStyle = '#08130c'; g.beginPath(); g.ellipse(5.2, -2.5, 0.95, 1.6, 0, 0, TAU); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(4.4, -3.8, 0.7, 0, TAU); g.fill();
  }
  g.strokeStyle = FC.line; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(0.8, -7); g.quadraticCurveTo(4, -7.6, 7, -5.8); g.stroke();
  g.beginPath(); g.moveTo(7.8, 4.2); g.quadraticCurveTo(9.6, 5.2, 11, 4); g.stroke(); g.lineWidth = 1;
}
function drawShoe(g) {
  g.lineWidth = 1; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(-3, -0.5); g.quadraticCurveTo(-3.6, -5.4, 1.5, -5); g.quadraticCurveTo(7.6, -4.4, 7.6, -1.2);
  g.lineTo(7.4, 0.6); g.lineTo(-3, 0.6); g.closePath(); fs(g, FC.shoe);
  g.fillStyle = FC.sole; g.fillRect(-3, -0.6, 10.4, 1.6);
  g.strokeStyle = '#ffffff'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(0.4, -4.6); g.lineTo(2.4, -1.4); g.stroke(); g.lineWidth = 1;
}
function drawIcon(g, k, x, y, s) {
  g.save(); g.translate(x, y); g.scale(s, s);
  if (k === 'ring') { g.lineWidth = 1.8; g.strokeStyle = '#ffd640'; g.beginPath(); g.ellipse(0, 0, 3.6, 4.2, 0, 0, TAU); g.stroke(); }
  else if (k === 'shield') {
    const gr = g.createRadialGradient(-1.5, -1.5, 0.5, 0, 0, 5); gr.addColorStop(0, '#e8f8ff'); gr.addColorStop(1, '#2f8fff');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 5, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 0.8; g.beginPath(); g.arc(0, 0, 4.2, Math.PI * 1.1, Math.PI * 1.5); g.stroke();
  } else if (k === 'shoes') { g.scale(0.8, 0.8); g.translate(-2, 3); drawShoe(g); }
  else if (k === 'star') {
    g.fillStyle = GOLD; g.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 2.2 : 5.4, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath(); g.fill(); g.strokeStyle = '#b07a00'; g.lineWidth = 0.6; g.stroke();
  } else if (k === 'life') { g.scale(0.5, 0.5); drawHead(g, 'open'); }
  g.restore();
}

function drawHUD() {
  const P = K.player;
  const flashRings = G.rings === 0 && Math.floor(G.clock * 3.75) % 2 === 1;
  const lateTime = G.time >= 540 && Math.floor(G.clock * 3.75) % 2 === 1;
  const x0 = 16, xv = 156, y0 = 27, dy = 21, sz = 17;
  txt('SCORE', x0, y0, sz, GOLD, 'left', true); txt(fmtN(G.score), xv, y0, sz, WHITE, 'right');
  txt('TEMPS', x0, y0 + dy, sz, lateTime ? RED : GOLD, 'left', true); txt(fmtT(G.time), xv, y0 + dy, sz, WHITE, 'right');
  txt('ANNEAUX', x0, y0 + dy * 2, sz, flashRings ? RED : GOLD, 'left', true); txt(String(G.rings), xv, y0 + dy * 2, sz, WHITE, 'right');
  let rows = 3;
  if (G.act === 2 && K.board && K.board.trick) {
    rows = 4;
    txt('FIGURES', x0, y0 + dy * 3, sz, GOLD, 'left', true); txt(fmtN(K.board.trick.total), xv, y0 + dy * 3, sz, WHITE, 'right');
  }

  // lives box: bottom-left on desktop, under the counters on touch (the joystick owns that corner)
  const touch = K.input.isTouch();
  const bx = 12, by = touch ? y0 + dy * (rows - 1) + 12 : LH - 46, bw = 94, bh = 34;
  c.fillStyle = 'rgba(10,14,50,.5)'; rrect(c, bx, by, bw, bh, 9); c.fill();
  c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 1; c.stroke();
  c.save(); c.translate(bx + 19, by + 21); c.scale(0.82, 0.82);
  drawHead(c, P && P.dead ? 'x' : (Math.floor(G.clock * 60) % 220 < 6 ? 'shut' : 'open'));
  c.restore();
  txt('KIT', bx + 38, by + 14, 11, GOLD, 'left', true);
  txt('× ' + Math.max(0, G.lives), bx + 38, by + 29, 15, WHITE, 'left');

  // power-up timers
  let ix = bx + bw + 6;
  if (P && !P.dead) {
    if (P.shield) ix = powerBox(ix, by, bh, 'shield', -1);
    if (P.shoes > 0) ix = powerBox(ix, by, bh, 'shoes', P.shoes / 20);
    if (P.star > 0) ix = powerBox(ix, by, bh, 'star', P.star / 20);
  }

  // boss health
  let bi = null;
  try { bi = K.entities.bossInfo(); } catch (e) { bi = null; }
  if (bi && bi.active) {
    const max = clamp(Math.round(num(bi.max, 8)), 1, 16), hp = clamp(Math.round(num(bi.hp, 0)), 0, max);
    txt('DR BOULON', LW / 2, 24, 15, WHITE, 'center', true);
    const pw2 = 11, gap = 3, tw = max * pw2 + (max - 1) * gap, px = LW / 2 - tw / 2;
    c.fillStyle = 'rgba(10,14,50,.55)'; rrect(c, px - 4, 29, tw + 8, 12, 4); c.fill();
    for (let i = 0; i < max; i++) {
      c.fillStyle = i < hp ? '#ff4b3a' : 'rgba(255,255,255,.2)';
      rrect(c, px + i * (pw2 + gap), 32, pw2, 6, 2); c.fill();
    }
  }
}

function powerBox(ix, by, bh, k, left) {
  c.fillStyle = 'rgba(10,14,50,.5)'; rrect(c, ix, by, 30, bh, 9); c.fill();
  drawIcon(c, k, ix + 15, by + 15, 1.45);
  if (left >= 0) {
    c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(ix + 5, by + bh - 7, 20, 3);
    c.fillStyle = left < 0.25 && Math.floor(G.clock * 6) % 2 ? RED : GOLD; c.fillRect(ix + 5, by + bh - 7, 20 * clamp(left, 0, 1), 3);
  }
  return ix + 34;
}

// homing reticle at the projected target while airborne
const ret = { ref: null, t0: 0, a: 0, x: 0, y: 0 };
function drawReticle() {
  const P = K.player;
  let tgt = null;
  if (G.state === 'play' && !G.paused && P && !P.dead && !P.onGround) {
    try { tgt = K.entities.homingTarget(P.center(), P.forward); } catch (e) { tgt = null; }
  }
  if (tgt && tgt.pos && !badPos(tgt.pos)) {
    K.view.toScreen(tgt.pos, scr);
    if (scr.visible) {
      if (tgt.ref !== ret.ref || ret.a <= 0) { ret.ref = tgt.ref; ret.t0 = G.clock; }
      ret.x = scr.x / U; ret.y = scr.y / U; ret.a = Math.min(1, ret.a + 0.25);
    } else ret.a = Math.max(0, ret.a - 0.2);
  } else {
    ret.a = Math.max(0, ret.a - 0.2);
    if (ret.a === 0) ret.ref = null;
  }
  if (ret.a <= 0) return;
  const lk = easeOut((G.clock - ret.t0) / 0.18);
  const r = 15 + (1 - lk) * 26, rot = G.clock * 3.4, pulse = 1 + Math.sin(G.clock * 14) * 0.07 * lk;
  c.save(); c.translate(ret.x, ret.y); c.scale(pulse, pulse); c.globalAlpha = ret.a;
  for (let pass = 0; pass < 2; pass++) {
    c.lineWidth = pass ? 2.4 : 5; c.strokeStyle = pass ? GOLD : NAVY;
    for (let i = 0; i < 3; i++) { const a = rot + i * TAU / 3; c.beginPath(); c.arc(0, 0, r, a, a + 1.25); c.stroke(); }
  }
  for (let i = 0; i < 4; i++) {
    const a = -rot * 0.7 + i * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
    const tipR = r - 3, baseR = r + 9;
    c.beginPath();
    c.moveTo(ca * tipR, sa * tipR);
    c.lineTo(ca * baseR - sa * 5, sa * baseR + ca * 5);
    c.lineTo(ca * baseR + sa * 5, sa * baseR - ca * 5);
    c.closePath();
    c.fillStyle = '#ff4b3a'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = NAVY; c.stroke();
  }
  c.fillStyle = WHITE; c.beginPath(); c.arc(0, 0, 2, 0, TAU); c.fill();
  c.restore();
}

// speed lines at very high speed
function drawSpeedLines() {
  const P = K.player;
  if (!P || P.dead || G.paused || vfxOn()) return;
  const v = P.vel, sp = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 0;
  const k = smooth((sp - 25) / 13);
  if (k <= 0.02) return;
  const cx = LW / 2, cy = LH * 0.52, R = Math.hypot(LW, LH) * 0.55;
  const seed = Math.floor(G.clock * 24);
  c.fillStyle = WHITE;
  for (let i = 0; i < 40; i++) {
    const h = hash(i * 7.13 + seed * 1.37);
    if (h > 0.25 + k * 0.6) continue;
    const a = (i + hash(i * 1.7 + seed) * 0.9) / 40 * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    const r0 = R * (0.62 + 0.22 * hash(i * 3.1 + seed)), r1 = R * 1.05, w = (1.2 + 2.4 * hash(i * 5.3 + seed)) * (0.6 + k * 0.6);
    c.globalAlpha = (0.14 + 0.38 * k) * (0.55 + 0.45 * hash(i + seed * 0.5));
    c.beginPath();
    c.moveTo(cx + ca * r0, cy + sa * r0);
    c.lineTo(cx + ca * r1 - sa * w, cy + sa * r1 + ca * w);
    c.lineTo(cx + ca * r1 + sa * w, cy + sa * r1 - ca * w);
    c.closePath(); c.fill();
  }
  c.globalAlpha = 1;
}

const FEEDC = { trick: WHITE, land: GOLD, fail: RED, grind: '#7fe8ff', hoop: '#7fe8ff', bumper: '#ff8fd0' };
function drawTricks() {
  let y = 30;
  if (G.comboN >= 2 && G.comboT < 1.9) {
    const a = G.comboT > 1.5 ? 1 - (G.comboT - 1.5) / 0.4 : 1, pop = 1 + 0.35 * Math.max(0, 1 - G.comboT / 0.15);
    c.save(); c.globalAlpha = clamp(a, 0, 1); c.translate(LW / 2, y); c.scale(pop, pop);
    txt('COMBO ×' + G.comboN, 0, 0, 22, '#ff9a3c', 'center', true);
    c.restore();
    y += 26;
  }
  for (const e of feed) {
    if (!e.on) continue;
    const a = e.t > 1.25 ? 1 - (e.t - 1.25) / 0.45 : 1, pop = 1 + 0.4 * Math.max(0, 1 - e.t / 0.12);
    const big = e.kind === 'land' || e.kind === 'bumper';
    let s = e.name;
    if ((e.kind === 'land' || e.kind === 'bumper') && e.pts > 0) s += '  +' + fmtN(e.pts);
    c.save(); c.globalAlpha = clamp(a, 0, 1); c.translate(LW / 2, y + (big ? 3 : 0)); c.scale(pop, pop);
    txt(s, 0, 0, big ? 21 : 16, FEEDC[e.kind] || WHITE, 'center', true, LW * 0.6);
    c.restore();
    y += big ? 25 : 20;
  }
  c.globalAlpha = 1;
}
// Act 2 hints: the skateboard controls at the start, the flight controls after the bumper's slow motion
function drawHint() {
  if (G.act !== 2 || G.state !== 'play' || G.paused || G.hintT >= 7) return;
  const dur = G.hintKind === 'flight' ? 3.6 : 6.5;
  if (G.hintT > dur) return;
  const a = Math.min(1, G.hintT / 0.3, (dur - G.hintT) / 0.5);
  const dev = K.input.device;
  let s;
  if (G.hintKind === 'flight') s = dev === 'touch' ? 'Joystick : diriger Kit dans les anneaux' : dev === 'pad' ? 'Stick : diriger Kit dans les anneaux' : 'Flèches : diriger Kit dans les anneaux';
  else s = dev === 'touch' ? 'SAUT : ollie   ·   SAUT en l’air : figure   ·   ROULER : se baisser'
    : dev === 'pad' ? 'A : ollie   ·   A en l’air : figure   ·   B : se baisser' : 'Espace : ollie   ·   Espace en l’air : figure   ·   Maj : se baisser';
  // above the lives box on desktop; on touch the band between the on-screen controls
  const touch = K.input.isTouch(), y = touch ? LH - 34 : LH - 66;
  const band = helpBand(y - 16, y + 12), fs = 13.5;
  c.font = `${fs}px ${FONT}`;
  const maxW = band[1] - band[0] - 20, tw = Math.min(maxW, c.measureText(s).width), cx = (band[0] + band[1]) / 2;
  c.globalAlpha = clamp(a, 0, 1);
  c.fillStyle = 'rgba(10,14,50,.62)'; rrect(c, cx - tw / 2 - 12, y - 14, tw + 24, 24, 12); c.fill();
  c.fillStyle = WHITE; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(s, cx, y - 1, maxW);
  c.textBaseline = 'alphabetic'; c.globalAlpha = 1;
}
function drawPopups() {
  for (const p of pops) {
    if (!p.on) continue;
    tmpV.copy(p.pos); tmpV.y += 0.4 + easeOut(p.t / 0.6) * 1.6;
    K.view.toScreen(tmpV, scr);
    if (!scr.visible) continue;
    c.globalAlpha = p.t > 0.8 ? clamp(1 - (p.t - 0.8) / 0.3, 0, 1) : 1;
    txt(p.txt, scr.x / U, scr.y / U, p.txt === '1UP' ? 18 : 15, p.col, 'center');
  }
  c.globalAlpha = 1;
}

// ----- controls help lines (depend on the device in use and the keyboard layout) -----
let helpKey = '', helpItems = [], helpWrap = { key: '', lines: [] };
// the controls, one move per item (wrapped into lines that fit the free width), plus the canvas' accessible name
function controlsItems() {
  const I = K.input, dev = I.device;
  const skate = G.act === 2 && (G.state === 'play' || G.state === 'card');
  const key = dev + (skate ? '2' : '1') + (dev === 'kb' ? ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].map(I.keyLabel).join('') : '');
  if (key === helpKey) return helpItems;
  helpKey = key; helpWrap.key = '';
  let label;
  if (skate) {
    const L = I.keyLabel;
    if (dev === 'touch') {
      helpItems = ['Joystick : se pencher, freiner', 'SAUT : ollie (maintiens : plus haut)', 'SAUT en l’air : figure (+ joystick)', 'ROULER : se baisser',
        'Après le bumper : joystick pour voler'];
      label = 'skateboard : joystick pour se pencher, SAUT pour un ollie, SAUT en l’air pour une figure, ROULER pour se baisser.';
    } else if (dev === 'pad') {
      helpItems = ['Stick gauche : se pencher, freiner', 'A : ollie (maintiens : plus haut)', 'A en l’air : figure (+ stick)', 'B / X : se baisser', 'Start : pause'];
      label = 'skateboard : stick gauche pour se pencher, A pour un ollie, A en l’air pour une figure, B ou X pour se baisser.';
    } else {
      helpItems = [`${L('KeyA')} / ${L('KeyD')} ou flèches : se pencher, freiner`, 'Espace : ollie (maintiens : plus haut)', 'Espace en l’air : figure (+ direction)',
        'Maj : se baisser', 'Échap : pause'];
      label = `skateboard : ${L('KeyA')} et ${L('KeyD')} ou les flèches pour se pencher, Espace pour un ollie, Espace en l’air pour une figure, Maj pour se baisser.`;
    }
    const hud = $('hud');
    if (hud) hud.setAttribute('aria-label', 'Kit Rush 3D, acte 2 à San Francisco. ' + label.charAt(0).toUpperCase() + label.slice(1));
    return helpItems;
  }
  if (dev === 'touch') {
    helpItems = ['Joystick : courir', 'SAUT : sauter', 'SAUT en l’air : attaque téléguidée', 'ROULER en courant : rouler',
      'ROULER à l’arrêt + SAUT : super élan', 'Glisse l’écran : caméra'];
    label = 'joystick pour courir, bouton SAUT pour sauter et attaquer en l’air, bouton ROULER pour rouler, glisse l’écran pour tourner la caméra.';
  } else if (dev === 'pad') {
    helpItems = ['Stick gauche : courir', 'A : sauter, puis A en l’air : attaque téléguidée', 'B / X : rouler, maintiens + A : super élan',
      'Stick droit : caméra', 'Start : pause'];
    label = 'stick gauche pour courir, A pour sauter et attaquer en l’air, B ou X pour rouler, stick droit pour la caméra.';
  } else {
    const L = I.keyLabel, mv = `${L('KeyW')}${L('KeyA')}${L('KeyS')}${L('KeyD')}`;
    helpItems = [`${mv} ou flèches : courir`, 'Espace : sauter, puis Espace en l’air : attaque téléguidée',
      'Maj : rouler, maintiens Maj + Espace : super élan', `Souris ou ${L('KeyQ')} / ${L('KeyE')} : caméra`, 'M : son', 'Échap : pause'];
    label = `${mv} ou flèches pour courir, Espace pour sauter et attaquer en l’air, Maj pour rouler, souris ou ${L('KeyQ')} et ${L('KeyE')} pour tourner la caméra.`;
  }
  const hud = $('hud');
  if (hud) hud.setAttribute('aria-label', 'Kit Rush 3D, jeu de plateforme en 3D. ' + label.charAt(0).toUpperCase() + label.slice(1));
  return helpItems;
}
// free horizontal band of the HUD (logical units) between on-screen touch controls that overlap the game area at
// heights y0..y1; in portrait the controls sit below the game box and the full width is used
function helpBand(y0, y1) {
  let a = 14, b = LW - 14;
  if (!K.input.isTouch()) return [20, LW - 20];
  const game = $('game');
  if (!game) return [a, b];
  const gr = game.getBoundingClientRect();
  for (const id of ['stick', 'btnRoll', 'btnJump']) {
    const e = $(id);
    if (!e) continue;
    const r = e.getBoundingClientRect();
    if (!(r.width > 0) || r.right <= gr.left || r.left >= gr.right || r.bottom <= gr.top || r.top >= gr.bottom) continue;
    const top = (r.top - gr.top) / U, bot = (r.bottom - gr.top) / U;
    if (bot < y0 || top > y1) continue;
    const l = (r.left - gr.left) / U, rr = (r.right - gr.left) / U;
    if ((l + rr) / 2 < LW / 2) a = Math.max(a, rr + 8); else b = Math.min(b, l - 8);
  }
  if (b - a < LW * 0.3) { a = 14; b = LW - 14; }
  return [a, b];
}
// wraps the controls help into the free band at heights y0..y1 (text never below 11 css px)
function helpLayout(y0, y1) {
  const items = controlsItems();
  const fs = Math.max(10, 11 / U), lh = fs * 1.3;
  const band = helpBand(y0, y1);
  const maxW = band[1] - band[0];
  const wkey = helpKey + '|' + Math.round(maxW) + '|' + fs.toFixed(2);
  c.font = `${fs}px ${FONT}`;
  if (helpWrap.key !== wkey) {
    const lines = [], sep = '   ·   ';
    let cur = '';
    for (const it of items) {
      const cand = cur ? cur + sep + it : it;
      if (!cur || c.measureText(cand).width <= maxW) cur = cand;
      else { lines.push(cur); cur = it; }
    }
    if (cur) lines.push(cur);
    helpWrap.key = wkey; helpWrap.lines = lines;
  }
  return { lines: helpWrap.lines, fs, lh, maxW, cx: (band[0] + band[1]) / 2 };
}
// draws the controls help; y is the first baseline, or with fromBottom the last one
function drawHelp(y, fromBottom) {
  const fs0 = Math.max(10, 11 / U);
  const L = fromBottom ? helpLayout(y - fs0 * 1.3 * 3 - fs0, y + 2) : helpLayout(y - fs0, y + fs0 * 1.3 * 3);
  const n = L.lines.length, y0 = fromBottom ? y - (n - 1) * L.lh : y;
  c.font = `${L.fs}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.fillStyle = 'rgba(225,230,255,.92)';
  for (let i = 0; i < n; i++) {
    if (c.measureText(L.lines[i]).width > L.maxW) c.fillText(L.lines[i], L.cx, y0 + i * L.lh, L.maxW);
    else c.fillText(L.lines[i], L.cx, y0 + i * L.lh);
  }
  return y0 - L.fs; // top of the block
}

// ----- title logo, pre-rendered and re-rendered on resize / font load -----
let logo = null;
function buildLogo(scale) {
  const w = 480, h = 214;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(w * scale)); cv.height = Math.max(1, Math.ceil(h * scale));
  const g = cv.getContext('2d');
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.lineJoin = 'round'; g.lineCap = 'round';
  const ex = w / 2, ey = 76, R = 58;
  let gr = g.createRadialGradient(ex, ey, R * 0.5, ex, ey, R * 1.6);
  gr.addColorStop(0, 'rgba(255,214,90,.5)'); gr.addColorStop(1, 'rgba(255,214,90,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(ex, ey, R * 1.6, 0, TAU); g.fill();
  // emblem: a little Collines Émeraude scene inside a gold ring
  g.save(); g.beginPath(); g.arc(ex, ey, R - 3, 0, TAU); g.clip();
  gr = g.createLinearGradient(0, ey - R, 0, ey + R); gr.addColorStop(0, '#c8f2ff'); gr.addColorStop(0.5, '#59bcff'); gr.addColorStop(1, '#2468dc');
  g.fillStyle = gr; g.fillRect(ex - R, ey - R, 2 * R, 2 * R);
  g.fillStyle = 'rgba(255,255,255,.9)';
  g.beginPath(); g.ellipse(ex - 30, ey - 30, 16, 6, 0, 0, TAU); g.ellipse(ex - 20, ey - 33, 10, 7, 0, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(ex + 34, ey - 18, 13, 5, 0, 0, TAU); g.ellipse(ex + 40, ey - 21, 8, 6, 0, 0, TAU); g.fill();
  g.fillStyle = '#2f8fe8'; g.fillRect(ex - R, ey + 14, 2 * R, R);
  g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(ex - R, ey + 14, 2 * R, 1.5);
  for (let i = 0; i < 2; i++) {
    const hx = i ? ex + 34 : ex - 30, hy = i ? ey + 40 : ey + 36, hw = i ? 44 : 52, hh = i ? 24 : 28;
    g.fillStyle = '#b4561c'; g.beginPath(); g.ellipse(hx, hy + 8, hw, hh, 0, 0, TAU); g.fill();
    g.save(); g.beginPath(); g.ellipse(hx, hy + 8, hw, hh, 0, 0, TAU); g.clip();
    g.fillStyle = '#e48a2c';
    for (let yy = -4; yy < 4; yy++) for (let xx = -8; xx < 8; xx++) if ((xx + yy) & 1) g.fillRect(hx + xx * 7, hy + 6 + yy * 7, 7, 7);
    g.restore();
    g.fillStyle = '#35c25a'; g.beginPath(); g.ellipse(hx, hy, hw, hh * 0.55, 0, Math.PI, TAU); g.lineTo(hx + hw, hy + 3); g.lineTo(hx - hw, hy + 3); g.fill();
    g.fillStyle = '#7be37f'; g.beginPath(); g.ellipse(hx - hw * 0.2, hy - hh * 0.38, hw * 0.45, 2.2, 0, 0, TAU); g.fill();
  }
  g.restore();
  g.lineWidth = 15; g.strokeStyle = NAVY; g.beginPath(); g.arc(ex, ey, R, 0, TAU); g.stroke();
  gr = g.createLinearGradient(ex - R, ey - R, ex + R, ey + R);
  gr.addColorStop(0, '#fff6b0'); gr.addColorStop(0.4, '#ffc02a'); gr.addColorStop(0.75, '#e07a10'); gr.addColorStop(1, '#ffd84a');
  g.lineWidth = 10; g.strokeStyle = gr; g.beginPath(); g.arc(ex, ey, R, 0, TAU); g.stroke();
  g.lineWidth = 2.2; g.strokeStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.arc(ex, ey, R + 1.5, Math.PI * 1.08, Math.PI * 1.45); g.stroke();
  g.save(); g.translate(ex - 4, ey + 12); g.scale(3.25, 3.25); drawHead(g, 'open'); g.restore();

  // "KIT RUSH" + "3D"
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.font = `70px ${FONT}`; const tw = g.measureText('KIT RUSH').width;
  g.font = `60px ${FONT}`; const dw = g.measureText('3D').width;
  const gap = 16, x0 = w / 2 - (tw + gap + dw) / 2, base = 160;
  g.save(); g.translate(x0, base); g.transform(1, 0, -0.12, 1, 0, 0);
  g.font = `70px ${FONT}`;
  g.lineWidth = 12; g.strokeStyle = NAVY; g.strokeText('KIT RUSH', 0, 0);
  for (let i = 7; i > 0; i--) { g.fillStyle = i > 3 ? '#5a1d06' : '#8f3410'; g.fillText('KIT RUSH', i * 0.55, i * 1.05); }
  gr = g.createLinearGradient(0, -52, 0, 0);
  gr.addColorStop(0, '#fffbd8'); gr.addColorStop(0.34, '#ffe27a'); gr.addColorStop(0.36, '#ffc02a'); gr.addColorStop(1, '#f0621a');
  g.fillStyle = gr; g.fillText('KIT RUSH', 0, 0);
  g.restore();
  g.save(); g.translate(x0 + tw + gap + dw / 2, base - 6); g.rotate(-0.1); g.transform(1, 0, -0.12, 1, 0, 0);
  g.font = `60px ${FONT}`; g.textAlign = 'center';
  g.lineWidth = 12; g.strokeStyle = NAVY; g.strokeText('3D', 0, 0);
  for (let i = 6; i > 0; i--) { g.fillStyle = i > 3 ? '#0b1a5c' : '#16339a'; g.fillText('3D', i * 0.55, i * 1.05); }
  gr = g.createLinearGradient(0, -46, 0, 0);
  gr.addColorStop(0, '#f2fdff'); gr.addColorStop(0.36, '#bfeeff'); gr.addColorStop(0.38, '#6fcfff'); gr.addColorStop(1, '#2f5bff');
  g.fillStyle = gr; g.fillText('3D', 0, 0);
  g.restore();

  // ribbon
  const rw = 250, rh = 26, rx = w / 2 - rw / 2, ry = 178;
  g.fillStyle = '#8e1c16';
  g.beginPath(); g.moveTo(rx + 12, ry + 6); g.lineTo(rx - 24, ry + 6); g.lineTo(rx - 13, ry + 6 + rh / 2); g.lineTo(rx - 24, ry + 6 + rh); g.lineTo(rx + 12, ry + 6 + rh); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(rx + rw - 12, ry + 6); g.lineTo(rx + rw + 24, ry + 6); g.lineTo(rx + rw + 13, ry + 6 + rh / 2); g.lineTo(rx + rw + 24, ry + 6 + rh); g.lineTo(rx + rw - 12, ry + 6 + rh); g.closePath(); g.fill();
  g.fillStyle = '#d8322a'; rrect(g, rx, ry, rw, rh, 5); g.fill();
  g.fillStyle = NAVY; rrect(g, rx + 3, ry + 3, rw - 6, rh - 6, 4); g.fill();
  g.font = `16px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = GOLD;
  g.fillText('COLLINES ÉMERAUDE', w / 2, ry + rh / 2 + 1);

  const sh = document.createElement('canvas'); sh.width = cv.width; sh.height = cv.height;
  return { cv, sh, sg: sh.getContext('2d'), scale, w, h };
}
function drawLogo(x, y, s) {
  const k = K.view.hudDpr * U * s;
  if (!logo || Math.abs(logo.scale - k) > 0.01 * k) logo = buildLogo(k);
  const cyc = G.clock % 3.4;
  let src = logo.cv;
  if (cyc < 1.1) {
    const sg = logo.sg, W = logo.sh.width, H = logo.sh.height;
    sg.setTransform(1, 0, 0, 1, 0, 0); sg.globalCompositeOperation = 'source-over';
    sg.clearRect(0, 0, W, H); sg.drawImage(logo.cv, 0, 0);
    sg.globalCompositeOperation = 'source-atop';
    const p = (cyc / 1.1) * (W + H) - H * 0.5, bw = W * 0.08;
    const gr = sg.createLinearGradient(p - bw, 0, p + bw, H * 0.35);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    sg.fillStyle = gr; sg.fillRect(0, 0, W, H);
    sg.globalCompositeOperation = 'source-over';
    src = logo.sh;
  }
  c.drawImage(src, x, y, logo.w * s, logo.h * s);
  for (let i = 0; i < 4; i++) {
    const ph = (G.clock * 0.9 + i * 0.37) % 1.6;
    if (ph > 0.6) continue;
    const sx = x + (logo.w * (0.22 + 0.56 * hash(i * 3.7 + Math.floor((G.clock * 0.9 + i * 0.37) / 1.6)))) * s;
    const sy = y + (logo.h * (0.08 + 0.55 * hash(i * 9.1 + Math.floor((G.clock * 0.9 + i * 0.37) / 1.6)))) * s;
    star4(c, sx, sy, 7 * Math.sin(ph / 0.6 * Math.PI) * s, i % 2 ? '#fffbe0' : GOLD);
  }
}

function drawTitle() {
  let g = c.createLinearGradient(0, 0, 0, LH * 0.3);
  g.addColorStop(0, 'rgba(8,12,44,.35)'); g.addColorStop(1, 'rgba(8,12,44,0)');
  c.fillStyle = g; c.fillRect(0, 0, LW, LH * 0.3);
  g = c.createLinearGradient(0, LH * 0.45, 0, LH);
  g.addColorStop(0, 'rgba(8,12,44,0)'); g.addColorStop(1, 'rgba(8,12,44,.82)');
  c.fillStyle = g; c.fillRect(0, LH * 0.45, LW, LH * 0.55);
  // bottom-up: controls help, then the prompt above it, then the logo scaled to the room left
  const rfs = Math.max(11, 11.5 / U);
  const best = bestOf(G.sel);
  const helpTop = drawHelp(best ? LH - 10 - rfs * 1.35 : LH - 12, true);
  const promptY = Math.min(LH * 0.745, helpTop - 7);
  const two = act2Ready();
  const chipY = promptY - 21 - 28;
  const s = Math.max(0.3, Math.min(1, (LW - 24) / 480, (LH * 0.64) / 214, ((two ? chipY - 6 : promptY - 18) - LH * 0.035) / 214));
  const intro = easeOut(G.st / 0.7);
  drawLogo(LW / 2 - 240 * s, LH * 0.035 - (1 - intro) * 40, s);
  if (two) drawActChips(chipY, intro);
  const I = K.input, dev = I.device;
  const prompt = dev === 'touch' ? 'Touche l’écran pour jouer' : dev === 'pad' ? 'Appuie sur A pour jouer' : 'Appuie sur Espace pour jouer';
  if (Math.floor(G.clock * 1.9) % 2 === 0 || G.st < 0.7) txt(prompt, LW / 2, promptY, 19, WHITE, 'center', false, LW - 40);
  if (best) {
    c.font = `${rfs}px ${FONT}`; c.textAlign = 'center'; c.fillStyle = GOLD;
    c.fillText(`Record${two ? ' acte ' + G.sel : ''} : ${fmtT(best.time)}   ·   ${fmtN(best.score)} pts`, LW / 2, LH - 10);
  }
}
// "ACTE 1 — COLLINES ÉMERAUDE" / "ACTE 2 — SAN FRANCISCO": arrows, A/D, the stick or a tap pick the act
const chipRects = [{ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 0, h: 0 }];
const CHIPS = [['ACTE 1', 'COLLINES ÉMERAUDE'], ['ACTE 2', 'SAN FRANCISCO']];
function actChipAt(x, y) {
  for (let i = 0; i < 2; i++) { const r = chipRects[i]; if (r.w > 0 && x >= r.x - 4 && x <= r.x + r.w + 4 && y >= r.y - 6 && y <= r.y + r.h + 6) return i + 1; }
  return 0;
}
function drawActChips(y, a) {
  const gap = 12, h = 28, w = Math.min(216, (LW - 70 - gap) / 2), x0 = LW / 2 - w - gap / 2;
  c.save(); c.globalAlpha = a;
  for (let i = 0; i < 2; i++) {
    const x = x0 + i * (w + gap), sel = G.sel === i + 1, r = chipRects[i];
    r.x = x; r.y = y; r.w = w; r.h = h;
    c.fillStyle = sel ? GOLD : 'rgba(10,14,50,.62)'; rrect(c, x, y, w, h, 14); c.fill();
    c.lineWidth = sel ? 2.5 : 1.5; c.strokeStyle = sel ? WHITE : 'rgba(255,255,255,.35)'; c.stroke();
    const fs1 = 11, fs2 = 13.5;
    c.textBaseline = 'middle'; c.textAlign = 'left';
    c.font = `${fs1}px ${FONT}`; const w1 = c.measureText(CHIPS[i][0] + '  ').width;
    c.font = `${fs2}px ${FONT}`; let w2 = c.measureText(CHIPS[i][1]).width;
    const k = Math.min(1, (w - 18) / (w1 + w2)), tx = x + w / 2 - (w1 + w2) * k / 2;
    c.save(); c.translate(tx, y + h / 2 + 1); c.scale(k, k);
    c.font = `${fs1}px ${FONT}`; c.fillStyle = sel ? '#b0301c' : GOLD; c.fillText(CHIPS[i][0], 0, 0);
    c.font = `${fs2}px ${FONT}`; c.fillStyle = sel ? NAVY : WHITE; c.fillText(CHIPS[i][1], w1, 0);
    c.restore();
  }
  // arrows on the outside of the row (keyboard / pad: left, right)
  if (K.input.device !== 'touch') {
    const pulse = 1 + Math.sin(G.clock * 6) * 0.12;
    for (const sgn of [-1, 1]) {
      const ax = LW / 2 + sgn * (w + gap / 2 + 16), ay = y + h / 2, on = (sgn < 0) === (G.sel === 2);
      c.save(); c.translate(ax, ay); c.scale(sgn * (on ? pulse : 1), on ? pulse : 1);
      c.beginPath(); c.moveTo(-5, -7); c.lineTo(6, 0); c.lineTo(-5, 7); c.closePath();
      c.fillStyle = on ? GOLD : 'rgba(255,255,255,.3)'; c.fill(); c.lineWidth = 2; c.strokeStyle = NAVY; c.stroke();
      c.restore();
    }
  }
  c.restore();
  c.textBaseline = 'alphabetic';
}
function drawCard() {
  const t = G.st, L = G.cardLen, e = 0.37;
  const k = t < e ? easeOut(t / e) : t > L - e ? 1 - easeOut((t - (L - e)) / e) : 1;
  if (t < 0.25) { c.fillStyle = `rgba(0,0,0,${1 - t / 0.25})`; c.fillRect(0, 0, LW, LH); }
  const w = LW * 0.46 * k;
  c.fillStyle = NAVY; c.beginPath(); c.moveTo(0, 0); c.lineTo(w + 66, 0); c.lineTo(w - 14, LH); c.lineTo(0, LH); c.fill();
  c.fillStyle = GOLD; c.beginPath(); c.moveTo(w + 66, 0); c.lineTo(w + 76, 0); c.lineTo(w - 4, LH); c.lineTo(w - 14, LH); c.fill();
  const two = G.act === 2;
  c.fillStyle = two ? '#e8622c' : '#2bb24c'; c.fillRect(0, LH - 34, LW * k, 34);
  c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(0, LH - 34, LW * k, 3);
  const tx = LW * 0.5 + (1 - k) * LW * 0.8;
  txt(two ? 'SAN' : 'COLLINES', tx - 12, LH * 0.42, 45, WHITE, 'left', true, LW * 0.5 - 6);
  txt(two ? 'FRANCISCO' : 'ÉMERAUDE', tx + 6, LH * 0.58, 45, WHITE, 'left', true, LW * 0.5 - 22);
  const bx = LW * 0.8 + (1 - k) * LW * 0.6, by = LH * 0.75;
  c.fillStyle = two ? '#2f5bff' : '#d8322a'; c.beginPath(); c.arc(bx, by, 29, 0, TAU); c.fill();
  c.strokeStyle = NAVY; c.lineWidth = 4; c.stroke();
  txt('ACTE', bx, by - 8, 12, GOLD, 'center'); txt(two ? '2' : '1', bx, by + 19, 29, WHITE, 'center');
}
// first screen while the renderer starts and the Act 1 assets load (K.boot is async)
function drawBoot() {
  const g = c.createLinearGradient(0, 0, 0, LH);
  g.addColorStop(0, '#1b2a6b'); g.addColorStop(1, '#070a1d');
  c.fillStyle = g; c.fillRect(0, 0, LW, LH);
  txt('KIT RUSH 3D', LW / 2, LH * 0.42, 44, GOLD, 'center', true);
  const p = clamp(num(G.bootP, 0), 0, 1), bw = Math.min(260, LW - 60), bx = LW / 2 - bw / 2, by = LH * 0.58;
  c.fillStyle = 'rgba(255,255,255,.14)'; rrect(c, bx, by, bw, 10, 5); c.fill();
  if (p > 0) { c.fillStyle = GOLD; rrect(c, bx, by, Math.max(10, bw * p), 10, 5); c.fill(); }
  txt('Chargement…', LW / 2, LH * 0.7, 16, WHITE, 'center');
}
function drawLoading() {
  const g = c.createLinearGradient(0, 0, 0, LH);
  g.addColorStop(0, '#2a1c5a'); g.addColorStop(0.55, '#121845'); g.addColorStop(1, '#070a1d');
  c.fillStyle = g; c.fillRect(0, 0, LW, LH);
  c.fillStyle = '#e8622c'; c.fillRect(0, LH - 34, LW, 34);
  c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(0, LH - 34, LW, 3);
  txt('ACTE 2', LW / 2, LH * 0.33, 18, GOLD, 'center', true);
  txt('SAN FRANCISCO', LW / 2, LH * 0.47, 40, WHITE, 'center', true, LW - 40);
  // a spinning gold ring
  const cx = LW / 2, cy = LH * 0.64, a = G.clock * 5;
  c.save(); c.translate(cx, cy); c.scale(Math.cos(a) * 0.85 + 0.15 * Math.sign(Math.cos(a) || 1), 1);
  c.lineWidth = 6; c.strokeStyle = NAVY; c.beginPath(); c.ellipse(0, 0, 11, 13, 0, 0, TAU); c.stroke();
  c.lineWidth = 3.5; c.strokeStyle = GOLD; c.beginPath(); c.ellipse(0, 0, 11, 13, 0, 0, TAU); c.stroke();
  c.restore();
  txt('Chargement…', LW / 2, LH * 0.78, 16, WHITE, 'center');
}
const pauseRects = [];
for (let i = 0; i < PAUSE_ROWS; i++) pauseRects.push({ x: 0, y: 0, w: 0, h: 0 });
function pauseItemAt(x, y) {
  for (let i = 0; i < PAUSE_ROWS; i++) { const r = pauseRects[i]; if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i; }
  return -1;
}
function drawPause() {
  c.fillStyle = 'rgba(8,12,44,.6)'; c.fillRect(0, 0, LW, LH);
  txt('PAUSE', LW / 2, LH * 0.19, 44, GOLD, 'center', true);
  const Q = K.post, ok = postOn();
  const q = Q && QLABEL[Q.quality] ? QLABEL[Q.quality] : QLABEL.high;
  const items = ['Reprendre', 'Graphismes', 'Super Résolution', 'Retour au titre', 'Version classique'];
  const vals = [null, ok ? q : 'Simple', ok ? (Q.superRes ? 'Oui' : 'Non') : '—', null, null];
  const y0 = LH * 0.235, step = 30, h = 25;
  for (let i = 0; i < PAUSE_ROWS; i++) {
    const val = vals[i], w = val === null ? 200 : 262, x = LW / 2 - w / 2, y = y0 + i * step, sel = G.pauseSel === i;
    const r = pauseRects[i]; r.x = x; r.y = y; r.w = w; r.h = h;
    c.globalAlpha = val !== null && !ok ? 0.55 : 1;
    c.fillStyle = sel ? GOLD : 'rgba(18,24,69,.85)'; rrect(c, x, y, w, h, 14); c.fill();
    c.strokeStyle = sel ? WHITE : 'rgba(255,255,255,.35)'; c.lineWidth = 2; c.stroke();
    c.font = `16px ${FONT}`; c.textBaseline = 'middle';
    c.fillStyle = sel ? NAVY : WHITE;
    if (val === null) { c.textAlign = 'center'; c.fillText(items[i], LW / 2, y + h / 2 + 1); }
    else {
      c.textAlign = 'left'; c.fillText(items[i], x + 16, y + h / 2 + 1);
      c.textAlign = 'right'; c.fillStyle = sel ? '#b0301c' : GOLD; c.fillText(val, x + w - 30, y + h / 2 + 1);
      // the value cycles: a small arrow pair on its right
      c.fillStyle = sel ? NAVY : 'rgba(255,255,255,.55)';
      const ax = x + w - 17, ay = y + h / 2;
      c.beginPath(); c.moveTo(ax - 4, ay - 2); c.lineTo(ax, ay - 7); c.lineTo(ax + 4, ay - 2); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(ax - 4, ay + 2); c.lineTo(ax, ay + 7); c.lineTo(ax + 4, ay + 2); c.closePath(); c.fill();
    }
    c.globalAlpha = 1;
  }
  c.textBaseline = 'alphabetic';
  const dev = K.input.device;
  const yEnd = y0 + (PAUSE_ROWS - 1) * step + h;
  // which renderer runs (bottom-right corner, clear of the lives box and the help lines)
  const be = K.view.backend;
  txt('Rendu : ' + (be === 'webgpu' ? 'WebGPU' : be === 'webgl2' ? 'WebGL 2' : '—'), LW - 10, LH - 8, 12, '#9fe8ff', 'right');
  const hint = !ok && (G.pauseSel === 1 || G.pauseSel === 2) ? 'Effets graphiques indisponibles : rendu simple'
    : dev === 'touch' ? 'Touche un choix' : dev === 'pad' ? 'Start pour reprendre · ← → pour régler' : 'Entrée ou Échap pour reprendre · ← → pour régler';
  txt(hint, LW / 2, yEnd + 17, 13, WHITE, 'center', false, LW - 30);
  drawHelp(yEnd + 35);
}
function drawResults() {
  const t = G.st, R = G.res;
  if (!R) return;
  const a = easeOut((t - 0.17) / 0.5), b = easeOut((t - 0.5) / 0.5);
  const two = R.act === 2, n = two ? 5 : 4;
  rowY0 = two ? LH * 0.47 : LH * 0.52; rowDy = two ? 24 : 26;
  txt('KIT A TERMINÉ', LW / 2 - (1 - a) * LW, LH * (two ? 0.22 : 0.25), 37, WHITE, 'center', true);
  txt(two ? 'L’ACTE 2' : 'L’ACTE 1', LW / 2 + (1 - b) * LW, LH * (two ? 0.34 : 0.37), 29, GOLD, 'center', true);
  const pe = easeOut((t - 0.9) / 0.4);
  if (pe > 0) {
    c.globalAlpha = pe; c.fillStyle = 'rgba(10,14,50,.66)'; rrect(c, LW / 2 - 170, rowY0 - 24, 340, n * rowDy + 14, 14); c.fill(); c.globalAlpha = 1;
  }
  let i = 0;
  resultRow(t, i++, 'TEMPS', fmtT(G.time));
  if (two) resultRow(t, i++, 'FIGURES', fmtN(R.tricks));
  resultRow(t, i++, 'BONUS TEMPS', fmtN(R.tb));
  resultRow(t, i++, 'BONUS ANNEAUX', fmtN(R.rb));
  resultRow(t, i, 'SCORE', fmtN(G.score));
  if (R.done && G.newRecord) txt('Nouveau record de temps !', LW / 2, LH * 0.87, 17, GREEN, 'center', true);
  if (R.done && Math.floor(G.clock * 1.9) % 2 === 0) txt('Appuie pour continuer', LW / 2, LH * 0.95, 14, WHITE, 'center');
}
let rowY0 = 0, rowDy = 26;
function resultRow(t, i, label, v) {
  const e = easeOut((t - 1 - i * 0.2) / 0.4); if (e <= 0) return;
  const y = rowY0 + i * rowDy, x = (1 - e) * LW;
  txt(label, LW / 2 - 150 + x, y, 19, GOLD, 'left', true); txt(v, LW / 2 + 150 + x, y, 19, WHITE, 'right');
}
function drawEnd() {
  c.fillStyle = 'rgba(8,12,44,.68)'; c.fillRect(0, 0, LW, LH);
  const two = G.lastAct === 2, best = bestOf(G.lastAct);
  txt('MERCI D’AVOIR JOUÉ !', LW / 2, LH * 0.3, 37, GOLD, 'center', true, LW - 30);
  const tl = G.runActs > 1 ? 'Temps total' : 'Temps', tv = G.runActs > 1 ? G.runTime : G.time;
  txt(`${tl}  ${fmtT(tv)}     Score  ${fmtN(G.score)}`, LW / 2, LH * 0.46, 20, WHITE, 'center', false, LW - 30);
  if (best) txt(`Record${act2Ready() ? ' acte ' + G.lastAct : ''}  ${fmtT(best.time)}     Meilleur score  ${fmtN(best.score)}`, LW / 2, LH * 0.57, 15, '#9fe8ff', 'center', false, LW - 30);
  txt(G.loadErr ? 'L’acte 2 n’a pas pu se charger sur cet appareil.' : two ? 'Kit a dévalé San Francisco et survolé la baie jusqu’au pont !' : 'Dr Boulon a pris la fuite… les animaux des Collines sont libres.',
    LW / 2, LH * 0.69, 14, '#dfe4ff', 'center', false, LW - 30);
  if (Math.floor(G.clock * 1.9) % 2 === 0) txt('Appuie pour revenir au titre', LW / 2, LH * 0.86, 15, WHITE, 'center');
}
function drawOver() {
  c.fillStyle = `rgba(8,12,44,${Math.min(0.72, G.st).toFixed(3)})`; c.fillRect(0, 0, LW, LH);
  const k = easeOut(G.st / 0.66);
  txt('GAME', LW / 2 - 10 - (1 - k) * LW * 0.7, LH * 0.52, 58, GOLD, 'right', true);
  txt('OVER', LW / 2 + 10 + (1 - k) * LW * 0.7, LH * 0.52, 58, GOLD, 'left', true);
  if (G.st > 1.2 && Math.floor(G.clock * 1.9) % 2 === 0) txt('Appuie pour revenir au titre', LW / 2, LH * 0.7, 15, WHITE, 'center');
}
let fatal = '';
function drawFatal() {
  const g = c.createLinearGradient(0, 0, 0, LH);
  g.addColorStop(0, '#1b2a6b'); g.addColorStop(1, '#070a1d');
  c.fillStyle = g; c.fillRect(0, 0, LW, LH);
  txt('KIT RUSH 3D', LW / 2, LH * 0.38, 44, GOLD, 'center', true);
  txt(fatal, LW / 2, LH * 0.55, 16, WHITE, 'center', false, LW - 40);
  txt('Recharge la page ou essaie un autre navigateur.', LW / 2, LH * 0.66, 13, '#c9cff5', 'center', false, LW - 40);
}

function render() {
  const V = K.view;
  if (!fatal && V.ok && !V.lost && G.state !== 'loading' && G.state !== 'boot') {
    V.beginFrame();
    if (K.post && K.post.ok) K.post.render(); else V.renderer.render(V.scene, V.camera);
    V.endFrame();
  }
  c = V.hud; if (!c) return;
  const cv = c.canvas;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, cv.width, cv.height);
  U = Math.max(0.6, Math.min(V.H / 320, V.W / 480));
  LW = V.W / U; LH = V.H / U;
  c.setTransform(V.hudDpr * U, 0, 0, V.hudDpr * U, 0, 0);
  c.lineJoin = 'round'; c.lineCap = 'round'; c.globalAlpha = 1;
  if (fatal) drawFatal();
  else switch (G.state) {
    case 'title': drawTitle(); break;
    case 'loading': drawLoading(); break;
    case 'boot': drawBoot(); break;
    case 'card': case 'play':
      drawSpeedLines(); drawPopups(); drawReticle(); drawHUD();
      if (G.act === 2) { drawTricks(); drawHint(); }
      if (G.state === 'card') drawCard();
      else if (G.paused) drawPause();
      break;
    case 'results': drawPopups(); drawResults(); break;
    case 'end': drawEnd(); break;
    case 'over': drawHUD(); drawOver(); break;
  }
  c.globalAlpha = 1;
  c.setTransform(V.hudDpr, 0, 0, V.hudDpr, 0, 0);
}

// ================= tool buttons =================
let pauseIcon = null, fullIcon = null;
function focusGame() { try { $('hud').focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
function syncPauseBtn() {
  const p = G.state === 'play' && G.paused;
  if (p === pauseIcon) return;
  pauseIcon = p;
  const b = $('btnPause'); if (!b) return;
  $('ico-pause').style.display = p ? 'none' : ''; $('ico-play').style.display = p ? '' : 'none';
  b.setAttribute('aria-label', p ? 'Reprendre' : 'Pause');
}
function syncFullBtn() {
  const f = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (f === fullIcon) return;
  fullIcon = f;
  $('ico-full').style.display = f ? 'none' : ''; $('ico-exit').style.display = f ? '' : 'none';
  $('btnFull').setAttribute('aria-label', f ? 'Quitter le plein écran' : 'Plein écran');
}
function wireTools() {
  $('btnSound').addEventListener('click', () => { K.audio.init(); K.audio.toggleMute(); focusGame(); });
  $('btnPause').addEventListener('click', () => { K.audio.init(); if (G.state === 'play') setPaused(!G.paused); focusGame(); });
  const bF = $('btnFull');
  if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) bF.hidden = true;
  bF.addEventListener('click', async () => {
    K.audio.init();
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } else {
        const el = document.documentElement;
        if (el.requestFullscreen) await el.requestFullscreen(); else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch (_) { /* not allowed */ }
      }
    } catch (_) { /* fullscreen refused by the host */ }
    focusGame();
  });
  document.addEventListener('fullscreenchange', syncFullBtn);
  document.addEventListener('webkitfullscreenchange', syncFullBtn);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.state === 'play' && !G.paused) setPaused(true);
  });
  syncFullBtn(); syncPauseBtn();
}

// ================= render interpolation =================
// The simulation runs at a fixed 60 Hz. On a display whose refresh is not a multiple of that (75, 90, 144 Hz…) each
// rendered image shows the moment between the last two ticks (alpha = accumulator / step), so motion advances by the
// same amount every refresh instead of stuttering. Top-level scene objects (Kit, his shadow, enemies, platforms…)
// and the camera are snapshot before each tick; lights stay on their ticks (the shadow map follows Kit by steps).
const IP = { ms: 1000 / 60, on: false, list: [], prev: [], cur: [], used: [], count: -1, age: 0, lastDraw: -1e9, applied: false };
function ipRebuild() {
  const V = K.view, sc = V.scene, skip = new Set();
  for (const o of sc.children) if (o.isLight && o.target) skip.add(o.target);
  IP.list.length = 0;
  for (const o of sc.children) if (!o.isLight && !skip.has(o) && o.matrixAutoUpdate) IP.list.push(o);
  IP.list.push(V.camera);
  while (IP.prev.length < IP.list.length) {
    IP.prev.push({ p: new THREE.Vector3(), q: new THREE.Quaternion(), v: false });
    IP.cur.push({ p: new THREE.Vector3(), q: new THREE.Quaternion() });
    IP.used.push(false);
  }
  for (let i = 0; i < IP.list.length; i++) IP.prev[i].v = false; // nothing to blend from until the next snapshot
  IP.count = sc.children.length; IP.age = 0;
}
function ipSnap() {
  const V = K.view;
  if (!IP.on || !V.ok || !V.scene) return;
  if (IP.count !== V.scene.children.length || ++IP.age > 600) ipRebuild();
  for (let i = 0; i < IP.list.length; i++) {
    const o = IP.list[i], s = IP.prev[i];
    s.p.copy(o.position); s.q.copy(o.quaternion); s.v = o.visible;
  }
}
function ipApply(alpha) {
  IP.applied = false;
  if (!IP.on || !(alpha > 0 && alpha < 1) || IP.list.length === 0) return;
  for (let i = 0; i < IP.list.length; i++) {
    const o = IP.list[i], s = IP.prev[i];
    IP.used[i] = false;
    if (!s.v || !o.visible) continue;
    const d2 = s.p.distanceToSquared(o.position);
    if (d2 > 25 || (d2 < 1e-12 && Math.abs(s.q.dot(o.quaternion)) > 0.999999)) continue; // teleport or still
    const cu = IP.cur[i];
    cu.p.copy(o.position); cu.q.copy(o.quaternion);
    o.position.lerpVectors(s.p, cu.p, alpha);
    o.quaternion.copy(s.q).slerp(cu.q, alpha);
    IP.used[i] = true; IP.applied = true;
  }
}
function ipRestore() {
  if (!IP.applied) return;
  for (let i = 0; i < IP.list.length; i++) {
    if (!IP.used[i]) continue;
    const o = IP.list[i], cu = IP.cur[i];
    o.position.copy(cu.p); o.quaternion.copy(cu.q);
    IP.used[i] = false;
  }
  IP.applied = false;
}
// a refresh whose period is a multiple of the 60 Hz tick (60, 120, 30 Hz) needs no blending (and no added latency)
function ipTrackRate(ms) {
  if (!(ms > 3 && ms < 60)) return;
  IP.ms += (ms - IP.ms) * 0.08;
  const r = IP.ms * 0.06; // period in ticks
  const aligned = Math.abs(r - 1) < 0.05 || Math.abs(r - 0.5) < 0.03 || Math.abs(r - 2) < 0.08;
  if (aligned === IP.on) {
    IP.on = !aligned;
    for (let i = 0; i < IP.prev.length; i++) IP.prev[i].v = false;
    IP.count = -1;
  }
}

// ================= loop =================
let last = 0, acc = 0, rafId = 0, needDraw = true, errors = 0;
function report(e) { errors++; if (errors <= 5) console.error('Kit Rush 3D:', e); }
function frame(now) {
  rafId = requestAnimationFrame(frame);
  const t0 = performance.now();
  let dt = (now - last) / 1000; last = now;
  if (!(dt >= 0)) dt = 0;
  if (dt > 0.1) dt = 0.1;
  ipTrackRate(dt * 1000);
  if (Math.abs(dt - STEP) < 0.002) dt = STEP; // lock to 60 Hz displays without jitter
  acc += dt;
  let n = 0;
  if (!fatal) {
    while (acc >= STEP && n < 4) { ipSnap(); try { step(); } catch (e) { report(e); } acc -= STEP; n++; }
    if (n === 4) acc = 0;
  } else { acc = 0; n = 1; G.clock += dt; }
  // blended frames are drawn on every refresh up to about 110 Hz (every other one at 144 Hz and above), so the GPU
  // work stays bounded; otherwise a frame is drawn after each tick
  const draw = needDraw || (IP.on && !fatal ? now - IP.lastDraw >= 9 : n > 0);
  if (draw) {
    needDraw = false; IP.lastDraw = now;
    try { ipApply(acc / STEP); render(); } catch (e) { report(e); }
    ipRestore();
  }
  K.view.adapt(dt * 1000, performance.now() - t0);
}
function startLoop() {
  if (rafId) return;
  last = performance.now();
  rafId = requestAnimationFrame(frame);
}

// ================= boot =================
const API = {
  world: ['build', 'update', 'setFocus', 'terrainY', 'ground', 'collideWalls', 'loopPoint'],
  player: ['create', 'init', 'update', 'center', 'isAttacking', 'bounce', 'hurt', 'kill', 'launch', 'dash'],
  entities: ['build', 'reset', 'update', 'homingTarget', 'scatterRings', 'bossInfo'],
  camera: ['init', 'update', 'setMode', 'shake']
};
function ensureApi() {
  for (const mod in API) {
    const m = K[mod];
    if (!m || typeof m !== 'object') throw new Error('module K.' + mod + ' is missing');
    for (const fn of API[mod]) {
      if (typeof m[fn] !== 'function') {
        console.warn('Kit Rush 3D: K.' + mod + '.' + fn + '() is missing, using a stub');
        m[fn] = fn === 'ground' || fn === 'homingTarget' || fn === 'bossInfo' ? () => null : () => {};
      }
    }
  }
  const P = K.player;
  if (!P.pos) P.pos = new THREE.Vector3();
  if (!P.vel) P.vel = new THREE.Vector3();
  if (!P.forward) P.forward = new THREE.Vector3(0, 0, -1);
}
let booted = false;
// Boot: the HUD shows the loading screen at once while the renderer starts (async: WebGPU adapter/device or WebGL 2
// context), the Act 1 textures load, the island is built and its shaders compiled; then the title screen.
K.boot = function (data) {
  if (booted) return;
  booted = true;
  data = data && typeof data === 'object' ? data : {};
  const V = K.view;
  G.best = sanitizeBest(K.store.get('best', null));
  G.best2 = sanitizeBest(K.store.get('best2', null));
  G.sel = K.store.get('act', 1) === 2 ? 2 : 1;
  wireTools();
  V.onResize.push(() => { needDraw = true; });
  G.state = 'boot'; G.st = 0; G.bootP = 0; G.booted = false;
  V.fit();
  if (!V.hud) V.hud = $('hud').getContext('2d');
  startLoop();
  bootAsync(data).catch(e => {
    console.error(e);
    fatal = 'Le niveau n’a pas pu être construit.';
    V.showFatal(fatal);
  });
};
async function bootAsync(data) {
  const V = K.view;
  const ok = await V.init();
  if (!ok) { fatal = V.error || 'Le jeu n’a pas pu démarrer.'; V.showFatal(fatal); return; }
  G.bootP = 0.15;
  tmpV = new THREE.Vector3();
  for (let i = 0; i < 12; i++) pops.push({ on: false, pos: new THREE.Vector3(), txt: '', t: 0, col: WHITE });
  ensureApi();
  const T = K.tex;
  if (T && typeof T.init === 'function') { try { await T.init(); } catch (e) { console.warn('Kit Rush 3D: textures', e); } }
  if (T && typeof T.preloadGroup === 'function') {
    try { await T.preloadGroup('act1', p => { G.bootP = 0.15 + 0.6 * p; needDraw = true; }); } catch (e) { console.warn('Kit Rush 3D: textures', e); }
  }
  G.bootP = 0.75;
  try {
    K.world.build(V.scene);
    K.player.create(V.scene);
    K.entities.build(V.scene);
    K.camera.init();
    if (K.vfx && typeof K.vfx.init === 'function') { try { K.vfx.init(V.scene); } catch (e) { console.warn('Kit Rush 3D: effects disabled', e); } }
    if (!act2Ready()) G.sel = 1;
    if (data.playing) {
      G.score = Math.max(0, Math.floor(num(data.score, 0)));
      G.lives = clamp(Math.floor(num(data.lives, 3)), 0, 99);
      const cps = (K.level && K.level.checkpoints) || [];
      const ci = Math.floor(num(data.cpIndex, -1));
      G.cpIndex = ci >= 0 && ci < cps.length ? ci : -1;
      G.cpTime = G.cpIndex >= 0 ? Math.max(0, num(data.cpTime, 0)) : 0;
      G.bossDone = !!data.bossDone;
      if (data.act === 2 && act2Ready()) beginAct2(); else startAct(1.2);
    } else toTitle();
  } catch (e) {
    console.error(e);
    fatal = 'Le niveau n’a pas pu être construit.';
    V.showFatal(fatal);
    return;
  }
  G.bootP = 0.85;
  needDraw = true;
  await precompile();
  G.bootP = 1;
  G.booted = true;
  needDraw = true;
  const hot = window.claude && window.claude.hot;
  if (hot && typeof hot.snapshot === 'function') {
    hot.snapshot(() => ({
      score: G.score, lives: G.lives, cpIndex: G.act === 1 ? G.cpIndex : -1, cpTime: G.act === 1 ? G.cpTime : 0, bossDone: G.bossDone, act: G.act,
      playing: G.state === 'play' || G.state === 'card' || G.state === 'loading'
    }));
  }
  if (document.fonts && document.fonts.load) {
    document.fonts.load(`20px "Lilita One"`).then(() => { logo = null; helpWrap.key = ''; needDraw = true; }).catch(() => {});
  }
  focusGame();
}

const start = data => K.boot(data);
if (window.claude?.hot?.ready) window.claude.hot.ready(start);
else start(window.claude?.hot?.data ?? {});
})();
