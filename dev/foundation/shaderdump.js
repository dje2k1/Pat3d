T.ticks(40);
const sc = __K.view.scene, mesh = sc.children.find(o => o.name === 'vfx-glow');
mesh.visible = true;
const R = __K.view.renderer;
const sh = await R.debug.getShaderAsync(sc, __K.view.camera, mesh);
window.__sh = sh;
return { v: sh.vertexShader.length, f: sh.fragmentShader.length, frag: sh.fragmentShader.slice(sh.fragmentShader.indexOf('void main'), sh.fragmentShader.indexOf('void main') + 6000) };
