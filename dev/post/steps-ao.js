const settle = `for (let i = 0; i < 6; i++) T.renderNow();`;
const Q = process.env.PRESET || 'high';
module.exports = [
  { name: 'setup', code: `T.ticks(40); const G=__K.game; T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300); T.ticks(40); return 1;` },
  { name: 'ao-a1', shot: true, code: `const K=__K; K.post.look.debug='ao'; K.post.setQuality('${Q}'==='ultra'?'high':'ultra'); K.post.setQuality('${Q}'); T.teleport(-6, -100, T.routeDirYaw(-6, -100), 0); T.ticks(60); T.frame(); ${settle} return K.post.stats().passes;` },
  { name: 'gi-a1', shot: true, code: `const K=__K; K.post.look.debug='gi'; K.post.setQuality('high'); K.post.setQuality('${Q}'); T.frame(); ${settle} return 1;` },
  { name: 'final-a1', shot: true, code: `const K=__K; K.post.look.debug=''; K.post.setQuality('high'); K.post.setQuality('${Q}'); T.frame(); ${settle} return 1;` },
];
