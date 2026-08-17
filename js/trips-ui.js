// trips-ui.js — page DÉPLACEMENTS : carte + boutons + création/démarrage.
// Un déplacement = GPS du berger (référence) + chameaux + seuil, avec un cycle
// Démarrer / Terminer. Actif = on alerte quand un chameau s'éloigne du berger.
(() => {
  const cfg = window.CT_CONFIG || {};
  const el = (id) => document.getElementById(id);

  let map;
  let devices = [], positions = {};
  let selectedId = null;
  let draft = null;
  let previewLayers = [];
  let camelMarkers = [];

  async function boot() {
    map = CTMap.create("map");
    await loadData();
    drawCamelContext();

    el("addTripBtn").addEventListener("click", () => openEdit(null));
    el("editSelBtn").addEventListener("click", () => selectedId && openEdit(selectedId));
    el("delSelBtn").addEventListener("click", removeSelected);
    el("startStopBtn").addEventListener("click", toggleStartStop);
    el("cancelBtn").addEventListener("click", closeEdit);
    el("saveBtn").addEventListener("click", save);

    el("tripName").addEventListener("input", () => (draft.name = el("tripName").value));
    el("guideSel").addEventListener("change", () => { draft.guideId = Number(el("guideSel").value); renderMembers(); redrawPreview(true); });
    el("threshold").addEventListener("input", () => { draft.thresholdKm = +el("threshold").value; el("thresholdVal").textContent = draft.thresholdKm; redrawPreview(false); updateStatus(); });

    renderChips();
    drawActiveTrips();
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

  // ---------- Boutons ----------
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
    closeEditSilent();
    renderChips();
    const t = Trips.get(id);
    if (!t) { el("selBar").hidden = true; drawActiveTrips(); return; }
    drawActiveTrips();
    drawPreviewFor(t, true);
    const guide = (devices.find((d) => d.id === t.guideId) || {}).name || "—";
    const n = (t.members || []).length;
    el("selName").textContent = (Trips.isActive(t) ? "🟢 " : "") + t.name;
    el("selSub").textContent = `Berger : ${guide} · ${n} chameau${n > 1 ? "x" : ""} · seuil ${t.thresholdKm} km`;
    const btn = el("startStopBtn");
    btn.textContent = Trips.isActive(t) ? "■ Terminer" : "▶ Démarrer";
    btn.classList.toggle("stop", Trips.isActive(t));
    el("selBar").hidden = false;
  }

  function toggleStartStop() {
    const t = Trips.get(selectedId);
    if (!t) return;
    if (Trips.isActive(t)) { Trips.end(t.id); toast("Déplacement terminé"); }
    else {
      if (!t.guideId) return toast("Choisis d'abord le GPS du berger");
      if (!(t.members || []).length) return toast("Affecte au moins un chameau");
      Trips.start(t.id);
      toast("Déplacement démarré");
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
    if (fit) map.fitBounds(circle.getBounds().pad(0.4));
  }
  function redrawPreview(fit) {
    drawActiveTrips();
    if (draft) drawPreviewFor(draft, fit);
  }

  // ---------- Édition ----------
  function openEdit(id) {
    buildDraft(id);
    selectedId = id;
    el("selBar").hidden = true;
    el("tripBar").style.display = "none";
    el("editSheet").hidden = false;
    el("pageTitle").textContent = draft.id ? draft.name : "Nouveau déplacement";
    el("tripName").value = draft.name;
    el("threshold").value = draft.thresholdKm;
    el("thresholdVal").textContent = draft.thresholdKm;
    fillGuideSelect();
    renderMembers();
    setTimeout(() => { map.invalidateSize(); redrawPreview(true); }, 60);
  }
  function closeEdit() { closeEditSilent(); }
  function closeEditSilent() {
    draft = null;
    el("editSheet").hidden = true;
    el("tripBar").style.display = "";
    el("pageTitle").textContent = "Déplacements";
    drawActiveTrips();
  }
  function buildDraft(id) {
    const t = id ? Trips.get(id) : null;
    if (t) draft = { id: t.id, name: t.name, guideId: t.guideId, members: (t.members || []).map(Number), thresholdKm: t.thresholdKm, startedAt: t.startedAt, endedAt: t.endedAt };
    else draft = { id: null, name: "", guideId: guideDefault(), members: [], thresholdKm: Trips.DEFAULT_THRESHOLD_KM, startedAt: null, endedAt: null };
  }
  function fillGuideSelect() {
    const sel = el("guideSel");
    sel.innerHTML = "";
    for (const d of devices) {
      const o = document.createElement("option");
      o.value = d.id;
      o.textContent = d.name;
      sel.appendChild(o);
    }
    sel.value = draft.guideId != null ? draft.guideId : "";
  }
  function renderMembers() {
    const box = el("members");
    box.innerHTML = "";
    for (const d of devices) {
      if (d.id === draft.guideId) continue; // le berger n'est pas un chameau surveillé
      const inThis = draft.members.includes(Number(d.id));
      const row = document.createElement("label");
      row.className = "member";
      row.innerHTML = `<input type="checkbox" ${inThis ? "checked" : ""} value="${d.id}"><span class="m-name">${CTMap.escapeHtml(d.name)}</span>`;
      row.querySelector("input").addEventListener("change", (e) => {
        const id = Number(d.id);
        if (e.target.checked) { if (!draft.members.includes(id)) draft.members.push(id); }
        else draft.members = draft.members.filter((m) => m !== id);
        updateStatus();
      });
      box.appendChild(row);
    }
  }

  function updateStatus() {
    if (!draft) return;
    const box = el("tripStatus");
    const guide = positions[draft.guideId];
    const n = draft.members.length;
    if (!n) { box.className = "gf-status none"; box.textContent = "Aucun chameau affecté"; return; }
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
      ? `Un chameau s'éloigne — écart max ${maxD.toFixed(1)} km (seuil ${draft.thresholdKm} km)`
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
    closeEditSilent();
    renderChips();
    toast(`Déplacement « ${name} » enregistré`);
    selectTrip(savedId);
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
