// controllers/webhookController.js

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { logger } = require('../utils/logger');
const SubscriptionIntegrationService = require('../services/subscriptionIntegrationService');
const axios = require('axios');

class WebhookController {
  static async handleStripeWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
      logger.info(`Webhook Stripe reçu: ${event.type}`);
    } catch (err) {
      logger.error(`Erreur de signature webhook: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    return WebhookController.processWebhookEvent(event, res);
  }

  static async handleStripeWebhookTest(req, res) {
    const event = req.body;
    logger.info(`Test webhook Stripe: ${event.type}`);
    return WebhookController.processWebhookEvent(event, res);
  }

  static async processWebhookEvent(event, res) {
    try {
      switch (event.type) {
        case 'checkout.session.completed':
          return res.json(await WebhookController.handleCheckoutSessionCompleted(event.data.object));

        case 'customer.subscription.deleted':
          return res.json(await WebhookController.handleSubscriptionDeleted(event.data.object));

        case 'customer.subscription.updated':
          return res.json(await WebhookController.handleSubscriptionUpdated(event.data.object));

        case 'invoice.paid':
          return res.json(await WebhookController.handleInvoicePaid(event.data.object));

        case 'invoice.payment_failed':
          return res.json(await WebhookController.handleInvoicePaymentFailed(event.data.object));

        default:
          logger.info(`Événement non traité: ${event.type}`);
          return res.status(200).json({ received: true, ignored: true });
      }
    } catch (error) {
      logger.error(`Erreur processWebhookEvent: ${error.message}`);
      return res.status(200).json({ received: true, error: error.message });
    }
  }

  static async handleCheckoutSessionCompleted(session) {
    logger.info('[📥] Stripe webhook hit: checkout.session.completed');
    logger.info('[🔥] handleCheckoutSessionCompleted called', { session });
  
    const userId = session.metadata?.userId;
    const plan = session.metadata?.plan;
  
    if (!userId) {
      logger.error('[❌] Aucun userId trouvé dans les metadata Stripe');
      throw new Error("User ID manquant dans metadata");
    }
  
    logger.info(`Checkout réussi pour ${userId}, plan: ${plan}`);
  
    let stripePriceId = null;
    let stripeSubscriptionId = null;
  
    const isTest = session.id === 'cs_test_simulated';
  
    if (session.subscription && !isTest) {
      try {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        stripeSubscriptionId = subscription.id;
        stripePriceId = subscription.items.data[0]?.price?.id;
      } catch (err) {
        logger.warn(`[Stripe] Erreur de récupération de l'abonnement: ${err.message}`);
      }
    }
  
    const result = await SubscriptionIntegrationService.updateSubscription(userId, {
      plan,
      paymentMethod: 'stripe',
      status: 'active',
      sessionId: session.id,
      stripeCustomerId: session.customer,
      stripeSubscriptionId,
      stripePriceId,
      updateUserRole: true
    });
  
    logger.info('[✅] Subscription enregistrée avec succès');
  
    return result; // <--- ça doit renvoyer un résultat ici
  }  

  static async handleSubscriptionDeleted(subscription) {
    const customerId = subscription.customer;
    const userId = await SubscriptionIntegrationService.getUserIdFromCustomerId(customerId);
    return SubscriptionIntegrationService.updateSubscription(userId, {
      status: 'canceled',
      plan: 'free',
      stripeSubscriptionId: subscription.id,
      updateUserRole: true
    });
  }

  static async handleSubscriptionUpdated(subscription) {
    const customerId = subscription.customer;
    const userId = await SubscriptionIntegrationService.getUserIdFromCustomerId(customerId);

    let plan = 'premium';
    if (subscription.items.data.length > 0) {
      const priceId = subscription.items.data[0].price.id;
      plan = SubscriptionIntegrationService.getPlanFromStripePrice(priceId);
    }

    return SubscriptionIntegrationService.updateSubscription(userId, {
      status: subscription.status,
      plan,
      stripeSubscriptionId: subscription.id,
      updateUserRole: true
    });
  }

  static async handleInvoicePaid(invoice) {
    const customerId = invoice.customer;
    const userId = await SubscriptionIntegrationService.getUserIdFromCustomerId(customerId);

    return SubscriptionIntegrationService.recordSubscriptionPayment(userId, {
      amount: invoice.amount_paid / 100,
      currency: invoice.currency,
      transactionId: invoice.id,
      invoiceId: invoice.id,
      status: 'success',
      isRenewal: invoice.billing_reason === 'subscription_cycle'
    });
  }

  static async handleInvoicePaymentFailed(invoice) {
    const customerId = invoice.customer;
    const userId = await SubscriptionIntegrationService.getUserIdFromCustomerId(customerId);

    return SubscriptionIntegrationService.recordPaymentFailure(userId, {
      amount: invoice.amount_due / 100,
      currency: invoice.currency,
      failureReason: invoice.last_payment_error?.message || 'Échec inconnu',
      transactionId: invoice.payment_intent || invoice.id,
      invoiceId: invoice.id
    });
  }
}

module.exports = WebhookController;
