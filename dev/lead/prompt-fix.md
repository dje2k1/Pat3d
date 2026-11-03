You are working on "Kit Rush 3D", a free-roaming 3D platformer (original characters: Kit the fox, Dr Boulon) for a French user who plays on PC and phone. It is published on GitHub Pages from the git repo /home/user/pat3d (GitHub dje2k1/Pat3d, branch main). We are building v3: a port from three.js r128 to three.js r186 WebGPURenderer (WebGPU, with the renderer's own WebGL 2 backend as fallback) with TSL node materials, an "Unreal-like" post stack, generated PBR textures and much better looking Kit, scenery and vehicles. Gameplay must not change.
MANDATORY first reads: /home/user/pat3d/docs/SPEC3.md (v3 contract, read fully; the "Foundation notes" section at its end, once it exists, holds the concrete APIs and conventions), then the parts of /home/user/pat3d/docs/SPEC.md and /home/user/pat3d/docs/SPEC2.md relevant to your role (gameplay contracts, module APIs, tests). The v2 source of any file is available with `git -C /home/user/pat3d show 9bcf15d:src/<file>` (v2 = three r128, the live version before v3); v2 screenshots for comparison: /tmp/claude-0/-home-user/608f9dd0-d109-57d1-b4c1-e900c9677b3d/scratchpad/kit3d/shots/*.png.
Environment: Node 22, Playwright 1.56.1 with Chromium (PLAYWRIGHT_BROWSERS_PATH is set; never run "playwright install"), Python 3 with numpy and Pillow (WebP ok, no scipy), npm registry reachable; CDNs and asset sites are blocked, so everything is vendored or generated. 4 CPUs shared with one other agent that may be running browser tests at the same time: local HTTP servers must listen on port 0 (or a free port), keep browser runs lean, close browsers.
Rules: do NOT git commit, push, reset, checkout, stash or clean (the lead commits). Only edit the files your role owns (listed below); if you need a change elsewhere, write it under "Requests for integrator" in your STATUS.md and work around it meanwhile. Usage limits can kill you at any time: keep /home/user/pat3d/dev/<your-role>/STATUS.md updated after every milestone with RESUME NOTES (done / verified / next). If that file already exists when you start, you are resuming: read it and continue, don't redo verified work. Put probes, harness scripts and scratch screenshots in /home/user/pat3d/dev/<your-role>/ (gitignored).
Quality bar: screenshots you take must look clearly and obviously better than v2 (closer to a modern AAA game) while staying within SPEC3 budgets on every preset, on phone (landscape, touch) as well as desktop. Read your own screenshots (Read the PNG files) and iterate on what looks wrong. Report honestly: what you verified, how, and what is left.
ROLE: FIXER (role dir dev/fixer3). You own every file. Apply every verified finding below (blockers and majors first, then the cheap safe minors). For each: reproduce, fix the root cause, add or extend an e2e regression check. Don't widen scope except to fix regressions you cause.
Context: integration finished (dev/integrator/report.json, below; dev/integrator/STATUS.md), then two reviewers ran: dev/review-gameplay/ and dev/review-visual/ (each has report.json, STATUS.md and its probe scripts and screenshots; reuse their probes to reproduce and to verify your fixes, e.g. dev/review-gameplay/shadowbreak.js, deltex.js, cachekey.js, alloc2.js, pausetap2.js, touch.js; dev/review-visual/rv.js and py/*.py). HEAD of branch claude/keen-maxwell-z7ef39 holds all of it. Gameplay must stay bit-identical to v2 (dev/review-gameplay/det.js + cmpdet.py prove it; re-run it after touching anything near gameplay or the main loop). You are the only agent running: the 4 CPUs are yours, still keep browser runs lean. The full WebGL 2 e2e takes about 30 min here: iterate with --only=<suite> and the reviewers' probes, and run the full suite (plus the WebGPU suite) once at the end on the final build.
Findings (12 verified: 1 blocker, 5 major, 6 minor):
[
 {
  "lens": "gameplay",
  "title": "WebGPU: Act 2 renders a black 3D view after Graphismes Économie -> Moyen -> Économie (shadow map destroyed but still bound)",
  "severity": "blocker",
  "file": "src/25-city.js (applyShadows, line 3553: `if (sh.mapSize.x !== size) { sh.mapSize.set(size, size); if (sh.map) { sh.map.dispose(); sh.map = null; } }`); same pattern in src/20-world.js:799 (not reproduced in Act 1)",
  "evidence": "dev/review-gameplay/shadowbreak.js (WebGPU, Act 2, real keyboard pause menu) -> dev/review-gameplay/out/shadowbreak-gpu.json. Steps: Élevé mean luma 98.3 -> Économie 98.0 -> Moyen 95.1 -> Économie again: mean 0, std 0, 1 colour, 10 x 'Uncaptured WebGPU GPUValidationError: Destroyed texture [Texture \"ShadowDepthTexture\"] used in a submit' per 4 frames. Still black 2 s later. Back to Élevé recovers (114.9). Screenshots: dev/review-gameplay/shots/shadowbreak-gpu-4-low-2s-later.png (black view, HUD only) vs shadowbreak-gpu-1-low.png. Act 1 with the same sequence: no error, image normal (out/shadowbreak-gpu-a1.json). A single Moyen -> Économie switch is fine (out/shadowbreak-gpu-frommedium.json). On WebGL 2 the same trigger gives 3 'WebGL: INVALID_OPERATION: bindTexture: attempt to use a deleted object' per frame without a visible change (deltex.js --act2 -> out/deltex-a2.json; lowshot2.js -> out/lowshot2-gl.json, 2nd visit vs 1st mean diff <= 1.4/255 with shadows intact). The leak run also logged them (out/leak-webgl2.json warns). Phones: by code reading, touch devices use a 1024 map for both modes, so the dispose branch is not taken; I did not run a phone WebGPU page.",
  "fix_hint": "Do not dispose or null `light.shadow.map` yourself: r186's ShadowNode owns that target and resizes it when shadow.mapSize changes. Alternatively, use a separate 1024 DirectionalLight for Économie and toggle visibility, as is already done for sunS/sunC. Align 20-world.js:799. Re-run `node dev/review-gameplay/shadowbreak.js` (WebGPU, Act 2 and --act1) and `node dev/review-gameplay/deltex.js --act2` (WebGL 2): expect 0 errors and a normal mean luma at every step."
 },
 {
  "lens": "gameplay",
  "title": "Act 2 allocates 0.6-1.5 MB of JS garbage per drawn frame (v2: 0.04 MB), mostly r186 material cache-key rebuilds from the alpha-tested city foliage shadows",
  "severity": "major",
  "file": "src/25-city.js:1558 (foliageMaterial: `m.alphaTest = 0.5` on the 'city-foliage' shadow casters)",
  "evidence": "dev/review-gameplay/alloc.js (CDP sampling heap profiler, objects already collected by the GC included, test-helper code excluded) -> out/alloc-webgl2.json. JS allocated per drawn frame without ticking, v2 -> v3: Act 1 55 -> 197 KB, Act 2 43 -> 1046 KB. Simulation ticks are similar: 43-54 vs 65-69 KB. dev/review-gameplay/alloc2.js -> out/alloc2-desk.json, Act 2 KB per frame: Ultra 1457, Élevé 1271, Moyen 604, Économie 620. Of that, 858 / 845 / 280 / 277 KB is under three r186 RenderObject.getMaterialCacheKey. dev/review-gameplay/cachekey.js -> out/cachekey-webgl2.json: Act 2 rebuilds about 75 cache keys per frame, all shadow-pass render objects with reason 'matVersion' (Act 1: 0.2). dev/review-gameplay/alphatest.js: the 5 'city-foliage' meshes are the only shadow casters with alphaTest > 0 (Act 1 has none). The renderer copies material.alphaTest onto the one shared shadow override material, and the Material.alphaTest setter bumps .version each time a caster crosses 0 <-> 0.5 (three r186 src/materials/Material.js:495-499 and src/renderers/common/Renderer.js about line 3748). Every later caster then fails RenderObjects' version check. SPEC3 §6 asks for no per-frame allocations in hot paths. At 60 fps this is about 36 MB/s on Moyen and 76-87 MB/s on Élevé/Ultra. GC pauses on real phones were not measured (SwiftShader only). The cache-key CPU share measured here was 0.2-0.7 % of a SwiftShader frame.",
  "fix_hint": "Keep material.alphaTest at 0 on the foliage: do the cut-out with `m.alphaTestNode = float(0.5)` or a discard in the node graph. maskShadowNode already cuts the shadow. Re-run `node dev/review-gameplay/cachekey.js` (expect about 0 rebuilds per Act 2 frame) and `node dev/review-gameplay/alloc2.js` (expect cacheKeyKBPerFrame about 0, and Act 2 per-frame allocation close to Act 1's)."
 },
 {
  "lens": "visual",
  "title": "Motion blur turns Kit into a translucent ghost through the loops (Ultra, Élevé, Moyen; WebGL 2, WebGPU and phone)",
  "severity": "major",
  "file": "src/15-post.js (velocity motion blur: U.mb / U.mbVel, the pass at ~line 466; PRESETS mb 12/8/6)",
  "evidence": "View a1loopkit in dev/review-visual/rv.js. Kit is at about (471,292); speed 30.6 m/s, post speed 0.43. Crop dev/review-visual/shots/c-loopkit-high-nomb-low-ultra.png, panels from left to right: Élevé, Élevé with motion blur off (pseudo-view mb=0), Économie, Ultra. With motion blur off and on Économie Kit is solid; on Élevé and Ultra he is a pale cyan/orange ghost with the track showing through. The same holds on Moyen (dev/review-visual/shots/c-loopkit-medium-vs-nomb.png), on WebGPU (dev/review-visual/shots/c-loopkit-gpu-vs-gl.png), on the phone (dev/review-visual/shots/M-a1loop.png, Kit near (1050,500) in the 2532x1170 shot) and in the integrator's shots/v3-a1loop.png. Sequence drawn every tick at 60 Hz (a1loopkit@tick6): dev/review-visual/shots/c-loopkit-seq.png, Kit is a ghost in every frame. Numbers vs motion blur off, mean |diff| in Kit's box 440,265-520,330 against a cliff box: Élevé 18.4 vs 6.2, Ultra 20.0 vs 7.0, Moyen 11.5 vs 2.8. Value of Kit's orange top 25% (py/hue.py, box 430,260,530,330, hue 10-35): 0.43 with motion blur off, 0.44 Économie, 0.30 Élevé, 0.24 Ultra, 0.27 Moyen. v2 05-loop.png shows Kit opaque.",
  "fix_hint": "The loop camera is fixed, so Kit crosses the screen fast and gets a full 1/60 s (360°) shutter plus the radial streak term. Keep the player sharp: tag Kit in the velocity MRT (zero his velocity, or use a mask), or clamp the blur length per pixel. Also consider a 180° shutter (halve U.mbVel) and capping the blur length in pixels."
 },
 {
  "lens": "visual",
  "title": "Bumper flight: the fog-bank billboards cut the bay water with a hard straight horizontal line (plus a faint vertical billboard edge)",
  "severity": "major",
  "file": "src/25-city.js fogMesh() / fogTexture() (~line 2676-2715)",
  "evidence": "Crop dev/review-visual/shots/c-flight-fogedge.png: on the left, dev/review-visual/shots/h-kitflight.png at y≈546; on the right, dev/review-visual/shots/h-a2flight.png at y≈503. A straight hazy band ends on a hard line across the water. Row-mean luma (x 40-1200) in h-kitflight drops 144.2 -> 133.2 -> 119.1 -> 111.8 over rows 545-548, a 32-level step within 3 rows on otherwise smooth water. In h-a2flight it drops 190 -> 173 at y=503. The edge reproduces on WebGPU (dev/review-visual/shots/G-kitflight.png, y=540, -11.1 per row) and in the integrator's shots/v3-kitflight.png (y=545, 3-row drop 28.3). In fogMesh, opacity uses softFade(viewDepth(c0), 12): with a 12 m fade range against 70-160 m billboards over water seen at a grazing angle, the soft-particle fade collapses to 1-3 pixel rows. dev/review-visual/fogtex.js reproduces fogTexture(): the alpha on the canvas border is 0.146 in the right column and 0.026 in the left, so blobs are clipped and leave a vertical edge (visible at x≈415 in the left half of the crop). The integrator's remaining_issues mention only haze, not this edge.",
  "fix_hint": "Scale the soft-fade range with the billboard size (for example aOff.w * 0.3-0.5), or fade on the depth difference divided by its screen derivative. Keep the fog blobs inside the canvas (centre within [r, 128-r]) or multiply alpha by an edge window such as smoothstep on uv.x and uv.y."
 },
 {
  "lens": "visual",
  "title": "Act 1 checker cliffs show no rock texture or normal detail at play distance (flat colour, same as v2)",
  "severity": "major",
  "file": "src/20-world.js groundMaterial() checker branch (gChk / chkBump, ~line 397-415): w-terrain and w-decor meshes",
  "evidence": "Crop dev/review-visual/shots/c-cliff-flat.png (left: h-a1lakeside 40,380-340,700; right: h-a1cliffclose 300,500-560,720): flat orange and brown planes with bevel lines and no strata, cracks or bump. py/detail.py (std of luma minus a 7x7 box blur): h-a1water.png cliff 100,100,800,600 = 1.96, h-a1cliffclose.png 330,560,520,700 = 1.91, h-a1bridge.png 1080,200,1240,380 = 1.98. Clear sky in the same frame (h-a1water 1100,40,1250,200) = 1.89, so the cliffs carry only film grain. For comparison, the dirt path (h-a1start 700,500,1000,650) = 9.61 and the pier boards (h-a2pier) = 12.8. The generated texture has strong strata and cracks (dev/review-visual/shots/tex-rock_albedo.png; luma std/mean 0.111). It is loaded (K.tex 28/28, rock_* in the act1 group), and the raycast probe dev/review-visual/probe-cliff.js (dev/review-visual/logC.txt) shows that w-terrain and w-decor draw these faces. SPEC3 §5 asks for 'real rock/soil materials with normal detail'. This is not the known 'triangular patches' issue.",
  "fix_hint": "Debug-output rA and chkBump on a cliff face. Likely suspects: the texture weight (mix 0.7 times meanInv), and a 1.3 m repeat (gq*1.9) that minifies the strata and cracks into a low mip at 3-15 m. Use a larger macro scale for the strata (for example 1 repeat per 2.5 m square or less), add a second detail octave, and give the rock normal more strength than nXY(rN, 0.6)."
 },
 {
  "lens": "visual",
  "title": "Ultra: SSGI ambient occlusion makes the grass blades flicker on a still frame (about 3x Élevé)",
  "severity": "major",
  "file": "src/15-post.js SSGI branch (~line 288-300: sliceCount 2, stepCount 8, AO multiplied into lit)",
  "evidence": "Still sequences have the clock, world and camera frozen, so only the TAA jitter advances (verified with dev/review-visual/probe-freeze.js: world, post and node time are constant). Grass box 300,460,1248,720 in a1grass@still, py/tstab.py, % of pixels with temporal std > 8 (and % with |frame diff| > 20, f05->f06): Ultra 25.2% (12.4%), Ultra with gi=0 22.3% (11.6%), Ultra with gi=0 and ao=0 8.2% (6.6%), Élevé 6.2% (4.1%), Moyen+SR 3.9% (2.6%), Moyen 2.9% (1.5%). Turning off the SSGI AO term (uniform ao=0) removes most of the flicker; GI does not. Heat map dev/review-visual/shots/P-a1grass-ultra-sdmap.png: whole blades and the near rings light up. Compare dev/review-visual/shots/h-a1grass-sdmap.png (Élevé, edges only) and the 3-frame crop dev/review-visual/shots/c-grass-ultra-frames.png. Frames: dev/review-visual/shots/P-a1grass-ultra-f*.png and X-a1grass-ultra-gi0*-f*.png.",
  "fix_hint": "Thin alpha-tested blades are undersampled with 2 slices x 8 steps. Options: take AO on Ultra from GTAO (or more SSGI slices and steps) and keep SSGI for GI only; exclude grass blades and rings from SSGI AO (mask or thickness); or clamp the AO in the TRAA neighbourhood before it multiplies the lit colour."
 },
 {
  "lens": "gameplay",
  "title": "Phone: the pause button ignores a tap while the other thumb holds the joystick, and a tap right after a camera swipe (pre-existing, same in v2)",
  "severity": "minor",
  "file": "src/90-main.js wireTools (about line 1271): btnPause / btnSound listen to 'click' only",
  "evidence": "dev/review-gameplay/pausetap2.js (phone 844x390, CDP touch, while playing) -> dev/review-gameplay/out/pausetap-v3.json and out/pausetap-v2.json (identical). A quick tap, or a tap held 30/120/250 ms, gives pointerdown, pointerup and click, and the game pauses. A tap while a second finger holds the joystick gives pointerdown and pointerup but no click, and the game is not paused. Chromium does not synthesise click for a non-primary touch. A tap right after a 144 px camera swipe also gives no click and no pause (fling cancel). The same tap 1.5 s after the swipe pauses.",
  "fix_hint": "Act on pointerup (or pointerdown) with a pointerId check on the tool buttons, as touchButton() does for SAUT and ROULER, and keep click only for the keyboard and mouse."
 },
 {
  "lens": "gameplay",
  "title": "Pause menu: one tap or confirm on the new 'Version classique' row leaves the game at once (current run lost), just under 'Retour au titre', with smaller rows than v2",
  "severity": "minor",
  "file": "src/90-main.js pauseConfirm / openLegacy (about lines 418-434) and the pause layout (PAUSE_ROWS = 5, step 30, h 25)",
  "evidence": "dev/review-gameplay/touch.js -> out/touch-webgl2.json pauseRects: on the phone (844x390) the 5 rows are 30.4 px tall at a 36.5 px pitch. v2 had 4 rows of 34 px (out/touch-v2.json). Tapping a row confirms it immediately (pauseMenu: `if (i >= 0) { G.pauseSel = i; pauseConfirm(1); }`). Row 4 is `location.href = 'legacy/'`. dev/review-gameplay/subpath.js -> out/subpath.json: confirming row 4 navigated straight to /Pat3d/legacy/ (status 200, three r128) without a confirmation step.",
  "fix_hint": "Ask for confirmation ('Quitter la partie ?') before openLegacy, or move 'Version classique' to the title screen or the error overlay only. Keep the pause rows at least 34 px tall on the phone."
 },
 {
  "lens": "visual",
  "title": "Van and delivery-van tail lamps render as ragged salmon slivers (the curved body pokes through the lamp patch)",
  "severity": "minor",
  "file": "src/26-vehicles.js van rear lamps: patch(vb, S, true, 1, 3, ..., -2.2], () => [0, 0, -1], 0.006, VK.TAIL, ...) (~line 684)",
  "evidence": "Views vanrear and dvanrear in dev/review-visual/rv.js: dev/review-visual/shots/X-vanrear.png, dev/review-visual/shots/X-dvanrear.png, zoomed crop dev/review-visual/shots/c-vanrear-lamps.png. Each lamp is a torn, irregular shape with body paint showing through. Lamp pixels average rgb (252,195,160), a clipped salmon, while the sedan and taxi tail lamps in dev/review-visual/shots/h-vehcars.png are (248,102,76). It is also visible at play distance: dev/review-visual/shots/c-van-lamps.png (P-a2street-low.png at x≈1190-1250, y≈520-670; h-vehcars.png at x≈1210-1250, y≈540-600).",
  "fix_hint": "A 1 x 3 patch spans the strongly curved rear corner, so its flat quads cut into the body. Subdivide across (nu >= 4), raise the offset (about 0.015-0.02) or add a polygon offset. Also check the tail emissive on this lamp (it reads salmon, not red)."
 },
 {
  "lens": "visual",
  "title": "Gold rings look pale and brassy, much less saturated than v2",
  "severity": "minor",
  "file": "src/40-entities.js ringMaterial() (GOLD (1,0.5,0.07) full metal + emissive bands (1.0,0.78,0.3))",
  "evidence": "py/hue.py, hue 36-62, top-25% most saturated pixels. v3 in 7 views across both acts: sat 0.61-0.66, rgb about (198,160,72). Boxes: h-a1start 372,268,414,304; 834,276,872,320; h-a1valley 460,185,580,335; h-a1cliffs 565,565,715,680; h-a1bridge 595,335,690,440; h-a1lake 615,270,870,530; h-a2traffic 90,20,360,250. v2 03-start.png: sat 0.98-1.00, rgb (211,156,5). Crops: dev/review-visual/shots/c-rings-v2-v3.png (v2 left, v3 right) and dev/review-visual/shots/c-rings-v3-close.png.",
  "fix_hint": "The blue-sky reflection times gold plus the pale yellow band emissive desaturates the rings. Use a deeper gold for the emissive bands (for example 1.0, 0.62, 0.12), tint the reflection, or slightly lower the band strength."
 },
 {
  "lens": "visual",
  "title": "Cable-car rails still read as saturated blue painted strips in shade (and clip with bloom into the sun)",
  "severity": "minor",
  "file": "src/25-city.js rail surface kind (rail roughness / colour in cityMaterial)",
  "evidence": "Crops dev/review-visual/shots/c-a2traffic-rails.png and dev/review-visual/shots/c-a2street-rails.png. Rail top 25% in h-a2traffic.png box 615,520,650,720: rgb (40,62,120), sat 0.66, against the asphalt around it at (29,34,70). In h-a2street.png 60,540,380,700 the rails are (24,35,76), sat 0.67. Into the low sun, the waterfront rails peak at luma 251-254 in rows 420-540 (x 823-910), against an asphalt median of 147-189 in the same rows, and they bloom (dev/review-visual/shots/c-waterfront-rails.png, from h-a2waterfront.png). The integrator lists this as fixed ('no longer read as neon-blue lines'); they are less neon but still read as blue strips.",
  "fix_hint": "Shaded steel should take the warm and pink ambient: lower the environment/specular contribution of the rail kind, raise roughness further in the groove, or darken its albedo. A specular clamp on rails would tame the sun glints."
 },
 {
  "lens": "visual",
  "title": "Act 1 totem props are untextured flat boxes with painted faces at close range",
  "severity": "minor",
  "file": "src/20-world.js decor (totems near the start)",
  "evidence": "Crop dev/review-visual/shots/c-totems.png (h-a1start.png 1170,160-1262,440 and 16,160-110,440; h-kit34.png 16,0-200,470): flat yellow and blue boxes with square eyes, next to fully textured rocks, grass and Kit.",
  "fix_hint": "Use the wood material (world/wood_*) with bevels for the totems, or the entities' painted-metal look."
 }
]
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
Finish: ./build.sh, full e2e green on the WebGL 2 backend and the WebGPU suite green, budgets re-measured, fresh screenshots in shots/ (Read a few to confirm, especially the views of the visual findings), docs/screenshots and README still accurate (update the README test count / numbers if they changed). Report each finding's outcome honestly.
Report: write your final report as JSON to dev/fixer3/report.json with keys summary, tests (array of {name, pass, notes}), screenshots, fixed (one entry per finding: outcome + how verified), remaining_issues, keep dev/fixer3/STATUS.md with RESUME NOTES after every milestone (limits can stop you), no git commit/push, and end your final message with that JSON.
