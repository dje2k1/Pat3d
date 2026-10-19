# Kit Rush 3D — shared build spec (read fully before writing code)

A free-roaming 3D platformer in the spirit of Sonic Adventure (Dreamcast), delivered as ONE self-contained HTML
file published as a claude.ai Artifact. It is the 3D sequel of the 2D game already built in
`../kit/` (files p1.html … p10.js, assembled in `../kit/kit-rush.html`). Reuse its identity: the hero is
**Kit**, an original orange fox (white muzzle/chest/tail tip, green eyes, blue scarf, teal sneakers with white
stripe), the zone is **Collines Émeraude** (emerald grass, brown/orange checkerboard earth, palm trees,
sunflowers, totems, blue sea, white clouds), the villain is **Dr Boulon** (bald, goggles, huge brown moustache,
red coat, silver hover-pod with glass dome, wrecking ball). Never use Sonic/SEGA names, logos or likenesses.
All UI text is **French**. The user plays on PC (keyboard / gamepad) **and** phone (touch, landscape).

## Platform constraints (hard rules — the artifact viewer enforces them)
- The final page is HTML **without** `<!doctype>`, `<html>`, `<head>`, `<body>` tags (the host wraps it). Start
  with `<title>Kit Rush 3D</title>` and `<meta name="claude:viewport-fit-sides" content="cover">`, then
  `<link>`s, `<style>`, markup, scripts.
- External scripts ONLY: `<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>`
  (Three.js r128, UMD global `THREE`). No other library, no ES modules, no GLTF/loader files, no images/fonts
  from other hosts. Fonts: Google Fonts `Lilita One` only (link already used by the 2D game). Everything else is
  procedural (geometry, CanvasTexture, shaders) and inline.
- r128 API notes: use `THREE.BufferGeometry` (no `THREE.Geometry`), `renderer.outputEncoding = THREE.sRGBEncoding`,
  `renderer.toneMapping = THREE.ACESFilmicToneMapping`, `THREE.InstancedMesh` exists, `mesh.onBeforeCompile`
  works for shader injection, `CapsuleGeometry` does NOT exist in r128 (build from cylinder+spheres or lathe).
- No `alert/confirm/prompt`, no `window.open`, no downloads. `localStorage` only inside try/catch.
- Sound starts only after a user gesture. Respect `prefers-reduced-motion` for screen shake / camera bob.
- Body/background must be explicitly colored; the layout must work at phone width in landscape and portrait,
  side gutter `padding-left/right: max(16px, env(safe-area-inset-left/right, 0px))` on body; fixed controls add
  safe-area insets. The page is a single dark stage (single-theme by design: `color-scheme: dark`).
- Performance budget: 60 fps on a mid-range laptop, ≥30 fps on a mid-range phone. Pixel ratio
  `min(devicePixelRatio, 2)` desktop / `min(dpr, 1.5)` touch; one directional shadow map (2048 desktop,
  1024 touch) whose camera follows the player; fog to hide far geometry; instancing for repeated props/rings;
  target < 300 draw calls. Adaptive: if average frame time > 24 ms for 2 s, drop pixel ratio by 0.25 (min 0.75).

## File layout (all in this folder: `kit3d/`)
| file | owner | content |
|---|---|---|
| `00-shell.html` | CORE | title/meta/fonts/`<style>`/DOM (`#stage`, `canvas#gl`, `canvas#hud`, tool buttons, touch UI), three.js `<script src>`, then the opening `<script>` and `'use strict'; const K = {};` |
| `10-core.js` | CORE | `K.util`, `K.store`, `K.view` (renderer/scene/camera/resize), `K.input`, `K.audio` |
| `20-world.js` | WORLD | `K.world` + fills `K.level` |
| `30-player.js` | PLAYER | `K.player`, `K.camera` |
| `40-entities.js` | ENTITIES | `K.entities`, `K.fx` |
| `90-main.js` | CORE | `K.game`, HUD/screens on `#hud`, main loop, boot, closing `</script>` |

Final assembly = concatenation in that order → `kit-rush-3d.html`. Every `.js` part MUST wrap its code in
`(() => { ... })();` and only communicate through the shared `K` object (no other globals, no name clashes).
Modules may reference each other's functions only at call time (inside functions), never at module top level,
because load order is core → world → player → entities → main. `K.boot()` in 90-main.js runs everything.

