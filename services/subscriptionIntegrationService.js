const Subscription = require('../models/Subscription');
const User = require('../models/User');
const { logger } = require('../utils/logger');
const mongoose = require('mongoose');
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SubscriptionIntegrationService = {
  async updateSubscription(userId, data) {
    logger.info("[🔄] updateSubscription", { userId, data });

    const objectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    // ✅ Mise à jour du rôle utilisateur si demandé
    if (data.updateUserRole === true) {
      if (data.status === 'active') {
        await User.findByIdAndUpdate(objectId, { role: 'premium' });
        logger.info(`[👤] Rôle mis à jour → premium pour l'utilisateur ${objectId}`);
      } else if (data.status === 'canceled') {
        await User.findByIdAndUpdate(objectId, { role: 'user' });
        logger.info(`[👤] Rôle mis à jour → user pour l'utilisateur ${objectId}`);
      }
    }

    // 🔒 Ne pas écraser un abonnement actif par une annulation si un actif est déjà présent
    if (data.status === 'canceled') {
      const existing = await Subscription.findOne({ userId: objectId, status: 'active' });
      if (existing) {
        logger.warn(`[⚠️] Abonnement actif existant – annulation ignorée`, { userId });
        return existing;
      }
    }

    const updated = await Subscription.findOneAndUpdate(
      { userId: objectId },
      {
        ...data,
        updatedAt: new Date(),
        isActive: data.status === 'active'
      },
      { upsert: true, new: true }
    );

    logger.info("[✅] Subscription mise à jour", {
      userId: objectId,
      status: updated.status,
      plan: updated.plan,
      stripeId: updated.stripeSubscriptionId
    });

    return updated;
  },

  async getUserIdFromCustomerId(customerId) {
    const subscription = await Subscription.findOne({ stripeCustomerId: customerId });
    if (!subscription) {
      logger.warn(`[❌] Aucun abonnement trouvé pour le customerId ${customerId}`);
    }
    return subscription?.userId;
  },

  async recordSubscriptionPayment(userId, paymentData) {
    logger.info("💰 Paiement reçu", { userId, ...paymentData });
    return Subscription.findOneAndUpdate(
      { userId },
      {
        lastPaymentDate: new Date(),
        lastTransactionId: paymentData.transactionId,
        paymentStatus: 'success'
      },
      { new: true }
    );
  },

  async recordPaymentFailure(userId, failureData) {
    logger.warn("❌ Échec de paiement", { userId, ...failureData });
    return Subscription.findOneAndUpdate(
      { userId },
      {
        paymentStatus: 'failed',
        paymentFailureReason: failureData.failureReason,
        lastFailureDate: new Date()
      },
      { new: true }
    );
  },

  getPlanFromStripePrice(priceId) {
    switch (priceId) {
      case process.env.STRIPE_PRICE_ANNUAL_ID:
        return 'annual';
      case process.env.STRIPE_PRICE_MONTHLY_ID:
        return 'monthly';
      default:
        return 'premium';
    }
  },

  async getCurrentSubscription(userId) {
    return Subscription.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      isActive: true
    });
  },

  async cancelSubscription(userId) {
    const subscription = await Subscription.findOne({ 
      userId, 
      status: 'active',
      isActive: true 
    });

    if (!subscription) {
      throw new Error("Aucun abonnement actif à annuler.");
    }

    logger.info(`[🔚] Début annulation abonnement pour ${userId}`, {
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      plan: subscription.plan
    });

    // 🔥 ÉTAPE 1 : Annuler dans Stripe AVANT la DB
    if (subscription.stripeSubscriptionId) {
      try {
        logger.info(`[📞] Annulation Stripe subscription: ${subscription.stripeSubscriptionId}`);
        
        const canceledStripeSubscription = await stripe.subscriptions.cancel(
          subscription.stripeSubscriptionId,
          {
            // Options d'annulation
            prorate: false,  // Pas de proratisation
            invoice_now: false,  // Pas de facture immédiate
          }
        );

        logger.info(`[✅] Stripe subscription annulé:`, {
          id: canceledStripeSubscription.id,
          status: canceledStripeSubscription.status,
          canceled_at: canceledStripeSubscription.canceled_at
        });

      } catch (stripeError) {
        logger.error(`[❌] Erreur annulation Stripe:`, {
          message: stripeError.message,
          type: stripeError.type,
          code: stripeError.code
        });

        // Si l'abonnement n'existe plus dans Stripe, continuer quand même
        if (stripeError.code === 'resource_missing') {
          logger.warn(`[⚠️] Abonnement déjà supprimé dans Stripe, continuation...`);
        } else {
          // Pour les autres erreurs, propager l'erreur
          throw new Error(`Échec annulation Stripe: ${stripeError.message}`);
        }
      }
    } else {
      logger.warn(`[⚠️] Pas de stripeSubscriptionId trouvé, annulation locale uniquement`);
    }

    // 🔥 ÉTAPE 2 : Mettre à jour la DB locale
    subscription.status = 'canceled';
    subscription.endDate = new Date();
    subscription.isActive = false;
    subscription.updatedAt = new Date();

    await subscription.save();

    // 🔥 ÉTAPE 3 : Rétrograder le rôle utilisateur
    await User.findByIdAndUpdate(userId, { role: 'user' });

    logger.info(`[🔚] Abonnement complètement annulé pour ${userId}`, {
      localStatus: subscription.status,
      endDate: subscription.endDate
    });

    return subscription;
  },

  // 🔥 NOUVELLE MÉTHODE : Vérifier le statut Stripe vs DB
  async syncSubscriptionWithStripe(userId) {
    try {
      const localSubscription = await Subscription.findOne({ userId });
      
      if (!localSubscription || !localSubscription.stripeSubscriptionId) {
        return { synced: true, message: 'Pas d\'abonnement Stripe à synchroniser' };
      }

      // Récupérer le statut depuis Stripe
      const stripeSubscription = await stripe.subscriptions.retrieve(
        localSubscription.stripeSubscriptionId
      );

      logger.info(`[🔄] Sync check:`, {
        local: localSubscription.status,
        stripe: stripeSubscription.status
      });

      // Si les statuts diffèrent, mettre à jour la DB
      if (localSubscription.status !== stripeSubscription.status) {
        logger.warn(`[⚠️] Désynchronisation détectée!`, {
          userId,
          localStatus: localSubscription.status,
          stripeStatus: stripeSubscription.status
        });

        await this.updateSubscription(userId, {
          status: stripeSubscription.status,
          isActive: stripeSubscription.status === 'active',
          updateUserRole: true
        });

        return { 
          synced: false, 
          corrected: true,
          oldStatus: localSubscription.status,
          newStatus: stripeSubscription.status
        };
      }

      return { synced: true, message: 'Statuts synchronisés' };

    } catch (error) {
      logger.error(`[❌] Erreur sync Stripe:`, error.message);
      return { synced: false, error: error.message };
    }
  }
};

module.exports = SubscriptionIntegrationService;
