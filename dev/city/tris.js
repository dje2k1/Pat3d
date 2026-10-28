const K = __K, cam = K.view.camera, fr = new THREE.Frustum(), m4 = new THREE.Matrix4();
cam.updateMatrixWorld(); m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); fr.setFromProjectionMatrix(m4);
const rows = [];
K.view.scene.traverseVisible(o => {
  if (!o.isMesh || !o.geometry) return;
  const g = o.geometry, idx = g.index ? g.index.count : g.attributes.position.count;
  let tris = idx / 3;
  if (o.isInstancedMesh) tris *= o.count;
  if (g.isInstancedBufferGeometry) tris *= g.instanceCount;
  if (!g.boundingSphere) g.computeBoundingSphere();
  const vis = o.frustumCulled === false || fr.intersectsObject(o);
  rows.push({ name: (o.name || o.material.type) + (o.parent && o.parent.name ? '@' + o.parent.name : ''), tris: Math.round(tris), vis, cast: !!o.castShadow });
});
const agg = {};
for (const r of rows) { const k = r.name; agg[k] = agg[k] || { n: 0, tris: 0, visTris: 0, cast: 0 }; agg[k].n++; agg[k].tris += r.tris; if (r.vis) agg[k].visTris += r.tris; if (r.cast) agg[k].cast += r.tris; }
return Object.entries(agg).sort((a, b) => b[1].visTris - a[1].visTris).slice(0, 25);
