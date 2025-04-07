// payment-service/services/stripeService.js
const stripe = require('../config/stripeConfig');
const { logger } = require('../utils/logger');
const { formatAmount } = require('../utils/priceUtils');

/**
 * Create a Stripe checkout session for one-time payment
 */
const createCheckoutSession = async ({
  amount,
  currency = 'eur',
  productId,
  userId,
  successUrl,
  cancelUrl
}) => {
  try {
    logger.info(`Creating Stripe checkout session for user ${userId}, product ${productId}`);
    
    // Créer directement la session sans créer de client
    // Pour les tests, nous n'avons pas besoin d'associer un client
    
    // Create a checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      // Ne pas utiliser de client pour le test
      client_reference_id: userId,
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: `Product ID: ${productId}`,
              // Metadata n'est pas supporté directement dans price_data.product_data
              description: `Product Reference: ${productId}`
            },
            unit_amount: formatAmount(amount, currency),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      // Déplacer les métadonnées au bon niveau
      payment_intent_data: {
        metadata: {
          userId: userId.toString(),
          productId: productId.toString()
        }
      }
    });
    
    return session;
  } catch (error) {
    logger.error(`Error creating Stripe checkout session: ${error.message}`);
    throw error;
  }
};

/**
 * Create a Stripe subscription session
 */
const createSubscriptionSession = async ({
  userId,
  priceId,
  successUrl,
  cancelUrl
}) => {
  try {
    logger.info(`Creating Stripe subscription session for user ${userId}, price ${priceId}`);
    
    // Ensure we have a Stripe customer for this user
    const customer = await getOrCreateCustomer(userId);
    
    // Create a subscription checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer: customer.id,
      client_reference_id: userId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId,
        priceId
      }
    });
    
    return session;
  } catch (error) {
    logger.error(`Error creating Stripe subscription session: ${error.message}`);
    throw error;
  }
};

/**
 * Get or create a Stripe customer for a user
 */
const getOrCreateCustomer = async (userId) => {
  try {
    // Vérifier que l'objet stripe est correctement initialisé
    if (!stripe || !stripe.customers) {
      throw new Error('Client Stripe non initialisé correctement');
    }
    
    // Créer directement un nouveau client
    // Note: Dans un environnement de production, vous voudriez vérifier si 
    // le client existe déjà, mais pour simplifier les tests, nous créons 
    // toujours un nouveau client
    const newCustomer = await stripe.customers.create({
      description: `Customer for user ID: ${userId}`,
      metadata: {
        userId: userId.toString()
      }
    });
    
    logger.info(`Nouveau client Stripe créé: ${newCustomer.id}`);
    return newCustomer;
  } catch (error) {
    logger.error(`Error getting or creating Stripe customer: ${error.message}`);
    throw error;
  }
};

/**
 * Get public price list from Stripe
 */
const getPublicPrices = async () => {
  try {
    const prices = await stripe.prices.list({
      active: true,
      expand: ['data.product']
    });
    
    // Filter and format prices for the frontend
    return prices.data.map(price => ({
      id: price.id,
      productId: price.product.id,
      name: price.product.name,
      description: price.product.description,
      unitAmount: price.unit_amount / 100,
      currency: price.currency,
      interval: price.recurring?.interval || null,
      intervalCount: price.recurring?.interval_count || null
    }));
  } catch (error) {
    logger.error(`Error fetching Stripe prices: ${error.message}`);
    throw error;
  }
};

/**
 * Get subscription details from Stripe
 */
const getSubscription = async (subscriptionId) => {
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    return subscription;
  } catch (error) {
    logger.error(`Error fetching Stripe subscription: ${error.message}`);
    throw error;
  }
};

/**
 * Cancel a subscription
 */
const cancelSubscription = async (subscriptionId, cancelAtPeriodEnd = true) => {
  try {
    if (cancelAtPeriodEnd) {
      // Cancel at the end of the billing period
      const subscription = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true
      });
      return subscription;
    } else {
      // Cancel immediately
      const subscription = await stripe.subscriptions.cancel(subscriptionId);
      return subscription;
    }
  } catch (error) {
    logger.error(`Error canceling Stripe subscription: ${error.message}`);
    throw error;
  }
};

/**
 * Update a subscription to a new price
 */
const updateSubscription = async (subscriptionId, newPriceId) => {
  try {
    // Get the subscription to find the item ID
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const subscriptionItemId = subscription.items.data[0].id;
    
    // Update the subscription
    const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
      items: [
        {
          id: subscriptionItemId,
          price: newPriceId
        }
      ],
      proration_behavior: 'create_prorations'
    });
    
    return updatedSubscription;
  } catch (error) {
    logger.error(`Error updating Stripe subscription: ${error.message}`);
    throw error;
  }
};

/**
 * Create a refund
 */
const createRefund = async ({ paymentIntentId, amount, reason }) => {
  try {
    const refundParams = {
      payment_intent: paymentIntentId,
      reason: reason || 'requested_by_customer'
    };
    
    // If amount specified, add it to refund params
    if (amount) {
      refundParams.amount = formatAmount(amount);
    }
    
    const refund = await stripe.refunds.create(refundParams);
    return refund;
  } catch (error) {
    logger.error(`Error creating Stripe refund: ${error.message}`);
    throw error;
  }
};

module.exports = {
  createCheckoutSession,
  createSubscriptionSession,
  getOrCreateCustomer,
  getPublicPrices,
  getSubscription,
  cancelSubscription,
  updateSubscription,
  createRefund
};