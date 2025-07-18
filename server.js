const twilio = require('twilio');
const { getPool } = require('../db/init');

// Initialiser le client Twilio avec API Key
const client = twilio(process.env.TWILIO_API_KEY_SID, process.env.TWILIO_API_KEY_SECRET, {
  accountSid: process.env.TWILIO_MAIN_ACCOUNT_SID,
  httpProxy: process.env.http_proxy && process.env.http_proxy !== 'http_proxy' ? process.env.http_proxy : null,
  httpsProxy: process.env.https_proxy && process.env.https_proxy !== 'https_proxy' ? process.env.https_proxy : null
});

/**
 * Envoie un SMS via Twilio
 * @param {string} to - Numéro de téléphone destinataire (format international)
 * @param {string} message - Message à envoyer
 * @returns {Promise<Object>} - Résultat de l'envoi
 */
async function sendSMS(to, message) {
  try {
    // Vérifier que le numéro est au format international et valide
    if (!to.match(/^\+\d{10,15}$/)) {
      throw new Error(`Numéro de téléphone invalide: ${to}. Attendu format international (ex. +237677865607)`);
    }

    console.log(`Attempting to send SMS to ${to} with message: ${message}`);
    console.log(`Twilio config: Account SID=${process.env.TWILIO_MAIN_ACCOUNT_SID}, From=${process.env.TWILIO_PHONE_NUMBER}`);
    console.log(`Proxy config: http_proxy=${process.env.http_proxy || 'none'}, https_proxy=${process.env.https_proxy || 'none'}`);

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
    console.error(`❌ Erreur lors de l'envoi du SMS à ${to}:`, error.message, JSON.stringify(error, null, 2));
    return {
      success: false,
      error: error.message,
      errorDetails: error,
      to: to,
      message: message
    };
  }
}

/**
 * Envoie un SMS de notification de réservation à tous les utilisateurs
 * @param {string} nomSalle - Nom de la salle réservée
 * @param {string} date - Date de la réservation
 * @param {string} heureDebut - Heure de début
 * @param {string} heureFin - Heure de fin
 * @returns {Promise<Object>} - Résultat des envois
 */
async function sendReservationSMS(nomSalle, date, heureDebut, heureFin) {
  try {
    // Récupérer tous les utilisateurs depuis la base de données
    const pool = getPool();
    const userResult = await pool.query(`
      SELECT telephone, nom 
      FROM utilisateurs
    `);

    const users = userResult.rows;
    if (!users || users.length === 0) {
      console.warn('⚠️ Aucun utilisateur trouvé pour envoyer la notification de réservation');
      return {
        success: false,
        error: 'Aucun utilisateur trouvé',
        results: []
      };
    }

    const message = `🏢 Nouvelle réservation\n\nSalle: ${nomSalle}\nDate: ${date}\nHeure: ${heureDebut} - ${heureFin}\n\nUne nouvelle réservation a été créée dans le système.`;

    // Envoyer le SMS à chaque utilisateur
    const sendPromises = users.map(user => {
      const telephone = user.telephone;
      const nomUtilisateur = user.nom || 'Utilisateur';
      return sendSMS(telephone, message.replace('Utilisateur', nomUtilisateur));
    });

    const results = await Promise.all(sendPromises);
    const successes = results.filter(r => r.success).length;
    const failures = results.filter(r => !r.success);

    console.log(`📤 Envoi de SMS de réservation à ${users.length} utilisateurs: ${successes} réussis, ${failures.length} échoués`);

    return {
      success: successes > 0,
      results: results,
      summary: {
        total: users.length,
        successes: successes,
        failures: failures.length,
        failedNumbers: failures.map(f => ({ to: f.to, error: f.error }))
      }
    };
  } catch (error) {
    console.error('❌ Erreur lors de l\'envoi des SMS de réservation:', error.message, JSON.stringify(error, null, 2));
    return {
      success: false,
      error: error.message,
      errorDetails: error,
      results: []
    };
  }
}

/**
 * Envoie un SMS de confirmation de réservation à un seul utilisateur (utilisé pour les réservations prioritaires)
 * @param {string} telephone - Numéro de téléphone destinataire
 * @param {string} nomUtilisateur - Nom de l'utilisateur
 * @param {string} nomSalle - Nom de la salle réservée
 * @param {string} date - Date de la réservation
 * @param {string} heureDebut - Heure de début
 * @param {string} heureFin - Heure de fin
 * @returns {Promise<Object>} - Résultat de l'envoi
 */
async function sendSingleReservationSMS(telephone, nomUtilisateur, nomSalle, date, heureDebut, heureFin) {
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
async function testSMS(telephone = '+237655998106') {
  const message = `🧪 Test SMS - ${new Date().toLocaleString('fr-FR')}\n\nCeci est un message de test du système de réservation de salles de réunion.`;
  return await sendSMS(telephone, message);
}

module.exports = {
  sendSMS,
  sendReservationSMS,
  sendSingleReservationSMS,
  sendCancellationSMS,
  sendOutOfServiceSMS,
  sendPriorityReservationSMS,
  testSMS
};
