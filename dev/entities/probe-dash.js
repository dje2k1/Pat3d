const K = __K, G = K.game, P = K.player, W = K.world, THREE = window.THREE;
T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300);
const L = K.level.dashPanels[0], D = K.entities._dbg();
T.teleport(L.pos.x, L.pos.z + 14, 0, 0); T.ticks(10);
const out = [];
for (const p of D.POOLS) if (p.name.startsWith('e-dash')) out.push({ n: p.name, count: p.mesh.count, vis: p.mesh.visible, idx: p.slots.map(s => s.idx), bs: p.mesh.boundingSphere && [p.mesh.boundingSphere.center.toArray().map(v => +v.toFixed(1)), +p.mesh.boundingSphere.radius.toFixed(1)], m: Array.from(p.mesh.instanceMatrix.array.slice(0, 16)).map(v => +v.toFixed(2)) });
const d = D.DSH[0];
return { out, rootVis: d.root.visible, pos: d.pos, cam: K.view.camera.position };
