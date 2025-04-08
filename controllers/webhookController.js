// controllers/webhookController.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
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
    return this.processWebhookEvent(event, res);
  }
  
  /**
   * Point d'entrée pour les tests de webhook - ignore la vérification de signature
   */
  static async handleStripeWebhookTest(req, res) {
    const event = req.body;
    
    logger.info(`Test de webhook Stripe reçu: ${event.type}`);
    
    // Ajouter des logs détaillés pour le débogage
    logger.info(`Contenu de l'événement test:`, {
      eventId: event.id,
      eventType: event.type,
      object: event.data?.object?.id,
      metadata: event.data?.object?.metadata
    });
    
    // Correction: utilisez le nom de la classe au lieu de this
    return WebhookController.processWebhookEvent(event, res);
  }
  
  /**
   * Logique commune de traitement des événements
   */
  static async processWebhookEvent(event, res) {
    try {
      // Traiter les différents types d'événements
      switch (event.type) {
        case 'checkout.session.completed': {
          await this.handleCheckoutSessionCompleted(event.data.object);
          break;
        }
        
        case 'invoice.paid': {
          await this.handleInvoicePaid(event.data.object);
          break;
        }
        
        case 'customer.subscription.updated': {
          await this.handleSubscriptionUpdated(event.data.object);
          break;
        }
        
        case 'customer.subscription.deleted': {
          await this.handleSubscriptionDeleted(event.data.object);
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
      return res.json({ received: true });
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
      
      // Récupérer des détails supplémentaires si nécessaire
      let stripePriceId = null;
      let stripeSubscriptionId = null;
      
      // Si des informations sont manquantes, on peut faire une requête supplémentaire
      if (session.line_items) {
        // Déjà inclus dans l'événement
        stripePriceId = session.line_items.data[0]?.price?.id;
      } else if (session.subscription) {
        // Faire une requête pour obtenir l'abonnement
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        stripeSubscriptionId = subscription.id;
        stripePriceId = subscription.items.data[0]?.price?.id;
      }
      
      // Mettre à jour l'abonnement dans la base de données
      await SubscriptionIntegrationService.updateSubscription(userId, {
        plan: plan || 'premium',
        paymentMethod: 'stripe',
        status: 'active',
        sessionId: session.id,
        stripeCustomerId: session.customer,
        stripeSubscriptionId,
        stripePriceId
      });
      
      logger.info(`Abonnement activé avec succès pour l'utilisateur ${userId}`);
    } catch (error) {
      logger.error(`Erreur lors de l'activation de l'abonnement: ${error.message}`, error);
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
      
      // Rechercher l'utilisateur par customerId
      const userId = await this.findUserIdByCustomerId(customerId);
      
      if (!userId) {
        logger.warn(`Aucun utilisateur trouvé pour le customer ${customerId}`);
        return;
      }
      
      // Enregistrer le paiement dans l'historique
      await SubscriptionIntegrationService.recordSubscriptionPayment(userId, {
        amount: invoice.amount_paid / 100, // Convertir de centimes
        currency: invoice.currency,
        transactionId: invoice.id,
        invoiceId: invoice.id,
        status: 'success'
      });
      
      logger.info(`Paiement enregistré pour l'utilisateur ${userId}`);
    } catch (error) {
      logger.error(`Erreur lors de l'enregistrement du paiement: ${error.message}`, error);
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
      
      // Rechercher l'utilisateur par customerId
      const userId = await this.findUserIdByCustomerId(customerId);
      
      if (!userId) {
        logger.warn(`Aucun utilisateur trouvé pour le customer ${customerId}`);
        return;
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
          status = 'suspended'; // Ou un statut équivalent
          break;
        case 'canceled':
          status = 'canceled';
          break;
        default:
          status = subscription.status;
      }
      
      // Mettre à jour l'abonnement
      await SubscriptionIntegrationService.updateSubscription(userId, {
        status,
        stripeSubscriptionId: subscription.id
      });
      
      logger.info(`Statut d'abonnement mis à jour pour l'utilisateur ${userId}: ${status}`);
    } catch (error) {
      logger.error(`Erreur lors de la mise à jour du statut d'abonnement: ${error.message}`, error);
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
      
      // Rechercher l'utilisateur par customerId
      const userId = await this.findUserIdByCustomerId(customerId);
      
      if (!userId) {
        logger.warn(`Aucun utilisateur trouvé pour le customer ${customerId}`);
        return;
      }
      
      // Mettre à jour l'abonnement comme annulé
      await SubscriptionIntegrationService.updateSubscription(userId, {
        status: 'canceled',
        stripeSubscriptionId: subscription.id
      });
      
      logger.info(`Abonnement marqué comme annulé pour l'utilisateur ${userId}`);
    } catch (error) {
      logger.error(`Erreur lors de l'annulation de l'abonnement: ${error.message}`, error);
      throw error;
    }
  }
  
  /**
   * Utilitaire pour trouver l'ID utilisateur à partir d'un ID client Stripe
   */
  static async findUserIdByCustomerId(customerId) {
    try {
      // Cette méthode dépend de votre implémentation spécifique
      // Voici un exemple de ce qu'elle pourrait faire
      
      // Option 1: Utiliser la méthode du service d'intégration si elle existe
      if (typeof SubscriptionIntegrationService.getUserIdFromCustomerId === 'function') {
        return await SubscriptionIntegrationService.getUserIdFromCustomerId(customerId);
      }
      
      // Option 2: Rechercher dans les métadonnées du client Stripe
      // Cela suppose que vous avez stocké l'ID utilisateur dans les métadonnées du client
      const customer = await stripe.customers.retrieve(customerId);
      if (customer && customer.metadata && customer.metadata.userId) {
        return customer.metadata.userId;
      }
      
      // Option 3: Faire une requête à votre service de base de données
      // pour trouver un utilisateur avec ce customerId
      // Cela dépend de votre mise en œuvre spécifique
      
      logger.warn(`Méthode de recherche d'utilisateur par customerId non implémentée`);
      return null;
    } catch (error) {
      logger.error(`Erreur lors de la recherche de l'utilisateur par customerId: ${error.message}`, error);
      return null;
    }
  }
}

module.exports = WebhookController;