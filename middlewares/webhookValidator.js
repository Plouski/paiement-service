// payment-service/middlewares/webhookValidator.js
const { validateStripeWebhook, validatePayPalWebhook } = require('../config/webhookConfig');
const { logger } = require('../utils/logger');

/**
 * Middleware to validate Stripe webhook signature
 */
const validateStripeSignature = async (req, res, next) => {
  try {
    // Get Stripe signature from header
    const signature = req.headers['stripe-signature'];
    
    if (!signature) {
      logger.error('No Stripe signature found in request header');
      return res.status(400).json({
        error: 'Missing Stripe signature'
      });
    }
    
    // Validate the webhook event using the signature
    const event = await validateStripeWebhook(req, signature);
    
    // Attach the validated event to the request object
    req.stripeEvent = event;
    
    next();
  } catch (error) {
    logger.error(`Stripe webhook validation failed: ${error.message}`);
    return res.status(400).json({
      error: 'Invalid Stripe webhook signature'
    });
  }
};

/**
 * Middleware to validate PayPal webhook request
 */
const validatePayPalRequest = async (req, res, next) => {
  try {
    // PayPal webhook validation
    // This is a placeholder for a more robust implementation
    // In a real app, you would verify the webhook CRC or other authentication
    
    const event = await validatePayPalWebhook(req);
    req.paypalEvent = event;
    
    next();
  } catch (error) {
    logger.error(`PayPal webhook validation failed: ${error.message}`);
    return res.status(400).json({
      error: 'Invalid PayPal webhook request'
    });
  }
};

module.exports = {
  validateStripeSignature,
  validatePayPalRequest
};