export const meta = {
  name: 'kit-rush-3d-v3',
  description: 'Port Kit Rush 3D to three.js r186 (WebGPU + TSL), upgrade Kit, scenery, vehicles and textures; integrate, review, fix',
  phases: [
    { title: 'Foundation', detail: 'vendor r186, WebGPU boot, mechanical port, vehicles split, K.tex, tests' },
    { title: 'Build', detail: 'post+vfx, Kit, Act 1, city, vehicles, entities in parallel' },
    { title: 'Integrate', detail: 'merge, full e2e on WebGL 2 and WebGPU, budgets, README' },
    { title: 'Review', detail: 'gameplay/platform and visual quality reviewers' },
    { title: 'Fix', detail: 'apply verified findings, retest' },
  ],
}

const D = '/home/user/pat3d'
const V2SHOTS = '/tmp/claude-0/-home-user/608f9dd0-d109-57d1-b4c1-e900c9677b3d/scratchpad/kit3d/shots'

const COMMON = `You are working on "Kit Rush 3D", a free-roaming 3D platformer (original characters: Kit the fox, Dr Boulon) for a French user who plays on PC and phone. It is published on GitHub Pages from the git repo ${D} (GitHub dje2k1/Pat3d, branch main). We are building v3: a port from three.js r128 to three.js r186 WebGPURenderer (WebGPU, with the renderer's own WebGL 2 backend as fallback) with TSL node materials, an "Unreal-like" post stack, generated PBR textures and much better looking Kit, scenery and vehicles. Gameplay must not change.
MANDATORY first reads: ${D}/docs/SPEC3.md (v3 contract, read fully; the "Foundation notes" section at its end, once it exists, holds the concrete APIs and conventions), then the parts of ${D}/docs/SPEC.md and ${D}/docs/SPEC2.md relevant to your role (gameplay contracts, module APIs, tests). The v2 source of any file is available with \`git -C ${D} show 9bcf15d:src/<file>\` (v2 = three r128, the live version before v3); v2 screenshots for comparison: ${V2SHOTS}/*.png.
Environment: Node 22, Playwright 1.56.1 with Chromium (PLAYWRIGHT_BROWSERS_PATH is set; never run "playwright install"), Python 3 with numpy and Pillow (WebP ok, no scipy), npm registry reachable; CDNs and asset sites are blocked, so everything is vendored or generated. 4 CPUs shared with one other agent that may be running browser tests at the same time: local HTTP servers must listen on port 0 (or a free port), keep browser runs lean, close browsers.
Rules: do NOT git commit, push, reset, checkout, stash or clean (the lead commits). Only edit the files your role owns (listed below); if you need a change elsewhere, write it under "Requests for integrator" in your STATUS.md and work around it meanwhile. Usage limits can kill you at any time: keep ${D}/dev/<your-role>/STATUS.md updated after every milestone with RESUME NOTES (done / verified / next). If that file already exists when you start, you are resuming: read it and continue, don't redo verified work. Put probes, harness scripts and scratch screenshots in ${D}/dev/<your-role>/ (gitignored).
Quality bar: screenshots you take must look clearly and obviously better than v2 (closer to a modern AAA game) while staying within SPEC3 budgets on every preset, on phone (landscape, touch) as well as desktop. Read your own screenshots (Read the PNG files) and iterate on what looks wrong. Report honestly: what you verified, how, and what is left.`

const RUN_SCHEMA = { type: 'object', properties: {
  summary: { type: 'string' },
  tests: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, pass: { type: 'boolean' }, notes: { type: 'string' } }, required: ['name', 'pass'] } },
  screenshots: { type: 'array', items: { type: 'string' } },
  fixed: { type: 'array', items: { type: 'string' } },
  remaining_issues: { type: 'array', items: { type: 'string' } },
}, required: ['summary', 'tests', 'remaining_issues'] }

