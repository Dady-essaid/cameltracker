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

  // Centre par défaut : Hodh El Gharbi (Aïoun el Atrous) + zoom.
  defaultCenter: [16.5, -9.7],
  defaultZoom: 8,

  // Zoom minimum (empêche de trop dézoomer et de perdre la Mauritanie).
  minZoom: 6,

  // Limites de la carte : la Mauritanie uniquement (SO puis NE).
  // Impossible de faire glisser la carte hors de ces frontières.
  bounds: [
    [14.5, -17.5], // sud-ouest
    [27.5, -4.5],  // nord-est
  ],
};
