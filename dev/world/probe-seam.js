// replicates e2e regress2 "no lawn-stripe seam" measure; window.__pre = presets
const K = __K, G = K.game;
T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 400);
const out = { act: G.act };
for (const q of (window.__pre || 'ultra,high,low').split(',')) {
  K.post.setQuality(q);
  if (window.__after) window.__after();
  const st = K.level.start; T.teleport(st.pos.x, st.pos.z, st.yaw, 0); K.player.vel.set(0, 0, 0); T.ticks(100);
  for (let f = 0; f < (window.__frames || 1); f++) T.frame();
  const { w, h, px } = T.pixelsGL();
  const y0 = Math.floor(h * 0.03), y1 = Math.floor(h * 0.28), col = x => { let t = 0; for (let y = y0; y < y1; y++) { const i = (y * w + x) * 4; t += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; } return t / (y1 - y0); };
  const k = Math.max(3, Math.floor(w / 200)), step = x0 => { let a = 0, b = 0; for (let x = x0 - 2 * k; x < x0 - k; x++) a += col(x); for (let x = x0 + k; x < x0 + 2 * k; x++) b += col(x); return Math.abs(a - b) / k; };
  const others = [];
  for (let x0 = Math.floor(w / 8); x0 < w - w / 8; x0 += Math.floor(w / 12)) if (Math.abs(x0 - w / 2) > w / 10) others.push(step(x0));
  others.sort((a, b) => a - b);
  // also: mean luma per 6-px column band across the width (to see structure)
  const prof = []; for (let x = 0; x < w; x += k * 4) prof.push(Math.round(col(x)));
  out[q] = { centre: +step(Math.floor(w / 2)).toFixed(1), others: +others[others.length >> 1].toFixed(1), othersMax: +others[others.length - 1].toFixed(1), prof: prof.join(' ') };
}
return out;
