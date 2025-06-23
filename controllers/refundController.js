const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const { logger } = require("../utils/logger");
const Subscription = require("../models/Subscription");
const User = require("../models/User");
const NotificationService = require("../services/notificationService");

class RefundController {
  
  // Méthode statique pour estimer le montant du remboursement
  static estimateRefundAmount(plan) {
    const amounts = {
      'monthly': 9.99,
      'annual': 99.99,
      'premium': 9.99
    };
    return amounts[plan] || 9.99;
  }

  // Remboursement complet pour un utilisateur
  static async processRefund(req, res) {
    try {
      const userId = req.user?.userId || req.user?.id;
      const { reason } = req.body;

      if (!userId) {
        return res.status(401).json({ error: "Utilisateur non authentifié" });
      }

      logger.info(`[💰] Demande de remboursement pour ${userId}`);

      const subscription = await Subscription.findOne({
        userId,
        status: { $in: ["active", "canceled"] },
        lastTransactionId: { $exists: true }
      });

      if (!subscription) {
        return res.status(404).json({ 
          error: "Aucun abonnement éligible au remboursement" 
        });
      }

      const daysSincePayment = Math.floor(
        (Date.now() - subscription.lastPaymentDate?.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSincePayment > 30) {
        return res.status(400).json({
          error: `Remboursement possible uniquement dans les 30 jours (${daysSincePayment} jours écoulés)`
        });
      }

      let refundResult = null;
      let refundAmount = 0;
      let processingMessage = "Remboursement traité avec succès";

      if (subscription.lastTransactionId && subscription.paymentMethod === "stripe") {
        try {
          let paymentIntentId = subscription.lastTransactionId;
          
          logger.info(`[🔍] Tentative de remboursement Stripe pour: ${paymentIntentId}`);

          if (paymentIntentId.startsWith('cs_')) {
            try {
              const session = await stripe.checkout.sessions.retrieve(paymentIntentId);
              paymentIntentId = session.payment_intent;
              logger.info(`[🔍] Payment intent récupéré depuis session: ${paymentIntentId}`);
            } catch (sessionError) {
              logger.warn(`[⚠️] Session Stripe introuvable: ${paymentIntentId}`, sessionError.message);
            }
          }

          if (paymentIntentId && paymentIntentId !== 'null') {
            try {
              refundResult = await stripe.refunds.create({
                payment_intent: paymentIntentId,
                reason: "requested_by_customer",
                metadata: {
                  userId,
                  refundReason: reason || "Demande client"
                }
              });
              
              refundAmount = refundResult.amount / 100;
              logger.info(`[✅] Remboursement Stripe créé: ${refundResult.id} - ${refundAmount}€`);
              
            } catch (refundError) {
              logger.warn(`[⚠️] Erreur remboursement Stripe pour ${paymentIntentId}:`, refundError.message);
              
              if (refundError.code === 'charge_already_refunded') {
                return res.status(400).json({ 
                  error: "Ce paiement a déjà été remboursé" 
                });
              }
              
              if (refundError.code === 'resource_missing') {
                logger.warn(`[⚠️] Payment intent non trouvé dans Stripe: ${paymentIntentId}`);
                refundAmount = RefundController.estimateRefundAmount(subscription.plan);
                processingMessage = "Remboursement manuel traité - notre équipe vous contactera sous 48h";
              } else {
                throw refundError;
              }
            }
          } else {
            logger.warn(`[⚠️] Aucun payment intent valide trouvé`);
            refundAmount = RefundController.estimateRefundAmount(subscription.plan);
            processingMessage = "Remboursement manuel traité - notre équipe vous contactera sous 48h";
          }

        } catch (stripeError) {
          logger.error(`[❌] Erreur générale Stripe:`, stripeError.message);
          
          refundAmount = RefundController.estimateRefundAmount(subscription.plan);
          processingMessage = "Demande de remboursement enregistrée - notre équipe vous contactera sous 48h";
        }
      } else {
        refundAmount = RefundController.estimateRefundAmount(subscription.plan);
        processingMessage = "Remboursement manuel traité - notre équipe vous contactera sous 48h";
      }

      if (subscription.stripeSubscriptionId) {
        try {
          await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
          logger.info(`[🔚] Abonnement Stripe annulé: ${subscription.stripeSubscriptionId}`);
        } catch (cancelError) {
          logger.warn(`[⚠️] Erreur annulation abonnement Stripe:`, cancelError.message);
        }
      }

      await Subscription.findByIdAndUpdate(subscription._id, {
        status: "canceled",
        isActive: false,
        cancelationType: "immediate",
        refundStatus: refundResult ? "processed" : "manual_pending",
        refundAmount: refundAmount,
        refundDate: new Date(),
        refundReason: reason || "Demande de remboursement utilisateur"
      });

      await User.findByIdAndUpdate(userId, { role: "user" });

      try {
        const user = await User.findById(userId);
        if (user?.email) {
          await NotificationService.sendEmail('refund_confirmation', user.email, {
            amount: refundAmount,
            refundId: refundResult?.id || 'MANUAL',
            processingTime: refundResult ? "3-5 jours ouvrés" : "48-72 heures",
            isManualRefund: !refundResult
          });
          logger.info(`[📧] Email de confirmation envoyé à ${user.email}`);
        }
      } catch (emailError) {
        logger.warn("⚠️ Erreur envoi email:", emailError.message);
      }

      res.json({
        success: true,
        message: processingMessage,
        refund: {
          amount: refundAmount,
          id: refundResult?.id || 'MANUAL_REFUND',
          status: refundResult?.status || 'manual_pending',
          processingTime: refundResult ? "3-5 jours ouvrés" : "48-72 heures",
          isManualRefund: !refundResult
        }
      });

    } catch (error) {
      logger.error("❌ Erreur remboursement:", error);
      res.status(500).json({
        error: "Erreur lors du remboursement",
        details: error.message
      });
    }
  }

  // Vérifier l'éligibilité au remboursement
  static async checkEligibility(req, res) {
    try {
      const userId = req.user?.userId || req.user?.id;
      
      const subscription = await Subscription.findOne({
        userId,
        lastTransactionId: { $exists: true }
      });

      if (!subscription) {
        return res.json({ eligible: false, reason: "Aucun paiement trouvé" });
      }

      if (subscription.refundStatus && subscription.refundStatus !== 'none') {
        return res.json({ 
          eligible: false, 
          reason: "Déjà remboursé ou en cours de traitement" 
        });
      }

      const daysSincePayment = Math.floor(
        (Date.now() - subscription.lastPaymentDate?.getTime()) / (1000 * 60 * 60 * 24)
      );

      const eligible = daysSincePayment <= 30;

      res.json({
        eligible,
        daysSincePayment,
        daysRemaining: eligible ? 30 - daysSincePayment : 0,
        reason: eligible ? null : daysSincePayment > 30 ? "Délai dépassé" : "Déjà remboursé"
      });

    } catch (error) {
      logger.error("❌ Erreur vérification éligibilité:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }
}

module.exports = RefundController;