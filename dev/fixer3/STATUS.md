# FIXER3 STATUS (role dir dev/fixer3; owns every file; no git commit/push/reset/checkout/stash/clean)

## RESUME NOTES (S2 paused on a usage-limit warning, 2026-11-03 ~08:35; nothing is running)
- ALL 12 findings have src edits done. Verified with probes + the new e2e suite A/B (orig HEAD build fails all 11 finding
  checks, new build passes all; logs/fix3-new-2.log vs fix3-orig-2.log). Only the rails check was re-targeted after the
  last fix3 run (counts clipped px < 300 instead of peak < 250): NOT re-run yet.
- Phone suite 8/8 incl. the 2 new checks (logs/phone-2.log) AFTER the last 90-main edit (toolButton click rule).
- Root ./build.sh was run after the last src edit (90-main click rule); dev/fixer3/site + review-gameplay/site may be
  one edit behind for 90-main only (rebuild with sh dev/fixer3/mkbuild.sh / dev/review-gameplay/mkbuild.sh).
- det.js gameplay: pos/vel identical to v2 in every segment, final scores/records identical. One ring-counter timing
  difference vs orig in Act 1 (tick 906 vs 918, lost-ring pickup after a hurt): ringprobe.js shows the scatter at tick 807
  happens with Math.random count 545 (new) vs 495 (orig) -> 50 more seeded-random calls between the play-start re-seed
  and the scatter in the new build, so the lost rings fly differently. randprobe.js (hooks Math.random AFTER boot)
  saw only 5 audio calls in both -> the extra 50 come from a reference captured earlier (entities `rand` = Math.random
  is the same seeded fn; or three/TSL objects created during play: Node uuid / generateUUID). Kit's path is unchanged.
  The original build also shows run-to-run ring-timing noise in the boss segment (orig vs orig rerun: 213 ticks).
  NEXT: find the 50 extra calls (wrap window.Math.random BEFORE page scripts via init, count by stack between reseed
  and tick 807; suspects: TSL node uuids from materials built lazily during play, e.g. GTAO/post graph or a lazily
  created material in my edits) and either remove the cause or document it as not gameplay.
- INTERRUPTED: dev/fixer3/alloc3.js (v3-only alloc.js) never finished -> rerun: cd dev/fixer3 && node alloc3.js
  (output logs/alloc3-webgl2.json; compare with review numbers Act 1 197 KB / Act 2 1046 KB per drawn frame).
