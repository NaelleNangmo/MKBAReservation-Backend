const jwt = require('jsonwebtoken');
const { getPool } = require('../db/init');

// Middleware pour vérifier le token JWT
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Token d\'accès requis' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Vérifier que l'utilisateur existe toujours
    const pool = getPool();
    const result = await pool.query(
      'SELECT id, nom, email, role, telephone FROM utilisateurs WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Utilisateur non trouvé' });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    console.error('Erreur de vérification du token:', error);
    return res.status(403).json({ error: 'Token invalide' });
  }
};

// Middleware pour vérifier le rôle admin
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  }
  next();
};

// Middleware pour vérifier que l'utilisateur peut accéder à ses propres données
const requireOwnershipOrAdmin = (req, res, next) => {
  const resourceUserId = parseInt(req.params.userId) || parseInt(req.body.utilisateur_id);
  
  if (req.user.role === 'admin' || req.user.id === resourceUserId) {
    next();
  } else {
    return res.status(403).json({ error: 'Accès non autorisé à cette ressource' });
  }
};

module.exports = {
  authenticateToken,
  requireAdmin,
  requireOwnershipOrAdmin
};