const go = `const G=__K.game; T.ticks(40); T.key('ArrowRight', true); T.ticks(3); T.key('ArrowRight', false); T.ticks(3); T.tapKey('Space'); T.ticks(2); T.until(() => G.state === 'card', 400); T.until(() => G.state === 'play', 400); T.place2(640, 0, 0); __K.player.invT = 9; T.ticks(60); T.frame();`;
module.exports = [
  { name: 'a2', code: go + `return 1;` },
  { name: 'seq', code: `const K=__K, S=K.post._state, d=S.G.named.dof; let n=0; const ub=d.updateBefore.bind(d); d.updateBefore=function(f){n++; return ub(f);};
     K.post.look.debug='dof'; K.post.cinematic(true, { focus: () => K.player.center(), letterbox: true, dof: true }); T.ticks(40); const out=[];
     for (let i=0;i<8;i++){ T.renderNow(); const g=T.glStats(); out.push([n, g.mean]); } return out;` },
];
