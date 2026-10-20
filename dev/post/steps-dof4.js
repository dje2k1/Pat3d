module.exports = [
  { name: 'dbg', code: `const K=__K, S=K.post._state, N=S.G.named; const cnt={};
    for (const k of Object.keys(N)) { const n=N[k]; if (typeof n.updateBefore!=='function') continue; cnt[k]=0; const ub=n.updateBefore.bind(n); n.updateBefore=function(f){cnt[k]++; return ub(f);}; }
    T.ticks(5); T.frame(); T.renderNow(); T.renderNow();
    const types={}; for (const k of Object.keys(N)) types[k]=N[k].updateBeforeType;
    return {cnt, types, fresh:S.fresh, builds:S.builds};` },
  { name: 'rebuild', code: `const K=__K, S=K.post._state; K.post.setQuality('ultra'); K.post.setQuality('high'); const N=S.G.named; const cnt={};
    for (const k of Object.keys(N)) { const n=N[k]; if (typeof n.updateBefore!=='function') continue; cnt[k]=0; const ub=n.updateBefore.bind(n); n.updateBefore=function(f){cnt[k]++; return ub(f);}; }
    T.renderNow(); T.renderNow(); T.renderNow();
    return {cnt, fresh:S.fresh, builds:S.builds};` },
];
