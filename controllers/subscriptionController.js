const SubscriptionIntegrationService = require("../services/subscriptionIntegrationService.js");
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const { logger } = require("../utils/logger");

class subscriptionController {
  // Récupérer l'abonnement actif de l'utilisateur connecté
  static async getCurrentSubscription(req, res) {
    try {
      const userId = req.user?.userId || req.user?.id;
      if (!userId)
        return res
          .status(401)
          .json({ message: "Utilisateur non authentifié." });

      const subscription =
        await SubscriptionIntegrationService.getCurrentSubscription(userId);

      if (!subscription) {
        return res
          .status(404)
          .json({ message: "Aucun abonnement actif trouvé." });
      }

      res.json(subscription);
    } catch (error) {
      logger.error("❌ Erreur getCurrentSubscription:", error);
      res.status(500).json({ message: "Erreur serveur." });
    }
  }

  // Récupérer l'abonnement actif d'un utilisateur spécifique (admin ou le user lui-même)
  static async getUserSubscription(req, res) {
    const userId = req.params.userId;
    const requesterId = req.user?.userId || req.user?.id;

    if (req.user.role !== "admin" && requesterId !== userId) {
      return res.status(403).json({ message: "Accès interdit" });
    }

    try {
      const subscription =
        await SubscriptionIntegrationService.getCurrentSubscription(userId);

      if (!subscription) {
        return res
          .status(404)
          .json({ message: "Aucun abonnement actif trouvé." });
      }

      res.json(subscription);
    } catch (error) {
      logger.error("❌ Erreur getUserSubscription:", error);
      res.status(500).json({ message: "Erreur serveur." });
    }
  }

  // Annuler l'abonnement à la fin de la période de facturation
  static async cancel(req, res) {
    try {
      const userId = req.user?.userId || req.user?.id;
      if (!userId)
        return res.status(401).json({ error: "Utilisateur non authentifié" });

      logger.info(`[🔚] Demande d'annulation pour l'utilisateur ${userId}`);

      const result =
        await SubscriptionIntegrationService.cancelSubscriptionAtPeriodEnd(
          userId
        );

      try {
        const User = require("../models/User");
        const user = await User.findById(userId);

        if (user && user.email) {
          const NotificationService = require("../services/notificationService");
          await NotificationService.sendSubscriptionCancelScheduled(
            user.email,
            {
              plan: result.plan,
              endDate: result.endDate,
              daysRemaining: result.daysRemaining,
            }
          );
          logger.info(
            `[📧] Notification d'annulation programmée envoyée à ${user.email}`
          );
        }
      } catch (notificationError) {
        logger.warn(
          "⚠️ Erreur envoi notification annulation:",
          notificationError.message
        );
      }

      res.json({
        success: true,
        subscription: result,
        message: `Abonnement programmé pour annulation le ${
          result.endDate
            ? new Date(result.endDate).toLocaleDateString("fr-FR")
            : "fin de période"
        }. Vous gardez vos avantages jusqu'à cette date.`,
        cancelationType: "end_of_period",
      });
    } catch (err) {
      logger.error("❌ Erreur annulation abonnement:", err);
      res.status(500).json({
        error: "Erreur lors de l'annulation de l'abonnement",
        details: err.message,
      });
    }
  }

  // Réactiver un abonnement annulé
  static async reactivate(req, res) {
    try {
      const userId = req.user?.userId || req.user?.id;
      if (!userId)
        return res.status(401).json({ error: "Utilisateur non authentifié" });

      logger.info(`[🔄] Demande de réactivation pour l'utilisateur ${userId}`);

      const result =
        await SubscriptionIntegrationService.reactivateSubscription(userId);

      res.json({
        success: true,
        subscription: result,
        message: "Abonnement réactivé avec succès !",
      });
    } catch (error) {
      logger.error("❌ Erreur réactivation abonnement:", error);
      res.status(500).json({
        error: "Erreur lors de la réactivation de l'abonnement",
        details: error.message,
      });
    }
  }

