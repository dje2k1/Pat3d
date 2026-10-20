# KIT role — STATUS (SPEC3 §5 Kit + skateboard)

Owner files: src/30-player.js (rendering side only: model, materials, anim visuals; camera code untouched),
src/35-board.js (board look only — it has no meshes; the board mesh lives in 30-player.js buildBoard),
tools/tex/kit_*.py, assets/tex/kit/.

## RESUME NOTES (latest first)
- SESSION 3 (resumed 22:32 after usage limit; lead committed everything as bdf01d6 "Kit terminé", tree clean).
  VERIFIED on HEAD bdf01d6 (tree = HEAD, ./build.sh OK): e2e WebGL 2 --only=desktop,valley,boss 30/30 (183 s,
  dev/kit/e2e3-desktop.log), --only=act2,phone 16/16 (182 s, e2e3-act2phone.log); --webgpu 4/6 (e2e3-webgpu.log): boot,
  Act 1, Act 2, K.tex pass; the 2 FAILs are still the post role's Ultra MRT on WebGPU (40 > 32 bytes/sample).
  NOW: fresh Kit shots on HEAD (private build dev/kit/site): s3h (Élevé GL2), s3u (Ultra GL2), s3g (Élevé WebGPU),
  s3p (phone Moyen) -> dev/kit/shots/s3*.png, logs dev/kit/s3*.log.
