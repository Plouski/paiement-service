// payment-service/controllers/webhookController.js
const stripe = require('../config/stripeConfig');
const dbService = require('../services/dbService');
const notificationService = require('../services/notificationService');
const { logger } = require('../utils/logger');

/**
 * Handle Stripe webhook events
 */
const handleStripeEvent = async (req, res) => {
  const event = req.stripeEvent; // Passed from the webhook validator middleware
  
  try {
    switch (event.type) {
      // Payment succeeded events
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object);
        break;
      
      // Subscription events
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object);
        break;
        
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
        
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
        
      // Invoice events
      case 'invoice.paid':
        await handleInvoicePaid(event.data.object);
        break;
        
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object);
        break;
        
      // Default case
      default:
        logger.info(`Unhandled Stripe event type: ${event.type}`);
    }
    
    // Return success response to Stripe
    res.status(200).json({ received: true });
  } catch (error) {
    logger.error(`Error processing Stripe webhook: ${error.message}`);
    // Still return 200 to Stripe to acknowledge receipt
    res.status(200).json({ received: true, error: error.message });
  }
};

/**
 * Handle PayPal webhook events
 */
const handlePayPalEvent = async (req, res) => {
  const event = req.body;
  
  try {
    switch (event.event_type) {
      // PayPal event handling would go here
      // This is a placeholder for future implementation
      
      default:
        logger.info(`Unhandled PayPal event type: ${event.event_type}`);
    }
    
    // Return success response to PayPal
    res.status(200).json({ received: true });
  } catch (error) {
    logger.error(`Error processing PayPal webhook: ${error.message}`);
    // Still return 200 to acknowledge receipt
    res.status(200).json({ received: true, error: error.message });
  }
};

/**
 * Handle Stripe checkout.session.completed event
 */
const handleCheckoutSessionCompleted = async (session) => {
  logger.info(`Processing checkout.session.completed for session ${session.id}`);
  
  try {
    // Extract customer and payment info
    const { customer, client_reference_id: userId, amount_total, currency } = session;
    
    if (session.mode === 'payment') {
      // Single payment
      
      // Update the transaction status in our database
      await dbService.updateTransactionBySessionId(session.id, {
        status: 'completed',
        stripeCustomerId: customer,
        paymentIntentId: session.payment_intent
      });
      
      // Retrieve product details if needed
      const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
      const productId = paymentIntent.metadata?.productId;
      
      // Send invoice email
      await notificationService.sendInvoice({
        userId,
        amount: amount_total / 100, // Convert from cents
        currency,
        productId,
        invoiceId: session.id,
        paymentDate: new Date()
      });
      
    } else if (session.mode === 'subscription') {
      // Handle in subscription events
      logger.info(`Subscription checkout completed, waiting for subscription events`);
    }
  } catch (error) {
    logger.error(`Error processing checkout.session.completed: ${error.message}`);
    throw error;
  }
};

/**
 * Handle Stripe customer.subscription.created event
 */
const handleSubscriptionCreated = async (subscription) => {
  logger.info(`Processing subscription.created for subscription ${subscription.id}`);
  
  try {
    // Extract subscription metadata
    const { customer, items, current_period_end, status } = subscription;
    
    // Get price ID and product ID from the subscription
    const priceId = items.data[0].price.id;
    const productId = items.data[0].price.product;
    
    // Get customer for user association
    const stripeCustomer = await stripe.customers.retrieve(customer);
    const userId = stripeCustomer.metadata.userId;
    
    if (!userId) {
      logger.error(`No userId found in customer metadata for subscription ${subscription.id}`);
      return;
    }
    
    // Calculate expiration date from current_period_end (UNIX timestamp)
    const expiresAt = new Date(current_period_end * 1000);
    
    // Update user subscription in database
    await dbService.createOrUpdateSubscription({
      userId,
      subscriptionId: subscription.id,
      status,
      priceId,
      productId,
      currentPeriodEnd: expiresAt,
      stripeCustomerId: customer
    });
    
    // Send subscription confirmation email
    await notificationService.sendSubscriptionConfirmation({
      userId,
      subscriptionId: subscription.id,
      productId,
      planName: items.data[0].price.nickname || 'Subscription',
      startDate: new Date(),
      expiresAt
    });
  } catch (error) {
    logger.error(`Error processing subscription.created: ${error.message}`);
    throw error;
  }
};

