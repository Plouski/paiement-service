require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");
const { logger, stream } = require("./utils/logger");
const connectToDatabase = require("./config/db");
const WebhookController = require("./controllers/webhookController");
const subscriptionRoutes = require("./routes/subscriptionRoutes");
const {
  register,
  httpRequestDuration,
  httpRequestsTotal,
  updateServiceHealth,
  updateActiveConnections,
  updateDatabaseHealth,
  updateExternalServiceHealth
} = require('./metrics');

const app = express();
const PORT = process.env.PORT || 5004;
const METRICS_PORT = process.env.METRICS_PORT || 9090;
const SERVICE_NAME = "paiement-service";

console.log(`🔥 Lancement du ${SERVICE_NAME}...`);

// INITIALISATION ASYNC

(async () => {
  try {
    // Connexion MongoDB
    await connectToDatabase();
    logger.info("✅ MongoDB connecté");
    updateDatabaseHealth('mongodb', true);

    const logsDir = path.join(__dirname, "logs");
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

    // MIDDLEWARES SPÉCIFIQUES PAIEMENT

    // Sécurité HTTP
    app.use(helmet({
      contentSecurityPolicy: process.env.NODE_ENV === "production" ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }));

    // CORS
    app.use(cors({
      origin: process.env.CORS_ORIGINS?.split(",") || ["http://localhost:3000"],
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
      maxAge: 86400,
    }));

    // Logger HTTP
    app.use(morgan("combined", { stream }));

    // MIDDLEWARE DE MÉTRIQUES STANDARDISÉ

    let currentConnections = 0;

    app.use((req, res, next) => {
      const start = Date.now();
      currentConnections++;
      updateActiveConnections(currentConnections);

      res.on("finish", () => {
        const duration = (Date.now() - start) / 1000;
        currentConnections--;
        updateActiveConnections(currentConnections);

        httpRequestDuration.observe(
          {
            method: req.method,
            route: req.route?.path || req.path,
            status_code: res.statusCode,
          },
          duration
        );

        httpRequestsTotal.inc({
          method: req.method,
          route: req.route?.path || req.path,
          status_code: res.statusCode,
        });

        logger.info(`${req.method} ${req.path} - ${res.statusCode} - ${Math.round(duration * 1000)}ms`);
      });

      next();
    });

    // MIDDLEWARES SPÉCIAUX POUR WEBHOOKS

    // Middleware JSON sauf pour /webhook
    app.use((req, res, next) => {
      const isRawRoute = req.path === "/webhook" || req.path === "/webhooks/stripe";
      if (!isRawRoute) express.json({ limit: "1mb" })(req, res, next);
      else next();
    });

    // Middleware URL-encoded sauf pour /webhook
    app.use((req, res, next) => {
      const isRawRoute = req.path === "/webhook" || req.path === "/webhooks/stripe";
      if (!isRawRoute) express.urlencoded({ extended: true })(req, res, next);
      else next();
    });

    // MONITORING MONGODB

    mongoose.connection.on('connected', () => {
      logger.info('✅ MongoDB connecté');
      updateDatabaseHealth('mongodb', true);
    });

    mongoose.connection.on('error', (err) => {
      logger.error('❌ Erreur MongoDB:', err);
      updateDatabaseHealth('mongodb', false);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('⚠️ MongoDB déconnecté');
      updateDatabaseHealth('mongodb', false);
    });

    // ROUTES SPÉCIFIQUES PAIEMENT

    // Route de webhook Stripe (spéciale avec raw body)
    app.post("/webhook", 
      express.raw({ type: "application/json" }),
      (req, res, next) => {
        logger.info(`Webhook Stripe reçu: ${req.headers['stripe-event'] || 'unknown'}`);
        next();
      },
      WebhookController.handleStripeWebhook
    );

    // Routes principales
    app.use("/subscription", subscriptionRoutes);

    // ROUTES STANDARD

    // Métriques Prometheus
    app.get("/metrics", async (req, res) => {
      res.set("Content-Type", register.contentType);
      res.end(await register.metrics());
    });

    // Health check enrichi pour paiement-service
    app.get("/health", async (req, res) => {
      const health = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        service: SERVICE_NAME,
        version: "1.0.0",
        dependencies: {}
      };

      // Vérifier MongoDB
      if (mongoose.connection.readyState === 1) {
        health.dependencies.mongodb = "healthy";
        updateDatabaseHealth('mongodb', true);
      } else {
        health.dependencies.mongodb = "unhealthy";
        health.status = "degraded";
        updateDatabaseHealth('mongodb', false);
      }

      // Vérifier Stripe
      if (process.env.STRIPE_SECRET_KEY) {
        health.dependencies.stripe = "configured";
        updateExternalServiceHealth('stripe', true);
      } else {
        health.dependencies.stripe = "not_configured";
        health.status = "degraded";
        updateExternalServiceHealth('stripe', false);
      }

      // Vérifier PayPal
      if (process.env.PAYPAL_CLIENT_ID) {
        health.dependencies.paypal = "configured";
        updateExternalServiceHealth('paypal', true);
      } else {
        health.dependencies.paypal = "not_configured";
        updateExternalServiceHealth('paypal', false);
      }

      const isHealthy = health.status === "healthy";
      updateServiceHealth(SERVICE_NAME, isHealthy);

      const statusCode = isHealthy ? 200 : 503;
      res.status(statusCode).json(health);
    });

    // Vitals
    app.get("/vitals", async (req, res) => {
      const vitals = {
        service: SERVICE_NAME,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        status: "running",
        active_connections: currentConnections,
        
        payment: {
          providers: {
            stripe: !!process.env.STRIPE_SECRET_KEY,
            paypal: !!process.env.PAYPAL_CLIENT_ID
          },
          webhook_endpoints: [
            "/webhook"
          ],
          currencies_supported: ["EUR", "USD"]
        },
        
        database: {
          mongodb: {
            status: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
            host: mongoose.connection.host || 'unknown',
            name: mongoose.connection.name || 'unknown'
          }
        },
        
        api: {
          endpoints: [
            "/subscription",
            "/webhook"
          ]
        }
      };

      res.json(vitals);
    });

    // Ping
    app.get("/ping", (req, res) => {
      res.json({
        status: "pong ✅",
        service: SERVICE_NAME,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });

    // GESTION D'ERREURS

    app.use((req, res) => {
      res.status(404).json({
        error: "Route non trouvée",
        service: SERVICE_NAME,
        message: `${req.method} ${req.path} n'existe pas`,
        availableRoutes: [
          "GET /health", "GET /vitals", "GET /metrics", "GET /ping",
          "POST /webhook", "GET /subscription"
        ],
      });
    });

    app.use((err, req, res, next) => {
      logger.error(`💥 Erreur ${SERVICE_NAME}:`, err.message);

      if (err.type === 'StripeConnectionError') {
        updateExternalServiceHealth('stripe', false);
        return res.status(503).json({
          error: "Service de paiement indisponible",
          service: SERVICE_NAME,
          message: "Stripe est temporairement indisponible",
        });
      }

      if (err.name === 'PaymentError') {
        return res.status(400).json({
          error: "Erreur de paiement",
          service: SERVICE_NAME,
          message: err.message,
        });
      }

      if (err.name === 'MongoError' || err.name === 'MongoServerError') {
        updateDatabaseHealth('mongodb', false);
        return res.status(503).json({
          error: "Erreur base de données",
          service: SERVICE_NAME,
          message: "Service temporairement indisponible",
        });
      }

      res.status(err.statusCode || 500).json({
        error: "Erreur serveur",
        service: SERVICE_NAME,
        message: err.message || "Erreur interne du serveur",
        ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
      });
    });

    // DÉMARRAGE

    // Serveur principal
    app.listen(PORT, () => {
      console.log(`💳 ${SERVICE_NAME} démarré sur le port ${PORT}`);
      console.log(`📊 Métriques: http://localhost:${PORT}/metrics`);
      console.log(`❤️ Health: http://localhost:${PORT}/health`);
      console.log(`📈 Vitals: http://localhost:${PORT}/vitals`);
      console.log(`💰 Webhook: http://localhost:${PORT}/webhook`);
      
      updateServiceHealth(SERVICE_NAME, true);
      logger.info(`✅ ${SERVICE_NAME} avec métriques démarré`);
    });

    // Serveur métriques séparé
    const metricsApp = express();
    metricsApp.get('/metrics', async (req, res) => {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    });

    metricsApp.get('/health', (req, res) => {
      res.json({ status: 'healthy', service: `${SERVICE_NAME}-metrics` });
    });

    metricsApp.listen(METRICS_PORT, () => {
      console.log(`📊 Metrics server running on port ${METRICS_PORT}`);
    });

  } catch (err) {
    console.error("❌ Erreur fatale au démarrage :", err.message);
    updateServiceHealth(SERVICE_NAME, false);
    updateDatabaseHealth('mongodb', false);
    process.exit(1);
  }
})();

// GRACEFUL SHUTDOWN

function gracefulShutdown(signal) {
  console.log(`🔄 Arrêt ${SERVICE_NAME} (${signal})...`);
  updateServiceHealth(SERVICE_NAME, false);
  updateDatabaseHealth('mongodb', false);
  updateExternalServiceHealth('stripe', false);
  updateExternalServiceHealth('paypal', false);
  updateActiveConnections(0);
  
  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', reason);
  updateServiceHealth(SERVICE_NAME, false);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  updateServiceHealth(SERVICE_NAME, false);
  process.exit(1);
});

module.exports = app;