const BUILD_SCHEMA = { type: 'object', properties: {
  role: { type: 'string' },
  summary: { type: 'string' },
  files: { type: 'array', items: { type: 'string' } },
  tests: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, pass: { type: 'boolean' }, notes: { type: 'string' } }, required: ['name', 'pass'] } },
  screenshots: { type: 'array', items: { type: 'string' } },
  integration_todo: { type: 'array', items: { type: 'string' } },
  known_issues: { type: 'array', items: { type: 'string' } },
}, required: ['role', 'summary', 'files', 'tests', 'known_issues'] }

const FIND_SCHEMA = { type: 'object', properties: {
  verdict: { type: 'string' },
  findings: { type: 'array', items: { type: 'object', properties: {
    title: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
    file: { type: 'string' }, evidence: { type: 'string' }, fix_hint: { type: 'string' } },
    required: ['title', 'severity', 'evidence'] } },
}, required: ['verdict', 'findings'] }

// ---------------------------------------------------------------- Foundation
phase('Foundation')
const found = await agent(`${COMMON}
ROLE: FOUNDATION (role dir dev/foundation). You own everything at this stage (no one else is running), but leave the deep per-area work to the builders that come after you.
Goal: v3 boots and plays both acts on three.js 0.186.1 WebGPURenderer, on the WebGL 2 backend and on WebGPU, with placeholder materials where the v2 GLSL is not yet ported, and every gameplay e2e check green. Then the six builders (post+vfx, kit, world, city, vehicles, entities) can work in parallel on their own files.
Do, in order (SPEC3 §1, §2, §4, §7):
1. Freeze v2 into legacy/ (legacy/index.html and legacy/kit-rush-3d.html, copied from the current built files; they keep loading r128 from cdnjs/jsDelivr) and make sure legacy/index.html still runs as-is.
2. Vendor three@0.186.1 from npm into lib/three/ (build/three.webgpu.js, three.core.js, three.tsl.js; addons the game will use: tsl/display/* nodes for post (GTAO, SSGI, SSR, Bloom, Godrays, Lensflare, DepthOfField, MotionBlur, TRAA, TAAU, FSR1, Sharpen, FXAA, SMAA and their helpers), csm/CSMShadowNode (+ deps), objects/SkyMesh, WaterMesh or Water2Mesh, any math/utils they import). Keep relative layout so their bare 'three/webgpu' and 'three/tsl' imports resolve through the import map. Minify with esbuild only if it really saves bytes and still works.
3. New build.sh: index.html (full document per SPEC3 §1: doctype, lang fr, meta, title, styles + HUD markup from src/00-shell.html, import map, ONE <script type="module"> = imports of THREE/TSL/addons + the concatenated parts), test.html (same + window.__K = K), checks (parts parse, no onBeforeCompile/ShaderMaterial/RawShaderMaterial/EffectComposer/gl_FragColor/#include < in src, no external URL except Google Fonts, every imported file exists under lib/). Keep src/ parts as IIFEs sharing K.
4. Renderer bootstrap (src/10-core.js K.view + src/90-main.js boot): WebGPURenderer, await init, ?gl forces WebGL 2, K.view.backend, resize/DPR, device-lost handling, French error screen linking legacy/, render loop unchanged (rAF), loading screen while init + assets load.
5. Mechanical r128 -> r186 migration of ALL src parts so the game runs: every onBeforeCompile / ShaderMaterial / EffectComposer use replaced by a node-material placeholder that approximates the v2 look (vertex colours, simple TSL where trivial), each marked "// PORT(<role>): <what the v2 GLSL did>" (roles: post, vfx->post, world, city, vehicles, kit, entities); colour management (outputColorSpace, texture colorSpace), physically based light units rebalanced so both acts look at least sane, renamed/removed APIs fixed. K.post: minimal RenderPipeline (scene pass + tone mapping output) keeping the whole K.post API callable (stubs ok) + K.gfx skeleton (presets, knobs, onChange) per SPEC3 §3.
6. Extract the vehicles out of src/25-city.js into a new part src/26-vehicles.js (K.vehicles: VT, vehicleTop, build(type, opts) -> geometry/material(s) for instancing, paint palette, lamp/blink hooks) with traffic in 25-city.js consuming it — byte-for-byte same behaviour, same VT/vehicleTop/collisions.
7. K.tex (new src/12-tex.js) + tools/tex/texlib.py per SPEC3 §4, with PER-ROLE manifests assets/tex/<role>/manifest.json merged at runtime (builders run in parallel, so no shared manifest file) and one small sample texture proving the pipeline (generated, loaded, colour space right, half/full sets).
8. Tests: test/serve.js (static server on port 0), test/e2e.js + test/page-helpers.js adapted (http URL, async boot, WebGL 2 backend default via ?gl, Chromium flags from SPEC3 §7, a --webgpu flag to run on the WebGPU backend). All gameplay checks green on WebGL 2; list any visual/post check that is pending on builder work (re-target it to v3 intent, don't delete it). Add: backend check, WebGPU boot smoke (Act 1 + Act 2 play a few seconds, no errors), legacy page loads.
9. Append a "Foundation notes" section to docs/SPEC3.md: concrete APIs (K.view, K.post stubs + K.gfx, K.tex, K.vehicles), placeholder/PORT conventions with the list of PORT markers per file and role, how to run the game and the tests (commands, flags, --only suites, typical durations), and r186 gotchas you hit (TSL patterns that work in both backends, instancing colour, shadows, PMREM).
Report with RUN_SCHEMA: summary, tests (with real results), remaining_issues (anything builders must know).`, { label: 'foundation', phase: 'Foundation', schema: RUN_SCHEMA })

