const go = `const G=__K.game; T.ticks(40); T.key('ArrowRight', true); T.ticks(3); T.key('ArrowRight', false); T.ticks(3); T.tapKey('Space'); T.ticks(2); T.until(() => G.state === 'card', 400); T.until(() => G.state === 'play', 400); T.place2(640, 0, 0); __K.player.invT = 9; T.ticks(60);`;
const lum = `const g=T.glStats(); return g.mean;`;
module.exports = [
  { name: 'a2', code: go + `return 1;` },
  { name: 'd1', shot: true, code: `const K=__K; K.post.look.debug='dof'; K.post.cinematic(true, { focus: () => K.player.center(), letterbox: true, dof: true }); T.ticks(40); T.frame(); for(let i=0;i<3;i++) T.renderNow(); ${lum}` },
  { name: 'd2', shot: true, code: `const K=__K; T.ticks(30); T.frame(); for(let i=0;i<3;i++) T.renderNow(); ${lum}` },
  { name: 'd3', shot: true, code: `const K=__K; K.post.cinematic(false); T.ticks(60); T.frame(); K.post.cinematic(true, { focus: () => K.player.center(), letterbox: true, dof: true }); T.ticks(40); T.frame(); for(let i=0;i<3;i++) T.renderNow(); ${lum}` },
];
