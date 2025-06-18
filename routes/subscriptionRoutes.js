const express = require('express');
const { authMiddleware } = require("../middlewares/authMiddleware.js");
const subscriptionController = require('../controllers/subscriptionController');

const router = express.Router();

// Middleware d'authentification global : toutes les routes nécessitent un utilisateur connecté
router.use(authMiddleware);

// Récupérer l'abonnement de l'utilisateur connecté
router.get("/current", subscriptionController.getCurrentSubscription);

// Récupérer l'abonnement d'un utilisateur spécifique (admin ou soi-même)
router.get("/user/:userId", subscriptionController.getUserSubscription);

// Annuler l’abonnement (fin de période)
router.delete("/cancel", subscriptionController.cancel);

// Réactiver un abonnement annulé (si éligible)
router.post("/reactivate", subscriptionController.reactivate);

// Changer le plan (mensuel ↔ annuel)
router.put("/change-plan", subscriptionController.changePlan);

// Créer une session Stripe Checkout (initialisation de paiement)
router.post("/checkout", subscriptionController.createCheckoutSession);

module.exports = router;