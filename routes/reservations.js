const express = require('express');
const Joi = require('joi');
const { getPool } = require('../db/init');
const { authenticateToken, requireAdmin, requireOwnershipOrAdmin } = require('../middleware/auth');
const { sendReservationSMS, sendSingleReservationSMS, sendCancellationSMS, sendPriorityReservationSMS } = require('../services/sendSMS');

const router = express.Router();

// Schéma de validation pour une réservation
const reservationSchema = Joi.object({
  salle_id: Joi.number().integer().positive().required(),
  date: Joi.date().iso().required(),
  heure_debut: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
  heure_fin: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
  motif: Joi.string().max(500).optional()
});

// Fonction pour vérifier les conflits de réservation
async function checkReservationConflict(pool, salle_id, date, heure_debut, heure_fin, excludeReservationId = null) {
  let query = `
    SELECT id FROM reservations 
    WHERE salle_id = $1 
      AND date = $2 
      AND statut = 'active'
      AND (
        (heure_debut < $4 AND heure_fin > $3) OR
        (heure_debut < $4 AND heure_fin > $4) OR
        (heure_debut >= $3 AND heure_debut < $4)
      )
  `;
  
  const params = [salle_id, date, heure_debut, heure_fin];
  
  if (excludeReservationId) {
    query += ' AND id != $5';
    params.push(excludeReservationId);
  }

  const result = await pool.query(query, params);
  return result.rows.length > 0;
}

