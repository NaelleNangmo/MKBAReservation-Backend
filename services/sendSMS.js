const twilio = require('twilio');

// Initialiser le client Twilio avec API Key
const client = twilio(process.env.TWILIO_API_KEY_SID, process.env.TWILIO_API_KEY_SECRET, {
  accountSid: process.env.TWILIO_MAIN_ACCOUNT_SID
});

/**
 * Envoie un SMS via Twilio
 * @param {string} to - Numéro de téléphone destinataire (format international)
 * @param {string} message - Message à envoyer
 * @returns {Promise<Object>} - Résultat de l'envoi
 */
async function sendSMS(to, message) {
  try {
    // Vérifier que le numéro est au format international
    if (!to.startsWith('+')) {
      throw new Error('Le numéro de téléphone doit être au format international (+237...)');
    }

    const result = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to
    });

    console.log(`✅ SMS envoyé avec succès à ${to}. SID: ${result.sid}`);
    return {
      success: true,
      sid: result.sid,
      to: to,
      message: message
    };
  } catch (error) {
    console.error(`❌ Erreur lors de l'envoi du SMS à ${to}:`, error.message);
    return {
      success: false,
      error: error.message,
      to: to,
      message: message
    };
  }
}

/**
 * Envoie un SMS de notification de réservation
 */
async function sendReservationSMS(telephone, nomUtilisateur, nomSalle, date, heureDebut, heureFin) {
  const message = `🏢 Réservation confirmée!\n\nUtilisateur: ${nomUtilisateur}\nSalle: ${nomSalle}\nDate: ${date}\nHeure: ${heureDebut} - ${heureFin}\n\nMerci d'utiliser notre système de réservation.`;
  return await sendSMS(telephone, message);
}

/**
 * Envoie un SMS d'annulation de réservation
 */
async function sendCancellationSMS(telephone, nomUtilisateur, nomSalle, date, heureDebut, heureFin) {
  const message = `❌ Réservation annulée\n\nUtilisateur: ${nomUtilisateur}\nSalle: ${nomSalle}\nDate: ${date}\nHeure: ${heureDebut} - ${heureFin}\n\nVotre réservation a été annulée avec succès.`;
  return await sendSMS(telephone, message);
}

/**
 * Envoie un SMS de notification de salle hors service
 */
async function sendOutOfServiceSMS(telephone, nomUtilisateur, nomSalle) {
  const message = `⚠️ Salle hors service\n\nBonjour ${nomUtilisateur},\n\nLa salle "${nomSalle}" est temporairement hors service. Vos réservations ont été automatiquement annulées.\n\nVeuillez nous excuser pour la gêne occasionnée.`;
  return await sendSMS(telephone, message);
}

/**
 * Envoie un SMS de réservation prioritaire (admin)
 */
async function sendPriorityReservationSMS(telephone, nomUtilisateur, nomSalle, date, heureDebut, heureFin) {
  const message = `🔄 Réservation modifiée\n\nBonjour ${nomUtilisateur},\n\nVotre réservation pour la salle "${nomSalle}" le ${date} de ${heureDebut} à ${heureFin} a été annulée pour cause de réservation prioritaire.\n\nNous nous excusons pour ce désagrément.`;
  return await sendSMS(telephone, message);
}

/**
 * Teste l'envoi d'un SMS
 */
async function testSMS(telephone = '+237655000000') {
  const message = `🧪 Test SMS - ${new Date().toLocaleString('fr-FR')}\n\nCeci est un message de test du système de réservation de salles de réunion.`;
  return await sendSMS(telephone, message);
}

module.exports = {
  sendSMS,
  sendReservationSMS,
  sendCancellationSMS,
  sendOutOfServiceSMS,
  sendPriorityReservationSMS,
  testSMS
};