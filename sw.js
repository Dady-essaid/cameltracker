// sw.js — service worker (tuiles hors ligne + app shell)
// Stratégie : réseau d'abord pour le code (mises à jour immédiates),
// cache d'abord pour les tuiles satellite (utile hors ligne / connexion lente).
const SHELL = "ct-shell-v10";
const TILES = "ct-tiles-v1";

const SHELL_FILES = [
  "./",
  "index.html",
  "camps.html",
  "css/style.css",
  "config.js",
  "js/api.js",
  "js/map.js",
  "js/app.js",
  "js/geofence.js",
  "js/camps.js",
  "js/camps-ui.js",
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

  // App shell (HTML/JS/CSS) : réseau d'abord, cache en secours (hors ligne).
  if (e.request.method === "GET") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(e.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  }
});
