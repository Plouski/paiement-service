const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { logger } = require("../utils/logger");
const SubscriptionIntegrationService = require("../services/subscriptionIntegrationService");
const NotificationService = require("../services/notificationService");

// Fonction pour calculer correctement les dates d'abonnement
function calculateSubscriptionDates(plan, startDate = new Date()) {
  const start = new Date(startDate);
  let endDate = new Date(start);

  switch (plan) {
    case "monthly":
      endDate.setMonth(endDate.getMonth() + 1);
      break;

    case "annual":
      endDate.setFullYear(endDate.getFullYear() + 1);
      break;

    case "premium":
      endDate.setMonth(endDate.getMonth() + 1);
      break;

    default:
      endDate.setMonth(endDate.getMonth() + 1);
  }

  return {
    startDate: start,
    endDate: endDate,
  };
}

class WebhookController {

  // Réception d’un webhook Stripe (signé)
  static async handleStripeWebhook(req, res) {
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
      logger.info(`📥 Webhook Stripe reçu: ${event.type}`);
    } catch (err) {
      logger.error(`❌ Erreur de signature webhook: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    return WebhookController.processWebhookEvent(event, res);
  }

  // Simulation de webhook Stripe (non signé)
  static async handleStripeWebhookTest(req, res) {
    const event = req.body;
    logger.info(`🧪 Test webhook Stripe: ${event.type}`);
    return WebhookController.processWebhookEvent(event, res);
  }

  // Traitement du webhook selon le type d’événement Stripe
  static async processWebhookEvent(event, res) {
    try {
      switch (event.type) {
        case "checkout.session.completed":
          return res.json(
            await WebhookController.handleCheckoutSessionCompleted(
              event.data.object
            )
          );

        case "customer.subscription.deleted":
          return res.json(
            await WebhookController.handleSubscriptionDeleted(event.data.object)
          );

        case "customer.subscription.updated":
          return res.json(
            await WebhookController.handleSubscriptionUpdated(event.data.object)
          );

        case "invoice.paid":
          return res.json(
            await WebhookController.handleInvoicePaid(event.data.object)
          );

        case "invoice.payment_failed":
          return res.json(
            await WebhookController.handleInvoicePaymentFailed(
              event.data.object
            )
          );

        default:
          logger.info(`ℹ️ Événement Stripe non traité: ${event.type}`);
          return res.status(200).json({ received: true, ignored: true });
      }
    } catch (error) {
      logger.error(`❌ Erreur processWebhookEvent: ${error.message}`);
      return res.status(200).json({ received: true, error: error.message });
    }
  }

  // Traitement de la création d'une session Checkout réussie
  static async handleCheckoutSessionCompleted(session) {
    logger.info("[📥] Stripe: checkout.session.completed reçu");

    const userId = session.metadata?.userId;
    const planFromMetadata = session.metadata?.plan;
    const isTest = session.id === "cs_test_simulated";

    if (!userId) {
      logger.error("❌ Aucun userId trouvé dans les metadata Stripe");
      throw new Error("User ID manquant dans metadata");
    }

    logger.info(`🛒 Checkout réussi pour ${userId}, plan: ${planFromMetadata}`);

    let stripeSubscriptionId = null;
    let stripePriceId = null;
    let plan = planFromMetadata || "monthly";
    const now = new Date();

    if (session.subscription && !isTest) {
      try {
        const stripeSub = await stripe.subscriptions.retrieve(
          session.subscription
        );
        stripeSubscriptionId = stripeSub.id;
        stripePriceId = stripeSub.items.data[0]?.price?.id;

        if (stripePriceId) {
          plan = await SubscriptionIntegrationService.getPlanFromStripePrice(
            stripePriceId
          );
        }
      } catch (err) {
        logger.warn(
          `[⚠️ Stripe] Erreur récupération abonnement: ${err.message}`
        );
      }
    }

    const { startDate, endDate } = calculateSubscriptionDates(plan, now);

    console.log(`📅 Dates calculées pour plan ${plan}:`, {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      duration: `${Math.ceil(
        (endDate - startDate) / (1000 * 60 * 60 * 24)
      )} jours`,
    });

    const updated = await SubscriptionIntegrationService.updateSubscription(
      userId,
      {
        plan,
        status: "active",
        paymentMethod: "stripe",
        isActive: true,
        sessionId: session.id,
        stripeCustomerId: session.customer,
        stripeSubscriptionId,
        stripePriceId,
        startDate: startDate,
        endDate: endDate,
        lastPaymentDate: now,
        lastTransactionId: session.payment_intent || session.id,
        updateUserRole: true,
        cancelationType: null,
        refundStatus: "none",
        refundAmount: 0,
        refundDate: null,
        refundReason: null,
        paymentStatus: "success",
      }
    );

    try {
      const User = require("../models/User");
      const user = await User.findById(userId);

      if (user?.email) {
        const invoiceData = NotificationService.generateInvoiceData(
          {
            plan,
            userEmail: user.email,
            userName: `${user.firstName} ${user.lastName}`,
            paymentMethod: "stripe",
          },
          {
            amount: session.amount_total / 100,
            currency: session.currency,
            transactionId: session.payment_intent || session.id,
          }
        );

        await NotificationService.sendInvoice(user.email, invoiceData);

        await NotificationService.sendSubscriptionStarted(user.email, {
          plan,
          startDate: now,
          amount: session.amount_total / 100,
        });

        logger.info("📧 Notifications d'abonnement envoyées avec succès");
      }
    } catch (notificationError) {
      logger.warn(
        "⚠️ Erreur notification abonnement:",
        notificationError.message
      );
    }

    return updated;
  }

  static async handleSubscriptionUpdated(subscription) {
    logger.info("[🔄] Stripe: customer.subscription.updated");

    const customerId = subscription.customer;
    const userId = await SubscriptionIntegrationService.getUserIdFromCustomerId(
      customerId
    );

    if (!userId) {
      logger.warn(`❌ Aucun userId pour customerId: ${customerId}`);
      return { success: false, reason: "User not found" };
    }

    let plan = "premium";
    if (subscription.items.data.length > 0) {
      const priceId = subscription.items.data[0].price.id;
      plan = SubscriptionIntegrationService.getPlanFromStripePrice(priceId);
    }

    const endDate = new Date(subscription.current_period_end * 1000);

    const updateData = {
      plan,
      stripeSubscriptionId: subscription.id,
      endDate,
      updateUserRole: false,
    };

    logger.info(`[🔍] Statut reçu:`, {
      status: subscription.status,
      cancel_at_period_end: subscription.cancel_at_period_end,
      current_period_end: endDate,
    });

    if (subscription.cancel_at_period_end === true) {
      logger.info(
        `[📅] Abonnement programmé pour annulation à la fin: ${endDate}`
      );
      updateData.status = "canceled";
      updateData.isActive = true;
      updateData.cancelationType = "end_of_period";
    } else if (subscription.status === "active") {
      logger.info(`[✅] Abonnement réactivé`);
      updateData.status = "active";
      updateData.isActive = true;
      updateData.cancelationType = null;
      updateData.updateUserRole = true;
    } else {
      logger.info(`[ℹ️] Mise à jour normale`);
      updateData.status = subscription.status;
      updateData.isActive = subscription.status === "active";
      if (subscription.status !== "active") {
        updateData.updateUserRole = true;
      }
    }

    logger.debug(`[🛠️] Données de mise à jour pour ${userId}:`, updateData);

    return SubscriptionIntegrationService.updateSubscription(
      userId,
      updateData
    );
  }

  static async handleInvoicePaid(invoice) {
    const customerId = invoice.customer;
    const userId = await SubscriptionIntegrationService.getUserIdFromCustomerId(
      customerId
    );

    return SubscriptionIntegrationService.recordSubscriptionPayment(userId, {
      amount: invoice.amount_paid / 100,
      currency: invoice.currency,
      transactionId: invoice.id,
      invoiceId: invoice.id,
      status: "success",
      isRenewal: invoice.billing_reason === "subscription_cycle",
    });
  }

  static async handleInvoicePaymentFailed(invoice) {
    const customerId = invoice.customer;
    const userId = await SubscriptionIntegrationService.getUserIdFromCustomerId(
      customerId
    );

    const result = await SubscriptionIntegrationService.recordPaymentFailure(
      userId,
      {
        amount: invoice.amount_due / 100,
        currency: invoice.currency,
        failureReason: invoice.last_payment_error?.message || "Échec inconnu",
        transactionId: invoice.payment_intent || invoice.id,
        invoiceId: invoice.id,
      }
    );

    try {
      const User = require("../models/User");
      const user = await User.findById(userId);

      if (user?.email) {
        await NotificationService.sendPaymentFailed(user.email, {
          amount: invoice.amount_due / 100,
          failureReason: invoice.last_payment_error?.message || "Échec inconnu",
          nextAttempt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        });
      }
    } catch (notificationError) {
      logger.warn(
        "⚠️ Erreur notification échec paiement:",
        notificationError.message
      );
    }

    return result;
  }
}

module.exports = WebhookController;
