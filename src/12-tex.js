// ===================== 12-tex.js — K.tex: generated PBR textures (assets/tex/<role>/*.webp) =====================
// Every art role owns assets/tex/<role>/ and its manifest.json (written by tools/tex/texlib.py, see SPEC3 §4 and the
// Foundation notes). K.tex merges the role manifests at boot and hands out THREE.Texture objects at once: a 1×1
// neutral texture until the WebP arrives, then the real image in the same Texture (materials need no rebuild).
//   K.tex.init()                         -> Promise (manifests fetched; boot awaits it)
//   K.tex.load(name, opts)               -> THREE.Texture (cached by name). name = '<role>/<texture>' as in the manifest.
//       opts: { repeat: [x, y] | number, wrap: 'repeat'|'clamp'|'mirror', anisotropy (default 8), colorSpace override
//               ('srgb'|'linear'), fallback: [r, g, b, a] 0..255 }
//   K.tex.preload(names, onProgress)     -> Promise (resolves when every name is loaded or failed; onProgress(0..1))
//   K.tex.preloadGroup(group, onProgress)-> Promise for every manifest entry of that group ('act1', 'act2', 'common')
//   K.tex.set('full'|'half')             -> switches the resolution set (K.gfx.texRes follows the preset); loaded
//                                           textures are reloaded in place
//   K.tex.stats()                        -> { count, loaded, failed, pending, res, gpuBytes (estimated, mips incl.),
//                                           fileBytes (downloaded), names }
//   K.tex.manifest                       -> merged { name: entry } (entry: full, half, size, halfSize, colorSpace,
//                                           bytes, halfBytes, group, wrap, role, base)
(() => {
'use strict';
const ROLES = ['foundation', 'post', 'kit', 'world', 'city', 'vehicles', 'entities'];
const BASE = 'assets/tex/';
const NEUTRAL = { srgb: [128, 128, 128, 255], normal: [128, 128, 255, 255], orm: [255, 204, 0, 255], linear: [128, 128, 128, 255] };

const S = { res: 'full', inited: null, cache: new Map(), loaded: 0, failed: 0, pending: 0, fileBytes: 0, gen: 0 };
const tex = K.tex = {
  manifest: Object.create(null),
  roles: ROLES.slice(),
  get res() { return S.res; },
  init, load, preload, preloadGroup, set, stats, has: name => !!tex.manifest[name],
  // names of the manifest entries in a group
  group(g) { return Object.keys(tex.manifest).filter(n => tex.manifest[n].group === g); }
};

function init() {
  if (S.inited) return S.inited;
  // follow the quality preset (K.gfx is created by 15-post.js, after this part)
  if (K.gfx && typeof K.gfx.onChange === 'function') {
    if (typeof K.gfx.sync === 'function') K.gfx.sync();
    S.res = K.gfx.texRes === 'half' ? 'half' : 'full';
    K.gfx.onChange(g => set(g.texRes));
  }
  S.inited = Promise.all(ROLES.map(role => fetch(BASE + role + '/manifest.json', { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : null))
    .then(m => {
      if (!m || typeof m !== 'object' || !m.textures) return;
      for (const name in m.textures) {
        const e = Object.assign({}, m.textures[name]);
        e.role = role; e.base = BASE + role + '/';
        tex.manifest[name.indexOf('/') > 0 ? name : role + '/' + name] = e;
      }
    })
    .catch(err => console.warn('Kit Rush 3D: texture manifest ' + role, err))));
  return S.inited;
}

function kindOf(e, opts) {
  const cs = (opts && opts.colorSpace) || (e && e.colorSpace) || 'srgb';
  if (cs === 'srgb') return 'srgb';
  if (e && /normal/i.test(e.full || '')) return 'normal';
  if (e && /orm/i.test(e.full || '')) return 'orm';
  return 'linear';
}
function neutralImage(rgba) {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const g = c.getContext('2d');
  g.fillStyle = `rgba(${rgba[0]},${rgba[1]},${rgba[2]},${(rgba[3] == null ? 255 : rgba[3]) / 255})`;
  g.fillRect(0, 0, 1, 1);
  return c;
}
function wrapOf(w) {
  return w === 'clamp' ? THREE.ClampToEdgeWrapping : w === 'mirror' ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
}

function load(name, opts) {
  opts = opts || {};
  let rec = S.cache.get(name);
  if (rec) return rec.tex;
  const e = tex.manifest[name] || null;
  const kind = kindOf(e, opts);
  const t = new THREE.Texture(neutralImage(opts.fallback || NEUTRAL[kind]));
  t.name = name;
  t.colorSpace = kind === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = wrapOf(opts.wrap || (e && e.wrap) || 'repeat');
  if (opts.repeat != null) { if (typeof opts.repeat === 'number') t.repeat.set(opts.repeat, opts.repeat); else t.repeat.set(opts.repeat[0], opts.repeat[1]); }
  t.anisotropy = opts.anisotropy || 8;
  t.flipY = false; // the bitmaps are decoded already flipped (ImageBitmap uploads ignore flipY on WebGL)
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  rec = { tex: t, entry: e, state: e ? 'pending' : 'missing', res: '', bytes: 0, file: 0, promise: null };
  S.cache.set(name, rec);
  if (e) fetchInto(rec);
  else console.warn('Kit Rush 3D: unknown texture ' + name);
  return t;
}

function fetchInto(rec) {
  const e = rec.entry, res = S.res, file = res === 'half' && e.half ? e.half : e.full;
  const gen = S.gen;
  if (rec.state !== 'loaded') S.pending++;
  const wasLoaded = rec.state === 'loaded';
  rec.state = wasLoaded ? 'loaded' : 'pending';
  rec.promise = fetch(e.base + file)
    .then(r => { if (!r.ok) throw new Error(r.status + ' ' + file); return r.blob(); })
    .then(b => { rec.file = b.size; return createImageBitmap(b, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); })
    .then(img => {
      const t = rec.tex, old = t.image;
      // a GPU texture keeps the storage size of its first upload (texStorage2D on WebGL 2, a fixed-size GPUTexture on
      // WebGPU): when the size changes (1x1 fallback -> WebP after a first draw, full <-> half on a preset change) the
      // renderer must drop it and create a new one, else the upload overflows (GL_INVALID_VALUE) or fills a corner only
      const resized = !old || old.width !== img.width || old.height !== img.height;
      t.image = img;
      if (resized) t.dispose();
      t.needsUpdate = true;
      if (old && typeof old.close === 'function') { try { old.close(); } catch (x) { /* already closed */ } }
      rec.res = res;
      rec.bytes = Math.round(img.width * img.height * 4 * (t.generateMipmaps ? 4 / 3 : 1));
      if (!wasLoaded) { S.pending--; S.loaded++; }
      S.fileBytes += rec.file;
      rec.state = 'loaded';
      if (gen !== S.gen && res !== S.res) fetchInto(rec); // the set changed while this one was in flight
    })
    .catch(err => {
      if (!wasLoaded) { S.pending--; S.failed++; rec.state = 'failed'; }
      console.warn('Kit Rush 3D: texture ' + rec.tex.name + ' not loaded', err);
    });
  return rec.promise;
}

function preload(names, onProgress) {
  const list = (names || []).filter(Boolean);
  if (!list.length) { if (onProgress) onProgress(1); return Promise.resolve(); }
  let done = 0;
  return Promise.all(list.map(n => {
    load(n);
    const rec = S.cache.get(n);
    const p = rec && rec.promise ? rec.promise : Promise.resolve();
    return p.then(() => { done++; if (onProgress) { try { onProgress(done / list.length); } catch (x) { /* ignore */ } } });
  })).then(() => undefined);
}
function preloadGroup(group, onProgress) {
  return init().then(() => preload(tex.group(group), onProgress));
}

function set(res) {
  res = res === 'half' ? 'half' : 'full';
  if (res === S.res) return S.res;
  S.res = res; S.gen++;
  for (const rec of S.cache.values()) if (rec.entry && rec.state === 'loaded' && rec.res !== res) fetchInto(rec);
  return S.res;
}

function stats() {
  let gpu = 0;
  const names = [];
  for (const [n, rec] of S.cache) { names.push(n); gpu += rec.state === 'loaded' ? rec.bytes : 4; }
  return { count: S.cache.size, loaded: S.loaded, failed: S.failed, pending: S.pending, res: S.res, gpuBytes: gpu, fileBytes: S.fileBytes, names };
}
})();
