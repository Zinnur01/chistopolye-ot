/* Админка «Охрана труда».
   Хранит данные в том же репозитории GitHub, что и сайт:
   - data/content.json — все тексты;
   - assets/uploads/ — загруженные фото, схемы, PDF и короткие видео.
   Вход по персональному ключу (fine-grained token) с правом Contents: Read and write. */
(function () {
  'use strict';
  var I = window.icon;
  var API = 'https://api.github.com';
  var root = document.getElementById('admin');

  var S = {
    auth: null,       // {token, owner, repo}
    branch: 'main',
    demo: false,
    content: null,
    sha: null,
    dirty: false,
    stack: [],        // история экранов
    form: null,       // редактируемая запись
    formDirty: false,
    preview: {},      // путь → локальная ссылка для мгновенного превью
  };

  /* ---------- утилиты ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function store(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null');
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { return null; }
  }
  var toastT;
  function toast(msg, err) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, err ? 6000 : 3000);
  }
  function busy(text) {
    var el = document.getElementById('busy');
    if (!text) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'busy'; el.className = 'busy'; document.body.appendChild(el); }
    el.innerHTML = '<div class="card"><div class="spinner" style="width:26px;height:26px;border-width:3px"></div>' + esc(text) + '</div>';
  }
  var TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'c', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  function slug(s) {
    return String(s || '').toLowerCase().split('').map(function (ch) { return TR[ch] != null ? TR[ch] : ch; }).join('')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item';
  }
  function uniqueId(title, list, self) {
    var base = slug(title), id = base, n = 2;
    while ((list || []).some(function (x) { return x !== self && x.id === id; })) id = base + '-' + n++;
    return id;
  }
  function siteBase() { return location.href.replace(/admin\/.*$/, ''); }
  function src(p) {
    if (!p) return '';
    if (S.preview[p]) return S.preview[p];
    if (/^(https?:|data:|blob:)/.test(p)) return p;
    return '../' + p;
  }
  function fmtTime(t) { var m = Math.floor(t / 60), s = t % 60; return m + ':' + (s < 10 ? '0' : '') + s; }

  /* ---------- GitHub API ---------- */
  function gh(path, opts) {
    opts = opts || {};
    return fetch(API + '/repos/' + S.auth.owner + '/' + S.auth.repo + path, {
      method: opts.method || 'GET',
      headers: { Authorization: 'Bearer ' + S.auth.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.message || ('Ошибка ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function b64text(str) {
    var bytes = new TextEncoder().encode(str);
    return b64bytes(bytes);
  }
  function b64bytes(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function unb64text(b64) {
    var bin = atob(b64.replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function errText(e) {
    if (e.status === 401) return 'Ключ не подходит или истёк. Войдите заново.';
    if (e.status === 403) return 'У ключа нет права на запись (Contents: Read and write).';
    if (e.status === 404) return 'Репозиторий не найден или ключ не даёт к нему доступ.';
    if (!navigator.onLine) return 'Нет интернета.';
    return e.message || 'Что-то пошло не так';
  }

  /* ---------- данные ---------- */
  function normalize(c) {
    c.org = c.org || {};
    ['numbers', 'categories', 'instructions', 'emergencies', 'schemes', 'contacts'].forEach(function (k) { c[k] = c[k] || []; });
    return c;
  }
  function loadContent() {
    if (S.demo) {
      return fetch('../data/content.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (c) {
        S.content = normalize(c); S.sha = 'demo';
      });
    }
    return gh('').then(function (repo) {
      if (!repo.permissions || !repo.permissions.push) { var e = new Error('no push'); e.status = 403; throw e; }
      S.branch = repo.default_branch || 'main';
      return gh('/contents/data/content.json?ref=' + encodeURIComponent(S.branch));
    }).then(function (f) {
      S.sha = f.sha;
      S.content = normalize(JSON.parse(unb64text(f.content)));
    });
  }
  function saveDraft() {
    store('ot-admin-draft', { content: S.content, sha: S.sha, demo: S.demo, at: Date.now() });
  }
  function markDirty() { S.dirty = true; saveDraft(); }

  function publish() {
    S.content.updatedAt = new Date().toISOString();
    var json = JSON.stringify(S.content, null, 2) + '\n';
    if (S.demo) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = 'content.json'; a.click();
      toast('Демо-режим: скачан файл content.json');
      return;
    }
    busy('Публикую…');
    function put(sha) {
      return gh('/contents/data/content.json', { method: 'PUT', body: { message: 'Обновление контента через админку', content: b64text(json), sha: sha, branch: S.branch } });
    }
    put(S.sha).catch(function (e) {
      // файл успели изменить в другом месте — берём свежий sha и сохраняем нашу версию
      if (e.status === 409 || e.status === 422) {
        return gh('/contents/data/content.json?ref=' + S.branch).then(function (f) { return put(f.sha); });
      }
      throw e;
    }).then(function (res) {
      S.sha = res.content.sha; S.dirty = false; store('ot-admin-draft', null);
      busy(); render();
      toast('Опубликовано! На сайте появится через 1–2 минуты');
    }).catch(function (e) { busy(); toast(errText(e), true); });
  }

  /* ---------- загрузка файлов ---------- */
  function readAsBytes(blob) {
    return new Promise(function (ok, fail) {
      var r = new FileReader();
      r.onload = function () { ok(new Uint8Array(r.result)); };
      r.onerror = fail; r.readAsArrayBuffer(blob);
    });
  }
  function readAsDataURL(blob) {
    return new Promise(function (ok, fail) {
      var r = new FileReader();
      r.onload = function () { ok(r.result); }; r.onerror = fail; r.readAsDataURL(blob);
    });
  }
  // Уменьшаем большие фото, чтобы сайт быстро открывался по мобильному интернету
  function shrinkImage(file, keepAlpha) {
    if (!/^image\/(jpeg|png|webp|heic|heif)/.test(file.type) || file.size < 350 * 1024) return Promise.resolve({ blob: file, ext: (file.name.split('.').pop() || 'jpg').toLowerCase() });
    return new Promise(function (ok) {
      var img = new Image();
      img.onload = function () {
        var max = 2000, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
        var cv = document.createElement('canvas');
        cv.width = Math.round(w * k); cv.height = Math.round(h * k);
        var ctx = cv.getContext('2d');
        if (!keepAlpha) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        var type = keepAlpha ? 'image/png' : 'image/jpeg';
        cv.toBlob(function (b) { ok({ blob: b || file, ext: keepAlpha ? 'png' : 'jpg' }); }, type, 0.85);
      };
      img.onerror = function () { ok({ blob: file, ext: 'jpg' }); };
      img.src = URL.createObjectURL(file);
    });
  }
  function upload(file, kind, keepAlpha) {
    var LIMIT = kind === 'video' ? 25 : 15;
    if (file.size > LIMIT * 1024 * 1024) {
      toast('Файл больше ' + LIMIT + ' МБ.' + (kind === 'video' ? ' Загрузите видео на RuTube или VK и вставьте ссылку.' : ''), true);
      return Promise.reject(new Error('big'));
    }
    var prep = kind === 'image' ? shrinkImage(file, keepAlpha) : Promise.resolve({ blob: file, ext: (file.name.split('.').pop() || 'bin').toLowerCase() });
    return prep.then(function (p) {
      var d = new Date();
      var name = 'assets/uploads/' + d.toISOString().slice(0, 10) + '-' + Math.random().toString(36).slice(2, 8) + '.' + p.ext.replace(/[^a-z0-9]/g, '');
      if (S.demo) {
        return readAsDataURL(p.blob).then(function (url) { toast('Демо-режим: файл не сохраняется на сайт'); return url; });
      }
      busy('Загружаю файл…');
      return readAsBytes(p.blob).then(function (bytes) {
        return gh('/contents/' + name, { method: 'PUT', body: { message: 'Загрузка файла через админку', content: b64bytes(bytes), branch: S.branch } });
      }).then(function () {
        S.preview[name] = URL.createObjectURL(p.blob);
        busy(); toast('Файл загружен');
        return name;
      });
    }).catch(function (e) { busy(); if (e.message !== 'big') toast(errText(e), true); throw e; });
  }

  /* ---------- описание разделов ---------- */
  function catOptions() { return S.content.categories.map(function (c) { return [c.id, c.title]; }); }
  var SECTIONS = {
    instructions: {
      title: 'Инструкции', one: 'инструкцию', icon: 'book', route: 'i',
      name: function (x) { return x.title; },
      sub: function (x) {
        var c = S.content.categories.filter(function (c) { return c.id === x.category; })[0];
        return (c ? c.title : 'Без раздела') + (x.video ? ' · видео' : '') + (x.quiz && x.quiz.length ? ' · тест' : '');
      },
      blank: function () { return { title: '', category: (S.content.categories[0] || {}).id || '', summary: '', video: '', chapters: [], ppe: [], must: [], forbidden: [], steps: [], doc: '', quiz: [] }; },
      groups: [
        ['Основное', [
          { k: 'title', label: 'Название', type: 'text', req: true, ph: 'Например: Работа на тракторе' },
          { k: 'category', label: 'Раздел', type: 'select', options: catOptions },
          { k: 'summary', label: 'Коротко о чём инструкция', type: 'textarea', rows: 2 },
        ]],
        ['Видео', [
          { k: 'video', label: 'Ссылка на видео', type: 'video' },
          { k: 'chapters', label: 'Тайм-коды (необязательно)', type: 'chapters' },
        ]],
        ['Главное за 30 секунд', [
          { k: 'ppe', label: 'Средства защиты', type: 'ppe' },
          { k: 'must', label: 'Обязательно', type: 'lines', help: 'Каждый пункт — с новой строки' },
          { k: 'forbidden', label: 'Запрещено', type: 'lines', help: 'Каждый пункт — с новой строки' },
          { k: 'steps', label: 'Порядок работы по шагам', type: 'lines', help: 'Каждый шаг — с новой строки. Нумерация появится сама' },
        ]],
        ['Дополнительно', [
          { k: 'doc', label: 'Полный текст инструкции (PDF)', type: 'file', accept: 'application/pdf,.pdf' },
          { k: 'quiz', label: 'Проверочные вопросы', type: 'quiz' },
        ]],
      ],
    },
    categories: {
      title: 'Разделы инструкций', one: 'раздел', icon: 'grid', route: 'cat',
      name: function (x) { return x.title; },
      sub: function (x) { var n = S.content.instructions.filter(function (i) { return i.category === x.id; }).length; return n + ' инстр.'; },
      blank: function () { return { title: '', icon: 'shield' }; },
      groups: [['', [
        { k: 'title', label: 'Название раздела', type: 'text', req: true, ph: 'Например: Механизаторы' },
        { k: 'icon', label: 'Значок', type: 'icon' },
      ]]],
    },
    emergencies: {
      title: 'Действия при ЧС', one: 'ситуацию', icon: 'alert', route: 'sos',
      name: function (x) { return x.title; },
      sub: function (x) { return (x.steps || []).length + ' шагов · звонить ' + (x.call || []).join(', '); },
      blank: function () { return { title: '', icon: 'alert', summary: '', call: ['112'], steps: [], dont: [] }; },
      groups: [['', [
        { k: 'title', label: 'Ситуация', type: 'text', req: true, ph: 'Например: Пожар' },
        { k: 'summary', label: 'Подпись', type: 'text', ph: 'Огонь, дым, запах гари' },
        { k: 'icon', label: 'Значок', type: 'icon' },
        { k: 'call', label: 'Куда звонить', type: 'lines', help: 'Номера, каждый с новой строки. Первые два появятся большими кнопками' },
        { k: 'steps', label: 'Что делать — по шагам', type: 'lines', help: 'Каждый шаг — с новой строки' },
        { k: 'dont', label: 'Чего делать нельзя', type: 'lines', help: 'Каждый пункт — с новой строки' },
      ]]],
    },
    schemes: {
      title: 'Схемы и планы', one: 'схему', icon: 'map', route: 'scheme',
      name: function (x) { return x.title; },
      sub: function (x) { return x.assembly ? 'Место сбора: ' + x.assembly : 'Без места сбора'; },
      blank: function () { return { title: '', image: '', description: '', assembly: '' }; },
      groups: [['', [
        { k: 'title', label: 'Название', type: 'text', req: true, ph: 'Например: Зерноток — план эвакуации' },
        { k: 'image', label: 'Схема (фото или картинка)', type: 'image', help: 'Можно просто сфотографировать план эвакуации на стене' },
        { k: 'assembly', label: 'Место сбора', type: 'text', ph: 'Площадка у проходной' },
        { k: 'description', label: 'Пояснение', type: 'textarea' },
      ]]],
    },
    contacts: {
      title: 'Ответственные лица', one: 'контакт', icon: 'users',
      name: function (x) { return x.name; },
      sub: function (x) { return x.role + ' · ' + x.phone; },
      blank: function () { return { name: '', role: '', phone: '', note: '' }; },
      groups: [['', [
        { k: 'name', label: 'ФИО или название', type: 'text', req: true },
        { k: 'role', label: 'Должность', type: 'text', ph: 'Специалист по охране труда' },
        { k: 'phone', label: 'Телефон', type: 'tel', req: true, ph: '+7 900 000-00-00' },
        { k: 'note', label: 'Примечание', type: 'text', ph: 'Пн–Пт, 8:00–17:00' },
      ]]],
    },
    numbers: {
      title: 'Экстренные номера', one: 'номер', icon: 'phone',
      name: function (x) { return x.phone + ' — ' + x.label; },
      sub: function (x) { return x.note || ''; },
      blank: function () { return { label: '', phone: '', note: '' }; },
      groups: [['', [
        { k: 'label', label: 'Служба', type: 'text', req: true },
        { k: 'phone', label: 'Номер', type: 'tel', req: true },
        { k: 'note', label: 'Примечание', type: 'text' },
      ]]],
      hint: 'Первый номер в списке — главный: он крупно показан на экране ЧС и на главной.',
    },
    org: {
      title: 'Оформление', icon: 'palette', single: true,
      groups: [['', [
        { k: 'name', label: 'Название организации', type: 'text', req: true },
        { k: 'shortName', label: 'Короткое название', type: 'text' },
        { k: 'subtitle', label: 'Заголовок на главной', type: 'text' },
        { k: 'logo', label: 'Эмблема', type: 'image', keepAlpha: true, help: 'Лучше PNG с прозрачным фоном' },
        { k: 'hero', label: 'Фоновая картинка на главной', type: 'image', help: 'Поле, техника, элеватор. Горизонтальное фото' },
        { k: 'notice', label: 'Объявление на главной', type: 'textarea', rows: 2, help: 'Оставьте пустым, чтобы скрыть' },
      ]]],
    },
  };

  /* ---------- поля формы ---------- */
  function fieldHtml(f, v) {
    var id = 'f_' + f.k;
    var head = '<span>' + esc(f.label) + (f.req ? ' <span class="req">*</span>' : '') + '</span>';
    var help = f.help ? '<span class="help">' + esc(f.help) + '</span>' : '';
    switch (f.type) {
      case 'text':
      case 'tel':
        return '<label class="f">' + head + '<input id="' + id + '" type="' + (f.type === 'tel' ? 'tel' : 'text') + '" data-f="' + f.k + '" value="' + esc(v) + '" placeholder="' + esc(f.ph || '') + '"' + (f.type === 'tel' ? ' inputmode="tel"' : '') + '>' + help + '</label>';
      case 'textarea':
        return '<label class="f">' + head + '<textarea data-f="' + f.k + '" rows="' + (f.rows || 3) + '">' + esc(v) + '</textarea>' + help + '</label>';
      case 'select':
        return '<label class="f">' + head + '<select data-f="' + f.k + '">' + f.options().map(function (o) {
          return '<option value="' + esc(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
        }).join('') + '</select>' + help + '</label>';
      case 'icon':
        return '<div class="f">' + head + '<div class="icon-pick">' + window.PICKABLE_ICONS.map(function (n) {
          return '<label title="' + n + '"><input type="radio" name="' + id + '" data-f="' + f.k + '" value="' + n + '"' + (n === v ? ' checked' : '') + '>' + I(n) + '</label>';
        }).join('') + '</div></div>';
      case 'lines':
        v = v || [];
        return '<label class="f">' + head + '<textarea data-f="' + f.k + '" data-type="lines" rows="' + Math.max(3, v.length + 1) + '">' + esc(v.join('\n')) + '</textarea>' + help + '</label>';
      case 'chapters':
        return '<label class="f">' + head + '<textarea data-f="' + f.k + '" data-type="chapters" rows="' + Math.max(3, (v || []).length + 1) + '" placeholder="0:00 Осмотр\n0:45 Запуск">' +
          esc((v || []).map(function (c) { return fmtTime(c.t) + ' ' + c.label; }).join('\n')) + '</textarea><span class="help">Время и название, каждое с новой строки. Под видео появятся кнопки для перехода к нужному моменту</span></label>';
      case 'quiz':
        return '<label class="f">' + head + '<textarea data-f="' + f.k + '" data-type="quiz" rows="' + Math.max(6, quizText(v).split('\n').length + 1) + '" placeholder="Можно ли перевозить людей на прицепе?\n- Да\n+ Нет, никогда\n\nСледующий вопрос…">' + esc(quizText(v)) + '</textarea>' +
          '<span class="help">Вопрос, под ним варианты. Правильный начинается с <b>+</b>, неправильные — с <b>-</b>. Между вопросами — пустая строка.</span>' +
          '<span class="help" id="quizInfo">' + quizInfo(v) + '</span></label>';
      case 'ppe':
        v = v || [];
        return '<div class="f">' + head + '<div class="chips">' + Object.keys(window.PPE).map(function (k) {
          var p = window.PPE[k];
          return '<label class="chip"><input type="checkbox" data-f="' + f.k + '" data-type="ppe" value="' + k + '"' + (v.indexOf(k) >= 0 ? ' checked' : '') + '>' + I(p[0]) + esc(p[1]) + '</label>';
        }).join('') + '</div></div>';
      case 'image':
        return '<div class="f">' + head + '<div class="upload"><div class="thumb" style="' + (v ? 'background-image:url(\'' + esc(src(v)) + '\')' : '') + '">' + (v ? '' : I('image')) + '</div>' +
          '<div class="meta">' + (v ? '<b>Загружено</b>' + esc(/^data:/.test(v) ? 'демо-файл' : v.split('/').pop()) : '<b>Нет картинки</b>JPG или PNG') + '</div></div>' +
          '<div class="upload-btns"><label class="mini-btn">' + I('upload') + (v ? 'Заменить' : 'Загрузить') + '<input type="file" accept="image/*" data-upload="' + f.k + '" data-kind="image"' + (f.keepAlpha ? ' data-alpha="1"' : '') + '></label>' +
          (v ? '<button class="mini-btn red" data-clear="' + f.k + '">' + I('trash') + 'Убрать</button>' : '') + '</div>' + help + '</div>';
      case 'file':
        return '<div class="f">' + head + '<div class="upload"><div class="thumb">' + I('file') + '</div><div class="meta">' + (v ? '<b>Файл загружен</b>' + esc(/^data:/.test(v) ? 'демо-файл' : v.split('/').pop()) : '<b>Нет файла</b>Можно сфотографировать и сохранить как PDF') + '</div></div>' +
          '<div class="upload-btns"><label class="mini-btn">' + I('upload') + (v ? 'Заменить' : 'Загрузить PDF') + '<input type="file" accept="' + esc(f.accept) + '" data-upload="' + f.k + '" data-kind="file"></label>' +
          (v ? '<button class="mini-btn red" data-clear="' + f.k + '">' + I('trash') + 'Убрать</button>' : '') + '</div>' + help + '</div>';
      case 'video':
        return '<div class="f">' + head + '<input type="url" data-f="' + f.k + '" value="' + esc(/^data:/.test(v) ? '' : v) + '" placeholder="https://rutube.ru/video/…" inputmode="url">' +
          '<span id="videoDetect">' + videoDetect(v) + '</span>' +
          '<span class="help">Лучше всего: загрузите ролик на <b>RuTube</b> или <b>VK Видео</b>, нажмите «Поделиться», скопируйте ссылку и вставьте сюда. Короткий ролик до 25 МБ можно загрузить прямо на сайт:</span>' +
          '<div class="upload-btns"><label class="mini-btn">' + I('video') + 'Загрузить видеофайл<input type="file" accept="video/mp4,video/webm,video/quicktime" data-upload="' + f.k + '" data-kind="video"></label>' +
          (v ? '<button class="mini-btn red" data-clear="' + f.k + '">' + I('trash') + 'Убрать видео</button>' : '') + '</div></div>';
    }
    return '';
  }
  function videoDetect(v) {
    v = String(v || '');
    if (!v) return '<span class="detect">Видео не добавлено — на сайте будет заглушка</span>';
    if (/^data:|^assets\/uploads\//.test(v)) return '<span class="detect ok">' + I('check') + 'Видеофайл загружен на сайт</span>';
    if (/rutube\.ru/.test(v)) return '<span class="detect ok">' + I('check') + 'RuTube — отлично</span>';
    if (/vk\.com|vkvideo\.ru|vk\.ru/.test(v)) return '<span class="detect ok">' + I('check') + 'VK Видео — отлично</span>';
    if (/youtu/.test(v)) return '<span class="detect warn">' + I('alert') + 'YouTube в России работает медленно, лучше RuTube или VK</span>';
    if (/<iframe/.test(v)) return '<span class="detect ok">' + I('check') + 'Код плеера распознан</span>';
    return '<span class="detect warn">' + I('alert') + 'Ссылка не распознана — на сайте будет кнопка «Смотреть видео»</span>';
  }
  function quizText(q) {
    return (q || []).map(function (x) {
      return x.q + '\n' + x.options.map(function (o, i) { return (i === x.answer ? '+ ' : '- ') + o; }).join('\n');
    }).join('\n\n');
  }
  function parseQuiz(txt) {
    return String(txt || '').split(/\n\s*\n/).map(function (block) {
      var lines = block.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      if (lines.length < 3) return null;
      var q = { q: lines[0], options: [], answer: 0 };
      lines.slice(1).forEach(function (l) {
        var m = l.match(/^([+\-–—*•])\s*(.*)$/);
        if (!m) { q.options.push(l); return; }
        if (m[1] === '+' || m[1] === '*') q.answer = q.options.length;
        q.options.push(m[2]);
      });
      return q.options.length >= 2 ? q : null;
    }).filter(Boolean);
  }
  function quizInfo(q) {
    var n = (q || []).length;
    return n ? '✓ Распознано вопросов: ' + n : '';
  }
  function parseChapters(txt) {
    return String(txt || '').split('\n').map(function (l) {
      var m = l.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})\s+(.+)$/);
      if (!m) return null;
      return { t: (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]), label: m[4].trim() };
    }).filter(Boolean);
  }

  /* ---------- экраны ---------- */
  function top(title, back) {
    return '<header class="topbar"><button class="icon-btn" data-act="back" aria-label="Назад">' + I('back') + '</button><div class="topbar-title">' + esc(title) + '</div>' +
      (back === false ? '' : '<a class="icon-btn" href="' + siteBase() + '" target="_blank" rel="noopener" aria-label="Открыть сайт">' + I('eye') + '</a>') + '</header>';
  }
  function publishBar() {
    if (!S.dirty) return '';
    return '<div class="publish-bar"><div class="txt"><span class="dot"></span>Есть неопубликованные изменения<small>' + (S.demo ? 'Демо-режим: будет скачан файл' : 'Сохранены на этом телефоне') + '</small></div>' +
      '<button class="btn" data-act="publish">' + I('upload') + 'Опубликовать</button></div>';
  }

  var SCREENS = {};

  SCREENS.login = function () {
    var guess = S.auth || detectRepo() || {};
    return '<div class="admin-hero"><span class="eyebrow">Админка</span><h1>Охрана труда</h1><p>Здесь можно добавлять и менять инструкции, видео, схемы и телефоны прямо с телефона.</p></div>' +
      '<div class="page">' +
      '<div class="card fieldset"><div class="form">' +
        '<label class="f"><span>Ключ доступа GitHub</span><input type="password" id="token" placeholder="github_pat_…" autocomplete="off" value="' + esc((S.auth && S.auth.token) || '') + '"><span class="help">Ключ хранится только на этом телефоне.</span></label>' +
        '<label class="f"><span>Репозиторий сайта</span><input type="text" id="repo" placeholder="имя-пользователя/название" value="' + esc(guess.owner ? guess.owner + '/' + guess.repo : '') + '" autocapitalize="off" autocorrect="off"></label>' +
        '<button class="btn" data-act="login">Войти</button>' +
      '</div></div>' +
      '<details class="card"><summary>' + I('info') + 'Как получить ключ (один раз, 3 минуты)</summary>' +
        '<ol class="steps-help">' +
          '<li>Откройте <a class="code" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a> и войдите в аккаунт, где лежит сайт.</li>' +
          '<li><b>Token name</b> — любое, например «админка охрана труда». <b>Expiration</b> — 1 год или «No expiration».</li>' +
          '<li><b>Repository access</b> → «Only select repositories» → выберите репозиторий сайта.</li>' +
          '<li><b>Permissions</b> → Repository permissions → <b>Contents</b> → «Read and write».</li>' +
          '<li>Нажмите <b>Generate token</b>, скопируйте ключ и вставьте его выше.</li>' +
        '</ol></details>' +
      '<button class="btn secondary" data-act="demo">' + I('eye') + 'Посмотреть в демо-режиме</button>' +
      '<a class="btn secondary" href="' + siteBase() + '">' + I('home') + 'Вернуться на сайт</a>' +
      '</div>';
  };

  SCREENS.home = function () {
    var c = S.content;
    var row = function (key) {
      var s = SECTIONS[key];
      var n = s.single ? '' : (c[key] || []).length;
      return '<button class="card section-card" data-act="open" data-sec="' + key + '"><div class="row-icon' + (key === 'emergencies' ? ' red' : key === 'schemes' || key === 'org' ? ' wheat' : '') + '">' + I(s.icon) + '</div>' +
        '<div class="row-body"><div class="row-title">' + esc(s.title) + '</div></div><span class="count">' + n + '</span>' + I('chevron') + '</button>';
    };
    return '<div class="admin-hero"><span class="eyebrow">Админка</span><h1>' + esc(c.org.shortName || 'Охрана труда') + '</h1><p>Что будем менять?</p>' +
      '<div class="status-line"><span class="tag">' + I(S.demo ? 'eye' : 'link') + (S.demo ? 'Демо-режим' : esc(S.auth.owner + '/' + S.auth.repo)) + '</span>' +
      (c.updatedAt ? '<span class="tag">' + I('clock') + 'Обновлено ' + new Date(c.updatedAt).toLocaleDateString('ru-RU') + '</span>' : '') + '</div></div>' +
      '<div class="page">' +
      '<section><div class="section-head"><h2>Содержимое</h2></div><div class="list">' + ['instructions', 'categories', 'emergencies', 'schemes'].map(row).join('') + '</div></section>' +
      '<section><div class="section-head"><h2>Телефоны</h2></div><div class="list">' + ['contacts', 'numbers'].map(row).join('') + '</div></section>' +
      '<section><div class="section-head"><h2>Прочее</h2></div><div class="list">' + row('org') +
        '<a class="card section-card" href="../qr.html" target="_blank" rel="noopener"><div class="row-icon">' + I('qr') + '</div><div class="row-body"><div class="row-title">QR-коды для печати</div><div class="row-sub">Общий и для каждой инструкции</div></div>' + I('external') + '</a>' +
        '<a class="card section-card" href="' + siteBase() + '" target="_blank" rel="noopener"><div class="row-icon">' + I('eye') + '</div><div class="row-body"><div class="row-title">Открыть сайт</div></div>' + I('external') + '</a>' +
        '<button class="card section-card" data-act="logout"><div class="row-icon red">' + I('logout') + '</div><div class="row-body"><div class="row-title">Выйти</div></div></button>' +
      '</div></section>' +
      '<p class="footer">Изменения появляются на сайте через 1–2 минуты после публикации</p>' +
      '</div>' + publishBar();
  };

  SCREENS.list = function (key) {
    var s = SECTIONS[key], items = S.content[key];
    var rows = items.map(function (x, i) {
      return '<div class="card a-row"><div class="row-body" data-act="edit" data-sec="' + key + '" data-i="' + i + '"><div class="row-title">' + esc(s.name(x) || 'Без названия') + '</div><div class="row-sub">' + esc(s.sub(x)) + '</div></div>' +
        '<button class="icon-btn" data-act="move" data-sec="' + key + '" data-i="' + i + '" data-d="-1" aria-label="Выше"' + (i === 0 ? ' disabled' : '') + '>' + I('up') + '</button>' +
        '<button class="icon-btn" data-act="move" data-sec="' + key + '" data-i="' + i + '" data-d="1" aria-label="Ниже"' + (i === items.length - 1 ? ' disabled' : '') + '>' + I('down') + '</button></div>';
    }).join('');
    return top(s.title) + '<div class="page-tight">' +
      (s.hint ? '<div class="notice">' + I('info') + '<span>' + esc(s.hint) + '</span></div>' : '') +
      '<button class="btn" data-act="new" data-sec="' + key + '">' + I('plus') + 'Добавить ' + esc(s.one) + '</button>' +
      '<div class="list">' + (rows || '<div class="empty">' + I(s.icon) + '<p>Пока пусто</p></div>') + '</div></div>' + publishBar();
  };

  SCREENS.edit = function (key, idx) {
    var s = SECTIONS[key], x = S.form, isNew = idx === 'new';
    var groups = s.groups.map(function (g) {
      return '<div class="card fieldset">' + (g[0] ? '<div class="fieldset-title">' + esc(g[0]) + '</div>' : '') + g[1].map(function (f) { return fieldHtml(f, x[f.k]); }).join('') + '</div>';
    }).join('');
    var link = '';
    if (!s.single && s.route && x.id) {
      link = '<div class="f"><span>Ссылка для QR-кода</span><div class="linkbox">' + I('link') + esc(siteBase() + '#/' + s.route + '/' + x.id) + '</div><span class="help">Ссылка не меняется при правках, поэтому распечатанные QR-коды продолжат работать</span></div>';
    }
    return top(s.single ? s.title : (isNew ? 'Новая запись' : 'Редактирование'), false) + '<div class="page"><div class="form">' + groups + link +
      '<button class="btn" data-act="save">' + I('check') + 'Готово</button>' +
      (!s.single && !isNew ? '<button class="btn secondary" style="color:var(--danger)" data-act="delete">' + I('trash') + 'Удалить</button>' : '') +
      '</div></div>';
  };

  /* ---------- навигация ---------- */
  function go(screen) { S.stack.push(screen); render(true); }
  function back() {
    var cur = S.stack[S.stack.length - 1];
    if (cur && cur[0] === 'edit' && S.formDirty && !confirm('Выйти без сохранения изменений?')) return;
    S.stack.pop(); S.form = null; S.formDirty = false;
    if (!S.stack.length) S.stack.push(['home']);
    render(true);
  }
  function render(scrollTop) {
    var cur = S.stack[S.stack.length - 1] || ['login'];
    var y = window.scrollY;
    root.innerHTML = SCREENS[cur[0]].apply(null, cur.slice(1));
    window.scrollTo(0, scrollTop ? 0 : y);
  }

  function detectRepo() {
    var h = location.hostname;
    if (!/\.github\.io$/.test(h)) return null;
    var owner = h.split('.')[0];
    var seg = location.pathname.split('/').filter(Boolean)[0];
    return { owner: owner, repo: seg && seg !== 'admin' ? seg : h };
  }

  function start() {
    busy('Загружаю данные…');
    loadContent().then(function () {
      busy();
      var d = store('ot-admin-draft');
      if (d && d.demo === S.demo && d.content) {
        if (d.sha === S.sha) { S.content = normalize(d.content); S.dirty = true; toast('Восстановлены неопубликованные изменения'); }
        else if (confirm('На телефоне есть неопубликованные изменения, но сайт уже обновили с другого устройства. Восстановить ваши изменения? (Отмена — удалить их)')) { S.content = normalize(d.content); S.dirty = true; }
        else store('ot-admin-draft', null);
      }
      S.stack = [['home']];
      render(true);
    }).catch(function (e) {
      busy();
      S.stack = [['login']]; render(true);
      toast(errText(e), true);
    });
  }

  /* ---------- события ---------- */
  root.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act],[data-clear]');
    if (!t) return;
    if (t.hasAttribute('data-clear')) {
      ev.preventDefault();
      S.form[t.getAttribute('data-clear')] = ''; S.formDirty = true; render();
      return;
    }
    var act = t.getAttribute('data-act'), key = t.getAttribute('data-sec'), i = +t.getAttribute('data-i');
    switch (act) {
      case 'back': return back();
      case 'login': {
        var token = document.getElementById('token').value.trim();
        var repo = document.getElementById('repo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '').split('/');
        if (!token || repo.length !== 2) return toast('Укажите ключ и репозиторий в виде имя/название', true);
        S.auth = { token: token, owner: repo[0], repo: repo[1] }; S.demo = false;
        store('ot-admin-auth', S.auth);
        return start();
      }
      case 'demo': S.demo = true; S.auth = null; return start();
      case 'logout':
        if (S.dirty && !confirm('Есть неопубликованные изменения. Всё равно выйти?')) return;
        store('ot-admin-auth', null); store('ot-admin-draft', null);
        S.auth = null; S.demo = false; S.dirty = false; S.stack = [['login']]; return render(true);
      case 'publish': return publish();
      case 'open':
        if (SECTIONS[key].single) { S.form = clone(S.content[key]); S.formDirty = false; return go(['edit', key, 0]); }
        return go(['list', key]);
      case 'new': S.form = SECTIONS[key].blank(); S.formDirty = false; return go(['edit', key, 'new']);
      case 'edit': S.form = clone(S.content[key][i]); S.formDirty = false; return go(['edit', key, i]);
      case 'move': {
        var arr = S.content[key], j = i + (+t.getAttribute('data-d'));
        if (j < 0 || j >= arr.length) return;
        var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        markDirty(); return render();
      }
      case 'save': return saveForm();
      case 'delete': {
        var cur = S.stack[S.stack.length - 1], k = cur[1], idx = cur[2], s = SECTIONS[k];
        var item = S.content[k][idx];
        var warn = '';
        if (k === 'categories') {
          var used = S.content.instructions.filter(function (x) { return x.category === item.id; }).length;
          if (used) warn = '\nВ разделе ' + used + ' инструкц. — они попадут в «Другое».';
        }
        if (!confirm('Удалить «' + (s.name(item) || 'запись') + '»?' + warn)) return;
        S.content[k].splice(idx, 1);
        markDirty(); S.formDirty = false; S.stack.pop(); render(true);
        return toast('Удалено. Не забудьте опубликовать');
      }
    }
  });

  function saveForm() {
    var cur = S.stack[S.stack.length - 1], key = cur[1], idx = cur[2], s = SECTIONS[key], x = S.form;
    var missing = [];
    s.groups.forEach(function (g) { g[1].forEach(function (f) { if (f.req && !String(x[f.k] || '').trim()) missing.push(f.label); }); });
    if (missing.length) return toast('Заполните: ' + missing.join(', '), true);
    if (s.single) S.content[key] = x;
    else {
      if (s.route || key === 'categories') {
        if (!x.id) x.id = uniqueId(x.title || x.name, S.content[key], null);
      }
      if (idx === 'new') S.content[key].push(x); else S.content[key][idx] = x;
    }
    markDirty(); S.form = null; S.formDirty = false; S.stack.pop();
    render(true);
    toast('Сохранено. Нажмите «Опубликовать», чтобы изменения появились на сайте');
  }

  function onField(ev) {
    var el = ev.target;
    if (!S.form) return;
    if (el.matches('input[type=file][data-upload]')) {
      var file = el.files && el.files[0];
      if (!file) return;
      var k = el.getAttribute('data-upload');
      upload(file, el.getAttribute('data-kind'), el.hasAttribute('data-alpha')).then(function (path) {
        S.form[k] = path; S.formDirty = true; render();
      }).catch(function () {});
      return;
    }
    var k2 = el.getAttribute('data-f');
    if (!k2) return;
    var type = el.getAttribute('data-type');
    if (type === 'lines') S.form[k2] = el.value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    else if (type === 'chapters') S.form[k2] = parseChapters(el.value);
    else if (type === 'quiz') { S.form[k2] = parseQuiz(el.value); var qi = document.getElementById('quizInfo'); if (qi) qi.textContent = quizInfo(S.form[k2]); }
    else if (type === 'ppe') S.form[k2] = Array.prototype.map.call(root.querySelectorAll('input[data-type=ppe]:checked'), function (c) { return c.value; });
    else S.form[k2] = el.value;
    if (k2 === 'video') document.getElementById('videoDetect').innerHTML = videoDetect(el.value);
    S.formDirty = true;
  }
  root.addEventListener('input', function (ev) { if (ev.target.type !== 'file') onField(ev); });
  root.addEventListener('change', function (ev) { if (ev.target.type === 'file' || ev.target.type === 'radio' || ev.target.type === 'checkbox' || ev.target.tagName === 'SELECT') onField(ev); });
  window.addEventListener('beforeunload', function (e) { if (S.formDirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- запуск ---------- */
  S.auth = store('ot-admin-auth');
  if (S.auth && S.auth.token) start();
  else { S.stack = [['login']]; render(true); }
})();
