// trips-ui.js — page DÉPLACEMENTS : vue carte (boutons + Démarrer/Terminer)
// et formulaire plein écran (berger + chameaux par boutons, seuil).
(() => {
  const cfg = window.CT_CONFIG || {};
  const el = (id) => document.getElementById(id);

  let map;
  let devices = [], positions = {};
  let selectedId = null;
  let draft = null;
  let previewLayers = [], camelMarkers = [];

  async function boot() {
    map = CTMap.create("map");
    await loadData();
    drawCamelContext();

    el("addTripBtn").addEventListener("click", () => showEdit(null));
    el("editSelBtn").addEventListener("click", () => selectedId && showEdit(selectedId));
    el("delSelBtn").addEventListener("click", removeSelected);
    el("startStopBtn").addEventListener("click", toggleStartStop);
    el("cancelBtn").addEventListener("click", showMap);
    el("saveBtn").addEventListener("click", save);
    el("headerBack").addEventListener("click", (e) => {
      if (!el("editView").hidden) { e.preventDefault(); showMap(); }
    });

    el("tripName").addEventListener("input", () => (draft.name = el("tripName").value));
    el("threshold").addEventListener("input", () => {
      draft.thresholdKm = +el("threshold").value;
      el("thresholdVal").textContent = draft.thresholdKm;
      updateStatus();
    });

    renderChips();
    showMap();
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
  function guideDefault() {
    return (devices.find((d) => d.guide) || devices.find((d) => /berger/i.test(d.name)) || devices[0] || {}).id;
  }
  function nameOf(id) { return (devices.find((d) => d.id === id) || {}).name || "—"; }

  // ---------- Vue carte ----------
  function showMap() {
    draft = null;
    el("editView").hidden = true;
    el("tripBar").style.display = "";
    el("pageTitle").textContent = "Déplacements";
    el("headerBack").setAttribute("href", "index.html");
    renderChips();
    drawActiveTrips();
    if (selectedId && Trips.get(selectedId)) selectTrip(selectedId);
    else el("selBar").hidden = true;
  }

  function renderChips() {
    const bar = el("tripBar");
    bar.querySelectorAll(".trip-chip").forEach((c) => c.remove());
    for (const t of Trips.all()) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip trip-chip" + (t.id === selectedId ? " active" : "") + (Trips.isActive(t) ? " live" : "");
      b.innerHTML = (Trips.isActive(t) ? "🟢 " : "") + CTMap.escapeHtml(t.name);
      b.addEventListener("click", () => selectTrip(t.id));
      bar.appendChild(b);
    }
  }

  function selectTrip(id) {
    selectedId = id;
    renderChips();
    const t = Trips.get(id);
    if (!t) { el("selBar").hidden = true; drawActiveTrips(); return; }
    drawActiveTrips();
    drawPreviewFor(t, true);
    const n = (t.members || []).length;
    const active = Trips.isActive(t);
    el("selName").textContent = (active ? "🟢 " : "") + t.name;
    el("selSub").textContent = active
      ? `Berger : ${nameOf(t.guideId)} · ${n} chameau${n > 1 ? "x" : ""} · seuil ${t.thresholdKm} km`
      : `Non démarré · berger : ${nameOf(t.guideId)} · ${n} chameau${n > 1 ? "x" : ""}`;
    const btn = el("startStopBtn");
    btn.textContent = active ? "■ Terminer" : "▶ Démarrer";
    btn.classList.toggle("stop", active);
    el("selBar").hidden = false;
  }

  function toggleStartStop() {
    const t = Trips.get(selectedId);
    if (!t) return;
    if (Trips.isActive(t)) { Trips.end(t.id); toast("Déplacement terminé"); }
    else {
      if (t.guideId == null) return toast("Choisis le GPS du berger");
      if (!(t.members || []).length) return toast("Affecte au moins un chameau");
      Trips.start(t.id);
      toast("Déplacement démarré — suivi actif");
    }
    renderChips();
    selectTrip(t.id);
  }

  // ---------- Dessin ----------
  function clearPreview() { previewLayers.forEach((l) => map.removeLayer(l)); previewLayers = []; }
  function drawActiveTrips() {
    clearPreview();
    for (const t of Trips.active()) drawPreviewFor(t, false);
  }
  function drawPreviewFor(trip, fit) {
    const guide = positions[trip.guideId];
    if (!guide) return;
    const circle = L.circle([guide.latitude, guide.longitude], {
      radius: (trip.thresholdKm || 3) * 1000,
      color: "#3d6e8f", weight: 2, opacity: 0.9, fillColor: "#3d6e8f", fillOpacity: 0.07, dashArray: "6 6",
    }).addTo(map);
    const gm = L.marker([guide.latitude, guide.longitude], { icon: guideIcon(), zIndexOffset: 1000 })
      .addTo(map).bindTooltip("Berger", { direction: "top", offset: [0, -18], className: "camel-label" });
    previewLayers.push(circle, gm);
    if (fit) map.fitBounds(circle.getBounds().pad(0.5));
  }

  // ---------- Formulaire ----------
  function showEdit(id) {
    buildDraft(id);
    selectedId = id;
    el("selBar").hidden = true;
    el("tripBar").style.display = "none";
    el("editView").hidden = false;
    el("pageTitle").textContent = draft.id ? draft.name : "Nouveau déplacement";
    el("tripName").value = draft.name;
    el("threshold").value = draft.thresholdKm;
    el("thresholdVal").textContent = draft.thresholdKm;
    renderGuideChips();
    renderMemberChips();
    updateStatus();
  }
  function buildDraft(id) {
    const t = id ? Trips.get(id) : null;
    if (t) draft = { id: t.id, name: t.name, guideId: t.guideId, members: (t.members || []).map(Number), thresholdKm: t.thresholdKm, startedAt: t.startedAt, endedAt: t.endedAt };
    else draft = { id: null, name: "", guideId: guideDefault(), members: [], thresholdKm: Trips.DEFAULT_THRESHOLD_KM, startedAt: null, endedAt: null };
  }

  function renderGuideChips() {
    const box = el("guideChips");
    box.innerHTML = "";
    for (const d of devices) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pick" + (d.id === draft.guideId ? " active" : "");
      b.textContent = d.name;
      b.addEventListener("click", () => {
        draft.guideId = d.id;
        draft.members = draft.members.filter((m) => m !== d.id); // le berger n'est pas un membre
        renderGuideChips();
        renderMemberChips();
        updateStatus();
      });
      box.appendChild(b);
    }
  }
  function renderMemberChips() {
    const box = el("memberChips");
    box.innerHTML = "";
    for (const d of devices) {
      if (d.id === draft.guideId) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pick" + (draft.members.includes(d.id) ? " active" : "");
      b.textContent = d.name;
      b.addEventListener("click", () => {
        if (draft.members.includes(d.id)) draft.members = draft.members.filter((m) => m !== d.id);
        else draft.members.push(d.id);
        renderMemberChips();
        updateStatus();
      });
      box.appendChild(b);
    }
  }

  function updateStatus() {
    if (!draft) return;
    const box = el("tripStatus");
    const guide = positions[draft.guideId];
    const n = draft.members.length;
    if (draft.guideId == null) { box.className = "gf-status none"; box.textContent = "Choisis le GPS du berger"; return; }
    if (!n) { box.className = "gf-status none"; box.textContent = "Ajoute au moins un chameau"; return; }
    if (!guide) { box.className = "gf-status none"; box.textContent = "Position du berger inconnue"; return; }
    let maxD = 0;
    for (const m of draft.members) {
      const p = positions[m]; if (!p) continue;
      const d = Geofence.distanceKm(p.latitude, p.longitude, guide.latitude, guide.longitude);
      if (d > maxD) maxD = d;
    }
    const out = maxD > draft.thresholdKm;
    box.className = "gf-status " + (out ? "outside" : "inside");
    box.textContent = out
      ? `Un chameau s'éloignerait — écart max ${maxD.toFixed(1)} km (seuil ${draft.thresholdKm} km)`
      : `Groupé autour du berger — écart max ${maxD.toFixed(1)} km`;
  }

  // ---------- Enregistrer / supprimer ----------
  function save() {
    if (!draft) return;
    const name = (el("tripName").value || "").trim();
    if (!name) return toast("Donne un nom au déplacement");
    if (draft.guideId == null) return toast("Choisis le GPS du berger");
    const trip = { id: draft.id || "trip_" + Date.now().toString(36), name, guideId: draft.guideId, members: draft.members, thresholdKm: draft.thresholdKm, startedAt: draft.startedAt, endedAt: draft.endedAt };
    Trips.upsert(trip);
    const savedId = trip.id;
    toast(`Déplacement « ${name} » enregistré`);
    selectedId = savedId;
    showMap();
  }
  function removeSelected() {
    if (!selectedId) return;
    Trips.remove(selectedId);
    selectedId = null;
    el("selBar").hidden = true;
    renderChips();
    drawActiveTrips();
    toast("Déplacement supprimé");
  }

  // ---------- Icônes ----------
  function guideIcon() { return L.divIcon({ className: "", html: `<div style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;background:#3d6e8f;border:2px solid #fff;border-radius:50%;box-shadow:var(--ombre);font-size:15px">🧑🏽</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }); }
  function camelIcon() { return L.divIcon({ className: "", html: `<div class="camel-marker"><img src="img/camel.svg" alt=""></div>`, iconSize: [42, 42], iconAnchor: [21, 21] }); }

  let toastTimer;
  function toast(msg) { const t = el("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3000); }

  document.addEventListener("DOMContentLoaded", boot);
})();
