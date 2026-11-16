// Service worker: האפליקציה נטענת גם בלי רשת (מעטפת + תוכן). נתוני ההתקדמות נשמרים במכשיר ומסתנכרנים כשהרשת חוזרת.
const C = 'bbh-v4';
const FILES = ['./', 'index.html', 'app.js', 'content.js', 'adapter.js', 'style.css', 'logo.svg', 'icon-192.png', 'icon-512.png', 'manifest.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/__/')) return;
  // רשת קודם (כדי לקבל עדכונים), ומטמון כשאין רשת
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
