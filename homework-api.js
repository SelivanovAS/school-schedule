/* Общие задания: Supabase Auth + REST. Права проверяются политиками базы данных. */
(function (root) {
  'use strict';

  function createClient(config, fetcher) {
    config = config || {};
    var url = (config.url || '').replace(/\/$/, '');
    var key = config.publishableKey || '';
    var configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) &&
      /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
    var session = null; // Только в памяти вкладки, без пароля и постоянного хранилища.
    fetcher = fetcher || root.fetch.bind(root);

    async function request(path, options, token) {
      if (!configured) throw new Error('Общие задания ещё не подключены.');
      options = options || {};
      var controller = new AbortController();
      var timeout = setTimeout(function () { controller.abort(); }, 15000);
      var headers = { apikey: key, 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      if (options.method && options.method !== 'GET') headers.Prefer = 'return=representation';
      try {
        var response = await fetcher(url + path, {
          method: options.method || 'GET', headers: headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          cache: 'no-store', credentials: 'omit', signal: controller.signal,
        });
        if (!response.ok) {
          var error = new Error(response.status === 401 || response.status === 403
            ? 'Вход не подтверждён или нет прав учителя. Войдите заново.'
            : response.status === 429 ? 'Слишком много попыток. Попробуйте немного позже.'
            : 'Не удалось выполнить запрос. Попробуйте ещё раз.');
          error.status = response.status;
          if (token && (response.status === 401 || response.status === 403)) session = null;
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
        session = null;
        throw new Error('Сеанс учителя завершён. Войдите заново; текст задания сохранён в форме.');
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
      return { subject: subject, body: body, due_date: due };
    }

    function selector(item) {
      if (!/^[0-9a-f-]{36}$/i.test(item.id) || !Number.isSafeInteger(item.version) || item.version < 1) {
        throw new Error('Некорректное задание. Обновите список.');
      }
      return '?id=eq.' + item.id + '&version=eq.' + item.version;
    }

    return {
      configured: configured,
      storageScope: url,
      isTeacher: function () { return !!session && session.expiresAt > Date.now(); },
      list: function (offset) {
        return request('/rest/v1/assignments?select=id,subject,body,due_date,version,updated_at' +
          '&order=due_date.desc,id.desc&limit=100&offset=' + (offset || 0));
      },
      login: async function (email, password) {
        session = null;
        var result = await request('/auth/v1/token?grant_type=password', {
          method: 'POST', body: { email: email.trim(), password: password },
        });
        var allowed = await request('/rest/v1/rpc/is_class_teacher', { method: 'POST', body: {} }, result.access_token);
        if (allowed !== true) {
          await request('/auth/v1/logout', { method: 'POST' }, result.access_token).catch(function () {});
          throw new Error('Этот аккаунт не назначен учителем класса.');
        }
        session = { token: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 };
      },
      logout: async function () {
        var old = session;
        session = null;
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
