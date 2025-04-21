// payment-service/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const { logger, stream } = require('./utils/logger');
const connectToDatabase = require('./config/db');

// Créer le dossier de logs s'il n'existe pas
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Connexion à la base de données MongoDB
connectToDatabase();

// Import des routes
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const stripeWebhookRoutes = require('./routes/stripeWebhookRoutes');

// Initialiser express
const app = express();
const PORT = process.env.PORT || 5004;

// Configurer les origines CORS autorisées
const allowedOrigins = process.env.CORS_ORIGINS 
  ? process.env.CORS_ORIGINS.split(',') 
  : ['http://localhost:3000'];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      logger.warn(`Requête CORS bloquée depuis l'origine: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  credentials: true,
  maxAge: 86400
};

// Middlewares
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false
}));
app.use(cors(corsOptions));
app.use(morgan('combined', { stream }));

// Appliquer le body parser uniquement pour les routes sauf Stripe Webhook
app.use(/^(?!\/webhooks\/stripe).+/, express.json({ limit: '1mb' }));
app.use(/^(?!\/webhooks\/stripe).+/, express.urlencoded({ extended: true }));

// Routes
app.use('/subscription', subscriptionRoutes);
app.use('/webhooks', stripeWebhookRoutes);

// Endpoint de santé
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    service: 'payment-service',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Gestion des erreurs 404
app.use((req, res, next) => {
  res.status(404).json({
    error: {
      message: 'Endpoint not found',
      path: req.path,
      method: req.method
    }
  });
});

// Middleware de gestion des erreurs
app.use((err, req, res, next) => {
  logger.error(`Erreur non gérée: ${err.stack}`);

  const statusCode = err.statusCode || 500;
  const errorResponse = {
    error: {
      message: err.message || 'Internal Server Error',
      code: err.code || 'INTERNAL_ERROR',
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    }
  };

  res.status(statusCode).json(errorResponse);
});

// Lancer le serveur
const server = app.listen(PORT, () => {
  logger.info(`✅ Payment service running on port ${PORT}`);
  logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Arrêt propre
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

module.exports = app;