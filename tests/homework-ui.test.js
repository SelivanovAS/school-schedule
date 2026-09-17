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
  let teacher = false;
  const api = {
    configured: true, storageScope: 'test',
    list: async () => [{ ...item }],
    isTeacher: () => teacher,
    login: async () => { teacher = true; }, logout: async () => { teacher = false; },
    save: async input => ({ ...item, ...input }), remove: async () => {}, ...overrides,
  };
  w.SchoolHomework = { createClient: () => api };
  w.SCHEDULE = { mon: [{ title: 'Математика' }] };
  w.confirm = () => true;
  for (const [key, value] of Object.entries(storage)) w.localStorage.setItem(key, JSON.stringify(value));
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
    assert.equal(get('assignment-list').querySelector('input').checked, true);
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