Local test harness: Three.js r128 is vendored at `kit3d/vendor/three.min.js` (byte-identical to the cdnjs
file). The CDN is NOT reachable from this sandbox, so Playwright tests must
`page.route('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', r => r.fulfill({path: <abs path to vendor/three.min.js>, contentType: 'application/javascript'}))`.
Google Fonts are also unreachable in tests (fallback font is fine). Headless Chromium WebGL works (SwiftShader).
Use Node `require('playwright')` (already installed; browsers at /opt/pw-browsers; never run `playwright install`).
For tests, wrap the HTML in `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>…</body></html>` and expose
`window.__K = K` only in the test copy (string-replace), never in the shipped file.

## Conventions
- Units: 1 unit ≈ 1 m. Y is up. The level's main route runs from the start toward **−Z** (north).
- Fixed timestep: every `update(dt)` receives `dt = 1/60` s. Velocities are units/second.
- Vectors are `THREE.Vector3`. Avoid per-frame allocations in hot paths (reuse scratch vectors).
- Kit is ~1.25 units tall; collision = vertical capsule radius 0.45, height 1.2, `pos` = feet.

## The contract (names and signatures are binding)

### CORE — `10-core.js`
```
K.util = { clamp(v,a,b), lerp(a,b,t), smooth(t) /*smoothstep 0..1*/, damp(a,b,lambda,dt) /*a + (b-a)*(1-exp(-lambda*dt))*/,
           angleDiff(a,b) /*shortest signed b-a in radians*/, hash(n) /*deterministic 0..1*/, rng(seed) /*returns fn()→0..1*/ }
K.store = { get(key, dflt), set(key, value) }            // localStorage JSON, prefix 'kitrush3d.', try/catch
K.view  = { renderer, scene, camera /*PerspectiveCamera fov 62, near .1, far 900*/, W, H /*css px of the game area*/,
            dpr, isTouch, hud /*2D context of #hud, already scaled so 1 unit = 1 css px*/, onResize: [] /*callbacks(W,H)*/ ,
            init() /*creates renderer on #gl with antialias, shadows (PCFSoft), sRGB, ACES, exposure 1.05; resize handling*/ }
K.input = {
  poll(),                    // call exactly once per fixed tick, first thing
  move: {x, y},              // analog stick, |move| ≤ 1, deadzone applied; x = right, y = forward (W/ArrowUp/stick up)
  look: {x, y},              // camera orbit request THIS tick in radians (mouse drag / right stick / touch drag / Q,E keys)
  held: {jump, action, start, pause},
  hit(name),                 // rising edge this tick for 'jump' | 'action' | 'start' | 'pause'
  isTouch()                  // true once touch UI is shown
}
// Keys (use event.code so AZERTY works physically): move = Arrows + KeyW/A/S/D; jump = Space, KeyJ, KeyK;
// action (crouch/roll/spin-dash) = ShiftLeft, ShiftRight, KeyC, KeyX; camera = KeyQ / KeyE (orbit), mouse drag on canvas;
// start = Enter; pause = Escape, KeyP; mute = KeyM.  Gamepad: left stick/dpad move, right stick look,
// button 0 jump, buttons 1/2 action, 9 start.  Touch: analog joystick bottom-left, big SAUT button and smaller
// ROULER button bottom-right, drag anywhere else on the screen to orbit the camera, tap = start on menus.
K.audio = { init(), sfx(name, arg), playMusic('main'|'boss'|'clear'|'over'), stopMusic(), setSpeed(f), toggleMute(), muted }
// Port the 2D game's Web Audio engine and ORIGINAL compositions verbatim from ../kit/p2.js and ../kit/p3.js
// (same sfx names: jump ring spin release roll skid hurt lose pop spring monitor check bosshit boom item oneup die
// tick button bounce) and add 'homing' (short rising whoosh) and 'dash' (dash-panel zip). Mute persists via K.store.
```

