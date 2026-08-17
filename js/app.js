// app.js — logique principale : connexion, chargement, rafraîchissement
(() => {
  const cfg = window.CT_CONFIG || {};
  let devices = [];
  let positionsById = {};
  let statusById = {}; // deviceId -> statut géofence
  let timer = null;

  const el = (id) => document.getElementById(id);

  // ---------- Connexion ----------
  async function doLogin(email, password) {
    try {
      await API.login(email, password);
      el("login").style.display = "none";
      start();
    } catch (e) {
      el("loginErr").textContent =
        "Connexion échouée : " + (e.message || "vérifie tes identifiants.");
    }
  }

  function setupLogin() {
    // Mode démo : on saute l'écran de connexion.
    if (cfg.demo) {
      el("login").style.display = "none";
      el("demoBadge").style.display = "inline";
      start();
      return;
    }
    // Identifiants pré-remplis dans config.js
    if (cfg.email && cfg.password) {
      doLogin(cfg.email, cfg.password);
      return;
    }
    el("login").style.display = "flex";
    el("loginForm").addEventListener("submit", (ev) => {
      ev.preventDefault();
      doLogin(el("email").value.trim(), el("password").value);
    });
  }

  // ---------- Démarrage ----------
  async function start() {
    CTMap.init();
    setStatus(true, "Chargement…");
    await refresh(true);
    if (timer) clearInterval(timer);
    timer = setInterval(() => refresh(false), cfg.refreshInterval || 30000);
  }

  // ---------- Rafraîchissement des données ----------
  async function refresh(first) {
    try {
      if (first || !devices.length) devices = await API.getDevices();
      const positions = await API.getPositions();
      positionsById = {};
      for (const p of positions) positionsById[p.deviceId] = p;

      let online = 0;
      let outside = 0;
      for (const d of devices) {
        const pos = positionsById[d.id];
        if (pos) {
          const gf = Geofence.get(d.id);
          const st = Geofence.status(pos, gf);
          statusById[d.id] = st;
          CTMap.upsert(d, pos, { status: st });
          CTMap.setGeofence(d.id, gf, st.outside);
          if (!CTMap.isStale(pos.deviceTime)) online++;
          if (st.outside) outside++;
        }
      }
      renderList();

      // Alertes : sortie de zone, immobilité, batterie faible.
      const ev = Alerts.evaluate(devices, positionsById, statusById);
      renderAlerts();
      for (const a of ev.newly) {
        toast(`${ALERT_META[a.type].icon} ${a.deviceName} — ${a.message}`);
        notify(a);
      }

      const suffix = outside ? ` · ${outside} hors zone` : "";
      setStatus(true, `${online}/${devices.length} en ligne${suffix}`);
      if (first) CTMap.fitAll();
    } catch (e) {
      setStatus(false, "Hors ligne");
      toast("Erreur de connexion au serveur");
      console.error(e);
    }
  }

  // ---------- Liste des chameaux (panneau) ----------
  function renderList() {
    const list = el("list");
    list.innerHTML = "";
    for (const d of devices) {
      const pos = positionsById[d.id];
      const bat = pos?.attributes?.batteryLevel;
      const low = bat != null && bat < 25;
      const kmh = pos?.speed != null ? (pos.speed * 1.852).toFixed(1) : "—";
      const st = statusById[d.id];
      const zone =
        st && st.state === "outside"
          ? '<span class="zone-badge out">HORS ZONE</span>'
          : st && st.state === "inside"
          ? '<span class="zone-badge in">zone OK</span>'
          : "";
      const item = document.createElement("div");
      item.className = "camel-item";
      item.innerHTML = `
        <div class="ava"><img src="img/camel.svg" alt=""></div>
        <div class="meta">
          <div class="name">${CTMap.escapeHtml(d.name)} ${zone}</div>
          <div class="sub">${kmh} km/h · ${
        pos ? CTMap.timeAgo(pos.deviceTime) : "aucun signal"
      }</div>
        </div>
        <div class="bat ${low ? "low" : ""}">${bat != null ? bat + "%" : "—"}</div>`;
      item.addEventListener("click", () => {
        CTMap.focus(d.id);
        el("panel").classList.remove("open");
      });
      list.appendChild(item);
    }
    el("count").textContent = devices.length;
  }

  // ---------- Alertes (cloche + panneau) ----------
  const ALERT_META = {
    zone: { icon: "📍", label: "Sortie de zone" },
    immobile: { icon: "💤", label: "Immobilité" },
    battery: { icon: "🔋", label: "Batterie faible" },
  };

  function renderAlerts() {
    const items = Alerts.list();
    const unread = Alerts.unreadCount();

    // Badge de la cloche
    const badge = el("alertBadge");
    if (unread > 0) {
      badge.textContent = unread > 99 ? "99+" : unread;
      badge.hidden = false;
      el("bell").classList.add("has-unread");
    } else {
      badge.hidden = true;
      el("bell").classList.remove("has-unread");
    }

    // Liste
    const list = el("alertsList");
    if (!items.length) {
      list.innerHTML = '<div class="ap-empty">Aucune alerte. Tout va bien 🐪</div>';
      return;
    }
    list.innerHTML = items
      .map((a) => {
        const m = ALERT_META[a.type] || { icon: "⚠️", label: "Alerte" };
        const when = a.resolved
          ? `résolue ${CTMap.timeAgo(a.resolvedAt)}`
          : `depuis ${CTMap.timeAgo(a.since)}`;
        return `<div class="ap-item ${a.type}${a.resolved ? " resolved" : ""}${
          !a.resolved && !a.read ? " unread" : ""
        }" data-device="${a.deviceId}">
          <div class="ap-ic">${m.icon}</div>
          <div class="ap-body">
            <div class="ap-name">${CTMap.escapeHtml(a.deviceName)}</div>
            <div class="ap-msg">${CTMap.escapeHtml(a.message)}</div>
            <div class="ap-when">${when}</div>
          </div>
        </div>`;
      })
      .join("");
    // Clic sur une alerte : recentrer la carte sur le chameau + fermer.
    list.querySelectorAll(".ap-item").forEach((node) => {
      node.addEventListener("click", () => {
        CTMap.focus(Number(node.dataset.device));
        closeAlerts();
      });
    });
  }

  function openAlerts() {
    el("alertsPanel").hidden = false;
    Alerts.markAllRead();
    renderAlerts();
  }
  function closeAlerts() {
    el("alertsPanel").hidden = true;
    el("alertSettings").hidden = true;
  }

  // Notification système (si l'utilisateur l'a autorisée).
  function notify(a) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const m = ALERT_META[a.type] || { icon: "⚠️" };
    try {
      new Notification(`CamelTracker — ${a.deviceName}`, {
        body: `${m.icon} ${a.message}`,
        icon: "img/camel.svg",
        tag: a.id, // évite les doublons pour une même alerte
      });
    } catch {}
  }

  function setupAlertsUI() {
    el("bell").addEventListener("click", () => {
      if (el("alertsPanel").hidden) openAlerts();
      else closeAlerts();
    });
    el("alertCloseBtn").addEventListener("click", closeAlerts);
    el("alertMarkRead").addEventListener("click", () => {
      Alerts.markAllRead();
      renderAlerts();
    });
    el("alertClear").addEventListener("click", () => {
      Alerts.clearResolved();
      renderAlerts();
    });

    // Réglages
    const settings = el("alertSettings");
    el("alertSettingsBtn").addEventListener("click", () => {
      settings.hidden = !settings.hidden;
      if (!settings.hidden) fillSettings();
    });
    const cfgWrite = (patch) => {
      Alerts.setConfig(patch);
      renderAlerts();
    };
    el("alSetEnabled").addEventListener("change", (e) => cfgWrite({ enabled: e.target.checked }));
    el("alSetZone").addEventListener("change", (e) => cfgWrite({ outOfZone: e.target.checked }));
    el("alSetBattery").addEventListener("change", (e) => {
      const v = Math.max(1, Math.min(100, Number(e.target.value) || 20));
      e.target.value = v;
      cfgWrite({ lowBattery: v });
    });
    el("alSetImmobility").addEventListener("change", (e) => {
      const v = Math.max(1, Math.min(72, Number(e.target.value) || 6));
      e.target.value = v;
      cfgWrite({ immobilityHours: v });
    });
    el("alSetNotif").addEventListener("click", requestNotifPermission);
    updateNotifBtn();
  }

  function fillSettings() {
    const c = Alerts.config();
    el("alSetEnabled").checked = c.enabled;
    el("alSetZone").checked = c.outOfZone;
    el("alSetBattery").value = c.lowBattery;
    el("alSetImmobility").value = c.immobilityHours;
    updateNotifBtn();
  }

  function updateNotifBtn() {
    const btn = el("alSetNotif");
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

  function requestNotifPermission() {
    if (!("Notification" in window)) return;
    Notification.requestPermission().then(() => updateNotifBtn());
  }

  // ---------- UI ----------
  function setStatus(ok, text) {
    el("statusDot").className = "dot" + (ok ? "" : " off");
    el("statusText").textContent = text;
  }

  let toastTimer = null;
  function toast(msg) {
    const t = el("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
  }

  function setupUI() {
    el("panelHandle").addEventListener("click", () =>
      el("panel").classList.toggle("open")
    );
    el("recenter").addEventListener("click", () => CTMap.fitAll());
  }

  // ---------- PWA : service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () =>
      navigator.serviceWorker.register("sw.js").catch(() => {})
    );
  }

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", () => {
    setupUI();
    setupAlertsUI();
    setupLogin();
  });
})();
