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
- ✅ **Camps** : page carto (carte + boutons de camps + ➕). Chaque camp a sa
  **géofence** (cercle rayon/campement déplaçable posé au doigt, ou **forme
  libre** polygone) et ses **chameaux affectés**. On voit HORS ZONE sur la carte
  si un chameau sort de son camp. **Entrer dans un camp** (bouton du camp)
  n'affiche que **ses chameaux** ; « 🗺️ Tous » réaffiche tout le troupeau.

> Le site a été volontairement **simplifié** : uniquement la **Carte** et les
> **Camps**. Les pages Tableau de bord / Chameaux / Déplacements / Alertes /
> Historique ont été retirées (récupérables dans l'historique git).

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
  index.html        carte temps réel (tous les chameaux)
  camps.html        camps (carte + boutons + géofence)
  config.js         configuration (URL Traccar, mode démo)
  css/style.css     thème désert, mobile-first
  js/
    api.js          appels API Traccar (+ données démo)
    map.js          carte Leaflet et marqueurs (partagé)
    app.js          logique : login, refresh, liste
    geofence.js     géométrie des zones (distance, in/out, status)
    camps.js        modèle des camps
    camps-ui.js     page des camps (carto)
  img/camel.svg     icône chameau
  manifest.json     PWA
  sw.js             service worker (cache tuiles + app shell)
```
