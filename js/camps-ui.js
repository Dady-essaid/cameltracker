// camps-ui.js — page CAMPS : vue liste + vue édition (onglets), mode dessin plein écran
(() => {
  const cfg = window.CT_CONFIG || {};
  const el = (id) => document.getElementById(id);

  let map = null;
  let mapInited = false;
  let circle = null, centerMarker = null, polyLayer = null, cohesionCircle = null;
  let vertexMarkers = [], camelMarkers = [];
  let devices = [], positions = {};
  let draft = null;
  let drawing = false;

  // ---------- Démarrage ----------
  async function boot() {
    await loadData();

    el("createCampBtn").addEventListener("click", () => showEdit(null));
    el("headerBack").addEventListener("click", (e) => {
      if (!el("editView").hidden) {
        e.preventDefault();
        showList();
      }
    });

    el("campName").addEventListener("input", () => (draft.name = el("campName").value));
    document.querySelectorAll("#modeTabs .tab").forEach((b) =>
      b.addEventListener("click", () => setMode(b.dataset.mode))
    );
    document.querySelectorAll("#typeTabs .tab").forEach((b) =>
      b.addEventListener("click", () => setType(b.dataset.type))
    );

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

    el("cohesion").addEventListener("input", () => {
      draft.cohesionKm = +el("cohesion").value;
      el("cohesionVal").textContent = draft.cohesionKm;
      refreshCohesion();
      updateStatus();
    });

    // Mode dessin (forme libre)
    el("drawStart").addEventListener("click", enterDraw);
    el("drawDone").addEventListener("click", exitDraw);
    el("drawUndo").addEventListener("click", undoPoint);
    el("drawClear").addEventListener("click", clearPolygon);

    el("saveBtn").addEventListener("click", save);
    el("cancelBtn").addEventListener("click", showList);
    el("deleteBtn").addEventListener("click", removeCamp);

    showList();
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

  // ---------- Vue LISTE ----------
  function showList() {
    el("editView").hidden = true;
    el("listView").hidden = false;
    el("pageTitle").textContent = "Camps";
    el("headerBack").setAttribute("href", "index.html");
    renderCampCards();
  }

  function renderCampCards() {
    const box = el("campCards");
    const camps = Camps.all();
    if (!camps.length) {
      box.innerHTML = '<div class="camps-empty">Aucun camp pour l’instant.<br>Crée ton premier camp ci-dessous.</div>';
      return;
    }
    box.innerHTML = "";
    for (const c of camps) {
      const n = (c.members || []).length;
      const names = (c.members || [])
        .map((m) => (devices.find((d) => d.id === m) || {}).name)
        .filter(Boolean)
        .join(", ");
      const modeChip =
        c.mode === "move"
          ? '<span class="mode-chip move">🧭 En déplacement</span>'
          : '<span class="mode-chip camp">🏕️ Au campement</span>';
      const card = document.createElement("div");
      card.className = "camp-card";
      card.innerHTML = `
        <div class="cc-top">
          <div class="cc-name">${CTMap.escapeHtml(c.name)}</div>
          ${modeChip}
        </div>
        <div class="cc-sub">${n} chameau${n > 1 ? "x" : ""}${names ? " · " + CTMap.escapeHtml(names) : ""}</div>`;
      card.addEventListener("click", () => showEdit(c.id));
      box.appendChild(card);
    }
  }

  // ---------- Vue ÉDITION ----------
  function showEdit(id) {
    buildDraft(id);
    el("listView").hidden = true;
    el("editView").hidden = false;
    el("pageTitle").textContent = draft.id ? draft.name : "Nouveau camp";
    el("headerBack").setAttribute("href", "#");

    ensureMap();
    el("campName").value = draft.name;
    el("radius").value = draft.geofence.radiusKm;
    el("cohesion").value = draft.cohesionKm;
    el("cohesionVal").textContent = draft.cohesionKm;
    el("deleteBtn").style.display = draft.id ? "" : "none";
    syncModeUI();
    syncTypeUI();
    renderMembers();
    // La carte était masquée : recalculer sa taille puis dessiner.
    setTimeout(() => {
      if (map) map.invalidateSize();
      redraw(true);
    }, 60);
  }

  function buildDraft(id) {
    const camp = id ? Camps.get(id) : null;
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
      const c = herdCenter([]);
      draft = {
        id: null,
        name: "",
        mode: "camp",
        cohesionKm: Camps.DEFAULT_COHESION_KM,
        geofence: { type: "circle", lat: c.lat, lon: c.lon, radiusKm: 30, points: [] },
        members: [],
      };
    }
  }

  function normalizeGeofence(gf) {
    gf = gf || {};
    const c = herdCenter([]);
    return {
      type: gf.type === "polygon" ? "polygon" : "circle",
      lat: gf.lat != null ? gf.lat : c.lat,
      lon: gf.lon != null ? gf.lon : c.lon,
      radiusKm: gf.radiusKm || 30,
      points: gf.points ? gf.points.map((p) => [p[0], p[1]]) : [],
    };
  }

  function herdCenter(memberIds) {
    const ids = memberIds && memberIds.length ? memberIds : devices.map((d) => d.id);
    const pts = ids.map((i) => positions[i]).filter(Boolean);
    if (!pts.length) return { lat: cfg.defaultCenter[0], lon: cfg.defaultCenter[1] };
    let lat = 0, lon = 0;
    for (const p of pts) { lat += p.latitude; lon += p.longitude; }
    return { lat: lat / pts.length, lon: lon / pts.length };
  }

  function ensureMap() {
    if (mapInited) return;
    map = CTMap.create("map");
    map.on("click", onMapClick);
    mapInited = true;
    drawCamelContext();
  }

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

  // ---------- Onglets ----------
  function setMode(mode) {
    if (draft.mode === mode) return;
    draft.mode = mode;
    syncModeUI();
    redraw(true);
  }
  function syncModeUI() {
    document.querySelectorAll("#modeTabs .tab").forEach((b) =>
      b.classList.toggle("active", b.dataset.mode === draft.mode)
    );
    const isCamp = draft.mode === "camp";
    el("campPane").hidden = !isCamp;
    el("movePane").hidden = isCamp;
  }
  function setType(type) {
    if (draft.geofence.type === type) return;
    draft.geofence.type = type;
    syncTypeUI();
    redraw(true);
  }
  function syncTypeUI() {
    document.querySelectorAll("#typeTabs .tab").forEach((b) =>
      b.classList.toggle("active", b.dataset.type === draft.geofence.type)
    );
    const isCircle = draft.geofence.type === "circle";
    el("circleCtrls").hidden = !isCircle;
    el("polyCtrls").hidden = isCircle;
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

  // ---------- Mode dessin (forme libre) ----------
  function enterDraw() {
    drawing = true;
    document.body.classList.add("drawing");
    el("drawBar").hidden = false;
    updateDrawCount();
    setTimeout(() => map && map.invalidateSize(), 60);
    toast("Touche la carte pour poser les points");
  }
  function exitDraw() {
    drawing = false;
    document.body.classList.remove("drawing");
    el("drawBar").hidden = true;
    setTimeout(() => {
      if (map) map.invalidateSize();
      redraw(true);
    }, 60);
  }
  function updateDrawCount() {
    const n = draft.geofence.points.length;
    el("drawCount").textContent = n <= 1 ? `${n} point` : `${n} points`;
  }

  // ---------- Dessin carte ----------
  function clearLayers() {
    [circle, centerMarker, polyLayer, cohesionCircle].forEach((l) => l && map.removeLayer(l));
    vertexMarkers.forEach((m) => map.removeLayer(m));
    circle = centerMarker = polyLayer = cohesionCircle = null;
    vertexMarkers = [];
  }
  function redraw(fit) {
    if (!map) return;
    clearLayers();
    if (draft.mode === "move") drawCohesion();
    else if (draft.geofence.type === "circle") drawCircle();
    else drawPolygon();
    if (fit) fitView();
    updateLabel();
    updateStatus();
  }

  function drawCircle() {
    const g = draft.geofence;
    circle = L.circle([g.lat, g.lon], { radius: g.radiusKm * 1000, ...zoneStyle() }).addTo(map);
    centerMarker = L.marker([g.lat, g.lon], { draggable: true, icon: campIcon(), zIndexOffset: 1000 }).addTo(map);
    centerMarker.on("drag", (e) => {
      const ll = e.target.getLatLng();
      g.lat = ll.lat; g.lon = ll.lng;
      circle.setLatLng(ll);
      updateStatus();
    });
  }
  function refreshCircle() {
    const g = draft.geofence;
    if (circle) { circle.setLatLng([g.lat, g.lon]); circle.setRadius(g.radiusKm * 1000); }
    updateLabel();
    updateStatus();
  }
  function centerOnHerd() {
    const c = herdCenter(draft.members);
    draft.geofence.lat = c.lat; draft.geofence.lon = c.lon;
    if (centerMarker) centerMarker.setLatLng([c.lat, c.lon]);
    refreshCircle();
    fitView();
  }

  function drawPolygon() {
    const pts = draft.geofence.points;
    if (pts.length >= 2) polyLayer = L.polygon(pts, zoneStyle()).addTo(map);
    pts.forEach((p, i) => addVertexMarker(p, i));
    updateDrawCount();
  }
  function addVertexMarker(p, i) {
    const m = L.marker(p, { draggable: true, icon: vertexIcon() }).addTo(map);
    m.on("drag", (e) => {
      const ll = e.target.getLatLng();
      draft.geofence.points[i] = [ll.lat, ll.lng];
      if (polyLayer) polyLayer.setLatLngs(draft.geofence.points);
      updateStatus();
    });
    m.on("dblclick", (e) => { L.DomEvent.stop(e); draft.geofence.points.splice(i, 1); redrawPolygonOnly(); });
    vertexMarkers.push(m);
  }
  function onMapClick(e) {
    if (!drawing) return; // on n'ajoute des points qu'en mode dessin
    draft.geofence.points.push([e.latlng.lat, e.latlng.lng]);
    redrawPolygonOnly();
  }
  function redrawPolygonOnly() {
    [polyLayer, ...vertexMarkers].forEach((l) => l && map.removeLayer(l));
    polyLayer = null; vertexMarkers = [];
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

  function drawCohesion() {
    const c = memberCentroid();
    if (!c) return;
    cohesionCircle = L.circle([c.lat, c.lon], {
      radius: draft.cohesionKm * 1000,
      color: "#3d6e8f", weight: 2, opacity: 0.9, fillColor: "#3d6e8f", fillOpacity: 0.08, dashArray: "6 6",
    }).addTo(map);
  }
  function refreshCohesion() {
    const c = memberCentroid();
    if (cohesionCircle && c) { cohesionCircle.setLatLng([c.lat, c.lon]); cohesionCircle.setRadius(draft.cohesionKm * 1000); }
    else redraw(false);
  }
  function memberCentroid() {
    const pts = draft.members.map((m) => positions[m]).filter(Boolean);
    if (pts.length < 1) return null;
    let lat = 0, lon = 0;
    for (const p of pts) { lat += p.latitude; lon += p.longitude; }
    return { lat: lat / pts.length, lon: lon / pts.length, count: pts.length };
  }

  // ---------- Enregistrement ----------
  function save() {
    if (!draft) return;
    const name = (el("campName").value || "").trim();
    if (!name) return toast("Donne un nom au camp");
    draft.name = name;
    if (draft.mode === "camp" && draft.geofence.type === "polygon" && draft.geofence.points.length < 3) {
      return toast("Dessine au moins 3 points pour la zone");
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
    toast(`Camp « ${camp.name} » enregistré`);
    showList();
  }

  function removeCamp() {
    if (!draft || !draft.id) return;
    Camps.remove(draft.id);
    toast("Camp supprimé");
    showList();
  }

  // ---------- Statut ----------
  function updateLabel() {
    el("radiusVal").textContent = draft.geofence.radiusKm;
    el("cohesionVal").textContent = draft.cohesionKm;
    updateDrawCount();
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
    const gf = { enabled: true, ...geofenceForCheck() };
    let out = 0, known = 0;
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
    if (!map) return;
    if (draft.mode === "move") {
      if (cohesionCircle) map.fitBounds(cohesionCircle.getBounds().pad(0.3));
      else if (camelMarkers.length) map.fitBounds(L.featureGroup(camelMarkers).getBounds().pad(0.3));
      return;
    }
    if (draft.geofence.type === "circle" && circle) map.fitBounds(circle.getBounds().pad(0.2));
    else if (draft.geofence.type === "polygon" && draft.geofence.points.length >= 2)
      map.fitBounds(L.latLngBounds(draft.geofence.points).pad(0.3));
    else map.setView([draft.geofence.lat, draft.geofence.lon], cfg.defaultZoom || 8);
  }

  // ---------- Styles / icônes ----------
  function zoneStyle() {
    return { color: "#4f8a3d", weight: 2, opacity: 0.9, fillColor: "#4f8a3d", fillOpacity: 0.08, dashArray: "6 6" };
  }
  function campIcon() {
    return L.divIcon({ className: "", html: `<div style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:var(--sable-clair);border:2px solid var(--marron);border-radius:50%;box-shadow:var(--ombre);font-size:16px">🏕️</div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
  }
  function vertexIcon() {
    return L.divIcon({ className: "", html: `<div style="width:18px;height:18px;background:var(--marron);border:2px solid #fff;border-radius:50%;box-shadow:var(--ombre)"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
  }
  function camelIcon() {
    return L.divIcon({ className: "", html: `<div class="camel-marker"><img src="img/camel.svg" alt=""></div>`, iconSize: [42, 42], iconAnchor: [21, 21] });
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