const foundDigest = `\nFoundation report (read docs/SPEC3.md "Foundation notes" for details):\n${JSON.stringify(found || { summary: 'foundation agent returned nothing: read dev/foundation/STATUS.md' }).slice(0, 6000)}`

// ---------------------------------------------------------------- Build
phase('Build')
const BUILDERS = [
  { key: 'post', label: 'build:post+vfx', prompt: `ROLE: POST + VFX (role dir dev/post). You own src/15-post.js (K.post, K.gfx) and src/16-vfx.js (K.vfx), and the post/vfx rows of the pause menu only through requests (90-main.js belongs to the integrator; the foundation left the rows working).
Build the full "Unreal-like" pipeline of SPEC3 §3 with THREE.RenderPipeline and the TSL display nodes: MRT scene pass, GTAO, SSGI (Ultra), SSR (Ultra/Élevé; it must work for any material that opts in — publish a simple opt-in, e.g. a material flag or MRT output, in SPEC3 Foundation notes / your STATUS for world/city/vehicles), HDR bloom, godrays + lens flare for the sun (both acts; sun direction from the scene's sun light), DOF in cinematics (bumper orbit, results), motion blur at speed, TRAA, Super Résolution (internal resolution + TAAU, FSR1 + sharpen fallback), AgX/ACES tone mapping + our grade, vignette, grain, chromatic aberration, letterbox, flash, speed streaks. Presets Ultra/Élevé/Moyen/Économie with K.gfx knobs + onChange, persisted, switchable live from the pause menu without leaks, Moyen default on touch. Keep every K.post API used by other parts working (SPEC2). Port 16-vfx.js particles to TSL (instanced sprites, additive HDR), same K.vfx API, same particle budgets, no leaks.
Verify on BOTH backends: e2e suites post + vfx + leak checks green, preset switching stress (no geometry/texture/pipeline growth), screenshots of each preset in Act 1 and Act 2 (and a phone Moyen view), TAAU/FSR sharpness vs native, ghosting check during fast motion, cost per preset (passes, internal resolution). Document the K.post/K.gfx/SSR opt-in API in your STATUS.md and return it in the report.` },
  { key: 'kit', label: 'build:kit', prompt: `ROLE: KIT (role dir dev/kit). You own the rendering side of src/30-player.js (Kit's model, materials, animation visuals, camera code stays as is) and src/35-board.js (board look only), plus tools/tex/kit_*.py and assets/tex/kit/. Do NOT change Kit's physics, controller, collision sizes, pivot or timings.
Port the PORT(kit) placeholders to TSL, then make Kit look great per SPEC3 §5: smooth high-quality body, shell fur (count from K.gfx.furShells, motion/wind lag, no shimmering under TRAA), fur textures, fluffy tail and cheek tufts, expressive eyes (iris, cornea highlight, blinking), glossy nose, outfit with fabric materials, SSS/wrap lighting and rim light, a detailed skateboard (deck graphics, grip tape, trucks, wheels). All poses and animations (idle, run, jump/ball, spin dash, homing, hurt, skate, tricks, flight) must read well; Kit stays the same size and silhouette.
Verify: turntable and in-game close-ups (title, Act 1 run, jump, Act 2 skate, flight) on Élevé and Ultra, phone Moyen view, both backends; draw calls/triangles budget for Kit (state numbers); e2e player-related checks still green (run --only suites that cover Act 1 movement and Act 2 board).` },
  { key: 'world', label: 'build:act1-world', prompt: `ROLE: WORLD / ACT 1 (role dir dev/world). You own src/20-world.js (Act 1 island: terrain, cliffs, path, sea, sky, vegetation, loops/ramps/bridges visuals, K.world API) plus tools/tex/world_*.py and assets/tex/world/. Do NOT move or resize anything the physics uses (ground, loops, ramps, colliders, level data).
Port the PORT(world) placeholders to TSL (terrain splat/checker shading, lawn stripes as a subtle mowing pattern without the old centre seam, cliffs, water, sky), then upgrade per SPEC3 §5: generated PBR textures (grass, soil, rock, sand, bark, leaves, wood/metal for structures) with normal + ORM, instanced grass blades near the camera with wind (density from K.gfx), rock and flower dressing, convincing water (depth colour, foam, SSR opt-in, caustics), lusher palms, sky with clouds feeding scene.environment, sun light/shadows (CSM on Ultra/Élevé) tuned for a bright tropical morning.
Verify on both backends: the v2 Act 1 viewpoints (start valley, loops, lake, cliffs, boss arena) side by side with v2 shots, desktop Élevé + Ultra and phone Moyen, budgets (draw calls, triangles, texture MB), no tiling repetition visible at play distance, e2e Act 1 suites green.` },
  { key: 'city', label: 'build:act2-city', prompt: `ROLE: CITY / ACT 2 (role dir dev/city). You own src/25-city.js (Act 2 San Francisco: streets, houses, props, land, bay, bridge, sky, rings/bumper/goal visuals, traffic logic) plus tools/tex/city_*.py and assets/tex/city/. Vehicles' looks belong to the vehicles role (src/26-vehicles.js); keep using K.vehicles. Do NOT change the route, profile, colliders, traffic behaviour or timings.
Port the PORT(city) placeholders (the "kind" uber-shader: siding, windows, shingles, asphalt, paint lines, slabs, brick, metal, glow, leaves, …) to TSL — texture arrays/atlases of generated PBR materials are welcome — then upgrade per SPEC3 §5: Victorian houses with wood siding, trims, shingles, glass with interior mapping, asphalt with cracks/patches/worn lines/manholes and wet puddles (SSR opt-in), sidewalks and curbs, lamps, trees, the red suspension bridge, bay water, golden-hour sky and sun with CSM shadows; keep shaded streets readable (v2 rule: road luma p10 >= 30).
Verify on both backends: the v2 Act 2 viewpoints (hill top, traffic, intersection air, trick, pier/bumper, orbit, flight, goal) vs v2 shots, desktop Élevé + Ultra and phone Moyen, budgets, e2e act2 + regress2 suites green.` },
  { key: 'vehicles', label: 'build:vehicles', prompt: `ROLE: VEHICLES (role dir dev/vehicles). You own src/26-vehicles.js (K.vehicles, created by the foundation) plus tools/tex/vehicles_*.py and assets/tex/vehicles/. Keep VT half extents, vehicleTop() and every collision value exactly as they are; keep instancing and the K.vehicles API the city uses (extend it only compatibly).
Port the PORT(vehicles) placeholders (per-instance paint, blinking amber lamps, head/tail lights) to TSL, then rebuild every vehicle per SPEC3 §5: sedan, taxi, van, delivery van (hazard lights), bus, cable car, tram, road-works barriers: real shapes (rounded bodies, wheel arches, bumpers, separate glass), detailed wheels (tread, rims), chrome trims, emissive lights that bloom, plates, clearcoat metallic paint with flakes (MeshPhysicalNodeMaterial), glass reflecting the sky (SSR opt-in), near/far LOD. Visual size must match the collision boxes (cars must not look bigger or smaller than what hits Kit).
Verify on both backends: a vehicle line-up turntable (each type, a few paints), in-traffic Act 2 views vs v2 (shots 24, 43, 44, 45), phone Moyen, budgets (instanced draw calls, triangles at LOD), e2e act2 + regress2 suites green.` },
  { key: 'entities', label: 'build:entities', prompt: `ROLE: ENTITIES (role dir dev/entities). You own src/40-entities.js (rings, enemies, springs, bumpers, dash panels, monitors, star posts, boss Dr Boulon, capsule, lost rings, explosions fallback) plus tools/tex/entities_*.py and assets/tex/entities/. Do NOT change any gameplay value (positions, radii, timings, boss pattern).
Port the PORT(entities) placeholders to TSL, then upgrade per SPEC3 §5: polished gold rings (env reflections + bloom glint, instanced, cheap), robot enemies in painted metal with emissive eyes and panel detail, chrome/rubber springs and bumpers, monitors with glowing screens, the boss machine (metal panels, rivets, glass dome, pilot), star posts, capsule; all PBR with generated textures where it helps.
Verify on both backends: close-ups and in-game views (rings line, enemies, springs, monitors, boss fight, capsule) vs v2 shots, phone Moyen, budgets, e2e Act 1 suites (rings, enemies, boss, capsule) green.` },
]
const built = await parallel(BUILDERS.map(b => () => agent(`${COMMON}\n${b.prompt}\nFinish with: ./build.sh passes, the e2e suites for your area pass on the WebGL 2 backend and your area boots on WebGPU, your STATUS.md is complete (incl. Requests for integrator), and you return BUILD_SCHEMA.${foundDigest}`, { label: b.label, phase: 'Build', schema: BUILD_SCHEMA })))
const reports = BUILDERS.map((b, i) => ({ role: b.key, report: built[i] }))
const buildDigest = JSON.stringify(reports.map(r => ({ role: r.role, report: r.report || 'agent returned nothing: read dev/' + r.role + '/STATUS.md' }))).slice(0, 14000)

