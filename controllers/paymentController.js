// payment-service/controllers/paymentController.js
const stripe = require('../config/stripeConfig');
const stripeService = require('../services/stripeService');
const paypalService = require('../services/paypalService');
const dbService = require('../services/dbService');
const notificationService = require('../services/notificationService');
const { logger } = require('../utils/logger');
const { formatAmount } = require('../utils/priceUtils');

/**
 * Create a checkout session for one-time payment
 */
const createCheckoutSession = async (req, res, next) => {
  try {
    const { amount, currency = 'eur', productId, userId, paymentMethod = 'stripe', successUrl, cancelUrl } = req.body;
    
    if (!amount || !productId || !userId || !successUrl || !cancelUrl) {
      return res.status(400).json({
        error: 'Missing required parameters (amount, productId, userId, successUrl, cancelUrl)'
      });
    }
    
    // Format amount for consistent handling
    const formattedAmount = formatAmount(amount, currency);
    
    let session;
    // Create payment session based on selected payment method
    if (paymentMethod === 'stripe') {
      session = await stripeService.createCheckoutSession({
        amount: formattedAmount,
        currency,
        productId,
        userId,
        successUrl,
        cancelUrl
      });
    } else if (paymentMethod === 'paypal') {
      session = await paypalService.createCheckoutSession({
        amount: formattedAmount,
        currency,
        productId,
        userId,
        successUrl,
        cancelUrl
      });
    } else {
      return res.status(400).json({
        error: 'Unsupported payment method'
      });
    }
    
    // Create transaction record in our database
    await dbService.createTransaction({
      userId,
      amount: formattedAmount,
      currency,
      productId,
      paymentMethod,
      status: 'pending',
      sessionId: session.id
    });
    
    res.status(200).json({
      success: true,
      sessionId: session.id,
      url: session.url
    });
  } catch (error) {
    logger.error(`Error creating checkout session: ${error.message}`);
    next(error);
  }
};

/**
 * Get public product prices (for display on frontend)
 */
const getPublicPrices = async (req, res, next) => {
  try {
    // Get prices from Stripe
    const prices = await stripeService.getPublicPrices();
    
    res.status(200).json({
      success: true,
      prices
    });
  } catch (error) {
    logger.error(`Error fetching prices: ${error.message}`);
    next(error);
  }
};

/**
 * Process a refund request
 */
const refundPayment = async (req, res, next) => {
  try {
    const { paymentIntentId, amount, reason } = req.body;
    
    if (!paymentIntentId) {
      return res.status(400).json({
        error: 'Missing required parameter: paymentIntentId'
      });
    }
    
    // Process refund with Stripe
    const refund = await stripeService.createRefund({
      paymentIntentId,
      amount,
      reason
    });
    
    // Update transaction status in our database
    await dbService.updateTransactionStatus(paymentIntentId, 'refunded');
    
    // Send refund notification email
    await notificationService.sendRefundNotification({
      userId: req.user.id,
      refundId: refund.id,
      amount: refund.amount,
      currency: refund.currency
    });
    
    res.status(200).json({
      success: true,
      refundId: refund.id
    });
  } catch (error) {
    logger.error(`Error processing refund: ${error.message}`);
    next(error);
  }
};

module.exports = {
  createCheckoutSession,
  getPublicPrices,
  refundPayment
};