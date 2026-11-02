# INTEGRATOR STATUS (role dir dev/integrator, owns every file; no git commit/push)

## RESUME NOTES
- Started 2026-10-27 22:00. Read: prompt-integrate.md, SPEC3 (+Foundation notes), SPEC/SPEC2, all 7 reports and
  every STATUS "Requests for integrator".
- Baseline: HEAD 737cf21, ./build.sh OK (index.html 1109757 B). Baseline WebGL 2 e2e (killed by usage limit after
  regress): 63/63 PASS (desktop, v3 incl. Moyen target met, act2, post, fullrun, regress) -> dev/integrator/logs/base-gl.log.
- Session 2 (2026-10-28): lead committed f3c1fa9 (has my 12-tex/90-main edits).
- Tools: dev/integrator/mkbuild.sh (private build of the working tree -> dev/integrator/site/test.html),
  run.js (probe: --eval/--file/--shot/--init/--warn/--page), shoot.js (screenshot harness, views of both acts,
  --preset --sr --phone --webgpu --hud --out --prefix --json).

## PLAN / CHECKLIST (x = done + verified)
- [~] K.tex: dispose GPU texture when the image size changes (DONE in src, verify). Bug confirmed: Moyen boot ->
      Élevé gives GL_INVALID_VALUE (1281); Élevé -> Moyen silently writes the half image into one quadrant.
      Preload 'common' with 'act1' (DONE in src; no 'common' entries exist today)
- [~] 90-main: K.post.compileAsync() after precompile (DONE, verify boot time); results DOF on (DONE, look at shot);
      Act 2 loading card progress bar (DONE, look at shot); upscaler pause row: skipped (auto = FSR1 is best)
- [ ] build.sh specs(): skip comment lines -> FSR1Node static import possible [post]
- [ ] post: cyan glare looking into the low sun; bright close car lamps / blue lens ghost on Ultra
- [ ] sun/shadow consistency between acts (city 'cheap' = 1024 like the island?)
- [ ] e2e: pending Moyen -> check(); lawn-seam re-target (robust to noise); post passes per preset; vehicles check;
      game-over check independent of the boss block; screenshot motion-blur artefact (frames after skipped ticks)
- [ ] SPEC3 Foundation notes: post API, world (layer 5, K.world.sun), city KIND 22-24, vehicles, entities
- [ ] Full WebGL 2 e2e green; WebGPU suite green
- [ ] Budgets per preset with numbers (calls, tris, texture MB, assets MB, Act 1 / Act 2 download)
- [ ] Fresh screenshots in shots/ (title, A1 start/loop/lake/boss/results, A2 hill/traffic/works/pier/orbit/flight/
      goal, Kit close-ups, vehicle line-up, each preset, phone Moyen A1+A2, WebGPU vs WebGL 2 pair); Read + fix
- [ ] 8 JPEGs in docs/screenshots/ (same names); README.md (French, v3); sub-path /Pat3d/ check
- [ ] report.json

## LOG
- S2: K.tex resize fix VERIFIED (Moyen boot -> Élevé -> Moyen -> Élevé: no GL error, memory stable).
- S2: post: motion blur scaled by the gap since the last *drawn* frame (S.drawClk; fixes the e2e screenshot blur
  artefact: tests tick without drawing, the velocity buffer then holds several ticks of motion).
- S2: city rail kind rougher (0.45*map + 0.24): the cable-car rails read less like neon-blue lines in the shade.
- S2: e2e edits: game-over block goes to the title itself; Moyen budget = check(); seam check averages 4 frames and
  accepts a centre step < 4.5 or <= p75(other columns)+1; post graph check per preset/SR; post memory-cycle check;
  Act 2 vehicles check (v2 VT + vehicleTop compared, LOD pools, 224 parked).
- S2: FOUND + FIXED: K.post.compileAsync (PassNode.compileAsync) left the pass's render target + MRT set on the
  renderer while awaiting -> frames drawn meanwhile (game running behind the Act 2 card) went into the pass target,
  canvas stale for the rest of the session (GL 'Feedback loop formed'). Now: set RT/MRT, start renderer.compileAsync
  (pipelines are built synchronously for the target set at call time), restore at once, then await. Verified
  (r2-grid.png: results -> Act 2 hill / orbit render).
- S2: FSR1Node now a static import (build.sh specs() skips comment lines); city Économie shadows = 1024 map, box 36 m.
- S2: SPEC3 Foundation notes rewritten for the final APIs (post, world, city, vehicles, entities, tests). README v3 draft.
- S2: run 1 of the full WebGL 2 e2e (before the compileAsync fix): 84/84 PASS in 2448 s (logs/run1-gl.log).
  Seam Ultra centre 3.5 (p75 4.9), Élevé 1.8, Économie 2.0. Budgets act1 U155/1.81M H135/1.39M M99/677k L94/483k;
  act2 U174/818k H167/844k M138/576k L138/529k. Memory cycle: prog 646 -> 668 -> 668 (stable after cycle 1).
- S2: e2e: Act 1 results -> Act 2 check now also compares a canvas fingerprint (catches a stale canvas).
- S2: run 2 (all fixes) started -> logs/run2-gl.log; final Élevé screenshot set -> shots/v3-*.png (logs/final-high.log)
- S2: e2e + serve.js: new v3 check "site works from a sub-path /Pat3d/" (serve(root, port, prefix)); NOT yet run.
- S2: final shots in shots/v3-*.png (Élevé set, presets set incl. Moyen+SR / Ultra+SR, kit, vehicles), read: OK.
  Budgets from the shots (scene pass incl. shadows): Ultra max 194 calls / 1.79 M tris; Élevé max 196 / 1.37 M;
  Moyen max 149 / 0.72 M; Économie 146 / 0.64 M. K.tex GPU estimate: 133.7 MB full (both acts), 33.4 MB half.
  Download (dev/integrator/sizes.py): code 2.38 MB raw / 0.70 MB gzip; Act 1 textures 4.25 MB full / 1.42 half;
  Act 2 2.99 / 0.92; Act 1 total desktop ~4.96 MB, phone ~2.13 MB; assets/ 9.66 MB.
