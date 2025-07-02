const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { getPool } = require('../db/init');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Schéma de validation pour la connexion
const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  mot_de_passe: Joi.string().min(6).required()
});

// Route de connexion
router.post('/login', async (req, res) => {
  try {
    // Validation des données
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ 
        error: 'Données invalides', 
        details: error.details[0].message 
      });
    }

    const { email, mot_de_passe } = value;
    const pool = getPool();

    // Rechercher l'utilisateur
    const result = await pool.query(
      'SELECT id, nom, email, mot_de_passe, role, telephone FROM utilisateurs WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const user = result.rows[0];

    // Vérifier le mot de passe
    const isValidPassword = await bcrypt.compare(mot_de_passe, user.mot_de_passe);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    // Générer le token JWT
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Retourner les informations utilisateur (sans le mot de passe)
    const { mot_de_passe: _, ...userInfo } = user;
    
    res.json({
      message: 'Connexion réussie',
      token,
      user: userInfo
    });

  } catch (error) {
    console.error('Erreur lors de la connexion:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Route pour vérifier le token et obtenir les infos utilisateur
router.get('/me', authenticateToken, (req, res) => {
  res.json({
    user: req.user
  });
});

// Route pour changer le mot de passe
router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { ancien_mot_de_passe, nouveau_mot_de_passe } = req.body;

    if (!ancien_mot_de_passe || !nouveau_mot_de_passe) {
      return res.status(400).json({ error: 'Ancien et nouveau mot de passe requis' });
    }

    if (nouveau_mot_de_passe.length < 6) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
    }

    const pool = getPool();

    // Récupérer le mot de passe actuel
    const result = await pool.query(
      'SELECT mot_de_passe FROM utilisateurs WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Vérifier l'ancien mot de passe
    const isValidPassword = await bcrypt.compare(ancien_mot_de_passe, result.rows[0].mot_de_passe);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Ancien mot de passe incorrect' });
    }

    // Hasher le nouveau mot de passe
    const hashedPassword = await bcrypt.hash(nouveau_mot_de_passe, 10);

    // Mettre à jour le mot de passe
    await pool.query(
      'UPDATE utilisateurs SET mot_de_passe = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedPassword, req.user.id]
    );

    res.json({ message: 'Mot de passe modifié avec succès' });

  } catch (error) {
    console.error('Erreur lors du changement de mot de passe:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

module.exports = router;