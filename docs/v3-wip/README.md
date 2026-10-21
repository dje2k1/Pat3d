# Kit Rush 3D v3 — work in progress (paused)

v3 ports the game to three.js 0.186.1 (WebGPURenderer, WebGL 2 fallback, TSL) and upgrades the art.
The live site (`main`) still serves v2. This branch holds v3 so far. The contract is `docs/SPEC3.md`, including
its "Foundation notes" section.

## Status (paused at the user's request to save usage credits)

| Step | State | Notes |
|---|---|---|
| Foundation (r186 vendored, WebGPU boot, all parts ported to TSL, K.tex, K.vehicles, tests) | done | `foundation-report.json` |
| Post + VFX (`src/15-post.js`, `src/16-vfx.js`) | done | `post-report.json`, `dev/post/STATUS.md` |
| Kit + skateboard (`src/30-player.js`, `src/35-board.js`) | done | `kit-report.json`, `dev/kit/STATUS.md` |
| Act 1 world (`src/20-world.js`) | started (textures, harness; terrain material in progress) | `dev/world/STATUS.md` |
| Act 2 city (`src/25-city.js`) | not started | |
| Vehicles (`src/26-vehicles.js`) | not started | |
| Entities (`src/40-entities.js`) | not started | |
| Integrate, review (gameplay + visual), fix | not started | |

## Resuming

`workflow-v3.js` is the full workflow script (foundation → 6 builders → integrate → 2 reviewers → fix).
When resuming, skip the finished steps: drop the foundation call (use `foundation-report.json` as its result),
and keep only the world, city, vehicles and entities builders, followed by integrate, review and fix.
Every builder resumes from its `dev/<role>/STATUS.md` (RESUME NOTES). `workflow-post-finish.js` shows how a
single-builder run was made.
