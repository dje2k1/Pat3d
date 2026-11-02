# REVIEW-VISUAL STATUS (role dir dev/review-visual; read-only on src/lib/assets; no git writes)

## RESUME NOTES
- S1 2026-11-02 18:45, S2 23:16 (after a usage-limit kill). REVIEW DONE: dev/review-visual/report.json written
  (8 findings: 4 major, 4 minor, no blocker), validated as JSON. Nothing is running.
- Tools (dev/review-visual): mkbuild.sh (private build -> site/test.html = HEAD 85a0d5e), rv.js (integrator shoot.js
  + extra views + `view@stillN` (clock frozen, render only) / `view@tickN` (draw every tick) sequences ->
  <prefix><view>-fNN.png; pseudo-views q=, sr=, mb=0|1, gi=, ao=), run.js (probe runner), probe-freeze.js,
  probe-cliff.js, fogtex.js, py/{lstats,hue,tstab,crop,detail}.py.
- Runs (all 0 console errors): A Act 1 Élevé (h-), L loop Kit x presets (L-), T tick sequences (T-), B Act 2 Élevé (h-),
  P presets ultra/medium/medium+SR/low (P-), G WebGPU (G-), M phone Moyen+SR+HUD (M-), X van lamps + Ultra gi/ao
  test (X-), S loop drawn every tick (S-), C cliff raycast probe (logC.txt).
- If resumed: nothing left to do except re-sending the final message with report.json.

## CANDIDATE FINDINGS (being verified)
- VERIFIED: loop: Kit translucent smear = motion blur (mb=0 -> solid; Économie solid; Ultra/Élevé/Moyen smeared).
  shots/c-loopkit-high-nomb-low-ultra.png, shots/c-loopkit-medium-vs-nomb.png (L-a1loopkit*.png).
- VERIFIED: cliffs show no rock texture/normal detail at close range: py/detail.py hp-std 1.9-2.0 (= film grain) on
  h-a1cliffclose.png 320,540,520,700 / h-a1water.png 100,100,800,600 / h-a1bridge.png 1080,200,1240,380; texture
  itself has strong strata/cracks (shots/tex-rock_albedo.png).
- MEASURED: grass shimmer on a frozen still scene (Élevé, h-a1grass@still12, frames 4-11): grass box 300,460,1248,720
  6.2% px temporal std > 8, |dF| p99 32.7; palms box 300,130,560,230 5.7% / 25.6; sky 1.3%. (Moyen/Ultra TBD)
- Rings desaturated/pale vs v2 (hue.py: v2 top sat 0.98 rgb 211,156,5; v3 0.58-0.65 rgb ~200,162,78).
- Global Act 1 saturation -15..-20% vs v2 (cliff/grass/sky) + lifted blacks (p1 luma 28 -> 50 at the start view).
- Act 2: cable-car rails read as blue painted strips in shade (h-a2traffic 615,520,650,720 top rgb 40,62,120 sat .66;
  h-a2street left rails 24,35,76 sat .67) on navy asphalt (sat .55-.59; v2 asphalt sat .43). minor.
- VERIFIED major: flight fog-bank billboards cut the water with a hard straight edge (+ vertical edge): row-mean luma
  144 -> 108 within 3 rows at y=546 (h-kitflight.png), 190 -> 172 at y=503 (h-a2flight.png); crop
  shots/c-flight-fogedge.png. src 25-city.js fogMesh: softFade(viewDepth(c0), 12) uses the billboard centre depth and a
  12 m range -> near-hard edge at grazing angles. Not in the integrator's remaining issues (it lists haze only).
- VERIFIED: rings top-25% sat 0.61-0.66 (rgb ~198,160,72) in 7 views of both acts vs v2 0.98-1.0 (rgb 211,156,5).
- MEASURED: grass shimmer Ultra (P-a1grass-ultra still): grass box 25% px std>8, 12.4% px |d|>20 frame to frame
  (Élevé 6% / 4.1%); whole blades flicker on Ultra (sd map P-a1grass-ultra-sdmap.png), edges only on Élevé.
- minor: waterfront rails into the sun clip (254) with bloom (h-a2waterfront, shots/c-waterfront-rails.png).
- minor: totem props = flat boxes at close range (shots/c-totems.png).
- checked OK: Act 2 DOF on Kit (orbit), pier, facades, vehicles line-up, interior-mapped shop windows, kit close-ups.
- goal sign shows its blue back at landing+40 ticks in both my and the integrator's shot (v2 showed the face):
  checking at landing+330 ticks (a2goalend) before reporting.
- MEASURED shimmer per preset (still frames, grass box 300,460,1248,720, % px |dF|>20 f05->f06):
  Ultra 12.4%, Élevé 4.1%, Moyen+SR 2.6%, Moyen 1.5%. City still (a2streetstill) Élevé/Moyen+SR: 0.45/0.37% px std>8
  -> city is stable; the Ultra grass flicker is the outlier (SSGI on Ultra is the only AO difference).
- presets city: Ultra/Moyen+SR/Économie read fine (P-a2street-*.png), budgets in logP.txt within SPEC3.
- minor: van rear lamps = thin ragged slivers (shots/c-van-lamps.png from P-a2street-low + h-vehcars) -> vanrear view.
- WebGPU = WebGL 2 look: G-a1start vs h-a1start mean |d| 1.03 (0.13% px > 30); kit34 diff = idle-pose phase only
  (shots/c-kit34-gpu-vs-gl.png); loop smear and fog edge (y=540) reproduce on WebGPU (c-loopkit-gpu-vs-gl.png).
- phone Moyen+SR (M-*.png): HUD/touch UI readable, Act 1/2 read well; Kit soft at 731x350 internal. OK.
- goal sign: at landing+330 ticks it shows Kit's face (M-a2goalend, rotY 0.25 idle sway) -> blue back at +40 ticks is
  just the hit spin. NOT a finding.
- peel leg wheel (translucent legs at speed) exists in v2 too (st 'peel') -> NOT a finding.
- fog texture (fogtex.js reproduces 25-city fogTexture): right column alpha 0.146, left 0.026 -> faint vertical
  billboard edge; main horizontal edge = softFade range 12 m at grazing angles.
- VERIFIED Ultra grass shimmer = SSGI AO: grass box px std>8: Ultra 25.2%, Ultra gi=0 22.3%, Ultra gi=0+ao=0 8.2%,
  Élevé 6.2%; px |dF|>20: 12.4 / 11.6 / 6.6 / 4.1% (X-a1grass-ultra-gi0*, P-a1grass-ultra, h-a1grass; py/tstab.py).
- VERIFIED van + delivery van rear lamps ragged (body pokes through a 1x3 patch on the curved rear corner,
  26-vehicles.js:684 patch(..., 1, 3, ..., 0.006, VK.TAIL)): X-vanrear.png / X-dvanrear.png, crop
  shots/c-vanrear-lamps.png; lamp px mean rgb 252,195,160 (salmon, clipped) vs sedan tail lamp 248,102,76.
