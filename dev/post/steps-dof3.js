module.exports = [
  { name: 'a2', code: `const G=__K.game; T.ticks(40); T.key('ArrowRight', true); T.ticks(3); T.key('ArrowRight', false); T.ticks(3); T.tapKey('Space'); T.ticks(2); T.until(() => G.state === 'card', 400); T.until(() => G.state === 'play', 400); T.place2(640, 0, 0); __K.player.invT = 9; T.ticks(60); return G.act;` },
  { name: 'dofdbg', code: `const K=__K, S=K.post._state, d=S.G.named.dof; let n=0; const ub=d.updateBefore.bind(d); d.updateBefore=function(f){n++; return ub(f);};
    K.post.look.dofScale = 0; K.post.cinematic(true, { focus: () => K.player.center(), letterbox: true, dof: true }); T.ticks(40); T.frame(); T.renderNow();
    const r=K.view.renderer; const has = rt => { try { return !!r.backend.get(rt.texture).textureGPU; } catch(e) { return 'err '+e.message; } };
    return {n, type:d.updateBeforeType, comp: has(d._compositeRT), coc: has(d._CoCRT), w: d._compositeRT.width, h: d._compositeRT.height, tex: d.textureNode.value.image, fresh:S.fresh};` },
];