// Créer une réservation
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { error, value } = reservationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ 
        error: 'Données invalides', 
        details: error.details[0].message 
      });
    }

    const { salle_id, date, heure_debut, heure_fin, motif } = value;
    const pool = getPool();

    await pool.query('BEGIN');

    try {
      // Vérifier que la date n'est pas dans le passé
      const reservationDate = new Date(date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (reservationDate < today) {
        throw new Error('Impossible de réserver dans le passé');
      }

      // Vérifier que l'heure de fin est après l'heure de début
      const startTimeMinutes = parseInt(heure_debut.split(':')[0]) * 60 + parseInt(heure_debut.split(':')[1]);
      const endTimeMinutes = parseInt(heure_fin.split(':')[0]) * 60 + parseInt(heure_fin.split(':')[1]);
      if (endTimeMinutes < startTimeMinutes + 60) {
        throw new Error('L\'heure de fin doit être au moins 1 heure après l\'heure de début');
      }

      // Vérifier que la salle existe et est disponible
      const salleResult = await pool.query(
        'SELECT nom, statut FROM salles WHERE id = $1',
        [salle_id]
      );

      if (salleResult.rows.length === 0) {
        throw new Error('Salle non trouvée');
      }

      if (salleResult.rows[0].statut !== 'disponible') {
        throw new Error('Salle non disponible');
      }

      // Vérifier les conflits de réservation
      const hasConflict = await checkReservationConflict(pool, salle_id, date, heure_debut, heure_fin);
      if (hasConflict) {
        throw new Error('Créneau déjà réservé');
      }

      // Formater les heures pour PostgreSQL
      const formattedHeureDebut = `${heure_debut}:00`;
      const formattedHeureFin = `${heure_fin}:00`;

      // Créer la réservation
      const result = await pool.query(`
        INSERT INTO reservations (utilisateur_id, salle_id, date, heure_debut, heure_fin, motif)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, date, heure_debut, heure_fin, motif, created_at
      `, [req.user.id, salle_id, date, formattedHeureDebut, formattedHeureFin, motif]);

      const reservation = result.rows[0];
      let smsStatus = true;
      let notificationStatus = true;

      // Envoyer SMS de confirmation à tous les utilisateurs
      let smsResult;
      try {
        smsResult = await sendReservationSMS(
          salleResult.rows[0].nom,
          new Date(date).toLocaleDateString('fr-FR'),
          heure_debut,
          heure_fin
        );
        if (!smsResult.success) {
          smsStatus = false;
        }
      } catch (smsError) {
        console.error('Erreur envoi SMS:', smsError);
        smsStatus = false;
      }

      // Enregistrer la notification pour l'utilisateur qui a créé la réservation
      try {
        await pool.query(`
          INSERT INTO notifications (utilisateur_id, reservation_id, message, type, lu)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          req.user.id,
          reservation.id,
          `Réservation confirmée pour ${salleResult.rows[0].nom} le ${new Date(date).toLocaleDateString('fr-FR')} de ${heure_debut} à ${heure_fin}`,
          smsStatus ? 'sms_envoye' : 'sms_echec',
          false
        ]);
      } catch (notificationError) {
        console.error('Erreur enregistrement notification:', notificationError);
        notificationStatus = false;
      }

      await pool.query('COMMIT');

      res.status(201).json({
        message: 'Réservation créée avec succès',
        reservation: {
          ...reservation,
          salle_nom: salleResult.rows[0].nom,
          utilisateur_nom: req.user.nom
        },
        smsStatus,
        smsDetails: smsResult.summary,
        notificationStatus
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      res.status(
        error.message === 'Salle non trouvée' ? 404 :
        error.message === 'Créneau déjà réservé' ? 409 :
        error.message === 'Salle non disponible' ? 400 :
        error.message === 'Impossible de réserver dans le passé' ? 400 :
        error.message === 'L\'heure de fin doit être au moins 1 heure après l\'heure de début' ? 400 : 500
      ).json({ error: error.message || 'Erreur interne du serveur' });
    }
  } catch (error) {
    console.error('Erreur lors de la création de la réservation:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Obtenir les réservations de l'utilisateur connecté
router.get('/mes-reservations', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(`
      SELECT 
        r.id,
        r.date,
        r.heure_debut,
        r.heure_fin,
        r.motif,
        r.statut,
        r.created_at,
        s.nom as salle_nom,
        s.capacite as salle_capacite
      FROM reservations r
      JOIN salles s ON r.salle_id = s.id
      WHERE r.utilisateur_id = $1
      ORDER BY r.date DESC, r.heure_debut DESC
    `, [req.user.id]);

    res.json({
      reservations: result.rows
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des réservations:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Obtenir toutes les réservations (admin seulement)
router.get('/all', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(`
      SELECT 
        r.id,
        r.date,
        r.heure_debut,
        r.heure_fin,
        r.motif,
        r.statut,
        r.created_at,
        u.nom as utilisateur_nom,
        u.email as utilisateur_email,
        u.telephone as utilisateur_telephone,
        s.nom as salle_nom,
        s.capacite as salle_capacite
      FROM reservations r
      JOIN utilisateurs u ON r.utilisateur_id = u.id
      JOIN salles s ON r.salle_id = s.id
      ORDER BY r.date DESC, r.heure_debut DESC
    `);

    res.json({
      reservations: result.rows
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des réservations:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Annuler une réservation
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const reservationId = parseInt(req.params.id);
    const pool = getPool();

    await pool.query('BEGIN');

    // Récupérer les détails de la réservation
    const result = await pool.query(`
      SELECT 
        r.*,
        u.nom as utilisateur_nom,
        u.telephone as utilisateur_telephone,
        s.nom as salle_nom
      FROM reservations r
      JOIN utilisateurs u ON r.utilisateur_id = u.id
      JOIN salles s ON r.salle_id = s.id
      WHERE r.id = $1
    `, [reservationId]);

    if (result.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Réservation non trouvée' });
    }

    const reservation = result.rows[0];

    // Vérifier les permissions (propriétaire ou admin)
    if (req.user.role !== 'admin' && reservation.utilisateur_id !== req.user.id) {
      await pool.query('ROLLBACK');
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    // Vérifier que la réservation peut être annulée
    if (reservation.statut !== 'active') {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Cette réservation ne peut pas être annulée' });
    }

    // Annuler la réservation
    await pool.query(
      'UPDATE reservations SET statut = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['annulee', reservationId]
    );

    let smsStatus = true;
    let notificationStatus = true;

    // Envoyer SMS d'annulation
    try {
      const smsResult = await sendCancellationSMS(
        reservation.utilisateur_telephone,
        reservation.utilisateur_nom,
        reservation.salle_nom,
        new Date(reservation.date).toLocaleDateString('fr-FR'),
        reservation.heure_debut,
        reservation.heure_fin
      );
      if (!smsResult.success) {
        smsStatus = false;
      }
    } catch (smsError) {
      console.error('Erreur envoi SMS:', smsError);
      smsStatus = false;
    }

    // Enregistrer la notification
    try {
      await pool.query(`
        INSERT INTO notifications (utilisateur_id, reservation_id, message, type, lu)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        reservation.utilisateur_id,
        reservation.id,
        `Réservation annulée pour ${reservation.salle_nom} le ${new Date(reservation.date).toLocaleDateString('fr-FR')} de ${reservation.heure_debut} à ${reservation.heure_fin}`,
        smsStatus ? 'sms_envoye' : 'sms_echec',
        false
      ]);
    } catch (notificationError) {
      console.error('Erreur enregistrement notification:', notificationError);
      notificationStatus = false;
    }

    await pool.query('COMMIT');

    res.json({
      message: 'Réservation annulée avec succès',
      smsStatus,
      notificationStatus
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Erreur lors de l\'annulation de la réservation:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Réservation prioritaire (admin seulement)
router.post('/prioritaire', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { error, value } = reservationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ 
        error: 'Données invalides', 
        details: error.details[0].message 
      });
    }

    const { salle_id, date, heure_debut, heure_fin, motif } = value;
    const pool = getPool();

    await pool.query('BEGIN');

    try {
      // Vérifier que la date n'est pas dans le passé
      const reservationDate = new Date(date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (reservationDate < today) {
        throw new Error('Impossible de réserver dans le passé');
      }

      // Vérifier que l'heure de fin est après l'heure de début
      const startTimeMinutes = parseInt(heure_debut.split(':')[0]) * 60 + parseInt(heure_debut.split(':')[1]);
      const endTimeMinutes = parseInt(heure_fin.split(':')[0]) * 60 + parseInt(heure_fin.split(':')[1]);
      if (endTimeMinutes < startTimeMinutes + 60) {
        throw new Error('L\'heure de fin doit être au moins 1 heure après l\'heure de début');
      }

      // Vérifier que la salle existe et est disponible
      const salleResult = await pool.query(
        'SELECT nom, statut FROM salles WHERE id = $1',
        [salle_id]
      );

      if (salleResult.rows.length === 0) {
        throw new Error('Salle non trouvée');
      }

      if (salleResult.rows[0].statut !== 'disponible') {
        throw new Error('Salle non disponible');
      }

      // Récupérer les réservations en conflit
      const conflictResult = await pool.query(`
        SELECT 
          r.*,
          u.nom as utilisateur_nom,
          u.telephone as utilisateur_telephone,
          s.nom as salle_nom
        FROM reservations r
        JOIN utilisateurs u ON r.utilisateur_id = u.id
        JOIN salles s ON r.salle_id = s.id
        WHERE r.salle_id = $1 
          AND r.date = $2 
          AND r.statut = 'active'
          AND (
            (r.heure_debut < $4 AND r.heure_fin > $3) OR
            (r.heure_debut < $4 AND r.heure_fin > $4) OR
            (r.heure_debut >= $3 AND r.heure_debut < $4)
          )
      `, [salle_id, date, heure_debut, heure_fin]);

      let smsStatus = true;
      let notificationStatus = true;

      // Annuler les réservations en conflit
      if (conflictResult.rows.length > 0) {
        const conflictIds = conflictResult.rows.map(r => r.id);
        await pool.query(
          'UPDATE reservations SET statut = $1, updated_at = CURRENT_TIMESTAMP WHERE id = ANY($2)',
          ['annulee', conflictIds]
        );

        // Envoyer SMS aux utilisateurs concernés
        for (const conflict of conflictResult.rows) {
          try {
            const smsResult = await sendPriorityReservationSMS(
              conflict.utilisateur_telephone,
              conflict.utilisateur_nom,
              conflict.salle_nom,
              new Date(conflict.date).toLocaleDateString('fr-FR'),
              conflict.heure_debut,
              conflict.heure_fin
            );
            if (!smsResult.success) {
              smsStatus = false;
            }

            // Enregistrer la notification
            try {
              await pool.query(`
                INSERT INTO notifications (utilisateur_id, reservation_id, message, type, lu)
                VALUES ($1, $2, $3, $4, $5)
              `, [
                conflict.utilisateur_id,
                conflict.id,
                `Réservation annulée pour ${conflict.salle_nom} le ${new Date(conflict.date).toLocaleDateString('fr-FR')} de ${conflict.heure_debut} à ${conflict.heure_fin} (réservation prioritaire)`,
                smsResult.success ? 'sms_envoye' : 'sms_echec',
                false
              ]);
            } catch (notificationError) {
              console.error('Erreur enregistrement notification:', notificationError);
              notificationStatus = false;
            }
          } catch (smsError) {
            console.error('Erreur envoi SMS:', smsError);
            smsStatus = false;
          }
        }
      }

      // Formater les heures pour PostgreSQL
      const formattedHeureDebut = `${heure_debut}:00`;
      const formattedHeureFin = `${heure_fin}:00`;

      // Créer la réservation prioritaire
      const result = await pool.query(`
        INSERT INTO reservations (utilisateur_id, salle_id, date, heure_debut, heure_fin, motif)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, date, heure_debut, heure_fin, motif, created_at
      `, [req.user.id, salle_id, date, formattedHeureDebut, formattedHeureFin, motif]);

      const reservation = result.rows[0];

      // Envoyer SMS de confirmation à l'admin
      try {
        const smsResult = await sendSingleReservationSMS(
          req.user.telephone,
          req.user.nom,
          salleResult.rows[0].nom,
          new Date(date).toLocaleDateString('fr-FR'),
          heure_debut,
          heure_fin
        );
        if (!smsResult.success) {
          smsStatus = false;
        }

        // Enregistrer la notification
        try {
          await pool.query(`
            INSERT INTO notifications (utilisateur_id, reservation_id, message, type, lu)
            VALUES ($1, $2, $3, $4, $5)
          `, [
            req.user.id,
            reservation.id,
            `Réservation prioritaire confirmée pour ${salleResult.rows[0].nom} le ${new Date(date).toLocaleDateString('fr-FR')} de ${heure_debut} à ${heure_fin}`,
            smsResult.success ? 'sms_envoye' : 'sms_echec',
            false
          ]);
        } catch (notificationError) {
          console.error('Erreur enregistrement notification:', notificationError);
          notificationStatus = false;
        }
      } catch (smsError) {
        console.error('Erreur envoi SMS:', smsError);
        smsStatus = false;
      }

      await pool.query('COMMIT');

      res.status(201).json({
        message: 'Réservation prioritaire créée avec succès',
        reservation: {
          ...reservation,
          salle_nom: salleResult.rows[0].nom,
          utilisateur_nom: req.user.nom
        },
        reservations_annulees: conflictResult.rows.length,
        smsStatus,
        notificationStatus
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      res.status(
        error.message === 'Salle non trouvée' ? 404 :
        error.message === 'Créneau déjà réservé' ? 409 :
        error.message === 'Salle non disponible' ? 400 :
        error.message === 'Impossible de réserver dans le passé' ? 400 :
        error.message === 'L\'heure de fin doit être au moins 1 heure après l\'heure de début' ? 400 : 500
      ).json({ error: error.message || 'Erreur interne du serveur' });
    }
  } catch (error) {
    console.error('Erreur lors de la réservation prioritaire:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Obtenir les statistiques des réservations (admin)
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_reservations,
        COUNT(*) FILTER (WHERE statut = 'active') as reservations_actives,
        COUNT(*) FILTER (WHERE statut = 'annulee') as reservations_annulees,
        COUNT(*) FILTER (WHERE date >= CURRENT_DATE) as reservations_futures,
        COUNT(*) FILTER (WHERE date = CURRENT_DATE) as reservations_aujourd_hui
      FROM reservations
    `);

    const sallesPopulaires = await pool.query(`
      SELECT 
        s.nom,
        COUNT(r.id) as nombre_reservations
      FROM salles s
      LEFT JOIN reservations r ON s.id = r.salle_id
      GROUP BY s.id, s.nom
      ORDER BY nombre_reservations DESC
      LIMIT 5
    `);

    res.json({
      statistiques: stats.rows[0],
      salles_populaires: sallesPopulaires.rows
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

module.exports = router;
