// payment-service/routes/webhookRoutes.js
const express = require('express');
const router = express.Router();

// Import controllers
const webhookController = require('../controllers/webhookController');

// Import middleware for webhook validation
const webhookValidator = require('../middlewares/webhookValidator');

// Special body parser configuration for Stripe webhooks
// It must be raw body for signature verification
router.post('/stripe', 
  express.raw({type: 'application/json'}), 
  webhookValidator.validateStripeSignature,
  webhookController.handleStripeEvent
);

// PayPal webhook endpoint
router.post('/paypal',
  express.json(),
  webhookValidator.validatePayPalRequest,
  webhookController.handlePayPalEvent
);

module.exports = router;