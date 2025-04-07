// payment-service/services/paypalService.js
const { getPayPalClient } = require('../config/paypalConfig');
const checkoutNodeJssdk = require('@paypal/checkout-server-sdk');
const { logger } = require('../utils/logger');
const { formatAmount } = require('../utils/priceUtils');

/**
 * Create a PayPal checkout session for one-time payment
 */
const createCheckoutSession = async ({
  amount,
  currency = 'EUR',
  productId,
  userId,
  successUrl,
  cancelUrl
}) => {
  try {
    logger.info(`Creating PayPal checkout session for user ${userId}, product ${productId}`);
    
    const client = getPayPalClient();
    
    if (!client) {
      throw new Error('PayPal client not configured');
    }
    
    // Format the amount properly (PayPal uses strings)
    const formattedAmount = (formatAmount(amount, currency) / 100).toFixed(2);
    
    // Create a payment request
    const request = new checkoutNodeJssdk.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: currency,
          value: formattedAmount
        },
        description: `Product ID: ${productId}`,
        custom_id: userId,
        reference_id: productId
      }],
      application_context: {
        return_url: successUrl,
        cancel_url: cancelUrl,
        user_action: 'PAY_NOW',
        brand_name: 'Your Application Name'
      }
    });
    
    // Execute the request
    const response = await client.execute(request);
    
    // Find the approval URL
    const approvalUrl = response.result.links.find(link => link.rel === 'approve').href;
    
    return {
      id: response.result.id,
      url: approvalUrl
    };
  } catch (error) {
    logger.error(`Error creating PayPal checkout session: ${error.message}`);
    throw error;
  }
};

/**
 * Create a PayPal subscription plan
 */
const createSubscriptionPlan = async ({
  userId,
  priceId, // We'll need to map this to PayPal plans
  successUrl,
  cancelUrl
}) => {
  try {
    logger.info(`Creating PayPal subscription for user ${userId}, price ${priceId}`);
    
    const client = getPayPalClient();
    
    if (!client) {
      throw new Error('PayPal client not configured');
    }
    
    // In a real implementation, you would fetch or create the plan based on the priceId
    // For now, we'll assume a placeholder implementation
    
    // Create subscription request
    const request = new checkoutNodeJssdk.subscriptions.SubscriptionsCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      plan_id: 'PLAN_ID_MAPPED_FROM_STRIPE_PRICE', // You would map this from your DB
      subscriber: {
        name: {
          given_name: 'User',
          surname: userId.toString()
        }
      },
      application_context: {
        return_url: successUrl,
        cancel_url: cancelUrl,
        brand_name: 'Your Application Name',
        user_action: 'SUBSCRIBE_NOW'
      }
    });
    
    // Execute the request
    const response = await client.execute(request);
    
    // Find the approval URL
    const approvalUrl = response.result.links.find(link => link.rel === 'approve').href;
    
    return {
      id: response.result.id,
      url: approvalUrl
    };
  } catch (error) {
    logger.error(`Error creating PayPal subscription: ${error.message}`);
    throw error;
  }
};

/**
 * Capture a PayPal payment (after user approval)
 */
const capturePayment = async (orderId) => {
  try {
    const client = getPayPalClient();
    
    if (!client) {
      throw new Error('PayPal client not configured');
    }
    
    const request = new checkoutNodeJssdk.orders.OrdersCaptureRequest(orderId);
    request.prefer("return=representation");
    
    const response = await client.execute(request);
    
    return {
      id: response.result.id,
      status: response.result.status,
      captureId: response.result.purchase_units[0].payments.captures[0].id
    };
  } catch (error) {
    logger.error(`Error capturing PayPal payment: ${error.message}`);
    throw error;
  }
};

/**
 * Create a PayPal refund
 */
const createRefund = async (captureId, amount, reason) => {
  try {
    const client = getPayPalClient();
    
    if (!client) {
      throw new Error('PayPal client not configured');
    }
    
    const request = new checkoutNodeJssdk.payments.CapturesRefundRequest(captureId);
    
    // Add refund details if amount specified
    if (amount) {
      request.requestBody({
        amount: {
          value: (amount / 100).toFixed(2),
          currency_code: 'EUR'
        },
        note_to_payer: reason || 'Refund requested'
      });
    }
    
    const response = await client.execute(request);
    
    return {
      id: response.result.id,
      status: response.result.status
    };
  } catch (error) {
    logger.error(`Error creating PayPal refund: ${error.message}`);
    throw error;
  }
};

module.exports = {
  createCheckoutSession,
  createSubscriptionPlan,
  capturePayment,
  createRefund
};