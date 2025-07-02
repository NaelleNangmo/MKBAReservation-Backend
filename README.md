# 🏢 Meeting Room Booking System

Application complète de réservation de salles de réunion avec backend Node.js/Express, base de données PostgreSQL et notifications SMS via Twilio.

## 🚀 Fonctionnalités

### 👤 Utilisateurs
- ✅ Authentification sécurisée avec JWT
- ✅ Réservation de salles de réunion
- ✅ Consultation des créneaux disponibles
- ✅ Gestion de ses réservations
- ✅ Notifications SMS automatiques

### 👨‍💼 Administrateurs
- ✅ Tableau de bord avec statistiques
- ✅ Gestion complète des utilisateurs (CRUD)
- ✅ Gestion des salles (CRUD)
- ✅ Réservations prioritaires
- ✅ Mise hors service des salles
- ✅ Vue sur toutes les réservations

## 🛠️ Technologies

- **Backend**: Node.js, Express.js
- **Base de données**: PostgreSQL
- **Authentification**: JWT (JSON Web Tokens)
- **SMS**: Twilio API
- **Sécurité**: Helmet, CORS, Rate Limiting
- **Validation**: Joi

## 📦 Installation

### Prérequis
- Node.js (v14 ou supérieur)
- PostgreSQL
- Compte Twilio

### 1. Installation des dépendances
```bash
npm install
```

### 2. Configuration de l'environnement
Copiez le fichier `.env.example` vers `.env` et configurez vos variables :

```bash
cp .env.example .env
```

Modifiez le fichier `.env` avec vos paramètres :
```env
# Base de données PostgreSQL
DATABASE_URL=postgresql://username:password@host:port/database

# JWT Secret (changez en production)
JWT_SECRET=your_super_secret_jwt_key_here

# Configuration Twilio
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+237655998106

# Configuration serveur
PORT=3000
NODE_ENV=development
```

### 3. Démarrage de l'application

#### Mode développement
```bash
npm run dev
```

#### Mode production
```bash
npm start
```

L'API sera disponible sur `http://localhost:3000/api`

## 🗄️ Base de données

La base de données est **automatiquement initialisée** au premier démarrage avec :

### Tables créées
- `utilisateurs` - Gestion des utilisateurs
- `salles` - Gestion des salles de réunion
- `reservations` - Gestion des réservations
- `notifications` - Historique des notifications

### Comptes par défaut
- **Admin**: `admin@example.com` / `admin123`
- **Utilisateur**: `user@example.com` / `user123`

### Salles par défaut
- Salle de Conférence A (20 places)
- Salle de Réunion B (8 places)
- Salle de Créativité C (6 places)
- Salle Exécutive D (12 places)
- Espace Coworking E (15 places)

## 📱 API Endpoints

### 🔐 Authentification
```
POST /api/auth/login          # Connexion
GET  /api/auth/me             # Profil utilisateur
PUT  /api/auth/change-password # Changer mot de passe
```

### 🏢 Salles
```
GET  /api/salles              # Liste des salles
GET  /api/salles/libres       # Salles disponibles
GET  /api/salles/:id/reservations # Réservations d'une salle
POST /api/salles              # Créer salle (admin)
PUT  /api/salles/:id          # Modifier salle (admin)
POST /api/salles/:id/hors-service # Mettre hors service (admin)
POST /api/salles/:id/en-service   # Remettre en service (admin)
DELETE /api/salles/:id        # Supprimer salle (admin)
```

### 📅 Réservations
```
POST /api/reservations        # Créer réservation
GET  /api/reservations/mes-reservations # Mes réservations
GET  /api/reservations/all    # Toutes les réservations (admin)
DELETE /api/reservations/:id  # Annuler réservation
POST /api/reservations/prioritaire # Réservation prioritaire (admin)
GET  /api/reservations/stats  # Statistiques (admin)
```

### 👥 Utilisateurs
```
GET  /api/utilisateurs        # Liste utilisateurs (admin)
GET  /api/utilisateurs/:id    # Détails utilisateur (admin)
POST /api/utilisateurs        # Créer utilisateur (admin)
PUT  /api/utilisateurs/:id    # Modifier utilisateur (admin)
DELETE /api/utilisateurs/:id  # Supprimer utilisateur (admin)
GET  /api/utilisateurs/stats/overview # Statistiques (admin)
```

## 📲 Notifications SMS

### Configuration Twilio
Les SMS sont envoyés automatiquement via Twilio dans les cas suivants :
- ✅ Confirmation de réservation
- ❌ Annulation de réservation
- ⚠️ Salle mise hors service
- 🔄 Réservation prioritaire (conflit)

### Test SMS
```bash
npm test
```

## 🔒 Sécurité

- **JWT** pour l'authentification
- **Helmet** pour la sécurité des headers HTTP
- **Rate Limiting** pour prévenir les attaques
- **CORS** configuré
- **Validation** des données avec Joi
- **Mots de passe** hashés avec bcrypt

## 📊 Fonctionnalités avancées

### Gestion des conflits
- Vérification automatique des chevauchements
- Réservations prioritaires pour les admins
- Annulation automatique en cas de conflit

### Mise hors service
- Annulation automatique des réservations sur 7 jours
- Notifications SMS à tous les utilisateurs concernés

### Statistiques
- Dashboard admin avec métriques clés
- Salles les plus populaires
- Utilisateurs les plus actifs

## 🧪 Tests

### Test de l'API
```bash
curl http://localhost:3000/api/health
```

### Test SMS
```bash
npm test
```

### Test de connexion
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","mot_de_passe":"admin123"}'
```

## 🚨 Dépannage

### Problèmes courants

1. **Erreur de connexion à la base de données**
   - Vérifiez la variable `DATABASE_URL`
   - Assurez-vous que PostgreSQL est démarré

2. **SMS non envoyés**
   - Vérifiez vos identifiants Twilio
   - Vérifiez le format des numéros (+237...)

3. **Erreur JWT**
   - Vérifiez la variable `JWT_SECRET`
   - Le token expire après 24h

### Logs
Les logs détaillés sont affichés dans la console en mode développement.

## 📝 Structure du projet

```
backend/
├── db/
│   └── init.js              # Initialisation base de données
├── middleware/
│   └── auth.js              # Middleware d'authentification
├── routes/
│   ├── auth.js              # Routes d'authentification
│   ├── reservations.js      # Routes des réservations
│   ├── salles.js            # Routes des salles
│   └── utilisateurs.js      # Routes des utilisateurs
├── services/
│   └── sendSMS.js           # Service d'envoi SMS
├── test/
│   └── test-sms.js          # Test d'envoi SMS
├── .env                     # Variables d'environnement
├── .env.example             # Exemple de configuration
├── package.json             # Dépendances
├── server.js                # Point d'entrée
└── README.md                # Documentation
```

## 🤝 Contribution

1. Fork le projet
2. Créez une branche feature (`git checkout -b feature/AmazingFeature`)
3. Commit vos changements (`git commit -m 'Add some AmazingFeature'`)
4. Push vers la branche (`git push origin feature/AmazingFeature`)
5. Ouvrez une Pull Request

## 📄 Licence

Ce projet est sous licence MIT. Voir le fichier `LICENSE` pour plus de détails.

## 📞 Support

Pour toute question ou problème :
- 📧 Email: support@meetingroom.com
- 📱 Téléphone: +237 655 998 106

---

**Développé avec ❤️ pour une gestion efficace des salles de réunion**# ReservationApp
# ReservationApp
