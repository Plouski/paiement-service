// controllers/webhookController.js

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { logger } = require("../utils/logger");
const SubscriptionIntegrationService = require("../services/subscriptionIntegrationService");
const NotificationService = require("../services/notificationService");
const axios = require("axios");

class WebhookController {
  static async handleStripeWebhook(req, res) {
    const sig = req.headers["stripe-signature"];
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
          logger.info(`Événement non traité: ${event.type}`);
          return res.status(200).json({ received: true, ignored: true });
      }
    } catch (error) {
      logger.error(`Erreur processWebhookEvent: ${error.message}`);
      return res.status(200).json({ received: true, error: error.message });
    }
  }

  static async handleCheckoutSessionCompleted(session) {
    logger.info("[📥] Stripe webhook hit: checkout.session.completed");

    const userId = session.metadata?.userId;
    const planFromMetadata = session.metadata?.plan;

    if (!userId) {
      logger.error("[❌] Aucun userId trouvé dans les metadata Stripe");
      throw new Error("User ID manquant dans metadata");
    }

    logger.info(`Checkout réussi pour ${userId}, plan: ${planFromMetadata}`);

    let stripeSubscriptionId = null;
    let stripePriceId = null;
    let plan = planFromMetadata || "premium";
    const now = new Date();

    const isTest = session.id === "cs_test_simulated";

    if (session.subscription && !isTest) {
      try {
        const stripeSub = await stripe.subscriptions.retrieve(
          session.subscription
        );
        stripeSubscriptionId = stripeSub.id;
        stripePriceId = stripeSub.items.data[0]?.price?.id;
        plan =
          SubscriptionIntegrationService.getPlanFromStripePrice(stripePriceId);
      } catch (err) {
        logger.warn(`[Stripe] Erreur récupération abonnement: ${err.message}`);
      }
    }

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
        startDate: now,
        lastPaymentDate: now,
        lastTransactionId: session.payment_intent || session.id,
        updateUserRole: true,
      }
    );

    // 🔥 NOUVEAU : Récupérer les infos utilisateur et envoyer notifications
    try {
      const User = require("../models/User");
      const user = await User.findById(userId);

      if (user && user.email) {
        // Générer et envoyer la facture
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

        // Notification début d'abonnement
        await NotificationService.sendSubscriptionStarted(user.email, {
          plan,
          startDate: now,
          amount: session.amount_total / 100,
        });

        logger.info("✅ Notifications envoyées avec succès");
      }
    } catch (notificationError) {
      logger.warn("⚠️ Erreur envoi notifications:", notificationError.message);
      // Ne pas faire échouer le webhook pour une erreur de notification
    }

    return updated;
  }

  static async handleSubscriptionDeleted(subscription) {
    const customerId = subscription.customer;
    const userId = await SubscriptionIntegrationService.getUserIdFromCustomerId(
      customerId
    );

    const result = await SubscriptionIntegrationService.updateSubscription(
      userId,
      {
        status: "canceled",
        plan: "free",
        stripeSubscriptionId: subscription.id,
        updateUserRole: true,
      }
    );

    // 🔥 NOUVEAU : Notification fin d'abonnement
    try {
      const User = require("../models/User");
      const user = await User.findById(userId);

      if (user && user.email) {
        await NotificationService.sendSubscriptionEnded(user.email, {
          plan: result.plan,
          endDate: new Date(),
        });
      }
    } catch (notificationError) {
      logger.warn(
        "⚠️ Erreur notification fin abonnement:",
        notificationError.message
      );
    }

    return result;
  }

  static async handleSubscriptionUpdated(subscription) {
    logger.info("[🔄] Webhook: customer.subscription.updated");

    const customerId = subscription.customer;
    const userId = await SubscriptionIntegrationService.getUserIdFromCustomerId(
      customerId
    );

    if (!userId) {
      logger.warn(`❌ Aucun userId trouvé pour customerId: ${customerId}`);
      return { success: false, reason: "User not found" };
    }

    let plan = "premium";
    if (subscription.items.data.length > 0) {
      const priceId = subscription.items.data[0].price.id;
      plan = SubscriptionIntegrationService.getPlanFromStripePrice(priceId);
    }

    const endDate = new Date(subscription.current_period_end * 1000);

    // 🔥 LOGIQUE CORRIGÉE pour cancel_at_period_end
    let updateData = {
      plan,
      stripeSubscriptionId: subscription.id,
      endDate: endDate,
      updateUserRole: false, // Par défaut, ne pas changer le rôle
    };

    logger.info(`[🔍] Webhook subscription state:`, {
      status: subscription.status,
      cancel_at_period_end: subscription.cancel_at_period_end,
      current_period_end: endDate,
    });

    if (subscription.cancel_at_period_end === true) {
      // 🎯 Abonnement programmé pour annulation à la fin de période
      logger.info(
        `[📅] Abonnement programmé pour annulation à la fin de période: ${endDate}`
      );
      updateData.status = "canceled"; // Status = canceled
      updateData.isActive = true; // Mais reste actif jusqu'à endDate
      updateData.cancelationType = "end_of_period";
      // Garder le rôle premium jusqu'à la fin (updateUserRole: false)
    } else if (
      subscription.cancel_at_period_end === false &&
      subscription.status === "active"
    ) {
      // 🎯 Abonnement réactivé (cancel_at_period_end remis à false)
      logger.info(
        `[✅] Abonnement réactivé - cancel_at_period_end est maintenant false`
      );
      updateData.status = "active";
      updateData.isActive = true;
      updateData.cancelationType = null;
      updateData.updateUserRole = true; // Remettre le rôle premium
    } else {
      // 🎯 Cas normal - pas de changement de cancel_at_period_end
      logger.info(`[🔄] Mise à jour normale de l'abonnement`);
      updateData.status = subscription.status;
      updateData.isActive = subscription.status === "active";

      // Si statut devient inactif, rétrograder le rôle
      if (subscription.status !== "active") {
        updateData.updateUserRole = true;
      }
    }

    // 🔥 LOG DÉTAILLÉ pour debug
    logger.info(`[🔍] Update data pour userId ${userId}:`, {
      cancel_at_period_end: subscription.cancel_at_period_end,
      stripe_status: subscription.status,
      updateData,
    });

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

    // 🔥 NOUVEAU : Notification échec de paiement
    try {
      const User = require("../models/User");
      const user = await User.findById(userId);

      if (user && user.email) {
        await NotificationService.sendPaymentFailed(user.email, {
          amount: invoice.amount_due / 100,
          failureReason: invoice.last_payment_error?.message || "Échec inconnu",
          nextAttempt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // +3 jours
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
