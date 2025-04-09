// controllers/webhookController.js
const stripe = require('../config/stripeConfig');
const { logger } = require('../utils/logger');
const SubscriptionIntegrationService = require('../services/subscriptionIntegrationService');

class WebhookController {
  /**
   * Point d'entrée principal pour les webhooks Stripe - vérifie la signature
   */
  static async handleStripeWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    let event;
    
    try {
      // Vérifier la signature du webhook
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
      logger.info(`Webhook Stripe reçu: ${event.type}`);
    } catch (err) {
      logger.error(`Erreur de signature webhook: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    // Traiter l'événement vérifié
    return WebhookController.processWebhookEvent(event, res);
  }
  
  /**
   * Point d'entrée pour les tests de webhook - ignore la vérification de signature
   */
  static async handleStripeWebhookTest(req, res) {
    const event = req.body;
    
    logger.info(`Test de webhook Stripe reçu: ${event.type}`, {
      eventId: event.id,
      eventType: event.type,
      object: event.data?.object?.id
    });
    
    return WebhookController.processWebhookEvent(event, res);
  }
  
  /**
   * Logique commune de traitement des événements
   */
  static async processWebhookEvent(event, res) {
    try {
      let result = null;

      // Traiter les différents types d'événements
      switch (event.type) {
        case 'checkout.session.completed': {
          result = await WebhookController.handleCheckoutSessionCompleted(event.data.object);
          break;
        }
        
        case 'invoice.paid': {
          result = await WebhookController.handleInvoicePaid(event.data.object);
          break;
        }
        
        case 'customer.subscription.updated': {
          result = await WebhookController.handleSubscriptionUpdated(event.data.object);
          break;
        }
        
        case 'customer.subscription.deleted': {
          result = await WebhookController.handleSubscriptionDeleted(event.data.object);
          break;
        }
        
        case 'payment_intent.succeeded': {
          logger.info(`Paiement réussi: ${event.data.object.id}`);
          break;
        }
        
        case 'payment_intent.payment_failed': {
          logger.warn(`Échec de paiement: ${event.data.object.id}`);
          break;
        }
        
        default:
          logger.info(`Événement non traité: ${event.type}`);
      }
      
      // Répondre à Stripe pour confirmer la réception
      return res.status(200).json({ 
        received: true,
        processed: true,
        result
      });
    } catch (error) {
      // Log détaillé de l'erreur mais répondre 200 quand même
      // pour éviter que Stripe ne réessaie infiniment
      logger.error(`Erreur lors du traitement du webhook ${event.type}:`, error);
      return res.status(200).json({ 
        received: true,
        error: error.message,
        processed: false
      });
    }
  }
  
  /**
   * Gestion d'une session de checkout complétée
   */
  static async handleCheckoutSessionCompleted(session) {
    logger.info(`Session de checkout complétée: ${session.id}`);
    
    try {
      // Extraire les métadonnées
      const userId = session.metadata.userId;
      const plan = session.metadata.plan;
      
      if (!userId) {
        throw new Error('Pas d\'ID utilisateur dans les métadonnées de la session');
      }
      
      logger.info(`Checkout réussi pour l'utilisateur ${userId}, plan ${plan}`);
      
      // Récupérer des détails supplémentaires
      let stripePriceId = null;
      let stripeSubscriptionId = null;
      
      // Récupérer l'abonnement si nécessaire
      if (session.subscription) {
        try {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          stripeSubscriptionId = subscription.id;
          stripePriceId = subscription.items.data[0]?.price?.id;
        } catch (subError) {
          logger.warn(`Impossible de récupérer les détails de l'abonnement: ${subError.message}`);
        }
      }
      
      // Mettre à jour l'abonnement dans la base de données
      const result = await SubscriptionIntegrationService.updateSubscription(userId, {
        plan: plan || 'premium',
        paymentMethod: 'stripe',
        status: 'active',
        sessionId: session.id,
        stripeCustomerId: session.customer,
        stripeSubscriptionId,
        stripePriceId,
        updateUserRole: true
      });
      
      logger.info(`Abonnement activé pour l'utilisateur ${userId}: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      logger.error(`Erreur lors de l'activation de l'abonnement: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Gestion d'une facture payée
   */
  static async handleInvoicePaid(invoice) {
    logger.info(`Facture payée: ${invoice.id}`);
    
    try {
      const customerId = invoice.customer;
      
      // Rechercher l'ID utilisateur via l'API
      const userId = await SubscriptionIntegrationService.getUserIdFromCustomerId(customerId);
      
      if (!userId) {
        logger.warn(`Aucun utilisateur trouvé pour le customer ${customerId}`);
        return {
          success: false,
          message: `Aucun utilisateur trouvé pour le customer ${customerId}`
        };
      }
      
      // Enregistrer le paiement dans l'historique
      const result = await SubscriptionIntegrationService.recordSubscriptionPayment(userId, {
        amount: invoice.amount_paid / 100, // Convertir de centimes
        currency: invoice.currency,
        transactionId: invoice.id,
        invoiceId: invoice.id,
        status: 'success'
      });
      
      logger.info(`Paiement enregistré pour l'utilisateur ${userId}`);
      return result;
    } catch (error) {
      logger.error(`Erreur lors de l'enregistrement du paiement: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Gestion d'un abonnement mis à jour
   */
  static async handleSubscriptionUpdated(subscription) {
    logger.info(`Abonnement mis à jour: ${subscription.id}`);
    
    try {
      const customerId = subscription.customer;
      
      // Rechercher l'ID utilisateur via l'API
      const userId = await SubscriptionIntegrationService.getUserIdFromCustomerId(customerId);
      
      if (!userId) {
        logger.warn(`Aucun utilisateur trouvé pour le customer ${customerId}`);
        return {
          success: false,
          message: `Aucun utilisateur trouvé pour le customer ${customerId}`
        };
      }
      
      // Déterminer le nouveau statut
      let status;
      switch (subscription.status) {
        case 'active':
          status = 'active';
          break;
        case 'past_due':
          status = 'active'; // Ou 'warning' si vous avez ce statut
          break;
        case 'unpaid':
          status = 'suspended';
          break;
        case 'canceled':
          status = 'canceled';
          break;
        default:
          status = subscription.status;
      }
      
      // Déterminer le plan
      const items = subscription.items.data;
      let plan = 'premium';  // Par défaut
      if (items && items.length > 0) {
        const priceId = items[0].price.id;
        plan = SubscriptionIntegrationService.getPlanFromStripePrice(priceId);
      }
      
      // Mettre à jour l'abonnement
      const result = await SubscriptionIntegrationService.updateSubscription(userId, {
        status,
        plan,
        stripeSubscriptionId: subscription.id,
        updateUserRole: true
      });
      
      logger.info(`Statut d'abonnement mis à jour pour l'utilisateur ${userId}: ${status}`);
      return result;
    } catch (error) {
      logger.error(`Erreur lors de la mise à jour du statut d'abonnement: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Gestion d'un abonnement supprimé
   */
  static async handleSubscriptionDeleted(subscription) {
    logger.info(`Abonnement supprimé: ${subscription.id}`);
    
    try {
      const customerId = subscription.customer;
      
      // Rechercher l'ID utilisateur via l'API
      const userId = await SubscriptionIntegrationService.getUserIdFromCustomerId(customerId);
      
      if (!userId) {
        logger.warn(`Aucun utilisateur trouvé pour le customer ${customerId}`);
        return {
          success: false,
          message: `Aucun utilisateur trouvé pour le customer ${customerId}`
        };
      }
      
      // Mettre à jour l'abonnement comme annulé
      const result = await SubscriptionIntegrationService.updateSubscription(userId, {
        status: 'canceled',
        plan: 'free',
        stripeSubscriptionId: subscription.id,
        updateUserRole: true
      });
      
      logger.info(`Abonnement marqué comme annulé pour l'utilisateur ${userId}`);
      return result;
    } catch (error) {
      logger.error(`Erreur lors de l'annulation de l'abonnement: ${error.message}`);
      throw error;
    }
  }
}

module.exports = WebhookController;