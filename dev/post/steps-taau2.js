// TAAU post-sharpen sweep: sharpness + PSNR vs native TRAA for several taaSharp values (TAAU 0.85 and 0.6)
const v = require('./steps-verify.js');
const lib = v[0].code.split('__K.post.setQuality')[0];
module.exports = [
  v[0],
  { name: 'sweep', code: lib + `
    const K = __K, U = K.post.uniforms, out = {}; const pose = V.pose();
    const run = (q, sr, k) => { U.taaSharp.value = k; K.post.setUpscaler('auto'); K.post.setSuperRes(sr); K.post.setQuality(q); V.setPose(pose); V.still(30); return V.grab(); };
    const ref = run('high', false, 0.35); out.native = V.sharp(ref);
    for (const k of [0.35, 0.8, 1.2, 1.6]) { const g = run('high', true, k); out['taau85@' + k] = V.sharp(g) + ' / ' + V.psnr(g, ref) + 'dB'; }
    const refM = run('medium', false, 0.35); out.nativeM = V.sharp(refM);
    for (const k of [0.35, 1.2]) { const g = run('medium', true, k); out['taau60@' + k] = V.sharp(g) + ' / ' + V.psnr(g, refM) + 'dB'; }
    U.taaSharp.value = 0.35; K.post.setSuperRes(false); K.post.setQuality('high');
    return out;` },
];
