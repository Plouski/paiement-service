const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { logger } = require('../utils/logger');
const SubscriptionIntegrationService = require('../services/subscriptionIntegrationService');

/**
 * Contrôleur pour gérer les abonnements premium
 */
class PremiumController {
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
          plan: plan
        }
      });

      // Essayer de pré-enregistrer l'abonnement dans la base de données
      try {
        await SubscriptionIntegrationService.updateSubscription(
          customerId,
          {
            plan: plan,
            paymentMethod: 'stripe',
            status: 'pending',
            sessionId: session.id,
            stripeCustomerId: customer.id,
            stripePriceId: priceId
          }
        );
      } catch (error) {
        logger.warn(`Couldn't pre-register premium subscription: ${error.message}`);
        // Continuer même en cas d'échec, l'abonnement sera mis à jour par le webhook
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
   * Vérifier si un utilisateur a un abonnement premium actif
   */
  static async checkPremiumStatus(req, res) {
    try {
      // Prioritize userId from params, fall back to authenticated user
      const userId = req.params.userId || (req.user && req.user.userId);
      
      if (!userId) {
        return res.status(400).json({
          error: 'User ID is required',
          details: 'No user ID found in request'
        });
      }
  
      // Verify the user matches the authenticated user (optional security check)
      if (req.user && req.user.userId !== userId) {
        return res.status(403).json({
          error: 'Unauthorized access',
          details: 'User ID does not match authenticated user'
        });
      }

      logger.info('Checking premium status', {
        requestUserId: req.params.userId,
        authenticatedUser: req.user ? req.user.userId : 'No authenticated user'
      });
  
      // Proceed with status check
      const subscriptionStatus = await SubscriptionIntegrationService.checkSubscriptionStatus(userId);
      
      return res.status(200).json(subscriptionStatus);
    } catch (error) {
      logger.error(`Error checking premium status: ${error.message}`);
      logger.error('Premium status check failed', {
        error: error.message,
        stack: error.stack,
        requestDetails: {
          userId: req.params.userId,
          authenticatedUser: req.user ? req.user.userId : null
        }
      });
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
      const userId = req.params.userId;
      const { stripeSubscriptionId } = req.body;
      
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

      // Annuler l'abonnement Stripe
      const canceledSubscription = await stripe.subscriptions.cancel(stripeSubscriptionId);
      
      // Mettre à jour l'abonnement dans la base de données
      await SubscriptionIntegrationService.updateSubscription(
        userId,
        {
          status: 'canceled',
          stripeSubscriptionId: stripeSubscriptionId
        }
      );
      
      return res.status(200).json({
        message: 'Subscription canceled successfully',
        status: canceledSubscription.status
      });
    } catch (error) {
      logger.error(`Error canceling premium subscription: ${error.message}`);
      return res.status(500).json({
        error: 'Failed to cancel premium subscription',
        details: error.message
      });
    }
  }
}

module.exports = PremiumController;