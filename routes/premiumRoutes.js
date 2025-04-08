const express = require('express');
const router = express.Router();
const premiumController = require('../controllers/premiumController');
const authMiddleware = require('../middlewares/authMiddleware');

// Route pour créer une session de paiement pour un abonnement premium
router.post('/subscribe',
  authMiddleware,
  premiumController.createPremiumSubscription
);

router.get('/subscriptions/:userId',
  authMiddleware,
  premiumController.getUserSubscriptions
);

// Route pour vérifier le statut premium d'un utilisateur
router.get('/status/:userId',
  authMiddleware,
  premiumController.checkPremiumStatus
);

// Route pour annuler un abonnement premium
router.post('/cancel/:userId',
  authMiddleware,
  premiumController.cancelPremiumSubscription
);

module.exports = router;