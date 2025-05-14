const subscriptionIntegrationService = require("../services/subscriptionIntegrationService.js");
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

class subscriptionController {
    static async getCurrentSubscription(req, res) {
        try {
            const userId = req.user?.userId || req.user?.id;
            if (!userId) return res.status(401).json({ message: "Utilisateur non authentifié." });

            const subscription = await subscriptionIntegrationService.getCurrentSubscription(userId);

            if (!subscription) {
                return res.status(404).json({ message: "Aucun abonnement actif trouvé." });
            }

            res.json(subscription);
        } catch (error) {
            console.error("❌ Erreur getCurrentSubscription:", error);
            res.status(500).json({ message: "Erreur serveur." });
        }
    }

    static async getUserSubscription(req, res) {
        const userId = req.params.userId;
        const requesterId = req.user?.userId || req.user?.id;

        if (req.user.role !== "admin" && requesterId !== userId) {
            return res.status(403).json({ message: "Accès interdit" });
        }

        try {
            const subscription = await subscriptionIntegrationService.getCurrentSubscription(userId);

            if (!subscription) {
                return res.status(404).json({ message: "Aucun abonnement actif trouvé." });
            }

            res.json(subscription);
        } catch (error) {
            console.error("❌ Erreur getUserSubscription:", error);
            res.status(500).json({ message: "Erreur serveur." });
        }
    }

    static async cancel(req, res) {
        try {
            const userId = req.user?.userId || req.user?.id;
            if (!userId) return res.status(401).json({ error: "Utilisateur non authentifié" });

            const result = await subscriptionIntegrationService.cancelSubscription(userId);
            res.json({ success: true, subscription: result });
        } catch (err) {
            console.error("❌ Erreur annulation abonnement:", err);
            res.status(500).json({ error: "Erreur lors de l'annulation de l'abonnement" });
        }
    }

    // static async update(req, res) {
    //     try {
    //       const userId = req.user?.userId || req.user?.id;
    //       if (!userId) return res.status(401).json({ error: "Utilisateur non authentifié." });
      
    //       const updatedSubscription = await subscriptionIntegrationService.updateSubscription(userId, req.body);
      
    //       if (!updatedSubscription) {
    //         return res.status(404).json({ error: "Abonnement introuvable ou non mis à jour." });
    //       }
      
    //       res.json(updatedSubscription);
    //     } catch (error) {
    //       console.error("❌ Erreur update abonnement:", error);
    //       res.status(500).json({ error: "Erreur lors de la mise à jour de l'abonnement." });
    //     }
    //   }
      

    static async createCheckoutSession(req, res) {
        try {
            const { plan } = req.body;
            const user = req.user;

            if (!["monthly", "annual"].includes(plan)) {
                return res.status(400).json({ error: "Plan invalide" });
            }

            const priceId = plan === "annual"
                ? process.env.STRIPE_PRICE_ANNUAL_ID
                : process.env.STRIPE_PRICE_MONTHLY_ID;

            if (!priceId) {
                return res.status(500).json({ error: "Price ID non défini dans les variables d'environnement" });
            }

            const userId = user?.userId || user?.id;
            if (!userId) {
                return res.status(400).json({ error: "ID utilisateur manquant dans le token JWT" });
            }

            console.log("🔥 DEBUG checkout metadata:", { userId, email: user.email });

            const session = await stripe.checkout.sessions.create({
                payment_method_types: ["card"],
                mode: "subscription",
                customer_email: user.email,
                line_items: [{
                    price: priceId,
                    quantity: 1
                }],
                metadata: {
                    userId,
                    plan
                },
                success_url: `${process.env.CLIENT_URL}/premium/success`,
                cancel_url: `${process.env.CLIENT_URL}/premium/cancel`
            });

            res.status(200).json({ url: session.url });

        } catch (error) {
            console.error("❌ Erreur Checkout Stripe:", error);
            res.status(500).json({ error: "Erreur lors de la création de la session Stripe" });
        }
    }
}

module.exports = subscriptionController;
