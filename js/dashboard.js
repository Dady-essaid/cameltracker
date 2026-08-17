// dashboard.js — tableau de bord : synthèse visuelle du troupeau
// Mini-carte (tous les chameaux + zones) + dispersion / plus éloigné du
// campement + alertes actives + état par chameau. Réutilise API, Geofence,
// Alerts et la carte partagée (CTMap). Rafraîchissement auto.
(() => {
  const cfg = window.CT_CONFIG || {};
  const el = (id) => document.getElementById(id);
  let devices = [];
  let positionsById = {};
  let statusById = {};
  let mapReady = false;
  let fitted = false;

  const ALERT_META = {
    zone: { icon: "📍", label: "Sortie de zone" },
    immobile: { icon: "💤", label: "Immobilité" },
    battery: { icon: "🔋", label: "Batterie faible" },
  };

  // --- utilitaires ---
  const esc = (s) => CTMap.escapeHtml(s);
  const timeAgo = (t) => CTMap.timeAgo(t);
  const isStale = (t) => CTMap.isStale(t);

  function setStatus(ok, text) {
    el("statusDot").className = "dot" + (ok ? "" : " off");
    el("statusText").textContent = text;
  }

  // ---------- Rafraîchissement ----------
  async function refresh() {
    try {
      devices = await API.getDevices();
      const positions = await API.getPositions();
      positionsById = {};
      for (const p of positions) positionsById[p.deviceId] = p;

      statusById = {};
      for (const d of devices) {
        const pos = positionsById[d.id];
        if (pos) {
          const st = Geofence.status(pos, Geofence.get(d.id));
          statusById[d.id] = st;
          if (mapReady) {
            CTMap.upsert(d, pos, { status: st });
            CTMap.setGeofence(d.id, Geofence.get(d.id), st.outside);
          }
        }
      }
      if (mapReady && !fitted) {
        CTMap.fitAll();
        fitted = true;
      }

      const ev = Alerts.evaluate(devices, positionsById, statusById);
      renderHerd();
      renderAlerts(ev.active);
      renderCamels(ev.active);
      setStatus(true, "à jour");
    } catch (e) {
      setStatus(false, "hors ligne");
      console.error(e);
    }
  }

  // ---------- Distance d'un chameau à son campement (cercle) ----------
  // Renvoie { km, radius, out } ou null (pas de zone cercle exploitable).
  function campDistance(deviceId) {
    const pos = positionsById[deviceId];
    const gf = Geofence.get(deviceId);
    if (!pos || !gf || !gf.enabled || gf.type === "polygon" || gf.lat == null) return null;
    const km = Geofence.distanceKm(pos.latitude, pos.longitude, gf.lat, gf.lon);
    return { km, radius: gf.radiusKm, out: km > gf.radiusKm };
  }

  // ---------- Synthèse du troupeau ----------
  function renderHerd() {
    const pts = [];
    for (const d of devices) {
      const p = positionsById[d.id];
      if (p) pts.push({ d, p });
    }

    // Étendue : plus grande distance entre deux chameaux.
    let spread = 0;
    let pair = null;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const km = Geofence.distanceKm(
          pts[i].p.latitude, pts[i].p.longitude,
          pts[j].p.latitude, pts[j].p.longitude
        );
        if (km > spread) {
          spread = km;
          pair = [pts[i].d.name, pts[j].d.name];
        }
      }
    }
    if (pts.length < 2) {
      el("herdSpread").textContent = "—";
      el("herdSpreadSub").textContent = pts.length ? "un seul chameau localisé" : "aucune position";
    } else {
      el("herdSpread").textContent = spread.toFixed(0) + " km";
      el("herdSpreadSub").textContent = pair ? `entre ${pair[0]} et ${pair[1]}` : "";
    }

    // Plus éloigné de son campement (zones cercle).
    let far = null;
    for (const { d } of pts) {
      const c = campDistance(d.id);
      if (c && (!far || c.km > far.km)) far = { name: d.name, ...c };
    }
    if (!far) {
      el("herdFar").textContent = "—";
      el("herdFar").className = "hs-val";
      el("herdFarSub").textContent = "aucun campement défini";
    } else {
      el("herdFar").textContent = far.name;
      el("herdFar").className = "hs-val" + (far.out ? " danger" : "");
      el("herdFarSub").textContent = `à ${far.km.toFixed(1)} km${
        far.out ? ` · hors zone (rayon ${far.radius} km)` : ` / ${far.radius} km`
      }`;
    }

    // Comptes inline.
    let online = 0;
    let outside = 0;
    for (const { d, p } of pts) {
      if (!isStale(p.deviceTime)) online++;
      const st = statusById[d.id];
      if (st && st.outside) outside++;
    }
    el("herdCounts").innerHTML =
      `<span>🐪 ${devices.length} chameaux</span>` +
      `<span>📡 ${online} en ligne</span>` +
      `<span class="${outside ? "danger" : ""}">📍 ${outside} hors zone</span>`;
  }

  function renderAlerts(activeAlerts) {
    const box = el("dashAlerts");
    if (!activeAlerts.length) {
      box.innerHTML = '<div class="dash-empty">Aucune alerte active. Tout va bien 🐪</div>';
      return;
    }
    box.innerHTML = activeAlerts
      .map((a) => {
        const m = ALERT_META[a.type] || { icon: "⚠️" };
        return `<div class="dash-alert ${a.type}">
          <span class="da-ic">${m.icon}</span>
          <span class="da-name">${esc(a.deviceName)}</span>
          <span class="da-msg">${esc(a.message)}</span>
          <span class="da-when">${timeAgo(a.since)}</span>
        </div>`;
      })
      .join("");
  }

  function renderCamels(activeAlerts) {
    const alertsByDevice = {};
    for (const a of activeAlerts) (alertsByDevice[a.deviceId] ||= []).push(a);

    // Tri : chameaux en alerte d'abord, puis les plus éloignés du campement.
    const sorted = [...devices].sort((a, b) => {
      const na = (alertsByDevice[a.id] || []).length;
      const nb = (alertsByDevice[b.id] || []).length;
      if (na !== nb) return nb - na;
      const da = campDistance(a.id)?.km ?? -1;
      const db = campDistance(b.id)?.km ?? -1;
      if (da !== db) return db - da;
      return String(a.name).localeCompare(String(b.name));
    });

    el("dashCamels").innerHTML = sorted
      .map((d) => {
        const pos = positionsById[d.id];
        const st = statusById[d.id];
        const bat = pos?.attributes?.batteryLevel;
        const kmh = pos?.speed != null ? (pos.speed * 1.852).toFixed(1) : "—";
        const stale = pos ? isStale(pos.deviceTime) : true;
        const badges = alertsByDevice[d.id] || [];
        const camp = campDistance(d.id);

        const zoneBadge =
          st && st.state === "outside"
            ? '<span class="db-badge out">HORS ZONE</span>'
            : st && st.state === "inside"
            ? '<span class="db-badge in">zone OK</span>'
            : "";

        const batClass = bat == null ? "" : bat < 25 ? "low" : bat < 50 ? "mid" : "";
        const batBar =
          bat == null
            ? '<span class="db-nobat">—</span>'
            : `<span class="db-bat ${batClass}"><span class="db-bat-fill" style="width:${Math.max(
                4, Math.min(100, bat)
              )}%"></span></span><span class="db-bat-val">${bat}%</span>`;

        const alertIcons = badges.map((a) => (ALERT_META[a.type] || {}).icon || "⚠️").join(" ");
        const campTxt = camp ? ` · ${camp.km.toFixed(1)} km du campement` : "";

        return `<div class="db-row${badges.length ? " has-alert" : ""}">
          <div class="db-main">
            <div class="db-name">${esc(d.name)} ${zoneBadge} ${
          alertIcons ? `<span class="db-alerticons">${alertIcons}</span>` : ""
        }</div>
            <div class="db-sub">${kmh} km/h${campTxt} · ${
          pos ? timeAgo(pos.deviceTime) : "aucun signal"
        }${stale && pos ? " · signal perdu" : ""}</div>
          </div>
          <div class="db-batwrap">${batBar}</div>
        </div>`;
      })
      .join("");
  }

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", () => {
    setStatus(true, "Chargement…");
    const m = CTMap.init();
    m.scrollWheelZoom.disable(); // laisser le scroll faire défiler la page
    mapReady = true;
    refresh();
    setInterval(refresh, cfg.refreshInterval || 30000);
  });
})();