/**
 * Handle Stripe customer.subscription.updated event
 */
const handleSubscriptionUpdated = async (subscription) => {
  logger.info(`Processing subscription.updated for subscription ${subscription.id}`);
  
  try {
    // Extract subscription metadata
    const { status, current_period_end, cancel_at_period_end, items } = subscription;
    
    // Get price ID from the subscription
    const priceId = items.data[0].price.id;
    
    // Calculate expiration date from current_period_end (UNIX timestamp)
    const expiresAt = new Date(current_period_end * 1000);
    
    // Update subscription in database
    await dbService.updateSubscriptionById(subscription.id, {
      status,
      priceId,
      currentPeriodEnd: expiresAt,
      cancelAtPeriodEnd: cancel_at_period_end
    });
    
    // If subscription status changed to past due, notify customer
    if (status === 'past_due') {
      // Get user ID from database using subscription ID
      const { userId } = await dbService.getSubscriptionById(subscription.id);
      
      await notificationService.sendPaymentFailureNotice({
        userId,
        subscriptionId: subscription.id
      });
    }
  } catch (error) {
    logger.error(`Error processing subscription.updated: ${error.message}`);
    throw error;
  }
};

/**
 * Handle Stripe customer.subscription.deleted event
 */
const handleSubscriptionDeleted = async (subscription) => {
  logger.info(`Processing subscription.deleted for subscription ${subscription.id}`);
  
  try {
    // Get user ID from database using subscription ID
    const { userId } = await dbService.getSubscriptionById(subscription.id);
    
    // Update subscription status in database
    await dbService.updateSubscriptionById(subscription.id, {
      status: 'canceled',
      endedAt: new Date()
    });
    
    // Send subscription ended email
    await notificationService.sendSubscriptionEndedNotice({
      userId,
      subscriptionId: subscription.id,
      endDate: new Date()
    });
  } catch (error) {
    logger.error(`Error processing subscription.deleted: ${error.message}`);
    throw error;
  }
};

/**
 * Handle Stripe invoice.paid event
 */
const handleInvoicePaid = async (invoice) => {
  logger.info(`Processing invoice.paid for invoice ${invoice.id}`);
  
  try {
    // Check if this is a subscription invoice
    if (invoice.subscription) {
      // Get subscription details
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      
      // Get user ID from database using subscription ID
      const { userId } = await dbService.getSubscriptionById(invoice.subscription);
      
      // Update subscription payment status
      await dbService.recordSubscriptionPayment({
        subscriptionId: invoice.subscription,
        invoiceId: invoice.id,
        amount: invoice.amount_paid,
        currency: invoice.currency,
        paymentDate: new Date()
      });
      
      // Send invoice receipt
      await notificationService.sendInvoice({
        userId,
        subscriptionId: invoice.subscription,
        invoiceId: invoice.id,
        amount: invoice.amount_paid / 100, // Convert from cents
        currency: invoice.currency,
        paymentDate: new Date(),
        nextBillingDate: new Date(subscription.current_period_end * 1000)
      });
    }
  } catch (error) {
    logger.error(`Error processing invoice.paid: ${error.message}`);
    throw error;
  }
};

/**
 * Handle Stripe invoice.payment_failed event
 */
const handleInvoicePaymentFailed = async (invoice) => {
  logger.info(`Processing invoice.payment_failed for invoice ${invoice.id}`);
  
  try {
    // Check if this is a subscription invoice
    if (invoice.subscription) {
      // Get user ID from database using subscription ID
      const { userId } = await dbService.getSubscriptionById(invoice.subscription);
      
      // Update subscription payment status
      await dbService.updateSubscriptionPaymentStatus(invoice.subscription, 'failed');
      
      // Send payment failure notice
      await notificationService.sendPaymentFailureNotice({
        userId,
        subscriptionId: invoice.subscription,
        invoiceId: invoice.id,
        amount: invoice.amount_due / 100, // Convert from cents
        currency: invoice.currency,
        attemptCount: invoice.attempt_count,
        nextAttemptDate: invoice.next_payment_attempt ? 
                        new Date(invoice.next_payment_attempt * 1000) : null
      });
    }
  } catch (error) {
    logger.error(`Error processing invoice.payment_failed: ${error.message}`);
    throw error;
  }
};

module.exports = {
  handleStripeEvent,
  handlePayPalEvent
};