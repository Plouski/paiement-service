const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator'); // Ajoutez validationResult ici
const premiumController = require('../controllers/premiumController');
const { authMiddleware, checkRole, serviceAuthMiddleware } = require('../middlewares/authMiddleware');

/**
 * Validations pour les requêtes
 */
const createSubscriptionValidation = [
  body('priceId')
    .notEmpty().withMessage('Le priceId est requis')
    .isString().withMessage('Le priceId doit être une chaîne de caractères'),
  body('userId')
    .optional()
    .isString().withMessage('L\'userId doit être une chaîne de caractères')
];

const cancelSubscriptionValidation = [
  body('stripeSubscriptionId')
    .notEmpty().withMessage('Le stripeSubscriptionId est requis')
    .isString().withMessage('Le stripeSubscriptionId doit être une chaîne de caractères')
];

/**
 * Middleware de validation
 */
const validate = (validations) => {
  return async (req, res, next) => {
    for (let validation of validations) {
      const result = await validation.run(req);
      if (result.errors.length) break;
    }

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    return res.status(400).json({ 
      error: 'Validation Error',
      details: errors.array() 
    });
  };
};

/**
 * Route pour créer une session de paiement pour un abonnement premium
 * @route POST /premium/subscribe
 * @access Private
 */
router.post('/subscribe',
  authMiddleware,
  validate(createSubscriptionValidation),
  premiumController.createPremiumSubscription
);

/**
 * Route pour récupérer les abonnements d'un utilisateur
 * @route GET /premium/subscriptions/:userId
 * @access Private
 */
router.get('/subscriptions/:userId',
  authMiddleware,
  param('userId').isString().withMessage('L\'userId doit être une chaîne de caractères'),
  premiumController.getUserSubscriptions
);

/**
 * Route pour vérifier le statut premium d'un utilisateur
 * @route GET /premium/status/:userId
 * @access Private/Service
 */
router.get('/status/:userId',
  authMiddleware,
  param('userId').isString().withMessage('L\'userId doit être une chaîne de caractères'),
  premiumController.checkPremiumStatus
);

/**
 * Route pour vérifier le statut premium de l'utilisateur authentifié
 * @route GET /premium/status
 * @access Private
 */
router.get('/status',
  authMiddleware,
  (req, res) => {
    if (!req.user || !req.user.userId) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }
    
    // Rediriger vers la route avec l'ID utilisateur
    req.params.userId = req.user.userId;
    premiumController.checkPremiumStatus(req, res);
  }
);

/**
 * Route pour annuler un abonnement premium
 * @route POST /premium/cancel/:userId
 * @access Private
 */
router.post('/cancel/:userId',
  authMiddleware,
  param('userId').isString().withMessage('L\'userId doit être une chaîne de caractères'),
  validate(cancelSubscriptionValidation),
  premiumController.cancelPremiumSubscription
);

/**
 * Route de service pour vérifier un statut premium
 * @route GET /premium/service/status/:userId
 * @access Service
 */
router.get('/service/status/:userId',
  serviceAuthMiddleware,
  param('userId').isString().withMessage('L\'userId doit être une chaîne de caractères'),
  premiumController.checkPremiumStatus
);

module.exports = router;