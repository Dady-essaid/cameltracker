// chameaux-ui.js — liste des chameaux -> clic ouvre le profil (camel.html?id=).
(() => {
  const cfg = window.CT_CONFIG || {};
  const el = (id) => document.getElementById(id);
  let devices = [], positionsById = {};

  function setStatus(ok, text) {
    el("statusDot").className = "dot" + (ok ? "" : " off");
    el("statusText").textContent = text;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function timeAgo(t) {
    if (!t) return "aucun signal";
    const s = Math.floor((Date.now() - new Date(t).getTime()) / 1000);
    if (s < 60) return "à l'instant";
    if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
    return `il y a ${Math.floor(s / 86400)} j`;
  }

  async function load() {
    try {
      devices = await API.getDevices();
      Camels.applyNames(devices);
      const positions = await API.getPositions();
      positionsById = {};
      for (const p of positions) positionsById[p.deviceId] = p;
      setStatus(true, `${devices.length} chameau${devices.length > 1 ? "x" : ""}`);
    } catch (e) {
      setStatus(false, "hors ligne");
      console.error(e);
    }
    render();
  }

  function render() {
    const box = el("camelList");
    if (!devices.length) { box.innerHTML = '<div class="camels-empty">Aucun chameau.</div>'; return; }
    box.innerHTML = devices.map((d) => {
      const pos = positionsById[d.id];
      const bat = pos?.attributes?.batteryLevel;
      const low = bat != null && bat < 25;
      const camp = Camps.campOfDevice(d.id);
      const trip = Trips.activeTripOfDevice(d.id);
      const p = Camels.get(d.id);
      const muted = !p.notif.global;
      const place = trip ? `🧭 ${esc(trip.name)}` : camp ? `🏕️ ${esc(camp.name)}` : "sans camp";
      return `<a class="camel-card" href="camel.html?id=${d.id}">
        <div class="cc-avatar"><img src="img/camel.svg" alt=""></div>
        <div class="cc-body">
          <div class="cc-name">${esc(d.name)} ${muted ? '<span class="cc-mute" title="Notifications coupées">🔕</span>' : ""}</div>
          <div class="cc-meta">${place} · ${pos ? timeAgo(pos.deviceTime) : "aucun signal"}</div>
        </div>
        <div class="cc-bat ${low ? "low" : ""}">${bat != null ? bat + "%" : "—"}</div>
        <div class="cc-arrow">›</div>
      </a>`;
    }).join("");
  }

  document.addEventListener("DOMContentLoaded", () => { setStatus(true, "Chargement…"); load(); });
})();
