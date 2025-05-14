require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const { logger, stream } = require('./utils/logger');
const connectToDatabase = require('./config/db');
const { httpRequestsTotal, httpDurationHistogram } = require('./services/metricsServices');
const metricsRoutes = require('./routes/metricsRoutes');
const WebhookController = require('./controllers/webhookController');

// Créer le dossier de logs s'il n'existe pas
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Connexion à la base de données MongoDB
connectToDatabase();

// Initialiser express
const app = express();
const PORT = process.env.PORT || 5004;

app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  WebhookController.handleStripeWebhook
);

// ───────────── CORS ─────────────
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
  maxAge: 86400,
};

// ───────────── Middlewares globaux ─────────────
app.use(helmet({ contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false }));
app.use(cors(corsOptions));
app.use(morgan('combined', { stream }));

// ───────────── Metrics Middleware ─────────────
app.use((req, res, next) => {
  const start = process.hrtime();

  res.on('finish', () => {
    const duration = process.hrtime(start);
    const seconds = duration[0] + duration[1] / 1e9;

    httpRequestsTotal.inc({
      method: req.method,
      route: req.route ? req.route.path : req.path,
      status_code: res.statusCode,
    });

    httpDurationHistogram.observe({
      method: req.method,
      route: req.route ? req.route.path : req.path,
      status_code: res.statusCode,
    }, seconds);
  });

  next();
});

// ───────────── Body parser ─────────────
app.use(/^(?!\/webhooks\/stripe).+/, express.json({ limit: '1mb' }));
app.use(/^(?!\/webhooks\/stripe).+/, express.urlencoded({ extended: true }));

// ───────────── Routes ─────────────
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const stripeWebhookRoutes = require('./routes/stripeWebhookRoutes');
app.use('/subscription', subscriptionRoutes);
app.use('/webhooks', stripeWebhookRoutes);
app.use('/metrics', metricsRoutes);

// ───────────── Endpoint de santé ─────────────
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    service: 'payment-service',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ───────────── 404 & gestion des erreurs ─────────────
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: 'Endpoint not found',
      path: req.path,
      method: req.method,
    },
  });
});

app.use((err, req, res, next) => {
  logger.error(`Erreur non gérée: ${err.stack}`);
  const statusCode = err.statusCode || 500;
  const errorResponse = {
    error: {
      message: err.message || 'Internal Server Error',
      code: err.code || 'INTERNAL_ERROR',
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    },
  };
  res.status(statusCode).json(errorResponse);
});

// ───────────── Lancer le serveur ─────────────
const server = app.listen(PORT, () => {
  logger.info(`✅ Payment service running on port ${PORT}`);
  logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// ───────────── Arrêt propre ─────────────
['SIGTERM', 'SIGINT'].forEach(signal => {
  process.on(signal, () => {
    logger.info(`${signal} signal received: closing HTTP server`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  });
});

module.exports = app;