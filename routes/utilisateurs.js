const express = require('express');
const bcrypt = require('bcryptjs');
const Joi = require('joi');
const { getPool } = require('../db/init');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Schéma de validation pour un utilisateur
const utilisateurSchema = Joi.object({
  nom: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
  mot_de_passe: Joi.string().min(6).required(),
  role: Joi.string().valid('utilisateur', 'admin').default('utilisateur'),
  telephone: Joi.string().pattern(/^\+[1-9]\d{1,14}$/).required()
});

const utilisateurUpdateSchema = Joi.object({
  nom: Joi.string().min(2).max(100).optional(),
  email: Joi.string().email().optional(),
  role: Joi.string().valid('utilisateur', 'admin').optional(),
  telephone: Joi.string().pattern(/^\+[1-9]\d{1,14}$/).optional()
});

// Obtenir tous les utilisateurs (admin seulement)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(`
      SELECT 
        id,
        nom,
        email,
        role,
        telephone,
        created_at,
        updated_at
      FROM utilisateurs
      ORDER BY nom
    `);

    res.json({
      utilisateurs: result.rows
    });

  } catch (error) {
    console.error('Erreur lors de la récupération des utilisateurs:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Obtenir un utilisateur par ID (admin seulement)
router.get('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const pool = getPool();
    
    const result = await pool.query(`
      SELECT 
        id,
        nom,
        email,
        role,
        telephone,
        created_at,
        updated_at
      FROM utilisateurs
      WHERE id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json({
      utilisateur: result.rows[0]
    });

  } catch (error) {
    console.error('Erreur lors de la récupération de l\'utilisateur:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Créer un nouvel utilisateur (admin seulement)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { error, value } = utilisateurSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ 
        error: 'Données invalides', 
        details: error.details[0].message 
      });
    }

    const { nom, email, mot_de_passe, role, telephone } = value;
    const pool = getPool();

    // Vérifier que l'email n'existe pas déjà
    const existingResult = await pool.query('SELECT id FROM utilisateurs WHERE email = $1', [email]);
    if (existingResult.rows.length > 0) {
      return res.status(409).json({ error: 'Un utilisateur avec cet email existe déjà' });
    }

    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(mot_de_passe, 10);

    // Créer l'utilisateur
    const result = await pool.query(`
      INSERT INTO utilisateurs (nom, email, mot_de_passe, role, telephone)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, nom, email, role, telephone, created_at
    `, [nom, email, hashedPassword, role, telephone]);

    res.status(201).json({
      message: 'Utilisateur créé avec succès',
      utilisateur: result.rows[0]
    });

  } catch (error) {
    console.error('Erreur lors de la création de l\'utilisateur:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Modifier un utilisateur (admin seulement)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { error, value } = utilisateurUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ 
        error: 'Données invalides', 
        details: error.details[0].message 
      });
    }

    const pool = getPool();

    // Vérifier que l'utilisateur existe
    const existingResult = await pool.query('SELECT id FROM utilisateurs WHERE id = $1', [userId]);
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Vérifier que l'email n'est pas déjà utilisé par un autre utilisateur
    if (value.email) {
      const emailResult = await pool.query('SELECT id FROM utilisateurs WHERE email = $1 AND id != $2', [value.email, userId]);
      if (emailResult.rows.length > 0) {
        return res.status(409).json({ error: 'Un autre utilisateur utilise déjà cet email' });
      }
    }

    // Construire la requête de mise à jour dynamiquement
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    Object.keys(value).forEach(key => {
      updateFields.push(`${key} = $${paramIndex}`);
      updateValues.push(value[key]);
      paramIndex++;
    });

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(userId);

    const query = `
      UPDATE utilisateurs 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, nom, email, role, telephone, updated_at
    `;

    const result = await pool.query(query, updateValues);

    res.json({
      message: 'Utilisateur modifié avec succès',
      utilisateur: result.rows[0]
    });

  } catch (error) {
    console.error('Erreur lors de la modification de l\'utilisateur:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Supprimer un utilisateur (admin seulement)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const pool = getPool();

    // Vérifier que l'utilisateur existe
    const userResult = await pool.query('SELECT nom, role FROM utilisateurs WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Empêcher la suppression du dernier admin
    if (userResult.rows[0].role === 'admin') {
      const adminCountResult = await pool.query('SELECT COUNT(*) as count FROM utilisateurs WHERE role = $1', ['admin']);
      if (parseInt(adminCountResult.rows[0].count) <= 1) {
        return res.status(400).json({ 
          error: 'Impossible de supprimer le dernier administrateur' 
        });
      }
    }

    // Empêcher la suppression si l'utilisateur a des réservations futures
    const reservationsResult = await pool.query(
      'SELECT COUNT(*) as count FROM reservations WHERE utilisateur_id = $1 AND date >= CURRENT_DATE AND statut = $2',
      [userId, 'active']
    );

    if (parseInt(reservationsResult.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: 'Impossible de supprimer un utilisateur avec des réservations futures actives' 
      });
    }

    // Supprimer l'utilisateur (les réservations passées seront conservées grâce à ON DELETE CASCADE)
    await pool.query('DELETE FROM utilisateurs WHERE id = $1', [userId]);

    res.json({
      message: 'Utilisateur supprimé avec succès'
    });

  } catch (error) {
    console.error('Erreur lors de la suppression de l\'utilisateur:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Obtenir les statistiques des utilisateurs (admin seulement)
router.get('/stats/overview', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_utilisateurs,
        COUNT(*) FILTER (WHERE role = 'admin') as total_admins,
        COUNT(*) FILTER (WHERE role = 'utilisateur') as total_utilisateurs_normaux,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as nouveaux_utilisateurs_30j
      FROM utilisateurs
    `);

    const utilisateursActifs = await pool.query(`
      SELECT 
        u.nom,
        u.email,
        COUNT(r.id) as nombre_reservations
      FROM utilisateurs u
      LEFT JOIN reservations r ON u.id = r.utilisateur_id 
        AND r.created_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY u.id, u.nom, u.email
      ORDER BY nombre_reservations DESC
      LIMIT 10
    `);

    res.json({
      statistiques: stats.rows[0],
      utilisateurs_actifs: utilisateursActifs.rows
    });

  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques utilisateurs:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

module.exports = router;