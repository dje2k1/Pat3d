// soft glow billboards (lamps, aviation lights, the lighthouse): one instanced quad, camera-facing, additive
// PORT(city): v2 GLSL billboards ported 1:1 to TSL (vertexNode); v3: real emissive lamp heads + bloom, light cones.
function glowMesh(points) {
  const n = Math.max(1, points.length);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const off = new Float32Array(n * 4);
  points.forEach((p, i) => { off[i * 4] = p[0]; off[i * 4 + 1] = p[1]; off[i * 4 + 2] = p[2]; off[i * 4 + 3] = p[3] || 0; });
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  g.instanceCount = points.length;
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const aOff = attribute('aOff', 'vec4'), kind = aOff.w;
  const c = select(kind.lessThan(0.5), vec3(1.0, 0.72, 0.38), select(kind.lessThan(1.5), vec3(1.0, 0.12, 0.08), vec3(1.0, 0.92, 0.7)));
  const blink = select(kind.greaterThan(0.5).and(kind.lessThan(1.5)), tstep(0.5, tfract(U.time.mul(0.7).add(aOff.x.mul(0.01)))).mul(0.65).add(0.35), float(1));
  const d = viewDepth(aOff.xyz);
  const size = select(kind.lessThan(0.5), float(1.1).mul(d.mul(0.004).add(1)), select(kind.lessThan(1.5), float(6), float(9)).mul(d.mul(0.0015).add(1)));
  m.vertexNode = billboard(aOff.xyz, size);
  const q = positionGeometry.xy, r = tlength(q);
  const a = texp(r.mul(r).mul(-5)).mul(0.8).add(texp(r.mul(r).mul(-40)).mul(0.6)).mul(float(1).sub(smoothstep(0.85, 1.0, r)));
  m.colorNode = c.mul(a).mul(smoothstep(2.0, 12.0, d).mul(blink)).mul(mix(float(0.55), float(1.6), U.hdr));
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = 5;
  return mesh;
}
// manhole steam: rising, growing, fading puffs lit by the sunset
function steamMesh(vents) {
  const per = 7, n = Math.max(1, vents.length * per);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const off = new Float32Array(n * 4);
  vents.forEach((v, i) => { for (let k = 0; k < per; k++) { const j = (i * per + k) * 4; off[j] = v[0]; off[j + 1] = v[1]; off[j + 2] = v[2]; off[j + 3] = k / per + v[3] * 0.13; } });
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  g.instanceCount = vents.length * per;
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  const aOff = attribute('aOff', 'vec4');
  const ph = tfract(U.time.mul(0.16).add(aOff.w));
  const c0 = aOff.xyz.add(vec3(tsin(ph.mul(6).add(aOff.w.mul(30))).mul(0.6).add(ph.mul(2.5)), ph.mul(7).add(0.2), tcos(ph.mul(5).add(aOff.w.mul(20))).mul(0.6)));
  m.vertexNode = billboard(c0, ph.mul(3.2).add(0.6));
  const q = positionGeometry.xy, r = tlength(q);
  const vA = smoothstep(0.0, 0.12, ph).mul(float(1).sub(smoothstep(0.45, 1.0, ph)));
  const uLit = uniform(lin('#ffc9a0')), uShade = uniform(lin('#9a8ea8'));
  m.colorNode = mix(uShade, uLit.mul(mix(float(1), float(1.6), U.hdr)), smoothstep(-0.6, 0.8, q.x.mul(0.7).add(q.y.mul(0.5))));
  m.opacityNode = smoothstep(1.0, 0.1, r).mul(vA).mul(0.32);
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = 6;
  return mesh;
}