### WORLD — `20-world.js`
```
K.world = {
  build(scene),              // creates EVERYTHING static and fills K.level (below). Called once at boot after K.view.init().
  update(dt, t),             // water/cloud animation, moving platforms (update solids + meshes), sun shadow follow
  setFocus(vec3),            // the point the sun shadow camera should center on (player), called each tick by main
  terrainY(x, z),            // heightfield height (fast; bilinear from a precomputed grid)
  ground(x, z, yTop),        // highest walkable surface at (x,z) whose height ≤ yTop (+0.05): considers terrain AND the
                             // TOP faces of K.world.solids (platforms, bridges, pillars, arena). Returns a reused object
                             // {y, n: Vector3 unit normal, solid: ref|null} or null when there is nothing (bottomless pit).
  collideWalls(pos, radius, height),  // pushes pos (feet) horizontally out of solid SIDES (AABB vs vertical capsule)
                             // and out of terrain that is too steep to walk (normal.y < 0.55). Returns {hit, nx, nz}.
  solids: [],                // [{min: Vector3, max: Vector3, delta: Vector3 /*movement this tick*/, kind, mesh}]
  deathY,                    // falling below this kills (pits, sea)
  loopPoint(loop, theta, out) // see loops below; out = {pos: Vector3, up: Vector3 (toward loop center), fwd: Vector3}
}
K.level = {
  start: {pos, yaw}, checkpoints: [{pos, yaw}],          // yaw: radians, 0 = facing −Z
  rings: [Vector3],                                      // ring centers (~1.1 above walkable surface)
  enemies: [{type: 'bug'|'wasp'|'fish', pos, range, dir?}],  // bug patrols on ground; wasp hovers & shoots; fish jumps from water
  springs: [{pos, dir /*unit*/, power /*u/s*/, lock /*s*/}],
  dashPanels: [{pos, dir /*unit horizontal*/, speed}],
  monitors: [{pos, kind: 'ring'|'shield'|'shoes'|'star'|'life'}],
  spikes: [{pos, sx, sz}],                               // optional hazards (axis-aligned footprint)
  loops: [{entry /*ground point at the loop's bottom*/, dir /*unit travel dir*/, side /*unit lateral*/, radius, shift /*lateral offset gained over the loop*/, minSpeed}],
  boss: {center, radius}, capsule: {pos}
}
```
Loops: a vertical circle whose bottom is `entry`; parameter `theta ∈ [0, 2π]`, `theta = 0` at the entry, rising
forward along `dir`, lateral offset `side * shift * theta/(2π)` so the exit doesn't hit the entry (corkscrew-style
ramp-in/ramp-out is fine). `loopPoint` returns the running-surface point, the surface normal pointing to the loop
center, and the tangent. The world builds a beautiful mesh for it (checkerboard band + grass running surface,
rails) and keeps the ground continuous before/after.

### PLAYER — `30-player.js`
```
K.player = {
  create(scene),             // builds Kit's 3D model (procedural, rigged with Groups: body, head, ears, tail, arms, legs, shoes, scarf)
  init(pos, yaw),            // reset state at a spawn point (alive, no powers kept except what K.game says)
  update(dt),                // controls + physics + animation; reads K.input, K.world, K.level.loops, K.entities.homingTarget
  pos, vel,                  // Vector3 feet position and velocity (u/s)
  onGround, ball,            // ball = attacking shape (jump, roll, spin dash, homing attack)
  forward,                   // unit Vector3 facing
  dead, invT, star, shoes, shield,   // invT/star/shoes are seconds remaining
  homing,                    // true while homing-attacking
  center(),                  // Vector3 body center (~0.6 above feet), reused object
  radius: 0.5,
  isAttacking(),             // ball || star > 0
  bounce(vy),                // after destroying an enemy/monitor from the air: vel.y = vy, re-enable homing
  hurt(fromPos),             // shield → lose shield; else rings>0 → K.entities.scatterRings(center, K.game.rings), K.game.rings = 0; else kill()
  kill(reason),              // death animation then K.game.onDeath()
  launch(vel, lock, spring), // springs: set velocity, airborne, controls locked `lock` s, spring pose
  dash(dir, speed)           // dash panel: set ground velocity along dir at speed, short control lock
}
K.camera = { init(), update(dt), setMode('follow'|'loop'|'boss'|'title', opts), shake(amount) }
```
Feel targets (Sonic Adventure-like, tuned at 60 Hz): walk→run acceleration 28 u/s², top run speed 20 u/s,
absolute cap 42 u/s (slopes, dash panels), turning that tightens at low speed and widens at high speed, braking
with skid dust when stick opposes velocity, ground friction 14 u/s² with no input, gravity 42 u/s², jump 15.5 u/s
with variable height (release early → cut to 6 u/s), slope physics (downhill accelerates, uphill slows; rolling
amplifies), ground snapping so the player follows hills but launches off ramp crests at speed, steep-slope wall
sliding. **Moves**: jump (curls into a ball), **homing attack** (jump again in the air: if `homingTarget` exists dash
to it at 34 u/s, else air dash forward 22 u/s), **roll** (action while running ≥ 4 u/s), **spin dash** (hold action
while standing, tap jump to rev up to 5 levels, release action → launch 26–40 u/s rolling), **crouch** (action
standing still). Loops: when grounded, entering a loop's entry trigger with speed along `dir` ≥ `minSpeed`
(usually 14) and |lateral offset| < 2.5 → scripted traversal via `K.world.loopPoint`, speed keeps decreasing on
the way up (fall off near the top if it drops below 8), camera switches to 'loop' (side view) then back.
Camera 'follow': third-person behind/above Kit (distance 7.5, height 2.6, look-at slightly ahead), auto-realigns
behind the movement direction when the player moves and no manual look input for 1 s, manual orbit via
`K.input.look`, never goes below terrain (raise it), FOV widens a little with speed (62→72).
Kit's model must read clearly at a distance: smooth shaded (MeshStandardMaterial / MeshToonMaterial with a
gradientMap for an Adventure-era cel look — choose one and be consistent), dark outline via back-face hull
(scaled inverted mesh) optional. Animations: idle breathing + tail wag, walk, run (arms back, tail streaming),
"peel-out" leg wheel at ≥ 17 u/s, ball spin (sphere with fur stripes + blur ring), spin-dash rev, skid, spring
pose (arms up), fall, hurt, death (X eyes), victory (thumbs up / tail flick). Blob shadow under the feet in
addition to real shadows. Afterimages when shoes are active, sparkles when `star`, bubble when `shield`.

