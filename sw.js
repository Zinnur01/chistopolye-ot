// Service worker: сайт открывается даже без интернета (показывается последняя сохранённая версия).
var SHELL = 'ot-shell-v1';
var FILES = [
  './', 'index.html', 'assets/app.css', 'assets/app.js', 'assets/icons.js',
  'assets/img/logo.svg', 'assets/img/hero.svg', 'manifest.webmanifest'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('ot-shell') === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;           // видео, шрифты и API — напрямую
  if (url.pathname.indexOf('/admin') >= 0) return;      // админку не кэшируем
  if (url.pathname.endsWith('/data/content.json')) return; // контент кэширует сама страница

  // Сначала сеть (чтобы видеть свежие правки), при её отсутствии — кэш
  e.respondWith(
    fetch(req).then(function (res) {
      if (res.ok) {
        var copy = res.clone();
        caches.open(url.pathname.indexOf('/assets/uploads/') >= 0 ? 'ot-media' : SHELL).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); });
    })
  );
});
