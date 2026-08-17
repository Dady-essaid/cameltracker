// geofence.js — module partagé de géofencing PAR CHAMEAU
// Chaque chameau a : un centre (point d'attache / campement) + un rayon (km).
// Hors du rayon = hors zone (alerte). Réglable individuellement, à tout moment.
// Stockage local (localStorage) tant qu'il n'y a pas de backend ; se synchronisera
// plus tard avec les geofences Traccar (type CIRCLE).
const Geofence = (() => {
  const KEY = "ct_geofences";
  const DEFAULT_RADIUS_KM = 30;

  function all() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
  }
  function saveAll(obj) {
    localStorage.setItem(KEY, JSON.stringify(obj));
  }

  // Renvoie la geofence d'un chameau (ou null si aucune).
  function get(deviceId) {
    return all()[deviceId] || null;
  }

  // Crée/met à jour la geofence d'un chameau. Fusionne avec l'existant.
  function set(deviceId, gf) {
    const a = all();
    a[deviceId] = { ...(a[deviceId] || {}), ...gf };
    saveAll(a);
    return a[deviceId];
  }

  function remove(deviceId) {
    const a = all();
    delete a[deviceId];
    saveAll(a);
  }

  // Distance en km entre deux points (haversine).
  function distanceKm(aLat, aLon, bLat, bLon) {
    const R = 6371;
    const dLat = ((bLat - aLat) * Math.PI) / 180;
    const dLon = ((bLon - aLon) * Math.PI) / 180;
    const la1 = (aLat * Math.PI) / 180;
    const la2 = (bLat * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Statut d'un chameau vis-à-vis de sa zone.
  // Renvoie { state:'none'|'inside'|'outside', distanceKm, radiusKm, outside }
  function status(pos, gf) {
    if (!gf || !gf.enabled || gf.lat == null || gf.lon == null)
      return { state: "none", outside: false };
    const d = distanceKm(pos.latitude, pos.longitude, gf.lat, gf.lon);
    const outside = d > gf.radiusKm;
    return {
      state: outside ? "outside" : "inside",
      distanceKm: d,
      radiusKm: gf.radiusKm,
      outside,
    };
  }

  return { all, get, set, remove, distanceKm, status, DEFAULT_RADIUS_KM };
})();
