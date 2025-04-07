// payment-service/config/paypalConfig.js
const checkoutNodeJssdk = require('@paypal/checkout-server-sdk');
const { logger } = require('../utils/logger');

// Configure PayPal environment
const getPayPalEnvironment = () => {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    logger.warn('PayPal credentials missing or incomplete. PayPal integration disabled.');
    return null;
  }
  
  // Use sandbox for development, production for production
  const environment = process.env.NODE_ENV === 'production'
    ? new checkoutNodeJssdk.core.LiveEnvironment(clientId, clientSecret)
    : new checkoutNodeJssdk.core.SandboxEnvironment(clientId, clientSecret);
  
  return environment;
};

// Create PayPal client
const getPayPalClient = () => {
  const environment = getPayPalEnvironment();
  
  if (!environment) {
    return null;
  }
  
  return new checkoutNodeJssdk.core.PayPalHttpClient(environment);
};

module.exports = {
  getPayPalClient
};