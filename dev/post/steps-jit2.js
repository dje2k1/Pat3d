// probe: TAAU jitter sign convention (resolve uniform vs camera view offset) -> sharpness / PSNR vs native
const v = require('./steps-verify.js');
const lib = v[0].code.split('__K.post.setQuality')[0];
module.exports = [
  v[0],
  { name: 'signs', code: lib + `
    const K = __K, out = {}; const pose = V.pose();
    K.post.setUpscaler('auto'); K.post.setSuperRes(false); K.post.setQuality('high'); V.setPose(pose); V.still(30); const ref = V.grab(); out.native = V.sharp(ref);
    K.post.setSuperRes(true); K.post.setQuality('high'); V.still(4);
    const n = K.post._state.G.named.taau; const proto = Object.getPrototypeOf(n).setViewOffset;
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      n.setViewOffset = function (w, h) { proto.call(this, w, h); this._jitterOffset.value.x *= sx; this._jitterOffset.value.y *= sy; };
      V.setPose(pose); V.still(40); const g = V.grab(); out[sx + ',' + sy] = V.sharp(g) + ' / ' + V.psnr(g, ref) + 'dB';
    }
    delete n.setViewOffset; K.post.setSuperRes(false); K.post.setQuality('high');
    return out;` },
];
