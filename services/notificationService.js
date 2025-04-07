// payment-service/services/notificationService.js
const axios = require('axios');
const { logger } = require('../utils/logger');

// Base URL for notification service
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:5005';

/**
 * Send invoice to user via notification service
 */
const sendInvoice = async ({
  userId,
  amount,
  currency,
  productId,
  invoiceId,
  paymentDate,
  subscriptionId,
  nextBillingDate
}) => {
  try {
    logger.info(`Sending invoice notification for user ${userId}, invoice ${invoiceId}`);
    
    // Format the data for the notification service
    const notificationData = {
      userId,
      type: 'INVOICE',
      subject: 'Your Invoice',
      data: {
        invoiceId,
        amount,
        currency,
        productId,
        paymentDate: paymentDate.toISOString(),
        subscriptionId,
        nextBillingDate: nextBillingDate ? nextBillingDate.toISOString() : undefined,
        isSubscription: !!subscriptionId
      }
    };
    
    // Send to notification service
    const response = await axios.post(
      `${NOTIFICATION_SERVICE_URL}/notifications/email`,
      notificationData
    );
    
    return response.data;
  } catch (error) {
    logger.error(`Error sending invoice notification: ${error.message}`);
    throw error;
  }
};

/**
 * Send subscription confirmation
 */
const sendSubscriptionConfirmation = async ({
  userId,
  subscriptionId,
  productId,
  planName,
  startDate,
  expiresAt
}) => {
  try {
    logger.info(`Sending subscription confirmation for user ${userId}, subscription ${subscriptionId}`);
    
    // Format the data for the notification service
    const notificationData = {
      userId,
      type: 'SUBSCRIPTION_CONFIRMATION',
      subject: 'Subscription Confirmation',
      data: {
        subscriptionId,
        productId,
        planName,
        startDate: startDate.toISOString(),
        expiresAt: expiresAt.toISOString()
      }
    };
    
    // Send to notification service
    const response = await axios.post(
      `${NOTIFICATION_SERVICE_URL}/notifications/email`,
      notificationData
    );
    
    return response.data;
  } catch (error) {
    logger.error(`Error sending subscription confirmation: ${error.message}`);
    throw error;
  }
};

/**
 * Send subscription cancellation notice
 */
const sendSubscriptionCancelationNotice = async ({
  userId,
  subscriptionId,
  effectiveDate
}) => {
  try {
    logger.info(`Sending subscription cancellation notice for user ${userId}, subscription ${subscriptionId}`);
    
    // Format the data for the notification service
    const notificationData = {
      userId,
      type: 'SUBSCRIPTION_CANCELLATION',
      subject: 'Subscription Cancellation Confirmation',
      data: {
        subscriptionId,
        effectiveDate: effectiveDate.toISOString()
      }
    };
    
    // Send to notification service
    const response = await axios.post(
      `${NOTIFICATION_SERVICE_URL}/notifications/email`,
      notificationData
    );
    
    return response.data;
  } catch (error) {
    logger.error(`Error sending subscription cancellation notice: ${error.message}`);
    throw error;
  }
};

/**
 * Send subscription update notice
 */
const sendSubscriptionUpdateNotice = async ({
  userId,
  subscriptionId,
  newPlanId,
  effectiveDate
}) => {
  try {
    logger.info(`Sending subscription update notice for user ${userId}, subscription ${subscriptionId}`);
    
    // Format the data for the notification service
    const notificationData = {
      userId,
      type: 'SUBSCRIPTION_UPDATE',
      subject: 'Subscription Update Confirmation',
      data: {
        subscriptionId,
        newPlanId,
        effectiveDate: effectiveDate.toISOString()
      }
    };
    
    // Send to notification service
    const response = await axios.post(
      `${NOTIFICATION_SERVICE_URL}/notifications/email`,
      notificationData
    );
    
    return response.data;
  } catch (error) {
    logger.error(`Error sending subscription update notice: ${error.message}`);
    throw error;
  }
};

/**
 * Send subscription ended notice
 */
const sendSubscriptionEndedNotice = async ({
  userId,
  subscriptionId,
  endDate
}) => {
  try {
    logger.info(`Sending subscription ended notice for user ${userId}, subscription ${subscriptionId}`);
    
    // Format the data for the notification service
    const notificationData = {
      userId,
      type: 'SUBSCRIPTION_ENDED',
      subject: 'Your Subscription Has Ended',
      data: {
        subscriptionId,
        endDate: endDate.toISOString()
      }
    };
    
    // Send to notification service
    const response = await axios.post(
      `${NOTIFICATION_SERVICE_URL}/notifications/email`,
      notificationData
    );
    
    return response.data;
  } catch (error) {
    logger.error(`Error sending subscription ended notice: ${error.message}`);
    throw error;
  }
};

/**
 * Send payment failure notice
 */
const sendPaymentFailureNotice = async ({
  userId,
  subscriptionId,
  invoiceId,
  amount,
  currency,
  attemptCount,
  nextAttemptDate
}) => {
  try {
    logger.info(`Sending payment failure notice for user ${userId}, subscription ${subscriptionId}`);
    
    // Format the data for the notification service
    const notificationData = {
      userId,
      type: 'PAYMENT_FAILURE',
      subject: 'Payment Failure Notice',
      data: {
        subscriptionId,
        invoiceId,
        amount,
        currency,
        attemptCount,
        nextAttemptDate: nextAttemptDate ? nextAttemptDate.toISOString() : null,
        isLastAttempt: !nextAttemptDate
      }
    };
    
    // Send to notification service
    const response = await axios.post(
      `${NOTIFICATION_SERVICE_URL}/notifications/email`,
      notificationData
    );
    
    return response.data;
  } catch (error) {
    logger.error(`Error sending payment failure notice: ${error.message}`);
    throw error;
  }
};

/**
 * Send refund notification
 */
const sendRefundNotification = async ({
  userId,
  refundId,
  amount,
  currency
}) => {
  try {
    logger.info(`Sending refund notification for user ${userId}, refund ${refundId}`);
    
    // Format the data for the notification service
    const notificationData = {
      userId,
      type: 'REFUND',
      subject: 'Refund Confirmation',
      data: {
        refundId,
        amount,
        currency,
        refundDate: new Date().toISOString()
      }
    };
    
    // Send to notification service
    const response = await axios.post(
      `${NOTIFICATION_SERVICE_URL}/notifications/email`,
      notificationData
    );
    
    return response.data;
  } catch (error) {
    logger.error(`Error sending refund notification: ${error.message}`);
    throw error;
  }
};

module.exports = {
  sendInvoice,
  sendSubscriptionConfirmation,
  sendSubscriptionCancelationNotice,
  sendSubscriptionUpdateNotice,
  sendSubscriptionEndedNotice,
  sendPaymentFailureNotice,
  sendRefundNotification
};