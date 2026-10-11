const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../homework.js'), 'utf8');
const item = { id: '11111111-1111-4111-8111-111111111111', subject: 'Математика',
  body: '<img src=x onerror=alert(1)>\nЗадание № 3', due_date: '2099-09-18', version: 1 };
const flush = () => new Promise(resolve => setImmediate(resolve));

async function setup(overrides = {}, storage = {}) {
  const dom = new JSDOM(html, { url: 'https://school.example/', runScripts: 'outside-only' });
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.URL.createObjectURL = () => 'blob:preview';
  w.URL.revokeObjectURL = () => {};
  w.SchoolPhotos = { maxFiles: 4, prepare: async () => new w.Blob(['jpeg'], { type: 'image/jpeg' }) };
  let teacher = false;
  const api = {
    configured: true, storageScope: 'test',
    list: async () => [{ ...item }],
    isTeacher: () => teacher,
    login: async () => { teacher = true; }, logout: async () => { teacher = false; },
    save: async input => ({ ...item, ...input }), remove: async () => {},
    photoUrl: path => /^[a-f0-9-]{36}\.jpg$/.test(path) ? 'https://example.supabase.co/storage/v1/object/public/homework-photos/' + path : null,
    uploadPhoto: async () => item.id + '.jpg', removePhotos: async () => {}, ...overrides,
  };
  w.SchoolHomework = { createClient: () => api };
  w.SCHEDULE = { mon: [{ title: 'Математика' }] };
  w.confirm = () => true;
  for (const [key, value] of Object.entries(storage)) w.localStorage.setItem(key, JSON.stringify(value));
  w.eval(fs.readFileSync(path.join(__dirname, '../school-app.js'), 'utf8'));
  w.eval(script);
  await flush();
  const get = id => w.document.getElementById(id);
  const submit = async id => { get(id).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await flush(); };
  return { dom, w, api, get, submit };
}

test('student sees literal teacher text, no edit controls, and completion stays local', async () => {
  const { dom, w, get } = await setup();
  try {
    assert.equal(get('assignment-editor').hidden, true);
    assert.equal(get('assignment-list').querySelector('button'), null);
    assert.equal(get('assignment-list').querySelector('img'), null);
    assert.match(get('assignment-list').textContent, /<img src=x/);
    const checkbox = get('assignment-list').querySelector('input');
    checkbox.click();
    assert.equal(JSON.parse(w.localStorage.getItem('sch3a_shared_done_v1:test'))[item.id + ':1'], true);
  } finally { dom.window.close(); }
});
test('edited assignments reset completion and never move it to another assignment', async () => {
  const { dom, get, api } = await setup({}, { 'sch3a_shared_done_v1:test': { [item.id + ':1']: true } });
  try {
    assert.equal(get('assignment-completed-list').querySelector('input').checked, true);
    assert.equal(get('homework-count').hidden, true);
    api.list = async () => [{ ...item, version: 2 }];
    get('assignments-refresh').click(); await flush();
    assert.equal(get('assignment-list').querySelector('input').checked, false);
  } finally { dom.window.close(); }
});
test('teacher publishes, edits and deletes; failed save preserves draft and logout hides editor', async () => {
  const { dom, get, submit, api } = await setup();
  try {
    get('teacher-email').value = 'teacher@example.com';
    get('teacher-password').value = 'password';
    await submit('teacher-login');
    assert.equal(get('assignment-editor').hidden, true);
    assert.equal(get('assignment-new').hidden, false);
    get('assignment-new').click();
    assert.equal(get('assignment-editor').hidden, false);
    assert.equal(get('teacher-password').value, '');
    get('assignment-body').value = 'Выполнить упражнение 7';
    get('assignment-due').value = '2099-09-19';
    api.save = async () => { throw new Error('Нет связи с сервером'); };
    await submit('assignment-editor');
    assert.equal(get('assignment-body').value, 'Выполнить упражнение 7');
    assert.match(get('assignment-save-status').textContent, /Нет связи/);
    api.save = async input => ({ ...item, ...input });
    await submit('assignment-editor');
    assert.match(get('assignment-list').textContent, /упражнение 7/);
    assert.equal(get('assignment-body').value, '');
    get('assignment-list').querySelector('button').click();
    assert.equal(get('assignment-body').value, 'Выполнить упражнение 7');
    get('assignment-list').querySelectorAll('button')[1].click(); await flush();
    assert.equal(get('assignment-list').querySelector('article'), null);
    get('teacher-logout').click(); await flush();
    assert.equal(get('assignment-editor').hidden, true);
  } finally { dom.window.close(); }
});
test('offline shows cached data with an explicit stale notice, never an empty-success message', async () => {
  const { dom, get } = await setup({ list: async () => { throw new Error('Нет связи'); } }, {
    'sch3a_shared_cache_v1:test': { items: [item], at: '2026-09-16T12:00:00Z', more: false },
  });
  try {
    assert.match(get('assignment-list').textContent, /Задание № 3/);
    assert.match(get('assignments-status').textContent, /сохранённая копия/);
    assert.match(get('assignments-status').textContent, /2026/);
  } finally { dom.window.close(); }
});
test('without backend configuration, login is unavailable and setup is reported honestly', async () => {
  const { dom, get } = await setup({ configured: false });
  try {
    assert.equal(get('teacher-access').hidden, true);
    assert.match(get('assignments-status').textContent, /не подключены/);
  } finally { dom.window.close(); }
});