- S2: run 2: 83/84 (logs/run2-gl.log); the one FAIL = 'drawn motion is even ... 120 Hz' (perSec 59, CV 0.05):
  float rounding of the 120 Hz accumulator (2 x 8.333 ms lands 1e-12 below the step -> a tick slips one refresh,
  depends on the start time: flaky, passed in baseline + run1). FIX in 90-main frame(): `acc >= STEP - 1e-6`.
- S2: phone shots shots/v3-phone-*.png (Moyen + SR, HUD + touch UI) read: OK (Act 2 hint shows keyboard text
  because my harness drives with key events; real touch shows the touch text).
- S3 (2026-11-02, resumed, tree = fdecc07): SPEC3 notes ARE done (S2). Remaining: run 3 full WebGL 2 e2e (loop fix
  + sub-path check), WebGPU suite, WebGPU pair shots, docs shots (--hud) -> docs/screenshots, README numbers, report.
- S3: docs/screenshots/*.jpg replaced (same 8 names) from dev/integrator/shots/doc-*.png (HUD on, Élevé):
  titre=title, acte1-depart=a1run, acte1-looping=a1loop, acte1-boss=a1boss, acte2-rue=a2street,
  acte2-chantier=a2traffic (works island), acte2-bumper-orbite=a2orbit, acte2-vol=a2flight2. Read: OK.
- S3: run 3 full WebGL 2 e2e running -> logs/run3-gl.log (build BEFORE the fix below: informative only)
- S3: WebGPU suite FAILED 5/6 (console errors 'Async render pipeline creation failed'): my K.post.compileAsync calls.
  Root cause (r186): renderer.compileAsync builds pipelines for the render context of call depth 0, the scene pass
  renders at depth 1 (another context, no depth format on WebGPU); NodeMaterial reads renderer.getMRT() at async build
  time; PassNode.compileAsync keeps the target bound across awaits (froze the canvas). DECISION: K.post.compileAsync is
  a stub resolving false (documented), 90-main precompile = renderer.compileAsync only (foundation behaviour) + ONE
  warm-up frame through K.post at boot behind the loading screen. SPEC3 note corrected. Private WebGPU rerun ->
  logs/p-gpu3.log (private e2e: dev/integrator/e2e-private.js -> dev/integrator/site/test.html): 6/6 PASS, no errors.
- S3: run 3 killed (old build). Root rebuilt (index.html 1112111 B) = FINAL src; run 4 full WebGL 2 -> logs/run4-gl.log.
- S3: WebGPU pair shots shots/v3-gpu-{a1start,a2street,kit34}.png vs shots/v3-{...}.png, grid
  shots/v3-pair-webgl2-vs-webgpu.png: same look on both backends.
- S3: root WebGPU suite on the final build: 6/6 PASS, no console errors, 200 s (logs/run4-gpu.log).
- S3: run4 GL in progress; sub-path check PASS. Report generator: python3 dev/integrator/mkreport.py (reads run4 logs).
- S3: run4 GL: 84/85 in 1907 s; FAIL = interpolation at 90 Hz (CV 1.2): my 1 µs slack made a tick happen at acc =
  STEP - eps while blending (IP on) -> negative blend factor -> one-tick jump. FIX: slack only when IP is off
  (`const slack = IP.on ? 0 : 1e-6`, acc clamped >= 0). --only=present 3/3 twice (logs/present-1/2.log).
  All other run4 checks are unaffected (the tests' tick pumping runs with IP off, same as run4).
- S3: run5 = final full WebGL 2 run on this build -> logs/run5-gl.log; probe of interpolation with 7 start offsets
  (dev/integrator/probe-interp.js) running.
- S3: final WebGPU on this build: 6/6 in 311 s (logs/run5-gpu.log). Interpolation probe with 3 start offsets: CV 0 at
  90/120/144 Hz (logs/probe-interp.log). run5 GL killed by the usage limit at 67 PASS / 0 FAIL.
- S4 (resumed, tree 0cb0d36): run6 = final full WebGL 2 run -> logs/run6-gl.log; README numbers filled (85 checks,
  ~35 min, WebGPU 6). mkreport.py reads run6-gl + run5-gpu.
- S4: run6 FINAL full WebGL 2: 85/85 in 1808 s (logs/run6-gl.log). README time -> ~30 min. report.json written by
  dev/integrator/mkreport.py. INTEGRATION DONE (all checklist items).
- (old) NEXT: run4 result -> README numbers (__CHECKS__, __MINUTES__) -> mkreport.py -> final message with the JSON.
- NEXT (old): run2 result; WebGPU suite; shots: presets (q=..), phone Moyen (--phone --hud), WebGPU pair, docs (--hud);
  docs/screenshots JPEGs (dev/integrator/docshots.py name=src.png ...); README numbers; report.json.
- Looked: no cyan cast found into the low sun (waterfront/west/pier, Élevé + Ultra): warm glare; close headlights at
  Ultra: no blue ghost (u2-*.png). Kit blink in screenshots was my harness (invT) -> fixed in shoot.js.
