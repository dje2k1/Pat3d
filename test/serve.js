// Tiny static file server for the tests (ES modules cannot load from file://).
// Usage: node test/serve.js [port] [root]   (port 0 = any free port; prints "http://127.0.0.1:<port>/")
// Or: const { serve } = require('./serve'); const srv = await serve(root); srv.url ... srv.close()
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ktx2': 'image/ktx2', '.bin': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.wasm': 'application/wasm'
};
function serve(root, port) {
  root = path.resolve(root || path.join(__dirname, '..'));
  const stats = { requests: 0, bytes: 0, files: Object.create(null) };
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end(); return; }
    let f = path.join(root, path.normalize(p).replace(/^([/\\])+/, ''));
    if (f !== root && !f.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.stat(f, (err, st) => {
      if (!err && st.isDirectory()) {
        if (!p.endsWith('/')) { res.writeHead(301, { Location: p + '/' }); res.end(); return; }
        f = path.join(f, 'index.html');
      }
      fs.readFile(f, (err2, data) => {
        if (err2) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
        stats.requests++; stats.bytes += data.length; stats.files[p] = data.length;
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port || 0, '127.0.0.1', () => {
      const url = 'http://127.0.0.1:' + server.address().port + '/';
      resolve({ url, server, stats, close: () => new Promise(r => server.close(() => r())) });
    });
  });
}
module.exports = { serve };
if (require.main === module) {
  serve(process.argv[3], +process.argv[2] || 0).then(s => console.log(s.url));
}
