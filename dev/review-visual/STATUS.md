# REVIEW-VISUAL STATUS (role dir dev/review-visual; read-only on src/lib/assets; no git writes)

## RESUME NOTES
- S1 started 2026-11-02 18:45. Read brief, SPEC3 (incl. Foundation notes), integrator STATUS + tools.
- Tools (dev/review-visual): mkbuild.sh (private build -> site/test.html, DONE: = HEAD 85a0d5e), rv.js (= integrator
  shoot.js + extra views + `view@stillN` (clock frozen, render only) / `view@tickN` frame sequences saved as
  <prefix><view>-fNN.png straight from the canvas), py/lstats.py (luma/sat/clip), py/hue.py (hue-band saturation in a
  box), py/tstab.py (per-pixel temporal std of a still sequence + heat map), py/crop.py (zoomed crops side by side).
  Run: `node dev/review-visual/rv.js --views=a,b@still12 --out=dev/review-visual/shots --prefix=h- [--preset=ultra]`
  (~30-45 s per view on GL, shared CPUs).
- v2 shots: /tmp/claude-0/-home-user/608f9dd0-d109-57d1-b4c1-e900c9677b3d/scratchpad/kit3d/shots/*.png
- DONE: run A (Act 1 Élevé, prefix h-, logA.txt); run L (loop Kit: Élevé / mb off / Économie / Ultra / Moyen, logL.txt).
- NOTE: `@still` frames: wind still moves a bit? (grass blades shift) -> run T uses `@tick` with frozen camera instead.
  Free-cam S.still() frames advance the world wind 0.1 s per frame (stale path in 20-world onBeforeRender) -> foliage
  ghosting in the integrator's free-cam shots is partly a harness artefact; judge foliage on @tick sequences.
- RUNNING: run T (kitstill/a1grass @tick10 Élevé + Ultra, runseq mb off) -> logT.txt.
- NEXT: Act 2 Élevé run (views listed in rv.js V), presets subset, WebGPU subset, phone Moyen, report.json.

## CANDIDATE FINDINGS (being verified)
- VERIFIED: loop: Kit translucent smear = motion blur (mb=0 -> solid; Économie solid; Ultra/Élevé/Moyen smeared).
  shots/c-loopkit-high-nomb-low-ultra.png, shots/c-loopkit-medium-vs-nomb.png (L-a1loopkit*.png).
- VERIFIED: cliffs show no rock texture/normal detail at close range: py/detail.py hp-std 1.9-2.0 (= film grain) on
  h-a1cliffclose.png 320,540,520,700 / h-a1water.png 100,100,800,600 / h-a1bridge.png 1080,200,1240,380; texture
  itself has strong strata/cracks (shots/tex-rock_albedo.png).
- Rings desaturated/pale vs v2 (hue.py: v2 top sat 0.98 rgb 211,156,5; v3 0.58-0.65 rgb ~200,162,78).
- Kit in the loop = translucent pastel smear (crop shots/c-loop-kit-v2-v3-v3int.png), v2 crisp. Cause TBD (MB vs TAA).
- Global Act 1 saturation -15..-20% vs v2 (cliff/grass/sky) + lifted blacks (p1 luma 28 -> 50 at the start view).