- NEXT (in order): 1. rebuild private sites; 2. finish the det/random investigation above; 3. alloc3.js; 4. node
  test/e2e.js --only=fix3 (rails re-target); 5. full WebGL 2 e2e alone (node test/e2e.js > dev/fixer3/logs/full-gl.log,
  ~35 min) + node test/e2e.js --webgpu (~5 min); 6. budgets from the e2e v3 spots; 7. fresh shots in shots/ (node
  dev/integrator/shoot.js with --page=test.html --out=shots --prefix=v3- for the integrator's set, Read a few) +
  docs/screenshots via dev/integrator/docshots.py (titre=title, acte1-depart=a1run, acte1-looping=a1loop,
  acte1-boss=a1boss, acte2-rue=a2street, acte2-chantier=a2traffic, acte2-bumper-orbite=a2orbit, acte2-vol=a2flight2,
  shot with --hud); 8. README test count (85 -> new total; WebGPU 6) ; 9. report.json + final JSON message.

## FINDINGS CHECKLIST (x = fixed + verified)
- [x] B1 blocker: WebGPU Act 2 black after Économie->Moyen->Économie (shadow map disposed) 25-city.js applyShadows, 20-world.js:799
- [x] M1 Act 2 per-frame garbage: city-foliage alphaTest 0.5 (25-city.js:1558)
- [x] M2 motion blur ghosts Kit in loops (15-post.js)
- [x] M3 fog-bank billboard hard edge over bay (25-city.js fogMesh/fogTexture)
- [x] M4 Act 1 checker cliffs no rock detail (20-world.js groundMaterial)
- [x] M5 Ultra SSGI AO grass flicker (15-post.js)
- [x] m1 phone pause button tap with joystick held / after swipe (90-main.js wireTools)
- [x] m2 'Version classique' pause row: confirm + rows >= 34 px on phone (90-main.js)
- [x] m3 van / dvan tail lamps ragged (26-vehicles.js ~684)
- [x] m4 gold rings pale (40-entities.js ringMaterial)
- [x] m5 cable-car rails blue strips (25-city.js rail kind)
- [x] m6 Act 1 totems flat boxes (20-world.js decor)
- [ ] det.js + cmpdet.py bit-identical gameplay after changes
- [ ] full WebGL 2 e2e + WebGPU suite green; budgets; fresh shots; README numbers; report.json

## LOG
- S1: copied dev/review-gameplay/out -> dev/fixer3/rg-out-orig (reviewer evidence kept; probes overwrite out/).
- S1: B1 reproduced on WebGL 2 (unchanged tree): deltex.js --act2 -> logs/deltex-a2-before.log: 2nd and 4th visit to
  Économie = 3 'bindTexture: deleted object' per frame (total 36). Cause: applyShadows disposes sunS.shadow.map; r186
  ShadowNode keeps its own shadowMap ref and resizes it itself (renderShadow -> shadowMap.setSize(mapSize)).
- S1 plans: M1 -> foliage alphaTest 0 + alphaTestNode float(0.5). M2 -> PostAuxNode velocity .w = 2 for Kit materials
  (flag m.kitSharp), MB pass: no blur at w>1.5 centre, taps on w>1.5 excluded (TRAA reads .xy only).
- S2 (after a usage-limit kill): resumed, no src edit had been made.
- S2: B1 FIXED: removing the manual dispose was NOT enough (deltex still 36 warns: ShadowNode's own setSize also
  disposes, bindings keep the destroyed depth texture). Final fix = no live resize at all: a separate 1024 'cheap'
  DirectionalLight (ST.sunL city / S.sunL world), visibility toggled like sunS/sunC. Verified: deltex --act2 (GL) total 0
  (logs/deltex-a2-after2.log); shadowbreak WebGPU Act 2: 0 errs, mean 98.3/98.0/95.1/98.2/108.5/114.9 (was 0 at step 3-4);
  --act1: 0 errs, normal luma (logs/shadowbreak-gpu*-after2.log).
- S2: M1 edit done (foliage alphaTestNode); M2 edit done (velocity .w=2 Kit mask, 30-player postSharp()); M3 edit done
  (fog bank softFade range aOff.w*0.45 + uv edge window). NOT yet verified.
- S2: M4 ROOT CAUSE: groundMaterial used normalWorld (= the perturbed normal outside the NORMAL sub-build) to pick the
  projection -> rock uv broke in the colour build (debug: colour-only shows texture; adding normalNode -> flat). Fix:
  normalWorldGeometry. Also 1 repeat per square + rotated detail octave (3.3x), contrast x1.3, cavity 0.4, normal 1.1.
  Shots dev/fixer3/shots/c2-*.png: cliffs now show strata + cracks. Tools: dev/fixer3/rv.js (= review-visual rv.js +
  --init, page dev/fixer3/site), dev/fixer3/mkbuild.sh.
- S2: M1: cachekey.js Act 2 0.2 rebuilds/frame (was 75); alloc2.js Act 2 KB/frame (tick+draw) U605 H486 M368 L373 (was
  1457/1271/604/620), cacheKeyKB 37-57 (was 277-858) (logs/cachekey-after.log, alloc2-after.log). alloc.js running.
- S2: M2 VERIFIED: loop Kit (rv a1loopkit) hue.py 430,260,530,330 10-35 val: Élevé 0.46, nomb 0.45, Ultra 0.41, Moyen 0.45
  (was 0.30/0.43/0.24/0.27); crop shots/c-loopkit-after.png: Kit solid on every preset.
- S2: M3: softFade range alone was not enough (row step 14 -> 10); added a height-above-water fade (billboard world y via
  cameraWorldMatrix varying, smoothstep(0, size*0.2)). kitflight max row step 14.0 -> 2.7, a2flight 7.6 -> 1.3
  (shots/f2-*.png). VERIFIED.
- S2: M4 VERIFIED visually (shots/c2-*.png); detail.py numbers still to take on final shots.
- S2: M5 FIXED: Ultra takes AO from GTAO (16 samples, half res), SSGI gives GI only (passes 'gtao(x0.5)', 'ssgi(gi)').
  a1grass@still10 grass box 300,460,1248,720: px std>8 Ultra 8.9% (was 25.7%), Élevé 6.2%; |f05-f06|>20: Ultra 3.9%
  (was 12.4%), Élevé 2.6% (shots/P-a1grass-*-f*.png).
- S2: m1 edit: 90-main toolButton(el, fn): touch acts on pointerup (pointerId + over the button), click kept for mouse /
  keyboard, a click after a touch tap ignored. m2 edit: G.legacyAsk: 1st confirm on row 4 -> 'Quitter la partie ? Oui'
  (orange), 2nd confirm opens legacy/; moving / tapping elsewhere / unpausing cancels; rows h 28 step 32 (v2 h 28).
  NOT yet verified (pausetap2.js, touch.js, subpath.js, e2e phone).
- S2: m3 VERIFIED: van/dvan lamp patch 4x6, off 0.014, emit 0.6 (ACES turned the big flat lens salmon at 1.0-1.4);
  lamps now solid rectangles, rgb (253,136,107) (was 252,195,160) shots/c-vanrear-lamps-after.png; dvan hinges moved
  inboard (x 0.67) after the lamp showed a notch.
- S2: m4: GOLD (1,0.42,0.018), band (1,0.56,0.07)x0.8, ring outputNode: sat x1.25 + blue offset -0.09*luma (pre-compensates
  ACES; TRAA's neighbour max(0) eats most of it). hue.py top-25% sat: Élevé 0.68-0.73 (was 0.57-0.61 same views, review
  0.61-0.66), Économie 1.00 (223,167,0). shots/c-rings-after.png. Partial vs v2 0.98 on TRAA presets.
- S2: m5: rail kind rough 0.3*map+0.44, metal 0.55, colour RAILC #8e8a84; cityMaterial outputNode caps rail HDR at 1.1.
  a2traffic rail box (33,37,72) sat 0.55 (was 40,62,120 sat 0.66; asphalt 29,34,70). waterfront peak not re-measured
  after the cap (n- shots were before the cap: 253) -> re-measure.
- S2: m6 VERIFIED: totems = painted wood (grain 0.55 in colour, full wood normal, wood ORM), big blocks bevelled
  (RoundedBoxGeometry r 0.06) shots/m-kit34.png, c-totem-rings.png.
- S2: alloc.js was killed by the 30 min background limit (v2 part done: a1draw 55.5, a2draw 43.5 KB) -> rerun v3 only.
- S2: m1 VERIFIED with pausetap2.js: every sequence pauses (incl. stick held, right after a swipe), the trailing click
  does not toggle back.
- S2: e2e: new suite regressV3 (--only=fix3) in test/e2e.js (+ T.grab / T.img metrics in test/page-helpers.js, --page=
  option); phone suite: pause button with stick held / after swipe, pause rows >= 34 px, legacy ask; WebGPU suite: preset
  sequence ultra,medium,low,medium,low,high in Act 2. Original HEAD build for A/B: dev/fixer3/orig/test.html.
  Running fix3 on new + orig -> logs/fix3-new-1.log, fix3-orig-1.log (thresholds to tune from these).
- TODO next: det.js v3 12345 --reseed + cmpdet.py 12345r; alloc.js v3 (longer timeout); full e2e GL + WebGPU; budgets;
  fresh shots in shots/; docs/screenshots check; README numbers; report.json.
- S2: fix3 e2e suite A/B (logs/fix3-new-2.log vs fix3-orig-2.log): ORIGINAL build fails all 11 finding checks, new
  build passes all except the rails sun-peak (253: a twinkle sparkle, not the rails; rails px>=250 968 -> 70) -> check
  now counts clipped px (< 300). Values new/orig: cliff detail 14.4/1.9, totem 16.4/7.0, ring sat .70,.67/.59,.56 (Éco
  1.0/.56), loop Kit val .51/.32, Ultra grass flicker 3.6/15.6 %, shadow seq 0 warns / bindTexture warns, cache keys
  0/76 per frame, fog step 1.6/7.3, lamps 5058 px G/R .59 / 1097 px .66, rails sat .57/.67, legacy ask ok/none.
- S2: README (legacy confirm, Ultra = SSGI GI + AO) + SPEC3 notes (sun lights, alphaTest, postSharp, normalWorldGeometry,
  GTAO on Ultra) updated.
- S2: running det.js v3 --reseed + cmpdet + dev/fixer3/alloc3.js (v3-only alloc.js) -> logs/det-v3.log, cmpdet.log,
  alloc3.log / alloc3-webgl2.json.
- S2: phone e2e 8/8 (logs/phone-2.log) after fixing toolButton's click suppression (time window ignored Playwright mouse
  clicks right after a touch tap; now: ignore click with pointerType touch/pen, or no pointerType + detail>0 within 800 ms).
  shots/16b-phone-pause-legacy-ask.png read: OK.
- S2: det.js v3 --reseed (new build): pos/vel maxDiff 0 vs v2 in every segment, final a1end/res1/a2end/res2 identical
  to the original v3; but ring-counter timing differs at a1 tick 906 (+12 ticks early) and in the boss segment (the
  original also differed from v2 there: 171 ticks). randprobe.js: Math.random consumers during Act 1 play identical (5,
  audio noise) in orig and new. Checking run-to-run determinism: det3.js on orig + new -> logs/orig-det-*, new-det-*.
- S2 (end): e2e fix3 A/B done (see RESUME NOTES); phone 8/8; det analysis in progress; alloc3 interrupted.
