# FOUNDATION status

## RESUME NOTES
- DONE (all 9 steps): legacy/ frozen (git show 9bcf15d:index.html / kit-rush-3d.html); lib/three = three 0.186.1
  (esbuild-minified builds, curated addons, swizzle patch, VENDOR.txt); build.sh (module + import map + checks);
  src ported to WebGPURenderer + TSL (PORT markers, see SPEC3 Foundation notes); K.view async init/stats/fatal,
  K.tsl, K.util.spinY; K.post RenderPipeline placeholder (scene + bloom + v2 grade) + K.gfx; K.tex (12-tex.js) +
  tools/tex/texlib.py + foundation_sample.py + make.sh; 26-vehicles.js (K.vehicles, K.cityLib); tests (serve.js,
  e2e.js v3/WebGPU suites, pending() builder targets, page-helpers pixels via 2D canvas); docs/SPEC3.md
  "Foundation notes"; .gitignore; package.json 3.0.0; root kit-rush-3d.html removed (v2 artifact lives in legacy/).
- VERIFIED: WebGL 2: desktop 30/30, v3 6/6 + 1 PEND (Moyen draw calls 243 > 220, Act 1), act2/post/regress/present/
  regress2/phone 40/40, fullrun 4/4. WebGPU (--webgpu) 6/6. index.html (no test hooks) boots to the title.
  Final full default run (WebGL 2): 80/80 checks + 1 PEND in 649 s (dev/foundation/e2e-all.log).
- Dev tools: dev/foundation/run.js (--eval/--file/--shot/--out/--webgpu/--phone/--q), probe.js, smoke.js,
  indexcheck.js, ringprobe.js, shaderdump*.js (renderer.debug.getShaderAsync).

## Requests for integrator
- README.md still describes v2 (r128, kit-rush-3d.html, "Construire" section): rewrite at the end (SPEC3 §1).
- vendor/ (three r128 + examples) is kept only so test/e2e.js can serve legacy/ (CDN blocked in the sandbox).
- Builders' textures: each role writes assets/tex/<role>/ + its manifest via tools/tex/texlib.Manifest; tools/tex/make.sh
  regenerates all.
