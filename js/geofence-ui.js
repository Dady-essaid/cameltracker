// geofence-ui.js — page de gestion des zones par chameau (cercle OU forme libre)
(() => {
  const cfg = window.CT_CONFIG || {};
  const el = (id) => document.getElementById(id);

  let map;
  let circle = null; // cercle (mode cercle)
  let centerMarker = null; // campement déplaçable (mode cercle)
  let polyLayer = null; // polygone (mode forme libre)
  let vertexMarkers = []; // sommets déplaçables (mode forme libre)
  let camelMarker = null; // position actuelle du chameau
  let devices = [];
  let positions = {};
  let currentId = null;
  let draft = null; // { type, enabled, lat, lon, radiusKm, points:[] }

  // ---------- Démarrage ----------
  async function boot() {
    map = CTMap.create("map");
    await loadData();

    el("device").addEventListener("change", () => selectCamel(el("device").value));

    // Type de zone
    document.querySelectorAll(".gf-typeswitch .seg").forEach((b) =>
      b.addEventListener("click", () => setType(b.dataset.type))
    );

    // Cercle
    el("radius").addEventListener("input", () => {
      draft.radiusKm = +el("radius").value;
      refreshCircle();
    });
    document.querySelectorAll(".gf-presets .chip").forEach((c) =>
      c.addEventListener("click", () => {
        draft.radiusKm = +c.dataset.km;
        el("radius").value = draft.radiusKm;
        refreshCircle();
      })
    );
    el("centerBtn").addEventListener("click", centerOnCamel);

    // Polygone
    el("undoBtn").addEventListener("click", undoPoint);
    el("clearBtn").addEventListener("click", clearPolygon);
    map.on("click", onMapClick);

    // Commun
    el("enabled").addEventListener("change", () => {
      draft.enabled = el("enabled").checked;
      redraw();
    });
    el("saveBtn").addEventListener("click", save);

    if (devices.length) selectCamel(String(devices[0].id));
  }

  async function loadData() {
    try {
      devices = await API.getDevices();
      const pos = await API.getPositions();
      positions = {};
      pos.forEach((p) => (positions[p.deviceId] = p));
      const sel = el("device");
      sel.innerHTML = "";
      devices.forEach((d) => {
        const o = document.createElement("option");
        o.value = d.id;
        o.textContent = d.name;
        sel.appendChild(o);
      });
    } catch (e) {
      toast("Erreur : chargement des chameaux");
      console.error(e);
    }
  }

  // ---------- Sélection d'un chameau ----------
  function selectCamel(id) {
    currentId = String(id);
    const gf = Geofence.get(currentId);
    const pos = positions[currentId];
    const fallback = pos
      ? { lat: pos.latitude, lon: pos.longitude }
      : { lat: cfg.defaultCenter[0], lon: cfg.defaultCenter[1] };

    draft = {
      type: gf?.type === "polygon" ? "polygon" : "circle",
      enabled: gf?.enabled ?? true,
      lat: gf?.lat ?? fallback.lat,
      lon: gf?.lon ?? fallback.lon,
      radiusKm: gf?.radiusKm ?? Geofence.DEFAULT_RADIUS_KM,
      points: gf?.points ? gf.points.map((p) => [p[0], p[1]]) : [],
    };

    el("device").value = currentId;
    el("radius").value = draft.radiusKm;
    el("enabled").checked = draft.enabled;
    syncTypeUI();
    redraw(true);
  }

  // ---------- Type de zone ----------
  function setType(type) {
    if (draft.type === type) return;
    draft.type = type;
    syncTypeUI();
    redraw(true);
  }
  function syncTypeUI() {
    document.querySelectorAll(".gf-typeswitch .seg").forEach((b) =>
      b.classList.toggle("active", b.dataset.type === draft.type)
    );
    const isCircle = draft.type === "circle";
    el("circleCtrls").style.display = isCircle ? "" : "none";
    el("polyCtrls").style.display = isCircle ? "none" : "";
    el("centerBtn").style.display = isCircle ? "" : "none";
  }

  // ---------- Dessin selon le mode ----------
  function clearLayers() {
    [circle, centerMarker, polyLayer, camelMarker].forEach(
      (l) => l && map.removeLayer(l)
    );
    vertexMarkers.forEach((m) => map.removeLayer(m));
    circle = centerMarker = polyLayer = camelMarker = null;
    vertexMarkers = [];
  }

  function redraw(fit) {
    clearLayers();

    // Position actuelle du chameau (repère commun)
    const pos = positions[currentId];
    if (pos) {
      camelMarker = L.marker([pos.latitude, pos.longitude], { icon: camelIcon() })
        .addTo(map)
        .bindTooltip("Position actuelle", { direction: "top", offset: [0, -22] });
    }

    if (draft.type === "circle") drawCircle();
    else drawPolygon();

    if (fit) fitView();
    updateLabel();
    updateStatus();
  }

  // --- Mode cercle ---
  function drawCircle() {
    circle = L.circle([draft.lat, draft.lon], {
      radius: draft.radiusKm * 1000,
      ...zoneStyle(),
    }).addTo(map);
    centerMarker = L.marker([draft.lat, draft.lon], {
      draggable: true,
      icon: campIcon(),
      zIndexOffset: 1000,
    }).addTo(map);
    centerMarker.on("drag", (e) => {
      const ll = e.target.getLatLng();
      draft.lat = ll.lat;
      draft.lon = ll.lng;
      circle.setLatLng(ll);
      updateStatus();
    });
  }
  function refreshCircle() {
    if (circle) {
      circle.setLatLng([draft.lat, draft.lon]);
      circle.setRadius(draft.radiusKm * 1000);
      circle.setStyle(zoneStyle());
    }
    updateLabel();
    updateStatus();
  }
  function centerOnCamel() {
    const pos = positions[currentId];
    if (!pos) return toast("Position actuelle inconnue");
    draft.lat = pos.latitude;
    draft.lon = pos.longitude;
    if (centerMarker) centerMarker.setLatLng([draft.lat, draft.lon]);
    refreshCircle();
    fitView();
  }

  // --- Mode forme libre (polygone) ---
  function drawPolygon() {
    if (draft.points.length >= 2) {
      polyLayer = L.polygon(draft.points, zoneStyle()).addTo(map);
    } else if (draft.points.length === 1) {
      // un seul point : rien à tracer, juste le sommet
    }
    draft.points.forEach((p, i) => addVertexMarker(p, i));
    updatePolyCount();
  }
  function addVertexMarker(p, i) {
    const m = L.marker(p, { draggable: true, icon: vertexIcon() }).addTo(map);
    m.on("drag", (e) => {
      const ll = e.target.getLatLng();
      draft.points[i] = [ll.lat, ll.lng];
      if (polyLayer) polyLayer.setLatLngs(draft.points);
      updateStatus();
    });
    m.on("dblclick", (e) => {
      L.DomEvent.stop(e);
      removePoint(i);
    });
    vertexMarkers.push(m);
  }
  function onMapClick(e) {
    if (!draft || draft.type !== "polygon") return;
    draft.points.push([e.latlng.lat, e.latlng.lng]);
    redrawPolygonOnly();
  }
  function redrawPolygonOnly() {
    [polyLayer, ...vertexMarkers].forEach((l) => l && map.removeLayer(l));
    polyLayer = null;
    vertexMarkers = [];
    drawPolygon();
    updateStatus();
  }
  function undoPoint() {
    if (!draft.points.length) return;
    draft.points.pop();
    redrawPolygonOnly();
  }
  function removePoint(i) {
    draft.points.splice(i, 1);
    redrawPolygonOnly();
  }
  function clearPolygon() {
    draft.points = [];
    redrawPolygonOnly();
  }
  function updatePolyCount() {
    const n = draft.points.length;
    el("polyCount").textContent = n <= 1 ? `${n} point` : `${n} points`;
  }

  // ---------- Enregistrement ----------
  function save() {
    if (!currentId || !draft) return;
    if (draft.type === "polygon" && draft.points.length < 3) {
      return toast("Ajoute au moins 3 points pour la forme");
    }
    const payload =
      draft.type === "polygon"
        ? { type: "polygon", points: draft.points, enabled: draft.enabled }
        : {
            type: "circle",
            lat: draft.lat,
            lon: draft.lon,
            radiusKm: draft.radiusKm,
            enabled: draft.enabled,
          };
    Geofence.set(currentId, payload);
    const d = devices.find((x) => String(x.id) === currentId);
    const label =
      draft.type === "polygon" ? "forme libre" : `${draft.radiusKm} km`;
    toast(`Zone enregistrée pour ${d ? d.name : "ce chameau"} (${label})`);
  }

  // ---------- Statut / labels ----------
  function updateLabel() {
    el("radiusVal").textContent = draft.radiusKm;
    updatePolyCount();
  }
  function updateStatus() {
    const pos = positions[currentId];
    const box = el("gfStatus");
    if (!draft.enabled) {
      box.className = "gf-status none";
      box.textContent = "Alertes désactivées pour ce chameau";
      return;
    }
    if (!pos) {
      box.className = "gf-status none";
      box.textContent = "Position actuelle inconnue";
      return;
    }
    if (draft.type === "polygon") {
      if (draft.points.length < 3) {
        box.className = "gf-status none";
        box.textContent = "Dessine au moins 3 points pour délimiter la zone";
        return;
      }
      const inside = Geofence.pointInPolygon(pos.latitude, pos.longitude, draft.points);
      box.className = "gf-status " + (inside ? "inside" : "outside");
      box.textContent = inside ? "Dans la zone" : "HORS ZONE";
      return;
    }
    const d = Geofence.distanceKm(pos.latitude, pos.longitude, draft.lat, draft.lon);
    if (d > draft.radiusKm) {
      box.className = "gf-status outside";
      box.textContent = `HORS ZONE — à ${d.toFixed(1)} km du campement (limite ${draft.radiusKm} km)`;
    } else {
      box.className = "gf-status inside";
      box.textContent = `Dans la zone — à ${d.toFixed(1)} km du campement (limite ${draft.radiusKm} km)`;
    }
  }

  function fitView() {
    if (draft.type === "circle" && circle) {
      map.fitBounds(circle.getBounds().pad(0.2));
    } else if (draft.type === "polygon" && draft.points.length >= 2) {
      map.fitBounds(L.latLngBounds(draft.points).pad(0.3));
    } else {
      map.setView([draft.lat, draft.lon], cfg.defaultZoom || 8);
    }
  }

  // ---------- Styles / icônes ----------
  function zoneStyle() {
    const c = draft.enabled ? "#4f8a3d" : "#9a9a9a";
    return {
      color: c,
      weight: 2,
      opacity: 0.9,
      fillColor: c,
      fillOpacity: 0.08,
      dashArray: "6 6",
    };
  }
  function campIcon() {
    return L.divIcon({
      className: "",
      html: `<div style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:var(--sable-clair);border:2px solid var(--marron);border-radius:50%;box-shadow:var(--ombre);font-size:16px">🏕️</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
  }
  function vertexIcon() {
    return L.divIcon({
      className: "",
      html: `<div style="width:18px;height:18px;background:var(--marron);border:2px solid #fff;border-radius:50%;box-shadow:var(--ombre)"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
  }
  function camelIcon() {
    return L.divIcon({
      className: "",
      html: `<div class="camel-marker"><img src="img/camel.svg" alt=""></div>`,
      iconSize: [42, 42],
      iconAnchor: [21, 21],
    });
  }

  let toastTimer;
  function toast(msg) {
    const t = el("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
