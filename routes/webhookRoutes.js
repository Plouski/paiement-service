// routes/webhookRoutes.js
const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// Route pour le webhook Stripe (utiliser express.raw pour accéder au body brut)
router.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  webhookController.handleStripeWebhook
);

// Route de test pour le développement (n'utiliser que dans l'environnement de développement)
if (process.env.NODE_ENV !== 'production') {
  router.post(
    '/stripe-test',
    express.json(),  // Utiliser express.json() pour parser facilement
    webhookController.handleStripeWebhookTest
  );
}

module.exports = router;