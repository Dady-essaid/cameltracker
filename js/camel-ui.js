// camel-ui.js — profil d'un chameau (camel.html?id=). Champs auto-enregistrés.
(() => {
  const cfg = window.CT_CONFIG || {};
  const el = (id) => document.getElementById(id);
  const id = Number(new URLSearchParams(location.search).get("id"));
  let device = null, pos = null;
  let routeMap = null, routeLayer = null;

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function toast(msg) { const t = el("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(window.__tt); window.__tt = setTimeout(() => t.classList.remove("show"), 2200); }

  async function boot() {
    try {
      const devices = Camels.applyNames(await API.getDevices());
      device = devices.find((d) => d.id === id);
      const positions = await API.getPositions();
      pos = positions.find((p) => p.deviceId === id) || null;
    } catch (e) { console.error(e); }
    if (!device) { el("pageTitle").textContent = "Chameau introuvable"; return; }
    fillHero();
    fillProfile();
    wire();
    // Date du jour par défaut pour le trajet.
    const now = new Date();
    el("routeDate").value = now.toISOString().slice(0, 10);
  }

  function fillHero() {
    el("pageTitle").textContent = device.name;
    el("pfName").value = device.name;
    const bat = pos?.attributes?.batteryLevel;
    el("pfBattery").textContent = bat != null ? bat + "%" : "—";
    el("pfBattery").className = bat != null && bat < 25 ? "low" : "";
    el("pfSpeed").textContent = pos?.speed != null ? (pos.speed * 1.852).toFixed(1) + " km/h" : "—";
    const trip = Trips.activeTripOfDevice(id);
    const camp = Camps.campOfDevice(id);
    el("pfPlace").textContent = trip ? "🧭 " + trip.name : camp ? "🏕️ " + camp.name : "libre";
    const camp2 = Camps.campOfDevice(id);
    el("nfCampName").textContent = camp2 ? "« " + camp2.name + " »" : "(aucun)";
  }

  function fillProfile() {
    const p = Camels.get(id);
    el("pfBirth").value = p.birthDate || "";
    el("pfNotes").value = p.notes || "";
    updateAge();
    renderVax(p.vaccinations);
    el("nfGlobal").checked = p.notif.global;
    el("nfBattery").checked = p.notif.battery;
    el("nfImmobile").checked = p.notif.immobile;
    el("nfCamp").checked = p.notif.camp;
    el("nfTrip").checked = p.notif.trip;
    el("nfGeofence").checked = p.notif.geofence;
    reflectGlobal();
  }

  function updateAge() {
    const b = el("pfBirth").value;
    if (!b) { el("pfAge").textContent = ""; return; }
    const days = Math.floor((Date.now() - new Date(b).getTime()) / 86400000);
    if (days < 0) { el("pfAge").textContent = ""; return; }
    const years = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);
    el("pfAge").textContent = years >= 1 ? `${years} an${years > 1 ? "s" : ""}${months ? " " + months + " mois" : ""}` : `${months} mois`;
  }

  function renderVax(list) {
    const box = el("vaxList");
    if (!list.length) { box.innerHTML = '<div class="pf-hint">Aucune vaccination enregistrée.</div>'; return; }
    box.innerHTML = list
      .slice()
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .map((v, i) => `<div class="vax-item"><span class="vx-date">${esc(v.date || "")}</span><span class="vx-note">${esc(v.note || "Vaccination")}</span><button class="vx-del" data-i="${i}" type="button">✕</button></div>`)
      .join("");
    box.querySelectorAll(".vx-del").forEach((btn) =>
      btn.addEventListener("click", () => {
        const cur = Camels.get(id).vaccinations.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        cur.splice(Number(btn.dataset.i), 1);
        Camels.set(id, { vaccinations: cur });
        renderVax(cur);
      })
    );
  }

  function reflectGlobal() {
    const on = el("nfGlobal").checked;
    el("nfDetails").classList.toggle("disabled", !on);
    el("nfDetails").querySelectorAll("input").forEach((i) => (i.disabled = !on));
  }

  function wire() {
    el("pfName").addEventListener("input", () => {
      const v = el("pfName").value.trim();
      Camels.set(id, { name: v });
      el("pageTitle").textContent = v || device.name;
    });
    el("pfBirth").addEventListener("change", () => { Camels.set(id, { birthDate: el("pfBirth").value }); updateAge(); });
    el("pfNotes").addEventListener("input", () => Camels.set(id, { notes: el("pfNotes").value }));

    el("vaxAdd").addEventListener("click", () => {
      const date = el("vaxDate").value;
      if (!date) return toast("Choisis une date");
      const list = Camels.get(id).vaccinations.concat([{ date, note: el("vaxNote").value.trim() }]);
      Camels.set(id, { vaccinations: list });
      el("vaxDate").value = ""; el("vaxNote").value = "";
      renderVax(list);
      toast("Vaccination ajoutée");
    });

    const nf = (key, elId) => el(elId).addEventListener("change", () => {
      const notif = { ...Camels.get(id).notif, [key]: el(elId).checked };
      Camels.set(id, { notif });
      if (key === "global") reflectGlobal();
    });
    nf("global", "nfGlobal");
    nf("battery", "nfBattery");
    nf("immobile", "nfImmobile");
    nf("camp", "nfCamp");
    nf("trip", "nfTrip");
    nf("geofence", "nfGeofence");

    el("routeShow").addEventListener("click", showRoute);
  }

  async function showRoute() {
    const date = el("routeDate").value;
    if (!date) return toast("Choisis une date");
    el("routeKm").textContent = "…";
    try {
      const from = new Date(date + "T00:00:00").toISOString();
      const to = new Date(date + "T23:59:59").toISOString();
      const pts = await API.getRoute(id, from, to);
      let km = 0;
      const coords = [];
      for (let i = 0; i < pts.length; i++) {
        coords.push([pts[i].latitude, pts[i].longitude]);
        if (i > 0) km += Geofence.distanceKm(pts[i - 1].latitude, pts[i - 1].longitude, pts[i].latitude, pts[i].longitude);
      }
      el("routeKm").textContent = km.toFixed(1) + " km";
      if (!routeMap) routeMap = CTMap.create("routeMap");
      if (routeLayer) routeMap.removeLayer(routeLayer);
      if (coords.length >= 2) {
        routeLayer = L.polyline(coords, { color: "#b3492f", weight: 4, opacity: 0.9 }).addTo(routeMap);
        routeMap.fitBounds(routeLayer.getBounds().pad(0.2));
      } else {
        toast("Aucun déplacement ce jour-là");
      }
      setTimeout(() => routeMap.invalidateSize(), 60);
    } catch (e) { console.error(e); el("routeKm").textContent = "—"; toast("Erreur de chargement du trajet"); }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
