// map.js — gestion de la carte Leaflet et des marqueurs chameaux
const CTMap = (() => {
  const cfg = window.CT_CONFIG || {};
  let map;
  const markers = {}; // deviceId -> L.marker

  const camelIcon = (stale) =>
    L.divIcon({
      className: "",
      html: `<div class="camel-marker${stale ? " stale" : ""}">
               <img src="img/camel.svg" alt="chameau">
             </div>`,
      iconSize: [42, 42],
      iconAnchor: [21, 21],
      popupAnchor: [0, -22],
    });

  function init() {
    map = L.map("map", { zoomControl: false }).setView(
      cfg.defaultCenter || [18.07, -15.96],
      cfg.defaultZoom || 6
    );
    L.control.zoom({ position: "topright" }).addTo(map);

    // Fond satellite Esri World Imagery (gratuit).
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 18,
        attribution:
          "Tuiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics",
      }
    ).addTo(map);

    // Noms de lieux par-dessus le satellite (labels).
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 18, opacity: 0.9 }
    ).addTo(map);

    return map;
  }

  // Met à jour (ou crée) le marqueur d'un chameau.
  function upsert(device, pos) {
    if (!pos) return;
    const stale = isStale(pos.deviceTime);
    const latlng = [pos.latitude, pos.longitude];
    let m = markers[device.id];
    if (!m) {
      m = L.marker(latlng, { icon: camelIcon(stale) }).addTo(map);
      m.bindTooltip(device.name, {
        permanent: true,
        direction: "top",
        offset: [0, -22],
        className: "camel-label",
      });
      markers[device.id] = m;
    } else {
      m.setLatLng(latlng);
      m.setIcon(camelIcon(stale));
    }
    m.bindPopup(popupHtml(device, pos), { className: "ct-popup-wrap" });
    m._ctPos = pos;
  }

  function popupHtml(device, pos) {
    const bat = pos.attributes?.batteryLevel;
    const kmh = pos.speed != null ? (pos.speed * 1.852).toFixed(1) : "—";
    const low = bat != null && bat < 25;
    return `<div class="ct-popup">
      <h3>${escapeHtml(device.name)}</h3>
      <div class="row"><b>Vitesse</b><span>${kmh} km/h</span></div>
      <div class="row"><b>Batterie</b><span class="bat ${low ? "low" : ""}">${
      bat != null ? bat + " %" : "—"
    }</span></div>
      <div class="row"><b>Dernier signal</b><span>${timeAgo(pos.deviceTime)}</span></div>
      <div class="row"><b>Position</b><span>${pos.latitude.toFixed(
        4
      )}, ${pos.longitude.toFixed(4)}</span></div>
    </div>`;
  }

  function focus(deviceId) {
    const m = markers[deviceId];
    if (m) {
      map.setView(m.getLatLng(), Math.max(map.getZoom(), 13), {
        animate: true,
      });
      m.openPopup();
    }
  }

  function fitAll() {
    const ms = Object.values(markers);
    if (!ms.length) return;
    const group = L.featureGroup(ms);
    map.fitBounds(group.getBounds().pad(0.25));
  }

  // --- utilitaires ---
  function isStale(t) {
    return Date.now() - new Date(t).getTime() > 2 * 3600 * 1000; // > 2 h
  }
  function timeAgo(t) {
    const s = Math.floor((Date.now() - new Date(t).getTime()) / 1000);
    if (s < 60) return "à l'instant";
    if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
    return `il y a ${Math.floor(s / 86400)} j`;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  return { init, upsert, focus, fitAll, isStale, timeAgo, escapeHtml };
})();
