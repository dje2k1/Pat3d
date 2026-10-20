// FSR1 (dynamic import) check: upscale path per (preset, upscaler), screenshots, sharpness vs native
// node dev/post/shoot.js --steps=dev/post/steps-fsr.js --page=dev/post/site2/test.html --prefix=fsr-
const v = require('./steps-verify.js');
const lib = v[0].code.split('__K.post.setQuality')[0];
const settle = `for (let i = 0; i < 30; i++) T.renderNow();`;
module.exports = [
  v[0],
  { name: 'paths', code: lib + `
    const K = __K, out = [];
    for (const [q, up] of [['low', 'auto'], ['high', 'fsr'], ['medium', 'fsr'], ['medium', 'auto'], ['ultra', 'auto']]) {
      K.post.setUpscaler(up); K.post.setSuperRes(true); K.post.setQuality(q); T.frame(); T.frame();
      const s = K.post.stats(); out.push({ q, up, upscale: s.upscale, aa: s.aa, internal: s.internal.join('x'), passes: s.passes.join(' | ') });
    }
    K.post.setUpscaler('auto'); K.post.setSuperRes(false); K.post.setQuality('high'); T.frame();
    return out;` },
  { name: 'low-native', shot: true, code: `__K.post.setSuperRes(false); __K.post.setQuality('low'); ${settle} return __K.post.stats().upscale;` },
  { name: 'low-fsr', shot: true, code: `__K.post.setSuperRes(true); __K.post.setQuality('low'); ${settle} return __K.post.stats().upscale;` },
  { name: 'high-native', shot: true, code: `__K.post.setUpscaler('auto'); __K.post.setSuperRes(false); __K.post.setQuality('high'); ${settle} return __K.post.stats().upscale;` },
  { name: 'high-fsr', shot: true, code: `__K.post.setUpscaler('fsr'); __K.post.setSuperRes(true); __K.post.setQuality('high'); ${settle} return __K.post.stats().upscale;` },
  { name: 'high-taau', shot: true, code: `__K.post.setUpscaler('auto'); __K.post.setSuperRes(true); __K.post.setQuality('high'); ${settle} return __K.post.stats().upscale;` },
  v.find(s => s.name === 'sharp')
].filter(Boolean);
