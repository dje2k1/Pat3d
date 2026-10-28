// draw-call / triangle tally per object group at the e2e budget spots (+ extra spots), main camera vs shadow passes
const K = __K, G = K.game, R = K.view.renderer;
T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300);
const spots = (window.__spots || [[0, -10], [-6, -100], [K.level.boss.center.x, K.level.boss.center.z + 20], [0, -233], [0, -352]]);
const tally = {}; let on = false;
const be = R.backend, draw0 = be.draw.bind(be);
const grp = o => {
  let n = o.name || '';
  for (let q = o; q && !n; q = q.parent) n = q.name || '';
  if (n.startsWith('w-')) return 'world';
  if (n.startsWith('kit')) return 'kit';
  if (n.startsWith('e-')) return n;
  return 'other:' + o.type + ':' + (o.material && o.material.type) + ':' + (o.geometry && o.geometry.index ? o.geometry.index.count : 0);
};
be.draw = function (ro, info) {
  if (on) {
    const o = ro.object, main = ro.camera === K.view.camera;
    const g = ro.geometry, ic = o.count > 1 ? o.count : 1;
    let tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    if (g.drawRange && g.drawRange.count !== Infinity) tris = Math.min(tris, g.drawRange.count / 3);
    const k = (main ? 'M ' : 'S ') + grp(o);
    const t = tally[k] || (tally[k] = [0, 0]);
    t[0]++; t[1] += tris * ic;
  }
  return draw0(ro, info);
};
const out = {};
for (const q of (window.__presets || 'ultra,medium').split(',')) {
  K.post.setQuality(q);
  const per = [];
  for (const [x, z] of spots) {
    T.teleport(x, z, T.routeDirYaw(x, z), 0); T.ticks(30); T.renderNow();
    for (const k in tally) delete tally[k];
    on = true; T.renderNow(); on = false;
    const d = T.drawStats();
    const sum = { Mworld: 0, Sworld: 0, Mkit: 0, Skit: 0, Mother: 0, Sother: 0, Ment: 0, Sent: 0 };
    for (const k in tally) {
      const s = k[0], g = k.slice(2);
      const c = g === 'world' ? 'world' : g === 'kit' ? 'kit' : g.startsWith('e-') ? 'ent' : 'other';
      sum[s + c] += tally[k][0];
    }
    const top = Object.entries(tally).sort((a, b) => b[1][0] - a[1][0]).slice(0, 30).map(e => e[1][0] + 'x ' + Math.round(e[1][1] / 1000) + 'k ' + e[0]);
    per.push({ at: [x, z], calls: d.calls, tris: d.tris, sum, top });
  }
  out[q] = per;
}
K.post.setQuality('high');
be.draw = draw0;
return out;
