const K=__K, G=K.game, P=K.player, E=K.entities;
const gl = K.view.renderer.backend.gl; const errs = () => { const o=[]; let e; let n=0; while ((e=gl.getError()) && n++<20) o.push(e); return o; };
T.ticks(40); T.tapKey('Space'); T.ticks(4); T.until(()=>G.state==='play',300);
const log = [];
const snap = tag => { T.frame(); const g = T.glStats(); log.push({tag, st:G.state, act:G.act, cine:K.post.stats().cinematic, dof:K.post.stats().dof, mean:g.mean, e:errs()}); };
snap('play');
K.post.cinematic(true, { focus: () => P.center(), letterbox: true, dof: true });
for (let i=0;i<4;i++) { T.ticks(10); snap('cine'+i); }
K.post.cinematic(false);
for (let i=0;i<4;i++) { T.ticks(20); snap('after'+i); }
return log;
