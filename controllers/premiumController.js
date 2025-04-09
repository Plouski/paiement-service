// controllers/premiumController.js
const stripe = require('../config/stripeConfig');
const { logger } = require('../utils/logger');
const SubscriptionIntegrationService = require('../services/subscriptionIntegrationService');
const apiClient = require('../services/apiClientService');
const { ApiError } = require('../middlewares/errorHandler');
const path = require('path');
const fs = require('fs').promises;

/**
 * Contrôleur pour gérer les abonnements premium
 */
class PremiumController {

  /**
   * Méthode statique pour stocker les métriques qui n'ont pas pu être enregistrées
   */
  static async storeFailedMetric(metricData) {
    try {
      // Chemin vers le fichier de métriques échouées
      const failedMetricsFile = path.join(__dirname, '../failed-metrics.json');

      // Lire les métriques existantes
      let failedMetrics = [];
      try {
        failedMetrics = JSON.parse(await fs.readFile(failedMetricsFile, 'utf8'));
      } catch (readError) {
        // Fichier peut ne pas exister encore
        if (readError.code !== 'ENOENT') {
          throw readError;
        }
      }

      // Ajouter la nouvelle métrique
      failedMetrics.push({
        ...metricData,
        timestamp: new Date().toISOString()
      });

      // Limiter le nombre de métriques stockées (par exemple, garder les 100 dernières)
      if (failedMetrics.length > 100) {
        failedMetrics = failedMetrics.slice(-100);
      }

      // Écrire les métriques mises à jour
      await fs.writeFile(failedMetricsFile, JSON.stringify(failedMetrics, null, 2));

      logger.info('Métrique de paiement non enregistrée stockée localement');
    } catch (storeError) {
      logger.error(`Erreur lors du stockage de la métrique non enregistrée: ${storeError.message}`);

      // Fallback: log dans la console si l'écriture de fichier échoue
      console.error('Impossible de stocker la métrique:', metricData);
    }
  }


  /**
   * Créer une session de paiement pour un abonnement premium
   */
  static async createPremiumSubscription(req, res) {
    try {
      const { priceId, userId } = req.body;

      // Utiliser l'ID utilisateur du token JWT si aucun n'est fourni
      const customerId = userId || req.user.userId;

      if (!customerId) {
        return res.status(400).json({
          error: 'User ID is required'
        });
      }

      if (!priceId) {
        return res.status(400).json({
          error: 'Price ID is required'
        });
      }

      logger.info(`Creating Stripe subscription session for user ${customerId}, price ${priceId}`);

      // Récupérer ou créer un client Stripe
      let customer;
      try {
        // Vérifier si le client existe déjà dans Stripe
        const customers = await stripe.customers.list({
          email: req.user.email,
          limit: 1
        });

        if (customers.data.length > 0) {
          customer = customers.data[0];
          logger.info(`Client Stripe existant trouvé: ${customer.id}`);
        } else {
          // Créer un nouveau client Stripe
          customer = await stripe.customers.create({
            email: req.user.email,
            metadata: {
              userId: customerId
            }
          });
          logger.info(`Nouveau client Stripe créé: ${customer.id}`);
        }
      } catch (error) {
        logger.error(`Erreur lors de la gestion du client Stripe: ${error.message}`);
        throw error;
      }

      // Déterminer le plan d'abonnement en fonction du priceId
      const plan = SubscriptionIntegrationService.getPlanFromStripePrice(priceId) || 'premium';

      // Définir explicitement le statut d'abonnement
      const subscriptionStatus = 'pending';

      // Créer une session de paiement Stripe Checkout
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        customer: customer.id,
        line_items: [{
          price: priceId,
          quantity: 1
        }],
        mode: 'subscription',
        success_url: `${process.env.FRONTEND_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/subscription/cancel`,
        metadata: {
          userId: customerId,
          plan: plan,
          subscriptionStatus: subscriptionStatus
        }
      });

