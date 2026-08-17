// trips.js — module des DÉPLACEMENTS (transhumance)
// Un déplacement = nom + GPS du berger (guideId, le tracker que porte le berger)
// + chameaux affectés + seuil (km) + cycle de vie (démarré / terminé).
// Tant qu'il est ACTIF, on alerte si un chameau s'éloigne du GPS du berger
// au-delà du seuil. Un déplacement actif prime sur le camp (voir Rules).
const Trips = (() => {
  const KEY = "ct_trips";
  const DEFAULT_THRESHOLD_KM = 3;
  let seq = 0;

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
  }
  function saveAll(list) { localStorage.setItem(KEY, JSON.stringify(list)); }

  function all() { return load(); }
  function get(id) { return load().find((t) => t.id === id) || null; }
  function newId() { return "trip_" + Date.now().toString(36) + "_" + seq++; }

  function isActive(t) { return !!(t && t.startedAt && !t.endedAt); }
  function active() { return load().filter(isActive); }

  function upsert(trip) {
    const list = load();
    const clean = {
      id: trip.id,
      name: trip.name,
      guideId: trip.guideId != null ? Number(trip.guideId) : null,
      members: (trip.members || []).map(Number),
      thresholdKm: trip.thresholdKm || DEFAULT_THRESHOLD_KM,
      startedAt: trip.startedAt || null,
      endedAt: trip.endedAt || null,
    };
    const i = list.findIndex((t) => t.id === trip.id);
    if (i >= 0) list[i] = clean; else list.push(clean);
    saveAll(list);
    return clean;
  }
  function remove(id) { saveAll(load().filter((t) => t.id !== id)); }

  function start(id) {
    const list = load();
    const t = list.find((x) => x.id === id);
    if (!t) return;
    t.startedAt = Date.now();
    t.endedAt = null;
    saveAll(list);
  }
  function end(id) {
    const list = load();
    const t = list.find((x) => x.id === id);
    if (!t) return;
    t.endedAt = Date.now();
    saveAll(list);
  }

  // Déplacement ACTIF auquel appartient un chameau (ou null).
  function activeTripOfDevice(deviceId) {
    const id = Number(deviceId);
    return active().find((t) => (t.members || []).map(Number).includes(id)) || null;
  }

  // Statut d'un chameau membre d'un déplacement actif : distance au GPS du berger.
  // Renvoie un statut { type:"trip", ... } ou null si pas concerné / non calculable.
  function statusFor(deviceId, positionsById) {
    const trip = activeTripOfDevice(deviceId);
    if (!trip) return null;
    const pos = positionsById[deviceId];
    const guide = positionsById[trip.guideId];
    const base = { type: "trip", tripId: trip.id, tripName: trip.name, guideId: trip.guideId };
    if (!pos || !guide) return { state: "none", outside: false, ...base };
    const d = Geofence.distanceKm(pos.latitude, pos.longitude, guide.latitude, guide.longitude);
    const outside = d > trip.thresholdKm;
    return { state: outside ? "outside" : "inside", outside, distanceKm: d, thresholdKm: trip.thresholdKm, ...base };
  }

  return { all, get, upsert, remove, start, end, isActive, active, activeTripOfDevice, statusFor, DEFAULT_THRESHOLD_KM };
})();
