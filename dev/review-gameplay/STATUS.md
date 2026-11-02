# REVIEWER — GAMEPLAY, PLATFORM, PERFORMANCE — STATUS

## RESUME NOTES
- Started 2026-11-02 (HEAD 85a0d5e, tree clean). Role dir = dev/review-gameplay (all probes here; out/ = JSON results, logs/, shots/).
- Tools: mkbuild.sh (private build -> site/, identical to root index.html), h.js (harness lib: open({webgpu, phone, legacy, seed,
  raf:false, prefix, init, q}) ; seeded Math.random + __reseed), legacy-test.html (legacy/index.html + window.__K), v2src/ (v2 sources),
  v2-page-helpers.js (v2 test helpers, bots identical to v3's).
- DONE/VERIFIED:
  1. Static diff v2->v3 of gameplay code: 35-board.js identical; player physics, entities interactions, city physics/traffic, world
     queries unchanged; main loop changes = async boot, Act 2 loading wait (<=4 s), fixed-step slack (diff-*.txt).
  2. det.js: same scripted bots + seeded Math.random in v2 and v3 (WebGL 2): per-tick player pos/vel bit-identical (1e-5) over the
     whole Act 1 route + boss (8 hits) + capsule + results + Act 2 descent/tricks/orbit/flight/goal + results (out/det-v*-12345r.json,
     cmpdet.py). Only differences: ring pickups of scattered rings, caused by three.js uuid generation consuming Math.random
     (randBeforePlay v2 52088 vs v3 54375); with re-seed at play start all final scores/rings/times identical (52200 / 83650).
  3. layout.js: Act 1 rings/enemies/springs/dash/monitors/spikes/loops/cps/115 solids/terrain+ground grid and Act 2 rings/cps/
     ground grid/route/cars/bumper/goal identical v2 vs v3 (out/layout-diff.json).
- Observed: Act 2 loading under the tick pump hits the 4 s cap (238 ticks) -> check in real time (raf:false).
- NEXT: realkb.js (real keyboard/mouse/gamepad, webgl2 + webgpu), touch (CDP touch on phone), fallback/error screens, budgets
  sweep per preset, preset-switch leak 2+ min, sub-path incl. Act 2 entry, French text scan, persistence (v2 keys), allocations,
  real-RAF loading card timing.
