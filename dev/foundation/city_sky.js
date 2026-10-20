const SKY_UNI = {
  uSun: uniform(SUN_DIR.clone()), uTime: U.time, uHDR: U.hdr,
  uZen: uniform(lin('#27306a')), uMid: uniform(lin('#b87e8e')), uHor: uniform(lin('#ffb27a')),
  uHaze: uniform(lin(FOG_HEX)), uSunCol: uniform(lin('#ffd2a0'))
};
// golden-hour sky toward direction d (unit vec3 node); clouds: 0..1 (JS number)
// PORT(city): v2 GLSL skyCol ported 1:1 (gradient, warm sun azimuth, haze below the horizon, altocumulus streaks);
// v3: physical sky (SkyMesh / TSL) with the PMREM fed from it.
function skyCol(d, hdr, t, clouds) {
  const S = SKY_UNI, h = d.y;
  const sd = tmax(tdot(d, S.uSun), 0);
  const az = tpow(tmax(tdot(tnormalize(vec3(d.x, 0, d.z).add(1e-5)), tnormalize(vec3(S.uSun.x, 0, S.uSun.z))), 0), 2);
  const hor = mix(mix(S.uHaze, vec3(0.62, 0.45, 0.55), 0.35), S.uHor, az);
  let col = mix(mix(hor, S.uMid, smoothstep(0.0, 0.22, h)), S.uZen, smoothstep(0.12, 0.75, h));
  col = col.add(vec3(1.0, 0.5, 0.18).mul(tpow(sd, 6)).mul(0.55).mul(float(1).sub(smoothstep(-0.05, 0.4, h))));
  col = select(h.lessThan(0), mix(col, S.uHaze.mul(0.9), smoothstep(0.0, -0.08, h)), col);
  if (clouds > 0) {
    const cp = d.xz.div(tmax(h.add(0.12), 0.05));
    const n = TL.vnoise(cp.mul(1.3).add(vec2(t.mul(0.01), 0))).mul(0.55).add(TL.vnoise(cp.mul(3.1).sub(vec2(t.mul(0.02), 0))).mul(0.3)).add(TL.vnoise(cp.mul(vec2(7, 15))).mul(0.15));
    const band = smoothstep(0.03, 0.12, h).mul(float(1).sub(smoothstep(0.35, 0.6, h)));
    const c = smoothstep(0.52, 0.78, n).mul(band);
    const lit = mix(vec3(1.0, 0.55, 0.42), vec3(1.0, 0.78, 0.5), az).mul(hdr.mul(1.2).mul(az).add(0.9));
    col = mix(col, mix(vec3(0.42, 0.33, 0.48), lit, smoothstep(0.55, 0.85, n)), c.mul(0.85 * clouds));
  }
  return col;
}
function skyMaterial() {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
  const S = SKY_UNI, hdr = S.uHDR;
  const d = tnormalize(positionGeometry);
  let col = skyCol(d, hdr, S.uTime, 1);
  const sd = tmax(tdot(d, S.uSun), 0);
  col = col.add(S.uSunCol.mul(tpow(sd, 900).mul(1.6).add(tpow(sd, 90).mul(0.45)).add(tpow(sd, 12).mul(0.12))));
  col = col.add(S.uSunCol.mul(hdr).mul(smoothstep(0.99955, 0.9998, sd).mul(22).add(tpow(sd, 400).mul(2))));
  m.colorNode = mix(tmin(col, vec3(1)), col, hdr);
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(positionLocal.add(cameraPosition), 1));
  m.vertexNode = vec4(clip.xy, clip.w.mul(0.99999), clip.w);
  return m;
}
// PORT(city): v2 GLSL bay water ported 1:1 (wave normals, Fresnel sky reflection, sun glitter path); v3: SSR,
// depth colour, foam along the piers and the sea wall.
function waterMaterial() {
  const m = new THREE.MeshBasicNodeMaterial({ fog: true });
  const S = SKY_UNI, hdr = S.uHDR, t = S.uTime;
  const uDeep = uniform(lin('#123447')), uShallow = uniform(lin('#2e5f6e'));
  const wp = positionWorld, p = positionGeometry.xz;
  const Vd = tnormalize(cameraPosition.sub(wp));
  const dist = tlength(cameraPosition.sub(wp));
  let g = vec2(0.8, 0.3).mul(tcos(tdot(p, vec2(0.11, 0.05)).add(t.mul(1.1))).mul(0.12))
    .add(vec2(-0.3, 0.9).mul(tcos(tdot(p, vec2(-0.04, 0.17)).add(t.mul(1.4))).mul(0.09)))
    .add(vec2(0.6, -0.7).mul(tcos(tdot(p, vec2(0.31, -0.27)).add(t.mul(2.2))).mul(0.05)))
    .add(vec2(TL.vnoise(p.mul(0.9).add(t.mul(0.6))), TL.vnoise(p.mul(0.9).sub(t.mul(0.5)).add(7))).sub(0.5).mul(0.16))
    .add(vec2(TL.vnoise(p.mul(3.3).sub(t.mul(0.9))), TL.vnoise(p.mul(3.3).add(t.mul(1.1)).add(3))).sub(0.5).mul(0.08));
  g = g.mul(mix(float(1), float(0.35), smoothstep(80.0, 900.0, dist)));
  const N = tnormalize(vec3(g.x.negate(), 1, g.y.negate()));
  const fr = tpow(float(1).sub(tmax(tdot(N, Vd), 0)), 5).mul(0.98).add(0.02);
  const Rr = treflect(Vd.negate(), N);
  const refl = skyCol(vec3(Rr.x, tabs(Rr.y), Rr.z), hdr, t, 0.6);
  const base = mix(uShallow, uDeep, smoothstep(0.0, 0.6, Vd.y));
  let col = mix(base.mul(0.55), refl, tclamp(fr.mul(1.15), 0, 1));
  const Hh = tnormalize(S.uSun.add(Vd));
  const nh = tmax(tdot(N, Hh), 0);
  const sp = tpow(nh, 260).mul(hdr.mul(5).add(1.4)).add(tpow(nh, 40).mul(0.18));
  const sparkle = tstep(0.86, TL.hash21(tfloor(p.mul(2)).add(tfloor(t.mul(6))))).mul(tpow(nh, 30)).mul(hdr.mul(6).add(0.8));
  col = col.add(S.uSunCol.mul(sp.add(sparkle)).mul(vec3(1.0, 0.82, 0.6)));
  m.colorNode = mix(tmin(col, vec3(1)), col, hdr);
  return m;
}
// camera-facing billboard: clip position of an instance centre c (local vec3 node) with the quad corner scaled by size
const billboard = (c, size) => cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(c, 1)).add(vec4(positionGeometry.xy.mul(size), 0, 0)));
const viewDepth = c => modelViewMatrix.mul(vec4(c, 1)).z.negate();
