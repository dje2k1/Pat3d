T.ticks(40);
const sc = __K.view.scene, mesh = sc.children.find(o => o.name === 'vfx-glow');
mesh.visible = true;
const R = __K.view.renderer;
const sh = await R.debug.getShaderAsync(sc, __K.view.camera, mesh);
const v = sh.vertexShader;
return v.slice(v.indexOf('void main'));
