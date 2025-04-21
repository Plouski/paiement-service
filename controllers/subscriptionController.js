const subscriptionService = require("../services/subscriptionService.js");
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

class subscriptionController {
    static async getCurrent(req, res) {
        const subscription = await subscriptionService.getCurrentSubscription(req.user.id);
        if (!subscription) return res.status(404).json({ message: "Aucun abonnement actif trouvé." });
        res.json(subscription);
    }

    static async getStatus(req, res) {
        const result = await subscriptionService.getStatus(req.params.userId);
        res.json(result);
    }

    static async update(req, res) {
        const subscription = await subscriptionService.update(req.user.id, req.body);
        res.json(subscription);
    }

    static async cancel(req, res) {
        try {
            const result = await subscriptionService.cancel(req.user.userId);
            res.json({ success: true, subscription: result });
        } catch (err) {
            console.error('Erreur annulation abonnement:', err);
            res.status(500).json({ error: 'Erreur lors de l\'annulation de l\'abonnement' });
        }
    }

    static async getHistory(req, res) {
        const { page = 1, limit = 10, status } = req.query;
        const result = await subscriptionService.getHistory(req.user.id, limit, page, status);
        res.json(result);
    }

    static async getFeatures(req, res) {
        const result = await subscriptionService.getFeatures(req.user.id);
        res.json(result);
    }

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

            const userId = user.userId || user.id;
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
                    userId: userId,
                    plan
                },
                success_url: `${process.env.CLIENT_URL}/premium/success`,
                cancel_url: `${process.env.CLIENT_URL}/premium/cancel`
            });

            res.status(200).json({ url: session.url });

        } catch (error) {
            console.error("Erreur Checkout Stripe:", error);
            res.status(500).json({ error: "Erreur lors de la création de la session Stripe" });
        }
    }

    static async getUserSubscription(req, res) {
        const userId = req.params.userId;

        if (req.user.role !== "admin" && req.user.userId !== userId) {
            return res.status(403).json({ message: "Accès interdit" });
        }

        try {
            const subscription = await subscriptionService.getCurrentSubscription(userId);

            if (!subscription) {
                return res.status(404).json({ message: "Aucun abonnement actif trouvé." });
            }

            res.json(subscription);
        } catch (error) {
            console.error("❌ Erreur getUserSubscription:", error);
            res.status(500).json({ message: "Erreur serveur." });
        }
    }
}

module.exports = subscriptionController;