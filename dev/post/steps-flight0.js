// reproduces the kit role's note: flight cinematic darkening when frames are drawn every 10 ticks
const Q = process.env.PRESET || 'high';
module.exports = [
  { name: 'setup', code: `__K.post.setQuality('${Q}'); const G=__K.game; T.ticks(40); T.key("ArrowRight", true); T.ticks(3); T.key("ArrowRight", false); T.ticks(3); T.tapKey("Space"); T.ticks(2); T.until(() => G.state === "card", 400); T.until(() => G.state === "play", 600); return G.act;` },
  { name: 'fly', code: `const G=__K.game, C=__K.city, B=__K.board, P=__K.player; const out=[]; const lum=(tag)=>{ window.__pump(0); const s=T.glStats(); out.push(tag+' '+s.mean.toFixed(1)+' '+__K.post.stats().dof+' cin '+__K.post.stats().cinematic); };
    P.invT=0; G.rings=Math.max(G.rings,5); T.place2(C.feature('bumper')-60,0,30); lum('placed');
    T.key('ArrowUp', true); for (let i=0;i<600 && B.mode!=='flight';i++){ T.ticks(1); if (i%20===0) lum('up'+i+B.mode); } T.key('ArrowUp', false);
    lum('flight0'); for (let i=0;i<70;i+=10){ T.ticks(10); lum('fl'+i); } return out;` , shot: true },
];
