// map.js — gestion de la carte Leaflet et des marqueurs chameaux
const CTMap = (() => {
  const cfg = window.CT_CONFIG || {};
  let map;
  const markers = {}; // deviceId -> L.marker
  const campLayers = {}; // campId -> [L.Layer] (zone du camp)

  const camelIcon = (stale, outside) =>
    L.divIcon({
      className: "",
      html: `<div class="camel-marker${stale ? " stale" : ""}${
        outside ? " out" : ""
      }">
               <img src="img/camel.svg" alt="chameau">
             </div>`,
      iconSize: [42, 42],
      iconAnchor: [21, 21],
      popupAnchor: [0, -22],
    });

  // Ajoute le fond satellite + labels sur une carte donnée (partagé entre pages).
  function addBaseLayers(m) {
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 18,
        attribution:
          "Tuiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics",
      }
    ).addTo(m);
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 18, opacity: 0.9 }
    ).addTo(m);
    return m;
  }

  // Crée une carte satellite prête à l'emploi dans l'élément donné.
  function create(elId, opts = {}) {
    const m = L.map(elId, {
      zoomControl: false,
      minZoom: cfg.minZoom || 6,
      maxBounds: cfg.bounds ? L.latLngBounds(cfg.bounds) : undefined,
      maxBoundsViscosity: 1.0, // "colle" la vue aux frontières de la Mauritanie
    }).setView(
      opts.center || cfg.defaultCenter || [16.5, -9.7],
      opts.zoom || cfg.defaultZoom || 8
    );
    L.control.zoom({ position: "topright" }).addTo(m);
    addBaseLayers(m);
    return m;
  }

  function init() {
    map = create("map");
    return map;
  }

  // Met à jour (ou crée) le marqueur d'un chameau.
  // opts.status : résultat de Geofence.status() (facultatif).
  function upsert(device, pos, opts = {}) {
    if (!pos) return;
    const stale = isStale(pos.deviceTime);
    const outside = !!(opts.status && opts.status.outside);
    const latlng = [pos.latitude, pos.longitude];
    let m = markers[device.id];
    if (!m) {
      m = L.marker(latlng, { icon: camelIcon(stale, outside) }).addTo(map);
      m.bindTooltip(device.name, {
        permanent: true,
        direction: "top",
        offset: [0, -22],
        className: "camel-label",
      });
      markers[device.id] = m;
      // Mode navigation : un clic déclenche opts.onClick au lieu d'ouvrir le popup.
      if (opts.onClick) m.on("click", () => opts.onClick(device.id));
    } else {
      m.setLatLng(latlng);
      m.setIcon(camelIcon(stale, outside));
    }
    if (!opts.onClick) {
      m.bindPopup(popupHtml(device, pos, opts.status), { className: "ct-popup-wrap" });
    }
    m._ctPos = pos;
  }

  // Dessine / met à jour les zones de TOUS les camps.
  // camps : liste Camps.all() ; statusByDevice : { deviceId: statut } pour
  // colorer en rouge un camp dont au moins un membre est hors règle.
  function renderCamps(camps, positionsById, statusByDevice) {
    const seen = new Set();
    for (const camp of camps || []) {
      seen.add(camp.id);
      const anyOut = (camp.members || []).some(
        (m) => statusByDevice[m] && statusByDevice[m].outside
      );
      drawCampZone(camp, positionsById, anyOut);
    }
    for (const id of Object.keys(campLayers)) {
      if (!seen.has(id)) removeCampLayer(id);
    }
  }
  function removeCampLayer(id) {
    (campLayers[id] || []).forEach((l) => map.removeLayer(l));
    delete campLayers[id];
  }
  function campCentroid(camp, positionsById) {
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
  function drawCampZone(camp, positionsById, anyOut) {
    removeCampLayer(camp.id);
    const move = camp.mode === "move";
    const color = anyOut ? "#b3492f" : move ? "#3d6e8f" : "#4f8a3d";
    const style = {
      color,
      weight: 2,
      opacity: 0.9,
      fillColor: color,
      fillOpacity: 0.07,
      dashArray: "6 6",
    };
    const layers = [];
    if (move) {
      // Cercle de cohésion autour du barycentre du groupe.
      const c = campCentroid(camp, positionsById);
      if (c && c.count >= 2) {
        layers.push(
          L.circle([c.lat, c.lon], { radius: (camp.cohesionKm || 3) * 1000, ...style }).addTo(map)
        );
      }
    } else {
      const gf = camp.geofence || {};
      if (gf.type === "polygon") {
        if (gf.points && gf.points.length >= 3) layers.push(L.polygon(gf.points, style).addTo(map));
      } else if (gf.lat != null) {
        layers.push(
          L.circle([gf.lat, gf.lon], { radius: (gf.radiusKm || 1) * 1000, ...style }).addTo(map)
        );
      }
    }
    if (layers.length) campLayers[camp.id] = layers;
  }

  function popupHtml(device, pos, st) {
    const bat = pos.attributes?.batteryLevel;
    const kmh = pos.speed != null ? (pos.speed * 1.852).toFixed(1) : "—";
    const low = bat != null && bat < 25;
    let zoneRow = "";
    if (st && st.state !== "none") {
      if (st.type === "cohesion") {
        const detail =
          st.distanceKm != null ? ` · ${st.distanceKm.toFixed(1)}/${st.thresholdKm} km` : "";
        zoneRow = st.outside
          ? `<div class="row"><b>Groupe</b><span class="bat low">S'ÉLOIGNE${detail}</span></div>`
          : `<div class="row"><b>Groupe</b><span style="color:#4f8a3d;font-weight:700">Avec le groupe${detail}</span></div>`;
      } else {
        const detail =
          st.distanceKm != null ? ` · ${st.distanceKm.toFixed(1)}/${st.radiusKm} km` : "";
        zoneRow = st.outside
          ? `<div class="row"><b>Zone</b><span class="bat low">HORS ZONE${detail}</span></div>`
          : `<div class="row"><b>Zone</b><span style="color:#4f8a3d;font-weight:700">Dans la zone${detail}</span></div>`;
      }
    }
    const campRow = st && st.campName
      ? `<div class="row"><b>Camp</b><span>${escapeHtml(st.campName)}</span></div>`
      : "";
    return `<div class="ct-popup">
      <h3>${escapeHtml(device.name)}</h3>
      ${campRow}
      <div class="row"><b>Vitesse</b><span>${kmh} km/h</span></div>
      <div class="row"><b>Batterie</b><span class="bat ${low ? "low" : ""}">${
      bat != null ? bat + " %" : "—"
    }</span></div>
      ${zoneRow}
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

  return { init, create, addBaseLayers, upsert, renderCamps, focus, fitAll, isStale, timeAgo, escapeHtml };
})();
