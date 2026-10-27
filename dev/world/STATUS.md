# WORLD / ACT 1 role — STATUS (SPEC3 §5 Act 1 scenery)

Owner files: src/20-world.js, tools/tex/world_*.py, assets/tex/world/.

## RESUME NOTES (latest first)
- SESSION 2 (2026-10-25/26). Tree checkpointed by the lead as 34ae4dc (contains everything below).
  DONE in 20-world.js (shot-checked on WebGL 2 Élevé, see dev/world/shots/a1..a6-*.png):
  * Sky: TSL dome with a textured cumulus deck (skyClouds(d, hdr), new tex world/sky_noise from world_tex.py `sky`),
    sun disc/aureole; mesh clouds removed. Water reflects the same sky + clouds.
  * Sun/shadows per K.gfx.shadows: two DirectionalLights (S.sunC = CSMShadowNode 3 x 2048, maxFar 160, fade, bound
    to K.view.camera via node._init; S.sunS = single map following Kit, 'cheap' = 1024 / 30 m); hidden one = inactive.
    Terrain chunks no longer cast; a 2 m shadow proxy (layer SHADOW_LAYER = 5, only shadow cameras see it) casts.
  * Decor rewritten: merged static meshes per 110 m zone (solid: bark/rock/painted wood/raw wood/bush leaves; foliage:
    alpha-cut fronds + petals, MeshSSSNodeMaterial translucency), wind in positionNode (aK = kind, bend, phase,
    flutter). Templates: textured palms (12-14 fronds, 4 variants), sunflowers, flower tufts, bushes, rocks (smooth),
    totems (wood grain). Near/far LOD per zone (S.decorLodDist by preset), tiers (Moyen/Économie draw tier 0 only).
    Extra dressing: stones at wall feet, shore boulders, flower tufts.
  * Grass blades: 2 instanced draws (near 3 m x 7x7 tiles x 1500, far 6 m x 9x9 x 520), half-float field texture
    (height, density, mown, cavity), wind gusts, Kit pushes blades, density = K.gfx.grass (instanceCount).
  * Sea: water_n detail normals, sand bottom + caustics + Beer-Lambert absorption, sky+cloud Fresnel reflection,
    sparkles, bubbly shore foam, K.post.ssr(seaMat, 0.55*(1-foam), 0.08).
  * Waterfalls: TSL streak material (no canvas texture). Loops: grass-textured running surface + chrome rails.
    Bridge: raw-wood textured (decor solid material, DK.RAWWOOD).
  * K.gfx.onChange -> onGfx(): applyShadows, applyDecorTier, applyGrass.
  * Budgets (2026-10-26): CSM per preset (Ultra 3 cascades / 200 m, Élevé 2 / 150 m, lights created at build, nodes
    lazily), terrain chunks 96 m + LOD distances per preset, decor zones 150 m, proxy zones 192 m, Moyen grass far
    ring x0.4. Private e2e `sh dev/world/mke2e.sh && node dev/world/e2e-private.js --only=desktop,valley,boss,v3`:
    36/36 PASS incl. desktop shot views < 300 calls (max 246 bridge), budgets Ultra 287 calls / 1.91 M tris, Élevé
    243, Moyen 153 calls / 721 k tris (the Moyen target passes), Économie 147 (dev/world/e2e-d2.log).
  * Fixes: ribbon NaN normals (black petal / leaf tips), grass density eroded 1 cell (no blades half way up walls or
    on banks), sea sparkles toned down, sandstone 2 repeats per checker square at 70 % contrast, env capture with a
    warm neutral floor (ENV_OPTS) + HEMI_ENV 0.28 pi (shadowed checker faces stay brown, not olive).
  * 2026-10-26 later: phone Moyen shots OK (dev/world/shots/ph1-grid.png, 127-163 calls, 345-595 k tris, 18 MB tex),
    WebGPU Élevé + Ultra boot and render OK (gpu1-grid.png, gpu2-*.png; backend 'webgpu' confirmed), v2/v3
    side-by-side sheets dev/world/shots/sbs-1..4.png, Économie / Ultra q-grid.png. Bird material replaces
    animMaterial (no PORT(world) markers left), far islands shaded by the sun, soil/sand double lookups, softer bridge
    wood, path stretches with sharper ends.
  * e2e fullrun,regress,present,regress2,phone,post,act2 (dev/world/e2e-r1.log): 42/44. FAIL 1 = Act 2 shaded street
    luma (city: HEAD's partial city fails it too, dev/city/e2e-base-r.log; the city builder's working copy passes).
    FAIL 2 = lawn seam on Ultra (centre 6.2): blade noise + SSGI on the lawn. Fixed: the mown lane keeps 45 % of the
    blades, softer blade root contrast, blades fade within 0.8-2.6 m of the camera; probe dev/world/probe-seam.js
    now gives Ultra centre 2.0 / High 2.6 (limit 4.5).
  * Seam check is noise-limited (no visible seam: dev/world/shots/seam-e2e-*.png saved by the instrumented copy
    dev/world/e2e-seam.js). Mown lane texture contrast x 0.7 + lane blades 30 %: combined run regress,present,
    fullrun,regress2 24/24 (dev/world/e2e-seam3.log, Ultra centre 3.6, High 2.0, Low 1.9).
  * FINAL (2026-10-27, tree fc7dfe5 + my working 20-world.js): ./build.sh OK (index.html 1011188 B); private e2e
    all suites WebGL 2 80/80 PASS + Moyen target met (dev/world/e2e-final.log, 1784 s); WebGPU suite 6/6 PASS
    (dev/world/e2e-gpu-final.log). Final shots dev/world/shots/final-grid.png (Élevé), ph1-grid.png (phone Moyen),
    gpu1-grid.png (WebGPU), sbs-1..4.png (v2 | v3). Report: dev/world/report.json. DONE.
