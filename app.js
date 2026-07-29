/* ============================================================================
   3 «А» класс — расписание уроков
   Вся логика приложения: сборка дня, часы «сейчас идёт», домашние задания,
   переключение дней, тема, печать, офлайн.
   Данные лежат в data.js — этот файл трогать для смены расписания не нужно.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------- хранилище */

  var LS_THEME = 'sch3a_theme_v1';
  var LS_HW    = 'sch3a_homework_v1';

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* приватный режим */ }
  }

  var homework = (function () {
    var raw = lsGet(LS_HW);
    if (!raw) return {};
    try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
  })();

  function saveHomework() { lsSet(LS_HW, JSON.stringify(homework)); }

  /* -------------------------------------------------------- время и склонения */

  function toMin(hhmm) {
    var p = String(hhmm).split(':');
    return (+p[0]) * 60 + (+p[1]);
  }

  function plural(n, one, few, many) {
    n = Math.abs(n) % 100;
    var n1 = n % 10;
    if (n > 10 && n < 20) return many;
    if (n1 > 1 && n1 < 5) return few;
    if (n1 === 1) return one;
    return many;
  }

  /** «12 минут», «1 ч 25 мин», «меньше минуты» */
  function humanDur(mins) {
    mins = Math.round(mins);
    if (mins < 1) return 'меньше минуты';
    if (mins < 60) return mins + ' ' + plural(mins, 'минута', 'минуты', 'минут');
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    if (m === 0) return h + ' ' + plural(h, 'час', 'часа', 'часов');
    return h + ' ч ' + m + ' мин';
  }

  /** Короткая форма для подписи карточки: «40 мин», «1 ч 30 мин» */
  function shortDur(mins) {
    if (mins < 60) return mins + ' мин';
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return m ? h + ' ч ' + m + ' мин' : h + ' ч';
  }

  var DAY_WHEN = {
    mon: 'в понедельник', tue: 'во вторник', wed: 'в среду',
    thu: 'в четверг', fri: 'в пятницу',
  };

  var dateFmt = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  /* ---------------------------------------------------------- сборка дня -- */

  /**
   * Превращает сырые записи из data.js в готовый к отрисовке список:
   * подставляет эмодзи и цвет, считает номера уроков и вставляет
   * безымянные перерывы там, где между записями остался зазор.
   * Возвращает null, если расписание дня ещё не известно.
   */
  function buildDay(dayKey) {
    var raw = SCHEDULE[dayKey];
    if (!raw || !raw.length) return null;

    var items = [];
    var lessonNo = 0;
    var prevEnd = null;

    raw.forEach(function (e) {
      var from = toMin(e.from);
      var to = toMin(e.to);

      if (prevEnd !== null && from > prevEnd) {
        items.push({
          kind: 'gap', slim: true,
          icon: BLOCKS.gap.icon, title: BLOCKS.gap.title,
          from: prevEnd, to: from,
          fromText: minToText(prevEnd), toText: e.from,
        });
      }
      prevEnd = to;

      var item = { from: from, to: to, fromText: e.from, toText: e.to };

      if (e.type) {
        var b = BLOCKS[e.type] || BLOCKS.unknown;
        item.kind = e.type;
        item.slim = !!b.slim;
        item.icon = b.icon;
        item.title = b.title;
        item.color = b.color || null;
      } else if (e.title) {
        lessonNo += 1;
        var s = SUBJECTS[e.title] || {};
        item.kind = 'lesson';
        item.icon = s.icon || '📘';
        item.color = s.color || 'slate';
        item.title = e.title;
        item.shortTitle = s.short || e.title;
        item.no = lessonNo;
        item.hwKey = dayKey + '|' + e.from;
      } else {
        lessonNo += 1;
        item.kind = 'unknown';
        item.icon = BLOCKS.unknown.icon;
        item.color = BLOCKS.unknown.color;
        item.title = BLOCKS.unknown.title;
        item.shortTitle = BLOCKS.unknown.title;
        item.no = lessonNo;
      }

      items.push(item);
    });

    return items;
  }

  function minToText(m) {
    var h = Math.floor(m / 60);
    var mm = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }

  /** Кэш собранных дней — пересобирать каждую секунду незачем. */
  var dayCache = {};
  function day(dayKey) {
    if (!(dayKey in dayCache)) dayCache[dayKey] = buildDay(dayKey);
    return dayCache[dayKey];
  }

  function dayMeta(dayKey) {
    for (var i = 0; i < DAYS.length; i++) if (DAYS[i].key === dayKey) return DAYS[i];
    return null;
  }

  /* -------------------------------------------------------------- «сейчас» */

  function nowStamp() {
    var d = new Date();
    var meta = null;
    for (var i = 0; i < DAYS.length; i++) if (DAYS[i].dow === d.getDay()) meta = DAYS[i];
    return {
      date: d,
      dayKey: meta ? meta.key : null,
      mins: d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60,
    };
  }

  /** Ближайший учебный день с известным расписанием, начиная со следующего. */
  function nextKnownDay(fromDow) {
    for (var step = 1; step <= 7; step++) {
      var dow = (fromDow + step) % 7;
      for (var i = 0; i < DAYS.length; i++) {
        if (DAYS[i].dow !== dow) continue;
        var items = day(DAYS[i].key);
        if (items) return { meta: DAYS[i], items: items, step: step };
      }
    }
    return null;
  }

  function isLessonItem(item) {
    return !!item && (item.kind === 'lesson' || item.kind === 'unknown');
  }

  function firstLesson(items) {
    for (var i = 0; i < items.length; i++) if (isLessonItem(items[i])) return items[i];
    return items[0] || null;
  }

  function nextLessonAfter(items, index) {
    for (var i = index + 1; i < items.length; i++) if (isLessonItem(items[i])) return items[i];
    return null;
  }

  /** Что вообще будет следующим — безымянные перерывы пропускаем:
      «Дальше: Перерыв» ничего не сообщает, «Дальше: Обед» сообщает. */
  function nextAnythingAfter(items, index) {
    for (var i = index + 1; i < items.length; i++) {
      if (items[i].kind !== 'gap') return items[i];
    }
    return null;
  }

  function nextLine(item) {
    return item
      ? 'Дальше: ' + item.icon + ' ' + item.title + ' в ' + item.fromText
      : 'Это последнее на сегодня';
  }

  /**
   * Что показать в верхней плашке. Возвращает объект с готовыми строками —
   * отрисовка отдельно, чтобы состояние было легко проверить.
   */
  function nowState(stamp) {
    var items = stamp.dayKey ? day(stamp.dayKey) : null;

    // выходной
    if (!stamp.dayKey) {
      var nx = nextKnownDay(stamp.date.getDay());
      return {
        color: 'accent', kicker: 'Выходной', icon: '🎉',
        title: 'Сегодня можно отдыхать',
        left: '',
        next: nx ? whenFirstText(nx) : '',
      };
    }

    // учебный день, но расписание ещё не прислали
    if (!items) {
      var meta = dayMeta(stamp.dayKey);
      return {
        color: 'unknown', kicker: 'Сегодня', icon: '❓',
        title: 'Расписание уточняется',
        left: meta ? 'На ' + meta.title.toLowerCase() + ' уроки пока не известны' : '',
        next: '',
      };
    }

    var first = items[0];
    var last = items[items.length - 1];

    // до начала занятий: ведём к первой записи дня (завтрак), а не к уроку —
    // прийти надо к ней; про первый урок сообщаем отдельной строкой
    if (stamp.mins < first.from) {
      var fl = firstLesson(items);
      return {
        color: first.color || 'accent',
        kicker: 'Скоро в школу', icon: first.icon || '🎒',
        title: first.title,
        left: 'начало в ' + first.fromText + ', через ' + humanDur(first.from - stamp.mins),
        next: fl && fl !== first
          ? 'Первый урок — ' + fl.icon + ' ' + fl.title + ' в ' + fl.fromText
          : '',
      };
    }

    // после конца
    if (stamp.mins >= last.to) {
      var nxt = nextKnownDay(stamp.date.getDay());
      return {
        color: 'accent', kicker: 'Уроки закончились', icon: '🎉',
        title: 'На сегодня всё!',
        left: '',
        next: nxt ? whenFirstText(nxt) : '',
      };
    }

    // что-то идёт прямо сейчас
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (stamp.mins < it.from || stamp.mins >= it.to) continue;

      var left = it.to - stamp.mins;
      var progress = Math.max(0, Math.min(100, ((stamp.mins - it.from) / (it.to - it.from)) * 100));
      var soon = nextAnythingAfter(items, i);

      if (isLessonItem(it)) {
        // На уроке интересен следующий УРОК, а не перемена между ними.
        return {
          color: it.color, kicker: 'Сейчас идёт', icon: it.icon,
          title: it.kind === 'unknown' ? 'Урок пока не известен' : it.title,
          left: 'до звонка ' + humanDur(left),
          progress: progress, pulse: true,
          next: nextLine(nextLessonAfter(items, i) || soon),
          activeIndex: i,
        };
      }

      // Не-урок: заголовок плашки называет сам блок, поэтому надпись сверху
      // остаётся нейтральной — иначе выходит «Перемена / Перемена».
      // И дальше показываем ближайшее событие: на завтраке это утренний круг,
      // а не первый урок через час.
      return {
        color: it.color || 'accent',
        kicker: 'Сейчас',
        icon: it.icon,
        title: it.kind === 'homework' ? 'Время домашки' : it.title,
        left: (isLessonItem(soon) ? 'до урока ' : 'ещё ') + humanDur(left),
        progress: progress, pulse: true,
        next: nextLine(soon),
        activeIndex: i,
      };
    }

    // теоретически недостижимо, но пусть будет честный ответ
    return { color: 'accent', kicker: 'Сегодня', icon: '🎒', title: 'Учебный день', left: '', next: '' };
  }

  function whenFirstText(nx) {
    var fl = firstLesson(nx.items);
    if (!fl) return '';
    var when = nx.step === 1 ? 'Завтра' : (DAY_WHEN[nx.meta.key] || '').replace(/^в/, 'В');
    return when + ' первым — ' + fl.icon + ' ' + fl.title + ' в ' + fl.fromText;
  }

  /* --------------------------------------------------------------- утилиты */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function hwOf(key) { return key && homework[key] ? homework[key] : null; }

  /* ------------------------------------------------------------- состояние */

  var state = {
    activeDay: null,   // какой день открыт
    todayKey: null,    // какой день сегодня (null в выходные)
    rows: [],          // соответствие «элемент расписания → узлы DOM»
  };

  var dom = {
    className: document.getElementById('class-name'),
    todayDate: document.getElementById('today-date'),
    nowCard: document.getElementById('now-card'),
    days: document.getElementById('days'),
    day: document.getElementById('day'),
    themeBtn: document.getElementById('theme-btn'),
    themeIcon: document.getElementById('theme-icon'),
    printBtn: document.getElementById('print-btn'),
    clearHwBtn: document.getElementById('clear-hw-btn'),
    printView: document.getElementById('print-view'),
    sheetWrap: document.getElementById('sheet-wrap'),
    sheet: document.getElementById('sheet'),
    sheetBackdrop: document.getElementById('sheet-backdrop'),
    sheetClose: document.getElementById('sheet-close'),
    sheetIcon: document.getElementById('sheet-icon'),
    sheetTitle: document.getElementById('sheet-title'),
    sheetSub: document.getElementById('sheet-sub'),
    hwText: document.getElementById('hw-text'),
    hwDone: document.getElementById('hw-done'),
    hwClear: document.getElementById('hw-clear'),
    savedNote: document.getElementById('saved-note'),
  };

  /* ------------------------------------------------------- отрисовка шапки */

  function renderTop(stamp) {
    dom.className.textContent = CLASS_NAME;
    var text = dateFmt.format(stamp.date);
    dom.todayDate.textContent = text.charAt(0).toUpperCase() + text.slice(1);
  }

  /* --------------------------------------------------- отрисовка «сейчас» */

  function renderNow(stamp) {
    var s = nowState(stamp);
    dom.nowCard.setAttribute('data-c', s.color || 'accent');
    dom.nowCard.innerHTML = '';

    var kicker = el('p', 'now-kicker');
    if (s.pulse) kicker.appendChild(el('span', 'now-pulse'));
    kicker.appendChild(document.createTextNode(s.kicker));
    dom.nowCard.appendChild(kicker);

    var main = el('div', 'now-main');
    var icon = el('span', 'now-icon', s.icon);
    icon.setAttribute('aria-hidden', 'true');
    main.appendChild(icon);

    var textWrap = el('div', 'now-text');
    var title = el('h2', 'now-title' + (s.title.length > 20 ? ' is-long' : ''), s.title);
    textWrap.appendChild(title);
    if (s.left) textWrap.appendChild(el('p', 'now-left', s.left));
    main.appendChild(textWrap);
    dom.nowCard.appendChild(main);

    if (typeof s.progress === 'number') {
      var bar = el('div', 'now-bar');
      var fill = el('i');
      fill.style.width = s.progress.toFixed(1) + '%';
      bar.appendChild(fill);
      dom.nowCard.appendChild(bar);
    }

    if (s.next) dom.nowCard.appendChild(el('p', 'now-next', s.next));
  }

  /* ------------------------------------------------- отрисовка дней недели */

  function renderDays() {
    dom.days.innerHTML = '';
    DAYS.forEach(function (d) {
      var known = !!day(d.key);
      var btn = el('button', 'day-pill' + (d.key === state.activeDay ? ' is-active' : '') +
                              (known ? '' : ' is-empty'));
      btn.type = 'button';
      btn.textContent = d.short;
      btn.title = d.title;
      btn.setAttribute('aria-label', d.title + (known ? '' : ' — расписание уточняется'));
      if (d.key === state.activeDay) btn.setAttribute('aria-current', 'true');
      if (d.key === state.todayKey) {
        var dot = el('span', 'today-dot');
        dot.setAttribute('aria-hidden', 'true');
        btn.appendChild(dot);
      }
      btn.addEventListener('click', function () { selectDay(d.key); });
      dom.days.appendChild(btn);
    });
  }

  /* -------------------------------------------------- отрисовка ленты дня */

  function renderDay() {
    var meta = dayMeta(state.activeDay);
    var items = day(state.activeDay);

    dom.day.innerHTML = '';
    state.rows = [];

    var head = el('div', 'day-head');
    head.appendChild(el('h2', null, meta ? meta.title : ''));
    if (items) {
      // Считаем именно уроки и их рамки: «до 15:00» по последнему блоку
      // читалось бы как «уроки до трёх», хотя в 15:00 заканчивается домашка.
      var lessonItems = items.filter(isLessonItem);
      var n = lessonItems.length;
      var span = n
        ? n + ' ' + plural(n, 'урок', 'урока', 'уроков') + ' · ' +
          lessonItems[0].fromText + '–' + lessonItems[n - 1].toText
        : 'уроков нет';
      head.appendChild(el('span', null, span));
    } else {
      head.appendChild(el('span', null, 'расписание уточняется'));
    }
    dom.day.appendChild(head);

    if (!items) {
      var empty = el('div', 'empty');
      var emo = el('div', 'emo', '🙂');
      emo.setAttribute('aria-hidden', 'true');
      empty.appendChild(emo);
      empty.appendChild(el('h3', null, 'Расписание уточняется'));
      empty.appendChild(el('p', null, 'Как только уроки на ' +
        (meta ? meta.title.toLowerCase() : 'этот день') + ' станут известны, они появятся здесь.'));
      dom.day.appendChild(empty);
      return;
    }

    var firstRowDone = false;

    items.forEach(function (it, index) {
      if (it.slim) {
        var pause = el('div', 'pause');
        pause.appendChild(el('div', 'time'));
        var track = el('div', 'track');
        pause.appendChild(track);
        var body = el('div', 'pause-body');
        var pIcon = el('span', null, it.icon);
        pIcon.setAttribute('aria-hidden', 'true');
        body.appendChild(pIcon);
        body.appendChild(document.createTextNode(it.title));
        body.appendChild(el('span', 'mins', shortDur(it.to - it.from)));
        pause.appendChild(body);
        dom.day.appendChild(pause);
        state.rows.push({ item: it, index: index, node: pause, card: null, fill: null });
        return;
      }

      var row = el('div', 'row' + (firstRowDone ? '' : ' is-first'));
      firstRowDone = true;
      row.setAttribute('data-c', it.color || 'slate');

      row.appendChild(el('div', 'time', it.fromText));

      var trackEl = el('div', 'track');
      var dot = el('span', 'dot');
      dot.setAttribute('aria-hidden', 'true');
      trackEl.appendChild(dot);
      row.appendChild(trackEl);

      var isLesson = it.kind === 'lesson';
      var card = el(isLesson ? 'button' : 'div',
        'card' + (it.kind === 'unknown' ? ' is-unknown' : '') + (isLesson ? '' : ' is-static'));
      if (isLesson) {
        card.type = 'button';
        card.addEventListener('click', function () { openSheet(it); });
      }

      var bubble = el('span', 'bubble', it.icon);
      bubble.setAttribute('aria-hidden', 'true');
      card.appendChild(bubble);

      var txt = el('div', 'txt');
      var name = it.shortTitle || it.title;
      txt.appendChild(el('h3', name.length > 20 ? 'is-long' : null, name));
      var sub = it.no
        ? it.no + '-й урок · до ' + it.toText
        : 'до ' + it.toText + ' · ' + shortDur(it.to - it.from);
      txt.appendChild(el('p', null, sub));
      card.appendChild(txt);

      // Длительность урока пилюлей справа — только на планшете и шире:
      // на телефоне ей негде встать, а на широком экране карточка без неё
      // выглядит наполовину пустой.
      if (it.no) card.appendChild(el('span', 'range', shortDur(it.to - it.from)));

      var hw = hwOf(it.hwKey);
      if (hw && (hw.t || hw.d)) {
        var flag = el('span', 'flag', hw.d ? '✅' : '📝');
        flag.setAttribute('title', hw.d ? 'Домашнее задание сделано' : 'Есть домашнее задание');
        card.appendChild(flag);
      }

      var progress = el('div', 'progress');
      var fill = el('i');
      fill.style.width = '0%';
      progress.appendChild(fill);
      card.appendChild(progress);

      row.appendChild(card);
      dom.day.appendChild(row);
      state.rows.push({ item: it, index: index, node: row, card: card, fill: fill, progress: progress });
    });

    var end = el('div', 'day-end');
    end.appendChild(el('div', 'time', items[items.length - 1].toText));
    var endTrack = el('div', 'track');
    var cap = el('span', 'cap');
    cap.setAttribute('aria-hidden', 'true');
    endTrack.appendChild(cap);
    end.appendChild(endTrack);
    end.appendChild(el('div', 'label', 'Конец учебного дня'));
    dom.day.appendChild(end);
  }

  /* ----------------------------------------- подсветка «идёт / прошло» */

  function paintLive(stamp) {
    var showLive = state.activeDay === state.todayKey;

    state.rows.forEach(function (r) {
      var it = r.item;
      var isNow = showLive && stamp.mins >= it.from && stamp.mins < it.to;
      var isPast = showLive && stamp.mins >= it.to;

      r.node.classList.toggle('is-now', isNow);
      r.node.classList.toggle('is-past', isPast);
      if (r.card) r.card.classList.toggle('is-now', isNow);
      if (r.progress) r.progress.style.display = isNow ? '' : 'none';
      if (r.fill && isNow) {
        var pct = ((stamp.mins - it.from) / (it.to - it.from)) * 100;
        r.fill.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';
      }
    });
  }

  /* ------------------------------------------------------ выбор дня недели */

  function selectDay(key) {
    if (state.activeDay === key) return;
    state.activeDay = key;
    renderDays();
    renderDay();
    paintLive(nowStamp());
  }

  function shiftDay(delta) {
    var i = 0;
    for (var k = 0; k < DAYS.length; k++) if (DAYS[k].key === state.activeDay) i = k;
    var next = Math.min(DAYS.length - 1, Math.max(0, i + delta));
    if (next !== i) selectDay(DAYS[next].key);
  }

  /* ---------------------------------------------------------------- шторка */

  var sheetItem = null;
  var savedTimer = null;
  var lastFocus = null;

  function openSheet(it) {
    sheetItem = it;
    lastFocus = document.activeElement;

    dom.sheet.setAttribute('data-c', it.color || 'slate');
    dom.sheetIcon.textContent = it.icon;
    dom.sheetTitle.textContent = it.title;
    dom.sheetSub.textContent = (it.no ? it.no + '-й урок · ' : '') +
      it.fromText + ' – ' + it.toText + ' · ' + shortDur(it.to - it.from);

    var hw = hwOf(it.hwKey) || { t: '', d: false };
    dom.hwText.value = hw.t || '';
    dom.hwDone.checked = !!hw.d;
    dom.savedNote.classList.remove('is-on');

    dom.sheetWrap.hidden = false;
    // отдельный кадр — иначе перехода снизу вверх не видно
    requestAnimationFrame(function () {
      dom.sheetWrap.classList.add('is-open');
      dom.sheetClose.focus();
    });
    document.body.style.overflow = 'hidden';
  }

  function closeSheet() {
    dom.sheetWrap.classList.remove('is-open');
    document.body.style.overflow = '';
    setTimeout(function () {
      dom.sheetWrap.hidden = true;
      sheetItem = null;
    }, 260);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function flashSaved() {
    dom.savedNote.textContent = 'Сохранено ✓';
    dom.savedNote.classList.add('is-on');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(function () { dom.savedNote.classList.remove('is-on'); }, 1600);
  }

  function storeSheet() {
    if (!sheetItem || !sheetItem.hwKey) return;
    var text = dom.hwText.value.trim();
    var done = dom.hwDone.checked;
    if (!text && !done) delete homework[sheetItem.hwKey];
    else homework[sheetItem.hwKey] = { t: text, d: done };
    saveHomework();
    flashSaved();
    refreshFlags();
  }

  /** Обновляет значки 📝/✅ на карточках, не перерисовывая весь день. */
  function refreshFlags() {
    state.rows.forEach(function (r) {
      if (!r.card || r.item.kind !== 'lesson') return;
      var existing = r.card.querySelector('.flag');
      var hw = hwOf(r.item.hwKey);
      var want = hw && (hw.t || hw.d) ? (hw.d ? '✅' : '📝') : null;
      if (!want) { if (existing) existing.remove(); return; }
      if (existing) { existing.textContent = want; return; }
      var flag = el('span', 'flag', want);
      r.card.insertBefore(flag, r.card.querySelector('.progress'));
    });
  }

  /* ------------------------------------------------------------------ тема */

  var THEME_ORDER = ['auto', 'light', 'dark'];
  var THEME_ICON = { auto: '🌗', light: '🌞', dark: '🌙' };
  var THEME_NAME = { auto: 'как на телефоне', light: 'светлое', dark: 'тёмное' };

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'auto';
  }

  function applyTheme(theme) {
    var dark = theme === 'dark' || (theme === 'auto' &&
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-resolved', dark ? 'dark' : 'light');
    dom.themeIcon.textContent = THEME_ICON[theme];
    dom.themeBtn.title = 'Оформление: ' + THEME_NAME[theme];
    dom.themeBtn.setAttribute('aria-label', 'Оформление: ' + THEME_NAME[theme] + '. Нажмите, чтобы сменить');
    lsSet(LS_THEME, theme);
  }

  /* ---------------------------------------------------------------- печать */

  function buildPrintView() {
    dom.printView.innerHTML = '';
    dom.printView.appendChild(el('h1', null, CLASS_NAME + ' — расписание уроков'));
    dom.printView.appendChild(el('p', 'p-sub',
      'Распечатано ' + new Intl.DateTimeFormat('ru-RU').format(new Date())));

    var grid = el('div', 'print-grid');
    DAYS.forEach(function (d) {
      var col = el('div', 'p-day');
      col.appendChild(el('h2', null, d.title));
      var items = day(d.key);
      if (!items) {
        col.appendChild(el('div', 'p-row p-quiet', 'расписание уточняется'));
      } else {
        items.forEach(function (it) {
          var row = el('div', 'p-row' + (it.kind === 'lesson' ? '' : ' p-quiet'));
          row.appendChild(el('span', 'p-t', it.fromText + '–' + it.toText));
          row.appendChild(el('span', null, it.title));
          col.appendChild(row);
        });
      }
      grid.appendChild(col);
    });
    dom.printView.appendChild(grid);
  }

  /* ---------------------------------------------------------------- свайпы */

  function bindSwipe() {
    var x0 = null, y0 = null, t0 = 0;

    dom.day.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { x0 = null; return; }
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      t0 = Date.now();
    }, { passive: true });

    dom.day.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - x0;
      var dy = t.clientY - y0;
      x0 = null;
      if (Date.now() - t0 > 700) return;            // это была не «пролистка»
      if (Math.abs(dx) < 55) return;                 // слишком короткий жест
      if (Math.abs(dx) < Math.abs(dy) * 1.4) return; // это вертикальная прокрутка
      shiftDay(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  /* ------------------------------------------------------------------- тик */

  function tick() {
    var stamp = nowStamp();

    // сменились сутки — пересобираем шапку и кнопки дней
    if (stamp.dayKey !== state.todayKey) {
      state.todayKey = stamp.dayKey;
      renderDays();
    }

    renderTop(stamp);
    renderNow(stamp);
    paintLive(stamp);
  }

  /* ------------------------------------------------------------------ старт */

  function start() {
    var stamp = nowStamp();
    state.todayKey = stamp.dayKey;
    // в выходные открываем ближайший учебный день
    state.activeDay = stamp.dayKey || (nextKnownDay(stamp.date.getDay()) || { meta: DAYS[0] }).meta.key;

    applyTheme(currentTheme());
    renderTop(stamp);
    renderDays();
    renderDay();
    renderNow(stamp);
    paintLive(stamp);
    buildPrintView();

    // --- события

    dom.themeBtn.addEventListener('click', function () {
      var i = THEME_ORDER.indexOf(currentTheme());
      applyTheme(THEME_ORDER[(i + 1) % THEME_ORDER.length]);
    });

    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onScheme = function () { if (currentTheme() === 'auto') applyTheme('auto'); };
      if (mq.addEventListener) mq.addEventListener('change', onScheme);
      else if (mq.addListener) mq.addListener(onScheme);
    }

    dom.printBtn.addEventListener('click', function () {
      buildPrintView();
      window.print();
    });

    dom.clearHwBtn.addEventListener('click', function () {
      if (!Object.keys(homework).length) {
        alert('Домашних заданий пока не записано.');
        return;
      }
      if (!confirm('Стереть все записанные домашние задания?')) return;
      homework = {};
      saveHomework();
      renderDay();
      paintLive(nowStamp());
    });

    dom.sheetClose.addEventListener('click', closeSheet);
    dom.sheetBackdrop.addEventListener('click', closeSheet);
    dom.hwText.addEventListener('input', debounce(storeSheet, 450));
    dom.hwText.addEventListener('blur', storeSheet);
    dom.hwDone.addEventListener('change', storeSheet);
    dom.hwClear.addEventListener('click', function () {
      dom.hwText.value = '';
      dom.hwDone.checked = false;
      storeSheet();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !dom.sheetWrap.hidden) { closeSheet(); return; }
      if (!dom.sheetWrap.hidden) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'ArrowRight') { shiftDay(1); e.preventDefault(); }
      if (e.key === 'ArrowLeft')  { shiftDay(-1); e.preventDefault(); }
    });

    bindSwipe();

    setInterval(tick, 30000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) tick();
    });
    window.addEventListener('focus', tick);

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('./service-worker.js').catch(function () {
          /* офлайн-режим просто не включится — приложение работает и так */
        });
      });
    }
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
