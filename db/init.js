const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initializeDatabase() {
  const client = await pool.connect();
  
  try {
    // Création des tables
    await client.query('BEGIN');
    
    // Table utilisateurs
    await client.query(`
      CREATE TABLE IF NOT EXISTS utilisateurs (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        mot_de_passe VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'utilisateur' CHECK (role IN ('utilisateur', 'admin')),
        telephone VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Table salles
    await client.query(`
      CREATE TABLE IF NOT EXISTS salles (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(100) NOT NULL,
        capacite INTEGER NOT NULL DEFAULT 1,
        statut VARCHAR(20) DEFAULT 'disponible' CHECK (statut IN ('disponible', 'hors_service', 'maintenance')),
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Table reservations
    await client.query(`
      CREATE TABLE IF NOT EXISTS reservations (
        id SERIAL PRIMARY KEY,
        utilisateur_id INTEGER REFERENCES utilisateurs(id) ON DELETE CASCADE,
        salle_id INTEGER REFERENCES salles(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        heure_debut TIME NOT NULL,
        heure_fin TIME NOT NULL,
        statut VARCHAR(20) DEFAULT 'active' CHECK (statut IN ('active', 'annulee', 'terminee')),
        motif TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT check_heures CHECK (heure_fin > heure_debut)
      )
    `);

    // Table notifications
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        utilisateur_id INTEGER REFERENCES utilisateurs(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        type VARCHAR(50) DEFAULT 'info',
        lu BOOLEAN DEFAULT FALSE,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Index pour optimiser les performances
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(date);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_reservations_salle ON reservations(salle_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_reservations_utilisateur ON reservations(utilisateur_id);
    `);

    // Vue pour les prochaines réservations
    await client.query(`
      CREATE OR REPLACE VIEW vue_prochaines_reservations AS
      SELECT 
        r.id,
        r.date,
        r.heure_debut,
        r.heure_fin,
        r.motif,
        r.statut,
        u.nom as utilisateur_nom,
        u.email as utilisateur_email,
        u.telephone as utilisateur_telephone,
        s.nom as salle_nom,
        s.capacite as salle_capacite
      FROM reservations r
      JOIN utilisateurs u ON r.utilisateur_id = u.id
      JOIN salles s ON r.salle_id = s.id
      WHERE r.date >= CURRENT_DATE 
        AND r.statut = 'active'
      ORDER BY r.date, r.heure_debut;
    `);

    // Vérifier si les données par défaut existent déjà
    const adminExists = await client.query(
      "SELECT id FROM utilisateurs WHERE email = 'admin@example.com'"
    );
    
    if (adminExists.rows.length === 0) {
      // Créer les utilisateurs par défaut
      const adminPassword = await bcrypt.hash('admin123', 10);
      const userPassword = await bcrypt.hash('user123', 10);

      await client.query(`
        INSERT INTO utilisateurs (nom, email, mot_de_passe, role, telephone) VALUES
        ('Administrateur', 'admin@example.com', $1, 'admin', '+237690000000'),
        ('Utilisateur Test', 'user@example.com', $2, 'utilisateur', '+237655000000')
      `, [adminPassword, userPassword]);

      // Créer des salles par défaut
      await client.query(`
        INSERT INTO salles (nom, capacite, description) VALUES
        ('Salle de Conférence A', 20, 'Grande salle avec projecteur et système audio'),
        ('Salle de Réunion B', 8, 'Salle moyenne pour réunions d''équipe'),
        ('Salle de Créativité C', 6, 'Espace collaboratif avec tableau blanc'),
        ('Salle Exécutive D', 12, 'Salle haut de gamme pour réunions importantes'),
        ('Espace Coworking E', 15, 'Espace ouvert pour travail collaboratif')
      `);

      console.log('✅ Données par défaut créées');
      console.log('👤 Admin: admin@example.com / admin123');
      console.log('👤 User: user@example.com / user123');
    }

    await client.query('COMMIT');
    console.log('✅ Base de données initialisée avec succès');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur lors de l\'initialisation de la base de données:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Fonction pour obtenir une connexion à la base de données
function getPool() {
  return pool;
}

module.exports = {
  initializeDatabase,
  getPool
};