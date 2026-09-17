/* Интерфейс общих домашних заданий. Отметки выполнения принадлежат устройству. */
(function () {
  'use strict';
  var api = SchoolHomework.createClient(window.HOMEWORK_CONFIG);
  var cacheKey = 'sch3a_shared_cache_v1:' + api.storageScope;
  var doneKey = 'sch3a_shared_done_v1:' + api.storageScope;
  var items = [], editing = null, loading = false, busy = false, hasMore = false;
  var hasSnapshot = false, lastUpdated = null;
  var done = read(doneKey) || {};
  var ids = ['assignments-refresh', 'assignments-status', 'assignment-notice', 'teacher-access',
    'teacher-login', 'teacher-email', 'teacher-password', 'teacher-status', 'teacher-logout',
    'assignment-editor', 'assignment-editor-title', 'assignment-subject', 'assignment-due',
    'assignment-body', 'assignment-save', 'assignment-cancel', 'assignment-save-status',
    'assignments-history', 'assignment-list', 'assignments-more'];
  var ui = {};
  ids.forEach(function (id) { ui[id] = document.getElementById(id); });

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function dateText(value) {
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      .format(new Date(value + 'T12:00:00'));
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function completionKey(item) { return item.id + ':' + item.version; }
  function validItem(item) {
    return item && typeof item.id === 'string' && typeof item.subject === 'string' &&
      typeof item.body === 'string' && Number.isInteger(item.version) && item.version > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.due_date) &&
      Number.isFinite(new Date(item.due_date + 'T12:00:00').getTime());
  }
  function saveSnapshot() {
    hasSnapshot = true;
    write(cacheKey, { items: items, at: lastUpdated, more: hasMore });
  }
  function snapshotStatus() {
    return lastUpdated ? 'Последняя загрузка: ' + new Date(lastUpdated).toLocaleString('ru-RU') + '.' : '';
  }
  function syncTeacher() {
    var teacher = api.isTeacher();
    ui['teacher-login'].hidden = teacher;
    ui['teacher-logout'].hidden = !teacher;
    ui['assignment-editor'].hidden = !teacher;
    ui['teacher-access'].querySelector('summary').textContent = teacher ? 'Режим учителя' : 'Вход для учителя';
  }
  function setBusy(value) {
    busy = value;
    ['teacher-login', 'assignment-editor'].forEach(function (id) {
      ui[id].querySelectorAll('input, textarea, select, button').forEach(function (n) { n.disabled = value; });
    });
    ui['teacher-logout'].disabled = value;
    render();
  }
  function showError(error) {
    ui['assignment-notice'].textContent = error.message;
    syncTeacher();
    if (!api.isTeacher()) {
      ui['teacher-access'].open = true;
      ui['teacher-status'].textContent = error.message;
    }
  }
  function resetEditor() {
    editing = null;
    ui['assignment-body'].value = '';
    ui['assignment-due'].value = today();
    ui['assignment-editor-title'].textContent = 'Новое задание для всех учеников';
    ui['assignment-save'].textContent = 'Опубликовать для всех';
    ui['assignment-cancel'].hidden = true;
  }
  function beginEdit(item) {
    if (ui['assignment-body'].value.trim() && !confirm('Заменить несохранённый текст в форме выбранным заданием?')) return;
    editing = item;
    if (!Array.from(ui['assignment-subject'].options).some(function (o) { return o.value === item.subject; })) {
      ui['assignment-subject'].appendChild(node('option', null, item.subject));
    }
    ui['assignment-subject'].value = item.subject;
    ui['assignment-due'].value = item.due_date;
    ui['assignment-body'].value = item.body;
    ui['assignment-editor-title'].textContent = 'Редактирование задания';
    ui['assignment-save'].textContent = 'Сохранить для всех';
    ui['assignment-cancel'].hidden = false;
    ui['assignment-save-status'].textContent = '';
    ui['assignment-body'].focus();
  }

  function render() {
    ui['assignment-save'].disabled = busy || loading;
    var list = ui['assignment-list'];
    list.replaceChildren();
    var visible = items.filter(function (item) { return ui['assignments-history'].checked || item.due_date >= today(); });
    visible.sort(function (a, b) { return a.due_date.localeCompare(b.due_date) || a.subject.localeCompare(b.subject, 'ru'); });
    if (!visible.length && hasSnapshot) {
      list.appendChild(node('p', 'homework-hint', ui['assignments-history'].checked
        ? 'Учитель пока не опубликовал задания.' : 'На сегодня и следующие дни заданий пока нет.'));
    }
    visible.forEach(function (item) {
      var card = node('article', 'assignment' + (done[completionKey(item)] ? ' is-done' : ''));
      card.appendChild(node('h3', null, item.subject));
      card.appendChild(node('p', 'assignment-meta', 'Сдать к ' + dateText(item.due_date)));
      card.appendChild(node('p', 'assignment-body', item.body)); // Не HTML: текст учителя не исполняется.
      var label = node('label', 'assignment-done');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!done[completionKey(item)];
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode('Сделано'));
      checkbox.addEventListener('change', function () {
        if (checkbox.checked) done[completionKey(item)] = true;
        else delete done[completionKey(item)];
        card.classList.toggle('is-done', checkbox.checked);
        ui['assignment-notice'].textContent = write(doneKey, done)
          ? 'Отметка сохранена на этом устройстве.' : 'Браузер не разрешил сохранить отметку. Она останется только до закрытия страницы.';
      });
      card.appendChild(label);
      if (api.isTeacher()) {
        var actions = node('div', 'homework-actions');
        var edit = node('button', 'link-btn', 'Редактировать');
        edit.type = 'button'; edit.disabled = busy || loading;
        edit.addEventListener('click', function () { beginEdit(item); });
        var remove = node('button', 'link-btn', 'Удалить');
        remove.type = 'button'; remove.disabled = busy || loading;
        remove.addEventListener('click', function () { removeItem(item); });
        actions.append(edit, remove);
        card.appendChild(actions);
      }
      list.appendChild(card);
    });
    ui['assignments-more'].hidden = !hasMore;
    ui['assignments-more'].disabled = loading || busy;
    ui['assignments-refresh'].disabled = loading || busy || !api.configured;
  }

  async function load(more) {
    if (!api.configured || loading || busy) return;
    loading = true;
    render();
    ui['assignments-status'].textContent = 'Загружаем задания…';
    try {
      var fetched = await api.list(more ? items.length : 0);
      if (!Array.isArray(fetched) || !fetched.every(validItem)) throw new Error('Сервер вернул некорректные задания. Повторите загрузку.');
      hasMore = fetched.length === 100;
      var combined = more ? items.concat(fetched) : fetched;
      items = Array.from(new Map(combined.map(function (item) { return [item.id, item]; })).values());
      lastUpdated = new Date().toISOString();
      saveSnapshot();
      ui['assignments-status'].textContent = snapshotStatus();
    } catch (error) {
      ui['assignments-status'].textContent = hasSnapshot
        ? 'Не удалось обновить задания. Показана сохранённая копия. ' + snapshotStatus()
        : error.message + ' Нажмите «Обновить».';
    } finally { loading = false; render(); }
  }

  async function removeItem(item) {
    if (busy || loading || !confirm('Удалить задание «' + item.subject + '» к ' + dateText(item.due_date) + ' у всех учеников?')) return;
    setBusy(true);
    try {
      await api.remove(item);
      items = items.filter(function (x) { return x.id !== item.id; });
      if (editing && editing.id === item.id) resetEditor();
      saveSnapshot();
      ui['assignment-notice'].textContent = 'Задание удалено у всех учеников.';
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  }

  var subjects = new Set();
  Object.values(SCHEDULE).forEach(function (day) {
    (day || []).forEach(function (item) { if (item.title) subjects.add(item.title); });
  });
  Array.from(subjects).sort(function (a, b) { return a.localeCompare(b, 'ru'); }).forEach(function (subject) {
    ui['assignment-subject'].appendChild(node('option', null, subject));
  });
  ui['assignment-subject'].appendChild(node('option', null, 'Общее задание'));
  resetEditor();
  syncTeacher();

  ui['teacher-login'].addEventListener('submit', async function (event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    ui['teacher-status'].textContent = 'Проверяем вход…';
    try {
      await api.login(ui['teacher-email'].value, ui['teacher-password'].value);
      ui['teacher-status'].textContent = 'Вы вошли как учитель. Задания публикуются для всего класса.';
      ui['assignment-notice'].textContent = '';
      syncTeacher();
    } catch (error) { ui['teacher-status'].textContent = error.message; }
    finally { ui['teacher-password'].value = ''; setBusy(false); }
  });
  ui['teacher-logout'].addEventListener('click', async function () {
    setBusy(true);
    try {
      await api.logout();
      ui['teacher-status'].textContent = 'Вы вышли из режима учителя.';
    } catch (error) {
      ui['teacher-status'].textContent = 'Вы вышли на этом устройстве. Сервер не подтвердил завершение сеанса — проверьте интернет.';
    } finally { syncTeacher(); setBusy(false); }
  });
  ui['assignment-editor'].addEventListener('submit', async function (event) {
    event.preventDefault();
    if (busy || loading) return;
    var wasEditing = !!editing;
    setBusy(true);
    ui['assignment-save-status'].textContent = 'Сохраняем…';
    try {
      var saved = await api.save({ subject: ui['assignment-subject'].value,
        due_date: ui['assignment-due'].value, body: ui['assignment-body'].value }, editing);
      items = items.filter(function (item) { return item.id !== saved.id; });
      items.push(saved);
      saveSnapshot();
      if (saved.due_date < today()) ui['assignments-history'].checked = true;
      resetEditor();
      ui['assignment-save-status'].textContent = wasEditing ? 'Изменения сохранены для всех учеников.' : 'Задание опубликовано для всех учеников.';
      ui['assignment-notice'].textContent = '';
    } catch (error) {
      ui['assignment-save-status'].textContent = error.message;
      showError(error);
    } finally { setBusy(false); }
  });
  ui['assignment-cancel'].addEventListener('click', function () {
    if (confirm('Отменить несохранённые изменения в форме?')) { resetEditor(); ui['assignment-save-status'].textContent = ''; }
  });
  ui['assignments-refresh'].addEventListener('click', function () { load(false); });
  ui['assignments-more'].addEventListener('click', function () { load(true); });
  ui['assignments-history'].addEventListener('change', render);
  window.addEventListener('online', function () { load(false); });
  window.addEventListener('storage', function (event) {
    if (event.key === doneKey) { done = read(doneKey) || {}; render(); }
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { syncTeacher(); load(false); } });
  setInterval(function () { if (!document.hidden) { syncTeacher(); load(false); } }, 60000);
  window.addEventListener('beforeunload', function (event) {
    if (ui['assignment-body'].value.trim()) { event.preventDefault(); event.returnValue = ''; }
  });

  if (!api.configured) {
    ui['assignments-status'].textContent = 'Общие задания пока не подключены.';
    ui['teacher-access'].hidden = true;
    ui['assignments-history'].parentElement.hidden = true;
    render();
    return;
  }
  var cached = read(cacheKey);
  if (cached && Array.isArray(cached.items) && cached.items.every(validItem) &&
      Number.isFinite(Date.parse(cached.at))) {
    items = cached.items; lastUpdated = cached.at; hasMore = !!cached.more; hasSnapshot = true;
  }
  load(false);
})();
