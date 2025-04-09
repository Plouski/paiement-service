// services/subscriptionIntegrationService.js
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
   */
  static getPlanFromStripePrice(priceId) {
    const priceToPlanMap = {
      'price_1RBEbRFPUw49ncmgarXkQo25': 'premium',
      // Vous pouvez ajouter d'autres correspondances ici
    };

    if (priceToPlanMap[priceId]) {
      return priceToPlanMap[priceId];
    }

    // Vérification par préfixe
    if (priceId.includes('standard')) return 'standard';
    if (priceId.includes('premium')) return 'premium';
    if (priceId.includes('enterprise')) return 'enterprise';

    return 'premium';
  }

  /**
   * Mettre à jour ou créer un abonnement dans le service de base de données
   */
  static async updateSubscription(userId, subscriptionData) {
    try {
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
        cancelExistingSubscriptions: true
      };

      logger.info(`Appel API vers ${DATABASE_SERVICE_URL}/api/subscriptions/update-from-payment`);
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
          timeout: 8000  // Augmenter le timeout
        }
      );

      // Mise à jour du rôle utilisateur si nécessaire
      if (response.data.success !== false && subscriptionData.updateUserRole) {
        try {
          const role = this.determineUserRole(subscriptionData.plan, subscriptionData.status);
          
          await axios.put(
            `${DATABASE_SERVICE_URL}/api/users/${userId}/role`,
            { role },
            { 
              headers: { 
                'x-api-key': SERVICE_API_KEY,
                'Content-Type': 'application/json'
              },
              timeout: 5000
            }
          );
          logger.info(`Rôle utilisateur mis à jour pour ${userId} vers ${role}`);
        } catch (roleError) {
          logger.warn(`Couldn't update user role: ${roleError.message}`);
        }
      }

      logger.info(`Abonnement mis à jour pour l'utilisateur ${userId}`);
      logger.info(`Mise à jour d'abonnement - données entrantes:`, subscriptionData);
      return response.data;
    } catch (error) {
      logger.error(`Erreur lors de la mise à jour de l'abonnement: ${error.message}`);
      
      // Retourner un objet de résultat avec une indication d'échec
      return { 
        success: false, 
        message: "Échec de la mise à jour de l'abonnement. La mise à jour sera effectuée par le webhook Stripe ultérieurement."
      };
    }
  }

  /**
   * Déterminer le rôle de l'utilisateur en fonction du plan et du statut
   */
  static determineUserRole(plan, status) {
    if (status === 'canceled' || plan === 'free') {
      return 'user';
    }
    
    if (plan === 'premium' || plan === 'enterprise') {
      return 'premium';
    }
    
    return 'user';
  }

  /**
   * Vérifier l'état d'un abonnement dans le service de base de données
   */
  static async checkSubscriptionStatus(userId) {
    try {
      if (!userId) {
        throw new Error('L\'ID utilisateur est requis');
      }

      logger.info(`Vérification du statut d'abonnement pour l'utilisateur ${userId}`);
      
      const url = `${DATABASE_SERVICE_URL}/api/subscriptions/status/${userId}`;
      
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
        
        logger.info(`Statut d'abonnement récupéré avec succès: ${JSON.stringify(response.data)}`);
        return response.data;
      } catch (axiosError) {
        logger.error(`Erreur lors de la requête de statut d'abonnement: ${axiosError.message}`);
        
        // Si nous sommes en environnement de développement, retourner des données de test
        if (process.env.NODE_ENV !== 'production') {
          logger.info('Retour de données de test pour l\'environnement de développement');
          return {
            success: true,
            isPremium: true,
            subscription: {
              id: 'sub_test_123456',
              plan: 'premium',
              status: 'active',
              startDate: new Date(),
              endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              features: {
                maxTrips: 50,
                aiConsultations: 20,
                customization: true
              }
            }
          };
        }

        return {
          success: false,
          subscription: null,
          isPremium: false,
          error: axiosError.message
        };
      }
    } catch (error) {
      logger.error(`Échec de la vérification du statut: ${error.message}`);

      return {
        success: false,
        subscription: null,
        isPremium: false,
        error: error.message
      };
    }
  }

  /**
   * Obtenir l'ID utilisateur à partir de l'ID client Stripe
   */
  static async getUserIdFromCustomerId(customerId) {
    try {
      const response = await axios.get(
        `${DATABASE_SERVICE_URL}/api/users/stripe-customer/${customerId}`,
        {
          headers: {
            'x-api-key': SERVICE_API_KEY
          },
          timeout: 5000
        }
      );
      
      return response.data.userId;
    } catch (error) {
      logger.error(`Erreur lors de la récupération de l'utilisateur par customerId: ${error.message}`);
      return null;
    }
  }

  /**
   * Générer un token de service interne
   */
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
          timeout: 5000
        }
      );

      logger.info(`Paiement enregistré pour l'utilisateur ${userId}`);
      return response.data;
    } catch (error) {
      logger.error(`Erreur lors de l'enregistrement du paiement: ${error.message}`);
      
      return {
        success: false,
        message: "Échec de l'enregistrement du paiement. Sera réessayé ultérieurement."
      };
    }
  }
}

module.exports = SubscriptionIntegrationService;