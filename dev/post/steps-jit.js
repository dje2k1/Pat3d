// probe: is the TAAU / TRAA jitter in the camera projection when the scene pass renders?
const v = require('./steps-verify.js');
module.exports = [
  v[0],
  { name: 'jit', code: `
    const K = __K, R = K.view.renderer, cam = K.view.camera, out = {};
    const orig = R.render.bind(R); const log = [];
    R.render = function (sc, c) { if (c === cam) log.push([+c.projectionMatrix.elements[8].toFixed(5), +c.projectionMatrix.elements[9].toFixed(5), c.view && c.view.enabled ? 1 : 0, sc && sc.isScene ? 'scene' : (sc && sc.type) || '?']); return orig(sc, c); };
    const oUP = cam.updateProjectionMatrix.bind(cam); let ups = 0; cam.updateProjectionMatrix = function () { ups++; return oUP(); };
    for (const [q, sr] of [['high', false], ['high', true], ['medium', true]]) {
      K.post.setUpscaler('auto'); K.post.setSuperRes(sr); K.post.setQuality(q); for (let i = 0; i < 4; i++) T.renderNow();
      log.length = 0; ups = 0; for (let i = 0; i < 3; i++) T.renderNow(); out[q + (sr ? '+SR' : '')] = { aa: K.post.stats().aa, renders: log.slice(0, 9), ups };
    }
    R.render = orig; delete cam.updateProjectionMatrix;
    K.post.setSuperRes(false); K.post.setQuality('high');
    return out;` },
];
