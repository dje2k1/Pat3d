const settle = `for (let i = 0; i < 6; i++) T.renderNow();`;
module.exports = [
  { name: 'a2', code: `const G=__K.game; T.ticks(40); T.key('ArrowRight', true); T.ticks(3); T.key('ArrowRight', false); T.ticks(3); T.tapKey('Space'); T.ticks(2); T.until(() => G.state === 'card', 400); T.until(() => G.state === 'play', 400); T.place2(640, 0, 0); __K.player.invT = 9; T.ticks(60); return G.act;` },
  { name: 'dof-off', shot: true, code: `const K=__K; K.player.vel.set(0,0,0); ${settle} return K.post.stats().dof;` },
  { name: 'cine-nodof', shot: true, code: `const K=__K; K.post.cinematic(true, { focus: () => K.player.center(), letterbox: true, dof: false }); T.ticks(40); T.frame(); for(let i=0;i<5;i++){ T.renderNow(); } return K.post.stats();` },
  { name: 'cine-dof', shot: true, code: `const K=__K; K.post.cinematic(true, { focus: () => K.player.center(), letterbox: true, dof: true }); T.ticks(40); T.frame(); for(let i=0;i<5;i++){ T.renderNow(); } const u=K.post.uniforms; return {s:K.post.stats().dof, f:u.focus.value, fl:u.focal.value, b:u.bokeh.value};` },
];
