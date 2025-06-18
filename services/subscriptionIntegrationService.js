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

    // 🔥 VALIDATION DES DATES AVANT MISE À JOUR
    if (data.endDate !== undefined) {
      if (data.endDate === null || data.endDate === 'null' || data.endDate === '') {
        logger.warn("[⚠️] endDate invalide détectée, suppression du champ");
        delete data.endDate;
      } else if (data.endDate && isNaN(new Date(data.endDate).getTime())) {
        logger.warn("[⚠️] endDate invalide (Invalid Date), suppression du champ");
        delete data.endDate;
      } else if (data.endDate) {
        // S'assurer que c'est un objet Date valide
        data.endDate = new Date(data.endDate);
        logger.info(`[📅] endDate validée: ${data.endDate}`);
      }
    }

    // ✅ Mise à jour du rôle utilisateur si demandé
    if (data.updateUserRole === true) {
      if (data.status === 'active' && data.isActive) {
        await User.findByIdAndUpdate(objectId, { role: 'premium' });
        logger.info(`[👤] Rôle mis à jour → premium pour l'utilisateur ${objectId}`);
      } else if (data.status === 'canceled' && !data.isActive) {
        await User.findByIdAndUpdate(objectId, { role: 'user' });
        logger.info(`[👤] Rôle mis à jour → user pour l'utilisateur ${objectId}`);
      }
      // Si canceled mais encore actif, on garde le rôle premium
    }

    const updated = await Subscription.findOneAndUpdate(
      { userId: objectId },
      {
        ...data,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    logger.info("[✅] Subscription mise à jour", {
      userId: objectId,
      status: updated.status,
      plan: updated.plan,
      isActive: updated.isActive,
      endDate: updated.endDate,
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
    const subscription = await Subscription.findOne({
      userId: new mongoose.Types.ObjectId(userId)
    });

    if (!subscription) return null;

    // Calculer les jours restants
    if (subscription.endDate) {
      const now = new Date();
      const endDate = new Date(subscription.endDate);
      const diffTime = endDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      subscription.daysRemaining = Math.max(0, diffDays);
    }

    return subscription;
  },

  // 🔥 MÉTHODE CORRIGÉE : Annulation à la fin de période avec gestion d'erreurs
  async cancelSubscriptionAtPeriodEnd(userId) {
    // Recherche intelligente : chercher d'abord un abonnement actif, puis actif mais canceled
    let subscription = await Subscription.findOne({ 
      userId, 
      status: 'active',
      isActive: true 
    });

    // Si pas trouvé, chercher un abonnement canceled mais encore actif (déjà programmé)
    if (!subscription) {
      subscription = await Subscription.findOne({ 
        userId, 
        status: 'canceled',
        isActive: true,
        cancelationType: { $ne: 'immediate' } // Pas d'annulation immédiate
      });
      
      if (subscription) {
        logger.info(`[ℹ️] Abonnement déjà programmé pour annulation trouvé`, {
          userId,
          status: subscription.status,
          cancelationType: subscription.cancelationType,
          endDate: subscription.endDate
        });
        
        // Si déjà programmé pour annulation, retourner l'état actuel
        throw new Error(`Votre abonnement est déjà programmé pour annulation le ${subscription.endDate ? new Date(subscription.endDate).toLocaleDateString('fr-FR') : 'fin de période'}. Vous pouvez le réactiver si vous changez d'avis.`);
      }
    }

    if (!subscription) {
      // Vérifier s'il y a un abonnement expiré
      const expiredSub = await Subscription.findOne({ 
        userId, 
        status: 'canceled',
        isActive: false 
      });
      
      if (expiredSub) {
        throw new Error("Votre abonnement a déjà expiré. Vous pouvez souscrire à un nouveau plan depuis la page Premium.");
      }
      
      throw new Error("Aucun abonnement à annuler trouvé.");
    }

    logger.info(`[🔚] Début annulation END OF PERIOD pour ${userId}`, {
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      plan: subscription.plan,
      currentStatus: subscription.status
    });

    let endDate = subscription.endDate;

    // 🔥 ÉTAPE 1 : Programmer l'annulation dans Stripe à la fin de période
    if (subscription.stripeSubscriptionId) {
      try {
        logger.info(`[📞] Programmation annulation Stripe: ${subscription.stripeSubscriptionId}`);
        
        // Vérifier d'abord l'état actuel dans Stripe
        const currentStripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
        
        if (currentStripeSubscription.cancel_at_period_end === true) {
          logger.info(`[ℹ️] Abonnement déjà programmé pour annulation dans Stripe`);
          // Récupérer la date de fin depuis Stripe
          if (currentStripeSubscription.current_period_end) {
            endDate = new Date(currentStripeSubscription.current_period_end * 1000);
          }
        } else {
          // Programmer l'annulation
          const updatedStripeSubscription = await stripe.subscriptions.update(
            subscription.stripeSubscriptionId,
            {
              cancel_at_period_end: true,
              metadata: {
                canceled_by_user: 'true',
                canceled_at: new Date().toISOString()
              }
            }
          );

          // Récupérer la date de fin
          if (updatedStripeSubscription.current_period_end && updatedStripeSubscription.current_period_end > 0) {
            endDate = new Date(updatedStripeSubscription.current_period_end * 1000);
            logger.info(`[📅] Date de fin récupérée depuis Stripe: ${endDate}`);
          }
        }

        // Fallback si pas de date valide
        if (!endDate || isNaN(endDate.getTime())) {
          logger.warn(`[⚠️] Date de fin invalide, calcul manuel`);
          endDate = new Date();
          if (subscription.plan === 'annual') {
            endDate.setFullYear(endDate.getFullYear() + 1);
          } else {
            endDate.setMonth(endDate.getMonth() + 1);
          }
          logger.info(`[📅] Date de fin calculée manuellement: ${endDate}`);
        }

        logger.info(`[✅] Stripe subscription programmé pour annulation:`, {
          id: subscription.stripeSubscriptionId,
          endDate: endDate
        });

      } catch (stripeError) {
        logger.error(`[❌] Erreur programmation annulation Stripe:`, {
          message: stripeError.message,
          type: stripeError.type,
          code: stripeError.code
        });

        // Si l'abonnement n'existe plus dans Stripe, continuer quand même
        if (stripeError.code === 'resource_missing') {
          logger.warn(`[⚠️] Abonnement non trouvé dans Stripe, annulation locale`);
          endDate = new Date();
          if (subscription.plan === 'annual') {
            endDate.setFullYear(endDate.getFullYear() + 1);
          } else {
            endDate.setMonth(endDate.getMonth() + 1);
          }
        } else {
          throw new Error(`Échec programmation annulation Stripe: ${stripeError.message}`);
        }
      }
    } else {
      logger.warn(`[⚠️] Pas de stripeSubscriptionId trouvé, annulation locale uniquement`);
      // Calculer une date de fin
      endDate = new Date();
      if (subscription.plan === 'annual') {
        endDate.setFullYear(endDate.getFullYear() + 1);
      } else {
        endDate.setMonth(endDate.getMonth() + 1);
      }
      logger.info(`[📅] Date de fin calculée pour abonnement local: ${endDate}`);
    }

    // 🔥 VALIDATION FINALE DE LA DATE
    if (!endDate || isNaN(endDate.getTime())) {
      logger.error(`[❌] Date de fin invalide après toutes les tentatives`);
      throw new Error("Impossible de déterminer la date de fin d'abonnement");
    }

    // 🔥 ÉTAPE 2 : Mettre à jour la DB locale
    try {
      const updatedSubscription = await this.updateSubscription(userId, {
        status: 'canceled',
        isActive: true,
        endDate: endDate,
        cancelationType: 'end_of_period',
        updateUserRole: false
      });

      // Calculer les jours restants
      const now = new Date();
      const diffTime = endDate.getTime() - now.getTime();
      const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      updatedSubscription.daysRemaining = Math.max(0, daysRemaining);

      logger.info(`[🔚] Abonnement programmé pour annulation le ${endDate.toLocaleDateString('fr-FR')}`, {
        userId,
        localStatus: updatedSubscription.status,
        isActive: updatedSubscription.isActive,
        daysRemaining: updatedSubscription.daysRemaining
      });

      return updatedSubscription;

    } catch (dbError) {
      logger.error(`[❌] Erreur mise à jour DB:`, dbError.message);
      throw new Error(`Erreur sauvegarde annulation: ${dbError.message}`);
    }
  },

  // Réactiver un abonnement
  async reactivateSubscription(userId) {
    const subscription = await Subscription.findOne({ 
      userId, 
      status: 'canceled',
      isActive: true,
      cancelationType: 'end_of_period'
    });

    if (!subscription) {
      throw new Error("Aucun abonnement annulé réactivable trouvé.");
    }

    logger.info(`[🔄] Début réactivation pour ${userId}`, {
      stripeSubscriptionId: subscription.stripeSubscriptionId
    });

    // Réactiver dans Stripe
    if (subscription.stripeSubscriptionId) {
      try {
        const reactivatedStripeSubscription = await stripe.subscriptions.update(
          subscription.stripeSubscriptionId,
          {
            cancel_at_period_end: false,
            metadata: {
              reactivated_by_user: 'true',
              reactivated_at: new Date().toISOString()
            }
          }
        );

        logger.info(`[✅] Stripe subscription réactivé:`, {
          id: reactivatedStripeSubscription.id,
          cancel_at_period_end: reactivatedStripeSubscription.cancel_at_period_end
        });

      } catch (stripeError) {
        logger.error(`[❌] Erreur réactivation Stripe:`, stripeError.message);
        throw new Error(`Échec réactivation Stripe: ${stripeError.message}`);
      }
    }

    // Mettre à jour la DB locale
    const reactivated = await this.updateSubscription(userId, {
      status: 'active',
      isActive: true,
      cancelationType: null,
      updateUserRole: true
    });

    logger.info(`[🔄] Abonnement réactivé avec succès pour ${userId}`);

    return reactivated;
  },

  // 🔥 NOUVELLE MÉTHODE : Changer de plan
  async changePlan(userId, newPlan) {
    const subscription = await Subscription.findOne({ 
      userId, 
      status: 'active',
      isActive: true 
    });

    if (!subscription) {
      throw new Error("Aucun abonnement actif trouvé pour changer le plan.");
    }

    if (subscription.plan === newPlan) {
      throw new Error(`Vous êtes déjà sur le plan ${newPlan}.`);
    }

    logger.info(`[🔄] Début changement de plan pour ${userId}`, {
      currentPlan: subscription.plan,
      newPlan: newPlan,
      stripeSubscriptionId: subscription.stripeSubscriptionId
    });

    const oldPlan = subscription.plan;
    let prorationAmount = 0;
    let effectiveDate = new Date();

    // 🔥 ÉTAPE 1 : Changer le plan dans Stripe
    if (subscription.stripeSubscriptionId) {
      try {
        const newPriceId = newPlan === "annual"
          ? process.env.STRIPE_PRICE_ANNUAL_ID
          : process.env.STRIPE_PRICE_MONTHLY_ID;

        if (!newPriceId) {
          throw new Error(`Price ID non défini pour le plan ${newPlan}`);
        }

        logger.info(`[📞] Changement de plan dans Stripe: ${subscription.stripeSubscriptionId}`);

        // Récupérer l'abonnement Stripe actuel
        const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);

        // Mettre à jour l'abonnement Stripe
        const updatedStripeSubscription = await stripe.subscriptions.update(
          subscription.stripeSubscriptionId,
          {
            items: [{
              id: stripeSubscription.items.data[0].id,
              price: newPriceId,
            }],
            proration_behavior: 'create_prorations', // Gérer la proratisation
            metadata: {
              changed_by_user: 'true',
              changed_at: new Date().toISOString(),
              old_plan: oldPlan,
              new_plan: newPlan
            }
          }
        );

        // Récupérer la nouvelle date de fin
        if (updatedStripeSubscription.current_period_end) {
          effectiveDate = new Date(updatedStripeSubscription.current_period_end * 1000);
        }

        // Calculer le montant de proratisation (approximatif)
        const monthlyPrice = 9.99;
        const annualPrice = 99.99;
        
        if (oldPlan === 'monthly' && newPlan === 'annual') {
          // Passage mensuel → annuel : crédit à appliquer
          prorationAmount = -(monthlyPrice * 12 - annualPrice);
        } else if (oldPlan === 'annual' && newPlan === 'monthly') {
          // Passage annuel → mensuel : montant à payer
          prorationAmount = (annualPrice / 12) - monthlyPrice;
        }

        logger.info(`[✅] Plan changé dans Stripe:`, {
          id: updatedStripeSubscription.id,
          oldPlan,
          newPlan,
          newPriceId,
          effectiveDate
        });

      } catch (stripeError) {
        logger.error(`[❌] Erreur changement plan Stripe:`, {
          message: stripeError.message,
          type: stripeError.type,
          code: stripeError.code
        });

        throw new Error(`Échec changement de plan Stripe: ${stripeError.message}`);
      }
    } else {
      logger.warn(`[⚠️] Pas de stripeSubscriptionId trouvé, changement local uniquement`);
    }

    // 🔥 ÉTAPE 2 : Mettre à jour la DB locale
    try {
      const updatedSubscription = await this.updateSubscription(userId, {
        plan: newPlan,
        endDate: effectiveDate,
        updateUserRole: false // Garder le rôle premium
      });

      logger.info(`[🔄] Plan changé avec succès de ${oldPlan} vers ${newPlan}`, {
        userId,
        effectiveDate,
        prorationAmount
      });

      return {
        subscription: updatedSubscription,
        oldPlan,
        newPlan,
        effectiveDate,
        prorationAmount
      };

    } catch (dbError) {
      logger.error(`[❌] Erreur mise à jour DB changement plan:`, dbError.message);
      throw new Error(`Erreur sauvegarde changement plan: ${dbError.message}`);
    }
  },

  // Annulation immédiate (pour admin)
  async cancelSubscriptionImmediately(userId) {
    const subscription = await Subscription.findOne({ 
      userId, 
      $or: [
        { status: 'active', isActive: true },
        { status: 'canceled', isActive: true }
      ]
    });

    if (!subscription) {
      throw new Error("Aucun abonnement à annuler immédiatement.");
    }

    logger.info(`[🔚] Début annulation IMMÉDIATE pour ${userId}`, {
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      plan: subscription.plan
    });

    // Annulation immédiate dans Stripe
    if (subscription.stripeSubscriptionId) {
      try {
        const canceledStripeSubscription = await stripe.subscriptions.cancel(
          subscription.stripeSubscriptionId,
          {
            prorate: false,
            invoice_now: false,
          }
        );

        logger.info(`[✅] Stripe subscription annulé immédiatement:`, {
          id: canceledStripeSubscription.id,
          status: canceledStripeSubscription.status
        });

      } catch (stripeError) {
        logger.error(`[❌] Erreur annulation immédiate Stripe:`, stripeError.message);
        if (stripeError.code !== 'resource_missing') {
          throw new Error(`Échec annulation Stripe: ${stripeError.message}`);
        }
      }
    }

    // Mise à jour DB avec annulation immédiate
    const canceled = await this.updateSubscription(userId, {
      status: 'canceled',
      endDate: new Date(),
      isActive: false,
      cancelationType: 'immediate',
      updateUserRole: true
    });

    logger.info(`[🔚] Abonnement annulé immédiatement pour ${userId}`);

    return canceled;
  }
};

module.exports = SubscriptionIntegrationService;