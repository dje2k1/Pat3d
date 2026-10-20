module.exports = [
  { name: 'setup', code: `T.ticks(40); const G=__K.game; T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300); T.ticks(40); T.frame(); return 1;` },
  ...['ssgi-ao', 'ssgi-gi', 'alb', ''].map(d => ({ name: 'dbg-' + (d || 'none'), shot: true, code: `const K=__K; K.post.look.debug='${d}'; K.post._state.graphs = {}; K.post.setQuality('high'); K.post.setQuality('ultra'); T.ticks(2); T.frame(); const a=[]; for (let i=0;i<3;i++){ a.push(T.glStats().mean); } return a;` }))
];
