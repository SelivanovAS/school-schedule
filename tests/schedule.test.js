const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'data.js'), 'utf8');
const { SCHEDULE, BLOCKS } = vm.runInNewContext(source + ';({SCHEDULE, BLOCKS})');

test('morning lessons match the September 21 photo', () => {
  const expected = {
    mon: ['Инженерное проектирование', 'Математика', 'Русский язык', 'Литературное чтение', 'Физ-ра'],
    tue: ['Личностный рост с психологом', 'Английский язык', 'Технология', 'Русский язык', 'Окружающий мир'],
    wed: ['Русский язык', 'ИЗО', 'Литературное чтение', 'Математика', 'Креативное мышление'],
    thu: ['Английский язык', 'Музыка', 'Математика', 'Литературное чтение', 'Русский язык'],
    fri: ['Математика', 'Русский язык', 'Литературное чтение', 'Физ-ра', 'Окружающий мир'],
  };
  for (const [day, names] of Object.entries(expected)) {
    const lessons = Array.from(SCHEDULE[day]).filter(x => x.title);
    assert.deepEqual(lessons.map(x => x.title), names, day);
    assert.deepEqual(lessons.map(x => [x.from, x.to]), [
      ['09:00','09:40'], ['09:50','10:30'], ['10:40','11:20'], ['11:30','12:10'], ['12:20','13:00'],
    ], day);
  }
});
test('afternoon times, breaks and end-of-day match the photo without inventing Monday dinner', () => {
  const expected = {
    mon: ['15:00-15:10 afternoonSnack', '15:10-15:50 cooking', '16:00-16:50 choreography'],
    tue: ['15:00-15:10 afternoonSnack', '15:10-16:00 creativeActivity', '16:00-16:50 chinese', '17:00-17:20 dinner'],
    wed: ['15:00-15:10 afternoonSnack', '15:10-16:00 games', '16:00-17:00 engineeringClub', '17:00-17:20 dinner'],
    thu: ['15:00-15:10 afternoonSnack', '15:10-15:50 psychologistGroup', '16:00-17:00 chinese', '17:00-17:20 dinner'],
    fri: ['15:00-15:10 afternoonSnack', '15:10-15:50 engineeringClub', '16:10-16:50 choreography', '17:00-17:20 dinner'],
  };
  for (const [day, times] of Object.entries(expected)) {
    assert.deepEqual(Array.from(SCHEDULE[day]).filter(x => x.from >= '15:00').map(x => `${x.from}-${x.to} ${x.type}`), times);
    let end = '00:00';
    for (const item of SCHEDULE[day]) {
      assert.ok(item.from >= end, `${day}: overlapping ${item.from}`);
      assert.ok(item.to > item.from, `${day}: invalid duration`);
      if (item.type) assert.ok(BLOCKS[item.type], item.type);
      end = item.to;
    }
    assert.equal(SCHEDULE[day].find(x => x.type === 'homework').from, '13:50');
  }
});
test('clubs do not inflate lesson count; unknown cooking week is not marked live and prints clearly', async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { url: 'https://school.example/', runScripts: 'outside-only' });
  try {
    const w = dom.window, NativeDate = w.Date;
    const fixed = new NativeDate(2026, 8, 21, 15, 20).getTime();
    w.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
    w.eval(source + '\n' + fs.readFileSync(path.join(root, 'app.js'), 'utf8'));
    await new Promise(resolve => setImmediate(resolve));
    const day = w.document.getElementById('day');
    assert.match(day.textContent, /5 уроков · 09:00–13:00/);
    assert.match(day.textContent, /16:50/);
    assert.match(day.textContent, /Даты уточняются/);
    assert.match(w.document.getElementById('now-card').textContent, /Возможное занятие/);
    assert.equal(day.querySelector('.is-now'), null);
    const print = w.document.getElementById('print-view').textContent;
    assert.match(print, /Кулинария \(1 раз в две недели\) — даты уточняются/);
    assert.match(print, /Китайский язык/);
  } finally { dom.window.close(); }
});
test('all static assets and offline cache use the new release version', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
  assert.match(sw, /CACHE_VERSION = 'v6'/);
  for (const [, asset] of html.matchAll(/(?:src|href)="\.\/([^"?]+)\?v=6"/g)) {
    assert.ok(fs.existsSync(path.join(root, asset)), asset);
    assert.ok(sw.includes(`./${asset}?v=6`), asset);
  }
  assert.doesNotMatch(html + sw, /\?v=[1-5](?:'|")/);
});
