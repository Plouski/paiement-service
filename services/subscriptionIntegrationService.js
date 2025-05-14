const Subscription = require('../models/Subscription');
const User = require('../models/User');
const { logger } = require('../utils/logger');
const mongoose = require('mongoose');

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
    const subscription = await Subscription.findOne({ userId, status: 'active' });

    if (!subscription) {
      throw new Error("Aucun abonnement actif à annuler.");
    }

    subscription.status = 'canceled';
    subscription.endDate = new Date();
    subscription.isActive = false;

    await subscription.save();

    await User.findByIdAndUpdate(userId, { role: 'user' });

    logger.info(`[🔚] Abonnement annulé pour ${userId}`);

    return subscription;
  }
};

module.exports = SubscriptionIntegrationService;
