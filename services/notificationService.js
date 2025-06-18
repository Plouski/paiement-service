// 📬 Service pour envoyer des notifications (emails) via le microservice notifications
const axios = require('axios');
const { logger } = require('../utils/logger');

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:5005';
const API_KEY = process.env.NOTIFICATION_API_KEY;

class NotificationService {

  // Méthode générique pour envoyer un email via le service de notification
  static async sendEmail(type, email, data) {
    try {
      logger.info(`📧 Envoi d'un email de type '${type}' à ${email}`, { data });

      const payload = {
        type,
        email,
        data
      };

      const response = await axios.post(
        `${NOTIFICATION_SERVICE_URL}/api/notifications/email`,
        payload,
        {
          headers: {
            'x-api-key': API_KEY,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      logger.info(`✅ Email '${type}' envoyé avec succès à ${email}`);
      return response.data;

    } catch (error) {
      if (error.response) {
        logger.error(`❌ Erreur HTTP ${error.response.status} lors de l'envoi de l'email`, {
          status: error.response.status,
          data: error.response.data,
          url: error.config?.url
        });
      } else if (error.request) {
        logger.error('❌ Aucun retour du service de notification (timeout ?)', {
          timeout: error.code === 'ECONNABORTED',
          url: NOTIFICATION_SERVICE_URL
        });
      } else {
        logger.error('❌ Erreur lors de la configuration de la requête Axios', error.message);
      }
      throw error;
    }
  }

  // Envoie un email avec la facture d'abonnement
  static async sendInvoice(userEmail, invoiceData) {
    return this.sendEmail('invoice', userEmail, invoiceData);
  }

  // Envoie une notification pour le début d'un abonnement
  static async sendSubscriptionStarted(userEmail, subscriptionData) {
    return this.sendEmail('subscription_started', userEmail, subscriptionData);
  }

  // Envoie une notification pour la fin d'un abonnement
  static async sendSubscriptionEnded(userEmail, subscriptionData) {
    return this.sendEmail('subscription_ended', userEmail, subscriptionData);
  }

  // Envoie une notification lorsque l'annulation est programmée
  static async sendSubscriptionCancelScheduled(userEmail, subscriptionData) {
    return this.sendEmail('subscription_cancel_scheduled', userEmail, subscriptionData);
  }

  // Envoie une notification lors de la réactivation de l'abonnement
  static async sendSubscriptionReactivated(userEmail, subscriptionData) {
    return this.sendEmail('subscription_reactivated', userEmail, subscriptionData);
  }

  // Envoie une notification lorsqu'un utilisateur change de plan
  static async sendPlanChanged(userEmail, planData) {
    return this.sendEmail('plan_changed', userEmail, planData);
  }

  // Envoie une notification en cas d'échec de paiement
  static async sendPaymentFailed(userEmail, paymentData) {
    return this.sendEmail('payment_failed', userEmail, paymentData);
  }

  // Génère les données de facture (pour email ou PDF)
  static generateInvoiceData(subscription, payment) {
    return {
      invoiceNumber: `ROADTRIP-${Date.now()}`,
      date: new Date().toLocaleDateString('fr-FR'),
      customer: {
        email: subscription.userEmail || subscription.email || 'inconnu',
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

  // Vérifie que le service de notification est accessible
  static async testConnection() {
    try {
      const response = await axios.get(`${NOTIFICATION_SERVICE_URL}/ping`, { timeout: 5000 });
      logger.info('✅ Service de notifications accessible');
      return true;
    } catch (error) {
      logger.warn('⚠️ Service de notifications inaccessible');
      return false;
    }
  }
}

module.exports = NotificationService;