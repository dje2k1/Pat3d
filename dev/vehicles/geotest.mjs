// node dev/vehicles/geotest.mjs : builds every vehicle model in Node (no renderer) -> triangle counts, bounds vs VT
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import fs from 'fs';
let src = fs.readFileSync(new URL('../../src/26-vehicles.js', import.meta.url), 'utf8');
src = src.replace(/^import .*$/m, '');
const K = { cityLib: { hash: x => (Math.sin(x * 12.9898) * 43758.5453) % 1, C_WHITE: new THREE.Color(1, 1, 1) } };
new Function('THREE', 'TSL', 'K', 'vehRoundedBox', src)(THREE, TSL, K, RoundedBoxGeometry);
const V = K.vehicles;
const out = [];
for (let t = 0; t < 8; t++) for (const lod of [0, 1]) {
  const g = V._dbg.geometry(t, lod);
  g.computeBoundingBox();
  const b = g.boundingBox, vt = V.VT[t];
  const ka = g.attributes.aKind, kinds = {};
  for (let i = 0; i < ka.count; i++) kinds[ka.getX(i)] = (kinds[ka.getX(i)] || 0) + 1;
  let nan = 0; const pa = g.attributes.position.array; for (const v of pa) if (!Number.isFinite(v)) nan++;
  out.push(`${vt.name.padEnd(6)} lod${lod} tris ${String(g.index.count / 3).padStart(5)} verts ${String(g.attributes.position.count).padStart(5)} nan ${nan} x[${b.min.x.toFixed(3)},${b.max.x.toFixed(3)}] y[${b.min.y.toFixed(3)},${b.max.y.toFixed(3)}] z[${b.min.z.toFixed(3)},${b.max.z.toFixed(3)}]  VT ±${vt.hx} 0..${(vt.hy * 2).toFixed(2)} ±${vt.hz}`);
}
console.log(out.join('\n'));
try { V.material(); console.log('material ok'); } catch (e) { console.log('material error', e.stack); }
console.log(JSON.stringify(V._dbg.PARTS));
