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
const metricsRoutes = require("./routes/metricsRoutes");

const {
  httpRequestsTotal,
  httpDurationHistogram,
  serviceHealthStatus,
  externalServiceHealth,
} = require('./services/metricsServices');

const app = express();
const PORT = process.env.PORT || 5004;

console.log("💳 Lancement du serveur de paiement...");

(async () => {
  try {
    // Connexion MongoDB
    await connectToDatabase();

    // Création du dossier de logs s'il n'existe pas
    const logsDir = path.join(__dirname, "logs");
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

    // Sécurité HTTP
    app.use(
      helmet({
        contentSecurityPolicy: process.env.NODE_ENV === "production" ? undefined : false,
        crossOriginEmbedderPolicy: false,
      })
    );

    // CORS
    app.use(cors({
      origin: process.env.CORS_ORIGINS?.split(",") || ["http://localhost:3000"],
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
      maxAge: 86400,
    }));

    // Logger HTTP connecté à Winston
    app.use(morgan("combined", { stream }));

    // ⏱Middleware de suivi des métriques HTTP
    app.use((req, res, next) => {
      const start = process.hrtime();
      res.on("finish", () => {
        const duration = process.hrtime(start);
        const seconds = duration[0] + duration[1] / 1e9;

        httpRequestsTotal.inc({
          method: req.method,
          route: req.route?.path || req.path,
          status_code: res.statusCode,
        });

        httpDurationHistogram.observe({
          method: req.method,
          route: req.route?.path || req.path,
          status_code: res.statusCode,
        }, seconds);
      });
      next();
    });

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

    // Route de webhook Stripe
    app.post(
      "/webhook",
      express.raw({ type: "application/json" }),
      WebhookController.handleStripeWebhook
    );

    // Routes principales
    app.use("/subscription", subscriptionRoutes);
    app.use("/metrics", metricsRoutes);

    // Route de vérification de santé
    app.get("/health", async (req, res) => {
      const health = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: {},
      };

      if (mongoose.connection.readyState === 1) {
        health.services.mongodb = "healthy";
        externalServiceHealth.set({ service_name: "mongodb" }, 1);
      } else {
        health.services.mongodb = "unhealthy";
        health.status = "degraded";
        externalServiceHealth.set({ service_name: "mongodb" }, 0);
      }

      const isHealthy = health.status === "healthy" ? 1 : 0;
      serviceHealthStatus.set({ service_name: "payment-service" }, isHealthy);

      const statusCode = isHealthy ? 200 : 503;
      res.status(statusCode).json(health);
    });

    // Test rapide de vie
    app.get("/ping", (req, res) => {
      res.status(200).json({
        status: "pong ✅",
        timestamp: new Date().toISOString(),
        service: "payment-service",
      });
    });

    // Gestion des routes non trouvées
    app.use((req, res) => {
      logger.warn("📍 Route non trouvée", {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });

      res.status(404).json({
        error: "Route non trouvée",
        message: `La route ${req.method} ${req.path} n'existe pas`,
        availableRoutes: [
          "GET /health",
          "GET /ping",
          "POST /webhook",
          "GET /subscription",
          "GET /metrics",
        ],
      });
    });

    // Middleware de gestion des erreurs
    app.use((err, req, res, next) => {
      logger.error(`Erreur non gérée: ${err.stack}`);
      const statusCode = err.statusCode || err.status || 500;
      res.status(statusCode).json({
        error: "Erreur serveur",
        message: err.message || "Erreur interne du serveur",
        ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
      });
    });

    // Lancement du serveur
    app.listen(PORT, () => {
      logger.info(`🚀 Serveur de paiement en écoute sur http://localhost:${PORT}`);
      logger.info(`🌍 Environnement: ${process.env.NODE_ENV || "development"}`);
      logger.info(`📊 Métriques: http://localhost:${PORT}/metrics`);
      logger.info(`❤️ Santé: http://localhost:${PORT}/health`);
    });    

  } catch (err) {
    console.error("❌ Erreur fatale au démarrage :", err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
