module.exports = [
  { name: 'a2', code: `const G=__K.game; T.ticks(40); T.key('ArrowRight', true); T.ticks(3); T.key('ArrowRight', false); T.ticks(3); T.tapKey('Space'); T.ticks(2); T.until(() => G.state === 'card', 400); T.until(() => G.state === 'play', 400); T.place2(640, 0, 0); __K.player.invT = 9; T.ticks(60); return G.act;` },
  { name: 'rt', code: `const K=__K, S=K.post._state, d=S.G.named.dof, tr=S.G.named.traa, r=K.view.renderer;
    K.post.cinematic(true, { focus: () => K.player.center(), letterbox: true, dof: true }); T.ticks(40); T.frame(); T.renderNow();
    const rd = async (rt, i) => { const w=rt.width, h=rt.height; const px = await r.readRenderTargetPixelsAsync(rt, Math.floor(w*0.3), Math.floor(h*0.5), 1, 1, i||0); return [w,h,Array.from(px).map(v=>+(+v).toFixed(3))]; };
    return { traa: await rd(tr._resolveRenderTarget), coc0: await rd(d._CoCRT,0), coc1: await rd(d._CoCRT,1), b64: await rd(d._blur64RT), farB: await rd(d._blur16FarRT), nearB: await rd(d._blur16NearRT), comp: await rd(d._compositeRT), u:[K.post.uniforms.focus.value,K.post.uniforms.focal.value,K.post.uniforms.bokeh.value] };` },
];
