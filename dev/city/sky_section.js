const SUN_DIR = new V3(-0.92, 0.2, -0.33).normalize();
const SUN_HEX = '#ffb47a';
const FOG_HEX = '#d9a184';
const SKY_UNI = {
  uSun: uniform(SUN_DIR.clone()), uTime: U.time, uHDR: U.hdr,
  uZen: uniform(lin('#232a63')), uMid: uniform(lin('#b47d93')), uHor: uniform(lin('#ffb27a')),
  uHaze: uniform(lin(FOG_HEX)), uSunCol: uniform(lin('#ffd2a0'))
};
// cloud fbm: value noise, 5 octaves, rotated between octaves (no grid streaks)
function skyFbm(p, oct) {
  let s = float(0), a = 0.5, q = p, tot = 0;
  for (let i = 0; i < oct; i++) {
    s = s.add(TL.vnoise(q).mul(a)); tot += a; a *= 0.5;
    q = vec2(q.x.mul(1.6).sub(q.y.mul(1.2)), q.x.mul(1.2).add(q.y.mul(1.6))).add(vec2(3.1, 1.7));
  }
  return s.div(tot);
}
// golden-hour sky toward direction d (unit vec3 node); clouds: 0..1 (JS number of cloud octaves' weight)
// Gradient: warm horizon toward the low sun, the pink "belt" and the cool earth shadow opposite it, a violet zenith;
// a deck of altocumulus projected on a plane (domain-warped fbm) lit from the sun's side (gold edges near it, lavender
// undersides away from it); haze under the horizon. Branch-free (masks), shared by the dome, the bay and the PMREM.
function skyCol(d, hdr, t, clouds) {
  const S = SKY_UNI, h = d.y;
  const sd = tmax(tdot(d, S.uSun), 0);
  const hd = vec3(d.x, 0, d.z), sh = vec3(S.uSun.x, 0, S.uSun.z);
  const azc = tdot(hd.mul(inverseSqrt(tmax(tdot(hd, hd), 1e-6))), sh.mul(inverseSqrt(tmax(tdot(sh, sh), 1e-6))));
  const az = tpow(tmax(azc, 0), 2), anti = tpow(tmax(azc.negate(), 0), 1.5);
  // horizon: gold toward the sun, pink belt / cool earth shadow away from it
  const belt = vec3(0.86, 0.55, 0.62), earth = vec3(0.42, 0.42, 0.62);
  const horAway = mix(mix(S.uHaze, belt, 0.5), mix(earth, belt, smoothstep(0.02, 0.09, h)), anti);
  const hor = mix(horAway, S.uHor, az);
  let col = mix(mix(hor, S.uMid, smoothstep(0.0, 0.24, h)), S.uZen, smoothstep(0.14, 0.8, h));
  // broad warm Mie glow round the low sun
  col = col.add(vec3(1.0, 0.5, 0.2).mul(tpow(sd, 6).mul(0.5).add(tpow(sd, 24).mul(0.35))).mul(float(1).sub(smoothstep(-0.05, 0.45, h))));
  // under the horizon: haze
  col = mix(col, S.uHaze.mul(0.9), float(1).sub(smoothstep(-0.08, 0.0, h)));
  if (clouds > 0) {
    const cp = d.xz.div(tmax(h.add(0.1), 0.04)).mul(0.9);
    const wind = vec2(t.mul(0.012), t.mul(0.004));
    const warp = vec2(skyFbm(cp.mul(0.35).add(wind), 3), skyFbm(cp.mul(0.35).add(vec2(5.2, 1.3)), 3)).sub(0.5).mul(2.4);
    const q = cp.add(warp).add(wind.mul(2));
    const n = skyFbm(q, 5);
    // density toward the sun (projected): lit edges where the cloud thins toward the light
    const sdir = vec2(S.uSun.x, S.uSun.z).mul(0.35);
    const n2 = skyFbm(q.add(sdir), 5);
    const band = smoothstep(0.025, 0.1, h).mul(float(1).sub(smoothstep(0.42, 0.75, h)));
    const cov = mix(float(0.5), float(0.42), TL.vnoise(cp.mul(0.12)));
    const c = smoothstep(cov, cov.add(0.22), n).mul(band);
    const lightT = tclamp(n.sub(n2).mul(5).add(0.55), 0, 1);
    const litC = mix(vec3(1.0, 0.56, 0.5), vec3(1.0, 0.74, 0.42), az).mul(hdr.mul(1.1).mul(az).add(0.95));
    const shadeC = mix(vec3(0.38, 0.31, 0.47), vec3(0.55, 0.36, 0.42), az);
    let cc = mix(shadeC, litC, lightT);
    // silver lining: thin cloud edges next to the sun
    const edge = c.mul(float(1).sub(c)).mul(4).mul(tpow(sd, 10)).mul(hdr.mul(2.5).add(0.6));
    cc = cc.add(vec3(1.0, 0.75, 0.45).mul(edge));
    col = mix(col, cc, c.mul(0.9 * clouds));
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
  // the disc (limb-darkened) and its core, HDR so the bloom and the lens flare pick it up
  const disc = smoothstep(0.99955, 0.9998, sd);
  col = col.add(S.uSunCol.mul(hdr).mul(disc.mul(smoothstep(0.99955, 0.99995, sd).mul(0.4).add(0.6)).mul(22).add(tpow(sd, 400).mul(2))));
  m.colorNode = mix(tmin(col, vec3(1)), col, hdr);
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(positionLocal.add(cameraPosition), 1));
  m.vertexNode = vec4(clip.xy, clip.w.mul(0.99999), clip.w);
  return m;
}
// The bay: the golden-hour sky reflected analytically (crisp clouds, Fresnel), wind waves (directional swells + two
// noise ripple layers, calmer with distance), a dark teal body with sun-side scattering, the sun's glitter path and
// sparkles (HDR), foam where the water meets the piles, the sea wall and the piers (scene depth, when the pipeline runs),
// and screen-space reflections of the city and the bridge on Ultra / Élevé (K.post.ssr; the wave normal goes to the
// G-buffer through normalNode). Transparent (drawn after the opaque scene so it can read its depth), depth-writing.
function waterMaterial() {
  const m = new THREE.MeshBasicNodeMaterial({ fog: true, transparent: true, depthWrite: true });
  const S = SKY_UNI, hdr = S.uHDR, t = S.uTime;
  const uDeep = uniform(lin('#0f2f3f')), uShallow = uniform(lin('#2b6670'));
  const wp = positionWorld, p = wp.xz;
  const Vd = tnormalize(cameraPosition.sub(wp));
  const dist = tlength(cameraPosition.sub(wp));
  let g = vec2(0.8, 0.3).mul(tcos(tdot(p, vec2(0.11, 0.05)).add(t.mul(1.1))).mul(0.11))
    .add(vec2(-0.3, 0.9).mul(tcos(tdot(p, vec2(-0.04, 0.17)).add(t.mul(1.4))).mul(0.085)))
    .add(vec2(0.6, -0.7).mul(tcos(tdot(p, vec2(0.31, -0.27)).add(t.mul(2.2))).mul(0.05)))
    .add(vec2(-0.9, -0.2).mul(tcos(tdot(p, vec2(-0.52, 0.21)).add(t.mul(2.9))).mul(0.03)))
    .add(vec2(TL.vnoise(p.mul(0.9).add(t.mul(0.6))), TL.vnoise(p.mul(0.9).sub(t.mul(0.5)).add(7))).sub(0.5).mul(0.15))
    .add(vec2(TL.vnoise(p.mul(3.3).sub(t.mul(0.9))), TL.vnoise(p.mul(3.3).add(t.mul(1.1)).add(3))).sub(0.5).mul(0.08))
    .add(vec2(TL.vnoise(p.mul(8.1).add(t.mul(1.7))), TL.vnoise(p.mul(8.1).sub(t.mul(1.3)).add(11))).sub(0.5).mul(0.035));
  g = g.mul(mix(float(1), float(0.3), smoothstep(60.0, 900.0, dist)));
  const N = tnormalize(vec3(g.x.negate(), 1, g.y.negate()));
  const fr = tpow(float(1).sub(tmax(tdot(N, Vd), 0)), 5).mul(0.97).add(0.03);
  const Rr = treflect(Vd.negate(), N);
  const refl = skyCol(vec3(Rr.x, tabs(Rr.y), Rr.z), hdr, t, 0.7);
  // body: dark teal, a little lighter on the wave faces lit through by the low sun
  const scat = tpow(tmax(tdot(Vd, vec3(S.uSun.x, 0, S.uSun.z).negate().normalize()), 0), 3).mul(tclamp(g.x.mul(S.uSun.x).add(g.y.mul(S.uSun.z)).mul(-3).add(0.3), 0, 1));
  const base = mix(uShallow, uDeep, smoothstep(0.0, 0.6, Vd.y)).mul(0.6).add(vec3(0.25, 0.45, 0.35).mul(scat).mul(0.35));
  let col = mix(base, refl, tclamp(fr.mul(1.1), 0, 1));
  const Hh = tnormalize(S.uSun.add(Vd));
  const nh = tmax(tdot(N, Hh), 0);
  const sp = tpow(nh, 280).mul(hdr.mul(5.5).add(1.4)).add(tpow(nh, 40).mul(0.2));
  const sparkle = tstep(0.86, TL.hash21(tfloor(p.mul(2)).add(tfloor(t.mul(6))))).mul(tpow(nh, 30)).mul(hdr.mul(6).add(0.8));
  col = col.add(S.uSunCol.mul(sp.add(sparkle)).mul(vec3(1.0, 0.82, 0.6)));
  // foam where something stands in the water (opaque depth just behind the surface)
  let foam = float(0);
  const sdN = K.post && typeof K.post.sceneDepth === 'function' ? K.post.sceneDepth() : null;
  if (sdN && TSL.perspectiveDepthToViewZ && TSL.cameraNear && TSL.cameraFar) {
    const zs = TSL.perspectiveDepthToViewZ(sdN.x, TSL.cameraNear, TSL.cameraFar);
    const thick = tmax(positionView.z.sub(zs), 0);
    const fn = TL.vnoise(p.mul(1.6).add(vec2(t.mul(0.3), t.mul(-0.2)))).mul(0.6).add(TL.vnoise(p.mul(5.3).sub(t.mul(0.5))).mul(0.4));
    foam = float(1).sub(smoothstep(0.0, 1.6, thick.add(fn.mul(0.9)))).mul(smoothstep(0.25, 0.6, fn.add(float(1).sub(smoothstep(0.0, 0.5, thick)).mul(0.5)))).mul(float(1).sub(smoothstep(150.0, 400.0, dist)));
    foam = foam.toVar('cFoam');
  }
  col = mix(col, vec3(0.95, 0.9, 0.86).mul(mix(float(0.8), float(1.1), hdr)), foam.mul(0.85));
  m.colorNode = mix(tmin(col, vec3(1)), col, hdr);
  m.normalNode = tnormalize(cameraViewMatrix.mul(vec4(N, 0)).xyz);
  if (K.post && typeof K.post.ssr === 'function') {
    try { K.post.ssr(m, float(0.9).mul(float(1).sub(foam)), 0.03); } catch (e) { console.warn('Kit Rush 3D: water SSR opt-in failed', e); }
  }
  return m;
}
