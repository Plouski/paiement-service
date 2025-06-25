const { logger } = require("../utils/logger");

class ValidationMiddleware {
  // Validation des données de paiement
  static validatePaymentData(req, res, next) {
    const { plan } = req.body;

    if (!plan) {
      return res.status(400).json({ error: "Le plan est requis" });
    }

    if (!["monthly", "annual"].includes(plan)) {
      return res.status(400).json({
        error: "Plan invalide. Utilisez 'monthly' ou 'annual'",
      });
    }

    next();
  }

  // Sanitisation basique des données
  static sanitizeInput(req, res, next) {
    const sanitizeString = (str) => {
      if (typeof str !== "string") return str;
      return str.trim().replace(/[<>]/g, "");
    };

    if (req.body) {
      Object.keys(req.body).forEach((key) => {
        if (typeof req.body[key] === "string") {
          req.body[key] = sanitizeString(req.body[key]);
        }
      });
    }

    next();
  }
}

module.exports = ValidationMiddleware;