// geofence-ui.js — page de gestion des zones (rayon par chameau)
(() => {
  const cfg = window.CT_CONFIG || {};
  const el = (id) => document.getElementById(id);

  let map;
  let centerMarker = null; // marqueur campement (déplaçable)
  let circle = null; // cercle de la zone
  let camelMarker = null; // position actuelle du chameau
  let devices = [];
  let positions = {};
  let currentId = null;
  let draft = null; // { lat, lon, radiusKm, enabled }

  // ---------- Démarrage ----------
  async function boot() {
    map = CTMap.create("map");
    await loadData();

    el("device").addEventListener("change", () => selectCamel(el("device").value));
    el("radius").addEventListener("input", () => {
      draft.radiusKm = +el("radius").value;
      refreshCircle();
    });
    document.querySelectorAll(".gf-presets .chip").forEach((c) =>
      c.addEventListener("click", () => {
        draft.radiusKm = +c.dataset.km;
        el("radius").value = draft.radiusKm;
        refreshCircle();
      })
    );
    el("enabled").addEventListener("change", () => {
      draft.enabled = el("enabled").checked;
      refreshCircle();
    });
    el("centerBtn").addEventListener("click", centerOnCamel);
    el("saveBtn").addEventListener("click", save);

    if (devices.length) selectCamel(String(devices[0].id));
  }

  async function loadData() {
    try {
      devices = await API.getDevices();
      const pos = await API.getPositions();
      positions = {};
      pos.forEach((p) => (positions[p.deviceId] = p));
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

  // ---------- Sélection d'un chameau ----------
  function selectCamel(id) {
    currentId = String(id);
    const gf = Geofence.get(currentId);
    const pos = positions[currentId];
    // Centre par défaut : geofence existante, sinon position actuelle, sinon centre carte.
    const base =
      gf && gf.lat != null
        ? { lat: gf.lat, lon: gf.lon }
        : pos
        ? { lat: pos.latitude, lon: pos.longitude }
        : { lat: cfg.defaultCenter[0], lon: cfg.defaultCenter[1] };
    draft = {
      lat: base.lat,
      lon: base.lon,
      radiusKm: gf?.radiusKm ?? Geofence.DEFAULT_RADIUS_KM,
      enabled: gf?.enabled ?? true,
    };
    el("device").value = currentId;
    el("radius").value = draft.radiusKm;
    el("enabled").checked = draft.enabled;
    drawEditor();
  }

  // ---------- Dessin de l'éditeur sur la carte ----------
  function drawEditor() {
    [centerMarker, circle, camelMarker].forEach((l) => l && map.removeLayer(l));
    centerMarker = circle = camelMarker = null;

    // Cercle de zone
    circle = L.circle([draft.lat, draft.lon], {
      radius: draft.radiusKm * 1000,
      ...circleStyle(draft.enabled),
    }).addTo(map);

    // Marqueur du campement (déplaçable)
    centerMarker = L.marker([draft.lat, draft.lon], {
      draggable: true,
      icon: campIcon(),
      zIndexOffset: 1000,
    }).addTo(map);
    centerMarker.on("drag", (e) => {
      const ll = e.target.getLatLng();
      draft.lat = ll.lat;
      draft.lon = ll.lng;
      circle.setLatLng(ll);
      updateStatus();
    });

    // Position actuelle du chameau (repère)
    const pos = positions[currentId];
    if (pos) {
      camelMarker = L.marker([pos.latitude, pos.longitude], {
        icon: camelIcon(),
      })
        .addTo(map)
        .bindTooltip("Position actuelle", { direction: "top", offset: [0, -22] });
    }

    fit();
    updateLabel();
    updateStatus();
  }

  function refreshCircle() {
    if (circle) {
      circle.setLatLng([draft.lat, draft.lon]);
      circle.setRadius(draft.radiusKm * 1000);
      circle.setStyle(circleStyle(draft.enabled));
    }
    updateLabel();
    updateStatus();
  }

  function centerOnCamel() {
    const pos = positions[currentId];
    if (!pos) {
      toast("Position actuelle inconnue");
      return;
    }
    draft.lat = pos.latitude;
    draft.lon = pos.longitude;
    if (centerMarker) centerMarker.setLatLng([draft.lat, draft.lon]);
    refreshCircle();
    fit();
  }

  function save() {
    if (!currentId || !draft) return;
    Geofence.set(currentId, {
      lat: draft.lat,
      lon: draft.lon,
      radiusKm: draft.radiusKm,
      enabled: draft.enabled,
    });
    const d = devices.find((x) => String(x.id) === currentId);
    toast(`Zone enregistrée pour ${d ? d.name : "ce chameau"} (${draft.radiusKm} km)`);
  }

  // ---------- Statut / labels ----------
  function updateLabel() {
    el("radiusVal").textContent = draft.radiusKm;
  }

  function updateStatus() {
    const pos = positions[currentId];
    const box = el("gfStatus");
    if (!draft.enabled) {
      box.className = "gf-status none";
      box.textContent = "Alertes désactivées pour ce chameau";
      return;
    }
    if (!pos) {
      box.className = "gf-status none";
      box.textContent = "Position actuelle inconnue";
      return;
    }
    const d = Geofence.distanceKm(pos.latitude, pos.longitude, draft.lat, draft.lon);
    if (d > draft.radiusKm) {
      box.className = "gf-status outside";
      box.textContent = `HORS ZONE — à ${d.toFixed(1)} km du campement (limite ${draft.radiusKm} km)`;
    } else {
      box.className = "gf-status inside";
      box.textContent = `Dans la zone — à ${d.toFixed(1)} km du campement (limite ${draft.radiusKm} km)`;
    }
  }

  function fit() {
    if (circle) map.fitBounds(circle.getBounds().pad(0.2));
  }

  // ---------- Styles / icônes ----------
  function circleStyle(enabled) {
    const c = enabled ? "#4f8a3d" : "#9a9a9a";
    return {
      color: c,
      weight: 2,
      opacity: 0.9,
      fillColor: c,
      fillOpacity: 0.08,
      dashArray: "6 6",
    };
  }
  function campIcon() {
    return L.divIcon({
      className: "",
      html: `<div style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:var(--sable-clair);border:2px solid var(--marron);border-radius:50%;box-shadow:var(--ombre);font-size:16px">🏕️</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
  }
  function camelIcon() {
    return L.divIcon({
      className: "",
      html: `<div class="camel-marker"><img src="img/camel.svg" alt=""></div>`,
      iconSize: [42, 42],
      iconAnchor: [21, 21],
    });
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
