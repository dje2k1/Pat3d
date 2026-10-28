const K = __K, G = K.game;
T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300); T.ticks(5);
const out = {};
const scene = K.view.scene;
const groups = { grass: ['w-grass'], decor: ['w-decor', 'w-foliage'], sea: ['w-sea'], terrain: ['w-terrain'], sky: ['w-sky'] };
const time = () => { T.sync(); const t0 = performance.now(); for (let i = 0; i < 3; i++) { T.renderNow(); } T.sync(); return Math.round((performance.now() - t0) / 3); };
for (const [x, z] of [[0, -10], [-6, -100]]) {
  T.teleport(x, z, T.routeDirYaw(x, z), 0); T.ticks(30); T.renderNow();
  const r = { all: time() };
  for (const [g, names] of Object.entries(groups)) {
    const objs = []; scene.traverse(o => { if (names.includes(o.name) && o.visible) objs.push(o); });
    objs.forEach(o => o.visible = false); r['-' + g] = time(); objs.forEach(o => o.visible = true);
  }
  out[x + ',' + z] = r;
}
return out;
