// payment-service/controllers/subscriptionController.js
const stripe = require('../config/stripeConfig');
const stripeService = require('../services/stripeService');
const paypalService = require('../services/paypalService');
const dbService = require('../services/dbService');
const notificationService = require('../services/notificationService');
const { logger } = require('../utils/logger');

/**
 * Create a new subscription
 */
const createSubscription = async (req, res, next) => {
  try {
    const { 
      userId, 
      priceId, 
      paymentMethod = 'stripe',
      successUrl,
      cancelUrl 
    } = req.body;
    
    if (!userId || !priceId || !successUrl || !cancelUrl) {
      return res.status(400).json({
        error: 'Missing required parameters (userId, priceId, successUrl, cancelUrl)'
      });
    }
    
    let session;
    // Create subscription session based on payment method
    if (paymentMethod === 'stripe') {
      session = await stripeService.createSubscriptionSession({
        userId,
        priceId,
        successUrl,
        cancelUrl
      });
    } else if (paymentMethod === 'paypal') {
      session = await paypalService.createSubscriptionPlan({
        userId,
        priceId,
        successUrl,
        cancelUrl
      });
    } else {
      return res.status(400).json({
        error: 'Unsupported payment method'
      });
    }
    
    res.status(200).json({
      success: true,
      sessionId: session.id,
      url: session.url
    });
  } catch (error) {
    logger.error(`Error creating subscription: ${error.message}`);
    next(error);
  }
};

/**
 * Get subscription status for a user
 */
const getSubscriptionStatus = async (req, res, next) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        error: 'Missing required parameter: userId'
      });
    }
    
    // Get subscription status from database service
    const subscriptionStatus = await dbService.getSubscriptionStatus(userId);
    
    res.status(200).json({
      success: true,
      subscription: subscriptionStatus
    });
  } catch (error) {
    logger.error(`Error fetching subscription status: ${error.message}`);
    next(error);
  }
};

/**
 * Get subscription details
 */
const getSubscriptionDetails = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    
    if (!subscriptionId) {
      return res.status(400).json({
        error: 'Missing required parameter: subscriptionId'
      });
    }
    
    // Get subscription from Stripe
    const subscription = await stripeService.getSubscription(subscriptionId);
    
    res.status(200).json({
      success: true,
      subscription
    });
  } catch (error) {
    logger.error(`Error fetching subscription details: ${error.message}`);
    next(error);
  }
};

/**
 * Cancel a subscription
 */
const cancelSubscription = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const { cancelAtPeriodEnd = true } = req.body;
    
    if (!subscriptionId) {
      return res.status(400).json({
        error: 'Missing required parameter: subscriptionId'
      });
    }
    
    // Cancel subscription with Stripe
    const canceledSubscription = await stripeService.cancelSubscription(
      subscriptionId,
      cancelAtPeriodEnd
    );
    
    // Update subscription status in database service
    await dbService.updateSubscriptionStatus(
      req.user.id,
      subscriptionId,
      cancelAtPeriodEnd ? 'canceling' : 'canceled'
    );
    
    // Send cancellation notification
    await notificationService.sendSubscriptionCancelationNotice({
      userId: req.user.id,
      subscriptionId,
      effectiveDate: cancelAtPeriodEnd ? 
        new Date(canceledSubscription.current_period_end * 1000) : 
        new Date()
    });
    
    res.status(200).json({
      success: true,
      subscription: canceledSubscription
    });
  } catch (error) {
    logger.error(`Error canceling subscription: ${error.message}`);
    next(error);
  }
};

/**
 * Update a subscription (change plan)
 */
const updateSubscription = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const { newPriceId } = req.body;
    
    if (!subscriptionId || !newPriceId) {
      return res.status(400).json({
        error: 'Missing required parameters: subscriptionId, newPriceId'
      });
    }
    
    // Update subscription with Stripe
    const updatedSubscription = await stripeService.updateSubscription(
      subscriptionId,
      newPriceId
    );
    
    // Update subscription details in database service
    await dbService.updateSubscriptionPlan(
      req.user.id,
      subscriptionId,
      newPriceId
    );
    
    // Send plan change notification
    await notificationService.sendSubscriptionUpdateNotice({
      userId: req.user.id,
      subscriptionId,
      newPlanId: newPriceId,
      effectiveDate: new Date()
    });
    
    res.status(200).json({
      success: true,
      subscription: updatedSubscription
    });
  } catch (error) {
    logger.error(`Error updating subscription: ${error.message}`);
    next(error);
  }
};

module.exports = {
  createSubscription,
  getSubscriptionStatus,
  getSubscriptionDetails,
  cancelSubscription,
  updateSubscription
};