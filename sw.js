const CACHE = 'sherlog-rmj-v0.3.0';
const FILES = ['./', './index.html', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './ikona-vlak.png', './ikona-ceta.png', './users.json', './ikony/alert_image.svg', './ikony/ic_alert.svg', './ikony/ic_back_arrow.svg', './ikony/ic_bell.svg', './ikony/ic_bell_slash.svg', './ikony/ic_check.svg', './ikony/ic_cross.svg', './ikony/ic_disconnect.svg', './ikony/ic_download_all.svg', './ikony/ic_exit.svg', './ikony/ic_eye.svg', './ikony/ic_green_status.svg', './ikony/ic_log.svg', './ikony/ic_moon.svg', './ikony/ic_person.svg', './ikony/ic_red_status.svg', './ikony/ic_refresh.svg', './ikony/ic_settings.svg', './ikony/ic_sherlog_blue.png', './ikony/ic_sun.svg', './ikony/logo_sherlog.png', './ikony/sos_icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
// síť napřed (aby se aktualizace projevily hned), offline z cache
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
