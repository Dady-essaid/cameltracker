// CamelTracker — configuration
// Modifie ces valeurs quand ton serveur Traccar est en ligne.
window.CT_CONFIG = {
  // URL de base de ton serveur Traccar (sans slash final).
  // Exemple : "https://tracker.mondomaine.com" ou "http://IP_DU_VPS:8082"
  traccarUrl: "",

  // Identifiants Traccar (email + mot de passe du compte Traccar).
  // Laisse vide pour saisir manuellement dans l'interface.
  email: "",
  password: "",

  // Mode démo : true = données fictives pour tester l'interface sans serveur.
  // Passe à false une fois ton serveur Traccar configuré.
  demo: true,

  // Rafraîchissement de la carte (millisecondes).
  refreshInterval: 30000,

  // Vue d'ouverture : Hodh El Gharbi (Aïoun el Atrous) + zoom.
  // La carte s'ouvre ici, mais tu peux te déplacer librement vers les autres
  // pays (utile si un chameau franchit la frontière — jusqu'à 100 km).
  defaultCenter: [16.5, -9.7],
  defaultZoom: 8,

  // Zoom arrière minimum (3 = vue régionale/continentale, aucune limite de
  // déplacement : on peut suivre un chameau au Mali ou ailleurs).
  minZoom: 3,
};
