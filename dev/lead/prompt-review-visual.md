You are working on "Kit Rush 3D", a free-roaming 3D platformer (original characters: Kit the fox, Dr Boulon) for a French user who plays on PC and phone. It is published on GitHub Pages from the git repo /home/user/pat3d (GitHub dje2k1/Pat3d, branch main). We are building v3: a port from three.js r128 to three.js r186 WebGPURenderer (WebGPU, with the renderer's own WebGL 2 backend as fallback) with TSL node materials, an "Unreal-like" post stack, generated PBR textures and much better looking Kit, scenery and vehicles. Gameplay must not change.
MANDATORY first reads: /home/user/pat3d/docs/SPEC3.md (v3 contract, read fully; the "Foundation notes" section at its end, once it exists, holds the concrete APIs and conventions), then the parts of /home/user/pat3d/docs/SPEC.md and /home/user/pat3d/docs/SPEC2.md relevant to your role (gameplay contracts, module APIs, tests). The v2 source of any file is available with `git -C /home/user/pat3d show 9bcf15d:src/<file>` (v2 = three r128, the live version before v3); v2 screenshots for comparison: /tmp/claude-0/-home-user/608f9dd0-d109-57d1-b4c1-e900c9677b3d/scratchpad/kit3d/shots/*.png.
Environment: Node 22, Playwright 1.56.1 with Chromium (PLAYWRIGHT_BROWSERS_PATH is set; never run "playwright install"), Python 3 with numpy and Pillow (WebP ok, no scipy), npm registry reachable; CDNs and asset sites are blocked, so everything is vendored or generated. 4 CPUs shared with one other agent that may be running browser tests at the same time: local HTTP servers must listen on port 0 (or a free port), keep browser runs lean, close browsers.
Rules: do NOT git commit, push, reset, checkout, stash or clean (the lead commits). Only edit the files your role owns (listed below); if you need a change elsewhere, write it under "Requests for integrator" in your STATUS.md and work around it meanwhile. Usage limits can kill you at any time: keep /home/user/pat3d/dev/<your-role>/STATUS.md updated after every milestone with RESUME NOTES (done / verified / next). If that file already exists when you start, you are resuming: read it and continue, don't redo verified work. Put probes, harness scripts and scratch screenshots in /home/user/pat3d/dev/<your-role>/ (gitignored).
Quality bar: screenshots you take must look clearly and obviously better than v2 (closer to a modern AAA game) while staying within SPEC3 budgets on every preset, on phone (landscape, touch) as well as desktop. Read your own screenshots (Read the PNG files) and iterate on what looks wrong. Report honestly: what you verified, how, and what is left.
ROLE DETAILS: ROLE: REVIEWER — VISUAL QUALITY (role dir dev/review-visual). Read-only on src/, lib/, assets/ (write only in your role dir). Adversarial art review against SPEC3 §3 and §5 and against the v2 screenshots: is v3 clearly better looking everywhere (Kit, Act 1, Act 2, vehicles, entities, VFX, HUD readability)? Hunt artefacts on both backends and every preset: TAA/TAAU ghosting or smearing in motion, shimmering fur or grass, shadow acne/peter-panning/cascade seams, SSR/SSGI noise or leaks, z-fighting, texture seams or obvious tiling, wrong colour space (washed out or too dark), blown highlights, bloom halos, LOD popping, fake-interior or glass errors, phone readability at Moyen. Take your own screenshots and crops (in your role dir) with numbers where possible (luma, edge sharpness, frame-to-frame differences). Each finding needs evidence (screenshot paths + what to look at); no speculation.

Context: the integration is finished and committed (HEAD 85a0d5e on branch claude/keen-maxwell-z7ef39): ./build.sh clean, full WebGL 2 e2e 85/85 (about 30 min on this sandbox: do NOT re-run the whole suite, run only the --only=<suite> parts you need, or your own lean probes), WebGPU suite 6/6. Its full report is dev/integrator/report.json (copied below) and dev/integrator/STATUS.md; its screenshots are in shots/ (v3-*.png, doc-*.png, phone, presets, WebGPU pair) and you may Read them, but take your own evidence for findings. Its tools (dev/integrator/mkbuild.sh, run.js, shoot.js) can be copied into your role dir and adapted.
The issues the integrator already lists under remaining_issues are known: report one only if you can show it matters more than stated (with evidence), and say so.
The other reviewer runs at the same time (gameplay/platform reviewer, dev/review-gameplay); keep browser runs lean.
Severity: blocker = must fix before publishing (crash, broken progression, broken backend, regression of a v2 gameplay contract, ugly enough that v2 looks better); major = clearly visible or measurable problem a player would notice; minor = polish.
Integration report (dev/integrator/report.json):
{
 "summary": "Integration of Kit Rush 3D v3 is done; nothing is committed (the lead commits). The final tree builds cleanly and both e2e suites pass: WebGL 2 85/85 checks in 1808 s (the 74 v2 checks with the same meaning plus the v3 checks, incl. new ones I added) and WebGPU 6/6. Every builder request was resolved or answered: the K.tex texture-resize bug (a real bug on every runtime preset change: GL_INVALID_VALUE or a half texture written into one quadrant) is fixed; motion blur no longer smears frames drawn after skipped ticks (the e2e screenshot artefact); a canvas freeze after the Act 2 load caused by precompiling the post MRT pass was found and removed (r186 cannot precompile the scene pass: K.post.compileAsync is now a documented stub, boot draws one warm-up frame behind the loading screen); the Act 2 loading card shows a progress bar; the results screen has its depth of field; FSR1 is a static import (build.sh now skips comment lines); Économie uses a cheap 1024 shadow map in both acts; a 120 Hz timing flake in the fixed-step loop is fixed; the cable-car rails read less neon. Tests: the Moyen budget is a real check, the lawn-seam check is noise-robust, and new checks cover the post graph per preset, preset x Super Résolution memory, Act 2 vehicles (v2 VT / vehicleTop compared), a stale-canvas fingerprint after the Act 2 load and sub-path hosting (/Pat3d/). Budgets are well within SPEC3 on every preset (numbers in tests). README is rewritten in French for v3, the 8 docs/screenshots JPEGs are replaced (same names), SPEC3 Foundation notes describe the final APIs, and a fresh screenshot set is in shots/.",
 "tests": [
  {
   "name": "./build.sh",
   "pass": true,
   "notes": "built index.html (1112313 bytes, 20 vendored module files) and test.html (1112351 bytes) — no GLSL, every import vendored (FSR1Node now static), only Google Fonts external"
  },
  {
   "name": "e2e WebGL 2, full default run (node test/e2e.js, final build)",
   "pass": true,
   "notes": "85/85 checks in 1808 s (dev/integrator/logs/run6-gl.log). Earlier runs: run1 84/84; run2 83/84 and run4 84/85 (render-interpolation check at 120 Hz then 90 Hz: float rounding of the fixed-step accumulator, fixed in 90-main; --only=present 3/3 twice after the fix; probe at 90/120/144 Hz with 3 start offsets: CV 0)."
  },
  {
   "name": "e2e WebGPU (node test/e2e.js --webgpu, final build)",
   "pass": true,
   "notes": "6/6 in 311 s, no console errors (dev/integrator/logs/run5-gpu.log). An intermediate build failed 5/6 (pipeline errors from precompiling the post MRT pass) -> removed."
  },
  {
   "name": "Performance budgets per preset (e2e v3 spots, scene pass incl. shadow maps)",
   "pass": true,
   "notes": "Act 1: ultra 156 calls / 1.81 M tris, high 135 calls / 1.39 M tris, medium 99 calls / 0.68 M tris, low 94 calls / 0.48 M tris. Act 2: ultra 174 calls / 0.82 M tris, high 167 calls / 0.84 M tris, medium 138 calls / 0.58 M tris, low 137 calls / 0.53 M tris. Worst views in the screenshot set: Ultra 194 calls / 1.79 M tris, Élevé 196 / 1.37 M, Moyen 149 / 0.72 M (phone Moyen 151 / 0.66 M), Économie 146 / 0.64 M. Limits: 350 / 2.5 M Ultra, 220 / 800 k Moyen."
  },
  {
   "name": "Texture and asset budgets",
   "pass": true,
   "notes": "K.tex GPU estimate (mips incl.) both acts loaded: 133.7 MB full set (Ultra/Élevé, limit 220), 33.4 MB half set (Moyen/Économie, limit 90). assets/ 9.66 MB on disk (limit 40). Act 1 download: code 2.38 MB raw / 0.7 MB gzip + textures 4.25 MB full (1.42 MB half) = about 4.96 MB desktop / 2.13 MB phone (limit 15). Act 2 extra: 2.99 MB full / 0.92 MB half (limit 15)."
  },
  {
   "name": "Sub-path hosting (/Pat3d/)",
   "pass": true,
   "notes": "{\"st\":{\"state\":\"title\",\"loaded\":35,\"failed\":0,\"legacy\":200,\"href\":\"legacy/\"},\"bad\":[],\"errors\":[]}"
  },
  {
   "name": "Preset switching memory (Ultra/Élevé/Moyen/Économie x Super Résolution, 3 cycles)",
   "pass": true,
   "notes": "{\"memc\":{\"cyc\":[{\"geo\":116,\"tex\":161,\"prog\":594},{\"geo\":116,\"tex\":161,\"prog\":616},{\"geo\":116,\"tex\":161,\"prog\":616}],\"builds\":8,\"tex\":\"full\"},\"errors\":[]}"
  },
  {
   "name": "K.tex resize fix (Moyen boot -> Élevé -> Moyen -> Élevé)",
   "pass": true,
   "notes": "before: GL_INVALID_VALUE (1281) on Moyen -> Élevé, Élevé -> Moyen wrote the half image into one quadrant; after: no GL error, renderer.info.memory stable"
  },
  {
   "name": "Visual review (screenshots read)",
   "pass": true,
   "notes": "Élevé set of both acts, Kit close-ups, vehicle line-ups, each preset (+ Moyen and Ultra with Super Résolution), phone Moyen (844x390, dpr 3, touch UI), WebGPU vs WebGL 2 pair: same look on both backends; v3 clearly richer than the v2 screenshots it replaces."
  }
 ],
 "screenshots": [
  "shots/v3-title.png",
  "shots/v3-a1start.png",
  "shots/v3-a1loop.png",
  "shots/v3-a1lakeside.png",
  "shots/v3-a1boss.png",
  "shots/v3-a1results.png",
  "shots/v3-a2hill.png",
  "shots/v3-a2street.png",
  "shots/v3-a2traffic.png",
  "shots/v3-a2works.png",
  "shots/v3-a2pier.png",
  "shots/v3-a2orbit.png",
  "shots/v3-a2flight.png",
  "shots/v3-a2goal.png",
  "shots/v3-kitface.png",
  "shots/v3-kit34.png",
  "shots/v3-kitback.png",
  "shots/v3-kitspinclose.png",
  "shots/v3-kitskate.png",
  "shots/v3-kitflight.png",
  "shots/v3-vehcars.png",
  "shots/v3-vehvans.png",
  "shots/v3-vehbig.png",
  "shots/v3-vehclose.png",
  "shots/v3-a1valley-{ultra,high,medium,low,medium-sr,ultra-sr}.png",
  "shots/v3-a2street-{ultra,high,medium,low,medium-sr}.png",
  "shots/v3-phone-{title,a1run,a1loop,a2street,a2works,a2orbit}.png",
  "shots/v3-gpu-{a1start,a2street,kit34}.png",
  "shots/v3-pair-webgl2-vs-webgpu.png",
  "shots/doc-*.png (HUD)",
  "docs/screenshots/{titre,acte1-depart,acte1-looping,acte1-boss,acte2-rue,acte2-chantier,acte2-bumper-orbite,acte2-vol}.jpg",
  "shots/01..37-*.png and shots/gpu-0*.png (written by the e2e runs)"
 ],
 "fixed": [
  "K.tex: a texture whose image size changes (1x1 fallback -> WebP after a first draw, full <-> half on a preset change) is disposed first so the GPU storage is re-created (was GL_INVALID_VALUE or a quarter-texture corruption on every runtime preset change between Élevé/Ultra and Moyen/Économie) [kit request]",
  "Boot preloads the 'act1' and 'common' texture groups with the progress bar [kit request]; the Act 2 'Chargement…' card has its own progress bar (textures + shaders)",
  "Post: motion blur is scaled by the time since the last frame really drawn (e2e screenshots taken after skipped ticks were smeared: the city/post artefact)",
  "Post: precompiling the scene pass MRT variants (post request) froze the canvas after the Act 2 load and broke WebGPU pipelines in r186 (compile at render-call depth 0 vs pass at depth 1; target kept bound across awaits): K.post.compileAsync is a documented stub, boot draws one warm-up frame behind the loading screen",
  "Results screen uses the cinematic depth of field on Kit (SPEC3 §3) [post request]",
  "FSR1Node is a static import; build.sh import scanner skips comment lines [post request]",
  "Économie in Act 2: cheap 1024 shadow map over a 36 m box like the island (sun/shadow consistency between acts)",
  "90-main fixed-step loop: 1 µs slack when frames are not blended (120 Hz class refresh rates), exact remainder when they are (it is the blend factor): the e2e render-interpolation check was flaky at 120 Hz",
  "City: cable-car rails rougher so they no longer read as neon-blue lines in the shade",
  "e2e: game-over check independent of the boss block [kit request]; pending Moyen budget -> check() [world/city/entities]; lawn-seam check re-targeted (4-frame average, centre < 4.5 or within the frame upper quartile); new checks: post graph per preset (passes, <= 4 scene outputs, Super Résolution scale + FSR1), preset x SR memory cycle [post request], Act 2 vehicles (v2 VT / vehicleTop, LOD pools, 224 parked) [vehicles request], canvas fingerprint after the Act 2 load, sub-path hosting /Pat3d/ (test/serve.js gained a prefix option)",
  "docs/SPEC3.md Foundation notes rewritten for the final APIs (K.post SSR opt-in / sceneDepth / no fragmentNode / FSR1 default, K.world layer 5 + active sun, K.city KIND 22-24, K.vehicles pools + own material, K.entities pools + LOD, K.tex resize, tests) [post/world/city/vehicles/entities requests]",
  "README.md rewritten in French for v3; docs/screenshots (8 JPEGs, same names) replaced with v3 shots"
 ],
 "remaining_issues": [
  "The bumper flight heads into the low sun: the frame is hazy (fog banks + sun glitter on the water) and Kit reads small and low-contrast at the horizon in the first seconds (no cyan cast found; analytic glare/shafts measured at only ~2 % of the brightness; camera framing left unchanged).",
  "No precompile of the post MRT variants (r186 limitation): the first frames after entering Act 2 compile the city materials lazily (a short hitch behind/after the card on slow devices); boot hides it with the warm-up frame.",
  "Kit's body mesh density is chosen from the preset at load; a later preset change updates the fur layers only (takes effect on reload).",
  "All timings are SwiftShader (CPU) numbers; no real GPU or real phone was measured. The full WebGL 2 e2e run takes about 30 min on this sandbox (1808 s).",
  "Graphs of presets not in use keep ~60 MB of GPU render targets after every preset x SR combination was visited (stable, no leak; post known issue).",
  "Small known art limits left as reported by the builders: checker cliffs keep their triangular patches on slanted faces (identity), far city background is boxes with lit windows, ring-pickup flash briefly covers Kit, entity far-LOD shadows pop in at 30 m (18 m on Moyen), a vehicle/entity changing LOD slot can get one frame of wrong motion vectors.",
  "docs/v3-wip/README.md says the integration is done; the review/fix steps of the workflow have not run yet."
 ]
}
Report: write your final report as JSON to dev/review-visual/report.json with keys verdict (a paragraph) and findings (array of {title, severity: blocker|major|minor, file, evidence (script path + numbers / screenshot paths + what to look at), fix_hint}), keep dev/review-visual/STATUS.md with RESUME NOTES, and end your final message with that JSON. Only verified findings, no speculation.
