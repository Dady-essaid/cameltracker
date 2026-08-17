// api.js — communication avec le serveur Traccar (API REST)
// Toutes les fonctions renvoient des promesses. En mode démo, on renvoie
// des données fictives pour pouvoir tester l'interface sans serveur.

const API = (() => {
  const cfg = window.CT_CONFIG || {};
  const base = () => (cfg.traccarUrl || "").replace(/\/+$/, "");

  // --- Appel HTTP générique vers Traccar (cookie de session) ---
  async function req(path, options = {}) {
    const res = await fetch(base() + path, {
      credentials: "include", // envoie le cookie de session Traccar
      headers: { Accept: "application/json", ...(options.headers || {}) },
      ...options,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} — ${txt || res.statusText}`);
    }
    return res.status === 204 ? null : res.json();
  }

  // --- Authentification : POST /api/session (form-encoded) ---
  async function login(email, password) {
    if (cfg.demo) return { name: "Démo", email };
    const body = new URLSearchParams({ email, password });
    return req("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  }

  // --- Liste des devices (chameaux) ---
  async function getDevices() {
    if (cfg.demo) return DEMO.devices();
    return req("/api/devices");
  }

  // --- Dernières positions de tous les devices ---
  async function getPositions() {
    if (cfg.demo) return DEMO.positions();
    return req("/api/positions");
  }

  // --- Historique d'un trajet (utilisé plus tard par la page historique) ---
  async function getRoute(deviceId, from, to) {
    if (cfg.demo) return DEMO.route(deviceId, from, to);
    const q = new URLSearchParams({ deviceId, from, to });
    return req(`/api/reports/route?${q}`, {
      headers: { Accept: "application/json" },
    });
  }

  return { login, getDevices, getPositions, getRoute, base };
})();

// --- Données de démonstration (mode démo) ---
const DEMO = (() => {
  // Trois chameaux fictifs autour de Nouakchott, avec une dérive aléatoire
  // à chaque appel pour simuler le mouvement.
  const state = [
    { id: 1, name: "Zarga", lat: 18.12, lon: -15.95, battery: 88, speed: 3.2 },
    { id: 2, name: "Hamra", lat: 18.02, lon: -16.02, battery: 64, speed: 0.0 },
    { id: 3, name: "Azrag", lat: 18.20, lon: -15.80, battery: 41, speed: 5.7 },
  ];

  function drift() {
    for (const c of state) {
      c.lat += (Math.sin(c.id * 9973 + c.lat * 100) % 1) * 0.004;
      c.lon += (Math.cos(c.id * 7919 + c.lon * 100) % 1) * 0.004;
      c.speed = Math.max(0, c.speed + ((c.id % 2 ? 1 : -1) * 0.5));
    }
  }

  function devices() {
    return state.map((c) => ({
      id: c.id,
      name: c.name,
      uniqueId: `86000000000000${c.id}`,
      status: c.battery > 10 ? "online" : "offline",
      lastUpdate: new Date().toISOString(),
    }));
  }

  function positions() {
    drift();
    return state.map((c) => ({
      id: 1000 + c.id,
      deviceId: c.id,
      latitude: c.lat,
      longitude: c.lon,
      speed: c.speed, // en nœuds côté Traccar
      course: 0,
      deviceTime: new Date().toISOString(),
      attributes: { batteryLevel: c.battery, distance: 0, motion: c.speed > 0 },
    }));
  }

  function route(deviceId, from, to) {
    // Petit trajet fictif : une boucle de points.
    const c = state.find((x) => x.id === Number(deviceId)) || state[0];
    const pts = [];
    for (let i = 0; i < 20; i++) {
      pts.push({
        deviceId: c.id,
        latitude: c.lat + Math.sin(i / 3) * 0.02,
        longitude: c.lon + Math.cos(i / 3) * 0.02,
        deviceTime: new Date(Date.now() - (20 - i) * 3600000).toISOString(),
        speed: Math.abs(Math.sin(i)) * 6,
        attributes: { batteryLevel: c.battery },
      });
    }
    return pts;
  }

  return { devices, positions, route };
})();
