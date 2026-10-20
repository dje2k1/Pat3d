// a visual tour of both acts for one preset: PRESET=high SR=0 node dev/post/shoot.js --steps=dev/post/steps-tour.js --prefix=high-
const Q = process.env.PRESET || 'high', SR = process.env.SR === '1', ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const settle = `for (let i = 0; i < 8; i++) T.renderNow();`;
const steps = [
  { name: 'setup', code: `__K.post.setQuality('${Q}'); __K.post.setSuperRes(${SR}); T.ticks(40); const G=__K.game; T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300); T.ticks(40); return __K.post.stats().passes;` },
  { name: 'a1-start', shot: true, code: `T.frame(); ${settle} const s=__K.post.stats(); return {sc:s.sceneCalls, calls:s.calls, cost:s.cost, internal:s.internal};` },
  { name: 'a1-sun', shot: true, code: `const K=__K, cam=K.view.camera, st=K.level.start.pos; const d=new THREE.Vector3(0.5,0.7,-0.42).normalize(); cam.position.set(st.x, st.y+2.5, st.z+6); cam.lookAt(cam.position.clone().add(new THREE.Vector3(d.x, 0.32, d.z).normalize())); cam.updateMatrixWorld(); ${settle} return K.post.stats().sunVis;` },
  { name: 'a1-valley', shot: true, code: `T.teleport(-6, -100, T.routeDirYaw(-6, -100), 0); T.ticks(60); T.frame(); ${settle} return T.glStats();` },
  { name: 'a1-speed', shot: true, code: `const K=__K, P=K.player; T.teleport(0, -10, T.routeDirYaw(0, -10), 36); T.key('KeyW', true); T.pre = () => { K.post.speed(0.9); K.vfx.speedLines(0.9); }; T.ticks(30); T.frame(); T.frame(); T.frame(); T.pre = null; T.key('KeyW', false); return {spd:K.post.stats().speed, v:P.vel.length()};` },
  { name: 'a2-street', shot: true, code: `const G=__K.game; T.toTitle(); T.ticks(10); T.ticks(40); T.key('ArrowRight', true); T.ticks(3); T.key('ArrowRight', false); T.ticks(3); T.tapKey('Space'); T.ticks(2); T.until(() => G.state === 'card', 400); T.until(() => G.state === 'play', 400); T.place2(640, 0, 0); __K.player.invT = 9; T.ticks(90); T.frame(); ${settle} return {act:G.act, g:T.glStats()};` },
  { name: 'a2-sun', shot: true, code: `const K=__K, cam=K.view.camera, p=K.player.pos; const d=new THREE.Vector3(-0.92,0.2,-0.33).normalize(); cam.position.set(p.x, p.y+3, p.z); cam.lookAt(cam.position.clone().add(new THREE.Vector3(d.x, 0.12, d.z).normalize())); cam.updateMatrixWorld(); ${settle} return K.post.stats().sunVis;` },
  { name: 'a2-lower', shot: true, code: `T.place2(1120, 0, 0); __K.player.invT = 9; T.ticks(90); T.frame(); ${settle} return T.glStats();` },
  { name: 'a2-cine', shot: true, code: `const K=__K; K.post.cinematic(true, { focus: () => K.player.center(), letterbox: true, dof: true }); T.ticks(60); T.frame(); ${settle} const s=K.post.stats(); K.post.cinematic(false); return {dof:s.dof, lb:s.letterbox};` },
];
module.exports = ONLY.length ? steps.filter(s => s.name === 'setup' || ONLY.includes(s.name) || (s.name === 'a2-street' && ONLY.some(o => o.startsWith('a2')))) : steps;
