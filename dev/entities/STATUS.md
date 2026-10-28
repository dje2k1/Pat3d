# ENTITIES role — STATUS (SPEC3 §5 entities)

Owner files: src/40-entities.js, tools/tex/entities_*.py, assets/tex/entities/.

## RESUME NOTES (latest first)
- SESSION 1 cont. (2026-10-27): REWRITE DONE in src/40-entities.js (original kept in dev/entities/40-entities.orig.js):
  * instanced part pools: every template part = ONE InstancedMesh (POOLS); entity Object3D hierarchies stay outside
    the scene as transform holders; flush() each tick copies holder.matrixWorld into stable instance slots
    (zero-scale when hidden), pool bounding sphere = visible instances (camera + cascades cull whole pools).
  * far LOD: lodTpl() builds templates twice (LQ = 0.45, small details skipped); far twins (> 30 m) cast no shadow.
  * static unique geometry (spring pedestals, spike beds) baked per 100 m chunk ('e-static').
  * rings: superellipse profile, near (< 26 m, 1120 tris) / far (168 tris) pools, spin in the instance matrix, no
    shadows; halo sprites fade near the camera; lost rings = 32-slot InstancedMesh.
  * one shared MeshPhysicalNodeMaterial (entMaterial): per-vertex aMat [rough, metal, emission, kind] + triplanar
    detail texture (tools/tex/entities_tex.py -> assets/tex/entities/detail.webp, lossless RGBA 0.52 MB) bump,
    clearcoat paint, brushed metal, chrome, rubber, sheen for soft, hull seams, HDR emission; per-instance iTint.
    Ring gold material, CRT screen material (icon atlas canvas), procedural chevron dash arrows, iridescent wings,
    glass dome (SSR opt-in). Env = scene.environment (private makeEnv fallback).
  * tally (dev/entities/tally.js, run via run.js --file): Ultra worst 156 calls (was 301), Moyen worst 99 calls /
    763k tris (before trims) -> trims applied (coil, caps, spikes, far ring 14x6, ring far 160 m on Moyen/Éco).
  * VERIFIED: private e2e --only=desktop,valley,boss 30/30 PASS (dev/entities/e2e-d1.log, shots dev/entities/e2eshots).
  * glow gain 2.6 -> 1.9 + specularIntensity off on emissive parts (lamps looked salmon/pink, LEDs white).
  * NOTE: the lead checkpointed my in-progress file as 7f3e8ea; the pre-rewrite v3 placeholder is dev/entities/
    40-entities.orig.js (ENT=head no longer gives the old baseline: baseline shots/tally are dev/entities/shots/base-*,
    dev/entities/tally-base.json).
  * LOD distances per preset (onGfx): Ultra/Élevé near < 30 m, rings near < 26 m, far rings to 190 m; Moyen/Éco
    18 m / 18 m / 160 m.
  * VERIFIED v3 suite (private build): budgets PASS incl. the Moyen target: Act 1 ultra 156 calls / 1.81 M,
    high 134 / 1.39 M, medium 99 / 677 k, low 95 / 483 k; Act 2 medium 138 / 629 k (dev/entities/e2e-v3.log).
    Baseline before my work: Act 1 ultra 287 / 1.91 M, medium 154 / 751 k.
  * phone Moyen shots OK (dev/entities/shots/ph-grid.png); WebGPU shots OK (gpu-grid.png; the missing dash panel in
    gpu-dash.png was the harness: cullPass runs every 6 ticks -> shoot.js now ticks 7 after fixing the camera).
  * VERIFIED e2e --only=fullrun,regress,present,regress2,phone 30/30 PASS (702 s, dev/entities/e2e-r1.log).
  * tree checkpointed by the lead as a58d2bf (contains all of the above).
  * VERIFIED e2e --only=act2,post 14/14 PASS (dev/entities/e2e-a2.log); --webgpu 6/6 PASS (dev/entities/e2e-gpu.log).
  * FINAL (tree a58d2bf = my final 40-entities.js, ./build.sh OK, index.html 1109757 B): e2e desktop,valley,boss
    30/30 again on the final build (dev/entities/e2e-final-d.log, 168 s). Final shots: dev/entities/shots/
    fin-grid1.png, fin-grid2.png (Élevé WebGL 2), sbs-1.png / sbs-2.png (before = v3 placeholder ≈ v2 | after),
    ph-grid.png (phone Moyen), gpu-grid.png (WebGPU Élevé). Report: dev/entities/report.json. DONE.
  * Optional ideas left: Ultra-only extras (anisotropic ring streaks, animated monitor bezel LEDs), real pilot face
    detail on Dr Boulon, a far LOD for the boss/capsule (only drawn at the arena, not needed for budgets).
- SESSION 1 (2026-10-27): started fresh. Read SPEC3/SPEC/SPEC2, dev/world/STATUS.md, dev/post/STATUS.md.
  Harness DONE: `sh dev/entities/mkbuild.sh` (HEAD parts of others + my working 40-entities.js -> dev/entities/site;
  ENT=head OUT=base -> baseline dev/entities/base), `sh dev/entities/mke2e.sh` -> dev/entities/e2e-private.js,
  `node dev/entities/shoot.js --page=dev/entities/site/test.html --prefix=x- --views=ring,rings,bug,wasp,fish,spring,
  dash,monitor,post,spikes,boss,bossclose,capsule,lake,... [--preset=] [--webgpu] [--phone]` -> dev/entities/shots/.
  Baseline shots taken: dev/entities/shots/base-*.png (log base-shoot.log, Élevé GL2: lake 260 calls, monitor 262).
  Next: draw-call tally per object, then the rewrite (shared TSL material, instanced part pools, ring LOD).

## Requests for integrator
- test/e2e.js (v3 suite): the Moyen budget target `pending('world+city+entities', 'performance budget Moyen ...')` is met
  with the entities rewrite (Act 1 99 calls / 677 k tris, Act 2 138 / 629 k on the private build, world + city at
  HEAD): please turn it into a `check()`.
- SPEC3 Foundation notes, K.entities: API unchanged (build, reset, update, homingTarget, scatterRings, bossInfo, stats,
  setActive, active) + `K.entities._dbg()` (dev probes only). Rendering: one InstancedMesh per template part (names
  `e-*`, userData.noEnv), far LOD beyond 30 m (18 m on Moyen / Économie) without shadows, rings never cast shadows,
  nothing on object layer 5. Entity materials use scene.environment (private fallback sky only if it is null).
- 90-main.js / K.view (optional): entity culling and LOD follow the camera of the previous tick (they run inside
  K.entities.update); a camera cut without ticks (e.g. a screenshot right after moving the camera) needs one tick.
