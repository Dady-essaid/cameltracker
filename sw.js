// sw.js — service worker minimal (app shell + cache des tuiles satellite)
const SHELL = "ct-shell-v1";
const TILES = "ct-tiles-v1";

const SHELL_FILES = [
  "./",
  "index.html",
  "css/style.css",
  "config.js",
  "js/api.js",
  "js/map.js",
  "js/app.js",
  "img/camel.svg",
  "manifest.json",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== SHELL && k !== TILES).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = e.request.url;

  // Tuiles satellite : cache d'abord (utile hors ligne / connexion lente).
  if (url.includes("arcgisonline.com")) {
    e.respondWith(
      caches.open(TILES).then(async (cache) => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        try {
          const res = await fetch(e.request);
          cache.put(e.request, res.clone());
          return res;
        } catch {
          return hit || Response.error();
        }
      })
    );
    return;
  }

  // Ne pas mettre en cache les appels API (positions temps réel).
  if (url.includes("/api/")) return;

  // App shell : cache d'abord, réseau en secours.
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});
