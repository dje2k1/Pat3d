const seq = (process.env.SEQ || 'ultra,high,ultra,medium,low,high').split(',');
module.exports = [
  { name: 'setup', code: `T.ticks(40); const G=__K.game; T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300); T.ticks(40); T.frame(); return 1;` },
  ...seq.map((q, i) => ({ name: 's' + i + '-' + q, shot: !!process.env.SHOTS, code: `const K=__K; const sr=${q.endsWith('+') ? 'true' : 'false'}; K.post.setSuperRes(sr); K.post.setQuality('${q.replace('+', '')}'); T.ticks(2); T.frame(); const a=[]; for (let i=0;i<4;i++){ const g=T.glStats(); a.push(g.mean); } const m=T.mem(); const inf=K.view.renderer.info.memory; return {a, m, rt: inf.renderTargets, texMB: +(inf.texturesSize/1e6).toFixed(1), passes: K.post.stats().passes.length};` }))
];
