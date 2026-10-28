const K=__K, G=K.game, P=K.player, C=K.city, B=K.board;
T.ticks(30); T.key('ArrowRight', true); T.ticks(3); T.key('ArrowRight', false); T.ticks(3); T.tapKey('Space'); T.ticks(4);
T.until(()=>G.state==='card',600); T.until(()=>G.state==='play',600);
const s0 = C.feature('t3b') + 40;
T.place2(s0, 0, 12); P.invT = 9;
const out = [];
for (let i=0;i<8;i++){ T.ticks(5); const c=K.view.camera.position; const r=C.routeAt(P.pos.x,P.pos.z); out.push({p:P.pos.toArray().map(v=>+v.toFixed(1)), cam:[c.x,c.y,c.z].map(v=>+v.toFixed(1)), s:r&&+r.s.toFixed(1), d:r&&+r.d.toFixed(2), mode:B.mode, vis: K.view.scene.getObjectByName('kit') && K.view.scene.getObjectByName('kit').visible, inv:+P.invT.toFixed(2), dead:P.dead}); }
return out;
