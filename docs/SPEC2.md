# Kit Rush 3D — v2 spec: "Unreal look", jump VFX, Act 2 San Francisco skateboard, bumper flight

Read `SPEC.md` first (it still applies: platform rules, K namespace, conventions, testing). This file adds the v2
contract. The shipped game is `kit-rush-3d.html`, assembled by `build.sh` from the part files. Current state: Act 1
(Collines Émeraude) is complete and green (47/47 in `test/e2e.js`), published to the user. **Do not regress Act 1.**

## What the user asked (in French, verbatim intent)
1. "Améliorer les graphismes pour un rendu Unreal … un air Unreal et DLSS 5." → a cinematic, high-end rendering look.
   Real DLSS cannot run in a browser (needs NVIDIA tensor cores); we deliver the *equivalent idea*: render at a
   reduced internal resolution and reconstruct/sharpen to the screen (FSR1-style: bilinear/edge-aware upscale +
   RCAS contrast-adaptive sharpening, optionally temporal accumulation), exposed in the UI as **"Super Résolution"**.
2. "Effets spéciaux quand le personnage saute (des petites étincelles entre autres)."
3. "Un passage où on dévalerait les rues de San Francisco à travers les voitures sur un skateboard."
4. "Un moment où Kit volerait comme Superman après avoir pris un bumper, et la caméra tournerait autour du personnage pendant le saut."

## Load order and new files
`00-shell.html, 10-core.js, 15-post.js, 16-vfx.js, 20-world.js, 25-city.js, 30-player.js, 35-board.js, 40-entities.js, 90-main.js`
(update `build.sh` PARTS accordingly — INTEGRATOR does that; builders test with their own harness copies).

Extra scripts allowed (exact versions, jsDelivr is on the artifact CDN allowlist), placed in `00-shell.html` right after the
three.js core script, in this order (only the ones you actually use):
```
https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/CopyShader.js
https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/LuminosityHighPassShader.js
https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/EffectComposer.js
https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/RenderPass.js
https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/ShaderPass.js
https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/UnrealBloomPass.js
(+ optionally SMAAPass.js + shaders/SMAAShader.js, BokehPass.js + shaders/BokehShader.js, SAOPass.js + its shaders)
```
Local copies for tests: `vendor/examples/postprocessing/*.js` and `vendor/examples/shaders/*.js` (byte-identical to
npm three@0.128.0). Tests must `page.route` each jsDelivr URL to the vendored file (jsDelivr is blocked in the sandbox).
**Everything must degrade gracefully**: if any of these globals is missing (CDN failure), the game renders directly
with the old path and keeps working (test this).

## Contracts (binding names)

### GFX — `15-post.js` (new) + rendering upgrades
```
K.post = {
  init(),                 // after K.view.init() and K.world.build(): build the pipeline for K.view.renderer/scene/camera
  ok,                     // true when the composer pipeline is active (false → direct rendering fallback)
  render(dt),             // renders the current frame (main calls this instead of renderer.render)
  setQuality(q),          // 'ultra' | 'high' | 'medium' | 'low'; persisted in K.store('gfx'); default desktop 'high', touch 'medium'
  quality,                // current preset name
  setSuperRes(on),        // reduced internal resolution + reconstruction/sharpening ("Super Résolution"); persisted; default on for touch
  superRes,               // boolean
  cinematic(on, opts),    // opts: {focus: () => Vector3, letterbox: bool, dof: bool}; smooth transitions in/out
  speed(v),               // 0..1 speed-effect intensity this frame (radial motion blur, edge chromatic aberration, wind streaks)
  flash(color, seconds),  // full-screen additive flash (bumper, boss hit)
  setSun(dirVector3, colorHex), // light-shaft source (world/city call this on build/enter)
  refreshEnvironment(),   // regenerate the PMREM environment map from the current sky (call after a world switch)
  stats()                 // {passes:[…], scale, quality, ok}
}
```
Look targets ("Unreal" HDR pipeline): float/half-float HDR render target (multisample on high/ultra via
`THREE.WebGLMultisampleRenderTarget` when WebGL2), physically-based bloom (UnrealBloomPass on HDR before tone mapping),
final custom pass doing ACES filmic tone map + exposure + filmic colour grading (warm highlights / cool shadows,
contrast, saturation), vignette, subtle film grain, edge chromatic aberration scaled by `speed`, radial speed blur,
cinematic letterbox, sharpening (RCAS) when `superRes`. Light shafts / god rays from the sun (low-res occlusion mask +
radial blur, high/ultra only). Optional SAO/SSAO on ultra. Depth of field during `cinematic`. Eye adaptation optional.
Note r128: tone mapping & sRGB encoding are applied only when rendering to the screen; the pipeline must keep HDR
linear in its targets and apply tone mapping + sRGB in its final pass (set `renderer.toneMapping` accordingly to avoid
doing it twice). Materials: scene.environment = PMREM of the procedural sky (metal/gold rings, monitors, boss pod,
water get real reflections); improved sea/lake water (fresnel, sun glint, normal-mapped waves, shoreline foam, depth
tint); terrain detail (micro-variation, baked cavity/ambient-occlusion darkening at cliff bases), contact shadows.
GFX may edit `20-world.js` (materials, sky, water, lights; also add `K.world.setVisible(on)` which shows/hides every
object, light and fog the island added to the scene, used when switching to Act 2), `10-core.js` (renderer setup),
and in `90-main.js` ONLY the single render call (`V.renderer.render(V.scene, V.camera)` → `K.post && K.post.ok ? K.post.render(dt) : …`).
Budgets: desktop 'high' must stay close to the old cost (+ bloom ≈ 1.5–2 ms on a laptop GPU); 'medium' for phones
(bloom at half res, no god rays, no SAO, superRes 0.67); 'low' = direct rendering + FXAA.

