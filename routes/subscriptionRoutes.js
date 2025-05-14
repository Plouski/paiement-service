const express = require('express');
const { authMiddleware } = require("../middlewares/authMiddleware.js");
const subscriptionController = require('../controllers/subscriptionController');

const router = express.Router();

router.use(authMiddleware); // Toutes les routes nécessitent une auth

router.get("/current", subscriptionController.getCurrentSubscription);
router.get("/user/:userId", authMiddleware, subscriptionController.getUserSubscription);
// router.get("/status/:userId", subscriptionController.getStatus);
// router.put("/", subscriptionController.update);
router.delete("/", subscriptionController.cancel);
// router.get("/history", subscriptionController.getHistory);
// router.get("/features", subscriptionController.getFeatures);

router.post("/checkout", subscriptionController.createCheckoutSession);

module.exports = router;