// ---------------------------------------------------------------- Integrate
phase('Integrate')
const integ = await agent(`${COMMON}
ROLE: INTEGRATOR (role dir dev/integrator). You now own every file. The foundation and six builders have finished (reports below; also read each dev/<role>/STATUS.md, especially "Requests for integrator").
Do: resolve every request and cross-module issue (K.gfx onChange wiring, SSR opt-ins, sun/shadow consistency between acts, preset defaults, pause menu rows for presets/Super Résolution/backend/"Version classique" link, loading progress for Act 1 assets and Act 2 assets). ./build.sh clean. Full e2e on the WebGL 2 backend: every check green (74 v2 checks with the same meaning + v3 checks). WebGPU suite green. Asset and performance budgets of SPEC3 §4/§6 measured per preset and reported with numbers (draw calls, triangles, texture MB, assets MB, Act 1 / Act 2 download sizes). Fresh screenshot set in ${D}/shots/ (gitignored): title, Act 1 start/loop/lake/boss/results, Act 2 hill top/traffic/works island/pier bumper/orbit/flight/goal, Kit close-ups, a vehicles line-up, each preset, phone Moyen Act 1 + Act 2, one WebGPU vs WebGL 2 pair; Read them and fix what looks wrong. Also copy 8 good screenshots as JPEG into docs/screenshots/ (replace the v2 ones, same file names or update README). Update README.md in French for v3 (what's new, WebGPU/WebGL 2, presets and Super Résolution, controls, build/test, legacy link "Version classique", credits). Make sure the site works when served from a sub-path like /Pat3d/ (relative URLs only).
Builder reports:
${buildDigest}
Return RUN_SCHEMA with real test results and honest remaining issues.`, { label: 'integrate+test', phase: 'Integrate', schema: RUN_SCHEMA })
const integDigest = JSON.stringify(integ || { summary: 'integrator returned nothing: read dev/integrator/STATUS.md' }).slice(0, 8000)

