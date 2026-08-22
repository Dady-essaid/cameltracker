// sw.js — service worker AUTO-DESTRUCTEUR.
// Le cache causait des mélanges anciens/nouveaux fichiers (modal cassé, liste
// de chameaux vide…). On supprime donc le SW : il vide tous les caches, se
// désinscrit, et recharge les pages ouvertes pour repartir 100 % à jour.
// Résultat : le site charge toujours la dernière version depuis le réseau.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      for (const c of clients) {
        try { c.navigate(c.url); } catch (_) {}
      }
    })()
  );
});
