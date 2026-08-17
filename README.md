# CamelTracker 🐪

Suivi GPS des chameaux en temps réel (Mauritanie). Application web légère et
responsive (mobile-first, PWA) qui affiche la position des chameaux sur une
carte satellite, à partir d'un serveur **Traccar**.

> Projet indépendant — aucun lien avec d'autres applications.

## État actuel (MVP)

- ✅ Carte satellite plein écran (Leaflet + Esri World Imagery)
- ✅ Position en temps réel de chaque chameau (marqueur + nom)
- ✅ Détails au clic : vitesse, batterie, dernier signal, coordonnées
- ✅ Liste des chameaux (panneau coulissant) + recentrage
- ✅ Rafraîchissement automatique (30 s par défaut)
- ✅ Connexion Traccar (session) + **mode démo** sans serveur
- ✅ PWA : installable sur l'écran d'accueil, cache des tuiles hors ligne
- ✅ **Historique des trajets** : sélection chameau + dates, tracé coloré par
  vitesse, points d'arrêt (durée), lecture animée (playback x4–x32)
- ✅ **Camps (bases sédentaires)** : page carto (carte + boutons de camps + ➕).
  Chaque camp a sa **géofence** (cercle rayon/campement déplaçable, ou **forme
  libre** polygone dessinée en plein écran) et ses **chameaux affectés**. On
  alerte si un chameau sort de la zone de son camp.
- ✅ **Déplacements (transhumance)** : page séparée. On désigne le **GPS du
  berger** (le tracker qu'il porte), on affecte les chameaux et un seuil (km),
  avec un cycle **Démarrer / Terminer**. Tant qu'il est actif, on alerte si un
  chameau **s'éloigne du berger** au-delà du seuil.

  Règle unique par chameau : un **déplacement actif prime** sur le camp — donc
  jamais deux règles à la fois (sortie de zone *ou* éloignement du berger).
- ✅ **Alertes / notifications** : page dédiée (onglets Alertes / Réglages) +
  cloche avec badge sur la carte. Quatre types par chameau — **sortie de zone**,
  **éloignement du berger** (déplacement), **immobilité prolongée** (seuil h) et
  **batterie faible** (seuil %). Seuils/toggles réglables, toast en direct,
  historique des alertes résolues, notifications système du navigateur
  (facultatives). *Push téléphone hors-site : nécessite un serveur (Traccar ou
  bot) — à venir.*
- ✅ **Tableau de bord** : synthèse du troupeau — mini-carte (tous les
  chameaux + zones d'un coup d'œil), **dispersion** (étendue du troupeau) et
  **chameau le plus éloigné de son campement**, alertes actives, et état par
  chameau (distance au campement, batterie, vitesse, signal) ; rafraîchi
  automatiquement.

## Démarrer en local

Aucune installation. Il faut juste servir le dossier en HTTP (le service worker
et les appels réseau ne marchent pas en `file://`).

```bash
# Python
python -m http.server 8000
# ou Node
npx serve .
```

Puis ouvre http://localhost:8000

Par défaut, l'app démarre en **mode démo** (chameaux fictifs). Pour brancher ton
vrai serveur, édite `config.js` :

```js
window.CT_CONFIG = {
  traccarUrl: "http://IP_DU_VPS:8082", // ton serveur Traccar
  demo: false,                          // désactive le mode démo
  refreshInterval: 30000,
};
```

## Brancher Traccar (rappel)

- Serveur Traccar sur un VPS, port device **5093** (protocole *watch* du RF-V44).
- L'API REST est sur le port **8082** (par défaut).
- CORS : autorise l'origine du site dans `traccar.xml` si le site et l'API sont
  sur des domaines différents (`web.origin`).
- SMS de config du tracker :
  - `apn,internet#`
  - `ip,IP_DU_SERVEUR,5093#`
  - `upload,1800#` (position toutes les 30 min)

## Structure

```
cameltracker/
  index.html        carte temps réel (MVP)
  history.html      historique des trajets + playback
  camps.html        camps sédentaires (carte + boutons + géofence)
  trips.html        déplacements (GPS berger + démarrer/terminer)
  notifications.html page Alertes (liste + réglages, onglets)
  dashboard.html    tableau de bord (mini-carte + dispersion + alertes)
  config.js         configuration (URL Traccar, mode démo)
  css/style.css     thème désert, mobile-first
  js/
    api.js          appels API Traccar (+ données démo)
    map.js          carte Leaflet et marqueurs (partagé)
    app.js          logique : login, refresh, liste
    history.js      trajet, arrêts, lecture animée
    geofence.js     géométrie des zones (distance, in/out, status)
    camps.js        modèle des camps (sédentaires)
    camps-ui.js     page des camps (carto)
    trips.js        modèle des déplacements (berger, démarrer/terminer)
    trips-ui.js     page des déplacements
    rules.js        règle unique par chameau (déplacement actif > camp)
    alerts.js       module alertes (zone / berger / immobilité / batterie)
    notifications.js page Alertes (liste + réglages)
    dashboard.js    tableau de bord
  img/camel.svg     icône chameau
  manifest.json     PWA
  sw.js             service worker (cache tuiles + app shell)
```
