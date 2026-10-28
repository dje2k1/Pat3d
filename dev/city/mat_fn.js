function cityMaterial(opts) {
  opts = opts || {};
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: false, roughness: 0.8, metalness: 0 });
  if (opts.side != null) m.side = opts.side;
  // NOTE: no If / select() over computed values in here: TSL turns a select() whose branches hold expressions into an
  // if / else and emits shared temporaries inside the first branch only (garbage in the other one), and texture reads
  // must stay in uniform control flow. Everything is straight-line arithmetic; masks are 0 / 1 floats (mk) and every
  // division / normalisation is guarded so the unused paths never produce NaN.
  const mk = c => select(c, float(1), float(0));
  const snorm = v => v.mul(inverseSqrt(tmax(tdot(v, v), 1e-12)));
  const aK = attribute('aKind', 'float'), aUv = attribute('aUv', 'vec2'), aE = attribute('aEmit', 'float');
  const kk = tfloor(aK.add(0.5)), ki = int(kk);
  const lp = positionGeometry;
  const hdr = U.hdr, uTime = U.time;
  let vc = attribute('color', 'vec3');
  if (opts.vehicle) {
    // three multiplies the diffuse by the instance colour on every vertex; v2 only tinted the paint (kind 30)
    const ic = varyingProperty('vec3', 'vInstanceColor');
    vc = mix(vc.div(tmax(ic, vec3(1e-3))), vc, mk(aK.greaterThan(29.5)));
  }
  const [P0, P1, P2] = kindTables(opts.vehicle ? { 0: [LY.paintwood, 1, 1, 0, 0.15, 0.6, 0.1, 0, 0, 0, 0.5] } : null);
  const p0 = P0.element(ki), p1 = P1.element(ki), p2 = P2.element(ki);
  const isK = n => mk(kk.equal(n));
  const mWin = isK(KIND.window), mShop = isK(KIND.shop), mGlass = isK(KIND.glass), mPaint = isK(KIND.paint);
  const mRoad = tmax(isK(KIND.asphalt), mPaint), mFac = isK(KIND.facade), mWS = tmax(mWin, mShop);
  // ---- uv per kind: 0 = aUv, 1 = local XZ (asphalt, ground), 2 = local "side" (foliage)
  const mXZ = mk(p0.w.greaterThan(0.5).and(p0.w.lessThan(1.5))), mSide = mk(p0.w.greaterThan(1.5));
  const uvSrc = aUv.mul(float(1).sub(mXZ).sub(mSide)).add(vec2(lp.x, lp.z.negate()).mul(mXZ)).add(vec2(lp.x.add(lp.z).mul(0.7071), lp.y).mul(mSide));
  const uv = uvSrc.mul(p0.yz).toVar('cUv');
  const layer = int(p0.x);
  // anti-tiling: a second sample, rotated and scaled, blended by a large-scale noise
  const RC = 0.8253, RS = 0.5646; // cos / sin 0.6 rad
  const uv2 = vec2(uv.x.mul(RC).sub(uv.y.mul(RS)), uv.x.mul(RS).add(uv.y.mul(RC))).mul(0.437).add(vec2(0.37, 0.71)).toVar('cUv2');
  const wb = smoothstep(0.3, 0.7, TL.vnoise(lp.xz.mul(0.045).add(lp.y.mul(0.03)))).mul(p2.y).toVar('cAnti');
  const A1 = citySample(0, uv, layer).toVar('cA1'), N1 = citySample(1, uv, layer).toVar('cN1');
  const A2 = citySample(0, uv2, layer).toVar('cA2'), N2 = citySample(1, uv2, layer).toVar('cN2');
  const A = mix(A1, A2, wb).toVar('cA');
  const n2xy = N2.xy.mul(2).sub(1);
  const n2r = vec2(n2xy.x.mul(RC).add(n2xy.y.mul(RS)), n2xy.y.mul(RC).sub(n2xy.x.mul(RS)));
  const nxy0 = mix(N1.xy.mul(2).sub(1), n2r, wb).toVar('cNxy');
  const rgh0 = mix(N1.z, N2.z, wb), ao0 = mix(N1.w, N2.w, wb).mul(2).sub(1);
  const tint = tclamp(A.w.mul(2).sub(1), 0, 1).toVar('cTint');
  const texC = A.xyz;
  // ---- base colour: the layer albedo, tinted by the vertex colour where the layer says so
  let base = mix(texC, texC.mul(vc).mul(2), tint).toVar('cBase0');
  // road markings: worn paint over the asphalt (chipped where the aggregate peaks)
  const lumT = tdot(texC, vec3(0.2126, 0.7152, 0.0722)).toVar('cLum');
  const wearN = TL.vnoise(lp.xz.mul(1.7)).mul(0.6).add(TL.vnoise(lp.xz.mul(6.3)).mul(0.4));
  const paintCover = smoothstep(0.32, 0.4, wearN.sub(lumT.sub(0.25).mul(0.6))).toVar('cPaint');
  const asphC = texC.mul(vec3(ASPH_LIN.r, ASPH_LIN.g, ASPH_LIN.b)).mul(2);
  base = mix(base, mix(asphC, vc.mul(0.85), paintCover), mPaint);
  // asphalt repair patches (darker, smoother, rectangular) on a 9 m grid
  const pc = lp.xz.div(9), pid = tfloor(pc), pf = tfract(pc);
  const ph = TL.hash21(pid), ph2 = TL.hash21(pid.add(7.31));
  const pbox = tstep(ph.mul(0.3).add(0.1), pf.x).mul(tstep(pf.x, ph.mul(0.3).add(0.55))).mul(tstep(ph2.mul(0.3).add(0.1), pf.y)).mul(tstep(pf.y, ph2.mul(0.35).add(0.5)));
  const patch = pbox.mul(tstep(0.62, TL.hash21(pid.add(3.1)))).mul(mRoad).toVar('cPatch');
  base = base.mul(float(1).sub(patch.mul(0.28)));
  // large-scale colour variation (asphalt stains, ground, roofs)
  const macro = TL.vnoise(lp.xz.mul(0.021)).mul(0.6).add(TL.vnoise(lp.xz.mul(0.083)).mul(0.4));
  base = base.mul(float(1).add(macro.sub(0.5).mul(mix(float(0.12), float(0.35), tmax(mRoad, isK(KIND.ground))))));
  // awnings: v2's stripes over the canvas
  base = mix(base, vec3(0.83, 0.8, 0.74).mul(texC.mul(2)), tstep(0.5, tfract(aUv.x.mul(1.1))).mul(isK(KIND.awning)));
  // the sea wall darkens and greens toward the water line
  const wetWall = float(1).sub(smoothstep(-0.4, 1.4, lp.y)).mul(isK(KIND.seawall));
  base = base.mul(float(1).sub(wetWall.mul(0.45))).mul(mix(vec3(1), vec3(0.85, 0.95, 0.85), wetWall));
  // ---- puddles on the flat parts of the streets (local noise, edges broken by the aggregate)
  const flat = smoothstep(0.985, 0.997, normalGeometry.y);
  const pn = TL.fbm(lp.xz.mul(0.075).add(vec2(13.1, 7.7)));
  const wet = smoothstep(0.6, 0.7, pn.add(lumT.sub(0.25).mul(0.25))).mul(flat).mul(mRoad).toVar('cWet');
  const pud = smoothstep(0.55, 0.85, wet).toVar('cPud');
  base = base.mul(float(1).sub(wet.mul(0.42)).sub(pud.mul(0.2)));
  // ---- normal: cotangent frame from derivatives of the sampling uv (view space)
  const pV = positionView, Ng = snorm(normalView.mul(faceDirection)).toVar('cNg');
  const dp1 = dFdx(pV).toVar('cDp1'), dp2 = dFdy(pV).toVar('cDp2'), du1 = dFdx(uv), du2 = dFdy(uv);
  const dp2p = tcross(dp2, Ng), dp1p = tcross(Ng, dp1);
  const Tv = dp2p.mul(du1.x).add(dp1p.mul(du2.x)).toVar('cTv'), Bv = dp2p.mul(du1.y).add(dp1p.mul(du2.y)).toVar('cBv');
  const inv = inverseSqrt(tmax(tmax(tdot(Tv, Tv), tdot(Bv, Bv)), 1e-24)).toVar('cInv');
  // ---- windows and shop fronts: interior mapping in world space (a room behind every pane)
  const pW = positionWorld;
  const dw1 = dFdx(aUv), dw2 = dFdy(aUv), dq1 = dFdx(pW), dq2 = dFdy(pW);
  const det0 = dw1.x.mul(dw2.y).sub(dw1.y.mul(dw2.x));
  const det = mix(tmax(det0, 1e-12), tmin(det0, -1e-12), mk(det0.lessThan(0))).toVar('cDet');
  const dpdu = dq1.mul(dw2.y).sub(dq2.mul(dw1.y)).div(det).toVar('cDpdu'), dpdv = dq2.mul(dw1.x).sub(dq1.mul(dw2.x)).div(det).toVar('cDpdv');
  const Ww = tclamp(tlength(dpdu), 0.05, 40).toVar('cWw'), Hh = tclamp(tlength(dpdv), 0.05, 40).toVar('cHh');
  const Tw = dpdu.div(Ww), Bw = dpdv.div(Hh), Nw = snorm(tcross(Tw, Bw)).toVar('cNw');
  const rd = snorm(pW.sub(cameraPosition)).toVar('cRd');
  const sgnSafe = d => mix(tmax(d, 1e-3), tmin(d, -1e-3), mk(d.lessThan(0)));
  const ddx = sgnSafe(tdot(rd, Tw)).toVar('cDdx'), ddy = sgnSafe(tdot(rd, Bw)).toVar('cDdy'), dz0 = tmin(tdot(rd, Nw), -0.02).toVar('cDz');
  const ox = aUv.x.mul(Ww), oy = aUv.y.mul(Hh);
  const rmx = mix(float(0.9), float(0.25), mShop), rlo = mix(float(-0.85), float(-0.45), mShop), rhi = Hh.add(mix(float(0.55), float(0.25), mShop));
  const rD = mix(float(3.4), float(5.5), mShop);
  const tX = mix(rmx.negate().sub(ox), Ww.add(rmx).sub(ox), mk(ddx.greaterThan(0))).div(ddx);
  const tY = mix(rlo.sub(oy), rhi.sub(oy), mk(ddy.greaterThan(0))).div(ddy);
  const tZ = rD.negate().div(dz0);
  const tH = tmax(tmin(tmin(tX, tY), tZ), 0).toVar('cTh');
  const hx = ox.add(ddx.mul(tH)), hy = oy.add(ddy.mul(tH)), hz = dz0.mul(tH); // hz in -rD..0
  const mBack = mk(tZ.lessThanEqual(tmin(tX, tY))), mSideW = mk(tX.lessThanEqual(tY)).mul(float(1).sub(mBack));
  const mFloor = float(1).sub(mBack).sub(mSideW).mul(mk(ddy.lessThan(0)));
  const mCeil = float(1).sub(mBack).sub(mSideW).sub(mFloor);
  const org = pW.sub(dpdu.mul(aUv.x)).sub(dpdv.mul(aUv.y));
  const wid = tfloor(org.mul(1.7)).add(0.5);
  const r1 = h31(wid).toVar('cR1'), r2 = h31(wid.add(3.7)).toVar('cR2'), r3 = h31(wid.add(9.1)).toVar('cR3'), r4 = h31(wid.add(5.3)).toVar('cR4');
  const pal = (t, a, b, c, d) => mix(mix(a, b, mk(t.greaterThan(0.25))), mix(c, d, mk(t.greaterThan(0.75))), mk(t.greaterThan(0.5)));
  const wallC = pal(r1, vec3(0.78, 0.68, 0.52), vec3(0.52, 0.6, 0.5), vec3(0.55, 0.6, 0.72), vec3(0.8, 0.58, 0.55)).toVar('cWall');
  const fy = hy.sub(rlo); // height above the room floor
  const plank = tstep(0.5, tfract(hx.mul(3.3))).mul(0.08).add(0.92);
  const floorC = mix(vec3(0.32, 0.2, 0.12).mul(plank), vec3(0.42, 0.38, 0.34), mShop);
  const ceilC = vec3(0.86, 0.84, 0.8);
  // back wall decor: a picture (house) or shelves (shop), a dresser / counter at the bottom
  const bx = hx.div(Ww);
  const pic = tstep(0.28, bx).mul(tstep(bx, 0.72)).mul(tstep(1.25, fy)).mul(tstep(fy, 1.95)).mul(tstep(r2, 0.7));
  const shelf = tstep(0.5, tfract(fy.mul(2.2))).mul(tstep(fy, 2.0)).mul(0.25);
  const dresser = tstep(fy, mix(float(0.8), float(0.95), mShop)).mul(tstep(r3.mul(0.4).add(0.1), bx)).mul(tstep(bx, r3.mul(0.4).add(0.55)));
  const backHouse = mix(wallC, vec3(0.25, 0.32, 0.4).mul(r4.add(0.6)), pic);
  const backShop = wallC.mul(float(0.85).sub(shelf)).add(vec3(0.25, 0.15, 0.1).mul(shelf));
  const backC = mix(mix(backHouse, backShop, mShop), vec3(0.3, 0.19, 0.12), dresser);
  const roomC = backC.mul(mBack).add(wallC.mul(0.82).mul(mSideW)).add(floorC.mul(mFloor)).add(ceilC.mul(mCeil));
  // lamp light: warm, brighter high in the room and near the window; dark rooms keep a dim cool ambient
  const mLit = mk(aE.greaterThan(0.01));
  const depthK = float(1).sub(hz.negate().div(rD).mul(0.45));
  const lampK = mix(float(1), float(0.7), mFloor).mul(depthK).mul(float(0.75).add(fy.div(rhi.sub(rlo)).mul(0.35)));
  const warm = mix(vec3(1.0, 0.62, 0.32), vec3(1.0, 0.82, 0.55), r4);
  const roomL = mix(vec3(0.05, 0.055, 0.07).mul(depthK), warm.mul(lampK).mul(aE.mul(0.6).add(0.4)), mLit);
  // curtains and blinds just behind the glass (house windows)
  const cl = r2.mul(0.22).add(0.06), cr = r3.mul(0.22).add(0.06);
  const curt = tstep(aUv.x, cl).add(tstep(float(1).sub(cr), aUv.x)).mul(tstep(0.25, r4)).mul(mWin);
  const curtC = pal(r3, vec3(0.6, 0.18, 0.15), vec3(0.85, 0.8, 0.68), vec3(0.85, 0.8, 0.68), vec3(0.25, 0.4, 0.32)).mul(tsin(aUv.x.mul(Ww).mul(30)).mul(0.18).add(0.82));
  const blind = tstep(r1.mul(0.5).add(0.5), aUv.y).mul(tstep(0.7, r2)).mul(mWin);
  const blindC = vec3(0.86, 0.82, 0.72).mul(tstep(0.5, tfract(aUv.y.mul(Hh).mul(14))).mul(0.15).add(0.8));
  const front = tclamp(curt.add(blind), 0, 1);
  const frontL = mix(vec3(0.09, 0.09, 0.1), warm.mul(0.55), mLit);
  const inC = mix(roomC.mul(roomL), mix(curtC, blindC, blind).mul(frontL), front);
  // shop fronts: a thin frame round the glass (metres from the edge)
  const sEdge = tmin(tmin(aUv.x.mul(Ww), Ww.sub(aUv.x.mul(Ww))), tmin(aUv.y.mul(Hh), Hh.sub(aUv.y.mul(Hh))));
  const shopFrame = float(1).sub(smoothstep(0.05, 0.07, sEdge)).mul(mShop);
  const glassM = float(1).sub(tint).mul(mWin).add(float(1).sub(shopFrame).mul(mShop)).toVar('cGlassM');
  const NdV = tclamp(tdot(Nw, rd.negate()), 0, 1);
  const transm = float(1).sub(tpow(float(1).sub(NdV), 5).mul(0.96).add(0.04));
  const interior = inC.mul(transm).mul(glassM).mul(mix(float(0.9), float(2.4), hdr)).mul(mWS).toVar('cIn');
  // frame colours: sash = vertex colour (trim), shop frame = dark bronze; the glass itself is near black (reflective)
  base = mix(base, mix(vec3(0.015), vec3(0.06, 0.05, 0.04), shopFrame), mShop);
  base = mix(base, vec3(0.012, 0.014, 0.018), glassM.mul(mWS));
  // plain dark glass (vehicles, the mixer, the towers): v2's gradient
  base = mix(base, mix(vec3(0.02, 0.025, 0.035), vec3(0.05, 0.06, 0.08), smoothstep(0.1, 1.0, aUv.y)), mGlass);
  // ---- far facades (kind 15): a procedural window grid, some lit (v2), with frames
  const fq = aUv.div(vec2(2.7, 3.3)), ff = tfract(fq), fid = tfloor(fq);
  const fwin = tstep(0.3, ff.x).mul(tstep(ff.x, 0.7)).mul(tstep(0.25, ff.y)).mul(tstep(ff.y, 0.85)).mul(tstep(0.5, fq.y)).mul(mFac).toVar('cFwin');
  const fframe = tstep(0.27, ff.x).mul(tstep(ff.x, 0.73)).mul(tstep(0.21, ff.y)).mul(tstep(ff.y, 0.88)).mul(tstep(0.5, fq.y)).mul(mFac).sub(fwin);
  const flit = tstep(0.62, TL.hash21(fid.add(tfloor(lp.xz.mul(0.05)))));
  base = mix(mix(base, vec3(0.85, 0.83, 0.78), fframe), vec3(0.03, 0.035, 0.05), fwin);
  m.colorNode = vec4(base, 1);
  // ---- roughness / metalness / AO
  let rough = tclamp(rgh0.mul(p1.y).add(p1.z), 0.03, 1);
  rough = mix(rough, mix(rough, float(0.58), paintCover), mPaint);
  rough = mix(rough, rough.mul(0.75), patch);
  rough = mix(rough, rough.mul(0.45), wet);
  rough = mix(rough, float(0.04), pud);
  rough = mix(rough, float(0.04), glassM.mul(mWS));
  rough = mix(rough, float(0.12), fwin);
  rough = mix(rough, float(0.3), wetWall.mul(0.6));
  m.roughnessNode = rough;
  m.metalnessNode = mix(tmax(p1.w, p2.x.mul(float(1).sub(tint))), float(0.15), mGlass);
  m.aoNode = mix(float(1), tclamp(ao0, 0, 1), p2.z);
  // ---- normal: the map (flat glass with a faint waviness of old panes)
  const nStr = p1.x.mul(float(1).sub(pud)).mul(mix(float(1), mix(float(1), float(0.45), paintCover), mPaint));
  const nxy = nxy0.mul(nStr);
  const nz = tsqrt(tmax(float(1).sub(tdot(nxy, nxy)), 0.0));
  const wav = vec2(TL.vnoise(aUv.mul(vec2(9, 13)).add(r1.mul(10))), TL.vnoise(aUv.mul(vec2(13, 9)).add(r2.mul(10)))).sub(0.5).mul(0.035);
  const gW = glassM.mul(mWS);
  const nxyF = mix(nxy, wav, gW), nzF = mix(nz, float(1), gW);
  m.normalNode = snorm(Tv.mul(inv).mul(nxyF.x).add(Bv.mul(inv).mul(nxyF.y)).add(Ng.mul(nzF)));
  // ---- emission: interiors, lamp globes, lit glass, the far facades' windows, blinkers
  const hk = mix(float(1), float(2.6), hdr);
  const warmG = mix(vec3(1.0, 0.56, 0.22), vec3(1.0, 0.78, 0.45), TL.hash21(tfloor(lp.xz.mul(0.3)).add(tfloor(lp.y))));
  const bl = tstep(0.45, tfract(uTime.mul(1.4)));
  m.emissiveNode = interior
    .add(vc.mul(aE).mul(hk).mul(isK(KIND.glow)))
    .add(warmG.mul(aE).mul(0.6).mul(hk).mul(mGlass))
    .add(vec3(1.0, 0.62, 0.3).mul(fwin.mul(flit)).mul(mix(float(0.9), float(2.2), hdr)).mul(aE))
    .add(vc.mul(aE).mul(mix(float(0.04), float(1), bl)).mul(hk).mul(isK(31)));
  // screen-space reflections (Ultra / Élevé): puddles, wet patches, glass, vehicle paint
  if (K.post && typeof K.post.ssr === 'function') {
    try { K.post.ssr(m, tmax(tmax(pud.mul(0.85), wet.mul(0.3)), tmax(gW.mul(0.35), isK(30).mul(0.2)))); }
    catch (e) { console.warn('Kit Rush 3D: city SSR opt-in failed', e); }
  }
  m.userData.dbg = { A, A1, A2, N1, uv, uv2, wb, tint, base, interior, glassM, nxy, vc, texC, macro, wet, pud, patch };
