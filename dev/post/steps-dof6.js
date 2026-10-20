module.exports = [
  { name: 'a2', code: `const G=__K.game; __K.post.look.dofInput='scene'; __K.post.setQuality('ultra'); __K.post.setQuality('high'); T.ticks(40); T.key('ArrowRight', true); T.ticks(3); T.key('ArrowRight', false); T.ticks(3); T.tapKey('Space'); T.ticks(2); T.until(() => G.state === 'card', 400); T.until(() => G.state === 'play', 400); T.place2(640, 0, 0); __K.player.invT = 9; T.ticks(60); return G.act;` },
  { name: 'dof-scene', shot: true, code: `const K=__K; K.post.cinematic(true, { focus: () => K.player.center(), letterbox: true, dof: true }); T.ticks(40); T.frame(); for(let i=0;i<4;i++){ T.renderNow(); } return K.post.stats().dof;` },
];