- SESSION 2 (resumed 17:34; lead had committed my work as 4f4f98d / 241a844). DONE+VERIFIED (screens, WebGL 2):
  * wrap lighting: KU.sunDir / KU.sunCol track the brightest visible DirectionalLight (trackSun, rescan 2 s);
    wrapTerm() (emissive wrap(n.l)-max(n.l,0)) on body + shells; shells now MeshSSSNodeMaterial with sheen +
    translucency like the body -> fixed the hard terminator line and the dark jagged fur fringe on the shadow side
    (flight close-up, city sunset): dev/kit/shots/cmp_fl.png (left before, right after), cmp_np.png (island, nopost).
  * shield: iridescent thin-film rim, clearer centre; speed-shoes afterimages: additive Fresnel cyan (HDR) per ghost
    uniform (c3/lo1-starshoes.png). Économie (no shells) strand bump 1.4 -> 0.55 (no speckles under FXAA).
  * shimmer (TRAA, Ultra, still camera, 12 frames): Kit box mean temporal std near 0.72 fur / 0.65 no fur, play
    distance 0.72 / 0.60 (luma 0-255) -> the shells add no visible shimmer.
  * Kit cost (KITCOST = scene with / without kit* objects): Ultra 7 calls / 310k tris (turntable), 12 calls in game
    view (shadow passes incl.); Élevé ~230k tris; Moyen phone 8-12 calls / 106k tris (res 1.6, 6 shells);
    Économie 7-11 calls / 99k tris. Act 1 frame totals: Ultra 213 calls / 864k tris, phone Moyen 204 / 481k.
  * harness: dev/kit/shot.js (orbit renders 4x so motion blur/TRAA settle; Act 2 waits for act2 textures;
    --vars, --nofur, --site=dev/kit/site/); dev/kit/mkbuild.sh = private build (HEAD parts of other roles + my
    working 30/35; KIT=head OUT=base -> baseline) so the post role's in-progress edits don't skew comparisons.
  * NOTE: e2e 'game over path' FAILs when running --only=desktop alone (needs boss in the same run: the boss block
    returns to the title). Run --only=desktop,valley,boss.
  * VERIFIED (final, working tree incl. post's in-progress 15/16): ./build.sh OK; e2e WebGL 2
    --only=desktop,valley,boss 30/30 (dev/kit/e2e-desktop.log), --only=act2,phone 16/16 (e2e-act2phone.log);
    WebGPU: Kit shots on Élevé (turn/face/skate/flight: shots/cmp_gpu2.png, no errors) and e2e --webgpu 4/6: the
    2 FAILs are the post pipeline's Ultra MRT on WebGPU ("Total color attachment bytes per sample (40) exceeds
    maximum (32)", 5 targets RGBA16F+2xRGBA8+2xRGBA16F -> every material fails at Ultra, frame black) -> post role.
    Poses (Élevé, HUD on): shots/cmp_e1.png (run/peel, ball jump, spin dash, hurt, victory wink, star+shoes);
    phone Moyen: ph1-*.png (Act 1), cmp_ph2.png (Act 2 skate / close / flight).
  * DONE. Remaining ideas (not required): per-preset LOOK.res is chosen at load only (preset changes later keep
    the mesh); Ultra on WebGPU not shot (blocked by the post issue above).
- DONE+VERIFIED (WebGL2, Élevé, turntable + face close-ups at the beach spot (0,24)): new Kit model in 30-player.js
  "model" section: SDF primitives (v2 parts) -> narrow-band surface nets -> ONE SkinnedMesh on the v2 rig (groups are
  THREE.Bone now, same pivots/pose code), soft bone weights; shell fur (one SkinnedMesh, 16 layers in one geometry,
  drawRange = K.gfx.furShells, lag spring uniform), face details mesh (eyes w/ iris/cornea/lids/gaze/X, glossy nose,
  mouth tube projected on the muzzle), shadow proxy (coarse, colorWrite/depthWrite off, castShadow), scarf knit
  fabric material, ball fur material. Textures: tools/tex/kit_tex.py -> assets/tex/kit (fur, knit: group act1;
  board_deck(_n,_orm): act2). K.player.lookStats() added (diagnostics).
- Numbers (Élevé): Kit = 8 draw calls (body, fur, face, proxy x2 (view+shadow), scarf x2, blob), ~230k tris incl.
  10 fur layers (body 54k, fur 13.2k/layer, face 6k). Build ~300-500 ms desktop (SwiftShader box, contended).
- Probe: `node dev/kit/shot.js --scenes=turn,face,run,jump,spin,hurt,victory,game,skate,skateclose,trick,flight
  [--q=ultra|high|medium|low] [--webgpu] [--phone] [--angles=..] [--prefix=dev/kit/shots/x]` (KITCOST json = Kit's
  own draw calls / tris by hiding kit* objects).
- DONE+VERIFIED: poses run/peel/jump(ball)/spin/hurt(shut eyes)/victory(wink)/dead(X eyes) read well; Act 2 skate,
  kickflip sequence (board flips, graphic underside), flight (nopost). Board rebuilt: textured deck (grip/graphic/
  maple plies, lacquer clear coat), detailed trucks/bushings/bolts, rolling urethane wheels (KU.wheel). Textures are
  attached only once K.tex has them (texRef/rtex: placeholder 1x1 until preload resolves) -> no GL swap warnings.
  WebGPU: boots, Kit identical to WebGL2 (dev/kit/shots/cmp_gpu1.png).
- NOTE for post role: flight cinematic darkens progressively when frames are drawn every 10 ticks (mean luma
  130 -> 15 over 60 ticks), also with Kit hidden -> temporal post effect, not Kit (probe: scratch tr3/tr4 scripts).
- NEXT: e2e desktop+act2+phone; presets (Ultra 16 / Moyen 6 / Économie 0) + phone view; TRAA shimmer measure;
  fur lag check; afterimage/shield/sparkles check; budgets per preset; phone build time (LOOK.res by preset?).

## Plan / checklist
- [x] M0 probe harness (dev/kit/shot.js)
- [x] M1 textures (tools/tex/kit_tex.py -> assets/tex/kit/)
- [x] M2 new body (SDF sculpt + skinning, same rig/pivots)
- [x] M3 TSL materials: fur (sheen, SSS/wrap translucency, rim, strand bump), eyes, nose, fabric
- [x] M4 shell fur (K.gfx.furShells, motion lag) — verify no shimmer / lag visuals
- [x] M5 skateboard (deck graphics, grip, trucks, wheels)
- [x] M6 poses check, shield / sparkles / afterimages / peel-out wheel
- [x] M7 verification (turntable, in-game, phone, WebGPU, budgets, e2e)

## Kit budget (KITCOST: scene pass draw calls / triangles with minus without the kit* objects)
| preset | shells | calls (view / game incl. shadows) | tris |
|---|---|---|---|
| Ultra | 16 | 7 / 12 | 310k |
| Élevé | 10 | 7 / 12 | ~230k |
| Moyen (phone, mesh res 1.6) | 6 | 8 / 12 | 106k (125k with the board) |
| Économie | 0 | 7 / 11 | 99k |
Frame totals seen: Act 1 game view Ultra 213 calls / 864k tris; phone Moyen 204 / 481k; Act 2 skate phone 120 / 522k.

## Notes for other roles (seen in my shots, not Kit)
- post: Ultra on WebGPU fails (MRT > 32 bytes/sample, see above). Spin-dash dust shows a hard-edged rectangle
  at ground level behind the ball (VFX quad clipped by depth, no soft particles?) in shots/e1-spin.png.
- city: a big translucent fog / haze billboard can sit between the camera and Kit over the bay in flight, cutting
  a hard vertical edge through Kit (shots/fl-site-flightclose.png, x≈770; also with ?nopost).

## Requests for integrator
1. K.tex (12-tex.js) lazy swap bug: when a texture is used (uploaded as the 1x1 fallback) BEFORE its WebP arrives,
   the in-place image swap triggers `GL_INVALID_VALUE: glTexSubImage2D: Offset overflows texture dimensions` on the
   WebGL 2 backend (the GPU texture keeps its 1x1 storage). Fix suggestion in fetchInto(): if the old image size
   differs from the new one, call `t.dispose()` before `t.needsUpdate = true` (same for K.tex.set full/half swaps).
   Workaround here: Kit's fur/knit textures are in group 'act1' (preloaded at boot before any render).
2. Boot only preloads 'act1'; 'common' entries are never preloaded (lazy) — consider preloading 'common' with 'act1'.
