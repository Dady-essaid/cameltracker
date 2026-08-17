// alerts.js — module partagé d'ALERTES / NOTIFICATIONS
// Détecte trois conditions par chameau, à chaque rafraîchissement :
//   - "zone"     : sortie de la zone de géofencing
//   - "immobile" : immobilité prolongée (aucun déplacement depuis X heures)
//   - "battery"  : batterie faible du tracker (sous un seuil %)
// Les alertes sont dédupliquées (une par condition et par chameau), persistées
// en localStorage, et gardées un temps après résolution pour l'historique.
// Aucune dépendance backend ; réutilise Geofence.distanceKm pour la distance.
const Alerts = (() => {
  const CFG_KEY = "ct_alert_cfg";
  const STATE_KEY = "ct_alert_state";

  // Seuils par défaut (modifiables via l'interface).
  const DEFAULTS = {
    enabled: true,
    outOfZone: true, // alerte de sortie de zone (camp au campement)
    cohesion: true, // alerte « s'éloigne du groupe » (camp en déplacement)
    lowBattery: 20, // % : alerte si la batterie descend à/sous cette valeur
    immobilityHours: 6, // h : alerte si immobile depuis ce nombre d'heures
  };

  const STALE_MS = 2 * 3600 * 1000; // position trop vieille (> 2 h) = pas d'alerte immobilité
  const MOVE_THRESHOLD_M = 40; // déplacement mini pour être considéré « en mouvement »
  const KEEP_RESOLVED_MS = 24 * 3600 * 1000; // durée de conservation des alertes résolues
  const MAX_RESOLVED = 40; // nombre max d'alertes résolues gardées

  // ---------- Persistance ----------
  function config() {
    try {
      return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(CFG_KEY)) || {}) };
    } catch {
      return { ...DEFAULTS };
    }
  }
  function setConfig(patch) {
    const next = { ...config(), ...patch };
    localStorage.setItem(CFG_KEY, JSON.stringify(next));
    return next;
  }

  function state() {
    try {
      const s = JSON.parse(localStorage.getItem(STATE_KEY)) || {};
      s.alerts = s.alerts || {};
      s.motion = s.motion || {};
      return s;
    } catch {
      return { alerts: {}, motion: {} };
    }
  }
  function save(s) {
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
  }

  // ---------- Détection du mouvement (pour l'immobilité) ----------
  // Renvoie le timestamp (ms) du dernier déplacement significatif du chameau.
  function lastMoveAt(s, deviceId, pos) {
    const now = Date.now();
    // Indice éventuel fourni par la source de données (démo, ou Traccar évolué) :
    // timestamp du dernier mouvement connu.
    if (pos.attributes && pos.attributes.lastMotionAt) {
      const at = new Date(pos.attributes.lastMotionAt).getTime();
      if (!Number.isNaN(at)) {
        s.motion[deviceId] = { lat: pos.latitude, lon: pos.longitude, at };
        return at;
      }
    }
    const rec = s.motion[deviceId];
    if (!rec) {
      s.motion[deviceId] = { lat: pos.latitude, lon: pos.longitude, at: now };
      return now;
    }
    const distM =
      Geofence.distanceKm(rec.lat, rec.lon, pos.latitude, pos.longitude) * 1000;
    if (distM > MOVE_THRESHOLD_M) {
      s.motion[deviceId] = { lat: pos.latitude, lon: pos.longitude, at: now };
      return now;
    }
    return rec.at; // n'a pas bougé depuis rec.at
  }

  // ---------- Cycle de vie d'une alerte ----------
  function raise(s, type, deviceId, deviceName, message) {
    const id = type + ":" + deviceId;
    const now = Date.now();
    let a = s.alerts[id];
    let isNew = false;
    if (!a || a.resolved) {
      a = { id, type, deviceId, deviceName, since: now, read: false };
      isNew = true;
    }
    a.deviceName = deviceName;
    a.message = message;
    a.lastSeen = now;
    a.resolved = false;
    a.resolvedAt = null;
    s.alerts[id] = a;
    return isNew;
  }
  function resolve(s, type, deviceId) {
    const a = s.alerts[type + ":" + deviceId];
    if (a && !a.resolved) {
      a.resolved = true;
      a.resolvedAt = Date.now();
    }
  }

  // Purge les alertes résolues trop anciennes / en surnombre.
  function prune(s) {
    const now = Date.now();
    let resolved = Object.values(s.alerts).filter((a) => a.resolved);
    for (const a of resolved) {
      if (now - (a.resolvedAt || 0) > KEEP_RESOLVED_MS) delete s.alerts[a.id];
    }
    resolved = Object.values(s.alerts)
      .filter((a) => a.resolved)
      .sort((x, y) => (y.resolvedAt || 0) - (x.resolvedAt || 0));
    for (const a of resolved.slice(MAX_RESOLVED)) delete s.alerts[a.id];
  }

  // ---------- Évaluation (appelée à chaque rafraîchissement) ----------
  // devices : liste des chameaux ; positionsById : {deviceId: position} ;
  // statusById : {deviceId: résultat Geofence.status()}.
  // Renvoie { active: [...], newly: [...] } (newly = alertes déclenchées à l'instant).
  function evaluate(devices, positionsById, statusById) {
    const cfg = config();
    const s = state();
    const newly = [];

    if (!cfg.enabled) {
      // Alertes désactivées : on ne fait que résoudre l'existant.
      for (const a of Object.values(s.alerts)) resolve(s, a.type, a.deviceId);
      prune(s);
      save(s);
      return { active: active(), newly: [] };
    }

    const now = Date.now();
    for (const d of devices) {
      const pos = positionsById[d.id];
      const name = d.name;
      if (!pos) {
        // Pas de position : rien de neuf, on laisse les alertes en l'état.
        continue;
      }
      const stale = now - new Date(pos.deviceTime).getTime() > STALE_MS;

      // 1) Batterie faible
      const bat = pos.attributes && pos.attributes.batteryLevel;
      if (bat != null && bat <= cfg.lowBattery) {
        if (raise(s, "battery", d.id, name, `Batterie faible — ${bat}%`)) newly.push("battery:" + d.id);
      } else {
        resolve(s, "battery", d.id);
      }

      // 2) Position vis-à-vis du camp : sortie de zone (mode campement) OU
      //    éloignement du groupe (mode déplacement) — jamais les deux à la fois,
      //    car le statut d'un chameau ne porte qu'un seul type.
      const st = statusById[d.id];
      if (st && st.type === "trip") {
        if (cfg.cohesion && st.outside) {
          const detail =
            st.distanceKm != null ? ` (à ${st.distanceKm.toFixed(1)} km du berger)` : "";
          if (raise(s, "cohesion", d.id, name, `S'éloigne du berger${detail}`))
            newly.push("cohesion:" + d.id);
        } else {
          resolve(s, "cohesion", d.id);
        }
        resolve(s, "zone", d.id);
      } else {
        if (cfg.outOfZone && st && st.outside) {
          const detail =
            st.distanceKm != null ? ` (à ${st.distanceKm.toFixed(1)} km du campement)` : "";
          if (raise(s, "zone", d.id, name, `Sortie de zone${detail}`)) newly.push("zone:" + d.id);
        } else {
          resolve(s, "zone", d.id);
        }
        resolve(s, "cohesion", d.id);
      }

      // 3) Immobilité prolongée (ignorée si la position est périmée : plutôt un
      //    problème de signal/batterie qu'une réelle immobilité).
      const moveAt = lastMoveAt(s, d.id, pos);
      const stillMs = now - moveAt;
      const thresholdMs = cfg.immobilityHours * 3600 * 1000;
      if (!stale && stillMs >= thresholdMs) {
        const h = Math.floor(stillMs / 3600000);
        if (raise(s, "immobile", d.id, name, `Immobile depuis ${h} h`)) newly.push("immobile:" + d.id);
      } else {
        resolve(s, "immobile", d.id);
      }
    }

    prune(s);
    save(s);
    const newlyAlerts = newly.map((id) => s.alerts[id]).filter(Boolean);
    return { active: active(), newly: newlyAlerts };
  }

  // ---------- Lecture ----------
  function all() {
    return Object.values(state().alerts);
  }
  function active() {
    return all()
      .filter((a) => !a.resolved)
      .sort((x, y) => y.since - x.since);
  }
  // Liste pour l'affichage : actives (récentes d'abord) puis résolues récentes.
  function list() {
    const act = active();
    const res = all()
      .filter((a) => a.resolved)
      .sort((x, y) => (y.resolvedAt || 0) - (x.resolvedAt || 0));
    return [...act, ...res];
  }
  function unreadCount() {
    return active().filter((a) => !a.read).length;
  }

  // ---------- Actions ----------
  function markAllRead() {
    const s = state();
    for (const a of Object.values(s.alerts)) a.read = true;
    save(s);
  }
  function clearResolved() {
    const s = state();
    for (const a of Object.values(s.alerts)) if (a.resolved) delete s.alerts[a.id];
    save(s);
  }

  return {
    config,
    setConfig,
    evaluate,
    list,
    active,
    unreadCount,
    markAllRead,
    clearResolved,
    DEFAULTS,
  };
})();