// ---------------------------------------------------------------- Review
phase('Review')
const LENSES = [
  { key: 'gameplay', prompt: `ROLE: REVIEWER — GAMEPLAY, PLATFORM, PERFORMANCE (role dir dev/review-gameplay). Read-only on src/, lib/, assets/ (write only in your role dir). Adversarial: try to break v3. Play both acts with real input events (keyboard, touch pointer events on the on-screen controls, a gamepad if you can emulate one) on the WebGL 2 backend and on WebGPU, desktop and phone landscape; compare behaviour with legacy/index.html (v2) where useful. Check: no gameplay regression (movement, loops, springs, homing, boss, skate, tricks, traffic, bumper flight, checkpoints, deaths, results, records), loading and the Act 2 loading card, renderer fallback and the error screen (simulate WebGPU missing and init failure), preset switching live (no leaks over 2+ minutes, no errors), budgets of SPEC3 §4/§6 per preset with your own measurements, site served from a sub-path (/Pat3d/), French text, persistence. Each finding needs reproducible evidence (script + numbers/screenshot paths); no speculation.` },
  { key: 'visual', prompt: `ROLE: REVIEWER — VISUAL QUALITY (role dir dev/review-visual). Read-only on src/, lib/, assets/ (write only in your role dir). Adversarial art review against SPEC3 §3 and §5 and against the v2 screenshots: is v3 clearly better looking everywhere (Kit, Act 1, Act 2, vehicles, entities, VFX, HUD readability)? Hunt artefacts on both backends and every preset: TAA/TAAU ghosting or smearing in motion, shimmering fur or grass, shadow acne/peter-panning/cascade seams, SSR/SSGI noise or leaks, z-fighting, texture seams or obvious tiling, wrong colour space (washed out or too dark), blown highlights, bloom halos, LOD popping, fake-interior or glass errors, phone readability at Moyen. Take your own screenshots and crops (in your role dir) with numbers where possible (luma, edge sharpness, frame-to-frame differences). Each finding needs evidence (screenshot paths + what to look at); no speculation.` },
]
const reviews = await parallel(LENSES.map(l => () => agent(`${COMMON}\n${l.prompt}\nIntegration report:\n${integDigest}\nReturn FIND_SCHEMA: a verdict paragraph and verified findings (blocker/major/minor) with file, evidence and fix_hint.`, { label: 'review:' + l.key, phase: 'Review', schema: FIND_SCHEMA })))
const findings = reviews.filter(Boolean).flatMap((r, i) => (r.findings || []).map(f => ({ lens: LENSES[i].key, ...f })))
log(`${findings.length} verified findings (${findings.filter(f => f.severity === 'blocker').length} blockers, ${findings.filter(f => f.severity === 'major').length} major)`)

// ---------------------------------------------------------------- Fix
phase('Fix')
const fix = await agent(`${COMMON}
ROLE: FIXER (role dir dev/fixer3). You own every file. Apply every verified finding below (blockers and majors first, then the cheap safe minors). For each: reproduce, fix the root cause, add or extend an e2e regression check. Don't widen scope except to fix regressions you cause.
Findings:
${JSON.stringify(findings, null, 1).slice(0, 30000)}
Integration report:
${integDigest}
Finish: ./build.sh, full e2e green on the WebGL 2 backend and the WebGPU suite green, budgets re-measured, fresh screenshots in shots/ (Read a few to confirm), docs/screenshots and README still accurate. Report each finding's outcome honestly with RUN_SCHEMA.`, { label: 'fix+retest', phase: 'Fix', schema: RUN_SCHEMA })

return { foundation: found, builders: reports.map(r => ({ role: r.role, summary: r.report && r.report.summary, known_issues: r.report && r.report.known_issues })), integration: integ, findings, fix }
