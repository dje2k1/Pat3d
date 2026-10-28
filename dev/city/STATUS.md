# CITY / ACT 2 role — STATUS (SPEC3 §5 Act 2 scenery)

Owner files: src/25-city.js, tools/tex/city_*.py, assets/tex/city/.

## RESUME NOTES (latest first)
- STATE: DONE + VERIFIED (sessions 2026-10-25 .. 27; lead checkpoints 34ae4dc, d28df5b, fc7dfe5 contain my work).
  Read SPEC3/SPEC2, 25-city.js, 26-vehicles.js, e2e act2/regress2 checks, post STATUS (K.post.ssr, sceneDepth, no
  fragmentNode).
  * HARNESS (done, verified):
    - `sh dev/city/mkbuild.sh` -> dev/city/site/test.html = HEAD parts of the other roles + my working 25-city.js
      (`CITY=head OUT=base` -> baseline build of HEAD; `MIX=work` -> every working-tree part).
    - `node dev/city/shoot.js [--page=dev/city/site/test.html] --prefix=x- --views=a,b,... [--preset=high] [--webgpu]
      [--phone] [--eval="js"]` -> dev/city/shots/<prefix><view>.png + draw stats + K.tex stats. Views: hilltop street
      cross air pier orbit flight goal (the v2 Act 2 shots), facade road lowroad corner works rail waterfront bridge
      overview, and `luma` (= the e2e "shaded streets readable" probe, returns p10/median per preset).
      Grids: `python3 dev/post/grid.py out.png cols width imgs...`. v2 reference grid: dev/city/shots/v2-grid.png,
      v3 baseline (HEAD placeholders): dev/city/shots/base-grid.png.
    - K.city._dbg = { MESH, CT, ST, TSL } (probes: e.g. swap material nodes at runtime; MESH.cityMat.userData.dbg holds
      intermediate TSL nodes of the city material).
  * TEXTURES (done): tools/tex/city_tex.py -> assets/tex/city/city_alb.webp + city_nrm.webp (+ _half), group act2,
    3.4 MB on disk. 18 layers x 512 px (half 256) stacked as a vertical strip, layer 0 at the bottom: paintwood,
    siding, shingle, asphalt, slab, brick, planks, metal, leaves, dentil, scales, ground, stone, canvas, tar, concrete,
    window (sash, uv 0..1), manhole (uv 0..1). alb = sRGB albedo + A = 0.5+0.5*tint; nrm = normal xy, roughness,
    A = 0.5+0.5*AO. `python3 tools/tex/city_tex.py --preview` also writes dev/city/texprev.png.
  * MATERIAL (done, verified GL2 + WebGPU): 25-city.js cityMaterial() rewritten: the strips become two
    THREE.DataArrayTexture (cityTexSync converts K.tex's ImageBitmaps with one getImageData, swaps the texture nodes'
    .value; follows K.tex full/half), per-kind tables (KDEF -> uniformArray P0/P1/P2: layer, uv scale/mode, normal
    strength, roughness, metal, anti-tiling, AO), normal mapping via a derivative cotangent frame, asphalt anti-tiling /
    patches / worn markings / puddles (SSR opt-in), interior-mapped windows (kind 2) and shop fronts (new kind 22),
    manholes (new kind 23), concrete (new kind 24), v2 glow/blink/facade logic kept. LESSON: no TSL select()/If over
    computed values (TSL emits if/else with temporaries in one branch only -> black); masks + mix only.
  * LIGHTS (done, first look OK): own light group at the world origin (ST.lights), two suns: sunC with
    CSMShadowNode (3 cascades, fade, maxFar 280; Ultra/Élevé) and sunS single map (Moyen/Économie), switched by
    K.gfx.onChange (applyShadows). CSM camera inited manually with K.view.camera (env capture uses a CubeCamera).
  * SKY / WATER (done, verified GL2): skyCol = belt of Venus + earth shadow, Mie glow, domain-warped lit altocumulus
    (gold edges near the sun, lavender undersides), limb-darkened HDR sun; water = analytic sky reflection, 7 wave
    layers, sun-side scatter, glitter + sparkles, foam from K.post.sceneDepth (piles, sea wall), SSR opt-in, transparent.
  * FOLIAGE (done): city_foliage atlas (broadleaf card, palm frond, bark, needles), alpha-tested cards per chunk
    (mb.fol -> 'city-foliage' meshes, cast their own dappled shadows, tree proxies removed), palms with drooping frond
    strips, conifers on the wooded hill (FOL_FAR), backlit translucency + breeze in foliageMaterial. Atlas swapped in
    only once loaded (FT; avoids the 1x1 texSubImage warning).
  * RANDOM SEQUENCE: the city layout uses one rng (parked cars = colliders!). Visual builders must consume exactly the
    v2 number of draws: burn(r, n) (tree 19, palm 29, Presidio 4 + 2) -> parked 224 / solids 230 as in v2 (verified).
  * LAMPS (ornamental: plinth, fluted column, curved arm, acorn lantern), BRIDGE (ribs, art-deco struts, Warren truss,
    steel suspenders as geometry, deck lane paint / walkways / railings / lamps), BUMPER (chrome, clearcoat red, pink
    panels, rubber ring, chasing neon ring + bulbs via TSL, gold dome, neck filling v2's gap under the dome; uBump
    uniform drives the hit flash), RINGS (smoother torus, MeshPhysicalNodeMaterial gold) — done, shots OK.
  * AMBIENT: ENV_I = HEMI_I = 0.4, asphalt x0.88 (the brighter sky had pushed the shaded-street luma over 60):
    probe now p10 35-46 / median 41-55.
  * HOUSES: door panels + glazed panel + knob, Italianate cornice brackets, chimneys (hash-placed), closed window hoods
    and sills (all without drawing from the layout rng).
  * LUMA CHECK (e2e regress2 'shaded streets readable', 35-60 median / p10 >= 30): FIXED + stable. Findings: the test
    result was bimodal because the city strips sometimes arrive after the probe (the e2e runs synchronously) -> the
    1x1 placeholder layers now hold the per-layer means written by city_tex.py into the manifest (entry.means), so the
    city shades the same before / after the download; asphalt x0.86, road macro variation +-7 %, wet darkening 0.25.
    Two runs: high640 p10 34-37 / med 44-46, high1120 med 54, low640 p10 37-39, low1120 med 50 (PASS).
    NOTE: with the true pre-city baseline (dd50f78 25-city.js + current other parts) this check FAILS (63/71): the
    other roles' changes (post grade) brightened it; it is now met by the city.
  * e2e private (dev/city/mke2e.sh -> dev/city/e2e-private.js on dev/city/site): act2 10/10 PASS, regress2 8/9: the
    one FAIL is Act 1's "no lawn-stripe seam" (world area; it also fails on the dd50f78 city baseline -> not city).
  * Tris (Élevé, street view): city chunk meshes ~450k visible, Kit fur 211k, total frame ~1.0M incl. shadow passes.
  * BUDGETS (done): every side street has its own near/far meshes (SIDE_M, LOD by distance: Ultra 300 / Élevé 230 /
    Moyen-Économie 150 m; chunks x0.8 on Moyen/Économie), lamp scroll torus low-poly; stats().buildTris gives the
    triangles per build stage. Private e2e v3 + act2: 16/16 PASS incl. the pending "[world+city+entities] Moyen <= 220
    calls / 800k" (Act 2 views: Moyen 140 calls / 500k tris, Ultra 168 / 685k; assets 9.07 MB, Act 2 2.94 MB).
    Shoot measurements: desktop Moyen hilltop 156 calls / 708k, Élevé 194 / 981k, phone Moyen ~135 / 720k.
  * Lamp light cones (instanced additive cone, 1 call), soft depth edges on steam / fog banks (softFade), dash hoops =
    animated portal (rings rushing inward) + clearcoat hoop.
  * Puddles clustered (large-scale mask) with wind ripples, SSR 0.6; goal pad = worn painted starburst + ring of
    lights + glowing star (v2's all-emissive pad was blinding); shop interiors with shelves of goods, ceiling light
    panels, dimmer; file header describes v3; no PORT(city) marker left. ./build.sh OK (root, with the world's tree).
  * VERIFIED (2026-10-26): FULL private e2e on WebGL 2 (dev/city/e2e-private.js, every suite, my 25-city.js + HEAD
    parts of the other roles): 80/80 PASS + the builder target "[world+city+entities] Moyen <= 220 / 800k" PASS
    (Act 2 142 calls / 518k), 1645 s, log dev/city/e2e-full1.log, shots dev/city/e2e-shots/ (23-30 = the v2 Act 2
    viewpoints). Hydrant model upgraded after that run (visual only, no rng use).
  * FINAL VERIFICATION (2026-10-27, final 25-city.js = HEAD fc7dfe5):
    - WebGPU private suite (e2e-private.js --webgpu): 6/6 PASS (boot, Act 1, Act 2 city plays and draws, presets incl.
      Ultra + Super Résolution, K.tex, no console errors), 163 s, dev/city/e2e-gpu1.log.
    - act2 + regress2 on the final build: 19/19 PASS (luma high640 p10 34 / med 45, high1120 med 55, low 43 / 51),
      dev/city/e2e-final-ar.log. Full WebGL 2 suite (one commit earlier, visual-only diff since): 80/80 + Moyen target.
    - ./build.sh OK (root index.html 1011188 B with the world's working tree).
    - Budgets (shoot.js, scene pass incl. shadows): Ultra max 196 calls / 1.12 M tris; Élevé ~194 / 0.99 M; Moyen
      desktop 156 / 722k; phone Moyen max 159 / 675k; e2e Moyen Act 2 142 / 518k. GPU textures (K.tex.stats, whole
      game): 131 MB full / 32.7 MB half. Act 2 assets 3.6 MB (budget 15).
    - Final shots: dev/city/shots/final-high.png, final-ultra.png, final-phone.png, final-webgpu.png; v2 vs v3 at the
      e2e Act 2 viewpoints: dev/city/shots/v2-vs-v3.png (the e2e frames are taken after unrendered ticks, so the post's
      motion blur is exaggerated there; my harness shots show the settled look).
  * DONE. Ideas left (optional): richer far skyline boxes, bank skate marks, street furniture (bins, news racks),
    per-house porch railings, softer sun glare when facing the sun (post).

## Requests for integrator
- Docs (SPEC3 Foundation notes, K.vehicles / K.cityLib paragraph): KIND gained shop 22 (interior-mapped shop glass),
  manhole 23, concrete 24; cityMaterial({vehicle:true}) still handles kinds 30 (paint = instance colour) / 31
  (blinkers); the city material is branch-free TSL on two DataArrayTextures (CT, 18 layers): vehicles may keep using
  it or bring their own material. K.city.stats().buildTris = triangles per build stage.
- test/e2e.js: the pending "[world+city+entities] performance budget Moyen" passes for Act 2 (140 calls / 500k);
  it can become a check() once world/entities agree.
- regress2 "no lawn-stripe seam" (Act 1, world area) is flaky in my private builds and also fails with the pre-city
  dd50f78 25-city.js -> not caused by the city.
- "shaded Act 2 streets readable" is sensitive to the post grade: it failed with the old city + the current post
  (63/71); the city now meets it (median 42-54). If the post grade changes again, re-run regress2.
- Post: looking straight into the low sun (waterfront, west) the glare / godrays wash the frame (cyan cast), same with
  the old city; maybe cap the analytic glare when the sun is near the frame centre.
