// camps.js — module partagé des CAMPS (bases)
// Un camp possède : un nom, une géofence (cercle ou polygone), une liste de
// chameaux affectés, et un MODE :
//   - "camp" (au campement) : les chameaux doivent rester dans la géofence
//   - "move" (en déplacement) : la géofence est ignorée ; les chameaux doivent
//     rester groupés (cohésion) — alerte si l'un s'éloigne du barycentre du camp
// Règle unique : un chameau appartient à AU PLUS un camp, donc une seule règle
// de zone s'applique à lui (sortie de zone OU cohésion, jamais les deux).
// Réutilise la géométrie de Geofence (distance, point-dans-polygone, status).
const Camps = (() => {
  const KEY = "ct_camps";
  const MIGR_KEY = "ct_camps_migrated";
  const DEFAULT_COHESION_KM = 3;
  let seq = 0;

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || [];
    } catch {
      return [];
    }
  }
  function saveAll(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
  }

  function all() {
    return load();
  }
  function get(id) {
    return load().find((c) => c.id === id) || null;
  }
  function newId() {
    return "camp_" + Date.now().toString(36) + "_" + seq++;
  }

  // Crée / met à jour un camp. Applique la règle « un chameau = un seul camp » :
  // les membres de ce camp sont retirés de tous les autres.
  function upsert(camp) {
    const list = load();
    const members = (camp.members || []).map(Number);
    const clean = { ...camp, members };
    const i = list.findIndex((c) => c.id === camp.id);
    if (i >= 0) list[i] = clean;
    else list.push(clean);
    for (const c of list) {
      if (c.id !== clean.id) {
        c.members = (c.members || []).map(Number).filter((m) => !members.includes(m));
      }
    }
    saveAll(list);
    return clean;
  }

  function remove(id) {
    saveAll(load().filter((c) => c.id !== id));
  }

  // Camp auquel appartient un chameau (ou null).
  function campOfDevice(deviceId) {
    const id = Number(deviceId);
    return load().find((c) => (c.members || []).map(Number).includes(id)) || null;
  }

  // Barycentre des membres d'un camp dont on connaît la position.
  function centroid(camp, positionsById) {
    const pts = (camp.members || []).map((m) => positionsById[m]).filter(Boolean);
    if (!pts.length) return null;
    let lat = 0;
    let lon = 0;
    for (const p of pts) {
      lat += p.latitude;
      lon += p.longitude;
    }
    return { lat: lat / pts.length, lon: lon / pts.length, count: pts.length };
  }

  // Statut d'un chameau selon SON camp (la règle unique).
  // Renvoie un objet compatible avec Geofence.status() + { type, campId, campName }.
  //   type: "circle" | "polygon" (mode camp) | "cohesion" (mode move) | absent (none)
  function statusFor(deviceId, positionsById) {
    const pos = positionsById[deviceId];
    const camp = campOfDevice(deviceId);
    if (!camp || !pos) return { state: "none", outside: false };

    // Mode déplacement : cohésion autour du barycentre du groupe.
    if (camp.mode === "move") {
      const c = centroid(camp, positionsById);
      // Cohésion impossible avec moins de 2 chameaux localisés : pas d'alerte.
      if (!c || c.count < 2)
        return { state: "none", outside: false, type: "cohesion", campId: camp.id, campName: camp.name };
      const d = Geofence.distanceKm(pos.latitude, pos.longitude, c.lat, c.lon);
      const thr = camp.cohesionKm || DEFAULT_COHESION_KM;
      const outside = d > thr;
      return {
        state: outside ? "outside" : "inside",
        outside,
        type: "cohesion",
        distanceKm: d,
        thresholdKm: thr,
        campId: camp.id,
        campName: camp.name,
      };
    }

    // Mode campement : géofence du camp.
    const gf = { enabled: true, ...(camp.geofence || {}) };
    const st = Geofence.status(pos, gf);
    st.campId = camp.id;
    st.campName = camp.name;
    return st;
  }

  // Migration unique : convertit d'anciennes géofences par-chameau en camps
  // individuels (rien de perdu). nameById : { deviceId: nom } pour nommer.
  function migrateFromGeofences(nameById) {
    if (localStorage.getItem(MIGR_KEY)) return;
    localStorage.setItem(MIGR_KEY, "1");
    if (load().length) return; // déjà des camps : on ne touche à rien
    const gfs = (window.Geofence && Geofence.all && Geofence.all()) || {};
    const list = [];
    for (const [deviceId, gf] of Object.entries(gfs)) {
      if (!gf) continue;
      const hasZone =
        gf.type === "polygon" ? gf.points && gf.points.length >= 3 : gf.lat != null;
      if (!hasZone) continue;
      const nm = (nameById && nameById[deviceId]) || "Chameau " + deviceId;
      list.push({
        id: newId(),
        name: "Campement de " + nm,
        mode: "camp",
        cohesionKm: DEFAULT_COHESION_KM,
        geofence:
          gf.type === "polygon"
            ? { type: "polygon", points: gf.points }
            : { type: "circle", lat: gf.lat, lon: gf.lon, radiusKm: gf.radiusKm },
        members: [Number(deviceId)],
      });
    }
    if (list.length) saveAll(list);
  }

  return {
    all,
    get,
    upsert,
    remove,
    campOfDevice,
    centroid,
    statusFor,
    migrateFromGeofences,
    DEFAULT_COHESION_KM,
  };
})();
