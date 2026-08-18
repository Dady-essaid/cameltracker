// nav.js — menu de navigation partagé (bouton ☰ + tiroir latéral).
// Injecté sur toutes les pages : centralise l'accès à toutes les sections.
(() => {
  const PAGES = [
    { href: "index.html", icon: "🗺️", label: "Carte" },
    { href: "dashboard.html", icon: "📊", label: "Tableau de bord" },
    { href: "chameaux.html", icon: "🐫", label: "Chameaux" },
    { href: "camps.html", icon: "🏕️", label: "Camps" },
    { href: "trips.html", icon: "🧭", label: "Déplacements" },
    { href: "notifications.html", icon: "🔔", label: "Alertes" },
    { href: "history.html", icon: "🕘", label: "Historique" },
  ];

  function currentFile() {
    let f = location.pathname.split("/").pop();
    if (!f || !f.length) f = "index.html";
    if (f === "camel.html") f = "chameaux.html"; // le profil relève de « Chameaux »
    return f;
  }

  function build() {
    const header = document.querySelector("header");
    if (!header || header.querySelector(".nav-toggle")) return;

    const btn = document.createElement("button");
    btn.className = "nav-toggle";
    btn.type = "button";
    btn.setAttribute("aria-label", "Menu");
    btn.innerHTML = "<span></span><span></span><span></span>";
    header.insertBefore(btn, header.firstChild);

    const scrim = document.createElement("div");
    scrim.className = "drawer-scrim";

    const drawer = document.createElement("nav");
    drawer.className = "drawer";
    const cur = currentFile();
    const unread = (typeof Alerts !== "undefined" && Alerts.unreadCount && Alerts.unreadCount()) || 0;
    drawer.innerHTML =
      `<div class="drawer-head"><img src="img/camel.svg" alt=""><b>CamelTracker</b></div>` +
      `<div class="drawer-links">` +
      PAGES.map((p) => {
        const active = p.href === cur ? " active" : "";
        const badge =
          p.href === "notifications.html" && unread
            ? `<span class="dl-badge">${unread > 99 ? "99+" : unread}</span>`
            : "";
        return `<a href="${p.href}" class="drawer-link${active}"><span class="dl-ic">${p.icon}</span><span class="dl-label">${p.label}</span>${badge}</a>`;
      }).join("") +
      `</div>`;

    document.body.appendChild(scrim);
    document.body.appendChild(drawer);

    const open = () => { drawer.classList.add("open"); scrim.classList.add("show"); };
    const close = () => { drawer.classList.remove("open"); scrim.classList.remove("show"); };
    btn.addEventListener("click", open);
    scrim.addEventListener("click", close);
    drawer.querySelectorAll(".drawer-link.active").forEach((a) =>
      a.addEventListener("click", (e) => { e.preventDefault(); close(); })
    );
  }

  document.addEventListener("DOMContentLoaded", build);
})();
