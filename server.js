const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import des routes
const authRoutes = require('./routes/auth');
const reservationRoutes = require('./routes/reservations');
const salleRoutes = require('./routes/salles');
const utilisateurRoutes = require('./routes/utilisateurs');

// Import de Twilio pour l'envoi de SMS
const twilio = require('twilio');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware de sécurité
app.use(helmet());
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limite chaque IP à 100 requêtes par windowMs
});
app.use(limiter);

// Middleware pour parser JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/salles', salleRoutes);
app.use('/api/utilisateurs', utilisateurRoutes);

// Route de test
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'API Meeting Room Booking fonctionnelle',
    timestamp: new Date().toISOString()
  });
});

// Gestion des erreurs 404
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route non trouvée',
    path: req.originalUrl 
  });
});

// Gestion globale des erreurs
app.use((err, req, res, next) => {
  console.error('Erreur serveur:', err.stack);
  res.status(500).json({ 
    error: 'Erreur interne du serveur',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Une erreur est survenue'
  });
});

// Fonction pour tester l'envoi de SMS
const testSMS = async () => {
  try {
    const accountSid = process.env.TWILIO_MAIN_ACCOUNT_SID ;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_PHONE_NUMBER || '+237655998106';
    // Remplacez par un numéro différent (ex. votre numéro personnel ou un numéro de test)
    const to = '+237670123456'; // Adaptez selon votre numéro valide

    if (!authToken) {
      console.error('❌ Erreur: TWILIO_AUTH_TOKEN non défini dans .env');
      return false;
    }

    console.log('📋 Vérification des identifiants:', { accountSid, authToken, from, to });

    const client = twilio(accountSid, authToken);

    const testMessage = `🔍 Test SMS de DORA - ${new Date().toLocaleString()}\nSystème de réservation opérationnel.`;

    console.log(`📤 Envoi d'un test SMS à ${to}...`);
    const message = await client.messages.create({
      body: testMessage,
      from: from,
      to: to
    });

    console.log(`✅ SMS test envoyé avec succès. SID: ${message.sid}`);
    return true;
  } catch (error) {
    console.error('❌ Erreur lors du test SMS:', error.message);
    if (error.code) {
      console.error(`Code d'erreur Twilio: ${error.code}`);
      if (error.code === 21610) {
        console.error('Erreur: Numéro non valide ou non vérifié dans Twilio.');
      } else if (error.code === 21614) {
        console.error('Erreur: Limite d\'envoi atteinte.');
      } else if (error.code === 20003) {
        console.error('Erreur: Authentification échouée (vérifiez Auth Token).');
      } else {
        console.error('Erreur inconnue:', error.stack);
      }
    } else {
      console.error('Erreur non gérée:', error.stack);
    }
    return false;
  }
};

// Démarrage du serveur
async function startServer() {
  try {
    console.log('📞 Test de l\'envoi de SMS...');
    const smsTestSuccess = await testSMS();
    if (!smsTestSuccess) {
      console.warn('⚠️ Le test SMS a échoué, mais le serveur démarrera quand même. Vérifiez la configuration Twilio.');
    } else {
      console.log('✅ Test SMS réussi. Le serveur est prêt.');
    }

    app.listen(PORT, () => {
      console.log(`🚀 Serveur démarré sur le port ${PORT}`);
      console.log(`📱 API disponible sur http://localhost:${PORT}/api`);
      console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('❌ Erreur lors du démarrage du serveur:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
