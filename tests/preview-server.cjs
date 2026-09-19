// Изолированный браузерный стенд. Никаких записей в настоящий Supabase.
// node tests/preview-server.cjs — http://127.0.0.1:8766
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const fixture = `
window.SchoolHomework = { createClient: function () {
  var teacher = false, rows = [], urls = {};
  return {
    configured: true, storageScope: 'isolated-browser-test', isTeacher: function () { return teacher; },
    login: async function () { teacher = true; }, logout: async function () { teacher = false; },
    list: async function () { return rows.slice(); },
    photoUrl: function (p) { return urls[p] || null; },
    uploadPhoto: async function (blob) { var p = crypto.randomUUID() + '.jpg'; urls[p] = URL.createObjectURL(blob); return p; },
    removePhotos: async function (paths) { paths.forEach(function (p) { URL.revokeObjectURL(urls[p]); delete urls[p]; }); },
    save: async function (input, old) {
      var row = Object.assign({}, input, { id: old ? old.id : crypto.randomUUID(), version: old ? old.version + 1 : 1 });
      rows = rows.filter(function (r) { return r.id !== row.id; }); rows.push(row); return row;
    },
    remove: async function (old) { rows = rows.filter(function (r) { return r.id !== old.id; }); }
  };
}};`;
http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/__fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fixture); return; }
  if (pathname === '/service-worker.js') { res.writeHead(404); res.end(); return; }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    let content = fs.readFileSync(file);
    if (file.endsWith('index.html')) content = content.toString().replace(/(<script src="\.\/homework\.js\?v=\d+"><\/script>)/, '<script src="/__fixture.js"></script>$1');
    res.setHeader('Content-Type', ({'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.woff2':'font/woff2'})[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store'); res.end(content);
  } catch { res.writeHead(404); res.end(); }
}).listen(8766, '127.0.0.1', () => console.log('Isolated photo test: http://127.0.0.1:8766'));
