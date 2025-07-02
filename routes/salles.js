const express = require('express');
const Joi = require('joi');
const { getPool } = require('../db/init');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { sendOutOfServiceSMS } = require('../services/sendSMS');

const router = express.Router();

// Schéma de validation pour une salle
const salleSchema = Joi.object({
  nom: Joi.string().min(2).max(100).required(),
  capacite: Joi.number().integer().min(1).max(1000).required(),
  description: Joi.string().max(500).optional()
});

// Obtenir toutes les salles
router.get('/', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(`
      SELECT 
        id,
        nom,
        capacite,
        statut,
        description,
        created_at,
        updated_at
      FROM salles
      ORDER BY nom
    `);

    res.json({
      salles: result.rows
    });

  } catch (error) {
    console.error('Erreur lors de la récupération des salles:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Obtenir les salles disponibles pour une période donnée
router.get('/libres', authenticateToken, async (req, res) => {
  try {
    const { date, heure_debut, heure_fin } = req.query;

    if (!date || !heure_debut || !heure_fin) {
      return res.status(400).json({ 
        error: 'Paramètres requis: date, heure_debut, heure_fin' 
      });
    }

    // Validation du format des heures
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(heure_debut) || !timeRegex.test(heure_fin)) {
      return res.status(400).json({ 
        error: 'Format d\'heure invalide (HH:MM)' 
      });
    }

    if (heure_debut >= heure_fin) {
      return res.status(400).json({ 
        error: 'L\'heure de fin doit être après l\'heure de début' 
      });
    }

    const pool = getPool();
    
    // Récupérer les salles disponibles (pas de conflit de réservation)
    const result = await pool.query(`
      SELECT 
        s.id,
        s.nom,
        s.capacite,
        s.description,
        s.statut
      FROM salles s
      WHERE s.statut = 'disponible'
        AND s.id NOT IN (
          SELECT DISTINCT r.salle_id
          FROM reservations r
          WHERE r.date = $1
            AND r.statut = 'active'
            AND (
              (r.heure_debut < $3 AND r.heure_fin > $2) OR
              (r.heure_debut < $3 AND r.heure_fin > $3) OR
              (r.heure_debut >= $2 AND r.heure_debut < $3)
            )
        )
      ORDER BY s.nom
    `, [date, heure_debut, heure_fin]);

    res.json({
      salles_libres: result.rows,
      periode: {
        date,
        heure_debut,
        heure_fin
      }
    });

  } catch (error) {
    console.error('Erreur lors de la recherche des salles libres:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Obtenir les réservations d'une salle pour une date donnée
router.get('/:id/reservations', authenticateToken, async (req, res) => {
  try {
    const salleId = parseInt(req.params.id);
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'Paramètre date requis' });
    }

    const pool = getPool();
    
    // Vérifier que la salle existe
    const salleResult = await pool.query('SELECT nom FROM salles WHERE id = $1', [salleId]);
    if (salleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Salle non trouvée' });
    }

    // Récupérer les réservations de la salle pour la date donnée
    const result = await pool.query(`
      SELECT 
        r.id,
        r.heure_debut,
        r.heure_fin,
        r.motif,
        r.statut,
        u.nom as utilisateur_nom,
        u.email as utilisateur_email
      FROM reservations r
      JOIN utilisateurs u ON r.utilisateur_id = u.id
      WHERE r.salle_id = $1 
        AND r.date = $2
        AND r.statut = 'active'
      ORDER BY r.heure_debut
    `, [salleId, date]);

    res.json({
      salle: salleResult.rows[0],
      date,
      reservations: result.rows
    });

  } catch (error) {
    console.error('Erreur lors de la récupération des réservations de la salle:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Créer une nouvelle salle (admin seulement)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { error, value } = salleSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ 
        error: 'Données invalides', 
        details: error.details[0].message 
      });
    }

    const { nom, capacite, description } = value;
    const pool = getPool();

    // Vérifier que le nom n'existe pas déjà
    const existingResult = await pool.query('SELECT id FROM salles WHERE nom = $1', [nom]);
    if (existingResult.rows.length > 0) {
      return res.status(409).json({ error: 'Une salle avec ce nom existe déjà' });
    }

    // Créer la salle
    const result = await pool.query(`
      INSERT INTO salles (nom, capacite, description)
      VALUES ($1, $2, $3)
      RETURNING id, nom, capacite, statut, description, created_at
    `, [nom, capacite, description]);

    res.status(201).json({
      message: 'Salle créée avec succès',
      salle: result.rows[0]
    });

  } catch (error) {
    console.error('Erreur lors de la création de la salle:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Modifier une salle (admin seulement)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const salleId = parseInt(req.params.id);
    const { error, value } = salleSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ 
        error: 'Données invalides', 
        details: error.details[0].message 
      });
    }

    const { nom, capacite, description } = value;
    const pool = getPool();

    // Vérifier que la salle existe
    const existingResult = await pool.query('SELECT id FROM salles WHERE id = $1', [salleId]);
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Salle non trouvée' });
    }

    // Vérifier que le nom n'est pas déjà utilisé par une autre salle
    const nameResult = await pool.query('SELECT id FROM salles WHERE nom = $1 AND id != $2', [nom, salleId]);
    if (nameResult.rows.length > 0) {
      return res.status(409).json({ error: 'Une autre salle utilise déjà ce nom' });
    }

    // Modifier la salle
    const result = await pool.query(`
      UPDATE salles 
      SET nom = $1, capacite = $2, description = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING id, nom, capacite, statut, description, updated_at
    `, [nom, capacite, description, salleId]);

    res.json({
      message: 'Salle modifiée avec succès',
      salle: result.rows[0]
    });

  } catch (error) {
    console.error('Erreur lors de la modification de la salle:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Mettre une salle hors service (admin seulement)
router.post('/:id/hors-service', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const salleId = parseInt(req.params.id);
    const pool = getPool();

    await pool.query('BEGIN');

    try {
      // Vérifier que la salle existe
      const salleResult = await pool.query('SELECT nom, statut FROM salles WHERE id = $1', [salleId]);
      if (salleResult.rows.length === 0) {
        return res.status(404).json({ error: 'Salle non trouvée' });
      }

      const salle = salleResult.rows[0];

      // Mettre la salle hors service
      await pool.query(
        'UPDATE salles SET statut = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['hors_service', salleId]
      );

      // Récupérer les réservations actives des 7 prochains jours
      const reservationsResult = await pool.query(`
        SELECT 
          r.*,
          u.nom as utilisateur_nom,
          u.telephone as utilisateur_telephone
        FROM reservations r
        JOIN utilisateurs u ON r.utilisateur_id = u.id
        WHERE r.salle_id = $1 
          AND r.statut = 'active'
          AND r.date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
      `, [salleId]);

      // Annuler les réservations
      if (reservationsResult.rows.length > 0) {
        const reservationIds = reservationsResult.rows.map(r => r.id);
        await pool.query(
          'UPDATE reservations SET statut = $1, updated_at = CURRENT_TIMESTAMP WHERE id = ANY($2)',
          ['annulee', reservationIds]
        );

        // Envoyer SMS aux utilisateurs concernés
        for (const reservation of reservationsResult.rows) {
          try {
            await sendOutOfServiceSMS(
              reservation.utilisateur_telephone,
              reservation.utilisateur_nom,
              salle.nom
            );
          } catch (smsError) {
            console.error('Erreur envoi SMS:', smsError);
          }
        }
      }

      await pool.query('COMMIT');

      res.json({
        message: 'Salle mise hors service avec succès',
        reservations_annulees: reservationsResult.rows.length
      });

    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Erreur lors de la mise hors service de la salle:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Remettre une salle en service (admin seulement)
router.post('/:id/en-service', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const salleId = parseInt(req.params.id);
    const pool = getPool();

    // Vérifier que la salle existe
    const salleResult = await pool.query('SELECT nom, statut FROM salles WHERE id = $1', [salleId]);
    if (salleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Salle non trouvée' });
    }

    // Remettre la salle en service
    await pool.query(
      'UPDATE salles SET statut = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['disponible', salleId]
    );

    res.json({
      message: 'Salle remise en service avec succès'
    });

  } catch (error) {
    console.error('Erreur lors de la remise en service de la salle:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Supprimer une salle (admin seulement)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const salleId = parseInt(req.params.id);
    const pool = getPool();

    // Vérifier que la salle existe
    const salleResult = await pool.query('SELECT nom FROM salles WHERE id = $1', [salleId]);
    if (salleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Salle non trouvée' });
    }

    // Vérifier s'il y a des réservations futures
    const reservationsResult = await pool.query(
      'SELECT COUNT(*) as count FROM reservations WHERE salle_id = $1 AND date >= CURRENT_DATE AND statut = $2',
      [salleId, 'active']
    );

    if (parseInt(reservationsResult.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: 'Impossible de supprimer une salle avec des réservations futures actives' 
      });
    }

    // Supprimer la salle
    await pool.query('DELETE FROM salles WHERE id = $1', [salleId]);

    res.json({
      message: 'Salle supprimée avec succès'
    });

  } catch (error) {
    console.error('Erreur lors de la suppression de la salle:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

module.exports = router;