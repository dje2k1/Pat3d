# REVIEWER — GAMEPLAY, PLATFORM, PERFORMANCE — STATUS

## RESUME NOTES
- Session 1 (2026-11-02, HEAD 85a0d5e); session 2 resumed after the usage-limit reset (HEAD c16e730, src/lib/assets unchanged
  since 85a0d5e -> all session-1 results still valid). Role dir = dev/review-gameplay (out/ JSON, logs/, shots/).
- Tools: mkbuild.sh (private build -> site/, identical to root index.html), h.js (harness lib: open({webgpu, phone, legacy, seed,
  raf:false, prefix, init, q, routes}); seeded Math.random + __reseed), legacy-test.html (legacy/index.html + window.__K),
  v2src/ (v2 sources), v2-page-helpers.js (v2 test helpers; bots identical to v3's).
- DONE / VERIFIED:
  1. Static diff v2->v3 of gameplay code (diff-*.txt): 35-board.js identical; player physics, entity interactions, city
     physics/traffic, world queries unchanged; main loop changes = async boot, Act 2 loading wait (<= 4 s), fixed-step slack.
  2. det.js: same bots + seeded Math.random in v2 and v3 (WebGL 2): per-tick player pos/vel bit-identical over Act 1 route +
     boss + capsule + results + Act 2 descent/tricks/orbit/flight/goal + results (out/det-v*-12345r.json, cmpdet.py). Only
     scattered-ring pickups differ (three.js uuid generation consumes Math.random: 52088 vs 54375 calls before play); with a
     re-seed at play start final scores/rings/times identical (Act 1 52200, Act 2 83650, records saved).
  3. layout.js: every Act 1 / Act 2 placement, solid, terrain/ground sample, route, car identical (out/layout-diff.json).
  4. realkb.js (trusted CDP keyboard/mouse + emulated Gamepad API): start, run, jump, air dash/homing, roll, spin dash (32.1),
     Q/mouse orbit, Esc pause + arrows preset change persisted, Enter resume, pause button + Space (focus back on #hud), M mute,
     pad stick/A/B/Start/right stick, loop 1, spring: all OK and IDENTICAL on WebGL 2 and WebGPU (out/realkb-*.json).
  5. touch.js (phone 844x390 dpr3, CDP touch, multi-touch): tap start, joystick, SAUT while holding stick, homing, ROULER roll,
     spin dash 32.1, camera drag, pause button + rows (Graphismes/Super Résolution/Reprendre), act chips -> Act 2, carve,
     tuck, ollie, trick: OK, identical WebGL 2 / WebGPU / v2 (except pause rows 30.4 px vs v2 34 px, 5 rows).
     FINDING (pre-existing, v2 same): pause tool button ignores a tap while another finger holds the joystick (no click for a
     non-primary touch) and right after a swipe (fling cancel) -> pausetap2.js.
  6. fallback.js / gpucrash.js: no navigator.gpu / null adapter / requestDevice failure -> WebGL 2, boots, no errors; no WebGPU
     and no WebGL 2 -> French overlay + legacy/ link (desktop + phone, shots/fb-none*.png); three module 404 -> overlay;
     WebGL context loss and real GPU process crash (CDP Browser.crashGpuProcess) -> overlay "Recharge la page" on both
     backends; WebGPU crash also throws 5+ uncaught "Instance dropped in popErrorScope" pageerrors (check count/minor);
     device.destroy() is ignored by three (not a real loss); all /assets/ 404 -> boots and plays (K.tex failed=0 since
     manifests 404 too); Google Fonts aborted -> boots.
  7. budget.js (desktop 640x360, WebGL 2, seeded bots, a frame every 100-150 ticks over both whole acts incl. boss/orbit/flight,
     84 views per preset, out/budget-desk.json): scene calls/tris max Ultra A1 164/2.08 M, A2 203/1.38 M; Élevé 143/1.45 M, 199/1.09 M;
     Moyen 109/616 k, 160/683 k; Économie 102/467 k, 157/635 k -> all within SPEC3 (350/2.5 M Ultra, 220/800 k Moyen). No errors.
  8. french.js: every HUD string (fillText capture) through both acts/all screens, kb/pad/touch: v3-only strings = 'Version
     classique', 'Rendu : WebGL 2', boot 'KIT RUSH 3D', overlay texts: all correct French; nothing removed vs v2.
  9. persist.js: v2 records/settings read by v3 and v3's read by legacy v2 (same keys), corrupt values and throwing localStorage
     survived, no errors (out/persist.json).
- NEXT (old list): budgets sweep per preset (route bot views, both acts, phone Moyen), preset-switch leak 2+ min (GL + shorter GPU),
  sub-path incl. Act 2 entry + pause "Version classique", French text scan (fillText capture v2 vs v3), persistence (v2 keys),
  allocations per frame (v2 vs v3), real-time Act 2 loading card (raf:false + Fast 3G throttling), report.json.
