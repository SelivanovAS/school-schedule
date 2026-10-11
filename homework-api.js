/* Общие задания: Supabase Auth + REST. Права проверяются политиками базы данных. */
(function (root) {
  'use strict';

  function createClient(config, fetcher) {
    config = config || {};
    var url = (config.url || '').replace(/\/$/, '');
    var key = config.publishableKey || '';
    var configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) &&
      /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
    var listeners = [];
    function changed() { listeners.forEach(function (fn) { fn(); }); }
    function clearSession() { session = null; changed(); }
    var session = null; // Только в памяти вкладки, без пароля и постоянного хранилища.
    var photoPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;
    fetcher = fetcher || root.fetch.bind(root);

    async function request(path, options, token) {
      if (!configured) throw new Error('Общие задания ещё не подключены.');
      options = options || {};
      var controller = new AbortController();
      var timeout = setTimeout(function () { controller.abort(); }, options.raw ? 60000 : 15000);
      var headers = { apikey: key, 'Content-Type': options.raw ? 'image/jpeg' : 'application/json' };
      if (options.raw) headers['x-upsert'] = 'false';
      if (token) headers.Authorization = 'Bearer ' + token;
      if (options.method && options.method !== 'GET') headers.Prefer = 'return=representation';
      try {
        var response = await fetcher(url + path, {
          method: options.method || 'GET', headers: headers,
          body: options.raw ? options.body : options.body === undefined ? undefined : JSON.stringify(options.body),
          cache: 'no-store', credentials: 'omit', signal: controller.signal,
        });
        if (!response.ok) {
          var error = new Error(response.status === 401 || response.status === 403
            ? 'Вход не подтверждён или нет прав учителя. Войдите заново.'
            : response.status === 429 ? 'Слишком много попыток. Попробуйте немного позже.'
            : 'Не удалось выполнить запрос. Попробуйте ещё раз.');
          error.status = response.status;
          if (token && (response.status === 401 || response.status === 403)) clearSession();
          throw error;
        }
        var text = await response.text();
        return text ? JSON.parse(text) : null;
      } catch (error) {
        if (error.name === 'AbortError' || error instanceof TypeError) {
          throw new Error('Нет связи с сервером. Проверьте интернет и повторите попытку.');
        }
        throw error;
      } finally { clearTimeout(timeout); }
    }

    function teacherToken() {
      if (!session || session.expiresAt <= Date.now()) {
        clearSession();
        throw new Error('Сеанс учителя завершён. Войдите заново; текст сохранён в форме.');
      }
      return session.token;
    }

    function validate(input) {
      var subject = String(input.subject || '').trim();
      var body = String(input.body || '').trim();
      var due = String(input.due_date || '');
      var date = new Date(due + 'T12:00:00Z');
      if (!subject || subject.length > 100 || !body || body.length > 6000) {
        throw new Error('Укажите предмет (до 100 символов) и задание (до 6000 символов).');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(date.getTime()) ||
          date.toISOString().slice(0, 10) !== due || due < '2020-01-01' || due > '2100-12-31') {
        throw new Error('Укажите корректную дату сдачи.');
      }
      var payload = { subject: subject, body: body, due_date: due };
      if (input.photo_paths !== undefined) {
        if (!Array.isArray(input.photo_paths) || input.photo_paths.length > 4 ||
            new Set(input.photo_paths).size !== input.photo_paths.length ||
            !input.photo_paths.every(function (p) { return typeof p === 'string' && photoPattern.test(p); })) {
          throw new Error('Можно прикрепить до 4 фотографий из хранилища класса.');
        }
        payload.photo_paths = input.photo_paths.slice();
      }
      return payload;
    }

    function selector(item) {
      if (!/^[0-9a-f-]{36}$/i.test(item.id) || !Number.isSafeInteger(item.version) || item.version < 1) {
        throw new Error('Некорректное задание. Обновите список.');
      }
      return '?id=eq.' + item.id + '&version=eq.' + item.version;
    }

    return {
      listEvents: function (group, day, offset, limit) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Некорректная дата.');
        var filters = {
          announcements: '&archived=eq.false&event_date=is.null&order=created_at.desc,id.desc',
          upcoming: '&archived=eq.false&event_date=gte.' + day + '&order=event_date.asc,created_at.desc,id.desc',
          archive: '&or=(archived.eq.true,event_date.lt.' + day + ')&order=event_date.desc.nullslast,created_at.desc,id.desc'
        };
        if (!Object.hasOwn(filters, group)) throw new Error('Некорректный раздел.');
        if (!Number.isSafeInteger(offset || 0) || offset < 0 || !Number.isSafeInteger(limit || 50) || limit < 1 || limit > 1000) throw new Error('Некорректная страница.');
        return request('/rest/v1/events?select=*' + filters[group] + '&limit=' + (limit || 50) + '&offset=' + (offset || 0));
      },
      saveEvent: async function (input, existing, id) {
        var token = teacherToken();
        var model = root.SchoolEventsModel || (typeof require === 'function' ? require('./events-model.js') : null);
        var payload = model.validate(input);
        if (!existing && !model.uuid.test(id)) throw new Error('Некорректный идентификатор публикации.');
        if (!existing) payload.id = id;
        var result;
        try {
          result = await request('/rest/v1/events' + (existing ? selector(existing) : ''), { method: existing ? 'PATCH' : 'POST', body: payload }, token);
        } catch (error) {
          // Повтор после потери ответа не создаёт вторую публикацию и не затирает изменения.
          if (existing || error.status !== 409) throw error;
          result = await request('/rest/v1/events?id=eq.' + id + '&select=*');
          if (!Array.isArray(result) || result.length !== 1 || !Object.keys(payload).every(function (key) { return JSON.stringify(result[0][key]) === JSON.stringify(payload[key]); })) throw new Error('Публикация уже сохранена с другим содержимым. Обновите список и откройте её заново.');
        }
        if (!Array.isArray(result) || result.length !== 1 || !model.validItem(result[0])) throw new Error('Публикация уже изменена или удалена. Обновите список; текст остаётся в форме.');
        return result[0];
      },
      removeEvent: async function (item) {
        var result = await request('/rest/v1/events' + selector(item), { method: 'DELETE' }, teacherToken());
        if (!Array.isArray(result) || result.length !== 1) throw new Error('Публикация уже изменена или удалена. Обновите список.');
      },
      eventPhotoUrl: function (path) {
        return configured && typeof path === 'string' && photoPattern.test(path) ? url + '/storage/v1/object/public/event-photos/' + path : null;
      },
      uploadEventPhoto: async function (blob, path) {
        var token = teacherToken();
        if (!blob || blob.type !== 'image/jpeg' || !blob.size || blob.size > 5 * 1024 * 1024 || !photoPattern.test(path)) throw new Error('Фотография должна быть JPEG размером до 5 МБ.');
        try { await request('/storage/v1/object/event-photos/' + path, { method: 'POST', body: blob, raw: true }, token); }
        catch (error) {
          // Storage может вернуть 400 для Duplicate: принимаем только подтверждённое наличие того же UUID.
          if (error.status !== 400 && error.status !== 409) throw error;
          var found = await request('/storage/v1/object/list/event-photos', { method: 'POST', body: { prefix: '', search: path, limit: 2 } }, token);
          if (!Array.isArray(found) || !found.some(function (x) { return x.name === path; })) throw error;
        }
        return path;
      },
      removeEventPhotos: async function (paths) {
        if (!paths.length) return;
        if (!paths.every(function (p) { return photoPattern.test(p); })) throw new Error('Некорректное имя фотографии.');
        await request('/storage/v1/object/event-photos', { method: 'DELETE', body: { prefixes: paths } }, teacherToken());
      },
      onAuthChange: function (fn) { listeners.push(fn); },
      configured: configured,
      storageScope: url,
      isTeacher: function () { return !!session && session.expiresAt > Date.now(); },
      list: function (offset) {
        return request('/rest/v1/assignments?select=id,subject,body,due_date,version,updated_at,photo_paths' +
          '&order=due_date.desc,id.desc&limit=100&offset=' + (offset || 0));
      },
      photoUrl: function (path) {
        return configured && typeof path === 'string' && photoPattern.test(path)
          ? url + '/storage/v1/object/public/homework-photos/' + path : null;
      },
      uploadPhoto: async function (blob) {
        var token = teacherToken();
        if (!blob || blob.type !== 'image/jpeg' || !blob.size || blob.size > 5 * 1024 * 1024) {
          throw new Error('Фотография должна быть JPEG размером до 5 МБ.');
        }
        var path = root.crypto.randomUUID() + '.jpg';
        await request('/storage/v1/object/homework-photos/' + path,
          { method: 'POST', body: blob, raw: true }, token);
        return path;
      },
      removePhotos: async function (paths) {
        if (!paths.length) return;
        if (!paths.every(function (p) { return typeof p === 'string' && photoPattern.test(p); })) throw new Error('Некорректное имя фотографии.');
        await request('/storage/v1/object/homework-photos',
          { method: 'DELETE', body: { prefixes: paths } }, teacherToken());
      },
      login: async function (email, password) {
        clearSession();
        var result = await request('/auth/v1/token?grant_type=password', {
          method: 'POST', body: { email: email.trim(), password: password },
        });
        var allowed = await request('/rest/v1/rpc/is_class_teacher', { method: 'POST', body: {} }, result.access_token);
        if (allowed !== true) {
          await request('/auth/v1/logout', { method: 'POST' }, result.access_token).catch(function () {});
          throw new Error('Этот аккаунт не назначен учителем класса.');
        }
        session = { token: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 }; changed();
      },
      logout: async function () {
        var old = session;
        clearSession();
        if (old) await request('/auth/v1/logout', { method: 'POST' }, old.token);
      },
      save: async function (input, existing) {
        var token = teacherToken();
        var payload = validate(input);
        var result = await request('/rest/v1/assignments' + (existing ? selector(existing) : ''), {
          method: existing ? 'PATCH' : 'POST', body: payload,
        }, token);
        if (!Array.isArray(result) || result.length !== 1) {
          throw new Error('Задание уже изменено или удалено в другой вкладке. Обновите список и откройте его заново.');
        }
        return result[0];
      },
      remove: async function (existing) {
        var result = await request('/rest/v1/assignments' + selector(existing), { method: 'DELETE' }, teacherToken());
        if (!Array.isArray(result) || result.length !== 1) {
          throw new Error('Задание уже изменено или удалено. Обновите список.');
        }
      },
    };
  }

  var api = { createClient: createClient };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SchoolHomework = api;
})(typeof window === 'object' ? window : globalThis);
