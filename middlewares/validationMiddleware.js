const { logger } = require('../utils/logger');

class ValidationMiddleware {

  // Validation des données de paiement
  static validatePaymentData(req, res, next) {
    const { plan } = req.body;

    if (!plan) {
      return res.status(400).json({ error: "Le plan est requis" });
    }

    if (!["monthly", "annual"].includes(plan)) {
      return res.status(400).json({ 
        error: "Plan invalide. Utilisez 'monthly' ou 'annual'" 
      });
    }

    next();
  }

  // Validation des IDs utilisateur
  static validateUserId(req, res, next) {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "ID utilisateur requis" });
    }

    if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
      return res.status(400).json({ 
        error: "Format d'ID utilisateur invalide" 
      });
    }

    next();
  }

  // Validation des changements de plan
  static validatePlanChange(req, res, next) {
    const { newPlan } = req.body;

    if (!newPlan) {
      return res.status(400).json({ error: "Le nouveau plan est requis" });
    }

    if (!["monthly", "annual"].includes(newPlan)) {
      return res.status(400).json({ 
        error: "Nouveau plan invalide. Utilisez 'monthly' ou 'annual'" 
      });
    }

    next();
  }

  // Sanitisation basique des données
  static sanitizeInput(req, res, next) {
    // Nettoyer les chaînes de caractères
    const sanitizeString = (str) => {
      if (typeof str !== 'string') return str;
      return str.trim().replace(/[<>]/g, '');
    };

    // Sanitiser le body
    if (req.body) {
      Object.keys(req.body).forEach(key => {
        if (typeof req.body[key] === 'string') {
          req.body[key] = sanitizeString(req.body[key]);
        }
      });
    }

    next();
  }

  // Validation de taille de requête
  static validateRequestSize(req, res, next) {
    if (req.body && JSON.stringify(req.body).length > 5000) {
      return res.status(400).json({ 
        error: "Requête trop volumineuse" 
      });
    }

    next();
  }
}

module.exports = ValidationMiddleware;