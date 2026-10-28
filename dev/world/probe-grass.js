const K = __K, G = K.game;
T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300);
T.ticks(10);
const D = K.world._dbg(), GR = D.GR;
const out = { meshes: GR.meshes.map(g => ({ vis: g.mesh.visible, ic: g.mesh.geometry.instanceCount, N: g.N, origin: g.origin.value.toArray(), inScene: !!g.mesh.parent })) };
const P = K.player.pos; out.kit = P.toArray();
const T2 = D.T, ix = Math.round((P.x - T2.XMIN)), iz = Math.round((P.z - T2.ZMIN));
const d = GR.tex.image.data, i = (iz * T2.NX + ix) * 4;
out.tex = [THREE.DataUtils.fromHalfFloat(d[i]), THREE.DataUtils.fromHalfFloat(d[i + 1]), THREE.DataUtils.fromHalfFloat(d[i + 2]), THREE.DataUtils.fromHalfFloat(d[i + 3])];
let nz = 0; for (let k = 1; k < d.length; k += 4) if (THREE.DataUtils.fromHalfFloat(d[k]) > 0.1) nz++;
out.densNonZero = nz;
try {
  const sh = await K.view.renderer.debug.getShaderAsync(K.view.scene, K.view.camera, GR.meshes[0].mesh);
  out.vs = sh.vertexShader.slice(-2500);
} catch (e) { out.err = String(e); }
return out;
