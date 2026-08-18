// camels.js — profils des chameaux (nom, champs optionnels, notifications).
// Stocké par deviceId. Le nom saisi ici remplace le nom du tracker partout
// (via applyNames). Les préférences de notification permettent de couper les
// alertes d'un chameau, globalement ou par type/contexte.
const Camels = (() => {
  const KEY = "ct_camel_profiles";
  const DEFAULT_NOTIF = {
    global: true,   // interrupteur maître du chameau
    battery: true,  // batterie faible
    immobile: true, // immobilité prolongée
    camp: true,     // sortie du camp
    trip: true,     // éloignement du berger (déplacement)
    geofence: true, // sortie de sa géofence perso
  };

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  }
  function saveAll(o) { localStorage.setItem(KEY, JSON.stringify(o)); }

  // Profil complet (avec valeurs par défaut) d'un chameau.
  function get(id) {
    const p = load()[String(id)] || {};
    return {
      name: p.name || "",
      birthDate: p.birthDate || "",
      vaccinations: Array.isArray(p.vaccinations) ? p.vaccinations : [],
      notes: p.notes || "",
      geofence: p.geofence || null,
      notif: { ...DEFAULT_NOTIF, ...(p.notif || {}) },
    };
  }
  function set(id, patch) {
    const all = load();
    all[String(id)] = { ...(all[String(id)] || {}), ...patch };
    saveAll(all);
    return get(id);
  }

  // Nom d'affichage : le nom saisi s'il existe, sinon celui du tracker.
  function name(id, fallback) {
    const n = (load()[String(id)] || {}).name;
    return n && n.trim() ? n.trim() : fallback;
  }
  // Applique les noms personnalisés à une liste de devices (mute device.name).
  function applyNames(devices) {
    for (const d of devices || []) d.name = name(d.id, d.name);
    return devices;
  }

  // Une alerte de ce type doit-elle être envoyée pour ce chameau ?
  function notifEnabled(id, type) {
    const n = get(id).notif;
    if (!n.global) return false;
    return n[type] !== false;
  }

  return { get, set, name, applyNames, notifEnabled, DEFAULT_NOTIF };
})();
