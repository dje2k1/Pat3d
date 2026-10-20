// grade A/B on fixed views: LOOKS env = JSON list of {name, look:{...}} applied to K.post.look (then rebuild)
const Q = process.env.PRESET || 'high';
const looks = JSON.parse(process.env.LOOKS || '[{"name":"cur","look":{}}]');
const settle = `for (let i = 0; i < 8; i++) T.renderNow();`;
const views = (process.env.VIEWS || 'a1,a1v,a2').split(',');
const steps = [{ name: 'setup', code: `__K.post.setQuality('${Q}'); T.ticks(40); const G=__K.game; T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300); T.ticks(40); window.__base = Object.assign({}, __K.post.look); return 1;` }];
const pose = {
  a1: `T.teleport(0, -6, T.routeDirYaw(0, -6), 0); T.ticks(50);`,
  a1v: `T.teleport(-6, -100, T.routeDirYaw(-6, -100), 0); T.ticks(60);`,
  a2: `const G=__K.game; T.toTitle(); T.ticks(50); T.key('ArrowRight', true); T.ticks(3); T.key('ArrowRight', false); T.ticks(3); T.tapKey('Space'); T.ticks(2); T.until(() => G.state === 'card', 400); T.until(() => G.state === 'play', 400); T.place2(640, 0, 0); __K.player.invT = 9; T.ticks(90);`
};
for (const v of views) {
  steps.push({ name: v + '-pose', code: pose[v] + ' return 1;' });
  for (const L of looks) steps.push({ name: v + '-' + L.name, shot: true, code: `const K=__K; Object.assign(K.post.look, window.__base, ${JSON.stringify(L.look)}); const U=K.post.uniforms, l=K.post.look; for (const k of ['sat','curve','ao','gi','ssr','shafts','flare','glare','taaSharp']) if (U[k] && l[k] != null) U[k].value = l[k]; U.vig.value = l.vignette; U.shadowTint.value.set(...l.shadowTint); U.highTint.value.set(...l.highTint); K.post.rebuild(); T.frame(); ${settle} return T.glStats().mean;` });
}
module.exports = steps;
