// camps-ui.js — page de gestion des CAMPS
// Un camp = nom + mode (campement/déplacement) + géofence (mode campement) OU
// seuil de cohésion (mode déplacement) + chameaux affectés.
(() => {
  const cfg = window.CT_CONFIG || {};
  const el = (id) => document.getElementById(id);

  let map;
  let circle = null; // cercle (mode campement, type cercle)
  let centerMarker = null; // campement déplaçable
  let polyLayer = null; // polygone (mode campement, forme libre)
  let vertexMarkers = []; // sommets déplaçables
  let cohesionCircle = null; // aperçu de cohésion (mode déplacement)
  let camelMarkers = []; // positions de tous les chameaux (repères)
  let devices = [];
  let positions = {};
  let draft = null; // camp en cours d'édition

  // ---------- Démarrage ----------
  async function boot() {
    map = CTMap.create("map");
    await loadData();
    drawCamelContext();

    el("campSelect").addEventListener("change", () => selectCamp(el("campSelect").value));
    el("newCampBtn").addEventListener("click", () => selectCamp("__new__"));
    el("campName").addEventListener("input", () => (draft.name = el("campName").value));

    // Mode du camp
    document.querySelectorAll("#modeSwitch .seg").forEach((b) =>
      b.addEventListener("click", () => setMode(b.dataset.mode))
    );
    // Type de zone (mode campement)
    document.querySelectorAll("#campSection .gf-typeswitch .seg").forEach((b) =>
      b.addEventListener("click", () => setType(b.dataset.type))
    );

    // Cercle
    el("radius").addEventListener("input", () => {
      draft.geofence.radiusKm = +el("radius").value;
      refreshCircle();
    });
    document.querySelectorAll(".gf-presets .chip").forEach((c) =>
      c.addEventListener("click", () => {
        draft.geofence.radiusKm = +c.dataset.km;
        el("radius").value = draft.geofence.radiusKm;
        refreshCircle();
      })
    );
    el("centerBtn").addEventListener("click", centerOnHerd);

    // Polygone
    el("undoBtn").addEventListener("click", undoPoint);
    el("clearBtn").addEventListener("click", clearPolygon);
    map.on("click", onMapClick);

    // Cohésion (mode déplacement)
    el("cohesion").addEventListener("input", () => {
      draft.cohesionKm = +el("cohesion").value;
      el("cohesionVal").textContent = draft.cohesionKm;
      refreshCohesion();
      updateStatus();
    });

    el("saveBtn").addEventListener("click", save);
    el("deleteBtn").addEventListener("click", removeCamp);

    refreshCampSelect();
    const first = Camps.all()[0];
    selectCamp(first ? first.id : "__new__");
  }

  async function loadData() {
    try {
      devices = await API.getDevices();
      const pos = await API.getPositions();
      positions = {};
      pos.forEach((p) => (positions[p.deviceId] = p));
    } catch (e) {
      toast("Erreur : chargement des chameaux");
      console.error(e);
    }
  }

  // Repères : tous les chameaux sur la carte (contexte d'affectation).
  function drawCamelContext() {
    camelMarkers.forEach((m) => map.removeLayer(m));
    camelMarkers = [];
    for (const d of devices) {
      const p = positions[d.id];
      if (!p) continue;
      const m = L.marker([p.latitude, p.longitude], { icon: camelIcon() })
        .addTo(map)
        .bindTooltip(d.name, { permanent: true, direction: "top", offset: [0, -22], className: "camel-label" });
      camelMarkers.push(m);
    }
  }

  // ---------- Sélecteur de camps ----------
  function refreshCampSelect() {
    const sel = el("campSelect");
    sel.innerHTML = "";
    for (const c of Camps.all()) {
      const o = document.createElement("option");
      o.value = c.id;
      const n = (c.members || []).length;
      o.textContent = `${c.name} (${n} chameau${n > 1 ? "x" : ""})`;
      sel.appendChild(o);
    }
    const o = document.createElement("option");
    o.value = "__new__";
    o.textContent = "➕ Nouveau camp…";
    sel.appendChild(o);
  }

  // ---------- Sélection / création ----------
  function selectCamp(id) {
    let camp = id === "__new__" ? null : Camps.get(id);
    if (camp) {
      draft = {
        id: camp.id,
        name: camp.name,
        mode: camp.mode === "move" ? "move" : "camp",
        cohesionKm: camp.cohesionKm || Camps.DEFAULT_COHESION_KM,
        geofence: normalizeGeofence(camp.geofence),
        members: (camp.members || []).map(Number),
      };
    } else {
      const c = herdCenter();
      draft = {
        id: null,
        name: "Nouveau camp",
        mode: "camp",
        cohesionKm: Camps.DEFAULT_COHESION_KM,
        geofence: { type: "circle", lat: c.lat, lon: c.lon, radiusKm: 30, points: [] },
        members: [],
      };
    }

    el("campSelect").value = id;
    el("campName").value = draft.name;
    el("radius").value = draft.geofence.radiusKm;
    el("cohesion").value = draft.cohesionKm;
    el("cohesionVal").textContent = draft.cohesionKm;
    el("deleteBtn").style.visibility = draft.id ? "visible" : "hidden";
    syncModeUI();
    syncTypeUI();
    renderMembers();
    redraw(true);
  }

  function normalizeGeofence(gf) {
    gf = gf || {};
    const c = herdCenter();
    return {
      type: gf.type === "polygon" ? "polygon" : "circle",
      lat: gf.lat != null ? gf.lat : c.lat,
      lon: gf.lon != null ? gf.lon : c.lon,
      radiusKm: gf.radiusKm || 30,
      points: gf.points ? gf.points.map((p) => [p[0], p[1]]) : [],
    };
  }

  // Centre du troupeau (barycentre des chameaux affectés, sinon tous, sinon défaut).
  function herdCenter() {
    const ids = draft && draft.members && draft.members.length ? draft.members : devices.map((d) => d.id);
    const pts = ids.map((i) => positions[i]).filter(Boolean);
    if (!pts.length) return { lat: cfg.defaultCenter[0], lon: cfg.defaultCenter[1] };
    let lat = 0;
    let lon = 0;
    for (const p of pts) {
      lat += p.latitude;
      lon += p.longitude;
    }
    return { lat: lat / pts.length, lon: lon / pts.length };
  }

  // ---------- Mode (campement / déplacement) ----------
  function setMode(mode) {
    if (draft.mode === mode) return;
    draft.mode = mode;
    syncModeUI();
    redraw(true);
  }
  function syncModeUI() {
    document.querySelectorAll("#modeSwitch .seg").forEach((b) =>
      b.classList.toggle("active", b.dataset.mode === draft.mode)
    );
    const isCamp = draft.mode === "camp";
    el("campSection").style.display = isCamp ? "" : "none";
    el("moveSection").style.display = isCamp ? "none" : "";
  }

  // ---------- Type de zone (mode campement) ----------
  function setType(type) {
    if (draft.geofence.type === type) return;
    draft.geofence.type = type;
    syncTypeUI();
    redraw(true);
  }
  function syncTypeUI() {
    document.querySelectorAll("#campSection .gf-typeswitch .seg").forEach((b) =>
      b.classList.toggle("active", b.dataset.type === draft.geofence.type)
    );
    const isCircle = draft.geofence.type === "circle";
    el("circleCtrls").style.display = isCircle ? "" : "none";
    el("polyCtrls").style.display = isCircle ? "none" : "";
  }

  // ---------- Membres ----------
  function renderMembers() {
    const box = el("members");
    box.innerHTML = "";
    if (!devices.length) {
      box.innerHTML = '<div class="hint">Aucun chameau.</div>';
      return;
    }
    for (const d of devices) {
      const other = Camps.campOfDevice(d.id);
      const inThis = draft.members.includes(Number(d.id));
      const inOther = other && other.id !== draft.id;
      const row = document.createElement("label");
      row.className = "member";
      row.innerHTML = `
        <input type="checkbox" ${inThis ? "checked" : ""} value="${d.id}">
        <span class="m-name">${CTMap.escapeHtml(d.name)}</span>
        ${inOther ? `<span class="m-tag">${CTMap.escapeHtml(other.name)}</span>` : ""}`;
      row.querySelector("input").addEventListener("change", (e) => {
        const id = Number(d.id);
        if (e.target.checked) {
          if (!draft.members.includes(id)) draft.members.push(id);
        } else {
          draft.members = draft.members.filter((m) => m !== id);
        }
        redraw(false);
        updateStatus();
      });
      box.appendChild(row);
    }
  }

  // ---------- Dessin ----------
  function clearLayers() {
    [circle, centerMarker, polyLayer, cohesionCircle].forEach((l) => l && map.removeLayer(l));
    vertexMarkers.forEach((m) => map.removeLayer(m));
    circle = centerMarker = polyLayer = cohesionCircle = null;
    vertexMarkers = [];
  }

  function redraw(fit) {
    clearLayers();
    if (draft.mode === "move") {
      drawCohesion();
    } else if (draft.geofence.type === "circle") {
      drawCircle();
    } else {
      drawPolygon();
    }
    if (fit) fitView();
    updateLabel();
    updateStatus();
  }

  // --- Mode campement : cercle ---
  function drawCircle() {
    const g = draft.geofence;
    circle = L.circle([g.lat, g.lon], { radius: g.radiusKm * 1000, ...zoneStyle() }).addTo(map);
    centerMarker = L.marker([g.lat, g.lon], { draggable: true, icon: campIcon(), zIndexOffset: 1000 }).addTo(map);
    centerMarker.on("drag", (e) => {
      const ll = e.target.getLatLng();
      g.lat = ll.lat;
      g.lon = ll.lng;
      circle.setLatLng(ll);
      updateStatus();
    });
  }
  function refreshCircle() {
    const g = draft.geofence;
    if (circle) {
      circle.setLatLng([g.lat, g.lon]);
      circle.setRadius(g.radiusKm * 1000);
    }
    updateLabel();
    updateStatus();
  }
  function centerOnHerd() {
    const c = herdCenter();
    draft.geofence.lat = c.lat;
    draft.geofence.lon = c.lon;
    if (centerMarker) centerMarker.setLatLng([c.lat, c.lon]);
    refreshCircle();
    fitView();
  }

  // --- Mode campement : forme libre ---
  function drawPolygon() {
    const pts = draft.geofence.points;
    if (pts.length >= 2) polyLayer = L.polygon(pts, zoneStyle()).addTo(map);
    pts.forEach((p, i) => addVertexMarker(p, i));
    updatePolyCount();
  }
  function addVertexMarker(p, i) {
    const m = L.marker(p, { draggable: true, icon: vertexIcon() }).addTo(map);
    m.on("drag", (e) => {
      const ll = e.target.getLatLng();
      draft.geofence.points[i] = [ll.lat, ll.lng];
      if (polyLayer) polyLayer.setLatLngs(draft.geofence.points);
      updateStatus();
    });
    m.on("dblclick", (e) => {
      L.DomEvent.stop(e);
      draft.geofence.points.splice(i, 1);
      redrawPolygonOnly();
    });
    vertexMarkers.push(m);
  }
  function onMapClick(e) {
    if (!draft || draft.mode !== "camp" || draft.geofence.type !== "polygon") return;
    draft.geofence.points.push([e.latlng.lat, e.latlng.lng]);
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
    if (!draft.geofence.points.length) return;
    draft.geofence.points.pop();
    redrawPolygonOnly();
  }
  function clearPolygon() {
    draft.geofence.points = [];
    redrawPolygonOnly();
  }
  function updatePolyCount() {
    const n = draft.geofence.points.length;
    el("polyCount").textContent = n <= 1 ? `${n} point` : `${n} points`;
  }

  // --- Mode déplacement : aperçu de cohésion ---
  function drawCohesion() {
    const c = memberCentroid();
    if (!c) return;
    cohesionCircle = L.circle([c.lat, c.lon], {
      radius: draft.cohesionKm * 1000,
      color: "#3d6e8f",
      weight: 2,
      opacity: 0.9,
      fillColor: "#3d6e8f",
      fillOpacity: 0.08,
      dashArray: "6 6",
    }).addTo(map);
  }
  function refreshCohesion() {
    const c = memberCentroid();
    if (cohesionCircle && c) {
      cohesionCircle.setLatLng([c.lat, c.lon]);
      cohesionCircle.setRadius(draft.cohesionKm * 1000);
    } else {
      redraw(false);
    }
  }
  function memberCentroid() {
    const pts = draft.members.map((m) => positions[m]).filter(Boolean);
    if (pts.length < 1) return null;
    let lat = 0;
    let lon = 0;
    for (const p of pts) {
      lat += p.latitude;
      lon += p.longitude;
    }
    return { lat: lat / pts.length, lon: lon / pts.length, count: pts.length };
  }

  // ---------- Enregistrement ----------
  function save() {
    if (!draft) return;
    const name = (el("campName").value || "").trim();
    if (!name) return toast("Donne un nom au camp");
    draft.name = name;
    if (draft.mode === "camp" && draft.geofence.type === "polygon" && draft.geofence.points.length < 3) {
      return toast("Ajoute au moins 3 points pour la zone");
    }

    const geofence =
      draft.geofence.type === "polygon"
        ? { type: "polygon", points: draft.geofence.points }
        : { type: "circle", lat: draft.geofence.lat, lon: draft.geofence.lon, radiusKm: draft.geofence.radiusKm };

    const camp = {
      id: draft.id || "camp_" + Date.now().toString(36),
      name: draft.name,
      mode: draft.mode,
      cohesionKm: draft.cohesionKm,
      geofence,
      members: draft.members,
    };
    Camps.upsert(camp);
    draft.id = camp.id;
    refreshCampSelect();
    el("campSelect").value = camp.id;
    el("deleteBtn").style.visibility = "visible";
    renderMembers(); // rafraîchit les tags « appartient à un autre camp »
    toast(`Camp « ${camp.name} » enregistré`);
  }

  function removeCamp() {
    if (!draft || !draft.id) return;
    Camps.remove(draft.id);
    refreshCampSelect();
    toast("Camp supprimé");
    const first = Camps.all()[0];
    selectCamp(first ? first.id : "__new__");
  }

  // ---------- Statut / labels ----------
  function updateLabel() {
    el("radiusVal").textContent = draft.geofence.radiusKm;
    el("cohesionVal").textContent = draft.cohesionKm;
    updatePolyCount();
  }
  function updateStatus() {
    const box = el("gfStatus");
    const n = draft.members.length;
    if (!n) {
      box.className = "gf-status none";
      box.textContent = "Aucun chameau affecté à ce camp";
      return;
    }

    if (draft.mode === "move") {
      const c = memberCentroid();
      if (!c || c.count < 2) {
        box.className = "gf-status none";
        box.textContent = `${n} chameau${n > 1 ? "x" : ""} · ajoute-en au moins 2 pour la cohésion`;
        return;
      }
      let maxD = 0;
      for (const m of draft.members) {
        const p = positions[m];
        if (!p) continue;
        const d = Geofence.distanceKm(p.latitude, p.longitude, c.lat, c.lon);
        if (d > maxD) maxD = d;
      }
      const out = maxD > draft.cohesionKm;
      box.className = "gf-status " + (out ? "outside" : "inside");
      box.textContent = out
        ? `Un chameau s'éloigne — écart max ${maxD.toFixed(1)} km (seuil ${draft.cohesionKm} km)`
        : `Groupé — écart max ${maxD.toFixed(1)} km (seuil ${draft.cohesionKm} km)`;
      return;
    }

    // Mode campement : combien de membres hors zone ?
    const gf = { enabled: true, ...geofenceForCheck() };
    let out = 0;
    let known = 0;
    for (const m of draft.members) {
      const p = positions[m];
      if (!p) continue;
      known++;
      if (Geofence.status(p, gf).outside) out++;
    }
    if (!known) {
      box.className = "gf-status none";
      box.textContent = `${n} chameau${n > 1 ? "x" : ""} · position(s) inconnue(s)`;
    } else if (out) {
      box.className = "gf-status outside";
      box.textContent = `${out}/${known} chameau(x) HORS ZONE`;
    } else {
      box.className = "gf-status inside";
      box.textContent = `Tous dans la zone (${known} chameau${known > 1 ? "x" : ""})`;
    }
  }
  function geofenceForCheck() {
    return draft.geofence.type === "polygon"
      ? { type: "polygon", points: draft.geofence.points }
      : { type: "circle", lat: draft.geofence.lat, lon: draft.geofence.lon, radiusKm: draft.geofence.radiusKm };
  }

  function fitView() {
    if (draft.mode === "move") {
      if (cohesionCircle) map.fitBounds(cohesionCircle.getBounds().pad(0.3));
      else if (camelMarkers.length) map.fitBounds(L.featureGroup(camelMarkers).getBounds().pad(0.3));
      return;
    }
    if (draft.geofence.type === "circle" && circle) {
      map.fitBounds(circle.getBounds().pad(0.2));
    } else if (draft.geofence.type === "polygon" && draft.geofence.points.length >= 2) {
      map.fitBounds(L.latLngBounds(draft.geofence.points).pad(0.3));
    } else {
      map.setView([draft.geofence.lat, draft.geofence.lon], cfg.defaultZoom || 8);
    }
  }

  // ---------- Styles / icônes ----------
  function zoneStyle() {
    return { color: "#4f8a3d", weight: 2, opacity: 0.9, fillColor: "#4f8a3d", fillOpacity: 0.08, dashArray: "6 6" };
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
