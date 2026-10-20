function fogMesh() {
  const R = rng(4242), pts = [];
  // a bank along the ocean side of the bridge, thinning over the bay
  for (let k = 0; k < 46; k++) {
    const z = lerp(BRIDGE.zA + 60, BRIDGE.zB - 120, R());
    const x = BRIDGE.x - 60 - R() * 700;
    pts.push([x, 6 + R() * 22, z, 70 + R() * 90]);
  }
  for (let k = 0; k < 14; k++) pts.push([BRIDGE.x + 40 + R() * 260, 4 + R() * 8, lerp(-1700, -2200, R()), 60 + R() * 60]);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, -1, 0.5, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const off = new Float32Array(pts.length * 4);
  pts.forEach((p, i) => off.set(p, i * 4));
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  g.instanceCount = pts.length;
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  const aOff = attribute('aOff', 'vec4');
  const c0 = aOff.xyz.add(vec3(tsin(U.time.mul(0.05).add(aOff.x)).mul(8), 0, 0));
  m.vertexNode = billboard(c0, aOff.w);
  const tx = ttexture(fogTexture(), tuv());
  const uLit = uniform(lin('#ffd4b0')), uShade = uniform(lin('#b9a3b3'));
  m.colorNode = mix(uShade, uLit.mul(mix(float(1), float(1.35), U.hdr)), smoothstep(0.2, 0.9, tuv().y));
  m.opacityNode = tx.a.mul(0.85).mul(smoothstep(30.0, 160.0, viewDepth(c0)));
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = 4;
  return mesh;
}
