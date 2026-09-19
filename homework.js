/* Общие задания, личные отметки выполнения и интерфейс учителя. */
(function () {
  'use strict';
  var api = SchoolHomework.createClient(window.HOMEWORK_CONFIG);
  var cacheKey = 'sch3a_shared_cache_v1:' + api.storageScope;
  var doneKey = 'sch3a_shared_done_v1:' + api.storageScope;
  var items = [], editing = null, loading = false, busy = false, hasMore = false;
  var hasSnapshot = false, lastUpdated = null, editorOpen = false, photos = [];
  var done = read(doneKey) || {};
  var ui = {};
  document.querySelectorAll('[id]').forEach(function (n) { ui[n.id] = n; });
  function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function dateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function today() { return dateKey(new Date()); }
  function dateText(value) {
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      .format(new Date(value + 'T12:00:00'));
  }
  function deadline(value) {
    var tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    var d = new Date(value + 'T12:00:00');
    var prefix = value < today() ? 'Срок прошёл' : value === today() ? 'На сегодня'
      : value === dateKey(tomorrow) ? 'На завтра'
      : ['К воскресенью', 'К понедельнику', 'К вторнику', 'К среде', 'К четвергу', 'К пятнице', 'К субботе'][d.getDay()];
    return prefix + ' · ' + dateText(value);
  }
  function completionKey(item) { return item.id + ':' + item.version; }
  function validItem(item) {
    return item && typeof item.id === 'string' && typeof item.subject === 'string' &&
      typeof item.body === 'string' && Number.isInteger(item.version) && item.version > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.due_date) &&
      Number.isFinite(new Date(item.due_date + 'T12:00:00').getTime()) &&
      (item.photo_paths === undefined || (Array.isArray(item.photo_paths) && item.photo_paths.length <= 4 &&
        item.photo_paths.every(function (p) { return !!api.photoUrl(p); })));
  }
  function saveSnapshot() { hasSnapshot = true; write(cacheKey, { items: items, at: lastUpdated, more: hasMore }); }
  function snapshotStatus() { return lastUpdated ? 'Последняя загрузка: ' + new Date(lastUpdated).toLocaleString('ru-RU') + '.' : ''; }
  function switchView(view, focus) {
    ['schedule', 'homework'].forEach(function (name) {
      var active = view === name;
      ui[name + '-panel'].hidden = !active;
      ui[name + '-tab'].setAttribute('aria-selected', String(active));
      ui[name + '-tab'].tabIndex = active ? 0 : -1;
    });
    if (focus) ui[view + '-tab'].focus();
  }
  ['schedule', 'homework'].forEach(function (name) {
    ui[name + '-tab'].addEventListener('click', function () { switchView(name); });
    ui[name + '-tab'].addEventListener('keydown', function (e) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      switchView(e.key === 'Home' ? 'schedule' : e.key === 'End' ? 'homework' : name === 'homework' ? 'schedule' : 'homework', true);
    });
  });
  function openTeacher() { if (!ui['teacher-access'].open) ui['teacher-access'].showModal(); }
  ui['teacher-open'].addEventListener('click', openTeacher);
  ui['teacher-close'].addEventListener('click', function () { ui['teacher-access'].close(); });
  function syncTeacher() {
    var teacher = api.isTeacher();
    ui['teacher-login'].hidden = teacher;
    ui['teacher-logout'].hidden = !teacher;
    ui['assignment-new'].hidden = !teacher || editorOpen;
    ui['assignment-editor'].hidden = !teacher || !editorOpen;
    ui['teacher-open'].textContent = teacher ? 'Учитель' : 'Учителю';
    ui['teacher-title'].textContent = teacher ? 'Режим учителя' : 'Вход для учителя';
  }
  function setBusy(value) {
    busy = value;
    ['teacher-login', 'assignment-editor'].forEach(function (id) {
      ui[id].querySelectorAll('input, textarea, select, button').forEach(function (n) { n.disabled = value; });
    });
    ['teacher-logout', 'teacher-open', 'assignment-new'].forEach(function (id) { ui[id].disabled = value; });
    syncTeacher(); render();
  }
  function showError(error) {
    ui['assignment-notice'].textContent = error.message; syncTeacher();
    if (!api.isTeacher()) { ui['teacher-status'].textContent = error.message; openTeacher(); }
  }
  async function cleanup(paths) {
    if (!paths.length) return;
    try { await api.removePhotos(paths); }
    catch (e) { ui['assignment-notice'].textContent += ' Не удалось очистить неиспользуемые фото из хранилища; опубликованные задания не затронуты.'; }
  }
  function resetEditor() {
    photos.forEach(function (p) { if (p.preview) URL.revokeObjectURL(p.preview); });
    photos = []; editing = null; editorOpen = false;
    ui['assignment-body'].value = '';
    var due = new Date();
    do { due.setDate(due.getDate() + 1); } while ([0, 6].includes(due.getDay()));
    ui['assignment-due'].value = dateKey(due);
    ui['assignment-editor-title'].textContent = 'Новое задание';
    ui['assignment-save'].textContent = 'Опубликовать для всех';
    ui['assignment-photos'].value = '';
    ui['photos-status'].textContent = '';
    ui['assignment-save-status'].textContent = '';
    renderPreviews(); syncTeacher();
  }
  function hasDraft() { return editorOpen && (editing || ui['assignment-body'].value.trim() || photos.length); }
  async function discardDraft() {
    var unused = photos.filter(function (p) { return p.fresh && p.path; }).map(function (p) { return p.path; });
    resetEditor(); await cleanup(unused);
  }
  function beginEdit(item) {
    if (hasDraft() && !confirm('Заменить несохранённые изменения выбранным заданием?')) return;
    var unused = photos.filter(function (p) { return p.fresh && p.path; }).map(function (p) { return p.path; });
    resetEditor(); cleanup(unused);
    editing = item; editorOpen = true;
    if (!Array.from(ui['assignment-subject'].options).some(function (o) { return o.value === item.subject; })) {
      ui['assignment-subject'].appendChild(node('option', null, item.subject));
    }
    ui['assignment-subject'].value = item.subject;
    ui['assignment-due'].value = item.due_date;
    ui['assignment-body'].value = item.body;
    photos = (item.photo_paths || []).map(function (path) { return { path: path }; });
    ui['assignment-editor-title'].textContent = 'Редактирование задания';
    ui['assignment-save'].textContent = 'Сохранить для всех';
    renderPreviews(); syncTeacher(); ui['assignment-body'].focus();
  }
  ui['assignment-new'].addEventListener('click', function () { editorOpen = true; syncTeacher(); ui['assignment-subject'].focus(); });
  function openPhoto(url, title) {
    ui['photo-full'].src = url; ui['photo-full'].alt = title;
    ui['photo-title'].textContent = title; ui['photo-original'].href = url;
    ui['photo-canvas'].classList.remove('is-zoomed');
    ui['photo-zoom'].setAttribute('aria-pressed', 'false'); ui['photo-zoom'].textContent = 'Увеличить';
    ui['photo-viewer'].showModal();
  }
  ui['photo-close'].addEventListener('click', function () { ui['photo-viewer'].close(); });
  ui['photo-zoom'].addEventListener('click', function () {
    var zoom = ui['photo-canvas'].classList.toggle('is-zoomed');
    ui['photo-zoom'].setAttribute('aria-pressed', String(zoom));
    ui['photo-zoom'].textContent = zoom ? 'Уместить целиком' : 'Увеличить';
  });
  function photoButton(url, title) {
    var button = node('button', 'photo-thumb'); button.type = 'button'; button.setAttribute('aria-label', 'Открыть: ' + title);
    var img = node('img'); img.src = url; img.alt = title; img.loading = 'lazy';
    img.addEventListener('error', function () {
      img.hidden = true;
      if (!button.querySelector('span')) button.appendChild(node('span', 'homework-hint', 'Фото недоступно. Нажмите, чтобы открыть.'));
    });
    button.appendChild(img); button.addEventListener('click', function () { openPhoto(url, title); }); return button;
  }
  function renderPreviews() {
    ui['photo-previews'].replaceChildren();
    photos.forEach(function (photo, index) {
      var box = node('div', 'photo-preview'); box.appendChild(photoButton(photo.preview || api.photoUrl(photo.path), 'Фото ' + (index + 1)));
      var remove = node('button', 'link-btn', 'Убрать фото ' + (index + 1)); remove.type = 'button'; remove.disabled = busy;
      remove.addEventListener('click', function () {
        photos.splice(index, 1);
        if (photo.preview) URL.revokeObjectURL(photo.preview);
        if (photo.fresh && photo.path) cleanup([photo.path]);
        renderPreviews();
      });
      box.appendChild(remove); ui['photo-previews'].appendChild(box);
    });
  }
  ui['assignment-photos'].addEventListener('change', async function () {
    if (busy) return;
    var files = Array.from(ui['assignment-photos'].files || []); ui['assignment-photos'].value = '';
    if (photos.length + files.length > SchoolPhotos.maxFiles) {
      ui['photos-status'].textContent = 'В одном задании может быть не больше 4 фото.'; return;
    }
    setBusy(true);
    try {
      for (var i = 0; i < files.length; i++) {
        ui['photos-status'].textContent = 'Готовим фото ' + (i + 1) + ' из ' + files.length + '…';
        var blob = await SchoolPhotos.prepare(files[i]); photos.push({ blob: blob, preview: URL.createObjectURL(blob), fresh: true });
      }
      ui['photos-status'].textContent = 'Фото готовы. Они появятся у учеников после публикации.';
    } catch (error) { ui['photos-status'].textContent = error.message; }
    finally { setBusy(false); renderPreviews(); }
  });
  function makeCard(item) {
    var completed = !!done[completionKey(item)];
    var card = node('article', 'assignment' + (completed ? ' is-done' : ''));
    var subject = typeof SUBJECTS !== 'undefined' ? SUBJECTS[item.subject] || {} : {};
    card.dataset.c = subject.color || 'slate';
    var heading = node('div', 'assignment-heading');
    var icon = node('span', 'assignment-icon', subject.icon || '📘'); icon.setAttribute('aria-hidden', 'true');
    heading.append(icon, node('h4', null, item.subject)); card.appendChild(heading);
    card.appendChild(node('p', 'assignment-body', item.body));
    if (item.photo_paths && item.photo_paths.length) {
      var grid = node('div', 'photo-grid');
      item.photo_paths.forEach(function (path, index) {
        var url = api.photoUrl(path); if (url) grid.appendChild(photoButton(url, item.subject + ' — фото ' + (index + 1)));
      });
      card.appendChild(grid);
    }
    card.appendChild(node('p', 'assignment-meta', 'Сдать к ' + dateText(item.due_date)));
    var label = node('label', 'assignment-done');
    var checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = completed;
    label.append(checkbox, document.createTextNode('Сделано'));
    checkbox.addEventListener('change', function () {
      if (checkbox.checked) done[completionKey(item)] = true; else delete done[completionKey(item)];
      ui['assignment-notice'].textContent = write(doneKey, done) ? 'Отметка сохранена на этом устройстве.'
        : 'Браузер не разрешил сохранить отметку. Она останется только до закрытия страницы.';
      var checked = checkbox.checked; render();
      if (checked) ui['completed-summary'].focus(); else ui['homework-tab'].focus();
    });
    card.appendChild(label);
    if (api.isTeacher()) {
      var actions = node('div', 'homework-actions');
      var edit = node('button', 'link-btn', 'Редактировать'); edit.type = 'button'; edit.disabled = busy || loading;
      edit.addEventListener('click', function () { beginEdit(item); });
      var remove = node('button', 'link-btn', 'Удалить'); remove.type = 'button'; remove.disabled = busy || loading;
      remove.addEventListener('click', function () { removeItem(item); });
      actions.append(edit, remove); card.appendChild(actions);
    }
    return card;
  }
  function renderGroups(list, rows) {
    list.replaceChildren(); var group, previous;
    rows.forEach(function (item) {
      if (previous !== item.due_date) {
        group = node('section', 'deadline-group'); var title = node('h3', 'deadline-title', deadline(item.due_date));
        if (item.due_date <= today()) title.classList.add('is-soon');
        group.appendChild(title); list.appendChild(group); previous = item.due_date;
      }
      group.appendChild(makeCard(item));
    });
  }
  function render() {
    ui['assignment-save'].disabled = busy || loading;
    var sorted = items.slice().sort(function (a, b) { return a.due_date.localeCompare(b.due_date) || a.subject.localeCompare(b.subject, 'ru'); });
    var active = sorted.filter(function (x) { return x.due_date >= today() && !done[completionKey(x)]; });
    var completed = sorted.filter(function (x) { return done[completionKey(x)]; });
    var past = sorted.filter(function (x) { return x.due_date < today() && !done[completionKey(x)]; }).reverse();
    renderGroups(ui['assignment-list'], active); renderGroups(ui['assignment-completed-list'], completed); renderGroups(ui['assignment-history-list'], past);
    if (!active.length && hasSnapshot) ui['assignment-list'].appendChild(node('p', 'homework-empty',
      completed.some(function (x) { return x.due_date >= today(); }) ? 'Всё на ближайшие дни сделано ✓' : 'На сегодня и следующие дни заданий пока нет.'));
    ui['assignments-completed'].hidden = !completed.length; ui['assignments-history'].hidden = !past.length;
    ui['completed-summary'].textContent = 'Выполненные · ' + completed.length;
    ui['history-summary'].textContent = 'Прошедшие сроки · ' + past.length;
    ui['homework-count'].hidden = !active.length && !hasMore; ui['homework-count'].textContent = active.length + (hasMore ? '+' : '');
    ui['homework-tab'].setAttribute('aria-label', hasSnapshot ? 'Задания домой. Невыполненных на этом устройстве: ' + active.length + (hasMore ? ' или больше' : '') : 'Задания домой: загружаются');
    ui['assignments-more'].hidden = !hasMore; ui['assignments-more'].disabled = loading || busy;
    ui['assignments-refresh'].disabled = loading || busy || !api.configured;
  }
  async function load(more) {
    if (!api.configured || loading || busy) return;
    loading = true; render();
    if (!hasSnapshot) ui['assignments-status'].textContent = 'Загружаем задания…';
    try {
      var fetched = await api.list(more ? items.length : 0);
      if (!Array.isArray(fetched) || !fetched.every(validItem)) throw new Error('Сервер вернул некорректные задания. Повторите загрузку.');
      hasMore = fetched.length === 100;
      var combined = more ? items.concat(fetched) : fetched;
      items = Array.from(new Map(combined.map(function (item) { return [item.id, item]; })).values());
      lastUpdated = new Date().toISOString(); saveSnapshot();
      ui['assignments-status'].textContent = 'Обновлено'; ui['assignments-status'].title = snapshotStatus(); ui['assignments-status'].classList.remove('is-warning');
    } catch (error) {
      ui['assignments-status'].textContent = hasSnapshot ? 'Нет обновления. Показана сохранённая копия. ' + snapshotStatus() : error.message + ' Нажмите «Обновить».';
      ui['assignments-status'].classList.add('is-warning');
    } finally { loading = false; render(); }
  }
  async function removeItem(item) {
    if (busy || loading || !confirm('Удалить задание «' + item.subject + '» к ' + dateText(item.due_date) + ' и его фото у всех учеников?')) return;
    setBusy(true);
    try {
      await api.remove(item); items = items.filter(function (x) { return x.id !== item.id; });
      if (editing && editing.id === item.id) await discardDraft();
      saveSnapshot(); ui['assignment-notice'].textContent = 'Задание удалено у всех учеников.'; await cleanup(item.photo_paths || []);
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  }
  var subjects = new Set();
  Object.values(SCHEDULE).forEach(function (day) { (day || []).forEach(function (item) { if (item.title) subjects.add(item.title); }); });
  Array.from(subjects).sort(function (a, b) { return a.localeCompare(b, 'ru'); }).forEach(function (s) { ui['assignment-subject'].appendChild(node('option', null, s)); });
  ui['assignment-subject'].appendChild(node('option', null, 'Общее задание')); resetEditor(); syncTeacher();
  ui['teacher-login'].addEventListener('submit', async function (event) {
    event.preventDefault(); if (busy) return;
    setBusy(true); ui['teacher-status'].textContent = 'Проверяем вход…';
    try {
      await api.login(ui['teacher-email'].value, ui['teacher-password'].value);
      ui['teacher-status'].textContent = 'Вы вошли как учитель. Задания публикуются для всего класса.';
      ui['assignment-notice'].textContent = ''; syncTeacher(); ui['teacher-access'].close(); switchView('homework');
    } catch (error) { ui['teacher-status'].textContent = error.message; }
    finally {
      ui['teacher-password'].value = ''; setBusy(false);
      if (api.isTeacher()) (editorOpen ? ui['assignment-body'] : ui['assignment-new']).focus();
    }
  });
  ui['teacher-logout'].addEventListener('click', async function () {
    if (hasDraft() && !confirm('Выйти и отменить несохранённые изменения?')) return;
    setBusy(true);
    try { await discardDraft(); await api.logout(); ui['teacher-status'].textContent = 'Вы вышли из режима учителя.'; }
    catch (error) { ui['teacher-status'].textContent = 'Вы вышли на этом устройстве. Сервер не подтвердил завершение сеанса — проверьте интернет.'; }
    finally { syncTeacher(); setBusy(false); }
  });
  ui['assignment-editor'].addEventListener('submit', async function (event) {
    event.preventDefault(); if (busy || loading || !editorOpen) return;
    var wasEditing = !!editing, oldPaths = editing ? editing.photo_paths || [] : [];
    setBusy(true); ui['assignment-save-status'].textContent = 'Сохраняем…';
    try {
      for (var i = 0; i < photos.length; i++) {
        if (!photos[i].path) {
          ui['assignment-save-status'].textContent = 'Загружаем фото ' + (i + 1) + ' из ' + photos.length + '…';
          photos[i].path = await api.uploadPhoto(photos[i].blob);
        }
      }
      var paths = photos.map(function (p) { return p.path; });
      var saved = await api.save({ subject: ui['assignment-subject'].value, due_date: ui['assignment-due'].value,
        body: ui['assignment-body'].value, photo_paths: paths }, editing);
      items = items.filter(function (item) { return item.id !== saved.id; }); items.push(saved); saveSnapshot();
      if (saved.due_date < today()) ui['assignments-history'].open = true;
      resetEditor(); ui['assignment-notice'].textContent = wasEditing ? 'Изменения сохранены для всех учеников.' : 'Задание опубликовано для всех учеников.';
      await cleanup(oldPaths.filter(function (p) { return !paths.includes(p); }));
    } catch (error) { ui['assignment-save-status'].textContent = error.message; showError(error); }
    finally { setBusy(false); if (!editorOpen) ui['assignment-new'].focus(); }
  });
  ui['assignment-cancel'].addEventListener('click', async function () {
    if (!hasDraft() || confirm('Отменить несохранённые изменения в форме?')) {
      setBusy(true); await discardDraft(); setBusy(false); ui['assignment-new'].focus();
    }
  });
  ui['assignments-refresh'].addEventListener('click', function () { load(false); });
  ui['assignments-more'].addEventListener('click', function () { load(true); });
  window.addEventListener('online', function () { load(false); });
  window.addEventListener('storage', function (event) { if (event.key === doneKey) { done = read(doneKey) || {}; render(); } });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { syncTeacher(); load(false); } });
  setInterval(function () { if (!document.hidden) { syncTeacher(); load(false); } }, 60000);
  window.addEventListener('beforeunload', function (event) { if (hasDraft() || busy) { event.preventDefault(); event.returnValue = ''; } });
  if (!api.configured) {
    ui['assignments-status'].textContent = 'Общие задания пока не подключены.';
    ui['teacher-open'].hidden = true; ui['teacher-access'].hidden = true; render(); return;
  }
  var cached = read(cacheKey);
  if (cached && Array.isArray(cached.items) && cached.items.every(validItem) && Number.isFinite(Date.parse(cached.at))) {
    items = cached.items; lastUpdated = cached.at; hasMore = !!cached.more; hasSnapshot = true;
  }
  load(false);
})();
