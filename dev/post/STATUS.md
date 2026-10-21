# POST + VFX status (role dir dev/post)

## STATE (2026-10-21 ~01:00 UTC): PAUSED (user asked to pause v3 to save usage credits)
The post + VFX role is functionally complete. Not committed by me (the lead commits): the working-tree changes are
`src/15-post.js` (two fixes from this session, see below), the rebuilt `index.html` / `test.html` (./build.sh) and
dev/post/ files. Everything below was verified on HEAD f6ed8e5 + my working 15-post.js (16-vfx.js = HEAD).
The previous, longer log of this file (sessions 1-3) is kept in dev/post/STATUS.prev.md.

## RESUME NOTES (read first next week)
- Owned: src/15-post.js (K.post, K.gfx), src/16-vfx.js (K.vfx). Nothing else.
- Private build (other roles' committed parts + my working 15/16): `sh dev/post/mkbuild.sh` -> dev/post/site/test.html
  (`MIX=work` = every working-tree part; `SITE=site2` = a second copy for experiments while an e2e run uses site/).
  Private e2e: `sh dev/post/mke2e.sh` (regenerates dev/post/e2e-private.js from test/e2e.js), then
  `node dev/post/e2e-private.js --only=desktop,valley,boss,post,fullrun,act2 --no-phone` (~580 s) and
  `node dev/post/e2e-private.js --webgpu` (~130 s warm). Run desktop together with valley,boss (the "game over path"
  check fails if desktop runs alone: the boss part returns to the title first).
- Screenshot harness: `node dev/post/shoot.js --steps=dev/post/<steps>.js [--webgpu] [--phone] [--w= --h=]
  --prefix=x- [--out=file.json]` (env PRESET=, SR=, ONLY=), shots in dev/post/shots/, grids with
  `python3 dev/post/grid.py out.png cols width imgs...`. Steps files: steps-tour.js (8 views, Act 1 + 2),
  steps-verify.js (ONLY=stress,sharp,ghost,cost), steps-ssr.js (SSR opt-in check), steps-tr3.js (kit's darkening
  probe), steps-taau*.js / steps-jit*.js (upscaler probes), steps-vfx.js (every effect), steps-look.js (grade A/B).
  Redirect runs to a file (`> log 2>&1`), never through `| cut | tee` (buffers everything until the end), and never
  `pkill -f <pattern>` from a shell whose own command line contains the pattern (it kills itself).
- NEXT (optional, none blocking): (1) sleepGraph(): also free render targets held in arrays (bloom mips) of sleeping
  graphs (~60 MB GPU textures kept after visiting every preset x SR x upscaler; no growth, see stress); (2) once
  world/city/vehicles opt materials into SSR (K.post.ssr), check reflections in both acts on Ultra/Élevé + WebGPU;
  (3) re-shoot the preset tour when the world/city art lands (look tuning depends on their materials); (4) the
  integrator requests below.

## DONE + VERIFIED
- **Pipeline (15-post.js, THREE.RenderPipeline + TSL display nodes)**: MRT scene pass with per-material aux outputs
  (PostAuxNode: view normal, velocity (+ packed SSR mask), albedo on Ultra; transparent/additive -> zeros + material
  blending = keep what is behind), GTAO (Élevé/Moyen), SSGI AO+GI (Ultra), SSR opt-in (Ultra x0.75 / Élevé x0.5),
  TRAA, Super Résolution (internal resolution + FSR1 EASU/RCAS by default, TAAU selectable), HDR bloom, lens flare
  ghosts, screen-space godrays + analytic sun glare (sun = brightest visible DirectionalLight, both acts), cinematic
  DOF (own gather + bokeh fill, half res), velocity motion blur + radial speed streaks, chromatic aberration,
  gamut compression + ACES (or AgX / neutral via look.tone + rebuild()) + our grade (tints, saturation, curve),
  vignette, grain/dither, letterbox, flash. Économie: no MRT / no temporal: glow-lite, grade, FXAA, FSR1 with SR.
- **Presets** Ultra/Élevé/Moyen/Économie with K.gfx knobs + onChange, persisted (K.store gfx / superres /
  upscaler), switchable live (graphs cached per preset x SR x upscaler, sleeping graphs release their buffers),
  Moyen + Super Résolution default on touch, Élevé default on desktop, ?nopost = direct rendering fallback.
- **VFX (16-vfx.js)**: every particle effect ported to TSL instanced sprites (additive HDR, outputNode = MRT-safe),
  scene fog, soft particles (shared K.post.sceneDepth()), same K.vfx API and budgets, no leaks.
- **This session (pause session)**:
  1. Kit's "flight darkening" note CLOSED: kit's exact probe (`__pump(0)` + T.glStats every 10 ticks in flight,
     dev/post/steps-tr3.js) on ultra/high/medium/low gives the same curve on every preset incl. Économie (no
     temporal pass): 160 -> 106 = letterbox bars (2 x 0.137) + view change; screenshot normal (shots/tr3-tr3.png).
     The 130 -> 15 drop was an artefact of an old build (fixed earlier by the nodeFrame bump / DOF rewrite).
  2. FIXED WebGPU Ultra (was black): its MRT had 5 attachments = 40 bytes/sample > WebGPU's 32 limit ("Total color
     attachment bytes per sample (40) exceeds maximum (32)", e2e --webgpu 4/6, dev/post/e2e-gpu-p4.log). When SSR
     and velocity are both on (Ultra, Élevé) the SSR mask is now packed into velocity.z (AUX.velssr:
     round(strength*31)*64 + round(roughness*63), exact in half float, decoded before SSRNode): Ultra = 4 attachments
     (32 B), Élevé = 3. K.post.ssr() is unchanged for other roles.
  3. PRESET TUNING, Super Résolution: TAAUNode measured much softer than TRAA + FSR1 (table below); not convergence
     (TAAU stays at the same sharpness after 30/120/240 still frames), not the jitter (probed: jitter is in the
     camera during the scene pass, sign flips change nothing), and a stronger post-TAA sharpen cannot recover it
     (0.35 -> 1.6: +3 %). TAAUNode's 3x3 Gaussian reconstruction (sigma ~0.47 input px) is simply soft.
     => `up: 'fsr'` on every preset: 'auto' = TRAA at the internal resolution, all HDR effects + grade there, FSR1
     (EASU + RCAS) to the screen, then grain/letterbox/flash at full res. TAAU stays available
     (K.post.setUpscaler('taau')). It is also cheaper (Moyen+SR 6.15 vs 6.4 MPx-cost, SwiftShader 1066 vs 1906 ms).

## VERIFICATION (WebGL 2 = SwiftShader GL, WebGPU = SwiftShader Vulkan, 1280x720 window -> 1248x720 canvas)
- e2e WebGL 2 (private build) `desktop,valley,boss,post,fullrun,act2`: 48/48 PASS with the MRT packing
  (dev/post/e2e-gl-p4b.log) and again 48/48 with the FSR default (FINAL RUNS below).
  Covers: VFX jump sparkles, VFX no leak (full run + 2 min effect stress), post pipeline active, presets from the
  pause menu + K.gfx + Super Résolution, persistence across reloads, ?nopost fallback, Act 2 bumper cinematic.
- e2e WebGPU: 6/6 PASS after the MRT fix (dev/post/e2e-gpu-p4b.log): boot, Act 1, Act 2, presets incl. Ultra + SR,
  K.tex, no console errors. Final run: see FINAL RUNS below.
- Preset switching stress (16 combos preset x SR x upscaler, 3 cycles, dev/post/p4-verify-gl.json): geometries
  157/157/157, programs 902/903/903, render targets 122/122/122, textures 163/164/164 -> no growth after cycle 1.
- Screenshots: every preset in Act 1 + Act 2 (dev/post/g-r3-ultra.png, g-r3-high.png, g-r3-medlow.png; WebGL 2),
  WebGPU Ultra tour (dev/post/p4-gpu-ultra-grid.png), phone Moyen + SR (FSR1) tour (dev/post/p4-phone-medium-grid.png,
  844x390 landscape touch, canvas 1218x583, internal 731x350), SSR opt-in slab (shots/ssr-gl-ssr-{ultra,high}.png:
  strength 1 vs 0 mean diff 4.1 / 3.6 levels over the slab), crops native / TAAU / FSR1 (dev/post/p4-sharp-crops.png).
- Sharpness (mean |Laplacian| of luma, centre 40 % crop, 30 still frames) and PSNR vs native TRAA (each run has its
  own native reference: the scene is animated):
  | path | internal | before (auto = TAAU) | now (auto = FSR1) |
  |---|---|---|---|
  | Élevé native TRAA | 1248x720 | 18.3 | 14.5 |
  | Élevé SR x0.85 | 1061x612 | TAAU 7.2 / 32.2 dB | FSR1 16.1 / 36.7 dB |
  | Moyen SR x0.6 | 749x432 | TAAU 6.0 / 31.3 dB | FSR1 11.8 / 33.4 dB |
  | Économie SR x0.75 (FSR1 both) | 936x540 | 14.4 (native 13.8) | 11.7 (native 11.6) |
- Ghosting (bright box crossing at 14 px/frame, trail region vs converged frame, 0..255): Ultra 0.77, Élevé 0.82,
  Moyen+SR 0.93 mean (max 18-23 on a few pixels: animated scene), Économie 0 -> no visible trail.
- Cost per preset (dev/post/p4b-verify-gl.json; costMPx = sum of pass pixels x weight; SwiftShader ms = CPU-rendered
  frame, only relative; draw calls of the whole frame, Act 1 valley view):
  | preset | passes | internal | AA / AO / SSR | costMPx | SwiftShader ms | calls |
  |---|---|---|---|---|---|---|
  | Ultra | 11 | 1248x720 | TRAA / SSGI / on | 19.4 | 3125 | 236 |
  | Ultra + SR | 13 | 961x554 | TRAA+FSR1 / SSGI / on | 17.4 | 2313 | 239 |
  | Élevé | 11 | 1248x720 | TRAA / GTAO / on | 10.8 | 2314 | 236 |
  | Élevé + SR | 13 | 1061x612 | TRAA+FSR1 / GTAO / on | 10.6 | 1855 | 239 |
  | Moyen | 7 | 1248x720 | TRAA / GTAO / off | 9.0 | 2169 | 229 |
  | Moyen + SR (touch default) | 9 | 749x432 | TRAA+FSR1 / GTAO / off | 6.2 | 1066 | 232 |
  | Économie | 5 | 1248x720 | FXAA / - / off | 2.9 | 1704 | 226 |
  | Économie + SR | 6 | 936x540 | FXAA+FSR1 / - / off | 3.6 | 1139 | 229 |
  Pass lists: `K.post.stats().passes` (e.g. Moyen+SR: scene(output+normal+velocity,x0.6) | gtao(x0.3) | composite |
  traa(x0.6) | bloom(hdr,x0.5) | dof(cinematic,x0.5,gather+fill) | finish(ca+motionblur+streaks+aces-grade+vignette,
  x0.6) | fsr1(easu+rcas) | overlays(grain+letterbox+flash)).
- FINAL RUNS (final 15-post.js, FSR default, 2026-10-21 ~01:00): ./build.sh OK (index.html 925640 B);
  WebGL 2 e2e desktop,valley,boss,post,fullrun,act2: 48/48 PASS in 384 s (dev/post/e2e-gl-final2.log);
  WebGPU e2e: 6/6 PASS in 121 s, no console errors (dev/post/e2e-gpu-final2.log).

## API for other roles (K.post / K.gfx / SSR opt-in / scene depth) — stable, use these
- **SSR opt-in (any material, any role):** `K.post.ssr(material, strength = 1, roughness?)` → returns the strength
  node (a `uniform` you may animate: `.value = 0..1`). `strength`: number 0..1 or any TSL float node (e.g. a puddle
  mask: `K.post.ssr(roadMat, puddleMaskNode, 0.05)`); `roughness`: number or TSL float node (default: the material's own
  `roughness` on Standard/Physical node materials, else 0). Sets `material.ssrNode` / `material.ssrRoughnessNode`
  (you can also set those two fields yourself before the first render). Only opted-in pixels are ray-marched; SSR runs
  on Ultra (x0.75 res) and Élevé (x0.5 res), the mask is free elsewhere. Works for transparent materials too (glass,
  water): an opted-in transparent surface overwrites the normal/velocity(+SSR) buffers. Call it once at build time.
  Strength acts like SSR "metalness" (reflection = strength x fresnel), so 0.3–0.6 for wet asphalt / glass, 0.8–1 for
  calm water / chrome. Example: `const s = K.post.ssr(waterMat, 0.85, 0.04);` (strength / roughness are quantised to
  32 / 64 levels in the G-buffer.)
- **Scene materials:** use `colorNode` / `outputNode`, never `fragmentNode` (it bypasses the MRT outputs of the scene
  pass: AO / SSR / TAA / motion blur break on that surface). Transparent / additive / depthWrite:false materials don't
  write normal/velocity (what is behind them stays) unless SSR-opted.
- **Scene depth for transparent materials (water depth tint, foam, soft edges):** `K.post.sceneDepth()` → a shared
  TSL `viewportDepthTexture` node (or `null` when the pipeline is off / ?nopost: provide a fallback). `.x` = opaque
  depth at this pixel (or `.sample(uvNode).x`); view distance = `perspectiveDepthToViewZ(d, cameraNear, cameraFar).negate()`.
  Sharing ONE node keeps it to one depth copy per frame; K.vfx soft particles use it already.
- **K.post.uHDR** (TSL uniform, 1 while the pipeline runs), **K.post.envMap**, **refreshEnvironment(pos, {floor,
  floorOpacity, floorColor, intensity})**, **setSun(dir, hex)** (the shafts/glare also follow the scene's brightest
  visible DirectionalLight automatically), **cinematic(on, {focus: () => Vector3, letterbox, dof})**, **speed(0..1)**,
  **flash(color, s)**, **letterbox** (bar height), **quality**, **setQuality('ultra'|'high'|'medium'|'low')**,
  **superRes / setSuperRes(on)**, **upscaler / setUpscaler('auto'|'taau'|'fsr')** (persisted 'upscaler'; 'auto' =
  FSR1 on every preset), **compileAsync()** (precompiles the scene's MRT pass variants; await it behind a loading
  card), **stats()** (`{ok, quality, superRes, upscaler, upscale: 'fsr1'|'taau'|'catmull-rom+rcas'|'none', scale,
  internal:[w,h], output:[w,h], aa, ao, ssrOn, passes:[...], cost, builds, gfx, calls, sceneCalls, sceneTris, speed,
  cinematic, letterbox, sunVis, dof, ...}`), **look** (grade numbers), **uniforms** (live TSL uniforms),
  **rebuild()** (after changing graph-time look settings such as `look.tone = 'agx'|'aces'|'neutral'`),
  **_state** (dev probes only).
- **K.gfx** = `{ preset, furShells, grass, texRes: 'full'|'half', shadows: 'csm'|'single'|'cheap', ssr, presets,
  onChange(fn) -> fn(gfx, previousPreset), offChange(fn), sync() }` (unchanged from the foundation).

## Requests for integrator
- **SPEC3 Foundation notes**: please copy the "API for other roles" section above (SSR opt-in, sceneDepth, no
  fragmentNode on scene materials, Super Résolution = FSR1 by default) into docs/SPEC3.md (K.post + K.gfx paragraph).
- **Precompile the post variants**: in 90-main.js `precompile()`, after `r.compileAsync(V.scene, V.camera)`, also
  `if (K.post && K.post.ok && K.post.compileAsync) await K.post.compileAsync();` — the scene pass renders with MRT, a
  different program per material than the plain compile, so today those compile lazily on the first frames (stall).
  Same after the Act 2 build (behind the loading card).
- **Results DOF**: SPEC3 §3 lists DOF for the results; 90-main.js `CINE_OPTS` has `dof: false`. Suggest `dof: true`
  (focus stays on Kit via `focus: () => K.player.center()`; the HUD panel is 2D and is not blurred).
- **Optional pause row** "Mise à l'échelle : Auto / TAAU / FSR" → `K.post.setUpscaler('auto'|'taau'|'fsr')`
  (persisted in K.store 'upscaler'); not required ('auto' = FSR1).
- **build.sh import scanner** (cleanup, no longer blocking): it matches doc comments, and
  lib/three/addons/tsl/display/FSR1Node.js has ` * @three_import import { fsr1 } from
  'three/addons/tsl/display/fsr1/FSR1Node.js';` (wrong path in a comment), so a static import of FSR1Node fails the
  build. 15-post.js loads it with a dynamic `import()` (the file is vendored; the import map resolves it) and uses a
  Catmull-Rom + RCAS stand-in until it arrives. If `specs()` skipped comment lines, the dynamic import could become
  static.
- **e2e post checks (suggested, test/e2e.js postChecks)**: passes per preset — high: /gtao/, /traa/, /ssr/,
  /godrays/, /bloom/; ultra: /ssgi/ and stats().passes[0] lists at most 4 outputs (WebGPU 32 B/sample limit);
  medium + Super Résolution: /fsr1/ and stats().scale 0.6; low: /fxaa/, no /traa/; and the memory check of
  dev/post/steps-verify.js 'stress' (cycle preset x SR x upscaler, renderer.info.memory equal after the 2nd cycle).

## Known issues / limits
- No scene material opts into SSR yet (world/city/vehicles roles): SSR was verified with a test slab only.
- Sleeping graphs keep ~60 MB of GPU textures after visiting all 11 graph variants (stable, not a leak; NEXT 1).
- Phone internal resolution on Moyen + SR is 731x350 (K.view caps the DPR, then x0.6): a little soft but clean
  (dev/post/p4-phone-valley-crop.png); sr 0.7 on touch is a possible tweak once tested on a real phone.
- Timings are SwiftShader (CPU) numbers: relative only; real GPU frame times were never measured here.
- Desktop screenshots show a 16 px dark column at each side: the canvas is 1248 wide in a 1280 window (shell layout,
  not the post pipeline).

## Lessons (three r186)
- FRAME-update nodes advance only in three's own rAF loop: K.post.render() bumps nodeFrame when it renders twice in
  one animation frame (tests' T.renderNow, screenshots).
- Toggling updateBeforeType breaks registration after an internal material rebuild: toggle RTTNode.autoUpdate.
- DepthOfFieldNode.getTextureNode() is a plain texture (node not registered); chained after TRAA it gave dark output
  -> own DOF. Feed effects with a plain `texture(node.value)` of another TempNode's output.
- fragmentNode on a scene material breaks MRT draws on WebGL 2 -> use outputNode.
- WebGPU limits MRT to 32 bytes per sample and rgba8unorm counts 8 bytes like rgba16float: max 4 attachments.
- TAAUNode (r186) is noticeably softer than TRAA + FSR1 at the same internal resolution.
