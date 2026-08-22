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

  // ---------- Repères nommés sur la carte (double-clic / Ctrl+M) ----------
  function setupPoints() {
    const m = CTMap.getMap();
    if (!m) return;
    m.doubleClickZoom.disable(); // double-clic = nommer un point (pas zoomer)
    m.on("dblclick", (e) => { if (Points.addPrompt(m, e.latlng)) toast("Repère ajouté"); });
    Points.render(m, true);
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "m" || e.key === "M")) {
        e.preventDefault();
        const map2 = CTMap.getMap();
        if (map2 && Points.addPrompt(map2, map2.getCenter())) toast("Repère ajouté");
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
