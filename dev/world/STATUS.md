# WORLD / ACT 1 role — STATUS (SPEC3 §5 Act 1 scenery)

Owner files: src/20-world.js, tools/tex/world_*.py, assets/tex/world/.

## RESUME NOTES (latest first)
- SESSION 2 started 2026-10-25 ~18:00 (tree at dd50f78, clean: the lead committed session 1's work in bdf01d6:
  world_tex.py + assets/tex/world/* + the textured terrain material in 20-world.js).
  * DONE (session 1, committed): textures (tools/tex/world_tex.py: grass soil rock sand bark frond leaves wood water,
    group act1, ~5 MB), terrain groundMaterial() = textured PBR (grass 2 rotated lookups, checker squares = sandstone
    per-square offset, soil path from aMat.x, beach sand aMat.y, mowing stripes view-dependent, no centre seam).
  * NEXT (session 2): sky + clouds, sun/CSM shadows per preset, water, grass blades, palms/bushes/rocks/flowers
    textured, loops/bridge/rails materials, budgets, e2e.
- SESSION 1 2026-10-20: harness.
  * `sh dev/world/mkbuild.sh` (HEAD parts of other roles + my working 20-world.js -> dev/world/site/test.html;
    WORLD=head OUT=base -> baseline; MIX=work -> all working-tree parts).
    `node dev/world/shoot.js --page=dev/world/site/test.html --prefix=x- --views=start,valley,... [--preset=high]
    [--webgpu] [--phone]` -> dev/world/shots/<prefix><view>.png + draw stats. Views: start, valley, loop1,
    loop1side, cliffs, chasm, descent, lake, lakeview, bridge, loop2, arena, overview, closegrass, closecliff.
  * v2 reference page: dev/world/v2/test.html (v2 parts from 9bcf15d, local vendor three r128): same views with
    `--page=dev/world/v2/test.html --prefix=v2-` (shots/v2-*.png, already taken).

## Requests for integrator
- (none yet)
