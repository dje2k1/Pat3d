// addTo() with a plain mesh builder (no city being built): writes the far model with the city's kinds
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import fs from 'fs';
let src = fs.readFileSync(new URL('../../src/26-vehicles.js', import.meta.url), 'utf8').replace(/^import .*$/m, '');
class MB { constructor() { this.p = []; this.k = []; this.i = []; this.v = 0; } vert(x, y, z, nx, ny, nz, c, k) { this.p.push(x, y, z); this.k.push(k); return this.v++; } get count() { return this.v; } }
const K = { cityLib: { hash: x => 0.5, C_WHITE: new THREE.Color(1, 1, 1), KIND: { plain: 0, glass: 20, metal: 9, glow: 10 } } };
new Function('THREE', 'TSL', 'K', 'vehRoundedBox', src)(THREE, TSL, K, RoundedBoxGeometry);
const mb = new MB();
for (let t = 0; t < 8; t++) K.vehicles.addTo(mb, t, new THREE.Matrix4().makeTranslation(t * 10, 0, 0), new THREE.Color(0.5, 0.1, 0.1));
const kinds = {}; for (const k of mb.k) kinds[k] = (kinds[k] || 0) + 1;
console.log('verts', mb.v, 'tris', mb.i.length / 3, 'kinds', JSON.stringify(kinds), 'maxIndex ok', Math.max(...mb.i) < mb.v);
