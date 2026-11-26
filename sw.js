/* 오프라인에서도 앱이 열리도록 파일을 보관합니다.
   인터넷이 되면 브라우저 임시저장을 거치지 않고 항상 깃허브의 최신 파일을 받아오므로,
   파일을 고쳐 올리면 다음 실행 때 바로 반영됩니다. settings.js, config.js 는 없을 수도 있어 하나씩 따로 보관합니다. */
const CACHE = "jasan-v13";
const FILES = ["./", "index.html", "app.js", "defaults.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "settings.js", "config.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(new Request(f, { cache: "no-cache" })).catch(() => {})))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // 구글 로그인·드라이브·시세는 건드리지 않음
  e.respondWith(fetch(e.request.url, { cache: "no-cache", credentials: "same-origin" }).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === "navigate" ? caches.match("index.html") : new Response("", { status: 404 })))));
});
