import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import fs from 'fs';
let src = fs.readFileSync(new URL('../../src/26-vehicles.js', import.meta.url), 'utf8').replace(/^import .*$/m, '');
const K = { cityLib: { hash: x => 0.5, C_WHITE: new THREE.Color(1, 1, 1) } };
new Function('THREE', 'TSL', 'K', 'vehRoundedBox', src)(THREE, TSL, K, RoundedBoxGeometry);
const V = K.vehicles, t = +(process.argv[2] || 0), lod = +(process.argv[3] || 0);
const g = V._dbg.geometry(t, lod), ka = g.attributes.aKind, pa = g.attributes.position, kinds = {};
for (let i = 0; i < ka.count; i++) { const k = ka.getX(i); const o = kinds[k] || (kinds[k] = { n: 0, min: [9, 9, 9], max: [-9, -9, -9] }); o.n++; for (let c = 0; c < 3; c++) { o.min[c] = Math.min(o.min[c], pa.getComponent(i, c)); o.max[c] = Math.max(o.max[c], pa.getComponent(i, c)); } }
const names = Object.fromEntries(Object.entries(V._dbg.VK).map(([a, b]) => [b, a]));
for (const [k, o] of Object.entries(kinds)) console.log((names[k] || k).padEnd(9), String(o.n).padStart(6), o.min.map(v => v.toFixed(2)).join(','), ' .. ', o.max.map(v => v.toFixed(2)).join(','));
