# Kit Rush 3D v3 — work in progress (paused)

v3 ports the game to three.js 0.186.1 (WebGPURenderer, WebGL 2 fallback, TSL) and upgrades the art.
The live site (`main`) still serves v2. This branch holds v3 so far. The contract is `docs/SPEC3.md`, including
its "Foundation notes" section.

## Status (paused at the user's request on 2026-10-28, to resume the following week)

| Step | State | Notes |
|---|---|---|
| Foundation (r186 vendored, WebGPU boot, all parts ported to TSL, K.tex, K.vehicles, tests) | done | `foundation-report.json` |
| Post + VFX (`src/15-post.js`, `src/16-vfx.js`) | done | `post-report.json`, `dev/post/STATUS.md` |
| Kit + skateboard (`src/30-player.js`, `src/35-board.js`) | done | `kit-report.json`, `dev/kit/STATUS.md` |
| Act 1 world (`src/20-world.js`) | done | `dev/world/report.json`, `dev/world/STATUS.md` |
| Act 2 city (`src/25-city.js`) | done | `dev/city/report.json`, `dev/city/STATUS.md` |
| Vehicles (`src/26-vehicles.js`) | done | `dev/vehicles/report.json`, `dev/vehicles/STATUS.md` |
| Entities (`src/40-entities.js`) | done | `dev/entities/report.json`, `dev/entities/STATUS.md` |
| Integrate | done (see `dev/integrator/report.json`, `dev/integrator/STATUS.md`): requests resolved, e2e WebGL 2 + WebGPU green, budgets measured, README / screenshots / SPEC3 notes updated | `dev/integrator/STATUS.md`, prompt `dev/lead/prompt-integrate.md` |
| Review (gameplay + visual) | done (2026-11-03): 1 blocker, 5 major, 6 minor | `dev/review-{gameplay,visual}/report.json` |
| Fix | done (2026-11-03): 12/12 findings fixed, WebGL 2 e2e 99/99, WebGPU 6/6 | `dev/fixer3/report.json` |
| Lead verification, publish | done (2026-11-03): WebGPU 6/6, WebGL 2 v3+fix3+present 23/23; `main` fast-forwarded to v3 | v2 stays at `legacy/` |

## Resuming

v3 is published on `main` (GitHub Pages); v2 stays playable at `legacy/`.


`workflow-v3.js` is the full workflow script (foundation → 6 builders → integrate → 2 reviewers → fix).
When resuming, skip the finished steps: drop the foundation call (use `foundation-report.json` as its result),
and keep only the world, city, vehicles and entities builders, followed by integrate, review and fix.
Every builder resumes from its `dev/<role>/STATUS.md` (RESUME NOTES). `workflow-post-finish.js` shows how a
single-builder run was made.
