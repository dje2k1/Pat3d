# POST + VFX status (role dir dev/post)

## RESUME NOTES
- Owned: src/15-post.js (K.post, K.gfx), src/16-vfx.js (K.vfx). Private build: `dev/post/mkbuild.sh` (HEAD parts of
  other roles + my working 15/16 -> dev/post/site/test.html; MIX=work uses every working-tree part). Harness:
  `node dev/post/shoot.js --steps=dev/post/steps-tour.js [--webgpu] [--phone] --prefix=x-` (PRESET=, SR=, ONLY= env),
  screenshots in dev/post/shots/.
- DONE (WebGL 2, verified by screenshots): new 15-post.js pipeline: MRT scene pass with PostAuxNode per-material aux
  outputs (normal/velocity/ssr/diffuse; transparent -> zeros + MaterialBlending = keep), GTAO, SSGI (Ultra), SSR opt-in
  (K.post.ssr(material, strength, roughness)), TRAA / TAAU, bloom, lensflare, screen-space godrays + analytic sun glare
  (1x1 occlusion RTT), own gather DOF (v2 algorithm, half res RTT), motion blur + radial streaks, CA, ACES grade,
  vignette, grain, letterbox, flash; Économie: glow-lite + grade + FXAA + Catmull-Rom/RCAS spatial upscale.
  16-vfx.js: fragmentNode -> outputNode (MRT-safe; fragmentNode broke WebGL draws with MRT).
- Lessons (r186): FRAME nodes advance only in three's own rAF loop -> K.post.render bumps nodeFrame when needed;
  toggling updateBeforeType breaks registration after an internal material rebuild -> toggle RTTNode.autoUpdate;
  DepthOfFieldNode getTextureNode() is a plain texture (node not registered) and chained after TRAA gave dark output ->
  own DOF; feed effects with plain `texture(node.value)` of another TempNode's output.
