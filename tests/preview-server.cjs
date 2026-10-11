// Изолированный браузерный стенд. Никаких записей в настоящий Supabase.
// node tests/preview-server.cjs — http://127.0.0.1:8766
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const fixture = `
window.SchoolHomework = { createClient: function () {
  var teacher = false, rows = [], urls = {};
  async function events(method, data) {
    var response = await fetch('/__events', { method: method, headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
    if (!response.ok) throw new Error('Публикация уже изменена или удалена.');
    return response.json();
  }
  return {
    configured: true, storageScope: 'isolated-browser-test', isTeacher: function () { return teacher; },
    login: async function () { teacher = true; }, logout: async function () { teacher = false; },
    list: async function () { return rows.slice(); },
    listEvents: async function (group, day, offset, limit) { return (await events('GET')).filter(function (r) { return SchoolEventsModel.section(r, day) === group; }).slice(offset, offset + limit); },
    saveEvent: function (input, old, id) { if (!teacher) throw new Error('Войдите как учитель'); return events('POST', { input: input, old: old, id: id }); },
    removeEvent: function (old) { return events('DELETE', { old: old }); },
    eventPhotoUrl: function (p) { return '/__photos/' + p; },
    uploadEventPhoto: async function (blob, p) { var res = await fetch('/__photos/' + p, { method: 'POST', body: blob }); if (!res.ok) throw new Error('Ошибка фото'); return p; },
    removeEventPhotos: async function (paths) { for (var p of paths) await fetch('/__photos/' + p, { method: 'DELETE' }); },
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
var eventRows = [], images = new Map();
http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/__events' || pathname.startsWith('/__photos/')) {
    // Только локальный стенд: временные данные разделяются между браузерами.
    if (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:8766') { res.writeHead(403); res.end(); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    if (pathname.startsWith('/__photos/')) {
      if (req.method === 'POST') images.set(pathname, raw);
      if (req.method === 'DELETE') images.delete(pathname);
      if (req.method === 'GET') { res.setHeader('Content-Type', 'image/jpeg'); res.end(images.get(pathname)); } else res.end('{}');
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') { res.end(JSON.stringify(eventRows)); return; }
    const data = JSON.parse(raw.toString());
    const old = data.old, current = old && eventRows.find(r => r.id === old.id && r.version === old.version);
    if (old && !current) { res.writeHead(409); res.end('{}'); return; }
    if (req.method === 'DELETE') { eventRows = eventRows.filter(r => r.id !== old.id); res.end('{}'); return; }
    const saved = { ...data.input, id: old ? old.id : data.id, version: old ? old.version + 1 : 1, created_at: old ? old.created_at : new Date().toISOString(), updated_at: new Date().toISOString() };
    eventRows = eventRows.filter(r => r.id !== saved.id).concat(saved); res.end(JSON.stringify(saved)); return;
  }
  if (pathname === '/__fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fixture); return; }
  if (pathname === '/service-worker.js') { res.writeHead(404); res.end(); return; }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    let content = fs.readFileSync(file);
    if (file.endsWith('index.html')) content = content.toString().replace(/(<script src="\.\/school-app\.js\?v=\d+"><\/script>)/, '<script src="/__fixture.js"></script>$1');
    res.setHeader('Content-Type', ({'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.woff2':'font/woff2'})[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store'); res.end(content);
  } catch { res.writeHead(404); res.end(); }
}).listen(8766, '127.0.0.1', () => console.log('Isolated classroom test: http://127.0.0.1:8766'));
