const express = require('express');
const Stripe = require("stripe");
const SubscriptionIntegrationService = require('../services/subscriptionIntegrationService');
const WebhookController = require('../controllers/webhookController');

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post("/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("⚠️ Webhook error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const subscription = event.data.object;
  const customerId = subscription.customer;
  const metadata = subscription.metadata || {};

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await SubscriptionIntegrationService.updateSubscription(metadata.userId, {
          plan: metadata.plan || "monthly",
          paymentMethod: "stripe",
          status: "active",
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscription.id,
          updateUserRole: true,
        });
        break;

      case "invoice.payment_succeeded":
        const userId1 = await SubscriptionIntegrationService.getUserIdFromCustomerId(customerId);
        if (userId1) {
          const newDate = new Date();
          newDate.setMonth(newDate.getMonth() + 1);
          await SubscriptionIntegrationService.updateSubscription(userId1, {
            status: "active",
            endDate: newDate,
          });
        }
        break;

      case "customer.subscription.deleted":
        const userId2 = await SubscriptionIntegrationService.getUserIdFromCustomerId(customerId);
        if (userId2) {
          await SubscriptionIntegrationService.updateSubscription(userId2, {
            status: "canceled",
            plan: "free",
            updateUserRole: true
          });
        }
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("Erreur lors du traitement du webhook Stripe:", err);
    res.status(500).json({ error: "Erreur interne" });
  }
});

router.post('/simulate/checkout', async (req, res) => {
  const fakeSession = {
    id: 'cs_test_simulated',
    customer: 'cus_fake123',
    subscription: 'sub_fake123',
    metadata: {
      userId: req.body.userId,
      plan: req.body.plan || 'monthly'
    }
  };

  try {
    const result = await WebhookController.handleCheckoutSessionCompleted(fakeSession);
    res.status(200).json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
