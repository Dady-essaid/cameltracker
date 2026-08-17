// notifications.js — page Alertes : onglets « Alertes » (liste) et « Réglages »
// Recalcule les alertes (via Camps + Alerts) et les affiche. Autonome (pas de carte).
(() => {
  const cfg = window.CT_CONFIG || {};
  const el = (id) => document.getElementById(id);
  let timer = null;

  const ALERT_META = {
    zone: { icon: "📍", label: "Sortie de zone" },
    cohesion: { icon: "🧭", label: "S'éloigne du groupe" },
    immobile: { icon: "💤", label: "Immobilité" },
    battery: { icon: "🔋", label: "Batterie faible" },
  };

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function timeAgo(t) {
    const s = Math.floor((Date.now() - new Date(t).getTime()) / 1000);
    if (s < 60) return "à l'instant";
    if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
    return `il y a ${Math.floor(s / 86400)} j`;
  }
  function setStatus(ok, text) {
    el("statusDot").className = "dot" + (ok ? "" : " off");
    el("statusText").textContent = text;
  }

  // ---------- Rafraîchissement ----------
  async function refresh() {
    try {
      const devices = await API.getDevices();
      const nameById = {};
      for (const d of devices) nameById[d.id] = d.name;
      Camps.migrateFromGeofences(nameById);
      const positions = await API.getPositions();
      const positionsById = {};
      for (const p of positions) positionsById[p.deviceId] = p;
      const statusById = {};
      for (const d of devices) if (positionsById[d.id]) statusById[d.id] = Camps.statusFor(d.id, positionsById);
      Alerts.evaluate(devices, positionsById, statusById);
      setStatus(true, "à jour");
    } catch (e) {
      setStatus(false, "hors ligne");
      console.error(e);
    }
    renderAlerts();
  }

  // ---------- Onglet Alertes ----------
  function renderAlerts() {
    const items = Alerts.list();
    const list = el("alertsList");
    if (!items.length) {
      list.innerHTML = '<div class="ap-empty">Aucune alerte. Tout va bien 🐪</div>';
      return;
    }
    list.innerHTML = items
      .map((a) => {
        const m = ALERT_META[a.type] || { icon: "⚠️" };
        const when = a.resolved ? `résolue ${timeAgo(a.resolvedAt)}` : `depuis ${timeAgo(a.since)}`;
        return `<div class="ap-item ${a.type}${a.resolved ? " resolved" : ""}${
          !a.resolved && !a.read ? " unread" : ""
        }" data-device="${a.deviceId}">
          <div class="ap-ic">${m.icon}</div>
          <div class="ap-body">
            <div class="ap-name">${esc(a.deviceName)}</div>
            <div class="ap-msg">${esc(a.message)}</div>
            <div class="ap-when">${when}</div>
          </div>
        </div>`;
      })
      .join("");
    list.querySelectorAll(".ap-item").forEach((n) => {
      n.addEventListener("click", () => (location.href = "index.html?focus=" + n.dataset.device));
    });
  }

  // ---------- Onglets ----------
  function showTab(name) {
    el("alertsTab").hidden = name !== "alerts";
    el("settingsTab").hidden = name !== "settings";
    document.querySelectorAll("#notifTabs .tab").forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === name)
    );
    if (name === "alerts") {
      Alerts.markAllRead();
      renderAlerts();
    } else {
      fillSettings();
    }
  }

  // ---------- Réglages ----------
  function fillSettings() {
    const c = Alerts.config();
    el("setEnabled").checked = c.enabled;
    el("setZone").checked = c.outOfZone;
    el("setCohesion").checked = c.cohesion;
    el("setBattery").value = c.lowBattery;
    el("setImmobility").value = c.immobilityHours;
    updateNotifBtn();
  }
  function updateNotifBtn() {
    const btn = el("notifBtn");
    if (!("Notification" in window)) {
      btn.textContent = "Notifications non supportées";
      btn.disabled = true;
      return;
    }
    if (Notification.permission === "granted") {
      btn.textContent = "Notifications système activées ✓";
      btn.disabled = true;
    } else if (Notification.permission === "denied") {
      btn.textContent = "Notifications bloquées (voir le navigateur)";
      btn.disabled = true;
    } else {
      btn.textContent = "Activer les notifications système";
      btn.disabled = false;
    }
  }

  // ---------- Init ----------
  function setup() {
    document.querySelectorAll("#notifTabs .tab").forEach((b) =>
      b.addEventListener("click", () => showTab(b.dataset.tab))
    );
    el("markRead").addEventListener("click", () => {
      Alerts.markAllRead();
      renderAlerts();
    });
    el("clearResolved").addEventListener("click", () => {
      Alerts.clearResolved();
      renderAlerts();
    });

    el("setEnabled").addEventListener("change", (e) => Alerts.setConfig({ enabled: e.target.checked }));
    el("setZone").addEventListener("change", (e) => Alerts.setConfig({ outOfZone: e.target.checked }));
    el("setCohesion").addEventListener("change", (e) => Alerts.setConfig({ cohesion: e.target.checked }));
    el("setBattery").addEventListener("change", (e) => {
      const v = Math.max(1, Math.min(100, Number(e.target.value) || 20));
      e.target.value = v;
      Alerts.setConfig({ lowBattery: v });
    });
    el("setImmobility").addEventListener("change", (e) => {
      const v = Math.max(1, Math.min(72, Number(e.target.value) || 6));
      e.target.value = v;
      Alerts.setConfig({ immobilityHours: v });
    });
    el("notifBtn").addEventListener("click", () => {
      if (!("Notification" in window)) return;
      Notification.requestPermission().then(updateNotifBtn);
    });

    // Onglet Alertes actif au chargement : consulter = marquer comme lu.
    setStatus(true, "Chargement…");
    refresh().then(() => Alerts.markAllRead());
    timer = setInterval(refresh, cfg.refreshInterval || 30000);
  }

  document.addEventListener("DOMContentLoaded", setup);
})();
