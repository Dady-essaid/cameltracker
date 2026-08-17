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
- ✅ **Camps (bases) + géofencing** : on crée des camps, chacun avec sa
  **géofence** (cercle avec rayon/campement déplaçable, ou **forme libre**
  polygone) et sa **liste de chameaux affectés**. Chaque camp a un **mode** :
  - `Au campement` : les chameaux doivent rester dans la zone du camp ;
  - `En déplacement` : la zone fixe est ignorée, on alerte si un chameau
    **s'éloigne du groupe** au-delà d'un seuil de cohésion (km) réglable —
    pratique pour un trajet d'un point à un autre.

  Règle unique : **un chameau appartient à un seul camp**, donc une seule règle
  s'applique (sortie de zone *ou* cohésion, jamais les deux).
- ✅ **Alertes / notifications** : cloche + panneau sur le site, avec quatre
  types d'alerte par chameau — **sortie de zone**, **éloignement du groupe**
  (mode déplacement), **immobilité prolongée** (seuil en heures) et **batterie
  faible** du tracker (seuil %). Seuils/toggles réglables, badge de non-lus,
  toast en direct, historique des alertes résolues, et notifications système du
  navigateur (facultatives).
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
  camps.html        gestion des camps (zones + affectation + mode)
  dashboard.html    tableau de bord (mini-carte + dispersion + alertes)
  config.js         configuration (URL Traccar, mode démo)
  css/style.css     thème désert, mobile-first
  js/
    api.js          appels API Traccar (+ données démo)
    map.js          carte Leaflet et marqueurs (partagé)
    app.js          logique : login, refresh, liste
    history.js      trajet, arrêts, lecture animée
    geofence.js     géométrie des zones (distance, in/out, status)
    camps.js        modèle des camps (affectation, statut, migration)
    camps-ui.js     page de gestion des camps
    alerts.js       module alertes (zone / groupe / immobilité / batterie)
    dashboard.js    tableau de bord
  img/camel.svg     icône chameau
  manifest.json     PWA
  sw.js             service worker (cache tuiles + app shell)
```
