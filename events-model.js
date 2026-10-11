/* Правила публикаций: общие для формы, API и офлайн-копии. */
(function (root) {
  'use strict';
  var types = { event: 'Мероприятие', test: 'Контрольная', announcement: 'Объявление' };
  var limits = { title: 150, body: 10000, time_text: 300, location: 500, cost: 200, payment: 3000 };
  var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var photo = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;
  function today(zone, now) {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone || 'Asia/Yekaterinburg', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now || new Date());
    var result = {}; parts.forEach(function (p) { result[p.type] = p.value; });
    return result.year + '-' + result.month + '-' + result.day;
  }
  function validate(input) {
    var result = { kind: input.kind };
    if (!Object.hasOwn(types, result.kind)) throw new Error('Выберите тип публикации.');
    Object.keys(limits).forEach(function (key) {
      var value = String(input[key] || '').trim();
      if (Array.from(value).length > limits[key] || (['title', 'body'].includes(key) && !value)) throw new Error('Заполните заголовок и описание и соблюдайте ограничения длины полей.');
      result[key] = value;
    });
    var date = input.event_date || null;
    if (date) {
      var parsed = new Date(date + 'T12:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date < '2020-01-01' || date > '2100-12-31') throw new Error('Укажите корректную дату события.');
    }
    if (!date && result.kind !== 'announcement') throw new Error('Для мероприятия и контрольной нужна дата.');
    result.event_date = date;
    var paths = input.photo_paths || [];
    if (!Array.isArray(paths) || paths.length > 4 || new Set(paths).size !== paths.length || !paths.every(function (p) { return typeof p === 'string' && photo.test(p); })) throw new Error('Можно прикрепить до 4 фотографий.');
    result.photo_paths = paths.slice();
    ['cancelled', 'archived'].forEach(function (key) { if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error('Некорректный статус публикации.'); result[key] = input[key] === true; });
    return result;
  }
  function validItem(item) {
    try { validate(item); return uuid.test(item.id) && Number.isSafeInteger(item.version) && item.version > 0 && Number.isFinite(Date.parse(item.created_at)) && Number.isFinite(Date.parse(item.updated_at)); } catch (e) { return false; }
  }
  function section(item, day) { return item.archived || (item.event_date && item.event_date < day) ? 'archive' : item.event_date ? 'upcoming' : 'announcements'; }
  root.SchoolEventsModel = { types: types, limits: limits, uuid: uuid, validate: validate, validItem: validItem, today: today, section: section };
  if (typeof module === 'object' && module.exports) module.exports = root.SchoolEventsModel;
})(typeof window === 'object' ? window : globalThis);