test('schedule opens first; tabs work with keyboard and do not discard a teacher draft', async () => {
  const { dom, w, get, submit } = await setup();
  try {
    assert.equal(get('schedule-panel').hidden, false);
    assert.equal(get('homework-panel').hidden, true);
    get('schedule-tab').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    assert.equal(get('homework-panel').hidden, false);
    assert.equal(get('homework-tab').getAttribute('aria-selected'), 'true');
    assert.equal(w.document.activeElement, get('homework-tab'));
    await submit('teacher-login'); get('assignment-new').click();
    get('assignment-body').value = 'Черновик';
    get('schedule-tab').click(); get('homework-tab').click();
    assert.equal(get('assignment-body').value, 'Черновик');
  } finally { dom.window.close(); }
});

test('completed and past assignments are separate; badge updates immediately and across tabs', async () => {
  const { dom, w, get } = await setup({ list: async () => [item, { ...item, id: 'past', due_date: '2020-01-01' }] });
  try {
    assert.equal(get('assignment-list').querySelectorAll('article').length, 1);
    assert.equal(get('assignment-history-list').querySelectorAll('article').length, 1);
    assert.equal(get('homework-count').textContent, '1');
    get('assignment-list').querySelector('input').click();
    assert.equal(get('assignment-list').querySelector('article'), null);
    assert.equal(get('assignment-completed-list').querySelectorAll('article').length, 1);
    assert.equal(get('homework-count').hidden, true);
    w.localStorage.removeItem('sch3a_shared_done_v1:test');
    w.dispatchEvent(new w.StorageEvent('storage', { key: 'sch3a_shared_done_v1:test' }));
    assert.equal(get('homework-count').textContent, '1');
  } finally { dom.window.close(); }
});

test('photos open in an accessible viewer; editing retains attached paths', async () => {
  const path = item.id + '.jpg';
  let payload;
  const { dom, get, submit } = await setup({ list: async () => [{ ...item, photo_paths: [path] }],
    save: async input => { payload = input; return { ...item, ...input }; } });
  try {
    get('assignment-list').querySelector('.photo-thumb').click();
    assert.equal(get('photo-viewer').open, true);
    assert.match(get('photo-full').src, /homework-photos/);
    get('photo-zoom').click(); assert.equal(get('photo-zoom').getAttribute('aria-pressed'), 'true');
    get('photo-close').click(); assert.equal(get('photo-viewer').open, false);
    await submit('teacher-login');
    get('assignment-list').querySelector('.homework-actions button').click();
    await submit('assignment-editor');
    assert.deepEqual(Array.from(payload.photo_paths), [path]);
  } finally { dom.window.close(); }
});

test('photo upload failure keeps draft; retry reuses uploaded photos and only then publishes', async () => {
  let uploads = 0, saves = 0;
  const { dom, w, get, submit, api } = await setup({ uploadPhoto: async () => {
    uploads++; if (uploads === 2) throw new Error('Нет связи при загрузке фото');
    return (uploads === 1 ? item.id : '22222222-2222-4222-8222-222222222222') + '.jpg';
  }, save: async input => { saves++; return { ...item, ...input }; } });
  try {
    await submit('teacher-login'); get('assignment-new').click(); get('assignment-body').value = 'По фотографии';
    Object.defineProperty(get('assignment-photos'), 'files', { configurable: true, value: [{}, {}] });
    get('assignment-photos').dispatchEvent(new w.Event('change')); await flush();
    assert.equal(get('photo-previews').children.length, 2);
    await submit('assignment-editor');
    assert.equal(saves, 0); assert.equal(get('assignment-body').value, 'По фотографии');
    assert.equal(get('photo-previews').children.length, 2);
    await submit('assignment-editor');
    assert.equal(uploads, 3); assert.equal(saves, 1);
    assert.equal(get('assignment-editor').hidden, true);
  } finally { dom.window.close(); }
});

test('removed photos are cleaned only after a successful save', async () => {
  const path = item.id + '.jpg', removed = [];
  const { dom, get, submit, api } = await setup({ list: async () => [{ ...item, photo_paths: [path] }],
    removePhotos: async paths => removed.push(...paths) });
  try {
    await submit('teacher-login'); get('assignment-list').querySelector('.homework-actions button').click();
    get('photo-previews').querySelector('.link-btn').click();
    assert.equal(removed.length, 0);
    api.save = async () => { throw new Error('Нет связи'); };
    await submit('assignment-editor'); assert.equal(removed.length, 0);
    api.save = async input => ({ ...item, ...input });
    await submit('assignment-editor'); assert.deepEqual(removed, [path]);
  } finally { dom.window.close(); }
});

test('too many photos and preparation errors are explained without losing existing previews', async () => {
  const { dom, w, get, submit } = await setup();
  try {
    await submit('teacher-login'); get('assignment-new').click();
    Object.defineProperty(get('assignment-photos'), 'files', { configurable: true, value: [{}, {}, {}, {}, {}] });
    get('assignment-photos').dispatchEvent(new w.Event('change')); await flush();
    assert.match(get('photos-status').textContent, /не больше 4/);
    assert.equal(get('photo-previews').children.length, 0);
    w.SchoolPhotos.prepare = async () => { throw new Error('Сохраните фото в JPEG'); };
    Object.defineProperty(get('assignment-photos'), 'files', { configurable: true, value: [{}] });
    get('assignment-photos').dispatchEvent(new w.Event('change')); await flush();
    assert.match(get('photos-status').textContent, /JPEG/);
    assert.equal(get('assignment-save').disabled, false);
  } finally { dom.window.close(); }
});
