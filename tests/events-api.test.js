const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../events-model.js');
const { createClient } = require('../homework-api.js');
const id = '11111111-1111-4111-8111-111111111111';
const input = model.validate({ kind: 'event', title: 'Тесла-шоу', body: '‼️ Наука\nЭксперименты', event_date: '2026-10-09', time_text: '13:30 — 1 группа; 14:30 — 2 группа', cost: '450 ₽' });
const row = { ...input, id, version: 1, created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z' };
const auth = () => [{ data: { access_token: 'teacher', expires_in: 3600 } }, { data: true }];
function setup(replies) {
  const calls = [];
  const api = createClient({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_example' }, async (url, options) => {
    calls.push({ url, ...options }); const reply = replies.shift(); assert.ok(reply, 'Unexpected request');
    if (reply instanceof Error) throw reply;
    return { ok: (reply.status || 200) < 400, status: reply.status || 200, text: async () => JSON.stringify(reply.data) };
  }); return { api, calls };
}
test('events require dates, announcements can be undated, invalid dates and photos are rejected', () => {
  assert.throws(() => model.validate({ ...input, event_date: null }), /нужна дата/);
  assert.throws(() => model.validate({ ...input, kind: 'test', event_date: null }), /нужна дата/);
  assert.equal(model.validate({ ...input, kind: 'announcement', event_date: null }).event_date, null);
  for (const date of ['2026-02-30', '2026-1-9', '2019-12-31']) assert.throws(() => model.validate({ ...input, event_date: date }), /дату/);
  assert.throws(() => model.validate({ ...input, title: ' ' }));
  assert.throws(() => model.validate({ ...input, body: 'a'.repeat(10001) }));
  assert.throws(() => model.validate({ ...input, photo_paths: ['https://evil.test/a.svg'] }));
  assert.throws(() => model.validate({ ...input, photo_paths: [id + '.jpg', id + '.jpg'] }));
});
test('school midnight and manual archive determine visibility regardless of device timezone', () => {
  const before = model.today('Asia/Yekaterinburg', new Date('2026-10-09T18:59:59Z'));
  const after = model.today('Asia/Yekaterinburg', new Date('2026-10-09T19:00:00Z'));
  assert.equal(before, '2026-10-09'); assert.equal(after, '2026-10-10');
  assert.equal(model.section(row, before), 'upcoming'); assert.equal(model.section(row, after), 'archive');
  assert.equal(model.section({ ...row, event_date: null }, after), 'announcements');
  assert.equal(model.section({ ...row, event_date: null, archived: true }, after), 'archive');
});
test('public reads paginate each section separately; anonymous writes fail before network', async () => {
  const { api, calls } = setup([{ data: [] }, { data: [] }, { data: [] }]);
  for (const section of ['announcements', 'upcoming', 'archive']) await api.listEvents(section, '2026-10-09', 50, 50);
  assert.match(calls[0].url, /event_date=is.null/); assert.match(calls[1].url, /event_date=gte.2026-10-09/);
  assert.match(calls[2].url, /or=\(archived.eq.true,event_date.lt.2026-10-09\)/);
  assert.ok(calls.every(c => c.url.endsWith('limit=50&offset=50') && !c.headers.Authorization));
  await assert.rejects(api.saveEvent(input, null, id), /Войдите/);
  await assert.rejects(api.removeEvent(row), /Войдите/);
});
test('retry after lost create response recovers same UUID without overwriting', async () => {
  const { api, calls } = setup([...auth(), new TypeError('offline'), { status: 409 }, { data: [row] }]);
  await api.login('teacher@example.com', 'test');
  await assert.rejects(api.saveEvent(input, null, id), /Нет связи/);
  assert.equal((await api.saveEvent(input, null, id)).id, id);
  assert.equal(JSON.parse(calls[2].body).id, JSON.parse(calls[3].body).id);
  assert.match(calls[4].url, /id=eq/);
});
test('UUID conflict with different content and stale edits are explicit failures', async () => {
  const { api, calls } = setup([...auth(), { status: 409 }, { data: [{ ...row, body: 'Другое' }] }, { data: [] }, { data: [] }]);
  await api.login('teacher@example.com', 'test');
  await assert.rejects(api.saveEvent(input, null, id), /другим содержимым/);
  await assert.rejects(api.saveEvent(input, row), /изменена или удалена/);
  await assert.rejects(api.removeEvent(row), /изменена или удалена/);
  assert.match(calls[4].url, /version=eq.1/);
});
test('server rejects credentials and shared session is revoked', async () => {
  const { api } = setup([...auth(), { status: 403 }]); let changes = 0; api.onAuthChange(() => changes++);
  await api.login('teacher@example.com', 'test'); await assert.rejects(api.saveEvent(input, null, id));
  assert.equal(api.isTeacher(), false); assert.ok(changes >= 2);
});
test('event photo retry uses same path and verifies duplicate exists in its bucket', async () => {
  const path = id + '.jpg';
  const { api, calls } = setup([...auth(), { status: 400 }, { data: [{ name: path }] }, { data: [] }]);
  await api.login('teacher@example.com', 'test');
  assert.equal(await api.uploadEventPhoto(new Blob(['jpeg'], { type: 'image/jpeg' }), path), path);
  assert.match(calls[2].url, /object\/event-photos\//); assert.equal(calls[2].headers['x-upsert'], 'false');
  assert.match(calls[3].url, /object\/list\/event-photos/);
  await api.removeEventPhotos([path]); assert.match(calls[4].url, /object\/event-photos$/);
});
