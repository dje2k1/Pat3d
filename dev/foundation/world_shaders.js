  // ======================= shared shader bits (TSL) =======================
  const { Fn, uniform, attribute, vec2, vec3, vec4, float, mix, smoothstep, clamp: tclamp, abs: tabs, max: tmax, min: tmin, fract: tfract,
    sin: tsin, cos: tcos, pow: tpow, exp: texp, dot: tdot, normalize: tnormalize, cross: tcross, reflect: treflect, length: tlength,
    atan: tatan, select, dFdx, dFdy, positionWorld, positionLocal, positionGeometry, normalWorld, normalViewGeometry, cameraPosition,
    cameraViewMatrix, cameraProjectionMatrix, instanceIndex, texture: ttexture, step: tstep } = TSL;
  const TL = K.tsl;
  const TIME = uniform(0);
  const CAMXZ = uniform(new THREE.Vector2());
  const GM_UNI = {
    gmGrassA: uniform(lin('#34b846')), gmGrassB: uniform(lin('#1f8f36')),
    gmLip: uniform(lin('#16762f')), gmLipHi: uniform(lin('#8af078')),
    gmChkA: uniform(lin('#dd8a3c')), gmChkB: uniform(lin('#a35522'))
  };
  // checkerboard tile colour with bevelled edges (faded out where a square is a few pixels wide)
  const gmCheckerCol = (p, w) => {
    const c = TL.checker(p, w);
    const col = mix(GM_UNI.gmChkA, GM_UNI.gmChkB, c).toVar();
    const f = tfract(p), w2 = w.mul(1.5).add(1e-4);
    const fade = tclamp(float(1).sub(tmax(w2.x, w2.y).mul(3.5)), 0, 1);
    const hi = tmax(smoothstep(float(0.92).sub(w2.y), float(0.92).add(w2.y), f.y), float(1).sub(smoothstep(float(0.06).sub(w2.x), float(0.06).add(w2.x), f.x)));
    const lo = tmax(float(1).sub(smoothstep(float(0.06).sub(w2.y), float(0.06).add(w2.y), f.y)), smoothstep(float(0.94).sub(w2.x), float(0.94).add(w2.x), f.x));
    col.mulAssign(float(1).add(fade.mul(hi.mul(0.2).sub(lo.mul(0.26)))));
    col.mulAssign(float(0.95).add(TL.vnoise(p.mul(6)).mul(0.1)));
    return col;
  };
  // Emerald grass / lip / checkerboard ground (v2 GM shader, colour + bevel/tuft bump, ported to TSL).
  // mode: 'terrain' (heightfield: route lawn stripes, baked cavity AO), 'prop' / 'local' (aLip blend; local = checker in
  // object space), 'checker' (plain checkerboard).
  // PORT(world): v2 GLSL = this same recipe through onBeforeCompile on MeshStandardMaterial; v3 should replace it with
  // textured PBR grass/rock/soil (K.tex), grass blades and real normal detail.
  function groundMaterial(mode) {
    const m = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    const terrain = mode === 'terrain', local = mode === 'local', propLip = mode === 'prop' || mode === 'local', chkOnly = mode === 'checker';
    const gN = tnormalize(normalWorld);
    const gP = (local ? positionGeometry : positionWorld).toVar();
    const gA = tabs(gN);
    const gqY = gP.xz.mul(0.4), gqX = gP.zy.mul(0.4), gqZ = gP.xy.mul(0.4);
    const gwY = TL.fw(gqY), gwX = TL.fw(gqX), gwZ = TL.fw(gqZ);
    const gUY = gA.y.greaterThan(gA.x).and(gA.y.greaterThan(gA.z)), gUX = gA.x.greaterThan(gA.z);
    const gq = select(gUY, gqY, select(gUX, gqX, gqZ)).toVar();
    const gw = select(gUY, gwY, select(gUX, gwX, gwZ)).toVar();
    const gChk = gmCheckerCol(gq, gw);
    const gTf = tfract(gq);
    const gBv = vec2(smoothstep(0.9, 1.0, gTf.x).sub(smoothstep(0.1, 0.0, gTf.x)), smoothstep(0.9, 1.0, gTf.y).sub(smoothstep(0.1, 0.0, gTf.y)))
      .mul(tclamp(float(1).sub(tmax(gw.x, gw.y).mul(5)), 0, 1).mul(0.6));
    const gBump = select(gUY, vec3(gBv.x, 0, gBv.y), select(gUX, vec3(0, gBv.y, gBv.x), vec3(gBv.x, gBv.y, 0))).toVar();
    let colorNode;
    if (chkOnly) colorNode = gChk;
    else {
      const gn1 = TL.vnoise(gP.xz.mul(0.045)), gn2 = TL.vnoise(gP.xz.mul(0.55).add(7));
      const gGrass = mix(GM_UNI.gmGrassA, GM_UNI.gmGrassB, smoothstep(0.25, 0.8, gn1)).mul(float(0.92).add(gn2.mul(0.14))).toVar();
      let gSt = float(1).sub(gN.y);
      if (terrain) {
        // mowing stripes: a stripe is centred on the route
        const R = attribute('aRoute', 'vec3');
        const gLq = vec2(R.x.div(7), R.y.div(5.5).add(0.5));
        const lawn = TL.checker(gLq, tmin(TL.fw(gLq), vec2(0.5)));
        gGrass.mulAssign(float(1).add(lawn.sub(0.5).mul(0.09).mul(tclamp(R.z, 0, 1))));
        const gFN = tnormalize(tcross(dFdx(positionWorld), dFdy(positionWorld)));
        gSt = mix(gSt, float(1).sub(tabs(gFN.y)), 0.72);
      }
      gSt = gSt.add(TL.vnoise(gP.xz.mul(0.8).add(gP.y.mul(0.7))).sub(0.5).mul(0.07)).toVar();
      const gMask = float(1).sub(smoothstep(0.31, 0.34, gSt)).toVar();
      const gLipM = float(1).sub(smoothstep(0.39, 0.42, gSt));
      const gCol = mix(gChk, GM_UNI.gmLip.mul(float(0.92).add(TL.vnoise(gP.xz.mul(2).add(gP.y)).mul(0.12))), gLipM).toVar();
      gCol.assign(mix(gCol, gGrass, gMask));
      gCol.assign(mix(gCol, GM_UNI.gmLipHi, gMask.mul(smoothstep(0.235, 0.3, gSt)).mul(0.5)));
      if (propLip) gCol.assign(mix(gCol, GM_UNI.gmLip.mul(float(0.8).add(TL.vnoise(gP.xz.mul(3).add(gP.y.mul(2))).mul(0.35))), tclamp(attribute('aLip', 'float'), 0, 1)));
      // grass detail: tufts and soft mounds (their gradient tilts the normal), sun-dried and lush patches
      const gFoot = TL.fw(gP.xz), gFoo = tmax(gFoot.x, gFoot.y);
      const gFine = float(1).sub(smoothstep(0.025, 0.11, gFoo)), gMidF = float(1).sub(smoothstep(0.1, 0.45, gFoo));
      const gTq = gP.xz.mul(vec2(7.3, 8.9));
      const gT0 = TL.vnoise(gTq), gTx = TL.vnoise(gTq.add(vec2(0.2, 0))), gTz = TL.vnoise(gTq.add(vec2(0, 0.2)));
      const gUq = gP.xz.mul(vec2(2.9, 3.4)).add(5.3);
      const gU0 = TL.vnoise(gUq), gUx = TL.vnoise(gUq.add(vec2(0.2, 0))), gUz = TL.vnoise(gUq.add(vec2(0, 0.2)));
      const gGb = vec2(gTx.sub(gT0), gTz.sub(gT0)).mul(gFine.mul(0.9)).add(vec2(gUx.sub(gU0), gUz.sub(gU0)).mul(gMidF.mul(0.45)));
      gBump.assign(mix(gBump, vec3(gGb.x.negate(), 0, gGb.y.negate()), gMask));
      gCol.mulAssign(mix(float(1), float(0.86).add(gT0.mul(0.16)).add(gU0.mul(0.1)), gMidF.mul(gMask)));
      const gPatch = TL.vnoise(gP.xz.mul(0.075).add(13));
      gCol.assign(mix(gCol, gCol.mul(vec3(1.16, 1.06, 0.66)), smoothstep(0.6, 0.88, gPatch).mul(gMask).mul(0.5)));
      gCol.assign(mix(gCol, gCol.mul(vec3(0.78, 0.92, 0.86)), smoothstep(0.62, 0.9, float(1).sub(gPatch)).mul(gMask).mul(0.45)));
      if (terrain) {
        const ao = attribute('aAO', 'float');
        gCol.mulAssign(mix(float(1), ao, 0.65));
        // the baked cavity term also shades the sky light and reflections
        m.aoNode = ao.mul(ao);
      }
      colorNode = gCol;
    }
    m.colorNode = colorNode;
    m.normalNode = tnormalize(normalViewGeometry.add(cameraViewMatrix.mul(vec4(gBump, 0)).xyz));
    return m;
  }
  // Swaying palms / flowers / flapping birds (vertex animation weighted by the aAnim attribute).
  // PORT(world): v2 animated in the instance's local space with a phase from the instance position and spun the
  // sunflower heads about their pivot (0, 2.1, 0.09); r186 applies instancing before positionNode, so this placeholder
  // sways in model space with a per-instance hash phase and the heads no longer spin.
  function animMaterial(kind, params) {
    const m = new THREE.MeshStandardNodeMaterial(Object.assign({ vertexColors: true, roughness: 0.82, metalness: 0 }, params || {}));
    const aAnim = attribute('aAnim', 'float');
    const kPh = TL.hash21(vec2(float(instanceIndex).mul(0.37), 1.7)).mul(6.2832);
    const p = positionLocal;
    let off;
    if (kind === 'palm') off = vec3(tsin(TIME.mul(1.5).add(kPh)).mul(aAnim).mul(0.32), tsin(TIME.mul(2.1).add(kPh)).mul(aAnim).mul(0.1), tcos(TIME.mul(1.1).add(kPh.mul(1.3))).mul(aAnim).mul(0.22));
    else if (kind === 'sunflower') off = vec3(tsin(TIME.mul(1.3).add(kPh)).mul(0.04).mul(positionGeometry.y), 0, 0);
    else if (kind === 'flower') off = vec3(tsin(TIME.mul(1.8).add(kPh)).mul(aAnim).mul(0.08), 0, tcos(TIME.mul(1.4).add(kPh)).mul(aAnim).mul(0.06));
    else off = vec3(0, tsin(TIME.mul(9).add(kPh.mul(3))).mul(aAnim).mul(0.55), 0);
    m.positionNode = p.add(off);
    return m;
  }
