const K = __K, D = K.world._dbg(), GR = D.GR, T2 = D.T, fh = THREE.DataUtils.fromHalfFloat, d = GR.tex.image.data;
const at = (x, z) => { const ix = Math.round((x - T2.XMIN)), iz = Math.round((z - T2.ZMIN)); const i = (iz * T2.NX + ix) * 4; return [fh(d[i]), fh(d[i + 1]), fh(d[i + 2]), fh(d[i + 3])].map(v => +v.toFixed(2)); };
let bad = 0, n = 0, badList = [];
for (let iz = 0; iz < T2.NZ; iz++) for (let ix = 0; ix < T2.NX; ix++) { const i = (iz * T2.NX + ix) * 4; const h = fh(d[i]), de = fh(d[i + 1]); if (de > 0.01) { n++; if (h < 0.9) { bad++; if (badList.length < 5) badList.push([ix, iz, h, de]); } } }
const lake = [];
for (let x = -30; x <= 30; x += 6) lake.push(at(x, -379.5));
return { n, bad, badList, lake, NX: T2.NX, NZ: T2.NZ, XMIN: T2.XMIN, ZMIN: T2.ZMIN, w: GR.tex.image.width, h: GR.tex.image.height, type: GR.tex.type, fmt: GR.tex.format };
