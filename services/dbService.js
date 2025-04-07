// payment-service/services/dbService.js
const axios = require('axios');
const { logger } = require('../utils/logger');

// Base URL for database service
const DATABASE_SERVICE_URL = process.env.DATABASE_SERVICE_URL || 'http://localhost:5002';

/**
 * Create a new transaction record
 */
const createTransaction = async (transactionData) => {
  try {
    const response = await axios.post(
      `${DATABASE_SERVICE_URL}/transactions`,
      transactionData
    );
    
    return response.data;
  } catch (error) {
    logger.error(`Error creating transaction in database: ${error.message}`);
    throw error;
  }
};

/**
 * Update a transaction by session ID
 */
const updateTransactionBySessionId = async (sessionId, updateData) => {
  try {
    const response = await axios.put(
      `${DATABASE_SERVICE_URL}/transactions/session/${sessionId}`,
      updateData
    );
    
    return response.data;
  } catch (error) {
    logger.error(`Error updating transaction by session ID: ${error.message}`);
    throw error;
  }
};

/**
 * Update a transaction status by payment intent ID
 */
const updateTransactionStatus = async (paymentIntentId, status) => {
  try {
    const response = await axios.put(
      `${DATABASE_SERVICE_URL}/transactions/payment-intent/${paymentIntentId}/status`,
      { status }
    );
    
    return response.data;
  } catch (error) {
    logger.error(`Error updating transaction status: ${error.message}`);
    throw error;
  }
};

/**
 * Create or update a user subscription
 */
const createOrUpdateSubscription = async (subscriptionData) => {
  try {
    const { userId } = subscriptionData;
    
    // Check if user already has a subscription
    try {
      const existingResponse = await axios.get(
        `${DATABASE_SERVICE_URL}/users/${userId}/subscription`
      );
      
      // If exists, update it
      if (existingResponse.data && existingResponse.data.subscription) {
        const response = await axios.put(
          `${DATABASE_SERVICE_URL}/users/${userId}/subscription`,
          subscriptionData
        );
        return response.data;
      }
    } catch (error) {
      // No existing subscription found, continue to create
      if (error.response && error.response.status !== 404) {
        throw error;
      }
    }
    
    // Create new subscription
    const response = await axios.post(
      `${DATABASE_SERVICE_URL}/users/${userId}/subscription`,
      subscriptionData
    );
    
    return response.data;
  } catch (error) {
    logger.error(`Error creating/updating subscription: ${error.message}`);
    throw error;
  }
};

/**
 * Update a subscription by ID
 */
const updateSubscriptionById = async (subscriptionId, updateData) => {
  try {
    const response = await axios.put(
      `${DATABASE_SERVICE_URL}/subscriptions/${subscriptionId}`,
      updateData
    );
    
    return response.data;
  } catch (error) {
    logger.error(`Error updating subscription by ID: ${error.message}`);
    throw error;
  }
};

/**
 * Get a subscription by ID
 */
const getSubscriptionById = async (subscriptionId) => {
  try {
    const response = await axios.get(
      `${DATABASE_SERVICE_URL}/subscriptions/${subscriptionId}`
    );
    
    return response.data;
  } catch (error) {
    logger.error(`Error getting subscription by ID: ${error.message}`);
    throw error;
  }
};

/**
 * Get subscription status for a user
 */
const getSubscriptionStatus = async (userId) => {
  try {
    const response = await axios.get(
      `${DATABASE_SERVICE_URL}/users/${userId}/subscription`
    );
    
    return response.data.subscription;
  } catch (error) {
    logger.error(`Error getting subscription status: ${error.message}`);
    
    // If 404, return null (user has no subscription)
    if (error.response && error.response.status === 404) {
      return null;
    }
    
    throw error;
  }
};

/**
 * Update subscription plan for a user
 */
const updateSubscriptionPlan = async (userId, subscriptionId, priceId) => {
  try {
    const response = await axios.put(
      `${DATABASE_SERVICE_URL}/users/${userId}/subscription/plan`,
      {
        subscriptionId,
        priceId
      }
    );
    
    return response.data;
  } catch (error) {
    logger.error(`Error updating subscription plan: ${error.message}`);
    throw error;
  }
};

/**
 * Update subscription payment status
 */
const updateSubscriptionPaymentStatus = async (subscriptionId, status) => {
  try {
    const response = await axios.put(
      `${DATABASE_SERVICE_URL}/subscriptions/${subscriptionId}/payment-status`,
      { status }
    );
    
    return response.data;
  } catch (error) {
    logger.error(`Error updating subscription payment status: ${error.message}`);
    throw error;
  }
};

/**
 * Record a subscription payment
 */
const recordSubscriptionPayment = async (paymentData) => {
  try {
    const response = await axios.post(
      `${DATABASE_SERVICE_URL}/subscriptions/${paymentData.subscriptionId}/payments`,
      paymentData
    );
    
    return response.data;
  } catch (error) {
    logger.error(`Error recording subscription payment: ${error.message}`);
    throw error;
  }
};

module.exports = {
  createTransaction,
  updateTransactionBySessionId,
  updateTransactionStatus,
  createOrUpdateSubscription,
  updateSubscriptionById,
  getSubscriptionById,
  getSubscriptionStatus,
  updateSubscriptionPlan,
  updateSubscriptionPaymentStatus,
  recordSubscriptionPayment
};