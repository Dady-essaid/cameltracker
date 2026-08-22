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
  const MAX_ZOOM = cfg.maxZoom || 21; // sur-zoom (tuiles natives jusqu'à 18)

  function addBaseLayers(m) {
    const gSub = ["0", "1", "2", "3"];
    // Google Hybride : satellite haute résolution + noms de lieux/routes.
    const gHybride = L.tileLayer("https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
      maxZoom: MAX_ZOOM,
      subdomains: gSub,
      attribution: "&copy; Google",
    });
    // Google Satellite pur (sans noms).
    const gSat = L.tileLayer("https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
      maxZoom: MAX_ZOOM,
      subdomains: gSub,
      attribution: "&copy; Google",
    });
    // Google Plan (routes / lieux).
    const gPlan = L.tileLayer("https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}", {
      maxZoom: MAX_ZOOM,
      subdomains: gSub,
      attribution: "&copy; Google",
    });
    // Secours : Esri (si Google est bloqué sur le réseau).
    const esri = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: MAX_ZOOM, maxNativeZoom: 18, attribution: "&copy; Esri" }
    );

    gHybride.addTo(m); // fond par défaut

    L.control
      .layers(
        {
          "🛰️ Satellite + noms": gHybride,
          "🛰️ Satellite": gSat,
          "🗺️ Plan": gPlan,
          "🌍 Esri (secours)": esri,
        },
        {},
        { position: "topright", collapsed: true }
      )
      .addTo(m);
    return m;
  }

  // Crée une carte satellite prête à l'emploi dans l'élément donné.
  function create(elId, opts = {}) {
    const m = L.map(elId, {
      zoomControl: false,
      minZoom: cfg.minZoom || 4,
      maxZoom: MAX_ZOOM,
      zoomSnap: 0.5, // zoom plus fin (paliers de 0,5)
      maxBounds: cfg.bounds ? L.latLngBounds(cfg.bounds) : undefined,
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

  // Dessine / met à jour les zones de TOUS les camps (sédentaires).
  // statusByDevice : { deviceId: statut } pour colorer en rouge un camp dont
  // au moins un membre est hors zone.
  function renderCamps(camps, positionsById, statusByDevice) {
    const seen = new Set();
    for (const camp of camps || []) {
      seen.add("camp:" + camp.id);
      const anyOut = (camp.members || []).some(
        (m) => statusByDevice[m] && statusByDevice[m].outside && statusByDevice[m].campId === camp.id
      );
      drawCampZone(camp, anyOut);
    }
    for (const id of Object.keys(campLayers)) {
      if (id.startsWith("camp:") && !seen.has(id)) removeCampLayer(id);
    }
  }
  function drawCampZone(camp, anyOut) {
    const key = "camp:" + camp.id;
    removeCampLayer(key);
    const color = anyOut ? "#b3492f" : "#4f8a3d";
    const style = { color, weight: 2, opacity: 0.9, fillColor: color, fillOpacity: 0.07, dashArray: "6 6" };
    const gf = camp.geofence || {};
    const layers = [];
    if (gf.type === "polygon") {
      if (gf.points && gf.points.length >= 3) layers.push(L.polygon(gf.points, style).addTo(map));
    } else if (gf.lat != null) {
      layers.push(L.circle([gf.lat, gf.lon], { radius: (gf.radiusKm || 1) * 1000, ...style }).addTo(map));
    }
    if (layers.length) campLayers[key] = layers;
  }

  // Dessine les DÉPLACEMENTS actifs : marqueur du berger + cercle de seuil autour.
  function renderTrips(trips, positionsById, statusByDevice) {
    const seen = new Set();
    for (const trip of trips || []) {
      const key = "trip:" + trip.id;
      seen.add(key);
      removeCampLayer(key);
      const guide = positionsById[trip.guideId];
      if (!guide) continue;
      const anyOut = (trip.members || []).some(
        (m) => statusByDevice[m] && statusByDevice[m].outside && statusByDevice[m].tripId === trip.id
      );
      const color = anyOut ? "#b3492f" : "#3d6e8f";
      const layers = [];
      layers.push(
        L.circle([guide.latitude, guide.longitude], {
          radius: (trip.thresholdKm || 3) * 1000,
          color, weight: 2, opacity: 0.9, fillColor: color, fillOpacity: 0.07, dashArray: "6 6",
        }).addTo(map)
      );
      layers.push(
        L.marker([guide.latitude, guide.longitude], { icon: guideIcon(), zIndexOffset: 900 })
          .addTo(map)
          .bindTooltip("Berger", { direction: "top", offset: [0, -18], className: "camel-label" })
      );
      campLayers[key] = layers;
    }
    for (const id of Object.keys(campLayers)) {
      if (id.startsWith("trip:") && !seen.has(id)) removeCampLayer(id);
    }
  }
  function guideIcon() {
    return L.divIcon({
      className: "",
      html: `<div style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;background:#3d6e8f;border:2px solid #fff;border-radius:50%;box-shadow:var(--ombre);font-size:15px">🧑🏽</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
  }
  function removeCampLayer(id) {
    (campLayers[id] || []).forEach((l) => map.removeLayer(l));
    delete campLayers[id];
  }

  function popupHtml(device, pos, st) {
    const bat = pos.attributes?.batteryLevel;
    const kmh = pos.speed != null ? (pos.speed * 1.852).toFixed(1) : "—";
    const low = bat != null && bat < 25;
    let zoneRow = "";
    if (st && st.state !== "none") {
      if (st.type === "trip") {
        const detail =
          st.distanceKm != null ? ` · ${st.distanceKm.toFixed(1)}/${st.thresholdKm} km` : "";
        zoneRow = st.outside
          ? `<div class="row"><b>Berger</b><span class="bat low">S'ÉLOIGNE${detail}</span></div>`
          : `<div class="row"><b>Berger</b><span style="color:#4f8a3d;font-weight:700">Avec le berger${detail}</span></div>`;
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

  function getMap() { return map; }

  return { init, create, getMap, addBaseLayers, upsert, renderCamps, renderTrips, focus, fitAll, isStale, timeAgo, escapeHtml };
})();
