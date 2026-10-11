/* Публикации класса. Формы и предпросмотр остаются в памяти вкладки. */
(function () {
  'use strict';
  var api = SchoolApp.api, model = SchoolEventsModel, node = SchoolApp.node, ui = {};
  document.querySelectorAll('[id]').forEach(function (n) { ui[n.id] = n; });
  var groups = ['announcements', 'upcoming', 'archive'];
  var pages = { announcements: 1, upcoming: 1, archive: 1 }, more = {};
  var items = [], expanded = new Set(), editing = null, draftId = null, photos = [];
  var editorOpen = false, preview = null, busy = false, loading = false, at = null;
  var zone = (window.HOMEWORK_CONFIG || {}).schoolTimeZone || 'Asia/Yekaterinburg';
  var cacheKey = 'sch3a_events_cache_v1:' + api.storageScope;
  var fields = { kind: 'kind', title: 'title', body: 'body', event_date: 'date', time_text: 'time', location: 'location', cost: 'cost', payment: 'payment' };
  function today() { return model.today(zone); }
  function dateText(date) { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z')); }
  function snapshot() { try { localStorage.setItem(cacheKey, JSON.stringify({ items: items, at: at, pages: pages, more: more })); } catch (e) { /* Чтение остаётся доступным в памяти. */ } }
  function hasDraft() { return editorOpen && (!!editing || photos.length > 0 || Object.keys(fields).some(function (key) { return key !== 'kind' && ui['event-' + fields[key]].value.trim(); })); }
  function sync() {
    var teacher = api.isTeacher();
    ui['event-new'].hidden = !teacher || editorOpen;
    ui['event-editor'].hidden = !teacher || !editorOpen || !!preview;
    ui['event-preview-panel'].hidden = !teacher || !editorOpen || !preview;
    ui['event-editor'].querySelectorAll('input, textarea, select, button').forEach(function (n) { n.disabled = busy; });
    ['event-new', 'event-back', 'event-discard'].forEach(function (id) { ui[id].disabled = busy; });
    ui['event-publish'].disabled = busy || loading;
    ui['events-refresh'].disabled = busy || loading || !api.configured;
    groups.forEach(function (group) { ui['events-' + group + '-more'].disabled = loading || busy; });
  }
  function setBusy(value) { busy = value; SchoolApp.setBusy('events', value); sync(); render(); }
  function failure(error) {
    ui['event-notice'].textContent = error.message;
    if (!api.isTeacher()) { ui['teacher-status'].textContent = error.message; SchoolApp.openTeacher(); }
  }
  async function cleanup(paths) {
    if (!paths.length) return;
    try { await api.removeEventPhotos(paths); }
    catch (e) { ui['event-notice'].textContent += ' Не удалось очистить неиспользуемые изображения. Опубликованные фотографии сохранены.'; }
  }
  function reset() {
    photos.forEach(function (p) { if (p.preview) URL.revokeObjectURL(p.preview); });
    photos = []; editing = null; draftId = null; preview = null; editorOpen = false;
    ui['event-editor'].reset(); ui['event-kind'].value = 'event';
    ui['event-save-status'].textContent = ''; ui['event-publish-status'].textContent = '';
    ui['event-preview-card'].replaceChildren(); updateDate(); renderPhotos(); sync();
  }
  async function discard() {
    var unused = photos.filter(function (p) { return p.fresh && p.attempted; }).map(function (p) { return p.path; });
    reset(); await cleanup(unused);
  }
  function updateDate() {
    var optional = ui['event-kind'].value === 'announcement'; ui['event-date'].required = !optional;
    ui['event-date-hint'].textContent = optional ? 'Можно оставить пустой: объявление действует до переноса в архив.' : 'Укажите день, месяц и год.';
  }
  function formInput() {
    var input = {}; Object.keys(fields).forEach(function (key) { input[key] = ui['event-' + fields[key]].value; });
    input.photo_paths = photos.map(function (p) { return p.path; });
    input.cancelled = editing ? editing.cancelled : false; input.archived = editing ? editing.archived : false;
    return model.validate(input);
  }
  function renderPhotos() {
    ui['event-photo-previews'].replaceChildren();
    photos.forEach(function (p, index) {
      var box = node('div', 'photo-preview'); box.appendChild(SchoolApp.photoButton(p.preview || api.eventPhotoUrl(p.path), 'Фото ' + (index + 1)));
      var remove = node('button', 'link-btn', 'Убрать фото ' + (index + 1)); remove.type = 'button'; remove.disabled = busy;
      remove.addEventListener('click', async function () {
        if (busy) return;
        photos.splice(index, 1); if (p.preview) URL.revokeObjectURL(p.preview); preview = null; renderPhotos();
        if (p.fresh && p.attempted) { setBusy(true); await cleanup([p.path]); setBusy(false); }
      }); box.appendChild(remove); ui['event-photo-previews'].appendChild(box);
    });
  }
  function card(item, isPreview) {
    var article = node('article', 'event-card' + (item.cancelled ? ' is-cancelled' : ''));
    article.dataset.eventId = item.id || 'preview';
    article.appendChild(node('p', 'event-kind', model.types[item.kind]));
    article.appendChild(node('h4', null, item.title));
    if (item.cancelled) article.appendChild(node('p', 'event-cancelled', 'Отменено'));
    var facts = node('div', 'event-facts');
    if (item.event_date) facts.appendChild(node('p', null, '📅 ' + dateText(item.event_date)));
    if (item.time_text) facts.appendChild(node('p', null, '🕒 ' + item.time_text));
    if (item.location) facts.appendChild(node('p', null, '📍 ' + item.location));
    if (item.cost) facts.appendChild(node('p', null, 'Стоимость: ' + item.cost));
    article.appendChild(facts);
    var excerpt = node('p', 'event-excerpt', item.body.length > 180 ? item.body.slice(0, 180) + '…' : item.body);
    article.appendChild(excerpt);
    var details = node('details', 'event-details'); details.open = isPreview || expanded.has(item.id);
    var summary = node('summary', null, 'Подробнее'); details.appendChild(summary);
    details.appendChild(node('p', 'assignment-body', item.body));
    if (item.payment) { var pay = node('div', 'event-payment'); pay.append(node('h5', null, 'Условия оплаты'), node('p', 'assignment-body', item.payment)); details.appendChild(pay); }
    if (item.photo_paths.length) {
      var grid = node('div', 'photo-grid');
      item.photo_paths.forEach(function (path, i) {
        var local = isPreview && photos.find(function (p) { return p.path === path; });
        grid.appendChild(SchoolApp.photoButton(local && local.preview || api.eventPhotoUrl(path), item.title + ' — фото ' + (i + 1)));
      }); details.appendChild(grid);
    }
    function disclosure() { excerpt.hidden = details.open; summary.textContent = details.open ? 'Свернуть' : 'Подробнее'; }
    disclosure(); details.addEventListener('toggle', function () {
      disclosure(); if (!isPreview && details.isConnected) { if (details.open) expanded.add(item.id); else expanded.delete(item.id); }
    }); article.appendChild(details);
    if (api.isTeacher() && !isPreview) {
      var actions = node('div', 'homework-actions');
      function action(label, fn) { var b = node('button', 'link-btn', label); b.type = 'button'; b.disabled = busy || loading; b.addEventListener('click', fn); actions.appendChild(b); }
      action('Редактировать', function () { begin(item); });
      if (item.event_date) action(item.cancelled ? 'Снять отмену' : 'Отменить событие', function () { update(item, { cancelled: !item.cancelled }); });
      action(item.archived ? 'Вернуть из архива' : 'В архив', function () { update(item, { archived: !item.archived }); });
      action('Удалить', function () { remove(item); }); article.appendChild(actions);
    }
    return article;
  }
  function render() {
    // Сохраняем раскрытие и фокус при фоновом обновлении карточек.
    ui['events-panel'].querySelectorAll('.event-card[data-event-id] .event-details').forEach(function (d) {
      if (d.closest('#event-preview-card')) return;
      var id = d.closest('.event-card').dataset.eventId; if (d.open) expanded.add(id); else expanded.delete(id);
    });
    var active = document.activeElement, activeCard = active && active.closest('.event-card');
    var focusId = activeCard && activeCard.dataset.eventId;
    var focusIndex = activeCard ? Array.from(activeCard.querySelectorAll('button, summary')).indexOf(active) : -1;
    var day = today();
    groups.forEach(function (group) {
      var list = ui['events-' + group]; list.replaceChildren();
      var rows = items.filter(function (item) { return model.section(item, day) === group; });
      rows.sort(function (a, b) {
        var dates = group === 'upcoming' ? a.event_date.localeCompare(b.event_date) : group === 'archive' ? (b.event_date || '').localeCompare(a.event_date || '') : 0;
        return dates || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
      });
      rows.forEach(function (item) { list.appendChild(card(item, false)); });
      if (!rows.length && at) list.appendChild(node('p', 'homework-hint', group === 'announcements' ? 'Объявлений пока нет.' : group === 'upcoming' ? 'Ближайших событий пока нет.' : 'В архиве пока пусто.'));
      ui['events-' + group + '-more'].hidden = !more[group];
    });
    if (focusId && focusIndex >= 0) {
      var replacement = Array.from(ui['events-panel'].querySelectorAll('.event-card')).find(function (c) { return c.dataset.eventId === focusId; });
      var target = replacement && replacement.querySelectorAll('button, summary')[focusIndex]; if (target) target.focus({ preventScroll: true });
    }
    sync();
  }
  async function load(extra) {
    if (!api.configured || busy || loading) return;
    loading = true; render();
    var nextPages = Object.assign({}, pages); if (extra) nextPages[extra]++;
    var day = today();
    try {
      var results = await Promise.all(groups.map(async function (group) {
        var rows = [], hasMore = false;
        for (var i = 0; i < nextPages[group]; i++) {
          var batch = await api.listEvents(group, day, i * 50, 50);
          if (!Array.isArray(batch) || !batch.every(model.validItem)) throw new Error('Сервер вернул некорректные события.');
          rows = rows.concat(batch); hasMore = batch.length === 50; if (!hasMore) break;
        }
        return { rows: rows, more: hasMore };
      }));
      items = Array.from(new Map(results.flatMap(function (r) { return r.rows; }).map(function (x) { return [x.id, x]; })).values());
      groups.forEach(function (g, i) { more[g] = results[i].more; }); pages = nextPages;
      at = new Date().toISOString(); snapshot(); ui['events-status'].textContent = 'Обновлено';
      ui['events-status'].title = new Date(at).toLocaleString('ru-RU'); ui['events-status'].classList.remove('is-warning');
    } catch (error) {
      ui['events-status'].textContent = at ? 'Нет обновления. Сохранённая копия от ' + new Date(at).toLocaleString('ru-RU') + '.' : 'Не удалось загрузить события. Нажмите «Обновить».';
      ui['events-status'].classList.add('is-warning');
    } finally { loading = false; render(); }
  }
  async function begin(item) {
    if (busy) return;
    if (hasDraft() && !confirm('Заменить несохранённые изменения?')) return;
    setBusy(true); await discard(); setBusy(false);
    editing = item || null; draftId = item ? item.id : crypto.randomUUID(); editorOpen = true;
    if (item) {
      Object.keys(fields).forEach(function (key) { ui['event-' + fields[key]].value = item[key] || ''; });
      photos = item.photo_paths.map(function (path) { return { path: path }; });
    }
    ui['event-editor-title'].textContent = item ? 'Редактирование публикации' : 'Новая публикация';
    ui['event-publish'].textContent = item ? 'Сохранить изменения' : 'Опубликовать';
    updateDate(); renderPhotos(); sync(); ui['event-title'].focus();
  }
  async function update(item, changes) {
    if (busy || loading) return;
    setBusy(true);
    try {
      var saved = await api.saveEvent(Object.assign({}, item, changes), item);
      items = items.map(function (x) { return x.id === saved.id ? saved : x; }); snapshot();
      ui['event-notice'].textContent = saved.cancelled && changes.cancelled ? 'Событие отмечено отменённым.' : 'Публикация обновлена.';
    } catch (error) { failure(error); }
    finally { setBusy(false); }
  }
  async function remove(item) {
    if (busy || loading || !confirm('Удалить публикацию «' + item.title + '» и её фотографии?')) return;
    setBusy(true);
    try {
      await api.removeEvent(item); items = items.filter(function (x) { return x.id !== item.id; }); snapshot();
      if (editing && editing.id === item.id) await discard();
      ui['event-notice'].textContent = 'Публикация удалена.'; await cleanup(item.photo_paths);
    } catch (error) { failure(error); }
    finally { setBusy(false); }
  }
  ui['event-new'].addEventListener('click', function () { begin(null); });
  ui['event-kind'].addEventListener('change', updateDate);
  ui['event-editor'].addEventListener('submit', function (e) {
    e.preventDefault(); if (busy) return;
    try { preview = formInput(); ui['event-preview-card'].replaceChildren(card(preview, true)); sync(); ui['event-preview-title'].focus(); }
    catch (error) { ui['event-save-status'].textContent = error.message; }
  });
  ui['event-back'].addEventListener('click', function () { preview = null; sync(); ui['event-title'].focus(); });
  ui['event-discard'].addEventListener('click', async function () {
    if (busy || (hasDraft() && !confirm('Отменить несохранённые изменения?'))) return;
    setBusy(true); await discard(); setBusy(false); ui['event-new'].focus();
  });
  ui['event-photos'].addEventListener('change', async function () {
    if (busy) return;
    var files = Array.from(ui['event-photos'].files || []); ui['event-photos'].value = '';
    if (files.length + photos.length > 4) { ui['event-save-status'].textContent = 'Можно прикрепить до 4 изображений.'; return; }
    setBusy(true);
    try {
      for (var file of files) { var blob = await SchoolPhotos.prepare(file); photos.push({ blob: blob, preview: URL.createObjectURL(blob), path: crypto.randomUUID() + '.jpg', fresh: true }); }
      ui['event-save-status'].textContent = 'Изображения готовы к предпросмотру.';
    } catch (error) { ui['event-save-status'].textContent = error.message; }
    finally { setBusy(false); renderPhotos(); }
  });
  ui['event-publish'].addEventListener('click', async function () {
    if (!preview || busy || loading) return;
    setBusy(true); ui['event-publish-status'].textContent = 'Сохраняем…';
    var oldPaths = editing ? editing.photo_paths : [];
    try {
      for (var p of photos) {
        if (p.fresh && !p.uploaded) { p.attempted = true; await api.uploadEventPhoto(p.blob, p.path); p.uploaded = true; }
      }
      var saved = await api.saveEvent(preview, editing, draftId);
      items = items.filter(function (x) { return x.id !== saved.id; }); items.push(saved); snapshot();
      if (model.section(saved, today()) === 'archive') ui['events-archive-details'].open = true;
      ui['event-notice'].textContent = editing ? 'Изменения сохранены.' : 'Публикация доступна всем по ссылке.';
      reset(); await cleanup(oldPaths.filter(function (path) { return !saved.photo_paths.includes(path); }));
    } catch (error) { ui['event-publish-status'].textContent = error.message; failure(error); }
    finally { setBusy(false); if (!editorOpen) ui['event-new'].focus(); }
  });
  ui['events-refresh'].addEventListener('click', function () { load(); });
  groups.forEach(function (g) { ui['events-' + g + '-more'].addEventListener('click', function () { load(g); }); });
  document.addEventListener('school-auth', function () { sync(); render(); });
  document.addEventListener('school-view', function (e) { if (e.detail === 'events') { render(); load(); } });
  function refreshVisible() { if (!document.hidden && SchoolApp.currentView() === 'events') { render(); load(); } }
  window.addEventListener('online', refreshVisible); document.addEventListener('visibilitychange', refreshVisible); window.addEventListener('focus', refreshVisible);
  setInterval(refreshVisible, 60000);
  window.addEventListener('beforeunload', function (e) { if (hasDraft() || busy) { e.preventDefault(); e.returnValue = ''; } });
  SchoolApp.registerEditor({ hasDraft: hasDraft, discard: discard });
  try {
    var cached = JSON.parse(localStorage.getItem(cacheKey));
    if (cached && Array.isArray(cached.items) && cached.items.every(model.validItem) && Number.isFinite(Date.parse(cached.at))) {
      items = cached.items; at = cached.at;
      groups.forEach(function (g) { if (cached.pages && Number.isInteger(cached.pages[g]) && cached.pages[g] > 0 && cached.pages[g] <= 100) pages[g] = cached.pages[g]; more[g] = !!(cached.more && cached.more[g]); });
      ui['events-status'].textContent = 'Сохранённая копия от ' + new Date(at).toLocaleString('ru-RU') + '.';
    }
  } catch (e) { /* Повреждённый кэш не мешает загрузке. */ }
  reset(); render();
  if (api.configured) load(); else ui['events-status'].textContent = 'События пока не подключены.';
})();
