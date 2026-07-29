/* ============================================================================
   Офлайн-режим приложения «3 «А» класс — расписание».

   ⚠️ При правке index.html / styles.css / app.js / data.js увеличьте
      CACHE_VERSION на единицу — и заодно ?v=N у файлов в index.html.
      Без этого у тех, кто поставил приложение на телефон, останется
      старая версия из кэша.
   ========================================================================== */

const CACHE_VERSION = 'v1';
const CACHE = 'sch3a-' + CACHE_VERSION;

const SHELL = [
  './',
  './index.html',
  './styles.css?v=1',
  './data.js?v=1',
  './app.js?v=1',
  './manifest.json',
  './fonts/nunito-cyrillic.woff2',
  './fonts/nunito-latin.woff2',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
];

/* Устанавливаем пофайлово, а не cache.addAll: один недокачанный файл
   не должен срывать установку целиком (иначе офлайна не будет вовсе). */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.all(
      SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null))
    )).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (e) {
    const hit = await cache.match(request);
    if (hit) return hit;
    const shell = await cache.match('./index.html');
    if (shell) return shell;
    throw e;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const fresh = await fetch(request);
  if (fresh && (fresh.ok || fresh.type === 'opaque')) cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Страница — сначала сеть: правку расписания видно сразу же.
  if (request.mode === 'navigate' ||
      (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Свои файлы версионированы через ?v=N — можно смело брать из кэша.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, CACHE).catch(() => caches.match(request)));
  }
});
