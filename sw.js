const CACHE = 'sherlog-rmj-v0.3.0';
const FILES = ['./', './index.html', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './ikona-vlak.png', './ikona-ceta.png', './users.json', './alert_image.svg', './ic_alert.svg', './ic_back_arrow.svg', './ic_bell.svg', './ic_bell_slash.svg', './ic_check.svg', './ic_cross.svg', './ic_disconnect.svg', './ic_download_all.svg', './ic_exit.svg', './ic_eye.svg', './ic_green_status.svg', './ic_log.svg', './ic_moon.svg', './ic_person.svg', './ic_red_status.svg', './ic_refresh.svg', './ic_settings.svg', './ic_sherlog_blue.png', './ic_sun.svg', './logo_sherlog.png', './sos_icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
// síť napřed (aby se aktualizace projevily hned), offline z cache
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
