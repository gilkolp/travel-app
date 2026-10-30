/* sw.js — Service Worker: שמירת מעטפת האפליקציה לעבודה אופליין.
   נתוני API (מזג אוויר, מפות) תמיד נטענים מהרשת כשהיא זמינה. */
var CACHE_NAME = 'travel-app-shell-v3';
var SHELL = [
  './',
  'index.html',
  'style.css',
  'js/db.js',
  'js/api.js',
  'js/app.js',
  'manifest.webmanifest',
  'icon.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  // רק בקשות לאותו מקור עוברות דרך המטמון; API חיצוני — מהרשת בלבד.
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(function (cached) {
      var network = fetch(event.request).then(function (response) {
        if (response && response.ok && event.request.method === 'GET') {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        }
        return response;
      }).catch(function () { return cached; });
      return cached || network;
    })
  );
});
