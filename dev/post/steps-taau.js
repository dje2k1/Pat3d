// TAAU convergence: sharpness (mean |Laplacian| of luma, centre crop) vs number of still frames, native TRAA vs TAAU 0.85
const v = require('./steps-verify.js');
const lib = v[0].code.split('__K.post.setQuality')[0];
module.exports = [
  v[0],
  { name: 'conv', code: lib + `
    const K = __K, out = {}; const pose = V.pose();
    const run = (tag, q, sr, up, marks) => { K.post.setUpscaler(up); K.post.setSuperRes(sr); K.post.setQuality(q); V.setPose(pose); let n = 0; const r = [];
      for (const m of marks) { while (n < m) { T.renderNow(); n++; } r.push(m + ':' + V.sharp(V.grab())); } out[tag] = r.join(' '); };
    run('native', 'high', false, 'auto', [30, 120]);
    run('taau85', 'high', true, 'auto', [30, 120, 240]);
    run('fsr85', 'high', true, 'fsr', [30]);
    K.post.setUpscaler('auto'); K.post.setSuperRes(false); K.post.setQuality('high');
    return out;` },
];
