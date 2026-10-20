// VFX look: a burst of every effect in front of Kit (Act 1 start), a frame mid-life, plus a dust landing on the ground
const Q = process.env.PRESET || 'high';
const settle = `for (let i = 0; i < 3; i++) T.renderNow();`;
module.exports = [
  { name: 'setup', code: `__K.post.setQuality('${Q}'); T.ticks(40); const G=__K.game; T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300); T.ticks(40); return 1;` },
  { name: 'burst', shot: true, code: `const K=__K, X=K.vfx, P=K.player, V3=THREE.Vector3; const p=P.pos.clone(); const f=new V3(0,0,-1);
    X.jump(p.clone(), new V3(0,1,0)); X.land(p.clone().add(new V3(2.5,0,-3)), new V3(0,1,0), 14); X.ringPickup(p.clone().add(new V3(-2,1.5,-4)));
    X.boom(p.clone().add(new V3(3,1,-9)), 1); X.impact(p.clone().add(new V3(-3,0.2,-7)), 0x66ccff, 2.5); X.sparks(p.clone().add(new V3(-1,0.6,-2)), new V3(1,0.5,0), 30, 0xffaa33);
    for (let i=0;i<6;i++) { T.ticks(1); X.homingTrail(p.clone().add(new V3(Math.sin(i)*0.5, 1+i*0.2, -2-i))); }
    T.ticks(4); T.frame(); ${settle} return X.stats();` },
  { name: 'burst2', shot: true, code: `T.ticks(14); T.frame(); ${settle} return __K.vfx.stats();` },
  { name: 'confetti', shot: true, code: `const K=__K, X=K.vfx, P=K.player, V3=THREE.Vector3; X.confetti(P.pos.clone().add(new V3(0,2,-4))); T.ticks(30); T.frame(); ${settle} return X.stats();` },
];
