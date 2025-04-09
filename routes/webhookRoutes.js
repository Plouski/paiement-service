// routes/webhookRoutes.js
const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const { serviceAuthMiddleware } = require('../middlewares/authMiddleware');
const { logger } = require('../utils/logger');

/**
 * Configuration pour recevoir les webhooks Stripe
 * L'ordre des middlewares est important ici.
 * Le middleware raw doit être avant tout autre middleware qui tente de parser le body.
 */

// Middleware pour traiter les requêtes brutes
const stripeWebhookMiddleware = express.raw({ 
  type: 'application/json',
  limit: '10mb'  // Augmenter la limite pour les grands événements
});

/**
 * Route pour le webhook Stripe
 * @route POST /webhooks/stripe
 * @access Public (secured by Stripe signature)
 */
router.post('/stripe', stripeWebhookMiddleware, (req, res, next) => {
  // Vérifier que le body n'a pas été transformé
  if (req.body.type === undefined && Buffer.isBuffer(req.body)) {
    // Tout est OK, continuons
    webhookController.handleStripeWebhook(req, res);
  } else {
    // Le body a déjà été parsé, ce qui est problématique
    logger.error('Webhook Stripe reçu avec un body déjà parsé, ce qui empêche la vérification de signature');
    return res.status(400).json({
      error: 'Invalid webhook payload format'
    });
  }
});

/**
 * Route pour tester les webhooks en développement
 * @route POST /webhooks/stripe-test
 * @access Private (development only)
 */
if (process.env.NODE_ENV !== 'production') {
  router.post(
    '/stripe-test',
    express.json(), // Utiliser le parser JSON standard
    (req, res) => {
      logger.info('Test webhook reçu', { type: req.body.type });
      webhookController.handleStripeWebhookTest(req, res);
    }
  );
  
  // Route de test pour simuler un événement sans avoir Stripe
  router.post(
    '/simulate/:event',
    express.json(),
    (req, res) => {
      const eventType = req.params.event;
      const validEvents = [
        'checkout.session.completed',
        'invoice.paid',
        'customer.subscription.updated',
        'customer.subscription.deleted'
      ];
      
      if (!validEvents.includes(eventType)) {
        return res.status(400).json({
          error: 'Invalid event type',
          validEvents
        });
      }
      
      // Créer un événement simulé
      const simulatedEvent = {
        id: `evt_test_${Date.now()}`,
        type: eventType,
        data: {
          object: {
            id: `${eventType.split('.')[0]}_test_${Date.now()}`,
            customer: req.body.customerId || 'cus_test_123456',
            subscription: req.body.subscriptionId || 'sub_test_123456',
            ...req.body.data,
            metadata: {
              userId: req.body.userId || 'test_user_id',
              plan: req.body.plan || 'premium',
              ...req.body.metadata
            }
          }
        }
      };
      
      logger.info(`Simulation d'événement webhook: ${eventType}`, { event: simulatedEvent });
      
      // Traiter l'événement simulé
      const modifiedReq = {
        ...req,
        body: simulatedEvent
      };
      
      webhookController.handleStripeWebhookTest(modifiedReq, res);
    }
  );
}

/**
 * Route pour les webhooks de service
 * @route POST /webhooks/service
 * @access Private (secured by service API key)
 */
router.post(
  '/service',
  serviceAuthMiddleware,
  express.json(),
  (req, res) => {
    const { type, data, source } = req.body;
    
    logger.info(`Webhook de service reçu: ${type} depuis ${source}`);
    
    // À implémenter selon les besoins
    res.status(200).json({
      received: true,
      status: 'Service webhook endpoint ready'
    });
  }
);

module.exports = router;