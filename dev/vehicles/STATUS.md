# VEHICLES role — STATUS (SPEC3 §5 vehicles)

Owner files: src/26-vehicles.js (K.vehicles), tools/tex/vehicles_*.py, assets/tex/vehicles/.
Do not edit src/25-city.js (final; requests go below).

## RESUME NOTES (latest first)
- STATE: DONE + VERIFIED (2026-10-27, session 4). Final code = working-tree src/26-vehicles.js (+ the committed
  tools/tex/vehicles_tex.py and assets/tex/vehicles/). Verified on the final code:
  * WebGL 2 private e2e act2,regress2,v3: 25/25 PASS + builder target "Moyen <= 220 calls / 800k" PASS
    (dev/vehicles/e2e-final.log, 403 s). WebGPU private suite: 6/6 PASS (dev/vehicles/e2e-gpu1.log; run on the code
    before the last lamp-intensity tweak, emission constants only).
  * Budgets (dev/vehicles/shoot.js, scene pass incl. shadows): Moyen desktop max 779k / 156 calls (v2 vehicles 745k),
    phone Moyen max 712k / 155 calls, Élevé max 1.18M / 194, Ultra max 1.36M / 194, Économie max 683k / 154;
    e2e budget views: Act 2 Ultra 174 calls / 818k, Moyen 138 / 576k.
  * ./build.sh OK at the root (index.html 1109757 B).
  * Shots: dev/vehicles/shots/final-lineups.png, final-close.png, final-v2-vs-v3.png (v2 boxes vs v3 at the e2e
    traffic / works / pull-out / runner viewpoints), final-phone.png (phone Moyen), final-webgpu.png (WebGPU).
  * report: dev/vehicles/report.json. Known issues: static wheels; one-frame motion-vector glitch possible when a car
    changes LOD pool; sedan roof long (vehicleTop); far cable car = boxes; lamps bloom strongly very close up.
- 2026-10-27 session 2-3 (HEAD 7f3e8ea = lead checkpoint incl. my WIP). DONE so far (working tree):
  * tools/tex/vehicles_tex.py -> assets/tex/vehicles/veh_atlas.webp (+half), 512 px, group act2, 75 KB: plates x8,
    taxi sign, LED bus/tram signs, cable car board, van logo "COLIS EXPRESS", keep-left sign, grille, tyre wall, bus
    band, cabin strip. A = emission mask. Preview: dev/vehicles/texprev.png.
  * src/26-vehicles.js REWRITTEN (v3): VB builder, gridMesh (smooth normals, glass inset), loft bodies (section(),
    loftBody(), per-type spec with cell classification), projected patches (hitOut/patch: lamps, grille, markers),
    sweep bumpers (endPath), lathe wheels (alloy / steel / bus), per-type builders buildCar/buildVan/buildBus/
    buildTram/buildCable/buildWorks with LOD 0/1, MeshPhysicalNodeMaterial (kinds 30-51, clearcoat + flakes,
    per-instance paint, seams, taxi checker / van logo decals, atlas, HDR lamps, blink on city clock, SSR opt-in,
    envMapIntensity 2), LOD instancing (POOL: near/far InstancedMeshes per type in K.city.group, city traffic meshes
    hooked + hidden, parked cars registered by addTo, slots assigned in onBeforeRender = evaluate(), shadow proxies
    'veh-shadow-*' = LOD1 geometry sharing the near pool's instanceMatrix, drawn only between onBeforeShadow /
    onAfterShadow).
  * Node tools: `node dev/vehicles/geotest.mjs` (builds every model with npm three in dev/vehicles/ref -> tris,
    bounds vs VT), `node dev/vehicles/kinds.mjs <type> <lod>` (kinds + extents), raydbg.mjs.
  * Shots so far: dev/vehicles/shots/t3-gridA.png (sedan/taxi), t3-gridB.png (bus/cable/tram/dvan); views
    c<type>_<angle> in shoot.js (close single vehicle, angles 1-6), lineups hide rings/hoops.
  * MEASURED Moyen desktop (scene tris): no vehicles 678-690k; v2 baseline 730-745k; mine (before LOD cuts)
    767k hilltop / 826k traffic / 879k parked -> OVER 800k.
  * FIXED budgets: LOD1 ~490 tris (7-point sections, hexagon wheels), third pool 'veh-dist-*' (LOD1, no shadows),
    LODD per preset [near, far+shadow, distant] = ultra 60/170/420, high 40/120/320, medium 16/70/150, low 14/50/120 m
    (x sqrt(length/4.6)), sedan LOD0 ~4.5k. Measured (shoot.js, scene incl. shadows): Moyen 727k/758k/779k (hilltop/
    traffic/parked; v2 baseline 730/745/740), Élevé max 1.18M / 194 calls, Ultra max 1.36M / 194 calls, Économie
    max 683k. Shots: shots/p-*.png, v2 vs v3: shots/t4-cmp.png (traffic, works, pullout, runner).
  * Visual pass 2: sedan C-pillar (rear side glass ends at -1.0), shoulder, rounder nose, lower lamps/grille, tyre
    r 0.345, tail lamps softer, van logo above the belt, patch rays pulled inward when they slip past the silhouette.
  * e2e private: `sh dev/vehicles/mke2e.sh` -> dev/vehicles/e2e-private.js (page dev/vehicles/site/test.html);
    RUN 1 (`--only=act2,regress2,v3`, WebGL 2, 608 s, dev/vehicles/e2e-r1.log): 24/25 + builder target "Moyen <= 220
    / 800k" PASS (Act 2 Moyen 138 calls / 576k; Ultra 174 / 818k). Only FAIL = Act 1 "no lawn-stripe seam" (world area,
    Act 1 has no vehicles; city STATUS notes it as flaky/failing before) -> to confirm on the base build.
  * After run 1 (not yet in a run): faint cabin (seat backs / headrests from the atlas strip) behind the cars' side
    glass, header doc of the pools, junk removed. Node checks: geotest.mjs, compat.mjs (addTo old path) OK.
  * WebGPU suite on my build (with the cabin change): 6/6 PASS in 190 s, no console errors (dev/vehicles/e2e-gpu1.log).
  * Baseline with the v2 vehicles (VEHREV=1b00bd0 OUT=base, dev/vehicles/e2e-base.js --only=regress2): the same Act 1
    "lawn-stripe seam" FAIL (ultra centre 6.2 vs mine 6.7) -> not caused by the vehicles (world area).
  * Final shots (Élevé, WebGL 2): dev/vehicles/shots/final-lineups.png (line-ups A/C cars, B bus/cable/tram, F far
    LOD), final-close.png (every type close). Then lamps toned down (head aE 0.62, tail 0.45, deeper red).
  * FINAL WebGL 2 e2e act2,regress2,v3 on the final code: 25/25 PASS + builder target "Moyen <= 220 / 800k" PASS
    (Act 2 Moyen 138 calls / 576k, Act 1 99 / 677k; Ultra Act 2 174 / 818k), 403 s, dev/vehicles/e2e-final.log
    (the lawn-seam check passed this time: flaky, world area).
  * (historical) these NEXT items were all done in session 4, see the top entry.
