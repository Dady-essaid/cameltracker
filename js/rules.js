// rules.js — résolution de la règle unique appliquée à un chameau.
// Priorité : un déplacement ACTIF prime sur le camp. Ainsi un chameau n'a
// jamais deux règles de position en même temps (pas de croisement).
const Rules = (() => {
  function statusFor(deviceId, positionsById) {
    const trip = Trips.statusFor(deviceId, positionsById);
    if (trip) return trip; // membre d'un déplacement actif
    return Camps.statusFor(deviceId, positionsById); // sinon, la zone de son camp
  }
  return { statusFor };
})();
