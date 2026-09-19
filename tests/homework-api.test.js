const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('../homework-api.js');
globalThis.crypto = require('node:crypto').webcrypto;
const config = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_example' };
const item = { id: '11111111-1111-4111-8111-111111111111', version: 1 };
const input = { subject: 'Математика', body: 'Страница 5, № 3', due_date: '2026-09-18' };

function fixture(replies) {
  const calls = [];
  const client = createClient(config, async (url, options) => {
    calls.push({ url, ...options });
    const reply = replies.shift();
    assert.ok(reply, 'Unexpected request');
    if (reply instanceof Error) throw reply;
    const status = reply.status || 200;
    return { ok: status < 400, status, text: async () => JSON.stringify(reply.data) };
  });
  return { client, calls };
}
const auth = () => [{ data: { access_token: 'teacher-token', expires_in: 3600 } }, { data: true }];

test('students can read without a user token and cannot write', async () => {
  const { client, calls } = fixture([{ data: [] }]);
  await client.list(100);
  assert.match(calls[0].url, /offset=100$/);
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[0].cache, 'no-store');
  await assert.rejects(client.save(input), /Войдите/);
  await assert.rejects(client.remove(item), /Войдите/);
  assert.equal(calls.length, 1);
});
test('teacher sign-in requires the server role, not merely a valid password', async () => {
  const { client, calls } = fixture([auth()[0], { data: false }, { data: null }]);
  await assert.rejects(client.login('someone@example.com', 'password'), /не назначен/);
  assert.equal(client.isTeacher(), false);
  assert.match(calls[1].url, /rpc\/is_class_teacher/);
  assert.match(calls[2].url, /logout/);
});
test('teacher saves with token and checks server version to prevent stale overwrites', async () => {
  const { client, calls } = fixture([...auth(), { data: [{ ...item, ...input, version: 2 }] }, { data: [] }]);
  await client.login('teacher@example.com', 'password');
  const result = await client.save(input, item);
  assert.equal(result.version, 2);
  assert.equal(calls[2].headers.Authorization, 'Bearer teacher-token');
  assert.equal(calls[2].method, 'PATCH');
  assert.match(calls[2].url, /version=eq.1$/);
  assert.deepEqual(JSON.parse(calls[2].body), input);
  await assert.rejects(client.save(input, item), /уже изменено/);
});
test('failed save is not reported as success and expired credentials revoke local teacher state', async () => {
  const { client } = fixture([...auth(), new TypeError('offline'), { status: 401, data: {} }]);
  await client.login('teacher@example.com', 'password');
  await assert.rejects(client.save(input), /Нет связи/);
  await assert.rejects(client.save(input), /Войдите заново/);
  assert.equal(client.isTeacher(), false);
});
test('invalid dates and blank assignments are rejected before transmission', async () => {
  const { client, calls } = fixture(auth());
  await client.login('teacher@example.com', 'password');
  await assert.rejects(client.save({ ...input, due_date: '2026-02-30' }), /дату/);
  await assert.rejects(client.save({ ...input, body: '  ' }), /задание/);
  assert.equal(calls.length, 2);
});
test('logout clears teacher access even if the network fails', async () => {
  const { client } = fixture([...auth(), new TypeError('offline')]);
  await client.login('teacher@example.com', 'password');
  await assert.rejects(client.logout(), /Нет связи/);
  assert.equal(client.isTeacher(), false);
});
test('secret API keys are never accepted as public configuration', () => {
  const client = createClient({ ...config, publishableKey: 'sb_secret_example' }, () => {});
  assert.equal(client.configured, false);
});

test('photo paths are confined to the class bucket and validated before saving', async () => {
  const { client, calls } = fixture(auth()); await client.login('teacher@example.com', 'password');
  const photo = item.id + '.jpg';
  assert.match(client.photoUrl(photo), /storage\/v1\/object\/public\/homework-photos/);
  for (const path of ['https://evil.example/a.jpg', '../secret.jpg', 'javascript:alert(1)', 'x.svg']) assert.equal(client.photoUrl(path), null);
  await assert.rejects(client.save({ ...input, photo_paths: [photo, photo] }), /фотографий/);
  await assert.rejects(client.save({ ...input, photo_paths: ['x.svg'] }), /фотографий/);
  assert.equal(calls.length, 2);
});
test('uploads use teacher token, binary JPEG and unique non-overwriting object names', async () => {
  const { client, calls } = fixture([...auth(), { data: { Key: 'ok' } }, { data: [] }]);
  const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
  await assert.rejects(client.uploadPhoto(blob), /Войдите/);
  await client.login('teacher@example.com', 'password');
  await assert.rejects(client.uploadPhoto(new Blob(['svg'], { type: 'image/svg+xml' })), /JPEG/);
  const path = await client.uploadPhoto(blob);
  assert.match(path, /^[a-f0-9-]{36}\.jpg$/);
  assert.equal(calls[2].body, blob); assert.equal(calls[2].headers['Content-Type'], 'image/jpeg');
  assert.equal(calls[2].headers.Authorization, 'Bearer teacher-token'); assert.equal(calls[2].headers['x-upsert'], 'false');
  await client.removePhotos([path]);
  assert.deepEqual(JSON.parse(calls[3].body), { prefixes: [path] });
});