### VFX — `16-vfx.js` (new)
```
K.vfx = {
  init(scene), update(dt, camera), reset(),
  jump(pos, up),               // the user's request: a crisp burst of tiny golden/white SPARKLES (star-shaped, twinkling,
                               // additive, HDR-bright so they bloom) + a soft air ring at the feet
  airJump(pos, dir),           // homing / air dash start: sparkle streak
  homingTrail(pos),            // call every tick while homing: blue-white comet trail
  land(pos, normal, speed),    // dust ring + pebbles, scaled by impact speed
  ballTrail(pos, vel),         // while rolling/spinning fast: swirl ribbon
  ringPickup(pos),             // golden starburst + sparkle shower
  boom(pos, scale),            // explosion: flash core, fire, smoke puffs, debris, shockwave ring
  sparks(pos, dir, n, color),  // metal sparks (skateboard grind, car scrape, boss hit)
  impact(pos, color, radius),  // shockwave disc (springs, dash panels, bumper)
  wheelSparks(pos, vel),       // skateboard wheels on rails/curb
  speedLines(intensity),       // 3D wind streaks around the camera at very high speed
  confetti(pos)                // act-clear celebration
}
```
GPU-friendly: pooled `THREE.Points` with a custom additive shader (soft round + 4-point star sprites drawn
procedurally), pooled ribbon trails, no per-frame allocations, hard cap on live particles (desktop 6000, touch 2500).
Colours are HDR (values > 1) so bloom picks them up. Works with or without K.post.

