# INTEGRATOR STATUS (role dir dev/integrator, owns every file; no git commit/push)

## RESUME NOTES
- Started 2026-10-27 22:00. Read: prompt-integrate.md, SPEC3 (+Foundation notes), SPEC/SPEC2, all 7 reports and
  every STATUS "Requests for integrator".
- Baseline: HEAD 737cf21, ./build.sh OK (index.html 1109757 B). Baseline full WebGL 2 e2e running ->
  dev/integrator/logs/base-gl.log.

## PLAN / CHECKLIST (x = done + verified)
- [ ] K.tex: dispose GPU texture when the image size changes (1x1 fallback -> WebP, full <-> half swap on preset
      change) [kit request 1; real bug on runtime preset switch on WebGL 2]; preload 'common' with 'act1' [kit 2]
- [ ] 90-main: K.post.compileAsync() after precompile (boot + Act 2) [post]; results DOF on [post]; Act 2 loading
      card progress bar (G.loadP) [lead]; pause row "Mise à l'échelle" optional [post]
- [ ] build.sh specs(): skip comment lines -> FSR1Node static import possible [post]
- [ ] post: cyan glare looking into the low sun; bright close car lamps / blue lens ghost on Ultra
- [ ] sun/shadow consistency between acts (city 'cheap' = 1024 like the island?)
- [ ] e2e: pending Moyen -> check(); lawn-seam re-target (robust to noise); post passes per preset; vehicles check;
      game-over check independent of the boss block; screenshot motion-blur artefact (frames after skipped ticks)
- [ ] SPEC3 Foundation notes: post API, world (layer 5, K.world.sun), city KIND 22-24, vehicles, entities
- [ ] Full WebGL 2 e2e green; WebGPU suite green
- [ ] Budgets per preset with numbers (calls, tris, texture MB, assets MB, Act 1 / Act 2 download)
- [ ] Fresh screenshots in shots/ (title, A1 start/loop/lake/boss/results, A2 hill/traffic/works/pier/orbit/flight/
      goal, Kit close-ups, vehicle line-up, each preset, phone Moyen A1+A2, WebGPU vs WebGL 2 pair); Read + fix
- [ ] 8 JPEGs in docs/screenshots/ (same names); README.md (French, v3); sub-path /Pat3d/ check
- [ ] report.json

## LOG