      // Pré-enregistrer l'abonnement dans la base de données
      try {
        await SubscriptionIntegrationService.updateSubscription(
          customerId,
          {
            plan: plan,
            paymentMethod: 'stripe',
            status: subscriptionStatus,
            sessionId: session.id,
            stripeCustomerId: customer.id,
            stripePriceId: priceId
          }
        );
        logger.info(`Abonnement en attente pré-enregistré pour l'utilisateur ${customerId}`);
      } catch (error) {
        logger.warn(`Couldn't pre-register premium subscription: ${error.message}`);
        // Continuer même en cas d'échec
      }

      // Enregistrer une métrique d'événement de paiement
      try {
        const metricData = {
          event: 'checkout_initiated',
          userId: customerId,
          plan: plan,
          priceId: priceId,
          sessionId: session.id,
          status: subscriptionStatus
        };

        const metricResult = await apiClient.metrics.recordPaymentEvent(metricData);

        // Vérifier explicitement le résultat de l'enregistrement de la métrique
        if (!metricResult.success) {
          // Stocker la métrique qui a échoué
          await PremiumController.storeFailedMetric({
            ...metricData,
            failureReason: metricResult.message
          });
          logger.warn(`Échec de l'enregistrement de la métrique: ${metricResult.message}`);
        }
      } catch (metricError) {
        // Stocker la métrique qui a échoué en cas d'erreur complète
        await PremiumController.storeFailedMetric({
          event: 'checkout_initiated',
          userId: customerId,
          plan: plan,
          priceId: priceId,
          sessionId: session.id,
          status: subscriptionStatus,
          error: metricError.message
        });
        logger.warn(`Erreur complète lors de l'enregistrement de la métrique: ${metricError.message}`);
      }