- SESSION 1 2026-10-20: harness.
  * `sh dev/world/mkbuild.sh` (HEAD parts of other roles + my working 20-world.js -> dev/world/site/test.html;
    WORLD=head OUT=base -> baseline; MIX=work -> all working-tree parts).
    `node dev/world/shoot.js --page=dev/world/site/test.html --prefix=x- --views=start,valley,... [--preset=high]
    [--webgpu] [--phone]` -> dev/world/shots/<prefix><view>.png + draw stats. Views: start, valley, loop1,
    loop1side, cliffs, chasm, descent, lake, lakeview, bridge, loop2, arena, overview, closegrass, closecliff.
  * `node dev/world/run.js --file=dev/world/tally2.js --out=dev/world/tally.json; python3 dev/world/tally.py
    dev/world/tally.json` = draw calls / triangles per object at the e2e budget spots (high, medium).
  * v2 reference page: dev/world/v2/test.html (v2 parts from 9bcf15d, local vendor three r128): same views with
    `--page=dev/world/v2/test.html --prefix=v2-` (shots/v2-*.png, already taken).

## Requests for integrator
- test/e2e.js (v3 suite): the Moyen budget is met for Act 1 (153 calls / 721 k tris at the budget spots, 2026-10-26):
  turn `pending('world+city+entities', 'performance budget Moyen ...')` into a `check()` once city/entities agree.
- Entities (40-entities.js): rings / enemies / monitors are drawn one mesh each and all cast shadows: at the Act 1 lake
  and chasm views they are 80-85 main + 110-125 shadow draws on Ultra (3 cascades), i.e. two thirds of the Ultra
  draw calls (world itself: ~30 main + ~45 shadow). Instancing the rings and/or `castShadow = false` on rings would
  give everyone headroom (Ultra worst Act 1 view measured 297-335 / 350).
- SPEC3 Foundation notes, K.world: object layer 5 is reserved for the island's shadow-only terrain proxy (shadow
  cameras of the island suns enable it; keep other objects off layer 5). K.world.sun is the active sun (it changes
  with the preset: CSM light on Ultra/Élevé, single-map light on Moyen/Économie). K.world._dbg() is a dev probe.
- 90-main.js precompile: the CSM light variant of the other desktop preset compiles on the first preset switch (a
  one-time stall in the pause menu); acceptable, but `K.post.compileAsync()` after a preset change would hide it.