### ENTITIES — `40-entities.js`
```
K.entities = {
  build(scene),              // meshes for everything in K.level except terrain/solids (rings instanced!)
  reset(),                   // after a death: restore enemies/rings/monitors/boss; checkpoints keep K.game.cpIndex state
  update(dt, t),             // animation + interactions with K.player (see below)
  homingTarget(pos, fwd),    // nearest attackable within 15 u, in front (dot ≥ 0.35), not far below; returns {pos: Vector3, ref} | null
  scatterRings(center, n),   // up to 32 lost rings that bounce on K.world.ground, collectable after 1 s, vanish after 4.5 s
  bossInfo()                 // {active, hp, max} for the HUD
}
K.fx = { burst(pos, kind /*'boom'|'bigboom'|'spark'|'dust'|'twinkle'|'splash'*/, n) }   // pooled particles/sprites
```
Interactions (all inside `K.entities.update`): rings (collect radius 1.3 → `K.game.addRings(1)` + spark),
enemies (touch while `K.player.isAttacking()` → destroy: explosion, freed animal (bunny/bird) hops away,
`K.game.addScore(100…1000 chain, pos)`, `K.player.bounce(9)` if airborne; otherwise `K.player.hurt(pos)`),
wasp shots, fish jumping from water, springs (`K.player.launch(dir*power, lock, true)`), dash panels
(`K.player.dash(dir, speed)`), monitors (attacking → break, item pops up then `K.game.applyItem(kind)`,
bounce if airborne; not attacking → solid box you can stand on / push against: register as K.world.solids entry
of kind 'monitor' and remove it when broken), spikes (hurt), checkpoints/star posts (pass → `K.game.setCheckpoint(i)`,
lamp spins and turns blue), boss and capsule (below).
**Boss — Dr Boulon**: dormant until the player enters `K.level.boss` radius → `K.game.onBossStart()` (main
switches music & camera to 'boss'). The pod hovers ~4.5 u above the arena floor, circles the arena and
periodically drifts toward the player; a spiked wrecking ball on a chain orbits/swings below it (hurts).
Hittable only with an attack (jump/homing/star) on the pod: 8 hits, 1.2 s invulnerable flashing after each,
the player is bounced away. Phase 2 (≤ 4 hp): faster, ball orbit wider, drops 3 bouncing bombs every few
seconds. Defeat: chained explosions 2.5 s, pod flees upward smoking → `K.game.onBossDefeated()`, the capsule
(animal prison with a big yellow button) lands at `K.level.capsule.pos`; jumping on the button opens it, frees
~10 animals → after 2.5 s `K.game.onCapsule()`.

