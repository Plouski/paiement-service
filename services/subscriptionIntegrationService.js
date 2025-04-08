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
        stripeCustomerId: subscriptionData.stripeCustomerId
      };

      // Ajoutez ceci juste avant l'appel axios
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
          }
        }
      );

      logger.info(`Abonnement mis à jour dans le service de base de données pour l'utilisateur ${userId}`);
      return response.data;
    } catch (error) {
      logger.error(`Erreur lors de la mise à jour de l'abonnement dans la base de données: ${error.message}`);
      throw error;
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
        urlService: process.env.USER_SERVICE_URL
      });

      const config = {
        method: 'get',
        url: `${process.env.USER_SERVICE_URL}/subscriptions/${userId}`,
        headers: {
          'Authorization': `Bearer ${this.genererTokenServiceInterne()}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // Augmenté à 10 secondes
      };

      // Log du token généré
      logger.info('Token de service interne généré', {
        token: config.headers.Authorization
      });

      try {
        const response = await axios(config);
        
        logger.info('Réponse du service utilisateur', {
          status: response.status,
          data: response.data
        });

        return response.data;
      } catch (axiosError) {
        // Log détaillé des erreurs Axios
        logger.error('Erreur détaillée lors de la requête', {
          message: axiosError.message,
          code: axiosError.code,
          config: axiosError.config,
          response: axiosError.response ? {
            status: axiosError.response.status,
            data: axiosError.response.data
          } : 'Pas de réponse',
        });

        // Gestion spécifique des erreurs Axios
        if (axiosError.code === 'ECONNREFUSED') {
          throw new Error('Connexion refusée : le service utilisateur est-il actif ?');
        }
        if (axiosError.code === 'ETIMEDOUT') {
          throw new Error('Délai de connexion dépassé : le service est-il joignable ?');
        }

        throw axiosError;
      }
    } catch (error) {
      logger.error('Échec final de la vérification du statut', {
        userId,
        messageErreur: error.message,
        stack: error.stack
      });

      throw error;
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
          }
        }
      );

      logger.info(`Paiement enregistré pour l'abonnement de l'utilisateur ${userId}`);
      return response.data;
    } catch (error) {
      logger.error(`Erreur lors de l'enregistrement du paiement: ${error.message}`);
      throw error;
    }
  }
}

module.exports = SubscriptionIntegrationService;