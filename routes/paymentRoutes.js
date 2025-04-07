// payment-service/routes/paymentRoutes.js
const express = require('express');
const router = express.Router();

// Import middlewares
const authMiddleware = require('../middlewares/authMiddleware');

// Import controllers
const paymentController = require('../controllers/paymentController');
const subscriptionController = require('../controllers/subscriptionController');

// Apply authentication middleware to all payment routes
router.use(authMiddleware);

// Payment endpoints
router.post('/checkout', paymentController.createCheckoutSession);
router.post('/subscription', subscriptionController.createSubscription);
router.get('/status/:userId', subscriptionController.getSubscriptionStatus);
router.post('/refund', paymentController.refundPayment);

// Expose public prices
router.get('/prices', paymentController.getPublicPrices);

// Subscription management
router.get('/subscription/:subscriptionId', subscriptionController.getSubscriptionDetails);
router.post('/subscription/:subscriptionId/cancel', subscriptionController.cancelSubscription);
router.post('/subscription/:subscriptionId/update', subscriptionController.updateSubscription);

module.exports = router;