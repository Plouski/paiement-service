const subscriptionIntegrationService = require("../services/subscriptionIntegrationService.js");
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const { logger } = require("../utils/logger");
const Subscription = require("../models/Subscription"); // 🆕 Ajouter cet import
const User = require("../models/User"); // 🆕 Ajouter cet import

class subscriptionController {
  // 🆕 FONCTION DEBUG POUR VÉRIFIER LES DATES
  static async debugSubscriptionDates(req, res) {
    try {
      const userId = req.user?.userId || req.user?.id;
      const subscription = await Subscription.findOne({ userId });
      
      if (!subscription) {
        return res.json({ error: "Aucun abonnement trouvé" });
      }
      
      const now = new Date();
      const start = new Date(subscription.startDate);
      const end = new Date(subscription.endDate);
      
      const debugInfo = {
        plan: subscription.plan,
        status: subscription.status,
        isActive: subscription.isActive,
        dates: {
          maintenant: now.toISOString(),
          debut: start.toISOString(),
          fin: end.toISOString(),
          debut_fr: start.toLocaleDateString('fr-FR'),
          fin_fr: end.toLocaleDateString('fr-FR')
        },
        duree: {
          jours_totaux: Math.ceil((end - start) / (1000 * 60 * 60 * 24)),
          jours_ecoules: Math.ceil((now - start) / (1000 * 60 * 60 * 24)),
          jours_restants: Math.ceil((end - now) / (1000 * 60 * 60 * 24))
        },
        probleme_detecte: {
          fin_avant_debut: end < start,
          duree_trop_courte: (end - start) < (30 * 24 * 60 * 60 * 1000), // Moins de 30 jours
          annuel_mais_court: subscription.plan === 'annual' && (end - start) < (300 * 24 * 60 * 60 * 1000), // Moins de 300 jours
          monthly_mais_long: subscription.plan === 'monthly' && (end - start) > (40 * 24 * 60 * 60 * 1000) // Plus de 40 jours
        },
        raw_data: {
          startDate_raw: subscription.startDate,
          endDate_raw: subscription.endDate,
          cancelationType: subscription.cancelationType,
          refundStatus: subscription.refundStatus
        }
      };
      
      console.log("🔍 Debug subscription dates:", debugInfo);
      res.json(debugInfo);
      
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // 🆕 FONCTION POUR CORRIGER MANUELLEMENT LES DATES
  static async fixSubscriptionDates(req, res) {
    try {
      const userId = req.user?.userId || req.user?.id;
      const subscription = await Subscription.findOne({ userId });
      
      if (!subscription) {
        return res.status(404).json({ error: "Aucun abonnement trouvé" });
      }

      // Recalculer les dates correctes
      const now = new Date();
      let newEndDate = new Date(subscription.startDate || now);
      
      switch (subscription.plan) {
        case 'monthly':
          newEndDate.setMonth(newEndDate.getMonth() + 1);
          break;
        case 'annual':
          newEndDate.setFullYear(newEndDate.getFullYear() + 1);
          break;
        default:
          newEndDate.setMonth(newEndDate.getMonth() + 1);
      }

      // Mettre à jour en base
      const updated = await Subscription.findByIdAndUpdate(
        subscription._id,
        {
          endDate: newEndDate,
          // Nettoyer aussi les champs problématiques
          cancelationType: null,
          refundStatus: "none"
        },
        { new: true }
      );

      res.json({
        success: true,
        message: "Dates corrigées",
        old_end_date: subscription.endDate,
        new_end_date: newEndDate,
        plan: subscription.plan,
        duration_days: Math.ceil((newEndDate - new Date(subscription.startDate)) / (1000 * 60 * 60 * 24))
      });

    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Récupérer l'abonnement actif de l'utilisateur connecté
  static async getCurrentSubscription(req, res) {
    try {
      const userId = req.user?.userId || req.user?.id;
      if (!userId)
        return res
          .status(401)
          .json({ message: "Utilisateur non authentifié." });

      const subscription =
        await subscriptionIntegrationService.getCurrentSubscription(userId);

      if (!subscription) {
        return res
          .status(404)
          .json({ message: "Aucun abonnement actif trouvé." });
      }

      // 🔍 Log pour debug
      console.log("📊 Subscription retournée:", {
        plan: subscription.plan,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        daysTotal: subscription.endDate && subscription.startDate ? 
          Math.ceil((new Date(subscription.endDate) - new Date(subscription.startDate)) / (1000 * 60 * 60 * 24)) : null
      });

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
        await subscriptionIntegrationService.getCurrentSubscription(userId);

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
        await subscriptionIntegrationService.cancelSubscriptionAtPeriodEnd(
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
        message:
          `Abonnement programmé pour annulation le ${result.endDate ? new Date(result.endDate).toLocaleDateString('fr-FR') : 'fin de période'}. Vous gardez vos avantages jusqu'à cette date.`,
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
        await subscriptionIntegrationService.reactivateSubscription(userId);

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

      const result = await subscriptionIntegrationService.changePlan(
        userId,
        newPlan
      );

      res.json({
        success: true,
        subscription: result.subscription,
        message:
          `Plan changé avec succès de ${result.oldPlan} vers ${result.newPlan}`,
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
}

module.exports = subscriptionController;