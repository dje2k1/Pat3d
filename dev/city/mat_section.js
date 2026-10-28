// ===================== materials =====================
const { Fn, If, uniform, uniformArray, attribute, vec2, vec3, vec4, float, int, mix, smoothstep, clamp: tclamp, abs: tabs, max: tmax, min: tmin,
  fract: tfract, floor: tfloor, sin: tsin, cos: tcos, pow: tpow, exp: texp, dot: tdot, normalize: tnormalize, reflect: treflect,
  length: tlength, step: tstep, select, positionWorld, positionLocal, positionGeometry, normalGeometry, cameraPosition,
  cameraViewMatrix, cameraProjectionMatrix, modelViewMatrix, modelWorldMatrix, varyingProperty, texture: ttexture, uv: tuv,
  positionView, normalView, dFdx, dFdy, cross: tcross, inverseSqrt, sqrt: tsqrt, sign: tsign, faceDirection } = TSL;
const TL = K.tsl;
const U = { time: uniform(0), hdr: K.post && K.post.uHDR && K.post.uHDR.isNode ? K.post.uHDR : uniform(1) };
// city surfaces: vertex colour + a surface kind, uv in metres (or 0..1 for openings), emission
const KIND = {
  plain: 0, siding: 1, window: 2, shingle: 3, asphalt: 4, paint: 5, slab: 6, brick: 7, plank: 8, metal: 9, glow: 10,
  leaf: 11, rail: 12, dentil: 13, scales: 14, facade: 15, ground: 16, seawall: 17, stone: 18, awning: 19, glass: 20, tar: 21,
  shop: 22, manhole: 23, concrete: 24
};
// ---- the city's PBR material layers: two texture ARRAYS (tools/tex/city_tex.py, assets/tex/city/city_{alb,nrm}.webp)
// alb: RGB albedo (sRGB), A = 0.5 + 0.5 * tint (1 = takes the vertex colour); nrm: RG normal xy, B roughness,
// A = 0.5 + 0.5 * AO. The WebP strips are converted to THREE.DataArrayTexture once K.tex has them (and again when the
// texture set switches full <-> half); until then 1x1 neutral layers.
const LY = { paintwood: 0, siding: 1, shingle: 2, asphalt: 3, slab: 4, brick: 5, planks: 6, metal: 7, leaves: 8, dentil: 9,
  scales: 10, ground: 11, stone: 12, canvas: 13, tar: 14, concrete: 15, window: 16, manhole: 17 };
