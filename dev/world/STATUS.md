# WORLD / ACT 1 role — STATUS (SPEC3 §5 Act 1 scenery)

Owner files: src/20-world.js, tools/tex/world_*.py, assets/tex/world/.

## RESUME NOTES (latest first)
- SESSION 1 started 2026-10-20 ~18:20.
  * Harness: `sh dev/world/mkbuild.sh` (HEAD parts of other roles + my working 20-world.js -> dev/world/site/test.html;
    WORLD=head OUT=base -> baseline; MIX=work -> all working-tree parts).
    `node dev/world/shoot.js --page=dev/world/site/test.html --prefix=x- --views=start,valley,... [--preset=high]
    [--webgpu] [--phone]` -> dev/world/shots/<prefix><view>.png + draw stats. Views: start, valley, loop1,
    loop1side, cliffs, chasm, descent, lake, lakeview, bridge, loop2, arena, overview, closegrass, closecliff.
  * v2 reference page: dev/world/v2/test.html (v2 parts from 9bcf15d, local vendor three r128): same views with
    `--page=dev/world/v2/test.html --prefix=v2-` (shots/v2-*.png).
- NEXT: textures (tools/tex/world_tex.py), terrain material, sky/shadows, water, vegetation, verify.

## Requests for integrator
- (none yet)
