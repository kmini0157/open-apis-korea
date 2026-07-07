// 서비스 워커 — 앱 셸은 캐시 우선, 데이터는 네트워크 우선(오프라인 시 캐시 폴백).
const CACHE = "open-apis-ko-v3";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./data/apis.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 외부(임베딩 모델 CDN, Puter 등)는 통과 — SW가 가로채지 않음
  if (url.origin !== self.location.origin) return;

  // 데이터(JSON)는 네트워크 우선 → 최신 상태 반영, 실패 시 캐시
  if (url.pathname.endsWith(".json")) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 앱 셸은 캐시 우선
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
