T.ticks(40); T.tapKey('Space'); T.ticks(4); T.until(() => __K.game.state === 'play', 300);
T.teleport(0, -10, 0, 0); T.ticks(30);
const cam = __K.view.camera, X = __K.vfx;
const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
const p = cam.position.clone().addScaledVector(fwd, 8);
const out = {};
const base = T.glStats();
out.base = base.mean;
X.reset(); T.ticks(4);
X.impact(p, 0xffd23a, 3, null);
T.ticks(4);
const st = T.glStats(); out.impact = st.mean;
const { w, h, px } = T.pixels();
// luma along a horizontal line through the centre
const row = [];
for (let x = 0; x < w; x += Math.floor(w / 40)) { const i = ((h >> 1) * w + x) * 4; row.push(Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2])); }
out.row = row.join(',');
return out;
