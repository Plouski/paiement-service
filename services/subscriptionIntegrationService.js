const Subscription = require("../models/Subscription");
const User = require("../models/User");
const { logger } = require("../utils/logger");
const mongoose = require("mongoose");
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SubscriptionIntegrationService = {

  // Met à jour un abonnement utilisateur
  async updateSubscription(userId, data) {
    logger.info("[🔄] Début de mise à jour de l'abonnement", { userId, data });
    
    const objectId = typeof userId === "string" ? new mongoose.Types.ObjectId(userId) : userId;
    logger.debug("[🔧] Conversion userId en ObjectId", { originalUserId: userId, objectId });

    if (data.endDate !== undefined) {
      logger.debug("[📅] Validation de la date de fin", { endDate: data.endDate });
      
      if (data.endDate === null || data.endDate === "null" || data.endDate === "") {
        logger.warn("[⚠️] Date de fin invalide détectée, suppression du champ", { invalidEndDate: data.endDate });
        delete data.endDate;
      } else if (data.endDate && isNaN(new Date(data.endDate).getTime())) {
        logger.warn("[⚠️] Date de fin invalide (Invalid Date), suppression du champ", { invalidEndDate: data.endDate });
        delete data.endDate;
      } else if (data.endDate) {
        data.endDate = new Date(data.endDate);
        logger.info(`[📅] Date de fin validée avec succès`, { validatedEndDate: data.endDate });
      }
    }

    if (data.updateUserRole === true) {
      logger.info("[👤] Mise à jour du rôle utilisateur demandée", { status: data.status, isActive: data.isActive });
      
      if (data.status === "active" && data.isActive) {
        await User.findByIdAndUpdate(objectId, { role: "premium" });
        logger.info(`[👤] Rôle mis à jour vers premium pour l'utilisateur`, { userId: objectId });
      } else if (data.status === "canceled" && !data.isActive) {
        await User.findByIdAndUpdate(objectId, { role: "user" });
        logger.info(`[👤] Rôle mis à jour vers user pour l'utilisateur`, { userId: objectId });
      }
      logger.debug("[👤] Pas de changement de rôle nécessaire (abonnement canceled mais encore actif)");
    }

    logger.info("[💾] Mise à jour de l'abonnement en base de données");
    const updated = await Subscription.findOneAndUpdate(
      { userId: objectId },
      {
        ...data,
        updatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    logger.info("[✅] Abonnement mis à jour avec succès", {
      userId: objectId,
      status: updated.status,
      plan: updated.plan,
      isActive: updated.isActive,
      endDate: updated.endDate,
      stripeId: updated.stripeSubscriptionId,
    });

    return updated;
  },

  // Récupère l'ID utilisateur à partir de l'ID client Stripe
  async getUserIdFromCustomerId(customerId) {
    logger.info("[🔍] Recherche utilisateur par customerId Stripe", { customerId });
    
    const subscription = await Subscription.findOne({
      stripeCustomerId: customerId,
    });
    
    if (!subscription) {
      logger.warn(`[❌] Aucun abonnement trouvé pour le customerId`, { customerId });
      return null;
    }
    
    logger.info("[✅] Utilisateur trouvé via customerId", { customerId, userId: subscription.userId });
    return subscription?.userId;
  },

  // Enregistre un paiement d'abonnement réussi
  async recordSubscriptionPayment(userId, paymentData) {
    logger.info("💰 Enregistrement d'un paiement réussi", { userId, ...paymentData });
    
    const result = await Subscription.findOneAndUpdate(
      { userId },
      {
        lastPaymentDate: new Date(),
        lastTransactionId: paymentData.transactionId,
        paymentStatus: "success",
      },
      { new: true }
    );
    
    logger.info("✅ Paiement enregistré avec succès", { userId, transactionId: paymentData.transactionId });
    return result;
  },

  // Enregistre un échec de paiement
  async recordPaymentFailure(userId, failureData) {
    logger.warn("❌ Enregistrement d'un échec de paiement", { userId, ...failureData });
    
    const result = await Subscription.findOneAndUpdate(
      { userId },
      {
        paymentStatus: "failed",
        paymentFailureReason: failureData.failureReason,
        lastFailureDate: new Date(),
      },
      { new: true }
    );
    
    logger.warn("💥 Échec de paiement enregistré", { userId, reason: failureData.failureReason });
    return result;
  },

  // Convertit un ID de prix Stripe en nom de plan
  getPlanFromStripePrice(priceId) {
    logger.debug("[🏷️] Conversion priceId Stripe vers nom de plan", { priceId });
    
    let planName;
    switch (priceId) {
      case process.env.STRIPE_PRICE_ANNUAL_ID:
        planName = "annual";
        break;
      case process.env.STRIPE_PRICE_MONTHLY_ID:
        planName = "monthly";
        break;
      default:
        planName = "premium";
        logger.warn("[⚠️] PriceId non reconnu, plan par défaut appliqué", { priceId, defaultPlan: "premium" });
    }
    
    logger.debug("[🏷️] Plan déterminé", { priceId, planName });
    return planName;
  },

  // Récupère l'abonnement actuel d'un utilisateur
  async getCurrentSubscription(userId) {
    logger.info("[🔍] Récupération de l'abonnement actuel", { userId });
    
    const subscription = await Subscription.findOne({
      userId: new mongoose.Types.ObjectId(userId),
    });
    
    if (!subscription) {
      logger.info("[❌] Aucun abonnement trouvé pour cet utilisateur", { userId });
      return null;
    }

    if (subscription.endDate) {
      const now = new Date();
      const endDate = new Date(subscription.endDate);
      const diffTime = endDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      subscription.daysRemaining = Math.max(0, diffDays);
      
      logger.debug("[📅] Jours restants calculés", { 
        userId, 
        endDate, 
        daysRemaining: subscription.daysRemaining 
      });
    }

    logger.info("[✅] Abonnement actuel récupéré", { 
      userId, 
      status: subscription.status, 
      plan: subscription.plan,
      daysRemaining: subscription.daysRemaining 
    });
    
    return subscription;
  },

  // Annulation à la fin de période avec gestion d'erreurs
  async cancelSubscriptionAtPeriodEnd(userId) {
    logger.info("[🔚] Début du processus d'annulation à la fin de période", { userId });
    
    let subscription = await Subscription.findOne({
      userId,
      status: "active",
      isActive: true,
    });
    
    logger.debug("[🔍] Recherche d'abonnement actif", { found: !!subscription });

    if (!subscription) {
      subscription = await Subscription.findOne({
        userId,
        status: "canceled",
        isActive: true,
        cancelationType: { $ne: "immediate" },
      });
      
      if (subscription) {
        logger.info(`[ℹ️] Abonnement déjà programmé pour annulation trouvé`, {
          userId,
          status: subscription.status,
          cancelationType: subscription.cancelationType,
          endDate: subscription.endDate,
        });
        
        const endDateFormatted = subscription.endDate
          ? new Date(subscription.endDate).toLocaleDateString("fr-FR")
          : "fin de période";
        
        throw new Error(
          `Votre abonnement est déjà programmé pour annulation le ${endDateFormatted}. Vous pouvez le réactiver si vous changez d'avis.`
        );
      }
    }

    if (!subscription) {
      logger.warn("[❌] Aucun abonnement actif trouvé", { userId });
      
      const expiredSub = await Subscription.findOne({
        userId,
        status: "canceled",
        isActive: false,
      });
      
      if (expiredSub) {
        logger.info("[ℹ️] Abonnement expiré trouvé", { userId });
        throw new Error(
          "Votre abonnement a déjà expiré. Vous pouvez souscrire à un nouveau plan depuis la page Premium."
        );
      }
      
      throw new Error("Aucun abonnement à annuler trouvé.");
    }

    logger.info(`[🔚] Début annulation END OF PERIOD pour l'utilisateur`, {
      userId,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      plan: subscription.plan,
      currentStatus: subscription.status,
    });

    let endDate = subscription.endDate;

    if (subscription.stripeSubscriptionId) {
      try {
        logger.info(`[📞] Programmation annulation Stripe en cours`, {
          stripeSubscriptionId: subscription.stripeSubscriptionId
        });
        
        const currentStripeSubscription = await stripe.subscriptions.retrieve(
          subscription.stripeSubscriptionId
        );
        
        logger.debug("[🔍] État actuel de l'abonnement Stripe", {
          id: currentStripeSubscription.id,
          cancel_at_period_end: currentStripeSubscription.cancel_at_period_end,
          current_period_end: currentStripeSubscription.current_period_end
        });
        
        if (currentStripeSubscription.cancel_at_period_end === true) {
          logger.info(`[ℹ️] Abonnement déjà programmé pour annulation dans Stripe`);
          
          if (currentStripeSubscription.current_period_end) {
            endDate = new Date(currentStripeSubscription.current_period_end * 1000);
            logger.info("[📅] Date de fin récupérée depuis Stripe", { endDate });
          }
        } else {
          logger.info("[📝] Programmation de l'annulation dans Stripe");
          const updatedStripeSubscription = await stripe.subscriptions.update(
            subscription.stripeSubscriptionId,
            {
              cancel_at_period_end: true,
              metadata: {
                canceled_by_user: "true",
                canceled_at: new Date().toISOString(),
              },
            }
          );
          
          if (
            updatedStripeSubscription.current_period_end &&
            updatedStripeSubscription.current_period_end > 0
          ) {
            endDate = new Date(updatedStripeSubscription.current_period_end * 1000);
            logger.info(`[📅] Date de fin récupérée depuis Stripe après mise à jour`, { endDate });
          }
        }

        if (!endDate || isNaN(endDate.getTime())) {
          logger.warn(`[⚠️] Date de fin invalide, calcul manuel nécessaire`);
          endDate = new Date();
          if (subscription.plan === "annual") {
            endDate.setFullYear(endDate.getFullYear() + 1);
          } else {
            endDate.setMonth(endDate.getMonth() + 1);
          }
          logger.info(`[📅] Date de fin calculée manuellement`, { endDate, plan: subscription.plan });
        }

        logger.info(`[✅] Abonnement Stripe programmé pour annulation avec succès`, {
          id: subscription.stripeSubscriptionId,
          endDate: endDate,
        });
      } catch (stripeError) {
        logger.error(`[❌] Erreur lors de la programmation d'annulation Stripe`, {
          message: stripeError.message,
          type: stripeError.type,
          code: stripeError.code,
          stripeSubscriptionId: subscription.stripeSubscriptionId
        });
        
        if (stripeError.code === "resource_missing") {
          logger.warn(`[⚠️] Abonnement non trouvé dans Stripe, procédure d'annulation locale`);
          endDate = new Date();
          if (subscription.plan === "annual") {
            endDate.setFullYear(endDate.getFullYear() + 1);
          } else {
            endDate.setMonth(endDate.getMonth() + 1);
          }
          logger.info("[📅] Date de fin calculée pour annulation locale", { endDate });
        } else {
          throw new Error(`Échec programmation annulation Stripe: ${stripeError.message}`);
        }
      }
    } else {
      logger.warn(`[⚠️] Pas de stripeSubscriptionId trouvé, annulation locale uniquement`);
      
      endDate = new Date();
      if (subscription.plan === "annual") {
        endDate.setFullYear(endDate.getFullYear() + 1);
      } else {
        endDate.setMonth(endDate.getMonth() + 1);
      }
      logger.info(`[📅] Date de fin calculée pour abonnement local`, { endDate, plan: subscription.plan });
    }

    if (!endDate || isNaN(endDate.getTime())) {
      logger.error(`[❌] Date de fin invalide après toutes les tentatives`, { endDate });
      throw new Error("Impossible de déterminer la date de fin d'abonnement");
    }

    try {
      logger.info("[💾] Mise à jour de la base de données locale");
      const updatedSubscription = await this.updateSubscription(userId, {
        status: "canceled",
        isActive: true,
        endDate: endDate,
        cancelationType: "end_of_period",
        updateUserRole: false,
      });

      const now = new Date();
      const diffTime = endDate.getTime() - now.getTime();
      const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      updatedSubscription.daysRemaining = Math.max(0, daysRemaining);

      logger.info(`[🔚] Abonnement programmé pour annulation avec succès`, {
        userId,
        endDate: endDate.toLocaleDateString("fr-FR"),
        localStatus: updatedSubscription.status,
        isActive: updatedSubscription.isActive,
        daysRemaining: updatedSubscription.daysRemaining,
      });

      return updatedSubscription;
    } catch (dbError) {
      logger.error(`[❌] Erreur lors de la mise à jour de la base de données`, {
        error: dbError.message,
        userId
      });
      throw new Error(`Erreur sauvegarde annulation: ${dbError.message}`);
    }
  },

  // Réactiver un abonnement annulé
  async reactivateSubscription(userId) {
    logger.info("[🔄] Début de la réactivation d'abonnement", { userId });
    
    const subscription = await Subscription.findOne({
      userId,
      status: "canceled",
      isActive: true,
      cancelationType: "end_of_period",
    });

    if (!subscription) {
      logger.warn("[❌] Aucun abonnement annulé réactivable trouvé", { userId });
      throw new Error("Aucun abonnement annulé réactivable trouvé.");
    }

    logger.info(`[🔄] Abonnement réactivable trouvé`, {
      userId,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      plan: subscription.plan
    });

    if (subscription.stripeSubscriptionId) {
      try {
        logger.info("[📞] Réactivation dans Stripe en cours", {
          stripeSubscriptionId: subscription.stripeSubscriptionId
        });
        
        const reactivatedStripeSubscription = await stripe.subscriptions.update(
          subscription.stripeSubscriptionId,
          {
            cancel_at_period_end: false,
            metadata: {
              reactivated_by_user: "true",
              reactivated_at: new Date().toISOString(),
            },
          }
        );

        logger.info(`[✅] Abonnement Stripe réactivé avec succès`, {
          id: reactivatedStripeSubscription.id,
          cancel_at_period_end: reactivatedStripeSubscription.cancel_at_period_end,
        });
      } catch (stripeError) {
        logger.error(`[❌] Erreur lors de la réactivation Stripe`, {
          error: stripeError.message,
          stripeSubscriptionId: subscription.stripeSubscriptionId
        });
        throw new Error(`Échec réactivation Stripe: ${stripeError.message}`);
      }
    }

    logger.info("[💾] Mise à jour de la base de données locale pour réactivation");
    const reactivated = await this.updateSubscription(userId, {
      status: "active",
      isActive: true,
      cancelationType: null,
      updateUserRole: true,
    });

    logger.info(`[🔄] Abonnement réactivé avec succès`, { userId, plan: reactivated.plan });
    return reactivated;
  },

  // Changer de plan d'abonnement

  async changePlan(userId, newPlan) {
    logger.info("[🔄] Début du changement de plan", { userId, newPlan });
    
    const subscription = await Subscription.findOne({
      userId,
      status: "active",
      isActive: true,
    });

    if (!subscription) {
      logger.warn("[❌] Aucun abonnement actif trouvé pour changement de plan", { userId });
      throw new Error("Aucun abonnement actif trouvé pour changer le plan.");
    }

    if (subscription.plan === newPlan) {
      logger.warn("[⚠️] Tentative de changement vers le même plan", { userId, currentPlan: subscription.plan, newPlan });
      throw new Error(`Vous êtes déjà sur le plan ${newPlan}.`);
    }

    logger.info(`[🔄] Changement de plan validé`, {
      userId,
      currentPlan: subscription.plan,
      newPlan: newPlan,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
    });

    const oldPlan = subscription.plan;
    let prorationAmount = 0;
    let effectiveDate = new Date();

    if (subscription.stripeSubscriptionId) {
      try {
        const newPriceId = newPlan === "annual"
          ? process.env.STRIPE_PRICE_ANNUAL_ID
          : process.env.STRIPE_PRICE_MONTHLY_ID;

        if (!newPriceId) {
          logger.error("[❌] Price ID non défini pour le nouveau plan", { newPlan });
          throw new Error(`Price ID non défini pour le plan ${newPlan}`);
        }

        logger.info("[📞] Changement de plan dans Stripe en cours", {
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          newPriceId
        });

        const stripeSubscription = await stripe.subscriptions.retrieve(
          subscription.stripeSubscriptionId
        );

        logger.debug("[🔍] Abonnement Stripe actuel récupéré", {
          id: stripeSubscription.id,
          itemsCount: stripeSubscription.items.data.length
        });

        const updatedStripeSubscription = await stripe.subscriptions.update(
          subscription.stripeSubscriptionId,
          {
            items: [
              {
                id: stripeSubscription.items.data[0].id,
                price: newPriceId,
              },
            ],
            proration_behavior: "create_prorations",
            metadata: {
              changed_by_user: "true",
              changed_at: new Date().toISOString(),
              old_plan: oldPlan,
              new_plan: newPlan,
            },
          }
        );

        if (updatedStripeSubscription.current_period_end) {
          effectiveDate = new Date(updatedStripeSubscription.current_period_end * 1000);
          logger.info("[📅] Nouvelle date de fin récupérée depuis Stripe", { effectiveDate });
        }

        const monthlyPrice = 9.99;
        const annualPrice = 99.99;
        
        if (oldPlan === "monthly" && newPlan === "annual") {
          prorationAmount = -(monthlyPrice * 12 - annualPrice);
          logger.info("[💰] Proratisation calculée (mensuel → annuel)", { prorationAmount });
        } else if (oldPlan === "annual" && newPlan === "monthly") {
          prorationAmount = annualPrice / 12 - monthlyPrice;
          logger.info("[💰] Proratisation calculée (annuel → mensuel)", { prorationAmount });
        }

        logger.info(`[✅] Plan changé dans Stripe avec succès`, {
          id: updatedStripeSubscription.id,
          oldPlan,
          newPlan,
          newPriceId,
          effectiveDate,
        });
      } catch (stripeError) {
        logger.error(`[❌] Erreur lors du changement de plan Stripe`, {
          message: stripeError.message,
          type: stripeError.type,
          code: stripeError.code,
          stripeSubscriptionId: subscription.stripeSubscriptionId
        });
        throw new Error(`Échec changement de plan Stripe: ${stripeError.message}`);
      }
    } else {
      logger.warn(`[⚠️] Pas de stripeSubscriptionId trouvé, changement local uniquement`);
    }

    try {
      logger.info("[💾] Mise à jour de la base de données locale");
      const updatedSubscription = await this.updateSubscription(userId, {
        plan: newPlan,
        endDate: effectiveDate,
        updateUserRole: false,
      });

      logger.info(`[🔄] Plan changé avec succès`, {
        userId,
        oldPlan,
        newPlan,
        effectiveDate,
        prorationAmount,
      });

      return {
        subscription: updatedSubscription,
        oldPlan,
        newPlan,
        effectiveDate,
        prorationAmount,
      };
    } catch (dbError) {
      logger.error(`[❌] Erreur lors de la mise à jour DB pour changement de plan`, {
        error: dbError.message,
        userId
      });
      throw new Error(`Erreur sauvegarde changement plan: ${dbError.message}`);
    }
  },
};

module.exports = SubscriptionIntegrationService;