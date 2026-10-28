# Kit Rush 3D v3 — work in progress (paused)

v3 ports the game to three.js 0.186.1 (WebGPURenderer, WebGL 2 fallback, TSL) and upgrades the art.
The live site (`main`) still serves v2. This branch holds v3 so far. The contract is `docs/SPEC3.md`, including
its "Foundation notes" section.

## Status (paused at the user's request, 2026-10-28, until usage credits reset)

| Step | State | Notes |
|---|---|---|
| Foundation (r186 vendored, WebGPU boot, all parts ported to TSL, K.tex, K.vehicles, tests) | done | `foundation-report.json` |
| Post + VFX (`src/15-post.js`, `src/16-vfx.js`) | done | `post-report.json`, `dev/post/STATUS.md` |
| Kit + skateboard (`src/30-player.js`, `src/35-board.js`) | done | `kit-report.json`, `dev/kit/STATUS.md` |
| Act 1 world (`src/20-world.js`) | done | `dev/world/report.json`, `dev/world/STATUS.md` |
| Act 2 city (`src/25-city.js`) | done | `dev/city/report.json`, `dev/city/STATUS.md` |
| Vehicles (`src/26-vehicles.js`) | done | `dev/vehicles/report.json`, `dev/vehicles/STATUS.md` |
| Entities (`src/40-entities.js`) | done | `dev/entities/report.json`, `dev/entities/STATUS.md` |
| Integrate | in progress (just started: plan written, small edits in `src/12-tex.js`, `src/90-main.js`) | `dev/integrator/STATUS.md`, prompt `dev/lead/prompt-integrate.md` |
| Review (gameplay + visual), fix | not started | prompts in `workflow-v3-resume.js` |

## Resuming

Next step: resume the integrator with `dev/lead/prompt-integrate.md` (it continues from `dev/integrator/STATUS.md`), then run the two reviewers and the fixer from `workflow-v3-resume.js`.


`workflow-v3.js` is the full workflow script (foundation → 6 builders → integrate → 2 reviewers → fix).
When resuming, skip the finished steps: drop the foundation call (use `foundation-report.json` as its result),
and keep only the world, city, vehicles and entities builders, followed by integrate, review and fix.
Every builder resumes from its `dev/<role>/STATUS.md` (RESUME NOTES). `workflow-post-finish.js` shows how a
single-builder run was made.
