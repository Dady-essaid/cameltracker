// camps-ui.js — page CAMPS (carto) : carte ouverte + boutons de camps + ajout.
// Cliquer un camp l'affiche sur la carte avec ses chameaux. La feuille d'ajout
// se ferme après enregistrement.
(() => {
  const cfg = window.CT_CONFIG || {};
  const el = (id) => document.getElementById(id);

  let map;
  let devices = [], positions = {};
  let selectedId = null;
  let draft = null;

  const staticLayers = {}; // campId -> [layer]
  let camelMarkers = [];
  let circle = null, centerMarker = null, polyLayer = null, vertexMarkers = [];

  async function boot() {
    map = CTMap.create("map");
    map.on("click", onMapClick);
    await loadData();
    drawCamelContext();

    el("addCampBtn").addEventListener("click", () => openEdit(null));
    el("editSelBtn").addEventListener("click", () => selectedId && openEdit(selectedId));
    el("delSelBtn").addEventListener("click", removeSelected);
    el("cancelBtn").addEventListener("click", closeEdit);
    el("saveBtn").addEventListener("click", save);
    el("campName").addEventListener("input", () => (draft.name = el("campName").value));

    document.querySelectorAll("#typeTabs .tab").forEach((b) =>
      b.addEventListener("click", () => setType(b.dataset.type))
    );
    el("radius").addEventListener("input", () => { draft.geofence.radiusKm = +el("radius").value; refreshCircle(); });
    document.querySelectorAll(".gf-presets .chip").forEach((c) =>
      c.addEventListener("click", () => { draft.geofence.radiusKm = +c.dataset.km; el("radius").value = draft.geofence.radiusKm; refreshCircle(); })
    );
    el("undoBtn").addEventListener("click", undoPoint);
    el("clearBtn").addEventListener("click", clearPolygon);

    renderChips();
    drawAllCamps();
  }

  async function loadData() {
    try {
      devices = await API.getDevices();
      const pos = await API.getPositions();
      positions = {};
      pos.forEach((p) => (positions[p.deviceId] = p));
    } catch (e) { toast("Erreur : chargement des chameaux"); console.error(e); }
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

  // ---------- Boutons de camps ----------
  function renderChips() {
    const bar = el("campBar");
    bar.querySelectorAll(".camp-chip").forEach((c) => c.remove());
    for (const c of Camps.all()) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip camp-chip" + (c.id === selectedId ? " active" : "");
      b.textContent = c.name;
      b.addEventListener("click", () => selectCamp(c.id));
      bar.appendChild(b);
    }
  }

  function selectCamp(id) {
    selectedId = id;
    closeEditSilent();
    renderChips();
    drawAllCamps();
    const camp = Camps.get(id);
    if (!camp) { el("selBar").hidden = true; return; }
    fitCamp(camp);
    const n = (camp.members || []).length;
    const names = (camp.members || []).map((m) => (devices.find((d) => d.id === m) || {}).name).filter(Boolean).join(", ");
    el("selName").textContent = camp.name;
    el("selSub").textContent = `${n} chameau${n > 1 ? "x" : ""}${names ? " · " + names : ""}`;
    el("selBar").hidden = false;
  }

  // ---------- Dessin des camps (statique) ----------
  function removeStatic(id) { (staticLayers[id] || []).forEach((l) => map.removeLayer(l)); delete staticLayers[id]; }
  function drawAllCamps() {
    Object.keys(staticLayers).forEach(removeStatic);
    for (const c of Camps.all()) {
      if (draft && draft.id === c.id) continue; // en cours d'édition : dessiné en éditable
      drawGeofenceStatic(c.id, c.geofence || {}, c.id === selectedId);
    }
  }
  function drawGeofenceStatic(id, gf, selected) {
    const color = selected ? "#6b4a2b" : "#4f8a3d";
    const style = { color, weight: selected ? 3 : 2, opacity: 0.9, fillColor: color, fillOpacity: 0.08, dashArray: "6 6" };
    let layer = null;
    if (gf.type === "polygon") { if (gf.points && gf.points.length >= 3) layer = L.polygon(gf.points, style).addTo(map); }
    else if (gf.lat != null) { layer = L.circle([gf.lat, gf.lon], { radius: (gf.radiusKm || 1) * 1000, ...style }).addTo(map); }
    if (layer) staticLayers[id] = [layer];
  }
  function fitCamp(camp) {
    const gf = camp.geofence || {};
    if (gf.type === "polygon" && gf.points && gf.points.length >= 2) map.fitBounds(L.latLngBounds(gf.points).pad(0.3));
    else if (gf.lat != null) {
      // toBounds() calcule des limites autour du point sans nécessiter que le
      // cercle soit ajouté à la carte (getBounds() planterait sinon).
      const diameterM = (gf.radiusKm || 1) * 2000 * 1.3;
      map.fitBounds(L.latLng(gf.lat, gf.lon).toBounds(diameterM));
    }
  }

  // ---------- Édition ----------
  function openEdit(id) {
    buildDraft(id);
    selectedId = id;
    el("selBar").hidden = true;
    el("campBar").style.display = "none";
    el("editSheet").hidden = false;
    el("pageTitle").textContent = draft.id ? draft.name : "Nouveau camp";
    el("campName").value = draft.name;
    el("radius").value = draft.geofence.radiusKm;
    map.doubleClickZoom.disable(); // le double-clic ne zoome pas pendant l'édition
    syncTypeUI();
    renderMembers();
    drawAllCamps();
    setTimeout(() => { map.invalidateSize(); redrawEdit(true); }, 60);
  }
  function closeEdit() { closeEditSilent(); }
  function closeEditSilent() {
    draft = null;
    el("editSheet").hidden = true;
    el("campBar").style.display = "";
    el("pageTitle").textContent = "Camps";
    if (map.doubleClickZoom) map.doubleClickZoom.enable();
    clearEditLayers();
    drawAllCamps();
  }

  function buildDraft(id) {
    const camp = id ? Camps.get(id) : null;
    if (camp) {
      draft = { id: camp.id, name: camp.name, geofence: normalizeGeofence(camp.geofence), members: (camp.members || []).map(Number) };
    } else {
      const c = herdCenter([]);
      draft = { id: null, name: "", geofence: { type: "circle", lat: c.lat, lon: c.lon, radiusKm: 30, points: [] }, members: [] };
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
  function herdCenter(ids) {
    const list = ids && ids.length ? ids : devices.map((d) => d.id);
    const pts = list.map((i) => positions[i]).filter(Boolean);
    if (!pts.length) return { lat: cfg.defaultCenter[0], lon: cfg.defaultCenter[1] };
    let lat = 0, lon = 0;
    for (const p of pts) { lat += p.latitude; lon += p.longitude; }
    return { lat: lat / pts.length, lon: lon / pts.length };
  }

  function setType(type) {
    if (draft.geofence.type === type) return;
    draft.geofence.type = type;
    syncTypeUI();
    redrawEdit(true);
  }
  function syncTypeUI() {
    document.querySelectorAll("#typeTabs .tab").forEach((b) => b.classList.toggle("active", b.dataset.type === draft.geofence.type));
    const isCircle = draft.geofence.type === "circle";
    el("circleCtrls").hidden = !isCircle;
    el("polyCtrls").hidden = isCircle;
    el("editHint").textContent = isCircle
      ? "Touchez la carte pour poser le campement 🏕️ (glissez-le pour ajuster)"
      : "Touchez la carte pour ajouter les points de la zone, puis Enregistrer";
  }

  function renderMembers() {
    const box = el("members");
    box.innerHTML = "";
    for (const d of devices) {
      const other = Camps.campOfDevice(d.id);
      const inThis = draft.members.includes(Number(d.id));
      const inOther = other && other.id !== draft.id;
      const row = document.createElement("label");
      row.className = "member";
      row.innerHTML = `<input type="checkbox" ${inThis ? "checked" : ""} value="${d.id}">
        <span class="m-name">${CTMap.escapeHtml(d.name)}</span>
        ${inOther ? `<span class="m-tag">${CTMap.escapeHtml(other.name)}</span>` : ""}`;
      row.querySelector("input").addEventListener("change", (e) => {
        const id = Number(d.id);
        if (e.target.checked) { if (!draft.members.includes(id)) draft.members.push(id); }
        else draft.members = draft.members.filter((m) => m !== id);
        updateStatus();
      });
      box.appendChild(row);
    }
  }

  // ---------- Dessin éditable ----------
  function clearEditLayers() {
    [circle, centerMarker, polyLayer].forEach((l) => l && map.removeLayer(l));
    vertexMarkers.forEach((m) => map.removeLayer(m));
    circle = centerMarker = polyLayer = null;
    vertexMarkers = [];
  }
  function redrawEdit(fit) {
    clearEditLayers();
    if (!draft) return;
    if (draft.geofence.type === "circle") drawCircle();
    else drawPolygon();
    if (fit) fitEdit();
    el("radiusVal").textContent = draft.geofence.radiusKm;
    updatePolyCount();
    updateStatus();
  }
  function drawCircle() {
    const g = draft.geofence;
    circle = L.circle([g.lat, g.lon], { radius: g.radiusKm * 1000, ...editStyle() }).addTo(map);
    centerMarker = L.marker([g.lat, g.lon], { draggable: true, icon: campIcon(), zIndexOffset: 1000 }).addTo(map);
    centerMarker.on("drag", (e) => { const ll = e.target.getLatLng(); g.lat = ll.lat; g.lon = ll.lng; circle.setLatLng(ll); updateStatus(); });
  }
  function refreshCircle() {
    const g = draft.geofence;
    if (circle) { circle.setLatLng([g.lat, g.lon]); circle.setRadius(g.radiusKm * 1000); }
    el("radiusVal").textContent = g.radiusKm;
    updateStatus();
  }
  function drawPolygon() {
    const pts = draft.geofence.points;
    if (pts.length >= 2) polyLayer = L.polygon(pts, editStyle()).addTo(map);
    pts.forEach((p, i) => addVertex(p, i));
    updatePolyCount();
  }
  function addVertex(p, i) {
    const m = L.marker(p, { draggable: true, icon: vertexIcon() }).addTo(map);
    m.on("drag", (e) => { const ll = e.target.getLatLng(); draft.geofence.points[i] = [ll.lat, ll.lng]; if (polyLayer) polyLayer.setLatLngs(draft.geofence.points); updateStatus(); });
    m.on("dblclick", (e) => { L.DomEvent.stop(e); draft.geofence.points.splice(i, 1); redrawPoly(); });
    vertexMarkers.push(m);
  }
  // Toucher la carte : en cercle -> pose le campement ; en forme libre -> ajoute un point.
  function onMapClick(e) {
    if (!draft) return;
    if (draft.geofence.type === "circle") {
      draft.geofence.lat = e.latlng.lat;
      draft.geofence.lon = e.latlng.lng;
      if (circle && centerMarker) { circle.setLatLng(e.latlng); centerMarker.setLatLng(e.latlng); }
      else redrawEdit(false);
      updateStatus();
    } else {
      draft.geofence.points.push([e.latlng.lat, e.latlng.lng]);
      redrawPoly();
    }
  }
  function redrawPoly() {
    [polyLayer, ...vertexMarkers].forEach((l) => l && map.removeLayer(l));
    polyLayer = null; vertexMarkers = [];
    drawPolygon();
    updateStatus();
  }
  function undoPoint() { if (draft.geofence.points.length) { draft.geofence.points.pop(); redrawPoly(); } }
  function clearPolygon() { draft.geofence.points = []; redrawPoly(); }
  function updatePolyCount() { const n = draft.geofence.points.length; el("polyCount").textContent = n <= 1 ? `${n} point` : `${n} points`; }

  // ---------- Statut ----------
  function updateStatus() {
    if (!draft) return;
    const box = el("gfStatus");
    const n = draft.members.length;
    if (!n) { box.className = "gf-status none"; box.textContent = "Aucun chameau affecté"; return; }
    const gf = { enabled: true, ...geofenceForCheck() };
    let out = 0, known = 0;
    for (const m of draft.members) {
      const p = positions[m]; if (!p) continue; known++;
      if (Geofence.status(p, gf).outside) out++;
    }
    if (!known) { box.className = "gf-status none"; box.textContent = `${n} chameau(x) · position inconnue`; }
    else if (out) { box.className = "gf-status outside"; box.textContent = `${out}/${known} chameau(x) HORS ZONE`; }
    else { box.className = "gf-status inside"; box.textContent = `Tous dans la zone (${known})`; }
  }
  function geofenceForCheck() {
    return draft.geofence.type === "polygon"
      ? { type: "polygon", points: draft.geofence.points }
      : { type: "circle", lat: draft.geofence.lat, lon: draft.geofence.lon, radiusKm: draft.geofence.radiusKm };
  }
  function fitEdit() {
    if (draft.geofence.type === "circle" && circle) map.fitBounds(circle.getBounds().pad(0.2));
    else if (draft.geofence.type === "polygon" && draft.geofence.points.length >= 2) map.fitBounds(L.latLngBounds(draft.geofence.points).pad(0.3));
    else map.setView([draft.geofence.lat, draft.geofence.lon], cfg.defaultZoom || 8);
  }

  // ---------- Enregistrer / supprimer ----------
  function save() {
    if (!draft) return;
    const name = (el("campName").value || "").trim();
    if (!name) return toast("Donne un nom au camp");
    draft.name = name;
    if (draft.geofence.type === "polygon" && draft.geofence.points.length < 3) return toast("Dessine au moins 3 points");
    const geofence = draft.geofence.type === "polygon"
      ? { type: "polygon", points: draft.geofence.points }
      : { type: "circle", lat: draft.geofence.lat, lon: draft.geofence.lon, radiusKm: draft.geofence.radiusKm };
    const camp = { id: draft.id || "camp_" + Date.now().toString(36), name, geofence, members: draft.members };
    Camps.upsert(camp);
    const savedId = camp.id;
    closeEditSilent();
    renderChips();
    toast(`Camp « ${name} » enregistré`);
    selectCamp(savedId);
  }
  function removeSelected() {
    if (!selectedId) return;
    Camps.remove(selectedId);
    selectedId = null;
    el("selBar").hidden = true;
    renderChips();
    drawAllCamps();
    toast("Camp supprimé");
  }

  // ---------- Styles / icônes ----------
  function editStyle() { return { color: "#6b4a2b", weight: 2, opacity: 0.9, fillColor: "#6b4a2b", fillOpacity: 0.08, dashArray: "6 6" }; }
  function campIcon() { return L.divIcon({ className: "", html: `<div style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:var(--sable-clair);border:2px solid var(--marron);border-radius:50%;box-shadow:var(--ombre);font-size:16px">🏕️</div>`, iconSize: [34, 34], iconAnchor: [17, 17] }); }
  function vertexIcon() { return L.divIcon({ className: "", html: `<div style="width:18px;height:18px;background:var(--marron);border:2px solid #fff;border-radius:50%;box-shadow:var(--ombre)"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] }); }
  function camelIcon() { return L.divIcon({ className: "", html: `<div class="camel-marker"><img src="img/camel.svg" alt=""></div>`, iconSize: [42, 42], iconAnchor: [21, 21] }); }

  let toastTimer;
  function toast(msg) { const t = el("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3000); }

  document.addEventListener("DOMContentLoaded", boot);
})();
