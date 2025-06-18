const express = require('express');
const { authMiddleware } = require("../middlewares/authMiddleware.js");
const subscriptionController = require('../controllers/subscriptionController');

const router = express.Router();

router.use(authMiddleware); // Toutes les routes nécessitent une auth

// Routes de consultation
router.get("/current", subscriptionController.getCurrentSubscription);
router.get("/user/:userId", subscriptionController.getUserSubscription);

// 🔥 ROUTES D'ACTIONS
router.delete("/cancel", subscriptionController.cancel);        // URL recommandée
router.delete("/", subscriptionController.cancel);              // Compatibilité avec l'ancien frontend

router.post("/reactivate", subscriptionController.reactivate);  // Réactivation
router.put("/change-plan", subscriptionController.changePlan);  // 🔥 NOUVEAU : Changement de plan

// Paiement
router.post("/checkout", subscriptionController.createCheckoutSession);

module.exports = router;