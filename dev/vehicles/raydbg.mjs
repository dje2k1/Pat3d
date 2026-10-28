import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import fs from 'fs';
let src = fs.readFileSync(new URL('../../src/26-vehicles.js', import.meta.url), 'utf8').replace(/^import .*$/m, '');
src = src.replace("K.vehicles = {", "K._int = { loftBody, carSpec, VB, hitOut };\nK.vehicles = {");
const K = { cityLib: { hash: x => 0.5, C_WHITE: new THREE.Color(1, 1, 1) } };
new Function('THREE', 'TSL', 'K', 'vehRoundedBox', src)(THREE, TSL, K, RoundedBoxGeometry);
const I = K._int, vb = new I.VB(), sp = I.carSpec(false), S = I.loftBody(vb, sp, 0);
for (const y of [0.5, 0.59, 0.68]) for (const x of [-0.47, -0.2, 0.0, 0.2, 0.47]) { const h = I.hitOut(S, [x, y, 0], [0, 0, 1]); console.log(x, y, h ? h.p.map(v => v.toFixed(3)).join(',') + ' n ' + h.n.map(v => v.toFixed(2)).join(',') : 'MISS'); }
const G = S.G, n = G.length;
console.log('stations', n, 'ring', G[0].length);
for (const i of [n - 3, n - 2, n - 1]) console.log(i, G[i].slice(0, 17).map(p => p.map(v => v.toFixed(3)).join(' ')).join(' | '));
