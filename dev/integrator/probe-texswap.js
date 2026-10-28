const K=__K, W=K.world; T.ticks(40); T.tapKey('Space'); T.ticks(4); T.until(()=>K.game.state==='play',300); T.ticks(10);
document.getElementById('hud').style.visibility='hidden';
const mode = window.__mode;
if (mode === 'swap') { K.post.setQuality('medium'); await new Promise(r=>setTimeout(r,4000)); }
T.teleport(0,-20,0,0); T.ticks(30);
K.camera.update = () => {};
const cam = K.view.camera; const g = W.ground(0,-26,1e4).y;
cam.position.set(1.5, g+2.2, -22); cam.lookAt(0, g, -27); cam.updateMatrixWorld();
for (let i=0;i<6;i++) T.renderNow();
return {q:K.post.quality, res:K.tex.res};
