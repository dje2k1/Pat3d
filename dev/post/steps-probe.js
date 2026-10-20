module.exports = [
  { name: 'probe', code: `const K=__K, G=K.game; T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300); T.ticks(40);
   const out=[]; T.frame(); out.push(['frame', K.view.stats.sceneCalls, K.view.stats.calls]);
   T.renderNow(); out.push(['now1', K.view.stats.sceneCalls, K.view.stats.calls]);
   T.renderNow(); out.push(['now2', K.view.stats.sceneCalls, K.view.stats.calls]);
   T.frame(); out.push(['frame2', K.view.stats.sceneCalls, K.view.stats.calls]);
   const nf = K.view.renderer._nodes.nodeFrame; out.push(['fid', nf.frameId, nf.renderId]);
   T.renderNow(); out.push(['fid2', nf.frameId, nf.renderId, K.view.stats.calls]);
   return out;` },
];
