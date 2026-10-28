const K=__K, G=K.game, P=K.player, C=K.city, B=K.board;
T.ticks(30); T.key('ArrowRight', true); T.ticks(3); T.key('ArrowRight', false); T.ticks(3); T.tapKey('Space'); T.ticks(4);
T.until(()=>G.state==='card',600); T.until(()=>G.state==='play',600);
T.place2(C.feature('bumper') - 60, 0, 30); P.invT = 0; T.key('ArrowUp', true); T.until(() => B.mode === 'flight', 600); T.key('ArrowUp', false);
const out = [];
const scr = {x:0,y:0,visible:false};
for (let i = 0; i < 40; i++) {
  T.ticks(15);
  const c = P.center(); K.view.toScreen(c, scr);
  const kit = K.view.scene.getObjectByName('kit');
  out.push({ i, ts: +B.timeScale.toFixed(2), u: +(B.stats().flightU||0).toFixed(2), mode: B.mode, sx: Math.round(scr.x), sy: Math.round(scr.y), vis: scr.visible, kitVis: kit && kit.visible, d: +K.view.camera.position.distanceTo(c).toFixed(1) });
  if (B.mode !== 'flight') break;
}
return out;