  // Changer le plan d'abonnement (mensuel ↔ annuel)
  static async changePlan(req, res) {
    try {
      const userId = req.user?.userId || req.user?.id;
      const { newPlan } = req.body;

      if (!userId) {
        return res.status(401).json({ error: "Utilisateur non authentifié" });
      }

      if (!["monthly", "annual"].includes(newPlan)) {
        return res
          .status(400)
          .json({ error: "Plan invalide. Utilisez 'monthly' ou 'annual'" });
      }

      logger.info(
        `[🔄] Demande de changement de plan pour l'utilisateur ${userId} vers ${newPlan}`
      );

      const result = await SubscriptionIntegrationService.changePlan(
        userId,
        newPlan
      );

      res.json({
        success: true,
        subscription: result.subscription,
        message: `Plan changé avec succès de ${result.oldPlan} vers ${result.newPlan}`,
        oldPlan: result.oldPlan,
        newPlan: result.newPlan,
        prorationAmount: result.prorationAmount,
      });
    } catch (error) {
      logger.error("❌ Erreur changement plan:", error);
      res.status(500).json({
        error: "Erreur lors du changement de plan",
        details: error.message,
      });
    }
  }

  // Créer une session Stripe Checkout pour souscrire à un abonnement
  static async createCheckoutSession(req, res) {
    try {
      const { plan } = req.body;
      const user = req.user;

      if (!["monthly", "annual"].includes(plan)) {
        return res.status(400).json({ error: "Plan invalide" });
      }

      const priceId =
        plan === "annual"
          ? process.env.STRIPE_PRICE_ANNUAL_ID
          : process.env.STRIPE_PRICE_MONTHLY_ID;

      if (!priceId) {
        return res.status(500).json({
          error: "Price ID non défini dans les variables d'environnement",
        });
      }

      const userId = user?.userId || user?.id;
      if (!userId) {
        return res
          .status(400)
          .json({ error: "ID utilisateur manquant dans le token JWT" });
      }

      logger.debug("🔥 checkout metadata:", { userId, email: user.email });

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "subscription",
        customer_email: user.email,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        metadata: {
          userId,
          plan,
        },
        subscription_data: {
          metadata: {
            userId,
            plan,
          },
        },
        success_url: `${process.env.CLIENT_URL}/premium/success`,
        cancel_url: `${process.env.CLIENT_URL}/premium/cancel`,
      });

