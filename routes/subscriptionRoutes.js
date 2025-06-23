const express = require('express');
const { authMiddleware } = require("../middlewares/authMiddleware.js");
const subscriptionController = require('../controllers/subscriptionController');
const refundController = require('../controllers/refundController.js');
const ValidationMiddleware = require('../middlewares/validationMiddleware');
const RateLimitMiddleware = require('../middlewares/rateLimitMiddleware');

const router = express.Router();

// Rate limiting général
router.use(RateLimitMiddleware.generalRateLimit());

// Authentification pour toutes les routes
router.use(authMiddleware);

// Validation de base
router.use(ValidationMiddleware.sanitizeInput);
router.use(ValidationMiddleware.validateRequestSize);

// Récupérer l'abonnement actuel
router.get("/current", subscriptionController.getCurrentSubscription);

// Récupérer l'abonnement d'un utilisateur spécifique
router.get("/user/:userId", 
  ValidationMiddleware.validateUserId,
  subscriptionController.getUserSubscription
);

// Créer une session de paiement
router.post("/checkout", 
  // RateLimitMiddleware.paymentRateLimit(),
  ValidationMiddleware.validatePaymentData,
  subscriptionController.createCheckoutSession
);

// Annuler l'abonnement
router.delete("/cancel", subscriptionController.cancel);

// Réactiver l'abonnement
router.post("/reactivate", subscriptionController.reactivate);

// Changer de plan
router.put("/change-plan", 
  ValidationMiddleware.validatePlanChange,
  subscriptionController.changePlan
);

// Demander un remboursement
router.post("/refund", 
  // RateLimitMiddleware.refundRateLimit(),
  refundController.processRefund
);

// Vérifier l'éligibilité au remboursement
router.get("/refund/eligibility", 
  refundController.checkEligibility
);

// Routes de debug
router.get('/debug/dates', subscriptionController.debugSubscriptionDates);
router.post('/debug/fix-dates', subscriptionController.fixSubscriptionDates);

module.exports = router;