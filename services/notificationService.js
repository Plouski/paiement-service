// services/notificationService.js - VERSION CORRIGÉE
const axios = require('axios');
const { logger } = require('../utils/logger');

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:5005';
const API_KEY = process.env.NOTIFICATION_API_KEY;

class NotificationService {
  
  // 🔥 Méthode générique pour envoyer des emails
  static async sendEmail(type, email, data) {
    try {
      logger.info(`📧 Envoi email type: ${type} à ${email}`);
      
      const payload = {
        type,
        email,
        data  // Les données spécifiques selon le type
      };

      const response = await axios.post(
        `${NOTIFICATION_SERVICE_URL}/api/notifications/email`, 
        payload,
        {
          headers: {
            'x-api-key': API_KEY,
            'Content-Type': 'application/json'
          },
          timeout: 10000  // 10 secondes timeout
        }
      );
      
      logger.info(`✅ Email ${type} envoyé avec succès`);
      return response.data;
      
    } catch (error) {
      // Meilleure gestion des erreurs
      if (error.response) {
        logger.error(`❌ Erreur HTTP ${error.response.status}:`, {
          status: error.response.status,
          data: error.response.data,
          url: error.config?.url
        });
      } else if (error.request) {
        logger.error('❌ Pas de réponse du service de notifications:', {
          timeout: error.code === 'ECONNABORTED',
          url: NOTIFICATION_SERVICE_URL
        });
      } else {
        logger.error('❌ Erreur configuration requête:', error.message);
      }
      throw error;
    }
  }

  // Envoie la facture par email
  static async sendInvoice(userEmail, invoiceData) {
    return this.sendEmail('invoice', userEmail, invoiceData);
  }

  // Notification début d'abonnement  
  static async sendSubscriptionStarted(userEmail, subscriptionData) {
    return this.sendEmail('subscription_started', userEmail, subscriptionData);
  }

  // Notification fin d'abonnement
  static async sendSubscriptionEnded(userEmail, subscriptionData) {
    return this.sendEmail('subscription_ended', userEmail, subscriptionData);
  }

  // Notification échec de paiement
  static async sendPaymentFailed(userEmail, paymentData) {
    return this.sendEmail('payment_failed', userEmail, paymentData);
  }

  // Service de génération de facture
  static generateInvoiceData(subscription, payment) {
    return {
      invoiceNumber: `ROADTRIP-${Date.now()}`,
      date: new Date().toLocaleDateString('fr-FR'),
      customer: {
        email: subscription.userEmail,
        name: subscription.userName || 'Client'
      },
      items: [{
        description: `Abonnement ${subscription.plan} ROADTRIP`,
        quantity: 1,
        unitPrice: payment.amount,
        total: payment.amount
      }],
      subtotal: payment.amount,
      total: payment.amount,
      currency: payment.currency?.toUpperCase() || 'EUR',
      paymentMethod: 'Carte bancaire (Stripe)',
      transactionId: payment.transactionId,
      notes: 'Merci pour votre confiance !'
    };
  }

  // Test de connectivité
  static async testConnection() {
    try {
      const response = await axios.get(`${NOTIFICATION_SERVICE_URL}/ping`, {
        timeout: 5000
      });
      logger.info('✅ Service de notifications accessible');
      return true;
    } catch (error) {
      logger.warn('⚠️ Service de notifications non accessible');
      return false;
    }
  }
}

module.exports = NotificationService;