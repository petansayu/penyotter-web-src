// Service Worker の元（ビルドのとき vite.config.ts の pwaServiceWorker が、版とファイルの一覧を入れて dist/sw.js にする）。
// 画面の部品（HTML・JavaScript・CSS・アイコン）だけを保存する。リレーとのやり取り（WebSocket）と、ほかのサイトの
// 画像・データは保存しない（ここを通さない）。

const VERSION = "__VERSION__";
const FILES = __FILES__;
const CACHE = `penyotter-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(["./", ...FILES.map((file) => `./${file}`)])).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("penyotter-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // ほかのサイト（画像・NIP-05・NIP-11 など）は保存しない
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    // 画面はネットから読み、つながらないときだけ保存分を出す（新しい版をすぐ使うため）
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("./", copy));
        }
        return response;
      }).catch(() => caches.match("./").then((cached) => cached ?? Response.error())),
    );
    return;
  }
  // JavaScript・CSS・アイコンは保存分を使う（ファイル名に版ごとの印が付くので、古いものとは混ざらない）
  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