### MAIN — `90-main.js`
```
K.game = { state /*'title'|'card'|'play'|'results'|'over'|'end'*/, paused, rings, score, lives, time /*s*/,
           cpIndex /*-1 = start*/, bossDone, best /*{time, score} from K.store*/,
           addRings(n), addScore(n, worldPos?), applyItem(kind), setCheckpoint(i), onDeath(), onBossStart(),
           onBossDefeated(), onCapsule() }
K.boot()   // init view, audio hooks, world.build, player.create, entities.build, camera.init, start the loop
```
Fixed-step loop (accumulator, max 4 steps/frame) → per tick in 'play': `K.input.poll(); K.player.update; K.entities.update;
K.world.setFocus(K.player.pos); K.world.update; K.camera.update`, timer, 100 rings → 1UP, time-over at 10:00.
Render: `renderer.render(scene, camera)` then the 2D HUD on `#hud` (sized to the same area as `#gl`, crisp at dpr).
HUD (Lilita One, italic-skewed yellow labels with navy outline like the 2D game): SCORE / TEMPS / ANNEAUX
(flash red at 0), lives box with Kit's head icon, power-up timers, boss name "DR BOULON" + 8 pips, a pulsing
homing reticle drawn at the projected `homingTarget` while airborne, speed lines at very high speed.
Screens: title (slow orbit of the island, big "KIT RUSH 3D" logo with gold gradient + extrude, "COLLINES ÉMERAUDE"
ribbon, blinking "Appuie sur Espace pour jouer" / "Touche l'écran pour jouer", controls line, record line),
act card ("COLLINES ÉMERAUDE" + "ACTE 1" badge sliding in), pause, results tally (BONUS TEMPS / BONUS
ANNEAUX / SCORE, counting with tick sound), game over, end screen ("MERCI D'AVOIR JOUÉ !", time, score, record).
Death → respawn at the last checkpoint (rings 0, time restored to checkpoint time) with `K.entities.reset()`.
Tool buttons (sound, pause, fullscreen) and visibility-change auto-pause like the 2D game.
Hot reload: `window.claude?.hot?.snapshot(() => ({...}))` and boot through
`window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {})`.

## Level design — "Collines Émeraude, Acte 1" (WORLD owns geometry & placements)
An island in a sparkling sea, ~700 u long (start at z ≈ 0, boss arena near z ≈ −640), playable in 2–3 minutes,
with a clear main route (a winding emerald valley/causeway ~22 u wide, bordered by checkerboard cliffs and hills
so players naturally stay on course) and optional side spots with monitors. Sections in order:
1. **Plage de départ** (z 0 → −60): sunny plateau, palms, totems, ring lines teaching the route, 2 ladybug robots, a ring monitor.
2. **Vallée des tournesols** (−60 → −160): rolling bumps, 2 dash panels, ring arcs over bumps, sunflowers, a wasp.
3. **Looping 1** (≈ −170): a straight with a dash panel just before a big loop (radius 7).
4. **Falaises en damier** (−200 → −280): a spring launches onto a higher cliff; checkerboard pillars; a chasm
   (death pit) crossed by 3 platforms (one moving); a chain of 3 wasps over the gap for homing-attack chaining;
   checkpoint 1 after the chasm.
5. **Grande descente** (−290 → −420): long downhill with dash panels and ring trails, a launch ramp over a lake
   (fish jumping), landing zone; shield monitor on a side ledge.
6. **Pont des piranhas** (−420 → −470): wooden plank bridge (solids) over water with 2 fish; checkpoint 2 after.
7. **Looping 2 + tremplins** (−480 → −560): second loop, then springs and a homing chain of 3 enemies across a
   gap, speed-shoes monitor, invincibility monitor, a 1UP hidden on a pillar top.
8. **Arène du Dr Boulon** (≈ −640): checkpoint 3 before it; a circular grass plateau radius 26 with a
   checkerboard rim, low walls/cliff edge (falling off = sea = death), sea all around.
Rings: ~250 total. Decorations instanced: palms (with swaying fronds), sunflowers (spinning heads), purple
flowers, bushes, rocks, fox-face totems, distant waterfalls on cliffs, floating clouds, birds circling.
Sky: gradient dome (deep blue zenith → pale horizon), big soft sun with glow sprite, sea with animated waves,
specular glints and shoreline foam, distant islands/mountains silhouettes, light fog matching the horizon.
Terrain look: emerald grass with subtle variation on gentle slopes, crisp brown/orange checkerboard (≈ 2.5 u
squares, world-space triplanar-ish in the shader) on steep faces and cliffs, a grass lip where they meet.

## Art direction
Bright, saturated, sunny Dreamcast-era Green Hill vibe rendered cleanly in HD: soft shadows, gentle ambient
(hemisphere sky blue / grass green bounce), warm sun, ACES tone mapping, sRGB. Gold rings with metallic shine
spinning. Readable silhouettes. No placeholder grey boxes left in the final game.
