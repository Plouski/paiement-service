// services/subscriptionIntegrationService.js
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const { logger } = require('../utils/logger');
const mongoose = require('mongoose');

const SubscriptionIntegrationService = {
  async updateSubscription(userId, data) {
    logger.info(`[🔄] SubscriptionIntegrationService.updateSubscription called`, { userId, data });

    const objectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    if (data.updateUserRole && data.status === 'active') {
      await User.findByIdAndUpdate(objectId, { role: 'premium' });
    } else if (data.updateUserRole && data.status === 'canceled') {
      await User.findByIdAndUpdate(objectId, { role: 'user' });
    }

    logger.info('[✅] Subscription créée ou mise à jour', {
      userId: objectId,
      stripeCustomerId: data.stripeCustomerId,
      plan: data.plan
    });

    return Subscription.findOneAndUpdate(
      { userId: objectId },
      {
        ...data,
        updatedAt: new Date(),
        isActive: data.status === 'active'
      },
      { upsert: true, new: true }
    );
  },

  async getUserIdFromCustomerId(customerId) {
    const subscription = await Subscription.findOne({ stripeCustomerId: customerId });
    if (!subscription) {
      logger.warn(`[❌] Aucun abonnement trouvé pour le customerId ${customerId}`);
    }
    return subscription?.userId;
  },

  async recordSubscriptionPayment(userId, paymentData) {
    logger.info(`Paiement reçu pour ${userId}`, paymentData);
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
    logger.warn(`Échec de paiement pour ${userId}`, failureData);
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
    const subscription = await Subscription.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      isActive: true
    });

    return subscription;
  },

  async cancel(userId) {
    const subscription = await Subscription.findOne({ userId, status: 'active' });

    if (!subscription) {
      throw new Error("Aucun abonnement actif à annuler.");
    }

    subscription.status = 'cancelled';
    subscription.endDate = new Date();
    await subscription.save();

    // Optionnel : rétrograder le rôle de l'utilisateur si souhaité
    await User.findByIdAndUpdate(userId, { role: 'user' });

    return subscription;
  }
};

module.exports = SubscriptionIntegrationService;