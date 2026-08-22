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
    setupPoints();
    setStatus(true, "Chargement…");
    await refresh(true);
    if (timer) clearInterval(timer);
    timer = setInterval(() => refresh(false), cfg.refreshInterval || 30000);
  }

  // ---------- Repères nommés sur la carte ----------
  const POINTS_KEY = "ct_points";
  let pointLayers = [];
  const loadPoints = () => { try { return JSON.parse(localStorage.getItem(POINTS_KEY)) || []; } catch { return []; } };
  const savePoints = (a) => localStorage.setItem(POINTS_KEY, JSON.stringify(a));

  function landmarkIcon() {
    return L.divIcon({ className: "", html: '<div class="landmark">📍</div>', iconSize: [26, 30], iconAnchor: [13, 30] });
  }
  function renderPoints() {
    const m = CTMap.getMap();
    if (!m) return;
    pointLayers.forEach((l) => m.removeLayer(l));
    pointLayers = [];
    for (const p of loadPoints()) {
      const mk = L.marker([p.lat, p.lon], { icon: landmarkIcon() })
        .addTo(m)
        .bindTooltip(p.name, { permanent: true, direction: "top", offset: [0, -26], className: "point-label" });
      mk.on("click", () => {
        if (confirm(`Supprimer le repère « ${p.name} » ?`)) {
          savePoints(loadPoints().filter((x) => x.id !== p.id));
          renderPoints();
        }
      });
      pointLayers.push(mk);
    }
  }
  function addPointAt(latlng) {
    const name = (prompt("Nom du repère (ex. Puits, Campement, Village) :") || "").trim();
    if (!name) return;
    const pts = loadPoints();
    pts.push({ id: "pt_" + Date.now().toString(36), name, lat: latlng.lat, lon: latlng.lng });
    savePoints(pts);
    renderPoints();
    toast(`Repère « ${name} » ajouté`);
  }
  function setupPoints() {
    const m = CTMap.getMap();
    if (!m) return;
    m.doubleClickZoom.disable(); // double-clic = nommer un point (pas zoomer)
    m.on("dblclick", (e) => addPointAt(e.latlng));
    renderPoints();
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "m" || e.key === "M")) {
        e.preventDefault();
        const map2 = CTMap.getMap();
        if (map2) addPointAt(map2.getCenter());
      }
    });
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
          const st = Camps.statusFor(d.id, positionsById);
          statusById[d.id] = st;
          CTMap.upsert(d, pos, { status: st });
          if (!CTMap.isStale(pos.deviceTime)) online++;
          if (st.outside) outside++;
        }
      }
      CTMap.renderCamps(Camps.all(), positionsById, statusById);
      renderList();

      const suffix = outside ? ` · ${outside} hors zone` : "";
      setStatus(true, `${online}/${devices.length} en ligne${suffix}`);
      if (first) {
        const fid = Number(new URLSearchParams(location.search).get("focus"));
        if (fid && positionsById[fid]) CTMap.focus(fid);
        else CTMap.fitAll();
      }
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

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", () => {
    setupUI();
    setupLogin();
  });
})();
