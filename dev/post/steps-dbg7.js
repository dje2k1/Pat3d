const go = `const G=__K.game; T.ticks(40); T.key('ArrowRight', true); T.ticks(3); T.key('ArrowRight', false); T.ticks(3); T.tapKey('Space'); T.ticks(2); T.until(() => G.state === 'card', 400); T.until(() => G.state === 'play', 400); T.place2(640, 0, 0); __K.player.invT = 9; T.ticks(60);`;
module.exports = [
  { name: 'a2', code: go + `return 1;` },
  { name: 'raw', shot: true, code: `const K=__K; K.post.look.debug='hdrRaw'; K.post.setQuality('ultra'); K.post.setQuality('high'); T.ticks(2); T.frame(); for(let i=0;i<3;i++) T.renderNow(); return 1;` },
  { name: 'dofraw', shot: true, code: `const K=__K; K.post.look.debug='dof'; K.post.setQuality('ultra'); K.post.setQuality('high'); K.post.cinematic(true, { focus: () => K.player.center(), letterbox: true, dof: true }); T.ticks(40); T.frame(); for(let i=0;i<3;i++) T.renderNow(); return 1;` },
];
