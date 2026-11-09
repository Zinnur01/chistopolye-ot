/* Охрана труда · Чистополье — клиентская часть сайта.
   Все данные берутся из data/content.json (его редактирует админка). */
(function () {
  'use strict';

  var C = null;                 // контент
  var view = document.getElementById('view');
  var topbar = document.getElementById('topbar');
  var tabbar = document.getElementById('tabbar');
  var I = window.icon;

  /* ---------- утилиты ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nl(s) { return esc(s).replace(/\n/g, '<br>'); }
  // Мягкие переносы в длинных русских словах: «Электробезо-пасность» вместо «Электробезопа/сность».
  // Перенос ставится после гласной перед слогом «согласная+гласная» (или перед гласной), минимум 3 буквы с каждой стороны.
  var VOW = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ';
  function hyWord(w) {
    var out = '', last = 0;
    for (var i = 3; i <= w.length - 3; i++) {
      var a = w[i - 1], b = w[i], c = w[i + 1];
      var after = VOW.indexOf(a) >= 0 && (VOW.indexOf(b) >= 0 || (VOW.indexOf(b) < 0 && 'ьъй'.indexOf(b) < 0 && VOW.indexOf(c) >= 0));
      var soft = 'ьъйЬЪЙ'.indexOf(a) >= 0;
      if ((after || soft) && i - last >= 2) { out += w.slice(last, i) + '­'; last = i; }
    }
    return out + w.slice(last);
  }
  function hy(s) { return esc(s).replace(/[А-Яа-яЁё]{10,}/g, hyWord); }
  function asset(p) { return p || ''; }
  function tel(p) { return 'tel:' + String(p || '').replace(/[^\d+]/g, ''); }
  function store(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null');
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { return null; }
  }
  function initials(name) {
    return String(name || '?').split(/\s+/).slice(0, 2).map(function (w) { return w[0] || ''; }).join('').toUpperCase();
  }
  function plural(n, a, b, c) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return n + ' ' + a;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return n + ' ' + b;
    return n + ' ' + c;
  }
  function fmtTime(t) {
    t = Math.max(0, Math.round(t || 0));
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    var ss = (s < 10 ? '0' : '') + s;
    return h ? h + ':' + (m < 10 ? '0' : '') + m + ':' + ss : m + ':' + ss;
  }
  function byId(list, id) { return (list || []).filter(function (x) { return x.id === id; })[0]; }
  function cat(id) { return byId(C.categories, id); }
  function passed(id) { return !!(store('ot-passed') || {})[id]; }

  /* ---------- видео ---------- */
  // Понимает ссылки RuTube, VK Видео, YouTube, код iframe и прямые файлы .mp4
  function videoInfo(url, start) {
    url = String(url || '').trim();
    if (!url) return null;
    start = start || 0;
    var m = url.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (m) url = m[1].replace(/&amp;/g, '&');
    if ((m = url.match(/rutube\.ru\/(?:video|play\/embed|shorts)\/(?:private\/)?([a-z0-9]{32})/i))) {
      var p = url.match(/[?&]p=([^&]+)/);
      return { kind: 'iframe', src: 'https://rutube.ru/play/embed/' + m[1] + '?' + (p ? 'p=' + p[1] + '&' : '') + (start ? 't=' + start + '&autoplay=1' : '') };
    }
    if ((m = url.match(/video_ext\.php\?(.+)/))) {
      return { kind: 'iframe', src: 'https://vk.com/video_ext.php?' + m[1].replace(/&t=[^&]*/, '') + (start ? '&t=' + start + 's&autoplay=1' : '') };
    }
    if ((m = url.match(/(?:vk\.com|vk\.ru|vkvideo\.ru)\/.*video(-?\d+)_(\d+)/))) {
      return { kind: 'iframe', src: 'https://vk.com/video_ext.php?oid=' + m[1] + '&id=' + m[2] + '&hd=2' + (start ? '&t=' + start + 's&autoplay=1' : '') };
    }
    if ((m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/))) {
      return { kind: 'iframe', src: 'https://www.youtube-nocookie.com/embed/' + m[1] + '?rel=0' + (start ? '&start=' + start + '&autoplay=1' : '') };
    }
    if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) return { kind: 'file', src: url };
    return { kind: 'link', src: url };
  }
  function videoHtml(ins) {
    var v = videoInfo(ins.video);
    if (!v) {
      return '<div class="video"><div class="video-empty" style="--hero-img:url(\'' + esc(asset(C.org.hero)) + '\')"><div>' +
        '<div class="play">' + I('play') + '</div><b>Видео скоро появится</b><small>Пока ознакомьтесь с главным ниже</small></div></div></div>';
    }
    if (v.kind === 'file') return '<div class="video"><video id="vid" src="' + esc(v.src) + '" controls playsinline preload="metadata"></video></div>';
    if (v.kind === 'iframe') return '<div class="video"><iframe id="vid" src="' + esc(v.src) + '" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen loading="lazy" title="Видео-инструкция"></iframe></div>';
    return '<a class="btn" href="' + esc(v.src) + '" target="_blank" rel="noopener">' + I('play') + 'Смотреть видео</a>';
  }
  function seek(ins, t) {
    var el = document.getElementById('vid');
    var v = videoInfo(ins.video, t);
    if (!el || !v) return;
    if (v.kind === 'file') { el.currentTime = t; el.play && el.play(); }
    else el.src = v.src;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---------- общие части интерфейса ---------- */
  function setTop(opts) {
    if (!opts) { topbar.hidden = true; return; }
    topbar.hidden = false;
    topbar.className = 'topbar' + (opts.danger ? ' danger' : '');
    document.getElementById('topTitle').textContent = opts.title || '';
    var logo = document.getElementById('topLogo');
    logo.src = asset(C.org.logo);
    logo.parentNode.style.display = opts.danger ? 'none' : '';
  }
  var TABS = [
    ['home', '#/', 'Главная'],
    ['book', '#/instructions', 'Инструкции'],
    ['sos', '#/sos', 'ЧС'],
    ['map', '#/schemes', 'Схемы'],
    ['phone', '#/contacts', 'Телефоны'],
  ];
  function renderTabs(active) {
    tabbar.innerHTML = TABS.map(function (t) {
      var on = active === t[1];
      if (t[0] === 'sos') {
        return '<a class="tab tab-sos' + (on ? ' active' : '') + '" href="#/sos" aria-label="Действия при ЧС"><span class="sos-btn">' + I('alert') + '</span><span>ЧС</span></a>';
      }
      return '<a class="tab' + (on ? ' active' : '') + '" href="' + t[1] + '"' + (on ? ' aria-current="page"' : '') + '>' + I(t[0]) + '<span>' + t[2] + '</span></a>';
    }).join('');
  }
  function insRow(x) {
    var c = cat(x.category);
    var tags = [];
    if (x.video) tags.push('<span class="tag">' + I('play') + 'Видео</span>');
    if (x.quiz && x.quiz.length) tags.push('<span class="tag wheat">' + I('award') + 'Тест</span>');
    if (passed(x.id)) tags.push('<span class="tag ok">' + I('check') + 'Ознакомлен</span>');
    return '<a class="row" href="#/i/' + esc(x.id) + '"><div class="row-icon">' + I(c ? c.icon : 'book') + '</div>' +
      '<div class="row-body"><div class="row-title">' + hy(x.title) + '</div>' +
      (x.summary ? '<div class="row-sub">' + esc(x.summary) + '</div>' : '') +
      (tags.length ? '<div class="row-tags">' + tags.join('') + '</div>' : '') + '</div>' + I('chevron') + '</a>';
  }
  function emgCard(e) {
    return '<a class="emg" href="#/sos/' + esc(e.id) + '"><div class="row-icon red">' + I(e.icon || 'alert') + '</div>' +
      '<div class="emg-title">' + hy(e.title) + '</div>' + (e.summary ? '<div class="emg-sub">' + esc(e.summary) + '</div>' : '') + '</a>';
  }
  function empty(text, ic) { return '<div class="empty">' + I(ic || 'info') + '<p>' + esc(text) + '</p></div>'; }
  function mainNumber() { return (C.numbers && C.numbers[0]) || { phone: '112', label: 'Единый номер экстренных служб' }; }

  /* ---------- экраны ---------- */
  var V = {};

  V.home = function () {
    setTop(null);
    var n = mainNumber();
    var cats = C.categories.map(function (c) {
      var cnt = C.instructions.filter(function (x) { return x.category === c.id; }).length;
      return '<a class="tile" href="#/cat/' + esc(c.id) + '"><div class="tile-icon">' + I(c.icon) + '</div>' +
        '<div class="tile-title">' + hy(c.title) + '</div><div class="tile-meta">' + plural(cnt, 'инструкция', 'инструкции', 'инструкций') + '</div></a>';
    }).join('');
    var contacts = (C.contacts || []).slice(0, 3).map(contactRow).join('');
    var schemes = (C.schemes || []).slice(0, 2).map(function (s) {
      return '<a class="row" href="#/scheme/' + esc(s.id) + '"><div class="row-icon wheat">' + I('map') + '</div><div class="row-body"><div class="row-title">' + esc(s.title) + '</div>' +
        (s.assembly ? '<div class="row-sub">Место сбора: ' + esc(s.assembly) + '</div>' : '') + '</div>' + I('chevron') + '</a>';
    }).join('');

    return '' +
      '<section class="hero" style="background-image:url(\'' + esc(asset(C.org.hero)) + '\')">' +
        '<div class="hero-brand"><img class="hero-logo" src="' + esc(asset(C.org.logo)) + '" alt="Эмблема"><div class="hero-org">' + esc(C.org.name) + '</div></div>' +
        '<h1>' + esc(C.org.subtitle || 'Охрана труда') + '</h1>' +
        '<p class="hero-sub">Видео-инструкции, правила безопасности и порядок действий при чрезвычайных ситуациях</p>' +
        '<div class="hero-badge">' + I('shield') + 'Работаем безопасно</div>' +
      '</section>' +
      '<div class="search-wrap"><form class="search" role="search" onsubmit="location.hash=\'#/search/\'+encodeURIComponent(this.q.value);return false">' +
        I('search') + '<input name="q" type="search" placeholder="Поиск: трактор, пожар, сварка…" autocomplete="off" aria-label="Поиск"></form></div>' +
      '<div class="page">' +
        (C.org.notice ? '<div class="notice">' + I('info') + '<span>' + esc(C.org.notice) + '</span></div>' : '') +
        '<section class="sos-card"><h2>' + I('alert') + 'Что-то случилось?</h2><p>Пожар, травма, удар током — пошаговые действия и звонок в одно касание</p>' +
          '<div class="sos-actions"><a class="btn-white" href="' + tel(n.phone) + '">' + I('phone') + 'Вызов ' + esc(n.phone) + '</a>' +
          '<a class="btn-ghost-white" href="#/sos">Что делать ' + I('chevron') + '</a></div></section>' +
        '<section><div class="section-head"><h2>Инструкции по участкам</h2><a href="#/instructions">Все</a></div><div class="tiles">' + cats + '</div></section>' +
        (schemes ? '<section><div class="section-head"><h2>Схемы эвакуации</h2><a href="#/schemes">Все</a></div><div class="list">' + schemes + '</div></section>' : '') +
        (contacts ? '<section><div class="section-head"><h2>Кому звонить</h2><a href="#/contacts">Все</a></div><div class="list">' + contacts + '</div></section>' : '') +
        '<div class="footer">' + esc(C.org.name) + (C.updatedAt ? '<br>Обновлено ' + new Date(C.updatedAt).toLocaleDateString('ru-RU') : '') +
          '<br><a href="admin/" style="text-decoration:underline;opacity:.8">Вход для ответственного</a></div>' +
      '</div>';
  };

  V.instructions = function () {
    setTop({ title: 'Инструкции' });
    var html = C.categories.map(function (c) {
      var items = C.instructions.filter(function (x) { return x.category === c.id; });
      if (!items.length) return '';
      return '<section><div class="section-head"><h2>' + esc(c.title) + '</h2></div><div class="list">' + items.map(insRow).join('') + '</div></section>';
    }).join('');
    var orphans = C.instructions.filter(function (x) { return !cat(x.category); });
    if (orphans.length) html += '<section><div class="section-head"><h2>Другое</h2></div><div class="list">' + orphans.map(insRow).join('') + '</div></section>';
    return '<div class="page">' + (html || empty('Инструкций пока нет', 'book')) + '</div>';
  };

  V.cat = function (id) {
    var c = cat(id);
    if (!c) return V.notFound();
    setTop({ title: c.title });
    var items = C.instructions.filter(function (x) { return x.category === id; });
    return '<div class="page-tight">' + (items.length ? '<div class="list">' + items.map(insRow).join('') + '</div>' : empty('В этом разделе пока нет инструкций', c.icon)) + '</div>';
  };

  V.ins = function (id) {
    var x = byId(C.instructions, id);
    if (!x) return V.notFound();
    var c = cat(x.category);
    setTop({ title: c ? c.title : 'Инструкция' });
    var parts = [];
    parts.push(videoHtml(x));
    if (x.video && x.chapters && x.chapters.length) {
      parts.push('<div class="chapters" aria-label="Перейти к моменту видео">' + x.chapters.map(function (ch, i) {
        return '<button class="chapter" data-seek="' + (ch.t || 0) + '"><b>' + fmtTime(ch.t) + '</b>' + esc(ch.label) + '</button>';
      }).join('') + '</div>');
    }
    if (x.ppe && x.ppe.length) {
      parts.push('<section class="card block key"><div class="block-head"><span class="badge">' + I('helmet') + '</span><h3>Средства защиты</h3></div><div class="ppe">' +
        x.ppe.map(function (k) { var p = window.PPE[k]; return p ? '<div class="ppe-item">' + I(p[0]) + p[1] + '</div>' : ''; }).join('') + '</div></section>');
    }
    if (x.must && x.must.length) {
      parts.push('<section class="card block must"><div class="block-head"><span class="badge">' + I('check') + '</span><h3>Обязательно</h3></div><ul class="checks">' +
        x.must.map(function (s) { return '<li>' + I('checkCircle') + '<span>' + esc(s) + '</span></li>'; }).join('') + '</ul></section>');
    }
    if (x.forbidden && x.forbidden.length) {
      parts.push('<section class="card block forbid"><div class="block-head"><span class="badge">' + I('ban') + '</span><h3>Запрещено</h3></div><ul class="checks">' +
        x.forbidden.map(function (s) { return '<li>' + I('ban') + '<span>' + esc(s) + '</span></li>'; }).join('') + '</ul></section>');
    }
    if (x.steps && x.steps.length) {
      parts.push('<section class="card block"><div class="block-head"><span class="badge">' + I('list') + '</span><h3>Порядок работы</h3></div><ol class="steps">' +
        x.steps.map(function (s) { return '<li><span>' + esc(s) + '</span></li>'; }).join('') + '</ol></section>');
    }
    if (x.doc) {
      parts.push('<a class="btn secondary" href="' + esc(asset(x.doc)) + '" target="_blank" rel="noopener">' + I('file') + 'Полный текст инструкции (PDF)</a>');
    }
    if (x.quiz && x.quiz.length) {
      var ok = passed(x.id);
      parts.push('<button class="quiz-cta' + (ok ? ' done' : '') + '" id="quizBtn"><div class="row-icon">' + I(ok ? 'check' : 'award') + '</div><div class="row-body" style="text-align:left">' +
        '<div class="row-title">' + (ok ? 'Вы прошли проверку' : 'Проверьте себя') + '</div><div class="row-sub" style="color:inherit;opacity:.85">' +
        (ok ? 'Можно пройти ещё раз' : plural(x.quiz.length, 'вопрос', 'вопроса', 'вопросов') + ' по этой инструкции') + '</div></div>' + I('chevron') + '</button>');
    }
    parts.push('<a class="row" href="#/sos"><div class="row-icon red">' + I('alert') + '</div><div class="row-body"><div class="row-title">Если случилась авария</div><div class="row-sub">Действия при ЧС и экстренные номера</div></div>' + I('chevron') + '</a>');

    return '<div class="ins-head"><span class="eyebrow">Инструкция по охране труда</span><h1>' + hy(x.title) + '</h1>' + (x.summary ? '<p>' + esc(x.summary) + '</p>' : '') + '</div>' +
      '<div class="page">' + parts.join('') + '</div>';
  };

  V.sos = function () {
    setTop({ title: 'Действия при ЧС', danger: true });
    var n = mainNumber();
    var rest = (C.numbers || []).slice(1);
    return '<section class="sos-hero"><h1>Сохраняйте спокойствие</h1><p>Выберите, что произошло, и действуйте по шагам</p>' +
      '<a class="call-main" href="' + tel(n.phone) + '"><div class="num">' + esc(n.phone) + '</div><div class="lbl">' + esc(n.label) + (n.note ? '<br><span style="font-weight:600;color:var(--muted)">' + esc(n.note) + '</span>' : '') + '</div><span class="go">' + I('phone') + '</span></a>' +
      (rest.length ? '<div class="call-grid">' + rest.map(function (r) {
        return '<a class="call-sm" href="' + tel(r.phone) + '"><b>' + esc(r.phone) + '</b><span>' + esc(r.label) + '</span></a>';
      }).join('') + '</div>' : '') + '</section>' +
      '<div class="page"><section><div class="section-head"><h2>Что случилось?</h2></div><div class="emg-grid">' + (C.emergencies || []).map(emgCard).join('') + '</div></section>' +
      ((C.schemes && C.schemes.length) ? '<a class="row" href="#/schemes"><div class="row-icon">' + I('exit') + '</div><div class="row-body"><div class="row-title">Схемы эвакуации</div><div class="row-sub">Выходы, огнетушители, место сбора</div></div>' + I('chevron') + '</a>' : '') +
      '<a class="row" href="#/contacts"><div class="row-icon wheat">' + I('users') + '</div><div class="row-body"><div class="row-title">Ответственные лица</div><div class="row-sub">Охрана труда, диспетчер, медпункт</div></div>' + I('chevron') + '</a>' +
      '</div>';
  };

  V.emg = function (id) {
    var e = byId(C.emergencies, id);
    if (!e) return V.notFound();
    setTop({ title: e.title, danger: true });
    var calls = (e.call && e.call.length ? e.call : [mainNumber().phone]).slice(0, 2);
    return '<div class="page">' +
      '<div style="display:flex;gap:14px;align-items:center"><div class="row-icon red" style="width:56px;height:56px">' + I(e.icon || 'alert') + '</div><div><span class="eyebrow">Действия при ЧС</span><h1 style="font-size:26px;font-weight:800">' + esc(e.title) + '</h1></div></div>' +
      '<ol class="big-steps">' + (e.steps || []).map(function (s) { return '<li><span>' + esc(s) + '</span></li>'; }).join('') + '</ol>' +
      (e.dont && e.dont.length ? '<section class="card block forbid"><div class="block-head"><span class="badge">' + I('ban') + '</span><h3>Нельзя</h3></div><ul class="checks">' +
        e.dont.map(function (s) { return '<li>' + I('ban') + '<span>' + esc(s) + '</span></li>'; }).join('') + '</ul></section>' : '') +
      ((C.schemes && C.schemes.length) ? '<a class="row" href="#/schemes"><div class="row-icon">' + I('exit') + '</div><div class="row-body"><div class="row-title">Куда идти</div><div class="row-sub">Схемы эвакуации и место сбора</div></div>' + I('chevron') + '</a>' : '') +
      '<div class="call-bar">' + calls.map(function (p, i) {
        return '<a class="btn ' + (i === 0 ? 'danger' : 'secondary') + '" href="' + tel(p) + '">' + I('phone') + 'Вызов ' + esc(p) + '</a>';
      }).join('') + '</div>' +
      '</div>';
  };

  V.schemes = function () {
    setTop({ title: 'Схемы и планы' });
    var list = (C.schemes || []).map(function (s) {
      return '<a class="card scheme-card" href="#/scheme/' + esc(s.id) + '"><div class="scheme-thumb"><img src="' + esc(asset(s.image)) + '" alt="" loading="lazy"></div>' +
        '<div class="scheme-body"><div class="row-title">' + esc(s.title) + '</div>' + (s.assembly ? '<div class="row-sub">Место сбора: ' + esc(s.assembly) + '</div>' : '') + '</div></a>';
    }).join('');
    return '<div class="page">' + (list || empty('Схемы пока не добавлены', 'map')) + '</div>';
  };

  V.scheme = function (id) {
    var s = byId(C.schemes, id);
    if (!s) return V.notFound();
    setTop({ title: s.title });
    return '<div class="page">' +
      '<div class="viewer" id="viewer"><img id="schemeImg" src="' + esc(asset(s.image)) + '" alt="' + esc(s.title) + '"></div>' +
      '<div class="viewer-tools"><button class="btn secondary" data-zoom="-1">' + I('zoomOut') + 'Меньше</button><button class="btn secondary" data-zoom="1">' + I('zoomIn') + 'Больше</button>' +
      '<a class="btn secondary" href="' + esc(asset(s.image)) + '" target="_blank" rel="noopener" aria-label="Открыть на весь экран">' + I('expand') + '</a></div>' +
      (s.assembly ? '<div class="assembly">' + I('pin') + '<div><b>Место сбора</b>' + esc(s.assembly) + '</div></div>' : '') +
      (s.description ? '<div class="card block"><p>' + nl(s.description) + '</p></div>' : '') +
      '</div>';
  };

  function contactRow(c) {
    return '<div class="card contact"><div class="avatar">' + esc(initials(c.name)) + '</div><div class="row-body"><div class="row-title">' + esc(c.name) + '</div>' +
      '<div class="row-sub">' + esc(c.role) + (c.note ? ' · ' + esc(c.note) : '') + '</div><div class="phone-num">' + esc(c.phone) + '</div></div>' +
      '<a class="call-btn" href="' + tel(c.phone) + '" aria-label="Позвонить: ' + esc(c.name) + '">' + I('phone') + '</a></div>';
  }

  V.contacts = function () {
    setTop({ title: 'Телефоны' });
    var nums = (C.numbers || []).map(function (n) {
      return '<div class="card contact"><div class="avatar" style="background:var(--danger-bg);color:var(--danger)">' + esc(n.phone) + '</div><div class="row-body"><div class="row-title">' + esc(n.label) + '</div>' +
        (n.note ? '<div class="row-sub">' + esc(n.note) + '</div>' : '') + '</div><a class="call-btn red" href="' + tel(n.phone) + '" aria-label="Позвонить ' + esc(n.phone) + '">' + I('phone') + '</a></div>';
    }).join('');
    return '<div class="page">' +
      '<section><div class="section-head"><h2>Экстренные службы</h2></div><div class="list">' + nums + '</div></section>' +
      '<section><div class="section-head"><h2>Ответственные на предприятии</h2></div><div class="list">' + ((C.contacts || []).map(contactRow).join('') || empty('Контакты пока не добавлены', 'users')) + '</div></section>' +
      '</div>';
  };

  V.search = function (q) {
    q = decodeURIComponent(q || '');
    setTop({ title: 'Поиск' });
    var ql = q.toLowerCase().trim();
    function hit(obj) { return ql && JSON.stringify(obj).toLowerCase().indexOf(ql) >= 0; }
    var ins = C.instructions.filter(hit), em = (C.emergencies || []).filter(hit), sc = (C.schemes || []).filter(hit), co = (C.contacts || []).filter(hit);
    var out = '';
    if (em.length) out += '<section><div class="section-head"><h2>Действия при ЧС</h2></div><div class="emg-grid">' + em.map(emgCard).join('') + '</div></section>';
    if (ins.length) out += '<section><div class="section-head"><h2>Инструкции</h2></div><div class="list">' + ins.map(insRow).join('') + '</div></section>';
    if (sc.length) out += '<section><div class="section-head"><h2>Схемы</h2></div><div class="list">' + sc.map(function (s) {
      return '<a class="row" href="#/scheme/' + esc(s.id) + '"><div class="row-icon wheat">' + I('map') + '</div><div class="row-body"><div class="row-title">' + esc(s.title) + '</div></div>' + I('chevron') + '</a>';
    }).join('') + '</div></section>';
    if (co.length) out += '<section><div class="section-head"><h2>Контакты</h2></div><div class="list">' + co.map(contactRow).join('') + '</div></section>';
    return '<div class="page"><form class="search" role="search" style="box-shadow:var(--shadow)" onsubmit="location.hash=\'#/search/\'+encodeURIComponent(this.q.value);return false">' + I('search') +
      '<input name="q" type="search" value="' + esc(q) + '" placeholder="Что вы ищете?" autocomplete="off" aria-label="Поиск" autofocus></form>' +
      (out || (ql ? empty('Ничего не нашлось по запросу «' + q + '»', 'search') : '')) + '</div>';
  };

  V.notFound = function () {
    setTop({ title: 'Не найдено' });
    return '<div class="page">' + empty('Такой страницы нет. Возможно, её удалили.', 'info') + '<a class="btn" href="#/">На главную</a></div>';
  };

  /* ---------- тест ---------- */
  function openQuiz(x) {
    var root = document.getElementById('sheet-root');
    var i = 0, score = 0, answered = false;
    function close() { root.innerHTML = ''; document.body.style.overflow = ''; render(); }
    function draw() {
      var q = x.quiz[i];
      var body;
      if (!q) {
        var good = score === x.quiz.length;
        if (good) { var p = store('ot-passed') || {}; p[x.id] = Date.now(); store('ot-passed', p); }
        body = '<div class="result"><div class="medal' + (good ? '' : ' bad') + '">' + I(good ? 'award' : 'info') + '</div>' +
          '<h3>' + (good ? 'Отлично!' : 'Почти получилось') + '</h3><p>Правильных ответов: ' + score + ' из ' + x.quiz.length + '</p>' +
          (good ? '<p>Отметка «Ознакомлен» сохранена на этом телефоне</p>' : '<p>Перечитайте инструкцию и попробуйте ещё раз</p>') + '</div>' +
          '<div style="display:grid;gap:10px;margin-top:18px">' + (good ? '' : '<button class="btn" data-q="again">Пройти ещё раз</button>') + '<button class="btn ' + (good ? '' : 'secondary') + '" data-q="close">Готово</button></div>';
      } else {
        body = '<div class="progress"><span style="width:' + (i / x.quiz.length * 100) + '%"></span></div>' +
          '<div class="eyebrow" style="margin-bottom:6px">Вопрос ' + (i + 1) + ' из ' + x.quiz.length + '</div>' +
          '<div class="q-title">' + esc(q.q) + '</div><div class="opts">' + q.options.map(function (o, k) {
            return '<button class="opt" data-opt="' + k + '"><span class="mark"></span><span>' + esc(o) + '</span></button>';
          }).join('') + '</div><div id="after"></div>';
      }
      root.innerHTML = '<div class="sheet-backdrop" data-q="close"><div class="sheet" role="dialog" aria-modal="true" aria-label="Проверка знаний">' +
        '<div class="sheet-grip"></div><div class="sheet-top"><b>' + esc(x.title) + '</b><button class="icon-btn" data-q="close" aria-label="Закрыть">' + I('x') + '</button></div>' + body + '</div></div>';
      answered = false;
    }
    root.onclick = function (ev) {
      var t = ev.target.closest('[data-q],[data-opt]');
      if (!t) return;
      if (t.classList.contains('sheet-backdrop') && ev.target !== t) return;
      var a = t.getAttribute('data-q');
      if (a === 'close') return close();
      if (a === 'again') { i = 0; score = 0; return draw(); }
      if (a === 'next') { i++; return draw(); }
      if (t.hasAttribute('data-opt') && !answered) {
        answered = true;
        var k = +t.getAttribute('data-opt'), q = x.quiz[i], right = k === q.answer;
        if (right) score++;
        root.querySelectorAll('.opt').forEach(function (b, j) {
          if (j === q.answer) { b.classList.add('right'); b.querySelector('.mark').innerHTML = I('check'); }
          else if (j === k) { b.classList.add('wrong'); b.querySelector('.mark').innerHTML = I('x'); }
        });
        document.getElementById('after').innerHTML = '<p class="explain" style="color:' + (right ? 'var(--ok)' : 'var(--danger)') + '">' + (right ? 'Верно!' : 'Неверно. Правильный ответ отмечен зелёным.') + '</p>' +
          '<button class="btn" data-q="next" style="margin-top:12px">' + (i + 1 < x.quiz.length ? 'Следующий вопрос' : 'Результат') + '</button>';
      }
    };
    document.body.style.overflow = 'hidden';
    draw();
  }

  /* ---------- маршрутизация ---------- */
  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var p = h.split('/');
    switch (p[0]) {
      case '': return ['home', '#/', V.home()];
      case 'instructions': return ['instructions', '#/instructions', V.instructions()];
      case 'cat': return ['cat', '#/instructions', V.cat(p[1])];
      case 'i': return ['ins', '#/instructions', V.ins(p[1])];
      case 'sos': return p[1] ? ['emg', '#/sos', V.emg(p[1])] : ['sos', '#/sos', V.sos()];
      case 'schemes': return ['schemes', '#/schemes', V.schemes()];
      case 'scheme': return ['scheme', '#/schemes', V.scheme(p[1])];
      case 'contacts': return ['contacts', '#/contacts', V.contacts()];
      case 'search': return ['search', '', V.search(p.slice(1).join('/'))];
      default: return ['nf', '', V.notFound()];
    }
  }
  var lastHash = null;
  function render() {
    if (!C) return;
    var r = route();
    view.innerHTML = r[2];
    renderTabs(r[1]);
    if (lastHash !== location.hash) { window.scrollTo(0, 0); lastHash = location.hash; }
    document.title = (r[0] === 'home' ? 'Охрана труда' : document.getElementById('topTitle').textContent) + ' · ' + (C.org.shortName || 'Чистополье');
  }

  document.getElementById('backBtn').innerHTML = I('back');
  // Если человек пришёл по QR сразу на инструкцию, «Назад» ведёт на главную, а не из сайта
  var navCount = 0;
  document.getElementById('backBtn').onclick = function () {
    if (navCount > 1) history.back();
    else location.hash = '#/';
  };

  view.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-seek],[data-zoom],#quizBtn');
    if (!t) return;
    var id = location.hash.split('/')[2];
    if (t.id === 'quizBtn') return openQuiz(byId(C.instructions, id));
    if (t.hasAttribute('data-seek')) return seek(byId(C.instructions, id), +t.getAttribute('data-seek'));
    if (t.hasAttribute('data-zoom')) {
      var img = document.getElementById('schemeImg');
      var w = parseInt(img.style.width || '100', 10) + (+t.getAttribute('data-zoom')) * 50;
      img.style.width = Math.min(400, Math.max(100, w)) + '%';
    }
  });
  window.addEventListener('hashchange', function () {
    navCount++;
    document.getElementById('sheet-root').innerHTML = '';
    document.body.style.overflow = '';
    render();
  });

  /* ---------- офлайн ---------- */
  var fromCache = false;
  function netStatus(ev) {
    var el = document.getElementById('offline');
    var off = ev && ev.type === 'offline' ? true : ev && ev.type === 'online' ? false : fromCache;
    el.hidden = !off;
    el.innerHTML = I('wifiOff') + 'Нет сети — показана сохранённая версия';
  }
  window.addEventListener('online', netStatus);
  window.addEventListener('offline', netStatus);

  /* ---------- загрузка ---------- */
  function load() {
    return fetch('data/content.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { store('ot-content', d); return d; })
      .catch(function () { fromCache = true; return store('ot-content'); });
  }
  load().then(function (d) {
    if (!d) { view.innerHTML = '<div class="page">' + empty('Не удалось загрузить данные. Проверьте интернет и обновите страницу.', 'wifiOff') + '</div>'; return; }
    C = d;
    C.categories = C.categories || []; C.instructions = C.instructions || [];
    navCount = 1;
    render();
    netStatus();
    // заранее сохраняем схемы и эмблему, чтобы они открывались без интернета
    if ('caches' in window) {
      var urls = [C.org.logo, C.org.hero].concat((C.schemes || []).map(function (s) { return s.image; })).filter(Boolean);
      caches.open('ot-media').then(function (cache) { urls.forEach(function (u) { cache.add(u).catch(function () {}); }); });
    }
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