const NLAYER = 18;
const CT = { names: ['city/city_alb', 'city/city_nrm'], tex: [null, null], src: [null, null], nodes: [[], []], loaded: 0, res: [0, 0] };
function cityArray(data, w, srgb) {
  const t = new THREE.DataArrayTexture(data, w, w, NLAYER);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = w > 1; t.anisotropy = 8; t.flipY = false; t.unpackAlignment = 4;
  t.needsUpdate = true;
  return t;
}
function cityArrays() {
  if (!CT.tex[0]) {
    const a = new Uint8Array(4 * NLAYER), n = new Uint8Array(4 * NLAYER);
    for (let i = 0; i < NLAYER; i++) { a.set([188, 188, 188, 255], i * 4); n.set([128, 128, 204, 255], i * 4); }
    CT.tex[0] = cityArray(a, 1, true); CT.tex[1] = cityArray(n, 1, false);
  }
  return CT.tex;
}
// a sampling node of array i (0 alb, 1 nrm) at uv, layer (int node); registered so a swap updates every material
function citySample(i, uvNode, layerNode) {
  const n = ttexture(cityArrays()[i], uvNode);
  n.depthNode = layerNode;
  CT.nodes[i].push(n);
  return n;
}
// K.tex hands the strips over as ImageBitmaps (flipped at decode: the rows are already the array's memory layout)
function cityTexSync() {
  if (!K.tex || typeof K.tex.load !== 'function') return;
  for (let i = 0; i < 2; i++) {
    const t = K.tex.load(CT.names[i]), img = t && t.image;
    if (!img || img === CT.src[i] || !(img.width > 1) || img.height !== img.width * NLAYER) continue;
    CT.src[i] = img;
    let data = null;
    try {
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      data = new Uint8Array(g.getImageData(0, 0, img.width, img.height).data.buffer);
      cv.width = cv.height = 1;
    } catch (e) { console.warn('Kit Rush 3D: city texture ' + CT.names[i] + ' not converted', e); continue; }
    const nt = cityArray(data, img.width, i === 0), old = CT.tex[i];
    CT.tex[i] = nt; CT.res[i] = img.width;
    for (const n of CT.nodes[i]) n.value = nt;
    if (old) old.dispose();
    // the bitmap is no longer needed (K.tex closes it when it switches sets)
    try { if (typeof img.close === 'function') img.close(); } catch (e) { /* closed */ }
    CT.loaded++;
  }
}
// per kind: [layer, tiles per metre along u, along v, uv source (0 aUv, 1 local XZ, 2 local side), normal strength,
// roughness = map * mul + add, metalness, chipped-paint metal (metal = 1 - tint), anti-tiling (2nd rotated sample), AO]
const KDEF = [];
const kd = (k, a) => { KDEF[k] = a; };
kd(KIND.plain, [LY.paintwood, 1, 1, 0, 0.7, 1, 0, 0, 0, 0, 1]);
kd(KIND.siding, [LY.siding, 0.92, 0.92, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.window, [LY.window, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.shingle, [LY.shingle, 0.667, 0.667, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.asphalt, [LY.asphalt, 0.42, 0.42, 1, 1, 1, 0, 0, 0, 1, 1]);
kd(KIND.paint, [LY.asphalt, 0.42, 0.42, 1, 0.55, 1, 0, 0, 0, 1, 0.6]);
kd(KIND.slab, [LY.slab, 0.333, 0.333, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.brick, [LY.brick, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.plank, [LY.planks, 0.5, 0.5, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.metal, [LY.metal, 2, 2, 0, 0.7, 1, 0, 0, 1, 0, 0.6]);
kd(KIND.glow, [LY.paintwood, 1, 1, 0, 0, 0, 0.35, 0, 0, 0, 0]);
kd(KIND.leaf, [LY.leaves, 1.1, 1.1, 2, 1, 1, 0, 0, 0, 1, 1]);
kd(KIND.rail, [LY.metal, 2, 2, 0, 0.35, 0.5, 0.0, 0.9, 0, 0, 0.3]);
kd(KIND.dentil, [LY.dentil, 0.65, 1, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.scales, [LY.scales, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.facade, [LY.siding, 0.92, 0.92, 0, 0.8, 1, 0, 0, 0, 0, 1]);
kd(KIND.ground, [LY.ground, 0.25, 0.25, 1, 1, 1, 0, 0, 0, 1, 1]);
kd(KIND.seawall, [LY.stone, 0.5, 0.5, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.stone, [LY.stone, 0.67, 0.67, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.awning, [LY.canvas, 2, 2, 0, 1, 1, 0, 0, 0, 0, 1]);
kd(KIND.glass, [LY.paintwood, 1, 1, 0, 0, 0, 0.05, 0, 0, 0, 0]);
kd(KIND.tar, [LY.tar, 0.5, 0.5, 0, 1, 1, 0, 0, 0, 1, 1]);
kd(KIND.shop, [LY.paintwood, 1, 1, 0, 0, 0, 0.05, 0, 0, 0, 0]);
kd(KIND.manhole, [LY.manhole, 1, 1, 0, 1, 1, 0, 0.35, 0, 0, 1]);
kd(KIND.concrete, [LY.concrete, 0.5, 0.5, 0, 1, 1, 0, 0, 0, 1, 1]);
kd(30, [LY.paintwood, 1, 1, 0, 0.12, 0, 0.28, 0.35, 0, 0, 0.5]);
kd(31, [LY.paintwood, 1, 1, 0, 0, 0, 0.3, 0, 0, 0, 0]);
function kindTables(over) {
  const P0 = [], P1 = [], P2 = [];
  for (let k = 0; k < 32; k++) {
    const d = (over && over[k]) || KDEF[k] || KDEF[0];
    P0.push(new THREE.Vector4(d[0], d[1], d[2], d[3]));
    P1.push(new THREE.Vector4(d[4], d[5], d[6], d[7]));
    P2.push(new THREE.Vector4(d[8], d[9], d[10], 0));
  }
  return [uniformArray(P0, 'vec4'), uniformArray(P1, 'vec4'), uniformArray(P2, 'vec4')];
}
const ASPH_LIN = new THREE.Color('#67666b');
// hash of a vec3 (0..1)
const h31 = p => tfract(tsin(tdot(p, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
// The v2 city shader (per-kind procedural surfaces) rebuilt on PBR texture layers, branch-free (select / mix only:
// every texture read happens in uniform control flow, see the TSL notes in docs/SPEC3.md):
//  - albedo = layer albedo, tinted by the vertex colour where the layer says so; normal map through a cotangent frame
//    built from screen-space derivatives (the city geometry has no tangents); roughness / AO from the layer;
//  - asphalt: a second rotated sample against tiling, repair patches, worn paint for the markings, puddles on the flat
//    parts (SSR opt-in through K.post.ssr);
//  - windows (kind 2: sash frame from the WINDOW layer) and shop fronts (kind 22): interior mapping (a room behind the
//    glass: walls, floor, ceiling, back-wall decor, curtains and blinds, lamp-lit or dark) under a reflective glass;
//  - glow / blinkers / the far facades' lit windows as emission (HDR, bloom).
// opts.position(p) -> displaced local position node (flags, gulls); opts.vehicle: kinds 30 (paint: takes the instance
// colour, glossy) and 31 (blinkers); opts.side: THREE side (double-sided cloth).
function cityMaterial(opts) {
  opts = opts || {};
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: false, roughness: 0.8, metalness: 0 });
  if (opts.side != null) m.side = opts.side;
  const aK = attribute('aKind', 'float'), aUv = attribute('aUv', 'vec2'), aE = attribute('aEmit', 'float');
  const kk = tfloor(aK.add(0.5)), ki = int(kk);
  const lp = positionGeometry;
  const hdr = U.hdr, uTime = U.time;
  let vc = attribute('color', 'vec3');
  if (opts.vehicle) {
    // three multiplies the diffuse by the instance colour on every vertex; v2 only tinted the paint (kind 30)
    const ic = varyingProperty('vec3', 'vInstanceColor');
    vc = select(aK.greaterThan(29.5), vc, vc.div(tmax(ic, vec3(1e-3))));
  }
  const [P0, P1, P2] = kindTables(opts.vehicle ? { 0: [LY.paintwood, 1, 1, 0, 0.15, 0.6, 0.1, 0, 0, 0, 0.5] } : null);
  const p0 = P0.element(ki), p1 = P1.element(ki), p2 = P2.element(ki);
  const isK = n => kk.equal(n);
  // ---- uv per kind
  const uvSrc = select(p0.w.lessThan(0.5), aUv, select(p0.w.lessThan(1.5), vec2(lp.x, lp.z.negate()), vec2(lp.x.add(lp.z).mul(0.7071), lp.y)));
  const uv = uvSrc.mul(p0.yz).toVar('cUv');
  const layer = int(p0.x);
  // anti-tiling: a second sample, rotated and scaled, blended by a large-scale noise
  const RC = 0.8253, RS = 0.5646; // cos / sin 0.6 rad
  const uv2 = vec2(uv.x.mul(RC).sub(uv.y.mul(RS)), uv.x.mul(RS).add(uv.y.mul(RC))).mul(0.437).add(vec2(0.37, 0.71));
  const wb = smoothstep(0.3, 0.7, TL.vnoise(lp.xz.mul(0.045).add(lp.y.mul(0.03)))).mul(p2.y).toVar('cAnti');
  const A1 = citySample(0, uv, layer), N1 = citySample(1, uv, layer);
  const A2 = citySample(0, uv2, layer), N2 = citySample(1, uv2, layer);
  const A = mix(A1, A2, wb).toVar('cA');
  const n2xy = N2.xy.mul(2).sub(1);
  const n2r = vec2(n2xy.x.mul(RC).add(n2xy.y.mul(RS)), n2xy.y.mul(RC).sub(n2xy.x.mul(RS)));
  const nxy0 = mix(N1.xy.mul(2).sub(1), n2r, wb);
  const rgh0 = mix(N1.z, N2.z, wb), ao0 = mix(N1.w, N2.w, wb).mul(2).sub(1);
  const tint = tclamp(A.w.mul(2).sub(1), 0, 1).toVar('cTint');
  const texC = A.xyz;
  // ---- surface masks
  const isWin = isK(KIND.window), isShop = isK(KIND.shop), isGlass = isK(KIND.glass);
  const isRoad = isK(KIND.asphalt).or(isK(KIND.paint)), isPaint = isK(KIND.paint);
  // ---- base colour
  let base = mix(texC, texC.mul(vc).mul(2), tint);
  // road markings: worn paint over the asphalt (chipped where the aggregate peaks, thinner in the wheel paths)
  const lumT = tdot(texC, vec3(0.2126, 0.7152, 0.0722));
  const wearN = TL.vnoise(lp.xz.mul(1.7)).mul(0.6).add(TL.vnoise(lp.xz.mul(6.3)).mul(0.4));
  const paintCover = smoothstep(0.32, 0.4, wearN.sub(lumT.sub(0.25).mul(0.6))).toVar('cPaint');
  const asphC = texC.mul(vec3(ASPH_LIN.r, ASPH_LIN.g, ASPH_LIN.b)).mul(2);
  base = select(isPaint, mix(asphC, vc.mul(0.85), paintCover), base);
  // asphalt repair patches (darker, smoother, rectangular) on a 9 m grid
  const pc = lp.xz.div(9), pid = tfloor(pc), pf = tfract(pc);
  const ph = TL.hash21(pid), ph2 = TL.hash21(pid.add(7.31));
  const pbox = tstep(ph.mul(0.3).add(0.1), pf.x).mul(tstep(pf.x, ph.mul(0.3).add(0.55))).mul(tstep(ph2.mul(0.3).add(0.1), pf.y)).mul(tstep(pf.y, ph2.mul(0.35).add(0.5)));
  const patch = pbox.mul(tstep(0.62, TL.hash21(pid.add(3.1)))).mul(select(isRoad, float(1), float(0))).toVar('cPatch');
  base = base.mul(float(1).sub(patch.mul(0.28)));
  // large-scale colour variation (asphalt stains, ground, roofs)
  const macro = TL.vnoise(lp.xz.mul(0.021)).mul(0.6).add(TL.vnoise(lp.xz.mul(0.083)).mul(0.4));
  base = base.mul(float(1).add(macro.sub(0.5).mul(select(isRoad.or(isK(KIND.ground)), float(0.35), float(0.12)))));
  // awnings: v2's stripes over the canvas
  base = select(isK(KIND.awning), mix(base, vec3(0.83, 0.8, 0.74).mul(texC.mul(2)), tstep(0.5, tfract(aUv.x.mul(1.1)))), base);
  // the sea wall darkens and greens toward the water line
  const wetWall = smoothstep(1.4, -0.4, lp.y).mul(select(isK(KIND.seawall), float(1), float(0)));
  base = base.mul(float(1).sub(wetWall.mul(0.45))).mul(mix(vec3(1), vec3(0.85, 0.95, 0.85), wetWall));
  // ---- puddles on the flat parts of the streets (local noise, edges broken by the aggregate)
  const flat = smoothstep(0.985, 0.997, normalGeometry.y);
  const pn = TL.fbm(lp.xz.mul(0.075).add(vec2(13.1, 7.7)));
  const wet = smoothstep(0.6, 0.7, pn.add(lumT.sub(0.25).mul(0.25))).mul(flat).mul(select(isRoad, float(1), float(0))).toVar('cWet');
  const pud = smoothstep(0.55, 0.85, wet).toVar('cPud');
  base = base.mul(float(1).sub(wet.mul(0.42)).sub(pud.mul(0.2)));
  // ---- normal: cotangent frame from derivatives of the sampling uv (view space)
  const pV = positionView, Ng = normalView.mul(faceDirection).normalize();
  const dp1 = dFdx(pV), dp2 = dFdy(pV), du1 = dFdx(uv), du2 = dFdy(uv);
  const dp2p = tcross(dp2, Ng), dp1p = tcross(Ng, dp1);
  const Tv = dp2p.mul(du1.x).add(dp1p.mul(du2.x)), Bv = dp2p.mul(du1.y).add(dp1p.mul(du2.y));
  const inv = inverseSqrt(tmax(tmax(tdot(Tv, Tv), tdot(Bv, Bv)), 1e-24));
  const nStr = p1.x.mul(float(1).sub(pud)).mul(select(isPaint, mix(float(1), float(0.45), paintCover), float(1)));
  const nxy = nxy0.mul(nStr);
  const nz = tsqrt(tmax(float(1).sub(tdot(nxy, nxy)), 0.0));
  // ---- windows and shop fronts: interior mapping in world space (a room behind every pane)
  const pW = positionWorld;
  const dw1 = dFdx(aUv), dw2 = dFdy(aUv), dq1 = dFdx(pW), dq2 = dFdy(pW);
  const det0 = dw1.x.mul(dw2.y).sub(dw1.y.mul(dw2.x));
  const det = tsign(det0).mul(tmax(tabs(det0), 1e-12)).add(select(det0.equal(0), float(1e-12), float(0)));
  const dpdu = dq1.mul(dw2.y).sub(dq2.mul(dw1.y)).div(det), dpdv = dq2.mul(dw1.x).sub(dq1.mul(dw2.x)).div(det);
  const Ww = tmax(tlength(dpdu), 0.05), Hh = tmax(tlength(dpdv), 0.05);
  const Tw = dpdu.div(Ww), Bw = dpdv.div(Hh), Nw = tnormalize(tcross(Tw, Bw));
  const rd = tnormalize(pW.sub(cameraPosition));
  const dx0 = tdot(rd, Tw), dy0 = tdot(rd, Bw), dz0 = tmin(tdot(rd, Nw), -0.02);
  const safe = d => tsign(d).mul(tmax(tabs(d), 1e-3)).add(select(d.equal(0), float(1e-3), float(0)));
  const ddx = safe(dx0), ddy = safe(dy0);
  const ox = aUv.x.mul(Ww), oy = aUv.y.mul(Hh);
  const rmx = select(isShop, float(0.25), float(0.9)), rlo = select(isShop, float(-0.45), float(-0.85)), rhi = select(isShop, Hh.add(0.25), Hh.add(0.55));
  const rD = select(isShop, float(5.5), float(3.4));
  const tX = select(ddx.greaterThan(0), Ww.add(rmx).sub(ox), rmx.negate().sub(ox)).div(ddx);
  const tY = select(ddy.greaterThan(0), rhi.sub(oy), rlo.sub(oy)).div(ddy);
  const tZ = rD.negate().div(dz0);
  const tH = tmin(tmin(tX, tY), tZ);
  const hx = ox.add(ddx.mul(tH)), hy = oy.add(ddy.mul(tH)), hz = dz0.mul(tH); // hz in -rD..0
  const backF = tZ.lessThanEqual(tmin(tX, tY)), sideF = tX.lessThanEqual(tY).and(backF.not());
  const floorF = backF.not().and(sideF.not()).and(ddy.lessThan(0));
  const org = pW.sub(dpdu.mul(aUv.x)).sub(dpdv.mul(aUv.y));
  const wid = tfloor(org.mul(1.7)).add(0.5);
  const r1 = h31(wid), r2 = h31(wid.add(3.7)), r3 = h31(wid.add(9.1)), r4 = h31(wid.add(5.3));
  const wallC = select(r1.lessThan(0.25), vec3(0.78, 0.68, 0.52), select(r1.lessThan(0.5), vec3(0.52, 0.6, 0.5), select(r1.lessThan(0.75), vec3(0.55, 0.6, 0.72), vec3(0.8, 0.58, 0.55))));
  const fy = hy.sub(rlo); // height above the room floor
  const plank = tstep(0.5, tfract(hx.mul(3.3))).mul(0.08).add(0.92);
  const floorC = select(isShop, vec3(0.42, 0.38, 0.34), vec3(0.32, 0.2, 0.12).mul(plank));
  const ceilC = vec3(0.86, 0.84, 0.8);
  // back wall decor: a picture (house) or shelves (shop), a dresser / counter at the bottom
  const bx = hx.div(Ww);
  const pic = tstep(0.28 + 0.0, bx).mul(tstep(bx, 0.72)).mul(tstep(1.25, fy)).mul(tstep(fy, 1.95)).mul(tstep(r2, 0.7));
  const shelf = tstep(0.5, tfract(fy.mul(2.2))).mul(tstep(fy, 2.0)).mul(0.25);
  const dresser = tstep(fy, select(isShop, float(0.95), float(0.8))).mul(tstep(r3.mul(0.4).add(0.1), bx)).mul(tstep(bx, r3.mul(0.4).add(0.55)));
  let backC = select(isShop, wallC.mul(float(0.85).sub(shelf)).add(vec3(0.25, 0.15, 0.1).mul(shelf)), mix(wallC, vec3(0.25, 0.32, 0.4).mul(r4.add(0.6)), pic));
  backC = mix(backC, vec3(0.3, 0.19, 0.12), dresser);
  const roomC = select(backF, backC, select(sideF, wallC.mul(0.82), select(floorF, floorC, ceilC)));
  // lamp light: warm, brighter high in the room and near the window; dark rooms keep a dim cool ambient
  const lit = aE.greaterThan(0.01);
  const depthK = float(1).sub(hz.negate().div(rD).mul(0.45));
  const lampK = select(floorF, float(0.7), float(1)).mul(depthK).mul(float(0.75).add(fy.div(rhi.sub(rlo)).mul(0.35)));
  const warm = mix(vec3(1.0, 0.62, 0.32), vec3(1.0, 0.82, 0.55), r4);
  const roomL = select(lit, warm.mul(lampK).mul(aE.mul(0.6).add(0.4)), vec3(0.05, 0.055, 0.07).mul(depthK));
  // curtains and blinds just behind the glass (house windows)
  const cl = r2.mul(0.22).add(0.06), cr = r3.mul(0.22).add(0.06);
  const curt = tstep(aUv.x, cl).add(tstep(float(1).sub(cr), aUv.x)).mul(tstep(0.25, r4)).mul(select(isWin, float(1), float(0)));
  const curtC = select(r3.lessThan(0.33), vec3(0.6, 0.18, 0.15), select(r3.lessThan(0.66), vec3(0.85, 0.8, 0.68), vec3(0.25, 0.4, 0.32))).mul(tsin(aUv.x.mul(Ww).mul(30)).mul(0.18).add(0.82));
  const blindV = r1.mul(0.5).add(0.5);
  const blind = tstep(blindV, aUv.y).mul(tstep(0.7, r2)).mul(select(isWin, float(1), float(0)));
  const blindC = vec3(0.86, 0.82, 0.72).mul(tstep(0.5, tfract(aUv.y.mul(Hh).mul(14))).mul(0.15).add(0.8));
  const front = tclamp(curt.add(blind), 0, 1);
  const inC = mix(roomC.mul(roomL), mix(curtC, blindC, blind).mul(select(lit, warm.mul(0.55), vec3(0.09, 0.09, 0.1))), front);
  // shop fronts: a thin frame round the glass (metres from the edge)
  const sEdge = tmin(tmin(aUv.x.mul(Ww), Ww.sub(aUv.x.mul(Ww))), tmin(aUv.y.mul(Hh), Hh.sub(aUv.y.mul(Hh))));
  const shopFrame = float(1).sub(smoothstep(0.05, 0.07, sEdge)).mul(select(isShop, float(1), float(0)));
  const glassM = select(isWin, float(1).sub(tint), select(isShop, float(1).sub(shopFrame), float(0))).toVar('cGlassM');
  const NdV = tclamp(tdot(Nw, rd.negate()), 0, 1);
  const transm = float(1).sub(tpow(float(1).sub(NdV), 5).mul(0.96).add(0.04));
  const interior = select(isWin.or(isShop), inC.mul(transm).mul(glassM).mul(mix(float(0.9), float(2.4), hdr)), vec3(0)).toVar('cIn');
  // frame colours: sash = vertex colour (trim), shop frame = dark bronze
  base = select(isShop, mix(vec3(0.015), vec3(0.06, 0.05, 0.04), shopFrame), base);
  base = select(isWin.or(isShop), mix(base, vec3(0.012, 0.014, 0.018), glassM), base);
  // plain dark glass (vehicles, the mixer, the towers): v2's gradient
  base = select(isGlass, mix(vec3(0.02, 0.025, 0.035), vec3(0.05, 0.06, 0.08), smoothstep(0.1, 1.0, aUv.y)), base);
  // ---- far facades (kind 15): a procedural window grid, some lit (v2), with frames and sills
  const fq = aUv.div(vec2(2.7, 3.3)), ff = tfract(fq), fid = tfloor(fq);
  const fwin = tstep(0.3, ff.x).mul(tstep(ff.x, 0.7)).mul(tstep(0.25, ff.y)).mul(tstep(ff.y, 0.85)).mul(tstep(0.5, fq.y));
  const fframe = tstep(0.27, ff.x).mul(tstep(ff.x, 0.73)).mul(tstep(0.21, ff.y)).mul(tstep(ff.y, 0.88)).mul(tstep(0.5, fq.y)).sub(fwin);
  const flit = tstep(0.62, TL.hash21(fid.add(tfloor(lp.xz.mul(0.05))))).toVar('cFlit');
  const isFac = isK(KIND.facade);
  base = select(isFac, mix(mix(base, vec3(0.85, 0.83, 0.78), fframe), vec3(0.03, 0.035, 0.05), fwin), base);
  // ---- outputs
  m.colorNode = vec4(base, 1);
  const rough0 = tclamp(rgh0.mul(p1.y).add(p1.z), 0.03, 1);
  let rough = select(isPaint, mix(rough0, float(0.58), paintCover), rough0);
  rough = mix(rough, rough.mul(0.75), patch);
  rough = mix(rough, rough.mul(0.45), wet);
  rough = mix(rough, float(0.04), pud);
  rough = select(isWin.or(isShop), mix(rough, float(0.04), glassM), rough);
  rough = select(isFac, mix(rough, float(0.12), fwin), rough);
  rough = mix(rough, float(0.3), wetWall.mul(0.6));
  m.roughnessNode = rough;
  m.metalnessNode = select(isGlass, float(0.15), tmax(p1.w, p2.x.mul(float(1).sub(tint))));
  m.aoNode = mix(float(1), tclamp(ao0, 0, 1), p2.z);
  // glass: flat (with a faint waviness of old panes); everything else: the normal map
  const wav = vec2(TL.vnoise(aUv.mul(vec2(9, 13)).add(r1.mul(10))), TL.vnoise(aUv.mul(vec2(13, 9)).add(r2.mul(10)))).sub(0.5).mul(0.035);
  const nxyF = select(isWin.or(isShop), mix(nxy, wav, glassM), nxy);
  m.normalNode = tnormalize(Tv.mul(inv).mul(nxyF.x).add(Bv.mul(inv).mul(nxyF.y)).add(Ng.mul(select(isWin.or(isShop), mix(nz, float(1), glassM), nz))));
  m.emissiveNode = Fn(() => {
    const e = vec3(interior).toVar();
    const glowK = select(isK(KIND.glow), float(1), float(0));
    e.addAssign(vc.mul(aE).mul(mix(float(1), float(2.6), hdr)).mul(glowK));
    // v2: glass with emission glows warm (lit transoms, bus windows)
    const warmG = mix(vec3(1.0, 0.56, 0.22), vec3(1.0, 0.78, 0.45), TL.hash21(tfloor(lp.xz.mul(0.3)).add(tfloor(lp.y))));
    e.addAssign(select(isGlass.and(aE.greaterThan(0)), warmG.mul(aE).mul(0.6).mul(mix(float(1.0), float(2.6), hdr)), vec3(0)));
    e.addAssign(select(isFac, vec3(1.0, 0.62, 0.3).mul(fwin.mul(flit)).mul(mix(float(0.9), float(2.2), hdr)).mul(aE), vec3(0)));
    const bl = tstep(0.45, tfract(uTime.mul(1.4)));
    e.addAssign(select(isK(31), vc.mul(aE).mul(mix(float(0.04), float(1), bl)).mul(mix(float(1), float(2.6), hdr)), vec3(0)));
    return e;
  })();
  // screen-space reflections (Ultra / Élevé): puddles, wet patches, glass, vehicle paint
  if (K.post && typeof K.post.ssr === 'function') {
    try {
      const s = tmax(tmax(pud.mul(0.85), wet.mul(0.3)), tmax(glassM.mul(0.35), select(isK(30), float(0.2), float(0))));
      K.post.ssr(m, s);
    } catch (e) { console.warn('Kit Rush 3D: city SSR opt-in failed', e); }
  }
  if (opts.position) m.positionNode = opts.position(positionLocal);
  return m;
}