- 17:40 RESUMED (HEAD 4f4f98d has my 15/16 + kit's new model). Private e2e copy: `sh dev/post/mke2e.sh` ->
  `node dev/post/e2e-private.js --only=post` (runs dev/post/site/test.html): post 4/4 PASS on WebGL 2.
  Kit's "flight darkening" note NOT reproduced (dev/post/steps-flight*.js: mean drop = letterbox bars only).
- 18:30 DONE+VERIFIED (WebGL 2 screenshots, all 4 presets + phone Moyen SR, dev/post/g-r3-*.png grids; WebGPU vfx shots):
  VFX scene fog (Fog/FogExp2 uniforms synced each update) + soft particles (shared K.post.sceneDepth() depth copy, billboards
  only, pipeline on only), vfx meshes userData.noEnv, debris MeshStandardNodeMaterial. Post: DOF rotated spiral + 3x3
  "bokeh fill" pass (no more speckle), post-TAA min/max-limited sharpen (look.taaSharp 0.35), gamut compression before
  ACES (look.gamut 0.22: less neon greens), grade exposure 0.96 / sat 1.1 / curve 0.26, tone 'aces'|'agx'|'neutral',
  K.post.rebuild(), K.post.sceneDepth() (depth copies freed when a graph sleeps). Look A/B harness: steps-look.js.
- 22:35 RESUMED after a usage-limit stop. HEAD bdf01d6 contains my 15/16 (working tree was clean). Cost per preset
  re-measured (dev/post/verify-cost-gl.json, table below). FSR1: real FSR1Node now loaded with a dynamic import
  (build.sh's static scanner never sees it; the file is vendored) -> graphs built before it arrives use the
  Catmull-Rom+RCAS stand-in and are rebuilt once (G.standIn); stats().upscale = 'taau'|'fsr1'|'catmull-rom+rcas'|'none'.
  mkbuild.sh takes SITE=site2 (second private build for experiments while an e2e run uses site/).
  Private e2e `--only=post,fullrun,desktop,v3` running -> dev/post/e2e-gl-final.log (NB: "game over path" FAILS when
  desktop runs without valley,boss: the boss part returns to the title first; run desktop,valley,boss together).
- 23:05 RESUMED (pause session, HEAD f6ed8e5 = my 15/16, working tree clean). Private build rebuilt from HEAD
  (`sh dev/post/mkbuild.sh && sh dev/post/mke2e.sh`). Kit's darkening note CLOSED: kit's exact probe (scratch tr3.js,
  `__pump(0)` + T.glStats every 10 ticks in flight) re-run as dev/post/steps-tr3.js on ultra/high/medium/low: the
  curve is the same on every preset incl. Économie (no temporal pass): 160 -> 106 = letterbox bars (0.137 x2) + view
  change, screenshot normal (shots/tr3-tr3.png). The 130 -> 15 drop was an old-build artefact (fixed by the 17:40
  nodeFrame bump / DOF rewrite).
- 23:20 VERIFIED: private e2e WebGL 2 `--only=desktop,valley,boss,post,fullrun,act2 --no-phone` on the HEAD build:
  48/48 PASS in 581 s (dev/post/e2e-gl-p4.log): VFX jump sparkles, VFX no leak (full run + 2 min stress), post
  pipeline, presets from the pause menu, persistence, ?nopost fallback, Act 2 bumper cinematic, game over path.
- 23:30 FIXED (WebGPU Ultra was black): Ultra's MRT had 5 attachments = 40 bytes/sample > WebGPU's 32 limit
  ("Total color attachment bytes per sample (40) exceeds maximum (32)", e2e --webgpu 4/6, dev/post/e2e-gpu-p4.log).
  Fix in 15-post.js: when SSR and velocity are both on (Ultra, Élevé) the SSR mask is packed into velocity.z
  (AUX.velssr: round(strength*31)*64 + round(roughness*63), exact in half float; decoded before SSRNode), so Ultra =
  output+normal+velocity/ssr+diffuse (4 x 8 B) and Élevé = 3 attachments. The separate 'ssr' attachment remains only
  for a non-temporal SSR preset (none today). Verified: WebGPU e2e 6/6 (dev/post/e2e-gpu-p4b.log, Ultra mean 100, no
  console errors); SSR opt-in still reflects on WebGL 2 (dev/post/steps-ssr.js: glossy slab opted with K.post.ssr,
  strength 1 vs 0 mean diff 4.1 Ultra / 3.6 Élevé, shots/ssr-gl-ssr-*.png).
- 23:50 VERIFIED on the fixed build (WebGL 2): private e2e desktop,valley,boss,post,fullrun,act2 48/48 PASS in 576 s
  (dev/post/e2e-gl-p4b.log). Preset stress (16 combos quality x SR x upscaler, 3 cycles, dev/post/p4-verify-gl.log):
  geometries 157/157/157, programs 902/903/903, render targets 122/122/122, textures 163/164/164 -> no growth after
  the first cycle. NOTE: sleeping graphs keep ~60 MB of textures (texMB 182.7 with 11 cached graphs, 120 MB at
  18:34 with fewer combos): sleepGraph() frees only render targets held directly in a node field, not arrays (bloom
  mips) -> follow-up: also walk arrays (low priority; only matters after many preset switches on a phone).
- 00:10 WebGPU Ultra tour after the MRT fix (dev/post/p4-gpu-ultra-grid.png, 8 views, Act 1 + Act 2): SSGI, sun
  glare/shafts, motion blur + streaks at speed, cinematic DOF + letterbox all draw; no console errors.
- 00:15 PRESET TUNING (Super Résolution): TAAU measured clearly softer than TRAA + FSR1 (WebGL 2, 1248x720, centre crop,
  mean |Laplacian| / PSNR vs native TRAA; dev/post/p4-verify-gl.json): native 18.3; TAAU x0.85 7.2 / 32.2 dB;
  FSR1 x0.85 19.7 / 36.8 dB; TAAU x0.6 6.0 / 31.3 dB; FSR1 x0.6 12.1 / 34.5 dB. Not a convergence issue (TAAU stays
  at 8.9 after 30/120/240 still frames, steps-taau.js), not the jitter sign (steps-jit*.js: jitter is in the camera
  during the scene pass, sign flips change nothing), and the min/max-limited post-TAA sharpen cannot recover it
  (taaSharp 0.35 -> 1.6: 8.9 -> 9.2, steps-taau2.js). TAAUNode's 3x3 Gaussian (sigma ~0.47 input px) reconstruction
  is simply soft. => PRESETS[ultra|high|medium].up = 'fsr': 'auto' Super Résolution = TRAA at the internal res +
  FSR1 (EASU + RCAS); TAAU stays available with K.post.setUpscaler('taau'). Ghosting (box crossing at 14 px/frame):
  trail mean diff <= 0.7 / 255 (max 4) on every temporal preset -> none visible.
- Verification harness: `node dev/post/shoot.js --steps=dev/post/steps-verify.js --prefix=ver- --out=dev/post/verify-gl.json`
  (ONLY=stress,sharp,ghost,cost): preset/SR/upscaler cycling x3 memory, sharpness+PSNR vs native, TAA ghost trail, cost.
- NEXT: verify results -> e2e desktop (vfx leak) + post on private build, WebGPU verify subset, ./build.sh, STATUS final.

## API for other roles (K.post / K.gfx / SSR opt-in / scene depth) — stable, use these
- **SSR opt-in (any material, any role):** `K.post.ssr(material, strength = 1, roughness?)` → returns the strength
  node (a `uniform` you may animate: `.value = 0..1`). `strength`: number 0..1 or any TSL float node (e.g. a puddle
  mask: `K.post.ssr(roadMat, puddleMaskNode, 0.05)`); `roughness`: number or TSL float node (default: the material's own
  `roughness` on Standard/Physical node materials, else 0). Sets `material.ssrNode` / `material.ssrRoughnessNode`
  (you can also set those two fields yourself before the first render). Only opted-in pixels are ray-marched; SSR runs
  on Ultra (x0.75 res) and Élevé (x0.5 res), the mask is free elsewhere. Works for transparent materials too (glass,
  water): an opted-in transparent surface overwrites the normal/velocity/SSR buffers. Call it once at build time.
  Strength acts like SSR "metalness" (reflection = strength x fresnel), so 0.3–0.6 for wet asphalt / glass, 0.8–1 for
  calm water / chrome. Example: `const s = K.post.ssr(waterMat, 0.85, 0.04);`
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
  **superRes / setSuperRes(on)**, **upscaler / setUpscaler('auto'|'taau'|'fsr')** (persisted 'upscaler'),
  **compileAsync()** (precompiles the scene's MRT pass variants; await it behind a loading card), **stats()**
  (`{ok, quality, superRes, upscaler, scale, internal:[w,h], output:[w,h], aa, ao, ssrOn, passes:[...], cost, builds,
  gfx, calls, sceneCalls, sceneTris, speed, cinematic, letterbox, sunVis, dof, ...}`), **look** (live grade numbers),
  **uniforms**, **rebuild()** (after changing graph-time look settings such as `look.tone = 'agx'|'aces'|'neutral'`).
- **K.gfx** = `{ preset, furShells, grass, texRes: 'full'|'half', shadows: 'csm'|'single'|'cheap', ssr, presets,
  onChange(fn) -> fn(gfx, previousPreset), offChange(fn), sync() }` (unchanged from the foundation).

## Requests for integrator
- build.sh import scanner matches doc comments: lib/three/addons/tsl/display/FSR1Node.js has
  ` * @three_import import { fsr1 } from 'three/addons/tsl/display/fsr1/FSR1Node.js';` (wrong path in a comment) so
  importing FSR1Node fails the build. Please make `specs()` skip comment lines (e.g. `grep -v '^\s*\*'` first). Until
  then the spatial Super Résolution path is Catmull-Rom + SharpenNode (RCAS), the FSR1 recipe.
- **Precompile the post variants**: in 90-main.js `precompile()`, after `r.compileAsync(V.scene, V.camera)`, also
  `if (K.post && K.post.ok && K.post.compileAsync) await K.post.compileAsync();` — the scene pass renders with MRT, a
  different program per material than the plain compile, so today those compile lazily on the first frames (stall).
  Same after the Act 2 build (behind the loading card).
- **Results DOF**: SPEC3 §3 lists DOF for the results; 90-main.js `CINE_OPTS` has `dof: false`. Suggest `dof: true`
  (focus stays on Kit via `focus: () => K.player.center()`; the HUD panel is 2D and is not blurred).
- **Optional pause row** "Mise à l'échelle : Auto / TAAU / FSR" → `K.post.setUpscaler('auto'|'taau'|'fsr')` (persisted
  in K.store 'upscaler'); not required, the default 'auto' picks TAAU (Ultra/Élevé/Moyen) / FSR1-style (Économie).
- **SPEC3 Foundation notes**: please copy the "API for other roles" section above (SSR opt-in, sceneDepth, no
  fragmentNode on scene materials) into docs/SPEC3.md (K.post + K.gfx paragraph).
- **e2e post checks (suggested, test/e2e.js postChecks)**: the v3 passes per preset — high: /gtao/, /traa/, /ssr/,
  /godrays/, /bloom/; ultra: /ssgi/; medium + Super Résolution: /taau/ and stats().scale 0.6; low: /fxaa/, no /traa/;
  and a memory check: cycle every (preset x SR) twice, renderer.info.memory geometries/textures/programs equal after the
  2nd cycle (dev/post/steps-verify.js 'stress' does exactly this).