      // Renvoyer l'URL de la session de paiement Stripe
      return res.status(200).json({
        sessionId: session.id,
        url: session.url
      });
    } catch (error) {
      logger.error(`Error creating premium subscription: ${error.message}`);
      return res.status(500).json({
        error: 'Failed to create premium subscription',
        details: error.message
      });
    }
  }

  /**
   * Récupérer les abonnements d'un utilisateur
   */
  static async getUserSubscriptions(req, res) {
    try {
      const userId = req.params.userId || req.user.userId;

      if (!userId) {
        return res.status(400).json({
          error: 'User ID is required'
        });
      }

      // Vérifier l'état de l'abonnement via le service d'intégration
      const subscriptionStatus = await SubscriptionIntegrationService.checkSubscriptionStatus(userId);

      if (!subscriptionStatus.success) {
        return res.status(404).json({
          message: "Aucun abonnement trouvé pour cet utilisateur"
        });
      }

      return res.status(200).json({
        subscription: subscriptionStatus.subscription,
        isPremium: subscriptionStatus.isPremium
      });
    } catch (error) {
      logger.error(`Error fetching user subscriptions: ${error.message}`);
      return res.status(500).json({
        error: 'Failed to fetch subscriptions',
        details: error.message
      });
    }
  }

  /**
   * Vérifier si un utilisateur a un abonnement premium actif
   */
  static async checkPremiumStatus(req, res) {
    try {
      const userId = req.params.userId || (req.user && req.user.userId);

      if (!userId) {
        return res.status(400).json({
          error: 'User ID is required',
          details: 'No user ID found in request'
        });
      }

      logger.info('Checking premium status', {
        requestUserId: req.params.userId,
        authenticatedUser: req.user ? req.user.userId : 'No authenticated user'
      });

      // Pour le développement, on peut retourner directement une réponse factice
      if (process.env.NODE_ENV !== 'production') {
        logger.info('Returning test subscription data for development');
        return res.status(200).json({
          success: true,
          isPremium: true,
          subscription: {
            id: 'sub_test_123456',
            plan: 'premium',
            status: 'active',
            startDate: new Date(),
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30 jours
            features: {
              maxTrips: 50,
              aiConsultations: 20,
              customization: true
            }
          },
          stripeDetails: {
            customerId: 'cus_test_123456',
            subscriptionId: 'sub_test_123456'
          }
        });
      }

      // Code normal pour l'environnement de production
      try {
        const subscriptionStatus = await SubscriptionIntegrationService.checkSubscriptionStatus(userId);
        return res.status(200).json(subscriptionStatus);
      } catch (error) {
        logger.error(`Error fetching subscription data: ${error.message}`);
        throw new Error(`Unable to get subscription: ${error.message}`);
      }
    } catch (error) {
      logger.error(`Error checking premium status: ${error.message}`);

      // Retourner une réponse en cas d'erreur
      return res.status(500).json({
        error: 'Failed to check premium status',
        details: error.message
      });
    }
  }

  /**
   * Annuler un abonnement premium
   */
  static async cancelPremiumSubscription(req, res) {
    try {
      const userId = req.params.userId || req.user.userId;
      const { stripeSubscriptionId, reason } = req.body;

      if (!userId) {
        return res.status(400).json({
          error: 'User ID is required'
        });
      }

      if (!stripeSubscriptionId) {
        return res.status(400).json({
          error: 'Stripe subscription ID is required'
        });
      }

      // Vérifier s'il s'agit d'un ID de test
      if (stripeSubscriptionId.startsWith('sub_test_') || process.env.NODE_ENV !== 'production') {
        logger.info(`Simulation d'annulation pour l'ID de test: ${stripeSubscriptionId}`);

        // Mettre à jour l'abonnement dans la base de données comme s'il était annulé
        await SubscriptionIntegrationService.updateSubscription(
          userId,
          {
            status: 'canceled',
            plan: 'free',
            stripeSubscriptionId: stripeSubscriptionId,
            updateUserRole: true,
            cancelReason: reason || 'Annulé par l\'utilisateur'
          }
        );

        // Enregistrer une métrique d'événement d'annulation
        try {
          await apiClient.metrics.recordSubscriptionEvent({
            event: 'subscription_canceled',
            userId: userId,
            subscriptionId: stripeSubscriptionId,
            reason: reason || 'Annulé par l\'utilisateur',
            isTest: true
          });
        } catch (metricError) {
          logger.warn(`Failed to record subscription metric: ${metricError.message}`);
        }

        return res.status(200).json({
          message: 'Subscription canceled successfully (test mode)',
          status: 'canceled'
        });
      }

      // Code normal pour les abonnements réels
      try {
        // Annuler l'abonnement dans Stripe
        const canceledSubscription = await stripe.subscriptions.cancel(stripeSubscriptionId, {
          // Si une raison est fournie, on peut l'ajouter comme métadonnée
          ...(reason && { metadata: { cancelReason: reason } })
        });

        // Mettre à jour l'abonnement dans la base de données
        await SubscriptionIntegrationService.updateSubscription(
          userId,
          {
            status: 'canceled',
            plan: 'free',
            stripeSubscriptionId: stripeSubscriptionId,
            updateUserRole: true,
            cancelReason: reason || 'Annulé par l\'utilisateur'
          }
        );

        // Envoyer une notification à l'utilisateur
        try {
          await apiClient.notification.sendSubscriptionUpdate(userId, {
            type: 'subscription_canceled',
            details: {
              plan: 'free',
              previousPlan: 'premium',
              cancelDate: new Date().toISOString()
            }
          });
        } catch (notificationError) {
          logger.warn(`Failed to send cancellation notification: ${notificationError.message}`);
        }

        // Enregistrer une métrique d'événement
        try {
          await apiClient.metrics.recordSubscriptionEvent({
            event: 'subscription_canceled',
            userId: userId,
            subscriptionId: stripeSubscriptionId,
            reason: reason || 'Annulé par l\'utilisateur'
          });
        } catch (metricError) {
          logger.warn(`Failed to record subscription metric: ${metricError.message}`);
        }

        return res.status(200).json({
          message: 'Subscription canceled successfully',
          status: canceledSubscription.status
        });
      } catch (stripeError) {
        logger.error(`Stripe error canceling subscription: ${stripeError.message}`);

        // Si l'erreur est que l'abonnement n'existe plus dans Stripe, on met quand même à jour en local
        if (stripeError.code === 'resource_missing') {
          await SubscriptionIntegrationService.updateSubscription(
            userId,
            {
              status: 'canceled',
              plan: 'free',
              stripeSubscriptionId: stripeSubscriptionId,
              updateUserRole: true,
              cancelReason: reason || 'Annulé par l\'utilisateur (subscription not found in Stripe)'
            }
          );

          return res.status(200).json({
            message: 'Subscription marked as canceled (not found in Stripe)',
            status: 'canceled'
          });
        }

        throw stripeError;
      }
    } catch (error) {
      logger.error(`Error canceling premium subscription: ${error.message}`);
      return res.status(500).json({
        error: 'Failed to cancel premium subscription',
        details: error.message
      });
    }
  }

  /**
   * Récupérer l'historique des paiements d'un utilisateur
   */
  static async getPaymentHistory(req, res) {
    try {
      const userId = req.params.userId || req.user.userId;

      if (!userId) {
        return res.status(400).json({
          error: 'User ID is required'
        });
      }

      const { limit = 10, page = 1 } = req.query;

      // Obtenir l'historique via le service de base de données
      try {
        const paymentHistory = await apiClient.database.getPaymentHistory(userId, {
          limit: parseInt(limit),
          page: parseInt(page)
        });

        return res.status(200).json(paymentHistory);
      } catch (error) {
        logger.error(`Error fetching payment history: ${error.message}`);
        throw new Error(`Unable to get payment history: ${error.message}`);
      }
    } catch (error) {
      logger.error(`Error retrieving payment history: ${error.message}`);
      return res.status(500).json({
        error: 'Failed to retrieve payment history',
        details: error.message
      });
    }
  }

  /**
   * Récupérer les factures d'un utilisateur depuis Stripe
   */
  static async getUserInvoices(req, res) {
    try {
      const userId = req.params.userId || req.user.userId;

      if (!userId) {
        return res.status(400).json({
          error: 'User ID is required'
        });
      }

      // Récupérer le client Stripe associé à l'utilisateur
      const userSubscription = await SubscriptionIntegrationService.checkSubscriptionStatus(userId);

      if (!userSubscription.stripeDetails?.customerId) {
        return res.status(404).json({
          message: "Aucun client Stripe trouvé pour cet utilisateur"
        });
      }

      const customerId = userSubscription.stripeDetails.customerId;

      // Récupérer les factures depuis Stripe
      const invoices = await stripe.invoices.list({
        customer: customerId,
        limit: 10
      });

      // Formater les factures pour la réponse
      const formattedInvoices = invoices.data.map(invoice => ({
        id: invoice.id,
        number: invoice.number,
        amount: invoice.amount_paid / 100, // Convertir les centimes en euros
        currency: invoice.currency,
        status: invoice.status,
        date: new Date(invoice.created * 1000),
        pdfUrl: invoice.invoice_pdf,
        description: invoice.description
      }));

      return res.status(200).json({
        invoices: formattedInvoices,
        hasMore: invoices.has_more
      });
    } catch (error) {
      logger.error(`Error retrieving user invoices: ${error.message}`);
      return res.status(500).json({
        error: 'Failed to retrieve invoices',
        details: error.message
      });
    }
  }

  /**
   * Générer un lien de portail client Stripe pour gérer l'abonnement
   */
  static async createBillingPortalSession(req, res) {
    try {
      const userId = req.params.userId || req.user.userId;

      if (!userId) {
        return res.status(400).json({
          error: 'User ID is required'
        });
      }

      // Récupérer le client Stripe associé à l'utilisateur
      const userSubscription = await SubscriptionIntegrationService.checkSubscriptionStatus(userId);

      if (!userSubscription.stripeDetails?.customerId) {
        return res.status(404).json({
          message: "Aucun client Stripe trouvé pour cet utilisateur"
        });
      }

      const customerId = userSubscription.stripeDetails.customerId;

      // Créer une session de portail client
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${process.env.FRONTEND_URL}/account/subscription`
      });

      return res.status(200).json({
        url: session.url
      });
    } catch (error) {
      logger.error(`Error creating billing portal session: ${error.message}`);
      return res.status(500).json({
        error: 'Failed to create billing portal session',
        details: error.message
      });
    }
  }

  /**
   * Mettre à jour les informations de paiement d'un utilisateur
   */
  static async updatePaymentMethod(req, res) {
    try {
      const userId = req.params.userId || req.user.userId;
      const { paymentMethodId } = req.body;

      if (!userId) {
        return res.status(400).json({
          error: 'User ID is required'
        });
      }

      if (!paymentMethodId) {
        return res.status(400).json({
          error: 'Payment method ID is required'
        });
      }

      // Récupérer le client Stripe associé à l'utilisateur
      const userSubscription = await SubscriptionIntegrationService.checkSubscriptionStatus(userId);

      if (!userSubscription.stripeDetails?.customerId) {
        return res.status(404).json({
          message: "Aucun client Stripe trouvé pour cet utilisateur"
        });
      }

      const customerId = userSubscription.stripeDetails.customerId;

      // Attacher la méthode de paiement au client
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId
      });

      // Définir comme méthode de paiement par défaut
      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId
        }
      });

      return res.status(200).json({
        message: "Méthode de paiement mise à jour avec succès",
        success: true
      });
    } catch (error) {
      logger.error(`Error updating payment method: ${error.message}`);
      return res.status(500).json({
        error: 'Failed to update payment method',
        details: error.message
      });
    }
  }

  /**
   * Mettre à niveau un abonnement (changer de plan)
   */
  static async upgradeSubscription(req, res) {
    try {
      const userId = req.params.userId || req.user.userId;
      const { newPriceId } = req.body;

      if (!userId) {
        return res.status(400).json({
          error: 'User ID is required'
        });
      }

      if (!newPriceId) {
        return res.status(400).json({
          error: 'New price ID is required'
        });
      }

      // Récupérer les informations d'abonnement actuelles
      const userSubscription = await SubscriptionIntegrationService.checkSubscriptionStatus(userId);

      if (!userSubscription.subscription || !userSubscription.stripeDetails?.subscriptionId) {
        return res.status(404).json({
          message: "Aucun abonnement actif trouvé"
        });
      }

      const stripeSubscriptionId = userSubscription.stripeDetails.subscriptionId;

      // Déterminer le nouveau plan
      const newPlan = SubscriptionIntegrationService.getPlanFromStripePrice(newPriceId);

      if (!newPlan) {
        return res.status(400).json({
          error: 'Invalid price ID'
        });
      }

      // Si c'est un ID de test ou en environnement de développement
      if (stripeSubscriptionId.startsWith('sub_test_') || process.env.NODE_ENV !== 'production') {
        // Simuler la mise à niveau
        await SubscriptionIntegrationService.updateSubscription(userId, {
          plan: newPlan,
          status: 'active',
          stripeSubscriptionId,
          stripePriceId: newPriceId,
          updateUserRole: true
        });

        return res.status(200).json({
          message: `Subscription upgraded to ${newPlan} (test mode)`,
          status: 'active',
          plan: newPlan
        });
      }

      // Mise à jour réelle dans Stripe
      const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);

      // Récupérer l'ID de l'élément d'abonnement à mettre à jour
      const itemId = subscription.items.data[0].id;

      // Mettre à jour l'abonnement
      const updatedSubscription = await stripe.subscriptions.update(stripeSubscriptionId, {
        items: [{
          id: itemId,
          price: newPriceId
        }],
        // Facturer immédiatement la différence pro-rata
        proration_behavior: 'create_prorations',
        metadata: {
          plan: newPlan
        }
      });

      // Mettre à jour dans notre base de données
      await SubscriptionIntegrationService.updateSubscription(userId, {
        plan: newPlan,
        status: updatedSubscription.status,
        stripePriceId: newPriceId,
        updateUserRole: true
      });

      // Enregistrer une métrique d'événement
      try {
        await apiClient.metrics.recordSubscriptionEvent({
          event: 'subscription_upgraded',
          userId,
          subscriptionId: stripeSubscriptionId,
          previousPlan: userSubscription.subscription.plan,
          newPlan
        });
      } catch (metricError) {
        logger.warn(`Failed to record subscription upgrade metric: ${metricError.message}`);
      }

      return res.status(200).json({
        message: `Subscription upgraded to ${newPlan}`,
        status: updatedSubscription.status,
        plan: newPlan
      });
    } catch (error) {
      logger.error(`Error upgrading subscription: ${error.message}`);
      return res.status(500).json({
        error: 'Failed to upgrade subscription',
        details: error.message
      });
    }
  }
}

module.exports = PremiumController;