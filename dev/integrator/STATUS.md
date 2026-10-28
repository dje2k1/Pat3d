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
- NEXT: run2 result; WebGPU suite; shots: presets (q=..), phone Moyen (--phone --hud), WebGPU pair, docs (--hud);
  docs/screenshots JPEGs (dev/integrator/docshots.py name=src.png ...); README numbers; report.json.
- Looked: no cyan cast found into the low sun (waterfront/west/pier, Élevé + Ultra): warm glare; close headlights at
  Ultra: no blue ghost (u2-*.png). Kit blink in screenshots was my harness (invT) -> fixed in shoot.js.
