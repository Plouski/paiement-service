// payment-service/config/webhookConfig.js
const stripe = require('./stripeConfig');
const { logger } = require('../utils/logger');

/**
 * Validates Stripe webhook events
 * @param {Object} req - Express request object
 * @param {string} signature - The stripe-signature header
 * @returns {Object} The validated event or throws an error
 */
const validateStripeWebhook = async (req, signature) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    logger.error('STRIPE_WEBHOOK_SECRET not configured');
    throw new Error('Webhook secret not configured');
  }
  
  try {
    // Verify the event came from Stripe using the webhook secret
    const event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      webhookSecret
    );
    
    logger.info(`Webhook received: ${event.type}`);
    return event;
  } catch (err) {
    logger.error(`Webhook signature verification failed: ${err.message}`);
    throw err;
  }
};

/**
 * Validates PayPal webhook events
 * @param {Object} req - Express request object
 * @returns {Object} The validated event or throws an error
 */
const validatePayPalWebhook = async (req) => {
  // PayPal webhook validation would go here
  // This is a placeholder for future implementation
  logger.info('PayPal webhook received, validation not yet implemented');
  return req.body;
};

module.exports = {
  validateStripeWebhook,
  validatePayPalWebhook
};