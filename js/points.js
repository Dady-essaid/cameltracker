// points.js — repères nommés partagés (localStorage), affichés sur les cartes.
const Points = (() => {
  const KEY = "ct_points";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const save = (a) => localStorage.setItem(KEY, JSON.stringify(a));

  function add(name, latlng) {
    const a = load();
    a.push({ id: "pt_" + Date.now().toString(36), name, lat: latlng.lat, lon: latlng.lng });
    save(a);
    return a;
  }
  function remove(id) { save(load().filter((p) => p.id !== id)); }

  function icon() {
    return L.divIcon({ className: "", html: '<div class="landmark">📍</div>', iconSize: [26, 30], iconAnchor: [13, 30] });
  }

  let layers = [];
  // Dessine tous les repères sur la carte. interactive=true : clic = supprimer.
  function render(map, interactive) {
    if (!map) return;
    layers.forEach((l) => map.removeLayer(l));
    layers = [];
    for (const p of load()) {
      const mk = L.marker([p.lat, p.lon], { icon: icon(), interactive: interactive !== false })
        .addTo(map)
        .bindTooltip(p.name, { permanent: true, direction: "top", offset: [0, -26], className: "point-label" });
      if (interactive !== false) {
        mk.on("click", () => {
          if (confirm(`Supprimer le repère « ${p.name} » ?`)) { remove(p.id); render(map, interactive); }
        });
      }
      layers.push(mk);
    }
  }

  // Demande un nom puis ajoute le repère à cette position.
  function addPrompt(map, latlng, interactive) {
    const name = (prompt("Nom du repère (ex. Puits, Campement, Village) :") || "").trim();
    if (!name) return null;
    add(name, latlng);
    render(map, interactive);
    return name;
  }

  return { load, save, add, remove, render, addPrompt, icon };
})();
