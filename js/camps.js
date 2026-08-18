// camps.js — module des CAMPS (bases sédentaires)
// Un camp = nom + géofence (cercle ou polygone) + chameaux affectés.
// Un chameau appartient à AU PLUS un camp. Règle : rester dans la zone du camp.
// Le mode « en déplacement » est géré séparément par le module Trips.
const Camps = (() => {
  const KEY = "ct_camps";
  const MIGR_KEY = "ct_camps_migrated";
  let seq = 0;

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
  }
  function saveAll(list) { localStorage.setItem(KEY, JSON.stringify(list)); }

  function all() { return load(); }
  function get(id) { return load().find((c) => c.id === id) || null; }
  function newId() { return "camp_" + Date.now().toString(36) + "_" + seq++; }

  // Crée / met à jour un camp. Applique « un chameau = un seul camp ».
  function upsert(camp) {
    const list = load();
    const members = (camp.members || []).map(Number);
    const clean = { id: camp.id, name: camp.name, geofence: camp.geofence, members };
    const i = list.findIndex((c) => c.id === camp.id);
    if (i >= 0) list[i] = clean; else list.push(clean);
    for (const c of list) {
      if (c.id !== clean.id) c.members = (c.members || []).map(Number).filter((m) => !members.includes(m));
    }
    saveAll(list);
    return clean;
  }

  function remove(id) { saveAll(load().filter((c) => c.id !== id)); }

  function campOfDevice(deviceId) {
    const id = Number(deviceId);
    return load().find((c) => (c.members || []).map(Number).includes(id)) || null;
  }

  // Statut d'un chameau vis-à-vis de la zone de son camp (sédentaire).
  function statusFor(deviceId, positionsById) {
    const pos = positionsById[deviceId];
    const camp = campOfDevice(deviceId);
    if (!camp || !pos) return { state: "none", outside: false };
    const gf = { enabled: true, ...(camp.geofence || {}) };
    const st = Geofence.status(pos, gf);
    st.campId = camp.id;
    st.campName = camp.name;
    return st;
  }

  // Migration unique des anciennes géofences par-chameau -> camps individuels.
  function migrateFromGeofences(nameById) {
    if (localStorage.getItem(MIGR_KEY)) return;
    localStorage.setItem(MIGR_KEY, "1");
    if (load().length) return;
    const gfs = (typeof Geofence !== "undefined" && Geofence.all && Geofence.all()) || {};
    const list = [];
    for (const [deviceId, gf] of Object.entries(gfs)) {
      if (!gf) continue;
      const hasZone = gf.type === "polygon" ? gf.points && gf.points.length >= 3 : gf.lat != null;
      if (!hasZone) continue;
      const nm = (nameById && nameById[deviceId]) || "Chameau " + deviceId;
      list.push({
        id: newId(),
        name: "Campement de " + nm,
        geofence: gf.type === "polygon"
          ? { type: "polygon", points: gf.points }
          : { type: "circle", lat: gf.lat, lon: gf.lon, radiusKm: gf.radiusKm },
        members: [Number(deviceId)],
      });
    }
    if (list.length) saveAll(list);
  }

  return { all, get, upsert, remove, campOfDevice, statusFor, migrateFromGeofences };
})();
