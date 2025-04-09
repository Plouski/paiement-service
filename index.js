// payment-service/index.js
require('dotenv').config();
require('./services/metricRetryService');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const { logger, stream } = require('./utils/logger');
const path = require('path');
const fs = require('fs');

// Créer le dossier de logs s'il n'existe pas
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Import routes
const premiumRoutes = require('./routes/premiumRoutes');
const webhookRoutes = require('./routes/webhookRoutes');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 5004;

// Configurer les origines CORS autorisées
const allowedOrigins = process.env.CORS_ORIGINS 
  ? process.env.CORS_ORIGINS.split(',') 
  : ['http://localhost:3000'];

const corsOptions = {
  origin: function (origin, callback) {
    // Permettre les requêtes sans origine (comme les appels API)
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
  maxAge: 86400 // 24 heures
};

// Middlewares de sécurité
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false
}));
app.use(cors(corsOptions));

// Logging
app.use(morgan('combined', { stream }));

// IMPORTANT: Ne pas utiliser le body parser global
// car il interfère avec le webhook Stripe qui a besoin du body brut
// Le body parser est appliqué sélectivement dans les routes

// Appliquer le body parser pour les routes régulières, mais pas pour /webhooks/stripe
app.use(/^(?!\/webhooks\/stripe).+/, express.json({ limit: '1mb' }));
app.use(/^(?!\/webhooks\/stripe).+/, express.urlencoded({ extended: true }));

// Routes with their specific middlewares
app.use('/premium', premiumRoutes);
app.use('/webhooks', webhookRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    service: 'payment-service',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({
    error: {
      message: 'Endpoint not found',
      path: req.path,
      method: req.method
    }
  });
});

// Error handling middleware
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

// Start the server
const server = app.listen(PORT, () => {
  logger.info(`Payment service running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
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