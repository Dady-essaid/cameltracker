// history.js — historique des trajets : tracé, arrêts, lecture animée
(() => {
  const cfg = window.CT_CONFIG || {};
  const el = (id) => document.getElementById(id);

  let map;
  let routeLayer = null; // groupe de segments colorés
  let stopLayer = null; // groupe des cercles d'arrêt
  let endpoints = null; // marqueurs départ/arrivée
  let mover = null; // marqueur animé (playback)
  let positions = [];
  let playIdx = 0;
  let playTimer = null;
  let playing = false;
  let speedMult = 8;

  // ---------- Démarrage ----------
  async function boot() {
    map = CTMap.create("map");
    await loadDevices();
    applyRange("24h");

    el("showBtn").addEventListener("click", load);
    document.querySelectorAll("[data-range]").forEach((b) =>
      b.addEventListener("click", () => {
        applyRange(b.dataset.range);
        load();
      })
    );
    el("playBtn").addEventListener("click", togglePlay);
    el("scrub").addEventListener("input", () => seek(+el("scrub").value));
    el("speedSel").addEventListener("change", () => (speedMult = +el("speedSel").value));
    el("panelHandle").addEventListener("click", () =>
      el("panel").classList.toggle("open")
    );

    load();
  }

  async function loadDevices() {
    try {
      const devices = await API.getDevices();
      const sel = el("device");
      sel.innerHTML = "";
      devices.forEach((d) => {
        const o = document.createElement("option");
        o.value = d.id;
        o.textContent = d.name;
        sel.appendChild(o);
      });
    } catch (e) {
      toast("Erreur : chargement des chameaux");
      console.error(e);
    }
  }

  // ---------- Plages de dates ----------
  function applyRange(r) {
    const to = new Date();
    const from = new Date();
    if (r === "today") from.setHours(0, 0, 0, 0);
    else if (r === "24h") from.setDate(from.getDate() - 1);
    else if (r === "7j") from.setDate(from.getDate() - 7);
    el("from").value = toLocalInput(from);
    el("to").value = toLocalInput(to);
  }
  function toLocalInput(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
      d.getHours()
    )}:${p(d.getMinutes())}`;
  }

  // ---------- Chargement d'un trajet ----------
  async function load() {
    const deviceId = el("device").value;
    if (!deviceId) return;
    const from = new Date(el("from").value).toISOString();
    const to = new Date(el("to").value).toISOString();
    stopPlay();
    setStatus("Chargement…");
    try {
      let pts = await API.getRoute(deviceId, from, to);
      positions = (pts || []).filter(
        (p) => p.latitude != null && p.longitude != null
      );
      if (!positions.length) {
        clearLayers();
        setStatus("Aucune position sur cette période");
        el("stops").innerHTML =
          '<div class="empty">Aucun trajet sur cette période.</div>';
        return;
      }
      drawRoute();
      const stops = detectStops(positions);
      drawStops(stops);
      renderStops(stops);
      setupPlayback();
      fitRoute();
      setStatus(`${positions.length} points · ${totalKm().toFixed(1)} km`);
    } catch (e) {
      setStatus("Erreur de chargement");
      toast("Erreur : chargement du trajet");
      console.error(e);
    }
  }

  function clearLayers() {
    [routeLayer, stopLayer, endpoints, mover].forEach((l) => l && map.removeLayer(l));
    routeLayer = stopLayer = endpoints = mover = null;
  }

  // ---------- Tracé coloré par vitesse ----------
  function drawRoute() {
    clearLayers();
    const segs = [];
    for (let i = 1; i < positions.length; i++) {
      const a = positions[i - 1];
      const b = positions[i];
      const kmh = (b.speed || 0) * 1.852;
      segs.push(
        L.polyline(
          [
            [a.latitude, a.longitude],
            [b.latitude, b.longitude],
          ],
          { color: speedColor(kmh), weight: 4, opacity: 0.9 }
        )
      );
    }
    routeLayer = L.layerGroup(segs).addTo(map);

    const first = positions[0];
    const last = positions[positions.length - 1];
    endpoints = L.layerGroup([
      L.circleMarker([first.latitude, first.longitude], {
        radius: 8,
        color: "#fff",
        weight: 2,
        fillColor: "#4f8a3d",
        fillOpacity: 1,
      }).bindTooltip("Départ", { direction: "top" }),
      L.circleMarker([last.latitude, last.longitude], {
        radius: 8,
        color: "#fff",
        weight: 2,
        fillColor: "#b3492f",
        fillOpacity: 1,
      }).bindTooltip("Arrivée", { direction: "top" }),
    ]).addTo(map);
  }

  function speedColor(kmh) {
    if (kmh < 2) return "#3d6e8f"; // arrêt / très lent — bleu
    if (kmh < 6) return "#4f8a3d"; // marche — vert
    if (kmh < 12) return "#c9a227"; // trot — jaune
    return "#b3492f"; // rapide — rouge
  }

  function fitRoute() {
    if (routeLayer) {
      const b = L.latLngBounds(positions.map((p) => [p.latitude, p.longitude]));
      map.fitBounds(b.pad(0.15));
    }
  }

  // ---------- Détection des arrêts ----------
  function detectStops(pts, radiusM = 80, minMinutes = 15) {
    const stops = [];
    let i = 0;
    while (i < pts.length) {
      let j = i + 1;
      // étend le cluster tant que les points restent proches du premier
      while (j < pts.length && haversine(pts[i], pts[j]) <= radiusM) j++;
      const durMin =
        (new Date(pts[j - 1].deviceTime) - new Date(pts[i].deviceTime)) / 60000;
      if (j - i >= 2 && durMin >= minMinutes) {
        // centroïde
        const slice = pts.slice(i, j);
        const lat = slice.reduce((s, p) => s + p.latitude, 0) / slice.length;
        const lon = slice.reduce((s, p) => s + p.longitude, 0) / slice.length;
        stops.push({
          lat,
          lon,
          from: pts[i].deviceTime,
          to: pts[j - 1].deviceTime,
          minutes: Math.round(durMin),
        });
        i = j;
      } else {
        i++;
      }
    }
    return stops;
  }

  function drawStops(stops) {
    stopLayer = L.layerGroup(
      stops.map((s, idx) =>
        L.circleMarker([s.lat, s.lon], {
          radius: 10,
          color: "#6b4a2b",
          weight: 2,
          fillColor: "#e9dcc3",
          fillOpacity: 0.9,
        })
          .bindTooltip(`Arrêt ${idx + 1} · ${fmtDuration(s.minutes)}`, {
            direction: "top",
          })
          .bindPopup(
            `<div class="ct-popup"><h3>Arrêt ${idx + 1}</h3>
             <div class="row"><b>Durée</b><span>${fmtDuration(s.minutes)}</span></div>
             <div class="row"><b>Début</b><span>${fmtTime(s.from)}</span></div>
             <div class="row"><b>Fin</b><span>${fmtTime(s.to)}</span></div></div>`
          )
      )
    ).addTo(map);
  }

  function renderStops(stops) {
    const box = el("stops");
    if (!stops.length) {
      box.innerHTML = '<div class="empty">Aucun arrêt détecté (≥ 15 min).</div>';
      return;
    }
    box.innerHTML = "";
    stops.forEach((s, idx) => {
      const d = document.createElement("div");
      d.className = "stop-item";
      d.innerHTML = `<span class="badge">${idx + 1}</span>
        <div class="meta"><div class="dur">${fmtDuration(s.minutes)}</div>
        <div class="sub">${fmtTime(s.from)} → ${fmtTime(s.to)}</div></div>`;
      d.addEventListener("click", () =>
        map.setView([s.lat, s.lon], 15, { animate: true })
      );
      box.appendChild(d);
    });
  }

  // ---------- Lecture animée (playback) ----------
  function setupPlayback() {
    el("scrub").max = String(positions.length - 1);
    el("scrub").value = "0";
    playIdx = 0;
    const mk = camelMover();
    mover = L.marker([positions[0].latitude, positions[0].longitude], {
      icon: mk,
      zIndexOffset: 1000,
    }).addTo(map);
    updateTimeLabel();
    el("playBtn").textContent = "▶";
  }

  function camelMover() {
    return L.divIcon({
      className: "",
      html: `<div class="camel-marker"><img src="img/camel.svg" alt=""></div>`,
      iconSize: [42, 42],
      iconAnchor: [21, 21],
    });
  }

  function togglePlay() {
    if (!positions.length) return;
    playing ? stopPlay() : startPlay();
  }
  function startPlay() {
    if (playIdx >= positions.length - 1) playIdx = 0;
    playing = true;
    el("playBtn").textContent = "⏸";
    tick();
  }
  function stopPlay() {
    playing = false;
    if (playTimer) clearTimeout(playTimer);
    playTimer = null;
    el("playBtn").textContent = "▶";
  }
  function tick() {
    if (!playing) return;
    if (playIdx >= positions.length - 1) {
      stopPlay();
      return;
    }
    playIdx++;
    seek(playIdx, true);
    playTimer = setTimeout(tick, 500 / speedMult);
  }
  function seek(idx, fromPlay) {
    playIdx = Math.max(0, Math.min(idx, positions.length - 1));
    const p = positions[playIdx];
    if (mover) mover.setLatLng([p.latitude, p.longitude]);
    if (!fromPlay) el("scrub").value = String(playIdx);
    else el("scrub").value = String(playIdx);
    updateTimeLabel();
  }
  function updateTimeLabel() {
    const p = positions[playIdx];
    if (!p) return;
    const kmh = ((p.speed || 0) * 1.852).toFixed(1);
    el("playTime").textContent = `${fmtTime(p.deviceTime)} · ${kmh} km/h`;
  }

  // ---------- utilitaires ----------
  function haversine(a, b) {
    const R = 6371000;
    const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
    const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
    const la1 = (a.latitude * Math.PI) / 180;
    const la2 = (b.latitude * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function totalKm() {
    let m = 0;
    for (let i = 1; i < positions.length; i++)
      m += haversine(positions[i - 1], positions[i]);
    return m / 1000;
  }
  function fmtDuration(min) {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  function fmtTime(t) {
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(
      d.getMinutes()
    )}`;
  }
  function setStatus(txt) {
    el("statusText").textContent = txt;
  }
  let toastTimer;
  function toast(msg) {
    const t = el("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
