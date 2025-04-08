require('dotenv').config();
const axios = require('axios');
const { logger } = require('../utils/logger');
const jwt = require('jsonwebtoken');

// Configuration de base
const DATABASE_SERVICE_URL = process.env.DATABASE_SERVICE_URL || 'http://localhost:5002';
const SERVICE_API_KEY = process.env.SERVICE_API_KEY;

class SubscriptionIntegrationService {
  /**
   * Mapping des prix Stripe vers les plans d'abonnement
   * Définissez ici vos correspondances entre les IDs de prix Stripe et vos plans d'abonnement
   */
  static getPlanFromStripePrice(priceId) {
    const priceToPlanMap = {
      // IDs de prix Stripe actuels
      'price_1RBEbRFPUw49ncmgarXkQo25': 'premium',
      // Vous pouvez ajouter d'autres correspondances ici
    };

    // Vérifier si le priceId existe dans notre mapping
    if (priceToPlanMap[priceId]) {
      return priceToPlanMap[priceId];
    }

    // Si le priceId n'est pas trouvé, vérifier les préfixes génériques
    if (priceId.includes('standard')) return 'standard';
    if (priceId.includes('premium')) return 'premium';
    if (priceId.includes('enterprise')) return 'enterprise';

    // Plan par défaut si non trouvé
    return 'premium';
  }

  /**
   * Mettre à jour ou créer un abonnement dans le service de base de données
   */
  /**
   * Mettre à jour ou créer un abonnement dans le service de base de données
   */
  static async updateSubscription(userId, subscriptionData) {
    try {
      // Vérifier que l'ID utilisateur est valide pour MongoDB
      if (!userId) {
        throw new Error('userId est requis');
      }

      if (!SERVICE_API_KEY) {
        throw new Error('SERVICE_API_KEY n\'est pas configurée');
      }

      // Préparer les données pour l'API
      const payload = {
        userId,
        plan: subscriptionData.plan,
        paymentMethod: subscriptionData.paymentMethod || 'stripe',
        status: subscriptionData.status || 'active',
        sessionId: subscriptionData.sessionId,
        stripeSubscriptionId: subscriptionData.stripeSubscriptionId,
        stripePriceId: subscriptionData.stripePriceId,
        stripeCustomerId: subscriptionData.stripeCustomerId,
        cancelExistingSubscriptions: true // Flag pour désactiver les autres abonnements
      };

      // Logs pour le débogage
      logger.info(`Tentative d'appel API vers ${DATABASE_SERVICE_URL}/api/subscriptions/update-from-payment`);
      logger.info(`Headers: x-api-key présent: ${!!SERVICE_API_KEY}`);
      logger.info(`Payload: ${JSON.stringify(payload)}`);

      // Appeler l'API du service de base de données
      const response = await axios.post(
        `${DATABASE_SERVICE_URL}/api/subscriptions/update-from-payment`,
        payload,
        {
          headers: {
            'x-api-key': SERVICE_API_KEY,
            'Content-Type': 'application/json'
          },
          timeout: 5000 
        }
      );

      // Si l'abonnement est mis à jour/créé avec succès ET qu'il faut mettre à jour le rôle
      if (response.data.success !== false && subscriptionData.updateUserRole) {
        try {
          // Appel pour mettre à jour le rôle utilisateur
          await axios.put(
            `${DATABASE_SERVICE_URL}/api/users/${userId}/role`,
            { 
              role: subscriptionData.plan === 'free' || subscriptionData.status === 'canceled' 
                ? 'user' 
                : subscriptionData.plan === 'premium' 
                  ? 'premium' 
                  : 'user'
            },
            { 
              headers: { 
                'x-api-key': SERVICE_API_KEY,
                'Content-Type': 'application/json'
              } 
            }
          );
          logger.info(`Rôle utilisateur mis à jour pour ${userId} selon le plan ${subscriptionData.plan}`);
        } catch (roleError) {
          logger.warn(`Couldn't update user role: ${roleError.message}`);
        }
      }

      logger.info(`Abonnement mis à jour dans la base de données pour l'utilisateur ${userId}`);
      return response.data;
    } catch (error) {
      logger.error(`Erreur lors de la mise à jour de l'abonnement: ${error.message}`);
      
      // Au lieu de faire remonter l'erreur, retourner un objet de résultat
      return { 
        success: false, 
        message: "Échec de la mise à jour de l'abonnement. La mise à jour sera effectuée par le webhook Stripe ultérieurement."
      };
    }
  }

  /**
   * Vérifier l'état d'un abonnement dans le service de base de données
   */
  static async checkSubscriptionStatus(userId) {
    try {
      if (!userId) {
        throw new Error('L\'ID utilisateur est requis');
      }

      // Log détaillé avant la requête
      logger.info('Tentative de vérification du statut d\'abonnement', {
        userId,
        urlService: process.env.DATABASE_SERVICE_URL
      });

      // Correction: utiliser DATABASE_SERVICE_URL au lieu de USER_SERVICE_URL
      const url = `${process.env.DATABASE_SERVICE_URL}/api/subscriptions/status/${userId}`;
      
      logger.info(`Appel de l'URL: ${url}`);
      
      const config = {
        method: 'get',
        url: url,
        headers: {
          'x-api-key': SERVICE_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      };

      try {
        const response = await axios(config);
        
        logger.info('Réponse du service de données', {
          status: response.status,
          data: response.data
        });

        return response.data;
      } catch (axiosError) {
        // Log détaillé des erreurs Axios
        logger.error(`${axiosError.message}`, {
          code: axiosError.code,
          config: axiosError.config,
          response: axiosError.response ? {
            status: axiosError.response.status,
            data: axiosError.response.data
          } : 'Pas de réponse'
        });

        // Retourner une réponse par défaut en cas d'erreur
        return {
          success: false,
          subscription: null,
          isPremium: false,
          error: axiosError.message
        };
      }
    } catch (error) {
      logger.error('Échec final de la vérification du statut', {
        userId,
        messageErreur: error.message,
        stack: error.stack
      });

      return {
        success: false,
        subscription: null,
        isPremium: false,
        error: error.message
      };
    }
  }

  static genererTokenServiceInterne() {
    return jwt.sign(
      { 
        type: 'service_interne', 
        nomService: 'service-paiement',
        timestamp: Date.now()
      }, 
      process.env.SECRET_SERVICE_INTERNE || 'fallback_secret_dev',
      { 
        expiresIn: '5m' 
      }
    );
  }

  /**
   * Enregistrer un paiement dans l'historique d'abonnement
   */
  static async recordSubscriptionPayment(userId, paymentData) {
    try {
      if (!SERVICE_API_KEY) {
        throw new Error('SERVICE_API_KEY n\'est pas configurée');
      }

      const response = await axios.post(
        `${DATABASE_SERVICE_URL}/api/subscriptions/record-payment`,
        {
          userId,
          ...paymentData
        },
        {
          headers: {
            'x-api-key': SERVICE_API_KEY,
            'Content-Type': 'application/json'
          },
          timeout: 5000 // Ajouter un timeout
        }
      );

      logger.info(`Paiement enregistré pour l'abonnement de l'utilisateur ${userId}`);
      return response.data;
    } catch (error) {
      logger.error(`Erreur lors de l'enregistrement du paiement: ${error.message}`);
      
      // Retourner un résultat par défaut au lieu de faire remonter l'erreur
      return {
        success: false,
        message: "Échec de l'enregistrement du paiement. Sera réessayé ultérieurement."
      };
    }
  }
}

module.exports = SubscriptionIntegrationService;