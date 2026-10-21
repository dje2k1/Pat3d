// SSR opt-in check (mask packed in velocity.z): a glossy dark slab opted in with K.post.ssr() in front of Kit;
// strength 1 vs 0 on Ultra and Élevé -> mean abs difference over the slab (reflections present) + screenshots
const settle = `for (let i = 0; i < 12; i++) T.renderNow();`;
module.exports = [
  { name: 'setup', code: `__K.post.setQuality('high'); T.ticks(40); const G=__K.game; T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300); T.ticks(30);
    const K=__K, P=K.player, cam=K.view.camera; const fw=new THREE.Vector3(); cam.getWorldDirection(fw); fw.y=0; fw.normalize();
    const m=new THREE.MeshStandardNodeMaterial({ color: 0x101418, roughness: 0.05, metalness: 0 });
    window.__ssrU = K.post.ssr(m, 1, 0.03);
    const slab=new THREE.Mesh(new THREE.BoxGeometry(7, 0.1, 7), m); slab.position.copy(P.pos).addScaledVector(fw, 6); slab.position.y = P.pos.y + 0.02; slab.name='ssrSlab';
    K.view.scene.add(slab); slab.updateMatrixWorld(true); window.__slab = slab; return slab.position.toArray().map(v=>+v.toFixed(1));` },
  ...['ultra', 'high'].map(q => ({ name: 'ssr-' + q, shot: true, code: `
    const K=__K; K.post.setQuality('${q}'); const c=K.view.renderer.domElement, W=c.width, H=c.height;
    const sl=__slab, cam=K.view.camera; const pr=sl.position.clone().project(cam); const cx=Math.round((pr.x*0.5+0.5)*W), cy=Math.round((0.5-pr.y*0.5)*H);
    const box=[Math.max(0,cx-120), Math.max(0,cy-40), 240, 80];
    const grab=()=>{ const p=T.pixels(...box); return new Uint8ClampedArray(p.px); };
    __ssrU.value=0; ${settle} const a=grab(); __ssrU.value=1; ${settle} const b=grab();
    let d=0; for (let i=0;i<a.length;i+=4) d+=(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/3;
    const s=K.post.stats(); return { q:'${q}', backend: K.view.backend, ssrOn: s.ssrOn, scene: s.passes[0], ssrPass: s.passes.find(p=>/^ssr/.test(p)), box, meanDiff: +(d/(a.length/4)).toFixed(2) };` })),
];