### ACT 2 — `25-city.js` (new, `K.city`) + `35-board.js` (new, `K.board`) + additive changes in `30-player.js`
Act 2 — **"San Francisco"** (card: "SAN FRANCISCO" / "ACTE 2"). An original take on the city (no trademarks beyond the
city's name): steep downhill streets lined with colourful Victorian "painted ladies" with bay windows, cable-car tracks,
a red/cream cable car, overhead wires, street lamps, fire hydrants, cars, taxis, vans and a bus in traffic, crosswalks,
steam from manholes, the bay with fog banks, a big red suspension bridge in the distance, an island prison silhouette,
golden-hour sunset lighting (low warm sun, long shadows, lit windows and car lights that bloom).

Gameplay (≈ 75–90 s): Kit grabs a skateboard at the top of a hill. Skateboard physics: gravity-driven downhill
acceleration along the street, carve left/right with the stick (body lean), **jump = ollie** (hold for higher),
**jump again in the air = trick** (spin/kickflip, +score popup "TRICK!" chaining combos, land it or wipe out = hurt),
**action = tuck** (crouch for speed). Streets have intersections that are flat → at speed Kit gets big air over the
crossing (iconic). Traffic in both directions + cross-traffic at intersections: touching a car = hurt (ring scatter,
knock-back, short invulnerability); 0 rings = death; cars can be jumped over (and their roofs can be landed on and
skated across). Ring lines guide the best lanes; dash rings; a construction ramp; a long grind rail on the cable-car
track (optional but great); one or two 90° turns at intersections with banked corners; checkpoint(s) (star posts).
The descent ends at the waterfront: a long pier with a **giant pinball BUMPER** at its end. Hitting it → bright flash,
impact shockwave → **Superman flight**: Kit flies horizontally, arms forward, scarf and tail streaming, sparkle trail.
For the first ~3 s the time slows (≈ 0.3×) and **the camera orbits a full 360° around Kit** (letterbox + depth of field
via `K.post.cinematic`), then a chase camera follows; the player steers gently through ring arcs and boost rings over the
bay, flies to the bridge, and lands on a goal platform (goal sign spins) → `K.game.onActComplete()` → results.

```
K.city = {
  build(scene),            // builds everything into K.city.group (NOT visible until enter); may be called lazily
  enter(), exit(),         // show/hide the act (lights, fog, sky, env refresh via K.post.refreshEnvironment/setSun)
  update(dt, t),           // traffic, cable car, steam, flags, water
  reset(),                 // after a death: traffic/rings/checkpoints restore (keeps reached checkpoint)
  start: {pos, yaw}, checkpoints: [{pos, yaw}], deathY,
  ground(x, z, yTop),      // highest skateable surface ≤ yTop (+0.05): road, sidewalks, car roofs, ramps, pier → {y, n, solid} | null
  collideWalls(pos, radius, height), // buildings, parked vehicles' sides, rails → push out, {hit, nx, nz}
  route(s) / routeAt(x, z),// route spline helpers for camera and bots: {pos, dir, right, width, s}
  cars,                    // live vehicles [{pos, quat, half: Vector3 (box half extents), vel}] for collisions
  bumper: {pos, normal}, goal: {pos}, flightPath: …, // whatever the board needs
  stats()                  // for tests: {rings, cars, cp, …}
}
K.board = {
  start(spawn),            // put Kit on the board (K.player.setExternal(true); pose 'skate'); camera 'external'
  stop(),                  // back to normal control
  update(dt),              // all Act-2 movement: skate, ollie, tricks, tuck, rails, ramps, cars, rings (via K.city),
                           // bumper → flight (cinematic orbit), flight steering, landing at goal
  active, mode,            // 'skate' | 'air' | 'flight' | 'land' | null
  camera(dt)               // drives K.view.camera while active (smooth chase; orbit during the cinematic)
}
```
`30-player.js` additive API (ACT2 owns these edits): `K.player.setExternal(on)` (skips its own movement/collision but
keeps animation, timers, hurt/invulnerability blink, death sequence and HUD-facing fields), `K.player.setPose(name, p)`
for 'skate' {lean, crouch}, 'skateAir' {spin, flip}, 'wipeout', 'flight' {bank, pitch}, 'land', null → normal; a
skateboard mesh (deck with grip tape, orange/teal livery, trucks, glowing wheels) attached under Kit's feet in skate poses;
`K.player.hurt()` must still work in external mode (the board applies its own knock-back). Rings collected in Act 2 go
through `K.game.addRings`; lost rings via `K.entities.scatterRings` must use `K.city.ground` while Act 2 is active
(INTEGRATOR wires that).

### INTEGRATOR (phase 2) — `90-main.js`, `40-entities.js`, `30-player.js` hooks, `build.sh`, tests
- `K.game.act` (1|2). Title: act select ("ACTE 1 — COLLINES ÉMERAUDE" / "ACTE 2 — SAN FRANCISCO", arrows / tap),
  both unlocked. Act 1 results → Act 2 card (lazy build with a short "Chargement…" card) → Act 2 → results → end.
  Lives/score carry over. Death in Act 2 → respawn at the Act 2 checkpoint. Pause menu adds "Graphismes : Ultra / Élevé /
  Moyen / Économie" and "Super Résolution : Oui / Non" (persisted), plus "Retour au titre".
- Wire `K.vfx` everywhere: player jump/air/homing/land/rolling, entities (rings, enemies, monitors, springs, dash panels,
  boss), Act 2 (ollie, tricks, grind, car hits, bumper, flight trail), act clear confetti. `K.post.speed()` from speed;
  `K.post.flash` on bumper/boss hits; `K.post.cinematic` during the bumper orbit.
- HUD: Act 2 trick score popups & combo counter; zone name in the card.
- Update `test/e2e.js`: keep all 47 checks green; add Act 2 checks (enter from title select, skate bot reaches the
  bumper without teleports, car hit → hurt not death with rings, ollie over a car, trick scores, bumper → flight →
  cinematic orbit (camera angle sweeps ≥ 300° around Kit) → goal → results; Act1→Act2 transition; phone Act 2),
  post pipeline active + fallback when the jsDelivr scripts are blocked, quality presets switch without errors,
  VFX: jump sparkles spawn particles, no particle leaks after 2 min.
