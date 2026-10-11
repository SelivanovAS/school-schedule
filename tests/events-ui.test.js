const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { randomUUID } = require('node:crypto');
const model = require('../events-model.js');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
function event(extra = {}) { return { ...model.validate({ kind: 'event', title: 'Тесла-шоу', body: '‼️ Эксперименты\n<img src=x onerror=alert(1)>', event_date: '2099-10-09', time_text: '13:30 — 1 группа; 14:30 — 2 группа', cost: '450 ₽', payment: 'Перевод или наличные' }), id: randomUUID(), version: 1, created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z', ...extra }; }
async function setup(initial = [], overrides = {}, cache) {
  const dom = new JSDOM(html, { url: 'https://school.example', runScripts: 'outside-only' });
  const w = dom.window; let teacher = false, rows = initial.slice(), calls = [], uploads = [];
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.URL.createObjectURL = () => 'blob:preview'; w.URL.revokeObjectURL = () => {};
  w.crypto.randomUUID = randomUUID; w.confirm = () => true;
  w.SCHEDULE = {}; w.HOMEWORK_CONFIG = { schoolTimeZone: 'Asia/Yekaterinburg' };
  w.SchoolPhotos = { maxFiles: 4, prepare: async () => new w.Blob(['jpeg'], { type: 'image/jpeg' }) };
  const api = {
    configured: true, storageScope: 'fixture', isTeacher: () => teacher,
    login: async () => { teacher = true; }, logout: async () => { teacher = false; },
    list: async () => [], photoUrl: () => null, removePhotos: async () => {},
    listEvents: async (group, date, offset, limit) => { calls.push({ group, offset }); return rows.filter(x => model.section(x, date) === group).slice(offset, offset + limit); },
    saveEvent: async (input, old, id) => { const saved = event({ ...input, id: old ? old.id : id, version: old ? old.version + 1 : 1 }); rows = rows.filter(x => x.id !== saved.id).concat(saved); return saved; },
    removeEvent: async old => { rows = rows.filter(x => x.id !== old.id); },
    eventPhotoUrl: p => 'https://example.supabase.co/storage/v1/object/public/event-photos/' + p,
    uploadEventPhoto: async (blob, p) => { uploads.push(p); return p; }, removeEventPhotos: async () => {}, ...overrides
  };
  w.SchoolHomework = { createClient: () => api };
  if (cache) w.localStorage.setItem('sch3a_events_cache_v1:fixture', JSON.stringify(cache));
  for (const file of ['events-model.js', 'school-app.js', 'homework.js', 'events.js']) w.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  await flush();
  const get = id => w.document.getElementById(id);
  const submit = async id => { get(id).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await flush(); };
  const login = async () => { get('events-tab').click(); await flush(); await submit('teacher-login'); };
  const begin = async () => { await login(); get('event-new').click(); await flush(); get('event-title').value = 'Тесла-шоу'; get('event-body').value = 'Описание'; get('event-date').value = '2099-10-09'; };
  return { dom, w, api, get, submit, login, begin, calls, uploads, rows: () => rows, expire: () => { teacher = false; w.document.dispatchEvent(new w.CustomEvent('school-auth')); } };
}
test('anonymous reader sees details and literal text, archived events and no management controls', async () => {
  const s = await setup([event(), event({ kind: 'announcement', event_date: null, title: 'Новость' }), event({ event_date: '2020-01-01' })]);
  try {
    assert.equal(s.get('events-upcoming').querySelectorAll('article').length, 1);
    assert.match(s.get('events-upcoming').textContent, /14:30 — 2 группа/);
    assert.match(s.get('events-upcoming').textContent, /450 ₽/);
    assert.equal(s.get('events-upcoming').querySelector('img'), null);
    assert.match(s.get('events-upcoming').textContent, /<img src=x/);
    assert.equal(s.get('events-upcoming').querySelector('button'), null);
    assert.match(s.get('events-announcements').textContent, /Новость/);
    assert.equal(s.get('events-archive').querySelectorAll('article').length, 1);
  } finally { s.dom.window.close(); }
});
test('preview and navigation preserve draft; publish is explicit and uses the existing teacher session', async () => {
  const s = await setup();
  try {
    await s.begin(); assert.equal(s.get('events-panel').hidden, false); assert.equal(s.get('assignment-new').hidden, false);
    s.get('event-time').value = '13:30 — 1 группа; 14:30 — 2 группа'; s.get('event-cost').value = '450 ₽';
    await s.submit('event-editor'); assert.equal(s.rows().length, 0); assert.equal(s.get('event-preview-panel').hidden, false);
    assert.match(s.get('event-preview-card').textContent, /14:30/);
    s.get('schedule-tab').click(); s.get('events-tab').click(); await flush();
    assert.equal(s.get('event-preview-panel').hidden, false);
    s.get('event-publish').click(); await flush();
    assert.equal(s.rows().length, 1); assert.equal(s.rows()[0].cost, '450 ₽'); assert.equal(s.get('event-preview-panel').hidden, true);
  } finally { s.dom.window.close(); }
});
test('failed publication and reauthentication retain preview and the creation UUID', async () => {
  const s = await setup(); const ids = []; const save = s.api.saveEvent;
  try {
    await s.begin(); await s.submit('event-editor');
    s.api.saveEvent = async (input, old, id) => { ids.push(id); s.expire(); throw new Error('Войдите заново'); };
    s.get('event-publish').click(); await flush();
    assert.equal(s.rows().length, 0); assert.equal(s.get('event-title').value, 'Тесла-шоу'); assert.equal(s.get('assignment-new').hidden, true);
    s.api.saveEvent = async (input, old, id) => { ids.push(id); return save(input, old, id); };
    await s.submit('teacher-login'); assert.equal(s.get('event-preview-panel').hidden, false);
    s.get('event-publish').click(); await flush(); assert.equal(ids[0], ids[1]); assert.equal(s.rows().length, 1);
  } finally { s.dom.window.close(); }
});
test('four local photos stay local through preview; upload failure retains prepared and uploaded images', async () => {
  const s = await setup(); let uploads = 0, failed = false;
  try {
    await s.begin(); Object.defineProperty(s.get('event-photos'), 'files', { configurable: true, value: [1, 2, 3, 4] });
    s.get('event-photos').dispatchEvent(new s.w.Event('change')); await flush(); await s.submit('event-editor');
    assert.equal(s.get('event-preview-card').querySelectorAll('img').length, 4); assert.equal(s.uploads.length, 0);
    s.api.uploadEventPhoto = async () => { uploads++; if (uploads === 2 && !failed) { failed = true; throw new Error('Нет связи'); } };
    s.get('event-publish').click(); await flush(); assert.equal(s.rows().length, 0); assert.equal(uploads, 2);
    s.get('event-publish').click(); await flush(); assert.equal(s.rows().length, 1); assert.equal(uploads, 5); assert.equal(s.rows()[0].photo_paths.length, 4);
  } finally { s.dom.window.close(); }
});
test('pagination preserves two loaded pages and expanded cards across refresh', async () => {
  const rows = Array.from({ length: 65 }, (_, i) => event({ title: 'Событие ' + i })); const s = await setup(rows);
  try {
    assert.equal(s.get('events-upcoming').querySelectorAll('article').length, 50);
    s.get('events-upcoming-more').click(); await flush(); assert.equal(s.get('events-upcoming').querySelectorAll('article').length, 65);
    const details = s.get('events-upcoming').querySelector('details'); details.open = true;
    s.get('events-refresh').click(); await flush();
    assert.equal(s.get('events-upcoming').querySelectorAll('article').length, 65); assert.equal(s.get('events-upcoming').querySelector('details').open, true);
    assert.ok(s.calls.filter(c => c.group === 'upcoming' && c.offset === 50).length >= 2);
  } finally { s.dom.window.close(); }
});
test('cancel, archive, restore, edit date and delete move the publication correctly', async () => {
  const s = await setup([event()]);
  function click(text, group = 'upcoming') { Array.from(s.get('events-' + group).querySelectorAll('button')).find(b => b.textContent === text).click(); }
  try {
    await s.login(); click('Отменить событие'); await flush(); assert.match(s.get('events-upcoming').textContent, /Отменено/);
    click('В архив'); await flush(); assert.equal(s.get('events-upcoming').querySelectorAll('article').length, 0);
    click('Вернуть из архива', 'archive'); await flush(); assert.equal(s.get('events-upcoming').querySelectorAll('article').length, 1);
    click('Редактировать'); await flush(); s.get('event-date').value = '2020-01-01'; await s.submit('event-editor'); s.get('event-publish').click(); await flush();
    assert.equal(s.get('events-archive-details').open, true); click('Удалить', 'archive'); await flush(); assert.equal(s.rows().length, 0);
  } finally { s.dom.window.close(); }
});
test('offline cache is explicit; recovery removes deleted records, corrupt cache is ignored', async () => {
  const s = await setup([], { listEvents: async () => { throw new Error('offline'); } }, { items: [event()], at: '2026-10-01T12:00:00Z' });
  try {
    assert.match(s.get('events-status').textContent, /Сохранённая копия/); assert.equal(s.get('events-upcoming').querySelectorAll('article').length, 1);
    s.api.listEvents = async () => []; s.get('events-tab').click(); await flush();
    assert.equal(s.get('events-upcoming').querySelectorAll('article').length, 0); assert.equal(s.get('events-status').textContent, 'Обновлено');
  } finally { s.dom.window.close(); }
  const bad = await setup([], {}, { items: [{ title: 'broken' }], at: 'invalid' });
  try { assert.equal(bad.get('events-status').textContent, 'Обновлено'); } finally { bad.dom.window.close(); }
});
test('keyboard navigation covers all three tabs and logout guards drafts in either editor', async () => {
  const s = await setup();
  try {
    s.get('schedule-tab').dispatchEvent(new s.w.KeyboardEvent('keydown', { key: 'End', bubbles: true })); await flush(); assert.equal(s.get('events-panel').hidden, false);
    s.get('events-tab').dispatchEvent(new s.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); assert.equal(s.get('schedule-panel').hidden, false);
    await s.begin(); s.w.confirm = () => false; s.get('teacher-logout').click(); await flush(); assert.equal(s.api.isTeacher(), true);
    s.w.confirm = () => true; s.get('teacher-logout').click(); await flush(); assert.equal(s.api.isTeacher(), false); assert.equal(s.get('event-title').value, '');
  } finally { s.dom.window.close(); }
});
