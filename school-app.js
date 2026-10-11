/* Общая сессия учителя, навигация и просмотр изображений. */
(function () {
  'use strict';
  var api = SchoolHomework.createClient(window.HOMEWORK_CONFIG);
  var ui = {}, editors = [], locks = new Set(), currentView = 'schedule', authBusy = false;
  document.querySelectorAll('[id]').forEach(function (n) { ui[n.id] = n; });
  var views = ['schedule', 'homework', 'events'];
  function node(tag, cls, text) {
    var n = document.createElement(tag); if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text; return n;
  }
  function syncAuth() {
    var teacher = api.isTeacher();
    ui['teacher-login'].hidden = teacher; ui['teacher-logout'].hidden = !teacher;
    ui['teacher-open'].textContent = teacher ? 'Учитель' : 'Учителю';
    ui['teacher-title'].textContent = teacher ? 'Режим учителя' : 'Вход для учителя';
    ui['teacher-login'].querySelectorAll('input, button').forEach(function (n) { n.disabled = authBusy; });
    ui['teacher-logout'].disabled = authBusy || locks.size > 0;
    document.dispatchEvent(new CustomEvent('school-auth'));
  }
  function switchView(view, focus) {
    currentView = view;
    views.forEach(function (name) {
      var active = name === view; ui[name + '-panel'].hidden = !active;
      ui[name + '-tab'].setAttribute('aria-selected', String(active));
      ui[name + '-tab'].tabIndex = active ? 0 : -1;
    });
    if (focus) ui[view + '-tab'].focus();
    document.dispatchEvent(new CustomEvent('school-view', { detail: view }));
  }
  views.forEach(function (view, index) {
    ui[view + '-tab'].addEventListener('click', function () { switchView(view); });
    ui[view + '-tab'].addEventListener('keydown', function (e) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      var next = e.key === 'Home' ? 0 : e.key === 'End' ? views.length - 1 :
        (index + (e.key === 'ArrowRight' ? 1 : -1) + views.length) % views.length;
      switchView(views[next], true);
    });
  });
  function openTeacher() { if (!ui['teacher-access'].open) ui['teacher-access'].showModal(); }
  ui['teacher-open'].addEventListener('click', openTeacher);
  ui['teacher-close'].addEventListener('click', function () { ui['teacher-access'].close(); });
  ui['teacher-login'].addEventListener('submit', async function (e) {
    e.preventDefault(); if (authBusy) return;
    authBusy = true; syncAuth(); ui['teacher-status'].textContent = 'Проверяем вход…';
    try {
      await api.login(ui['teacher-email'].value, ui['teacher-password'].value);
      ui['teacher-status'].textContent = 'Вы вошли как учитель.'; ui['teacher-access'].close();
      // Сохраняем привычный вход из расписания и выбранный раздел событий.
      if (currentView === 'schedule') switchView('homework');
    } catch (error) { ui['teacher-status'].textContent = error.message; }
    finally { ui['teacher-password'].value = ''; authBusy = false; syncAuth(); }
  });
  ui['teacher-logout'].addEventListener('click', async function () {
    if (authBusy || locks.size) return;
    if (editors.some(function (e) { return e.hasDraft(); }) && !confirm('Выйти и отменить несохранённые изменения?')) return;
    authBusy = true; syncAuth();
    try {
      for (var editor of editors) await editor.discard();
      await api.logout(); ui['teacher-status'].textContent = 'Вы вышли из режима учителя.';
    } catch (error) { ui['teacher-status'].textContent = 'Вы вышли на этом устройстве. Сервер не подтвердил завершение сеанса.'; }
    finally { authBusy = false; syncAuth(); }
  });
  function photoButton(url, title) {
    var button = node('button', 'photo-thumb'); button.type = 'button'; button.setAttribute('aria-label', 'Открыть: ' + title);
    var img = node('img'); img.src = url; img.alt = title; img.loading = 'lazy';
    img.addEventListener('error', function () { img.hidden = true; if (!button.querySelector('span')) button.appendChild(node('span', 'homework-hint', 'Фото недоступно. Нажмите, чтобы открыть.')); });
    button.appendChild(img);
    button.addEventListener('click', function () {
      ui['photo-full'].src = url; ui['photo-full'].alt = title; ui['photo-title'].textContent = title;
      ui['photo-original'].href = url; ui['photo-canvas'].classList.remove('is-zoomed');
      ui['photo-zoom'].setAttribute('aria-pressed', 'false'); ui['photo-zoom'].textContent = 'Увеличить';
      ui['photo-viewer'].showModal();
    }); return button;
  }
  ui['photo-close'].addEventListener('click', function () { ui['photo-viewer'].close(); });
  ui['photo-zoom'].addEventListener('click', function () {
    var zoom = ui['photo-canvas'].classList.toggle('is-zoomed');
    ui['photo-zoom'].setAttribute('aria-pressed', String(zoom)); ui['photo-zoom'].textContent = zoom ? 'Уместить целиком' : 'Увеличить';
  });
  window.SchoolApp = { api: api, node: node, photoButton: photoButton, openTeacher: openTeacher,
    registerEditor: function (editor) { editors.push(editor); },
    setBusy: function (key, value) { if (value) locks.add(key); else locks.delete(key); ui['teacher-logout'].disabled = authBusy || locks.size > 0; },
    currentView: function () { return currentView; } };
  if (api.onAuthChange) api.onAuthChange(syncAuth);
  var lastAuth = api.isTeacher();
  setInterval(function () { var auth = api.isTeacher(); if (lastAuth !== auth) { lastAuth = auth; syncAuth(); } }, 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) syncAuth(); });
  ui['teacher-open'].hidden = !api.configured; ui['teacher-access'].hidden = !api.configured; syncAuth();
})();