- 2026-10-27 session 1 START. Read SPEC3 (+ Foundation notes), city STATUS, post STATUS (SSR opt-in API), the city's
  traffic / parked code (buildTraffic, placeCar, hideCar, bakeParked, build order), three r186 sources
  (dev/vehicles/ref/package, npm pack: Instance.js, RenderObject.getDrawParameters -> count 0 = no draw).
  * HARNESS (done): `sh dev/vehicles/mkbuild.sh` -> dev/vehicles/site/test.html (HEAD parts of the other roles + my
    working 26-vehicles.js; `VEH=head OUT=base` = baseline; `MIX=work` = every working-tree part).
    `node dev/vehicles/shoot.js [--page=dev/vehicles/base/test.html] --prefix=x- --views=...` -> dev/vehicles/shots/.
    Views: the city's (hilltop street cross works corner ...) + lineA1-4 (cars line-up, 4 angles), lineB1-4 (bus, cable
    car, tram), lineC1-4 (more paints), lineF1-2 (far LOD line-up), close1-4 (one sedan close), traffic, pullout,
    runner, parked. Grid: `python3 dev/vehicles/grid.py out.png cols width imgs...`.
    Baseline (v2 boxes, HEAD): dev/vehicles/shots/v2b-*.png, grid v2b-grid.png.
  * PLAN:
    1. Own LOD instancing in K.vehicles: per type a near (LOD0) and a far (LOD1) InstancedMesh added to K.city.group,
       holding traffic AND parked cars. The city's own traffic InstancedMeshes (built from build(type)) are found in
       K.city.group, hidden, and their setMatrixAt is intercepted (store only). Slots are (re)assigned once per frame
       in onBeforeRender of my meshes (after every update: no lag), stable slots (lowest free), count = max slot + 1.
       Parked cars: addTo() registers them (matrix + paint) instead of baking boxes into the street chunks.
    2. One MeshPhysicalNodeMaterial for every vehicle (kinds: paint w/ clearcoat + flakes + instance colour, glass,
       chrome, rubber/tread, plastic, head/tail lamps (HDR emissive), blink, plate/sign atlas, livery paint, wood...),
       SSR opt-in mask (glass / paint / chrome).
    3. Lofted bodies (sections along z, smooth normals), wheel arches, inset glass with seals, bumpers, lathe tyres,
       spoked rims; per type; far LOD = coarse loft + octagon wheels.
    4. Atlas texture (plates, signs) from tools/tex/vehicles_tex.py.

## Requests for integrator
- docs/SPEC3.md Foundation notes, K.vehicles paragraph: the vehicles no longer use cityMaterial({vehicle:true});
  they have their own MeshPhysicalNodeMaterial (kinds 30-51; 30 paint = instance colour, 31 blink = city clock kept).
  build(type) returns the detailed LOD 0; new buildLOD(type, lod), stats(). Every city vehicle (traffic + the 224
  parked cars) is drawn by K.vehicles' own instanced pools in K.city.group ('veh-near-*', 'veh-shadow-*',
  'veh-far-*', 'veh-dist-*'); the city's traffic InstancedMeshes are hidden and only record poses; addTo() registers
  parked cars instead of baking boxes into the street chunks (with a plain mesh builder it still writes the far
  model with the city kinds). K.city.stats().buildTris.parked is therefore 0.
- 25-city.js: no change needed. (Optional cosmetic: the comment of bakeParked says "baked into the street chunks".)
- test/e2e.js (suggested): a vehicles check in act2, e.g. `K.vehicles.stats().built && hooked.length === 8 &&
  near+far+dist counts > 0` in Act 2, and every 'veh-*' mesh in K.city.group. The pending "[world+city+entities]
  Moyen" target passes with the vehicles in (Act 2 138 calls / 576k).
- regress2 "no lawn-stripe seam" (Act 1, world area) is flaky: it failed in my run 1 and on the baseline with the v2
  vehicles (same numbers), passed in the final run -> not vehicles.