      res.status(200).json({ url: session.url });
    } catch (error) {
      logger.error("❌ Erreur Checkout Stripe:", error);
      res
        .status(500)
        .json({ error: "Erreur lors de la création de la session Stripe" });
    }
  }

  // Vérifier l'éligibilité au remboursement
  static async checkRefundEligibility(req, res) {
    try {
      const userId = req.user?.userId || req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Utilisateur non authentifié" });
      }

      logger.info(
        `[💰] Vérification éligibilité remboursement pour l'utilisateur ${userId}`
      );

      const subscription =
        await SubscriptionIntegrationService.getCurrentSubscription(userId);

      if (!subscription) {
        return res.status(404).json({
          eligible: false,
          reason: "Aucun abonnement trouvé",
        });
      }

      const now = new Date();
      let subscriptionStartDate = null;
      let daysSinceStart = 0;

      if (subscription.startDate) {
        subscriptionStartDate = new Date(subscription.startDate);

        if (!isNaN(subscriptionStartDate.getTime())) {
          const timeDiff = now.getTime() - subscriptionStartDate.getTime();
          daysSinceStart = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
        } else {
          logger.warn("[⚠️] Date de début d'abonnement invalide", {
            startDate: subscription.startDate,
            userId,
          });
          if (subscription.createdAt) {
            subscriptionStartDate = new Date(subscription.createdAt);
            if (!isNaN(subscriptionStartDate.getTime())) {
              const timeDiff = now.getTime() - subscriptionStartDate.getTime();
              daysSinceStart = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
            }
          }
        }
      } else {
        logger.warn("[⚠️] Aucune date de début trouvée", { userId });
        if (subscription.createdAt) {
          subscriptionStartDate = new Date(subscription.createdAt);
          if (!isNaN(subscriptionStartDate.getTime())) {
            const timeDiff = now.getTime() - subscriptionStartDate.getTime();
            daysSinceStart = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
          }
        }
      }

      const maxRefundDays = 7;
      const daysRemainingForRefund = Math.max(
        0,
        maxRefundDays - daysSinceStart
      );

      const isEligible =
        daysSinceStart <= maxRefundDays &&
        subscription.status === "active" &&
        daysSinceStart >= 0;

      let reason = "";
      if (!isEligible) {
        if (daysSinceStart > maxRefundDays) {
          reason = `Période de remboursement expirée (${maxRefundDays} jours maximum)`;
        } else if (subscription.status !== "active") {
          reason = "Abonnement non actif";
        } else if (daysSinceStart < 0) {
          reason = "Erreur de calcul de date";
        }
      } else {
        reason = `Éligible au remboursement. Il vous reste ${daysRemainingForRefund} jour(s)`;
      }

      logger.info(`[💰] Éligibilité remboursement calculée`, {
        userId,
        eligible: isEligible,
        daysSinceStart,
        daysRemainingForRefund,
        subscriptionStatus: subscription.status,
        startDate: subscriptionStartDate,
        reason,
      });

      res.json({
        eligible: isEligible,
        daysSinceStart,
        daysRemainingForRefund,
        maxRefundDays,
        subscriptionStatus: subscription.status,
        startDate: subscriptionStartDate,
        reason,
      });
    } catch (error) {
      logger.error("❌ Erreur vérification éligibilité remboursement:", error);
      res.status(500).json({
        error: "Erreur lors de la vérification d'éligibilité",
        details: error.message,
      });
    }
  }

  // Demander un remboursement immédiat
  static async requestRefund(req, res) {
    try {
      const userId = req.user?.userId || req.user?.id;
      const { reason = "" } = req.body;

      if (!userId) {
        return res.status(401).json({ error: "Utilisateur non authentifié" });
      }

      logger.info(
        `[💰] Demande de remboursement pour l'utilisateur ${userId}`,
        { reason }
      );

      const subscription =
        await SubscriptionIntegrationService.getCurrentSubscription(userId);

      if (!subscription) {
        return res.status(404).json({
          error: "Aucun abonnement trouvé",
        });
      }

      if (subscription.status !== "active") {
        return res.status(400).json({
          error: "Seuls les abonnements actifs peuvent être remboursés",
        });
      }

      const now = new Date();
      let subscriptionStartDate = null;
      let daysSinceStart = 0;

      if (subscription.startDate) {
        subscriptionStartDate = new Date(subscription.startDate);
        if (!isNaN(subscriptionStartDate.getTime())) {
          const timeDiff = now.getTime() - subscriptionStartDate.getTime();
          daysSinceStart = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
        }
      }

      const maxRefundDays = 7;
      const isEligible =
        daysSinceStart <= maxRefundDays && subscription.status === "active";

      if (!isEligible) {
        const reason =
          daysSinceStart > maxRefundDays
            ? `Période de remboursement expirée (${maxRefundDays} jours maximum)`
            : "Abonnement non éligible";

        return res.status(400).json({
          error: "Remboursement non autorisé",
          reason,
        });
      }

      let refundAmount = 0;
      if (subscription.plan === "monthly") {
        refundAmount = 5;
      } else if (subscription.plan === "annual") {
        refundAmount = 45;
      }

      logger.info(`[💰] Remboursement éligible`, {
        userId,
        plan: subscription.plan,
        refundAmount,
        daysSinceStart,
      });

      const updatedSubscription =
        await SubscriptionIntegrationService.updateSubscription(userId, {
          status: "canceled",
          isActive: false,
          cancelationType: "immediate",
          endDate: new Date(),
          updateUserRole: true,
        });

      logger.info(`[💰] Remboursement traité avec succès`, {
        userId,
        refundAmount,
        plan: subscription.plan,
        reason,
      });

      res.json({
        success: true,
        message: "Remboursement demandé avec succès",
        refund: {
          amount: refundAmount,
          currency: "EUR",
          processingTime: "3-5 jours ouvrés",
          plan: subscription.plan,
          reason: reason || "Demande client",
        },
        subscription: updatedSubscription,
      });
    } catch (error) {
      logger.error("❌ Erreur demande remboursement:", error);
      res.status(500).json({
        error: "Erreur lors de la demande de remboursement",
        details: error.message,
      });
    }
  }
}

module.exports = subscriptionController;
