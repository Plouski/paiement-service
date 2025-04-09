// payment-service/services/apiClientService.js
const axios = require('axios');
const { logger } = require('../utils/logger');

/**
 * Service client API pour les communications inter-services
 * Fournit des méthodes standardisées pour communiquer avec les autres microservices
 */
class ApiClientService {
  constructor() {
    this.clients = {
      auth: this.createClient(process.env.AUTH_SERVICE_URL || 'http://localhost:5001'),
      database: this.createClient(process.env.DATABASE_SERVICE_URL || 'http://localhost:5002'),
      notification: this.createClient(process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:5003'),
      ai: this.createClient(process.env.AI_SERVICE_URL || 'http://localhost:5005'),
      metrics: this.createClient(process.env.METRICS_SERVICE_URL || 'http://localhost:5006')
    };

    this.serviceApiKey = process.env.SERVICE_API_KEY;
    
    if (!this.serviceApiKey) {
      logger.warn('SERVICE_API_KEY is not configured. Inter-service authentication will fail.');
    }
  }

  /**
   * Crée un client Axios configuré pour un service spécifique
   */
  createClient(baseURL) {
    const client = axios.create({
      baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.serviceApiKey
      }
    });

    // Intercepteur pour logger les requêtes
    client.interceptors.request.use(
      config => {
        logger.debug(`Requête API: ${config.method.toUpperCase()} ${config.baseURL}${config.url}`);
        return config;
      },
      error => {
        logger.error('Erreur de requête API:', error);
        return Promise.reject(error);
      }
    );

    // Intercepteur pour logger les réponses et les erreurs
    client.interceptors.response.use(
      response => {
        logger.debug(`Réponse API: ${response.status} ${response.config.method.toUpperCase()} ${response.config.url}`);
        return response;
      },
      error => {
        if (error.response) {
          logger.error(`Erreur API: ${error.response.status} ${error.config?.method?.toUpperCase()} ${error.config?.url}`, {
            status: error.response.status,
            data: error.response.data,
            headers: error.response.headers
          });
        } else if (error.request) {
          logger.error(`Erreur de connexion API: ${error.config?.method?.toUpperCase()} ${error.config?.url}`, {
            message: error.message
          });
        } else {
          logger.error(`Erreur API: ${error.message}`);
        }
        return Promise.reject(error);
      }
    );

    return client;
  }

  /**
   * Méthodes pour communiquer avec le service d'authentification
   */
  auth = {
    verifyToken: async (token) => {
      try {
        const response = await this.clients.auth.post('/auth/verify-token', { token });
        return response.data;
      } catch (error) {
        logger.error('Erreur lors de la vérification du token:', error.message);
        throw new Error('Failed to verify authentication token');
      }
    }
  };

  /**
   * Méthodes pour communiquer avec le service de base de données
   */
  database = {
    getUserById: async (userId) => {
      try {
        const response = await this.clients.database.get(`/api/users/${userId}`);
        return response.data;
      } catch (error) {
        logger.error(`Erreur lors de la récupération de l'utilisateur ${userId}:`, error.message);
        throw new Error('Failed to fetch user data');
      }
    },
    
    updateSubscription: async (userId, subscriptionData) => {
      try {
        const response = await this.clients.database.post(
          '/api/subscriptions/update-from-payment',
          {
            userId,
            ...subscriptionData
          }
        );
        return response.data;
      } catch (error) {
        logger.error(`Erreur lors de la mise à jour de l'abonnement pour l'utilisateur ${userId}:`, error.message);
        throw new Error('Failed to update subscription');
      }
    },
    
    checkSubscriptionStatus: async (userId) => {
      try {
        const response = await this.clients.database.get(`/api/subscriptions/status/${userId}`);
        return response.data;
      } catch (error) {
        logger.error(`Erreur lors de la vérification du statut d'abonnement pour l'utilisateur ${userId}:`, error.message);
        throw new Error('Failed to check subscription status');
      }
    },
    
    recordPayment: async (userId, paymentData) => {
      try {
        const response = await this.clients.database.post(
          '/api/subscriptions/record-payment',
          {
            userId,
            ...paymentData
          }
        );
        return response.data;
      } catch (error) {
        logger.error(`Erreur lors de l'enregistrement du paiement pour l'utilisateur ${userId}:`, error.message);
        throw new Error('Failed to record payment');
      }
    },
    
    getUserByStripeCustomerId: async (customerId) => {
      try {
        const response = await this.clients.database.get(`/api/users/stripe-customer/${customerId}`);
        return response.data;
      } catch (error) {
        logger.error(`Erreur lors de la récupération de l'utilisateur par customerId ${customerId}:`, error.message);
        throw new Error('Failed to fetch user by Stripe customer ID');
      }
    }
  };

  /**
   * Méthodes pour communiquer avec le service de notification
   */
  notification = {
    sendSubscriptionConfirmation: async (userId, subscriptionDetails) => {
      try {
        const response = await this.clients.notification.post(
          '/notifications/subscription/confirmation',
          {
            userId,
            subscriptionDetails
          }
        );
        return response.data;
      } catch (error) {
        logger.error(`Erreur lors de l'envoi de la notification de confirmation d'abonnement pour l'utilisateur ${userId}:`, error.message);
        // Ne pas propager l'erreur pour éviter de bloquer le processus principal
        return { success: false, message: error.message };
      }
    },
    
    sendPaymentReceipt: async (userId, paymentDetails) => {
      try {
        const response = await this.clients.notification.post(
          '/notifications/payment/receipt',
          {
            userId,
            paymentDetails
          }
        );
        return response.data;
      } catch (error) {
        logger.error(`Erreur lors de l'envoi du reçu de paiement pour l'utilisateur ${userId}:`, error.message);
        // Ne pas propager l'erreur pour éviter de bloquer le processus principal
        return { success: false, message: error.message };
      }
    }
  };

  /**
   * Méthodes pour communiquer avec le service de métriques
   */
  metrics = {
    recordPaymentEvent: async (eventData) => {
      try {
        const response = await this.clients.metrics.post(
          '/metrics/payment',
          eventData
        );
        
        // Si le service retourne explicitement un échec
        if (response.data && response.data.success === false) {
          throw new Error(response.data.message || 'Échec de l\'enregistrement de la métrique de paiement');
        }
        
        return response.data;
      } catch (error) {
        logger.error('Erreur lors de l\'enregistrement de la métrique de paiement:', error.message);
        throw error; // Propager l'erreur
      }
    },
    
    recordSubscriptionEvent: async (eventData) => {
      try {
        const response = await this.clients.metrics.post(
          '/metrics/subscription',
          eventData
        );
        return response.data;
      } catch (error) {
        logger.error('Erreur lors de l\'enregistrement de la métrique d\'abonnement:', error.message);
        // Ne pas propager l'erreur pour éviter de bloquer le processus principal
        return { success: false, message: error.message };
      }
    }
  };
}

// Exporter une instance unique pour toute l'application
module.exports = new ApiClientService();