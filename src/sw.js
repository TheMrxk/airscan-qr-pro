// sw.js — AirScan-QR Pro Service Worker：离线缓存 + PWA 安装能力
// 纯本地工具，缓存所有静态资源；装好后即使无网络也能打开。
const CACHE = "airscan-qr-pro-v0.2.0";
const ASSETS = [
  "./",
  "./sender.html",
  "./receiver.html",
  "./manifest.webmanifest",
  "./vendor/qrcode.js",
  "./vendor/jsQR.min.js",
  "./js/protocol.js",
  "./js/compressor.js",
  "./js/packet.js",
  "./js/qr-encode.js",
  "./js/wire-codec.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// cache-first：所有同源资源优先读缓存（离线可用），未命中再走网络并回写。
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  e.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => cached)
    )
  );
});
