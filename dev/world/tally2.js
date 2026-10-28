const K = __K, G = K.game, R = K.view.renderer;
T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300);
const spots = (window.__spots || [[0, -10], [-6, -100], [K.level.boss.center.x, K.level.boss.center.z + 20]]);
const tally = {}; let on = false;
const be = R.backend, draw0 = be.draw.bind(be);
be.draw = function (ro, info) {
  if (on) {
    const o = ro.object, main = ro.camera === K.view.camera;
    const g = ro.geometry, ic = o.count > 1 ? o.count : 1;
    let tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    if (g.drawRange && g.drawRange.count !== Infinity) tris = Math.min(tris, g.drawRange.count / 3);
    const nm = (o.name && o.name.startsWith('w-') ? o.name : 'other:' + (o.name || o.type));
    const k = (main ? 'M ' : 'S ') + nm;
    const t = tally[k] || (tally[k] = [0, 0]);
    t[0]++; t[1] += tris * ic;
  }
  return draw0(ro, info);
};
const out = {};
for (const q of (window.__presets || 'high,medium').split(',')) {
  K.post.setQuality(q);
  const per = [];
  for (const [x, z] of spots) {
    T.teleport(x, z, T.routeDirYaw(x, z), 0); T.ticks(30); T.renderNow();
    for (const k in tally) delete tally[k];
    on = true; T.renderNow(); on = false;
    const d = T.drawStats();
    const top = Object.entries(tally).sort((a, b) => b[1][1] - a[1][1]).map(e => e[1][0] + 'x ' + Math.round(e[1][1] / 1000) + 'k ' + e[0]);
    per.push({ calls: d.calls, tris: d.tris, top });
  }
  out[q] = per;
}
K.post.setQuality('high');
be.draw = draw0;
return out;
