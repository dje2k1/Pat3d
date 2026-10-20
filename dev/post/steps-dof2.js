module.exports = [
  { name: 'a2', code: `const G=__K.game; T.ticks(40); T.key('ArrowRight', true); T.ticks(3); T.key('ArrowRight', false); T.ticks(3); T.tapKey('Space'); T.ticks(2); T.until(() => G.state === 'card', 400); T.until(() => G.state === 'play', 400); T.place2(640, 0, 0); __K.player.invT = 9; T.ticks(60); return G.act;` },
  { name: 'dof-b0', shot: true, code: `const K=__K; K.post.look.dofScale = 0; K.post.cinematic(true, { focus: () => K.player.center(), letterbox: true, dof: true }); T.ticks(40); T.frame(); for(let i=0;i<4;i++){ T.renderNow(); } return K.post.stats().dof;` },
  { name: 'dof-far', shot: true, code: `const K=__K; K.post.look.dofScale = 1; K.post.look.dofRange = 30; T.ticks(2); T.frame(); for(let i=0;i<4;i++){ T.renderNow(); } return K.post.uniforms.focal.value;` },
];
