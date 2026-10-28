// probe: per preset, per spot (the e2e budget spots), draw calls / tris and a tally of draws by object (main vs shadow)
const K = __K, G = K.game, R = K.view.renderer;
T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300);
const spots = [[0, -10], [-6, -100], [K.level.boss.center.x, K.level.boss.center.z + 20]];
const tally = {}; let on = false;
const be = R.backend, draw0 = be.draw.bind(be);
be.draw = function (ro, info) {
  if (on) {
    const o = ro.object, main = ro.camera === K.view.camera;
    const nm = (o.name || o.type) + '|' + (ro.material.type || '');
    const k = (main ? 'M ' : 'S ') + nm;
    tally[k] = (tally[k] || 0) + 1;
  }
  return draw0(ro, info);
};
const out = {};
const presets = (window.__presets || 'ultra,high,medium,low').split(',');
for (const q of presets) {
  K.post.setQuality(q);
  const per = [];
  for (const [x, z] of spots) {
    T.teleport(x, z, T.routeDirYaw(x, z), 0); T.ticks(30); T.renderNow();
    for (const k in tally) delete tally[k];
    on = true; T.renderNow(); on = false;
    const d = T.drawStats();
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 14).map(e => e[1] + ' ' + e[0]);
    const nM = Object.entries(tally).filter(e => e[0][0] === 'M').reduce((a, e) => a + e[1], 0), nS = Object.entries(tally).filter(e => e[0][0] === 'S').reduce((a, e) => a + e[1], 0);
    per.push({ calls: d.calls, tris: d.tris, main: nM, shadow: nS, top: window.__top ? top : undefined });
  }
  out[q] = per;
}
K.post.setQuality('high');
be.draw = draw0;
return out;
