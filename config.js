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

  // Centre par défaut de la carte (Nouakchott, Mauritanie) + zoom.
  defaultCenter: [18.0735, -15.9582],
  defaultZoom: 6,
};
